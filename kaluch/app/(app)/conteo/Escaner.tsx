'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { accionConteoCerrar, accionConteoGuardar, type Resultado } from '../../acciones'
import { indiceEscaner, sumarLectura, type FilaEscaner } from '@/lib/conteo'
import type { LineaConteo } from '@/lib/types'

/**
 * Pantalla de conteo a ciegas: el lector de códigos actúa como teclado (escribe el código y pulsa Enter).
 * No se muestra la existencia del sistema. Lo contado se guarda en el teléfono a cada lectura y en el
 * servidor al pulsar Guardar o Terminar.
 */
export function Escaner({ id, numero, inicial, catalogo }: { id: string; numero: number; inicial: LineaConteo[]; catalogo: FilaEscaner[] }) {
  const indice = useMemo(() => indiceEscaner(catalogo), [catalogo])
  const clave = `ka_conteo_${id}`
  const [lineas, setLineas] = useState<LineaConteo[]>(inicial)
  const [codigo, setCodigo] = useState('')
  const [multiplo, setMultiplo] = useState('1')
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'error'; texto: string; imagen?: string } | null>(null)
  const [buscar, setBuscar] = useState('')
  const entrada = useRef<HTMLInputElement>(null)
  const [estGuardar, guardar, guardando] = useActionState<Resultado | null, FormData>(accionConteoGuardar, null)
  const [estCerrar, cerrar, cerrando] = useActionState<Resultado | null, FormData>(accionConteoCerrar, null)

  // Recupera lo contado en este teléfono si es más que lo guardado en el servidor.
  useEffect(() => {
    try {
      const g = JSON.parse(localStorage.getItem(clave) ?? 'null') as LineaConteo[] | null
      if (g && g.length > inicial.length) setLineas(g)
    } catch {}
    entrada.current?.focus()
  }, [clave, inicial.length])
  useEffect(() => {
    try {
      localStorage.setItem(clave, JSON.stringify(lineas))
    } catch {}
  }, [clave, lineas])
  useEffect(() => {
    if (estCerrar?.ok)
      try {
        localStorage.removeItem(clave)
      } catch {}
  }, [estCerrar, clave])

  const total = lineas.reduce((s, l) => s + l.cantidad, 0)
  const q = Number(multiplo.replace(',', '.')) || 1

  async function leer(cod: string) {
    const c = cod.trim()
    if (!c) return
    setCodigo('')
    setMultiplo('1')
    const p = indice.get(c)
    if (p) {
      setLineas((ls) => sumarLectura(ls, { codigo: p.codigo, nombre: p.nombre, cantidad: q }))
      setAviso({ tono: 'ok', texto: `+${q} ${p.nombre}` })
      try {
        navigator.vibrate?.(40)
      } catch {}
      return
    }
    // No está en el catálogo: se busca en MiBarcode para saber qué es, y se cuenta igual.
    setAviso({ tono: 'error', texto: `Buscando ${c}…` })
    let nombre = `Código ${c} (no está en el catálogo)`
    let imagen: string | undefined
    try {
      const r = await fetch(`/api/barcode/${encodeURIComponent(c)}`)
      const j = (await r.json()) as { encontrado: boolean; nombre?: string; imagen?: string }
      if (j.encontrado && j.nombre) {
        nombre = `${j.nombre} (no está en el catálogo)`
        imagen = j.imagen
      }
    } catch {}
    setLineas((ls) => sumarLectura(ls, { codigo: c, nombre, cantidad: q, desconocido: true }))
    setAviso({ tono: 'error', texto: `+${q} ${nombre}. Avísale a administración.`, imagen })
    try {
      navigator.vibrate?.([80, 60, 80])
    } catch {}
  }

  const cambiar = (codigo: string, cantidad: number) => setLineas((ls) => (cantidad > 0 ? ls.map((l) => (l.codigo === codigo ? { ...l, cantidad } : l)) : ls.filter((l) => l.codigo !== codigo)))
  const coincidencias = buscar.length >= 3 ? catalogo.filter(([cod, nom]) => nom.includes(buscar.toUpperCase()) || cod === buscar).slice(0, 8) : []

  if (estCerrar?.ok)
    return (
      <div className="tarjeta p-6 text-center">
        <div className="text-lg font-semibold">Conteo #{numero} terminado</div>
        <p className="mt-2 text-sm text-muted-foreground">{estCerrar.mensaje}</p>
        <a href="/conteo" className="btn mt-4 inline-block">
          Volver
        </a>
      </div>
    )

  return (
    <div className="mx-auto max-w-xl">
      <form
        className="tarjeta sticky top-2 z-10 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void leer(codigo)
          entrada.current?.focus()
        }}
      >
        <div className="flex gap-2">
          <input
            ref={entrada}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Escanea o escribe el código"
            inputMode="numeric"
            autoComplete="off"
            className="input flex-1 text-lg"
            aria-label="Código"
          />
          <input value={multiplo} onChange={(e) => setMultiplo(e.target.value)} inputMode="decimal" className="input w-16 text-center text-lg" aria-label="Cantidad por lectura" title="Cantidad por lectura (p. ej. una caja de 24)" />
          <button className="btn btn-primario">OK</button>
        </div>
        {aviso && (
          <div className={`mt-2 flex items-center gap-2 rounded px-2 py-1 text-sm ${aviso.tono === 'ok' ? 'bg-accent/10 text-accent' : 'bg-amber-100 text-amber-900'}`}>
            {aviso.imagen && <img src={aviso.imagen} alt="" className="h-10 w-10 rounded object-contain" />}
            <span>{aviso.texto}</span>
          </div>
        )}
        <div className="mt-2 text-xs text-muted-foreground">
          {lineas.length} productos · {total.toLocaleString('es-ES')} unidades. La casilla pequeña es la cantidad por lectura (vuelve a 1 después de cada una).
        </div>
      </form>

      <details className="tarjeta mt-3 p-3">
        <summary className="cursor-pointer text-sm">Producto sin código de barras: buscar por nombre</summary>
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre (mín. 3 letras)" className="input mt-2" />
        {coincidencias.map(([cod, nom]) => (
          <button key={cod} type="button" className="block w-full border-b border-border py-2 text-left text-sm" onClick={() => void leer(cod).then(() => setBuscar(''))}>
            {nom} <span className="text-xs text-muted-foreground">{cod}</span>
          </button>
        ))}
      </details>

      <ul className="tarjeta mt-3 divide-y divide-border">
        {lineas.map((l) => (
          <li key={l.codigo} className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className={`truncate text-sm ${l.desconocido ? 'text-amber-700' : ''}`}>{l.nombre}</div>
              <div className="text-xs text-muted-foreground">{l.codigo}</div>
            </div>
            <button type="button" className="btn px-3" onClick={() => cambiar(l.codigo, l.cantidad - 1)} aria-label="Menos">
              −
            </button>
            <input value={l.cantidad} onChange={(e) => cambiar(l.codigo, Number(e.target.value.replace(',', '.')) || 0)} inputMode="decimal" className="input w-16 text-center" aria-label={`Cantidad de ${l.nombre}`} />
            <button type="button" className="btn px-3" onClick={() => cambiar(l.codigo, l.cantidad + 1)} aria-label="Más">
              +
            </button>
          </li>
        ))}
        {!lineas.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Todavía no hay nada contado.</li>}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <form action={guardar}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="lineas" value={JSON.stringify(lineas)} />
          <button className="btn" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </form>
        <form
          action={cerrar}
          onSubmit={(e) => {
            if (!confirm(`¿Terminar el conteo con ${lineas.length} productos? Después ya no se puede cambiar.`)) e.preventDefault()
          }}
          className="flex flex-1 gap-2"
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="lineas" value={JSON.stringify(lineas)} />
          <input name="nota" placeholder="Nota (opcional)" className="input flex-1" />
          <button className="btn btn-exito" disabled={cerrando || !lineas.length}>
            {cerrando ? 'Terminando…' : 'Terminar conteo'}
          </button>
        </form>
      </div>
      {(estGuardar || estCerrar) && (
        <p role="status" className={`mt-2 text-sm ${(estCerrar ?? estGuardar)!.ok ? 'text-accent' : 'text-danger'}`}>
          {(() => {
            const r = (estCerrar && !estCerrar.ok ? estCerrar : estGuardar)!
            return r.ok ? r.mensaje : r.error
          })()}
        </p>
      )}
    </div>
  )
}
