import 'server-only'
import { gunzipSync } from 'node:zlib'
import type { Compra, Moneda, Movimiento, Salida, Tienda } from './types'

/**
 * Cliente del SyncApi de AxisPOS / AxisCloud («API de integración», v2.1 del 28-sep-2026,
 * https://doc.axissoft.cloud/api/). Dirección: https://<cliente>.axissoft.cloud/SyncApi/<Acción>.
 *
 * Lo que la documentación obliga a respetar y se hace aquí:
 * - El token (24 h) se pide una vez y se reutiliza: Auth tiene tope de 60/min y cerrojo de 10 fallos.
 * - El campo del token es `token` en minúscula; un 429 trae `Retry-After`.
 * - Las respuestas pueden venir en GZIP sin cabecera: se «huelen» los dos primeros bytes (1f 8b).
 * - Un 200 no basta: se mira `status`/`Status` sin distinguir mayúsculas.
 * - ExportOperations lleva tres marcas de agua (operaciones, cobros, caja) y `opertypes`.
 * - ExportAvailable es GET con el JSON en el parámetro `data`.
 */

export const OPER_TYPE: Record<number, string> = {
  1: 'Compra',
  2: 'Venta',
  3: 'Merma',
  4: 'Inventario / ajuste',
  5: 'Producción (entrada)',
  6: 'Producción (salida)',
  7: 'Traslado (entrada)',
  8: 'Traslado (salida)',
  11: 'Consumo interno',
  15: 'Consignación recibida',
  16: 'Venta de consignación',
  17: 'Devolución de consignación',
  24: 'Materia prima en producción',
  25: 'Producción',
  33: 'Orden de restaurante',
  34: 'Devolución de venta',
  39: 'Devolución de compra',
  71: 'Entrada de dinero',
  72: 'Salida de dinero',
  73: 'Entrada de dinero en banco',
  74: 'Salida de dinero en banco',
  101: 'Factura',
}

/** Tipos que el sistema contabiliza hoy. */
export const OPER_TYPES_SYNC = [1, 2, 3, 11, 34, 39]

/** Tipos de caja de CashbookSyncs.OperType (anexo de la API). */
export const CAJA_TIPO: Record<number, { label: string; entrada: boolean; categoria: string }> = {
  1: { label: 'Gasto: compra', entrada: false, categoria: 'MERCANCIA' },
  2: { label: 'Gasto: material gastable', entrada: false, categoria: 'MATERIALES DE OFICINA' },
  3: { label: 'Gasto: salario', entrada: false, categoria: 'SALARIO DEPENDIENTE' },
  4: { label: 'Gasto: alquiler', entrada: false, categoria: 'OTROS GASTOS' },
  5: { label: 'Gasto: otros', entrada: false, categoria: 'OTROS GASTOS' },
  6: { label: 'Sin definir', entrada: false, categoria: 'POR CLASIFICAR' },
  7: { label: 'Ingreso: otros', entrada: true, categoria: 'POR CLASIFICAR' },
  8: { label: 'Ingreso: venta', entrada: true, categoria: 'VENTAS' },
  9: { label: 'Gasto: combustible', entrada: false, categoria: 'TRANSPORTE' },
  10: { label: 'Ingreso: anticipo', entrada: true, categoria: 'COBRO ANTICIPADO' },
}

export interface PagoTPV {
  PaymentMethod?: string | number
  PaymentTypeName?: string
  AmountTotal?: number
  Amount?: number
  CurrencyName?: string
  CurrencyRate?: number
}

export interface OperacionTPV {
  Acct?: number | string
  Date: string
  DateIssued?: string
  OperType: number
  ObjectCode?: string
  PartnerCode?: string | number
  UserCode?: string | number
  AmountTotal?: number
  Note?: string
  InvoiceNumber?: string
  TransferObjectCode?: string
  Items?: { ItemCode?: string; ItemName?: string; Category?: string; Qtty?: number; Discount?: number; Price?: number; PriceIn?: number; AmountTotal?: number }[]
  Payments?: PagoTPV[]
}

/** Asiento de caja que no viene de una operación. Los nombres de campo se leen con tolerancia. */
export type CajaTPV = Record<string, unknown>

export interface Marcas {
  op: number
  pago: number
  caja: number
}

export class ErrorAxis extends Error {
  constructor(
    mensaje: string,
    public status?: number,
  ) {
    super(mensaje)
  }
}

