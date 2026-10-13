import type { Movimiento, Tasa } from './types'

export interface TablaTasas {
  fechas: string[]
  tasas: Tasa[]
}

export function prepararTasas(tasas: Tasa[]): TablaTasas {
  // Una tasa en 0 o vacía (p. ej. días futuros sin rellenar en el Excel) no cuenta: se usa la anterior válida.
  const ordenadas = [...tasas].filter((t) => t.fecha && t.cupPorUsd > 0).sort((a, b) => a.fecha.localeCompare(b.fecha))
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

// ---------------------------------------------------------------- elTOQUE

export interface TasaMercado {
  usd: number
  eur?: number
}

/** Extrae USD y EUR de la respuesta (elTOQUE llama «ECU» al euro). */
export function leerRespuesta(json: unknown): TasaMercado {
  const raiz = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const tasas = (raiz.tasas && typeof raiz.tasas === 'object' ? raiz.tasas : raiz) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN)
  const usd = num(tasas.USD ?? tasas.usd)
  const eur = num(tasas.ECU ?? tasas.EUR ?? tasas.eur)
  if (!Number.isFinite(usd) || usd <= 0) throw new Error(`elTOQUE no devolvió la tasa del USD (respuesta: ${JSON.stringify(json).slice(0, 200)}).`)
  return { usd, eur: Number.isFinite(eur) && eur > 0 ? eur : undefined }
}

export function tasaEmpresa(m: TasaMercado, margen: number) {
  const cupPorUsd = Math.round((m.usd + margen) * 100) / 100
  // El EUR se convierte a USD con la relación del mercado (CUP por EUR ÷ CUP por USD).
  const usdPorEur = m.eur ? Math.round((m.eur / m.usd) * 10000) / 10000 : undefined
  return { cupPorUsd, usdPorEur }
}

