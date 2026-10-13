'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { autorizar, cerrarSesion, hashPassword, iniciarSesion, verificarPassword } from '@/lib/auth'
import { CUENTA_BALANCE_INFO, DEFAULT_SETTINGS } from '@/lib/catalog'
import { COLECCIONES, type Campo } from '@/lib/colecciones'
import { COLECCIONES_OPERATIVAS, DEFECTOS, leerUsuarios, registrarAuditoria } from '@/lib/data'
import { esFecha } from '@/lib/fecha'
import { mutar } from '@/lib/store'
import type { Categoria, Cuenta, Dataset, Rol, Settings, Usuario } from '@/lib/types'

export type Resultado = { ok: true; mensaje?: string } | { ok: false; error: string }

const fallo = (e: unknown): Resultado => ({ ok: false, error: e instanceof Error ? e.message : String(e) })

function refrescar() {
  revalidatePath('/', 'layout')
}

// ---------------------------------------------------------------- sesión

export async function accionLogin(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  const r = await iniciarSesion(String(form.get('email') ?? ''), String(form.get('password') ?? ''))
  if (!r.ok) return r
  redirect('/')
}

export async function accionLogout() {
  await cerrarSesion()
  redirect('/login')
}

// ---------------------------------------------------------------- registros genéricos

type Fila = Record<string, unknown> & { id: string }

function normalizarCampo(c: Campo, v: unknown, ds: Pick<Dataset, 'categorias' | 'cuentas'>): unknown {
  const vacio = v == null || v === ''
  switch (c.tipo) {
    case 'numero': {
      if (vacio) {
        if (c.requerido) throw new Error(`«${c.label}» es obligatorio.`)
        return undefined
      }
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
      if (!Number.isFinite(n)) throw new Error(`«${c.label}» no es un número válido.`)
      return Math.round(n * 1e6) / 1e6
    }
    case 'bool':
      return v === true || v === 'true' || v === 'on' || v === 'Sí'
    case 'fecha':
      if (vacio) {
        if (c.requerido) throw new Error(`«${c.label}» es obligatoria.`)
        return undefined
      }
      if (!esFecha(v)) throw new Error(`«${c.label}» debe ser una fecha AAAA-MM-DD.`)
      return v
    case 'mes':
      if (vacio) {
        if (c.requerido) throw new Error(`«${c.label}» es obligatorio.`)
        return undefined
      }
      if (!/^\d{4}-\d{2}$/.test(String(v))) throw new Error(`«${c.label}» debe tener el formato AAAA-MM.`)
      return v
    case 'lista':
      return Array.isArray(v) ? v.map(String) : vacio ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean)
    case 'select': {
      if (vacio) {
        if (c.requerido) throw new Error(`Elige «${c.label}».`)
        return undefined
      }
      const s = String(v)
      if (Array.isArray(c.opciones) && !c.opciones.includes(s)) throw new Error(`«${s}» no es un valor válido para ${c.label}.`)
      if (c.opciones === 'categorias' && !ds.categorias.some((x) => x.nombre === s)) throw new Error(`La categoría «${s}» no existe en el catálogo.`)
      if (c.opciones === 'cuentas' && !ds.cuentas.some((x) => x.nombre === s)) throw new Error(`La cuenta «${s}» no existe.`)
      if (c.opciones === 'cuentasMayor' && !esCuentaMayor(s, ds)) throw new Error(`«${s}» no es una cuenta del mayor válida.`)
      return s
    }
    default: {
      const s = vacio ? '' : String(v).trim()
      if (!s && c.requerido) throw new Error(`«${c.label}» es obligatorio.`)
      return s || undefined
    }
  }
}

function esCuentaMayor(k: string, ds: Pick<Dataset, 'categorias' | 'cuentas'>) {
  if (k.startsWith('tes:')) return ds.cuentas.some((c) => c.nombre === k.slice(4))
  if (k.startsWith('res:')) return ds.categorias.some((c) => c.nombre === k.slice(4) && c.contrapartida === 'resultado')
  return k in CUENTA_BALANCE_INFO
}

function mesCerrado(settings: Settings, fecha: unknown) {
  return typeof fecha === 'string' && settings.mesesCerrados.includes(fecha.slice(0, 7))
}

export async function guardarRegistro(coleccion: string, id: string | null, valores: Record<string, unknown>): Promise<Resultado> {
  try {
    const cfg = COLECCIONES[coleccion]
    if (!cfg) throw new Error('Colección desconocida.')
    const s = await autorizar(cfg.rolesEditar)
    let etiqueta = ''
    await mutar(
      {
        [coleccion]: [] as Fila[],
        categorias: DEFECTOS.categorias,
        cuentas: DEFECTOS.cuentas,
        settings: DEFAULT_SETTINGS,
        movimientos: [] as Fila[],
        ...(coleccion === 'categorias' || coleccion === 'cuentas'
          ? { facturasCompra: [] as Fila[], devengos: [] as Fila[], reglas: [] as Fila[], asientos: [] as Fila[], pagosProveedor: [] as Fila[], usuarios: [] as Fila[] }
          : {}),
      } as Record<string, unknown>,
      (actual) => {
        const ds = actual as unknown as Dataset
        const filas = actual[coleccion] as Fila[]
        const previo = id ? filas.find((f) => f.id === id) : undefined
        if (id && !previo) throw new Error('El registro ya no existe (quizá otro usuario lo borró).')
        const nuevo: Fila = { ...(previo ?? {}), id: previo?.id ?? crypto.randomUUID() }
        for (const c of cfg.campos) {
          if (!(c.key in valores) && previo) continue
          const v = normalizarCampo(c, valores[c.key], ds)
          if (v === undefined) delete nuevo[c.key]
          else nuevo[c.key] = v
        }
        validarEspecifico(coleccion, nuevo, s)
        const fecha = cfg.campoFecha ? nuevo[cfg.campoFecha] : undefined
        if (s.rol !== 'admin' && (mesCerrado(ds.settings, fecha) || (previo && mesCerrado(ds.settings, previo[cfg.campoFecha ?? '']))))
          throw new Error('Ese mes está cerrado. Solo el administrador puede modificarlo.')
        if (s.rol === 'cajero' && previo && !s.cuentas?.includes(String(previo.cuenta))) throw new Error('No puedes modificar movimientos de esa cuenta.')
        etiqueta = cfg.etiqueta(nuevo)
        const out: Record<string, unknown> = { [coleccion]: previo ? filas.map((f) => (f.id === previo.id ? nuevo : f)) : [nuevo, ...filas] }

        // Cambios de nombre en catálogos: se actualizan los registros que los usan.
        if (previo && (coleccion === 'categorias' || coleccion === 'cuentas') && previo.nombre !== nuevo.nombre) {
          const dup = filas.some((f) => f.id !== nuevo.id && f.nombre === nuevo.nombre)
          if (dup) throw new Error(`Ya existe «${nuevo.nombre}».`)
          const campoRef = coleccion === 'categorias' ? 'categoria' : 'cuenta'
          const antes = String(previo.nombre)
          const despues = String(nuevo.nombre)
          const cambia = (f: Fila, k: string) => (f[k] === antes ? { ...f, [k]: despues } : f)
          out.movimientos = (actual.movimientos as Fila[]).map((m) => cambia(m, campoRef))
          // El nombre también aparece en otras tablas: se actualiza en todas.
          if (coleccion === 'categorias') {
            out.facturasCompra = (actual.facturasCompra as Fila[]).map((f) => cambia(f, 'categoria'))
            out.devengos = (actual.devengos as Fila[]).map((f) => cambia(f, 'categoria'))
            out.reglas = (actual.reglas as Fila[]).map((f) => cambia(f, 'categoria'))
            const clave = (k: unknown) => (k === `res:${antes}` ? `res:${despues}` : k)
            out.asientos = (actual.asientos as Fila[]).map((a) => ({ ...a, cargo: clave(a.cargo), abono: clave(a.abono) }))
          } else {
            out.pagosProveedor = (actual.pagosProveedor as Fila[]).map((f) => cambia(f, 'cuenta'))
            out.devengos = (actual.devengos as Fila[]).map((f) => cambia(f, 'origen'))
            out.reglas = (actual.reglas as Fila[]).map((f) => cambia(f, 'cuenta'))
            const clave = (k: unknown) => (k === `tes:${antes}` ? `tes:${despues}` : k)
            out.asientos = (actual.asientos as Fila[]).map((a) => ({ ...a, cargo: clave(a.cargo), abono: clave(a.abono) }))
            out.usuarios = (actual.usuarios as (Fila & { cuentas?: string[] })[]).map((u) => (u.cuentas?.includes(antes) ? { ...u, cuentas: u.cuentas.map((c) => (c === antes ? despues : c)) } : u))
          }
        }
        if (!previo && (coleccion === 'categorias' || coleccion === 'cuentas') && filas.some((f) => f.nombre === nuevo.nombre))
          throw new Error(`Ya existe «${nuevo.nombre}».`)
        return out
      },
    )
    await registrarAuditoria([{ usuario: s.email, accion: id ? 'editar' : 'crear', coleccion, registroId: id ?? undefined, detalle: etiqueta }])
    refrescar()
    return { ok: true, mensaje: id ? 'Cambios guardados.' : `${cfg.singular[0].toUpperCase()}${cfg.singular.slice(1)} creado.` }
  } catch (e) {
    return fallo(e)
  }
}

