'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { aplicarLote } from '@/lib/aplicar'
import { autorizar, cerrarSesion, hashPassword, iniciarSesion, tiendaFija, verificarPassword, type Sesion } from '@/lib/auth'
import { ClienteAxis, mapaAreas, mapearOperaciones, proponerAreas } from '@/lib/axispos'
import { DEFAULT_SETTINGS } from '@/lib/catalogo'
import { cargarDataset, leerUsuarios, registrarAuditoria } from '@/lib/data'
import { COLECCIONES_OPERATIVAS, DEFECTOS } from '@/lib/defectos'
import { esFecha, ym } from '@/lib/fecha'
import { aUSD, prepararTasas, tasaVigente } from '@/lib/fx'
import type { LoteKM } from '@/lib/importar-km'
import { leerArchivo, type TipoImport } from '@/lib/plantillas'
import { ROLES_LISTA } from '@/lib/permisos'
import { borrarSubida, leerSubida, mutar } from '@/lib/store'
import type { Asiento, Categoria, CategoriaPago, Compra, Dataset, Deuda, LineaER, Moneda, Movimiento, Producto, Rol, Salida, Settings, Tasa, Tienda, Usuario } from '@/lib/types'

export type Resultado = { ok: true; mensaje?: string } | { ok: false; error: string }

const fallo = (e: unknown): Resultado => ({ ok: false, error: e instanceof Error ? e.message : String(e) })
const refrescar = () => revalidatePath('/', 'layout')
const uid = () => crypto.randomUUID()

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
function numero(f: FormData, k: string, requerido = true): number | undefined {
  const s = str(f, k).replace(/\s/g, '').replace(',', '.')
  if (!s) {
    if (requerido) throw new Error(`Falta «${k}».`)
    return undefined
  }
  const n = Number(s)
  if (!Number.isFinite(n)) throw new Error(`«${k}» no es un número válido.`)
  return n
}
function fecha(f: FormData, k = 'fecha') {
  const v = str(f, k)
  if (!esFecha(v)) throw new Error('La fecha debe tener el formato AAAA-MM-DD.')
  return v
}
const MONEDAS = new Set(['CUP', 'USD', 'EUR', 'MLC'])
function moneda(f: FormData, k = 'moneda'): Moneda {
  const m = str(f, k).toUpperCase()
  if (!MONEDAS.has(m)) throw new Error('Moneda no válida.')
  return m as Moneda
}

/** Comprueba que el mes no esté cerrado (solo el propietario puede tocar meses cerrados). */
function comprobarMes(s: Sesion, settings: Settings, ...fechas: string[]) {
  for (const f of fechas) if (settings.mesesCerrados.includes(ym(f)) && s.rol !== 'propietario') throw new Error(`El mes ${ym(f)} está cerrado.`)
}

/** Tienda del formulario, forzada a la del usuario si es contador de tienda. */
function tiendaDe(s: Sesion, f: FormData, ds: Dataset) {
  const fija = tiendaFija(s)
  const t = fija ?? str(f, 'tienda')
  if (!ds.tiendas.some((x) => x.id === t)) throw new Error('Selecciona una tienda válida.')
  return t
}

// ---------------------------------------------------------------- sesión y preferencias

export async function accionLogin(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  const r = await iniciarSesion(str(form, 'email'), String(form.get('password') ?? ''))
  if (!r.ok) return r
  redirect('/')
}

export async function accionLogout() {
  await cerrarSesion()
  redirect('/login')
}

export async function accionPreferencia(form: FormData) {
  const c = await cookies()
  const opts = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' as const }
  if (form.has('tienda')) c.set('ka_tienda', str(form, 'tienda'), opts)
  if (form.has('vista')) c.set('ka_vista', str(form, 'vista') === 'CUP' ? 'CUP' : 'USD', opts)
  if (form.has('tema')) c.set('ka_tema', str(form, 'tema') === 'oscuro' ? 'oscuro' : 'claro', opts)
  refrescar()
}

export async function accionCambiarPassword(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar()
    const actual = String(form.get('actual') ?? '')
    const nueva = String(form.get('nueva') ?? '')
    if (nueva.length < 10) throw new Error('La nueva contraseña debe tener al menos 10 caracteres.')
    const u = (await leerUsuarios()).find((x) => x.id === s.id)
    if (!u || !(await verificarPassword(actual, u.hash))) throw new Error('La contraseña actual no es correcta.')
    const hash = await hashPassword(nueva)
    await mutar({ usuarios: [] as Usuario[] }, ({ usuarios }) => ({ usuarios: usuarios.map((x) => (x.id === s.id ? { ...x, hash } : x)) }))
    await registrarAuditoria([{ usuario: s.email, accion: 'cambiar contraseña', coleccion: 'usuarios', ref: s.id }])
    return { ok: true, mensaje: 'Contraseña actualizada.' }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- registros

export async function accionMovimiento(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const ds = await cargarDataset()
    const libro = str(form, 'libro') === 'banco' ? 'banco' : 'caja'
    const s = await autorizar('caja', str(form, 'tienda'))
    const m: Movimiento = {
      id: uid(),
      libro,
      fecha: fecha(form),
      tienda: tiendaDe(s, form, ds),
      ...(libro === 'banco' ? { cuenta: str(form, 'cuenta').toUpperCase() || 'SIN CUENTA', fiscal: form.get('fiscal') === 'on' } : {}),
      cajero: str(form, 'cajero') || undefined,
      comprobante: str(form, 'comprobante') || undefined,
      categoria: str(form, 'categoria'),
      concepto: str(form, 'concepto') || undefined,
      observaciones: str(form, 'observaciones') || undefined,
      tipo: str(form, 'tipo') === 'Entrada' ? 'Entrada' : 'Salida',
      moneda: moneda(form),
      monto: Math.abs(numero(form, 'monto')!),
      tasa: numero(form, 'tasa', false),
      origen: 'manual',
    }
    if (!m.monto) throw new Error('El monto no puede ser 0.')
    if (!ds.categorias.some((c) => c.nombre === m.categoria)) throw new Error('Elige una categoría del catálogo.')
    comprobarMes(s, ds.settings, m.fecha)
    await mutar({ movimientos: [] as Movimiento[] }, ({ movimientos }) => ({ movimientos: [...movimientos, m] }))
    await registrarAuditoria([{ usuario: s.email, accion: 'crear', coleccion: 'movimientos', ref: m.id, detalle: `${m.fecha} ${m.tipo} ${m.monto} ${m.moneda} ${m.categoria}` }])
    refrescar()
    return { ok: true, mensaje: 'Movimiento registrado.' }
  } catch (e) {
    return fallo(e)
  }
}

