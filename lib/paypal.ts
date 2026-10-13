import 'server-only'
import type { Tabla } from './extractos'

/**
 * Conexión con PayPal (Transaction Search API).
 * Variables: PAYPAL_CLIENT_ID, PAYPAL_SECRET y PAYPAL_ENV ('live' por defecto, o 'sandbox').
 * La app de PayPal necesita la función «Transaction search» activada (developer.paypal.com → la app → Features).
 *
 * Devuelve las transacciones con el mismo formato que el Excel de actividad de PayPal, de modo que pasan por la
 * misma revisión que un extracto: duplicados, importes distintos, categorías y conciliación con el saldo.
 */

const base = () => process.env.PAYPAL_API_URL || (process.env.PAYPAL_ENV === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com')

export const paypalConfigurado = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET)

/** Nombre en español de los códigos de evento más comunes. */
const EVENTOS: Record<string, string> = {
  T0000: 'Pago general',
  T0001: 'Pago masivo',
  T0002: 'Pago de suscripción',
  T0003: 'Pago con Pago de usuario de BillPay preaprobado',
  T0004: 'Pago de eBay',
  T0005: 'Pago directo con tarjeta',
  T0006: 'Pago con Pagos Exprés',
  T0007: 'Pago del carrito de compras',
  T0011: 'Pago móvil',
  T0013: 'Pago de donación',
  T0200: 'Conversión de divisas general',
  T0300: 'Depósito bancario a una cuenta de PayPal',
  T0400: 'Retiro general a cuenta bancaria',
  T0500: 'Transacción general de la tarjeta de débito de PayPal',
  T0600: 'Retiro general con tarjeta',
  T0700: 'Depósito general a tarjeta',
  T0800: 'Bonificación general',
  T0801: 'Bonificación en la tarjeta de débito de bonificaciones',
  T1000: 'Transacción de BillPay',
  T1100: 'Reversión general',
  T1105: 'Cancelación de la retención general de la cuenta',
  T1106: 'Reversión de pago',
  T1107: 'Reembolso de pago',
  T1108: 'Reversión de comisión',
  T1201: 'Contracargo',
  T1501: 'Retención de la cuenta para autorización abierta',
  T1503: 'Retención para disputa',
  T1700: 'Retiro general',
  T2000: 'Transferencia de fondos',
  T9900: 'Otros',
}

const ESTADOS: Record<string, string> = { S: 'Completado', P: 'Pendiente', D: 'Declinado', V: 'Revertido' }

let token: { valor: string; vence: number } | null = null

