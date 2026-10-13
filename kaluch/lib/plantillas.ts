import * as XLSX from 'xlsx'
import { CAT_POR_CLASIFICAR } from './catalogo'
import { leerLibroKM, type LoteKM } from './importar-km'
import { resolverCategoria, resolverTienda, saltosDeConsecutivo, validarMovimientos } from './validar'
import type { CategoriaPago, Dataset, Moneda, Movimiento, Salida } from './types'

export type TipoImport = 'km' | 'ventas' | 'compras' | 'caja' | 'banco' | 'tasas'

export const PLANTILLAS: Record<Exclude<TipoImport, 'km'>, { titulo: string; descripcion: string; columnas: string[]; ejemplo: (string | number)[] }> = {
  ventas: {
    titulo: 'Ventas',
    descripcion: 'Ventas, mermas y consumo interno del TPV (una línea por producto).',
    columnas: ['Fecha', 'Mercado', 'No. de Operación', 'Operación', 'Mercancía', 'Cantidad', 'Precio de Venta', 'Importe', 'Moneda', 'Costo (USD)'],
    ejemplo: ['2026-10-01', 'KM 26', 1, 'VENTA', 'OREO 68G', 2, 1100, 2200, 'CUP', 2.54],
  },
  compras: {
    titulo: 'Compras',
    descripcion: 'Facturas de compra por producto. Categoría: AL CONTADO, A CRÉDITO, PAGO EN EXTERIOR, CONSIGNACIÓN, MOV MERCADOS.',
    columnas: ['Fecha', 'Mercado', 'Mercancía', 'Nombre de socio', 'Factura', 'Cantidad', 'Moneda', 'Importe', 'Importe USD', 'Categoría', 'Fiscal'],
    ejemplo: ['2026-10-01', 'Almacén Central', 'OREO 68G', 'WALMART', 'INV-001', 24, 'USD', 30.5, 30.5, 'AL CONTADO', 'No'],
  },
  caja: {
    titulo: 'Efectivo en Caja',
    descripcion: 'Entradas y salidas de la caja de la tienda.',
    columnas: ['Fecha', 'Mercado', 'Cajero', 'Comprobante', 'Categoría', 'Concepto', 'Observaciones', 'Tipo', 'Moneda', 'Monto'],
    ejemplo: ['2026-10-01', 'KM 26', 'LORETA', '', 'SALARIO DEPENDIENTE', 'Salario del turno', '', 'Salida', 'CUP', 5000],
  },
  banco: {
    titulo: 'Efectivo en Banco',
    descripcion: 'Movimientos de las cuentas bancarias (fiscal y no fiscal).',
    columnas: ['Fecha', 'Mercado', 'Categoría', 'Concepto', 'Observaciones', 'Cuenta/Banco/Titular', 'Tipo', 'Moneda', 'Monto'],
    ejemplo: ['2026-10-01', 'KM 26', 'VENTAS', 'Transferencias del día', '', 'FISCAL', 'Entrada', 'CUP', 125000],
  },
  tasas: {
    titulo: 'Tasas de cambio',
    descripcion: 'Una fila por día. CUP por cada unidad de moneda (Toque). KM compra/venta son opcionales (si faltan: Toque ∓ margen).',
    columnas: ['Fecha', 'CUP/USD', 'CUP/EUR', 'CUP/MLC', 'Fiscal', 'KM CUP/USD compra', 'KM CUP/USD venta'],
    ejemplo: ['2026-10-01', 695, 790, 460, 120, '', ''],
  },
}

type Celda = string | number | boolean | null | undefined

function fechaISO(v: Celda): string | undefined {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v)
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  if (typeof v === 'string') {
    const s = v.trim()
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    const e = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (e) return `${e[3]}-${e[2].padStart(2, '0')}-${e[1].padStart(2, '0')}`
  }
  return undefined
}
const num = (v: Celda) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/\s/g, '').replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '')) : NaN)
const txt = (v: Celda) => (v == null ? '' : String(v).trim())
const MONEDAS = new Set(['CUP', 'USD', 'EUR', 'MLC'])

/** Primera hoja con el encabezado de la plantilla (acepta columnas en cualquier orden y con espacios). */
function leerTabla(wb: XLSX.WorkBook, requeridas: string[]) {
  const norm = (s: string) => s.trim().toLowerCase()
  for (const nombre of wb.SheetNames) {
    const f = XLSX.utils.sheet_to_json<Celda[]>(wb.Sheets[nombre], { header: 1, raw: true, defval: null, blankrows: false })
    const h = f.findIndex((r) => requeridas.every((c) => r.some((x) => norm(txt(x)) === norm(c))))
    if (h < 0) continue
    const pos = new Map(f[h].map((c, i) => [norm(txt(c)), i]))
    return { hoja: nombre, datos: f.slice(h + 1).map((r, i) => ({ fila: h + i + 2, get: (c: string) => r[pos.get(norm(c)) ?? -1] })) }
  }
  return undefined
}