export async function accionSalida(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const ds = await cargarDataset()
    const tipo = str(form, 'tipo') as Salida['tipo']
    if (!['venta', 'merma', 'consumo', 'devolucion'].includes(tipo)) throw new Error('Tipo no válido.')
    const s = await autorizar(tipo === 'venta' || tipo === 'devolucion' ? 'ventas' : 'inventario', str(form, 'tienda'))
    const cantidad = numero(form, 'cantidad')!
    const sal: Salida = {
      id: uid(),
      tipo,
      fecha: fecha(form),
      tienda: tiendaDe(s, form, ds),
      operacion: str(form, 'operacion') || undefined,
      producto: str(form, 'producto') || undefined,
      cantidad,
      ...(tipo === 'venta' || tipo === 'devolucion' ? { importe: numero(form, 'importe')!, moneda: moneda(form) } : {}),
      costoUSD: numero(form, 'costo', false),
      origen: 'manual',
      nota: str(form, 'nota') || undefined,
    }
    if (!sal.producto) throw new Error('Indica el producto.')
    comprobarMes(s, ds.settings, sal.fecha)
    await mutar({ salidas: [] as Salida[] }, ({ salidas }) => ({ salidas: [...salidas, sal] }))
    await registrarAuditoria([{ usuario: s.email, accion: 'crear', coleccion: 'salidas', ref: sal.id, detalle: `${sal.tipo} ${sal.producto} x${cantidad}` }])
    refrescar()
    return { ok: true, mensaje: tipo === 'venta' ? 'Venta registrada.' : 'Ajuste registrado.' }
  } catch (e) {
    return fallo(e)
  }
}

/**
 * Compra normal o distribuida. En modo CUP el importe se convierte a USD con la tasa elegida
 * (Toque o la de compra de la tienda). Distribuida: una sola factura repartida por tiendas.
 */
export async function accionCompra(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const ds = await cargarDataset()
    const s = await autorizar('compras', str(form, 'tienda') || undefined)
    const f = fecha(form)
    comprobarMes(s, ds.settings, f)
    const modo = str(form, 'modo') === 'CUP' ? 'CUP' : 'USD'
    const mon: Moneda = modo === 'CUP' ? 'CUP' : moneda(form)
    const importe = numero(form, 'importe')!
    const tabla = prepararTasas(ds.tasas, ds.settings.margenTasa)
    let usd: number
    let tasa: number | undefined
    if (mon === 'USD') usd = importe
    else if (mon === 'CUP') {
      const t = tasaVigente(tabla, f)
      if (!t) throw new Error(`Sin tasa de cambio para ${f}.`)
      tasa = str(form, 'claseTasa') === 'tienda' ? (t.kmCompra ?? t.cupUsd - ds.settings.margenTasa) : t.cupUsd
      usd = importe / tasa
    } else {
      usd = aUSD(tabla, importe, mon, f)
      if (!Number.isFinite(usd)) throw new Error(`Sin tasa ${mon} para ${f}.`)
    }
    const base = {
      fecha: f,
      producto: str(form, 'producto') || undefined,
      proveedor: str(form, 'proveedor') || undefined,
      factura: str(form, 'factura') || undefined,
      moneda: mon,
      pago: (str(form, 'pago') || 'contado') as CategoriaPago,
      fiscal: form.get('fiscal') === 'on',
      origen: 'manual' as const,
      ...(tasa ? { tasa } : {}),
    }
    const cantidad = numero(form, 'cantidad', false)
    let nuevas: Compra[]
    if (form.get('distribuida') === 'on') {
      const partes = ds.tiendas.map((t) => ({ t: t.id, q: numero(form, `q_${t.id}`, false) ?? 0 })).filter((p) => p.q > 0)
      const total = partes.reduce((a, p) => a + p.q, 0)
      if (!partes.length) throw new Error('Reparte la cantidad entre al menos una tienda.')
      if (cantidad && Math.abs(total - cantidad) > 0.0001) throw new Error(`Asignado ${total} de ${cantidad}: la distribución no cuadra.`)
      const grupo = uid()
      nuevas = partes.map((p) => ({ ...base, id: uid(), tienda: p.t, cantidad: p.q, importe: (importe * p.q) / total, importeUSD: (usd * p.q) / total, grupo }))
    } else {
      nuevas = [{ ...base, id: uid(), tienda: tiendaDe(s, form, ds), cantidad, importe, importeUSD: usd }]
    }
    await mutar({ compras: [] as Compra[] }, ({ compras }) => ({ compras: [...compras, ...nuevas] }))
    await registrarAuditoria([{ usuario: s.email, accion: 'crear', coleccion: 'compras', ref: nuevas[0].id, detalle: `${nuevas.length} registro(s) · ${importe} ${mon}` }])
    refrescar()
    return { ok: true, mensaje: nuevas.length > 1 ? `Compra distribuida en ${nuevas.length} tiendas.` : `Compra registrada (${usd.toFixed(2)} USD).` }
  } catch (e) {
    return fallo(e)
  }
}

export async function accionDeuda(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const ds = await cargarDataset()
    const s = await autorizar('deudas')
    const d: Deuda = {
      id: uid(),
      clase: str(form, 'clase') === 'cobrar' ? 'cobrar' : 'pagar',
      fecha: fecha(form),
      vence: str(form, 'vence') || undefined,
      tienda: tiendaDe(s, form, ds),
      contraparte: str(form, 'contraparte') || 'Casa Matriz',
      categoria: str(form, 'categoria'),
      concepto: str(form, 'concepto') || undefined,
      moneda: moneda(form),
      monto: numero(form, 'monto')!,
      origen: 'manual',
    }
    if (!ds.categorias.some((c) => c.nombre === d.categoria)) throw new Error('Elige una categoría del catálogo.')
    comprobarMes(s, ds.settings, d.fecha)
    await mutar({ deudas: [] as Deuda[] }, ({ deudas }) => ({ deudas: [...deudas, d] }))
    await registrarAuditoria([{ usuario: s.email, accion: 'crear', coleccion: 'deudas', ref: d.id, detalle: `${d.clase} ${d.contraparte} ${d.monto} ${d.moneda}` }])
    refrescar()
    return { ok: true, mensaje: 'Deuda registrada.' }
  } catch (e) {
    return fallo(e)
  }
}

