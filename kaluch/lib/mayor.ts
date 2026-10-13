import { CAT_POR_CLASIFICAR, RUBRO } from './catalogo'
import { finDeMes, hoy, mesesEntre, sumarMeses, ym } from './fecha'
import { aUSD, cupPor, prepararTasas, tasaVigente, valorarVenta, type TablaTasas } from './fx'
import { costosPromedio } from './inventario'
import type { Categoria, Dataset, LineaER, Moneda } from './types'

/**
 * Libro mayor de partida doble.
 *
 * Cada documento (movimiento de caja/banco, salida de inventario, compra, deuda, asiento) genera
 * líneas balanceadas. `usd` es positivo en el DEBE y negativo en el HABER: la suma de todas las
 * líneas de una tienda es 0 y el Estado de Situación cuadra por construcción, tienda a tienda.
 *
 * Claves de cuenta:
 *   caja:<tienda>:<moneda>   efectivo en caja por moneda
 *   banco:<tienda>:<cuenta>  cuentas bancarias
 *   res:<línea>:<rubro>      cuentas de resultado (renglón del ER)
 *   <cuenta>                 resto del balance (inventario, cxp_proveedores, casa_matriz…)
 */

export type Fuente = 'mov' | 'sal' | 'com' | 'deu' | 'asi' | 'imp' | 'rev' | 'div'

export const FUENTE_LABEL: Record<Fuente, string> = {
  mov: 'Caja / banco',
  sal: 'Ventas y salidas',
  com: 'Compra',
  deu: 'Deuda',
  asi: 'Asiento',
  imp: 'Impuesto calculado',
  rev: 'Revaluación de moneda',
  div: 'Distribución de utilidades',
}

export interface Linea {
  fecha: string
  tienda: string
  cuenta: string
  usd: number
  /** Equivalente en CUP a tasa histórica. */
  cup: number
  /** Importe en la moneda original (solo cuentas de efectivo). */
  orig?: number
  moneda?: Moneda
  fuente: Fuente
  ref: string
  concepto: string
  contra: string
  categoria: string
}

export interface Mayor {
  lineas: Linea[]
  inicio: string
  ultimoMes: string
  categorias: Map<string, Categoria>
  tasas: TablaTasas
  avisos: string[]
  /** USD de cada movimiento de caja/banco (por id) para las tablas. */
  usdMov: Map<string, number>
}

export const cuentaRes = (linea: LineaER, rubro: string) => `res:${linea}:${rubro}`

export function contraDeCategoria(cat: Categoria | undefined): string {
  if (!cat) return 'por_clasificar'
  if (cat.contrapartida === 'resultado') return cuentaRes(cat.linea ?? 'gasto_admin', cat.rubro ?? cat.nombre)
  return cat.contrapartida
}

export const cuentaCaja = (tienda: string, moneda: Moneda) => `caja:${tienda}:${moneda}`
export const cuentaBanco = (tienda: string, cuenta: string) => `banco:${tienda}:${(cuenta || 'BANCO').trim().toUpperCase()}`
export const esEfectivo = (c: string) => c.startsWith('caja:') || c.startsWith('banco:')

