import { Chip, Encabezado, Paginador, Pestanas, url, Vacio } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { clienteAxis } from '@/lib/axis-servidor'
import { escrituraAxis, type OperacionTPV } from '@/lib/axispos'
import { monedasConTasa, operacionAjuste, prepararEnvioCompra, SERIE_INICIAL } from '@/lib/axispos-envio'
import { cargarDataset } from '@/lib/data'
import { hoy } from '@/lib/fecha'
import { prepararTasas, tasaVigente } from '@/lib/fx'
import { inventarioDerivado } from '@/lib/inventario'
import { params, type SP } from '@/lib/pagina'
import { compararCatalogo, cuadreExistencias, itemParaTPV } from '@/lib/sincro'
import type { Dataset } from '@/lib/types'

const f2 = (n: number | undefined) => (n == null ? '' : n.toLocaleString('es-ES', { maximumFractionDigits: 2 }))

const TABS = [
  { clave: 'catalogo', label: 'Catálogo' },
  { clave: 'tasa', label: 'Tasa' },
  { clave: 'compras', label: 'Compras al central' },
  { clave: 'existencias', label: 'Existencias' },
  { clave: 'ajustes', label: 'Ajustes de conteo' },
]

/**
 * Sincronización Kaluch ↔ AxisPOS en MODO ENSAYO: se lee del TPV y se muestra lo que se enviaría,
 * sin enviar nada. El envío real solo existe con AXISPOS_ESCRITURA=1 y autorización expresa.
 */
export default async function Sincronizacion({ searchParams }: { searchParams: SP }) {
  await requerirUsuario('integraciones')
  const sp = await params(searchParams)
  const tab = TABS.some((t) => t.clave === sp.tab) ? sp.tab! : 'catalogo'
  const ds = await cargarDataset()
  let cuerpo: React.ReactNode
  try {
    if (!ds.settings.axispos?.url) cuerpo = <Vacio>Configura primero la conexión con AxisPOS en Integraciones.</Vacio>
    else if (tab === 'catalogo') cuerpo = await Catalogo({ ds, sp })
    else if (tab === 'tasa') cuerpo = await Tasa({ ds, sp })
    else if (tab === 'compras') cuerpo = <Compras ds={ds} sp={sp} />
    else if (tab === 'ajustes') cuerpo = <Ajustes ds={ds} />
    else cuerpo = await Existencias({ ds, sp })
  } catch (e) {
    cuerpo = <div className="tarjeta border-l-4 border-l-danger p-4 text-sm">No se pudo leer el TPV: {e instanceof Error ? e.message : String(e)}</div>
  }
  return (
    <>
      <Encabezado
        titulo="Sincronización con AxisPOS"
        descripcion="Kaluch es el dueño del catálogo, la tasa y las compras del Almacén Central; el TPV, de las ventas, las compras de los locales y las cajas. Aquí se compara y se ve lo que se enviaría."
      />
      <div className={`tarjeta mb-4 border-l-4 p-3 text-sm ${escrituraAxis() ? 'border-l-danger' : 'border-l-primary'}`}>
        {escrituraAxis() ? (
          <>
            <strong>Escritura activada.</strong> Los envíos al TPV están permitidos.
          </>
        ) : (
          <>
            <strong>Modo ensayo.</strong> Solo se lee del TPV. Lo que ves abajo es lo que se enviaría; no se envía nada hasta que se autorice.
          </>
        )}
      </div>
      <Pestanas activa={tab} items={TABS.map((t) => ({ ...t, href: `/sincronizacion?tab=${t.clave}` }))} />
      {cuerpo}
    </>
  )
}

