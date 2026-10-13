/** Utilidades de fechas en formato ISO (YYYY-MM-DD) sin zonas horarias. */

export const ym = (fecha: string) => fecha.slice(0, 7)

export function finDeMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${mes}-${String(d).padStart(2, '0')}`
}

export function sumarMeses(mes: string, n: number): string {
  const [y, m] = mes.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

export function mesesEntre(desde: string, hasta: string): string[] {
  const out: string[] = []
  for (let m = desde; m <= hasta; m = sumarMeses(m, 1)) out.push(m)
  return out
}

export function diaAnterior(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function hoy(): string {
  return new Date().toISOString().slice(0, 10)
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000)
}

export const esFecha = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
