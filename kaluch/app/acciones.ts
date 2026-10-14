'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { aplicarLote } from '@/lib/aplicar'
import { autorizar, cerrarSesion, hashPassword, iniciarSesion, tiendaFija, verificarPassword, type Sesion } from '@/lib/auth'
import { clienteAxis, sincronizarAxis } from '@/lib/axis-servidor'
import { escrituraAxis, mapaAreas, proponerAreas } from '@/lib/axispos'
import { monedasConTasa, notaKA, prepararEnvioCompra, SERIE_INICIAL } from '@/lib/axispos-envio'
import { esEntrega, GRUPOS_PRECIO, movimientosEntrega, productoDesdeItem } from '@/lib/sincro'
import { resultadoConteo } from '@/lib/conteo'
import { nombreTrabajador } from '@/lib/nomina'
import { esDelTPV, propuestasCasar } from '@/lib/casar'
import { BILLETES_CUP, calcularCuadre, horaCuba, ITEMS_CHECKLIST, porCuenta, resumenTurno, salarioSugerido, turnoDeHora, type ResumenTurno } from '@/lib/turno'
import { DEFAULT_SETTINGS } from '@/lib/catalogo'
import { cargarDataset, leerUsuarios, registrarAuditoria } from '@/lib/data'
import { COLECCIONES_OPERATIVAS, DEFECTOS } from '@/lib/defectos'
import { esFecha, ym } from '@/lib/fecha'
import { aUSD, prepararTasas, tasaVigente } from '@/lib/fx'
import type { LoteKM } from '@/lib/importar-km'
import { leerArchivo, type TipoImport } from '@/lib/plantillas'
import { esAdminEconomica, revisaArqueos, revisaConteos, ROLES_LISTA } from '@/lib/permisos'
import { borrarSubida, leerSubida, mutar } from '@/lib/store'
import type { ApunteNomina, Arqueo, Asiento, Categoria, Conteo, LineaConteo, CategoriaPago, Compra, Dataset, Deuda, EnvioAxis, LineaER, Moneda, Movimiento, Producto, Rol, Salida, Settings, Tasa, Tienda, Usuario } from '@/lib/types'

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
    // Venta web con recogida en tienda: sale del inventario del local elegido.
    if (ds.tiendas.find((t) => t.id === sal.tienda)?.tipo === 'web' && str(form, 'destino')) sal.destino = str(form, 'destino')
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
      proveedor: str(form, 'proveedor') || ds.settings.axispos?.proveedores?.find((p) => p.code === str(form, 'codigoProveedor'))?.nombre || undefined,
      factura: str(form, 'factura') || undefined,
      moneda: mon,
      pago: (str(form, 'pago') || 'contado') as CategoriaPago,
      fiscal: form.get('fiscal') === 'on',
      origen: 'manual' as const,
      ...(tasa ? { tasa } : {}),
    }
    const cantidad = numero(form, 'cantidad', false)
    let nuevas: Compra[]
    const codigos = { codigoProducto: str(form, 'codigoProducto') || undefined, codigoProveedor: str(form, 'codigoProveedor') || undefined }
    let traslados: Salida[] = []
    if (form.get('distribuida') === 'on') {
      // La compra entra entera al Almacén Central y de ahí sale un traslado a cada mercado.
      const partes = ds.tiendas.filter((t) => t.id !== 'almacen').map((t) => ({ t: t.id, q: numero(form, `q_${t.id}`, false) ?? 0 })).filter((p) => p.q > 0)
      const total = partes.reduce((a, p) => a + p.q, 0)
      if (!partes.length) throw new Error('Reparte la cantidad entre al menos un mercado.')
      if (!cantidad) throw new Error('Indica la cantidad total de la factura.')
      if (total - cantidad > 0.0001) throw new Error(`Repartes ${total} y la factura trae ${cantidad}.`)
      const grupo = uid()
      const central: Compra = { ...base, ...codigos, id: uid(), tienda: 'almacen', cantidad, importe, importeUSD: usd, grupo }
      nuevas = [central]
      for (const p of partes) {
        const costo = (usd * p.q) / cantidad
        const destino = ds.tiendas.find((t) => t.id === p.t)!
        traslados.push({ id: uid(), tipo: 'traslado', fecha: f, tienda: 'almacen', producto: base.producto, codigoProducto: codigos.codigoProducto, cantidad: p.q, costoUSD: costo, destino: p.t, grupo, origen: 'manual', nota: `a ${destino.nombre}` })
        nuevas.push({ ...base, id: uid(), tienda: p.t, cantidad: p.q, importe: (importe * p.q) / cantidad, importeUSD: costo, pago: 'mercados', proveedor: 'Almacén Central', factura: `Traslado ${base.factura ?? ''}`.trim(), grupo, origen: 'manual' })
      }
    } else {
      nuevas = [{ ...base, ...codigos, id: uid(), tienda: tiendaDe(s, form, ds), cantidad, importe, importeUSD: usd }]
    }
    await mutar({ compras: [] as Compra[], salidas: [] as Salida[] }, ({ compras, salidas }) => ({ compras: [...compras, ...nuevas], ...(traslados.length ? { salidas: [...salidas, ...traslados] } : {}) }))
    await registrarAuditoria([{ usuario: s.email, accion: 'crear', coleccion: 'compras', ref: nuevas[0].id, detalle: `${nuevas.length} registro(s) · ${importe} ${mon}` }])
    let extra = ''
    if (form.get('enviarAxis') === 'on' && escrituraAxis()) {
      const r = await enviarCompraAxis(nuevas[0].id)
      extra = r.ok ? ` ${r.mensaje}` : ` No se pudo subir a AxisPOS: ${r.error}`
    }
    refrescar()
    return { ok: true, mensaje: (traslados.length ? `Compra en el Almacén Central con ${traslados.length} traslados a mercados.` : `Compra registrada (${usd.toFixed(2)} USD).`) + extra }
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
    // Una entrega a la caja central son dos movimientos con el mismo comprobante: se borran juntos.
    const comp = col === 'movimientos' && esEntrega(reg as unknown as Movimiento) ? (reg as unknown as Movimiento).comprobante : undefined
    const fuera = (x: { id: string }) => x.id === id || (comp != null && esEntrega(x as unknown as Movimiento) && (x as unknown as Movimiento).comprobante === comp)
    await mutar({ [col]: [] } as Record<string, { id: string }[]>, (actual) => ({ [col]: actual[col].filter((x) => !fuera(x)) }))
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
    if (!esAdminEconomica(s.rol)) throw new Error('Solo administración.')
    const pct = (k: string) => (numero(form, k)! > 1 ? numero(form, k)! / 100 : numero(form, k)!)
    const cambios: Partial<Settings> = {
      empresa: str(form, 'empresa') || DEFAULT_SETTINGS.empresa,
      fechaInicio: fecha(form, 'fechaInicio'),
      margenTasa: numero(form, 'margenTasa')!,
      impuestoVentas: pct('impuestoVentas'),
      margenMinimo: pct('margenMinimo'),
      margenWeb: str(form, 'margenWeb') ? pct('margenWeb') : undefined,
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
    if (!esAdminEconomica(s.rol)) throw new Error('Solo administración puede cerrar o abrir meses.')
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
    const precios: Record<string, number> = {}
    for (const g of GRUPOS_PRECIO) {
      const v = numero(form, `precio${g}`, false)
      if (v != null && v > 0) precios[g] = v
    }
    const original = str(form, 'original').toUpperCase() || nombre
    const p: Partial<Producto> & { codigo: string; nombre: string } = {
      codigo: str(form, 'codigo') || nombre,
      nombre,
      grupo: str(form, 'grupo').toUpperCase() || undefined,
      unidad: str(form, 'unidad') || undefined,
      costoUSD: numero(form, 'costoUSD', false),
      precioCUP: numero(form, 'precioCUP', false),
      precios: Object.keys(precios).length ? precios : undefined,
      barras: [...new Set(str(form, 'barras').split(/[,\s]+/).filter(Boolean))].slice(0, 3),
      imagen: /^https:\/\//.test(str(form, 'imagen')) ? str(form, 'imagen') : undefined,
      descripcion: str(form, 'descripcion') || undefined,
      modificado: new Date().toISOString(),
    }
    if (!p.barras?.length) p.barras = undefined
    await mutar({ productos: [] as Producto[] }, ({ productos }) => {
      if (original !== nombre && productos.some((x) => x.nombre === nombre)) throw new Error(`Ya hay un producto «${nombre}».`)
      const repetido = p.barras?.map((b) => [b, productos.find((x) => x.nombre !== original && (x.barras?.includes(b) || x.codigo === b))] as const).find(([, x]) => x)
      if (repetido) throw new Error(`El código ${repetido[0]} ya es de «${repetido[1]!.nombre}».`)
      const existe = productos.some((x) => x.nombre === original)
      return { productos: existe ? productos.map((x) => (x.nombre === original ? { ...x, ...p } : x)) : [...productos, p] }
    })
    await registrarAuditoria([{ usuario: s.email, accion: 'guardar', coleccion: 'productos', ref: nombre, detalle: original !== nombre ? `antes ${original}` : undefined }])
    refrescar()
    return { ok: true, mensaje: 'Producto guardado. Queda pendiente de pasar al TPV (Sincronización → Catálogo).' }
  } catch (e) {
    return fallo(e)
  }
}