function validarEspecifico(coleccion: string, r: Fila, s: { rol: Rol; cuentas?: string[] }) {
  if (coleccion === 'movimientos') {
    const e = Number(r.entrada) || 0
    const sa = Number(r.salida) || 0
    if (e < 0 || sa < 0) throw new Error('Entrada y salida van en positivo.')
    if (!e && !sa) throw new Error('Indica una entrada o una salida.')
    r.entrada = e
    r.salida = sa
    if (s.rol === 'cajero' && !s.cuentas?.includes(String(r.cuenta))) throw new Error(`No tienes permiso para registrar en «${r.cuenta}».`)
  }
  if (coleccion === 'asientos') {
    if (r.cargo === r.abono) throw new Error('El cargo y el abono deben ser cuentas distintas.')
    if (!(Number(r.importe) > 0)) throw new Error('El importe debe ser mayor que 0.')
  }
  if (coleccion === 'facturasCompra' || coleccion === 'facturas') {
    if (r.pagado == null) r.pagado = 0
    if (r.cobrado == null && coleccion === 'facturas') r.cobrado = 0
  }
  if (coleccion === 'cxcManual' && r.cobrado == null) r.cobrado = 0
}

export async function borrarRegistro(coleccion: string, id: string): Promise<Resultado> {
  try {
    const cfg = COLECCIONES[coleccion]
    if (!cfg) throw new Error('Colección desconocida.')
    const s = await autorizar(cfg.rolesEditar)
    let etiqueta = ''
    await mutar({ [coleccion]: [] as Fila[], settings: DEFAULT_SETTINGS, movimientos: [] as Fila[], facturasCompra: [] as Fila[], devengos: [] as Fila[] } as Record<string, unknown>, (actual) => {
      const filas = actual[coleccion] as Fila[]
      const previo = filas.find((f) => f.id === id)
      if (!previo) throw new Error('El registro ya no existe.')
      const settings = actual.settings as Settings
      if (s.rol !== 'admin' && mesCerrado(settings, previo[cfg.campoFecha ?? ''])) throw new Error('Ese mes está cerrado.')
      if (s.rol === 'cajero' && !s.cuentas?.includes(String(previo.cuenta))) throw new Error('No puedes borrar movimientos de esa cuenta.')
      if (coleccion === 'categorias') {
        const usos = ['movimientos', 'facturasCompra', 'devengos'].reduce((a, k) => a + (actual[k] as Fila[]).filter((f) => f.categoria === previo.nombre).length, 0)
        if (usos) throw new Error(`No se puede borrar: ${usos} registros usan «${previo.nombre}». Desactívala o renómbrala.`)
      }
      if (coleccion === 'cuentas') {
        const usos = (actual.movimientos as Fila[]).filter((f) => f.cuenta === previo.nombre).length
        if (usos) throw new Error(`No se puede borrar: ${usos} movimientos usan «${previo.nombre}». Desactívala.`)
      }
      etiqueta = cfg.etiqueta(previo)
      return { [coleccion]: filas.filter((f) => f.id !== id) }
    })
    await registrarAuditoria([{ usuario: s.email, accion: 'borrar', coleccion, registroId: id, detalle: etiqueta }])
    refrescar()
    return { ok: true, mensaje: 'Registro borrado.' }
  } catch (e) {
    return fallo(e)
  }
}