export async function accionSaldarDeuda(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('deudas')
    const id = str(form, 'id')
    const saldado = numero(form, 'saldado')!
    await mutar({ deudas: [] as Deuda[] }, ({ deudas }) => ({ deudas: deudas.map((d) => (d.id === id ? { ...d, saldado } : d)) }))
    await registrarAuditoria([{ usuario: s.email, accion: 'saldar', coleccion: 'deudas', ref: id, detalle: String(saldado) }])
    refrescar()
    return { ok: true }
  } catch (e) {
    return fallo(e)
  }
}

export async function accionAsiento(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const ds = await cargarDataset()
    const s = await autorizar('contabilidad')
    const lineas: Asiento['lineas'] = []
    for (let i = 0; i < 6; i++) {
      const cuenta = str(form, `cuenta_${i}`)
      const debe = numero(form, `debe_${i}`, false) ?? 0
      const haber = numero(form, `haber_${i}`, false) ?? 0
      if (!cuenta && !debe && !haber) continue
      if (!cuenta) throw new Error(`Línea ${i + 1}: falta la cuenta.`)
      lineas.push({ cuenta, debe, haber })
    }
    const td = lineas.reduce((a, l) => a + l.debe, 0)
    const th = lineas.reduce((a, l) => a + l.haber, 0)
    if (lineas.length < 2) throw new Error('Un asiento necesita al menos dos líneas.')
    if (Math.abs(td - th) > 0.005) throw new Error(`El asiento no cuadra: Debe ${td.toFixed(2)} ≠ Haber ${th.toFixed(2)}.`)
    const a: Asiento = { id: uid(), fecha: fecha(form), tienda: tiendaDe(s, form, ds), concepto: str(form, 'concepto') || 'Asiento manual', lineas, origen: 'manual' }
    comprobarMes(s, ds.settings, a.fecha)
    await mutar({ asientos: [] as Asiento[] }, ({ asientos }) => ({ asientos: [...asientos, a] }))
    await registrarAuditoria([{ usuario: s.email, accion: 'crear', coleccion: 'asientos', ref: a.id, detalle: `${a.concepto} · ${td.toFixed(2)} USD` }])
    refrescar()
    return { ok: true, mensaje: 'Asiento registrado.' }
  } catch (e) {
    return fallo(e)
  }
}

const BORRABLES = ['movimientos', 'salidas', 'compras', 'deudas', 'asientos'] as const

export async function accionBorrar(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const col = str(form, 'col') as (typeof BORRABLES)[number]
    if (!BORRABLES.includes(col)) throw new Error('Colección no válida.')
    const sec = col === 'movimientos' ? 'caja' : col === 'salidas' ? 'ventas' : col === 'compras' ? 'compras' : col === 'deudas' ? 'deudas' : 'contabilidad'
    const s = await autorizar(sec)
    const ds = await cargarDataset()
    const id = str(form, 'id')
    const reg = (ds[col] as { id: string; fecha: string; tienda: string }[]).find((x) => x.id === id)
    if (!reg) throw new Error('El registro ya no existe.')
    const fija = tiendaFija(s)
    if (fija && reg.tienda !== fija) throw new Error('Solo puedes borrar registros de tu tienda.')
    comprobarMes(s, ds.settings, reg.fecha)
    await mutar({ [col]: [] } as Record<string, { id: string }[]>, (actual) => ({ [col]: actual[col].filter((x) => x.id !== id) }))
    await registrarAuditoria([{ usuario: s.email, accion: 'borrar', coleccion: col, ref: id, detalle: JSON.stringify(reg).slice(0, 300) }])
    refrescar()
    return { ok: true, mensaje: 'Borrado.' }
  } catch (e) {
    return fallo(e)
  }
}

/** Cambia la categoría de un movimiento (bandeja de «por clasificar»). */
export async function accionReclasificar(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('caja')
    const ds = await cargarDataset()
    const id = str(form, 'id')
    const categoria = str(form, 'categoria')
    if (!ds.categorias.some((c) => c.nombre === categoria)) throw new Error('Categoría no válida.')
    const m = ds.movimientos.find((x) => x.id === id)
    if (!m) throw new Error('El movimiento ya no existe.')
    comprobarMes(s, ds.settings, m.fecha)
    await mutar({ movimientos: [] as Movimiento[] }, ({ movimientos }) => ({ movimientos: movimientos.map((x) => (x.id === id ? { ...x, categoria } : x)) }))
    await registrarAuditoria([{ usuario: s.email, accion: 'reclasificar', coleccion: 'movimientos', ref: id, detalle: `${m.categoria} → ${categoria}` }])
    refrescar()
    return { ok: true }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- tasas y configuración

export async function accionTasa(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('tasas')
    const f = fecha(form)
    const o = (k: string) => numero(form, k, false)
    const t: Tasa = { fecha: f, cupUsd: numero(form, 'cupUsd')!, cupEur: o('cupEur'), cupMlc: o('cupMlc'), fiscal: o('fiscal'), kmCompra: o('kmCompra'), kmVenta: o('kmVenta'), fuente: `Manual (${s.email})` }
    if (!(t.cupUsd > 0)) throw new Error('La tasa CUP/USD debe ser mayor que 0.')
    let anterior: Tasa | undefined
    await mutar({ tasas: [] as Tasa[] }, ({ tasas }) => {
      anterior = tasas.find((x) => x.fecha === f)
      return { tasas: [...tasas.filter((x) => x.fecha !== f), t].sort((a, b) => a.fecha.localeCompare(b.fecha)) }
    })
    await registrarAuditoria([{ usuario: s.email, accion: anterior ? 'modificar' : 'crear', coleccion: 'tasas', ref: f, detalle: `${anterior ? `${anterior.cupUsd} → ` : ''}${t.cupUsd} CUP/USD` }])
    refrescar()
    return { ok: true, mensaje: `Tasa del ${f} guardada.` }
  } catch (e) {
    return fallo(e)
  }
}