/** Aplica casamientos «producto del Excel → mercancía del TPV»: renombra ventas y compras y deja un solo producto. */
async function casarProductos(pares: { excel: string; tpv: string }[], usuario: string) {
  if (!pares.length) throw new Error('No hay nada que casar.')
  const mapa = new Map(pares.map((p) => [p.excel, p.tpv]))
  let renombrados = 0
  await mutar({ productos: [] as Producto[], salidas: [] as Salida[], compras: [] as Compra[] }, (a) => {
    const porNombre = new Map(a.productos.map((p) => [p.nombre, p]))
    for (const { excel, tpv } of pares) {
      if (!porNombre.has(excel)) throw new Error(`«${excel}» ya no está en el catálogo.`)
      if (!esDelTPV(porNombre.get(tpv) ?? { codigo: '', nombre: '' })) throw new Error(`«${tpv}» no es una mercancía del TPV.`)
    }
    const ren = <T extends { producto?: string }>(x: T): T => {
      const n = x.producto ? mapa.get(x.producto) : undefined
      if (!n) return x
      renombrados++
      return { ...x, producto: n }
    }
    // El producto del TPV hereda lo que solo tenía el del Excel (existencia de referencia, costo).
    const productos = a.productos
      .filter((p) => !mapa.has(p.nombre))
      .map((p) => {
        const de = pares.filter((x) => x.tpv === p.nombre).map((x) => porNombre.get(x.excel)!)
        if (!de.length) return p
        const ref = de.reduce((s, x) => s + (x.existenciaRef ?? 0), 0)
        return { ...p, ...(p.existenciaRef == null && de.some((x) => x.existenciaRef != null) ? { existenciaRef: ref } : {}), ...(p.costoUSD == null && de[0].costoUSD != null ? { costoUSD: de[0].costoUSD } : {}) }
      })
    return { productos, salidas: a.salidas.map(ren), compras: a.compras.map(ren) }
  })
  await registrarAuditoria([{ usuario, accion: 'casar productos', coleccion: 'productos', detalle: `${pares.length} productos, ${renombrados} registros: ${pares.slice(0, 20).map((p) => `${p.excel} → ${p.tpv}`).join('; ')}` }])
  return renombrados
}

/** Casa los productos elegidos en la lista (cada fila: producto del Excel y la mercancía del TPV elegida). */
export async function accionCasar(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('catalogos')
    const pares: { excel: string; tpv: string }[] = []
    for (const [k, v] of form.entries()) if (k.startsWith('m_') && String(v)) pares.push({ excel: str(form, `e_${k.slice(2)}`), tpv: String(v) })
    const n = await casarProductos(pares, s.email)
    refrescar()
    return { ok: true, mensaje: `${pares.length} productos casados; ${n} ventas y compras pasan al producto del TPV.` }
  } catch (e) {
    return fallo(e)
  }
}

/** Casa de una vez los que coinciden con seguridad (mismo nombre salvo tildes, signos u orden de palabras). */
export async function accionCasarSeguros(_prev: Resultado | null, _form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('catalogos')
    const ds = await cargarDataset()
    const pares = propuestasCasar(ds.productos, new Map())
      .filter((p) => p.seguro)
      .map((p) => ({ excel: p.nombre, tpv: p.candidatos[0].nombre }))
    const n = await casarProductos(pares, s.email)
    refrescar()
    return { ok: true, mensaje: `${pares.length} productos casados automáticamente; ${n} ventas y compras actualizadas.` }
  } catch (e) {
    return fallo(e)
  }
}

