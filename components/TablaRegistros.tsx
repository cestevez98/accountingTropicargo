'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { borrarRegistro, cambiarCategoria } from '@/app/acciones'
import type { Campo } from '@/lib/colecciones'
import { FormRegistro, type Opciones } from './FormRegistro'

export interface ColumnaExtra {
  key: string
  label: string
  tipo: 'numero' | 'texto' | 'badge'
  despues?: string
}

type Fila = Record<string, unknown> & { id: string }

const nf = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true } as Intl.NumberFormatOptions)
const fmt = (v: unknown) => {
  const n = Number(v)
  return v == null || v === '' || !Number.isFinite(n) ? '' : nf.format(n)
}

const BADGE: Record<string, string> = {
  Cobrada: 'bg-emerald-100 text-emerald-800',
  Pagada: 'bg-emerald-100 text-emerald-800',
  Vigente: 'bg-sky-100 text-sky-800',
  Vencida: 'bg-red-100 text-red-700',
  Cuadra: 'bg-emerald-100 text-emerald-800',
  Disponible: 'bg-sky-100 text-sky-800',
  Vendido: 'bg-slate-200 text-slate-700',
}

export function TablaRegistros({
  coleccion,
  singular,
  campos,
  extras = [],
  filas,
  sumas,
  opciones,
  puedeEditar,
  puedeCrear = puedeEditar,
  seleccion = false,
  textoVacio = 'No hay registros con estos filtros.',
}: {
  coleccion: string
  singular: string
  campos: Campo[]
  extras?: ColumnaExtra[]
  filas: Fila[]
  sumas: Record<string, number>
  opciones: Opciones
  puedeEditar: boolean
  puedeCrear?: boolean
  seleccion?: boolean
  textoVacio?: string
}) {
  const router = useRouter()
  const [editando, setEditando] = useState<Fila | null | 'nuevo'>(null)
  const [plantilla, setPlantilla] = useState<Fila | null>(null)
  const [aviso, setAviso] = useState<{ ok: boolean; txt: string } | null>(null)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [catMasiva, setCatMasiva] = useState('')
  const [pendiente, start] = useTransition()

  const visibles = campos.filter((c) => c.tabla)
  const columnas: ({ tipo: 'campo'; c: Campo } | { tipo: 'extra'; e: ColumnaExtra })[] = []
  for (const c of visibles) {
    columnas.push({ tipo: 'campo', c })
    for (const e of extras.filter((x) => x.despues === c.key)) columnas.push({ tipo: 'extra', e })
  }
  for (const e of extras.filter((x) => !x.despues)) columnas.push({ tipo: 'extra', e })

  const mostrar = (ok: boolean, txt: string) => {
    setAviso({ ok, txt })
    setTimeout(() => setAviso(null), 4000)
  }

  function borrar(f: Fila) {
    if (!confirm(`¿Borrar este ${singular}? Esta acción queda registrada en la auditoría.`)) return
    start(async () => {
      const r = await borrarRegistro(coleccion, f.id)
      mostrar(r.ok, r.ok ? (r.mensaje ?? 'Borrado.') : r.error)
      if (r.ok) router.refresh()
    })
  }

  function clasificar() {
    if (!catMasiva || !marcados.size) return
    start(async () => {
      const r = await cambiarCategoria([...marcados], catMasiva)
      mostrar(r.ok, r.ok ? (r.mensaje ?? '') : r.error)
      if (r.ok) {
        setMarcados(new Set())
        router.refresh()
      }
    })
  }

  const todosMarcados = filas.length > 0 && filas.every((f) => marcados.has(f.id))

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {puedeCrear && (
          <button
            className="btn btn-primario"
            onClick={() => {
              setPlantilla(null)
              setEditando('nuevo')
            }}
          >
            + Nuevo {singular}
          </button>
        )}
        {seleccion && puedeEditar && marcados.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-marca-500/40 bg-marca-50 px-3 py-1.5 text-sm">
            <span>{marcados.size} seleccionados →</span>
            <select value={catMasiva} onChange={(e) => setCatMasiva(e.target.value)} className="input !w-auto !py-1">
              <option value="">Cambiar categoría a…</option>
              {opciones.categorias.map((g) => (
                <optgroup key={g.grupo} label={g.grupo}>
                  {g.nombres.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button className="btn btn-primario !py-1" disabled={!catMasiva || pendiente} onClick={clasificar}>
              Aplicar
            </button>
          </div>
        )}
        {aviso && <span className={`rounded-md px-3 py-1.5 text-sm ${aviso.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{aviso.txt}</span>}
      </div>

      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              {seleccion && puedeEditar && (
                <th className="w-8">
                  <input
                    type="checkbox"
                    checked={todosMarcados}
                    onChange={() => setMarcados(todosMarcados ? new Set() : new Set(filas.map((f) => f.id)))}
                    aria-label="Seleccionar todo"
                  />
                </th>
              )}
              {columnas.map((col) =>
                col.tipo === 'campo' ? (
                  <th key={col.c.key} className={col.c.tipo === 'numero' ? 'num' : ''}>
                    {col.c.label}
                  </th>
                ) : (
                  <th key={col.e.key} className={col.e.tipo === 'numero' ? 'num' : ''}>
                    {col.e.label}
                  </th>
                ),
              )}
              {puedeEditar && <th className="w-28" />}
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr>
                <td colSpan={columnas.length + 2} className="py-8 text-center text-slate-500">
                  {textoVacio}
                </td>
              </tr>
            )}
            {filas.map((f) => (
              <tr key={f.id}>
                {seleccion && puedeEditar && (
                  <td>
                    <input
                      type="checkbox"
                      checked={marcados.has(f.id)}
                      onChange={() => {
                        const s = new Set(marcados)
                        if (s.has(f.id)) s.delete(f.id)
                        else s.add(f.id)
                        setMarcados(s)
                      }}
                    />
                  </td>
                )}
                {columnas.map((col) => {
                  if (col.tipo === 'extra') {
                    const v = f[col.e.key]
                    if (col.e.tipo === 'numero') return <td key={col.e.key} className="num">{fmt(v)}</td>
                    if (col.e.tipo === 'badge')
                      return (
                        <td key={col.e.key}>
                          {v ? <span className={`rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${BADGE[String(v)] ?? 'bg-amber-100 text-amber-800'}`}>{String(v)}</span> : null}
                        </td>
                      )
                    return <td key={col.e.key} className="text-slate-600">{String(v ?? '')}</td>
                  }
                  const c = col.c
                  const v = f[c.key]
                  if (c.tipo === 'numero') return <td key={c.key} className="num">{fmt(v)}</td>
                  if (c.tipo === 'bool') return <td key={c.key}>{v ? 'Sí' : ''}</td>
                  if (c.tipo === 'fecha') return <td key={c.key} className="whitespace-nowrap">{String(v ?? '')}</td>
                  const s = Array.isArray(v) ? v.join(', ') : String(v ?? '')
                  const sinClasificar = c.key === 'categoria' && (s === 'Por clasificar' || !s)
                  return (
                    <td key={c.key} className={`${c.tipo === 'textarea' || c.key === 'concepto' ? 'max-w-sm' : 'whitespace-nowrap'} ${sinClasificar ? 'font-medium text-amber-700' : ''}`}>
                      {s}
                    </td>
                  )
                })}
                {puedeEditar && (
                  <td className="whitespace-nowrap text-right">
                    <button className="px-1.5 text-marca-600 hover:underline" onClick={() => setEditando(f)}>
                      Editar
                    </button>
                    <button
                      className="px-1.5 text-slate-500 hover:underline"
                      title="Crear uno nuevo copiando este"
                      onClick={() => {
                        const { id: _id, ...resto } = f
                        setPlantilla({ ...resto, id: '' } as Fila)
                        setEditando('nuevo')
                      }}
                    >
                      Copiar
                    </button>
                    <button className="px-1.5 text-red-600 hover:underline" disabled={pendiente} onClick={() => borrar(f)}>
                      Borrar
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {Object.keys(sumas).length > 0 && filas.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-medium">
                {seleccion && puedeEditar && <td />}
                {columnas.map((col, i) => {
                  const k = col.tipo === 'campo' ? col.c.key : col.e.key
                  return (
                    <td key={k} className={k in sumas ? 'num' : ''}>
                      {k in sumas ? fmt(sumas[k]) : i === 0 ? 'Total (todas las páginas)' : ''}
                    </td>
                  )
                })}
                {puedeEditar && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {editando && (
        <FormRegistro
          coleccion={coleccion}
          singular={singular}
          campos={campos}
          opciones={opciones}
          registro={editando === 'nuevo' ? null : editando}
          plantilla={editando === 'nuevo' ? plantilla : null}
          onCerrar={() => setEditando(null)}
          onGuardado={(m) => {
            mostrar(true, m)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
