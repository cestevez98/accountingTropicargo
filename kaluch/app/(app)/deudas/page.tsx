import Link from 'next/link'
import { accionBorrar, accionDeuda, accionSaldarDeuda } from '../../acciones'
import { BotonAccion, FormAccion } from '@/components/FormAccion'
import { Chip, Encabezado, Importe, Pestanas, Vacio } from '@/components/ui'
import { puedeRegistrar, requerirUsuario } from '@/lib/auth'
import { cargarContabilidad } from '@/lib/data'
import { diasEntre, hoy } from '@/lib/fecha'
import { params, tiendaActiva, type SP } from '@/lib/pagina'

const CUENTAS = [
  { clave: 'cxp_proveedores', label: 'Proveedores', signo: -1 },
  { clave: 'casa_matriz', label: 'Casa Matriz', signo: -1 },
  { clave: 'impuestos_por_pagar', label: 'Impuestos', signo: -1 },
  { clave: 'dividendos_por_pagar', label: 'Dividendos', signo: -1 },
  { clave: 'cxc', label: 'CxC clientes', signo: 1 },
  { clave: 'ventas_por_depositar', label: 'Ventas por depositar', signo: 1 },
]

export default async function Deudas({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('deudas')
  const sp = await params(searchParams)
  const clase = sp.clase === 'cobrar' ? 'cobrar' : 'pagar'
  const { tienda } = await tiendaActiva(s)
  const { ds, mayor } = await cargarContabilidad()
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))
  // Saldo de cada cuenta de terceros por tienda, sacado del mayor (positivo = deuda a pagar / derecho a cobrar).
  const saldos = new Map<string, number>()
  for (const l of mayor.lineas) {
    if (!CUENTAS.some((c) => c.clave === l.cuenta)) continue
    const k = `${l.tienda}|${l.cuenta}`
    saldos.set(k, (saldos.get(k) ?? 0) + l.usd)
  }
  const tiendas = ds.tiendas.filter((t) => (!tienda || t.id === tienda) && CUENTAS.some((c) => Math.abs(saldos.get(`${t.id}|${c.clave}`) ?? 0) > 0.005))
  const docs = ds.deudas.filter((d) => d.clase === clase && (!tienda || d.tienda === tienda)).sort((a, b) => b.fecha.localeCompare(a.fecha))
  const registrar = puedeRegistrar(s, 'deudas')
  const tramo = (dias: number) => (dias <= 30 ? ['0–30 días', 'verde'] : dias <= 60 ? ['31–60 días', 'ambar'] : ['60+ días', 'rojo']) as [string, 'verde' | 'ambar' | 'rojo']
  return (
    <>
      <Encabezado titulo="Deudas" descripcion="Cuentas por pagar y por cobrar. Los saldos salen del libro mayor: compras a crédito, pagos de caja/banco, deudas con la Casa Matriz, impuestos y dividendos." />
      <div className="tarjeta mb-4 overflow-x-auto">
        <h2 className="px-4 pt-3 text-sm font-semibold">Saldos por tienda y contraparte (USD)</h2>
        <table className="tabla mt-2">
          <thead>
            <tr>
              <th>Entidad</th>
              {CUENTAS.map((c) => (
                <th key={c.clave} className="num">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiendas.map((t) => (
              <tr key={t.id}>
                <td className="font-medium">{t.nombre}</td>
                {CUENTAS.map((c) => {
                  const v = (saldos.get(`${t.id}|${c.clave}`) ?? 0) * c.signo
                  return (
                    <td key={c.clave} className="num">
                      <Link href={`/contabilidad?tab=submayor&cuenta=${c.clave}`} className="hover:underline">
                        <Importe v={v} />
                      </Link>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-2 text-xs text-muted-foreground">Un saldo negativo en una cuenta por pagar es un anticipo (se pagó más de lo registrado como deuda). Casa Matriz positiva = le debemos; negativa = nos debe.</p>
      </div>
      <Pestanas
        activa={clase}
        items={[
          { clave: 'pagar', label: 'Cuentas por pagar', href: '/deudas' },
          { clave: 'cobrar', label: 'Cuentas por cobrar', href: '/deudas?clase=cobrar' },
        ]}
      />
      {registrar && (
        <details className="tarjeta mb-4 p-4">
          <summary className="cursor-pointer text-sm font-semibold">+ Registrar deuda {clase === 'pagar' ? 'por pagar' : 'por cobrar'}</summary>
          <FormAccion accion={accionDeuda} className="mt-3">
            <input type="hidden" name="clase" value={clase} />
            <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <label>
                <span className="etiqueta">Fecha</span>
                <input name="fecha" type="date" defaultValue={hoy()} className="input" required />
              </label>
              <label>
                <span className="etiqueta">Vence</span>
                <input name="vence" type="date" className="input" />
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
              <label>
                <span className="etiqueta">Contraparte</span>
                <input name="contraparte" list="contrapartes" defaultValue="Casa Matriz" className="input" />
              </label>
              <label className="sm:col-span-2">
                <span className="etiqueta">Categoría</span>
                <select name="categoria" className="input">
                  {ds.categorias
                    .filter((c) => c.activa)
                    .map((c) => (
                      <option key={c.nombre}>{c.nombre}</option>
                    ))}
                </select>
              </label>
              <label>
                <span className="etiqueta">Moneda</span>
                <select name="moneda" className="input">
                  <option>USD</option>
                  <option>CUP</option>
                  <option>EUR</option>
                  <option>MLC</option>
                </select>
              </label>
              <label>
                <span className="etiqueta">Monto</span>
                <input name="monto" inputMode="decimal" className="input" required />
              </label>
              <label className="sm:col-span-3">
                <span className="etiqueta">Concepto</span>
                <input name="concepto" className="input" />
              </label>
            </div>
            <datalist id="contrapartes">
              <option value="Casa Matriz" />
              {ds.tiendas.map((t) => (
                <option key={t.id} value={t.nombre} />
              ))}
            </datalist>
          </FormAccion>
        </details>
      )}
      {!docs.length ? (
        <Vacio>No hay deudas registradas {clase === 'pagar' ? 'por pagar' : 'por cobrar'} fuera de caja.</Vacio>
      ) : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Mercado</th>
                <th>Contraparte</th>
                <th>Categoría</th>
                <th>Concepto</th>
                <th>Moneda</th>
                <th className="num">Monto</th>
                <th className="num">{clase === 'pagar' ? 'Pagado' : 'Cobrado'}</th>
                <th className="num">Saldo</th>
                <th>Antigüedad</th>
                {registrar && <th />}
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const saldo = d.monto - (d.saldado ?? 0)
                const [label, tono] = tramo(diasEntre(d.vence ?? d.fecha, hoy()))
                return (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap">{d.fecha}</td>
                    <td>{nombreT.get(d.tienda) ?? d.tienda}</td>
                    <td>
                      <Chip tono={/casa matriz/i.test(d.contraparte) ? 'azul' : 'gris'}>{d.contraparte}</Chip>
                    </td>
                    <td className="text-xs">{d.categoria}</td>
                    <td>{d.concepto}</td>
                    <td>{d.moneda}</td>
                    <td className="num">
                      <Importe v={d.monto} />
                    </td>
                    <td className="num">
                      {registrar ? (
                        <FormAccion accion={accionSaldarDeuda} boton="✓" claseBoton="btn px-2 py-0.5 text-xs" limpiar={false}>
                          <input type="hidden" name="id" value={d.id} />
                          <input name="saldado" defaultValue={d.saldado ?? 0} inputMode="decimal" className="input w-24 text-right" />
                        </FormAccion>
                      ) : (
                        <Importe v={d.saldado} />
                      )}
                    </td>
                    <td className="num font-semibold">
                      <Importe v={saldo} />
                    </td>
                    <td>{saldo > 0.005 ? <Chip tono={tono}>{label}</Chip> : <Chip tono="verde">Saldada</Chip>}</td>
                    {registrar && (
                      <td>
                        <BotonAccion accion={accionBorrar} campos={{ col: 'deudas', id: d.id }} confirmar="¿Borrar esta deuda?" className="text-xs text-danger hover:underline">
                          Borrar
                        </BotonAccion>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-muted-foreground">El pago o cobro en efectivo se registra en Caja y Banco con su categoría; «Pagado» aquí solo sirve para seguir la antigüedad.</p>
        </div>
      )}
    </>
  )
}
