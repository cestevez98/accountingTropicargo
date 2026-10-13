'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { cerrarMes, guardarApertura } from '@/app/acciones'
import type { Settings } from '@/lib/types'

export function FormApertura({ settings, editable }: { settings: Settings; editable: boolean }) {
  const router = useRouter()
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [pendiente, start] = useTransition()
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        start(async () => {
          const r = await guardarApertura({
            empresa: String(fd.get('empresa')),
            fechaInicio: String(fd.get('fechaInicio')),
            capitalApertura: Number(fd.get('capitalApertura')),
            cxcSistemaApertura: Number(fd.get('cxcSistemaApertura')),
          })
          setMsg({ ok: r.ok, t: r.ok ? (r.mensaje ?? '') : r.error })
          if (r.ok) router.refresh()
        })
      }}
    >
      <fieldset disabled={!editable} className="contents">
        <div className="sm:col-span-2">
          <label className="etiqueta">Empresa</label>
          <input name="empresa" defaultValue={settings.empresa} className="input" />
        </div>
        <div>
          <label className="etiqueta">Fecha de inicio de la contabilidad</label>
          <input type="date" name="fechaInicio" defaultValue={settings.fechaInicio} className="input" required />
          <p className="mt-1 text-xs text-slate-400">Primer día de un mes.</p>
        </div>
        <div>
          <label className="etiqueta">Capital de apertura (USD)</label>
          <input type="number" step="0.01" name="capitalApertura" defaultValue={settings.capitalApertura} className="input" required />
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta">CxC de clientes al cierre anterior (USD)</label>
          <input type="number" step="0.01" name="cxcSistemaApertura" defaultValue={settings.cxcSistemaApertura} className="input" required />
          <p className="mt-1 text-xs text-slate-400">
            Lo que los clientes debían el día anterior al inicio por facturas del sistema. Los cobros posteriores («Cobro cliente») lo van bajando.
          </p>
        </div>
        {editable && (
          <div className="flex items-center gap-3 sm:col-span-2">
            <button className="btn btn-primario" disabled={pendiente}>
              {pendiente ? 'Guardando…' : 'Guardar'}
            </button>
            {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.t}</span>}
          </div>
        )}
      </fieldset>
    </form>
  )
}

export function BotonCierre({ mes, etiqueta, cerrado, editable }: { mes: string; etiqueta: string; cerrado: boolean; editable: boolean }) {
  const router = useRouter()
  const [pendiente, start] = useTransition()
  return (
    <button
      disabled={!editable || pendiente}
      title={cerrado ? 'Cerrado: haz clic para reabrir' : 'Abierto: haz clic para cerrar'}
      onClick={() =>
        start(async () => {
          if (!confirm(cerrado ? `¿Reabrir ${etiqueta}?` : `¿Cerrar ${etiqueta}? Solo el administrador podrá modificarlo después.`)) return
          const r = await cerrarMes(mes, !cerrado)
          if (!r.ok) alert(r.error)
          router.refresh()
        })
      }
      className={`rounded-md border px-3 py-1.5 text-sm ${cerrado ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'} disabled:opacity-60`}
    >
      {cerrado ? '🔒 ' : ''}
      {etiqueta}
    </button>
  )
}
