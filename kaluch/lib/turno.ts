import type { OperacionTPV, PagoTPV } from './axispos'
import type { Moneda } from './types'

/**
 * Cuadre de cambio de turno (modelo «Cuadre diario» de las tiendas, 24 horas). Funciones puras.
 *
 * Efectivo esperado = venta en tienda + a domicilio + en plataforma − transferencias − por cobrar
 *                     − otros gastos − salario.
 * Efectivo contado  = billetes CUP + sueltos + USD × tasa + EUR × tasa + otros.
 */

/** Billetes CUP (incluye los de 2000 y 5000). */
export const BILLETES_CUP = [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 3, 1]

const r2 = (n: number) => Math.round(n * 100) / 100

/** Fecha y hora local de Cuba (como las da el TPV en DateIssued): AAAA-MM-DDTHH:mm:ss. */
export function horaCuba(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
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
  primera?: string
  ultima?: string
}

const MONEDAS = new Set(['CUP', 'USD', 'EUR', 'MLC'])

/** Ventas (2) y devoluciones (34) de una caja entre dos horas locales (desde excluida, hasta incluida). */
export function resumenTurno(ops: OperacionTPV[], desde: string, hasta: string, usuarios: Map<string, string> = new Map()): ResumenTurno {
  const r: ResumenTurno = { tickets: 0, venta: 0, efectivo: 0, noEfectivo: {}, efectivoPorMoneda: {}, tasas: {}, porCajero: {} }
  const tasaAcum: Partial<Record<Moneda, { base: number; orig: number }>> = {}
  for (const o of ops) {
    if (o.OperType !== 2 && o.OperType !== 34) continue
    const h = String(o.DateIssued ?? o.Date).slice(0, 19)
    if (!(h > desde && h <= hasta)) continue
    const signo = o.OperType === 34 ? -1 : 1
    r.tickets++
    if (!r.primera || h < r.primera) r.primera = h
    if (!r.ultima || h > r.ultima) r.ultima = h
    const cajero = usuarios.get(String(o.UserCode ?? '')) ?? String(o.UserCode ?? '¿?')
    const pagos: PagoTPV[] = o.Payments?.length ? o.Payments : [{ PaymentMethod: '1', AmountTotal: Number(o.AmountTotal) || 0 }]
    for (const p of pagos) {
      const base = signo * Math.abs(Number(p.AmountTotal ?? p.Amount) || 0)
      if (!base) continue
      r.venta += base
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
  /** Otros importes en CUP contados aparte (paquetes, vales…). */
  otros: number
}

export function calcularCuadre(d: DatosCuadre) {
  const subtotal = r2(d.ventaTienda + d.domicilio + d.plataforma)
  const gastos = r2(d.gastos.reduce((s, g) => s + g.importe, 0))
  const transferencias = r2(d.transferencias.reduce((s, t) => s + t.importe, 0))
  const esperado = r2(subtotal - transferencias - d.porCobrar - gastos - d.salario)
  const billetesCUP = r2(d.billetes.reduce((s, b) => s + b.valor * b.cantidad, 0))
  const totalCUP = r2(billetesCUP + d.sueltosCUP)
  const usdCUP = r2(d.usd * d.tasaUSD)
  const eurCUP = r2(d.eur * d.tasaEUR)
  const contado = r2(totalCUP + usdCUP + eurCUP + d.otros)
  return { subtotal, gastos, transferencias, esperado, billetesCUP, totalCUP, usdCUP, eurCUP, contado, diferencia: r2(contado - esperado) }
}
