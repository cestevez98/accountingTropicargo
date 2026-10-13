/**
 * Importador del libro «TROPICARGO_Contabilidad_Integrada.xlsx».
 * Funciona igual en el navegador (página Importar) y en Node (scripts/import-excel.ts).
 * Lee solo los datos de entrada; todo lo calculado se recalcula en el sistema.
 */
import * as XLSX from 'xlsx'
import { CATEGORIA_ALIAS, CAT_POR_CLASIFICAR, DEFAULT_CATEGORIAS, DEFAULT_CUENTAS, DEFAULT_SETTINGS, MESES } from './catalog'
import { finDeMes } from './fecha'
import type {
  Activo,
  Asiento,
  Categoria,
  CxcManual,
  Dataset,
  Devengo,
  FacturaCompra,
  FacturaVenta,
  Moneda,
  Movimiento,
  PagoProveedor,
  Paquete,
  Tasa,
} from './types'

type Row = unknown[]

export interface ResultadoImportacion {
  dataset: Dataset
  resumen: { coleccion: string; filas: number }[]
  notas: string[]
  /** Valores calculados que tenía guardados el Excel, para comparar (informe → fila → mes → valor). */
  referencia: Record<string, Record<string, Record<string, number>>>
}

const BANCOS: Record<string, string> = {
  BOFA_Tropicargo: 'Bank of America',
  PayPal_Mov: 'PayPal',
  Revolut_Mov: 'Revolut',
  Regions_Mov: 'Regions',
  Truist_Mov: 'Truist',
  'AMERICAN EXPRESS NEXT PLUS ': 'AMEX Next Plus',
  'BOFA NEXT PLUS': 'BOFA Next Plus',
}

const EXTRA_IGNORAR = new Set(['saldo acumulado', 'grupo er (auto)', 'grupo flujo (auto)', 'column1', 'column2', 'mov en usd'])

export function leerLibro(data: ArrayBuffer | Uint8Array): XLSX.WorkBook {
  return XLSX.read(data, { type: 'array', cellDates: false, cellFormula: false, cellStyles: false })
}

function filas(ws: XLSX.WorkSheet | undefined): Row[] {
  if (!ws || !ws['!ref']) return []
  // Se fuerza el rango desde A1 para que el índice de columna coincida con la letra (A = 0).
  const rango = XLSX.utils.decode_range(ws['!ref'])
  rango.s = { r: 0, c: 0 }
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: null, blankrows: true, range: rango })
}

const norm = (v: unknown) =>
  String(v ?? '')
    .trim()
    .toLowerCase()

function fecha(v: unknown): string | undefined {
  if (v == null || v === '') return undefined
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v)
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return undefined
}

function num(v: unknown): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function txt(v: unknown): string {
  if (v == null) return ''
  const s = String(v).trim()
  return s === 'nan' || s === 'None' ? '' : s.replace(/\s+/g, ' ')
}

/** Busca la fila de encabezados que contiene todas las columnas pedidas y devuelve su índice y mapa de columnas. */
function encabezados(rows: Row[], requeridas: string[], maxFila = 30): { fila: number; col: Map<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, maxFila); i++) {
    const col = new Map<string, number>()
    rows[i]?.forEach((v, j) => {
      const k = norm(v)
      if (k && !col.has(k)) col.set(k, j)
    })
    if (requeridas.every((r) => col.has(r))) return { fila: i, col }
  }
  return null
}

const MES_NUM: Record<string, string> = Object.fromEntries(MESES.map((m, i) => [m.toLowerCase(), String(i + 1).padStart(2, '0')]))