export async function accionSettings(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('catalogos')
    if (s.rol !== 'propietario' && s.rol !== 'admin') throw new Error('Solo administración.')
    const pct = (k: string) => (numero(form, k)! > 1 ? numero(form, k)! / 100 : numero(form, k)!)
    const cambios: Partial<Settings> = {
      empresa: str(form, 'empresa') || DEFAULT_SETTINGS.empresa,
      fechaInicio: fecha(form, 'fechaInicio'),
      margenTasa: numero(form, 'margenTasa')!,
      impuestoVentas: pct('impuestoVentas'),
      margenMinimo: pct('margenMinimo'),
      pctReinversionDefecto: pct('pctReinversionDefecto'),
      pctInversionistaDefecto: pct('pctInversionistaDefecto'),
      revaluar: form.get('revaluar') === 'on',
    }
    await mutar({ settings: DEFAULT_SETTINGS }, ({ settings }) => ({ settings: { ...DEFAULT_SETTINGS, ...settings, ...cambios } }))
    await registrarAuditoria([{ usuario: s.email, accion: 'modificar', coleccion: 'settings', detalle: JSON.stringify(cambios) }])
    refrescar()
    return { ok: true, mensaje: 'Configuración guardada.' }
  } catch (e) {
    return fallo(e)
  }
}

export async function accionDistribucion(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('contabilidad')
    const mes = str(form, 'mes')
    if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mes no válido.')
    const pct = (k: string) => {
      const n = numero(form, k)!
      return n > 1 ? n / 100 : n
    }
    const d = { mes, pctReinversion: pct('pctReinversion'), pctInversionista: pct('pctInversionista'), ajusteInversionista: numero(form, 'ajusteInversionista', false) }
    await mutar({ distribuciones: [] as Dataset['distribuciones'] }, ({ distribuciones }) => ({ distribuciones: [...distribuciones.filter((x) => x.mes !== mes), d].sort((a, b) => a.mes.localeCompare(b.mes)) }))
    await registrarAuditoria([{ usuario: s.email, accion: 'modificar', coleccion: 'distribuciones', ref: mes, detalle: JSON.stringify(d) }])
    refrescar()
    return { ok: true, mensaje: `Distribución de ${mes} guardada.` }
  } catch (e) {
    return fallo(e)
  }
}

export async function accionCerrarMes(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('contabilidad')
    if (s.rol !== 'propietario' && s.rol !== 'admin') throw new Error('Solo administración puede cerrar o abrir meses.')
    const mes = str(form, 'mes')
    const abrir = str(form, 'abrir') === '1'
    if (abrir && s.rol !== 'propietario') throw new Error('Solo el propietario puede reabrir un mes.')
    await mutar({ settings: DEFAULT_SETTINGS }, ({ settings }) => {
      const set = new Set(settings.mesesCerrados ?? [])
      if (abrir) set.delete(mes)
      else set.add(mes)
      return { settings: { ...DEFAULT_SETTINGS, ...settings, mesesCerrados: [...set].sort() } }
    })
    await registrarAuditoria([{ usuario: s.email, accion: abrir ? 'abrir mes' : 'cerrar mes', coleccion: 'settings', ref: mes }])
    refrescar()
    return { ok: true, mensaje: abrir ? `Mes ${mes} abierto.` : `Mes ${mes} cerrado.` }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- catálogos

export async function accionTienda(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('catalogos')
    const id = (str(form, 'id') || str(form, 'nombre'))
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '')
    if (!id) throw new Error('Falta el nombre.')
    const t: Tienda = {
      id,
      nombre: str(form, 'nombre'),
      tipo: (str(form, 'tipo') || 'local') as Tienda['tipo'],
      direccion: str(form, 'direccion') || undefined,
      alias: str(form, 'alias')
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
      codigoTPV: str(form, 'codigoTPV') || undefined,
      activa: form.get('activa') === 'on',
    }
    await mutar({ tiendas: DEFECTOS.tiendas }, ({ tiendas }) => ({ tiendas: tiendas.some((x) => x.id === id) ? tiendas.map((x) => (x.id === id ? t : x)) : [...tiendas, t] }))
    await registrarAuditoria([{ usuario: s.email, accion: 'guardar', coleccion: 'tiendas', ref: id }])
    refrescar()
    return { ok: true, mensaje: 'Tienda guardada.' }
  } catch (e) {
    return fallo(e)
  }
}

export async function accionCategoria(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('catalogos')
    const nombre = str(form, 'nombre').toUpperCase()
    if (!nombre) throw new Error('Falta el nombre.')
    const contrapartida = str(form, 'contrapartida') as Categoria['contrapartida']
    const c: Categoria = {
      nombre,
      contrapartida,
      ...(contrapartida === 'resultado' ? { linea: (str(form, 'linea') || 'gasto_admin') as LineaER, rubro: str(form, 'rubro') || nombre } : {}),
      flujo: (str(form, 'flujo') || 'explotacion') as Categoria['flujo'],
      caja: form.get('caja') === 'on',
      banco: form.get('banco') === 'on',
      activa: form.get('activa') === 'on',
    }
    await mutar({ categorias: DEFECTOS.categorias }, ({ categorias }) => ({ categorias: categorias.some((x) => x.nombre === nombre) ? categorias.map((x) => (x.nombre === nombre ? c : x)) : [...categorias, c] }))
    await registrarAuditoria([{ usuario: s.email, accion: 'guardar', coleccion: 'categorias', ref: nombre, detalle: JSON.stringify(c) }])
    refrescar()
    return { ok: true, mensaje: 'Categoría guardada.' }
  } catch (e) {
    return fallo(e)
  }
}

