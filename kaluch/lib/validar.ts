import { CAT_POR_CLASIFICAR } from './catalogo'
import { prepararTasas, tasaVigente } from './fx'
import type { Categoria, Dataset, Movimiento, Tienda } from './types'

/** Distancia de edición (para sugerir la categoría que se quiso escribir). */
export function distancia(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 1; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[m][n]
}

const normal = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')

/** Resuelve un nombre de categoría escrito a mano: exacto, sin acentos/espacios, o sugerencia. */
export function resolverCategoria(nombre: string, categorias: Categoria[]): { categoria?: string; sugerencia?: string } {
  const n = normal(nombre)
  const exacta = categorias.find((c) => normal(c.nombre) === n)
  if (exacta) return { categoria: exacta.nombre }
  let mejor: { c: string; d: number } | undefined
  for (const c of categorias) {
    const d = distancia(normal(c.nombre), n)
    if (!mejor || d < mejor.d) mejor = { c: c.nombre, d }
  }
  return { sugerencia: mejor && mejor.d <= Math.max(2, Math.floor(n.length / 4)) ? mejor.c : undefined }
}

/** Resuelve el «Mercado» del Excel o del TPV a una tienda del catálogo. */
export function resolverTienda(nombre: string | undefined, tiendas: Tienda[], defecto?: string): string | undefined {
  if (!nombre) return defecto
  const n = normal(nombre).replace(/\s/g, '')
  const t = tiendas.find((t) => [t.id, t.nombre, t.codigoTPV ?? '', ...(t.alias ?? [])].some((a) => a && normal(a).replace(/\s/g, '') === n))
  return t?.id
}

/** Reglas de autoclasificación cuando el Excel no trae categoría. */
export function inferirCategoria(concepto = '', observaciones = ''): string | undefined {
  const t = normal(`${concepto} ${observaciones}`)
  if (/DIVISA|CAMBIO DE MONEDA/.test(t)) return 'CAMBIO DIVISAS'
  if (/SALARIO.*(TURNO|DEPENDIENTE)/.test(t)) return 'SALARIO DEPENDIENTE'
  if (/SEGURIDAD/.test(t)) return 'SALARIO SEGURIDAD'
  if (/TRANSPORTE|TAXI|COMBUSTIBLE/.test(t)) return 'TRANSPORTE'
  return undefined
}

export interface Problema {
  fila: number
  nivel: 'error' | 'aviso'
  mensaje: string
}

/** Clave para detectar movimientos ya importados. */
export const claveMovimiento = (m: Pick<Movimiento, 'libro' | 'fecha' | 'tienda' | 'tipo' | 'moneda' | 'monto' | 'categoria' | 'concepto' | 'cuenta'>) =>
  [m.libro, m.fecha, m.tienda, m.tipo, m.moneda, Math.round(m.monto * 100), m.categoria, normal(m.concepto ?? ''), normal(m.cuenta ?? '')].join('|')

/**
 * Valida movimientos de caja/banco antes de guardarlos: categoría del catálogo, tasa del día y
 * duplicados frente a lo ya registrado (se cuentan las repeticiones: dos salarios iguales el mismo
 * día en el archivo son dos filas válidas si en el sistema solo hay una).
 */
export function validarMovimientos(filas: (Movimiento & { _fila: number })[], ds: Pick<Dataset, 'movimientos' | 'tasas' | 'categorias' | 'settings'>): Problema[] {
  const problemas: Problema[] = []
  const existentes = new Map<string, number>()
  for (const m of ds.movimientos) {
    const k = claveMovimiento(m)
    existentes.set(k, (existentes.get(k) ?? 0) + 1)
  }
  const tabla = prepararTasas(ds.tasas, ds.settings.margenTasa)
  const conTasa = new Set(ds.tasas.filter((t) => t.cupUsd > 0).map((t) => t.fecha))
  const cats = new Map(ds.categorias.map((c) => [c.nombre, c]))
  for (const m of filas) {
    if (m.categoria === CAT_POR_CLASIFICAR) problemas.push({ fila: m._fila, nivel: 'aviso', mensaje: 'Sin categoría: queda «Por clasificar».' })
    else if (!cats.has(m.categoria)) {
      const r = resolverCategoria(m.categoria, ds.categorias)
      problemas.push({ fila: m._fila, nivel: 'error', mensaje: `Categoría «${m.categoria}» no existe en el catálogo${r.sugerencia ? ` — ¿quisiste decir ${r.sugerencia}?` : ''}` })
    }
    if (m.moneda !== 'USD' && !conTasa.has(m.fecha)) {
      const t = tasaVigente(tabla, m.fecha)
      if (!t) problemas.push({ fila: m._fila, nivel: 'error', mensaje: `Sin tasa de cambio para ${m.fecha}` })
      else problemas.push({ fila: m._fila, nivel: 'aviso', mensaje: `Sin tasa para ${m.fecha}: se usa la del ${t.fecha} (${t.cupUsd}).` })
    }
    const k = claveMovimiento(m)
    const n = existentes.get(k) ?? 0
    if (n > 0) {
      existentes.set(k, n - 1)
      problemas.push({ fila: m._fila, nivel: 'error', mensaje: 'Duplicado: este movimiento ya está registrado.' })
    }
  }
  return problemas
}

/** Avisa de saltos en la numeración de operaciones de venta de una tienda. */
export function saltosDeConsecutivo(ops: { tienda: string; operacion?: string; fila: number }[]): Problema[] {
  const porTienda = new Map<string, { n: number; fila: number }[]>()
  for (const o of ops) {
    const n = Number(o.operacion)
    if (!Number.isInteger(n)) continue
    const arr = porTienda.get(o.tienda) ?? []
    arr.push({ n, fila: o.fila })
    porTienda.set(o.tienda, arr)
  }
  const out: Problema[] = []
  for (const [tienda, arr] of porTienda) {
    const nums = [...new Set(arr.map((a) => a.n))].sort((a, b) => a - b)
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] - nums[i - 1] > 1) {
        const faltan = nums[i] - nums[i - 1] - 1
        const fila = arr.find((a) => a.n === nums[i])!.fila
        out.push({ fila, nivel: 'aviso', mensaje: `Salto de consecutivo en ${tienda}: falta${faltan > 1 ? 'n' : ''} ${faltan > 1 ? `${faltan} operaciones (#${nums[i - 1] + 1}–#${nums[i] - 1})` : `la operación #${nums[i - 1] + 1}`}` })
      }
    }
  }
  return out
}