function decodificar(buf: Buffer): string {
  // Se huelen los dos primeros bytes: la tabla de compresión de la API no es uniforme.
  return (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8')
}

/** Comprueba el estado del cuerpo (`status` u `Status`, en cualquier caja). */
function comprobarEstado(j: unknown, ruta: string) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return
  const o = j as Record<string, unknown>
  const k = Object.keys(o).find((x) => x.toLowerCase() === 'status')
  if (!k) return
  const v = String(o[k]).toLowerCase()
  if (v !== 'ok') {
    const m = Object.keys(o).find((x) => x.toLowerCase() === 'message')
    throw new ErrorAxis(`AxisPOS rechazó ${ruta}: ${m ? String(o[m]) : v}`)
  }
}

// Token por instancia (dura 24 h; se renueva a las 12 h para no caducar a mitad de un lote).
const tokens = new Map<string, { token: string; hasta: number }>()

export class ClienteAxis {
  constructor(
    private base: string,
    private usuario: string,
    private password: string,
  ) {
    this.base = base.replace(/\/+$/, '').replace(/\/SyncApi$/i, '')
  }

  private get clave() {
    return `${this.base}|${this.usuario}`
  }

  private async pedir(ruta: string, init: { method: 'GET' | 'POST'; cuerpo?: unknown; query?: string; conToken?: boolean }): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Encoding': 'gzip' }
    if (init.conToken !== false) headers.Authorization = `Bearer ${await this.token()}`
    if (init.cuerpo !== undefined) headers['Content-Type'] = 'application/json'
    let r: Response
    try {
      r = await fetch(`${this.base}/SyncApi/${ruta}${init.query ?? ''}`, {
        method: init.method,
        headers,
        body: init.cuerpo !== undefined ? JSON.stringify(init.cuerpo) : undefined,
        signal: AbortSignal.timeout(90_000),
      })
    } catch (e) {
      const causa = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e)
      throw new ErrorAxis(`No se pudo conectar con ${this.base} (${causa}). Los tenants solo aceptan TLS 1.3.`)
    }
    const texto = decodificar(Buffer.from(await r.arrayBuffer()))
    if (r.status === 401) {
      tokens.delete(this.clave)
      throw new ErrorAxis(init.conToken === false ? 'Usuario o contraseña de AxisPOS incorrectos (401).' : 'AxisPOS rechazó el token (401).', 401)
    }
    if (r.status === 403) throw new ErrorAxis(`El token no tiene permiso para ${ruta} (403): el usuario debe tener ámbito completo.`, 403)
    if (r.status === 404) throw new ErrorAxis(`La central no conoce ${ruta} (404): es anterior a esa función.`, 404)
    if (r.status === 429) throw new ErrorAxis(`AxisPOS pide esperar ${r.headers.get('retry-after') ?? 'unos'} segundos (429: demasiados intentos).`, 429)
    if (!r.ok) throw new ErrorAxis(`AxisPOS respondió HTTP ${r.status} en ${ruta}: ${texto.slice(0, 200)}`, r.status)
    if (!texto.trim()) return null
    let j: unknown
    try {
      j = JSON.parse(texto)
    } catch {
      throw new ErrorAxis(`Respuesta no válida de AxisPOS en ${ruta}: ${texto.slice(0, 200)}`)
    }
    comprobarEstado(j, ruta)
    return j
  }

  async token(): Promise<string> {
    const t = tokens.get(this.clave)
    if (t && t.hasta > Date.now()) return t.token
    const j = (await this.pedir('Auth', { method: 'POST', cuerpo: { User: this.usuario, Password: this.password, Scope: '' }, conToken: false })) as { token?: string; Token?: string } | null
    const token = j?.token ?? j?.Token
    if (!token) throw new ErrorAxis('AxisPOS no devolvió el token.')
    tokens.set(this.clave, { token, hasta: Date.now() + 12 * 3600_000 })
    return token
  }

  /** Sondeo de vida: confirma que el tenant responde y que el token vale. */
  async comprobar() {
    return this.pedir('CheckConnection', { method: 'GET' })
  }

  /** Ubicaciones (áreas/almacenes) del tenant: su Code es el ObjectCode de las operaciones. */
  async ubicaciones(): Promise<{ Code: string; Name: string; Type?: number; CurrencyName?: string; Group?: string; DeletedDb?: number }[]> {
    const j = (await this.pedir('ImportExportLocations', { method: 'POST', cuerpo: { data: [] } })) as { data?: [] } | null
    return j?.data ?? []
  }

  /** Catálogo completo de mercancías. */
  async mercancias(): Promise<{ Code: string; Name: string; Category?: string; Unit?: string; Cost?: number; Price?: number; Currency?: string }[]> {
    const j = (await this.pedir('ImportExportItems', { method: 'POST', cuerpo: { data: [], groups: [] } })) as { data?: [] } | null
    return j?.data ?? []
  }

  /**
   * Operaciones de un área. Con marcas de agua (≥ 0) la central ignora las fechas y devuelve lo
   * posterior a cada marca; sin ellas, el rango de fechas.
   */
  async exportarOperaciones(objectCode: string, opt: { desde?: string; hasta?: string; marcas?: Marcas; operTypes?: number[] }) {
    const cuerpo: Record<string, unknown> = {
      startDate: `${opt.desde ?? '2000-01-01'} 00:00:00`,
      endDate: `${opt.hasta ?? '2100-12-31'} 23:59:59`,
      objectCode,
      opertypes: (opt.operTypes ?? OPER_TYPES_SYNC).join(','),
      cobrosSueltos: false,
      acctsToResend: [],
    }
    if (opt.marcas) Object.assign(cuerpo, { idOperationFrom: opt.marcas.op, idPaymentFrom: opt.marcas.pago, idCashbookFrom: opt.marcas.caja })
    else Object.assign(cuerpo, { idOperationFrom: -1, idPaymentFrom: -1, idCashbookFrom: -1 })
    const j = (await this.pedir('ExportOperations', { method: 'POST', cuerpo })) as {
      Operations?: OperacionTPV[]
      CashbookSyncs?: CajaTPV[]
      LastOperationsId?: number
      LastPaymentId?: number
      LastCashbookId?: number
    } | null
    return {
      operaciones: j?.Operations ?? [],
      caja: j?.CashbookSyncs ?? [],
      marcas: { op: j?.LastOperationsId ?? opt.marcas?.op ?? 0, pago: j?.LastPaymentId ?? opt.marcas?.pago ?? 0, caja: j?.LastCashbookId ?? opt.marcas?.caja ?? 0 } as Marcas,
    }
  }

  /** Existencias por área (GET con el JSON en `data`, respuesta en GZIP). */
  async existencias(objectCodes: string[]) {
    const data = encodeURIComponent(JSON.stringify({ objectCodes: objectCodes.join(','), catalog: '' }))
    const j = (await this.pedir('ExportAvailable', { method: 'GET', query: `?data=${data}` })) as { LocationItemAvailabilities?: { objectCode: string; ItemsAvailability: { Code: string; Amount: number }[] }[] } | null
    return j?.LocationItemAvailabilities ?? []
  }
}

