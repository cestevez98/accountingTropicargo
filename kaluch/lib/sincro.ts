import type { FilaInventario } from './inventario'
import type { Moneda, Movimiento, Producto, Settings, Tienda } from './types'

/**
 * Sincronización Kaluch Accounting ↔ AxisPOS en modo ensayo: compara y prepara, nunca envía.
 * Funciones puras (sin red) para poder probarlas.
 *
 * Dueño de cada dato: el catálogo, la tasa y las compras del Almacén Central se crean aquí y van al TPV;
 * ventas, compras de los locales, traslados del día y cajas de los mercados se crean en el TPV y vienen aquí.
 */

/** Mercancía tal como la devuelve ImportExportItems. */
export interface ItemTPV {
  Code: string
  Name: string
  Category?: string
  Unit?: string
  Currency?: string
  Price?: number
  Cost?: number
  Barcode?: string
  [k: string]: unknown
}

export const GRUPOS_PRECIO = ['1', '2', '3', '4', '5', '6', '7', '8'] as const

const grupoLimpio = (c?: string) => (c ?? '').replace(/^\|+/, '').trim() || undefined
const r2 = (n: number) => Math.round(n * 100) / 100

/** Precios de un artículo del TPV: base y los de cada grupo que tengan valor. */
export function preciosDeItem(it: ItemTPV) {
  const precios: Record<string, number> = {}
  for (const g of GRUPOS_PRECIO) {
    const v = Number(it[`Price${g}`])
    if (v > 0) precios[g] = v
  }
  return { base: Number(it.Price) || undefined, precios }
}

/** Códigos de barras de un artículo del TPV (Barcode, Barcode2, Barcode3). */
export function barrasDeItem(it: ItemTPV) {
  const b = [it.Barcode, it.Barcode2, it.Barcode3].map((x) => String(x ?? '').trim()).filter(Boolean)
  return b.length ? [...new Set(b)] : undefined
}

/** Producto del catálogo maestro a partir de un artículo del TPV (para la carga inicial). */
export function productoDesdeItem(it: ItemTPV, previo?: Producto): Producto {
  const { base, precios } = preciosDeItem(it)
  return {
    ...previo,
    codigo: String(it.Code),
    nombre: it.Name,
    grupo: grupoLimpio(it.Category),
    unidad: it.Unit || undefined,
    precioCUP: base,
    precios: Object.keys(precios).length ? precios : undefined,
    costoCUP: Number(it.Cost) || undefined,
    barras: barrasDeItem(it),
    modificado: undefined,
  }
}

/** Grupo de precios que usa cada tienda (el de su piso de venta o, si no, el de cualquiera de sus áreas). */
export function gruposPorTienda(tiendas: Tienda[], ubic: NonNullable<Settings['axispos']>['ubicaciones'] = []) {
  const porCode = new Map(ubic.map((u) => [u.code, u]))
  const out = new Map<string, string>()
  for (const t of tiendas) {
    const areas = (t.codigoTPV ?? '').split(',').map((c) => porCode.get(c.trim())).filter((u) => u?.precioGrupo)
    const u = areas.find((a) => a!.tipo === 7) ?? areas[0]
    if (u?.precioGrupo) out.set(t.id, String(u.precioGrupo))
  }
  return out
}

/** Precio de venta en CUP de un producto en una tienda: el de su grupo o, si no tiene, el base. */
export function precioEnTienda(p: Producto, grupo?: string) {
  return (grupo && p.precios?.[grupo]) || p.precioCUP
}

/** Precio de la Tienda Web: costo del Almacén Central (CUP) más el margen de la web. */
export function precioWeb(p: Producto, margenWeb: number | undefined, cupUsd: number | undefined) {
  if (margenWeb == null) return undefined
  const costo = p.costoCUP ?? (p.costoUSD != null && cupUsd ? p.costoUSD * cupUsd : undefined)
  return costo ? r2(costo * (1 + margenWeb)) : undefined
}

export interface CambioCatalogo {
  codigo: string
  nombre: string
  campo: string
  kaluch: string | number | undefined
  tpv: string | number | undefined
}

const tieneCodigo = (p: Producto) => Boolean(p.codigo) && p.codigo !== p.nombre

/**
 * Lo que habría que hacer en el TPV para que tenga el catálogo de Kaluch:
 * altas (productos sin código del TPV o con un código que el TPV no tiene), cambios campo a campo,
 * y lo que solo existe en el TPV (no se toca: se informa).
 */
