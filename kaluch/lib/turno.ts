import type { OperacionTPV, PagoTPV } from './axispos'
import type { Moneda } from './types'

/**
 * Cierre de cambio de turno (modelo «Cuadre diario», «Check list de cambio de turno» y «Venta por tarjeta»
 * de las tiendas, que abren 24 horas). Funciones puras.
 *
 * Efectivo esperado = venta en tienda + a domicilio + en plataforma − transferencias − por cobrar − otros gastos.
 * Efectivo contado  = billetes CUP + sueltos + USD × tasa + EUR × tasa + otros.
 * El salario NO se resta del esperado (así cuadran las hojas del 11/10 y del 13/10): el efectivo contado lo
 * incluye. Se decide al revisar el cierre y se paga desde «Pagos al personal», con los descuentos que haya;
 * a la caja central va todo el efectivo menos el fondo.
 */

/** Billetes CUP de la hoja (las filas de 20000 y 10000 son paquetes). */
export const BILLETES_CUP = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 3, 1]

const r2 = (n: number) => Math.round(n * 100) / 100

/** Fecha y hora local de Cuba (como las da el TPV en DateIssued): AAAA-MM-DDTHH:mm:ss. */
export function horaCuba(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
}

/** Turno por la hora del cierre: el de NOCHE (8 pm – 8 am) se cierra por la mañana, el de DÍA por la noche. */
export const turnoDeHora = (hasta: string): 'dia' | 'noche' => {
  const h = Number(hasta.slice(11, 13))
  return h >= 2 && h < 14 ? 'noche' : 'dia'
}
export const TURNO_LABEL = { dia: 'DÍA (8:00 a.m. – 8:00 p.m.)', noche: 'NOCHE (8:00 p.m. – 8:00 a.m.)' } as const

export interface TramoTurno {
  desde: string
  hasta: string
  venta: number
  tickets: number
  pax: Record<string, number>
}

export interface ResumenTurno {
  tickets: number
  /** Venta del turno en CUP (moneda base del TPV), devoluciones restadas. */
  venta: number
  efectivo: number
  /** Cobros que no son efectivo (tarjeta, transferencia…), por tipo de pago. */
  noEfectivo: Record<string, number>
  /** Efectivo cobrado en su moneda original. */
  efectivoPorMoneda: Partial<Record<Moneda, number>>
  /** Tasa media a la que el TPV cobró cada moneda extranjera en el turno. */
  tasas: Partial<Record<Moneda, number>>
  porCajero: Record<string, number>
  /** Clientes marcados con los artículos de ESTADISTICA del TPV («PAX A», «PAX B», «PAX C»). */
  pax: Record<string, number>
  /** El turno partido por los cortes del reporte (p. ej. 2 a.m. en el de noche). */
  tramos: TramoTurno[]
  primera?: string
  ultima?: string
}

const MONEDAS = new Set(['CUP', 'USD', 'EUR', 'MLC'])
const esPax = (l: { Category?: string; ItemName?: string }) => /ESTADIST/i.test(l.Category ?? '') || /^PAX\b/i.test(l.ItemName ?? '')

/** Los tramos del reporte: el turno se corta en cada hora de `cortes` («02:00») que caiga dentro. */
export function tramosDe(desde: string, hasta: string, cortes: string[] = []) {
  const puntos = new Set<string>()
  for (let d = new Date(`${desde.slice(0, 10)}T00:00:00Z`); d.toISOString().slice(0, 10) <= hasta.slice(0, 10); d = new Date(d.getTime() + 86400000))
    for (const c of cortes) {
      const p = `${d.toISOString().slice(0, 10)}T${c}:00`
      if (p > desde && p < hasta) puntos.add(p)
    }
  const ps = [desde, ...[...puntos].sort(), hasta]
  return ps.slice(0, -1).map((p, i) => ({ desde: p, hasta: ps[i + 1] }))
}

