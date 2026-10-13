import 'server-only'
import { DEFAULT_SETTINGS } from './catalog'
import { CAJA_DE_CUENTA_TP, conciliarCobros, type GrupoCobro } from './conciliar-cobros'
import { cargarContabilidad, cargarDataset } from './data'
import { esFecha } from './fecha'
import { mutar } from './store'
import { aFactura, facturasTP, pagosTP, refsCobro, type PagoTP } from './trackingpremium'
import type { FacturaVenta, Movimiento, Rol } from './types'

/**
 * Sincronización con Tracking Premium: facturas (ingresos y CxC) y cobros en efectivo de las cajas.
 * La usan las pantallas de Facturación (con revisión) y el cron diario (automático).
 */

export type NuevaFacturaTP = Omit<FacturaVenta, 'id'>
export interface CambioFacturaTP {
  numero: string
  cliente: string
  campos: { campo: 'monto' | 'cobrado' | 'estatusSistema'; antes: string | number | undefined; despues: string | number | undefined }[]
}
export interface SyncTP {
  totales: { facturas: number; monto: number; cobrado: number }
  nuevas: NuevaFacturaTP[]
  cambios: CambioFacturaTP[]
  iguales: number
  soloSistema: { id: string; numero: string; cliente: string; emision: string; monto: number }[]
}
export interface ConciliacionCobrosTP {
  caja: string
  grupos: GrupoCobro[]
  /** Pagos del período que no entran en una caja física (Square, PayPal, wallet, banco…), por tipo y cuenta. */
  otros: { tipo: string; cuentaTP: string; n: number; monto: number }[]
}

export const CAJAS_TP = [...new Set(Object.values(CAJA_DE_CUENTA_TP))]

