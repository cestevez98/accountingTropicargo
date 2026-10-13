'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { confirmarExtracto, prepararExtracto, type DatosExtracto } from '@/app/acciones'
import {
  FORMATOS,
  FORMATO_OFX,
  ROLES,
  claveConcepto,
  convertir,
  detectarFormato,
  leerArchivo,
  mapear,
  marcarDiferencias,
  marcarDuplicados,
  sugerirCategoria,
  type Formato,
  type FormatoFecha,
  type Linea,
  type Mapeo,
  type Rol,
  type Tabla,
} from '@/lib/extractos'

const nf = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = (n: number | undefined) => (n == null || !Number.isFinite(n) ? '—' : nf.format(n))

type Vista = 'nuevas' | 'distintas' | 'registradas' | 'errores'

export function ImportadorExtractos({ cuentas, categorias }: { cuentas: string[]; categorias: { grupo: string; nombres: string[] }[] }) {
  const router = useRouter()
  const [cuenta, setCuenta] = useState('')
  const [archivo, setArchivo] = useState<{ nombre: string; tabla: Tabla } | null>(null)
  const [formato, setFormato] = useState<Formato | null>(null)
  const [mapeo, setMapeo] = useState<Mapeo>({})
  const [fechaFmt, setFechaFmt] = useState<FormatoFecha>('MDY')
  const [invertir, setInvertir] = useState(false)
  const [datos, setDatos] = useState<DatosExtracto | null>(null)
  const [cats, setCats] = useState<Record<number, string>>({})
  const [recordar, setRecordar] = useState<Record<number, boolean>>({})
  const [excluir, setExcluir] = useState<Record<number, boolean>>({})
  const [corregir, setCorregir] = useState<Record<number, boolean>>({})
  const [vista, setVista] = useState<Vista>('nuevas')
  const [saldoBanco, setSaldoBanco] = useState('')
  const [fechaSaldo, setFechaSaldo] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [pendiente, start] = useTransition()

  async function cargarDatos(c: string) {
    setDatos(null)
    if (!c) return
    const r = await prepararExtracto(c)
    if (r.ok) setDatos(r.datos)
    else setMsg({ ok: false, t: r.error })
  }

  async function elegirArchivo(f: File) {
    setMsg(null)
    try {
      const tabla = leerArchivo(f.name, await f.arrayBuffer())
      const det = detectarFormato(tabla)
      setArchivo({ nombre: f.name, tabla })
      aplicarFormato(tabla, det)
      setCats({})
      setRecordar({})
      setExcluir({})
      setCorregir({})
      if (tabla.saldoFinal) {
        setSaldoBanco(String(tabla.saldoFinal.importe))
        setFechaSaldo(tabla.saldoFinal.fecha)
      } else {
        setSaldoBanco('')
        setFechaSaldo('')
      }
    } catch (e) {
      setMsg({ ok: false, t: `No se pudo leer el archivo: ${e instanceof Error ? e.message : e}` })
    }
  }

  function aplicarFormato(tabla: Tabla, f: Formato | null) {
    setFormato(f)
    setMapeo(mapear(tabla, f))
    setFechaFmt(f?.fecha ?? 'MDY')
    setInvertir(Boolean(f?.invertir))
  }

  // Análisis: líneas, duplicadas, importes distintos y categoría sugerida.
  const analisis = useMemo(() => {
    if (!archivo || !datos) return null
    const lineas = convertir(archivo.tabla, mapeo, { fecha: fechaFmt, invertir, descartarEstados: formato?.descartarEstados })
    const usados = new Set<string>()
    const dup = marcarDuplicados(lineas, datos.existentes, usados)
    const dif = marcarDiferencias(lineas, datos.existentes, dup, usados)
    const sugerencias = new Map<number, { categoria: string; motivo: string } | null>()
    for (const l of lineas) sugerencias.set(l.n, sugerirCategoria(l, cuenta, datos.reglas, datos.aprendidas))
    const fechas = lineas.filter((l) => l.fecha).map((l) => l.fecha).sort()
    return { lineas, dup, dif, sugerencias, desde: fechas[0], hasta: fechas.at(-1) }
  }, [archivo, datos, mapeo, fechaFmt, invertir, formato, cuenta])

  const grupos = useMemo(() => {
    if (!analisis) return null
    const { lineas, dup, dif } = analisis
    return {
      nuevas: lineas.filter((l) => !l.error && !dup.has(l.n) && !dif.has(l.n)),
      distintas: lineas.filter((l) => dif.has(l.n)),
      registradas: lineas.filter((l) => dup.has(l.n)),
      errores: lineas.filter((l) => l.error),
    }
  }, [analisis])

  const categoriaDe = (l: Linea) => cats[l.n] ?? analisis?.sugerencias.get(l.n)?.categoria ?? 'Por clasificar'
  const seImporta = (l: Linea) => !excluir[l.n]
  // Solo se propone corregir automáticamente cuando coincide el número de referencia; por concepto, lo decide el usuario.
  const seCorrige = (l: Linea) => corregir[l.n] ?? Boolean(analisis?.dif.get(l.n)?.porReferencia)

  // Conciliación: saldo del sistema a la fecha del saldo del banco, tras aplicar la importación.
  const conciliacion = useMemo(() => {
    if (!analisis || !grupos || !datos || !fechaSaldo || saldoBanco === '') return null
    const banco = Number(saldoBanco.replace(',', '.'))
    if (!Number.isFinite(banco)) return null
    let sistema = 0
    const corr = new Map<string, number>()
    for (const l of grupos.distintas) if (seCorrige(l)) corr.set(analisis.dif.get(l.n)!.id, l.importe)
    for (const e of datos.existentes) if (e.fecha <= fechaSaldo) sistema += corr.get(e.id) ?? e.importe
    for (const l of grupos.nuevas) if (seImporta(l) && l.fecha <= fechaSaldo) sistema += l.importe
    return { banco, sistema, diferencia: banco - sistema }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analisis, grupos, datos, fechaSaldo, saldoBanco, excluir, corregir])

  function importar() {
    if (!analisis || !grupos || !archivo) return
    const nuevos = grupos.nuevas.filter(seImporta).map((l) => ({
      fecha: l.fecha,
      concepto: l.concepto,
      referencia: l.referencia,
      importe: l.importe,
      moneda: l.moneda,
      categoria: categoriaDe(l),
      extra: l.extra,
    }))
    const correcciones = grupos.distintas.filter(seCorrige).map((l) => ({ id: analisis.dif.get(l.n)!.id, importe: l.importe }))
    const reglas = grupos.nuevas
      .filter((l) => recordar[l.n] && claveConcepto(l.concepto))
      .map((l) => ({ contiene: claveConcepto(l.concepto), categoria: categoriaDe(l), sentido: (l.importe >= 0 ? 'entrada' : 'salida') as 'entrada' | 'salida' }))
    if (!nuevos.length && !correcciones.length) return setMsg({ ok: false, t: 'No hay nada que importar ni corregir.' })
    if (!confirm(`Se importarán ${nuevos.length} movimientos y se corregirán ${correcciones.length} importes en «${cuenta}». ¿Continuar?`)) return
    start(async () => {
      const r = await confirmarExtracto(cuenta, archivo.nombre, nuevos, correcciones, reglas)
      setMsg({ ok: r.ok, t: r.ok ? (r.mensaje ?? 'Hecho.') : r.error })
      if (r.ok) {
        await cargarDatos(cuenta)
        router.refresh()
      }
    })
  }

  const n = grupos ? { nuevas: grupos.nuevas.length, distintas: grupos.distintas.length, registradas: grupos.registradas.length, errores: grupos.errores.length } : null
  const aImportar = grupos ? grupos.nuevas.filter(seImporta) : []

  return (
    <div className="space-y-4">
      <section className="tarjeta grid gap-4 p-4 md:grid-cols-3">
        <div>
          <label className="etiqueta">1. Cuenta del extracto</label>
          <select
            className="input"
            value={cuenta}
            onChange={(e) => {
              setCuenta(e.target.value)
              setMsg(null)
              cargarDatos(e.target.value)
            }}
          >
            <option value="">— elige —</option>
            {cuentas.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="etiqueta">2. Archivo descargado del banco (CSV, Excel, OFX o QFX)</label>
          <input
            type="file"
            accept=".csv,.txt,.xlsx,.xls,.ofx,.qfx"
            disabled={!cuenta}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-marca-600 file:px-3 file:py-1.5 file:text-white disabled:opacity-50"
            onChange={(e) => e.target.files?.[0] && elegirArchivo(e.target.files[0])}
          />
          {!cuenta && <p className="mt-1 text-xs text-slate-400">Elige primero la cuenta.</p>}
        </div>
      </section>

      {msg && <p className={`rounded-md px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.t}</p>}

      {archivo && (
        <details className="tarjeta p-4" open={!formato}>
          <summary className="cursor-pointer text-sm font-medium text-slate-800">
            3. Formato: {formato ? <span className="text-emerald-700">{formato.nombre} (detectado)</span> : <span className="text-amber-700">no reconocido — indica qué es cada columna</span>}
            <span className="ml-2 text-xs font-normal text-slate-500">{archivo.tabla.filas.length} filas · clic para revisar las columnas</span>
          </summary>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="etiqueta">Formato</label>
              <select
                className="input"
                value={formato?.id ?? ''}
                onChange={(e) => aplicarFormato(archivo.tabla, [FORMATO_OFX, ...FORMATOS].find((f) => f.id === e.target.value) ?? null)}
              >
                <option value="">Manual / genérico</option>
                {[FORMATO_OFX, ...FORMATOS].map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="etiqueta">Fechas</label>
              <select className="input" value={fechaFmt} onChange={(e) => setFechaFmt(e.target.value as FormatoFecha)}>
                <option value="MDY">MM/DD/AAAA (EE. UU.)</option>
                <option value="DMY">DD/MM/AAAA</option>
                <option value="YMD">AAAA-MM-DD</option>
              </select>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" checked={invertir} onChange={(e) => setInvertir(e.target.checked)} className="accent-marca-600" />
              Invertir signo (el banco da los cargos en positivo)
            </label>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map(({ rol, label }) => (
              <div key={rol}>
                <label className="etiqueta">{label}</label>
                <select
                  className="input"
                  value={mapeo[rol] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    const m = { ...mapeo }
                    if (v === '') delete m[rol]
                    else m[rol as Rol] = Number(v)
                    setMapeo(m)
                  }}
                >
                  <option value="">—</option>
                  {archivo.tabla.encabezados.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Columna ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">Usa «Importe (con signo)» o bien «Débito» y «Crédito» por separado.</p>
        </details>
      )}

      {archivo && !datos && cuenta && <p className="text-sm text-slate-500">Cargando los movimientos de {cuenta}…</p>}

      {analisis && grupos && n && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Resumen titulo="Período del extracto" valor={analisis.desde ? `${analisis.desde} → ${analisis.hasta}` : '—'} />
            <Resumen titulo="Nuevos" valor={String(n.nuevas)} sub={`${fmt(grupos.nuevas.reduce((a, l) => a + l.importe, 0))} USD`} tono={n.nuevas ? 'info' : undefined} />
            <Resumen titulo="Importe distinto en el sistema" valor={String(n.distintas)} tono={n.distintas ? 'aviso' : undefined} sub="Posibles errores de tecleo" />
            <Resumen titulo="Ya registrados" valor={String(n.registradas)} sub="Se ignoran" />
            <Resumen titulo="Filas con error" valor={String(n.errores)} tono={n.errores ? 'error' : undefined} />
          </section>

          <section className="tarjeta flex flex-wrap items-end gap-4 p-4">
            <div>
              <label className="etiqueta">Saldo según el banco</label>
              <input className="input !w-40" value={saldoBanco} onChange={(e) => setSaldoBanco(e.target.value)} placeholder="p. ej. 1894.59" />
            </div>
            <div>
              <label className="etiqueta">a la fecha</label>
              <input type="date" className="input" value={fechaSaldo} onChange={(e) => setFechaSaldo(e.target.value)} />
            </div>
            {conciliacion ? (
              <div className="text-sm">
                <div>
                  Sistema tras importar: <b className="tabular-nums">{fmt(conciliacion.sistema)}</b> · Banco: <b className="tabular-nums">{fmt(conciliacion.banco)}</b>
                </div>
                {Math.abs(conciliacion.diferencia) < 0.01 ? (
                  <div className="font-medium text-emerald-700">✓ Cuadra con el banco</div>
                ) : (
                  <div className="font-medium text-red-700">Diferencia: {fmt(conciliacion.diferencia)} USD</div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                {archivo?.tabla.saldoFinal ? '' : 'Este archivo no trae el saldo: escríbelo (lo ves en la banca online) para comprobar que todo cuadra.'}
              </p>
            )}
          </section>

          <div className="flex flex-wrap gap-1 border-b border-slate-200">
            {(
              [
                ['nuevas', `Nuevos (${n.nuevas})`],
                ['distintas', `Importe distinto (${n.distintas})`],
                ['registradas', `Ya registrados (${n.registradas})`],
                ['errores', `Con error (${n.errores})`],
              ] as [Vista, string][]
            ).map(([v, t]) => (
              <button key={v} onClick={() => setVista(v)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${vista === v ? 'border-marca-600 font-medium text-marca-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                {t}
              </button>
            ))}
          </div>

          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  {vista === 'nuevas' && <th className="w-8">Incl.</th>}
                  {vista === 'distintas' && <th className="w-8">Corregir</th>}
                  <th>Fecha</th>
                  <th>Concepto</th>
                  <th className="num">Importe banco</th>
                  {vista === 'distintas' && <th className="num">En el sistema</th>}
                  {vista === 'nuevas' && <th>Categoría</th>}
                  {vista === 'nuevas' && <th title="Crear una regla para que la próxima vez se categorice solo">Recordar</th>}
                  {vista === 'errores' && <th>Problema</th>}
                  <th>Referencia</th>
                </tr>
              </thead>
              <tbody>
                {grupos[vista].length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-500">
                      Nada en esta lista.
                    </td>
                  </tr>
                )}
                {grupos[vista].map((l) => {
                  const sug = analisis.sugerencias.get(l.n)
                  const ex = analisis.dif.get(l.n)
                  return (
                    <tr key={l.n} className={vista === 'nuevas' && excluir[l.n] ? 'opacity-40' : ''}>
                      {vista === 'nuevas' && (
                        <td>
                          <input type="checkbox" checked={!excluir[l.n]} onChange={(e) => setExcluir({ ...excluir, [l.n]: !e.target.checked })} />
                        </td>
                      )}
                      {vista === 'distintas' && (
                        <td>
                          <input type="checkbox" checked={seCorrige(l)} onChange={(e) => setCorregir({ ...corregir, [l.n]: e.target.checked })} />
                        </td>
                      )}
                      <td className="whitespace-nowrap">{l.fecha || '—'}</td>
                      <td className="max-w-md">
                        {l.concepto}
                        {l.extra.Detalle && <div className="text-xs text-slate-400">{String(l.extra.Detalle)}</div>}
                      </td>
                      <td className={`num ${l.importe < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                        {fmt(l.importe)} {l.moneda !== 'USD' && <span className="text-xs">{l.moneda}</span>}
                      </td>
                      {vista === 'distintas' && (
                        <td className="num">
                          {fmt(ex?.importe)}
                          <div className="text-[11px] text-slate-400">{ex?.porReferencia ? 'misma referencia' : 'solo mismo concepto: revisa'}</div>
                        </td>
                      )}
                      {vista === 'nuevas' && (
                        <td>
                          <select className="input !py-1 text-xs" value={categoriaDe(l)} onChange={(e) => setCats({ ...cats, [l.n]: e.target.value })}>
                            {categorias.map((g) => (
                              <optgroup key={g.grupo} label={g.grupo}>
                                {g.nombres.map((c) => (
                                  <option key={c}>{c}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          {sug && !cats[l.n] && <div className="text-[11px] text-slate-400">{sug.motivo}</div>}
                        </td>
                      )}
                      {vista === 'nuevas' && (
                        <td className="text-center">
                          <input
                            type="checkbox"
                            title={`Regla: «${claveConcepto(l.concepto)}» → ${categoriaDe(l)}`}
                            checked={Boolean(recordar[l.n])}
                            disabled={!claveConcepto(l.concepto) || categoriaDe(l) === 'Por clasificar'}
                            onChange={(e) => setRecordar({ ...recordar, [l.n]: e.target.checked })}
                          />
                        </td>
                      )}
                      {vista === 'errores' && <td className="text-red-700">{l.error}</td>}
                      <td className="whitespace-nowrap text-xs text-slate-500">{l.referencia}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primario" disabled={pendiente || (!aImportar.length && !grupos.distintas.some(seCorrige))} onClick={importar}>
              {pendiente ? 'Guardando…' : `Importar ${aImportar.length} nuevos y corregir ${grupos.distintas.filter(seCorrige).length} importes`}
            </button>
            <span className="text-xs text-slate-500">Los movimientos sin categoría entran como «Por clasificar» y se pueden clasificar después en Movimientos.</span>
          </div>
        </>
      )}
    </div>
  )
}

function Resumen({ titulo, valor, sub, tono }: { titulo: string; valor: string; sub?: string; tono?: 'info' | 'aviso' | 'error' }) {
  const c = tono === 'aviso' ? 'border-amber-300 bg-amber-50' : tono === 'error' ? 'border-red-300 bg-red-50' : tono === 'info' ? 'border-marca-500/40 bg-marca-50' : ''
  return (
    <div className={`tarjeta p-3 ${c}`}>
      <div className="text-xs text-slate-500">{titulo}</div>
      <div className="text-lg font-semibold text-slate-900 tabular-nums">{valor}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}
