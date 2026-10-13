import 'server-only'
import { cargarContabilidad } from './data'
import { aniosDisponibles, mesesDelAnio } from './reports'

export type SP = Promise<Record<string, string | string[] | undefined>>

export const param = (sp: Record<string, string | string[] | undefined>, k: string) => {
  const v = sp[k]
  return Array.isArray(v) ? v[0] : v
}

export async function contextoInforme(searchParams: SP) {
  const sp = await searchParams
  const c = await cargarContabilidad()
  const anios = aniosDisponibles(c.mayor)
  const pedido = Number(param(sp, 'anio'))
  const anio = anios.includes(pedido) ? pedido : anios.at(-1)!
  const meses = mesesDelAnio(c.mayor, anio)
  return { ...c, anio, anios, meses, sp }
}
