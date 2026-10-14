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

/**
 * Cobros sin nota que pagan facturas de Tracking Premium (links generales de pago): se emparejan con los pagos
 * «Square» de Tracking Premium por importe —exacto o con el recargo de tarjeta de 2,5–4,5 %—, primero los del mismo
 * cliente (nombre en el correo) y luego los del mismo día. Devuelve, por id de pago de Square, las facturas que paga.
 */
export function emparejarSinNota(
  sinNota: { id: string; fecha: string; importe: number; email: string }[],
  pagos: PagoTP[],
): Map<string, string[]> {
  const cuadra = (a: number, s: number) => Math.abs(a - s) < 0.02 || (a >= 1.025 * s - 0.02 && a <= 1.045 * s + 0.02)
  const dias = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86400000
  const usados = new Set<number>()
  const out = new Map<string, string[]>()
  const nombre = (p: PagoTP) => p.cliente.toLowerCase().match(/[a-záéíóúñ]{3,}/g) ?? []
  const combinar = (cand: PagoTP[], a: number): PagoTP[] | null => {
    for (let n = 1; n <= Math.min(5, cand.length); n++) {
      const idx = Array.from({ length: n }, (_, i) => i)
      while (true) {
        const comb = idx.map((i) => cand[i])
        if (cuadra(a, comb.reduce((t, p) => t + p.monto, 0))) return comb
        let i = n - 1
        while (i >= 0 && idx[i] === cand.length - n + i) i--
        if (i < 0) break
        idx[i]++
        for (let j = i + 1; j < n; j++) idx[j] = idx[j - 1] + 1
      }
    }
    return null
  }
  for (const pasada of ['cliente', 'dia'] as const) {
    for (const c of sinNota) {
      if (out.has(c.id)) continue
      let cand = pagos.filter((p) => !usados.has(p.id) && dias(c.fecha, p.fecha) >= -1 && dias(c.fecha, p.fecha) <= 3)
      cand = pasada === 'cliente' ? (c.email ? cand.filter((p) => nombre(p).some((w) => c.email.includes(w))) : []) : cand.filter((p) => Math.abs(dias(c.fecha, p.fecha)) <= 1).slice(0, 12)
      const hit = combinar(cand, c.importe)
      if (!hit) continue
      hit.forEach((p) => usados.add(p.id))
      out.set(c.id, [...new Set(hit.flatMap((p) => p.refs))])
    }
  }
  return out
}
