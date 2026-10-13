import type { Movimiento, Tasa } from './types'

export interface TablaTasas {
  fechas: string[]
  tasas: Tasa[]
}

export function prepararTasas(tasas: Tasa[]): TablaTasas {
  const ordenadas = [...tasas].filter((t) => t.fecha).sort((a, b) => a.fecha.localeCompare(b.fecha))
  return { fechas: ordenadas.map((t) => t.fecha), tasas: ordenadas }
}

/** Tasa vigente: la última con fecha ≤ a la indicada (o la primera si la fecha es anterior a todas). */
export function tasaVigente(tabla: TablaTasas, fecha: string): Tasa | undefined {
  const { fechas, tasas } = tabla
  if (!tasas.length) return undefined
  let lo = 0
  let hi = fechas.length - 1
  let idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (fechas[mid] <= fecha) {
      idx = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return tasas[idx < 0 ? 0 : idx]
}

/** Importe del movimiento en USD (entrada − salida convertida). NaN si no hay tasa para convertir. */
export function movUSD(m: Pick<Movimiento, 'moneda' | 'entrada' | 'salida' | 'fecha' | 'tasa'>, tabla: TablaTasas): number {
  const neto = (Number(m.entrada) || 0) - (Number(m.salida) || 0)
  if (m.moneda === 'USD' || !m.moneda) return neto
  const t = tasaVigente(tabla, m.fecha)
  if (m.moneda === 'CUP') {
    const r = m.tasa || t?.cupPorUsd
    return r ? neto / r : NaN
  }
  if (m.moneda === 'EUR') {
    const r = m.tasa || t?.usdPorEur
    return r ? neto * r : NaN
  }
  return NaN
}
