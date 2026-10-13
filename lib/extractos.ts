/**
 * Lectura de extractos bancarios (CSV, XLSX, OFX/QFX) y su conversión a movimientos.
 * Funciona en el navegador: el archivo no sale del equipo hasta que se confirma la importación.
 */
import * as XLSX from 'xlsx'

export type Rol = 'fecha' | 'concepto' | 'importe' | 'debito' | 'credito' | 'comision' | 'referencia' | 'saldo' | 'moneda' | 'estado' | 'detalle'

export const ROLES: { rol: Rol; label: string }[] = [
  { rol: 'fecha', label: 'Fecha' },
  { rol: 'concepto', label: 'Concepto / descripción' },
  { rol: 'importe', label: 'Importe (con signo)' },
  { rol: 'debito', label: 'Débito / salida' },
  { rol: 'credito', label: 'Crédito / entrada' },
  { rol: 'comision', label: 'Comisión' },
  { rol: 'referencia', label: 'Referencia / Id.' },
  { rol: 'saldo', label: 'Saldo' },
  { rol: 'moneda', label: 'Moneda' },
  { rol: 'estado', label: 'Estado' },
  { rol: 'detalle', label: 'Detalle extra (nombre, memo…)' },
]

export type FormatoFecha = 'MDY' | 'DMY' | 'YMD'

export interface Formato {
  id: string
  nombre: string
  /** Encabezados (en minúsculas) que identifican el formato. */
  firma: string[]
  /** Alias de encabezado para cada rol. */
  columnas: Partial<Record<Rol, string[]>>
  fecha: FormatoFecha
  /** El banco da los cargos en positivo (tarjetas como AMEX): hay que invertir el signo. */
  invertir?: boolean
  /** Estados a descartar (p. ej. PayPal «Denied»). */
  descartarEstados?: string[]
  /**
   * Columna que dice si la línea mueve el saldo: solo se usan las líneas cuyo valor está en `incluir`.
   * PayPal: «Repercusiones en el saldo» = Crédito / Cargo; descarta los artículos del carrito, autorizaciones y notas.
   */
  impacto?: { columnas: string[]; incluir: string[] }
}

