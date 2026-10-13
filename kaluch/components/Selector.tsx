'use client'

import { useTransition } from 'react'

/** Select que guarda una preferencia (tienda, moneda, tema) en cuanto cambia. */
export function SelectorPreferencia({ accion, nombre, valor, opciones, titulo }: { accion: (f: FormData) => Promise<void>; nombre: string; valor: string; opciones: { valor: string; label: string; grupo?: string }[]; titulo?: string }) {
  const [pendiente, start] = useTransition()
  const grupos = [...new Set(opciones.map((o) => o.grupo ?? ''))]
  return (
    <select
      title={titulo}
      aria-label={titulo}
      defaultValue={valor}
      disabled={pendiente}
      className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm font-medium"
      onChange={(e) => {
        const f = new FormData()
        f.set(nombre, e.target.value)
        start(() => accion(f))
      }}
    >
      {grupos.map((g) =>
        g ? (
          <optgroup key={g} label={g}>
            {opciones
              .filter((o) => o.grupo === g)
              .map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.label}
                </option>
              ))}
          </optgroup>
        ) : (
          opciones
            .filter((o) => !o.grupo)
            .map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.label}
              </option>
            ))
        ),
      )}
    </select>
  )
}

export function Conmutador({ accion, nombre, valor, opciones }: { accion: (f: FormData) => Promise<void>; nombre: string; valor: string; opciones: { valor: string; label: string }[] }) {
  const [pendiente, start] = useTransition()
  return (
    <div className="flex rounded-lg border border-border p-0.5">
      {opciones.map((o) => (
        <button
          key={o.valor}
          disabled={pendiente}
          onClick={() => {
            const f = new FormData()
            f.set(nombre, o.valor)
            start(() => accion(f))
          }}
          className={`rounded-md px-2 py-1 text-xs font-semibold ${valor === o.valor ? 'bg-primary text-white' : 'text-muted-foreground'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
