'use client'

import { useActionState, useEffect, useState } from 'react'
import { accionArqueo, type Resultado } from '../../acciones'
import { DENOMINACIONES, totalArqueo } from '@/lib/conteo'
import type { Moneda } from '@/lib/types'

const f2 = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Arqueo por denominaciones: total en vivo; al guardar se abre el comprobante. */
export function FormArqueo({ tiendas, tienda }: { tiendas: { id: string; nombre: string }[]; tienda?: string }) {
  const [valores, setValores] = useState<Record<string, string>>({})
  const [estado, enviar, enviando] = useActionState<(Resultado & { id?: string }) | null, FormData>(accionArqueo, null)
  useEffect(() => {
    if (estado?.ok && estado.id) window.location.href = `/imprimir/arqueo?id=${estado.id}`
  }, [estado])
  const num = (k: string) => Number((valores[k] ?? '').replace(',', '.')) || 0
  const detalle = (Object.entries(DENOMINACIONES) as [Moneda, number[]][]).flatMap(([m, vs]) => vs.map((v) => ({ moneda: m, valor: v, cantidad: num(`${m}_${v}`) })))
  const otros = Object.fromEntries(Object.keys(DENOMINACIONES).map((m) => [m, num(`${m}_otros`)])) as Partial<Record<Moneda, number>>
  const total = totalArqueo(detalle, otros)
  const campo = (k: string) => ({ name: k, value: valores[k] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValores((v) => ({ ...v, [k]: e.target.value })) })
  return (
    <form
      action={enviar}
      onSubmit={(e) => {
        if (!confirm('¿Guardar el arqueo? Se genera el comprobante numerado.')) e.preventDefault()
      }}
      className="mx-auto max-w-3xl"
    >
      <div className="tarjeta mb-3 grid gap-3 p-4 sm:grid-cols-3">
        <label>
          <span className="etiqueta">Tienda</span>
          <select name="tienda" defaultValue={tienda} className="input">
            {tiendas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="etiqueta">Cajero/a</span>
          <input name="cajero" className="input" placeholder="Quién entrega la caja" />
        </label>
        <label>
          <span className="etiqueta">Nota</span>
          <input name="nota" className="input" />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {(Object.entries(DENOMINACIONES) as [Moneda, number[]][]).map(([m, vs]) => (
          <div key={m} className="tarjeta p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-semibold">{m}</h2>
              <span className="text-sm font-semibold">{f2(total[m] ?? 0)}</span>
            </div>
            {vs.map((v) => (
              <label key={v} className="mb-1 flex items-center gap-2 text-sm">
                <span className="w-14 text-right">{v} ×</span>
                <input {...campo(`${m}_${v}`)} inputMode="numeric" className="input w-20 text-center" placeholder="0" />
                <span className="flex-1 text-right text-xs text-muted-foreground">{num(`${m}_${v}`) ? f2(num(`${m}_${v}`) * v) : ''}</span>
              </label>
            ))}
            <label className="mt-2 flex items-center gap-2 text-sm">
              <span className="w-14 text-right">Sueltos</span>
              <input {...campo(`${m}_otros`)} inputMode="decimal" className="input w-28 text-center" placeholder="0,00" />
            </label>
          </div>
        ))}
      </div>
      <div className="tarjeta mt-3 flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="text-sm">
          Total contado:{' '}
          {Object.entries(total)
            .map(([m, v]) => `${f2(v)} ${m}`)
            .join(' · ') || '—'}
        </div>
        <button className="btn btn-exito" disabled={enviando}>
          {enviando ? 'Guardando y leyendo el TPV…' : 'Guardar arqueo y ver comprobante'}
        </button>
      </div>
      {estado && !estado.ok && (
        <p role="status" className="mt-2 text-sm text-danger">
          {estado.error}
        </p>
      )}
    </form>
  )
}
