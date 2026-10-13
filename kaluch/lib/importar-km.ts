import * as XLSX from 'xlsx'
import { CAT_POR_CLASIFICAR, RUBRO } from './catalogo'
import { finDeMes, sumarMeses } from './fecha'
import { inferirCategoria, resolverCategoria, resolverTienda, validarMovimientos, type Problema } from './validar'
import type { Asiento, CategoriaPago, Distribucion, Compra, Dataset, Deuda, Moneda, Movimiento, Producto, Salida, Tasa } from './types'

/**
 * Importador del libro «Operaciones KM-xx» (Excel de cada tienda).
 *
 * Lee los valores guardados (no las fórmulas) de: Tasas, Efectivo en Caja, Efectivo en Banco,
 * Inventario y, si existen, las tablas Salidas (ventas/mermas/consumo del TPV) y Costos y Gastos
 * (compras). Si el libro no trae esas dos tablas —como el KM-26 actual— reconstruye un resumen
 * mensual de ventas, costo y compras a partir de los totales guardados en el ER y el ES, para que
 * los estados financieros cuadren con el Excel hasta que entren los datos del TPV.
 */

export interface Referencia {
  meses: string[]
  er: Record<string, number[]>
  es: Record<string, number[]>
}

export interface LoteKM {
  movimientos: (Movimiento & { _fila: number; _hoja: string })[]
  tasas: Tasa[]
  productos: Producto[]
  salidas: Salida[]
  compras: Compra[]
  deudas: Deuda[]
  asientos: Asiento[]
  distribuciones?: Distribucion[]
  problemas: (Problema & { hoja: string })[]
  notas: string[]
  referencia?: Referencia
  tienda: string
}

type Celda = string | number | boolean | null | undefined

function fechaISO(v: Celda): string | undefined {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v)
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
    const e = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (e) return `${e[3]}-${e[2].padStart(2, '0')}-${e[1].padStart(2, '0')}`
  }
  return undefined
}

const num = (v: Celda) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/,/g, '')) : NaN)
const txt = (v: Celda) => (v == null ? '' : String(v).trim())

function filas(wb: XLSX.WorkBook, hoja: string): Celda[][] {
  const ws = wb.Sheets[hoja]
  if (!ws) return []
  return XLSX.utils.sheet_to_json<Celda[]>(ws, { header: 1, raw: true, defval: null, blankrows: false })
}

function hojaPorNombre(wb: XLSX.WorkBook, ...nombres: string[]) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  return wb.SheetNames.find((s) => nombres.some((n) => norm(s) === norm(n)))
}

/** Tabla con encabezado en la primera fila no vacía → objetos por nombre de columna. */
function tabla(wb: XLSX.WorkBook, hoja: string | undefined) {
  if (!hoja) return { cols: [] as string[], datos: [] as { fila: number; get: (c: string) => Celda }[] }
  const f = filas(wb, hoja)
  const h = f.findIndex((r) => r.filter((c) => c != null && c !== '').length >= 3)
  if (h < 0) return { cols: [], datos: [] }
  const cols = f[h].map((c) => txt(c))
  const pos = new Map(cols.map((c, i) => [c.toLowerCase(), i]))
  const datos = f.slice(h + 1).map((r, i) => ({ fila: h + i + 2, get: (c: string) => r[pos.get(c.toLowerCase()) ?? -1] }))
  return { cols, datos }
}

const MONEDAS = new Set(['CUP', 'USD', 'EUR', 'MLC'])

