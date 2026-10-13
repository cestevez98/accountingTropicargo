import type { Campo, ColeccionConfig } from './colecciones'
import { param } from './pagina'

export const POR_PAGINA = 100

export interface Listado<T> {
  filas: T[]
  total: number
  pagina: number
  paginas: number
  sumas: Record<string, number>
  opcionesFiltro: Record<string, string[]>
  filtros: Record<string, string>
}

type Rec = Record<string, unknown> & { id: string }

/**
 * Filtra, ordena y pagina una colección según los parámetros de la URL:
 * q (texto), desde / hasta (fechas), mes (AAAA-MM), id, p (página) y un parámetro por cada campo con filtro.
 * `extra` permite filtros adicionales propios de cada página.
 */
export function listar<T extends Rec>(
  cfg: ColeccionConfig,
  datos: T[],
  sp: Record<string, string | string[] | undefined>,
  extra?: (r: T) => boolean,
  sumarExtra: string[] = [],
): Listado<T> {
  const filtros: Record<string, string> = {}
  for (const k of ['q', 'desde', 'hasta', 'mes', 'id', ...cfg.campos.filter((c) => c.filtro).map((c) => c.key)]) {
    const v = param(sp, k)
    if (v) filtros[k] = v
  }
  const opcionesFiltro: Record<string, string[]> = {}
  for (const c of cfg.campos.filter((c) => c.filtro)) {
    opcionesFiltro[c.key] =
      c.tipo === 'bool'
        ? ['Sí', 'No']
        : [...new Set(datos.map((r) => r[c.key]).filter((v) => v != null && v !== '').map(String))].sort((a, b) => a.localeCompare(b, 'es'))
  }

  const f = cfg.campoFecha
  const q = filtros.q?.toLowerCase()
  const camposBusqueda = cfg.busqueda
  const filtrados = datos.filter((r) => {
    if (filtros.id) return r.id === filtros.id
    if (f) {
      const fecha = String(r[f] ?? '')
      if (filtros.desde && fecha < filtros.desde) return false
      if (filtros.hasta && fecha > filtros.hasta) return false
      if (filtros.mes && !fecha.startsWith(filtros.mes)) return false
    }
    for (const c of cfg.campos) {
      if (!c.filtro || !filtros[c.key]) continue
      const v = filtros[c.key]
      if (c.tipo === 'bool') {
        if (Boolean(r[c.key]) !== (v === 'Sí')) return false
      } else if (String(r[c.key] ?? '') !== v) return false
    }
    if (q) {
      const txt = camposBusqueda.map((k) => String(r[k] ?? '')).join(' ').toLowerCase()
      const num = Number(q.replace(',', '.'))
      const coincideImporte =
        Number.isFinite(num) && cfg.campos.some((c: Campo) => c.tipo === 'numero' && Math.abs(Number(r[c.key] ?? NaN) - num) < 0.005)
      if (!txt.includes(q) && !coincideImporte) return false
    }
    return extra ? extra(r) : true
  })
  if (f) filtrados.sort((a, b) => String(b[f] ?? '').localeCompare(String(a[f] ?? '')))

  const sumas: Record<string, number> = {}
  for (const k of [...cfg.campos.filter((c) => c.sumar).map((c) => c.key), ...sumarExtra]) {
    sumas[k] = filtrados.reduce((a, r) => a + (Number(r[k]) || 0), 0)
  }
  const total = filtrados.length
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const pagina = Math.min(paginas, Math.max(1, Number(param(sp, 'p')) || 1))
  return { filas: filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA), total, pagina, paginas, sumas, opcionesFiltro, filtros }
}
