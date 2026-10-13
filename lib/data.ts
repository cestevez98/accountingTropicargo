import 'server-only'
import { cache } from 'react'
import { DEFAULT_CATEGORIAS, DEFAULT_CUENTAS, DEFAULT_SETTINGS } from './catalog'
import { construirMayor, type Mayor } from './ledger'
import { Indice } from './reports'
import { leer, leerVarias, mutar, versionDatos } from './store'
import type { AuditEntry, Dataset, Usuario } from './types'

export const DEFECTOS: Dataset = {
  settings: DEFAULT_SETTINGS,
  categorias: DEFAULT_CATEGORIAS,
  cuentas: DEFAULT_CUENTAS,
  tasas: [],
  movimientos: [],
  facturas: [],
  facturasCompra: [],
  pagosProveedor: [],
  cxcManual: [],
  activos: [],
  paquetes: [],
  devengos: [],
  asientos: [],
}

/** Colecciones de datos operativos (lo que se vacía al borrar los datos de prueba). */
export const COLECCIONES_OPERATIVAS = [
  'movimientos',
  'facturas',
  'facturasCompra',
  'pagosProveedor',
  'cxcManual',
  'activos',
  'paquetes',
  'devengos',
  'asientos',
  'tasas',
] as const

let derivado: { version: number; mayor: Mayor; idx: Indice } | null = null

/** Carga todo el dataset (una vez por petición). */
export const cargarDataset = cache(async (): Promise<Dataset> => {
  const ds = await leerVarias({ ...DEFECTOS } as unknown as Record<string, unknown>)
  const d = ds as unknown as Dataset
  d.settings = { ...DEFAULT_SETTINGS, ...d.settings }
  return d
})

/** Dataset + libro mayor + índice, reutilizados entre peticiones mientras los datos no cambien. */
export const cargarContabilidad = cache(async () => {
  const version = await versionDatos()
  const ds = await cargarDataset()
  if (!derivado || derivado.version !== version) {
    const mayor = construirMayor(ds)
    derivado = { version, mayor, idx: new Indice(mayor) }
  }
  return { ds, mayor: derivado.mayor, idx: derivado.idx, version }
})

export async function leerUsuarios(): Promise<Usuario[]> {
  return leer<Usuario[]>('usuarios', [])
}

export async function registrarAuditoria(entradas: Omit<AuditEntry, 'id' | 'ts'>[]) {
  await mutar({ auditoria: [] as AuditEntry[] }, ({ auditoria }) => {
    const ts = new Date().toISOString()
    const nuevas = entradas.map((e) => ({ ...e, id: crypto.randomUUID(), ts }))
    return { auditoria: [...nuevas, ...auditoria].slice(0, 5000) }
  })
}
