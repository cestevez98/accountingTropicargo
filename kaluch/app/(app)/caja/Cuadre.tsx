import { accionEntregaCaja } from '../../acciones'
import { FormAccion } from '@/components/FormAccion'
import { Chip, Pestanas, url, Vacio } from '@/components/ui'
import { hoy } from '@/lib/fecha'
import { CONCEPTO_ENTREGA, cuadreCaja, esEntrega } from '@/lib/sincro'
import type { Dataset } from '@/lib/types'

const f2 = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Cuadre diario de las cajas de los mercados: lo cobrado en efectivo en el TPV, los gastos pagados de la caja,
 * lo entregado a la caja central y el saldo que debería quedar en cada tienda.
 */
export function CuadreCajas({ ds, sp, tiendaFija, registrar }: { ds: Dataset; sp: Record<string, string | undefined>; tiendaFija?: string; registrar: boolean }) {
  const h = hoy()
  const desde = sp.desde ?? `${h.slice(0, 8)}01`
  const hasta = sp.hasta ?? h
  const matriz = ds.tiendas.find((t) => t.tipo === 'matriz')
  const mercados = ds.tiendas.filter((t) => t.activa && t.tipo === 'local' && (!tiendaFija || t.id === tiendaFija))
  const sel = mercados.find((t) => t.id === sp.t) ?? (tiendaFija ? mercados[0] : undefined)
  const resumen = mercados.map((t) => ({ t, c: cuadreCaja(ds.movimientos, t.id, desde, hasta) }))
  const total = (c: ReturnType<typeof cuadreCaja>, k: 'cobrado' | 'gastos' | 'entregado', m: string) => c.dias.filter((d) => d.moneda === m).reduce((s, d) => s + d[k], 0)
  const monedas = [...new Set(resumen.flatMap((r) => r.c.dias.map((d) => d.moneda)))].sort()
  const recibidas = matriz ? ds.movimientos.filter((m) => esEntrega(m) && m.tienda === matriz.id && m.fecha >= desde && m.fecha <= hasta) : []
  const detalle = sel ? cuadreCaja(ds.movimientos, sel.id, desde, hasta) : undefined
  return (
    <>
      <Pestanas
        activa="cuadre"
        items={[
          { clave: 'caja', label: 'Caja', href: '/caja' },
          { clave: 'banco', label: 'Banco', href: '/caja?libro=banco' },
          { clave: 'cuadre', label: 'Cuadre de cajas', href: '/caja?libro=cuadre' },
        ]}
      />
      <form action="/caja" className="mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="libro" value="cuadre" />
        {sel && <input type="hidden" name="t" value={sel.id} />}
        <label>
          <span className="etiqueta">Desde</span>
          <input name="desde" type="date" defaultValue={desde} className="input" />
        </label>
        <label>
          <span className="etiqueta">Hasta</span>
          <input name="hasta" type="date" defaultValue={hasta} className="input" />
        </label>
        <button className="btn">Ver</button>
      </form>
      <p className="mb-3 text-xs text-muted-foreground">
        Saldo = saldo anterior + cobrado en efectivo (TPV) + otras entradas − gastos pagados de la caja − entregado a la caja central. Es el efectivo que debería haber en la tienda: si crece día tras día, falta registrar entregas o hay un descuadre.
      </p>
      {!resumen.some((r) => r.c.dias.length) ? (
        <Vacio>No hay movimientos de caja de los mercados en estas fechas.</Vacio>
      ) : (
        <div className="tarjeta mb-4 overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Mercado</th>
                <th>Moneda</th>
                <th className="num">Saldo anterior</th>
                <th className="num">Cobrado</th>
                <th className="num">Gastos</th>
                <th className="num">Entregado</th>
                <th className="num">Saldo en tienda</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {resumen.flatMap(({ t, c }) =>
                monedas
                  .filter((m) => c.dias.some((d) => d.moneda === m) || c.saldoFinal[m])
                  .map((m) => {
                    const ent = total(c, 'entregado', m)
                    const cob = total(c, 'cobrado', m)
                    return (
                      <tr key={`${t.id}${m}`} className={sel?.id === t.id ? 'bg-primary/5' : ''}>
                        <td>{t.nombre}</td>
                        <td>{m}</td>
                        <td className="num">{f2(c.saldoInicial[m] ?? 0)}</td>
                        <td className="num">{f2(cob)}</td>
                        <td className="num">{f2(total(c, 'gastos', m))}</td>
                        <td className="num">{f2(ent)}</td>
                        <td className="num font-semibold">
                          {f2(c.saldoFinal[m] ?? 0)} {cob > 0 && !ent && <Chip tono="ambar">Sin entregas</Chip>}
                        </td>
                        <td>
                          <a className="text-xs text-primary hover:underline" href={url('/caja', { libro: 'cuadre', desde, hasta }, { t: t.id })}>
                            Por día
                          </a>
                        </td>
                      </tr>
                    )
                  }),
              )}
            </tbody>
          </table>
        </div>
      )}
      {sel && detalle && (
        <div className="tarjeta mb-4 overflow-x-auto">
          <h2 className="px-4 pt-3 text-sm font-semibold">{sel.nombre} · día a día</h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Moneda</th>
                <th className="num">Cobrado</th>
                <th className="num">Otras entradas</th>
                <th className="num">Gastos</th>
                <th className="num">Entregado</th>
                <th className="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {detalle.dias.map((d) => (
                <tr key={`${d.fecha}${d.moneda}`}>
                  <td>{d.fecha}</td>
                  <td>{d.moneda}</td>
                  <td className="num">{f2(d.cobrado)}</td>
                  <td className="num">{d.otrasEntradas ? f2(d.otrasEntradas) : ''}</td>
                  <td className="num">{d.gastos ? f2(d.gastos) : ''}</td>
                  <td className="num">{d.entregado ? f2(d.entregado) : ''}</td>
                  <td className="num font-semibold">{f2(d.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {registrar && matriz && (
        <div className="tarjeta mb-4 p-4">
          <h2 className="text-sm font-semibold">Registrar entrega a la caja central</h2>
          <p className="mt-1 text-xs text-muted-foreground">Saca el efectivo de la caja del mercado y lo entra en la caja de {matriz.nombre} (dos movimientos de TRASPASO con el mismo comprobante). Solo en Kaluch: no toca el TPV.</p>
          <FormAccion accion={accionEntregaCaja} className="mt-3">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <label>
                <span className="etiqueta">Fecha</span>
                <input name="fecha" type="date" defaultValue={h} className="input" required />
              </label>
              <label>
                <span className="etiqueta">Mercado</span>
                <select name="tienda" defaultValue={sel?.id} className="input">
                  {mercados.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="etiqueta">Moneda</span>
                <select name="moneda" className="input">
                  <option>CUP</option>
                  <option>USD</option>
                  <option>EUR</option>
                  <option>MLC</option>
                </select>
              </label>
              <label>
                <span className="etiqueta">Monto</span>
                <input name="monto" inputMode="decimal" className="input" required />
              </label>
              <label>
                <span className="etiqueta">Entrega</span>
                <input name="cajero" placeholder="Quién entrega" className="input" />
              </label>
              <label>
                <span className="etiqueta">Nota</span>
                <input name="nota" className="input" />
              </label>
            </div>
          </FormAccion>
        </div>
      )}
      {matriz && (
        <div className="tarjeta overflow-x-auto">
          <h2 className="px-4 pt-3 text-sm font-semibold">Recibido en la caja central ({recibidas.length})</h2>
          {recibidas.length ? (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>De</th>
                  <th>Comprobante</th>
                  <th>Moneda</th>
                  <th className="num">Monto</th>
                </tr>
              </thead>
              <tbody>
                {recibidas
                  .sort((a, b) => b.fecha.localeCompare(a.fecha))
                  .map((m) => (
                    <tr key={m.id}>
                      <td>{m.fecha}</td>
                      <td>{(m.concepto ?? '').replace(`${CONCEPTO_ENTREGA} · de `, '')}</td>
                      <td className="text-xs text-muted-foreground">{m.comprobante}</td>
                      <td>{m.moneda}</td>
                      <td className="num">{f2(m.monto)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 pb-3 text-sm text-muted-foreground">Ninguna entrega en estas fechas.</p>
          )}
        </div>
      )}
    </>
  )
}
