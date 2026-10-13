import 'server-only'
import { ClienteAxis, mapearOperaciones } from './axispos'
import { DEFAULT_SETTINGS } from './catalogo'
import { cargarDataset, registrarAuditoria } from './data'
import { ym } from './fecha'
import { prepararTasas, tasaVigente } from './fx'
import { mutar } from './store'
import type { Compra, Dataset, Movimiento, Salida } from './types'

/** Cliente del TPV con la configuración guardada y la contraseña de las variables del servidor. */
export function clienteAxis(ds: Pick<Dataset, 'settings'>) {
  const cfg = ds.settings.axispos
  if (!cfg?.url || !cfg.usuario) throw new Error('Configura primero la dirección del tenant y el usuario de AxisPOS.')
  if (!process.env.AXISPOS_PASSWORD) throw new Error('Falta la variable de entorno AXISPOS_PASSWORD en Vercel.')
  return new ClienteAxis(cfg.url, cfg.usuario, process.env.AXISPOS_PASSWORD)
}

export interface OpcionesSync {
  modo: 'novedades' | 'rango'
  desde?: string
  hasta?: string
  /** Quién la lanza (correo o «sincronización automática»), para la auditoría. */
  usuario: string
  /** El propietario puede escribir en meses cerrados; para el resto lo de esos meses se descarta. */
  mesesCerradosEditables: boolean
  /** Solo estas tiendas (p. ej. para el arqueo de una caja). */
  tiendas?: string[]
}

/**
 * Trae las operaciones del TPV (solo lectura en AxisPOS) y las guarda en la contabilidad.
 * - «novedades»: desde el día anterior a la última pasada de cada área (sin duplicar).
 * - «rango»: un rango de fechas; sustituye lo traído antes del TPV en esas fechas.
 */
