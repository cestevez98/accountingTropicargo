import type { Mayor } from './ledger'
import { Indice, bancos, estadoResultados, flujoEfectivo } from './reports'
import type { Dataset } from './types'

export interface Comparacion {
  informe: string
  fila: string
  mes: string
  sistema: number
  excel: number
  diferencia: number
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Compara los totales del sistema con los valores calculados que traía el Excel. Solo devuelve las diferencias > 0,01. */
export function compararConExcel(ds: Dataset, mayor: Mayor, referencia: Record<string, Record<string, Record<string, number>>>, todas = false): Comparacion[] {
  const idx = new Indice(mayor)
  const meses = Object.keys(Object.values(referencia.ER ?? {})[0] ?? {}).sort()
  if (!meses.length) return []
  const er = estadoResultados(ds, idx, meses)
  const efe = flujoEfectivo(ds, idx, meses)
  const bc = bancos(ds, idx, meses)
  const out: Comparacion[] = []
  const comparar = (informe: string, filas: { label: string; valores: number[] }[], ref: Record<string, Record<string, number>> | undefined, alias: Record<string, string> = {}) => {
    if (!ref) return
    const refNorm = new Map(Object.entries(ref).map(([k, v]) => [norm(k), { k, v }]))
    for (const f of filas) {
      const key = alias[f.label] ?? f.label
      const r = refNorm.get(norm(key))
      if (!r) continue
      meses.forEach((m, i) => {
        const ex = r.v[m]
        if (ex == null) return
        const dif = f.valores[i] - ex
        if (todas || Math.abs(dif) > 0.01) out.push({ informe, fila: r.k, mes: m, sistema: f.valores[i], excel: ex, diferencia: dif })
      })
    }
  }
  comparar('ER', er.filas, referencia.ER, { [`Ingresos facturados`]: 'Ingresos facturados', 'Otros ingresos': 'Otros ingresos no facturados' })
  comparar('EFE', efe.filas.filter((f) => f.tipo === 'dato'), referencia.EFE)
  comparar(
    'BAN',
    bc.filas.filter((f) => f.key.startsWith('tes:')).map((f) => ({ ...f, label: f.label.replace(/ \(.*\)$/, '') })),
    referencia.Bancos,
    { 'AMEX Next Plus': 'AMEX Next Plus (tarjeta)', 'BOFA Next Plus': 'BOFA Next Plus (tarjeta)' },
  )
  return out
}
