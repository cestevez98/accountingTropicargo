import Link from 'next/link'
import { finDeMes } from '@/lib/fecha'
import type { Fila, Informe } from '@/lib/reports'
import { Importe } from './ui'

function hrefDetalle(f: Fila, desde: string, hasta: string) {
  if (!f.detalle) return null
  const p = new URLSearchParams()
  if (f.detalle.cuenta) p.set('cuenta', f.detalle.cuenta)
  if (f.detalle.categoria) p.set('categoria', f.detalle.categoria)
  if (f.detalle.fuente) p.set('fuente', f.detalle.fuente)
  p.set('desde', desde)
  p.set('hasta', hasta)
  return `/mayor?${p}`
}

export function InformeTabla({ informe, saldos = false }: { informe: Informe; saldos?: boolean }) {
  const { meses, columnas, filas, conTotal } = informe
  if (!meses.length) return <div className="tarjeta p-6 text-sm text-slate-500">No hay meses con datos para este año.</div>
  const primerDia = `${meses[0]}-01`
  return (
    <div className="tarjeta overflow-x-auto">
      <table className="tabla min-w-max">
        <thead>
          <tr>
            <th className="min-w-72">Concepto</th>
            {columnas.map((c) => (
              <th key={c} className="num">
                {c}
              </th>
            ))}
            {conTotal && <th className="num">Total</th>}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            if (f.tipo === 'titulo')
              return (
                <tr key={f.key}>
                  <td colSpan={meses.length + 2} className="!bg-slate-50 pt-4 text-xs font-semibold tracking-wide text-marca-700 uppercase">
                    {f.label}
                  </td>
                </tr>
              )
            const estilo =
              f.tipo === 'total'
                ? 'font-semibold text-slate-900 bg-marca-50/70'
                : f.tipo === 'subtotal'
                  ? 'font-medium text-slate-800 bg-slate-50'
                  : f.tipo === 'control'
                    ? 'text-slate-500 text-xs'
                    : f.tipo === 'pct'
                      ? 'text-slate-500 italic'
                      : ''
            const esCuadre = f.tipo === 'control' && /debe ser 0/.test(f.label)
            return (
              <tr key={f.key} className={estilo}>
                <td className={f.tipo === 'dato' ? 'pl-6' : ''}>
                  {f.label}
                  {f.nota && <span className="ml-1 text-xs text-slate-400">({f.nota})</span>}
                </td>
                {f.valores.map((v, i) => {
                  const contenido =
                    f.tipo === 'pct' ? (
                      <span>{(v * 100).toFixed(1)}%</span>
                    ) : esCuadre && Math.abs(v) > 0.01 ? (
                      <span className="rounded bg-red-100 px-1 font-semibold text-red-700">
                        <Importe v={v} />
                      </span>
                    ) : (
                      <Importe v={v} colorear={f.tipo !== 'dato' || saldos} />
                    )
                  const href = hrefDetalle(f, saldos ? '2000-01-01' : `${meses[i]}-01`, finDeMes(meses[i]))
                  return (
                    <td key={i} className="num">
                      {href && Math.abs(v) > 0.005 ? (
                        <Link href={href} className="hover:text-marca-600 hover:underline">
                          {contenido}
                        </Link>
                      ) : (
                        contenido
                      )}
                    </td>
                  )
                })}
                {conTotal && (
                  <td className="num font-medium">
                    {f.total == null ? (
                      ''
                    ) : f.tipo === 'pct' ? (
                      `${(f.total * 100).toFixed(1)}%`
                    ) : hrefDetalle(f, primerDia, finDeMes(meses.at(-1)!)) && Math.abs(f.total) > 0.005 && !saldos ? (
                      <Link href={hrefDetalle(f, primerDia, finDeMes(meses.at(-1)!))!} className="hover:text-marca-600 hover:underline">
                        <Importe v={f.total} colorear={f.tipo !== 'dato'} />
                      </Link>
                    ) : (
                      <Importe v={f.total} colorear={f.tipo !== 'dato'} />
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