export async function sincronizarAxis(o: OpcionesSync) {
  const ds = await cargarDataset()
  const { modo, desde, hasta } = o
  if (desde && hasta && hasta < desde) throw new Error('El rango de fechas está al revés.')
  const tiendas = ds.tiendas.filter((t) => t.codigoTPV && (!o.tiendas || o.tiendas.includes(t.id)))
  if (!tiendas.length) throw new Error('Ninguna tienda tiene asignada su área del TPV (ObjectCode).')
  const cfg = ds.settings.axispos!
  const c = clienteAxis(ds)
  const ops = []
  const caja = []
  const inicio = cfg.desde ?? ds.settings.fechaInicio
  const hoyISO = new Date().toISOString().slice(0, 10)
  const ultimo: Record<string, string> = { ...cfg.ultimoDia }
  for (const t of tiendas)
    for (const area of (t.codigoTPV ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
      // Novedades: desde el día anterior a la última pasada (recoge lo que llegó tarde) hasta hoy.
      // Lo repetido se descarta por tienda + ticket + fecha. Las marcas de agua de la central no se
      // usan porque un área sin movimiento devuelve -1, y pedir desde 0 traería todo el historial.
      let d = desde
      if (modo === 'novedades') {
        const u = cfg.ultimoDia?.[area]
        d = u ? new Date(Date.parse(`${u}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : inicio
        if (d < inicio) d = inicio
      }
      const r = await c.exportarOperaciones(area, { desde: d, hasta: modo === 'rango' ? hasta : hoyISO })
      ops.push(...r.operaciones)
      caja.push(...r.caja)
      if (modo === 'novedades') ultimo[area] = hoyISO
    }
  const tabla = prepararTasas(ds.tasas, ds.settings.margenTasa)
  const m = mapearOperaciones(ops, caja, ds.tiendas, (f) => tasaVigente(tabla, f)?.cupUsd ?? 0, { cobros: Boolean(cfg.cobros), cuentaBanco: cfg.cuentaBanco })
  // Meses cerrados: solo el propietario los toca; para el resto (y la pasada automática) se descartan.
  const cerrados = new Set(ds.settings.mesesCerrados)
  let enCerrados = 0
  const abierto = <T extends { fecha: string }>(xs: T[]) =>
    o.mesesCerradosEditables
      ? xs
      : xs.filter((x) => {
          const ok = !cerrados.has(ym(x.fecha))
          if (!ok) enCerrados++
          return ok
        })
  m.salidas = abierto(m.salidas)
  m.compras = abierto(m.compras)
  m.movimientos = abierto(m.movimientos)
  const loteId = crypto.randomUUID()
  let nuevas = { salidas: 0, compras: 0, movimientos: 0 }
  await mutar({ salidas: [] as Salida[], compras: [] as Compra[], movimientos: [] as Movimiento[], settings: DEFAULT_SETTINGS }, (a) => {
    const marca = <T extends object>(arr: T[]) => arr.map((x) => ({ ...x, id: crypto.randomUUID(), lote: loteId }))
    if (modo === 'rango') {
      const fuera = (x: { origen?: string; fecha: string }) => !(x.origen === 'tpv' && x.fecha >= desde! && x.fecha <= hasta! && (o.mesesCerradosEditables || !cerrados.has(ym(x.fecha))))
      nuevas = { salidas: m.salidas.length, compras: m.compras.length, movimientos: m.movimientos.length }
      return {
        salidas: [...a.salidas.filter(fuera), ...marca(m.salidas)],
        compras: [...a.compras.filter(fuera), ...marca(m.compras)],
        movimientos: [...a.movimientos.filter(fuera), ...marca(m.movimientos)],
        settings: { ...DEFAULT_SETTINGS, ...a.settings, axispos: { ...a.settings.axispos!, ultimoSync: new Date().toISOString() } },
      }
    }
    // Novedades: se descartan las operaciones (tienda + ticket + fecha) que ya estén guardadas.
    const ya = new Set(a.salidas.filter((x) => x.origen === 'tpv').map((x) => `${x.tienda}|${x.operacion}|${x.fecha}`))
    const yaC = new Set(a.compras.filter((x) => x.origen === 'tpv').map((x) => `${x.tienda}|${x.factura}|${x.fecha}`))
    const kM = (x: Movimiento) => `${x.libro}|${x.tienda}|${x.fecha}|${x.concepto}|${x.tipo}|${x.moneda}|${x.monto}`
    const yaM = new Map<string, number>()
    for (const x of a.movimientos) if (x.origen === 'tpv') yaM.set(kM(x), (yaM.get(kM(x)) ?? 0) + 1)
    const sal = m.salidas.filter((x) => !ya.has(`${x.tienda}|${x.operacion}|${x.fecha}`))
    const com = m.compras.filter((x) => !yaC.has(`${x.tienda}|${x.factura}|${x.fecha}`))
    const mov = m.movimientos.filter((x) => {
      const n = yaM.get(kM(x)) ?? 0
      if (n > 0) yaM.set(kM(x), n - 1)
      return n === 0
    })
    nuevas = { salidas: sal.length, compras: com.length, movimientos: mov.length }
    return {
      salidas: [...a.salidas, ...marca(sal)],
      compras: [...a.compras, ...marca(com)],
      movimientos: [...a.movimientos, ...marca(mov)],
      settings: { ...DEFAULT_SETTINGS, ...a.settings, axispos: { ...a.settings.axispos!, ultimoSync: new Date().toISOString(), ultimoDia: ultimo } },
    }
  })
  const ign = [...m.ignorados.entries()].map(([k, v]) => `${v} ${k}`).join(', ')
  await registrarAuditoria([{ usuario: o.usuario, accion: 'sincronizar', coleccion: 'axispos', detalle: `${modo}${desde ? ` ${desde}…${hasta}` : ''}: ${ops.length} operaciones, ${caja.length} asientos de caja → ${JSON.stringify(nuevas)}${enCerrados ? `, ${enCerrados} en meses cerrados descartadas` : ''}` }])
  return `${ops.length} operaciones del TPV: ${nuevas.salidas} líneas de venta/salida, ${nuevas.compras} de compra y ${nuevas.movimientos} movimientos de caja/banco.${m.sinTienda ? ` ${m.sinTienda} de áreas sin tienda.` : ''}${enCerrados ? ` ${enCerrados} de meses cerrados no se tocaron.` : ''}${ign ? ` No contabilizadas todavía: ${ign}.` : ''}`
}
