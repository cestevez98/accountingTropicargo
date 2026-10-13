'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { importarAjustes, importarParte, vaciarDatos } from '@/app/acciones'
import type { ResultadoImportacion } from '@/lib/import-excel'
import { compararConExcel, type Comparacion } from '@/lib/paridad'
import { construirMayor } from '@/lib/ledger'
import type { Dataset } from '@/lib/types'

const ORDEN: (keyof Dataset)[] = ['categorias', 'cuentas', 'tasas', 'movimientos', 'facturas', 'facturasCompra', 'pagosProveedor', 'cxcManual', 'activos', 'paquetes', 'devengos', 'asientos']
const TROZO = 2500

const nf = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function Importador() {
  const router = useRouter()
  const [res, setRes] = useState<ResultadoImportacion | null>(null)
  const [paridad, setParidad] = useState<Comparacion[]>([])
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pendiente, start] = useTransition()
  const [hecho, setHecho] = useState(false)

  async function leerArchivo(file: File) {
    setError(null)
    setHecho(false)
    setLog([`Leyendo ${file.name}…`])
    try {
      const { leerLibro, importarLibro } = await import('@/lib/import-excel')
      const r = importarLibro(leerLibro(new Uint8Array(await file.arrayBuffer())))
      setRes(r)
      setParidad(compararConExcel(r.dataset, construirMayor(r.dataset), r.referencia))
      setLog([])
    } catch (e) {
      setError(`No se pudo leer el archivo: ${e instanceof Error ? e.message : e}`)
    }
  }

  function subir() {
    if (!res) return
    if (!confirm('La importación reemplaza TODOS los datos actuales por los del Excel. ¿Continuar?')) return
    start(async () => {
      const pasos: string[] = []
      for (const k of ORDEN) {
        const filas = res.dataset[k] as unknown[]
        for (let i = 0; i < Math.max(1, filas.length); i += TROZO) {
          const r = await importarParte(k, filas.slice(i, i + TROZO), i === 0)
          if (!r.ok) {
            setError(`Error importando ${k}: ${r.error}`)
            return
          }
        }
        pasos.push(`✓ ${k}: ${filas.length.toLocaleString('es-ES')}`)
        setLog([...pasos])
      }
      const r = await importarAjustes(res.dataset.settings, res.resumen.map((x) => `${x.coleccion}=${x.filas}`).join(', '))
      if (!r.ok) return setError(r.error)
      setHecho(true)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <input
        type="file"
        accept=".xlsx,.xlsm"
        className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-marca-600 file:px-3 file:py-1.5 file:text-white"
        onChange={(e) => e.target.files?.[0] && leerArchivo(e.target.files[0])}
      />
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {log.length > 0 && <pre className="rounded-md bg-slate-900 p-3 text-xs text-slate-100">{log.join('\n')}</pre>}
      {res && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Tabla</th>
                  <th className="num">Filas</th>
                </tr>
              </thead>
              <tbody>
                {res.resumen.map((r) => (
                  <tr key={r.coleccion}>
                    <td>{r.coleccion}</td>
                    <td className="num">{r.filas.toLocaleString('es-ES')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
              {res.notas.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-900">Comparación con los totales del Excel (desde agosto)</h3>
            {paridad.length === 0 ? (
              <p className="text-sm text-emerald-700">Todos los totales comparables coinciden con el Excel.</p>
            ) : (
              <>
                <p className="mb-2 text-sm text-slate-600">
                  Diferencias encontradas ({paridad.length}). Son esperables donde el sistema corrige el Excel: facturas de proveedor que el Excel no llevaba al
                  ER, celdas con #VALUE! (CUP sin tasa) y Square, que el Excel no sumaba.
                </p>
                <div className="max-h-72 overflow-auto rounded border border-slate-200">
                  <table className="tabla">
                    <thead>
                      <tr>
                        <th>Informe</th>
                        <th>Fila</th>
                        <th>Mes</th>
                        <th className="num">Sistema</th>
                        <th className="num">Excel</th>
                        <th className="num">Diferencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paridad.map((c, i) => (
                        <tr key={i}>
                          <td>{c.informe}</td>
                          <td>{c.fila}</td>
                          <td>{c.mes}</td>
                          <td className="num">{nf.format(c.sistema)}</td>
                          <td className="num">{nf.format(c.excel)}</td>
                          <td className="num font-medium">{nf.format(c.diferencia)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
          {!hecho ? (
            <button className="btn btn-primario" disabled={pendiente} onClick={subir}>
              {pendiente ? 'Importando…' : 'Importar y reemplazar los datos actuales'}
            </button>
          ) : (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Importación terminada. Revisa el Panel y los informes.</p>
          )}
        </>
      )}
    </div>
  )
}

export function Vaciar() {
  const router = useRouter()
  const [txt, setTxt] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [pendiente, start] = useTransition()
  return (
    <div className="space-y-2">
      <label className="etiqueta">Escribe VACIAR para confirmar</label>
      <input value={txt} onChange={(e) => setTxt(e.target.value)} className="input" />
      <button
        className="btn btn-peligro"
        disabled={txt !== 'VACIAR' || pendiente}
        onClick={() =>
          start(async () => {
            const r = await vaciarDatos(txt)
            setMsg({ ok: r.ok, t: r.ok ? (r.mensaje ?? '') : r.error })
            if (r.ok) {
              setTxt('')
              router.refresh()
            }
          })
        }
      >
        {pendiente ? 'Borrando…' : 'Vaciar datos'}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.t}</p>}
    </div>
  )
}