export async function accionUsuario(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('catalogos')
    if (!esAdminEconomica(s.rol)) throw new Error('Solo administración gestiona usuarios.')
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
    if (!esAdminEconomica(s.rol)) throw new Error('Solo administración puede deshacer importaciones.')
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

/** Entrega de efectivo de un mercado a la caja central: salida de su caja y entrada en la de Casa Matriz. */
export async function accionEntregaCaja(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const ds = await cargarDataset()
    const s = await autorizar('caja', str(form, 'tienda'))
    const tienda = tiendaDe(s, form, ds)
    const t = ds.tiendas.find((x) => x.id === tienda)!
    const matriz = ds.tiendas.find((x) => x.tipo === 'matriz')
    if (!matriz) throw new Error('No hay Casa Matriz dada de alta.')
    if (t.tipo !== 'local') throw new Error('Las entregas son de la caja de un mercado.')
    const monto = numero(form, 'monto')!
    if (!(monto > 0)) throw new Error('El monto debe ser mayor que 0.')
    const f = fecha(form)
    comprobarMes(s, ds.settings, f)
    const movs = movimientosEntrega({ id: uid(), fecha: f, tienda, nombreTienda: t.nombre, matriz: matriz.id, moneda: moneda(form), monto, cajero: str(form, 'cajero') || undefined, nota: str(form, 'nota') || undefined })
    await mutar({ movimientos: [] as Movimiento[] }, ({ movimientos }) => ({ movimientos: [...movimientos, ...movs] }))
    await registrarAuditoria([{ usuario: s.email, accion: 'entrega a caja central', coleccion: 'movimientos', ref: movs[0].comprobante, detalle: `${t.nombre} ${monto} ${movs[0].moneda}` }])
    refrescar()
    return { ok: true, mensaje: `Entrega de ${t.nombre} registrada (${movs[0].comprobante}).` }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- conteo a ciegas y arqueo

function lineasDe(form: FormData): LineaConteo[] {
  let crudo: unknown
  try {
    crudo = JSON.parse(String(form.get('lineas') ?? '[]'))
  } catch {
    throw new Error('Lista de conteo no válida.')
  }
  if (!Array.isArray(crudo)) throw new Error('Lista de conteo no válida.')
  return crudo
    .map((l) => ({ codigo: String(l?.codigo ?? '').trim(), nombre: String(l?.nombre ?? '').slice(0, 200), cantidad: Number(l?.cantidad), ...(l?.desconocido ? { desconocido: true } : {}) }))
    .filter((l) => l.codigo && Number.isFinite(l.cantidad) && l.cantidad >= 0)
    .slice(0, 5000)
}

/** Abre el conteo del día de la tienda (si ya hay uno abierto, se sigue con ese). */
export async function accionConteoAbrir(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const ds = await cargarDataset()
    const s = await autorizar('conteo', str(form, 'tienda'))
    const tienda = tiendaDe(s, form, ds)
    let creado = false
    await mutar({ conteos: [] as Conteo[] }, ({ conteos }) => {
      if (conteos.some((c) => c.tienda === tienda && c.estado === 'abierto')) return { conteos }
      creado = true
      const numero = conteos.reduce((m, c) => Math.max(m, c.numero), 0) + 1
      const ahora = new Date().toISOString()
      return { conteos: [{ id: uid(), numero, tienda, fecha: ahora.slice(0, 10), usuario: s.email, nombreUsuario: s.nombre, estado: 'abierto' as const, inicio: ahora, lineas: [] }, ...conteos] }
    })
    if (creado) await registrarAuditoria([{ usuario: s.email, accion: 'abrir conteo', coleccion: 'conteos', ref: tienda }])
    refrescar()
    return { ok: true, mensaje: creado ? 'Conteo abierto. Escanea los productos.' : 'Ya había un conteo abierto en esta tienda: sigue con él.' }
  } catch (e) {
    return fallo(e)
  }
}

/** Guarda lo contado hasta ahora (el conteo sigue abierto). */
export async function accionConteoGuardar(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const ds = await cargarDataset()
    const c = ds.conteos.find((x) => x.id === str(form, 'id'))
    if (!c) throw new Error('El conteo ya no existe.')
    await autorizar('conteo', c.tienda)
    const lineas = lineasDe(form)
    await mutar({ conteos: [] as Conteo[] }, ({ conteos }) => {
      const x = conteos.find((y) => y.id === c.id)
      if (x?.estado !== 'abierto') throw new Error('El conteo ya está cerrado.')
      return { conteos: conteos.map((y) => (y.id === c.id ? { ...y, lineas } : y)) }
    })
    return { ok: true, mensaje: `Guardado: ${lineas.length} productos.` }
  } catch (e) {
    return fallo(e)
  }
}

/**
 * Cierra el conteo: guarda lo contado y lo compara con la existencia del TPV en ese momento
 * (solo se LEE del TPV). El trabajador no ve el resultado; administración sí.
 */
export async function accionConteoCerrar(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const ds = await cargarDataset()
    const c = ds.conteos.find((x) => x.id === str(form, 'id'))
    if (!c) throw new Error('El conteo ya no existe.')
    const s = await autorizar('conteo', c.tienda)
    if (c.estado !== 'abierto') throw new Error('El conteo ya está cerrado.')
    const lineas = lineasDe(form)
    if (!lineas.length) throw new Error('No hay nada contado.')
    const areas = (ds.tiendas.find((t) => t.id === c.tienda)?.codigoTPV ?? '').split(',').map((x) => x.trim()).filter(Boolean)
    let resultado: Conteo['resultado']
    let errorSistema: string | undefined
    try {
      if (!areas.length) throw new Error('La tienda no tiene áreas del TPV asignadas.')
      resultado = resultadoConteo(lineas, await clienteAxis(ds).existencias(areas), areas, ds.productos)
    } catch (e) {
      errorSistema = e instanceof Error ? e.message : String(e)
    }
    const cierre = new Date().toISOString()
    await mutar({ conteos: [] as Conteo[] }, ({ conteos }) => ({
      conteos: conteos.map((y) => (y.id === c.id ? { ...y, lineas, estado: 'cerrado' as const, cierre, resultado, errorSistema, nota: str(form, 'nota') || undefined } : y)),
    }))
    const dif = resultado?.filter((r) => r.diferencia).length ?? 0
    await registrarAuditoria([{ usuario: s.email, accion: 'cerrar conteo', coleccion: 'conteos', ref: `#${c.numero}`, detalle: `${lineas.length} productos${resultado ? `, ${dif} con diferencia` : `; sin comparar: ${errorSistema}`}` }])
    refrescar()
    return { ok: true, mensaje: `Conteo #${c.numero} cerrado: ${lineas.length} productos contados. Gracias.` }
  } catch (e) {
    return fallo(e)
  }
}

/**
 * El contador aprueba el ajuste de un conteo cerrado: queda pendiente de pasar al TPV como operación 4
 * en el área elegida (Sincronización → Ajustes). No se toca la contabilidad: el ajuste vuelve del TPV.
 */
