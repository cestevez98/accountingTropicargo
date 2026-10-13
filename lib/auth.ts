import 'server-only'
import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { leerUsuarios } from './data'
import { mutar } from './store'
import type { Rol, Usuario } from './types'

const COOKIE = 'tc_sesion'
const DURACION_H = 12

function secreto() {
  const s = process.env.AUTH_SECRET
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === 'production') throw new Error('Falta AUTH_SECRET (mínimo 32 caracteres).')
    return new TextEncoder().encode('desarrollo-local-no-usar-en-produccion-0123456789')
  }
  return new TextEncoder().encode(s)
}

export type Sesion = Pick<Usuario, 'id' | 'email' | 'nombre' | 'rol' | 'cuentas'>

export const ROL_LABEL: Record<Rol, string> = {
  admin: 'Administrador',
  contador: 'Contador',
  cajero: 'Cajero',
  lectura: 'Solo lectura',
}

// Freno simple contra fuerza bruta (por instancia).
const intentos = new Map<string, { n: number; hasta: number }>()

export async function iniciarSesion(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const clave = email.toLowerCase().trim()
  const reg = intentos.get(clave)
  if (reg && reg.n >= 5 && reg.hasta > Date.now()) return { ok: false, error: 'Demasiados intentos. Espera unos minutos.' }

  let usuarios = await leerUsuarios()
  let user = usuarios.find((u) => u.email.toLowerCase() === clave && u.activo)

  // Arranque: si todavía no hay usuarios, el administrador definido en las variables de entorno crea su cuenta.
  if (!usuarios.length && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    if (clave === process.env.ADMIN_EMAIL.toLowerCase() && password === process.env.ADMIN_PASSWORD) {
      const nuevo: Usuario = { id: crypto.randomUUID(), email: clave, nombre: 'Administrador', rol: 'admin', hash: await bcrypt.hash(password, 11), activo: true }
      await mutar({ usuarios: [] as Usuario[] }, ({ usuarios }) => ({ usuarios: usuarios.length ? usuarios : [nuevo] }))
      usuarios = await leerUsuarios()
      user = usuarios.find((u) => u.email.toLowerCase() === clave)
    }
  }

  if (!user || !(await bcrypt.compare(password, user.hash))) {
    const r = intentos.get(clave) ?? { n: 0, hasta: 0 }
    r.n++
    r.hasta = Date.now() + 10 * 60 * 1000
    intentos.set(clave, r)
    return { ok: false, error: 'Correo o contraseña incorrectos.' }
  }
  intentos.delete(clave)
  const token = await new SignJWT({ sub: user.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${DURACION_H}h`)
    .sign(secreto())
  ;(await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DURACION_H * 3600,
  })
  return { ok: true }
}

export async function cerrarSesion() {
  ;(await cookies()).delete(COOKIE)
}

export const sesionActual = cache(async (): Promise<Sesion | null> => {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secreto())
    const u = (await leerUsuarios()).find((x) => x.id === payload.sub && x.activo)
    if (!u) return null
    return { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, cuentas: u.cuentas }
  } catch {
    return null
  }
})

/** Para páginas: redirige al login si no hay sesión o el rol no alcanza. */
export async function requerirUsuario(roles?: Rol[]): Promise<Sesion> {
  const s = await sesionActual()
  if (!s) redirect('/login')
  if (roles && !roles.includes(s.rol)) redirect('/?sinPermiso=1')
  return s
}

/** Para acciones de servidor: lanza error en lugar de redirigir. */
export async function autorizar(roles?: Rol[]): Promise<Sesion> {
  const s = await sesionActual()
  if (!s) throw new Error('Sesión caducada. Vuelve a iniciar sesión.')
  if (roles && !roles.includes(s.rol)) throw new Error('No tienes permiso para esta acción.')
  return s
}

export const puedeEditar = (s: Sesion) => s.rol === 'admin' || s.rol === 'contador'

export async function hashPassword(p: string) {
  return bcrypt.hash(p, 11)
}
export async function verificarPassword(p: string, hash: string) {
  return bcrypt.compare(p, hash)
}
