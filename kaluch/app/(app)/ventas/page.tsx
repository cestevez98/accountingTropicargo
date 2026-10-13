import { accionBorrar, accionSalida } from '../../acciones'
import { BotonAccion, FormAccion } from '@/components/FormAccion'
import { Filtros } from '@/components/Filtros'
import { Chip, Encabezado, Importe, Paginador, url, Vacio } from '@/components/ui'
import { puedeRegistrar, requerirUsuario } from '@/lib/auth'
import { cargarDataset } from '@/lib/data'
import { hoy } from '@/lib/fecha'
import { params, tiendaActiva, type SP } from '@/lib/pagina'

const POR_PAGINA = 100
const TIPO = { venta: 'Venta', merma: 'Merma', consumo: 'Consumo interno', devolucion: 'Devolución' } as const
const ORIGEN = { importado: ['Importado', 'azul'], manual: ['Manual', 'ambar'], tpv: ['TPV', 'verde'], resumen: ['Resumen', 'gris'] } as const

export default async function Ventas({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('ventas')
  const sp = await params(searchParams)
  const { tienda } = await tiendaActiva(s)
  const ds = await cargarDataset()
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))
  const q = sp.q?.toUpperCase()
  const filas = ds.salidas
    .filter(
      (x) =>
        (!tienda || x.tienda === tienda) &&
        (!sp.desde || x.fecha >= sp.desde) &&
        (!sp.hasta || x.fecha <= sp.hasta) &&
        (!sp.tipo || x.tipo === sp.tipo) &&
        (!sp.op || x.operacion === sp.op) &&
        (!q || x.producto?.toUpperCase().includes(q)),
    )
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || Number(b.operacion ?? 0) - Number(a.operacion ?? 0))
  const pagina = Math.max(1, Number(sp.p) || 1)
  const vista = filas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  const tot = filas.reduce(
    (a, x) => {
      const signo = x.tipo === 'devolucion' ? -1 : 1
      if (x.tipo === 'venta' || x.tipo === 'devolucion') {
        a.cup += signo * (x.moneda === 'CUP' ? (x.importe ?? 0) : 0)
        a.usd += signo * ((x.ventaUSD ?? 0) + (x.ingresoTasaUSD ?? 0))
        a.cantidad += signo * (x.cantidad ?? 0)
      }
      a.costo += signo * (x.costoUSD ?? 0)
      return a
    },
    { cup: 0, usd: 0, costo: 0, cantidad: 0 },
  )
  const ops = new Set(filas.filter((x) => x.tipo === 'venta').map((x) => `${x.tienda}|${x.fecha}|${x.operacion}`)).size
  const registrar = puedeRegistrar(s, 'ventas')
  const tiendasForm = ds.tiendas.filter((t) => t.activa)
  return (
    <>
      <Encabezado titulo="Ventas" descripcion="Ventas, mermas, consumo interno y devoluciones (tabla «Salidas» del Excel o del TPV). El costo sale de la línea o del costo promedio de compra.">
        <a className="btn" href={`/api/exportar?tabla=ventas&${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])}`}>
          Exportar a Excel
        </a>
      </Encabezado>
      {registrar && (
        <details className="tarjeta mb-4 p-4">
          <summary className="cursor-pointer text-sm font-semibold">+ Nueva venta manual o ajuste</summary>
          <FormAccion accion={accionSalida} className="mt-3">
            <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <label>
                <span className="etiqueta">Tipo</span>
                <select name="tipo" className="input">
                  {Object.entries(TIPO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="etiqueta">Fecha</span>
                <input name="fecha" type="date" defaultValue={hoy()} className="input" required />
              </label>
              <label>
                <span className="etiqueta">Tienda</span>
                <select name="tienda" defaultValue={tienda ?? 'km26'} className="input">
                  {tiendasForm.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="etiqueta">No. operación</span>
                <input name="operacion" className="input" />
              </label>
              <label className="sm:col-span-2">
                <span className="etiqueta">Producto</span>
                <input name="producto" list="productos" className="input" required />
              </label>
              <label>
                <span className="etiqueta">Cantidad</span>
                <input name="cantidad" inputMode="decimal" className="input" required />
              </label>
              <label>
                <span className="etiqueta">Importe cobrado</span>
                <input name="importe" inputMode="decimal" className="input" placeholder="solo ventas" />
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
                <span className="etiqueta">Costo USD (opcional)</span>
                <input name="costo" inputMode="decimal" className="input" placeholder="promedio" />
              </label>
              <label className="sm:col-span-2">
                <span className="etiqueta">Nota</span>
                <input name="nota" className="input" />
              </label>
            </div>
            <datalist id="productos">
              {ds.productos.slice(0, 3000).map((p) => (
                <option key={p.nombre} value={p.nombre} />
              ))}
            </datalist>
          </FormAccion>
        </details>
      )}
      <Filtros
        base="/ventas"
        valores={sp}
        campos={[
          { nombre: 'desde', label: 'Desde', tipo: 'date' },
          { nombre: 'hasta', label: 'Hasta', tipo: 'date' },
          { nombre: 'tipo', label: 'Operación', tipo: 'select', opciones: Object.entries(TIPO).map(([valor, label]) => ({ valor, label })) },
          { nombre: 'op', label: 'No. operación', ancho: 'w-28' },
          { nombre: 'q', label: 'Producto', ancho: 'w-56' },
        ]}
      />
      {!filas.length ? (
        <Vacio>Importa ventas para poblar este libro.</Vacio>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <div className="tarjeta p-3">
              <div className="text-xs text-muted-foreground">Operaciones de venta</div>
              <div className="text-lg font-bold tabular-nums">{ops.toLocaleString('es-ES')}</div>
            </div>
            <div className="tarjeta p-3">
              <div className="text-xs text-muted-foreground">Unidades vendidas</div>
              <div className="text-lg font-bold tabular-nums">{tot.cantidad.toLocaleString('es-ES')}</div>
            </div>
            <div className="tarjeta p-3">
              <div className="text-xs text-muted-foreground">Importe CUP</div>
              <div className="text-lg font-bold">
                <Importe v={tot.cup} dec={0} />
              </div>
            </div>
            <div className="tarjeta p-3">
              <div className="text-xs text-muted-foreground">Venta USD (tasa Toque)</div>
              <div className="text-lg font-bold">
                <Importe v={tot.usd} />
              </div>
            </div>
            <div className="tarjeta p-3">
              <div className="text-xs text-muted-foreground">Costo USD · margen</div>
              <div className="text-lg font-bold">
                <Importe v={tot.costo} /> <span className="text-sm text-muted-foreground">{tot.usd ? `${(((tot.usd - tot.costo) / tot.usd) * 100).toFixed(1)} %` : ''}</span>
              </div>
            </div>
          </div>
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Mercado</th>
                  <th>No. Op.</th>
                  <th>Fecha</th>
                  <th>Operación</th>
                  <th>Mercancía</th>
                  <th className="num">Cant.</th>
                  <th className="num">Precio CUP</th>
                  <th className="num">Importe CUP</th>
                  <th className="num">Importe USD</th>
                  <th className="num">Costo USD</th>
                  <th>Origen</th>
                  {registrar && <th />}
                </tr>
              </thead>
              <tbody>
                {vista.map((x) => {
                  const usd = (x.ventaUSD ?? 0) + (x.ingresoTasaUSD ?? 0)
                  const bajoCosto = x.tipo === 'venta' && x.costoUSD != null && usd > 0 && x.costoUSD > usd
                  const [o, tono] = ORIGEN[x.origen]
                  return (
                    <tr key={x.id} className={bajoCosto ? 'bg-danger-soft' : ''} title={bajoCosto ? 'Vendido por debajo del costo' : undefined}>
                      <td>{nombreT.get(x.tienda) ?? x.tienda}</td>
                      <td>
                        {x.operacion && (
                          <a className="text-primary hover:underline" href={url('/ventas', {}, { op: x.operacion, desde: x.fecha, hasta: x.fecha })}>
                            {x.operacion}
                          </a>
                        )}
                      </td>
                      <td className="whitespace-nowrap">{x.fecha}</td>
                      <td>{x.tipo === 'venta' ? 'Venta' : <Chip tono={x.tipo === 'devolucion' ? 'info' : 'ambar'}>{TIPO[x.tipo]}</Chip>}</td>
                      <td>{x.producto ?? x.nota}</td>
                      <td className="num">{x.cantidad ?? ''}</td>
                      <td className="num">{x.cantidad && x.importe ? <Importe v={x.importe / x.cantidad} /> : ''}</td>
                      <td className="num">{x.moneda === 'CUP' ? <Importe v={x.importe} /> : x.importe ? `${x.importe} ${x.moneda}` : ''}</td>
                      <td className="num">{x.tipo === 'venta' || x.tipo === 'devolucion' ? <Importe v={usd} /> : ''}</td>
                      <td className="num">
                        <Importe v={x.costoUSD} />
                      </td>
                      <td>
                        <Chip tono={tono}>{o}</Chip>
                      </td>
                      {registrar && (
                        <td>
                          {x.origen === 'manual' && (
                            <BotonAccion accion={accionBorrar} campos={{ col: 'salidas', id: x.id }} confirmar="¿Borrar esta línea?" className="text-xs text-danger hover:underline">
                              Borrar
                            </BotonAccion>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Paginador pagina={pagina} total={filas.length} porPagina={POR_PAGINA} base={(p) => url('/ventas', sp, { p })} />
        </>
      )}
    </>
  )
}