async function Catalogo({ ds, sp }: { ds: Dataset; sp: Record<string, string | undefined> }) {
  const items = await clienteAxis(ds).mercancias()
  const { altas, cambios, soloTPV } = compararCatalogo(ds.productos, items)
  // Las altas sin código del TPV son productos del Excel sin casar: se separan de los creados aquí.
  const nuevos = altas.filter((p) => p.modificado)
  const sinCasar = altas.filter((p) => !p.modificado)
  const porCodigo = new Map(items.map((i) => [String(i.Code), i]))
  const ver = sp.ver ?? 'cambios'
  const pagina = Math.max(1, Number(sp.p) || 1)
  const cambiados = [...new Set(cambios.map((c) => c.codigo))]
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[
          ['cambios', 'Cambios a pasar al TPV', `${cambios.length} en ${cambiados.length} productos`],
          ['altas', 'Altas nuevas', String(nuevos.length)],
          ['sincasar', 'Del Excel sin código TPV', String(sinCasar.length)],
          ['solotpv', 'Solo en el TPV', String(soloTPV.length)],
        ].map(([k, t, v]) => (
          <a key={k} href={url('/sincronizacion', { tab: 'catalogo' }, { ver: k })} className={`tarjeta p-3 ${ver === k ? 'border-primary' : ''}`}>
            <div className="text-xs text-muted-foreground">{t}</div>
            <div className="text-lg font-semibold">{v}</div>
          </a>
        ))}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        {items.length} mercancías en el TPV · {ds.productos.length} productos en Kaluch. Los cambios se hacen en Catálogos → Productos.
        {ver === 'sincasar' && ' Estos productos vienen de los Excel sin código del TPV: si son la misma mercancía, ponles el código del TPV; no se darían de alta.'}
        {ver === 'solotpv' && ' Estas mercancías existen en el TPV y no en Kaluch: no se tocan. Con «Traer catálogo» (Integraciones) pasan a Kaluch.'}
      </p>
      {ver === 'cambios' &&
        (cambios.length ? (
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Producto</th>
                  <th>Campo</th>
                  <th className="num">En el TPV</th>
                  <th className="num">Pasaría a</th>
                </tr>
              </thead>
              <tbody>
                {cambios.slice((pagina - 1) * 100, pagina * 100).map((c) => (
                  <tr key={`${c.codigo}${c.campo}`}>
                    <td className="text-xs text-muted-foreground">{c.codigo}</td>
                    <td>{c.nombre}</td>
                    <td>{c.campo}</td>
                    <td className="num">{c.tpv ?? '—'}</td>
                    <td className="num font-semibold">{c.kaluch}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Paginador pagina={pagina} total={cambios.length} porPagina={100} base={(p) => url('/sincronizacion', sp, { p })} />
          </div>
        ) : (
          <Vacio>El TPV ya tiene el mismo catálogo que Kaluch: no habría nada que enviar.</Vacio>
        ))}
      {ver === 'altas' &&
        (nuevos.length ? (
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Producto</th>
                  <th>Grupo</th>
                  <th className="num">Precio base</th>
                  <th>Registro que se enviaría</th>
                </tr>
              </thead>
              <tbody>
                {nuevos.map((p) => (
                  <tr key={p.nombre}>
                    <td className="text-xs">{p.codigo !== p.nombre ? p.codigo : <Chip tono="rojo">Falta código</Chip>}</td>
                    <td>{p.nombre}</td>
                    <td>{p.grupo}</td>
                    <td className="num">{p.precioCUP}</td>
                    <td className="max-w-md truncate font-mono text-[11px] text-muted-foreground">{JSON.stringify(itemParaTPV(p, porCodigo.get(p.codigo)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Vacio>No hay productos creados aquí pendientes de dar de alta en el TPV.</Vacio>
        ))}
      {(ver === 'sincasar' || ver === 'solotpv') && (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Grupo</th>
                <th className="num">Precio</th>
              </tr>
            </thead>
            <tbody>
              {(ver === 'sincasar' ? sinCasar.map((p) => ({ c: '', n: p.nombre, g: p.grupo, pr: p.precioCUP })) : soloTPV.map((i) => ({ c: i.Code, n: i.Name, g: i.Category, pr: i.Price })))
                .slice((pagina - 1) * 100, pagina * 100)
                .map((x) => (
                  <tr key={`${x.c}${x.n}`}>
                    <td className="text-xs text-muted-foreground">{x.c}</td>
                    <td>{x.n}</td>
                    <td className="text-xs">{x.g}</td>
                    <td className="num">{x.pr ?? ''}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <Paginador pagina={pagina} total={ver === 'sincasar' ? sinCasar.length : soloTPV.length} porPagina={100} base={(p) => url('/sincronizacion', sp, { p })} />
        </div>
      )}
    </>
  )
}

async function Tasa({ ds, sp }: { ds: Dataset; sp: Record<string, string | undefined> }) {
  const f = sp.fecha ?? hoy()
  const monedas = await clienteAxis(ds).monedas()
  let r: ReturnType<typeof monedasConTasa> | undefined
  let error: string | undefined
  try {
    r = monedasConTasa(monedas, prepararTasas(ds.tasas, ds.settings.margenTasa), f)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  return (
    <>
      <form action="/sincronizacion" className="mb-3 flex items-end gap-2">
        <input type="hidden" name="tab" value="tasa" />
        <label>
          <span className="etiqueta">Tasa del día</span>
          <input name="fecha" type="date" defaultValue={f} className="input" />
        </label>
        <button className="btn">Ver</button>
      </form>
      {error ? (
        <Vacio>{error}</Vacio>
      ) : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Moneda</th>
                <th className="num">En el TPV ahora</th>
                <th className="num">Se enviaría (Toque + {ds.settings.margenTasa})</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r!.cambios.map((c) => (
                <tr key={c.moneda}>
                  <td>{c.moneda}</td>
                  <td className="num">{f2(c.antes)}</td>
                  <td className="num font-semibold">{f2(c.despues)}</td>
                  <td>{c.antes === c.despues ? <Chip tono="verde">Igual</Chip> : <Chip tono="ambar">Cambiaría</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 pb-3 text-xs text-muted-foreground">Tasa de Kaluch del {r!.fechaTasa}. Solo se leyó el TPV.</p>
        </div>
      )}
    </>
  )
}

function Compras({ ds, sp }: { ds: Dataset; sp: Record<string, string | undefined> }) {
  const pendientes = ds.compras.filter((c) => c.tienda === 'almacen' && c.origen === 'manual' && !c.axis?.enviada).sort((a, b) => b.fecha.localeCompare(a.fecha))
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))
  const area = new Map((ds.settings.axispos?.ubicaciones ?? []).map((u) => [u.code, u.nombre]))
  const sel = pendientes.find((c) => c.id === sp.id) ?? pendientes[0]
  let preparado: ReturnType<typeof prepararEnvioCompra> | undefined
  let error: string | undefined
  if (sel)
    try {
      preparado = prepararEnvioCompra(ds, sel.id)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  if (!pendientes.length) return <Vacio>No hay compras del Almacén Central registradas aquí pendientes de pasar al TPV. Se registran en Compras eligiendo «Almacén Central».</Vacio>
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <div className="tarjeta max-h-[70vh] overflow-y-auto">
        {pendientes.map((c) => (
          <a key={c.id} href={url('/sincronizacion', { tab: 'compras' }, { id: c.id })} className={`block border-b border-border px-3 py-2 text-sm ${c.id === sel?.id ? 'bg-primary/5' : ''}`}>
            <div className="font-medium">{c.producto ?? '(sin producto)'}</div>
            <div className="text-xs text-muted-foreground">
              {c.fecha} · {c.proveedor ?? 'sin proveedor'} · {c.cantidad ?? '?'} u
            </div>
          </a>
        ))}
      </div>
      <div>
        {error && <div className="tarjeta mb-3 border-l-4 border-l-danger p-3 text-sm">{error}</div>}
        {preparado && (
          <div className="tarjeta overflow-x-auto">
            <h2 className="px-4 pt-3 text-sm font-semibold">Lo que se subiría al TPV ({preparado.docs.length} documentos)</h2>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Origen → destino</th>
                  <th>Mercancía</th>
                  <th className="num">Cant.</th>
                  <th className="num">Costo CUP</th>
                  <th className="num">Precio CUP</th>
                  <th>Pago</th>
                </tr>
              </thead>
              <tbody>
                {preparado.docs.map((d) => {
                  const o = d.op as OperacionTPV | undefined
                  const it = o?.Items?.[0]
                  return (
                    <tr key={d.id}>
                      <td>
                        {d.tipo === 'compra' ? 'Compra (1)' : 'Traslado (8)'} {o && <span className="text-xs text-muted-foreground">#{o.Acct}</span>}
                      </td>
                      {d.error ? (
                        <td colSpan={6}>
                          <Chip tono="rojo">No se podría enviar</Chip> <span className="text-sm">{d.error}</span>
                        </td>
                      ) : (
                        <>
                          <td className="text-xs">
                            {area.get(o!.ObjectCode!) ?? o!.ObjectCode}
                            {o!.TransferObjectCode ? ` → ${area.get(o!.TransferObjectCode) ?? o!.TransferObjectCode}` : o!.PartnerCode ? ` ← proveedor ${o!.PartnerCode}` : ''}
                          </td>
                          <td className="text-xs">
                            {it?.ItemCode} · {it?.ItemName}
                          </td>
                          <td className="num">{f2(it?.Qtty)}</td>
                          <td className="num">{f2(it?.PriceIn)}</td>
                          <td className="num">{f2(it?.Price)}</td>
                          <td className="text-xs">{o!.Payments?.length ? `Efectivo ${f2(o!.Payments[0].AmountTotal)} CUP` : '—'}</td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="px-4 pb-3 text-xs text-muted-foreground">
              Compra de {nombreT.get(preparado.compra.tienda)} · nota KA:{preparado.compra.id.slice(0, 8)}… (al volver del TPV se reconoce y no se duplica). Números de documento provisionales.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

async function Existencias({ ds, sp }: { ds: Dataset; sp: Record<string, string | undefined> }) {
  const tiendas = ds.tiendas.filter((t) => t.codigoTPV)
  const areas = tiendas.flatMap((t) => (t.codigoTPV ?? '').split(',').map((c) => c.trim()).filter(Boolean))
  const disponibles = await clienteAxis(ds).existencias(areas)
  const { filas, resumen } = cuadreExistencias(inventarioDerivado(ds), disponibles, ds.productos, tiendas)
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))
  const t = sp.t && nombreT.has(sp.t) ? sp.t : undefined
  const vista = filas.filter((f) => (!t || f.tienda === t) && Math.abs(f.diferencia) > 0.001)
  const pagina = Math.max(1, Number(sp.p) || 1)
  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        Existencias de Kaluch (compras − salidas) contra las del TPV ahora mismo. Mientras falten los saldos iniciales de algunas tiendas habrá diferencias grandes; cuando cuadren, aquí solo quedarán los descuadres reales.
      </p>
      <div className="tarjeta mb-4 overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Tienda</th>
              <th className="num">Productos</th>
              <th className="num">Coinciden</th>
              <th className="num">Distintos</th>
              <th className="num">Diferencia valorada USD</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {resumen.map((r) => (
              <tr key={r.tienda} className={t === r.tienda ? 'bg-primary/5' : ''}>
                <td>{nombreT.get(r.tienda)}</td>
                <td className="num">{r.productos}</td>
                <td className="num">{r.coinciden}</td>
                <td className="num">{r.distintos}</td>
                <td className="num">{f2(r.valorUSD)}</td>
                <td>
                  <a className="text-xs text-primary hover:underline" href={url('/sincronizacion', { tab: 'existencias' }, { t: r.tienda })}>
                    Ver
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Tienda</th>
              <th>Código</th>
              <th>Producto</th>
              <th className="num">Kaluch</th>
              <th className="num">TPV</th>
              <th className="num">Diferencia</th>
              <th className="num">USD</th>
            </tr>
          </thead>
          <tbody>
            {vista.slice((pagina - 1) * 100, pagina * 100).map((f) => (
              <tr key={`${f.tienda}${f.codigo}`}>
                <td>{nombreT.get(f.tienda)}</td>
                <td className="text-xs text-muted-foreground">{f.codigo}</td>
                <td>{f.producto}</td>
                <td className="num">{f2(f.kaluch)}</td>
                <td className="num">{f2(f.tpv)}</td>
                <td className={`num font-semibold ${f.diferencia < 0 ? 'text-danger' : ''}`}>{f2(f.diferencia)}</td>
                <td className="num">{f2(f.valorUSD)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Paginador pagina={pagina} total={vista.length} porPagina={100} base={(p) => url('/sincronizacion', sp, { p })} />
      </div>
    </>
  )
}

function Ajustes({ ds }: { ds: Dataset }) {
  const pendientes = ds.conteos.filter((c) => c.ajuste && !c.ajuste.axis?.enviada)
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))
  const area = new Map((ds.settings.axispos?.ubicaciones ?? []).map((u) => [u.code, u.nombre]))
  const t = tasaVigente(prepararTasas(ds.tasas, ds.settings.margenTasa), hoy())
  if (!pendientes.length) return <Vacio>No hay ajustes de conteo aprobados pendientes de pasar al TPV.</Vacio>
  let acct = ds.settings.axispos?.siguienteAcct ?? SERIE_INICIAL
  return (
    <>
      {pendientes.map((c) => {
        let op: OperacionTPV | undefined
        let error: string | undefined
        try {
          op = operacionAjuste(c, acct++, c.ajuste!.area, ds.settings.axispos?.usuarioCodigo ?? '', ds.productos, t?.cupUsd ?? 0)
        } catch (e) {
          error = e instanceof Error ? e.message : String(e)
        }
        return (
          <div key={c.id} className="tarjeta mb-3 overflow-x-auto">
            <h2 className="px-4 pt-3 text-sm font-semibold">
              Conteo #{c.numero} · {nombreT.get(c.tienda)} · {area.get(c.ajuste!.area) ?? c.ajuste!.area} · aprobado por {c.ajuste!.aprobadoPor} — Inventario (4) {op && `#${op.Acct}`}
            </h2>
            {error ? (
              <p className="px-4 pb-3 text-sm text-danger">{error}</p>
            ) : (
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Mercancía</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Costo CUP</th>
                    <th className="num">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {op!.Items!.map((it) => (
                    <tr key={it.ItemCode}>
                      <td className="text-xs text-muted-foreground">{it.ItemCode}</td>
                      <td>{it.ItemName}</td>
                      <td className={`num ${(it.Qtty ?? 0) < 0 ? 'text-danger' : ''}`}>{f2(it.Qtty)}</td>
                      <td className="num">{f2(it.PriceIn)}</td>
                      <td className="num">{f2(it.AmountTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </>
  )
}
