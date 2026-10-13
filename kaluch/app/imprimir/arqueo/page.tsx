import { notFound } from 'next/navigation'
import { requerirUsuario, tiendaFija } from '@/lib/auth'
import { cargarDataset } from '@/lib/data'
import { params, type SP } from '@/lib/pagina'
import type { Moneda } from '@/lib/types'
import { Imprimir } from '../Imprimir'

const f2 = (n: number | undefined) => (n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Comprobante de arqueo de caja (imprimible / PDF). */
export default async function ComprobanteArqueo({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('arqueo')
  const sp = await params(searchParams)
  const ds = await cargarDataset()
  const a = ds.arqueos.find((x) => x.id === sp.id)
  const fija = tiendaFija(s)
  if (!a || (fija && a.tienda !== fija)) notFound()
  const tienda = ds.tiendas.find((t) => t.id === a.tienda)?.nombre ?? a.tienda
  const monedas = [...new Set([...Object.keys(a.contado), ...Object.keys(a.esperado)])].filter((m) => a.contado[m as Moneda] || a.esperado[m as Moneda]) as Moneda[]
  const hora = new Date(a.ts).toLocaleString('es-ES', { timeZone: 'America/Havana', dateStyle: 'short', timeStyle: 'short' })
  return (
    <div className="mx-auto max-w-2xl bg-white p-6 text-black">
      <Imprimir />
      <div className="flex items-start justify-between border-b-2 border-black pb-2">
        <div>
          <h1 className="text-xl font-bold">{ds.settings.empresa}</h1>
          <div className="text-sm">Comprobante de arqueo de caja</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">No. {String(a.numero).padStart(6, '0')}</div>
          <div className="text-sm">{hora}</div>
        </div>
      </div>
      <table className="mt-3 w-full text-sm">
        <tbody>
          <tr>
            <td className="w-40 py-0.5 font-semibold">Tienda</td>
            <td>{tienda}</td>
          </tr>
          <tr>
            <td className="py-0.5 font-semibold">Cajero/a</td>
            <td>{a.cajero ?? '—'}</td>
          </tr>
          <tr>
            <td className="py-0.5 font-semibold">Realizado por</td>
            <td>{a.nombreUsuario ?? a.usuario}</td>
          </tr>
          {a.nota && (
            <tr>
              <td className="py-0.5 font-semibold">Nota</td>
              <td>{a.nota}</td>
            </tr>
          )}
        </tbody>
      </table>
      <h2 className="mt-4 font-semibold">Detalle del efectivo</h2>
      <table className="mt-1 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black">
            <th className="py-1 text-left">Moneda</th>
            <th className="text-right">Denominación</th>
            <th className="text-right">Cantidad</th>
            <th className="text-right">Importe</th>
          </tr>
        </thead>
        <tbody>
          {a.detalle.map((d) => (
            <tr key={`${d.moneda}${d.valor}`} className="border-b border-gray-300">
              <td className="py-0.5">{d.moneda}</td>
              <td className="text-right">{d.valor}</td>
              <td className="text-right">{d.cantidad}</td>
              <td className="text-right">{f2(d.valor * d.cantidad)}</td>
            </tr>
          ))}
          {(Object.entries(a.otros ?? {}) as [Moneda, number][])
            .filter(([, v]) => v)
            .map(([m, v]) => (
              <tr key={`o${m}`} className="border-b border-gray-300">
                <td className="py-0.5">{m}</td>
                <td className="text-right">Sueltos</td>
                <td />
                <td className="text-right">{f2(v)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <h2 className="mt-4 font-semibold">Resumen</h2>
      <table className="mt-1 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black">
            <th className="py-1 text-left">Moneda</th>
            <th className="text-right">Contado</th>
            <th className="text-right">Según sistema</th>
            <th className="text-right">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          {monedas.map((m) => {
            const d = (a.contado[m] ?? 0) - (a.esperado[m] ?? 0)
            return (
              <tr key={m} className="border-b border-gray-300">
                <td className="py-0.5 font-semibold">{m}</td>
                <td className="text-right">{f2(a.contado[m])}</td>
                <td className="text-right">{f2(a.esperado[m])}</td>
                <td className="text-right font-semibold">
                  {Math.abs(d) < 0.005 ? 'Cuadra' : `${d > 0 ? 'Sobrante +' : 'Faltante '}${f2(d)}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs">
        «Según sistema»: saldo de la caja en Kaluch Accounting (cobros en efectivo del TPV − gastos − entregas a la caja central) al momento del arqueo.
        {a.avisoEsperado ? ` ${a.avisoEsperado}` : ''}
      </p>
      <div className="mt-16 grid grid-cols-2 gap-10 text-center text-sm">
        <div className="border-t border-black pt-1">Entrega (cajero/a)</div>
        <div className="border-t border-black pt-1">Recibe / Revisa</div>
      </div>
    </div>
  )
}
