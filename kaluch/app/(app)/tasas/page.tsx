import { accionAxisEnviarTasa, accionTasa } from '../../acciones'
import { escrituraAxis } from '@/lib/axispos'
import { FormAccion } from '@/components/FormAccion'
import { Aviso, Encabezado, Importe, Paginador, url } from '@/components/ui'
import { puedeRegistrar, requerirUsuario } from '@/lib/auth'
import { cargarDataset } from '@/lib/data'
import { hoy } from '@/lib/fecha'
import { params, type SP } from '@/lib/pagina'

function Linea({ puntos }: { puntos: { fecha: string; v: number }[] }) {
  if (puntos.length < 2) return null
  const min = Math.min(...puntos.map((p) => p.v))
  const max = Math.max(...puntos.map((p) => p.v))
  const w = 640
  const h = 160
  const x = (i: number) => (i / (puntos.length - 1)) * (w - 20) + 10
  const y = (v: number) => h - 20 - ((v - min) / Math.max(1, max - min)) * (h - 40)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Evolución de la tasa CUP/USD">
      <polyline fill="none" stroke="var(--primary-700)" strokeWidth={2} points={puntos.map((p, i) => `${x(i)},${y(p.v)}`).join(' ')} />
      <text x={10} y={12} fontSize={11} fill="var(--text-secondary)">
        máx {max}
      </text>
      <text x={10} y={h - 4} fontSize={11} fill="var(--text-secondary)">
        mín {min} · {puntos[0].fecha} → {puntos.at(-1)!.fecha}
      </text>
    </svg>
  )
}

export default async function Tasas({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('tasas')
  const sp = await params(searchParams)
  const ds = await cargarDataset()
  const h = hoy()
  const tasas = [...ds.tasas].sort((a, b) => b.fecha.localeCompare(a.fecha))
  const deHoy = tasas.find((t) => t.fecha === h)
  const ultima = tasas.find((t) => t.cupUsd > 0)
  const pagina = Math.max(1, Number(sp.p) || 1)
  const vista = tasas.slice((pagina - 1) * 60, pagina * 60)
  const margen = ds.settings.margenTasa
  const editar = sp.editar ? tasas.find((t) => t.fecha === sp.editar) : undefined
  const base = editar ?? deHoy ?? ultima
  return (
    <>
      <Encabezado titulo="Tasas de cambio" descripcion={`CUP por unidad de cada moneda (tasa Toque). La tienda compra a Toque − ${margen} y vende a Toque + ${margen} salvo que se fije a mano.`} />
      {!deHoy && <Aviso tono="rojo">Sin tasa para hoy ({h}): las conversiones usan la del {ultima?.fecha ?? '—'}. Registra la tasa del día.</Aviso>}
      {puedeRegistrar(s, 'tasas') && (
        <div className="tarjeta mb-4 p-4">
          <h2 className="text-sm font-semibold">{editar ? `Editar tasa del ${editar.fecha}` : 'Registrar tasa manual'}</h2>
          <FormAccion accion={accionTasa} className="mt-3" limpiar={false}>
            <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <label>
                <span className="etiqueta">Fecha</span>
                <input name="fecha" type="date" defaultValue={editar?.fecha ?? h} className="input" required />
              </label>
              <label>
                <span className="etiqueta">CUP/USD (Toque)</span>
                <input name="cupUsd" inputMode="decimal" defaultValue={base?.cupUsd} className="input" required />
              </label>
              <label>
                <span className="etiqueta">CUP/EUR</span>
                <input name="cupEur" inputMode="decimal" defaultValue={base?.cupEur} className="input" />
              </label>
              <label>
                <span className="etiqueta">CUP/MLC</span>
                <input name="cupMlc" inputMode="decimal" defaultValue={base?.cupMlc} className="input" />
              </label>
              <label>
                <span className="etiqueta">Fiscal</span>
                <input name="fiscal" inputMode="decimal" defaultValue={base?.fiscal} className="input" />
              </label>
              <label>
                <span className="etiqueta">KM compra (opcional)</span>
                <input name="kmCompra" inputMode="decimal" defaultValue={editar?.kmCompra} placeholder={`Toque − ${margen}`} className="input" />
              </label>
              <label>
                <span className="etiqueta">KM venta (opcional)</span>
                <input name="kmVenta" inputMode="decimal" defaultValue={editar?.kmVenta} placeholder={`Toque + ${margen}`} className="input" />
              </label>
            </div>
          </FormAccion>
          {escrituraAxis() && ds.settings.axispos?.url && (
            <div className="mt-4 rounded-lg border border-border p-3">
              <h3 className="text-sm font-semibold">Enviar al TPV</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Pone en AxisPOS la tasa de la tienda (Toque + {margen}) del USD{base?.cupEur ? ', EUR' : ''}{base?.cupMlc ? ' y MLC' : ''}: con ella cobran las cajas. Hoy sería USD {base ? (base.kmVenta ?? base.cupUsd + margen) : '—'}
                {base?.cupEur ? ` · EUR ${base.cupEur + margen}` : ''}.
              </p>
              <FormAccion accion={accionAxisEnviarTasa} boton="Enviar tasa al TPV" claseBoton="btn btn-exito mt-2" limpiar={false} confirmar="¿Cambiar la tasa de cobro en todas las cajas de AxisPOS?">
                <input type="hidden" name="fecha" value={editar?.fecha ?? h} />
              </FormAccion>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            ¿Muchos días? Usa Importar → Tasas de cambio con la plantilla. Los cambios quedan en la auditoría (quién, cuándo, valor anterior → nuevo).
          </p>
        </div>
      )}
      <div className="tarjeta mb-4 p-4">
        <h2 className="mb-2 text-sm font-semibold">Evolución CUP/USD (últimos 120 días con tasa)</h2>
        <Linea puntos={tasas.slice(0, 120).reverse().map((t) => ({ fecha: t.fecha, v: t.cupUsd }))} />
      </div>
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th className="num">Toque CUP/USD</th>
              <th className="num">CUP/EUR</th>
              <th className="num">CUP/MLC</th>
              <th className="num">EUR/USD</th>
              <th className="num">Fiscal</th>
              <th className="num">KM compra</th>
              <th className="num">KM venta</th>
              <th>Fuente</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vista.map((t) => (
              <tr key={t.fecha}>
                <td className="whitespace-nowrap">{t.fecha}</td>
                <td className="num font-semibold">
                  <Importe v={t.cupUsd} />
                </td>
                <td className="num">
                  <Importe v={t.cupEur} />
                </td>
                <td className="num">
                  <Importe v={t.cupMlc} />
                </td>
                <td className="num">{t.cupEur ? (t.cupUsd / t.cupEur).toFixed(4) : '—'}</td>
                <td className="num">
                  <Importe v={t.fiscal} />
                </td>
                <td className="num">
                  <Importe v={t.kmCompra ?? t.cupUsd - margen} />
                </td>
                <td className="num">
                  <Importe v={t.kmVenta ?? t.cupUsd + margen} />
                </td>
                <td className="text-xs text-muted-foreground">{t.fuente}</td>
                <td>
                  <a className="text-xs text-primary hover:underline" href={`/tasas?editar=${t.fecha}`}>
                    Editar
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Paginador pagina={pagina} total={tasas.length} porPagina={60} base={(p) => url('/tasas', sp, { p })} />
    </>
  )
}