async function obtenerToken(): Promise<string> {
  if (token && token.vence > Date.now() + 60_000) return token.valor
  const id = process.env.PAYPAL_CLIENT_ID
  const secret = process.env.PAYPAL_SECRET
  if (!id || !secret) throw new Error('Faltan las credenciales de PayPal (PAYPAL_CLIENT_ID y PAYPAL_SECRET).')
  const r = await fetch(`${base()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  })
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string }
  if (!r.ok || !j.access_token)
    throw new Error(
      r.status === 401
        ? 'PayPal rechazó las credenciales. Comprueba que son las de «Live» (no Sandbox).'
        : `PayPal no dio acceso: ${j.error_description ?? r.status}`,
    )
  token = { valor: j.access_token, vence: Date.now() + (j.expires_in ?? 3000) * 1000 }
  return token.valor
}

async function get<T>(ruta: string): Promise<T> {
  const r = await fetch(`${base()}${ruta}`, { headers: { Authorization: `Bearer ${await obtenerToken()}` }, cache: 'no-store', signal: AbortSignal.timeout(30000) })
  const j = (await r.json().catch(() => ({}))) as T & { name?: string; message?: string }
  if (r.status === 403 || j.name === 'NOT_AUTHORIZED')
    throw new Error('La app de PayPal no tiene activada «Transaction search». Actívala en developer.paypal.com (puede tardar unas horas en surtir efecto).')
  if (!r.ok) throw new Error(`PayPal respondió ${r.status}: ${j.message ?? ''}`)
  return j
}

interface Importe {
  currency_code: string
  value: string
}
interface Transaccion {
  transaction_info: {
    transaction_id: string
    transaction_event_code: string
    transaction_initiation_date: string
    transaction_amount: Importe
    fee_amount?: Importe
    transaction_status: string
    transaction_subject?: string
    transaction_note?: string
    ending_balance?: Importe
    paypal_reference_id?: string
    invoice_id?: string
  }
  payer_info?: { email_address?: string; payer_name?: { alternate_full_name?: string; given_name?: string; surname?: string } }
  shipping_info?: { name?: string }
}

const iso = (d: string, fin = false) => `${d}T${fin ? '23:59:59' : '00:00:00'}-0000`

/** Trae las transacciones que mueven el saldo entre dos fechas (AAAA-MM-DD), en tramos de 31 días como exige PayPal. */
export async function transaccionesPayPal(desde: string, hasta: string): Promise<Tabla> {
  const encabezados = ['Fecha', 'Nombre', 'Tipo', 'Estado', 'Divisa', 'Bruto', 'Comisión', 'Neto', 'Id. de transacción', 'Saldo', 'Repercusiones en el saldo', 'Asunto', 'Correo electrónico', 'Código de evento']
  const filas: unknown[][] = []
  let saldoFinal: Tabla['saldoFinal']
  for (let ini = new Date(`${desde}T00:00:00Z`); ini.toISOString().slice(0, 10) <= hasta; ) {
    const fin = new Date(Math.min(ini.getTime() + 30 * 86400000, Date.parse(`${hasta}T00:00:00Z`)))
    const d0 = ini.toISOString().slice(0, 10)
    const d1 = fin.toISOString().slice(0, 10)
    for (let pagina = 1, total = 1; pagina <= total; pagina++) {
      const q = new URLSearchParams({
        start_date: iso(d0),
        end_date: iso(d1, true),
        fields: 'transaction_info,payer_info,shipping_info',
        balance_affecting_records_only: 'Y',
        page_size: '500',
        page: String(pagina),
      })
      const r = await get<{ transaction_details: Transaccion[]; total_pages?: number }>(`/v1/reporting/transactions?${q}`)
      total = r.total_pages ?? 1
      for (const t of r.transaction_details ?? []) {
        const i = t.transaction_info
        const bruto = Number(i.transaction_amount?.value ?? 0)
        const nombre =
          t.payer_info?.payer_name?.alternate_full_name ||
          [t.payer_info?.payer_name?.given_name, t.payer_info?.payer_name?.surname].filter(Boolean).join(' ') ||
          t.shipping_info?.name ||
          i.transaction_subject ||
          EVENTOS[i.transaction_event_code] ||
          i.transaction_event_code
        const fecha = i.transaction_initiation_date.slice(0, 10)
        filas.push([
          fecha,
          nombre,
          EVENTOS[i.transaction_event_code] ?? i.transaction_event_code,
          ESTADOS[i.transaction_status] ?? i.transaction_status,
          i.transaction_amount?.currency_code ?? 'USD',
          bruto,
          i.fee_amount ? Number(i.fee_amount.value) : 0,
          Math.round((bruto + (i.fee_amount ? Number(i.fee_amount.value) : 0)) * 100) / 100,
          i.transaction_id,
          i.ending_balance ? Number(i.ending_balance.value) : null,
          bruto < 0 ? 'Cargo' : 'Crédito',
          [i.transaction_subject, i.transaction_note].filter(Boolean).join(' · ') || null,
          t.payer_info?.email_address ?? null,
          i.transaction_event_code,
        ])
      }
    }
    ini = new Date(fin.getTime() + 86400000)
  }
  // Saldo real de la cuenta en USD al final del período.
  try {
    const b = await get<{ balances: { currency: string; total_balance: Importe }[]; as_of_time?: string }>(`/v1/reporting/balances?as_of_time=${encodeURIComponent(iso(hasta, true))}&currency_code=USD`)
    const usd = b.balances?.find((x) => x.currency === 'USD')
    if (usd) saldoFinal = { importe: Number(usd.total_balance.value), fecha: hasta }
  } catch {
    // Si el saldo no está disponible, la conciliación usa el de la última transacción.
  }
  filas.sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return { encabezados, filas, ...(saldoFinal ? { saldoFinal } : {}) }
}
