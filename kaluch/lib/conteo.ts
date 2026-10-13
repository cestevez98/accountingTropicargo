import type { DisponibleTPV } from './sincro'
import type { LineaConteo, Producto } from './types'

/**
 * Conteo físico a ciegas. Funciones puras (sin red) para poder probarlas.
 */

/** Catálogo compacto para el escáner: [código, nombre, ...códigos de barras]. */
export type FilaEscaner = [string, string, ...string[]]

export function catalogoEscaner(productos: Producto[]): FilaEscaner[] {
  return productos.filter((p) => p.codigo && p.codigo !== p.nombre).map((p) => [p.codigo, p.nombre, ...(p.barras ?? [])] as FilaEscaner)
}

/** Índice código/código de barras → [código, nombre]. Se usa en el navegador del trabajador. */
export function indiceEscaner(filas: FilaEscaner[]) {
  const m = new Map<string, { codigo: string; nombre: string }>()
  for (const [codigo, nombre, ...barras] of filas) {
    const p = { codigo, nombre }
    for (const b of barras) if (!m.has(b)) m.set(b, p)
  }
  // El código interno gana sobre un código de barras igual de otro artículo.
  for (const [codigo, nombre] of filas) m.set(codigo, { codigo, nombre })
  return m
}

/** Suma una lectura al conteo (si ya estaba, acumula la cantidad). */
export function sumarLectura(lineas: LineaConteo[], l: LineaConteo): LineaConteo[] {
  const i = lineas.findIndex((x) => x.codigo === l.codigo)
  if (i < 0) return [l, ...lineas]
  const copia = [...lineas]
  copia[i] = { ...copia[i], cantidad: Math.round((copia[i].cantidad + l.cantidad) * 1000) / 1000 }
  // La última leída sube arriba para que el trabajador la vea.
  return [copia[i], ...copia.filter((_, k) => k !== i)]
}

/**
 * Resultado de un conteo: lo contado contra la existencia del TPV en las áreas de la tienda.
 * Solo se comparan los productos contados (los conteos diarios son parciales).
 */
export function resultadoConteo(lineas: LineaConteo[], disponibles: DisponibleTPV[], areas: string[], productos: Producto[]) {
  const sistema = new Map<string, number>()
  for (const d of disponibles)
    if (areas.includes(String(d.objectCode)))
      for (const a of d.ItemsAvailability ?? []) sistema.set(String(a.Code), (sistema.get(String(a.Code)) ?? 0) + (Number(a.Amount) || 0))
  const costo = new Map(productos.map((p) => [p.codigo, p.costoUSD]))
  return lineas.map((l) => {
    const s = Math.round((sistema.get(l.codigo) ?? 0) * 1000) / 1000
    return { codigo: l.codigo, nombre: l.nombre, contado: l.cantidad, sistema: s, diferencia: Math.round((l.cantidad - s) * 1000) / 1000, costoUSD: costo.get(l.codigo) }
  })
}
