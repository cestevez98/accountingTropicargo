'use client'

import { useActionState } from 'react'
import { accionLogin } from '../acciones'

export function FormLogin() {
  const [estado, enviar, pendiente] = useActionState(accionLogin, null)
  return (
    <form action={enviar} className="mt-6 space-y-4">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Correo electrónico</span>
        <input name="email" type="email" required autoComplete="username" className="input py-2.5" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Contraseña</span>
        <input name="password" type="password" required autoComplete="current-password" className="input py-2.5" />
      </label>
      {estado && !estado.ok && <p className="text-sm text-danger">{estado.error}</p>}
      <button className="btn btn-primario w-full py-2.5" disabled={pendiente}>
        {pendiente ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )
}
