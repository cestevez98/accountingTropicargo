import { puedeVer, sesionActual } from '@/lib/auth'

/** Muestra una foto de un cierre de turno (guardadas en Blob privado). Solo con sesión. */
export async function GET(req: Request) {
  const s = await sesionActual()
  if (!s || !puedeVer(s, 'arqueo')) return new Response('No autorizado', { status: 401 })
  const p = new URL(req.url).searchParams.get('p') ?? ''
  if (!/^fotos\/[\w./-]+$/.test(p) || p.includes('..')) return new Response('Ruta no válida', { status: 400 })
  const { get } = await import('@vercel/blob')
  const r = await get(p, { access: 'private' })
  if (!r?.stream) return new Response('No existe', { status: 404 })
  return new Response(r.stream, { headers: { 'Content-Type': r.blob.contentType ?? 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } })
}
