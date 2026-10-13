import 'server-only'
import { tiendaFija, type Sesion } from './auth'
import { preferencias } from './data'

/** Tienda efectiva de la página: la fija del usuario o la elegida en la barra superior. */
export async function tiendaActiva(s: Sesion) {
  const pref = await preferencias()
  return { tienda: tiendaFija(s) ?? pref.tienda, vista: pref.vista }
}

export type SP = Promise<Record<string, string | string[] | undefined>>

export async function params(sp: SP): Promise<Record<string, string | undefined>> {
  const p = await sp
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]))
}
