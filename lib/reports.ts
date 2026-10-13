import { CAT_INGRESOS_FACTURADOS, CAT_POR_CLASIFICAR, CAT_SALDO_INICIAL, CUENTA_BALANCE_INFO, MESES } from './catalog'
import { finDeMes, hoy, mesesEntre, sumarMeses, ym } from './fecha'
import { FUENTE_LABEL, type Fuente, type Mayor } from './ledger'
import type { CuentaBalance, Dataset, GrupoER, GrupoFlujo } from './types'

export interface Fila {
  key: string
  label: string
  valores: number[]
  total?: number
  tipo?: 'dato' | 'subtotal' | 'total' | 'titulo' | 'pct' | 'control'
  /** Enlace de detalle: filtro para la página del mayor. */
  detalle?: { cuenta?: string; categoria?: string; fuente?: string }
  nota?: string
}

export interface Informe {
  meses: string[]
  columnas: string[]
  filas: Fila[]
  conTotal: boolean
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Meses del año que cubre la contabilidad (desde la fecha de inicio hasta el último mes con datos). */
export function mesesDelAnio(mayor: Mayor, anio: number): string[] {
  const desde = [`${anio}-01`, ym(mayor.inicio)].sort().at(-1)!
  const hasta = [`${anio}-12`, mayor.ultimoMes].sort()[0]
  return desde > hasta ? [] : mesesEntre(desde, hasta)
}

export function aniosDisponibles(mayor: Mayor): number[] {
  const a0 = Number(mayor.inicio.slice(0, 4))
  const a1 = Number(mayor.ultimoMes.slice(0, 4))
  const out: number[] = []
  for (let a = a0; a <= a1; a++) out.push(a)
  return out
}

/** Índices agregados del mayor para consultas rápidas. */
export class Indice {
  /** cuenta → mes → suma */
  porCuentaMes = new Map<string, Map<string, number>>()
  /** tesorería: categoría → mes → suma (sin saldo inicial) */
  tesPorCategoriaMes = new Map<string, Map<string, number>>()
  /** resultado: fuente → mes → suma (en signo ER) */
  resPorFuenteMes = new Map<string, Map<string, number>>()
  /** tesorería: saldo inicial incorporado por mes */
  saldoInicialMes = new Map<string, number>()

  constructor(public mayor: Mayor) {
    const add = (m: Map<string, Map<string, number>>, k: string, mes: string, v: number) => {
      let inner = m.get(k)
      if (!inner) m.set(k, (inner = new Map()))
      inner.set(mes, (inner.get(mes) ?? 0) + v)
    }
    for (const l of mayor.lineas) {
      const mes = ym(l.fecha)
      add(this.porCuentaMes, l.cuenta, mes, l.importe)
      if (l.cuenta.startsWith('tes:')) {
        if (l.categoria === CAT_SALDO_INICIAL || l.fuente === 'ape') {
          this.saldoInicialMes.set(mes, (this.saldoInicialMes.get(mes) ?? 0) + l.importe)
        } else add(this.tesPorCategoriaMes, l.categoria, mes, l.importe)
      }
      if (l.cuenta.startsWith('res:')) add(this.resPorFuenteMes, l.fuente, mes, -l.importe)
    }
  }

  mes(cuenta: string, mes: string): number {
    return this.porCuentaMes.get(cuenta)?.get(mes) ?? 0
  }

  /** Saldo acumulado de la cuenta hasta el fin del mes indicado (inclusive). */
  saldo(cuenta: string, hastaMes: string): number {
    const inner = this.porCuentaMes.get(cuenta)
    if (!inner) return 0
    let s = 0
    for (const [m, v] of inner) if (m <= hastaMes) s += v
    return s
  }

  /** Suma de varias cuentas que cumplen un predicado. */
  saldoDonde(pred: (cuenta: string) => boolean, hastaMes: string): number {
    let s = 0
    for (const k of this.porCuentaMes.keys()) if (pred(k)) s += this.saldo(k, hastaMes)
    return s
  }