export const FORMATOS: Formato[] = [
  {
    id: 'square-api',
    nombre: 'Square (API)',
    firma: ['id. square'],
    columnas: { fecha: ['fecha'], concepto: ['concepto'], detalle: ['detalle'], importe: ['importe'], moneda: ['moneda'], referencia: ['id. square'] },
    fecha: 'YMD',
  },
  {
    id: 'paypal',
    nombre: 'PayPal (actividad)',
    firma: ['gross|bruto', 'net|neto'],
    columnas: {
      fecha: ['date', 'fecha'],
      concepto: ['name', 'nombre'],
      detalle: ['type', 'tipo', 'item title', 'título del artículo', 'subject', 'asunto', 'note', 'nota'],
      importe: ['gross', 'bruto'],
      comision: ['fee', 'comisión', 'tarifa'],
      referencia: ['transaction id', 'id. de transacción', 'id de transacción', 'número de identificación de la transacción'],
      saldo: ['balance', 'saldo'],
      moneda: ['currency', 'divisa', 'moneda'],
      estado: ['status', 'estado'],
    },
    fecha: 'MDY',
    descartarEstados: ['denied', 'denegado', 'declinado', 'rechazado', 'canceled', 'cancelado', 'reversed'],
    impacto: { columnas: ['repercusiones en el saldo', 'balance impact', 'impacto en el saldo'], incluir: ['crédito', 'credito', 'cargo', 'débito', 'debito', 'credit', 'debit'] },
  },
  {
    id: 'revolut',
    nombre: 'Revolut',
    firma: ['started date|fecha de inicio', 'completed date|fecha de finalización'],
    columnas: {
      fecha: ['completed date', 'fecha de finalización', 'started date', 'fecha de inicio'],
      concepto: ['description', 'descripción'],
      detalle: ['type', 'tipo'],
      importe: ['amount', 'importe', 'cantidad'],
      comision: ['fee', 'comisión'],
      moneda: ['currency', 'divisa'],
      saldo: ['balance', 'saldo'],
      estado: ['state', 'estado'],
    },
    fecha: 'YMD',
    descartarEstados: ['reverted', 'declined', 'failed', 'revertido', 'rechazado', 'fallido'],
  },
  {
    id: 'tarjeta-corporativa',
    nombre: 'Tarjeta corporativa BofA (Posting Date, Reference ID, MCC)',
    firma: ['posting date', 'reference id', 'amount'],
    columnas: {
      fecha: ['posting date'],
      concepto: ['description'],
      detalle: ['merchant category'],
      importe: ['amount'],
      referencia: ['reference id'],
    },
    fecha: 'MDY',
    invertir: true,
  },
  {
    id: 'amex',
    nombre: 'American Express',
    firma: ['date', 'description', 'amount', '!running bal.', '!posted date'],
    columnas: {
      fecha: ['date'],
      concepto: ['description'],
      detalle: ['extended details', 'appears on your statement as'],
      importe: ['amount'],
      referencia: ['reference'],
    },
    fecha: 'MDY',
    invertir: true,
  },
  {
    id: 'bofa-tarjeta',
    nombre: 'Bank of America — tarjeta',
    firma: ['posted date', 'payee', 'amount'],
    columnas: { fecha: ['posted date'], concepto: ['payee'], detalle: ['address'], importe: ['amount'], referencia: ['reference number'] },
    fecha: 'MDY',
  },
  {
    id: 'bofa',
    nombre: 'Bank of America — cuenta',
    firma: ['date', 'description', 'amount', 'running bal.'],
    columnas: { fecha: ['date'], concepto: ['description'], importe: ['amount'], saldo: ['running bal.'] },
    fecha: 'MDY',
  },
  {
    id: 'truist',
    nombre: 'Truist',
    firma: ['posted date', 'transaction date', 'description', '!long description'],
    columnas: {
      fecha: ['posted date', 'transaction date'],
      concepto: ['description'],
      detalle: ['transaction type', 'transaction category'],
      importe: ['amount'],
      debito: ['debit', 'debits'],
      credito: ['credit', 'credits'],
      referencia: ['check/serial #', 'check number'],
      saldo: ['daily posted balance', 'balance'],
    },
    fecha: 'MDY',
  },
  {
    id: 'regions',
    nombre: 'Regions',
    firma: ['long description|description', 'debit|amount', 'posted date|date', '!transaction type'],
    columnas: {
      fecha: ['date', 'posted date'],
      concepto: ['description', 'transaction', 'name'],
      detalle: ['long description', 'memo'],
      importe: ['amount'],
      debito: ['debit', 'withdrawals'],
      credito: ['credit', 'deposits'],
      referencia: ['no.', 'check number', 'reference'],
      saldo: ['balance'],
    },
    fecha: 'MDY',
  },
]

export interface Tabla {
  encabezados: string[]
  filas: unknown[][]
  /** Saldo final que declara el propio extracto (OFX/QFX: LEDGERBAL). */
  saldoFinal?: { importe: number; fecha: string }
}

export interface Linea {
  /** Índice de la fila en el archivo (para identificarla). */
  n: number
  fecha: string
  concepto: string
  importe: number
  referencia?: string
  moneda: 'USD' | 'CUP' | 'EUR'
  saldo?: number
  extra: Record<string, string | number>
  /** Motivo por el que la fila no se puede usar. */
  error?: string
}

const norm = (v: unknown) =>
  String(v ?? '')
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()

// ------------------------------------------------------------------ lectura

export function leerArchivo(nombre: string, datos: ArrayBuffer): Tabla {
  const texto = /\.(ofx|qfx)$/i.test(nombre) ? new TextDecoder().decode(datos) : null
  if (texto != null || looksLikeOfx(datos)) return leerOfx(texto ?? new TextDecoder().decode(datos))
  const wb = XLSX.read(new Uint8Array(datos), { type: 'array', raw: true, cellDates: false, codepage: 65001 })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const filas = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false })
  const h = filaEncabezado(filas)
  return { encabezados: (filas[h] ?? []).map((v) => String(v ?? '').trim()), filas: filas.slice(h + 1).filter((r) => r.some((c) => c != null && c !== '')) }
}

