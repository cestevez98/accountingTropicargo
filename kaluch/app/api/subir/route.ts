import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { puedeRegistrar, sesionActual } from '@/lib/auth'

/** Genera el token para que el navegador suba un archivo de importación directo a Vercel Blob. */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody
  try {
    const r = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const s = await sesionActual()
        if (!s || !puedeRegistrar(s, 'importar')) throw new Error('No autorizado')
        if (!pathname.startsWith('importaciones/')) throw new Error('Ruta no válida')
        return {
          allowedContentTypes: [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'application/vnd.ms-excel.sheet.macroEnabled.12',
            'text/csv',
            'application/octet-stream',
          ],
          maximumSizeInBytes: 60 * 1024 * 1024,
          addRandomSuffix: true,
        }
      },
    })
    return Response.json(r)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