export function leerLibroKM(buf: ArrayBuffer | Buffer, ds: Dataset, tiendaDefecto = 'km26'): LoteKM {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellFormula: false })
  const lote: LoteKM = { movimientos: [], tasas: [], productos: [], salidas: [], compras: [], deudas: [], asientos: [], problemas: [], notas: [], tienda: tiendaDefecto }
  const problema = (hoja: string, fila: number, nivel: Problema['nivel'], mensaje: string) => lote.problemas.push({ hoja, fila, nivel, mensaje })
  const nombreTienda = ds.tiendas.find((t) => t.id === tiendaDefecto)?.nombre ?? tiendaDefecto

  // --- Tasas
  const ht = hojaPorNombre(wb, 'Tasas')
  for (const r of tabla(wb, ht).datos) {
    const fecha = fechaISO(r.get('Tasas') as Celda)
    const cupUsd = num(r.get('Toque CUP/USD2')) || num(r.get('Toque CUP/USD'))
    if (!fecha || !(cupUsd > 0)) continue
    const cupEur = num(r.get('Toque CUP/EUR'))
    const cupMlc = num(r.get('Toque CUP/MLC'))
    const kmc = num(r.get('KM CUP/USD compra'))
    const kmv = num(r.get('KM CUP/USD venta'))
    lote.tasas.push({
      fecha,
      cupUsd,
      ...(cupEur > 0 ? { cupEur } : {}),
      ...(cupMlc > 0 ? { cupMlc } : {}),
      ...(kmc > 0 && Math.abs(cupUsd - ds.settings.margenTasa - kmc) > 0.001 ? { kmCompra: kmc } : {}),
      ...(kmv > 0 && Math.abs(cupUsd + ds.settings.margenTasa - kmv) > 0.001 ? { kmVenta: kmv } : {}),
      fuente: 'Excel KM',
    })
  }

  // Las validaciones usan las tasas del archivo además de las ya guardadas.
  const tasasJuntas = new Map(ds.tasas.map((t) => [t.fecha, t]))
  for (const t of lote.tasas) tasasJuntas.set(t.fecha, t)
  const dsVal = { ...ds, tasas: [...tasasJuntas.values()] }

  // --- Efectivo en Caja / Banco
  const leerEfectivo = (hoja: string | undefined, libro: 'caja' | 'banco') => {
    if (!hoja) return
    for (const r of tabla(wb, hoja).datos) {
      const fecha = fechaISO(r.get('Fecha'))
      let monto = num(r.get('Monto'))
      if (!fecha || !Number.isFinite(monto) || monto === 0) continue
      const moneda = txt(r.get('Moneda')).toUpperCase() as Moneda
      if (!MONEDAS.has(moneda)) {
        problema(hoja, r.fila, 'error', `Moneda «${txt(r.get('Moneda'))}» no reconocida.`)
        continue
      }
      const mercado = txt(r.get('Mercado'))
      const tienda = resolverTienda(mercado, ds.tiendas, tiendaDefecto)
      if (!tienda) {
        problema(hoja, r.fila, 'error', `Mercado «${mercado}» no está en el catálogo de tiendas.`)
        continue
      }
      let tipo: Movimiento['tipo'] = txt(r.get('Tipo')).toLowerCase().startsWith('e') ? 'Entrada' : 'Salida'
      const concepto = txt(r.get('Concepto'))
      const observaciones = txt(r.get('Observaciones'))
      let categoria = txt(r.get('Categoría'))
      if (monto < 0) {
        // Un importe negativo invierte el sentido. En el banco, una «venta» negativa es un cargo del banco.
        monto = -monto
        tipo = tipo === 'Entrada' ? 'Salida' : 'Entrada'
        if (libro === 'banco' && categoria.toUpperCase() === 'VENTAS') {
          categoria = 'GASTOS BANCARIOS'
          problema(hoja, r.fila, 'aviso', 'Venta negativa en el banco: se registra como «Gastos bancarios» (como hace el ER del Excel).')
        }
      }
      if (!categoria) {
        const inf = inferirCategoria(concepto, observaciones)
        categoria = inf ?? CAT_POR_CLASIFICAR
        if (inf) problema(hoja, r.fila, 'aviso', `Sin categoría: se clasifica como ${inf} por el concepto «${concepto}».`)
      } else {
        const res = resolverCategoria(categoria, ds.categorias)
        if (res.categoria) categoria = res.categoria
      }
      let cuenta = libro === 'banco' ? txt(r.get('Cuenta/Banco/Titular')) : undefined
      if (libro === 'banco' && !cuenta) {
        cuenta = 'SIN CUENTA'
        problema(hoja, r.fila, 'aviso', 'Movimiento de banco sin cuenta: queda en «SIN CUENTA».')
      }
      lote.movimientos.push({
        id: '',
        _fila: r.fila,
        _hoja: hoja,
        libro,
        fecha,
        tienda,
        ...(cuenta ? { cuenta: cuenta.toUpperCase().replace(/\s+/g, ' '), fiscal: /fiscal/i.test(cuenta) } : {}),
        ...(txt(r.get('Cajero')) ? { cajero: txt(r.get('Cajero')) } : {}),
        ...(txt(r.get('Comprobante')) ? { comprobante: txt(r.get('Comprobante')) } : {}),
        categoria,
        concepto: concepto || undefined,
        observaciones: observaciones || undefined,
        tipo,
        moneda,
        monto: Math.round(monto * 100) / 100,
        origen: 'importado',
      })
    }
  }
  leerEfectivo(hojaPorNombre(wb, 'Efectivo en Caja', 'Efectivo_en_Caja', 'Caja'), 'caja')
  leerEfectivo(hojaPorNombre(wb, 'Efectivo en Banco', 'Efectivo_en_Banco', 'Banco'), 'banco')
  for (const p of validarMovimientos(lote.movimientos, dsVal)) {
    const m = lote.movimientos.find((x) => x._fila === p.fila && (p.nivel === 'aviso' || true))
    lote.problemas.push({ ...p, hoja: m?._hoja ?? '' })
  }

  // --- Inventario (lista de productos con la existencia que calculaba el Excel)
  const hi = hojaPorNombre(wb, 'Inventario')
  for (const r of tabla(wb, hi).datos) {
    const nombre = txt(r.get('Mercancía'))
    if (!nombre) continue
    const q = num(r.get('Cantidades que quedan en general'))
    lote.productos.push({ codigo: nombre, nombre, ...(Number.isFinite(q) ? { existenciaRef: q } : {}) })
  }

  // --- Ventas (tabla «Salidas»: ventas, mermas y consumo interno del TPV) y Compras («Costos y Gastos»)
  const hs = hojaPorNombre(wb, 'Ventas', 'Salidas')
  const hc = hojaPorNombre(wb, 'Compras', 'Costos y Gastos', 'Costos_y_Gastos')
  if (hs) {
    for (const r of tabla(wb, hs).datos) {
      const fecha = fechaISO(r.get('Fecha'))
      const producto = txt(r.get('Mercancía'))
      if (!fecha || !producto) continue
      const op = txt(r.get('Operación')).toUpperCase()
      const tipo: Salida['tipo'] = op.startsWith('MERMA') ? 'merma' : op.startsWith('CONSUMO') ? 'consumo' : op.startsWith('DEVOL') ? 'devolucion' : 'venta'
      const tienda = resolverTienda(txt(r.get('Mercado')), ds.tiendas, tiendaDefecto) ?? tiendaDefecto
      const importe = num(r.get('Importe'))
      const venta = num(r.get('Ingreso Tasa tienda (USD)'))
      const financiero = num(r.get('Ingreso Financiero (Tasa tienda - Tasa Toque)'))
      const costo = num(r.get('Costo (USD)'))
      const vende = tipo === 'venta' || tipo === 'devolucion'
      lote.salidas.push({
        id: '',
        tipo,
        fecha,
        tienda,
        operacion: txt(r.get('No. de Operación')) || txt(r.get('No. Operación')) || undefined,
        producto,
        cantidad: num(r.get('Cantidad')) || undefined,
        ...(Number.isFinite(importe) ? { importe, moneda: 'CUP' as Moneda } : {}),
        ...(vende && Number.isFinite(venta) ? { ventaUSD: venta, ingresoTasaUSD: Number.isFinite(financiero) ? financiero : 0 } : {}),
        ...(Number.isFinite(costo) ? { costoUSD: costo } : {}),
        origen: 'importado',
      })
    }
  }
  if (hc) {
    for (const r of tabla(wb, hc).datos) {
      const fecha = fechaISO(r.get('Fecha'))
      const usd = num(r.get('Importe USD'))
      if (!fecha || !Number.isFinite(usd) || usd === 0) continue
      let moneda = txt(r.get('Moneda')).toUpperCase() as Moneda
      let importe = num(r.get('Importe'))
      if (!MONEDAS.has(moneda) || !Number.isFinite(importe)) {
        moneda = 'USD'
        importe = usd
      }
      const cat = txt(r.get('Categoría'))
      const pago = pagoDe(cat)
      if (cat && !pago) problema(hc, r.fila, 'aviso', `Categoría de pago «${cat}» no reconocida: se registra como al contado.`)
      lote.compras.push({
        id: '',
        fecha,
        tienda: resolverTienda(txt(r.get('Mercado')), ds.tiendas, tiendaDefecto) ?? tiendaDefecto,
        producto: txt(r.get('Mercancía')) || undefined,
        proveedor: txt(r.get('Nombre de socio')) || txt(r.get('Proveedor')) || undefined,
        factura: txt(r.get('Factura')) || undefined,
        cantidad: num(r.get('Cantidad')) || undefined,
        moneda,
        importe: Math.round(importe * 100) / 100,
        importeUSD: usd,
        ...(moneda !== 'USD' && importe ? { tasa: Math.round((importe / usd) * 1e4) / 1e4 } : {}),
        pago: pago ?? 'contado',
        fiscal: false,
        origen: 'importado',
      })
    }
  }

  // --- Deuda con la Casa Matriz
  const hd = hojaPorNombre(wb, 'Deuda CM', 'Deuda_CM')
  for (const r of tabla(wb, hd).datos) {
    const fecha = fechaISO(r.get('Fecha'))
    if (!fecha || !hd) continue
    const pagarUSD = num(r.get('PAGAR en USD'))
    const cobrarUSD = num(r.get('COBRAR en USD'))
    const clase = pagarUSD > 0 ? 'pagar' : cobrarUSD > 0 ? 'cobrar' : undefined
    if (!clase) continue
    const usd = clase === 'pagar' ? pagarUSD : cobrarUSD
    const cat = txt(r.get('Categoría')).toUpperCase()
    const concepto = txt(r.get('Concepto'))
    const categoria = cat === 'IMPUESTO' && /N[OÓ]MINA/i.test(concepto) ? 'IMPUESTO NÓMINA' : cat === 'NÓMINA' || cat === 'NOMINA' ? 'NÓMINA' : resolverCategoria(cat, ds.categorias).categoria ?? CAT_POR_CLASIFICAR
    if (categoria === CAT_POR_CLASIFICAR) problema(hd, r.fila, 'aviso', `Deuda con categoría «${cat}» sin equivalente: queda por clasificar.`)
    lote.deudas.push({
      id: '',
      clase,
      fecha,
      tienda: resolverTienda(txt(r.get('Mercado')), ds.tiendas, tiendaDefecto) ?? tiendaDefecto,
      contraparte: 'Casa Matriz',
      categoria,
      concepto: concepto || undefined,
      moneda: 'USD',
      monto: Math.round(usd * 100) / 100,
      origen: 'importado',
    })
  }

  // --- Referencia: valores guardados del ER y del ES
  const ref = leerReferencia(wb)
  lote.referencia = ref

  if (ref && !lote.salidas.length && !lote.compras.length) {
    lote.notas.push(
      'El libro no trae las tablas «Salidas» ni «Costos y Gastos»: las ventas, el costo, las mermas, el consumo interno y las compras se cargan como un resumen mensual reconstruido de los totales del ER y del ES. Se sustituirán por el detalle cuando entren los datos del TPV AxisPOS.',
    )
    const er = (k: string, i: number) => ref.er[k]?.[i] ?? 0
    const es = (k: string, i: number) => ref.es[k]?.[i] ?? 0
    let invAnterior = 0
    ref.meses.forEach((mes, i) => {
      const fin = finDeMes(mes)
      const venta = er('Venta', i)
      if (!venta && !es('Inventario', i)) return
      const costo = -er('Costo de Ventas', i)
      const consumo = -er('Consumo interno', i)
      const merma = -er('Merma', i)
      const nota = `Resumen ${mes} (Excel)`
      if (venta) lote.salidas.push({ id: '', tipo: 'venta', fecha: fin, tienda: tiendaDefecto, ventaUSD: venta, ingresoTasaUSD: er('Ingreso por tasa de cambio', i), costoUSD: costo, origen: 'resumen', nota })
      if (consumo) lote.salidas.push({ id: '', tipo: 'consumo', fecha: fin, tienda: tiendaDefecto, costoUSD: consumo, origen: 'resumen', nota })
      if (merma) lote.salidas.push({ id: '', tipo: 'merma', fecha: fin, tienda: tiendaDefecto, costoUSD: merma, origen: 'resumen', nota })
      // Compras del mes = inventario final − inicial + todo lo que salió del inventario.
      let compras = es('Inventario', i) - invAnterior + costo + consumo + merma
      if (i === 0 && ref.capitalInicial) {
        lote.asientos.push({
          id: '',
          fecha: ref.fechaCapital ?? `${mes}-01`,
          tienda: tiendaDefecto,
          concepto: `Inventario inicial aportado como capital (${nombreTienda})`,
          lineas: [
            { cuenta: 'inventario', debe: ref.capitalInicial, haber: 0 },
            { cuenta: 'capital', debe: 0, haber: ref.capitalInicial },
          ],
          origen: 'resumen',
        })
        compras -= ref.capitalInicial
      }
      if (Math.abs(compras) > 0.005)
        lote.compras.push({ id: '', fecha: fin, tienda: tiendaDefecto, moneda: 'USD', importe: compras, importeUSD: compras, pago: 'credito', fiscal: false, origen: 'resumen', nota: `Compras de ${mes} reconstruidas del ES (Excel)` })
      invAnterior = es('Inventario', i)
      const nomina = -er('Nómina', i)
      if (nomina) lote.deudas.push({ id: '', clase: 'pagar', fecha: fin, tienda: tiendaDefecto, contraparte: 'Casa Matriz', categoria: 'IMPUESTO NÓMINA', concepto: 'Impuesto sobre la nómina (Deuda CM, Excel)', moneda: 'USD', monto: nomina, origen: 'resumen' })
    })
  } else if (ref?.capitalInicial) marcarAporteInicial(lote, ref.capitalInicial)
  if (ref) {
    lote.distribuciones = distribucionesDelER(ref)
    // Ajustes escritos a mano en la fila «Diferencia» del ER.
    ref.meses.forEach((mes, i) => {
      const fin = finDeMes(mes)
      const er = (k: string) => ref.er[k]?.[i] ?? 0
      const dif = er('Diferencia')
      if (dif)
        lote.asientos.push({
          id: '',
          fecha: fin,
          tienda: tiendaDefecto,
          concepto: `Diferencia escrita a mano en el ER del Excel (${mes}) — revisar contrapartida`,
          lineas: dif < 0 ? [{ cuenta: `res:gasto_admin:${RUBRO.ajuste}`, debe: -dif, haber: 0 }, { cuenta: 'por_clasificar', debe: 0, haber: -dif }] : [{ cuenta: 'por_clasificar', debe: dif, haber: 0 }, { cuenta: `res:gasto_admin:${RUBRO.ajuste}`, debe: 0, haber: dif }],
          origen: 'resumen',
        })
    })
  }
  return lote
}