export function compararCatalogo(productos: Producto[], items: ItemTPV[]) {
  const porCodigo = new Map(items.map((i) => [String(i.Code), i]))
  const usados = new Set<string>()
  const altas: Producto[] = []
  const cambios: CambioCatalogo[] = []
  for (const p of productos) {
    const it = tieneCodigo(p) ? porCodigo.get(p.codigo) : undefined
    if (!it) {
      altas.push(p)
      continue
    }
    usados.add(p.codigo)
    const dif = (campo: string, k: string | number | undefined, t: string | number | undefined) => {
      if (k == null || k === '') return
      if (typeof k === 'number' ? Math.abs(k - (Number(t) || 0)) > 0.005 : k !== t) cambios.push({ codigo: p.codigo, nombre: p.nombre, campo, kaluch: k, tpv: t })
    }
    const { base, precios } = preciosDeItem(it)
    dif('Nombre', p.nombre, it.Name)
    dif('Grupo', p.grupo, grupoLimpio(it.Category))
    dif('Precio base', p.precioCUP, base)
    if (p.barras?.length) dif('Códigos de barras', p.barras.join(', '), (barrasDeItem(it) ?? []).join(', '))
    for (const g of GRUPOS_PRECIO) dif(`Precio grupo ${g}`, p.precios?.[g], precios[g])
  }
  const soloTPV = items.filter((i) => !usados.has(String(i.Code)))
  return { altas, cambios, soloTPV }
}

/** Registro que se mandaría a ImportExportItems (ensayo): conserva lo que ya tenga el TPV y pisa lo que manda Kaluch. */
export function itemParaTPV(p: Producto, actual?: ItemTPV): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(actual ?? { Currency: 'CUP', Unit: p.unidad ?? 'pzs.' }), Code: p.codigo, Name: p.nombre }
  if (p.grupo) out.Category = `|${p.grupo}`
  if (p.precioCUP != null) out.Price = p.precioCUP
  if (p.barras?.length) ['Barcode', 'Barcode2', 'Barcode3'].forEach((k, i) => (out[k] = p.barras![i] ?? ''))
  for (const g of GRUPOS_PRECIO) if (p.precios?.[g] != null) out[`Price${g}`] = p.precios[g]
  return out
}

// ---------------------------------------------------------------- existencias

export interface DisponibleTPV {
  objectCode: string
  ItemsAvailability: { Code: string; Amount: number }[]
}

export interface FilaCuadreExistencia {
  tienda: string
  codigo: string
  producto: string
  kaluch: number
  tpv: number
  diferencia: number
  valorUSD?: number
}

/**
 * Existencias de Kaluch (compras − salidas) contra las de AxisPOS (ExportAvailable), por tienda.
 * Las áreas de una tienda se suman. Los productos se casan por código del TPV.
 */
export function cuadreExistencias(filas: FilaInventario[], disponibles: DisponibleTPV[], productos: Producto[], tiendas: Tienda[]) {
  const tiendaDeArea = new Map<string, string>()
  for (const t of tiendas) for (const c of (t.codigoTPV ?? '').split(',')) if (c.trim()) tiendaDeArea.set(c.trim(), t.id)
  const codigoDe = new Map(productos.filter(tieneCodigo).map((p) => [p.nombre, p.codigo]))
  const nombreDe = new Map(productos.filter(tieneCodigo).map((p) => [p.codigo, p.nombre]))
  const tpv = new Map<string, number>()
  for (const d of disponibles) {
    const t = tiendaDeArea.get(String(d.objectCode))
    if (!t) continue
    for (const a of d.ItemsAvailability ?? []) {
      const k = `${t}|${a.Code}`
      tpv.set(k, (tpv.get(k) ?? 0) + (Number(a.Amount) || 0))
    }
  }
  const kal = new Map<string, { q: number; costo?: number; nombre: string }>()
  for (const f of filas) {
    const cod = codigoDe.get(f.producto) ?? f.producto
    const k = `${f.tienda}|${cod}`
    const prev = kal.get(k)
    kal.set(k, { q: (prev?.q ?? 0) + f.existencia, costo: f.costo ?? prev?.costo, nombre: f.producto })
  }
  const filasOut: FilaCuadreExistencia[] = []
  for (const k of new Set([...tpv.keys(), ...kal.keys()])) {
    const [tienda, codigo] = k.split('|')
    if (!tiendas.some((t) => t.id === tienda && t.codigoTPV)) continue
    const a = kal.get(k)
    const kq = r2(a?.q ?? 0)
    const tq = r2(tpv.get(k) ?? 0)
    const diferencia = r2(kq - tq)
    filasOut.push({ tienda, codigo, producto: a?.nombre ?? nombreDe.get(codigo) ?? codigo, kaluch: kq, tpv: tq, diferencia, valorUSD: a?.costo != null ? r2(diferencia * a.costo) : undefined })
  }
  const resumen = tiendas
    .filter((t) => t.codigoTPV)
    .map((t) => {
      const xs = filasOut.filter((f) => f.tienda === t.id)
      const distintos = xs.filter((f) => Math.abs(f.diferencia) > 0.001)
      return { tienda: t.id, productos: xs.length, coinciden: xs.length - distintos.length, distintos: distintos.length, valorUSD: r2(distintos.reduce((s, f) => s + (f.valorUSD ?? 0), 0)) }
    })
  return { filas: filasOut.sort((a, b) => Math.abs(b.valorUSD ?? b.diferencia) - Math.abs(a.valorUSD ?? a.diferencia)), resumen }
}

