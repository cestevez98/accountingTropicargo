import 'server-only'
import { gunzipSync } from 'node:zlib'
import type { Compra, Salida, Tienda } from './types'

/**
 * Cliente de la API de sincronización de AxisPOS / Microinvest (documento «Integración con API
 * AxisPOS o Microinvest v1.2»). Autenticación JWT en /SyncApi/Auth; las respuestas pueden venir
 * comprimidas con GZIP.
 */

export const OPER_TYPE: Record<number, string> = {
  1: 'Compra',
  2: 'Venta',
  3: 'Merma',
  4: 'Ajuste de inventario',
  7: 'Transferencia (entrada)',
  8: 'Transferencia (salida)',
  11: 'Consumo interno',
  15: 'Consignación recibida',
  16: 'Venta de consignación',
  17: 'Devolución de consignación',
  24: 'Materia prima en producción',
  25: 'Producción',
  34: 'Devolución de venta',
  39: 'Devolución de compra',
}

export interface OperacionTPV {
  Acct?: number
  Date: string
  DateIssued?: string
  OperType: number
  ObjectCode?: string
  PartnerCode?: string | number
  UserCode?: string | number
  AmountTotal?: number
  AmountTotalIn?: number
  Note?: string
  InvoiceNumber?: string
  Items?: { ItemCode?: string; ItemName?: string; Qtty?: number; Discount?: number; Price?: number; PriceIn?: number; AmountTotal?: number }[]
  Payments?: { PaymentMethod?: string; PaymentTypeName?: string; Amount?: number }[]
}

async function leerJSON(r: Response): Promise<unknown> {
  const buf = Buffer.from(await r.arrayBuffer())
  // Si el servidor manda GZIP sin la cabecera Content-Encoding, se descomprime a mano.
  const datos = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf
  const txt = datos.toString('utf8')
  try {
    return JSON.parse(txt)
  } catch {
    throw new Error(`Respuesta no válida de AxisPOS (HTTP ${r.status}): ${txt.slice(0, 200)}`)
  }
}

export class ClienteAxis {
  private token?: string
  constructor(
    private base: string,
    private usuario: string,
    private password: string,
  ) {
    this.base = base.replace(/\/+$/, '')
  }

  private async post(ruta: string, cuerpo: unknown): Promise<unknown> {
    const r = await fetch(`${this.base}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'gzip', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(60_000),
    })
    if (r.status === 401) throw new Error('AxisPOS rechazó las credenciales (401).')
    if (!r.ok) throw new Error(`AxisPOS respondió HTTP ${r.status} en ${ruta}.`)
    return leerJSON(r)
  }

  async autenticar() {
    const j = (await this.post('/SyncApi/Auth', { User: this.usuario, Password: this.password })) as { Token?: string; token?: string }
    this.token = j.Token ?? j.token
    if (!this.token) throw new Error('AxisPOS no devolvió el token.')
  }

  /** Operaciones de un rango (fechas «AAAA-MM-DD HH:mm:ss»). */
  async exportarOperaciones(desde: string, hasta: string, objectCode: string, operTypes = '1,2,3,11,34,39') {
    if (!this.token) await this.autenticar()
    const j = (await this.post('/SyncApi/ExportOperations', { startDate: `${desde} 00:00:00`, endDate: `${hasta} 23:59:59`, objectCode, opertype: operTypes })) as { Operations?: OperacionTPV[] }
    return j.Operations ?? []
  }

  async disponibilidad(objectCodes: string) {
    if (!this.token) await this.autenticar()
    return this.post('/SyncApi/ExportAvailable', { objectCodes, catalog: '' })
  }
}

/**
 * Convierte las operaciones del TPV en salidas (ventas, mermas, consumo, devoluciones) y compras.
 * Los importes del TPV están en CUP; el costo (PriceIn) también, y se pasa a USD con la tasa del día.
 */
export function mapearOperaciones(ops: OperacionTPV[], tiendas: Tienda[], tasaDia: (fecha: string) => number) {
  const salidas: Salida[] = []
  const compras: Compra[] = []
  const porCodigo = new Map(tiendas.filter((t) => t.codigoTPV).map((t) => [String(t.codigoTPV), t.id]))
  let sinTienda = 0
  for (const o of ops) {
    const tienda = porCodigo.get(String(o.ObjectCode ?? ''))
    if (!tienda) {
      sinTienda++
      continue
    }
    const fecha = String(o.Date).slice(0, 10)
    const tasa = tasaDia(fecha)
    const op = String(o.Acct ?? '')
    for (const it of o.Items ?? []) {
      const q = Number(it.Qtty) || 0
      const costoUSD = tasa > 0 ? ((Number(it.PriceIn) || 0) * q) / tasa : undefined
      const base = { id: '', fecha, tienda, operacion: op, producto: it.ItemName || it.ItemCode, cantidad: q, origen: 'tpv' as const }
      switch (o.OperType) {
        case 2:
          salidas.push({ ...base, tipo: 'venta', importe: Number(it.AmountTotal) || q * (Number(it.Price) || 0), moneda: 'CUP', costoUSD, pago: o.Payments?.[0]?.PaymentTypeName })
          break
        case 34:
          salidas.push({ ...base, tipo: 'devolucion', importe: Number(it.AmountTotal) || q * (Number(it.Price) || 0), moneda: 'CUP', costoUSD })
          break
        case 3:
          salidas.push({ ...base, tipo: 'merma', costoUSD })
          break
        case 11:
          salidas.push({ ...base, tipo: 'consumo', costoUSD })
          break
        case 1:
        case 39: {
          const signo = o.OperType === 39 ? -1 : 1
          const importe = signo * (Number(it.PriceIn) || 0) * q
          compras.push({ id: '', fecha, tienda, producto: base.producto, cantidad: signo * q, factura: o.InvoiceNumber || undefined, proveedor: o.PartnerCode != null ? String(o.PartnerCode) : undefined, moneda: 'CUP', importe, ...(tasa > 0 ? { importeUSD: importe / tasa, tasa } : {}), pago: 'contado', fiscal: false, origen: 'tpv' })
          break
        }
      }
    }
  }
  return { salidas, compras, sinTienda }
}
