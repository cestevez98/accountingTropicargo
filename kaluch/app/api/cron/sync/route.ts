import { sincronizarAxis } from '@/lib/axis-servidor'

// La pasada puede tardar (15 áreas): se da margen a la función.
export const maxDuration = 300

/**
 * Sincronización automática de cada noche (Vercel Cron, ver vercel.json). Solo LEE de AxisPOS:
 * trae las novedades a la contabilidad. Vercel manda «Authorization: Bearer $CRON_SECRET».
 */
export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET
  if (!secreto || req.headers.get('authorization') !== `Bearer ${secreto}`) return new Response('No autorizado', { status: 401 })
  try {
    const mensaje = await sincronizarAxis({ modo: 'novedades', usuario: 'sincronización automática', mesesCerradosEditables: false })
    return Response.json({ ok: true, mensaje })
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