function looksLikeOfx(datos: ArrayBuffer) {
  const inicio = new TextDecoder().decode(datos.slice(0, 400))
  return /OFXHEADER|<OFX>/i.test(inicio)
}

/** Primera fila que parece un encabezado: tiene una columna de fecha y otra de importe/débito. */
function filaEncabezado(filas: unknown[][]): number {
  for (let i = 0; i < Math.min(filas.length, 40); i++) {
    const c = (filas[i] ?? []).map(norm)
    const fecha = c.some((x) => /date|fecha/.test(x))
    const importe = c.some((x) => /amount|importe|debit|credit|gross|bruto|cantidad|monto/.test(x))
    if (fecha && importe) return i
  }
  return 0
}

function leerOfx(txt: string): Tabla {
  const encabezados = ['DTPOSTED', 'NAME', 'MEMO', 'TRNAMT', 'FITID', 'TRNTYPE', 'CHECKNUM']
  const filas: unknown[][] = []
  const bloques = txt.split(/<STMTTRN>/i).slice(1)
  for (const b of bloques) {
    const tag = (t: string) => b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i'))?.[1]?.trim() ?? ''
    const d = tag('DTPOSTED')
    const nombre = tag('NAME').replace(/&amp;/g, '&')
    filas.push([d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '', nombre, tag('MEMO').replace(/&amp;/g, '&'), tag('TRNAMT'), tag('FITID'), tag('TRNTYPE'), tag('CHECKNUM')])
  }
  const bal = txt.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)[\s\S]*?<DTASOF>(\d{8})/i)
  const saldoFinal = bal ? { importe: Number(bal[1]), fecha: `${bal[2].slice(0, 4)}-${bal[2].slice(4, 6)}-${bal[2].slice(6, 8)}` } : undefined
  return { encabezados, filas, ...(saldoFinal && Number.isFinite(saldoFinal.importe) ? { saldoFinal } : {}) }
}

export const FORMATO_OFX: Formato = {
  id: 'ofx',
  nombre: 'OFX / QFX (Quicken, Money)',
  firma: ['dtposted', 'trnamt'],
  columnas: { fecha: ['dtposted'], concepto: ['name'], detalle: ['memo'], importe: ['trnamt'], referencia: ['fitid'] },
  fecha: 'YMD',
}

// ------------------------------------------------------------------ detección y mapeo

export type Mapeo = Partial<Record<Rol, number>>

export function detectarFormato(t: Tabla): Formato | null {
  const h = t.encabezados.map(norm)
  const tiene = (alt: string) => alt.split('|').some((a) => h.includes(a))
  for (const f of [FORMATO_OFX, ...FORMATOS]) {
    const ok = f.firma.every((s) => (s.startsWith('!') ? !h.includes(s.slice(1)) : tiene(s)))
    if (ok) return f
  }
  return null
}

export function mapear(t: Tabla, f: Formato | null): Mapeo {
  const h = t.encabezados.map(norm)
  const m: Mapeo = {}
  if (f) {
    for (const [rol, alias] of Object.entries(f.columnas) as [Rol, string[]][]) {
      for (const a of alias) {
        const i = h.indexOf(a)
        if (i >= 0) {
          m[rol] = i
          break
        }
      }
    }
    return m
  }
  // Genérico: por palabras clave.
  const busca = (re: RegExp, excluir?: RegExp) => h.findIndex((x) => re.test(x) && !(excluir && excluir.test(x)))
  const pon = (rol: Rol, i: number) => {
    if (i >= 0 && !Object.values(m).includes(i)) m[rol] = i
  }
  pon('fecha', busca(/posted|fecha|date/))
  pon('debito', busca(/debit|débito|withdraw|cargo|salida|retiro/))
  pon('credito', busca(/credit|crédito|deposit|abono|entrada|ingreso/))
  if (m.debito == null || m.credito == null) {
    delete m.debito
    delete m.credito
    pon('importe', busca(/amount|importe|monto|cantidad|gross|bruto|valor/, /balance|saldo/))
  }
  pon('concepto', busca(/descrip|concepto|payee|name|nombre|detalle|transaction/))
  pon('referencia', busca(/ref|id|n[uú]mero|check/))
  pon('saldo', busca(/balance|saldo/))
  pon('moneda', busca(/currency|moneda|divisa/))
  return m
}