const numero = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN)
const campo = (o: Record<string, unknown>, ...nombres: string[]) => {
  for (const n of nombres) {
    const k = Object.keys(o).find((x) => x.toLowerCase() === n.toLowerCase())
    if (k && o[k] != null && o[k] !== '') return o[k]
  }
  return undefined
}
const MONEDAS = new Set(['CUP', 'USD', 'EUR', 'MLC'])

/** Moneda e importe original de un cobro: AmountTotal va en moneda base (CUP) y CurrencyRate es la tasa de entonces. */
function importeCobro(p: PagoTPV): { moneda: Moneda; monto: number } {
  const base = numero(p.AmountTotal ?? p.Amount) || 0
  const mon = (p.CurrencyName ?? '').toUpperCase()
  const rate = numero(p.CurrencyRate)
  if (mon && mon !== 'CUP' && MONEDAS.has(mon) && rate > 0) return { moneda: mon as Moneda, monto: Math.round((base / rate) * 100) / 100 }
  return { moneda: 'CUP', monto: base }
}

/**
 * Convierte lo exportado por el TPV en datos contables:
 * - Ventas (2), devoluciones (34), mermas (3), consumo interno (11) → salidas de inventario.
 * - Compras (1) y devoluciones de compra (39) → compras.
 * - Con `cobros`, cada cobro de venta entra en caja (efectivo) o banco (transferencia/tarjeta) como VENTAS.
 * - Los CashbookSyncs → movimientos de caja con la categoría de su tipo.
 * Los importes del TPV van en CUP; el costo (PriceIn) se pasa a USD con la tasa Toque del día.
 */