/** Cambia la categoría de varios movimientos a la vez (bandeja «por clasificar»). */
export async function cambiarCategoria(ids: string[], categoria: string): Promise<Resultado> {
  try {
    const s = await autorizar(['admin', 'contador'])
    await mutar({ movimientos: [] as Fila[], categorias: DEFECTOS.categorias, settings: DEFAULT_SETTINGS } as Record<string, unknown>, (a) => {
      const cats = a.categorias as Categoria[]
      if (!cats.some((c) => c.nombre === categoria)) throw new Error('Categoría inválida.')
      const set = new Set(ids)
      const settings = a.settings as Settings
      const movs = (a.movimientos as Fila[]).map((m) => {
        if (!set.has(m.id)) return m
        if (s.rol !== 'admin' && mesCerrado(settings, m.fecha)) throw new Error('Algún movimiento está en un mes cerrado.')
        return { ...m, categoria }
      })
      return { movimientos: movs }
    })
    await registrarAuditoria([{ usuario: s.email, accion: 'editar', coleccion: 'movimientos', detalle: `${ids.length} movimientos → ${categoria}` }])
    refrescar()
    return { ok: true, mensaje: `${ids.length} movimiento(s) clasificados como «${categoria}».` }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- configuración

export async function guardarApertura(valores: { fechaInicio: string; capitalApertura: number; cxcSistemaApertura: number; empresa: string }): Promise<Resultado> {
  try {
    const s = await autorizar(['admin'])
    if (!esFecha(valores.fechaInicio) || !valores.fechaInicio.endsWith('-01')) throw new Error('La fecha de inicio debe ser el primer día de un mes.')
    for (const k of ['capitalApertura', 'cxcSistemaApertura'] as const) if (!Number.isFinite(Number(valores[k]))) throw new Error('Importe inválido.')
    await mutar({ settings: DEFAULT_SETTINGS }, ({ settings }) => ({
      settings: {
        ...settings,
        empresa: valores.empresa.trim() || settings.empresa,
        fechaInicio: valores.fechaInicio,
        capitalApertura: Number(valores.capitalApertura),
        cxcSistemaApertura: Number(valores.cxcSistemaApertura),
      },
    }))
    await registrarAuditoria([{ usuario: s.email, accion: 'editar', coleccion: 'settings', detalle: JSON.stringify(valores) }])
    refrescar()
    return { ok: true, mensaje: 'Saldos de apertura guardados.' }
  } catch (e) {
    return fallo(e)
  }
}

export async function cerrarMes(mes: string, cerrar: boolean): Promise<Resultado> {
  try {
    const s = await autorizar(['admin'])
    if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mes inválido.')
    await mutar({ settings: DEFAULT_SETTINGS }, ({ settings }) => {
      const set = new Set(settings.mesesCerrados)
      if (cerrar) set.add(mes)
      else set.delete(mes)
      return { settings: { ...settings, mesesCerrados: [...set].sort() } }
    })
    await registrarAuditoria([{ usuario: s.email, accion: cerrar ? 'cerrar' : 'abrir', coleccion: 'settings', detalle: mes }])
    refrescar()
    return { ok: true, mensaje: cerrar ? `Mes ${mes} cerrado.` : `Mes ${mes} reabierto.` }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- importación

const COLECCIONES_IMPORTABLES = new Set<string>([...COLECCIONES_OPERATIVAS, 'categorias', 'cuentas'])

/** Recibe una colección (o un trozo) del Excel ya convertido en el navegador. */
export async function importarParte(coleccion: string, filas: unknown[], reemplazar: boolean): Promise<Resultado> {
  try {
    await autorizar(['admin'])
    if (!COLECCIONES_IMPORTABLES.has(coleccion)) throw new Error(`No se puede importar «${coleccion}».`)
    if (!Array.isArray(filas)) throw new Error('Formato inválido.')
    await mutar({ [coleccion]: [] as unknown[] }, (a) => ({ [coleccion]: reemplazar ? filas : [...(a[coleccion] as unknown[]), ...filas] }))
    return { ok: true }
  } catch (e) {
    return fallo(e)
  }
}

export async function importarAjustes(settings: Partial<Settings>, resumen: string): Promise<Resultado> {
  try {
    const s = await autorizar(['admin'])
    await mutar({ settings: DEFAULT_SETTINGS }, (a) => ({
      settings: {
        ...a.settings,
        fechaInicio: settings.fechaInicio ?? a.settings.fechaInicio,
        capitalApertura: Number(settings.capitalApertura ?? a.settings.capitalApertura),
        cxcSistemaApertura: Number(settings.cxcSistemaApertura ?? a.settings.cxcSistemaApertura),
      },
    }))
    await registrarAuditoria([{ usuario: s.email, accion: 'importar', coleccion: 'todas', detalle: resumen }])
    refrescar()
    return { ok: true, mensaje: 'Importación terminada.' }
  } catch (e) {
    return fallo(e)
  }
}

/** Borra todos los datos operativos (movimientos, facturas…). Conserva catálogo, cuentas y usuarios. */
export async function vaciarDatos(confirmacion: string): Promise<Resultado> {
  try {
    const s = await autorizar(['admin'])
    if (confirmacion !== 'VACIAR') throw new Error('Escribe VACIAR para confirmar.')
    const vacio = Object.fromEntries(COLECCIONES_OPERATIVAS.map((k) => [k, [] as unknown[]]))
    await mutar(vacio, () => ({ ...vacio }))
    await mutar({ settings: DEFAULT_SETTINGS }, ({ settings }) => ({ settings: { ...settings, cxcSistemaApertura: 0, mesesCerrados: [] } }))
    await registrarAuditoria([{ usuario: s.email, accion: 'borrar', coleccion: 'todas', detalle: 'Vaciado de datos operativos' }])
    refrescar()
    return { ok: true, mensaje: 'Datos borrados. El catálogo, las cuentas y los usuarios se conservan.' }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- usuarios

export async function guardarUsuario(
  id: string | null,
  v: { email: string; nombre: string; rol: Rol; activo: boolean; cuentas: string[]; agente?: string; password?: string },
): Promise<Resultado> {
  try {
    const s = await autorizar(['admin'])
    const email = v.email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Correo inválido.')
    if (!['admin', 'contador', 'cajero', 'lectura', 'agente'].includes(v.rol)) throw new Error('Rol inválido.')
    if (v.rol === 'agente' && !v.agente) throw new Error('Elige a qué agente pertenece el usuario.')
    const agente = v.rol === 'agente' ? v.agente : undefined
    if (!id && (!v.password || v.password.length < 10)) throw new Error('La contraseña debe tener al menos 10 caracteres.')
    if (v.password && v.password.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres.')
    const hash = v.password ? await hashPassword(v.password) : undefined
    await mutar({ usuarios: [] as Usuario[], cuentas: DEFECTOS.cuentas }, ({ usuarios, cuentas }) => {
      if (usuarios.some((u) => u.email === email && u.id !== id)) throw new Error('Ya existe un usuario con ese correo.')
      const cuentasValidas = v.cuentas.filter((c) => (cuentas as Cuenta[]).some((x) => x.nombre === c))
      if (id) {
        const u = usuarios.find((x) => x.id === id)
        if (!u) throw new Error('El usuario no existe.')
        if (u.id === s.id && (v.rol !== 'admin' || !v.activo)) throw new Error('No puedes quitarte a ti mismo el rol de administrador ni desactivarte.')
        return { usuarios: usuarios.map((x) => (x.id === id ? { ...x, email, nombre: v.nombre.trim(), rol: v.rol, activo: v.activo, cuentas: cuentasValidas, agente, ...(hash ? { hash } : {}) } : x)) }
      }
      return { usuarios: [...usuarios, { id: crypto.randomUUID(), email, nombre: v.nombre.trim(), rol: v.rol, activo: v.activo, cuentas: cuentasValidas, agente, hash: hash! }] }
    })
    await registrarAuditoria([{ usuario: s.email, accion: id ? 'editar' : 'crear', coleccion: 'usuarios', detalle: `${email} (${v.rol})` }])
    refrescar()
    return { ok: true, mensaje: 'Usuario guardado.' }
  } catch (e) {
    return fallo(e)
  }
}

export async function cambiarMiPassword(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar()
    const actual = String(form.get('actual') ?? '')
    const nueva = String(form.get('nueva') ?? '')
    if (nueva.length < 10) throw new Error('La nueva contraseña debe tener al menos 10 caracteres.')
    if (nueva !== String(form.get('repetir') ?? '')) throw new Error('Las contraseñas no coinciden.')
    const u = (await leerUsuarios()).find((x) => x.id === s.id)
    if (!u || !(await verificarPassword(actual, u.hash))) throw new Error('La contraseña actual no es correcta.')
    const hash = await hashPassword(nueva)
    await mutar({ usuarios: [] as Usuario[] }, ({ usuarios }) => ({ usuarios: usuarios.map((x) => (x.id === s.id ? { ...x, hash } : x)) }))
    return { ok: true, mensaje: 'Contraseña cambiada.' }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- tasas de elTOQUE

export async function actualizarTasaHoy(): Promise<Resultado> {
  try {
    const s = await autorizar(['admin', 'contador'])
    const { actualizarTasas, hoyCuba } = await import('@/lib/eltoque')
    const r = await actualizarTasas([hoyCuba()])
    await registrarAuditoria([{ usuario: s.email, accion: 'editar', coleccion: 'tasas', detalle: `Actualización manual elTOQUE: ${r.detalle}` }])
    refrescar()
    return r.guardadas.length ? { ok: true, mensaje: r.detalle } : { ok: false, error: r.detalle }
  } catch (e) {
    return fallo(e)
  }
}

/** Trae de elTOQUE la tasa de cada día desde `desde` hasta hoy. Reemplaza las importadas del Excel, no las manuales. */
export async function rellenarTasas(desde: string): Promise<Resultado> {
  try {
    const s = await autorizar(['admin'])
    if (!esFecha(desde)) throw new Error('Fecha inválida.')
    const { actualizarTasas, diasHastaHoy } = await import('@/lib/eltoque')
    const dias = diasHastaHoy(desde)
    if (dias.length > 400) throw new Error('Como máximo 400 días por vez.')
    const r = await actualizarTasas(dias, { reemplazarImportadas: true })
    await registrarAuditoria([{ usuario: s.email, accion: 'editar', coleccion: 'tasas', detalle: `Relleno elTOQUE desde ${desde}: ${r.detalle}` }])
    refrescar()
    return r.guardadas.length ? { ok: true, mensaje: r.detalle } : { ok: false, error: r.detalle }
  } catch (e) {
    return fallo(e)
  }
}

/** Cambia el margen sobre la tasa de elTOQUE y recalcula las tasas automáticas ya guardadas. */
export async function guardarMargen(margen: number): Promise<Resultado> {
  try {
    const s = await autorizar(['admin'])
    if (!Number.isFinite(margen) || margen < -1000 || margen > 1000) throw new Error('Margen inválido.')
    let n = 0
    await mutar({ settings: DEFAULT_SETTINGS, tasas: [] as import('@/lib/types').Tasa[] }, ({ settings, tasas }) => {
      n = 0
      const nuevas = tasas.map((t) => {
        if (t.fuente !== 'eltoque' || !t.mercadoUsd) return t
        n++
        return { ...t, cupPorUsd: Math.round((t.mercadoUsd + margen) * 100) / 100 }
      })
      return { settings: { ...settings, margenCupUsd: margen }, tasas: nuevas }
    })
    await registrarAuditoria([{ usuario: s.email, accion: 'editar', coleccion: 'settings', detalle: `Margen CUP/USD = ${margen} (${n} tasas recalculadas)` }])
    refrescar()
    return { ok: true, mensaje: `Margen guardado. ${n} tasas de elTOQUE recalculadas.` }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- extractos bancarios

export interface DatosExtracto {
  existentes: { id: string; fecha: string; importe: number; referencia?: string; concepto: string }[]
  reglas: import('@/lib/types').ReglaCategoria[]
  aprendidas: Record<string, string>
}

/** Lo que el navegador necesita para analizar un extracto de una cuenta: sus movimientos, las reglas y lo aprendido. */
export async function prepararExtracto(cuenta: string): Promise<{ ok: true; datos: DatosExtracto } | { ok: false; error: string }> {
  try {
    await autorizar(['admin', 'contador'])
    const { cargarDataset } = await import('@/lib/data')
    const { claveConcepto } = await import('@/lib/extractos')
    const ds = await cargarDataset()
    if (!ds.cuentas.some((c) => c.nombre === cuenta)) throw new Error('Cuenta desconocida.')
    const existentes = ds.movimientos
      .filter((m) => m.cuenta === cuenta)
      .map((m) => ({ id: m.id, fecha: m.fecha, importe: Math.round((m.entrada - m.salida) * 100) / 100, referencia: m.referencia, concepto: m.concepto }))
    // Aprendizaje: para cada «clave» de concepto, la categoría más usada (si domina claramente).
    const conteo = new Map<string, Map<string, number>>()
    const ignorar = new Set(['Por clasificar', 'Saldo inicial'])
    for (const m of ds.movimientos) {
      if (ignorar.has(m.categoria)) continue
      const k = claveConcepto(m.concepto)
      if (!k) continue
      const signo = m.entrada - m.salida >= 0 ? '+' : '-'
      for (const key of [`${m.cuenta}|${signo}|${k}`, `*|${signo}|${k}`]) {
        const inner = conteo.get(key) ?? new Map<string, number>()
        inner.set(m.categoria, (inner.get(m.categoria) ?? 0) + 1)
        conteo.set(key, inner)
      }
    }
    const aprendidas: Record<string, string> = {}
    for (const [k, inner] of conteo) {
      const total = [...inner.values()].reduce((a, b) => a + b, 0)
      const [cat, n] = [...inner.entries()].sort((a, b) => b[1] - a[1])[0]
      if (n >= 2 && n / total >= 0.6) aprendidas[k] = cat
    }
    return { ok: true, datos: { existentes, reglas: ds.reglas ?? [], aprendidas } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export interface NuevoDesdeExtracto {
  fecha: string
  concepto: string
  referencia?: string
  importe: number
  moneda: 'USD' | 'CUP' | 'EUR'
  categoria: string
  extra?: Record<string, string | number>
}

export async function confirmarExtracto(
  cuenta: string,
  archivo: string,
  nuevos: NuevoDesdeExtracto[],
  correcciones: { id: string; importe: number }[],
  reglasNuevas: { contiene: string; categoria: string; sentido: 'entrada' | 'salida' }[],
  borrar: string[] = [],
): Promise<Resultado> {
  try {
    const s = await autorizar(['admin', 'contador'])
    let creados = 0
    let corregidos = 0
    let omitidos = 0
    let borrados = 0
    await mutar(
      {
        movimientos: [] as import('@/lib/types').Movimiento[],
        categorias: DEFECTOS.categorias,
        cuentas: DEFECTOS.cuentas,
        settings: DEFAULT_SETTINGS,
        reglas: [] as import('@/lib/types').ReglaCategoria[],
      },
      ({ movimientos, categorias, cuentas, settings, reglas }) => {
        creados = corregidos = omitidos = borrados = 0
        if (!cuentas.some((c) => c.nombre === cuenta)) throw new Error('Cuenta desconocida.')
        const cats = new Set(categorias.map((c) => c.nombre))
        // Las líneas que se borran en este mismo envío no cuentan: su referencia puede volver con el importe correcto.
        const refs = new Set(movimientos.filter((m) => m.cuenta === cuenta && m.referencia && !borrar.includes(m.id)).map((m) => m.referencia))
        const cerrado = (f: string) => s.rol !== 'admin' && settings.mesesCerrados.includes(f.slice(0, 7))
        const agregados: import('@/lib/types').Movimiento[] = []
        for (const n of nuevos) {
          if (!esFecha(n.fecha) || !Number.isFinite(n.importe) || !n.importe) throw new Error(`Línea inválida: ${n.fecha} ${n.concepto}`)
          if (cerrado(n.fecha)) throw new Error(`El mes de ${n.fecha} está cerrado.`)
          // Protección ante un doble envío: la misma referencia bancaria no se importa dos veces.
          if (n.referencia && refs.has(n.referencia)) {
            omitidos++
            continue
          }
          if (n.referencia) refs.add(n.referencia)
          agregados.push({
            id: crypto.randomUUID(),
            fecha: n.fecha,
            cuenta,
            categoria: cats.has(n.categoria) ? n.categoria : 'Por clasificar',
            concepto: n.concepto.slice(0, 300),
            ...(n.referencia ? { referencia: n.referencia } : {}),
            moneda: n.moneda,
            entrada: n.importe > 0 ? n.importe : 0,
            salida: n.importe < 0 ? -n.importe : 0,
            observaciones: `Importado del extracto ${archivo}`,
            ...(n.extra && Object.keys(n.extra).length ? { extra: n.extra } : {}),
          })
          creados++
        }
        const mapa = new Map(correcciones.map((c) => [c.id, c.importe]))
        const aBorrar = new Set(borrar)
        const actualizados = movimientos.filter((m) => {
          if (!aBorrar.has(m.id) || m.cuenta !== cuenta) return true
          if (cerrado(m.fecha)) throw new Error(`El mes de ${m.fecha} está cerrado.`)
          borrados++
          return false
        }).map((m) => {
          const imp = mapa.get(m.id)
          if (imp == null || m.cuenta !== cuenta) return m
          if (cerrado(m.fecha)) throw new Error(`El mes de ${m.fecha} está cerrado.`)
          corregidos++
          const nota = `Importe corregido según extracto ${archivo} (antes ${(m.entrada - m.salida).toFixed(2)})`
          return { ...m, entrada: imp > 0 ? imp : 0, salida: imp < 0 ? -imp : 0, observaciones: m.observaciones ? `${m.observaciones} · ${nota}` : nota }
        })
        const nuevasReglas = reglasNuevas
          .filter((r) => r.contiene.trim().length >= 3 && cats.has(r.categoria))
          .filter((r) => !reglas.some((x) => x.contiene.toLowerCase() === r.contiene.toLowerCase() && (x.cuenta ?? '') === cuenta))
          .map((r) => ({ id: crypto.randomUUID(), contiene: r.contiene.trim(), categoria: r.categoria, cuenta, sentido: r.sentido }))
        return { movimientos: [...agregados, ...actualizados], reglas: [...reglas, ...nuevasReglas] }
      },
    )
    await registrarAuditoria([
      {
        usuario: s.email,
        accion: 'importar',
        coleccion: 'movimientos',
        detalle: `Extracto ${archivo} (${cuenta}): ${creados} nuevos, ${corregidos} importes corregidos, ${borrados} borrados por no estar en el banco, ${omitidos} omitidos por referencia repetida`,
      },
    ])
    refrescar()
    return {
      ok: true,
      mensaje: `${creados} movimientos importados, ${corregidos} importes corregidos${borrados ? ` y ${borrados} borrados` : ''}${omitidos ? ` (${omitidos} ya estaban por referencia)` : ''}.`,
    }
  } catch (e) {
    return fallo(e)
  }
}

/** USD que vale 1 EUR en las cajas (por defecto 1, el euro se toma 1×1 en la oficina). */
export async function guardarEurCaja(valor: number): Promise<Resultado> {
  try {
    const s = await autorizar(['admin'])
    if (!Number.isFinite(valor) || valor <= 0 || valor > 5) throw new Error('Valor inválido.')
    await mutar({ settings: DEFAULT_SETTINGS }, ({ settings }) => ({ settings: { ...settings, eurCajaUsd: valor } }))
    await registrarAuditoria([{ usuario: s.email, accion: 'editar', coleccion: 'settings', detalle: `EUR en caja = ${valor} USD` }])
    refrescar()
    return { ok: true, mensaje: `El euro en caja vale ahora ${valor} USD.` }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- remesas

type Remesa = import('@/lib/types').Remesa

/** Categorías que necesita el módulo de remesas; se crean si el catálogo guardado no las tiene. */
async function asegurarCategoriasRemesas(categorias: Categoria[]): Promise<Categoria[] | null> {
  const { DEFAULT_CATEGORIAS } = await import('@/lib/catalog')
  const faltan = ['Comisiones de remesas', 'Pago a agentes de remesas']
    .filter((n) => !categorias.some((c) => c.nombre === n))
    .map((n) => ({ ...DEFAULT_CATEGORIAS.find((c) => c.nombre === n)!, id: `cat-${crypto.randomUUID()}` }))
  const remesa = categorias.find((c) => c.nombre === 'Remesa')
  const corregir = remesa && remesa.contrapartida === 'fondos_terceros'
  if (!faltan.length && !corregir) return null
  return [...categorias.map((c) => (c.nombre === 'Remesa' && corregir ? { ...c, contrapartida: 'remesas' as const } : c)), ...faltan]
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function guardarRemesa(id: string | null, v: Record<string, unknown>): Promise<Resultado> {
  try {
    const s = await autorizar(['admin', 'contador', 'cajero'])
    let numero = ''
    await mutar({ remesas: [] as Remesa[], settings: DEFAULT_SETTINGS, categorias: DEFECTOS.categorias, cuentas: DEFECTOS.cuentas }, async ({ remesas, settings, categorias, cuentas }) => {
      const previo = id ? remesas.find((r) => r.id === id) : undefined
      if (id && !previo) throw new Error('La remesa ya no existe.')
      if (previo?.liquidacion && s.rol !== 'admin') throw new Error('Esta remesa ya se le pagó al agente: solo el administrador puede modificarla.')
      const txt = (k: string, req = false) => {
        const x = String(v[k] ?? '').trim()
        if (req && !x) throw new Error(`Falta «${k}».`)
        return x || undefined
      }
      const num = (k: string) => {
        const x = Number(String(v[k] ?? '').replace(',', '.'))
        return Number.isFinite(x) ? x : NaN
      }
      const fecha = txt('fecha', true)!
      if (!esFecha(fecha)) throw new Error('Fecha inválida.')
      if (s.rol !== 'admin' && settings.mesesCerrados.includes(fecha.slice(0, 7))) throw new Error('Ese mes está cerrado.')
      const monto = num('monto')
      if (!(monto > 0)) throw new Error('El monto debe ser mayor que 0.')
      const pct = Number(settings.comisionRemesasPct ?? 10)
      const comision = String(v.comision ?? '') === '' ? r2((monto * pct) / 100) : num('comision')
      if (!(comision >= 0)) throw new Error('Comisión inválida.')
      const monedaEntrega = (txt('monedaEntrega') ?? 'USD') as Remesa['monedaEntrega']
      if (!['USD', 'CUP', 'MLC', 'EUR'].includes(monedaEntrega)) throw new Error('Moneda de entrega inválida.')
      const tasa = num('tasaEntrega')
      if (monedaEntrega === 'CUP' && !(tasa > 0)) throw new Error('Indica la tasa de entrega en CUP.')
      const montoEntregar = monedaEntrega === 'CUP' ? Math.round(monto * tasa) : monto
      const { AGENTE_PROPIO } = await import('@/lib/ledger')
      const agente = txt('agente', true)!
      if (agente !== AGENTE_PROPIO && !(settings.agentesRemesas ?? DEFAULT_SETTINGS.agentesRemesas).includes(agente)) throw new Error('Agente desconocido.')
      const cuentaCobro = txt('cuentaCobro')
      if (cuentaCobro && !cuentas.some((c) => c.nombre === cuentaCobro)) throw new Error('Cuenta de cobro desconocida.')
      if (!previo) {
        const max = remesas.reduce((m, r) => Math.max(m, Number(r.numero.replace(/\D/g, '')) || 0), 0)
        numero = `R-${String(max + 1).padStart(6, '0')}`
      } else numero = previo.numero
      const r: Remesa = {
        ...(previo ?? { estado: 'pendiente' as const, creadoPor: s.email }),
        id: previo?.id ?? crypto.randomUUID(),
        numero,
        fecha,
        remitente: txt('remitente', true)!,
        remitenteTelefono: txt('remitenteTelefono'),
        beneficiario: txt('beneficiario', true)!,
        beneficiarioTelefono: txt('beneficiarioTelefono'),
        beneficiarioCI: txt('beneficiarioCI'),
        direccion: txt('direccion'),
        provincia: txt('provincia'),
        monto: r2(monto),
        comision: r2(comision),
        monedaEntrega,
        ...(monedaEntrega === 'CUP' ? { tasaEntrega: tasa } : { tasaEntrega: undefined }),
        montoEntregar,
        cuentaCobro,
        agente,
        notas: txt('notas'),
      }
      if (r.estado === 'pendiente' && agente) r.estado = 'asignada'
      const nuevasCats = await asegurarCategoriasRemesas(categorias)
      return { remesas: previo ? remesas.map((x) => (x.id === r.id ? r : x)) : [r, ...remesas], ...(nuevasCats ? { categorias: nuevasCats } : {}) }
    })
    await registrarAuditoria([{ usuario: s.email, accion: id ? 'editar' : 'crear', coleccion: 'remesas', registroId: id ?? undefined, detalle: numero }])
    refrescar()
    return { ok: true, mensaje: id ? `Remesa ${numero} guardada.` : `Remesa ${numero} creada.` }
  } catch (e) {
    return fallo(e)
  }
}

/** Marca una remesa como entregada. Los agentes solo pueden marcar las suyas. Las fotos llegan comprimidas desde el navegador (data URL). */
export async function entregarRemesa(id: string, fechaEntrega: string, comprobante: string, fotos: string[]): Promise<Resultado> {
  try {
    const s = await autorizar(['admin', 'contador', 'cajero', 'agente'])
    if (!esFecha(fechaEntrega)) throw new Error('Fecha de entrega inválida.')
    if (fotos.length > 4) throw new Error('Como máximo 4 fotos.')
    const { guardarArchivo, leer } = await import('@/lib/store')
    const actual = (await leer<Remesa[]>('remesas', [])).find((r) => r.id === id)
    if (!actual) throw new Error('La remesa no existe.')
    if (s.rol === 'agente' && actual.agente !== s.agente) throw new Error('Esta remesa no es tuya.')
    const rutas: string[] = []
    for (const f of fotos) {
      const m = f.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/)
      if (!m) throw new Error('Formato de foto no válido.')
      const buf = Buffer.from(m[2], 'base64')
      if (buf.length > 1_500_000) throw new Error('Una foto es demasiado grande.')
      rutas.push(await guardarArchivo(`remesas/${id}/${crypto.randomUUID()}.${m[1] === 'image/png' ? 'png' : 'jpg'}`, buf, m[1]))
    }
    await mutar({ remesas: [] as Remesa[] }, ({ remesas }) => {
      const r = remesas.find((x) => x.id === id)
      if (!r) throw new Error('La remesa no existe.')
      if (r.estado === 'cancelada') throw new Error('La remesa está cancelada.')
      if (s.rol === 'agente' && r.agente !== s.agente) throw new Error('Esta remesa no es tuya.')
      if (r.liquidacion) throw new Error('La remesa ya está liquidada.')
      const nueva: Remesa = { ...r, estado: 'entregada', fechaEntrega, comprobante: comprobante.trim() || r.comprobante, fotos: [...(r.fotos ?? []), ...rutas] }
      return { remesas: remesas.map((x) => (x.id === id ? nueva : x)) }
    })
    await registrarAuditoria([{ usuario: s.email, accion: 'editar', coleccion: 'remesas', registroId: id, detalle: `${actual.numero} entregada el ${fechaEntrega}` }])
    refrescar()
    return { ok: true, mensaje: `Remesa ${actual.numero} marcada como entregada.` }
  } catch (e) {
    return fallo(e)
  }
}

export async function cambiarEstadoRemesa(id: string, estado: 'asignada' | 'cancelada'): Promise<Resultado> {
  try {
    const s = await autorizar(['admin', 'contador'])
    let numero = ''
    await mutar({ remesas: [] as Remesa[] }, ({ remesas }) => {
      const r = remesas.find((x) => x.id === id)
      if (!r) throw new Error('La remesa no existe.')
      if (r.liquidacion) throw new Error('La remesa ya está liquidada al agente.')
      numero = r.numero
      const nueva: Remesa = estado === 'asignada' ? { ...r, estado, fechaEntrega: undefined } : { ...r, estado }
      return { remesas: remesas.map((x) => (x.id === id ? nueva : x)) }
    })
    await registrarAuditoria([{ usuario: s.email, accion: 'editar', coleccion: 'remesas', registroId: id, detalle: `${numero} → ${estado}` }])
    refrescar()
    return { ok: true, mensaje: estado === 'cancelada' ? `Remesa ${numero} cancelada.` : `Remesa ${numero} reabierta.` }
  } catch (e) {
    return fallo(e)
  }
}

/** Paga al agente las remesas entregadas: crea la salida de dinero y las marca como liquidadas. */
export async function liquidarAgente(agente: string, ids: string[], cuenta: string, fecha: string): Promise<Resultado> {
  try {
    const s = await autorizar(['admin', 'contador'])
    if (!esFecha(fecha)) throw new Error('Fecha inválida.')
    if (!ids.length) throw new Error('Elige al menos una remesa.')
    let total = 0
    const movId = crypto.randomUUID()
    await mutar(
      { remesas: [] as Remesa[], movimientos: [] as import('@/lib/types').Movimiento[], cuentas: DEFECTOS.cuentas, categorias: DEFECTOS.categorias, settings: DEFAULT_SETTINGS },
      async ({ remesas, movimientos, cuentas, categorias, settings }) => {
        if (!cuentas.some((c) => c.nombre === cuenta)) throw new Error('Cuenta desconocida.')
        if (s.rol !== 'admin' && settings.mesesCerrados.includes(fecha.slice(0, 7))) throw new Error('Ese mes está cerrado.')
        const set = new Set(ids)
        const elegidas = remesas.filter((r) => set.has(r.id))
        if (elegidas.length !== ids.length) throw new Error('Alguna remesa ya no existe.')
        for (const r of elegidas) {
          if (r.agente !== agente) throw new Error(`${r.numero} no es de ${agente}.`)
          if (r.estado !== 'entregada') throw new Error(`${r.numero} no está entregada.`)
          if (r.liquidacion) throw new Error(`${r.numero} ya estaba liquidada.`)
        }
        total = r2(elegidas.reduce((a, r) => a + r.monto, 0))
        const mov: import('@/lib/types').Movimiento = {
          id: movId,
          fecha,
          cuenta,
          categoria: 'Pago a agentes de remesas',
          concepto: `Liquidación de ${elegidas.length} remesas a ${agente} (${elegidas[0].numero}…${elegidas.at(-1)!.numero})`,
          moneda: 'USD',
          entrada: 0,
          salida: total,
          observaciones: elegidas.map((r) => r.numero).join(', '),
        }
        const nuevasCats = await asegurarCategoriasRemesas(categorias)
        return {
          remesas: remesas.map((r) => (set.has(r.id) ? { ...r, liquidacion: movId } : r)),
          movimientos: [mov, ...movimientos],
          ...(nuevasCats ? { categorias: nuevasCats } : {}),
        }
      },
    )
    await registrarAuditoria([{ usuario: s.email, accion: 'crear', coleccion: 'remesas', detalle: `Liquidación a ${agente}: ${ids.length} remesas, ${total} USD desde ${cuenta}` }])
    refrescar()
    return { ok: true, mensaje: `Pago a ${agente} registrado: ${total.toFixed(2)} USD por ${ids.length} remesas.` }
  } catch (e) {
    return fallo(e)
  }
}

export async function guardarAjustesRemesas(pct: number, agentes: string[]): Promise<Resultado> {
  try {
    const s = await autorizar(['admin'])
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) throw new Error('Comisión inválida.')
    const lista = [...new Set(agentes.map((a) => a.trim()).filter(Boolean))]
    if (!lista.length) throw new Error('Indica al menos un agente.')
    await mutar({ settings: DEFAULT_SETTINGS, remesas: [] as Remesa[] }, ({ settings, remesas }) => {
      const enUso = [...new Set(remesas.map((r) => r.agente))].filter((a) => !lista.includes(a) && a !== 'Tropicargo (caja propia)')
      if (enUso.length) throw new Error(`No se puede quitar ${enUso.join(', ')}: tiene remesas.`)
      return { settings: { ...settings, comisionRemesasPct: pct, agentesRemesas: lista } }
    })
    await registrarAuditoria([{ usuario: s.email, accion: 'editar', coleccion: 'settings', detalle: `Remesas: comisión ${pct}%, agentes ${lista.join(', ')}` }])
    refrescar()
    return { ok: true, mensaje: 'Ajustes de remesas guardados.' }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- PayPal (API)

export async function traerPayPal(desde: string, hasta: string): Promise<{ ok: true; tabla: import('@/lib/extractos').Tabla } | { ok: false; error: string }> {
  try {
    await autorizar(['admin', 'contador'])
    if (!esFecha(desde) || !esFecha(hasta) || desde > hasta) throw new Error('Rango de fechas inválido.')
    if ((Date.parse(hasta) - Date.parse(desde)) / 86400000 > 400) throw new Error('Como máximo 400 días por consulta.')
    const { transaccionesPayPal } = await import('@/lib/paypal')
    return { ok: true, tabla: await transaccionesPayPal(desde, hasta) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------------------------------------------------------------- Tracking Premium

type NuevaFacturaTP = Omit<import('@/lib/types').FacturaVenta, 'id'>
export interface CambioFacturaTP {
  numero: string
  cliente: string
  campos: { campo: 'monto' | 'cobrado' | 'estatusSistema'; antes: string | number | undefined; despues: string | number | undefined }[]
}
export interface SyncTP {
  totales: { facturas: number; monto: number; cobrado: number }
  nuevas: NuevaFacturaTP[]
  cambios: CambioFacturaTP[]
  iguales: number
  soloSistema: { id: string; numero: string; cliente: string; emision: string; monto: number }[]
}

/** Compara las facturas de Tracking Premium del período con las de la contabilidad. No guarda nada. */
export async function prepararSyncTP(desde: string, hasta: string): Promise<{ ok: true; sync: SyncTP } | { ok: false; error: string }> {
  try {
    await autorizar(['admin', 'contador'])
    if (!esFecha(desde) || !esFecha(hasta) || desde > hasta) throw new Error('Rango de fechas inválido.')
    if ((Date.parse(hasta) - Date.parse(desde)) / 86400000 > 120) throw new Error('Como máximo 120 días por consulta.')
    const { facturasTP, aFactura } = await import('@/lib/trackingpremium')
    const { cargarDataset } = await import('@/lib/data')
    const [tp, ds] = await Promise.all([facturasTP(desde, hasta), cargarDataset()])
    const porNumero = new Map(ds.facturas.map((f) => [f.numero.toUpperCase(), f]))
    const enTP = new Set(tp.lista.map((f) => f.number.toUpperCase()))
    const nuevasLista = tp.lista.filter((f) => !porNumero.has(f.number.toUpperCase()))
    const det = nuevasLista.length ? await tp.conDetalle(nuevasLista.map((f) => f.number)) : new Map()
    const nuevas = nuevasLista.map((f) => aFactura(f, det.get(f.number))).sort((a, b) => a.emision.localeCompare(b.emision) || a.numero.localeCompare(b.numero))
    // El vencimiento de las facturas ya registradas no se toca: el Excel original usaba otra convención.
    const cambios: CambioFacturaTP[] = []
    let iguales = 0
    for (const f of tp.lista) {
      const sis = porNumero.get(f.number.toUpperCase())
      if (!sis) continue
      const n = aFactura(f)
      const campos: CambioFacturaTP['campos'] = []
      if (Math.abs(sis.monto - n.monto) > 0.005) campos.push({ campo: 'monto', antes: sis.monto, despues: n.monto })
      if (Math.abs(sis.cobrado - n.cobrado) > 0.005) campos.push({ campo: 'cobrado', antes: sis.cobrado, despues: n.cobrado })
      if ((sis.estatusSistema ?? '') !== (n.estatusSistema ?? '')) campos.push({ campo: 'estatusSistema', antes: sis.estatusSistema, despues: n.estatusSistema })
      if (campos.length) cambios.push({ numero: sis.numero, cliente: sis.cliente, campos })
      else iguales++
    }
    const soloSistema = ds.facturas
      .filter((f) => /^INV/i.test(f.numero) && f.emision >= desde && f.emision <= hasta && !enTP.has(f.numero.toUpperCase()))
      .map((f) => ({ id: f.id, numero: f.numero, cliente: f.cliente, emision: f.emision, monto: f.monto }))
    return { ok: true, sync: { totales: tp.totales, nuevas, cambios, iguales, soloSistema } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Guarda lo revisado: facturas nuevas, datos actualizados y, si se marcan, las que Tracking Premium ya no tiene. */
export async function confirmarSyncTP(nuevas: NuevaFacturaTP[], cambios: CambioFacturaTP[], borrar: string[]): Promise<Resultado> {
  try {
    const s = await autorizar(['admin', 'contador'])
    let creadas = 0
    let actualizadas = 0
    let borradas = 0
    await mutar({ facturas: [] as import('@/lib/types').FacturaVenta[], settings: DEFAULT_SETTINGS }, ({ facturas, settings }) => {
      const cerrado = (f: string) => s.rol !== 'admin' && settings.mesesCerrados.includes(f.slice(0, 7))
      const existentes = new Set(facturas.map((f) => f.numero.toUpperCase()))
      const aBorrar = new Set(borrar)
      const porNumero = new Map(cambios.map((c) => [c.numero.toUpperCase(), c]))
      const resultado = facturas
        .filter((f) => {
          if (!aBorrar.has(f.id)) return true
          if (cerrado(f.emision)) throw new Error(`El mes de ${f.emision} está cerrado.`)
          borradas++
          return false
        })
        .map((f) => {
          const c = porNumero.get(f.numero.toUpperCase())
          if (!c) return f
          if (cerrado(f.emision)) throw new Error(`El mes de ${f.emision} está cerrado.`)
          actualizadas++
          const n = { ...f }
          for (const x of c.campos) {
            if (x.campo === 'monto' || x.campo === 'cobrado') {
              if (!Number.isFinite(Number(x.despues))) throw new Error(`Importe inválido en ${f.numero}.`)
              n[x.campo] = Number(x.despues)
            } else n[x.campo] = x.despues == null ? undefined : String(x.despues)
          }
          return n
        })
      for (const f of nuevas) {
        if (!f.numero || !esFecha(f.emision) || !Number.isFinite(f.monto) || !Number.isFinite(f.cobrado)) throw new Error(`Factura inválida: ${f.numero}`)
        if (existentes.has(f.numero.toUpperCase())) continue
        if (cerrado(f.emision)) throw new Error(`El mes de ${f.emision} está cerrado.`)
        existentes.add(f.numero.toUpperCase())
        resultado.push({ ...f, id: `fv-tp-${f.numero}` })
        creadas++
      }
      return { facturas: resultado }
    })
    await registrarAuditoria([
      { usuario: s.email, accion: 'importar', coleccion: 'facturas', detalle: `Tracking Premium: ${creadas} nuevas, ${actualizadas} actualizadas, ${borradas} borradas` },
    ])
    refrescar()
    return { ok: true, mensaje: `${creadas} facturas nuevas, ${actualizadas} actualizadas${borradas ? ` y ${borradas} borradas` : ''}.` }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- cobros de Tracking Premium

export interface ConciliacionCobrosTP {
  caja: string
  grupos: import('@/lib/conciliar-cobros').GrupoCobro[]
  /** Pagos del período que no entran en una caja física (Square, PayPal, wallet, banco…), por tipo y cuenta. */
  otros: { tipo: string; cuentaTP: string; n: number; monto: number }[]
}

const sumarDias = (f: string, d: number) => new Date(Date.parse(`${f}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)

/** Compara los pagos verificados de Tracking Premium con los cobros registrados en una caja. No guarda nada. */
export async function prepararCobrosTP(caja: string, desde: string, hasta: string): Promise<{ ok: true; datos: ConciliacionCobrosTP } | { ok: false; error: string }> {
  try {
    await autorizar(['admin', 'contador'])
    if (!esFecha(desde) || !esFecha(hasta) || desde > hasta) throw new Error('Rango de fechas inválido.')
    if ((Date.parse(hasta) - Date.parse(desde)) / 86400000 > 120) throw new Error('Como máximo 120 días por consulta.')
    const { pagosTP, refsCobro } = await import('@/lib/trackingpremium')
    const { CAJA_DE_CUENTA_TP, conciliarCobros } = await import('@/lib/conciliar-cobros')
    const { cargarContabilidad } = await import('@/lib/data')
    // Se piden unos días de margen a cada lado: un cobro puede registrarse en la caja un día antes o después.
    const [todos, { ds, mayor }] = await Promise.all([pagosTP(sumarDias(desde, -5), sumarDias(hasta, 5)), cargarContabilidad()])
    // Pagar con wallet no mete efectivo en la caja: el dinero entró antes, con la recarga de billetera.
    const enCaja = (p: { tipo: string; cuentaTP: string }) => Boolean(CAJA_DE_CUENTA_TP[p.cuentaTP]) && p.tipo !== 'Wallet'
    const pagos = todos.filter((p) => enCaja(p) && CAJA_DE_CUENTA_TP[p.cuentaTP] === caja)
    const cobros = ds.movimientos
      .filter((m) => m.cuenta === caja && m.categoria === 'Cobro cliente' && m.fecha >= sumarDias(desde, -5) && m.fecha <= sumarDias(hasta, 5) && !/recarga\s+(de\s+)?billetera/i.test(m.concepto))
      .map((m) => ({ id: m.id, fecha: m.fecha, concepto: m.concepto, usd: mayor.usd.get(m.id) ?? 0, refs: refsCobro(`${m.concepto} ${m.referencia ?? ''}`) }))
    const grupos = conciliarCobros(pagos, cobros).filter((g) => g.fecha >= desde && g.fecha <= hasta)
    const otros = new Map<string, { tipo: string; cuentaTP: string; n: number; monto: number }>()
    for (const p of todos) {
      if (enCaja(p) || p.fecha < desde || p.fecha > hasta) continue
      const k = `${p.tipo}|${p.cuentaTP}`
      const o = otros.get(k) ?? { tipo: p.tipo, cuentaTP: p.cuentaTP || 'N/A', n: 0, monto: 0 }
      o.n++
      o.monto += p.monto
      otros.set(k, o)
    }
    return { ok: true, datos: { caja, grupos, otros: [...otros.values()].sort((a, b) => b.monto - a.monto) } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Registra en la caja, como «Cobro cliente», los pagos de Tracking Premium elegidos. */
export async function importarCobrosTP(caja: string, pagos: import('@/lib/trackingpremium').PagoTP[]): Promise<Resultado> {
  try {
    const s = await autorizar(['admin', 'contador'])
    const { CAJA_DE_CUENTA_TP } = await import('@/lib/conciliar-cobros')
    let creados = 0
    let omitidos = 0
    await mutar({ movimientos: [] as import('@/lib/types').Movimiento[], settings: DEFAULT_SETTINGS }, ({ movimientos, settings }) => {
      const refs = new Set(movimientos.map((m) => m.referencia).filter(Boolean))
      const nuevos: import('@/lib/types').Movimiento[] = []
      for (const p of pagos) {
        if (CAJA_DE_CUENTA_TP[p.cuentaTP] !== caja || p.tipo === 'Wallet') throw new Error(`El pago ${p.numero} no es un cobro en efectivo de ${caja}.`)
        if (!esFecha(p.fecha) || !Number.isFinite(p.monto) || p.monto <= 0) throw new Error(`Pago inválido: ${p.numero}`)
        if (s.rol !== 'admin' && settings.mesesCerrados.includes(p.fecha.slice(0, 7))) throw new Error(`El mes de ${p.fecha} está cerrado.`)
        const referencia = `TP-PAGO-${p.id}`
        if (refs.has(referencia)) {
          omitidos++
          continue
        }
        refs.add(referencia)
        nuevos.push({
          id: crypto.randomUUID(),
          fecha: p.fecha,
          cuenta: caja,
          categoria: 'Cobro cliente',
          concepto: `${p.refs.join(', ') || p.numero} ${p.cliente}`.slice(0, 300),
          referencia,
          moneda: 'USD',
          entrada: p.monto,
          salida: 0,
          observaciones: `Importado de Tracking Premium (${p.numero}, ${p.tipo}, ${p.cuentaTP})`,
        })
        creados++
      }
      return { movimientos: [...movimientos, ...nuevos] }
    })
    await registrarAuditoria([{ usuario: s.email, accion: 'importar', coleccion: 'movimientos', detalle: `Cobros de Tracking Premium en ${caja}: ${creados} registrados` }])
    refrescar()
    return { ok: true, mensaje: `${creados} cobros registrados en ${caja}${omitidos ? ` (${omitidos} ya estaban)` : ''}.` }
  } catch (e) {
    return fallo(e)
  }
}