// ------------------------------------------------------------------ conversión

export function parseImporte(v: unknown): number {
  if (typeof v === 'number') return v
  let s = String(v ?? '').trim()
  if (!s) return NaN
  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1)
  }
  if (/^\s*[-−]|[-−]\s*$/.test(s.replace(/[$€\s]/g, ''))) neg = !neg
  s = s.replace(/[^\d.,]/g, '')
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? (neg ? -n : n) : NaN
}

export function parseFecha(v: unknown, formato: FormatoFecha): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v)
    return iso(d.y, d.m, d.d)
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{8})/)
  if (m && formato === 'YMD') return iso(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8))
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (m) {
    let [a, b, y] = [+m[1], +m[2], +m[3]]
    if (y < 100) y += 2000
    // Si un número no puede ser mes, se deduce el orden aunque el formato diga otra cosa.
    const dmy = formato === 'DMY' ? b <= 12 || a > 12 : a > 12
    return dmy ? iso(y, b, a) : iso(y, a, b)
  }
  const meses: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, ene: 1, abr: 4, ago: 8, dic: 12 }
  m = s.match(/^(\d{1,2})\s+([a-záé]{3})\w*\.?\s+(\d{4})/i) ?? null
  if (m && meses[m[2].toLowerCase()]) return iso(+m[3], meses[m[2].toLowerCase()], +m[1])
  m = s.match(/^([a-z]{3})\w*\.?\s+(\d{1,2}),?\s+(\d{4})/i)
  if (m && meses[m[1].toLowerCase()]) return iso(+m[3], meses[m[1].toLowerCase()], +m[2])
  return null
}

