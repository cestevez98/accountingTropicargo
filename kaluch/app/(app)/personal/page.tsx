import { accionNominaApunte, accionNominaBorrar } from '../../acciones'
import { BotonAccion, FormAccion } from '@/components/FormAccion'
import { Chip, Encabezado, url, Vacio } from '@/components/ui'
import { puedeRegistrar, requerirUsuario, tiendaFija } from '@/lib/auth'
import { cargarDataset } from '@/lib/data'
import { hoy } from '@/lib/fecha'
import { cuentasTrabajadores, inventarioRevisado } from '@/lib/nomina'
import { params, type SP } from '@/lib/pagina'

const f2 = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Pagos al personal: la cuenta de cada trabajador. Cada turno aprobado suma su salario; los faltantes
 * de caja o de inventario (aunque aparezcan después) se descuentan; los pagos salen de una caja.
 */
export default async function Personal({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('personal')
  const sp = await params(searchParams)
  const ds = await cargarDataset()
  const fija = tiendaFija(s)
  const registrar = puedeRegistrar(s, 'personal')
  const apuntes = ds.nomina.filter((a) => !fija || a.tienda === fija)
  const cuentas = cuentasTrabajadores(apuntes)
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))
  const sel = sp.t ? cuentas.find((c) => c.trabajador === sp.t) : undefined
  const cierres = new Map(ds.arqueos.map((a) => [a.id, a]))
  const conteos = new Map(ds.conteos.map((c) => [c.id, c]))
  const tiendasForm = ds.tiendas.filter((t) => t.activa && t.tipo === 'local' && (!fija || t.id === fija))
  const cajas = ds.tiendas.filter((t) => t.activa && (t.tipo === 'local' || t.tipo === 'matriz') && (!fija || t.id === fija))

  if (sel) {
    const mios = apuntes.filter((a) => a.trabajador === sel.trabajador).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.ts.localeCompare(a.ts))
    // Pago por turno cerrado: lo devengado en cada cierre menos los descuentos ligados a ese cierre.
    const porTurno = mios
      .filter((a) => a.tipo === 'devengo' && a.cierre)
      .map((d) => {
        const c = cierres.get(d.cierre!)
        const desc = mios.filter((x) => x.tipo === 'descuento' && x.cierre === d.cierre).reduce((t, x) => t + x.importe, 0)
        return { d, c, desc, neto: d.importe - desc, revisado: c ? inventarioRevisado(c, ds.conteos) : false }
      })
    const tiendaDefecto = mios[0]?.tienda ?? tiendasForm[0]?.id
    return (
      <>
        <Encabezado titulo={sel.trabajador} descripcion={`${sel.tiendas.map((t) => nombreT.get(t)).join(', ')} · ${sel.turnos} turnos`}>
          <a className="btn" href="/personal">
            Volver
          </a>
        </Encabezado>
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          {[
            ['Devengado', sel.devengado],
            ['Descuentos', -sel.descuentos],
            ['Pagado', -sel.pagado],
            ['Por pagar', sel.porPagar],
          ].map(([k, v]) => (
            <div key={k as string} className="tarjeta p-3">
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className={`text-lg font-semibold ${k === 'Por pagar' && (v as number) < 0 ? 'text-danger' : ''}`}>{f2(v as number)}</div>
            </div>
          ))}
        </div>
        {sel.porPagar < 0 && <p className="mb-3 text-sm text-danger">Los descuentos superan lo devengado: el trabajador debe {f2(-sel.porPagar)} CUP, que se le irán descontando de los próximos turnos.</p>}
        {registrar && (
          <div className="mb-4 grid gap-3 md:grid-cols-2">
            <div className="tarjeta p-4">
              <h2 className="mb-2 text-sm font-semibold">Registrar pago</h2>
              <FormAccion accion={accionNominaApunte} boton="Pagar" claseBoton="btn btn-exito mt-2" confirmar="¿Registrar el pago? Sale de la caja elegida como salario.">
                <input type="hidden" name="tipo" value="pago" />
                <input type="hidden" name="trabajador" value={sel.trabajador} />
                <input type="hidden" name="tienda" value={tiendaDefecto} />
                <div className="grid gap-2 sm:grid-cols-3">
                  <label>
                    <span className="etiqueta">Fecha</span>
                    <input name="fecha" type="date" defaultValue={hoy()} className="input" />
                  </label>
                  <label>
                    <span className="etiqueta">Importe CUP</span>
                    <input name="importe" defaultValue={sel.porPagar > 0 ? sel.porPagar : ''} inputMode="decimal" className="input text-right" required />
                  </label>
                  <label>
                    <span className="etiqueta">Sale de la caja de</span>
                    <select name="caja" defaultValue={tiendaDefecto} className="input">
                      {cajas.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nombre}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <input name="concepto" placeholder="Concepto (opcional)" className="input mt-2" />
              </FormAccion>
            </div>
            <div className="tarjeta p-4">
              <h2 className="mb-2 text-sm font-semibold">Registrar descuento u otro devengo</h2>
              <FormAccion accion={accionNominaApunte} claseBoton="btn mt-2">
                <input type="hidden" name="trabajador" value={sel.trabajador} />
                <div className="grid gap-2 sm:grid-cols-3">
                  <label>
                    <span className="etiqueta">Tipo</span>
                    <select name="tipo" className="input">
                      <option value="descuento">Descuento</option>
                      <option value="devengo">Devengo (bono, ajuste)</option>
                    </select>
                  </label>
                  <label>
                    <span className="etiqueta">Importe CUP</span>
                    <input name="importe" inputMode="decimal" className="input text-right" required />
                  </label>
                  <label>
                    <span className="etiqueta">Tienda</span>
                    <select name="tienda" defaultValue={tiendaDefecto} className="input">
                      {tiendasForm.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nombre}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[10rem_1fr]">
                  <input name="fecha" type="date" defaultValue={hoy()} className="input" />
                  <input name="concepto" placeholder="Motivo (p. ej. faltante de inventario del 12/10)" className="input" required />
                </div>
              </FormAccion>
            </div>
          </div>
        )}
        {porTurno.length > 0 && (
          <div className="tarjeta mb-4 overflow-x-auto">
            <h2 className="px-4 pt-3 text-sm font-semibold">Pago por turno cerrado</h2>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Turno</th>
                  <th>Tienda</th>
                  <th className="num">Venta</th>
                  <th className="num">Salario</th>
                  <th className="num">Descuentos del turno</th>
                  <th className="num">Neto</th>
                  <th>Inventario</th>
                </tr>
              </thead>
              <tbody>
                {porTurno.map(({ d, c, desc, neto, revisado }) => (
                  <tr key={d.id}>
                    <td className="text-xs">
                      {c ? (
                        <a className="text-primary hover:underline" href={`/arqueo?id=${c.id}`}>
                          #{c.numero} · {c.turno === 'noche' ? 'noche' : 'día'} {d.fecha}
                        </a>
                      ) : (
                        d.concepto
                      )}
                    </td>
                    <td className="text-xs">{nombreT.get(d.tienda)}</td>
                    <td className="num">{c ? f2(c.ventaTienda + c.domicilio + c.plataforma) : ''}</td>
                    <td className="num">{f2(d.importe)}</td>
                    <td className="num">{desc ? f2(-desc) : ''}</td>
                    <td className="num font-semibold">{f2(neto)}</td>
                    <td>{revisado ? <Chip tono="verde">Contado después</Chip> : <Chip tono="ambar">Sin conteo posterior</Chip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="tarjeta overflow-x-auto">
          <h2 className="px-4 pt-3 text-sm font-semibold">Movimientos de la cuenta</h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th className="num">Devengo</th>
                <th className="num">Descuento</th>
                <th className="num">Pago</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mios.map((a) => (
                <tr key={a.id}>
                  <td>{a.fecha}</td>
                  <td className="text-xs">
                    {a.concepto}
                    {a.conteo && conteos.get(a.conteo) && (
                      <a className="ml-1 text-primary hover:underline" href={`/conteo?id=${a.conteo}`}>
                        ver conteo
                      </a>
                    )}
                  </td>
                  <td className="num">{a.tipo === 'devengo' ? f2(a.importe) : ''}</td>
                  <td className="num text-danger">{a.tipo === 'descuento' ? f2(a.importe) : ''}</td>
                  <td className="num">{a.tipo === 'pago' ? f2(a.importe) : ''}</td>
                  <td>
                    {registrar && (
                      <BotonAccion accion={accionNominaBorrar} campos={{ id: a.id }} confirmar={`¿Anular este ${a.tipo}?${a.tipo === 'pago' ? ' También se borra su salida de caja.' : ''}`} className="text-xs text-danger hover:underline">
                        Anular
                      </BotonAccion>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  return (
    <>
      <Encabezado
        titulo="Pagos al personal"
        descripcion="La cuenta de cada trabajador: el salario de cada turno se suma al aprobar el cierre; los faltantes de caja o de inventario se descuentan aunque aparezcan después; lo que se le entrega se registra como pago."
      />
      {cuentas.length ? (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Trabajador</th>
                <th>Tienda</th>
                <th className="num">Turnos</th>
                <th className="num">Devengado</th>
                <th className="num">Descuentos</th>
                <th className="num">Pagado</th>
                <th className="num">Por pagar</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cuentas.map((c) => (
                <tr key={c.trabajador}>
                  <td>{c.trabajador}</td>
                  <td className="text-xs">{c.tiendas.map((t) => nombreT.get(t)).join(', ')}</td>
                  <td className="num">{c.turnos}</td>
                  <td className="num">{f2(c.devengado)}</td>
                  <td className="num text-danger">{c.descuentos ? f2(c.descuentos) : ''}</td>
                  <td className="num">{f2(c.pagado)}</td>
                  <td className={`num font-semibold ${c.porPagar < 0 ? 'text-danger' : ''}`}>{f2(c.porPagar)}</td>
                  <td>
                    <a className="text-xs text-primary hover:underline" href={url('/personal', {}, { t: c.trabajador })}>
                      Ver
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Vacio>Todavía no hay turnos aprobados. El salario de cada turno aparece aquí cuando el contador aprueba el cierre.</Vacio>
      )}
    </>
  )
}