export async function accionConteoAprobarAjuste(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const ds = await cargarDataset()
    const c = ds.conteos.find((x) => x.id === str(form, 'id'))
    if (!c) throw new Error('El conteo ya no existe.')
    const s = await autorizar('conteo', c.tienda)
    if (!revisaConteos(s.rol)) throw new Error('Solo el contador o administración aprueban ajustes.')
    if (c.estado !== 'cerrado' || !c.resultado) throw new Error('El conteo no está cerrado o no se pudo comparar con el TPV.')
    if (c.ajuste) throw new Error('El ajuste ya estaba aprobado.')
    const area = str(form, 'area')
    if (!(ds.tiendas.find((t) => t.id === c.tienda)?.codigoTPV ?? '').split(',').map((x) => x.trim()).includes(area)) throw new Error('Elige un área de la tienda.')
    const ajuste = { area, aprobadoPor: s.nombre ?? s.email, aprobadoEn: new Date().toISOString() }
    // El faltante puede descontarse a quien estaba de turno (se le rebaja de lo que tenga por cobrar).
    const trabajador = nombreTrabajador(str(form, 'descontarA'))
    const importe = numero(form, 'descuento', false) ?? 0
    const apunte: ApunteNomina[] =
      trabajador && importe > 0
        ? [{ id: uid(), trabajador, tienda: c.tienda, fecha: (c.cierre ?? c.inicio).slice(0, 10), tipo: 'descuento', importe, concepto: `Faltante de inventario · conteo #${c.numero}`, conteo: c.id, usuario: s.email, ts: ajuste.aprobadoEn }]
        : []
    await mutar({ conteos: [] as Conteo[], nomina: [] as ApunteNomina[] }, ({ conteos, nomina }) => ({ conteos: conteos.map((x) => (x.id === c.id ? { ...x, ajuste } : x)), nomina: [...nomina, ...apunte] }))
    await registrarAuditoria([{ usuario: s.email, accion: 'aprobar ajuste de conteo', coleccion: 'conteos', ref: `#${c.numero}`, detalle: `área ${area}, ${c.resultado.filter((r) => r.diferencia).length} productos` }])
    refrescar()
    return { ok: true, mensaje: escrituraAxis() ? 'Ajuste aprobado.' : 'Ajuste aprobado. Queda pendiente de pasar al TPV (modo ensayo): mientras tanto, hazlo en AxisPOS y llegará solo en la sincronización.' }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- pagos al personal

/** Descuento o pago manual en la cuenta de un trabajador. El pago sale de la caja elegida como SALARIO DEPENDIENTE. */
export async function accionNominaApunte(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const ds = await cargarDataset()
    const s = await autorizar('personal', str(form, 'tienda'))
    const tienda = tiendaDe(s, form, ds)
    const tipo = str(form, 'tipo')
    if (tipo !== 'descuento' && tipo !== 'pago' && tipo !== 'devengo') throw new Error('Tipo no válido.')
    const trabajador = nombreTrabajador(str(form, 'trabajador'))
    if (!trabajador) throw new Error('Falta el trabajador.')
    const importe = numero(form, 'importe')!
    if (!(importe > 0)) throw new Error('El importe debe ser mayor que 0.')
    const f = fecha(form)
    comprobarMes(s, ds.settings, f)
    const ahora = new Date().toISOString()
    const id = uid()
    let mov: Movimiento | undefined
    if (tipo === 'pago') {
      const caja = str(form, 'caja') || tienda
      if (!ds.tiendas.some((t) => t.id === caja)) throw new Error('Caja no válida.')
      mov = { id: uid(), libro: 'caja', fecha: f, tienda: caja, categoria: 'SALARIO DEPENDIENTE', concepto: `Pago a ${trabajador}${str(form, 'concepto') ? ` · ${str(form, 'concepto')}` : ''}`, tipo: 'Salida', moneda: 'CUP', monto: importe, origen: 'manual', comprobante: `NOM-${id.slice(0, 8)}` }
    }
    const apunte: ApunteNomina = { id, trabajador, tienda, fecha: f, tipo, importe, concepto: str(form, 'concepto') || (tipo === 'pago' ? 'Pago' : tipo === 'descuento' ? 'Descuento' : 'Devengo'), movimiento: mov?.id, usuario: s.email, ts: ahora }
    await mutar({ nomina: [] as ApunteNomina[], movimientos: [] as Movimiento[] }, (x) => ({ nomina: [...x.nomina, apunte], movimientos: mov ? [...x.movimientos, mov] : x.movimientos }))
    await registrarAuditoria([{ usuario: s.email, accion: `nómina: ${tipo}`, coleccion: 'nomina', ref: trabajador, detalle: `${importe} CUP · ${apunte.concepto}` }])
    refrescar()
    return { ok: true, mensaje: tipo === 'pago' ? `Pago de ${importe} CUP a ${trabajador} registrado en caja.` : `${tipo === 'descuento' ? 'Descuento' : 'Devengo'} registrado a ${trabajador}.` }
  } catch (e) {
    return fallo(e)
  }
}

