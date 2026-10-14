import { DEFAULT_CATEGORIAS, DEFAULT_SETTINGS, DEFAULT_TIENDAS } from './catalogo'
import type { Dataset } from './types'

export const DEFECTOS: Dataset = {
  settings: DEFAULT_SETTINGS,
  tiendas: DEFAULT_TIENDAS,
  categorias: DEFAULT_CATEGORIAS,
  tasas: [],
  movimientos: [],
  salidas: [],
  compras: [],
  deudas: [],
  asientos: [],
  productos: [],
  distribuciones: [],
  importaciones: [],
  conteos: [],
  arqueos: [],
  nomina: [],
  referencias: {},
}

/** Colecciones con datos operativos (las que se vacían al reiniciar). */
export const COLECCIONES_OPERATIVAS = ['tasas', 'movimientos', 'salidas', 'compras', 'deudas', 'asientos', 'productos', 'distribuciones', 'importaciones', 'referencias', 'conteos', 'arqueos', 'nomina'] as const
