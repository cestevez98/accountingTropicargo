'use client'

import { useActionState, useEffect, useRef } from 'react'
import type { Resultado } from '@/app/acciones'

/** Formulario que llama a una acción de servidor y muestra el resultado. Los campos llegan como hijos. */
export function FormAccion({
  accion,
  children,
  boton = 'Guardar',
  className = '',
  limpiar = true,
  confirmar,
  claseBoton = 'btn btn-primario',
}: {
  accion: (prev: Resultado | null, form: FormData) => Promise<Resultado>
  children: React.ReactNode
  boton?: string
  className?: string
  limpiar?: boolean
  confirmar?: string
  claseBoton?: string
}) {
  const [estado, enviar, pendiente] = useActionState(accion, null)
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (estado?.ok && limpiar) ref.current?.reset()
  }, [estado, limpiar])
  return (
    <form
      ref={ref}
      action={enviar}
      className={className}
      onSubmit={(e) => {
        if (confirmar && !window.confirm(confirmar)) e.preventDefault()
      }}
    >
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className={claseBoton} disabled={pendiente}>
          {pendiente ? 'Guardando…' : boton}
        </button>
        {estado && (
          <span className={`text-sm ${estado.ok ? 'text-accent' : 'text-danger'}`} role="status">
            {estado.ok ? (estado.mensaje ?? 'Guardado.') : estado.error}
          </span>
        )}
      </div>
    </form>
  )
}

/** Botón suelto (borrar, marcar…) que llama a una acción con campos ocultos. */
export function BotonAccion({ accion, campos, children, confirmar, className = 'btn' }: { accion: (prev: Resultado | null, form: FormData) => Promise<Resultado>; campos: Record<string, string>; children: React.ReactNode; confirmar?: string; className?: string }) {
  const [estado, enviar, pendiente] = useActionState(accion, null)
  return (
    <form
      action={enviar}
      className="inline"
      onSubmit={(e) => {
        if (confirmar && !window.confirm(confirmar)) e.preventDefault()
      }}
    >
      {Object.entries(campos).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button className={className} disabled={pendiente} title={estado && !estado.ok ? estado.error : undefined}>
        {pendiente ? '…' : children}
      </button>
      {estado && !estado.ok && <span className="ml-2 text-xs text-danger">{estado.error}</span>}
    </form>
  )
}
