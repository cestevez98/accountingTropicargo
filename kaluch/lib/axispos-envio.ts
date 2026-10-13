import { prepararTasas, tasaTiendaVenta, tasaVigente, type TablaTasas } from './fx'
import type { OperacionTPV } from './axispos'
import type { Compra, Dataset, EnvioAxis, Producto, Salida, Tienda } from './types'

/**
 * Lo que este sistema sube a AxisPOS: la tasa de la tienda y las compras del Almacén Central con
 * sus traslados a los mercados. Funciones puras (sin red) para poder probarlas.
 */

export const SERIE_INICIAL = 900001

/** Nota que identifica en AxisPOS lo subido desde aquí (sirve para no volver a importarlo). */
export const notaKA = (id: string) => `KA:${id}`

/** Monedas con la tasa de la tienda (Toque + margen) en ExchangeRate; el resto de campos se conserva tal cual. */
export function monedasConTasa(monedas: Record<string, unknown>[], tabla: TablaTasas, fecha: string) {
  const t = tasaVigente(tabla, fecha)
  if (!t) throw new Error(`No hay tasa registrada para ${fecha}.`)
  const nuevas: Record<string, number> = { USD: tasaTiendaVenta(tabla, fecha) }
  if (t.cupEur) nuevas.EUR = t.cupEur + tabla.margen
  if (t.cupMlc) nuevas.MLC = t.cupMlc + tabla.margen
  const cambios: { moneda: string; antes: number; despues: number }[] = []
  const data = monedas
    .filter((m) => typeof m.Name === 'string' && nuevas[(m.Name as string).toUpperCase()] != null)
    .map((m) => {
      const despues = Math.round(nuevas[(m.Name as string).toUpperCase()] * 100) / 100
      cambios.push({ moneda: m.Name as string, antes: Number(m.ExchangeRate), despues })
      return { ...m, ExchangeRate: despues }
    })
  if (!data.length) throw new Error('El TPV no tiene USD/EUR/MLC dados de alta.')
  return { data, cambios, fechaTasa: t.fecha }
}

/** Área de almacén de una tienda (tipo 3 en el tenant de Kaluch; si no se sabe, la primera). */
export function areaAlmacen(t: Tienda | undefined, ubic: { code: string; tipo?: number; nombre: string }[] = []) {
  const codigos = (t?.codigoTPV ?? '').split(',').map((c) => c.trim()).filter(Boolean)
  const tipo = new Map(ubic.map((u) => [u.code, u]))
  return codigos.find((c) => tipo.get(c)?.tipo === 3 || /ALMAC/i.test(tipo.get(c)?.nombre ?? '')) ?? codigos[0]
}

interface Contexto {
  areaCentral: string
  usuario: string
  productos: Map<string, Producto>
  tabla: TablaTasas
}

function cupDe(usd: number, tasa: number | undefined, tabla: TablaTasas, fecha: string) {
  const r = tasa || tasaVigente(tabla, fecha)?.cupUsd
  if (!r) throw new Error(`Sin tasa para pasar ${fecha} a CUP.`)
  return usd * r
}

function codigoDe(nombre: string | undefined, codigo: string | undefined, productos: Map<string, Producto>) {
  const p = nombre ? productos.get(nombre) : undefined
  const c = codigo || (p && p.codigo !== p.nombre ? p.codigo : undefined)
  if (!c) throw new Error(`«${nombre ?? '(sin producto)'}» no tiene código de AxisPOS: elígelo del catálogo del TPV.`)
  return { codigo: c, precio: p?.precioCUP }
}

/** Compra del Almacén Central como operación 1 del SyncApi. Los importes van en CUP (moneda base del TPV). */
export function operacionCompra(c: Compra, acct: number, ctx: Contexto): OperacionTPV {
  if (!c.cantidad || c.cantidad <= 0) throw new Error('La compra necesita cantidad para subirla al TPV.')
  if (!c.codigoProveedor) throw new Error('Elige el proveedor de AxisPOS.')
  const { codigo, precio } = codigoDe(c.producto, c.codigoProducto, ctx.productos)
  const totalCUP = Math.round((c.moneda === 'CUP' ? c.importe : cupDe(c.importeUSD ?? 0, c.tasa, ctx.tabla, c.fecha)) * 100) / 100
  const unit = Math.round((totalCUP / c.cantidad) * 1000) / 1000
  const pv = precio && precio > 0 ? precio : unit
  return {
    Acct: acct,
    Date: c.fecha,
    DateIssued: `${c.fecha}T12:00:00`,
    OperType: 1,
    ObjectCode: ctx.areaCentral,
    PartnerCode: c.codigoProveedor,
    UserCode: ctx.usuario,
    AmountTotal: Math.round(pv * c.cantidad * 100) / 100,
    Note: notaKA(c.id),
    InvoiceNumber: c.factura ?? '',
    Items: [{ ItemCode: codigo, ItemName: c.producto, Qtty: c.cantidad, Discount: 0, Price: pv, PriceIn: unit, AmountTotal: Math.round(pv * c.cantidad * 100) / 100 }],
    // Al contado se paga desde la caja central; a crédito o en el exterior no lleva cobro.
    Payments: c.pago === 'contado' ? [{ PaymentMethod: '1', PaymentTypeName: 'Pago en efectivo', AmountTotal: totalCUP, CurrencyName: 'CUP', CurrencyRate: 1 }] : [],
  }
}

