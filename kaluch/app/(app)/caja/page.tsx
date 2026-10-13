import { accionBorrar, accionMovimiento, accionReclasificar } from '../../acciones'
import { BotonAccion, FormAccion } from '@/components/FormAccion'
import { Filtros } from '@/components/Filtros'
import { Chip, Encabezado, Importe, Paginador, Pestanas, url, Vacio } from '@/components/ui'
import { puedeRegistrar, requerirUsuario } from '@/lib/auth'
import { CAT_POR_CLASIFICAR } from '@/lib/catalogo'
import { cargarContabilidad } from '@/lib/data'
import { hoy } from '@/lib/fecha'
import { params, tiendaActiva, type SP } from '@/lib/pagina'

const POR_PAGINA = 100

export default async function CajaBanco({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('caja')
  const sp = await params(searchParams)
  const libro = sp.libro === 'banco' ? 'banco' : 'caja'
  const { tienda } = await tiendaActiva(s)
  const { ds, mayor } = await cargarContabilidad()
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))
  const soloFiscal = s.rol === 'contador_fiscal'
  const q = sp.q?.toUpperCase()
  const base = ds.movimientos.filter((m) => m.libro === libro && (!tienda || m.tienda === tienda) && (!soloFiscal || m.fiscal))
  const cuentas = [...new Set(base.map((m) => m.cuenta).filter(Boolean))] as string[]
  const filtradas = base
    .filter(
      (m) =>
        (!sp.desde || m.fecha >= sp.desde) &&
        (!sp.hasta || m.fecha <= sp.hasta) &&
        (!sp.cat || m.categoria === sp.cat) &&
        (!sp.moneda || m.moneda === sp.moneda) &&
        (!sp.cuenta || m.cuenta === sp.cuenta) &&
        (!sp.tipo || m.tipo === sp.tipo) &&
        (!q || `${m.concepto ?? ''} ${m.observaciones ?? ''} ${m.cajero ?? ''}`.toUpperCase().includes(q)),
    )
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
  // Saldo acumulado en USD (sobre lo filtrado, en orden cronológico).
  let saldo = 0
  const conSaldo = filtradas.map((m) => {
    const usd = mayor.usdMov.get(m.id) ?? NaN
    if (Number.isFinite(usd)) saldo += usd
    return { m, usd, saldo }
  })
  conSaldo.reverse()
  const pagina = Math.max(1, Number(sp.p) || 1)
  const vista = conSaldo.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  const porMoneda = new Map<string, number>()
  for (const m of filtradas) porMoneda.set(m.moneda, (porMoneda.get(m.moneda) ?? 0) + (m.tipo === 'Entrada' ? m.monto : -m.monto))
  const registrar = puedeRegistrar(s, 'caja')
  const cats = ds.categorias.filter((c) => c.activa && (libro === 'caja' ? c.caja : c.banco))
  return (
    <>
      <Encabezado titulo="Caja y Banco" descripcion="Libro de efectivo de cada tienda. La categoría decide a qué renglón del ER o del balance va cada movimiento.">
        <a className="btn" href={`/api/exportar?tabla=${libro}&${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])}`}>
          Exportar a Excel
        </a>
      </Encabezado>
      <Pestanas
        activa={libro}
        items={[
          { clave: 'caja', label: 'Caja', href: '/caja' },
          { clave: 'banco', label: 'Banco', href: '/caja?libro=banco' },
        ]}
      />
      {registrar && (
        <details className="tarjeta mb-4 p-4" open={!base.length}>
          <summary className="cursor-pointer text-sm font-semibold">+ Registrar movimiento de {libro}</summary>
          <FormAccion accion={accionMovimiento} className="mt-3">
            <input type="hidden" name="libro" value={libro} />
            <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <label>
                <span className="etiqueta">Fecha</span>
                <input name="fecha" type="date" defaultValue={hoy()} className="input" required />
              </label>
              <label>
                <span className="etiqueta">Tienda</span>
                <select name="tienda" defaultValue={tienda ?? 'km26'} className="input">
                  {ds.tiendas
                    .filter((t) => t.activa)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span className="etiqueta">Tipo</span>
                <select name="tipo" className="input">
                  <option>Salida</option>
                  <option>Entrada</option>
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className="etiqueta">Categoría</span>
                <select name="categoria" className="input" required>
                  {cats.map((c) => (
                    <option key={c.nombre}>{c.nombre}</option>
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
              {libro === 'banco' ? (
                <label>
                  <span className="etiqueta">Cuenta</span>
                  <input name="cuenta" list="cuentas" defaultValue={cuentas[0] ?? 'FISCAL'} className="input" />
                </label>
              ) : (
                <label>
                  <span className="etiqueta">Cajero</span>
                  <input name="cajero" className="input" />
                </label>
              )}
              <label className="sm:col-span-2">
                <span className="etiqueta">Concepto</span>
                <input name="concepto" className="input" />
              </label>
              <label className="sm:col-span-2">
                <span className="etiqueta">Observaciones</span>
                <input name="observaciones" className="input" />
              </label>
              <label>
                <span className="etiqueta">Comprobante</span>
                <input name="comprobante" className="input" />
              </label>
              <label>
                <span className="etiqueta">Tasa CUP/USD (opcional)</span>
                <input name="tasa" inputMode="decimal" className="input" placeholder="la del día" />
              </label>
              {libro === 'banco' && (
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <input type="checkbox" name="fiscal" defaultChecked /> Fiscal
                </label>
              )}
            </div>
            <datalist id="cuentas">
              {cuentas.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </FormAccion>
        </details>
      )}
      <Filtros
        base="/caja"
        valores={sp}
        campos={[
          { nombre: 'desde', label: 'Desde', tipo: 'date' },
          { nombre: 'hasta', label: 'Hasta', tipo: 'date' },
          { nombre: 'cat', label: 'Categoría', tipo: 'select', opciones: [...new Set(base.map((m) => m.categoria))].sort().map((c) => ({ valor: c, label: c })), ancho: 'w-52' },
          { nombre: 'tipo', label: 'Tipo', tipo: 'select', opciones: ['Entrada', 'Salida'].map((v) => ({ valor: v, label: v })), ancho: 'w-28' },
          { nombre: 'moneda', label: 'Moneda', tipo: 'select', opciones: ['CUP', 'USD', 'EUR', 'MLC'].map((v) => ({ valor: v, label: v })), ancho: 'w-28' },
          ...(libro === 'banco' ? [{ nombre: 'cuenta', label: 'Cuenta', tipo: 'select' as const, opciones: cuentas.map((c) => ({ valor: c, label: c })) }] : []),
          { nombre: 'q', label: 'Concepto / cajero' },
        ]}
      />
      {!filtradas.length ? (
        <Vacio>Sin movimientos de {libro} con estos filtros.</Vacio>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            {[...porMoneda.entries()].map(([k, v]) => (
              <span key={k} className="tarjeta px-3 py-2">
                Neto {k}: <b className={`tabular-nums ${v < 0 ? 'text-danger' : 'text-accent'}`}>{v.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</b>
              </span>
            ))}
            <span className="tarjeta px-3 py-2">
              Saldo USD de lo filtrado: <b className="tabular-nums">{saldo.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</b>
            </span>
          </div>
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Mercado</th>
                  <th>Categoría</th>
                  <th>Concepto</th>
                  <th>{libro === 'caja' ? 'Cajero' : 'Cuenta'}</th>
                  <th>Tipo</th>
                  <th>Moneda</th>
                  <th className="num">Monto</th>
                  <th className="num">Monto USD</th>
                  <th className="num">Saldo USD</th>
                  {registrar && <th />}
                </tr>
              </thead>
              <tbody>
                {vista.map(({ m, usd, saldo }) => {
                  const huerfana = m.categoria === CAT_POR_CLASIFICAR || !mayor.categorias.has(m.categoria)
                  return (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap">{m.fecha}</td>
                      <td>{nombreT.get(m.tienda) ?? m.tienda}</td>
                      <td>
                        {huerfana && registrar ? (
                          <BotonReclasificar id={m.id} cats={cats.map((c) => c.nombre)} actual={m.categoria} />
                        ) : (
                          <span className="text-xs font-medium">{m.categoria}</span>
                        )}
                      </td>
                      <td className="max-w-80">
                        {m.concepto}
                        {m.observaciones && <div className="text-xs text-muted-foreground">{m.observaciones}</div>}
                      </td>
                      <td>{libro === 'caja' ? m.cajero : <Chip tono={m.fiscal ? 'verde' : 'gris'}>{m.cuenta}</Chip>}</td>
                      <td>
                        <Chip tono={m.tipo === 'Entrada' ? 'verde' : 'rojo'}>{m.tipo}</Chip>
                      </td>
                      <td>{m.moneda}</td>
                      <td className="num">
                        <Importe v={m.monto} />
                      </td>
                      <td className="num">
                        <Importe v={usd} colorear />
                      </td>
                      <td className="num">
                        <Importe v={saldo} />
                      </td>
                      {registrar && (
                        <td>
                          <BotonAccion accion={accionBorrar} campos={{ col: 'movimientos', id: m.id }} confirmar="¿Borrar este movimiento?" className="text-xs text-danger hover:underline">
                            Borrar
                          </BotonAccion>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Paginador pagina={pagina} total={conSaldo.length} porPagina={POR_PAGINA} base={(p) => url('/caja', sp, { p })} />
        </>
      )}
    </>
  )
}

function BotonReclasificar({ id, cats, actual }: { id: string; cats: string[]; actual: string }) {
  return (
    <FormAccion accion={accionReclasificar} boton="Clasificar" claseBoton="btn text-xs" limpiar={false}>
      <input type="hidden" name="id" value={id} />
      <Chip tono="ambar">{actual}</Chip>
      <select name="categoria" className="input mt-1 w-44 text-xs">
        {cats.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </FormAccion>
  )
}
