import type { Moneda, Tasa } from './types'

export interface TablaTasas {
  fechas: string[]
  tasas: Tasa[]
  margen: number
}

export function prepararTasas(tasas: Tasa[], margen: number): TablaTasas {
  // Una tasa en 0 (días futuros sin rellenar en el Excel) no cuenta: se usa la anterior válida.
  const ordenadas = tasas.filter((t) => t.fecha && t.cupUsd > 0).sort((a, b) => a.fecha.localeCompare(b.fecha))
  return { fechas: ordenadas.map((t) => t.fecha), tasas: ordenadas, margen }
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

/** CUP que vale una unidad de la moneda en esa fecha (tasa Toque). NaN si no hay tasa. */
export function cupPor(tabla: TablaTasas, moneda: Moneda, fecha: string): number {
  if (moneda === 'CUP') return 1
  const t = tasaVigente(tabla, fecha)
  if (!t) return NaN
  if (moneda === 'USD') return t.cupUsd
  if (moneda === 'EUR') return t.cupEur || NaN
  if (moneda === 'MLC') return t.cupMlc || NaN
  return NaN
}

/** Convierte un importe a USD con la tasa Toque del día (o la tasa CUP/USD fijada a mano). */
export function aUSD(tabla: TablaTasas, importe: number, moneda: Moneda, fecha: string, tasaManual?: number): number {
  if (moneda === 'USD') return importe
  if (moneda === 'CUP' && tasaManual) return importe / tasaManual
  const t = tasaVigente(tabla, fecha)
  if (!t) return NaN
  return (importe * cupPor(tabla, moneda, fecha)) / t.cupUsd
}

/** Tasa a la que la tienda compra USD (Toque − margen): con ella se valora el efectivo de las ventas. */
export function tasaTiendaCompra(tabla: TablaTasas, fecha: string): number {
  const t = tasaVigente(tabla, fecha)
  if (!t) return NaN
  return t.kmCompra || t.cupUsd - tabla.margen
}

export function tasaTiendaVenta(tabla: TablaTasas, fecha: string): number {
  const t = tasaVigente(tabla, fecha)
  if (!t) return NaN
  return t.kmVenta || t.cupUsd + tabla.margen
}

/**
 * Venta cobrada en CUP (columnas de la hoja Ventas del Excel): la venta se valora a la tasa de
 * venta de la tienda (Toque + margen) y la diferencia hasta su valor a tasa Toque es el
 * «Ingreso por tasa de cambio».
 */
export function valorarVenta(tabla: TablaTasas, importe: number, moneda: Moneda, fecha: string) {
  const toque = aUSD(tabla, importe, moneda, fecha)
  if (moneda !== 'CUP') return { ventaUSD: toque, ingresoTasaUSD: 0 }
  const tienda = tasaTiendaVenta(tabla, fecha)
  const ventaUSD = Number.isFinite(tienda) && tienda > 0 ? importe / tienda : toque
  return { ventaUSD, ingresoTasaUSD: toque - ventaUSD }
}

/** ¿Hay tasa exactamente para ese día? (las importaciones avisan cuando falta). */
export function hayTasaDelDia(tasas: Tasa[], fecha: string) {
  return tasas.some((t) => t.fecha === fecha && t.cupUsd > 0)
}