export async function accionProducto(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('catalogos')
    const nombre = str(form, 'nombre').toUpperCase()
    if (!nombre) throw new Error('Falta el nombre.')
    const p: Producto = { codigo: str(form, 'codigo') || nombre, nombre, grupo: str(form, 'grupo') || undefined, unidad: str(form, 'unidad') || undefined, costoUSD: numero(form, 'costoUSD', false), precioCUP: numero(form, 'precioCUP', false) }
    await mutar({ productos: [] as Producto[] }, ({ productos }) => ({ productos: productos.some((x) => x.nombre === nombre) ? productos.map((x) => (x.nombre === nombre ? { ...x, ...p } : x)) : [...productos, p] }))
    await registrarAuditoria([{ usuario: s.email, accion: 'guardar', coleccion: 'productos', ref: nombre }])
    refrescar()
    return { ok: true, mensaje: 'Producto guardado.' }
  } catch (e) {
    return fallo(e)
  }
}

export async function accionUsuario(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('catalogos')
    if (s.rol !== 'propietario' && s.rol !== 'admin') throw new Error('Solo administración gestiona usuarios.')
    const email = str(form, 'email').toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Correo no válido.')
    const rol = str(form, 'rol') as Rol
    if (!ROLES_LISTA.includes(rol)) throw new Error('Rol no válido.')
    if (rol === 'propietario' && s.rol !== 'propietario') throw new Error('Solo el propietario puede crear otro propietario.')
    const password = String(form.get('password') ?? '')
    const tiendas = form.getAll('tiendas').map(String).filter(Boolean)
    const usuarios = await leerUsuarios()
    const existe = usuarios.find((u) => u.email === email)
    if (!existe && password.length < 10) throw new Error('La contraseña inicial debe tener al menos 10 caracteres.')
    const hash = password ? await hashPassword(password) : existe!.hash
    const u: Usuario = { id: existe?.id ?? uid(), email, nombre: str(form, 'nombre') || email, rol, hash, activo: form.get('activo') === 'on', tiendas }
    if (existe?.id === s.id && (!u.activo || u.rol !== s.rol)) throw new Error('No puedes desactivarte ni cambiar tu propio rol.')
    await mutar({ usuarios: [] as Usuario[] }, ({ usuarios }) => ({ usuarios: usuarios.some((x) => x.id === u.id) ? usuarios.map((x) => (x.id === u.id ? u : x)) : [...usuarios, u] }))
    await registrarAuditoria([{ usuario: s.email, accion: existe ? 'modificar' : 'crear', coleccion: 'usuarios', ref: email, detalle: rol }])
    refrescar()
    return { ok: true, mensaje: existe ? 'Usuario actualizado.' : 'Usuario creado.' }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- importación

export interface Previa {
  ok: true
  resumen: { movimientos: number; salidas: number; compras: number; tasas: number; productos: number; deudas: number; asientos: number; errores: number; avisos: number; totalUSD: number; totalCUP: number }
  problemas: LoteKM['problemas']
  notas: string[]
  muestra: { hoja: string; fila: number; fecha: string; descripcion: string; importe: string; error?: string }[]
}

async function leerLoteDeForm(form: FormData, s: Sesion, ds: Dataset) {
  // Archivos grandes: el navegador los sube antes a Vercel Blob y aquí llega su ruta.
  const subido = str(form, 'blob')
  const archivo = form.get('archivo')
  let buf: Buffer
  let nombreArchivo: string
  if (subido) {
    buf = await leerSubida(subido)
    nombreArchivo = str(form, 'nombre') || subido.split('/').pop()!
  } else {
    if (!(archivo instanceof File) || !archivo.size) throw new Error('Selecciona un archivo.')
    if (archivo.size > 4 * 1024 * 1024 && process.env.VERCEL) throw new Error('El archivo supera 4 MB: hace falta el almacenamiento Vercel Blob para subirlo.')
    buf = Buffer.from(await archivo.arrayBuffer())
    nombreArchivo = archivo.name
  }
  const tipo = str(form, 'tipo') as TipoImport
  if (!['km', 'ventas', 'compras', 'caja', 'banco', 'tasas'].includes(tipo)) throw new Error('Tipo de importación no válido.')
  const tienda = tiendaFija(s) ?? str(form, 'tienda') ?? 'km26'
  if (!ds.tiendas.some((t) => t.id === tienda)) throw new Error('Selecciona la tienda.')
  const lote = leerArchivo(tipo, buf, ds, tienda)
  // Las compras sin importe en USD se convierten con la tasa del día.
  const tabla = prepararTasas([...ds.tasas, ...lote.tasas], ds.settings.margenTasa)
  for (const c of lote.compras) if (c.importeUSD == null) c.importeUSD = aUSD(tabla, c.importe, c.moneda, c.fecha)
  if (tiendaFija(s)) {
    const ajenas = [...lote.movimientos, ...lote.salidas, ...lote.compras].filter((x) => x.tienda !== tienda)
    if (ajenas.length) throw new Error(`El archivo trae ${ajenas.length} filas de otra tienda.`)
  }
  return { lote, tipo, tienda, nombre: nombreArchivo, subido }
}

export async function accionPrevisualizar(_prev: Previa | Resultado | null, form: FormData): Promise<Previa | Resultado> {
  try {
    const s = await autorizar('importar')
    const ds = await cargarDataset()
    const { lote } = await leerLoteDeForm(form, s, ds)
    const tabla = prepararTasas([...ds.tasas, ...lote.tasas], ds.settings.margenTasa)
    let totalUSD = 0
    let totalCUP = 0
    for (const m of lote.movimientos) {
      const v = aUSD(tabla, m.monto, m.moneda, m.fecha, m.tasa)
      if (Number.isFinite(v)) totalUSD += m.tipo === 'Entrada' ? v : -v
      if (m.moneda === 'CUP') totalCUP += m.tipo === 'Entrada' ? m.monto : -m.monto
    }
    for (const x of lote.salidas) {
      totalUSD += (x.ventaUSD ?? 0) + (x.ingresoTasaUSD ?? 0)
      if (x.moneda === 'CUP') totalCUP += x.importe ?? 0
    }
    for (const c of lote.compras) totalUSD += c.importeUSD ?? 0
    const errores = new Map<string, string>()
    for (const p of lote.problemas) if (p.nivel === 'error') errores.set(`${p.hoja}|${p.fila}`, p.mensaje)
    const conError = lote.movimientos.filter((m) => errores.has(`${m._hoja}|${m._fila}`))
    const muestra: Previa['muestra'] = [...conError, ...lote.movimientos.filter((m) => !errores.has(`${m._hoja}|${m._fila}`))].slice(0, 60).map((m) => ({
      hoja: m._hoja,
      fila: m._fila,
      fecha: m.fecha,
      descripcion: `${m.libro === 'caja' ? 'Caja' : `Banco ${m.cuenta}`} · ${m.tipo} · ${m.categoria}${m.concepto ? ` · ${m.concepto}` : ''}`,
      importe: `${m.monto.toLocaleString('es-ES')} ${m.moneda}`,
      error: errores.get(`${m._hoja}|${m._fila}`),
    }))
    if (!muestra.length)
      for (const x of lote.salidas.slice(0, 40)) muestra.push({ hoja: '', fila: 0, fecha: x.fecha, descripcion: `${x.tipo} · ${x.producto ?? x.nota ?? ''}${x.operacion ? ` · op. ${x.operacion}` : ''}`, importe: x.importe != null ? `${x.importe.toLocaleString('es-ES')} ${x.moneda ?? ''}` : `${(x.costoUSD ?? 0).toFixed(2)} USD costo` })
    if (!muestra.length) for (const c of lote.compras.slice(0, 40)) muestra.push({ hoja: '', fila: 0, fecha: c.fecha, descripcion: `${c.producto ?? c.nota ?? ''} · ${c.proveedor ?? ''}`, importe: `${c.importe.toLocaleString('es-ES')} ${c.moneda}` })
    if (!muestra.length) for (const t of lote.tasas.slice(-40)) muestra.push({ hoja: '', fila: 0, fecha: t.fecha, descripcion: `CUP/USD ${t.cupUsd}${t.cupEur ? ` · CUP/EUR ${t.cupEur}` : ''}`, importe: '' })
    return {
      ok: true,
      resumen: {
        movimientos: lote.movimientos.length,
        salidas: lote.salidas.length,
        compras: lote.compras.length,
        tasas: lote.tasas.length,
        productos: lote.productos.length,
        deudas: lote.deudas.length,
        asientos: lote.asientos.length,
        errores: lote.problemas.filter((p) => p.nivel === 'error').length,
        avisos: lote.problemas.filter((p) => p.nivel === 'aviso').length,
        totalUSD,
        totalCUP,
      },
      problemas: lote.problemas.slice(0, 300),
      notas: lote.notas,
      muestra,
    }
  } catch (e) {
    return fallo(e)
  }
}

export async function accionImportar(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('importar')
    const ds = await cargarDataset()
    const { lote, tipo, tienda, nombre, subido } = await leerLoteDeForm(form, s, ds)
    const soloValidas = str(form, 'modo') !== 'todas'
    const errores = lote.problemas.filter((p) => p.nivel === 'error').length
    if (errores && !soloValidas) throw new Error(`Hay ${errores} filas con errores: corrígelas o importa solo las válidas.`)
    const fechas = [...lote.movimientos, ...lote.salidas, ...lote.compras].map((x) => x.fecha)
    comprobarMes(s, ds.settings, ...fechas)
    // Un archivo de ventas/compras sin errores sustituye lo importado antes para esa tienda y esas fechas.
    let resultado: { omitidas: number; filas: number } = { omitidas: 0, filas: 0 }
    await mutar({ ...DEFECTOS } as unknown as Record<string, unknown>, (actual) => {
      const a = actual as unknown as Dataset
      const { nuevo, importacion, omitidas } = aplicarLote(a, lote, { usuario: s.email, tipo, archivo: nombre, tienda }, soloValidas)
      resultado = { omitidas, filas: importacion.filas }
      return nuevo as unknown as Record<string, unknown>
    })
    if (subido) await borrarSubida(subido)
    await registrarAuditoria([{ usuario: s.email, accion: 'importar', coleccion: tipo, detalle: `${nombre}: ${resultado.filas} filas${resultado.omitidas ? `, ${resultado.omitidas} omitidas` : ''}` }])
    refrescar()
    return { ok: true, mensaje: `Importación completada: ${resultado.filas.toLocaleString('es-ES')} filas${resultado.omitidas ? ` (${resultado.omitidas} con error omitidas)` : ''}.` }
  } catch (e) {
    return fallo(e)
  }
}