const sumarDias = (f: string, d: number) => new Date(Date.parse(`${f}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)

export function validarRango(desde: string, hasta: string) {
  if (!esFecha(desde) || !esFecha(hasta) || desde > hasta) throw new Error('Rango de fechas inválido.')
  if ((Date.parse(hasta) - Date.parse(desde)) / 86400000 > 120) throw new Error('Como máximo 120 días por consulta.')
}

/** Compara las facturas de Tracking Premium del período con las de la contabilidad. No guarda nada. */
export async function compararFacturas(desde: string, hasta: string): Promise<SyncTP> {
  validarRango(desde, hasta)
  const [tp, ds] = await Promise.all([facturasTP(desde, hasta), cargarDataset()])
  const porNumero = new Map(ds.facturas.map((f) => [f.numero.toUpperCase(), f]))
  const enTP = new Set(tp.lista.map((f) => f.number.toUpperCase()))
  const nuevasLista = tp.lista.filter((f) => !porNumero.has(f.number.toUpperCase()))
  const det = nuevasLista.length ? await tp.conDetalle(nuevasLista.map((f) => f.number)) : new Map()
  const nuevas = nuevasLista.map((f) => aFactura(f, det.get(f.number))).sort((a, b) => a.emision.localeCompare(b.emision) || a.numero.localeCompare(b.numero))
  // El vencimiento de las facturas ya registradas no se toca: el Excel original usaba otra convención.
  const cambios: CambioFacturaTP[] = []
  let iguales = 0
  for (const f of tp.lista) {
    const sis = porNumero.get(f.number.toUpperCase())
    if (!sis) continue
    const n = aFactura(f)
    const campos: CambioFacturaTP['campos'] = []
    if (Math.abs(sis.monto - n.monto) > 0.005) campos.push({ campo: 'monto', antes: sis.monto, despues: n.monto })
    if (Math.abs(sis.cobrado - n.cobrado) > 0.005) campos.push({ campo: 'cobrado', antes: sis.cobrado, despues: n.cobrado })
    if ((sis.estatusSistema ?? '') !== (n.estatusSistema ?? '')) campos.push({ campo: 'estatusSistema', antes: sis.estatusSistema, despues: n.estatusSistema })
    if (campos.length) cambios.push({ numero: sis.numero, cliente: sis.cliente, campos })
    else iguales++
  }
  const soloSistema = ds.facturas
    .filter((f) => /^INV/i.test(f.numero) && f.emision >= desde && f.emision <= hasta && !enTP.has(f.numero.toUpperCase()))
    .map((f) => ({ id: f.id, numero: f.numero, cliente: f.cliente, emision: f.emision, monto: f.monto }))
  return { totales: tp.totales, nuevas, cambios, iguales, soloSistema }
}

/** Guarda facturas nuevas, aplica cambios y borra las indicadas. Un rol distinto de admin no toca meses cerrados. */
export async function aplicarFacturas(nuevas: NuevaFacturaTP[], cambios: CambioFacturaTP[], borrar: string[], rol: Rol) {
  let creadas = 0
  let actualizadas = 0
  let borradas = 0
  await mutar({ facturas: [] as FacturaVenta[], settings: DEFAULT_SETTINGS }, ({ facturas, settings }) => {
    creadas = actualizadas = borradas = 0
    const cerrado = (f: string) => rol !== 'admin' && settings.mesesCerrados.includes(f.slice(0, 7))
    const existentes = new Set(facturas.map((f) => f.numero.toUpperCase()))
    const aBorrar = new Set(borrar)
    const porNumero = new Map(cambios.map((c) => [c.numero.toUpperCase(), c]))
    const resultado = facturas
      .filter((f) => {
        if (!aBorrar.has(f.id)) return true
        if (cerrado(f.emision)) throw new Error(`El mes de ${f.emision} está cerrado.`)
        borradas++
        return false
      })
      .map((f) => {
        const c = porNumero.get(f.numero.toUpperCase())
        if (!c) return f
        if (cerrado(f.emision)) throw new Error(`El mes de ${f.emision} está cerrado.`)
        actualizadas++
        const n = { ...f }
        for (const x of c.campos) {
          if (x.campo === 'monto' || x.campo === 'cobrado') {
            if (!Number.isFinite(Number(x.despues))) throw new Error(`Importe inválido en ${f.numero}.`)
            n[x.campo] = Number(x.despues)
          } else n[x.campo] = x.despues == null ? undefined : String(x.despues)
        }
        return n
      })
    for (const f of nuevas) {
      if (!f.numero || !esFecha(f.emision) || !Number.isFinite(f.monto) || !Number.isFinite(f.cobrado)) throw new Error(`Factura inválida: ${f.numero}`)
      if (existentes.has(f.numero.toUpperCase())) continue
      if (cerrado(f.emision)) throw new Error(`El mes de ${f.emision} está cerrado.`)
      existentes.add(f.numero.toUpperCase())
      resultado.push({ ...f, id: `fv-tp-${f.numero}` })
      creadas++
    }
    return { facturas: resultado }
  })
  return { creadas, actualizadas, borradas }
}

// Pagar con wallet no mete efectivo en la caja: el dinero entró antes, con la recarga de billetera.
const enCaja = (p: { tipo: string; cuentaTP: string }) => Boolean(CAJA_DE_CUENTA_TP[p.cuentaTP]) && p.tipo !== 'Wallet'

/** Compara los pagos verificados de Tracking Premium con los cobros registrados en una caja. No guarda nada. */
export async function compararCobros(caja: string, desde: string, hasta: string): Promise<ConciliacionCobrosTP> {
  validarRango(desde, hasta)
  // Se piden unos días de margen a cada lado: un cobro puede registrarse en la caja un día antes o después.
  const [todos, { ds, mayor }] = await Promise.all([pagosTP(sumarDias(desde, -5), sumarDias(hasta, 5)), cargarContabilidad()])
  const pagos = todos.filter((p) => enCaja(p) && CAJA_DE_CUENTA_TP[p.cuentaTP] === caja)
  const cobros = ds.movimientos
    .filter(
      (m) =>
        m.cuenta === caja &&
        m.categoria === 'Cobro cliente' &&
        m.fecha >= sumarDias(desde, -5) &&
        m.fecha <= sumarDias(hasta, 5) &&
        !/recarga\s+(de\s+)?billetera/i.test(m.concepto),
    )
    .map((m) => ({ id: m.id, fecha: m.fecha, concepto: m.concepto, usd: mayor.usd.get(m.id) ?? 0, refs: refsCobro(`${m.concepto} ${m.referencia ?? ''}`) }))
  const grupos = conciliarCobros(pagos, cobros).filter((g) => g.fecha >= desde && g.fecha <= hasta)
  const otros = new Map<string, { tipo: string; cuentaTP: string; n: number; monto: number }>()
  for (const p of todos) {
    if (enCaja(p) || p.fecha < desde || p.fecha > hasta) continue
    const k = `${p.tipo}|${p.cuentaTP}`
    const o = otros.get(k) ?? { tipo: p.tipo, cuentaTP: p.cuentaTP || 'N/A', n: 0, monto: 0 }
    o.n++
    o.monto += p.monto
    otros.set(k, o)
  }
  return { caja, grupos, otros: [...otros.values()].sort((a, b) => b.monto - a.monto) }
}

/** Registra en la caja, como «Cobro cliente», los pagos de Tracking Premium indicados (no repite los ya importados). */
export async function registrarCobros(caja: string, pagos: PagoTP[], rol: Rol) {
  let creados = 0
  let omitidos = 0
  await mutar({ movimientos: [] as Movimiento[], settings: DEFAULT_SETTINGS }, ({ movimientos, settings }) => {
    creados = omitidos = 0
    const refs = new Set(movimientos.map((m) => m.referencia).filter(Boolean))
    const nuevos: Movimiento[] = []
    for (const p of pagos) {
      if (CAJA_DE_CUENTA_TP[p.cuentaTP] !== caja || !enCaja(p)) throw new Error(`El pago ${p.numero} no es un cobro en efectivo de ${caja}.`)
      if (!esFecha(p.fecha) || !Number.isFinite(p.monto) || p.monto <= 0) throw new Error(`Pago inválido: ${p.numero}`)
      if (rol !== 'admin' && settings.mesesCerrados.includes(p.fecha.slice(0, 7))) throw new Error(`El mes de ${p.fecha} está cerrado.`)
      const referencia = `TP-PAGO-${p.id}`
      if (refs.has(referencia)) {
        omitidos++
        continue
      }
      refs.add(referencia)
      nuevos.push({
        id: crypto.randomUUID(),
        fecha: p.fecha,
        cuenta: caja,
        categoria: 'Cobro cliente',
        concepto: `${p.refs.join(', ') || p.numero} ${p.cliente}`.slice(0, 300),
        referencia,
        moneda: 'USD',
        entrada: p.monto,
        salida: 0,
        observaciones: `Importado de Tracking Premium (${p.numero}, ${p.tipo}, ${p.cuentaTP})`,
      })
      creados++
    }
    return { movimientos: [...movimientos, ...nuevos] }
  })
  return { creados, omitidos }
}
