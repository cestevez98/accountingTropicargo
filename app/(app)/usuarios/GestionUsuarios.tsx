'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { guardarUsuario } from '@/app/acciones'
import type { Rol, Usuario } from '@/lib/types'

type U = Omit<Usuario, 'hash'>
const ROLES: { v: Rol; l: string }[] = [
  { v: 'admin', l: 'Administrador' },
  { v: 'contador', l: 'Contador' },
  { v: 'cajero', l: 'Cajero' },
  { v: 'lectura', l: 'Solo lectura' },
  { v: 'agente', l: 'Agente de remesas (p. ej. DVA)' },
]

export function GestionUsuarios({ usuarios, cuentas, agentes, yo }: { usuarios: U[]; cuentas: string[]; agentes: string[]; yo: string }) {
  const [editando, setEditando] = useState<U | 'nuevo' | null>(null)
  return (
    <div className="space-y-4">
      <button className="btn btn-primario" onClick={() => setEditando('nuevo')}>
        + Nuevo usuario
      </button>
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
              <th>Cajas / agente</th>
              <th>Activo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.nombre}
                  {u.id === yo && <span className="ml-1 text-xs text-slate-400">(tú)</span>}
                </td>
                <td>{u.email}</td>
                <td>{ROLES.find((r) => r.v === u.rol)?.l}</td>
                <td>{u.rol === 'cajero' ? u.cuentas?.join(', ') : u.rol === 'agente' ? `Agente: ${u.agente ?? '—'}` : ''}</td>
                <td>{u.activo ? 'Sí' : 'No'}</td>
                <td className="text-right">
                  <button className="text-marca-600 hover:underline" onClick={() => setEditando(u)}>
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editando && <FormUsuario u={editando === 'nuevo' ? null : editando} cuentas={cuentas} agentes={agentes} onCerrar={() => setEditando(null)} />}
    </div>
  )
}

function FormUsuario({ u, cuentas, agentes, onCerrar }: { u: U | null; cuentas: string[]; agentes: string[]; onCerrar: () => void }) {
  const router = useRouter()
  const [rol, setRol] = useState<Rol>(u?.rol ?? 'contador')
  const [error, setError] = useState<string | null>(null)
  const [pendiente, start] = useTransition()
  return (
    <div className="tarjeta max-w-xl p-5">
      <h2 className="mb-3 font-semibold">{u ? `Editar ${u.email}` : 'Nuevo usuario'}</h2>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget)
          start(async () => {
            const r = await guardarUsuario(u?.id ?? null, {
              email: String(fd.get('email')),
              nombre: String(fd.get('nombre')),
              rol,
              activo: fd.get('activo') === 'on',
              cuentas: fd.getAll('cuentas').map(String),
              agente: rol === 'agente' ? String(fd.get('agente') ?? '') : undefined,
              password: String(fd.get('password') || '') || undefined,
            })
            if (!r.ok) return setError(r.error)
            onCerrar()
            router.refresh()
          })
        }}
      >
        <div>
          <label className="etiqueta">Nombre</label>
          <input name="nombre" defaultValue={u?.nombre} required className="input" />
        </div>
        <div>
          <label className="etiqueta">Correo</label>
          <input name="email" type="email" defaultValue={u?.email} required className="input" />
        </div>
        <div>
          <label className="etiqueta">Rol</label>
          <select value={rol} onChange={(e) => setRol(e.target.value as Rol)} className="input">
            {ROLES.map((r) => (
              <option key={r.v} value={r.v}>
                {r.l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiqueta">{u ? 'Nueva contraseña (vacío = no cambiar)' : 'Contraseña (mín. 10)'}</label>
          <input name="password" type="password" autoComplete="new-password" minLength={10} required={!u} className="input" />
        </div>
        {rol === 'cajero' && (
          <div className="sm:col-span-2">
            <label className="etiqueta">Cajas y cuentas en las que puede registrar</label>
            <div className="flex flex-wrap gap-3 text-sm">
              {cuentas.map((c) => (
                <label key={c} className="flex items-center gap-1.5">
                  <input type="checkbox" name="cuentas" value={c} defaultChecked={u?.cuentas?.includes(c)} className="accent-marca-600" />
                  {c}
                </label>
              ))}
            </div>
          </div>
        )}
        {rol === 'agente' && (
          <div className="sm:col-span-2">
            <label className="etiqueta">Agente</label>
            <select name="agente" defaultValue={u?.agente ?? agentes[0]} className="input">
              {agentes.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">Solo verá las remesas de este agente y podrá marcarlas como entregadas. No ve nada de la contabilidad.</p>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="activo" defaultChecked={u?.activo ?? true} className="accent-marca-600" /> Activo
        </label>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <button className="btn btn-primario" disabled={pendiente}>
            Guardar
          </button>
          <button type="button" className="btn" onClick={onCerrar}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}