/** Anula un apunte de la cuenta de un trabajador (si era un pago, también su movimiento de caja). */
export async function accionNominaBorrar(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const ds = await cargarDataset()
    const a = ds.nomina.find((x) => x.id === str(form, 'id'))
    if (!a) throw new Error('El apunte ya no existe.')
    const s = await autorizar('personal', a.tienda)
    comprobarMes(s, ds.settings, a.fecha)
    await mutar({ nomina: [] as ApunteNomina[], movimientos: [] as Movimiento[] }, (x) => ({ nomina: x.nomina.filter((y) => y.id !== a.id), movimientos: a.movimiento ? x.movimientos.filter((m) => m.id !== a.movimiento) : x.movimientos }))
    await registrarAuditoria([{ usuario: s.email, accion: 'nómina: anular', coleccion: 'nomina', ref: a.trabajador, detalle: `${a.tipo} ${a.importe} · ${a.concepto}` }])
    refrescar()
    return { ok: true, mensaje: 'Apunte anulado.' }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- cuadre de cambio de turno

/** Cajas (áreas del TPV que cobran) de una tienda: sus pisos de venta o, si no se sabe, todas sus áreas. */
function cajasDe(ds: Dataset, tienda: string) {
  const ubic = new Map((ds.settings.axispos?.ubicaciones ?? []).map((u) => [u.code, u]))
  const areas = (ds.tiendas.find((t) => t.id === tienda)?.codigoTPV ?? '').split(',').map((c) => c.trim()).filter(Boolean)
  const pisos = areas.filter((c) => ubic.get(c)?.tipo === 7)
  return (pisos.length ? pisos : areas).map((c) => ({ code: c, nombre: ubic.get(c)?.nombre ?? `Área ${c}` }))
}

const HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/
const conSegundos = (h: string) => (h.length === 16 ? `${h}:00` : h)

/** Ventas de una caja en el TPV entre dos horas locales (solo lectura), con los Pax y los tramos del reporte. */
async function turnoTPV(ds: Dataset, caja: string, desde: string, hasta: string) {
  const r = await clienteAxis(ds).exportarOperaciones(caja, { desde: desde.slice(0, 10), hasta: hasta.slice(0, 10), operTypes: [2, 34] })
  const usuarios = new Map((ds.settings.axispos?.usuariosTPV ?? []).map((u) => [u.code, u.nombre]))
  return resumenTurno(r.operaciones, desde, hasta, usuarios, ds.settings.cortesTurno ?? ['02:00'])
}

/** Tasa a la que se valora el USD/EUR del cuadre: la de venta de la tienda (Toque + margen), con la que cobra el TPV. */
function tasasTienda(ds: Dataset, fecha: string) {
  const t = tasaVigente(prepararTasas(ds.tasas, ds.settings.margenTasa), fecha)
  return { usd: t ? (t.kmVenta ?? t.cupUsd + ds.settings.margenTasa) : 0, eur: t?.cupEur ? t.cupEur + ds.settings.margenTasa : 0 }
}

export type ResultadoTurno = Resultado & { turno?: { tienda: string; caja: string; desde: string; hasta: string; resumen: ResumenTurno; salario: number; tasaUSD: number; tasaEUR: number } }

/** Paso 1 del cierre: trae del TPV las ventas de la caja desde el cierre anterior hasta ahora. */
export async function accionTurnoPreparar(_prev: ResultadoTurno | null, form: FormData): Promise<ResultadoTurno> {
  try {
    const ds = await cargarDataset()
    const s = await autorizar('arqueo', str(form, 'tienda'))
    const tienda = tiendaDe(s, form, ds)
    const caja = str(form, 'caja')
    if (!cajasDe(ds, tienda).some((c) => c.code === caja)) throw new Error('Elige la caja.')
    const anterior = ds.arqueos.filter((a) => a.caja === caja).sort((x, y) => y.hasta.localeCompare(x.hasta))[0]
    const desde = anterior?.hasta ?? (HORA.test(str(form, 'desde')) ? conSegundos(str(form, 'desde')) : '')
    if (!desde) throw new Error('Es el primer cierre de esta caja: indica a qué hora empezó el turno.')
    const hasta = horaCuba()
    if (hasta <= desde) throw new Error('El turno no puede terminar antes de empezar.')
    const resumen = await turnoTPV(ds, caja, desde, hasta)
    const tasas = tasasTienda(ds, hasta.slice(0, 10))
    return { ok: true, turno: { tienda, caja, desde, hasta, resumen, salario: salarioSugerido(resumen.venta, ds.settings.pctSalarioCajero ?? 0.03), tasaUSD: tasas.usd, tasaEUR: tasas.eur } }
  } catch (e) {
    return fallo(e)
  }
}

const listaForm = (form: FormData, a: string, b: string) => {
  const xs = form.getAll(a).map(String)
  const ys = form.getAll(b).map((v) => Number(String(v).replace(/\s/g, '').replace(',', '.')))
  return xs.map((x, i) => ({ x: x.trim(), n: ys[i] })).filter((r) => r.x && Number.isFinite(r.n) && r.n !== 0)
}

/**
 * Paso 2: guarda el cierre de turno (cuadre, ventas por tarjeta, check list, energía, firmas y fotos).
 * Lo hace el dependiente y queda pendiente; con `id`, el contador (o su autor mientras esté pendiente) lo corrige.
 */
export async function accionArqueo(_prev: (Resultado & { id?: string }) | null, form: FormData): Promise<Resultado & { id?: string }> {
  try {
    const ds = await cargarDataset()
    const previo = str(form, 'id') ? ds.arqueos.find((x) => x.id === str(form, 'id')) : undefined
    if (str(form, 'id') && !previo) throw new Error('El cierre ya no existe.')
    const s = await autorizar('arqueo', previo?.tienda ?? str(form, 'tienda'))
    if (previo) {
      if (previo.estado !== 'pendiente') throw new Error('Un cierre aprobado ya no se cambia.')
      if (!revisaArqueos(s.rol) && previo.usuario !== s.email) throw new Error('Solo el contador corrige cierres de otros.')
    }
    const tienda = previo?.tienda ?? tiendaDe(s, form, ds)
    const caja = previo?.caja ?? str(form, 'caja')
    const cajaInfo = cajasDe(ds, tienda).find((c) => c.code === caja)
    if (!cajaInfo) throw new Error('Elige la caja.')
    const desde = previo?.desde ?? str(form, 'desde')
    const hasta = previo?.hasta ?? str(form, 'hasta')
    if (!HORA.test(desde) || !HORA.test(hasta) || hasta <= desde) throw new Error('Turno no válido: vuelve a traer las ventas.')
    if (!previo) {
      const anterior = ds.arqueos.filter((a) => a.caja === caja).sort((x, y) => y.hasta.localeCompare(x.hasta))[0]
      if (anterior && desde < anterior.hasta) throw new Error(`Ya hay un cierre de esta caja hasta ${anterior.hasta.replace('T', ' ')}: vuelve a traer las ventas.`)
    }
    const n = (k: string) => numero(form, k, false) ?? 0
    const nOpc = (k: string) => numero(form, k, false)
    // La venta en tienda se vuelve a leer del TPV con el mismo turno: no se fía de lo que llegue del navegador.
    let avisoTPV: string | undefined
    let tpv: Arqueo['tpv'] = previo?.tpv ?? { tickets: 0, venta: 0, efectivo: 0, noEfectivo: {}, efectivoPorMoneda: {}, porCajero: {} }
    try {
      const r = await turnoTPV(ds, caja, desde, hasta)
      tpv = { tickets: r.tickets, venta: r.venta, efectivo: r.efectivo, noEfectivo: r.noEfectivo, efectivoPorMoneda: r.efectivoPorMoneda, porCajero: r.porCajero, pax: r.pax, tramos: r.tramos }
    } catch (e) {
      avisoTPV = `No se pudo leer el TPV; la venta en tienda es la que se escribió a mano (${e instanceof Error ? e.message : String(e)}).`
    }
    const tarjetas = form
      .getAll('tj_importe')
      .map((v, i) => ({
        cuenta: String(form.getAll('tj_cuenta')[i] ?? 'FISCAL').trim().toUpperCase() || 'FISCAL',
        numero: String(form.getAll('tj_numero')[i] ?? '').trim(),
        importe: Number(String(v).replace(/\s/g, '').replace(',', '.')),
        ci: String(form.getAll('tj_ci')[i] ?? '').trim() || undefined,
        titular: String(form.getAll('tj_titular')[i] ?? '').trim() || undefined,
      }))
      .filter((t) => Number.isFinite(t.importe) && t.importe !== 0)
    const datos = {
      ventaTienda: avisoTPV ? n('ventaTienda') || (previo?.ventaTienda ?? 0) : tpv.venta,
      domicilio: n('domicilio'),
      plataforma: n('plataforma'),
      gastos: listaForm(form, 'gasto_concepto', 'gasto_importe').map((r, i) => ({ concepto: r.x, importe: r.n, categoria: String(form.getAll('gasto_categoria')[i] ?? '') || undefined })),
      salario: n('salario'),
      transferencias: porCuenta(tarjetas),
      porCobrar: n('porCobrar'),
      billetes: BILLETES_CUP.map((v) => ({ valor: v, cantidad: n(`b_${v}`) })).filter((b) => b.cantidad),
      sueltosCUP: n('sueltosCUP'),
      usd: n('usd'),
      tasaUSD: n('tasaUSD'),
      eur: n('eur'),
      tasaEUR: n('tasaEUR'),
      otros: n('otros'),
      fondo: n('fondo'),
    }
    if (datos.billetes.some((b) => b.cantidad < 0 || !Number.isInteger(b.cantidad))) throw new Error('Las cantidades de billetes tienen que ser números enteros.')
    if ((datos.usd && !datos.tasaUSD) || (datos.eur && !datos.tasaEUR)) throw new Error('Falta la tasa del USD o del EUR.')
    const checklist: NonNullable<Arqueo['checklist']> = {}
    for (const it of ITEMS_CHECKLIST) {
      const obs = str(form, `obs_${it.id}`)
      checklist[it.id] = { ok: form.get(`ck_${it.id}`) === 'on', ...(obs ? { obs } : {}) }
    }
    const firmas: NonNullable<Arqueo['firmas']> = {}
    for (const r of ['cajero', 'dependiente', 'seguridad'] as const) {
      const entrega = str(form, `f_${r}_entrega`)
      const recibe = str(form, `f_${r}_recibe`)
      if (entrega || recibe) firmas[r] = { entrega: entrega || undefined, recibe: recibe || undefined }
    }
    const fotos = form.getAll('fotos').map(String).filter((f) => f.startsWith('fotos/')).slice(0, 12)
    const c = calcularCuadre(datos)
    const id = previo?.id ?? uid()
    const ahora = new Date().toISOString()
    let num = previo?.numero ?? 0
    const turno = str(form, 'turno') === 'dia' || str(form, 'turno') === 'noche' ? (str(form, 'turno') as 'dia' | 'noche') : turnoDeHora(hasta)
    await mutar({ arqueos: [] as Arqueo[] }, ({ arqueos }) => {
      if (!previo) {
        const ultimo = arqueos.filter((a) => a.caja === caja).sort((x, y) => y.hasta.localeCompare(x.hasta))[0]
        if (ultimo && desde < ultimo.hasta) throw new Error('Otra persona cerró esta caja mientras tanto: vuelve a traer las ventas.')
        num = arqueos.reduce((m, a) => Math.max(m, a.numero), 0) + 1
      } else if (arqueos.find((x) => x.id === id)?.estado !== 'pendiente') throw new Error('El cierre ya fue aprobado.')
      const a: Arqueo = {
        ...(previo ?? {}),
        id,
        numero: num,
        tienda,
        caja,
        cajaNombre: cajaInfo.nombre,
        desde,
        hasta,
        fecha: hasta.slice(0, 10),
        ts: previo?.ts ?? ahora,
        usuario: previo?.usuario ?? s.email,
        nombreUsuario: previo?.nombreUsuario ?? s.nombre,
        turno,
        cajero: str(form, 'cajero') || undefined,
        trabajadores: Math.max(1, Math.round(n('trabajadores')) || 1),
        tpv,
        paxCompra: nOpc('paxCompra'),
        paxMuseo: nOpc('paxMuseo'),
        ...datos,
        tarjetas,
        esperado: c.esperado,
        contado: c.contado,
        diferencia: c.diferencia,
        aEntregar: c.aEntregar,
        avisoTPV,
        observaciones: str(form, 'observaciones') || undefined,
        checklist,
        energia: { inversor: nOpc('inversor'), ecoflow: nOpc('ecoflow') },
        firmas,
        fotos,
        ...(previo ? { editadoPor: s.nombre ?? s.email, editadoEn: ahora } : {}),
        estado: 'pendiente',
      }
      return { arqueos: previo ? arqueos.map((x) => (x.id === id ? a : x)) : [a, ...arqueos] }
    })
    await registrarAuditoria([{ usuario: s.email, accion: previo ? 'corregir cierre de turno' : 'cierre de turno', coleccion: 'arqueos', ref: `#${num}`, detalle: `${cajaInfo.nombre} ${desde}→${hasta}: esperado ${c.esperado}, contado ${c.contado}, diferencia ${c.diferencia}` }])
    refrescar()
    return { ok: true, mensaje: `Cierre #${num} ${previo ? 'corregido' : 'guardado'}.`, id }
  } catch (e) {
    return fallo(e)
  }
}

/**
 * El contador revisa y aprueba el cierre: se registran en la caja de la tienda los gastos y el salario pagados
 * en el turno y, si se marca, la entrega del efectivo (contado − salario − fondo) a la caja central.
 */
export async function accionArqueoAprobar(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const ds = await cargarDataset()
    const a = ds.arqueos.find((x) => x.id === str(form, 'id'))
    if (!a) throw new Error('El cierre ya no existe.')
    const s = await autorizar('arqueo', a.tienda)
    if (!revisaArqueos(s.rol)) throw new Error('Solo el contador o administración aprueban cierres.')
    if (a.estado === 'aprobado') throw new Error('Ya estaba aprobado.')
    comprobarMes(s, ds.settings, a.fecha)
    const t = ds.tiendas.find((x) => x.id === a.tienda)!
    const matriz = ds.tiendas.find((x) => x.tipo === 'matriz')
    const base = { libro: 'caja' as const, fecha: a.fecha, tienda: a.tienda, moneda: 'CUP' as const, tipo: 'Salida' as const, origen: 'manual' as const, comprobante: `CT-${a.numero}`, cajero: a.cajero }
    const movs: Movimiento[] = a.gastos.map((g) => ({ ...base, id: uid(), categoria: g.categoria || 'OTROS GASTOS', concepto: `${g.concepto} · cierre #${a.numero}`, monto: g.importe }))
    // El salario no sale de la caja: se devenga en la cuenta del trabajador y se paga en «Pagos al personal».
    const trabajador = nombreTrabajador(str(form, 'trabajador') || a.cajero || '')
    const salario = numero(form, 'salario', false) ?? a.salario
    const ahora = new Date().toISOString()
    const apuntes: ApunteNomina[] = []
    if (salario > 0) {
      if (!trabajador) throw new Error('Falta el nombre del trabajador que cobra el turno.')
      apuntes.push({ id: uid(), trabajador, tienda: a.tienda, fecha: a.fecha, tipo: 'devengo', importe: salario, concepto: `Turno ${a.turno === 'noche' ? 'noche' : 'día'} ${a.fecha} · cierre #${a.numero}`, cierre: a.id, usuario: s.email, ts: ahora })
    }
    const faltante = numero(form, 'faltante', false) ?? 0
    if (faltante > 0) {
      if (!trabajador) throw new Error('Falta el nombre del trabajador al que se descuenta.')
      apuntes.push({ id: uid(), trabajador, tienda: a.tienda, fecha: a.fecha, tipo: 'descuento', importe: faltante, concepto: `Faltante de caja · cierre #${a.numero}`, cierre: a.id, usuario: s.email, ts: ahora })
    }
    if (form.get('entregar') === 'on') {
      if (!matriz) throw new Error('No hay Casa Matriz para recibir la entrega.')
      // Todo el efectivo (incluido el salario, que se paga después) menos el fondo va a la caja central.
      const cup = Math.round((a.billetes.reduce((x, b) => x + b.valor * b.cantidad, 0) + a.sueltosCUP + a.otros - a.fondo) * 100) / 100
      for (const [moneda, monto] of [['CUP', cup], ['USD', a.usd], ['EUR', a.eur]] as [Moneda, number][])
        if (monto > 0) movs.push(...movimientosEntrega({ id: uid(), fecha: a.fecha, tienda: a.tienda, nombreTienda: t.nombre, matriz: matriz.id, moneda, monto, cajero: a.cajero, nota: `Cierre #${a.numero}` }))
    }
    await mutar({ movimientos: [] as Movimiento[], arqueos: [] as Arqueo[], nomina: [] as ApunteNomina[] }, (x) => {
      if (x.arqueos.find((y) => y.id === a.id)?.estado === 'aprobado') throw new Error('Ya estaba aprobado.')
      return {
        movimientos: [...x.movimientos, ...movs],
        nomina: [...x.nomina, ...apuntes],
        arqueos: x.arqueos.map((y) => (y.id === a.id ? { ...y, salario, estado: 'aprobado' as const, revisadoPor: s.nombre ?? s.email, revisadoEn: ahora, movimientos: movs.map((m) => m.id) } : y)),
      }
    })
    await registrarAuditoria([{ usuario: s.email, accion: 'aprobar cierre de turno', coleccion: 'arqueos', ref: `#${a.numero}`, detalle: `${movs.length} movimientos de caja; ${trabajador}: devengo ${salario}${faltante ? `, descuento ${faltante}` : ''}` }])
    refrescar()
    return { ok: true, mensaje: `Cierre #${a.numero} aprobado: ${movs.length} movimientos en caja; ${salario ? `${salario} CUP a pagar a ${trabajador}` : 'sin salario'}${faltante ? ` (descuento de ${faltante} por faltante)` : ''}.` }
  } catch (e) {
    return fallo(e)
  }
}

