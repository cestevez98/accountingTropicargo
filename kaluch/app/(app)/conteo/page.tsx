import { accionConteoAbrir, accionConteoAprobarAjuste } from '../../acciones'
import { FormAccion } from '@/components/FormAccion'
import { Chip, Encabezado, Vacio, url } from '@/components/ui'
import { requerirUsuario, tiendaFija } from '@/lib/auth'
import { catalogoEscaner } from '@/lib/conteo'
import { cargarDataset, preferencias } from '@/lib/data'
import { params, type SP } from '@/lib/pagina'
import { revisaConteos } from '@/lib/permisos'
import { faltanteConteo } from '@/lib/nomina'
import { gruposPorTienda, precioEnTienda } from '@/lib/sincro'
import { prepararTasas, tasaVigente } from '@/lib/fx'
import { Escaner } from './Escaner'

const f2 = (n: number | undefined) => (n == null ? '' : n.toLocaleString('es-ES', { maximumFractionDigits: 2 }))

/** Conteo físico diario a ciegas con escáner. El trabajador cuenta; el resultado solo lo ve administración. */
export default async function Conteo({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('conteo')
  const sp = await params(searchParams)
  const ds = await cargarDataset()
  const admin = revisaConteos(s.rol)
  const fija = tiendaFija(s)
  const pref = await preferencias()
  const tiendas = ds.tiendas.filter((t) => t.activa && t.codigoTPV && (!fija || t.id === fija))
  const tienda = fija ?? (sp.t && tiendas.some((t) => t.id === sp.t) ? sp.t : pref.tienda && tiendas.some((t) => t.id === pref.tienda) ? pref.tienda : undefined)
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))
  const abierto = tienda ? ds.conteos.find((c) => c.tienda === tienda && c.estado === 'abierto') : undefined
  const sel = admin && sp.id ? ds.conteos.find((c) => c.id === sp.id && (!fija || c.tienda === fija)) : undefined
  const ubic = new Map((ds.settings.axispos?.ubicaciones ?? []).map((u) => [u.code, u]))
  const areaNombre = (c: string) => ubic.get(c)?.nombre ?? c
  // Piso de venta primero: es donde se cuenta normalmente.
  const areasTienda = (t: string) =>
    (ds.tiendas.find((x) => x.id === t)?.codigoTPV ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .sort((a, b) => (ubic.get(b)?.tipo === 7 ? 1 : 0) - (ubic.get(a)?.tipo === 7 ? 1 : 0))
      .map((c) => ({ code: c, nombre: areaNombre(c) }))
  const tasaHoy = tasaVigente(prepararTasas(ds.tasas, ds.settings.margenTasa), new Date().toISOString().slice(0, 10))?.cupUsd ?? 0
  const porCodigo = new Map(ds.productos.map((p) => [p.codigo, p]))
  // El faltante se descuenta a precio de venta de la tienda (si no lo hay, a costo).
  const grupos = gruposPorTienda(ds.tiendas, ds.settings.axispos?.ubicaciones)
  const faltanteCUP = (c: (typeof ds.conteos)[number]) =>
    faltanteConteo(c, (cod, usd) => {
      const p = porCodigo.get(cod)
      return (p && precioEnTienda(p, grupos.get(c.tienda))) || p?.costoCUP || (p?.costoUSD ?? usd ?? 0) * tasaHoy
    })
  // Quienes cerraron turno en la tienda últimamente (para descontarles un faltante).
  const trabajadoresTienda = (t: string) => [...new Set(ds.arqueos.filter((a) => a.tienda === t && a.cajero).slice(0, 30).map((a) => a.cajero!))]
  const historia = ds.conteos.filter((c) => c.estado === 'cerrado' && (!fija || c.tienda === fija)).slice(0, 60)

  if (sel?.resultado || sel?.errorSistema) {
    const conDif = (sel.resultado ?? []).filter((r) => r.diferencia)
    const valor = conDif.reduce((a, r) => a + r.diferencia * (r.costoUSD ?? 0), 0)
    return (
      <>
        <Encabezado titulo={`Conteo #${sel.numero} · ${nombreT.get(sel.tienda)}`} descripcion={`${sel.fecha} · ${sel.nombreUsuario ?? sel.usuario} · cerrado ${sel.cierre?.slice(11, 16)} (hora UTC). Existencias del TPV leídas al cerrar.`}>
          <a className="btn" href="/conteo">
            Volver
          </a>
        </Encabezado>
        {sel.errorSistema && <div className="tarjeta mb-3 border-l-4 border-l-danger p-3 text-sm">No se pudo comparar con el TPV: {sel.errorSistema}</div>}
        {sel.resultado && conDif.length > 0 && (
          <div className="tarjeta mb-3 p-3 text-sm">
            {sel.ajuste ? (
              <>
                Ajuste aprobado por <b>{sel.ajuste.aprobadoPor}</b> el {sel.ajuste.aprobadoEn.slice(0, 10)} en el área {areaNombre(sel.ajuste.area)} ·{' '}
                {sel.ajuste.axis?.enviada ? <Chip tono="verde">Pasado al TPV</Chip> : <Chip tono="ambar">Pendiente de pasar al TPV</Chip>}
              </>
            ) : (
              <FormAccion accion={accionConteoAprobarAjuste} boton="Aprobar ajuste" claseBoton="btn btn-exito" limpiar={false} confirmar={`¿Aprobar el ajuste de ${conDif.length} productos?`}>
                <input type="hidden" name="id" value={sel.id} />
                <div className="mb-2 grid gap-2 sm:grid-cols-2">
                  <label>
                    <span className="etiqueta">Descontar el faltante a (opcional)</span>
                    <input name="descontarA" list="trabajadores" className="input" placeholder="Trabajador del turno" />
                    <datalist id="trabajadores">
                      {trabajadoresTienda(sel.tienda).map((x) => (
                        <option key={x} value={x} />
                      ))}
                    </datalist>
                  </label>
                  <label>
                    <span className="etiqueta">Importe a descontar (CUP)</span>
                    <input name="descuento" defaultValue={faltanteCUP(sel) || ''} inputMode="decimal" className="input text-right" />
                    <span className="text-xs text-muted-foreground">Faltante a precio de venta: {f2(faltanteCUP(sel))} CUP</span>
                  </label>
                </div>
                <label className="mr-2 inline-flex items-center gap-2">
                  Área donde se ajusta:
                  <select name="area" className="input w-auto">
                    {areasTienda(sel.tienda).map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.nombre}
                      </option>
                    ))}
                  </select>
                </label>
              </FormAccion>
            )}
            <p className="mt-1 text-xs text-muted-foreground">El ajuste se aplica en el TPV (dueño de las cantidades) y vuelve solo a la contabilidad en la sincronización. Mientras la integración esté en modo ensayo, hazlo en AxisPOS con estas cantidades.</p>
          </div>
        )}
        <div className="mb-3 text-sm">
          {sel.lineas.length} productos contados · <strong>{conDif.length}</strong> con diferencia · valor {f2(valor)} USD {sel.nota && <>· Nota: {sel.nota}</>}
        </div>
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto</th>
                <th className="num">Contado</th>
                <th className="num">TPV</th>
                <th className="num">Diferencia</th>
                <th className="num">USD</th>
              </tr>
            </thead>
            <tbody>
              {(sel.resultado ?? sel.lineas.map((l) => ({ ...l, contado: l.cantidad, sistema: undefined, diferencia: undefined, costoUSD: undefined })))
                .slice()
                .sort((a, b) => Math.abs(b.diferencia ?? 0) - Math.abs(a.diferencia ?? 0))
                .map((r) => (
                  <tr key={r.codigo}>
                    <td className="text-xs text-muted-foreground">{r.codigo}</td>
                    <td>{r.nombre}</td>
                    <td className="num">{f2(r.contado)}</td>
                    <td className="num">{f2(r.sistema)}</td>
                    <td className={`num font-semibold ${(r.diferencia ?? 0) < 0 ? 'text-danger' : (r.diferencia ?? 0) > 0 ? 'text-accent' : ''}`}>{f2(r.diferencia)}</td>
                    <td className="num">{r.diferencia && r.costoUSD ? f2(r.diferencia * r.costoUSD) : ''}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Diferencia = contado − TPV. Negativa: falta mercancía. Si se vendió durante el conteo, el TPV ya la descontó: lo mejor es contar antes de abrir o después de cerrar.</p>
      </>
    )
  }

  return (
    <>
      <Encabezado titulo="Conteo a ciegas" descripcion="Cuenta los productos con el escáner. No se muestra lo que dice el sistema: al terminar, administración compara lo contado con el TPV." />
      {!tiendas.length ? (
        <Vacio>No hay tiendas con áreas del TPV asignadas.</Vacio>
      ) : !tienda ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {tiendas.map((t) => (
            <a key={t.id} className="btn" href={url('/conteo', {}, { t: t.id })}>
              {t.nombre}
            </a>
          ))}
        </div>
      ) : abierto ? (
        <>
          <p className="mb-3 text-sm">
            <strong>{nombreT.get(tienda)}</strong> · conteo #{abierto.numero} abierto por {abierto.nombreUsuario ?? abierto.usuario} a las {abierto.inicio.slice(11, 16)} (UTC)
          </p>
          <Escaner id={abierto.id} numero={abierto.numero} inicial={abierto.lineas} catalogo={catalogoEscaner(ds.productos)} />
        </>
      ) : (
        <div className="tarjeta mx-auto max-w-xl p-4">
          <div className="text-sm">
            Tienda: <strong>{nombreT.get(tienda)}</strong>
            {!fija && (
              <a className="ml-2 text-xs text-primary hover:underline" href="/conteo?t=">
                cambiar
              </a>
            )}
          </div>
          <FormAccion accion={accionConteoAbrir} boton="Empezar conteo" claseBoton="btn btn-primario mt-3 w-full">
            <input type="hidden" name="tienda" value={tienda} />
          </FormAccion>
        </div>
      )}
      {historia.length > 0 && (
        <div className="tarjeta mt-6 overflow-x-auto">
          <h2 className="px-4 pt-3 text-sm font-semibold">Conteos terminados</h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>#</th>
                <th>Fecha</th>
                <th>Tienda</th>
                <th>Contó</th>
                <th className="num">Productos</th>
                {admin && <th className="num">Con diferencia</th>}
                {admin && <th>Ajuste</th>}
                {admin && <th />}
              </tr>
            </thead>
            <tbody>
              {historia.map((c) => (
                <tr key={c.id}>
                  <td>{c.numero}</td>
                  <td>{c.fecha}</td>
                  <td>{nombreT.get(c.tienda)}</td>
                  <td className="text-xs">{c.nombreUsuario ?? c.usuario}</td>
                  <td className="num">{c.lineas.length}</td>
                  {admin && <td className="num">{c.resultado ? c.resultado.filter((r) => r.diferencia).length : <Chip tono="rojo">Sin comparar</Chip>}</td>}
                  {admin && <td>{c.ajuste ? <Chip tono={c.ajuste.axis?.enviada ? 'verde' : 'ambar'}>{c.ajuste.axis?.enviada ? 'En el TPV' : 'Aprobado'}</Chip> : c.resultado?.some((r) => r.diferencia) ? <Chip tono="gris">Por revisar</Chip> : ''}</td>}
                  {admin && (
                    <td>
                      <a className="text-xs text-primary hover:underline" href={url('/conteo', {}, { id: c.id })}>
                        Ver
                      </a>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
