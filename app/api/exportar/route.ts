import * as XLSX from 'xlsx'
import { sesionActual } from '@/lib/auth'
import { COLECCIONES } from '@/lib/colecciones'
import { cargarContabilidad } from '@/lib/data'
import { listar } from '@/lib/listado'
import { aniosDisponibles, bancos, capital, estadoResultados, estadoSituacion, flujoEfectivo, mesesDelAnio, type Informe } from '@/lib/reports'
import type { Dataset } from '@/lib/types'

const NOMBRES: Record<string, string> = { er: 'Estado de Resultados', efe: 'Flujo de Caja', es: 'Estado de Situacion', capital: 'Capital', bancos: 'Bancos' }

const r2 = (n: number) => Math.round(n * 100) / 100

function hojaInforme(inf: Informe) {
  const filas: (string | number)[][] = [['Concepto', ...inf.columnas, ...(inf.conTotal ? ['Total'] : [])]]
  for (const f of inf.filas) {
    if (f.tipo === 'titulo') filas.push([f.label])
    else filas.push([f.label, ...f.valores.map(r2), ...(inf.conTotal ? [f.total == null ? '' : r2(f.total)] : [])])
  }
  const ws = XLSX.utils.aoa_to_sheet(filas)
  ws['!cols'] = [{ wch: 55 }, ...inf.columnas.map(() => ({ wch: 14 })), { wch: 14 }]
  return ws
}

export async function GET(req: Request) {
  const s = await sesionActual()
  if (!s) return new Response('No autorizado', { status: 401 })
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams)
  const { ds, mayor, idx } = await cargarContabilidad()
  const wb = XLSX.utils.book_new()
  let nombre = 'export'

  if (sp.informe) {
    if (s.rol === 'cajero') return new Response('No autorizado', { status: 403 })
    const anios = aniosDisponibles(mayor)
    const anio = anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios.at(-1)!
    const meses = mesesDelAnio(mayor, anio)
    const er = estadoResultados(ds, idx, meses)
    const informes: Record<string, () => Informe> = {
      er: () => er,
      efe: () => flujoEfectivo(ds, idx, meses),
      es: () => estadoSituacion(ds, idx, meses),
      capital: () => capital(ds, idx, meses, er),
      bancos: () => bancos(ds, idx, meses),
    }
    const claves = sp.informe === 'todos' ? Object.keys(informes) : [sp.informe]
    for (const k of claves) {
      if (!informes[k]) return new Response('Informe desconocido', { status: 400 })
      XLSX.utils.book_append_sheet(wb, hojaInforme(informes[k]()), NOMBRES[k].slice(0, 31))
    }
    nombre = `${claves.length > 1 ? 'Informes' : NOMBRES[claves[0]]} ${anio}`
  } else if (sp.coleccion && COLECCIONES[sp.coleccion]) {
    const cfg = COLECCIONES[sp.coleccion]
    let datos = ds[sp.coleccion as keyof Dataset] as unknown as (Record<string, unknown> & { id: string })[]
    if (s.rol === 'cajero') {
      if (sp.coleccion !== 'movimientos') return new Response('No autorizado', { status: 403 })
      datos = datos.filter((m) => s.cuentas?.includes(String(m.cuenta)))
    }
    if (sp.coleccion === 'movimientos') {
      datos = datos.map((m) => ({ ...m, _usd: mayor.usd.get(m.id) }))
      if (sp.categoria === '__sin__') {
        const cats = new Set(ds.categorias.map((c) => c.nombre))
        datos = datos.filter((m) => m.categoria === 'Por clasificar' || !cats.has(String(m.categoria)))
        delete sp.categoria
      }
    }
    const filtrados = todosFiltrados(cfg, datos, sp)
    const cab = [...cfg.campos.map((c) => c.label), ...(sp.coleccion === 'movimientos' ? ['Importe USD'] : [])]
    const filas = filtrados.map((r) => [
      ...cfg.campos.map((c) => {
        const v = r[c.key]
        if (c.tipo === 'bool') return v ? 'Sí' : ''
        return v == null ? '' : (v as string | number)
      }),
      ...(sp.coleccion === 'movimientos' ? [(r._usd as number) ?? ''] : []),
    ])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cab, ...filas]), cfg.titulo.slice(0, 31))
    nombre = cfg.titulo
  } else return new Response('Parámetros inválidos', { status: 400 })

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}.xlsx`,
      'Cache-Control': 'no-store',
    },
  })
}

/** Todas las filas filtradas (sin paginar). */
function todosFiltrados(cfg: (typeof COLECCIONES)[string], datos: (Record<string, unknown> & { id: string })[], sp: Record<string, string>) {
  const primera = listar(cfg, datos, { ...sp, p: '1' })
  const out = [...primera.filas]
  for (let p = 2; p <= primera.paginas; p++) out.push(...listar(cfg, datos, { ...sp, p: String(p) }).filas)
  return out
}
