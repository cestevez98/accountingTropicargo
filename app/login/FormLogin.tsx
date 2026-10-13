'use client'

import { useActionState } from 'react'
import { accionLogin } from '../acciones'

export function FormLogin() {
  const [estado, accion, pendiente] = useActionState(accionLogin, null)
  return (
    <form action={accion} className="space-y-4">
      <div>
        <label className="etiqueta" htmlFor="email">
          Correo
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" />
      </div>
      <div>
        <label className="etiqueta" htmlFor="password">
          Contraseña
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      {estado && !estado.ok && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{estado.error}</p>}
      <button className="btn btn-primario w-full justify-center py-2" disabled={pendiente}>
        {pendiente ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )
}
