import { revalidatePath } from 'next/cache'
import { cargarDataset, registrarAuditoria } from '@/lib/data'
import { aplicarFacturas, CAJAS_TP, compararCobros, compararFacturas, registrarCobros } from '@/lib/sync-tp'
import { tpConfigurado } from '@/lib/trackingpremium'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const USUARIO = 'cron · Tracking Premium'

/**
 * Cron diario de Vercel (vercel.json): Tracking Premium manda en facturas y cobros en efectivo.
 * Revisa los últimos 7 días: guarda las facturas nuevas y los cambios de cobro/estatus, y registra en cada caja los
 * pagos en efectivo que aún no tiene. No borra nada ni toca meses cerrados; las diferencias quedan para revisar en
 * Facturación → Cobros de Tracking Premium.
 */
export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET
  if (!secreto || req.headers.get('authorization') !== `Bearer ${secreto}`) return new Response('No autorizado', { status: 401 })
  if (!tpConfigurado()) return Response.json({ error: 'Falta TP_USER / TP_PASS' }, { status: 500 })
  const hoy = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10) // hora de Cuba
  const desde = new Date(Date.parse(`${hoy}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10)
  const { settings, facturas } = await cargarDataset()
  const abierto = (f: string) => !settings.mesesCerrados.includes(f.slice(0, 7))
  const emision = new Map(facturas.map((f) => [f.numero.toUpperCase(), f.emision]))

  const sync = await compararFacturas(desde, hoy)
  const fact = await aplicarFacturas(
    sync.nuevas.filter((f) => abierto(f.emision)),
    sync.cambios.filter((c) => abierto(emision.get(c.numero.toUpperCase()) ?? hoy)),
    [],
    'contador',
  )
  const cobros: Record<string, { registrados: number; difieren: number; soloCaja: number }> = {}
  for (const caja of CAJAS_TP) {
    const c = await compararCobros(caja, desde, hoy)
    const faltan = c.grupos.filter((g) => g.estado === 'solo_tp').flatMap((g) => g.pagos).filter((p) => abierto(p.fecha))
    const r = faltan.length ? await registrarCobros(caja, faltan, 'contador') : { creados: 0 }
    cobros[caja] = { registrados: r.creados, difieren: c.grupos.filter((g) => g.estado === 'difiere').length, soloCaja: c.grupos.filter((g) => g.estado === 'solo_caja').length }
  }
  await registrarAuditoria([
    { usuario: USUARIO, accion: 'importar', coleccion: 'facturas', detalle: `${desde} a ${hoy}: ${fact.creadas} facturas nuevas, ${fact.actualizadas} actualizadas` },
    ...Object.entries(cobros).map(([caja, r]) => ({
      usuario: USUARIO,
      accion: 'importar' as const,
      coleccion: 'movimientos',
      detalle: `${caja}, ${desde} a ${hoy}: ${r.registrados} cobros registrados; quedan ${r.difieren} con importe distinto y ${r.soloCaja} solo en la caja`,
    })),
  ])
  revalidatePath('/', 'layout')
  return Response.json({ desde, hasta: hoy, facturas: fact, cobros })
}
