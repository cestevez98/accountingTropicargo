import { revalidatePath } from 'next/cache'
import { leer } from '@/lib/store'
import { actualizarTasas, diasHastaHoy, hoyCuba } from '@/lib/eltoque'
import type { Tasa } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Cron diario de Vercel (vercel.json): guarda la tasa de elTOQUE + margen del día.
 * Si en la última semana falta algún día (p. ej. un fallo), también lo rellena.
 */
export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET
  if (!secreto || req.headers.get('authorization') !== `Bearer ${secreto}`) return new Response('No autorizado', { status: 401 })
  const tasas = await leer<Tasa[]>('tasas', [])
  const conAuto = new Set(tasas.filter((t) => t.fuente === 'eltoque' || t.fuente === 'manual').map((t) => t.fecha))
  const hace7 = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)
  const dias = diasHastaHoy(hace7).filter((d) => d === hoyCuba() || !conAuto.has(d))
  const r = await actualizarTasas(dias)
  revalidatePath('/', 'layout')
  return Response.json(r, { status: r.guardadas.length ? 200 : 502 })
}