/** Borra un cuadre pendiente (mal hecho): la caja vuelve a cuadrarse desde el anterior. Solo el último de su caja. */
export async function accionArqueoBorrar(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const ds = await cargarDataset()
    const a = ds.arqueos.find((x) => x.id === str(form, 'id'))
    if (!a) throw new Error('El cuadre ya no existe.')
    const s = await autorizar('arqueo', a.tienda)
    if (!revisaArqueos(s.rol)) throw new Error('Solo el contador o administración borran cuadres.')
    if (a.estado !== 'pendiente') throw new Error('Un cuadre aprobado no se borra.')
    if (ds.arqueos.some((x) => x.caja === a.caja && x.hasta > a.hasta)) throw new Error('Solo se puede borrar el último cuadre de la caja.')
    await mutar({ arqueos: [] as Arqueo[] }, ({ arqueos }) => ({ arqueos: arqueos.filter((x) => x.id !== a.id) }))
    await registrarAuditoria([{ usuario: s.email, accion: 'borrar cuadre', coleccion: 'arqueos', ref: `#${a.numero}`, detalle: JSON.stringify({ esperado: a.esperado, contado: a.contado }) }])
    refrescar()
    return { ok: true, mensaje: `Cuadre #${a.numero} borrado.` }
  } catch (e) {
    return fallo(e)
  }
}