const vacio = (tienda: string): LoteKM => ({ movimientos: [], tasas: [], productos: [], salidas: [], compras: [], deudas: [], asientos: [], problemas: [], notas: [], tienda })

export function pagoDeTexto(cat: string): CategoriaPago {
  const c = cat
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
  if (c.includes('EXTERIOR')) return 'exterior'
  if (c.includes('CREDITO')) return 'credito'
  if (c.includes('CONSIG')) return 'consignacion'
  if (c.includes('MERCADO')) return 'mercados'
  if (c.includes('TRANSFER')) return 'transferencia'
  return 'contado'
}

/** Lee cualquier archivo de importación y devuelve un lote validado (todavía sin guardar). */
export function leerArchivo(tipo: TipoImport, buf: Buffer, ds: Dataset, tienda: string): LoteKM {
  if (tipo === 'km') return leerLibroKM(buf, ds, tienda)
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: false })
  const lote = vacio(tienda)
  const pl = PLANTILLAS[tipo]
  const t = leerTabla(wb, pl.columnas.slice(0, 2))
  if (!t) {
    lote.problemas.push({ hoja: '', fila: 0, nivel: 'error', mensaje: `No se encontró el encabezado de la plantilla (${pl.columnas.join(', ')}).` })
    return lote
  }
  const prob = (fila: number, nivel: 'error' | 'aviso', mensaje: string) => lote.problemas.push({ hoja: t.hoja, fila, nivel, mensaje })
  const tiendaDe = (fila: number, v: Celda) => {
    const id = resolverTienda(txt(v), ds.tiendas, tienda)
    if (!id) prob(fila, 'error', `Mercado «${txt(v)}» no está en el catálogo de tiendas.`)
    return id ?? tienda
  }

  if (tipo === 'tasas') {
    for (const r of t.datos) {
      const fecha = fechaISO(r.get('Fecha'))
      const cupUsd = num(r.get('CUP/USD'))
      if (!fecha) continue
      if (!(cupUsd > 0)) {
        prob(r.fila, 'error', 'Falta la tasa CUP/USD.')
        continue
      }
      const o = (c: string) => (num(r.get(c)) > 0 ? num(r.get(c)) : undefined)
      lote.tasas.push({ fecha, cupUsd, cupEur: o('CUP/EUR'), cupMlc: o('CUP/MLC'), fiscal: o('Fiscal'), kmCompra: o('KM CUP/USD compra'), kmVenta: o('KM CUP/USD venta'), fuente: 'Plantilla' })
    }
    return lote
  }

  if (tipo === 'caja' || tipo === 'banco') {
    for (const r of t.datos) {
      const fecha = fechaISO(r.get('Fecha'))
      let monto = num(r.get('Monto'))
      if (!fecha || !Number.isFinite(monto) || !monto) continue
      const moneda = txt(r.get('Moneda')).toUpperCase() as Moneda
      if (!MONEDAS.has(moneda)) {
        prob(r.fila, 'error', `Moneda «${txt(r.get('Moneda'))}» no reconocida.`)
        continue
      }
      let tipoMov: Movimiento['tipo'] = txt(r.get('Tipo')).toLowerCase().startsWith('e') ? 'Entrada' : 'Salida'
      if (monto < 0) {
        monto = -monto
        tipoMov = tipoMov === 'Entrada' ? 'Salida' : 'Entrada'
      }
      let categoria = txt(r.get('Categoría'))
      if (!categoria) categoria = CAT_POR_CLASIFICAR
      else categoria = resolverCategoria(categoria, ds.categorias).categoria ?? categoria
      const cuenta = tipo === 'banco' ? txt(r.get('Cuenta/Banco/Titular')).toUpperCase() || 'SIN CUENTA' : undefined
      lote.movimientos.push({
        id: '',
        _fila: r.fila,
        _hoja: t.hoja,
        libro: tipo,
        fecha,
        tienda: tiendaDe(r.fila, r.get('Mercado')),
        ...(cuenta ? { cuenta, fiscal: /fiscal/i.test(cuenta) } : {}),
        cajero: txt(r.get('Cajero')) || undefined,
        comprobante: txt(r.get('Comprobante')) || undefined,
        categoria,
        concepto: txt(r.get('Concepto')) || undefined,
        observaciones: txt(r.get('Observaciones')) || undefined,
        tipo: tipoMov,
        moneda,
        monto: Math.round(monto * 100) / 100,
        origen: 'importado',
      })
    }
    for (const p of validarMovimientos(lote.movimientos, ds)) lote.problemas.push({ ...p, hoja: t.hoja })
    return lote
  }

  if (tipo === 'ventas') {
    const ops: { tienda: string; operacion?: string; fila: number }[] = []
    const yaImportadas = new Set(ds.salidas.filter((s) => s.operacion).map((s) => `${s.tienda}|${s.fecha}|${s.operacion}|${s.producto}`))
    for (const r of t.datos) {
      const fecha = fechaISO(r.get('Fecha'))
      const producto = txt(r.get('Mercancía'))
      if (!fecha || !producto) continue
      const op = txt(r.get('Operación')).toUpperCase()
      const tipoS: Salida['tipo'] = op.startsWith('MERMA') ? 'merma' : op.startsWith('CONSUMO') ? 'consumo' : op.startsWith('DEVOL') ? 'devolucion' : 'venta'
      const t2 = tiendaDe(r.fila, r.get('Mercado'))
      const operacion = txt(r.get('No. de Operación')) || undefined
      if (operacion && yaImportadas.has(`${t2}|${fecha}|${operacion}|${producto}`)) prob(r.fila, 'error', `Duplicado: operación #${operacion} ya importada.`)
      ops.push({ tienda: t2, operacion, fila: r.fila })
      const moneda = (txt(r.get('Moneda')).toUpperCase() || 'CUP') as Moneda
      const costo = num(r.get('Costo (USD)'))
      lote.salidas.push({
        id: '',
        tipo: tipoS,
        fecha,
        tienda: t2,
        operacion,
        producto,
        cantidad: num(r.get('Cantidad')) || undefined,
        importe: num(r.get('Importe')) || num(r.get('Cantidad')) * num(r.get('Precio de Venta')) || 0,
        moneda: MONEDAS.has(moneda) ? moneda : 'CUP',
        ...(Number.isFinite(costo) ? { costoUSD: costo } : {}),
        origen: 'importado',
        // Se guarda la fila para relacionar los avisos.
        nota: undefined,
      })
      if (!ds.tasas.some((x) => x.fecha === fecha) && moneda !== 'USD') prob(r.fila, 'aviso', `Sin tasa para ${fecha}: se usará la más reciente.`)
    }
    for (const p of saltosDeConsecutivo(ops)) lote.problemas.push({ ...p, hoja: t.hoja })
    return lote
  }

  // compras
  for (const r of t.datos) {
    const fecha = fechaISO(r.get('Fecha'))
    const importe = num(r.get('Importe'))
    if (!fecha || !Number.isFinite(importe) || !importe) continue
    const moneda = (txt(r.get('Moneda')).toUpperCase() || 'USD') as Moneda
    if (!MONEDAS.has(moneda)) {
      prob(r.fila, 'error', `Moneda «${txt(r.get('Moneda'))}» no reconocida.`)
      continue
    }
    const usd = num(r.get('Importe USD'))
    if (moneda !== 'USD' && !Number.isFinite(usd) && !ds.tasas.length) prob(r.fila, 'error', 'Sin tasa de cambio para convertir a USD.')
    lote.compras.push({
      id: '',
      fecha,
      tienda: tiendaDe(r.fila, r.get('Mercado')),
      producto: txt(r.get('Mercancía')) || undefined,
      proveedor: txt(r.get('Nombre de socio')) || undefined,
      factura: txt(r.get('Factura')) || undefined,
      cantidad: num(r.get('Cantidad')) || undefined,
      moneda,
      importe,
      ...(Number.isFinite(usd) ? { importeUSD: usd } : moneda === 'USD' ? { importeUSD: importe } : {}),
      pago: pagoDeTexto(txt(r.get('Categoría'))),
      fiscal: /^s/i.test(txt(r.get('Fiscal'))),
      origen: 'importado',
    })
  }
  return lote
}

/** Libro Excel con la plantilla vacía (encabezado + una fila de ejemplo). */
export function libroPlantilla(tipo: Exclude<TipoImport, 'km'>): Buffer {
  const pl = PLANTILLAS[tipo]
  const ws = XLSX.utils.aoa_to_sheet([pl.columnas, pl.ejemplo])
  ws['!cols'] = pl.columnas.map((c) => ({ wch: Math.max(12, c.length + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, pl.titulo.slice(0, 31))
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