/** Deshace una importación completa (todo lo que entró con ese lote). */
export async function accionDeshacerImportacion(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('importar')
    if (s.rol !== 'propietario' && s.rol !== 'admin') throw new Error('Solo administración puede deshacer importaciones.')
    const lote = str(form, 'lote')
    await mutar({ movimientos: [] as Movimiento[], salidas: [] as Salida[], compras: [] as Compra[], importaciones: [] as Dataset['importaciones'] }, (a) => ({
      movimientos: a.movimientos.filter((x) => x.lote !== lote),
      salidas: a.salidas.filter((x) => x.lote !== lote),
      compras: a.compras.filter((x) => x.lote !== lote),
      importaciones: a.importaciones.filter((x) => x.lote !== lote),
    }))
    await registrarAuditoria([{ usuario: s.email, accion: 'deshacer importación', coleccion: 'importaciones', ref: lote }])
    refrescar()
    return { ok: true, mensaje: 'Importación deshecha.' }
  } catch (e) {
    return fallo(e)
  }
}

export async function accionVaciar(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('catalogos')
    if (s.rol !== 'propietario') throw new Error('Solo el propietario puede vaciar los datos.')
    if (str(form, 'confirmacion') !== 'VACIAR') throw new Error('Escribe VACIAR para confirmar.')
    await mutar(Object.fromEntries(COLECCIONES_OPERATIVAS.map((c) => [c, DEFECTOS[c]])) as Record<string, unknown>, () => Object.fromEntries(COLECCIONES_OPERATIVAS.map((c) => [c, DEFECTOS[c]])))
    await registrarAuditoria([{ usuario: s.email, accion: 'vaciar datos', coleccion: '*' }])
    refrescar()
    return { ok: true, mensaje: 'Datos operativos vaciados.' }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- AxisPOS (SyncApi v2.1)

export async function accionAxisConfig(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('integraciones')
    let url = str(form, 'url').replace(/\/+$/, '').replace(/\/SyncApi$/i, '')
    if (url && !/^https:\/\//.test(url)) url = `https://${url.replace(/^http:\/\//, '')}`
    const desde = str(form, 'desde')
    if (desde && !esFecha(desde)) throw new Error('La fecha de inicio debe tener el formato AAAA-MM-DD.')
    const cambios = { url, usuario: str(form, 'usuario'), cobros: form.get('cobros') === 'on', cuentaBanco: str(form, 'cuentaBanco').toUpperCase() || 'FISCAL', ...(desde ? { desde } : {}) }
    await mutar({ settings: DEFAULT_SETTINGS }, ({ settings }) => ({ settings: { ...DEFAULT_SETTINGS, ...settings, axispos: { ...settings.axispos, ...cambios } } }))
    await registrarAuditoria([{ usuario: s.email, accion: 'configurar', coleccion: 'axispos', detalle: JSON.stringify(cambios) }])
    refrescar()
    return { ok: true, mensaje: 'Conexión guardada.' }
  } catch (e) {
    return fallo(e)
  }
}

function clienteAxis(ds: Dataset) {
  const cfg = ds.settings.axispos
  if (!cfg?.url || !cfg.usuario) throw new Error('Configura primero la dirección del tenant y el usuario de AxisPOS.')
  if (!process.env.AXISPOS_PASSWORD) throw new Error('Falta la variable de entorno AXISPOS_PASSWORD en Vercel.')
  return new ClienteAxis(cfg.url, cfg.usuario, process.env.AXISPOS_PASSWORD)
}

/** Comprueba la conexión y trae las áreas del tenant para asignarlas a las tiendas. */
export async function accionAxisProbar(_prev?: Resultado | null, _f?: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('integraciones')
    const c = clienteAxis(await cargarDataset())
    await c.comprobar()
    const ubic = (await c.ubicaciones()).filter((u) => !u.DeletedDb).map((u) => ({ code: String(u.Code), nombre: u.Name, grupo: u.Group }))
    // Las tiendas que todavía no tienen área reciben las que les corresponden por grupo o nombre.
    let asignadas = 0
    await mutar({ settings: DEFAULT_SETTINGS, tiendas: DEFECTOS.tiendas }, ({ settings, tiendas }) => {
      const prop = proponerAreas(ubic, tiendas)
      return {
        settings: { ...DEFAULT_SETTINGS, ...settings, axispos: { ...settings.axispos!, ubicaciones: ubic } },
        tiendas: tiendas.map((t) => {
          const codigos = prop.get(t.id)
          if (t.codigoTPV || !codigos) return t
          asignadas++
          return { ...t, codigoTPV: codigos.join(',') }
        }),
      }
    })
    await registrarAuditoria([{ usuario: s.email, accion: 'probar conexión', coleccion: 'axispos', detalle: `${ubic.length} áreas, ${asignadas} tiendas asignadas` }])
    refrescar()
    return { ok: true, mensaje: `Conexión correcta. El tenant tiene ${ubic.length} áreas${asignadas ? `; se asignaron automáticamente a ${asignadas} tiendas (revísalo abajo)` : ''}.` }
  } catch (e) {
    return fallo(e)
  }
}