/**
 * El «Saldo inicial» de la hoja Capital es la suma de las compras hasta la apertura de la tienda:
 * esa mercancía se aportó como capital. Se busca la fecha de corte cuyo acumulado coincide.
 */
function marcarAporteInicial(lote: LoteKM, capital: number) {
  const fechas = [...new Set(lote.compras.map((c) => c.fecha))].sort()
  let acum = 0
  for (const f of fechas) {
    acum += lote.compras.filter((c) => c.fecha === f).reduce((s, c) => s + (c.importeUSD ?? 0), 0)
    if (Math.abs(acum - capital) < 0.05) {
      for (const c of lote.compras) if (c.fecha <= f) c.aporte = true
      lote.notas.push(`Las compras hasta el ${f} (${capital.toFixed(2)} USD) son el inventario inicial aportado como capital, como en la hoja Capital del Excel.`)
      return
    }
  }
  lote.notas.push(`No se encontró la fecha de corte del capital inicial (${capital.toFixed(2)} USD): todas las compras quedan como deuda con proveedores.`)
}

/** % de reinversión e inversionista que usó el Excel cada mes (bloque final del ER). */
function distribucionesDelER(ref: Referencia): Distribucion[] {
  const out: Distribucion[] = []
  ref.meses.forEach((mes, i) => {
    const base = ref.er['Beneficio neto después de bonos']?.[i] ?? 0
    const reinv = ref.er['Reinversión']?.[i] ?? 0
    const div = ref.er['Dividendos']?.[i] ?? 0
    const inv = ref.er['Inversionista']?.[i] ?? 0
    if (!(base > 0)) return
    out.push({ mes, pctReinversion: Math.round((reinv / base) * 1e4) / 1e4, pctInversionista: div > 0 ? Math.round((inv / div) * 1e4) / 1e4 : 0 })
  })
  return out
}

