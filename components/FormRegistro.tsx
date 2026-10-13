'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { guardarRegistro } from '@/app/acciones'
import type { Campo } from '@/lib/colecciones'

export interface Opciones {
  categorias: { grupo: string; nombres: string[] }[]
  cuentas: string[]
  cuentasMayor: { grupo: string; items: { value: string; label: string }[] }[]
}

type Valores = Record<string, unknown>

function valorInicial(c: Campo, r: Valores | null, plantilla: Valores | null): string | boolean {
  const v = r?.[c.key] ?? plantilla?.[c.key] ?? c.defecto
  if (c.tipo === 'bool') return Boolean(v)
  if (c.tipo === 'lista') return Array.isArray(v) ? v.join(', ') : String(v ?? '')
  return v == null ? '' : String(v)
}

export function FormRegistro({
  coleccion,
  singular,
  campos,
  opciones,
  registro,
  plantilla,
  onCerrar,
  onGuardado,
}: {
  coleccion: string
  singular: string
  campos: Campo[]
  opciones: Opciones
  registro: Valores | null
  plantilla?: Valores | null
  onCerrar: () => void
  onGuardado: (msg: string) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, start] = useTransition()
  const [clave, setClave] = useState(0)
  const [ultimo, setUltimo] = useState<Valores | null>(plantilla ?? null)

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const id = registro ? String(registro.id) : null

  function leer(form: HTMLFormElement): Valores {
    const fd = new FormData(form)
    const out: Valores = {}
    for (const c of campos) out[c.key] = c.tipo === 'bool' ? fd.get(c.key) === 'on' : (fd.get(c.key) ?? '')
    return out
  }

  function enviar(seguir: boolean) {
    const form = formRef.current
    if (!form || !form.reportValidity()) return
    const valores = leer(form)
    setError(null)
    start(async () => {
      const r = await guardarRegistro(coleccion, id, valores)
      if (!r.ok) return setError(r.error)
      onGuardado(r.mensaje ?? 'Guardado.')
      if (seguir) {
        // «Guardar y nuevo»: conserva fecha, cuenta, categoría y moneda para cargar rápido.
        const keep: Valores = {}
        for (const k of ['fecha', 'cuenta', 'categoria', 'moneda', 'proveedor', 'emision', 'fechaPago', 'mesCorresponde']) if (k in valores) keep[k] = valores[k]
        setUltimo(keep)
        setClave((k) => k + 1)
        setTimeout(() => form.querySelector<HTMLElement>('[data-foco]')?.focus(), 30)
      } else onCerrar()
    })
  }

  return (
    <dialog ref={ref} onClose={onCerrar} className="m-auto w-full max-w-2xl rounded-xl p-0 shadow-2xl backdrop:bg-slate-900/40">
      <form
        ref={formRef}
        key={clave}
        onSubmit={(e) => {
          e.preventDefault()
          enviar(false)
        }}
        className="flex max-h-[90vh] flex-col"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold text-slate-900">{id ? `Editar ${singular}` : `Nuevo ${singular}`}</h2>
          <button type="button" onClick={onCerrar} className="rounded px-2 text-xl leading-none text-slate-400 hover:text-slate-700" aria-label="Cerrar">
            ×
          </button>
        </div>
        <div className="grid gap-4 overflow-y-auto px-5 py-4 sm:grid-cols-2">
          {campos.map((c, i) => {
            const v = valorInicial(c, registro, ultimo)
            const ancho = c.tipo === 'textarea' || c.key === 'concepto' || c.key === 'descripcion' ? 'sm:col-span-2' : ''
            const foco = (!registro && ultimo ? c.key === 'concepto' || (i === 0 && !campos.some((x) => x.key === 'concepto')) : i === 0) ? { 'data-foco': true, autoFocus: true } : {}
            return (
              <div key={c.key} className={ancho}>
                {c.tipo === 'bool' ? (
                  <label className="flex items-center gap-2 pt-5 text-sm">
                    <input type="checkbox" name={c.key} defaultChecked={Boolean(v)} className="h-4 w-4 accent-marca-600" />
                    {c.label}
                  </label>
                ) : (
                  <>
                    <label className="etiqueta" htmlFor={`f-${c.key}`}>
                      {c.label}
                      {c.requerido && <span className="text-red-500"> *</span>}
                    </label>
                    <Control campo={c} valor={String(v)} opciones={opciones} extra={foco} />
                  </>
                )}
                {c.ayuda && <p className="mt-1 text-xs text-slate-400">{c.ayuda}</p>}
              </div>
            )
          })}
        </div>
        {error && <p className="mx-5 mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button type="button" className="btn" onClick={onCerrar}>
            Cancelar
          </button>
          {!id && (
            <button type="button" className="btn" disabled={pendiente} onClick={() => enviar(true)}>
              Guardar y nuevo
            </button>
          )}
          <button className="btn btn-primario" disabled={pendiente}>
            {pendiente ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

function Control({ campo: c, valor, opciones, extra }: { campo: Campo; valor: string; opciones: Opciones; extra: Record<string, unknown> }) {
  const comun = { id: `f-${c.key}`, name: c.key, defaultValue: valor, required: c.requerido, className: 'input', ...extra }
  switch (c.tipo) {
    case 'numero':
      return <input type="number" step="any" inputMode="decimal" {...comun} />
    case 'fecha':
      return <input type="date" {...comun} />
    case 'mes':
      return <input type="month" {...comun} />
    case 'textarea':
      return <textarea rows={2} {...comun} />
    case 'select':
      return (
        <select {...comun}>
          <option value="">—</option>
          {c.opciones === 'categorias' &&
            opciones.categorias.map((g) => (
              <optgroup key={g.grupo} label={g.grupo}>
                {g.nombres.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </optgroup>
            ))}
          {c.opciones === 'cuentas' && opciones.cuentas.map((n) => <option key={n}>{n}</option>)}
          {c.opciones === 'cuentasMayor' &&
            opciones.cuentasMayor.map((g) => (
              <optgroup key={g.grupo} label={g.grupo}>
                {g.items.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          {Array.isArray(c.opciones) && c.opciones.map((o) => <option key={o}>{o}</option>)}
          {/* Conserva valores antiguos que ya no están en el catálogo. */}
          {valor && !estaEnOpciones(c, valor, opciones) && <option value={valor}>{valor} (no está en el catálogo)</option>}
        </select>
      )
    default:
      return <input type="text" {...comun} />
  }
}

function estaEnOpciones(c: Campo, v: string, o: Opciones) {
  if (c.opciones === 'categorias') return o.categorias.some((g) => g.nombres.includes(v))
  if (c.opciones === 'cuentas') return o.cuentas.includes(v)
  if (c.opciones === 'cuentasMayor') return o.cuentasMayor.some((g) => g.items.some((i) => i.value === v))
  return Array.isArray(c.opciones) ? c.opciones.includes(v) : true
}