// ---------------------------------------------------------------- cajas

export const CONCEPTO_ENTREGA = 'Entrega a caja central'

export const esEntrega = (m: Movimiento) => m.libro === 'caja' && m.categoria === 'TRASPASO' && (m.concepto ?? '').startsWith(CONCEPTO_ENTREGA)

export interface DiaCaja {
  fecha: string
  moneda: Moneda
  cobrado: number
  gastos: number
  otrasEntradas: number
  entregado: number
  saldo: number
}

/**
 * Cuadre diario de la caja de un mercado, por moneda: lo cobrado en efectivo (TPV), los gastos pagados
 * de la caja, lo entregado a la caja central y el saldo que debería quedar en la tienda.
 */
export function cuadreCaja(movimientos: Movimiento[], tienda: string, desde: string, hasta: string) {
  const deCaja = movimientos.filter((m) => m.libro === 'caja' && m.tienda === tienda && m.fecha <= hasta)
  const saldoInicial = new Map<Moneda, number>()
  const dias = new Map<string, DiaCaja>()
  for (const m of deCaja) {
    const signo = m.tipo === 'Entrada' ? 1 : -1
    if (m.fecha < desde) {
      saldoInicial.set(m.moneda, (saldoInicial.get(m.moneda) ?? 0) + signo * m.monto)
      continue
    }
    const k = `${m.fecha}|${m.moneda}`
    const d = dias.get(k) ?? { fecha: m.fecha, moneda: m.moneda, cobrado: 0, gastos: 0, otrasEntradas: 0, entregado: 0, saldo: 0 }
    if (esEntrega(m)) d.entregado += m.monto * (m.tipo === 'Salida' ? 1 : -1)
    else if (m.tipo === 'Entrada' && m.categoria === 'VENTAS') d.cobrado += m.monto
    else if (m.tipo === 'Entrada') d.otrasEntradas += m.monto
    else d.gastos += m.monto
    dias.set(k, d)
  }
  const saldo = new Map(saldoInicial)
  const out = [...dias.values()].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.moneda.localeCompare(b.moneda))
  for (const d of out) {
    const s = (saldo.get(d.moneda) ?? 0) + d.cobrado + d.otrasEntradas - d.gastos - d.entregado
    saldo.set(d.moneda, s)
    Object.assign(d, { cobrado: r2(d.cobrado), gastos: r2(d.gastos), otrasEntradas: r2(d.otrasEntradas), entregado: r2(d.entregado), saldo: r2(s) })
  }
  return { dias: out, saldoInicial: Object.fromEntries([...saldoInicial].map(([k, v]) => [k, r2(v)])), saldoFinal: Object.fromEntries([...saldo].map(([k, v]) => [k, r2(v)])) }
}

/** Las dos patas de una entrega de efectivo de un mercado a la caja central (Casa Matriz). */
export function movimientosEntrega(e: { id: string; fecha: string; tienda: string; nombreTienda: string; matriz: string; moneda: Moneda; monto: number; cajero?: string; nota?: string }): Movimiento[] {
  const comun = { fecha: e.fecha, moneda: e.moneda, monto: e.monto, categoria: 'TRASPASO', comprobante: `ENT-${e.id.slice(0, 8)}`, cajero: e.cajero, observaciones: e.nota, origen: 'manual' as const, libro: 'caja' as const }
  return [
    { ...comun, id: `${e.id}-s`, tienda: e.tienda, tipo: 'Salida', concepto: CONCEPTO_ENTREGA },
    { ...comun, id: `${e.id}-e`, tienda: e.matriz, tipo: 'Entrada', concepto: `${CONCEPTO_ENTREGA} · de ${e.nombreTienda}` },
  ]
}
