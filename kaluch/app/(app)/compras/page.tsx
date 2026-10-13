import { accionBorrar } from '../../acciones'
import { BotonAccion } from '@/components/FormAccion'
import { Filtros } from '@/components/Filtros'
import { Chip, Encabezado, Importe, Paginador, url, Vacio } from '@/components/ui'
import { puedeRegistrar, requerirUsuario } from '@/lib/auth'
import { cargarDataset } from '@/lib/data'
import { hoy } from '@/lib/fecha'
import { prepararTasas, tasaVigente } from '@/lib/fx'
import { params, tiendaActiva, type SP } from '@/lib/pagina'
import { PAGO_LABEL } from '@/lib/types'
import { FormCompra } from './FormCompra'

const POR_PAGINA = 100

export default async function Compras({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('compras')
  const sp = await params(searchParams)
  const { tienda } = await tiendaActiva(s)
  const ds = await cargarDataset()
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))
  const q = sp.q?.toUpperCase()
  const filas = ds.compras
    .filter(
      (c) =>
        (!tienda || c.tienda === tienda) &&
        (!sp.desde || c.fecha >= sp.desde) &&
        (!sp.hasta || c.fecha <= sp.hasta) &&
        (!sp.pago || c.pago === sp.pago) &&
        (!sp.proveedor || c.proveedor?.toUpperCase().includes(sp.proveedor.toUpperCase())) &&
        (!q || c.producto?.toUpperCase().includes(q) || c.factura?.toUpperCase().includes(q)),
    )
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
  const pagina = Math.max(1, Number(sp.p) || 1)
  const vista = filas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  const totalUSD = filas.reduce((a, c) => a + (c.importeUSD ?? 0), 0)
  const porPago = new Map<string, number>()
  for (const c of filas) porPago.set(c.pago, (porPago.get(c.pago) ?? 0) + (c.importeUSD ?? 0))
  const t = tasaVigente(prepararTasas(ds.tasas, ds.settings.margenTasa), hoy())
  const registrar = puedeRegistrar(s, 'compras')
  return (
    <>
      <Encabezado titulo="Compras" descripcion="Facturas de compra por producto. Entran al inventario contra el proveedor; lo pagado en el exterior y lo que llega de otros mercados queda como deuda con la Casa Matriz.">
        <a className="btn" href={`/api/exportar?tabla=compras&${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])}`}>
          Exportar a Excel
        </a>
      </Encabezado>
      {registrar && (
        <details className="tarjeta mb-4 p-4">
          <summary className="cursor-pointer text-sm font-semibold">+ Nueva compra</summary>
          <FormCompra
            tiendas={ds.tiendas.filter((x) => x.activa).map((x) => ({ id: x.id, nombre: x.nombre }))}
            tiendaDefecto={tienda ?? 'almacen'}
            tasaToque={t?.cupUsd}
            tasaTienda={t ? (t.kmCompra ?? t.cupUsd - ds.settings.margenTasa) : undefined}
            hoy={hoy()}
            pagos={Object.entries(PAGO_LABEL)}
          />
          <datalist id="productos">
            {ds.productos.slice(0, 3000).map((p) => (
              <option key={p.nombre} value={p.nombre} />
            ))}
          </datalist>
        </details>
      )}
      <Filtros
        base="/compras"
        valores={sp}
        campos={[
          { nombre: 'desde', label: 'Desde', tipo: 'date' },
          { nombre: 'hasta', label: 'Hasta', tipo: 'date' },
          { nombre: 'pago', label: 'Pago', tipo: 'select', opciones: Object.entries(PAGO_LABEL).map(([valor, label]) => ({ valor, label })) },
          { nombre: 'proveedor', label: 'Proveedor' },
          { nombre: 'q', label: 'Mercancía o factura', ancho: 'w-56' },
        ]}
      />
      {!filas.length ? (
        <Vacio>Importa o registra compras para poblar este libro.</Vacio>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <span className="tarjeta px-3 py-2">
              Total <b className="tabular-nums">{totalUSD.toLocaleString('es-ES', { maximumFractionDigits: 2 })} USD</b>
            </span>
            {[...porPago.entries()].map(([k, v]) => (
              <span key={k} className="tarjeta px-3 py-2 text-muted-foreground">
                {PAGO_LABEL[k as keyof typeof PAGO_LABEL] ?? k}: <b className="text-foreground tabular-nums">{v.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</b>
              </span>
            ))}
          </div>
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Mercado</th>
                  <th>Fecha</th>
                  <th>Mercancía</th>
                  <th>Proveedor</th>
                  <th>Factura</th>
                  <th className="num">Cant.</th>
                  <th>Moneda</th>
                  <th className="num">Precio</th>
                  <th className="num">Importe</th>
                  <th className="num">Importe USD</th>
                  <th>Pago</th>
                  <th title="Solo las compras y ventas marcadas Fiscal alimentan el módulo Fiscal.">Fiscal</th>
                  {registrar && <th />}
                </tr>
              </thead>
              <tbody>
                {vista.map((c) => (
                  <tr key={c.id}>
                    <td>{nombreT.get(c.tienda) ?? c.tienda}</td>
                    <td className="whitespace-nowrap">{c.fecha}</td>
                    <td>
                      {c.producto ?? c.nota}
                      {c.aporte && (
                        <Chip tono="info" title="Inventario inicial aportado como capital">
                          aporte
                        </Chip>
                      )}
                      {c.grupo && <Chip tono="azul">distribuida</Chip>}
                    </td>
                    <td>{c.proveedor}</td>
                    <td className="whitespace-nowrap">{c.factura}</td>
                    <td className="num">{c.cantidad ?? ''}</td>
                    <td>
                      <Chip tono={c.moneda === 'USD' ? 'azul' : c.moneda === 'CUP' ? 'gris' : 'info'}>{c.moneda}</Chip>
                    </td>
                    <td className="num">{c.cantidad ? <Importe v={c.importe / c.cantidad} /> : ''}</td>
                    <td className="num">
                      <Importe v={c.importe} />
                    </td>
                    <td className="num">
                      <Importe v={c.importeUSD} />
                    </td>
                    <td>
                      <Chip tono={c.pago === 'credito' ? 'ambar' : c.pago === 'exterior' ? 'info' : 'gris'}>{PAGO_LABEL[c.pago] ?? c.pago}</Chip>
                    </td>
                    <td>{c.fiscal ? <Chip tono="verde">Sí</Chip> : <span className="text-xs text-muted-foreground">No</span>}</td>
                    {registrar && (
                      <td>
                        {c.origen === 'manual' && (
                          <BotonAccion accion={accionBorrar} campos={{ col: 'compras', id: c.id }} confirmar="¿Borrar esta compra?" className="text-xs text-danger hover:underline">
                            Borrar
                          </BotonAccion>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginador pagina={pagina} total={filas.length} porPagina={POR_PAGINA} base={(p) => url('/compras', sp, { p })} />
        </>
      )}
    </>
  )
}