function iso(y: number, m: number, d: number): string | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1990 && y < 2100)) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function convertir(
  t: Tabla,
  m: Mapeo,
  opciones: { fecha: FormatoFecha; invertir?: boolean; descartarEstados?: string[]; impacto?: Formato['impacto'] },
): Linea[] {
  const out: Linea[] = []
  const val = (r: unknown[], rol: Rol) => (m[rol] != null ? r[m[rol]!] : undefined)
  const h = t.encabezados.map(norm)
  const iImpacto = opciones.impacto ? h.findIndex((x) => opciones.impacto!.columnas.includes(x)) : -1
  t.filas.forEach((r, n) => {
    if (iImpacto >= 0 && !opciones.impacto!.incluir.includes(norm(r[iImpacto]))) return
    const estado = norm(val(r, 'estado'))
    if (estado && opciones.descartarEstados?.some((e) => estado.includes(e))) return
    const fecha = parseFecha(val(r, 'fecha'), opciones.fecha)
    let importe: number
    if (m.importe != null) importe = parseImporte(val(r, 'importe'))
    else {
      const d = parseImporte(val(r, 'debito'))
      const c = parseImporte(val(r, 'credito'))
      importe = (Number.isFinite(c) ? Math.abs(c) : 0) - (Number.isFinite(d) ? Math.abs(d) : 0)
      if (!Number.isFinite(d) && !Number.isFinite(c)) importe = NaN
    }
    const comision = parseImporte(val(r, 'comision'))
    if (Number.isFinite(comision) && comision) importe += comision < 0 ? comision : -comision
    if (opciones.invertir) importe = -importe
    const concepto = String(val(r, 'concepto') ?? '').replace(/\s+/g, ' ').trim()
    const detalle = String(val(r, 'detalle') ?? '').replace(/\s+/g, ' ').trim()
    const mon = String(val(r, 'moneda') ?? 'USD').toUpperCase().trim() || 'USD'
    const saldo = parseImporte(val(r, 'saldo'))
    const extra: Record<string, string | number> = {}
    if (detalle) extra.Detalle = detalle
    if (Number.isFinite(comision) && comision) extra['Comisión'] = comision
    t.encabezados.forEach((h, i) => {
      if (Object.values(m).includes(i) || r[i] == null || r[i] === '') return
      if (h) extra[h] = typeof r[i] === 'number' ? (r[i] as number) : String(r[i])
    })
    const linea: Linea = {
      n,
      fecha: fecha ?? '',
      concepto: concepto || detalle || '(sin concepto)',
      importe: Math.round(importe * 100) / 100,
      referencia: m.referencia != null ? String(val(r, 'referencia') ?? '').replace(/^ref(erence)?[:#]?\s*/i, '').replace(/^['"]+|['"]+$/g, '').trim() || undefined : undefined,
      moneda: mon === 'EUR' || mon === 'CUP' ? mon : 'USD',
      saldo: Number.isFinite(saldo) ? saldo : undefined,
      extra,
    }
    if (!['USD', 'EUR', 'CUP'].includes(mon)) linea.error = `Moneda ${mon}: no se importa (la cuenta lleva USD; la conversión aparece en su propia línea en USD)`
    else if (!fecha) linea.error = 'Fecha no reconocida'
    else if (!Number.isFinite(importe)) linea.error = 'Importe no reconocido'
    else if (importe === 0) linea.error = 'Importe 0'
    out.push(linea)
  })
  return out
}

// ------------------------------------------------------------------ duplicados y categorías

export interface Existente {
  id: string
  fecha: string
  importe: number
  referencia?: string
  concepto: string
}

const normConcepto = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/**
 * Marca como duplicadas las líneas que ya están en el sistema.
 * Cada movimiento existente solo puede «consumir» una línea, así que dos cobros iguales el mismo día
 * cuentan como dos. Coincide por referencia; si no hay, por fecha (±2 días) e importe.
 */
export function marcarDuplicados(lineas: Linea[], existentes: Existente[], usadosIds = new Set<string>()): Set<number> {
  const dup = new Set<number>()
  const usados = new Set<number>()
  const porRef = new Map<string, number[]>()
  existentes.forEach((e, i) => {
    if (e.referencia) porRef.set(e.referencia, [...(porRef.get(e.referencia) ?? []), i])
  })
  // Referencias recortadas (p. ej. el Excel guardaba solo 12 caracteres del Id. de PayPal): se comparan por prefijo.
  const recortadas = existentes.map((e, i) => [e.referencia, i] as const).filter(([r]) => r && r.length >= 10) as [string, number][]
  const buscarRef = (ref: string, importe: number) =>
    porRef.get(ref)?.find((j) => !usados.has(j) && Math.abs(existentes[j].importe - importe) < 0.01) ??
    (ref.length >= 10
      ? recortadas.find(([r, j]) => !usados.has(j) && (ref.startsWith(r) || r.startsWith(ref)) && Math.abs(existentes[j].importe - importe) < 0.01)?.[1]
      : undefined)
  // Primero las coincidencias por referencia (las más seguras).
  for (const l of lineas) {
    if (!l.referencia) continue
    const i = buscarRef(l.referencia, l.importe)
    if (i != null) {
      usados.add(i)
      dup.add(l.n)
    }
  }
  const dia = 86400000
  for (const l of lineas) {
    if (dup.has(l.n) || l.error) continue
    const t = Date.parse(l.fecha)
    let mejor = -1
    let mejorDist = Infinity
    existentes.forEach((e, j) => {
      if (usados.has(j) || Math.abs(e.importe - l.importe) >= 0.01) return
      const dist = Math.abs(Date.parse(e.fecha) - t)
      if (dist > 2 * dia) return
      // Mismo día y mismo concepto es lo más probable.
      const score = dist + (normConcepto(e.concepto) === normConcepto(l.concepto) ? 0 : dia / 2)
      if (score < mejorDist) {
        mejorDist = score
        mejor = j
      }
    })
    if (mejor >= 0) {
      usados.add(mejor)
      dup.add(l.n)
    }
  }
  for (const i of usados) usadosIds.add(existentes[i].id)
  return dup
}

const TOKENS_LARGOS = /\d{6,}(?:-\d{4,})?/g

/**
 * Entre las líneas que no son duplicadas, busca las que parecen el mismo movimiento ya registrado con
 * OTRO importe (p. ej. un error al teclear): misma fecha ±2 días y el mismo número de referencia dentro
 * del concepto (WIRE REF#…, número de cheque…) o el mismo concepto exacto. Devuelve línea → id existente.
 */
export function marcarDiferencias(
  lineas: Linea[],
  existentes: Existente[],
  duplicadas: Set<number>,
  usadosIds: Set<string>,
): Map<number, Existente & { porReferencia: boolean }> {
  const out = new Map<number, Existente & { porReferencia: boolean }>()
  const dia = 86400000
  for (const l of lineas) {
    if (duplicadas.has(l.n) || l.error) continue
    const tokens = `${l.concepto} ${l.referencia ?? ''}`.match(TOKENS_LARGOS) ?? []
    const t = Date.parse(l.fecha)
    const cerca = (e: Existente) => !usadosIds.has(e.id) && Math.abs(Date.parse(e.fecha) - t) <= 2 * dia && Math.sign(e.importe) === Math.sign(l.importe)
    // Primero por número de referencia dentro del concepto (seguro); si no, por concepto idéntico (dudoso).
    let candidato = existentes.find((e) => cerca(e) && tokens.some((tk) => `${e.concepto} ${e.referencia ?? ''}`.includes(tk)))
    const porReferencia = Boolean(candidato)
    // Por concepto solo si el importe se parece (±20 %): una diferencia enorme es otro movimiento, no un error de tecleo.
    candidato ??= existentes.find(
      (e) =>
        cerca(e) &&
        normConcepto(e.concepto).length > 12 &&
        normConcepto(e.concepto) === normConcepto(l.concepto) &&
        Math.abs(e.importe - l.importe) <= 0.2 * Math.abs(l.importe),
    )
    if (candidato) {
      usadosIds.add(candidato.id)
      out.set(l.n, { ...candidato, porReferencia })
    }
  }
  return out
}

export type { ReglaCategoria as Regla } from './types'
import type { ReglaCategoria as Regla } from './types'

/** Clave de aprendizaje: las 2 primeras palabras significativas del concepto (sin números ni códigos). */
export function claveConcepto(s: string): string {
  return normConcepto(s)
    .split(' ')
    .filter((w) => w.length > 1 && !/\d/.test(w))
    .slice(0, 2)
    .join(' ')
}

export function sugerirCategoria(l: Pick<Linea, 'concepto' | 'importe' | 'extra'>, cuenta: string, reglas: Regla[], aprendidas: Record<string, string>): { categoria: string; motivo: string } | null {
  const texto = normConcepto(`${l.concepto} ${l.extra?.Detalle ?? ''}`)
  for (const r of reglas) {
    if (r.cuenta && r.cuenta !== cuenta) continue
    if (r.sentido === 'entrada' && l.importe < 0) continue
    if (r.sentido === 'salida' && l.importe > 0) continue
    if (texto.includes(normConcepto(r.contiene))) return { categoria: r.categoria, motivo: `Regla «${r.contiene}»` }
  }
  const k = claveConcepto(l.concepto)
  const signo = l.importe >= 0 ? '+' : '-'
  const a = aprendidas[`${cuenta}|${signo}|${k}`] ?? aprendidas[`*|${signo}|${k}`]
  if (k && a) return { categoria: a, motivo: 'Aprendida de movimientos anteriores' }
  return null
}