export function importarLibro(wb: XLSX.WorkBook): ResultadoImportacion {
  const notas: string[] = []
  const settings = { ...DEFAULT_SETTINGS }
  const inicio = settings.fechaInicio
  const apertura = '2026-07-31'
  const categorias: Categoria[] = DEFAULT_CATEGORIAS.map((c) => ({ ...c }))
  const catNombres = new Set(categorias.map((c) => c.nombre))
  const nuevasCategorias = new Set<string>()
  const ws = (n: string) => wb.Sheets[n]

  const categoria = (v: unknown): string => {
    let c = txt(v)
    if (!c) return CAT_POR_CLASIFICAR
    c = CATEGORIA_ALIAS[c] ?? CATEGORIA_ALIAS[c.toLowerCase()] ?? c
    if (!catNombres.has(c)) {
      catNombres.add(c)
      nuevasCategorias.add(c)
      categorias.push({
        id: `cat-x${categorias.length + 1}`,
        nombre: c,
        grupoER: 'NO AFECTA ER',
        grupoFlujo: 'Interno',
        contrapartida: 'por_clasificar',
        orden: 9000 + categorias.length,
        activa: true,
        nota: 'Importada del Excel: no estaba en el catálogo. Revisa su grupo.',
      })
    }
    return c
  }

  // --- Tasas
  const tasas: Tasa[] = []
  {
    const rows = filas(ws('Tasas'))
    for (let i = 1; i < rows.length; i++) {
      const f = fecha(rows[i]?.[0])
      if (!f) continue
      tasas.push({ id: `tasa-${i}`, fecha: f, cupPorUsd: num(rows[i][1]), usdPorEur: num(rows[i][2]), confirmada: false })
    }
  }

  // --- Movimientos de efectivo
  const movimientos: Movimiento[] = []
  {
    const rows = filas(ws('Efectivo'))
    const h = encabezados(rows, ['fecha', 'caja', 'categoría', 'concepto', 'moneda', 'entrada', 'salida'])
    if (h) {
      const c = h.col
      for (let i = h.fila + 1; i < rows.length; i++) {
        const r = rows[i]
        const f = fecha(r[c.get('fecha')!])
        const caja = txt(r[c.get('caja')!])
        const entrada = num(r[c.get('entrada')!])
        const salida = num(r[c.get('salida')!])
        if (!f || !caja || (!entrada && !salida)) continue
        const moneda = (txt(r[c.get('moneda')!]).toUpperCase() || 'USD') as Moneda
        movimientos.push({
          id: `ef-${i}`,
          fecha: f,
          cuenta: caja,
          categoria: categoria(r[c.get('categoría')!]),
          concepto: txt(r[c.get('concepto')!]),
          moneda: (['USD', 'CUP', 'EUR'].includes(moneda) ? moneda : 'USD') as Moneda,
          entrada,
          salida,
        })
      }
    } else notas.push('No se encontró la tabla de la hoja Efectivo.')
  }

  // --- Estados de cuenta de bancos y tarjetas
  for (const [hoja, cuenta] of Object.entries(BANCOS)) {
    const rows = filas(ws(hoja))
    const h = encabezados(rows, ['fecha', 'concepto de la transacción', 'categoría'])
    if (!h) {
      notas.push(`No se encontró la tabla de la hoja ${hoja}.`)
      continue
    }
    const c = h.col
    const headerRow = rows[h.fila]
    const iObs = c.get('observaciones')
    const extras: [string, number][] = []
    headerRow.forEach((v, j) => {
      const k = norm(v)
      if (!k || EXTRA_IGNORAR.has(k)) return
      if (['fecha', 'concepto de la transacción', 'referencia', 'débito (salidas)', 'crédito (entradas)', 'categoría', 'observaciones'].includes(k)) return
      extras.push([txt(v), j])
    })
    let n = 0
    for (let i = h.fila + 1; i < rows.length; i++) {
      const r = rows[i]
      const f = fecha(r[c.get('fecha')!])
      if (!f) continue
      let entrada = num(r[c.get('crédito (entradas)') ?? -1])
      let salida = num(r[c.get('débito (salidas)') ?? -1])
      const mov = c.has('mov en usd') ? num(r[c.get('mov en usd')!]) : entrada - salida
      if (Math.abs(entrada - salida - mov) > 0.005) {
        // El importe en USD manda (p. ej. Revolut con divisas).
        entrada = mov > 0 ? mov : 0
        salida = mov < 0 ? -mov : 0
      }
      if (!entrada && !salida) continue
      const extra: Record<string, string | number | null> = {}
      for (const [k, j] of extras) {
        const v = r[j]
        if (v == null || v === '' || txt(v) === '') continue
        extra[k] = /fecha/i.test(k) ? (fecha(v) ?? txt(v)) : typeof v === 'number' ? v : txt(v)
      }
      n++
      movimientos.push({
        id: `${hoja.trim().toLowerCase().replace(/\W+/g, '-')}-${i}`,
        fecha: f,
        cuenta,
        categoria: categoria(r[c.get('categoría')!]),
        concepto: txt(r[c.get('concepto de la transacción')!]),
        referencia: txt(r[c.get('referencia') ?? -1]) || undefined,
        moneda: 'USD',
        entrada,
        salida,
        observaciones: iObs != null ? txt(r[iObs]) || undefined : undefined,
        ...(Object.keys(extra).length ? { extra } : {}),
      })
    }
    if (!n) notas.push(`La hoja ${hoja} no tiene movimientos.`)
  }

  // --- Facturación
  const facturas: FacturaVenta[] = []
  {
    const rows = filas(ws('Facturación'))
    const h = encabezados(rows, ['nº factura', 'cliente', 'f. emisión', 'monto usd'])
    if (h) {
      const c = h.col
      const g = (r: Row, k: string) => r[c.get(k) ?? -1]
      for (let i = h.fila + 1; i < rows.length; i++) {
        const r = rows[i]
        const numero = txt(g(r, 'nº factura'))
        const emision = fecha(g(r, 'f. emisión'))
        if (!numero || !emision) continue
        const cliente = txt(g(r, 'cliente'))
        const afecta = norm(g(r, 'afecta er'))
        facturas.push({
          id: `fv-${i}`,
          numero,
          cliente,
          emision,
          vencimiento: fecha(g(r, 'f. vencimiento')),
          monto: num(g(r, 'monto usd')),
          cobrado: num(g(r, 'cobrado usd')),
          servicio: txt(g(r, 'servicio')) || undefined,
          tipoEnvio: txt(g(r, 'tipo de envío')) || undefined,
          subtipo: txt(g(r, 'subtipo')) || undefined,
          detalle: txt(g(r, 'guías y detalle de las líneas')) || undefined,
          estatusSistema: txt(g(r, 'estatus del sistema')) || undefined,
          afectaER: afecta ? afecta.startsWith('s') : cliente !== 'Tropicargo Express',
          notas: txt(g(r, 'notas')) || undefined,
        })
      }
    } else notas.push('No se encontró la tabla de la hoja Facturación.')
  }

  // --- Facturas de compra (Proveedores) + CxPagar
  const facturasCompra: FacturaCompra[] = []
  {
    const rows = filas(ws('Proveedores'))
    const h = encabezados(rows, ['proveedor', 'no. de factura', 'fecha', 'monto (usd)'])
    if (h) {
      const c = h.col
      for (let i = h.fila + 1; i < rows.length; i++) {
        const r = rows[i]
        const f = fecha(r[c.get('fecha')!])
        const monto = num(r[c.get('monto (usd)')!])
        if (!f || !monto) continue
        facturasCompra.push({
          id: `fc-${i}`,
          proveedor: txt(r[c.get('proveedor')!]),
          numero: txt(r[c.get('no. de factura')!]),
          fecha: f,
          descripcion: txt(r[c.get('descripción') ?? -1]) || undefined,
          monto,
          categoria: categoria(r[c.get('categoría') ?? -1]),
          pagado: num(r[c.get('pagado según factura') ?? -1]),
        })
      }
    }
    const cxp = filas(ws('CxPagar'))
    for (let i = 7; i < cxp.length; i++) {
      const r = cxp[i]
      const facturado = num(r?.[6])
      if (!facturado) continue
      const f = fecha(r[4]) ?? apertura
      facturasCompra.push({
        id: `cxp-${i}`,
        numero: txt(r[1]),
        proveedor: txt(r[2]),
        descripcion: txt(r[3]) || undefined,
        fecha: f,
        vencimiento: fecha(r[5]),
        monto: facturado,
        pagado: num(r[7]),
        categoria: f < inicio ? 'Saldo inicial' : CAT_POR_CLASIFICAR,
      })
    }
  }

  // --- Pagos a proveedores (registro informativo)
  const pagosProveedor: PagoProveedor[] = []
  {
    const rows = filas(ws('Pago a Proveedores'))
    const h = encabezados(rows, ['fecha', 'proveedor', 'monto'])
    if (h) {
      const c = h.col
      for (let i = h.fila + 1; i < rows.length; i++) {
        const r = rows[i]
        const f = fecha(r[c.get('fecha')!])
        const monto = num(r[c.get('monto')!])
        if (!f || !monto) continue
        pagosProveedor.push({
          id: `pp-${i}`,
          fecha: f,
          proveedor: txt(r[c.get('proveedor')!]),
          numero: txt(r[c.get('no. de factura') ?? -1]) || undefined,
          monto,
          cuenta: txt(r[c.get('cuenta') ?? -1]) || undefined,
          observaciones: txt(r[c.get('observaciones') ?? -1]) || undefined,
        })
      }
    }
  }

  // --- CxC fuera del sistema
  const cxcManual: CxcManual[] = []
  {
    const rows = filas(ws('CxCobrar'))
    for (let i = 7; i < rows.length; i++) {
      const r = rows[i]
      const numero = txt(r?.[1])
      const facturado = num(r?.[6])
      if (!numero || numero === 'F-SISTEMA' || !facturado) continue
      cxcManual.push({
        id: `cxm-${i}`,
        numero,
        cliente: txt(r[2]),
        descripcion: txt(r[3]) || undefined,
        fecha: fecha(r[4]) ?? apertura,
        vencimiento: fecha(r[5]),
        facturado,
        cobrado: num(r[7]),
      })
    }
  }

  // --- Asientos: intercompañía y otros ingresos no facturados
  const asientos: Asiento[] = []
  {
    const rows = filas(ws('Intercompañía'))
    for (let i = 7; i < rows.length; i++) {
      const r = rows[i]
      if (!r) continue
      const contraparte = txt(r[2])
      const cuenta = /next/i.test(contraparte) ? 'interco_nextplus' : /kaluch/i.test(contraparte) ? 'interco_kaluch' : ''
      if (!cuenta) continue
      if (i <= 8) {
        // Filas 8 y 9: saldo traído del libro de cada empresa (vínculo externo, se toma el valor guardado).
        const saldo = num(r[6])
        if (saldo) asientos.push({ id: `asi-ic-${i}`, fecha: apertura, concepto: `Saldo de apertura intercompañía ${contraparte}`, cargo: cuenta, abono: 'apertura', importe: saldo })
        continue
      }
      const f = fecha(r[1])
      const neto = num(r[5]) - num(r[4])
      if (!f || !neto) continue
      asientos.push({
        id: `asi-ic-${i}`,
        fecha: f,
        concepto: `${contraparte}: ${txt(r[3])}`,
        cargo: cuenta,
        abono: f < inicio ? 'apertura' : 'por_clasificar',
        importe: neto,
        notas: f < inicio ? undefined : 'Importado de Intercompañía: indica la contrapartida correcta.',
      })
    }
  }
  const referencia: ResultadoImportacion['referencia'] = {}
  let anio = 2026
  {
    const ini = filas(ws('INICIO'))
    for (const r of ini.slice(0, 8)) {
      const i = r?.findIndex((v) => norm(v).startsWith('año de trabajo'))
      if (i != null && i >= 0 && typeof r[i + 1] === 'number') anio = r[i + 1] as number
    }
    const er = filas(ws('ER'))
    const otros = er.find((r) => norm(r?.[1]).startsWith('otros ingresos no facturados'))
    if (otros) {
      for (let m = 0; m < 12; m++) {
        const v = num(otros[2 + m])
        const mes = `${anio}-${String(m + 1).padStart(2, '0')}`
        if (!v || `${mes}-01` < inicio) continue
        asientos.push({
          id: `asi-oi-${mes}`,
          fecha: finDeMes(mes),
          concepto: `Otros ingresos no facturados de ${MESES[m]} (pasajes, remesas, carros)`,
          cargo: 'fondos_terceros',
          abono: 'res:Otros ingresos',
          importe: v,
          notas: 'Importado de la fila 7 del ER del Excel. Se asume que el cobro entró como Remesa/Boletería.',
        })
      }
    }
    // Valores de referencia del Excel para el informe de paridad.
    for (const hoja of ['ER', 'EFE', 'Bancos', 'ES']) {
      const rows = filas(ws(hoja))
      const hdr = rows.findIndex((r) => r?.some((v) => norm(v) === 'ene') && r?.some((v) => norm(v) === 'dic'))
      if (hdr < 0) continue
      const cols = new Map<number, string>()
      rows[hdr].forEach((v, j) => {
        const mm = MES_NUM[norm(v)]
        if (mm) cols.set(j, `${anio}-${mm}`)
      })
      const out: Record<string, Record<string, number>> = {}
      for (let i = hdr + 1; i < rows.length; i++) {
        const label = txt(rows[i]?.[1])
        if (!label) continue
        const vals: Record<string, number> = {}
        for (const [j, mes] of cols) if (typeof rows[i][j] === 'number' && `${mes}-01` >= inicio) vals[mes] = rows[i][j] as number
        if (Object.keys(vals).length) out[label] = vals
      }
      referencia[hoja] = out
    }
  }

  // --- Capital de apertura
  {
    const rows = filas(ws('Capital'))
    const ap = rows.find((r) => norm(r?.[1]).startsWith('aportes de capital'))
    if (ap) {
      let total = 0
      for (let m = 0; m < 12; m++) {
        const mes = `${anio}-${String(m + 1).padStart(2, '0')}`
        const v = num(ap[2 + m])
        if (!v) continue
        if (`${mes}-01` <= inicio) total += v
        else notas.push(`Capital: aporte de ${v} en ${MESES[m]} no se importó; regístralo como movimiento «Aporte de capital».`)
      }
      if (total) settings.capitalApertura = total
    }
  }

  // --- Activos
  const activos: Activo[] = []
  {
    const rows = filas(ws('Activos'))
    for (let i = 7; i < rows.length; i++) {
      const r = rows[i]
      const d = txt(r?.[1])
      if (!d) continue
      activos.push({
        id: `act-${i}`,
        descripcion: d,
        categoria: txt(r[2]) || undefined,
        geografia: /cuba/i.test(txt(r[3])) ? 'CUBA' : 'USA',
        costo: num(r[5]) || undefined,
        vidaUtil: num(r[6]) || undefined,
        depAcumApertura: num(r[7]) || undefined,
        notas: txt(r[9]) || undefined,
      })
    }
  }

  // --- Paquetes en abandono
  const paquetes: Paquete[] = []
  {
    const rows = filas(ws('Paq. Abandono'))
    for (let i = 7; i < rows.length; i++) {
      const r = rows[i]
      const kgt = txt(r?.[1])
      if (!kgt) continue
      paquetes.push({
        id: `paq-${i}`,
        kgt,
        cliente: txt(r[2]) || undefined,
        descripcion: txt(r[3]) || undefined,
        llegada: fecha(r[4]),
        valorDeclarado: num(r[5]) || undefined,
        fechaAbandono: fecha(r[6]),
        precioVenta: num(r[7]) || undefined,
        fechaVenta: fecha(r[8]),
        estado: /vend/i.test(txt(r[9])) ? 'Vendido' : 'Disponible',
        comprador: txt(r[10]) || undefined,
      })
    }
  }

  // --- Devengos
  const devengos: Devengo[] = []
  {
    const rows = filas(ws('Devengo'))
    const h = encabezados(rows, ['fecha de pago', 'categoría', 'importe usd'])
    if (h) {
      const c = h.col
      for (let i = h.fila + 1; i < rows.length; i++) {
        const r = rows[i]
        const f = fecha(r[c.get('fecha de pago')!])
        const imp = num(r[c.get('importe usd')!])
        const mes = MES_NUM[norm(r[c.get('mes al que corresponde') ?? -1])]
        const an = num(r[c.get('año al que corresponde') ?? -1]) || anio
        if (!f || !imp || !mes) continue
        devengos.push({
          id: `dev-${i}`,
          fechaPago: f,
          origen: txt(r[c.get('origen') ?? -1]) || undefined,
          concepto: txt(r[c.get('concepto / referencia') ?? -1]),
          categoria: categoria(r[c.get('categoría')!]),
          importe: imp,
          mesCorresponde: `${an}-${mes}`,
          notas: txt(r[c.get('notas') ?? -1]) || undefined,
        })
      }
    }
  }

  // CxC de apertura: lo pendiente de las facturas emitidas antes del inicio.
  settings.cxcSistemaApertura =
    Math.round(facturas.filter((f) => f.afectaER && f.emision < inicio).reduce((a, f) => a + Math.max(0, f.monto - f.cobrado), 0) * 100) / 100

  // Cuentas: las de catálogo más cualquiera encontrada en los datos.
  const cuentas = DEFAULT_CUENTAS.map((c) => ({ ...c }))
  for (const nombre of new Set(movimientos.map((m) => m.cuenta)))
    if (!cuentas.some((c) => c.nombre === nombre)) cuentas.push({ id: `cta-x${cuentas.length}`, nombre, tipo: 'banco', geografia: 'USA', orden: 900 + cuentas.length, activa: true })

  notas.push(
    'Square_Mov no se importó: Square liquida en Truist y esos depósitos ya están en Truist como «Cobro cliente». Importarlo contaría dos veces los cobros (el Excel tampoco lo sumaba).',
  )
  if (nuevasCategorias.size) notas.push(`Categorías encontradas que no estaban en el catálogo (añadidas como «por clasificar»): ${[...nuevasCategorias].join(', ')}.`)
  notas.push(
    `CxC de apertura de clientes estimada en ${settings.cxcSistemaApertura.toFixed(2)} USD (pendiente de facturas emitidas antes del ${inicio}). Ajústala en «Apertura» si tienes el dato real.`,
  )

  const dataset: Dataset = {
    settings,
    categorias,
    cuentas,
    tasas,
    movimientos,
    facturas,
    facturasCompra,
    pagosProveedor,
    cxcManual,
    activos,
    paquetes,
    devengos,
    asientos,
  }
  const resumen = (Object.keys(dataset) as (keyof Dataset)[])
    .filter((k) => k !== 'settings')
    .map((k) => ({ coleccion: k, filas: (dataset[k] as unknown[]).length }))
  return { dataset, resumen, notas, referencia }
}
