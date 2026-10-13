'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { confirmarSyncTP, prepararSyncTP, type SyncTP } from '@/app/acciones'

const nf = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = (n: number | undefined) => (n == null || !Number.isFinite(n) ? '—' : nf.format(n))

type Vista = 'nuevas' | 'cambios' | 'sistema'

const hoy = () => new Date().toISOString().slice(0, 10)
const inicioMes = () => `${hoy().slice(0, 8)}01`
const ETIQUETA = { monto: 'Monto', cobrado: 'Cobrado', estatusSistema: 'Estatus' } as const

export function SincronizarTP() {
  const router = useRouter()
  const [rango, setRango] = useState({ desde: inicioMes(), hasta: hoy() })
  const [sync, setSync] = useState<SyncTP | null>(null)
  const [vista, setVista] = useState<Vista>('nuevas')
  const [borrar, setBorrar] = useState<Record<string, boolean>>({})
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [consultando, startConsulta] = useTransition()
  const [guardando, startGuardar] = useTransition()

  function consultar() {
    setMsg(null)
    setSync(null)
    setBorrar({})
    startConsulta(async () => {
      const r = await prepararSyncTP(rango.desde, rango.hasta)
      if (!r.ok) return setMsg({ ok: false, t: r.error })
      setSync(r.sync)
      setVista(r.sync.nuevas.length ? 'nuevas' : r.sync.cambios.length ? 'cambios' : 'sistema')
    })
  }

  const aBorrar = useMemo(() => (sync ? sync.soloSistema.filter((f) => borrar[f.id]).map((f) => f.id) : []), [sync, borrar])

  function confirmar() {
    if (!sync) return
    if (!confirm(`¿Guardar ${sync.nuevas.length} facturas nuevas y ${sync.cambios.length} actualizaciones${aBorrar.length ? ` y borrar ${aBorrar.length}` : ''}?`)) return
    startGuardar(async () => {
      const r = await confirmarSyncTP(sync.nuevas, sync.cambios, aBorrar)
      setMsg({ ok: r.ok, t: r.ok ? (r.mensaje ?? 'Guardado.') : r.error })
      if (r.ok) {
        setSync(null)
        router.refresh()
      }
    })
  }

  const n = sync && { nuevas: sync.nuevas.length, cambios: sync.cambios.length, sistema: sync.soloSistema.length }

  return (
    <div className="space-y-4">
      <section className="tarjeta flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="etiqueta">Desde</label>
          <input type="date" className="input" value={rango.desde} onChange={(e) => setRango({ ...rango, desde: e.target.value })} />
        </div>
        <div>
          <label className="etiqueta">Hasta</label>
          <input type="date" className="input" value={rango.hasta} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} />
        </div>
        <button className="btn btn-primario" disabled={consultando} onClick={consultar}>
          {consultando ? 'Consultando Tracking Premium…' : 'Traer de Tracking Premium'}
        </button>
        <span className="text-xs text-slate-500">Puede tardar un minuto si hay muchas facturas nuevas.</span>
      </section>

      {msg && <p className={`rounded-md px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.t}</p>}

      {sync && n && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Resumen titulo="En Tracking Premium" valor={sync.totales.facturas.toLocaleString('es-ES')} sub={`${fmt(sync.totales.monto)} USD · cobrado ${fmt(sync.totales.cobrado)}`} />
            <Resumen titulo="Nuevas" valor={String(n.nuevas)} sub={`${fmt(sync.nuevas.reduce((a, f) => a + f.monto, 0))} USD`} tono={n.nuevas ? 'info' : undefined} />
            <Resumen titulo="Con cambios" valor={String(n.cambios)} sub="Cobros, estatus o montos" tono={n.cambios ? 'aviso' : undefined} />
            <Resumen titulo="Iguales" valor={String(sync.iguales)} sub="Se dejan como están" />
            <Resumen titulo="Solo en la contabilidad" valor={String(n.sistema)} sub="Anuladas o borradas en Tracking Premium" tono={n.sistema ? 'aviso' : undefined} />
          </section>

          <div className="flex flex-wrap gap-1 border-b border-slate-200">
            {(
              [
                ['nuevas', `Nuevas (${n.nuevas})`],
                ['cambios', `Con cambios (${n.cambios})`],
                ['sistema', `Solo en la contabilidad (${n.sistema})`],
              ] as [Vista, string][]
            ).map(([v, t]) => (
              <button key={v} onClick={() => setVista(v)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${vista === v ? 'border-marca-600 font-medium text-marca-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                {t}
              </button>
            ))}
          </div>

          <div className="tarjeta overflow-x-auto">
            {vista === 'nuevas' && (
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Nº factura</th>
                    <th>Cliente</th>
                    <th>Emisión</th>
                    <th className="num">Monto</th>
                    <th className="num">Cobrado</th>
                    <th>Servicio</th>
                    <th>Envío</th>
                    <th>Guías / detalle</th>
                    <th>Estatus</th>
                  </tr>
                </thead>
                <tbody>
                  {!n.nuevas && <Vacio />}
                  {sync.nuevas.map((f) => (
                    <tr key={f.numero} className={f.afectaER ? '' : 'text-slate-400'}>
                      <td className="whitespace-nowrap">{f.numero}</td>
                      <td>{f.cliente}</td>
                      <td className="whitespace-nowrap">{f.emision}</td>
                      <td className="num">{fmt(f.monto)}</td>
                      <td className="num">{fmt(f.cobrado)}</td>
                      <td className="text-xs">{f.servicio}</td>
                      <td className="text-xs">{[f.tipoEnvio, f.subtipo].filter(Boolean).join(' · ')}</td>
                      <td className="max-w-xs text-xs">{f.detalle}</td>
                      <td className="text-xs">{f.estatusSistema}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {vista === 'cambios' && (
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Nº factura</th>
                    <th>Cliente</th>
                    <th>Cambio</th>
                  </tr>
                </thead>
                <tbody>
                  {!n.cambios && <Vacio />}
                  {sync.cambios.map((c) => (
                    <tr key={c.numero}>
                      <td className="whitespace-nowrap">{c.numero}</td>
                      <td>{c.cliente}</td>
                      <td className="text-xs">
                        {c.campos.map((x) => (
                          <div key={x.campo}>
                            {ETIQUETA[x.campo]}: <span className="text-slate-400 line-through">{typeof x.antes === 'number' ? fmt(x.antes) : (x.antes ?? '—')}</span> →{' '}
                            <b>{typeof x.despues === 'number' ? fmt(x.despues) : (x.despues ?? '—')}</b>
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {vista === 'sistema' && (
              <>
                <p className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
                  Facturas que la contabilidad tiene en este período y Tracking Premium no devuelve (anuladas o borradas allí). Marca las que quieras borrar; las demás se quedan.
                </p>
                <table className="tabla">
                  <thead>
                    <tr>
                      <th className="w-8">Borrar</th>
                      <th>Nº factura</th>
                      <th>Cliente</th>
                      <th>Emisión</th>
                      <th className="num">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!n.sistema && <Vacio />}
                    {sync.soloSistema.map((f) => (
                      <tr key={f.id} className={borrar[f.id] ? 'bg-red-50 line-through' : ''}>
                        <td>
                          <input type="checkbox" checked={Boolean(borrar[f.id])} onChange={(e) => setBorrar({ ...borrar, [f.id]: e.target.checked })} />
                        </td>
                        <td>{f.numero}</td>
                        <td>{f.cliente}</td>
                        <td>{f.emision}</td>
                        <td className="num">{fmt(f.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primario" disabled={guardando || (!n.nuevas && !n.cambios && !aBorrar.length)} onClick={confirmar}>
              {guardando ? 'Guardando…' : `Guardar ${n.nuevas} nuevas y ${n.cambios} cambios${aBorrar.length ? ` · borrar ${aBorrar.length}` : ''}`}
            </button>
            <span className="text-xs text-slate-500">Las facturas a nombre de Tropicargo Express entran sin afectar el Estado de Resultados.</span>
          </div>
        </>
      )}
    </div>
  )
}

function Vacio() {
  return (
    <tr>
      <td colSpan={9} className="py-6 text-center text-slate-500">
        Nada en esta lista.
      </td>
    </tr>
  )
}

function Resumen({ titulo, valor, sub, tono }: { titulo: string; valor: string; sub?: string; tono?: 'info' | 'aviso' }) {
  const c = tono === 'aviso' ? 'border-amber-300 bg-amber-50' : tono === 'info' ? 'border-marca-500/40 bg-marca-50' : ''
  return (
    <div className={`tarjeta p-3 ${c}`}>
      <div className="text-xs text-slate-500">{titulo}</div>
      <div className="text-lg font-semibold text-slate-900 tabular-nums">{valor}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}
