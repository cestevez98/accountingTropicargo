import type { Producto } from './types'

/**
 * Casar los productos que vinieron de los Excel (solo nombre) con las mercancías del TPV (con código).
 * Las sugerencias se ordenan por parecido; solo se dan por seguras las que coinciden igual ignorando
 * mayúsculas, tildes, signos y el orden de las palabras. El resto lo confirma una persona: «CHAMPU
 * VOLUMEN» se parece a «ACONDICIONADOR VOLUMEN» y no es lo mismo.
 */

export const normalizar = (s: string) =>
  s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()

const palabras = (s: string) => new Set(normalizar(s).split(' ').filter((w) => w.length > 1))

export const esDelTPV = (p: Producto) => Boolean(p.codigo) && p.codigo !== p.nombre

export interface Candidato {
  nombre: string
  codigo: string
  parecido: number
}

/** Parecido entre dos nombres: proporción de palabras en común (Jaccard), 1 si son iguales normalizados. */
export function parecido(a: string, b: string) {
  if (normalizar(a).replace(/ /g, '') === normalizar(b).replace(/ /g, '')) return 1
  const x = palabras(a)
  const y = palabras(b)
  if (!x.size || !y.size) return 0
  const comun = [...x].filter((w) => y.has(w)).length
  return comun / (x.size + y.size - comun)
}

/** Productos del Excel sin casar, con sus mejores candidatos del TPV y cuántos registros los usan. */
export function propuestasCasar(productos: Producto[], uso: Map<string, number>, max = 3) {
  const tpv = productos.filter(esDelTPV).map((p) => ({ p, w: palabras(p.nombre), n: normalizar(p.nombre).replace(/ /g, '') }))
  const porNorm = new Map(tpv.map((t) => [t.n, t.p]))
  return productos
    .filter((p) => !esDelTPV(p))
    .map((p) => {
      const exacto = porNorm.get(normalizar(p.nombre).replace(/ /g, ''))
      const w = palabras(p.nombre)
      const cands: Candidato[] = exacto
        ? [{ nombre: exacto.nombre, codigo: exacto.codigo, parecido: 1 }]
        : tpv
            .map((t) => {
              const comun = [...w].filter((x) => t.w.has(x)).length
              return { nombre: t.p.nombre, codigo: t.p.codigo, parecido: comun ? comun / (w.size + t.w.size - comun) : 0 }
            })
            .filter((c) => c.parecido >= 0.3)
            .sort((a, b) => b.parecido - a.parecido)
            .slice(0, max)
      return { nombre: p.nombre, uso: uso.get(p.nombre) ?? 0, candidatos: cands, seguro: Boolean(cands[0] && (cands[0].parecido === 1 || palabrasIguales(p.nombre, cands[0].nombre))) }
    })
    .sort((a, b) => Number(b.seguro) - Number(a.seguro) || b.uso - a.uso || a.nombre.localeCompare(b.nombre))
}

function palabrasIguales(a: string, b: string) {
  const x = palabras(a)
  const y = palabras(b)
  return x.size === y.size && [...x].every((w) => y.has(w))
}