export function mapearOperaciones(
  ops: OperacionTPV[],
  caja: CajaTPV[],
  tiendas: Tienda[],
  tasaDia: (fecha: string) => number,
  opt: { cobros: boolean; cuentaBanco?: string } = { cobros: false },
) {
  const salidas: Salida[] = []
  const compras: Compra[] = []
  const movimientos: Movimiento[] = []
  const porCodigo = new Map(tiendas.filter((t) => t.codigoTPV).map((t) => [String(t.codigoTPV), t.id]))
  const ignorados = new Map<string, number>()
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
    if (![1, 2, 3, 11, 34, 39].includes(o.OperType)) {
      const k = OPER_TYPE[o.OperType] ?? `tipo ${o.OperType}`
      ignorados.set(k, (ignorados.get(k) ?? 0) + 1)
      continue
    }
    for (const it of o.Items ?? []) {
      const q = Number(it.Qtty) || 0
      const costoUSD = tasa > 0 ? ((Number(it.PriceIn) || 0) * q) / tasa : undefined
      const importe = Number(it.AmountTotal) || q * (Number(it.Price) || 0) * (1 - (Number(it.Discount) || 0) / 100)
      const base = { id: '', fecha, tienda, operacion: op, producto: it.ItemName || it.ItemCode, cantidad: q, origen: 'tpv' as const }
      if (o.OperType === 2) salidas.push({ ...base, tipo: 'venta', importe, moneda: 'CUP', costoUSD, pago: o.Payments?.[0]?.PaymentTypeName })
      else if (o.OperType === 34) salidas.push({ ...base, tipo: 'devolucion', importe, moneda: 'CUP', costoUSD })
      else if (o.OperType === 3) salidas.push({ ...base, tipo: 'merma', costoUSD })
      else if (o.OperType === 11) salidas.push({ ...base, tipo: 'consumo', costoUSD })
      else {
        const signo = o.OperType === 39 ? -1 : 1
        const total = signo * (Number(it.PriceIn) || 0) * q
        compras.push({
          id: '',
          fecha,
          tienda,
          producto: base.producto,
          cantidad: signo * q,
          factura: o.InvoiceNumber || `TPV ${op}`,
          proveedor: o.PartnerCode != null ? String(o.PartnerCode) : undefined,
          moneda: 'CUP',
          importe: total,
          ...(tasa > 0 ? { importeUSD: total / tasa, tasa } : {}),
          pago: 'contado',
          fiscal: false,
          origen: 'tpv',
        })
      }
    }
    // El cobro de la venta: efectivo a la caja de la tienda, el resto al banco.
    if (opt.cobros && (o.OperType === 2 || o.OperType === 34)) {
      for (const p of o.Payments ?? []) {
        const { moneda, monto } = importeCobro(p)
        if (!monto) continue
        const efectivo = String(p.PaymentMethod ?? '1') === '1'
        const entrada = (o.OperType === 2) === monto > 0
        movimientos.push({
          id: '',
          libro: efectivo ? 'caja' : 'banco',
          fecha,
          tienda,
          ...(efectivo ? {} : { cuenta: opt.cuentaBanco || 'FISCAL', fiscal: true }),
          categoria: 'VENTAS',
          concepto: `Cobro TPV op. ${op}${p.PaymentTypeName ? ` · ${p.PaymentTypeName}` : ''}`,
          tipo: entrada ? 'Entrada' : 'Salida',
          moneda,
          monto: Math.abs(monto),
          origen: 'tpv',
        })
      }
    }
  }
  for (const c of caja) {
    const tienda = porCodigo.get(String(campo(c, 'ObjectCode') ?? ''))
    if (!tienda) {
      sinTienda++
      continue
    }
    const tipo = CAJA_TIPO[numero(campo(c, 'OperType', 'Type'))] ?? CAJA_TIPO[6]
    const fecha = String(campo(c, 'Date', 'DateIssued', 'DateTime') ?? '').slice(0, 10)
    const base = numero(campo(c, 'AmountTotal', 'Amount', 'Sum'))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !base) continue
    const mon = String(campo(c, 'CurrencyName') ?? '').toUpperCase()
    const rate = numero(campo(c, 'CurrencyRate'))
    const extranjera = mon && mon !== 'CUP' && MONEDAS.has(mon) && rate > 0
    movimientos.push({
      id: '',
      libro: 'caja',
      fecha,
      tienda,
      cajero: campo(c, 'UserCode') != null ? String(campo(c, 'UserCode')) : undefined,
      categoria: tipo.categoria,
      concepto: [tipo.label, campo(c, 'SubTypeName'), campo(c, 'Note')].filter(Boolean).join(' · '),
      tipo: tipo.entrada === base > 0 ? 'Entrada' : 'Salida',
      moneda: extranjera ? (mon as Moneda) : 'CUP',
      monto: Math.abs(extranjera ? Math.round((base / rate) * 100) / 100 : base),
      origen: 'tpv',
    })
  }
  return { salidas, compras, movimientos, sinTienda, ignorados }
}
