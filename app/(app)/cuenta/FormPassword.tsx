'use client'

import { useActionState } from 'react'
import { cambiarMiPassword } from '@/app/acciones'

export function FormPassword() {
  const [estado, accion, pendiente] = useActionState(cambiarMiPassword, null)
  return (
    <form action={accion} className="space-y-3">
      <div>
        <label className="etiqueta">Contraseña actual</label>
        <input name="actual" type="password" autoComplete="current-password" required className="input" />
      </div>
      <div>
        <label className="etiqueta">Nueva contraseña (mínimo 10 caracteres)</label>
        <input name="nueva" type="password" autoComplete="new-password" minLength={10} required className="input" />
      </div>
      <div>
        <label className="etiqueta">Repite la nueva contraseña</label>
        <input name="repetir" type="password" autoComplete="new-password" minLength={10} required className="input" />
      </div>
      {estado && <p className={`text-sm ${estado.ok ? 'text-emerald-700' : 'text-red-700'}`}>{estado.ok ? estado.mensaje : estado.error}</p>}
      <button className="btn btn-primario" disabled={pendiente}>
        Cambiar contraseña
      </button>
    </form>
  )
}
