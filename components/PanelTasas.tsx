'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { actualizarTasaHoy, guardarEurCaja, guardarMargen, rellenarTasas } from '@/app/acciones'

export function PanelTasas({
  token,
  margen,
  eurCaja,
  ultima,
  hoy,
  vigente,
  fechaInicio,
  esAdmin,
  puedeActualizar,
}: {
  token: boolean
  margen: number
  eurCaja: number
  ultima?: { ts: string; ok: boolean; detalle: string }
  hoy: string
  vigente?: { fecha: string; cupPorUsd: number; mercadoUsd?: number; fuente?: string }
  fechaInicio: string
  esAdmin: boolean
  puedeActualizar: boolean
}) {
  const router = useRouter()
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [pendiente, start] = useTransition()
  const [m, setM] = useState(String(margen))
  const [desde, setDesde] = useState(fechaInicio)
  const [eur, setEur] = useState(String(eurCaja))

  const correr = (f: () => Promise<{ ok: true; mensaje?: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await f()
      setMsg({ ok: r.ok, t: r.ok ? (r.mensaje ?? 'Hecho.') : r.error })
      if (r.ok) router.refresh()
    })

  return (
    <section className="tarjeta mb-4 grid gap-4 p-4 lg:grid-cols-3">
      <div>
        <div className="text-xs font-medium text-slate-500">Tasa vigente hoy ({hoy})</div>
        {vigente ? (
          <div className="mt-1">
            <span className="text-2xl font-semibold text-slate-900 tabular-nums">{vigente.cupPorUsd}</span> <span className="text-sm text-slate-500">CUP por USD</span>
            <div className="text-xs text-slate-500">
              {vigente.fuente === 'eltoque' && vigente.mercadoUsd ? `elTOQUE ${vigente.mercadoUsd} + ${margen}` : `Cargada a mano`} · desde {vigente.fecha}
            </div>
          </div>
        ) : (
          <div className="mt-1 text-sm text-slate-500">No hay tasas.</div>
        )}
        <div className={`mt-3 rounded-md px-3 py-2 text-xs ${token ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
          {token ? (
            <>Actualización automática activa: cada día a las 9:05 (hora de Cuba) se guarda la tasa de elTOQUE + margen.</>
          ) : (
            <>
              Falta el token de la API de elTOQUE (variable <code>ELTOQUE_TOKEN</code> en Vercel). Se pide gratis en{' '}
              <a className="underline" href="https://tasas-token.eltoque.com/" target="_blank" rel="noreferrer">
                tasas-token.eltoque.com
              </a>
              .
            </>
          )}
        </div>
        {ultima && (
          <p className={`mt-2 text-xs ${ultima.ok ? 'text-slate-500' : 'text-red-700'}`}>
            Última actualización {ultima.ts.replace('T', ' ').slice(0, 16)} UTC: {ultima.detalle}
          </p>
        )}
      </div>

      <div>
        <label className="etiqueta">Margen sobre elTOQUE (CUP por USD)</label>
        <div className="flex gap-2">
          <input type="number" step="1" value={m} onChange={(e) => setM(e.target.value)} disabled={!esAdmin} className="input !w-28" />
          {esAdmin && (
            <button className="btn" disabled={pendiente || Number(m) === margen} onClick={() => correr(() => guardarMargen(Number(m)))}>
              Guardar margen
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-400">Tasa de la empresa = tasa de elTOQUE + margen. Al cambiarlo se recalculan las tasas automáticas ya guardadas.</p>
        <label className="etiqueta mt-3">Euro en las cajas (USD por 1 EUR)</label>
        <div className="flex gap-2">
          <input type="number" step="0.01" value={eur} onChange={(e) => setEur(e.target.value)} disabled={!esAdmin} className="input !w-28" />
          {esAdmin && (
            <button className="btn" disabled={pendiente || Number(eur) === eurCaja} onClick={() => correr(() => guardarEurCaja(Number(eur)))}>
              Guardar
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          En la oficina el euro se toma 1×1 con el dólar. Al cambiarlo, la diferencia con lo que se recibe queda como ingreso financiero («Cambio de divisas»). En
          los bancos el EUR se convierte a la tasa de mercado.
        </p>
        {puedeActualizar && (
          <button className="btn btn-primario mt-3" disabled={pendiente || !token} onClick={() => correr(actualizarTasaHoy)}>
            {pendiente ? 'Consultando…' : 'Traer la tasa de hoy ahora'}
          </button>
        )}
      </div>

      {esAdmin && (
        <div>
          <label className="etiqueta">Rellenar con elTOQUE desde</label>
          <div className="flex gap-2">
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="input !w-44" />
            <button
              className="btn"
              disabled={pendiente || !token}
              onClick={() => {
                if (confirm(`Se traerá la tasa de elTOQUE de cada día desde ${desde} y reemplazará las tasas importadas del Excel (no las cargadas a mano). Los importes en CUP de esos días cambiarán. ¿Continuar?`))
                  correr(() => rellenarTasas(desde))
              }}
            >
              Rellenar
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">Útil una sola vez para sustituir las tasas fijas del Excel por las diarias de elTOQUE.</p>
        </div>
      )}
      {msg && <p className={`text-sm lg:col-span-3 ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.t}</p>}
    </section>
  )
}
