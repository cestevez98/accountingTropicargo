import { accionSalida } from '../../acciones'
import { FormAccion } from '@/components/FormAccion'
import { Filtros } from '@/components/Filtros'
import { Aviso, Encabezado, Importe, Paginador, url, Vacio } from '@/components/ui'
import { puedeRegistrar, requerirUsuario } from '@/lib/auth'
import { cargarContabilidad } from '@/lib/data'
import { hoy } from '@/lib/fecha'
import { inventarioDerivado } from '@/lib/inventario'
import { params, tiendaActiva, type SP } from '@/lib/pagina'

const POR_PAGINA = 150

export default async function Inventario({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('inventario')
  const sp = await params(searchParams)
  const { tienda } = await tiendaActiva(s)
  const { ds, idx } = await cargarContabilidad()
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))
  const q = sp.q?.toUpperCase()
  const todas = inventarioDerivado(ds, tienda)
  const filas = todas.filter((f) => (!q || f.producto.toUpperCase().includes(q)) && (!sp.neg || f.existencia < 0) && (!sp.dif || (f.existenciaRef != null && Math.abs(f.existenciaRef - f.existencia) > 0.0001)))
  const pagina = Math.max(1, Number(sp.p) || 1)
  const vista = filas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  const valor = todas.reduce((a, f) => a + (f.valorUSD ?? 0), 0)
  const negativos = todas.filter((f) => f.existencia < 0).length
  const difs = todas.filter((f) => f.existenciaRef != null && Math.abs(f.existenciaRef - f.existencia) > 0.0001).length
  const contable = idx.suma((c) => c === 'inventario', '9999-12', { tienda, acumulado: true })
  const registrar = puedeRegistrar(s, 'inventario')
  return (
    <>
      <Encabezado titulo="Inventario" descripcion="Existencias derivadas (compras − ventas ± mermas, consumo y devoluciones). No se importan: se calculan. Valor al costo promedio de compra." />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="tarjeta p-3">
          <div className="text-xs text-muted-foreground">Productos con movimiento</div>
          <div className="text-lg font-bold tabular-nums">{todas.length.toLocaleString('es-ES')}</div>
        </div>
        <div className="tarjeta p-3">
          <div className="text-xs text-muted-foreground">Valor a costo promedio</div>
          <div className="text-lg font-bold">
            <Importe v={valor} /> USD
          </div>
        </div>
        <div className="tarjeta p-3">
          <div className="text-xs text-muted-foreground">Saldo contable (mayor)</div>
          <div className="text-lg font-bold">
            <Importe v={contable} /> USD
          </div>
        </div>
        <div className="tarjeta p-3">
          <div className="text-xs text-muted-foreground">Existencia negativa</div>
          <div className={`text-lg font-bold ${negativos ? 'text-danger' : ''}`}>{negativos}</div>
        </div>
      </div>
      {difs > 0 && (
        <Aviso tono="info">
          La lista de inventario del Excel (último conteo) difiere en {difs} productos de la existencia calculada.{' '}
          <a className="font-semibold underline" href="/inventario?dif=1">
            Ver diferencias
          </a>
        </Aviso>
      )}
      {registrar && (
        <details className="tarjeta mb-4 p-4">
          <summary className="cursor-pointer text-sm font-semibold">Registrar ajuste / merma / consumo interno</summary>
          <FormAccion accion={accionSalida} className="mt-3">
            <div className="grid gap-3 sm:grid-cols-6">
              <label>
                <span className="etiqueta">Tipo</span>
                <select name="tipo" className="input">
                  <option value="merma">Merma</option>
                  <option value="consumo">Consumo interno</option>
                </select>
              </label>
              <label>
                <span className="etiqueta">Fecha</span>
                <input name="fecha" type="date" defaultValue={hoy()} className="input" />
              </label>
              <label>
                <span className="etiqueta">Tienda</span>
                <select name="tienda" defaultValue={tienda ?? 'km26'} className="input">
                  {ds.tiendas.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className="etiqueta">Producto</span>
                <input name="producto" list="productos-inv" className="input" required />
              </label>
              <label>
                <span className="etiqueta">Cantidad</span>
                <input name="cantidad" inputMode="decimal" className="input" required />
              </label>
              <label className="sm:col-span-3">
                <span className="etiqueta">Motivo</span>
                <input name="nota" className="input" />
              </label>
            </div>
            <datalist id="productos-inv">
              {todas.slice(0, 3000).map((f) => (
                <option key={`${f.producto}|${f.tienda}`} value={f.producto} />
              ))}
            </datalist>
          </FormAccion>
        </details>
      )}
      <Filtros
        base="/inventario"
        valores={sp}
        campos={[
          { nombre: 'q', label: 'Producto', ancho: 'w-64' },
          { nombre: 'neg', label: 'Solo negativos', tipo: 'select', opciones: [{ valor: '1', label: 'Sí' }], ancho: 'w-32' },
          { nombre: 'dif', label: 'Difiere del conteo', tipo: 'select', opciones: [{ valor: '1', label: 'Sí' }], ancho: 'w-36' },
        ]}
      />
      {!filas.length ? (
        <Vacio>Sin productos con estos filtros. El inventario se forma con las compras y las ventas.</Vacio>
      ) : (
        <>
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Tienda</th>
                  <th className="num">Entradas</th>
                  <th className="num">Ventas</th>
                  <th className="num">Ajustes</th>
                  <th className="num">Existencia</th>
                  <th className="num">Conteo Excel</th>
                  <th className="num">Costo prom. USD</th>
                  <th className="num">Valor USD</th>
                </tr>
              </thead>
              <tbody>
                {vista.map((f) => (
                  <tr key={`${f.producto}|${f.tienda}`} className={f.existencia < 0 ? 'bg-danger-soft' : ''}>
                    <td>
                      {f.existencia < 0 && <span title="Existencia negativa">⚠ </span>}
                      {f.producto}
                    </td>
                    <td>{nombreT.get(f.tienda) ?? f.tienda}</td>
                    <td className="num">{f.entradas.toLocaleString('es-ES')}</td>
                    <td className="num">{f.ventas.toLocaleString('es-ES')}</td>
                    <td className="num">{f.ajustes ? f.ajustes.toLocaleString('es-ES') : '–'}</td>
                    <td className={`num font-semibold ${f.existencia < 0 ? 'text-danger' : ''}`}>{f.existencia.toLocaleString('es-ES')}</td>
                    <td className="num text-muted-foreground">{f.existenciaRef ?? ''}</td>
                    <td className="num">
                      <Importe v={f.costo} />
                    </td>
                    <td className="num">
                      <Importe v={f.valorUSD} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginador pagina={pagina} total={filas.length} porPagina={POR_PAGINA} base={(p) => url('/inventario', sp, { p })} />
        </>
      )}
    </>
  )
}
