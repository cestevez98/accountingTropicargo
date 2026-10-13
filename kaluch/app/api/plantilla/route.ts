import { sesionActual } from '@/lib/auth'
import { libroPlantilla, PLANTILLAS } from '@/lib/plantillas'

export async function GET(req: Request) {
  if (!(await sesionActual())) return new Response('No autorizado', { status: 401 })
  const tipo = new URL(req.url).searchParams.get('tipo') as keyof typeof PLANTILLAS
  if (!PLANTILLAS[tipo]) return new Response('Plantilla desconocida', { status: 404 })
  return new Response(new Uint8Array(libroPlantilla(tipo)), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="plantilla-${tipo}.xlsx"`,
    },
  })
}
