import { sesionActual } from '@/lib/auth'
import { cargarDataset } from '@/lib/data'
import { leerArchivoPrivado } from '@/lib/store'

/** Sirve las fotos de los comprobantes de remesas solo a quien puede ver esa remesa. */
export async function GET(req: Request) {
  const s = await sesionActual()
  if (!s) return new Response('No autorizado', { status: 401 })
  const ruta = new URL(req.url).searchParams.get('ruta') ?? ''
  if (!/^remesas\/[\w-]+\/[\w.-]+$/.test(ruta)) return new Response('Ruta inválida', { status: 400 })
  const ds = await cargarDataset()
  const r = ds.remesas.find((x) => x.fotos?.includes(ruta))
  if (!r) return new Response('No encontrado', { status: 404 })
  if (s.rol === 'agente' && r.agente !== s.agente) return new Response('No autorizado', { status: 403 })
  const a = await leerArchivoPrivado(ruta)
  if (!a) return new Response('No encontrado', { status: 404 })
  const cuerpo: BodyInit = Buffer.isBuffer(a.datos) ? new Uint8Array(a.datos) : (a.datos as ReadableStream)
  return new Response(cuerpo, {
    headers: { 'Content-Type': a.tipo, 'Cache-Control': 'private, max-age=3600' },
  })
}