function pagoDe(cat: string): CategoriaPago | undefined {
  const c = cat
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
  if (!c) return undefined
  if (c.includes('EXTERIOR')) return 'exterior'
  if (c.includes('CREDITO')) return 'credito'
  if (c.includes('CONSIG')) return 'consignacion'
  if (c.includes('MERCADO')) return 'mercados'
  if (c.includes('TRANSFER')) return 'transferencia'
  if (c.includes('CONTADO') || c.includes('CLASICA')) return 'contado'
  return undefined
}

/** Lee los valores guardados de las hojas ER, ES y Capital (columnas = meses). */
function leerReferencia(wb: XLSX.WorkBook): (Referencia & { capitalInicial?: number; fechaCapital?: string }) | undefined {
  const leer = (hoja: string | undefined, colLabel: number[]) => {
    if (!hoja) return undefined
    const f = filas(wb, hoja)
    // La fila de meses es la que tiene varios números 1–12 seguidos, y la de años está debajo.
    const iMes = f.findIndex((r) => r.filter((c) => typeof c === 'number' && c >= 1 && c <= 12).length >= 3)
    if (iMes < 0) return undefined
    const cols: { c: number; mes: string }[] = []
    f[iMes].forEach((c, j) => {
      const anio = f[iMes + 1]?.[j]
      if (typeof c === 'number' && c >= 1 && c <= 12 && typeof anio === 'number') cols.push({ c: j, mes: `${anio}-${String(c).padStart(2, '0')}` })
    })
    const out: Record<string, number[]> = {}
    for (const r of f.slice(iMes + 2)) {
      const label = colLabel.map((j) => txt(r[j])).find(Boolean)
      if (!label || out[label]) continue
      out[label] = cols.map(({ c }) => (typeof r[c] === 'number' ? (r[c] as number) : 0))
    }
    return { meses: cols.map((c) => c.mes), out }
  }
  const er = leer(hojaPorNombre(wb, 'ER'), [0])
  const es = leer(hojaPorNombre(wb, 'ES'), [2, 1])
  if (!er) return undefined
  // El ES pone «Efectivo en Banco»/«Inventario» en la columna B (total) y el detalle en la C.
  const esTot: Record<string, number[]> = {}
  if (es) {
    const f = filas(wb, hojaPorNombre(wb, 'ES')!)
    for (const r of f) {
      const b = txt(r[1])
      if (b && !esTot[b]) {
        const iMes = es.meses
        esTot[b] = iMes.map((_, k) => (typeof r[3 + k] === 'number' ? (r[3 + k] as number) : 0))
      }
    }
  }
  const meses = er.meses.filter((m, i) => Object.values(er.out).some((v) => Math.abs(v[i]) > 0.005))
  const recorta = (o: Record<string, number[]>, todos: string[]) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, meses.map((m) => v[todos.indexOf(m)] ?? 0)]))
  const capitalHoja = hojaPorNombre(wb, 'Capital')
  let capitalInicial: number | undefined
  if (capitalHoja) {
    const f = filas(wb, capitalHoja)
    const r = f.find((x) => txt(x[0]).toLowerCase() === 'saldo inicial')
    if (r && typeof r[1] === 'number') capitalInicial = r[1]
  }
  return {
    meses,
    er: recorta(er.out, er.meses),
    es: es ? recorta(esTot, es.meses) : {},
    capitalInicial,
    // El saldo inicial del Excel suma las compras hasta el 13-jun-2026 (fecha de apertura de la tienda).
    fechaCapital: meses[0] ? `${meses[0]}-13` : undefined,
  }
}

export const mesAnterior = (m: string) => sumarMeses(m, -1)