/** Asigna el código de área del TPV (ObjectCode) a una tienda. */
export async function accionAxisArea(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('integraciones')
    const tienda = str(form, 'tienda')
    const codigos = [...new Set(form.getAll('codigo').flatMap((v) => String(v).split(',')).map((v) => v.trim()).filter(Boolean))]
    const codigo = codigos.join(',')
    await mutar({ tiendas: DEFECTOS.tiendas }, ({ tiendas }) => {
      const usados = mapaAreas(tiendas.filter((t) => t.id !== tienda))
      const repetido = codigos.find((c) => usados.has(c))
      if (repetido) throw new Error(`El área ${repetido} ya está asignada a otra tienda.`)
      return { tiendas: tiendas.map((t) => (t.id === tienda ? { ...t, codigoTPV: codigo || undefined } : t)) }
    })
    await registrarAuditoria([{ usuario: s.email, accion: 'asignar área', coleccion: 'tiendas', ref: tienda, detalle: codigo }])
    refrescar()
    return { ok: true, mensaje: 'Guardado.' }
  } catch (e) {
    return fallo(e)
  }
}

/** Trae el catálogo de mercancías del TPV (código, nombre, grupo, unidad, costo y precio). */
export async function accionAxisProductos(_prev?: Resultado | null, _f?: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('integraciones')
    const ds = await cargarDataset()
    const items = await clienteAxis(ds).mercancias()
    const tabla = prepararTasas(ds.tasas, ds.settings.margenTasa)
    const t = tasaVigente(tabla, new Date().toISOString().slice(0, 10))
    await mutar({ productos: [] as Producto[] }, ({ productos }) => {
      const m = new Map(productos.map((p) => [p.nombre, p]))
      for (const it of items) {
        if (!it.Name) continue
        const cupo = (it.Currency ?? 'CUP').toUpperCase() === 'USD' ? undefined : t?.cupUsd
        const costoUSD = it.Cost ? (cupo ? it.Cost / cupo : it.Cost) : undefined
        m.set(it.Name, { ...m.get(it.Name), codigo: String(it.Code), nombre: it.Name, grupo: it.Category || undefined, unidad: it.Unit || undefined, ...(costoUSD ? { costoUSD: Math.round(costoUSD * 1e4) / 1e4 } : {}), ...(it.Price ? { precioCUP: it.Price } : {}) })
      }
      return { productos: [...m.values()] }
    })
    await registrarAuditoria([{ usuario: s.email, accion: 'traer catálogo', coleccion: 'axispos', detalle: `${items.length} mercancías` }])
    refrescar()
    return { ok: true, mensaje: `${items.length} mercancías del TPV actualizadas en el catálogo.` }
  } catch (e) {
    return fallo(e)
  }
}