  resultadoAcumulado(hastaMes: string): number {
    let s = 0
    for (const [k, inner] of this.porCuentaMes) {
      if (!k.startsWith('res:')) continue
      for (const [m, v] of inner) if (m <= hastaMes) s -= v
    }
    return s
  }
}

function fila(key: string, label: string, valores: number[], extra: Partial<Fila> = {}): Fila {
  const total = valores.reduce((a, b) => a + b, 0)
  // Se guardan sin redondear: el redondeo es solo de presentación, así los cuadres dan 0 exacto.
  return { key, label, valores, total, tipo: 'dato', ...extra }
}

function sumar(filas: Fila[], n: number): number[] {
  const out = new Array(n).fill(0)
  for (const f of filas) f.valores.forEach((v, i) => (out[i] += v))
  return out
}

const GRUPOS_ER_ORDEN: { grupo: GrupoER; titulo: string; total: string }[] = [
  { grupo: 'INGRESOS', titulo: 'I. INGRESOS', total: 'TOTAL INGRESOS' },
  { grupo: 'COSTO DE VENTAS', titulo: 'II. COSTO DE VENTAS', total: 'TOTAL COSTO DE VENTAS' },
  { grupo: 'GASTOS OPERATIVOS', titulo: 'III. GASTOS OPERATIVOS', total: 'TOTAL GASTOS OPERATIVOS' },
  { grupo: 'GASTOS FINANCIEROS', titulo: 'IV. RESULTADO FINANCIERO (cambio de divisas, financiamiento)', total: 'TOTAL RESULTADO FINANCIERO' },
  { grupo: 'IMPUESTOS', titulo: 'V. IMPUESTOS', total: 'TOTAL IMPUESTOS' },
]

const FUENTE_PLURAL: Record<Fuente, string> = {
  mov: 'movimientos de caja y bancos',
  fv: 'facturas de venta',
  fc: 'facturas de proveedores',
  cxm: 'CxC fuera del sistema',
  dev: 'devengos',
  asi: 'asientos manuales',
  dep: 'depreciación de activos',
  ape: 'apertura',
  rem: 'remesas',
}

export interface ResultadoER extends Informe {
  neta: number[]
  ingresos: number[]
}

export function estadoResultados(ds: Dataset, idx: Indice, meses: string[]): ResultadoER {
  const n = meses.length
  const filas: Fila[] = []
  const totales: Record<string, number[]> = {}

  for (const g of GRUPOS_ER_ORDEN) {
    filas.push({ key: `t-${g.grupo}`, label: g.titulo, valores: [], tipo: 'titulo' })
    const cats = ds.categorias.filter((c) => c.grupoER === g.grupo && c.contrapartida === 'resultado').sort((a, b) => a.orden - b.orden)
    const filasGrupo: Fila[] = []
    for (const c of cats) {
      const vals = meses.map((m) => -idx.mes(`res:${c.nombre}`, m))
      if (!c.activa && vals.every((v) => Math.abs(v) < 0.005)) continue
      filasGrupo.push(fila(`res:${c.nombre}`, c.nombre, vals, { detalle: { cuenta: `res:${c.nombre}` } }))
    }
    filas.push(...filasGrupo)
    totales[g.grupo] = sumar(filasGrupo, n)
    filas.push(fila(`tot-${g.grupo}`, g.total, totales[g.grupo], { tipo: 'subtotal' }))

    if (g.grupo === 'COSTO DE VENTAS') {
      const ub = totales.INGRESOS.map((v, i) => v + totales['COSTO DE VENTAS'][i])
      totales.UB = ub
      filas.push(fila('ub', 'UTILIDAD BRUTA', ub, { tipo: 'total' }))
      filas.push(pct('mb', 'Margen bruto %', ub, totales.INGRESOS))
    }
    if (g.grupo === 'GASTOS OPERATIVOS') {
      const ebit = totales.UB.map((v, i) => v + totales['GASTOS OPERATIVOS'][i])
      totales.EBIT = ebit
      filas.push(fila('ebit', 'UTILIDAD OPERATIVA (EBIT)', ebit, { tipo: 'total' }))
    }
    if (g.grupo === 'GASTOS FINANCIEROS') {
      const uai = totales.EBIT.map((v, i) => v + totales['GASTOS FINANCIEROS'][i])
      totales.UAI = uai
      filas.push(fila('uai', 'UTILIDAD ANTES DE IMPUESTOS', uai, { tipo: 'total' }))
    }
  }
  const neta = totales.UAI.map((v, i) => v + totales.IMPUESTOS[i])
  filas.push(fila('neta', 'UTILIDAD NETA', neta, { tipo: 'total' }))
  filas.push(pct('mn', 'Margen neto %', neta, totales.INGRESOS))

  // Control: de dónde sale cada importe del ER.
  filas.push({ key: 't-control', label: 'CONTROL — ORIGEN DE LOS IMPORTES DEL ER', valores: [], tipo: 'titulo' })
  const filasFuente: Fila[] = []
  for (const f of Object.keys(FUENTE_LABEL) as Fuente[]) {
    const vals = meses.map((m) => idx.resPorFuenteMes.get(f)?.get(m) ?? 0)
    if (vals.every((v) => Math.abs(v) < 0.005)) continue
    filasFuente.push(fila(`f-${f}`, `Desde ${FUENTE_PLURAL[f]}`, vals, { tipo: 'control', detalle: { fuente: f, cuenta: 'res:*' } }))
  }
  filas.push(...filasFuente)
  const sumaF = sumar(filasFuente, n)
  filas.push(fila('f-dif', 'Diferencia contra la utilidad neta (debe ser 0)', sumaF.map((v, i) => v - neta[i]), { tipo: 'control' }))

  return { meses, columnas: meses.map(etiquetaMes), filas, conTotal: true, neta: neta.map(r2), ingresos: totales.INGRESOS.map(r2) }
}

function pct(key: string, label: string, num: number[], den: number[]): Fila {
  const tn = num.reduce((a, b) => a + b, 0)
  const td = den.reduce((a, b) => a + b, 0)
  return { key, label, valores: num.map((v, i) => (den[i] ? v / den[i] : 0)), total: td ? tn / td : 0, tipo: 'pct' }
}

export const etiquetaMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`

const GRUPOS_FLUJO_ORDEN: { grupo: GrupoFlujo; titulo: string; total: string }[] = [
  { grupo: 'Explotación', titulo: 'ACTIVIDADES DE EXPLOTACIÓN', total: 'FLUJO DE EXPLOTACIÓN' },
  { grupo: 'Inversión', titulo: 'ACTIVIDADES DE INVERSIÓN', total: 'FLUJO DE INVERSIÓN' },
  { grupo: 'Financiación', titulo: 'ACTIVIDADES DE FINANCIACIÓN', total: 'FLUJO DE FINANCIACIÓN' },
  { grupo: 'Interno', titulo: 'MOVIMIENTOS INTERNOS (cambios de divisas, traspasos, depósitos)', total: 'FLUJO DE MOVIMIENTOS INTERNOS' },
]

export function flujoEfectivo(ds: Dataset, idx: Indice, meses: string[]): Informe {
  const n = meses.length
  const esTes = (k: string) => k.startsWith('tes:')
  const filas: Fila[] = []
  if (!n) return { meses, columnas: [], filas, conTotal: false }

  const saldoIni: number[] = []
  const saldoAntesPrimerMes = idx.saldoDonde(esTes, sumarMeses(meses[0], -1))
  const incorporados = meses.map((m) => idx.saldoInicialMes.get(m) ?? 0)

  const grupoDe = (cat: string): GrupoFlujo => ds.categorias.find((c) => c.nombre === cat)?.grupoFlujo ?? 'Interno'
  const catsConDatos = [...idx.tesPorCategoriaMes.keys()]
  const orden = new Map(ds.categorias.map((c) => [c.nombre, c.orden]))

  const flujosPorGrupo: number[][] = []
  const filasGrupos: Fila[] = []
  for (const g of GRUPOS_FLUJO_ORDEN) {
    filasGrupos.push({ key: `t-${g.grupo}`, label: g.titulo, valores: [], tipo: 'titulo' })
    const cats = catsConDatos.filter((c) => grupoDe(c) === g.grupo).sort((a, b) => (orden.get(a) ?? 9e9) - (orden.get(b) ?? 9e9))
    const fs: Fila[] = []
    for (const c of cats) {
      const vals = meses.map((m) => idx.tesPorCategoriaMes.get(c)?.get(m) ?? 0)
      if (vals.every((v) => Math.abs(v) < 0.005)) continue
      fs.push(fila(`efe:${c}`, c, vals, { detalle: { cuenta: 'tes:*', categoria: c } }))
    }
    filasGrupos.push(...fs)
    const tot = sumar(fs, n)
    flujosPorGrupo.push(tot)
    filasGrupos.push(fila(`tot-${g.grupo}`, g.total, tot, { tipo: 'subtotal' }))
  }

  const variacion = meses.map((_, i) => flujosPorGrupo.reduce((a, g) => a + g[i], 0))
  const saldoFin: number[] = []
  meses.forEach((m, i) => {
    saldoIni.push((i === 0 ? saldoAntesPrimerMes : saldoFin[i - 1]) + incorporados[i])
    saldoFin.push(saldoIni[i] + variacion[i])
  })

  filas.push({ ...fila('ini', 'SALDO INICIAL DE TESORERÍA', saldoIni, { tipo: 'total' }), total: saldoIni[0] })
  if (incorporados.some((v) => Math.abs(v) > 0.005))
    filas.push({ ...fila('inc', '   de ello: saldos de apertura incorporados en el mes', incorporados, { tipo: 'control', detalle: { cuenta: 'tes:*', categoria: CAT_SALDO_INICIAL } }) })
  filas.push(...filasGrupos)
  filas.push(fila('var', 'VARIACIÓN NETA DE TESORERÍA', variacion, { tipo: 'total' }))
  filas.push({ ...fila('fin', 'SALDO FINAL DE TESORERÍA (cajas + bancos − tarjetas)', saldoFin, { tipo: 'total' }), total: saldoFin[n - 1] })
  const real = meses.map((m) => idx.saldoDonde(esTes, m))
  filas.push({ ...fila('chk', 'Comprobación: saldo según cuentas − saldo final (debe ser 0)', real.map((v, i) => v - saldoFin[i]), { tipo: 'control' }), total: undefined })
  return { meses, columnas: meses.map(etiquetaMes), filas, conTotal: true }
}

export function estadoSituacion(ds: Dataset, idx: Indice, meses: string[]): Informe & { cuadre: number[] } {
  const n = meses.length
  const filas: Fila[] = []
  const tipoCuenta = new Map(ds.cuentas.map((c) => [c.nombre, c.tipo]))
  const tesKeys = [...idx.porCuentaMes.keys()].filter((k) => k.startsWith('tes:'))
  const orden = new Map(ds.cuentas.map((c) => [c.nombre, c.orden]))
  tesKeys.sort((a, b) => (orden.get(a.slice(4)) ?? 9e9) - (orden.get(b.slice(4)) ?? 9e9))
  const saldoMeses = (k: string) => meses.map((m) => idx.saldo(k, m))
  const noCero = (v: number[]) => v.some((x) => Math.abs(x) > 0.005)

  const activoC: Fila[] = []
  const activoNC: Fila[] = []
  const pasivo: Fila[] = []
  const patrimonio: Fila[] = []

  for (const k of tesKeys) {
    const nombre = k.slice(4)
    const tipo = tipoCuenta.get(nombre) ?? 'banco'
    const v = saldoMeses(k)
    if (!noCero(v)) continue
    if (tipo === 'tarjeta') pasivo.push(fila(k, `Tarjeta de crédito — ${nombre}`, v.map((x) => -x), { detalle: { cuenta: k } }))
    else activoC.push(fila(k, `${tipo === 'caja' ? 'Efectivo en caja' : 'Banco / pasarela'} — ${nombre}`, v, { detalle: { cuenta: k } }))
  }

  for (const [k, info] of Object.entries(CUENTA_BALANCE_INFO) as [CuentaBalance, (typeof CUENTA_BALANCE_INFO)[CuentaBalance]][]) {
    const v = saldoMeses(k)
    if (info.lado === 'patrimonio') {
      if (noCero(v)) patrimonio.push(fila(k, info.nombre, v.map((x) => -x), { detalle: { cuenta: k } }))
      continue
    }
    if (!noCero(v)) continue
    if (info.lado === 'activo') activoC.push(fila(k, info.nombre, v, { detalle: { cuenta: k } }))
    else if (info.lado === 'activo_nc') activoNC.push(fila(k, info.nombre, v, { detalle: { cuenta: k } }))
    else if (info.lado === 'pasivo') pasivo.push(fila(k, info.nombre, v.map((x) => -x), { detalle: { cuenta: k } }))
    else {
      // Cada cuenta va al lado que le corresponde según el signo de su saldo en cada mes.
      // Según el signo: positivo es activo, negativo es pasivo.
      const pos = v.map((x) => (x > 0 ? x : 0))
      const neg = v.map((x) => (x < 0 ? -x : 0))
      if (noCero(pos)) activoC.push(fila(k, info.nombre, pos, { detalle: { cuenta: k } }))
      if (noCero(neg)) pasivo.push(fila(`${k}-p`, info.nombrePasivo ?? info.nombre, neg, { detalle: { cuenta: k } }))
    }
  }
  patrimonio.push(fila('resultado', 'Resultado del período (desde el inicio)', meses.map((m) => idx.resultadoAcumulado(m)), { detalle: { cuenta: 'res:*' } }))

  const bloque = (titulo: string, fs: Fila[], total: string) => {
    filas.push({ key: `t-${titulo}`, label: titulo, valores: [], tipo: 'titulo' })
    filas.push(...fs)
    const t = sumar(fs, n)
    filas.push(fila(`tot-${titulo}`, total, t, { tipo: 'subtotal' }))
    return t
  }
  const tAC = bloque('ACTIVO CORRIENTE', activoC, 'TOTAL ACTIVO CORRIENTE')
  const tANC = bloque('ACTIVO NO CORRIENTE', activoNC, 'TOTAL ACTIVO NO CORRIENTE')
  const tA = tAC.map((v, i) => v + tANC[i])
  filas.push(fila('ta', 'TOTAL ACTIVO', tA, { tipo: 'total' }))
  const tP = bloque('PASIVO', pasivo, 'TOTAL PASIVO')
  const tE = bloque('PATRIMONIO', patrimonio, 'TOTAL PATRIMONIO')
  const tPE = tP.map((v, i) => v + tE[i])
  filas.push(fila('tpe', 'TOTAL PASIVO + PATRIMONIO', tPE, { tipo: 'total' }))
  const cuadre = tA.map((v, i) => v - tPE[i])
  filas.push(fila('cuadre', 'CUADRE (Activo − Pasivo − Patrimonio) — debe ser 0', cuadre, { tipo: 'control' }))
  // En el balance la columna total no tiene sentido: es un saldo.
  for (const f of filas) delete f.total
  return { meses, columnas: meses.map((m) => `${etiquetaMes(m)}`), filas, conTotal: false, cuadre: cuadre.map(r2) }
}

export function capital(ds: Dataset, idx: Indice, meses: string[], er: ResultadoER): Informe {
  const n = meses.length
  if (!n) return { meses, columnas: [], filas: [], conTotal: false }
  const movCap = meses.map((m) => -idx.mes('capital', m))
  const ini: number[] = []
  const fin: number[] = []
  meses.forEach((m, i) => {
    ini.push(i === 0 ? -idx.saldo('capital', sumarMeses(m, -1)) : fin[i - 1])
    fin.push(ini[i] + movCap[i])
  })
  const aportes = movCap.map((v) => (v > 0 ? v : 0))
  const retiros = movCap.map((v) => (v < 0 ? -v : 0))
  const acum = meses.map((m) => idx.resultadoAcumulado(m))
  const filas: Fila[] = [
    { ...fila('ini', 'Saldo inicial de capital', ini), total: undefined },
    fila('ap', 'Aportes de capital', aportes, { detalle: { cuenta: 'capital' } }),
    fila('re', 'Retiros / dividendos', retiros, { detalle: { cuenta: 'capital' } }),
    { ...fila('fin', 'Saldo final de capital', fin, { tipo: 'subtotal' }), total: undefined },
    fila('rn', 'Resultado neto del mes (ER)', er.neta),
    { ...fila('ra', 'Resultado acumulado desde el inicio', acum, { tipo: 'subtotal' }), total: undefined },
    { ...fila('pat', 'Capital + resultado acumulado', fin.map((v, i) => v + acum[i]), { tipo: 'total' }), total: undefined },
  ]
  return { meses, columnas: meses.map(etiquetaMes), filas, conTotal: true }
}

export function bancos(ds: Dataset, idx: Indice, meses: string[]): Informe {
  const n = meses.length
  const orden = new Map(ds.cuentas.map((c) => [c.nombre, c.orden]))
  const tipo = new Map(ds.cuentas.map((c) => [c.nombre, c.tipo]))
  const tesKeys = [...idx.porCuentaMes.keys()].filter((k) => k.startsWith('tes:'))
  tesKeys.sort((a, b) => (orden.get(a.slice(4)) ?? 9e9) - (orden.get(b.slice(4)) ?? 9e9))
  const filas: Fila[] = [{ key: 't-saldos', label: 'SALDO AL CIERRE DE CADA MES', valores: [], tipo: 'titulo' }]
  const fs: Fila[] = []
  for (const k of tesKeys) {
    const v = meses.map((m) => idx.saldo(k, m))
    const t = tipo.get(k.slice(4))
    fs.push({ ...fila(k, `${k.slice(4)}${t === 'tarjeta' ? ' (tarjeta)' : t === 'caja' ? ' (caja, en USD)' : ''}`, v, { detalle: { cuenta: k } }), total: undefined })
  }
  filas.push(...fs)
  filas.push({ ...fila('tot', 'TOTAL TESORERÍA', sumar(fs, n), { tipo: 'total' }), total: undefined })
  filas.push({ key: 't-mov', label: 'MOVIMIENTO DEL MES POR CUENTA', valores: [], tipo: 'titulo' })
  const fm: Fila[] = []
  for (const k of tesKeys) fm.push(fila(`m-${k}`, k.slice(4), meses.map((m) => idx.mes(k, m)), { detalle: { cuenta: k } }))
  filas.push(...fm)
  filas.push(fila('totm', 'TOTAL MOVIMIENTO', sumar(fm, n), { tipo: 'total' }))
  return { meses, columnas: meses.map(etiquetaMes), filas, conTotal: true }
}

export interface Aviso {
  nivel: 'error' | 'aviso' | 'info'
  titulo: string
  detalle: string
  href?: string
}

export function avisos(ds: Dataset, mayor: Mayor, idx: Indice): Aviso[] {
  const out: Aviso[] = mayor.avisos.map((d) => ({ nivel: 'error' as const, titulo: 'Movimientos sin convertir', detalle: d, href: '/tasas' }))
  const cats = new Set(ds.categorias.map((c) => c.nombre))
  const ultimo = mayor.ultimoMes

  const porClasificar = ds.movimientos.filter((m) => m.categoria === CAT_POR_CLASIFICAR || !cats.has(m.categoria))
  if (porClasificar.length) {
    const total = porClasificar.reduce((a, m) => a + Math.abs(mayor.usd.get(m.id) ?? 0), 0)
    out.push({
      nivel: 'aviso',
      titulo: `${porClasificar.length} movimientos por clasificar`,
      detalle: `Suman ${fmt(total)} USD en valor absoluto. Mientras no tengan categoría, quedan en «Partidas por clasificar» del balance.`,
      href: '/movimientos?categoria=__sin__',
    })
  }
  const desconocidas = [...new Set(ds.movimientos.filter((m) => !cats.has(m.categoria)).map((m) => m.categoria || '(vacía)'))]
  if (desconocidas.length)
    out.push({ nivel: 'aviso', titulo: 'Categorías que no están en el catálogo', detalle: desconocidas.join(', '), href: '/registros/categorias' })

  const transito = idx.saldo('transito', ultimo)
  if (Math.abs(transito) > 1)
    out.push({
      nivel: 'aviso',
      titulo: 'Traspasos sin contrapartida',
      detalle: `Las partidas en tránsito (traspasos, depósitos, cambios de divisas, pagos de tarjeta) suman ${fmt(transito)} USD. Si cada traspaso tiene sus dos lados registrados, este saldo debe ser 0.`,
      href: '/mayor?cuenta=transito',
    })

  const sinCosto = ds.activos.filter((a) => !a.costo)
  if (sinCosto.length)
    out.push({ nivel: 'aviso', titulo: `${sinCosto.length} activos fijos sin costo`, detalle: 'Sin el costo no entran al balance ni se deprecian.', href: '/registros/activos' })

  const mesesCUP = new Set(ds.movimientos.filter((m) => m.moneda !== 'USD').map((m) => ym(m.fecha)))
  const confirmados = new Set(ds.tasas.filter((t) => t.confirmada).map((t) => ym(t.fecha)))
  const sinConfirmar = [...mesesCUP].filter((m) => !confirmados.has(m)).sort()
  if (sinConfirmar.length)
    out.push({
      nivel: 'aviso',
      titulo: 'Tasas de cambio sin confirmar',
      detalle: `Hay movimientos en CUP/EUR en ${sinConfirmar.map(etiquetaMes).join(', ')} y ninguna tasa de esos meses está marcada como confirmada.`,
      href: '/registros/tasas',
    })

  // Devengos que no coinciden con ningún pago registrado.
  for (const d of ds.devengos) {
    const ok = ds.movimientos.some(
      (m) => m.categoria === d.categoria && Math.abs(Math.abs(mayor.usd.get(m.id) ?? 0) - d.importe) < 1 && Math.abs(Date.parse(m.fecha) - Date.parse(d.fechaPago)) <= 7 * 86400000,
    )
    if (!ok)
      out.push({
        nivel: 'aviso',
        titulo: 'Devengo sin pago coincidente',
        detalle: `«${d.concepto}» (${fmt(d.importe)} USD, ${d.fechaPago}): no hay un movimiento de la categoría «${d.categoria}» por ese importe cerca de esa fecha. El ajuste quita del ER un gasto que no estaba.`,
        href: '/registros/devengos',
      })
  }

  const ajuste = -idx.saldo('apertura', ultimo)
  if (Math.abs(ajuste) > 1)
    out.push({
      nivel: 'info',
      titulo: 'Ajuste de apertura',
      detalle: `Los saldos iniciales cargados (cajas, bancos, CxC, CxP, activos) no coinciden con el capital de apertura de ${fmt(ds.settings.capitalApertura)} USD. La diferencia, ${fmt(ajuste)} USD, se muestra en el patrimonio como «Ajuste de apertura».`,
      href: '/apertura',
    })

  const hoyStr = hoy()
  const vencidas = ds.facturas.filter((f) => f.afectaER && f.monto - f.cobrado > 0.01 && f.vencimiento && f.vencimiento < hoyStr)
  if (vencidas.length)
    out.push({
      nivel: 'info',
      titulo: `${vencidas.length} facturas vencidas según el sistema de facturación`,
      detalle: `Pendiente total ${fmt(vencidas.reduce((a, f) => a + f.monto - f.cobrado, 0))} USD.`,
      href: '/facturacion?estado=Vencida',
    })
  return out
}

export function fmt(n: number, dec = 2): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: 'always' } as Intl.NumberFormatOptions)
}

export function estadoFactura(f: { monto: number; cobrado: number; vencimiento?: string }, hoyStr = hoy()) {
  const pendiente = (f.monto || 0) - (f.cobrado || 0)
  if (pendiente <= 0.01) return { pendiente: 0, estado: 'Cobrada' as const, dias: 0 }
  const dias = f.vencimiento ? Math.max(0, Math.round((Date.parse(hoyStr) - Date.parse(f.vencimiento)) / 86400000)) : 0
  return { pendiente, estado: dias > 0 ? ('Vencida' as const) : ('Vigente' as const), dias }
}

export { finDeMes, CAT_INGRESOS_FACTURADOS }
