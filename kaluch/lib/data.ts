import 'server-only'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { DEFAULT_SETTINGS } from './catalogo'
import { DEFECTOS } from './defectos'
import { Indice, type Vista } from './informes'
import { construirMayor, type Mayor } from './mayor'
import { leer, leerVarias, mutar, versionDatos } from './store'
import type { AuditEntry, Dataset, Usuario } from './types'

let derivado: { version: number; mayor: Mayor; idx: Indice } | null = null

/** Carga todo el dataset (una vez por petición). */
export const cargarDataset = cache(async (): Promise<Dataset> => {
  const d = (await leerVarias({ ...DEFECTOS } as unknown as Record<string, unknown>)) as unknown as Dataset
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

export async function leerAuditoria(): Promise<AuditEntry[]> {
  return leer<AuditEntry[]>('auditoria', [])
}

export async function registrarAuditoria(entradas: Omit<AuditEntry, 'id' | 'ts'>[]) {
  await mutar({ auditoria: [] as AuditEntry[] }, ({ auditoria }) => {
    const ts = new Date().toISOString()
    const nuevas = entradas.map((e) => ({ ...e, id: crypto.randomUUID(), ts }))
    return { auditoria: [...nuevas, ...auditoria].slice(0, 5000) }
  })
}

/** Preferencias de la barra superior (tienda seleccionada y moneda de los informes). */
export async function preferencias(): Promise<{ tienda?: string; vista: Vista }> {
  const c = await cookies()
  const t = c.get('ka_tienda')?.value
  return { tienda: t && t !== 'all' ? t : undefined, vista: c.get('ka_vista')?.value === 'CUP' ? 'CUP' : 'USD' }
}
