import { clienteAxis } from '@/lib/axis-servidor'
import { cargarDataset } from '@/lib/data'
import { prepararTasas, tasaVigente } from '@/lib/fx'
import { gruposPorTienda, precioEnTienda, precioWeb } from '@/lib/sincro'

/**
 * Catálogo para la Tienda Web (el maestro es Kaluch). Protegido con WEB_CATALOGO_TOKEN
 * (cabecera «Authorization: Bearer …» o ?token=). Con ?existencias=1 añade lo disponible en el
 * Almacén Central (envío) y en cada local (recogida), leído del TPV en ese momento.
 */
export async function GET(req: Request) {
  const token = process.env.WEB_CATALOGO_TOKEN
  const u = new URL(req.url)
  const dado = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? u.searchParams.get('token')
  if (!token || dado !== token) return new Response('No autorizado', { status: 401 })
  const ds = await cargarDataset()
  const t = tasaVigente(prepararTasas(ds.tasas, ds.settings.margenTasa), new Date().toISOString().slice(0, 10))
  const grupos = gruposPorTienda(ds.tiendas, ds.settings.axispos?.ubicaciones)
  const locales = ds.tiendas.filter((x) => x.activa && x.tipo === 'local' && x.codigoTPV)
  const central = ds.tiendas.find((x) => x.tipo === 'almacen' && x.codigoTPV)
  let stock: Map<string, Map<string, number>> | undefined
  let aviso: string | undefined
  if (u.searchParams.get('existencias') === '1') {
    try {
      const fuentes = [...(central ? [central] : []), ...locales]
      const deArea = new Map(fuentes.flatMap((x) => (x.codigoTPV ?? '').split(',').map((c) => [c.trim(), x.id] as const)))
      stock = new Map()
      for (const d of await clienteAxis(ds).existencias([...deArea.keys()])) {
        const tid = deArea.get(String(d.objectCode))
        if (!tid) continue
        const m = stock.get(tid) ?? new Map<string, number>()
        for (const a of d.ItemsAvailability ?? []) m.set(String(a.Code), (m.get(String(a.Code)) ?? 0) + (Number(a.Amount) || 0))
        stock.set(tid, m)
      }
    } catch (e) {
      aviso = `Sin existencias: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  const productos = ds.productos
    .filter((p) => p.codigo && p.codigo !== p.nombre)
    .map((p) => ({
      codigo: p.codigo,
      nombre: p.nombre,
      grupo: p.grupo,
      unidad: p.unidad,
      barras: p.barras ?? [],
      imagen: p.imagen,
      descripcion: p.descripcion,
      precioWebCUP: precioWeb(p, ds.settings.margenWeb, t?.cupUsd),
      preciosTiendaCUP: Object.fromEntries(locales.map((x) => [x.id, precioEnTienda(p, grupos.get(x.id))])),
      ...(stock
        ? {
            existencias: {
              envio: central ? (stock.get(central.id)?.get(p.codigo) ?? 0) : 0,
              recogida: Object.fromEntries(locales.map((x) => [x.id, stock!.get(x.id)?.get(p.codigo) ?? 0])),
            },
          }
        : {}),
    }))
  return Response.json(
    { empresa: ds.settings.empresa, generado: new Date().toISOString(), margenWeb: ds.settings.margenWeb ?? null, tiendas: locales.map((x) => ({ id: x.id, nombre: x.nombre, direccion: x.direccion })), aviso, productos },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  )
}
