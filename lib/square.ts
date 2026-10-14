import 'server-only'
import type { Tabla } from './extractos'

/**
 * Conexión con Square (solo lectura: pagos y reembolsos). Variable: SQUARE_ACCESS_TOKEN.
 *
 * Devuelve un extracto de la cuenta «Square» con el formato del preset «Square (API)»: cada cobro por su importe
 * bruto (con la factura que cita la nota), su comisión en una línea aparte y los reembolsos. Las transferencias del
 * saldo de Square al banco se añaden aparte (las ve el extracto del banco, no la API).
 */

const BASE = process.env.SQUARE_API_URL || 'https://connect.squareup.com'
export const squareConfigurado = () => Boolean(process.env.SQUARE_ACCESS_TOKEN)

export const ENCABEZADOS_SQUARE = ['Fecha', 'Concepto', 'Detalle', 'Importe', 'Moneda', 'Id. Square']

interface Dinero {
  amount: number
  currency: string
}
interface Pago {
  id: string
  created_at: string
  status: string
  total_money: Dinero
  processing_fee?: { amount_money: Dinero }[]
  note?: string
  buyer_email_address?: string
  card_details?: { card?: { card_brand?: string; last_4?: string } }
  source_type?: string
}
interface Reembolso {
  id: string
  created_at: string
  status: string
  amount_money: Dinero
  payment_id: string
  reason?: string
  processing_fee?: { amount_money: Dinero }[]
}

async function* paginas<T>(ruta: string, clave: string): AsyncGenerator<T[]> {
  const token = process.env.SQUARE_ACCESS_TOKEN
  if (!token) throw new Error('Falta el token de Square (SQUARE_ACCESS_TOKEN).')
  let cursor: string | undefined
  for (let i = 0; i < 200; i++) {
    const r = await fetch(`${BASE}${ruta}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, {
      headers: { Authorization: `Bearer ${token}`, 'Square-Version': '2025-01-23' },
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    })
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { cursor?: string; errors?: { detail?: string; code?: string }[] }
    if (r.status === 401) throw new Error('Square rechazó el token. Comprueba que es el «Access token» de producción.')
    if (!r.ok) throw new Error(`Square respondió ${r.status}: ${j.errors?.[0]?.detail ?? j.errors?.[0]?.code ?? ''}`)
    yield (j[clave] as T[]) ?? []
    cursor = j.cursor
    if (!cursor) break
  }
}

const dia = (iso: string) => new Date(Date.parse(iso) - 4 * 3600000).toISOString().slice(0, 10) // hora de Miami
const usd = (d?: Dinero) => (d ? d.amount / 100 : 0)
const refs = (t?: string) => [...new Set((t ?? '').toUpperCase().match(/\bINV\d+\b|\bKGT\d+\b|\bMU?L?TIPAYMENT-\d+\b/g) ?? [])]

export async function transaccionesSquare(desde: string, hasta: string): Promise<Tabla> {
  // Un día de margen: Square trabaja en UTC y el día contable es el de Miami.
  const q = `begin_time=${desde}T00:00:00Z&end_time=${new Date(Date.parse(`${hasta}T00:00:00Z`) + 2 * 86400000).toISOString()}&limit=100`
  const filas: unknown[][] = []
  for await (const pagos of paginas<Pago>(`/v2/payments?${q}`, 'payments')) {
    for (const p of pagos) {
      const f = dia(p.created_at)
      if (p.status !== 'COMPLETED' || f < desde || f > hasta) continue
      const tarjeta = p.card_details?.card ? `${p.card_details.card.card_brand ?? 'tarjeta'} ${p.card_details.card.last_4 ?? ''}`.trim() : p.source_type
      const r = refs(p.note)
      const quien = [p.buyer_email_address, tarjeta].filter(Boolean).join(' · ')
      // Sin nota no se sabe si es una factura de Tracking Premium u otro negocio (pasajes, remesas…): queda por clasificar.
      const tipo = p.note?.trim() ? 'Pago Square' : 'Venta Square sin nota'
      filas.push([f, `${r.length ? `${r.join(', ')} ` : ''}${tipo}${quien ? ` · ${quien}` : ''}`, p.note ?? '', usd(p.total_money), p.total_money.currency, p.id])
      const fee = (p.processing_fee ?? []).reduce((a, x) => a + usd(x.amount_money), 0)
      if (fee) filas.push([f, `Comisión Square ${r.join(', ')}`.trim(), `Pago ${p.id}`, -Math.round(fee * 100) / 100, p.total_money.currency, `${p.id}-fee`])
    }
  }
  for await (const lista of paginas<Reembolso>(`/v2/refunds?${q}`, 'refunds')) {
    for (const x of lista) {
      const f = dia(x.created_at)
      if (x.status !== 'COMPLETED' || f < desde || f > hasta) continue
      filas.push([f, `Reembolso Square${x.reason ? ` · ${x.reason}` : ''}`, `Pago ${x.payment_id}`, -usd(x.amount_money), x.amount_money.currency, x.id])
      const fee = (x.processing_fee ?? []).reduce((a, y) => a + usd(y.amount_money), 0)
      if (fee) filas.push([f, 'Comisión Square devuelta', `Reembolso ${x.id}`, Math.round(-fee * 100) / 100, x.amount_money.currency, `${x.id}-fee`])
    }
  }
  filas.sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return { encabezados: ENCABEZADOS_SQUARE, filas }
}