/**
 * Trae las operaciones del TPV.
 * - «novedades»: desde las marcas de agua guardadas de cada tienda (solo lo nuevo, sin duplicar).
 * - «rango»: un rango de fechas; sustituye lo traído antes del TPV en esas fechas.
 * Las marcas solo avanzan si todo se guardó bien.
 */
export async function accionAxisSync(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('integraciones')
    const ds = await cargarDataset()
    const modo = str(form, 'modo') === 'rango' ? 'rango' : 'novedades'
    const desde = modo === 'rango' ? fecha(form, 'desde') : undefined
    const hasta = modo === 'rango' ? fecha(form, 'hasta') : undefined
    if (desde && hasta && hasta < desde) throw new Error('El rango de fechas está al revés.')
    const tiendas = ds.tiendas.filter((t) => t.codigoTPV)
    if (!tiendas.length) throw new Error('Ninguna tienda tiene asignada su área del TPV (ObjectCode).')
    const cfg = ds.settings.axispos!
    const c = clienteAxis(ds)
    const ops = []
    const caja = []
    const inicio = cfg.desde ?? ds.settings.fechaInicio
    const hoyISO = new Date().toISOString().slice(0, 10)
    const ultimo: Record<string, string> = { ...cfg.ultimoDia }
    for (const t of tiendas)
      for (const area of (t.codigoTPV ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
        // Novedades: desde el día anterior a la última pasada (recoge lo que llegó tarde) hasta hoy.
        // Lo repetido se descarta por tienda + ticket + fecha. Las marcas de agua de la central no se
        // usan porque un área sin movimiento devuelve -1, y pedir desde 0 traería todo el historial.
        let d = desde
        if (modo === 'novedades') {
          const u = cfg.ultimoDia?.[area]
          d = u ? new Date(Date.parse(`${u}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : inicio
          if (d < inicio) d = inicio
        }
        const r = await c.exportarOperaciones(area, { desde: d, hasta: modo === 'rango' ? hasta : hoyISO })
        ops.push(...r.operaciones)
        caja.push(...r.caja)
        if (modo === 'novedades') ultimo[area] = hoyISO
      }
    const tabla = prepararTasas(ds.tasas, ds.settings.margenTasa)
    const m = mapearOperaciones(ops, caja, ds.tiendas, (f) => tasaVigente(tabla, f)?.cupUsd ?? 0, { cobros: Boolean(cfg.cobros), cuentaBanco: cfg.cuentaBanco })
    const loteId = uid()
    const fechas = [...m.salidas, ...m.compras, ...m.movimientos].map((x) => x.fecha)
    comprobarMes(s, ds.settings, ...fechas)
    let nuevas = { salidas: 0, compras: 0, movimientos: 0 }
    await mutar({ salidas: [] as Salida[], compras: [] as Compra[], movimientos: [] as Movimiento[], settings: DEFAULT_SETTINGS }, (a) => {
      const marca = <T extends object>(arr: T[]) => arr.map((x) => ({ ...x, id: uid(), lote: loteId }))
      if (modo === 'rango') {
        const fuera = (x: { origen?: string; fecha: string }) => !(x.origen === 'tpv' && x.fecha >= desde! && x.fecha <= hasta!)
        nuevas = { salidas: m.salidas.length, compras: m.compras.length, movimientos: m.movimientos.length }
        return {
          salidas: [...a.salidas.filter(fuera), ...marca(m.salidas)],
          compras: [...a.compras.filter(fuera), ...marca(m.compras)],
          movimientos: [...a.movimientos.filter(fuera), ...marca(m.movimientos)],
          settings: { ...DEFAULT_SETTINGS, ...a.settings, axispos: { ...a.settings.axispos!, ultimoSync: new Date().toISOString() } },
        }
      }
      // Novedades: se descartan las operaciones (tienda + ticket + fecha) que ya estén guardadas.
      const ya = new Set(a.salidas.filter((x) => x.origen === 'tpv').map((x) => `${x.tienda}|${x.operacion}|${x.fecha}`))
      const yaC = new Set(a.compras.filter((x) => x.origen === 'tpv').map((x) => `${x.tienda}|${x.factura}|${x.fecha}`))
      const kM = (x: Movimiento) => `${x.libro}|${x.tienda}|${x.fecha}|${x.concepto}|${x.tipo}|${x.moneda}|${x.monto}`
      const yaM = new Map<string, number>()
      for (const x of a.movimientos) if (x.origen === 'tpv') yaM.set(kM(x), (yaM.get(kM(x)) ?? 0) + 1)
      const sal = m.salidas.filter((x) => !ya.has(`${x.tienda}|${x.operacion}|${x.fecha}`))
      const com = m.compras.filter((x) => !yaC.has(`${x.tienda}|${x.factura}|${x.fecha}`))
      const mov = m.movimientos.filter((x) => {
        const n = yaM.get(kM(x)) ?? 0
        if (n > 0) yaM.set(kM(x), n - 1)
        return n === 0
      })
      nuevas = { salidas: sal.length, compras: com.length, movimientos: mov.length }
      return {
        salidas: [...a.salidas, ...marca(sal)],
        compras: [...a.compras, ...marca(com)],
        movimientos: [...a.movimientos, ...marca(mov)],
        settings: { ...DEFAULT_SETTINGS, ...a.settings, axispos: { ...a.settings.axispos!, ultimoSync: new Date().toISOString(), ultimoDia: ultimo } },
      }
    })
    const ign = [...m.ignorados.entries()].map(([k, v]) => `${v} ${k}`).join(', ')
    await registrarAuditoria([{ usuario: s.email, accion: 'sincronizar', coleccion: 'axispos', detalle: `${modo}${desde ? ` ${desde}…${hasta}` : ''}: ${ops.length} operaciones, ${caja.length} asientos de caja → ${JSON.stringify(nuevas)}` }])
    refrescar()
    return {
      ok: true,
      mensaje: `${ops.length} operaciones del TPV: ${nuevas.salidas} líneas de venta/salida, ${nuevas.compras} de compra y ${nuevas.movimientos} movimientos de caja/banco.${m.sinTienda ? ` ${m.sinTienda} de áreas sin tienda.` : ''}${ign ? ` No contabilizadas todavía: ${ign}.` : ''}`,
    }
  } catch (e) {
    return fallo(e)
  }
}
