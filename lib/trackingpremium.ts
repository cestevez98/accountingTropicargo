import 'server-only'
import * as XLSX from 'xlsx'
import type { FacturaVenta } from './types'

/**
 * Lectura de facturas del sistema logístico Tracking Premium (tropicargoexpress.online).
 * Variables: TP_USER y TP_PASS (usuario del panel), TP_URL opcional.
 *
 * Solo lee: inicia sesión como el panel, pide la lista de facturas (la misma consulta que hace la pantalla
 * «Listar Facturas») y el Excel «Detalles» para conocer servicio, subtipo y guías de cada factura.
 */

const base = () => (process.env.TP_URL || 'https://tropicargoexpress.online').replace(/\/$/, '')
// El servidor rechaza (ModSecurity) las peticiones que no parecen de un navegador.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

export const tpConfigurado = () => Boolean(process.env.TP_USER && process.env.TP_PASS)

class Sesion {
  private cookies = new Map<string, string>()
  guardar(r: Response) {
    for (const c of r.headers.getSetCookie()) {
      const [par] = c.split(';')
      const i = par.indexOf('=')
      if (i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim())
    }
  }
  get cabecera() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }
  async pedir(ruta: string, init: RequestInit = {}) {
    const r = await fetch(`${base()}${ruta}`, {
      ...init,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(120000),
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*', Cookie: this.cabecera, ...(init.headers ?? {}) },
    })
    this.guardar(r)
    return r
  }
}

async function entrar(): Promise<Sesion> {
  const user = process.env.TP_USER
  const pass = process.env.TP_PASS
  if (!user || !pass) throw new Error('Faltan las credenciales de Tracking Premium (TP_USER y TP_PASS).')
  const s = new Sesion()
  await s.pedir('/login')
  const r = await s.pedir('/login_check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _username: user, _password: pass, login_date: new Date().toISOString().slice(0, 10) }).toString(),
  })
  const destino = r.headers.get('location') ?? ''
  if (r.status !== 302 || /login/i.test(destino)) throw new Error('Tracking Premium rechazó el usuario o la contraseña.')
  return s
}

interface FilaLista {
  id: number
  number: string
  status: string
  shippingtype: string
  customer: { name?: string; lastname?: string }
  creation: string
  expire: string
  total: number
  balance: number
  porcobrar: number
  payment: string | null
  guides: { number?: string }[]
  whrecs: { number?: string }[]
}

const mdy = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`

async function lista(s: Sesion, desde: string, hasta: string): Promise<FilaLista[]> {
  const q = new URLSearchParams({
    agency: '0', fini: mdy(desde), fend: mdy(hasta), status: 'CUALQUIERA', tfecha: 'creationdate', tship: 'Cualquiera', userid: '0', idconsol: '0',
    montomin: '', montomax: '', agent: '0', typesearch: 'FacturaCliente', q: '', sort: 'creation', dir: 'desc', limit: '1000',
  })
  const out: FilaLista[] = []
  let cursor: string | null = null
  for (let i = 0; i < 100; i++) {
    const r = await s.pedir(`/billlist/list?${q}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    if (r.status !== 200) throw new Error(`Tracking Premium respondió ${r.status} al pedir las facturas.`)
    const j = (await r.json()) as { data: FilaLista[]; more?: boolean; next_cursor?: string | null }
    out.push(...j.data)
    cursor = j.more ? (j.next_cursor ?? null) : null
    if (!cursor || !j.data.length) break
  }
  return out
}

interface Detalle {
  servicios: string[]
  subtipo?: string
  guias: string[]
  lineas: string[]
}

/** Excel «Detalles» de un grupo de facturas: una fila por línea de factura. */
async function detalles(s: Sesion, ids: number[]): Promise<Map<string, Detalle>> {
  const mapa = new Map<string, Detalle>()
  for (let i = 0; i < ids.length; i += 250) {
    const body = new URLSearchParams()
    ids.slice(i, i + 250).forEach((id) => body.append('bills[]', String(id)))
    const r = await s.pedir('/bill/0/bills_toexcel', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
    if (r.status !== 200) throw new Error(`Tracking Premium respondió ${r.status} al pedir el detalle de las facturas.`)
    const wb = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: 'array' })
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
    const v = (f: Record<string, unknown>, k: string) => {
      const t = String(f[k] ?? '').trim()
      return t && t !== 'N/A' ? t : ''
    }
    for (const f of filas) {
      const n = v(f, 'Número')
      if (!n) continue
      const d = mapa.get(n) ?? { servicios: [], guias: [], lineas: [] }
      const serv = v(f, 'Servicio')
      // «KGT123: Tarifa Aereo General» es la tarifa del paquete, no un servicio adicional.
      if (serv && !/:\s*/.test(serv) && !d.servicios.includes(serv)) d.servicios.push(serv)
      for (const g of [v(f, 'Guía'), v(f, 'Warehouse')]) if (g && !d.guias.includes(g)) d.guias.push(g)
      const lin = v(f, 'Descripción de la línea')
      if (serv && !/:\s*/.test(serv) && lin && lin !== serv && !d.lineas.includes(lin)) d.lineas.push(lin)
      d.subtipo ??= v(f, 'Subtipo de Envío') || undefined
      mapa.set(n, d)
    }
  }
  return mapa
}

const cliente = (f: FilaLista) => [f.customer?.name, f.customer?.lastname].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()

/** Factura de venta tal como la guarda la contabilidad. */
export function aFactura(f: FilaLista, d?: Detalle): Omit<FacturaVenta, 'id'> {
  const nombre = cliente(f)
  const guias = d?.guias.length ? d.guias : [...f.guides, ...f.whrecs].map((g) => g.number ?? '').filter(Boolean)
  const detalle = [...guias, ...(guias.length ? [] : (d?.lineas ?? []))].join(', ')
  return {
    numero: f.number,
    cliente: nombre,
    emision: f.creation.slice(0, 10),
    vencimiento: f.expire?.slice(0, 10) || undefined,
    monto: Math.round(f.total * 100) / 100,
    cobrado: Math.round(f.balance * 100) / 100,
    ...(d?.servicios.length ? { servicio: d.servicios.join(' · ') } : {}),
    ...(f.shippingtype && f.shippingtype !== 'Ninguno' ? { tipoEnvio: f.shippingtype } : {}),
    ...(d?.subtipo ? { subtipo: d.subtipo } : {}),
    ...(detalle ? { detalle: detalle.slice(0, 300) } : {}),
    estatusSistema: f.status,
    afectaER: nombre.toLowerCase() !== 'tropicargo express',
  }
}

export interface FacturasTP {
  lista: FilaLista[]
  totales: { facturas: number; monto: number; cobrado: number }
  /** Pide el detalle solo de las facturas indicadas (las nuevas). */
  conDetalle: (numeros: string[]) => Promise<Map<string, Detalle>>
}

export async function facturasTP(desde: string, hasta: string): Promise<FacturasTP> {
  const s = await entrar()
  const l = await lista(s, desde, hasta)
  return {
    lista: l,
    totales: { facturas: l.length, monto: l.reduce((a, f) => a + f.total, 0), cobrado: l.reduce((a, f) => a + f.balance, 0) },
    conDetalle: (numeros) => {
      const set = new Set(numeros)
      return detalles(s, l.filter((f) => set.has(f.number)).map((f) => f.id))
    },
  }
}