/** Traslado del Almacén Central al almacén de un mercado (operación 8). */
export function operacionTraslado(s: Salida, acct: number, destinoArea: string, ctx: Contexto): OperacionTPV {
  if (!s.cantidad || s.cantidad <= 0) throw new Error('El traslado necesita cantidad.')
  const { codigo, precio } = codigoDe(s.producto, s.codigoProducto, ctx.productos)
  const costoCUP = cupDe(s.costoUSD ?? 0, undefined, ctx.tabla, s.fecha)
  const unit = Math.round((costoCUP / s.cantidad) * 1000) / 1000
  const pv = precio && precio > 0 ? precio : unit
  return {
    Acct: acct,
    Date: s.fecha,
    DateIssued: `${s.fecha}T12:00:00`,
    OperType: 8,
    ObjectCode: ctx.areaCentral,
    TransferObjectCode: destinoArea,
    UserCode: ctx.usuario,
    AmountTotal: Math.round(pv * s.cantidad * 100) / 100,
    Note: notaKA(s.id),
    Items: [{ ItemCode: codigo, ItemName: s.producto, Qtty: s.cantidad, Discount: 0, Price: pv, PriceIn: unit, AmountTotal: Math.round(pv * s.cantidad * 100) / 100 }],
    Payments: [],
  }
}

export interface DocumentoEnvio {
  id: string
  tipo: 'compra' | 'traslado'
  op?: OperacionTPV
  error?: string
}

/**
 * Lo que se subiría al TPV para una compra del Almacén Central: la compra (operación 1) y los traslados
 * de su distribución (operación 8). No toca la red: lo usan el ensayo y el envío.
 * Los números de documento son provisionales (serie propia desde `acct`).
 */
export function prepararEnvioCompra(ds: Pick<Dataset, 'compras' | 'salidas' | 'tiendas' | 'productos' | 'tasas' | 'settings'>, id: string, acct = ds.settings.axispos?.siguienteAcct ?? SERIE_INICIAL) {
  const cfg = ds.settings.axispos
  const compra = ds.compras.find((c) => c.id === id)
  if (!compra) throw new Error('La compra ya no existe.')
  if (compra.tienda !== 'almacen') throw new Error('Solo se suben al TPV las compras del Almacén Central.')
  const areaCentral = areaAlmacen(ds.tiendas.find((t) => t.id === 'almacen'), cfg?.ubicaciones)
  if (!areaCentral) throw new Error('El Almacén Central no tiene asignada su área del TPV (Integraciones).')
  if (!cfg?.usuarioCodigo) throw new Error('Falta el usuario de AxisPOS con el que se firman las operaciones (Integraciones → Probar conexión).')
  const traslados = compra.grupo ? ds.salidas.filter((x) => x.grupo === compra.grupo && x.tipo === 'traslado') : []
  const ctx = { areaCentral, usuario: cfg.usuarioCodigo, productos: new Map(ds.productos.map((p) => [p.nombre, p])), tabla: prepararTasas(ds.tasas, ds.settings.margenTasa) }
  const docs: DocumentoEnvio[] = []
  let n = acct
  const intenta = (doc: Omit<DocumentoEnvio, 'op' | 'error'>, f: (acct: number) => OperacionTPV, previo?: EnvioAxis) => {
    if (previo?.enviada) return
    try {
      docs.push({ ...doc, op: f(previo?.acct || n++) })
    } catch (e) {
      docs.push({ ...doc, error: e instanceof Error ? e.message : String(e) })
    }
  }
  intenta({ id: compra.id, tipo: 'compra' }, (a) => operacionCompra(compra, a, ctx), compra.axis)
  for (const t of traslados) {
    const tienda = ds.tiendas.find((d) => d.id === t.destino)
    intenta(
      { id: t.id, tipo: 'traslado' },
      (a) => {
        const destino = areaAlmacen(tienda, cfg.ubicaciones)
        if (!destino) throw new Error(`${tienda?.nombre ?? t.destino} no tiene área del TPV asignada.`)
        return operacionTraslado(t, a, destino, ctx)
      },
      t.axis,
    )
  }
  return { compra, docs, siguiente: n }
}
