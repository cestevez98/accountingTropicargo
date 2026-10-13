import { CAT_DEPRECIACION, CAT_INGRESOS_FACTURADOS, CAT_POR_CLASIFICAR, CAT_SALDO_INICIAL, CAT_VENTAS_FUERA } from './catalog'
import { diaAnterior, finDeMes, hoy, mesesEntre, sumarMeses, ym } from './fecha'
import { movUSD, prepararTasas } from './fx'
import type { Categoria, Dataset } from './types'

/**
 * Libro mayor de partida doble.
 *
 * Cada documento del sistema (movimiento de caja/banco, factura de venta, factura de compra,
 * devengo, asiento manual, depreciación y saldos de apertura) genera líneas balanceadas.
 * `importe` es positivo en el DEBE y negativo en el HABER, de modo que la suma de todas las
 * líneas siempre es 0 y el Estado de Situación cuadra por construcción.
 *
 * Claves de cuenta:
 *   tes:<cuenta>       tesorería (cajas, bancos, pasarelas, tarjetas)
 *   res:<categoría>    cuentas de resultado (ER)
 *   <CuentaBalance>    resto del balance (cxc, cxp, capital, apertura…)
 */

export type Fuente = 'mov' | 'fv' | 'fc' | 'cxm' | 'dev' | 'asi' | 'dep' | 'ape'

export const FUENTE_LABEL: Record<Fuente, string> = {
  mov: 'Movimiento',
  fv: 'Factura de venta',
  fc: 'Factura de compra',
  cxm: 'CxC fuera del sistema',
  dev: 'Devengo',
  asi: 'Asiento manual',
  dep: 'Depreciación',
  ape: 'Apertura',
}

export interface Linea {
  fecha: string
  cuenta: string
  importe: number
  fuente: Fuente
  ref: string
  concepto: string
  contra: string
  /** Categoría del documento (para agrupar el flujo de caja). */
  categoria: string
}

export interface Mayor {
  lineas: Linea[]
  inicio: string
  /** Último mes con datos o el mes actual, lo que sea mayor. */
  ultimoMes: string
  categorias: Map<string, Categoria>
  /** Importe USD de cada movimiento, por id. */
  usd: Map<string, number>
  avisos: string[]
}

export function claveContra(cat: Categoria | undefined): string {
  if (!cat) return 'por_clasificar'
  return cat.contrapartida === 'resultado' ? `res:${cat.nombre}` : cat.contrapartida
}