/** Ventas (2) y devoluciones (34) de una caja entre dos horas locales (desde excluida, hasta incluida). */
export function resumenTurno(ops: OperacionTPV[], desde: string, hasta: string, usuarios: Map<string, string> = new Map(), cortes: string[] = []): ResumenTurno {
  const r: ResumenTurno = { tickets: 0, venta: 0, efectivo: 0, noEfectivo: {}, efectivoPorMoneda: {}, tasas: {}, porCajero: {}, pax: {}, tramos: tramosDe(desde, hasta, cortes).map((t) => ({ ...t, venta: 0, tickets: 0, pax: {} })) }
  const tasaAcum: Partial<Record<Moneda, { base: number; orig: number }>> = {}
  for (const o of ops) {
    if (o.OperType !== 2 && o.OperType !== 34) continue
    const h = String(o.DateIssued ?? o.Date).slice(0, 19)
    if (!(h > desde && h <= hasta)) continue
    const signo = o.OperType === 34 ? -1 : 1
    const tramo = r.tramos.find((t) => h > t.desde && h <= t.hasta)!
    r.tickets++
    tramo.tickets++
    if (!r.primera || h < r.primera) r.primera = h
    if (!r.ultima || h > r.ultima) r.ultima = h
    for (const l of o.Items ?? [])
      if (esPax(l)) {
        const k = (l.ItemName ?? 'PAX').toUpperCase()
        const q = signo * (Number(l.Qtty) || 0)
        r.pax[k] = (r.pax[k] ?? 0) + q
        tramo.pax[k] = (tramo.pax[k] ?? 0) + q
      }
    const cajero = usuarios.get(String(o.UserCode ?? '')) ?? String(o.UserCode ?? '¿?')
    const pagos: PagoTPV[] = o.Payments?.length ? o.Payments : [{ PaymentMethod: '1', AmountTotal: Number(o.AmountTotal) || 0 }]
    for (const p of pagos) {
      const base = signo * Math.abs(Number(p.AmountTotal ?? p.Amount) || 0)
      if (!base) continue
      r.venta += base
      tramo.venta += base
      r.porCajero[cajero] = (r.porCajero[cajero] ?? 0) + base
      if (String(p.PaymentMethod ?? '1') === '1') {
        r.efectivo += base
        const mon = (p.CurrencyName ?? '').toUpperCase()
        const rate = Number(p.CurrencyRate) || 0
        if (mon && mon !== 'CUP' && MONEDAS.has(mon) && rate > 0) {
          const m = mon as Moneda
          r.efectivoPorMoneda[m] = (r.efectivoPorMoneda[m] ?? 0) + base / rate
          const t = (tasaAcum[m] ??= { base: 0, orig: 0 })
          t.base += Math.abs(base)
          t.orig += Math.abs(base) / rate
        } else r.efectivoPorMoneda.CUP = (r.efectivoPorMoneda.CUP ?? 0) + base
      } else {
        const k = p.PaymentTypeName?.trim() || 'Otros cobros'
        r.noEfectivo[k] = (r.noEfectivo[k] ?? 0) + base
      }
    }
  }
  for (const [m, t] of Object.entries(tasaAcum) as [Moneda, { base: number; orig: number }][]) if (t.orig) r.tasas[m] = r2(t.base / t.orig)
  r.venta = r2(r.venta)
  r.efectivo = r2(r.efectivo)
  for (const t of r.tramos) t.venta = r2(t.venta)
  for (const k of Object.keys(r.noEfectivo)) r.noEfectivo[k] = r2(r.noEfectivo[k])
  for (const k of Object.keys(r.porCajero)) r.porCajero[k] = r2(r.porCajero[k])
  for (const k of Object.keys(r.efectivoPorMoneda) as Moneda[]) r.efectivoPorMoneda[k] = r2(r.efectivoPorMoneda[k]!)
  return r
}

/** Salario sugerido: porcentaje de la venta, redondeado hacia abajo a decenas (como en la hoja). */
export const salarioSugerido = (venta: number, pct: number) => Math.max(0, Math.floor((venta * pct) / 10) * 10)

export interface DatosCuadre {
  ventaTienda: number
  domicilio: number
  plataforma: number
  gastos: { concepto: string; importe: number; categoria?: string }[]
  salario: number
  transferencias: { cuenta: string; importe: number }[]
  porCobrar: number
  billetes: { valor: number; cantidad: number }[]
  sueltosCUP: number
  usd: number
  tasaUSD: number
  eur: number
  tasaEUR: number
  /** Otros importes en CUP contados aparte (vales…). */
  otros: number
  fondo?: number
}