// ---------------------------------------------------------------- AxisPOS: lo que se sube

/** Manda al TPV la tasa de la tienda (Toque + margen) del USD, EUR y MLC del día indicado. */
export async function accionAxisEnviarTasa(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    if (!escrituraAxis()) throw new Error('Integración en modo solo lectura: no se envía la tasa a AxisPOS.')
    const s = await autorizar('tasas')
    const ds = await cargarDataset()
    const f = str(form, 'fecha') || new Date().toISOString().slice(0, 10)
    const c = clienteAxis(ds)
    const { data, cambios, fechaTasa } = monedasConTasa(await c.monedas(), prepararTasas(ds.tasas, ds.settings.margenTasa), f)
    await c.guardarMonedas(data)
    const detalle = cambios.map((x) => `${x.moneda} ${x.antes} → ${x.despues}`).join(', ')
    await registrarAuditoria([{ usuario: s.email, accion: 'enviar tasa al TPV', coleccion: 'axispos', ref: fechaTasa, detalle }])
    return { ok: true, mensaje: `Tasa del ${fechaTasa} enviada al TPV: ${detalle}.` }
  } catch (e) {
    return fallo(e)
  }
}

/**
 * Sube una compra del Almacén Central (y los traslados de su distribución) a AxisPOS.
 * Cada documento lleva la nota «KA:<id>» y un número de la serie propia; antes de subir se pregunta
 * a la central qué notas faltan de verdad, así que repetir el envío no duplica.
 */