export function construirMayor(ds: Dataset): Mayor {
  const inicio = ds.settings.fechaInicio
  const apertura = diaAnterior(inicio)
  const categorias = new Map(ds.categorias.map((c) => [c.nombre, c]))
  const tasas = prepararTasas(ds.tasas)
  const lineas: Linea[] = []
  const usd = new Map<string, number>()
  const avisos: string[] = []
  let maxFecha = inicio

  const push = (
    fecha: string,
    debe: string,
    haber: string,
    importe: number,
    fuente: Fuente,
    ref: string,
    concepto: string,
    categoria: string,
  ) => {
    if (!importe || !Number.isFinite(importe)) return
    // Los resultados anteriores a la fecha de inicio pasan a patrimonio.
    const d = fecha < inicio && debe.startsWith('res:') ? 'resultados_anteriores' : debe
    const h = fecha < inicio && haber.startsWith('res:') ? 'resultados_anteriores' : haber
    lineas.push({ fecha, cuenta: d, importe, fuente, ref, concepto, contra: h, categoria })
    lineas.push({ fecha, cuenta: h, importe: -importe, fuente, ref, concepto, contra: d, categoria })
    if (fecha > maxFecha) maxFecha = fecha
  }

  // 1) Saldos de apertura de configuración.
  const st = ds.settings
  push(apertura, 'apertura', 'capital', st.capitalApertura, 'ape', 'capital', 'Capital de apertura', 'Apertura')
  push(apertura, 'cxc', 'apertura', st.cxcSistemaApertura, 'ape', 'cxc', 'CxC clientes al cierre anterior', 'Apertura')

  // 2) Movimientos de tesorería.
  let sinTasa = 0
  const tipoCuenta = new Map(ds.cuentas.map((c) => [c.nombre, c.tipo]))
  const eurCaja = Number(ds.settings.eurCajaUsd) || 1
  for (const m of ds.movimientos) {
    // En las cajas el euro se toma 1×1 (configurable); en bancos, a la tasa de mercado.
    const v = movUSD(m, tasas, tipoCuenta.get(m.cuenta) === 'caja' ? eurCaja : undefined)
    if (!Number.isFinite(v)) {
      sinTasa++
      continue
    }
    usd.set(m.id, v)
    const cat = categorias.get(m.categoria)
    const nombreCat = cat ? m.categoria : CAT_POR_CLASIFICAR
    const contra = m.excluirER ? 'transito' : claveContra(cat)
    push(m.fecha, `tes:${m.cuenta}`, contra, v, 'mov', m.id, m.concepto, nombreCat)
  }
  if (sinTasa) avisos.push(`${sinTasa} movimientos en CUP/EUR no tienen tasa de cambio y no se contabilizaron.`)

  // 3) Facturas de venta (ingresos devengados). Las anteriores al inicio van en la CxC de apertura.
  for (const f of ds.facturas) {
    if (!f.afectaER || !f.emision || f.emision < inicio) continue
    push(f.emision, 'cxc', `res:${CAT_INGRESOS_FACTURADOS}`, f.monto, 'fv', f.id, `${f.numero} · ${f.cliente}`, CAT_INGRESOS_FACTURADOS)
  }

  // 4) Facturas de compra (gasto devengado contra CxP). Antes del inicio solo cuenta lo pendiente.
  for (const f of ds.facturasCompra) {
    if (!f.fecha) continue
    const concepto = `${f.numero} · ${f.proveedor}`
    if (f.fecha < inicio) {
      push(apertura, 'apertura', 'cxp', (f.monto || 0) - (f.pagado || 0), 'ape', f.id, concepto, CAT_SALDO_INICIAL)
      continue
    }
    const cat = categorias.get(f.categoria)
    push(f.fecha, claveContra(cat), 'cxp', f.monto, 'fc', f.id, concepto, cat ? f.categoria : CAT_POR_CLASIFICAR)
  }

  // 5) CxC fuera del sistema.
  for (const c of ds.cxcManual) {
    if (!c.fecha) continue
    const concepto = `${c.numero} · ${c.cliente}`
    if (c.fecha < inicio) push(apertura, 'cxc_manual', 'apertura', (c.facturado || 0) - (c.cobrado || 0), 'ape', c.id, concepto, CAT_SALDO_INICIAL)
    else push(c.fecha, 'cxc_manual', `res:${CAT_VENTAS_FUERA}`, c.facturado, 'cxm', c.id, concepto, CAT_VENTAS_FUERA)
  }

  // 6) Devengos: el gasto sale del mes de pago y entra en el mes al que corresponde.
  for (const d of ds.devengos) {
    if (!d.fechaPago || !/^\d{4}-\d{2}$/.test(d.mesCorresponde)) continue
    const res = claveContra(categorias.get(d.categoria))
    push(d.fechaPago, 'devengos', res, d.importe, 'dev', d.id, `${d.concepto} (pagado, corresponde a ${d.mesCorresponde})`, d.categoria)
    push(`${d.mesCorresponde}-01`, res, 'devengos', d.importe, 'dev', d.id, `${d.concepto} (devengado)`, d.categoria)
  }

  // 7) Asientos manuales.
  for (const a of ds.asientos) {
    if (!a.fecha || !a.cargo || !a.abono) continue
    const cat = a.cargo.startsWith('tes:') ? 'Asiento manual' : a.abono.startsWith('tes:') ? 'Asiento manual' : 'Asiento manual'
    push(a.fecha, a.cargo, a.abono, a.importe, 'asi', a.id, a.concepto, cat)
  }

  // 8) Activos fijos: costo de apertura y depreciación mensual en línea recta.
  const mesInicio = ym(inicio)
  const ultimoMes = [ym(maxFecha), ym(hoy())].sort().at(-1)!
  for (const a of ds.activos) {
    const costo = Number(a.costo) || 0
    if (!costo) continue
    const depApertura = Number(a.depAcumApertura) || 0
    const deApertura = !a.fechaAlta || a.fechaAlta < inicio
    if (deApertura) {
      push(apertura, 'activo_fijo', 'apertura', costo, 'ape', a.id, a.descripcion, CAT_SALDO_INICIAL)
      push(apertura, 'apertura', 'dep_acumulada', depApertura, 'ape', a.id, a.descripcion, CAT_SALDO_INICIAL)
    }
    const vida = Number(a.vidaUtil) || 0
    if (vida <= 0) continue
    const cuota = costo / (vida * 12)
    let pendiente = costo - depApertura
    const desde = deApertura ? mesInicio : [mesInicio, sumarMeses(ym(a.fechaAlta!), 1)].sort().at(-1)!
    for (const mes of mesesEntre(desde, ultimoMes)) {
      if (pendiente <= 0.005) break
      const c = Math.min(cuota, pendiente)
      pendiente -= c
      push(finDeMes(mes), `res:${CAT_DEPRECIACION}`, 'dep_acumulada', c, 'dep', a.id, a.descripcion, CAT_DEPRECIACION)
    }
  }

  return { lineas, inicio, ultimoMes, categorias, usd, avisos }
}
