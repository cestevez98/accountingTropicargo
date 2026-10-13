import type { Dataset } from './types'

/** Costo promedio ponderado (USD por unidad) de cada producto, a partir de las compras con cantidad. */
export function costosPromedio(ds: Pick<Dataset, 'compras' | 'productos'>): Map<string, number> {
  const acum = new Map<string, { q: number; usd: number }>()
  for (const c of ds.compras) {
    if (!c.producto || !c.cantidad || c.importeUSD == null) continue
    const a = acum.get(c.producto) ?? { q: 0, usd: 0 }
    a.q += c.cantidad
    a.usd += c.importeUSD
    acum.set(c.producto, a)
  }
  const out = new Map<string, number>()
  for (const p of ds.productos) if (p.costoUSD != null) out.set(p.nombre, p.costoUSD)
  for (const [k, a] of acum) if (a.q > 0) out.set(k, a.usd / a.q)
  return out
}

export interface FilaInventario {
  producto: string
  grupo?: string
  tienda: string
  entradas: number
  ventas: number
  ajustes: number
  existencia: number
  costo?: number
  valorUSD?: number
  existenciaRef?: number
}

/**
 * Inventario derivado (compras − salidas), por producto y tienda. No se importa: se calcula.
 * Las devoluciones de venta suman; mermas y consumo interno van en «ajustes».
 */
export function inventarioDerivado(ds: Pick<Dataset, 'compras' | 'salidas' | 'productos'>, tienda?: string): FilaInventario[] {
  const costos = costosPromedio(ds)
  const filas = new Map<string, FilaInventario>()
  const fila = (producto: string, t: string) => {
    const k = `${producto}|${t}`
    let f = filas.get(k)
    if (!f) {
      f = { producto, tienda: t, entradas: 0, ventas: 0, ajustes: 0, existencia: 0 }
      filas.set(k, f)
    }
    return f
  }
  for (const c of ds.compras) {
    if (!c.producto || !c.cantidad || (tienda && c.tienda !== tienda)) continue
    fila(c.producto, c.tienda).entradas += c.cantidad
  }
  for (const s of ds.salidas) {
    if (!s.producto || !s.cantidad || (tienda && s.tienda !== tienda)) continue
    const f = fila(s.producto, s.tienda)
    if (s.tipo === 'venta') f.ventas += s.cantidad
    else if (s.tipo === 'devolucion') f.ventas -= s.cantidad
    else f.ajustes -= s.cantidad
  }
  const prods = new Map(ds.productos.map((p) => [p.nombre, p]))
  for (const p of ds.productos) {
    if (p.existenciaRef == null) continue
    const t = tienda ?? 'km26'
    if (![...filas.values()].some((f) => f.producto === p.nombre)) fila(p.nombre, t)
  }
  const out = [...filas.values()].map((f) => {
    f.existencia = f.entradas - f.ventas + f.ajustes
    const p = prods.get(f.producto)
    f.grupo = p?.grupo
    f.existenciaRef = p?.existenciaRef
    f.costo = costos.get(f.producto)
    f.valorUSD = f.costo != null ? f.costo * f.existencia : undefined
    return f
  })
  return out.sort((a, b) => a.producto.localeCompare(b.producto) || a.tienda.localeCompare(b.tienda))
}
