import { ETIQUETA_CUENTA, RUBRO } from './catalogo'
import { finDeMes, mesesEntre, sumarMeses, ym } from './fecha'
import { distribucionDelMes, esEfectivo, type Mayor } from './mayor'
import type { Dataset, LineaER } from './types'

export type Vista = 'USD' | 'CUP'

export interface Fila {
  label: string
  tipo: 'titulo' | 'linea' | 'sub' | 'total' | 'control' | 'memo'
  valores: number[]
  total?: number
  /** Filtro para el detalle: prefijos o claves de cuenta. */
  cuentas?: string[]
  nivel?: number
}

export interface Informe {
  titulo: string
  columnas: string[]
  meses: string[]
  filas: Fila[]
  conTotal: boolean
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
export const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`

export function fmt(v: number, dec = 2) {
  return v.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: 'always' } as Intl.NumberFormatOptions)
}

/** Agregado del mayor por cuenta, mes y tienda. */
export class Indice {
  private filas: { cuenta: string; mes: string; tienda: string; usd: number; cup: number }[]
  constructor(public mayor: Mayor) {
    const m = new Map<string, { cuenta: string; mes: string; tienda: string; usd: number; cup: number }>()
    for (const l of mayor.lineas) {
      const mes = ym(l.fecha)
      const k = `${l.cuenta}|${mes}|${l.tienda}`
      let e = m.get(k)
      if (!e) m.set(k, (e = { cuenta: l.cuenta, mes, tienda: l.tienda, usd: 0, cup: 0 }))
      e.usd += l.usd
      e.cup += l.cup
    }
    this.filas = [...m.values()]
  }
  cuentas(): string[] {
    return [...new Set(this.filas.map((f) => f.cuenta))].sort()
  }
  /** Suma del mes (o hasta el mes inclusive si `acumulado`). */
  suma(pred: (cuenta: string) => boolean, mes: string, opt: { tienda?: string; vista?: Vista; acumulado?: boolean } = {}) {
    let s = 0
    for (const f of this.filas) {
      if (opt.tienda && f.tienda !== opt.tienda) continue
      if (opt.acumulado ? f.mes > mes : f.mes !== mes) continue
      if (!pred(f.cuenta)) continue
      s += opt.vista === 'CUP' ? f.cup : f.usd
    }
    return s
  }
}

export interface Opciones {
  tienda?: string
  vista?: Vista
}

export function mesesDelAnio(mayor: Mayor, anio: number): string[] {
  const desde = `${anio}-01`
  const primero = mayor.inicio.slice(0, 7)
  const ini = primero > desde && primero.startsWith(String(anio)) ? primero : desde
  const fin = mayor.ultimoMes.startsWith(String(anio)) ? mayor.ultimoMes : `${anio}-12`
  return mesesEntre(ini, fin)
}

export function aniosDisponibles(mayor: Mayor): number[] {
  const a = Number(mayor.inicio.slice(0, 4))
  const b = Number(mayor.ultimoMes.slice(0, 4))
  const out: number[] = []
  for (let y = a; y <= b; y++) out.push(y)
  return out
}

const sumar = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] ?? 0))
const total = (v: number[]) => v.reduce((s, x) => s + x, 0)

// ------------------------------------------------------------------ Estado de Resultados

const ORDEN_RUBROS: Record<LineaER, string[]> = {
  ventas: [RUBRO.venta, 'Devoluciones de ventas'],
  ingreso_tasa: [RUBRO.tasa],
  costo_ventas: [RUBRO.costo],
  gasto_venta: ['Salarios variables (Dependientes)'],
  gasto_admin: [
    'Salarios fijos (personal administrativo)',
    'Salarios (seguridad y limpieza)',
    RUBRO.consumo,
    'Mtto',
    'Transporte',
    'Comunicación (Publicidad)',
    'Otros gastos',
    RUBRO.merma,
    'Gastos bancarios',
  ],
  ingreso_financiero: ['Ingresos Financieros', RUBRO.tenencia],
  gasto_financiero: ['Gastos Financieros'],
  impuesto: ['Nómina', 'Ventas'],
  bonos: ['Bonos'],
}

function rubrosDe(idx: Indice, ds: Dataset, linea: LineaER): string[] {
  const set = new Set(ORDEN_RUBROS[linea])
  for (const c of ds.categorias) if (c.contrapartida === 'resultado' && c.linea === linea && c.rubro) set.add(c.rubro)
  for (const c of idx.cuentas()) if (c.startsWith(`res:${linea}:`)) set.add(c.slice(`res:${linea}:`.length))
  return [...set]
}

export function estadoResultados(ds: Dataset, idx: Indice, meses: string[], o: Opciones = {}): Informe {
  const filas: Fila[] = []
  const valoresDe = (cuentas: string[]) => meses.map((m) => -idx.suma((c) => cuentas.includes(c), m, { tienda: o.tienda, vista: o.vista }))
  const bloque = (linea: LineaER, nivel = 1, ocultarVacios = true) => {
    let tot = meses.map(() => 0)
    const rows: Fila[] = []
    for (const r of rubrosDe(idx, ds, linea)) {
      const cuentas = [`res:${linea}:${r}`]
      const v = valoresDe(cuentas)
      tot = sumar(tot, v)
      if (ocultarVacios && v.every((x) => Math.abs(x) < 0.005) && !ORDEN_RUBROS[linea].includes(r)) continue
      rows.push({ label: r, tipo: 'linea', valores: v, total: total(v), cuentas, nivel })
    }
    return { rows, tot }
  }
  const sub = (label: string, v: number[], tipo: Fila['tipo'] = 'sub'): Fila => ({ label, tipo, valores: v, total: total(v) })

  const ventas = bloque('ventas')
  const tasa = bloque('ingreso_tasa')
  filas.push(...ventas.rows, ...tasa.rows)
  const ventasNetas = sumar(ventas.tot, tasa.tot)
  filas.push(sub('Ventas netas', ventasNetas))
  const costo = bloque('costo_ventas')
  filas.push(...costo.rows)
  const bruta = sumar(ventasNetas, costo.tot)
  filas.push(sub('Utilidad Bruta', bruta, 'total'))
  filas.push({ label: 'Margen bruto %', tipo: 'memo', valores: meses.map((_, i) => (ventasNetas[i] ? (bruta[i] / ventasNetas[i]) * 100 : 0)) })

  const gv = bloque('gasto_venta', 2)
  filas.push(sub('Gastos de Venta', gv.tot), ...gv.rows)
  const ga = bloque('gasto_admin', 2)
  filas.push(sub('Gastos Administrativos', ga.tot), ...ga.rows)
  const operativos = sumar(gv.tot, ga.tot)
  filas.push(sub('Gastos Operativos', operativos))
  const baii = sumar(bruta, operativos)
  filas.push(sub('BAII', baii, 'total'))

  const fi = bloque('ingreso_financiero')
  const fg = bloque('gasto_financiero')
  filas.push(...fi.rows, ...fg.rows)
  const bai = sumar(sumar(baii, fi.tot), fg.tot)
  filas.push(sub('BAI', bai, 'total'))
  const imp = bloque('impuesto', 2)
  filas.push({ label: 'Carga impositiva sobre:', tipo: 'titulo', valores: [] }, ...imp.rows)
  const neto = sumar(bai, imp.tot)
  filas.push(sub('Beneficio neto', neto, 'total'))
  const bonos = bloque('bonos')
  filas.push(...bonos.rows)
  const despues = sumar(neto, bonos.tot)
  filas.push(sub('Beneficio neto después de bonos', despues, 'total'))
  filas.push({ label: 'Margen neto %', tipo: 'memo', valores: meses.map((_, i) => (ventasNetas[i] ? (despues[i] / ventasNetas[i]) * 100 : 0)) })

  // Bloque de distribución (solo consolidado: la decisión es del grupo).
  if (!o.tienda) {
    const dist = meses.map((m) => distribucionDelMes(ds, m))
    const reinv = despues.map((v, i) => (v > 0 ? v * dist[i].pctReinversion : 0))
    const divid = despues.map((v, i) => (v > 0 ? v - reinv[i] : 0))
    const inv = divid.map((v, i) => v * dist[i].pctInversionista + dist[i].ajusteInversionista)
    filas.push({ label: 'Distribución', tipo: 'titulo', valores: [] })
    filas.push(sub('Reinversión', reinv, 'memo'), sub('Dividendos', divid, 'memo'), sub('Inversionista', inv, 'memo'), sub('Kaluch', divid.map((v, i) => v - inv[i]), 'memo'))
  }
  return { titulo: 'Estado de Resultados', columnas: meses.map(nombreMes), meses, filas, conTotal: true }
}

// ------------------------------------------------------------------ Estado de Situación

export const CLASE_CUENTA: Record<string, 'activo' | 'pasivo' | 'patrimonio' | 'mixta'> = {
  ventas_por_depositar: 'activo',
  inventario: 'activo',
  cxc: 'activo',
  traspasos: 'activo',
  por_clasificar: 'activo',
  cxp_proveedores: 'pasivo',
  casa_matriz: 'mixta',
  cobros_anticipados: 'pasivo',
  impuestos_por_pagar: 'pasivo',
  dividendos_por_pagar: 'pasivo',
  capital: 'patrimonio',
  dividendos_declarados: 'patrimonio',
}

export const etiquetaCuenta = (c: string) => {
  if (c.startsWith('caja:')) {
    const [, t, m] = c.split(':')
    return `Caja ${m} · ${t}`
  }
  if (c.startsWith('banco:')) {
    const [, t, b] = c.split(':')
    return `Banco ${b} · ${t}`
  }
  if (c.startsWith('res:')) return c.split(':').slice(2).join(':')
  return ETIQUETA_CUENTA[c] ?? c
}

export function estadoSituacion(idx: Indice, meses: string[], o: Opciones = {}): Informe {
  const filas: Fila[] = []
  const saldo = (pred: (c: string) => boolean) => meses.map((m) => idx.suma(pred, m, { tienda: o.tienda, vista: o.vista, acumulado: true }))
  const cuentas = idx.cuentas()
  const linea = (label: string, pred: (c: string) => boolean, signo = 1, nivel = 2): Fila => {
    const v = saldo(pred).map((x) => x * signo)
    return { label, tipo: 'linea', valores: v, cuentas: cuentas.filter(pred), nivel }
  }
  const noVacia = (f: Fila) => f.valores.some((x) => Math.abs(x) >= 0.005)

  // Activos
  const caja = ['USD', 'CUP', 'EUR', 'MLC'].map((mon) => linea(mon, (c) => c.startsWith('caja:') && c.endsWith(`:${mon}`))).filter((f, i) => i < 3 || noVacia(f))
  const bancos = [...new Set(cuentas.filter((c) => c.startsWith('banco:')).map((c) => c.split(':')[2]))].map((b) => linea(b, (c) => c.startsWith('banco:') && c.endsWith(`:${b}`)))
  const cm = saldo((c) => c === 'casa_matriz')
  const otrosActivos = [
    linea('Ventas por depositar', (c) => c === 'ventas_por_depositar'),
    linea('Cuentas por cobrar', (c) => c === 'cxc'),
    { label: 'Casa Matriz (nos debe)', tipo: 'linea', valores: cm.map((v) => Math.max(v, 0)), cuentas: ['casa_matriz'], nivel: 2 } as Fila,
    linea('Traspasos en tránsito', (c) => c === 'traspasos'),
    linea('Partidas por clasificar', (c) => c === 'por_clasificar'),
  ].filter(noVacia)
  const inventario = linea('Inventario', (c) => c === 'inventario', 1, 1)

  const sumaFilas = (fs: Fila[]) => fs.reduce((a, f) => sumar(a, f.valores), meses.map(() => 0))
  const tCaja = sumaFilas(caja)
  const tBanco = sumaFilas(bancos)
  const tOtros = sumaFilas(otrosActivos)
  const activos = sumar(sumar(sumar(tCaja, tBanco), tOtros), inventario.valores)
  filas.push({ label: 'ACTIVOS', tipo: 'total', valores: activos })
  filas.push({ label: 'Efectivo en Caja', tipo: 'sub', valores: tCaja, cuentas: cuentas.filter((c) => c.startsWith('caja:')) }, ...caja)
  filas.push({ label: 'Efectivo en Banco', tipo: 'sub', valores: tBanco, cuentas: cuentas.filter((c) => c.startsWith('banco:')) }, ...bancos)
  if (otrosActivos.length) filas.push({ label: 'Cuentas por cobrar y otros', tipo: 'sub', valores: tOtros }, ...otrosActivos)
  filas.push({ ...inventario, tipo: 'sub' })

  // Pasivos
  const pasivos = [
    linea('Proveedores', (c) => c === 'cxp_proveedores', -1),
    { label: 'Casa Matriz (le debemos)', tipo: 'linea', valores: cm.map((v) => Math.max(-v, 0)), cuentas: ['casa_matriz'], nivel: 2 } as Fila,
    linea('Dividendos por pagar', (c) => c === 'dividendos_por_pagar', -1),
    linea('Impuestos por pagar', (c) => c === 'impuestos_por_pagar', -1),
    linea('Cobros anticipados', (c) => c === 'cobros_anticipados', -1),
  ]
  const tPasivo = sumaFilas(pasivos)

  // Patrimonio
  const capital = linea('Capital aportado', (c) => c === 'capital', -1)
  const dividendos = linea('Dividendos declarados', (c) => c === 'dividendos_declarados', -1)
  const resultado = linea('Resultado acumulado', (c) => c.startsWith('res:'), -1)
  const tPatrimonio = sumaFilas([capital, dividendos, resultado])

  filas.push({ label: 'PASIVO + PATRIMONIO', tipo: 'total', valores: sumar(tPasivo, tPatrimonio) })
  filas.push({ label: 'PASIVOS', tipo: 'sub', valores: tPasivo }, ...pasivos.filter((f, i) => i === 0 || noVacia(f)))
  filas.push({ label: 'PATRIMONIO', tipo: 'sub', valores: tPatrimonio }, capital, dividendos, resultado)
  filas.push({ label: 'CUADRE (Activo − Pasivo − Patrimonio)', tipo: 'control', valores: activos.map((a, i) => a - tPasivo[i] - tPatrimonio[i]) })
  return { titulo: 'Estado de Situación', columnas: meses.map((m) => `Cierre ${nombreMes(m)}`), meses, filas, conTotal: false }
}

// ------------------------------------------------------------------ Flujo de Efectivo

export function flujoEfectivo(ds: Dataset, mayor: Mayor, meses: string[], o: Opciones = {}): Informe {
  const grupos = { explotacion: 'Explotación', inversion: 'Inversión', financiacion: 'Financiación', interno: 'Movimientos internos' } as const
  const porCat = new Map<string, number[]>()
  const efecto = meses.map(() => 0)
  const total0 = meses.map(() => 0)
  const pos = new Map(meses.map((m, i) => [m, i]))
  let inicial = 0
  for (const l of mayor.lineas) {
    if (!esEfectivo(l.cuenta) || (o.tienda && l.tienda !== o.tienda)) continue
    const v = o.vista === 'CUP' ? l.cup : l.usd
    const mes = ym(l.fecha)
    if (mes < meses[0]) {
      inicial += v
      continue
    }
    const i = pos.get(mes)
    if (i == null) continue
    total0[i] += v
    if (l.fuente === 'rev') {
      efecto[i] += v
      continue
    }
    const arr = porCat.get(l.categoria) ?? meses.map(() => 0)
    arr[i] += v
    porCat.set(l.categoria, arr)
  }
  const filas: Fila[] = []
  const saldoIni: number[] = []
  let s = inicial
  for (let i = 0; i < meses.length; i++) {
    saldoIni.push(s)
    s += total0[i]
  }
  filas.push({ label: 'Saldo inicial', tipo: 'total', valores: saldoIni })
  let variacion = meses.map(() => 0)
  for (const [g, label] of Object.entries(grupos)) {
    const cats = [...porCat.entries()].filter(([c]) => (mayor.categorias.get(c)?.flujo ?? 'interno') === g)
    if (!cats.length) continue
    const tot = cats.reduce((a, [, v]) => sumar(a, v), meses.map(() => 0))
    variacion = sumar(variacion, tot)
    filas.push({ label, tipo: 'sub', valores: tot, total: total(tot) })
    for (const [c, v] of cats.sort((a, b) => a[0].localeCompare(b[0]))) filas.push({ label: c, tipo: 'linea', valores: v, total: total(v), nivel: 2 })
  }
  if (efecto.some((x) => Math.abs(x) > 0.005)) {
    filas.push({ label: 'Efecto de la tasa de cambio sobre el efectivo', tipo: 'sub', valores: efecto, total: total(efecto) })
    variacion = sumar(variacion, efecto)
  }
  filas.push({ label: 'Variación neta', tipo: 'sub', valores: variacion, total: total(variacion) })
  filas.push({ label: 'Saldo final', tipo: 'total', valores: saldoIni.map((v, i) => v + variacion[i]) })
  filas.push({ label: 'Comprobación (movimiento de tesorería − variación)', tipo: 'control', valores: total0.map((v, i) => v - variacion[i]) })
  void ds
  return { titulo: 'Flujo de Efectivo', columnas: meses.map(nombreMes), meses, filas, conTotal: true }
}

// ------------------------------------------------------------------ Capital

export function capital(ds: Dataset, idx: Indice, meses: string[], o: Opciones = {}): Informe {
  const opt = { tienda: o.tienda, vista: o.vista }
  const ini = meses.map((m) => -idx.suma((c) => c === 'capital', sumarMeses(m, -1), { ...opt, acumulado: true }))
  const mov = meses.map((m) => -idx.suma((c) => c === 'capital', m, opt))
  const aum = mov.map((v) => Math.max(v, 0))
  const dis = mov.map((v) => Math.max(-v, 0))
  const beneficio = meses.map((m) => -idx.suma((c) => c.startsWith('res:'), m, opt))
  const dist = meses.map((m) => distribucionDelMes(ds, m))
  const reinv = beneficio.map((v, i) => (v > 0 ? v * dist[i].pctReinversion : 0))
  const divid = beneficio.map((v, i) => (v > 0 ? v - reinv[i] : 0))
  const declarados = meses.map((m) => idx.suma((c) => c === 'dividendos_declarados', m, opt))
  const retenido = meses.map((m) => -idx.suma((c) => c.startsWith('res:') || c === 'dividendos_declarados', m, { ...opt, acumulado: true }))
  const filas: Fila[] = [
    { label: 'Capital aportado', tipo: 'titulo', valores: [] },
    { label: 'Saldo inicial', tipo: 'linea', valores: ini, nivel: 2 },
    { label: 'Aumentos', tipo: 'linea', valores: aum, total: total(aum), cuentas: ['capital'], nivel: 2 },
    { label: 'Disminuciones', tipo: 'linea', valores: dis, total: total(dis), cuentas: ['capital'], nivel: 2 },
    { label: 'Saldo final', tipo: 'sub', valores: ini.map((v, i) => v + aum[i] - dis[i]) },
    { label: 'Resultado', tipo: 'titulo', valores: [] },
    { label: 'Beneficio del mes (después de bonos)', tipo: 'linea', valores: beneficio, total: total(beneficio), nivel: 2 },
    { label: '% de reinversión', tipo: 'memo', valores: dist.map((d) => d.pctReinversion * 100) },
    { label: 'Reinversión', tipo: 'linea', valores: reinv, total: total(reinv), nivel: 2 },
    { label: 'Dividendos (calculados)', tipo: 'linea', valores: divid, total: total(divid), nivel: 2 },
    { label: 'Dividendos declarados en el mayor', tipo: 'linea', valores: declarados, total: total(declarados), cuentas: ['dividendos_declarados'], nivel: 2 },
    { label: 'Resultado retenido acumulado', tipo: 'sub', valores: retenido },
  ]
  return { titulo: 'Capital', columnas: meses.map(nombreMes), meses, filas, conTotal: false }
}

export function rangoMes(mes: string) {
  return { desde: `${mes}-01`, hasta: finDeMes(mes) }
}
