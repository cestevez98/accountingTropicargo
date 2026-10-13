import 'server-only'
import { DEFAULT_SETTINGS } from './catalog'
import { mutar } from './store'
import { leerRespuesta, tasaEmpresa, type TasaMercado } from './fx'
import type { Settings, Tasa } from './types'

export { tasaEmpresa }

/**
 * Tasa del mercado informal de elTOQUE (https://tasas.eltoque.com).
 * Requiere un token de la API en la variable ELTOQUE_TOKEN (se pide en https://tasas-token.eltoque.com/).
 * La tasa de la empresa es la de elTOQUE para el USD más el margen configurado (por defecto +30 CUP).
 */

const API = process.env.ELTOQUE_API_URL || 'https://tasas.eltoque.com/v1/trmi'

/** Fecha de hoy en Cuba (AAAA-MM-DD). */
export function hoyCuba(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export const tokenConfigurado = () => Boolean(process.env.ELTOQUE_TOKEN)

/** Consulta la tasa de un día concreto (o de las últimas 24 horas si no se indica). */
export async function consultarElToque(dia?: string): Promise<TasaMercado> {
  const token = process.env.ELTOQUE_TOKEN
  if (!token) throw new Error('Falta el token de la API de elTOQUE (variable ELTOQUE_TOKEN).')
  const url = new URL(API)
  if (dia) {
    url.searchParams.set('date_from', `${dia} 00:00:01`)
    url.searchParams.set('date_to', `${dia} 23:59:01`)
  }
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (r.status === 401 || r.status === 422) throw new Error('elTOQUE rechazó el token: revisa ELTOQUE_TOKEN.')
  if (r.status === 429) throw new Error('Se superó el límite de consultas de elTOQUE; se reintentará en la próxima actualización.')
  if (!r.ok) throw new Error(`elTOQUE respondió ${r.status}.`)
  return leerRespuesta(await r.json())
}

export interface ResultadoActualizacion {
  ok: boolean
  detalle: string
  guardadas: string[]
  errores: string[]
}

/**
 * Trae de elTOQUE la tasa de cada día indicado y la guarda (una tasa por día).
 * No toca las tasas cargadas a mano (fuente «manual» o sin fuente que estén confirmadas).
 */
export async function actualizarTasas(dias: string[], opciones: { reemplazarImportadas?: boolean } = {}): Promise<ResultadoActualizacion> {
  const obtenidas: { dia: string; m: TasaMercado }[] = []
  const errores: string[] = []
  for (const dia of dias) {
    try {
      // Para hoy se usan las últimas 24 horas; para días pasados, ese día completo.
      obtenidas.push({ dia, m: await consultarElToque(dia === hoyCuba() ? undefined : dia) })
    } catch (e) {
      errores.push(`${dia}: ${e instanceof Error ? e.message : e}`)
      if (/token|límite/.test(String(e))) break
    }
    if (dias.length > 1) await new Promise((r) => setTimeout(r, 250))
  }

  const guardadas: string[] = []
  await mutar({ tasas: [] as Tasa[], settings: DEFAULT_SETTINGS }, ({ tasas, settings }) => {
    guardadas.length = 0 // mutar puede reintentar: se recalcula desde cero
    const margen = Number(settings.margenCupUsd ?? DEFAULT_SETTINGS.margenCupUsd)
    // Se descartan las tasas vacías o en 0 que no sean manuales (vienen de días sin rellenar del Excel).
    let nuevas = tasas.filter((t) => t.cupPorUsd > 0 || t.fuente === 'manual')
    for (const { dia, m } of obtenidas) {
      const existentes = nuevas.filter((t) => t.fecha === dia)
      const manual = existentes.find((t) => t.fuente === 'manual' || (!t.fuente && t.confirmada && !opciones.reemplazarImportadas))
      if (manual) continue
      const { cupPorUsd, usdPorEur } = tasaEmpresa(m, margen)
      const anterior = [...nuevas].filter((t) => t.fecha < dia).sort((a, b) => a.fecha.localeCompare(b.fecha)).at(-1)
      const t: Tasa = {
        id: existentes[0]?.id ?? `tasa-${dia}`,
        fecha: dia,
        cupPorUsd,
        usdPorEur: usdPorEur ?? existentes[0]?.usdPorEur ?? anterior?.usdPorEur ?? 1.08,
        confirmada: true,
        fuente: 'eltoque',
        mercadoUsd: m.usd,
        ...(m.eur ? { mercadoEur: m.eur } : {}),
      }
      nuevas = [...nuevas.filter((x) => x.fecha !== dia), t]
      guardadas.push(dia)
    }
    nuevas.sort((a, b) => a.fecha.localeCompare(b.fecha))
    const ok = errores.length === 0
    const ultima = obtenidas.at(-1)
    const detalle = ultima
      ? `${guardadas.length} día(s) guardado(s). Último: ${ultima.dia} — elTOQUE ${ultima.m.usd} + ${margen} = ${tasaEmpresa(ultima.m, margen).cupPorUsd} CUP por USD.${errores.length ? ` Errores: ${errores.join(' · ')}` : ''}`
      : `No se obtuvo ninguna tasa. ${errores.join(' · ')}`
    const st: Settings = { ...settings, ultimaTasaAuto: { ts: new Date().toISOString(), ok, detalle } }
    return { tasas: nuevas, settings: st }
  })
  return {
    ok: errores.length === 0,
    detalle: guardadas.length
      ? `${guardadas.length} tasa(s) guardada(s).${errores.length ? ` Errores: ${errores.join(' · ')}` : ''}`
      : `No se guardó ninguna tasa. ${errores.join(' · ')}`,
    guardadas,
    errores,
  }
}

/** Días (AAAA-MM-DD) desde `desde` hasta hoy en Cuba, ambos incluidos. */
export function diasHastaHoy(desde: string): string[] {
  const out: string[] = []
  const fin = hoyCuba()
  const d = new Date(`${desde}T12:00:00Z`)
  while (d.toISOString().slice(0, 10) <= fin) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
