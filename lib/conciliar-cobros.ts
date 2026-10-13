import type { PagoTP } from './trackingpremium'

/** Caja de la contabilidad a la que entra el dinero según la cuenta que marca Tracking Premium. */
export const CAJA_DE_CUENTA_TP: Record<string, string> = {
  'EFECTIVO CUBA USD': 'Caja Cuba',
  'EFECTIVO CUBA CUP': 'Caja Cuba',
  'EFECTIVO CUBA EUROS': 'Caja Cuba',
  'EFECTIVO MIAMI USD': 'Caja Miami',
}

export interface CobroCaja {
  id: string
  fecha: string
  concepto: string
  usd: number
  refs: string[]
}

export interface GrupoCobro {
  pagos: PagoTP[]
  cobros: CobroCaja[]
  totalTP: number
  totalCaja: number
  fecha: string
  estado: 'cuadra' | 'difiere' | 'solo_tp' | 'solo_caja'
}

/**
 * Agrupa pagos de Tracking Premium y cobros registrados en la caja que comparten alguna factura o multipago
 * (la caja suele juntar varias facturas en un movimiento y redondear el vuelto) y compara los totales de cada grupo.
 */
export function conciliarCobros(pagos: PagoTP[], cobros: CobroCaja[], tolerancia = 1): GrupoCobro[] {
  const padre = new Map<string, string>()
  const raiz = (a: string): string => {
    let r = a
    while (padre.has(r) && padre.get(r) !== r) r = padre.get(r)!
    padre.set(a, r)
    return r
  }
  const unir = (a: string, b: string) => {
    if (!padre.has(a)) padre.set(a, a)
    if (!padre.has(b)) padre.set(b, b)
    padre.set(raiz(a), raiz(b))
  }
  pagos.forEach((p) => (p.refs.length ? p.refs.forEach((r) => unir(`p${p.id}`, `r${r}`)) : unir(`p${p.id}`, `p${p.id}`)))
  cobros.forEach((c) => (c.refs.length ? c.refs.forEach((r) => unir(`m${c.id}`, `r${r}`)) : unir(`m${c.id}`, `m${c.id}`)))
  const grupos = new Map<string, GrupoCobro>()
  const grupo = (k: string) => {
    const g = grupos.get(raiz(k)) ?? { pagos: [], cobros: [], totalTP: 0, totalCaja: 0, fecha: '9999', estado: 'cuadra' as const }
    grupos.set(raiz(k), g)
    return g
  }
  for (const p of pagos) {
    const g = grupo(`p${p.id}`)
    g.pagos.push(p)
    g.totalTP += p.monto
    if (p.fecha < g.fecha) g.fecha = p.fecha
  }
  for (const c of cobros) {
    const g = grupo(`m${c.id}`)
    g.cobros.push(c)
    g.totalCaja += c.usd
    if (c.fecha < g.fecha) g.fecha = c.fecha
  }
  return [...grupos.values()]
    .map((g) => ({
      ...g,
      totalTP: Math.round(g.totalTP * 100) / 100,
      totalCaja: Math.round(g.totalCaja * 100) / 100,
      estado: !g.cobros.length ? 'solo_tp' : !g.pagos.length ? 'solo_caja' : Math.abs(g.totalCaja - g.totalTP) <= tolerancia ? 'cuadra' : 'difiere',
    }) as GrupoCobro)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
}
