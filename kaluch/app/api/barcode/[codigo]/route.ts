import { sesionActual } from '@/lib/auth'

/**
 * Busca un código de barras en MiBarcode (base pública de productos de AxisSoft) para identificar lo
 * que se escanea y no está en el catálogo. Solo lectura; pasa por aquí para no depender del CORS.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  if (!(await sesionActual())) return new Response('No autorizado', { status: 401 })
  const { codigo } = await params
  if (!/^[0-9A-Za-z-]{3,40}$/.test(codigo)) return Response.json({ encontrado: false })
  try {
    const r = await fetch(`https://mibarcode.axissoft.cloud/api/products/by-barcode/${encodeURIComponent(codigo)}`, { signal: AbortSignal.timeout(8000), next: { revalidate: 86400 } })
    if (!r.ok) return Response.json({ encontrado: false })
    const p = (await r.json()) as { id: number; name?: string; measureUnit?: string; image?: { url?: string } | null }
    return Response.json({ encontrado: true, nombre: p.name, unidad: p.measureUnit, imagen: p.image?.url ? `https://mibarcode.axissoft.cloud${p.image.url}` : undefined })
  } catch {
    return Response.json({ encontrado: false })
  }
}
