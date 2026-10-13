'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { importarCobrosTP, prepararCobrosTP, type ConciliacionCobrosTP } from '@/app/acciones'

const nf = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = (n: number) => nf.format(n)
const hoy = () => new Date().toISOString().slice(0, 10)

type Vista = 'solo_tp' | 'difiere' | 'solo_caja' | 'cuadra' | 'otros'
const TITULO: Record<Vista, string> = {
  solo_tp: 'Faltan en la caja',
  difiere: 'Importe distinto',
  solo_caja: 'Solo en la caja',
  cuadra: 'Cuadran',
  otros: 'Otros canales',
}

export function ConciliarCobros({ cajas }: { cajas: string[] }) {
  const router = useRouter()
  const [caja, setCaja] = useState(cajas[0])
  const [rango, setRango] = useState({ desde: `${hoy().slice(0, 8)}01`, hasta: hoy() })
  const [datos, setDatos] = useState<ConciliacionCobrosTP | null>(null)
  const [vista, setVista] = useState<Vista>('solo_tp')
  const [marcados, setMarcados] = useState<Record<number, boolean>>({})
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [consultando, startConsulta] = useTransition()
  const [guardando, startGuardar] = useTransition()

  function consultar() {
    setMsg(null)
    setDatos(null)
    setMarcados({})
    startConsulta(async () => {
      const r = await prepararCobrosTP(caja, rango.desde, rango.hasta)
      if (!r.ok) return setMsg({ ok: false, t: r.error })
      setDatos(r.datos)
      setVista('solo_tp')
    })
  }

  const por = useMemo(() => {
    const m: Record<string, ConciliacionCobrosTP['grupos']> = { solo_tp: [], difiere: [], solo_caja: [], cuadra: [] }
    datos?.grupos.forEach((g) => m[g.estado].push(g))
    return m
  }, [datos])
  const pagosMarcados = useMemo(() => por.solo_tp.flatMap((g) => g.pagos).filter((p) => marcados[p.id]), [por, marcados])
  const suma = (gs: ConciliacionCobrosTP['grupos'], f: (g: ConciliacionCobrosTP['grupos'][number]) => number) => gs.reduce((a, g) => a + f(g), 0)

  function importar() {
    if (!pagosMarcados.length || !confirm(`¿Registrar ${pagosMarcados.length} cobros en ${caja}?`)) return
    startGuardar(async () => {
      const r = await importarCobrosTP(caja, pagosMarcados)
      setMsg({ ok: r.ok, t: r.ok ? (r.mensaje ?? 'Guardado.') : r.error })
      if (r.ok) {
        router.refresh()
        consultar()
      }
    })
  }

  const filas = vista === 'otros' ? [] : por[vista]
  return (
    <div className="space-y-4">
      <section className="tarjeta flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="etiqueta">Caja</label>
          <select className="input" value={caja} onChange={(e) => setCaja(e.target.value)}>
            {cajas.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiqueta">Desde</label>
          <input type="date" className="input" value={rango.desde} onChange={(e) => setRango({ ...rango, desde: e.target.value })} />
        </div>
        <div>
          <label className="etiqueta">Hasta</label>
          <input type="date" className="input" value={rango.hasta} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} />
        </div>
        <button className="btn btn-primario" disabled={consultando} onClick={consultar}>
          {consultando ? 'Consultando Tracking Premium…' : 'Comparar'}
        </button>
      </section>

      {msg && <p className={`rounded-md px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.t}</p>}

      {datos && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Resumen titulo="Pagos en Tracking Premium" valor={fmt(suma(datos.grupos, (g) => g.totalTP))} sub={`Registrado en ${datos.caja}: ${fmt(suma(datos.grupos, (g) => g.totalCaja))}`} />
            <Resumen titulo="Cuadran" valor={String(por.cuadra.length)} sub="grupos de factura" />
            <Resumen titulo="Faltan en la caja" valor={String(por.solo_tp.length)} sub={`${fmt(suma(por.solo_tp, (g) => g.totalTP))} USD`} tono={por.solo_tp.length ? 'aviso' : undefined} />
            <Resumen titulo="Importe distinto" valor={String(por.difiere.length)} sub={`caja − TP: ${fmt(suma(por.difiere, (g) => g.totalCaja - g.totalTP))} USD`} tono={por.difiere.length ? 'aviso' : undefined} />
            <Resumen titulo="Solo en la caja" valor={String(por.solo_caja.length)} sub={`${fmt(suma(por.solo_caja, (g) => g.totalCaja))} USD sin pago en TP`} tono={por.solo_caja.length ? 'aviso' : undefined} />
          </section>

          <div className="flex flex-wrap gap-1 border-b border-slate-200">
            {(Object.keys(TITULO) as Vista[]).map((v) => (
              <button key={v} onClick={() => setVista(v)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${vista === v ? 'border-marca-600 font-medium text-marca-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                {TITULO[v]} ({v === 'otros' ? datos.otros.length : por[v].length})
              </button>
            ))}
          </div>

          <div className="tarjeta overflow-x-auto">
            {vista === 'otros' ? (
              <>
                <p className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
                  Pagos del período que no entran en una caja física. Los de Square, PayPal y bancos llegan con los extractos (como depósitos o líneas del extracto); los de wallet usan saldo que el cliente ya había pagado (la recarga es la que entra en la caja, y no se compara aquí).
                </p>
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Tipo de pago</th>
                      <th>Cuenta en Tracking Premium</th>
                      <th className="num">Pagos</th>
                      <th className="num">Monto USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.otros.map((o) => (
                      <tr key={`${o.tipo}|${o.cuentaTP}`}>
                        <td>{o.tipo}</td>
                        <td>{o.cuentaTP}</td>
                        <td className="num">{o.n}</td>
                        <td className="num">{fmt(o.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <table className="tabla">
                <thead>
                  <tr>
                    {vista === 'solo_tp' && (
                      <th className="w-8">
                        <input
                          type="checkbox"
                          checked={por.solo_tp.length > 0 && pagosMarcados.length === por.solo_tp.flatMap((g) => g.pagos).length}
                          onChange={(e) => setMarcados(Object.fromEntries(por.solo_tp.flatMap((g) => g.pagos).map((p) => [p.id, e.target.checked])))}
                        />
                      </th>
                    )}
                    <th>Fecha</th>
                    <th>En Tracking Premium</th>
                    <th>En la caja</th>
                    <th className="num">TP</th>
                    <th className="num">Caja</th>
                    <th className="num">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {!filas.length && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500">
                        Nada en esta lista.
                      </td>
                    </tr>
                  )}
                  {filas.map((g, i) => (
                    <tr key={i}>
                      {vista === 'solo_tp' && (
                        <td>
                          <input
                            type="checkbox"
                            checked={g.pagos.every((p) => marcados[p.id])}
                            onChange={(e) => setMarcados({ ...marcados, ...Object.fromEntries(g.pagos.map((p) => [p.id, e.target.checked])) })}
                          />
                        </td>
                      )}
                      <td className="whitespace-nowrap">{g.fecha}</td>
                      <td className="text-xs">
                        {g.pagos.map((p) => (
                          <div key={p.id}>
                            {p.numero} · {p.refs.join(', ')} · {p.cliente} · {p.tipo} <span className="text-slate-400">{fmt(p.monto)}</span>
                          </div>
                        ))}
                      </td>
                      <td className="text-xs">
                        {g.cobros.map((c) => (
                          <div key={c.id}>
                            {c.fecha} · {c.concepto} <span className="text-slate-400">{fmt(c.usd)}</span>
                          </div>
                        ))}
                      </td>
                      <td className="num">{fmt(g.totalTP)}</td>
                      <td className="num">{fmt(g.totalCaja)}</td>
                      <td className={`num ${Math.abs(g.totalCaja - g.totalTP) > 1 ? 'text-red-600' : ''}`}>{fmt(g.totalCaja - g.totalTP)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {vista === 'solo_tp' && (
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn btn-primario" disabled={guardando || !pagosMarcados.length} onClick={importar}>
                {guardando ? 'Guardando…' : `Registrar ${pagosMarcados.length} cobros en ${caja}`}
              </button>
              <span className="text-xs text-slate-500">Entran como «Cobro cliente» con la fecha del pago en Tracking Premium; bajan la cuenta por cobrar.</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Resumen({ titulo, valor, sub, tono }: { titulo: string; valor: string; sub?: string; tono?: 'aviso' }) {
  return (
    <div className={`tarjeta p-3 ${tono === 'aviso' ? 'border-amber-300 bg-amber-50' : ''}`}>
      <div className="text-xs text-slate-500">{titulo}</div>
      <div className="text-lg font-semibold text-slate-900 tabular-nums">{valor}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}