export function calcularCuadre(d: DatosCuadre) {
  const subtotal = r2(d.ventaTienda + d.domicilio + d.plataforma)
  const gastos = r2(d.gastos.reduce((s, g) => s + g.importe, 0))
  const transferencias = r2(d.transferencias.reduce((s, t) => s + t.importe, 0))
  const esperado = r2(subtotal - transferencias - d.porCobrar - gastos)
  const billetesCUP = r2(d.billetes.reduce((s, b) => s + b.valor * b.cantidad, 0))
  const totalCUP = r2(billetesCUP + d.sueltosCUP)
  const usdCUP = r2(d.usd * d.tasaUSD)
  const eurCUP = r2(d.eur * d.tasaEUR)
  const contado = r2(totalCUP + usdCUP + eurCUP + d.otros)
  const aEntregar = r2(contado - (d.fondo ?? 0))
  return { subtotal, gastos, transferencias, esperado, billetesCUP, totalCUP, usdCUP, eurCUP, contado, diferencia: r2(contado - esperado), aEntregar }
}

/** Transferencias por cuenta a partir de la lista de ventas por tarjeta. */
export function porCuenta(tarjetas: { cuenta: string; importe: number }[]) {
  const m = new Map<string, number>()
  for (const t of tarjetas) if (t.importe) m.set(t.cuenta, r2((m.get(t.cuenta) ?? 0) + t.importe))
  return [...m].map(([cuenta, importe]) => ({ cuenta, importe }))
}

/** Check list de cambio de turno (hoja de la tienda). */
export const CHECKLIST: { rol: 'cajero' | 'dependiente' | 'seguridad' | 'general'; titulo: string; grupos: { titulo: string; items: { id: string; texto: string }[] }[] }[] = [
  {
    rol: 'cajero',
    titulo: '1. Cajero',
    grupos: [
      { titulo: 'Caja', items: [{ id: 'c_arqueo', texto: 'Realizar arqueo de caja.' }, { id: 'c_contar', texto: 'Contar el efectivo físico.' }, { id: 'c_sistema', texto: 'Verificar que el efectivo coincida con el sistema.' }, { id: 'c_fondo', texto: 'Entregar / recibir fondo de caja.' }] },
      { titulo: 'Axisoft', items: [{ id: 'c_borradores', texto: 'Verificar que no existan borradores pendientes.' }, { id: 'c_reportes', texto: 'Generar reportes de ventas.' }, { id: 'c_cerrado', texto: 'Confirmar que el turno quedó cerrado correctamente.' }] },
      { titulo: 'Reporte de turno', items: [{ id: 'c_whatsapp', texto: 'Publicar en el grupo de WhatsApp las estadísticas y cierre del turno.' }, { id: 'c_incidencias', texto: 'Informar incidencias del turno (sobrantes o faltantes de efectivo).' }] },
    ],
  },
  {
    rol: 'dependiente',
    titulo: '2. Dependiente',
    grupos: [
      { titulo: 'Piso de venta', items: [{ id: 'd_neveras', texto: 'Verificar que las neveras estén surtidas.' }, { id: 'd_piso', texto: 'Verificar que el piso de venta esté abastecido y ordenado.' }, { id: 'd_faltantes', texto: 'Informar faltantes de mercancía.' }] },
      { titulo: 'Control de inventario', items: [{ id: 'd_ipv', texto: 'Realizar conteo del IPV.' }, { id: 'd_diferencias', texto: 'Reportar diferencias encontradas.' }] },
      { titulo: 'Energía y equipos', items: [{ id: 'd_inversor', texto: 'Revisar carga del inversor.' }, { id: 'd_publicar', texto: 'Publicar en el grupo el porcentaje de carga recibido.' }, { id: 'd_ecoflow', texto: 'Verificar carga del EcoFlow (si aplica).' }, { id: 'd_equipos', texto: 'Comprobar funcionamiento de computadoras, escáner y demás equipos.' }] },
    ],
  },
  {
    rol: 'seguridad',
    titulo: '3. Seguridad',
    grupos: [
      { titulo: 'Seguridad y accesos', items: [{ id: 's_cierre', texto: 'Verificar cierre de puertas, rejas y candados.' }, { id: 's_luz', texto: 'Revisar iluminación interior y exterior del local.' }, { id: 's_ronda', texto: 'Realizar ronda de inspección del área (interior y perímetro).' }, { id: 's_incidencias', texto: 'Informar incidencias de seguridad ocurridas durante el turno.' }, { id: 's_plantas', texto: 'Regar las plantas (si aplica).' }] },
    ],
  },
  {
    rol: 'general',
    titulo: '4. Pendientes generales',
    grupos: [{ titulo: 'Entrega de pendientes (todos los responsables)', items: [{ id: 'g_tareas', texto: 'Informar tareas pendientes para el próximo turno.' }, { id: 'g_tecnicas', texto: 'Informar incidencias técnicas o de operación pendientes de solución.' }] }],
  },
]

