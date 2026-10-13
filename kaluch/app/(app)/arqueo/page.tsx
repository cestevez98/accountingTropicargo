import { Chip, Encabezado } from '@/components/ui'
import { requerirUsuario, tiendaFija } from '@/lib/auth'
import { cargarDataset, preferencias } from '@/lib/data'
import type { Moneda } from '@/lib/types'
import { FormArqueo } from './FormArqueo'

const f2 = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Arqueo de caja de los mercados con comprobante numerado. */
export default async function PaginaArqueo() {
  const s = await requerirUsuario('arqueo')
  const ds = await cargarDataset()
  const fija = tiendaFija(s)
  const pref = await preferencias()
  const tiendas = ds.tiendas.filter((t) => t.activa && t.tipo === 'local' && (!fija || t.id === fija))
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))
  const lista = ds.arqueos.filter((a) => !fija || a.tienda === fija).slice(0, 60)
  return (
    <>
      <Encabezado titulo="Arqueo de caja" descripcion="Cuenta el efectivo por billetes. Al guardar se lee lo último del TPV de esa tienda, se calcula lo que debería haber y se genera el comprobante." />
      <FormArqueo tiendas={tiendas.map((t) => ({ id: t.id, nombre: t.nombre }))} tienda={fija ?? (tiendas.some((t) => t.id === pref.tienda) ? pref.tienda : undefined)} />
      {lista.length > 0 && (
        <div className="tarjeta mt-6 overflow-x-auto">
          <h2 className="px-4 pt-3 text-sm font-semibold">Arqueos</h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>#</th>
                <th>Fecha</th>
                <th>Tienda</th>
                <th>Cajero/a</th>
                <th>Contado</th>
                <th>Diferencia</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => {
                const monedas = [...new Set([...Object.keys(a.contado), ...Object.keys(a.esperado)])] as Moneda[]
                return (
                  <tr key={a.id}>
                    <td>{a.numero}</td>
                    <td>
                      {a.fecha} <span className="text-xs text-muted-foreground">{a.ts.slice(11, 16)}</span>
                    </td>
                    <td>{nombreT.get(a.tienda)}</td>
                    <td className="text-xs">{a.cajero ?? a.nombreUsuario}</td>
                    <td className="text-xs">{monedas.filter((m) => a.contado[m]).map((m) => `${f2(a.contado[m]!)} ${m}`).join(' · ')}</td>
                    <td className="text-xs">
                      {monedas.map((m) => {
                        const d = Math.round(((a.contado[m] ?? 0) - (a.esperado[m] ?? 0)) * 100) / 100
                        return d ? (
                          <Chip key={m} tono={d < 0 ? 'rojo' : 'ambar'}>
                            {d > 0 ? '+' : ''}
                            {f2(d)} {m}
                          </Chip>
                        ) : null
                      })}
                    </td>
                    <td>
                      <a className="text-xs text-primary hover:underline" href={`/imprimir/arqueo?id=${a.id}`}>
                        Comprobante
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