export function construirMayor(ds: Dataset, hasta = hoy()): Mayor {
  const inicio = ds.settings.fechaInicio
  const categorias = new Map(ds.categorias.map((c) => [c.nombre, c]))
  const tasas = prepararTasas(ds.tasas, ds.settings.margenTasa)
  const lineas: Linea[] = []
  const avisos: string[] = []
  const usdMov = new Map<string, number>()
  let maxFecha = inicio

  const cupDe = (usd: number, fecha: string) => {
    const t = tasaVigente(tasas, fecha)
    return t ? usd * t.cupUsd : 0
  }

  const push = (
    fecha: string,
    tienda: string,
    debe: string,
    haber: string,
    usd: number,
    fuente: Fuente,
    ref: string,
    concepto: string,
    categoria: string,
    extra?: { cup?: number; orig?: number; moneda?: Moneda },
  ) => {
    if (!usd || !Number.isFinite(usd)) return
    const cup = extra?.cup ?? cupDe(usd, fecha)
    const efectivoDebe = esEfectivo(debe)
    lineas.push({ fecha, tienda, cuenta: debe, usd, cup, fuente, ref, concepto, contra: haber, categoria, ...(efectivoDebe && extra?.orig != null ? { orig: extra.orig, moneda: extra.moneda } : {}) })
    lineas.push({
      fecha,
      tienda,
      cuenta: haber,
      usd: -usd,
      cup: -cup,
      fuente,
      ref,
      concepto,
      contra: debe,
      categoria,
      ...(!efectivoDebe && esEfectivo(haber) && extra?.orig != null ? { orig: -extra.orig, moneda: extra.moneda } : {}),
    })
    if (fecha > maxFecha) maxFecha = fecha
  }

  // 1) Movimientos de caja y banco.
  let sinTasa = 0
  for (const m of ds.movimientos) {
    const signo = m.tipo === 'Entrada' ? 1 : -1
    const usd = signo * aUSD(tasas, m.monto, m.moneda, m.fecha, m.tasa)
    if (!Number.isFinite(usd)) {
      sinTasa++
      continue
    }
    usdMov.set(m.id, usd)
    const cat = categorias.get(m.categoria)
    const caja = m.libro === 'caja' ? cuentaCaja(m.tienda, m.moneda) : cuentaBanco(m.tienda, m.cuenta ?? '')
    const cup = m.moneda === 'CUP' ? signo * m.monto : signo * m.monto * (cupPor(tasas, m.moneda, m.fecha) || 0)
    push(m.fecha, m.tienda, caja, contraDeCategoria(cat), usd, 'mov', m.id, m.concepto || m.categoria, cat ? m.categoria : CAT_POR_CLASIFICAR, {
      cup,
      orig: signo * m.monto,
      moneda: m.moneda,
    })
  }
  if (sinTasa) avisos.push(`${sinTasa} movimientos en CUP/EUR/MLC no tienen tasa de cambio y no se contabilizaron.`)

  // 2) Compras: entran al inventario contra el proveedor. Lo pagado en el exterior y lo que llega de
  //    otros mercados se le debe a la Casa Matriz; el inventario inicial aportado va a capital.
  for (const c of ds.compras) {
    const usd = c.importeUSD ?? aUSD(tasas, c.importe, c.moneda, c.fecha, c.tasa)
    if (!Number.isFinite(usd)) continue
    const haber = c.aporte ? 'capital' : c.pago === 'exterior' || c.pago === 'mercados' ? 'casa_matriz' : 'cxp_proveedores'
    push(c.fecha, c.tienda, 'inventario', haber, usd, 'com', c.id, [c.producto, c.proveedor, c.factura].filter(Boolean).join(' · ') || 'Compra', c.aporte ? 'Aporte de mercancía' : 'Compras')
  }

  // 3) Salidas de inventario: ventas, devoluciones, mermas y consumo interno. Se contabilizan por
  //    día, tienda y tipo (el detalle de cada operación queda en la tabla de ventas).
  const costos = costosPromedio(ds)
  let sinCosto = 0
  const dia = new Map<string, { fecha: string; tienda: string; tipo: string; venta: number; tasa: number; costo: number; n: number }>()
  for (const s of ds.salidas) {
    let costo = s.costoUSD
    if (costo == null) {
      const unit = s.producto ? costos.get(s.producto) : undefined
      costo = unit != null && s.cantidad ? unit * s.cantidad : 0
      if (!costo && s.tipo !== 'devolucion') sinCosto++
    }
    const signo = s.tipo === 'devolucion' ? -1 : 1
    let venta = 0
    let tasa = 0
    if (s.tipo === 'venta' || s.tipo === 'devolucion') {
      if (s.ventaUSD == null) {
        const v = valorarVenta(tasas, s.importe ?? 0, s.moneda ?? 'CUP', s.fecha)
        venta = v.ventaUSD
        tasa = s.ingresoTasaUSD ?? v.ingresoTasaUSD
      } else {
        venta = s.ventaUSD
        tasa = s.ingresoTasaUSD ?? 0
      }
    }
    const tipo = s.tipo === 'devolucion' ? 'venta' : s.tipo
    const k = `${s.fecha}|${s.tienda}|${tipo}`
    let d = dia.get(k)
    if (!d) dia.set(k, (d = { fecha: s.fecha, tienda: s.tienda, tipo, venta: 0, tasa: 0, costo: 0, n: 0 }))
    d.venta += signo * (venta || 0)
    d.tasa += signo * (tasa || 0)
    d.costo += signo * costo
    d.n++
  }
  for (const [k, d] of dia) {
    const ref = `sal:${k}`
    if (d.tipo === 'venta') {
      const concepto = `Ventas del día (${d.n} líneas)`
      push(d.fecha, d.tienda, 'ventas_por_depositar', cuentaRes('ventas', RUBRO.venta), d.venta, 'sal', ref, concepto, 'Ventas TPV')
      push(d.fecha, d.tienda, 'ventas_por_depositar', cuentaRes('ingreso_tasa', RUBRO.tasa), d.tasa, 'sal', ref, concepto, 'Ventas TPV')
      push(d.fecha, d.tienda, cuentaRes('costo_ventas', RUBRO.costo), 'inventario', d.costo, 'sal', ref, concepto, 'Costo de ventas')
    } else {
      const rubro = d.tipo === 'merma' ? RUBRO.merma : RUBRO.consumo
      push(d.fecha, d.tienda, cuentaRes('gasto_admin', rubro), 'inventario', d.costo, 'sal', ref, `${rubro} del día (${d.n} líneas)`, rubro)
    }
  }
  if (sinCosto) avisos.push(`${sinCosto} salidas de inventario no tienen costo (producto sin compras ni costo de referencia).`)

  // 4) Deudas registradas fuera de caja.
  for (const d of ds.deudas) {
    const usd = aUSD(tasas, d.monto, d.moneda, d.fecha)
    if (!Number.isFinite(usd)) continue
    const cat = categorias.get(d.categoria)
    const tercero = /casa\s*matriz/i.test(d.contraparte) ? 'casa_matriz' : d.clase === 'pagar' ? 'cxp_proveedores' : 'cxc'
    const concepto = `${d.contraparte} · ${d.concepto || d.categoria}`
    if (d.clase === 'pagar') push(d.fecha, d.tienda, contraDeCategoria(cat), tercero, usd, 'deu', d.id, concepto, d.categoria)
    else push(d.fecha, d.tienda, tercero, contraDeCategoria(cat), usd, 'deu', d.id, concepto, d.categoria)
  }

  // 5) Asientos manuales (y saldos de apertura).
  for (const a of ds.asientos) {
    const debe = a.lineas.filter((l) => l.debe > 0)
    const haber = a.lineas.filter((l) => l.haber > 0)
    // Se reparten los cargos contra los abonos en proporción, para que cada línea tenga su contrapartida.
    const totalHaber = haber.reduce((s, l) => s + l.haber, 0)
    if (!totalHaber) continue
    for (const d of debe) for (const h of haber) push(a.fecha, a.tienda, d.cuenta, h.cuenta, (d.debe * h.haber) / totalHaber, 'asi', a.id, a.concepto, 'Asiento')
  }

  const ultimoMes = [ym(maxFecha), ym(hasta)].sort().at(-1)!
  const meses = mesesEntre(ym(inicio) < ym(maxFecha) ? ym(inicio) : ym(maxFecha), ultimoMes)
  const mesesCerrados = meses.filter((m) => finDeMes(m) < hasta)

  // 6) Impuesto sobre las ventas: % de lo cobrado por los bancos en cada mes, por tienda.
  if (ds.settings.impuestoVentas > 0) {
    const base = new Map<string, number>()
    for (const l of lineas) {
      if (l.fuente !== 'mov' || !l.cuenta.startsWith('banco:') || l.categoria !== 'VENTAS') continue
      const k = `${ym(l.fecha)}|${l.tienda}`
      base.set(k, (base.get(k) ?? 0) + l.usd)
    }
    for (const [k, v] of base) {
      const [mes, tienda] = k.split('|')
      push(finDeMes(mes), tienda, cuentaRes('impuesto', RUBRO.impVentas), 'impuestos_por_pagar', v * ds.settings.impuestoVentas, 'imp', `imp-${k}`, `Impuesto sobre ventas cobradas por banco (${(ds.settings.impuestoVentas * 100).toFixed(0)} %)`, 'IMPUESTO VENTAS')
    }
  }

  // 7) Revaluación al cierre de mes del efectivo en CUP/EUR/MLC (resultado por tenencia de moneda).
  if (ds.settings.revaluar) {
    const efectivo = lineas.filter((l) => esEfectivo(l.cuenta) && l.moneda && l.moneda !== 'USD').sort((a, b) => a.fecha.localeCompare(b.fecha))
    const saldo = new Map<string, { orig: number; usd: number; moneda: Moneda; tienda: string }>()
    let i = 0
    for (const mes of mesesCerrados) {
      const fin = finDeMes(mes)
      while (i < efectivo.length && efectivo[i].fecha <= fin) {
        const l = efectivo[i++]
        const s = saldo.get(l.cuenta) ?? { orig: 0, usd: 0, moneda: l.moneda!, tienda: l.tienda }
        s.orig += l.orig ?? 0
        s.usd += l.usd
        saldo.set(l.cuenta, s)
      }
      for (const [cuenta, s] of saldo) {
        const valor = aUSD(tasas, s.orig, s.moneda, fin)
        if (!Number.isFinite(valor)) continue
        const dif = valor - s.usd
        if (Math.abs(dif) < 0.005) continue
        push(fin, s.tienda, cuenta, cuentaRes('ingreso_financiero', RUBRO.tenencia), dif, 'rev', `rev-${mes}-${cuenta}`, `Revaluación ${s.moneda} al ${fin}`, 'Revaluación', { cup: 0, orig: 0, moneda: s.moneda })
        s.usd += dif
      }
    }
  }

  // 8) Distribución de utilidades de cada mes cerrado: la parte que no se reinvierte se declara como dividendo.
  const resultadoMes = new Map<string, { neto: number }>()
  for (const l of lineas) {
    if (!l.cuenta.startsWith('res:')) continue
    const r = resultadoMes.get(ym(l.fecha)) ?? { neto: 0 }
    r.neto -= l.usd
    resultadoMes.set(ym(l.fecha), r)
  }
  for (const mes of mesesCerrados) {
    if (mes < ym(inicio)) continue
    const neto = resultadoMes.get(mes)?.neto ?? 0
    if (neto <= 0) continue
    const dist = distribucionDelMes(ds, mes)
    const dividendos = neto * (1 - dist.pctReinversion)
    push(finDeMes(mes), 'matriz', 'dividendos_declarados', 'dividendos_por_pagar', dividendos, 'div', `div-${mes}`, `Dividendos de ${mes} (${(100 - dist.pctReinversion * 100).toFixed(0)} % del beneficio)`, 'Distribución')
  }

  return { lineas, inicio, ultimoMes, categorias, tasas, avisos, usdMov }
}

export function distribucionDelMes(ds: Pick<Dataset, 'distribuciones' | 'settings'>, mes: string) {
  const d = ds.distribuciones.find((x) => x.mes === mes)
  return {
    pctReinversion: d?.pctReinversion ?? ds.settings.pctReinversionDefecto,
    pctInversionista: d?.pctInversionista ?? ds.settings.pctInversionistaDefecto,
    ajusteInversionista: d?.ajusteInversionista ?? 0,
  }
}

export const mesSiguiente = (m: string) => sumarMeses(m, 1)