async function enviarCompraAxis(id: string): Promise<Resultado> {
  if (!escrituraAxis()) return { ok: false, error: 'Integración en modo solo lectura: no se envía nada a AxisPOS.' }
  const ds = await cargarDataset()
  const { docs, siguiente } = prepararEnvioCompra(ds, id)
  if (!docs.length) return { ok: true, mensaje: 'Ya estaba subida al TPV.' }
  const malo = docs.find((d) => d.error)
  if (malo) throw new Error(malo.error)
  const c = clienteAxis(ds)
  const faltan = new Set(await c.documentosFaltantes(docs.map((d) => notaKA(d.id))))
  const ops = docs.filter((d) => faltan.has(notaKA(d.id))).map((d) => d.op!)
  const numeros = new Map(docs.map((d) => [d.id, Number(d.op!.Acct)]))
  const ahora = new Date().toISOString()
  let error: string | undefined
  if (ops.length) {
    try {
      await c.importarOperaciones(ops)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }
  const marca = <T extends { id: string; axis?: EnvioAxis }>(x: T): T => (numeros.has(x.id) ? { ...x, axis: { acct: numeros.get(x.id)!, ...(error ? { error } : { enviada: ahora }) } } : x)
  await mutar({ compras: [] as Compra[], salidas: [] as Salida[], settings: DEFAULT_SETTINGS }, (a) => ({
    compras: a.compras.map(marca),
    salidas: a.salidas.map(marca),
    settings: { ...DEFAULT_SETTINGS, ...a.settings, axispos: { ...a.settings.axispos!, siguienteAcct: Math.max(siguiente, a.settings.axispos?.siguienteAcct ?? SERIE_INICIAL) } },
  }))
  if (error) return { ok: false, error }
  return { ok: true, mensaje: `Subida al TPV: ${ops.filter((o) => o.OperType === 1).length} compra y ${ops.filter((o) => o.OperType === 8).length} traslados.` }
}

export async function accionAxisEnviarCompra(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('compras')
    const r = await enviarCompraAxis(str(form, 'id'))
    await registrarAuditoria([{ usuario: s.email, accion: 'subir compra al TPV', coleccion: 'compras', ref: str(form, 'id'), detalle: r.ok ? r.mensaje : r.error }])
    refrescar()
    return r
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


/** Comprueba la conexión y trae las áreas del tenant para asignarlas a las tiendas. */
const AREA_CENTRAL = '1'

export async function accionAxisProbar(_prev?: Resultado | null, _f?: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('integraciones')
    const ds0 = await cargarDataset()
    const c = clienteAxis(ds0)
    await c.comprobar()
    const ubic = (await c.ubicaciones()).filter((u) => !u.DeletedDb).map((u) => ({ code: String(u.Code), nombre: u.Name, grupo: u.Group, tipo: u.Type, precioGrupo: u.PriceGroup }))
    // El área 1 (ALMACEN CENTRAL KM) nunca viaja en el catálogo de ubicaciones, pero existe: es el almacén central.
    if (!ubic.some((u) => u.code === AREA_CENTRAL)) ubic.unshift({ code: AREA_CENTRAL, nombre: 'ALMACEN CENTRAL KM', grupo: 'CENTRAL', tipo: 3, precioGrupo: undefined })
    const proveedores = (await c.socios()).filter((p) => /prov/i.test(p.Group ?? '')).map((p) => ({ code: String(p.Code), nombre: p.Name }))
    const usuarios = await c.usuarios().catch(() => [])
    const usuarioCodigo = usuarios.find((u) => u.Name?.toLowerCase() === (ds0.settings.axispos?.usuario ?? '').toLowerCase())?.Code
    // Las tiendas que todavía no tienen área reciben las que les corresponden por grupo o nombre.
    let asignadas = 0
    await mutar({ settings: DEFAULT_SETTINGS, tiendas: DEFECTOS.tiendas }, ({ settings, tiendas }) => {
      const prop = proponerAreas(ubic, tiendas)
      return {
        settings: { ...DEFAULT_SETTINGS, ...settings, axispos: { ...settings.axispos!, ubicaciones: ubic, proveedores, usuariosTPV: usuarios.map((u) => ({ code: String(u.Code), nombre: u.Name })), ...(settings.axispos?.usuarioCodigo || !usuarioCodigo ? {} : { usuarioCodigo: String(usuarioCodigo) }) } },
        tiendas: [...tiendas, ...DEFECTOS.tiendas.filter((d) => !tiendas.some((t) => t.id === d.id))].map((t) => {
          const codigos = t.tipo === 'almacen' ? [AREA_CENTRAL] : prop.get(t.id)
          if (t.codigoTPV || !codigos) return t
          asignadas++
          return { ...t, codigoTPV: codigos.join(',') }
        }),
      }
    })
    await registrarAuditoria([{ usuario: s.email, accion: 'probar conexión', coleccion: 'axispos', detalle: `${ubic.length} áreas, ${asignadas} tiendas asignadas` }])
    refrescar()
    return { ok: true, mensaje: `Conexión correcta. El tenant tiene ${ubic.length} áreas y ${proveedores.length} proveedores${asignadas ? `; se asignaron automáticamente a ${asignadas} tiendas (revísalo abajo)` : ''}.` }
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

/**
 * Trae el catálogo de mercancías del TPV (código, nombre, grupo, unidad, costo, precio base y por grupo).
 * Lo que se haya cambiado aquí y esté pendiente de pasar al TPV no se pisa: el maestro es Kaluch.
 */
export async function accionAxisProductos(_prev?: Resultado | null, _f?: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('integraciones')
    const ds = await cargarDataset()
    const items = await clienteAxis(ds).mercancias()
    const tabla = prepararTasas(ds.tasas, ds.settings.margenTasa)
    const t = tasaVigente(tabla, new Date().toISOString().slice(0, 10))
    let respetados = 0
    await mutar({ productos: [] as Producto[] }, ({ productos }) => {
      const porNombre = new Map(productos.map((p) => [p.nombre, p]))
      const porCodigo = new Map(productos.filter((p) => p.codigo !== p.nombre).map((p) => [p.codigo, p]))
      const fuera = new Set<Producto>()
      const nuevos: Producto[] = []
      for (const it of items) {
        if (!it.Name) continue
        const previo = porCodigo.get(String(it.Code)) ?? porNombre.get(it.Name)
        if (previo?.modificado) {
          respetados++
          continue
        }
        const cupo = (it.Currency ?? 'CUP').toUpperCase() === 'USD' ? undefined : t?.cupUsd
        const costoUSD = it.Cost ? (cupo ? it.Cost / cupo : it.Cost) : previo?.costoUSD
        if (previo) fuera.add(previo)
        nuevos.push({ ...productoDesdeItem(it, previo), ...(costoUSD ? { costoUSD: Math.round(costoUSD * 1e4) / 1e4 } : {}) })
      }
      return { productos: [...productos.filter((p) => !fuera.has(p)), ...nuevos] }
    })
    await registrarAuditoria([{ usuario: s.email, accion: 'traer catálogo', coleccion: 'axispos', detalle: `${items.length} mercancías${respetados ? `, ${respetados} cambiados aquí sin tocar` : ''}` }])
    refrescar()
    return { ok: true, mensaje: `${items.length} mercancías del TPV en el catálogo.${respetados ? ` ${respetados} cambiados aquí y pendientes de pasar al TPV no se tocaron.` : ''}` }
  } catch (e) {
    return fallo(e)
  }
}

/** Trae las operaciones del TPV («novedades» o un «rango» de fechas que sustituye lo traído antes). */
export async function accionAxisSync(_prev: Resultado | null, form: FormData): Promise<Resultado> {
  try {
    const s = await autorizar('integraciones')
    const modo = str(form, 'modo') === 'rango' ? 'rango' : 'novedades'
    const mensaje = await sincronizarAxis({
      modo,
      desde: modo === 'rango' ? fecha(form, 'desde') : undefined,
      hasta: modo === 'rango' ? fecha(form, 'hasta') : undefined,
      usuario: s.email,
      mesesCerradosEditables: s.rol === 'propietario',
    })
    refrescar()
    return { ok: true, mensaje }
  } catch (e) {
    return fallo(e)
  }
}
