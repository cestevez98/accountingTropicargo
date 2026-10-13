'use client'

import { useState } from 'react'
import { accionProducto } from '../../acciones'
import { FormAccion } from '@/components/FormAccion'
import type { Producto } from '@/lib/types'

/**
 * Alta o edición de un producto del catálogo maestro. Con el código de barras se busca en MiBarcode
 * (base pública de AxisSoft) para rellenar el nombre, la unidad y la foto.
 */
export function FormProducto({ sel, grupos, barrasInicial }: { sel?: Producto; grupos: { g: string; etiqueta: string }[]; barrasInicial?: string }) {
  const [barras, setBarras] = useState(sel?.barras?.join(', ') ?? barrasInicial ?? '')
  const [nombre, setNombre] = useState(sel?.nombre ?? '')
  const [unidad, setUnidad] = useState(sel?.unidad ?? '')
  const [imagen, setImagen] = useState(sel?.imagen ?? '')
  const [aviso, setAviso] = useState('')

  async function buscar() {
    const b = barras.split(/[,\s]+/).filter(Boolean)[0]
    if (!b) return setAviso('Escribe o escanea un código de barras.')
    setAviso('Buscando en MiBarcode…')
    try {
      const j = (await (await fetch(`/api/barcode/${encodeURIComponent(b)}`)).json()) as { encontrado: boolean; nombre?: string; unidad?: string; imagen?: string }
      if (!j.encontrado) return setAviso('No está en MiBarcode: escribe el nombre a mano.')
      if (j.nombre && !nombre) setNombre(j.nombre.toUpperCase())
      if (j.unidad && !unidad) setUnidad(j.unidad)
      if (j.imagen) setImagen(j.imagen)
      setAviso(`Encontrado en MiBarcode: ${j.nombre}`)
    } catch {
      setAviso('No se pudo consultar MiBarcode.')
    }
  }

  return (
    <FormAccion key={sel?.nombre ?? barrasInicial ?? 'nuevo'} accion={accionProducto} className="mt-3" limpiar={!sel}>
      {sel && <input type="hidden" name="original" value={sel.nombre} />}
      <input type="hidden" name="imagen" value={imagen} />
      <div className="grid gap-3 sm:grid-cols-6">
        <label className="sm:col-span-2">
          <span className="etiqueta">Código de barras (varios separados por coma)</span>
          <div className="flex gap-2">
            <input
              name="barras"
              value={barras}
              onChange={(e) => setBarras(e.target.value)}
              onKeyDown={(e) => {
                // El escáner termina con Enter: busca en vez de guardar el formulario.
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void buscar()
                }
              }}
              className="input flex-1"
              inputMode="numeric"
            />
            <button type="button" className="btn" onClick={() => void buscar()}>
              Buscar
            </button>
          </div>
        </label>
        <label>
          <span className="etiqueta">Código del TPV</span>
          <input name="codigo" defaultValue={sel && sel.codigo !== sel.nombre ? sel.codigo : ''} placeholder="Si ya existe en el TPV" className="input" />
        </label>
        <label className="sm:col-span-3">
          <span className="etiqueta">Nombre</span>
          <input name="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className="input" required />
        </label>
        <label>
          <span className="etiqueta">Grupo</span>
          <input name="grupo" defaultValue={sel?.grupo} className="input" />
        </label>
        <label>
          <span className="etiqueta">Unidad</span>
          <input name="unidad" value={unidad} onChange={(e) => setUnidad(e.target.value)} className="input" />
        </label>
        <label>
          <span className="etiqueta">Costo ref. USD</span>
          <input name="costoUSD" defaultValue={sel?.costoUSD} inputMode="decimal" className="input" />
        </label>
        <label>
          <span className="etiqueta">Precio base CUP</span>
          <input name="precioCUP" defaultValue={sel?.precioCUP} inputMode="decimal" className="input" />
        </label>
        {grupos.map(({ g, etiqueta }) => (
          <label key={g}>
            <span className="etiqueta">Precio {etiqueta}</span>
            <input name={`precio${g}`} defaultValue={sel?.precios?.[g]} placeholder="= base" inputMode="decimal" className="input" />
          </label>
        ))}
        <label className="sm:col-span-4">
          <span className="etiqueta">Descripción para la web</span>
          <input name="descripcion" defaultValue={sel?.descripcion} className="input" />
        </label>
        <div className="flex items-end gap-2 sm:col-span-2">
          {imagen ? (
            <>
              <img src={imagen} alt="" className="h-16 w-16 rounded border border-border object-contain" />
              <button type="button" className="text-xs text-danger hover:underline" onClick={() => setImagen('')}>
                Quitar foto
              </button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Sin foto</span>
          )}
        </div>
      </div>
      {aviso && <p className="mt-2 text-xs text-muted-foreground">{aviso}</p>}
    </FormAccion>
  )
}