export const ITEMS_CHECKLIST = CHECKLIST.flatMap((s) => s.grupos.flatMap((g) => g.items))

const n0 = (n: number) => Math.round(n).toLocaleString('es-ES').replace(/\./g, ' ')
const hora12 = (h: string) => {
  const x = Number(h.slice(11, 13))
  return `${x % 12 || 12}${x < 12 ? 'am' : 'pm'}`
}
const fechaCorta = (f: string) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}/${f.slice(0, 4)}`

/** Clientes del turno: los Pax del TPV más los que se anotan a mano (compra, museo). */
export function totalPax(pax: Record<string, number>, extra: { compra?: number; museo?: number } = {}) {
  return Object.values(pax).reduce((s, v) => s + v, 0) + (extra.compra ?? 0) + (extra.museo ?? 0)
}

/** Texto del cierre para el grupo de WhatsApp (formato de las tiendas). */
export function reporteWhatsApp(c: {
  tienda: string
  turno: 'dia' | 'noche'
  desde: string
  hasta: string
  cajero?: string
  venta: number
  pax: Record<string, number>
  paxCompra?: number
  paxMuseo?: number
  tramos: TramoTurno[]
  inversor?: number
  ecoflow?: number
  incidencias?: string[]
}) {
  const fecha = c.turno === 'noche' ? c.desde : c.hasta
  const paxDe = (p: Record<string, number>, k: string) => p[`PAX ${k}`] ?? 0
  const total = totalPax(c.pax, { compra: c.paxCompra, museo: c.paxMuseo })
  const l = [
    `*${c.tienda}* · Fecha: ${fechaCorta(fecha)} ${c.turno === 'noche' ? 'noche' : 'día'}`,
    '',
    `Venta total: ${n0(c.venta)}`,
    `Pax A: ${paxDe(c.pax, 'A')}`,
    `Pax B: ${paxDe(c.pax, 'B')}`,
    `Pax C: ${paxDe(c.pax, 'C')}`,
    `Pax Compra: ${c.paxCompra ?? 0}`,
    `Pax Museo: ${c.paxMuseo ?? 0}`,
    `Per cápita: ${total ? n0(c.venta / total) : '—'}`,
  ]
  if (c.tramos.length > 1)
    for (const t of c.tramos) l.push('', `De ${hora12(t.desde)} a ${hora12(t.hasta)}`, `Venta: ${n0(t.venta)}`, `Pax A: ${paxDe(t.pax, 'A')}`, `Pax B: ${paxDe(t.pax, 'B')}`, `Pax C: ${paxDe(t.pax, 'C')}`)
  l.push('', `Trabajador: ${c.cajero ?? '—'}`)
  if (c.inversor != null || c.ecoflow != null) l.push(`Carga: ${c.inversor != null ? `inversor ${c.inversor} %` : ''}${c.inversor != null && c.ecoflow != null ? ' · ' : ''}${c.ecoflow != null ? `EcoFlow ${c.ecoflow} %` : ''}`)
  if (c.incidencias?.length) l.push('', 'Incidencias:', ...c.incidencias.map((x) => `- ${x}`))
  return l.join('\n')
}
