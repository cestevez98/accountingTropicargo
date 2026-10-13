import { accionCategoria, accionProducto, accionSettings, accionTienda, accionUsuario, accionVaciar } from '../../acciones'
import { FormAccion } from '@/components/FormAccion'
import { Chip, Encabezado, Paginador, Pestanas, url } from '@/components/ui'
import { puedeRegistrar, requerirUsuario } from '@/lib/auth'
import { ETIQUETA_CUENTA, LINEA_LABEL, TIPO_ENTIDAD_LABEL } from '@/lib/catalogo'
import { cargarDataset, leerAuditoria, leerUsuarios } from '@/lib/data'
import { params, type SP } from '@/lib/pagina'
import { ROLES, ROLES_LISTA } from '@/lib/permisos'
import type { Categoria, Tienda } from '@/lib/types'

const FLUJO = { explotacion: 'Explotación', inversion: 'Inversión', financiacion: 'Financiación', interno: 'Interno' }

export default async function Catalogos({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('catalogos')
  const sp = await params(searchParams)
  const admin = s.rol === 'propietario' || s.rol === 'admin'
  const tabs = [
    { clave: 'tiendas', label: 'Tiendas' },
    { clave: 'categorias', label: 'Categorías' },
    { clave: 'productos', label: 'Productos' },
    ...(admin ? [{ clave: 'usuarios', label: 'Usuarios' }, { clave: 'config', label: 'Configuración' }, { clave: 'auditoria', label: 'Auditoría' }] : []),
  ]
  const tab = tabs.some((t) => t.clave === sp.tab) ? sp.tab! : 'tiendas'
  const ds = await cargarDataset()
  const editar = puedeRegistrar(s, 'catalogos')
  let cuerpo: React.ReactNode = null

  if (tab === 'tiendas') {
    const sel = ds.tiendas.find((t) => t.id === sp.id)
    cuerpo = (
      <>
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Dirección</th>
                <th>Alias en Excel / TPV</th>
                <th>Código TPV</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ds.tiendas.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium">{t.nombre}</td>
                  <td>
                    <Chip tono="azul">{TIPO_ENTIDAD_LABEL[t.tipo]}</Chip>
                  </td>
                  <td>{t.direccion}</td>
                  <td className="text-xs">{t.alias?.join(', ')}</td>
                  <td>{t.codigoTPV}</td>
                  <td>{t.activa ? <Chip tono="verde">Activa</Chip> : <Chip>Inactiva</Chip>}</td>
                  <td>
                    {editar && (
                      <a className="text-xs text-primary hover:underline" href={`/catalogos?tab=tiendas&id=${t.id}`}>
                        Editar
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editar && <FormTienda key={sel?.id ?? 'nueva'} t={sel} />}
      </>
    )
  } else if (tab === 'categorias') {
    const sel = ds.categorias.find((c) => c.nombre === sp.id)
    cuerpo = (
      <>
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Va a</th>
                <th>Grupo de flujo</th>
                <th>Caja</th>
                <th>Banco</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ds.categorias.map((c) => (
                <tr key={c.nombre}>
                  <td className="font-medium">{c.nombre}</td>
                  <td className="text-sm">{c.contrapartida === 'resultado' ? `ER · ${LINEA_LABEL[c.linea ?? 'gasto_admin']} › ${c.rubro}` : `Balance · ${ETIQUETA_CUENTA[c.contrapartida] ?? c.contrapartida}`}</td>
                  <td>{FLUJO[c.flujo]}</td>
                  <td>{c.caja ? '✓' : ''}</td>
                  <td>{c.banco ? '✓' : ''}</td>
                  <td>{c.activa ? <Chip tono="verde">Activa</Chip> : <Chip>Inactiva</Chip>}</td>
                  <td>
                    {editar && (
                      <a className="text-xs text-primary hover:underline" href={`/catalogos?tab=categorias&id=${encodeURIComponent(c.nombre)}`}>
                        Editar
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editar && <FormCategoria key={sel?.nombre ?? 'nueva'} c={sel} />}
      </>
    )
  } else if (tab === 'productos') {
    const q = sp.q?.toUpperCase()
    const filas = ds.productos.filter((p) => !q || p.nombre.includes(q) || p.codigo.toUpperCase().includes(q)).sort((a, b) => a.nombre.localeCompare(b.nombre))
    const pagina = Math.max(1, Number(sp.p) || 1)
    cuerpo = (
      <>
        <form action="/catalogos" className="mb-3 flex gap-2">
          <input type="hidden" name="tab" value="productos" />
          <input name="q" defaultValue={sp.q} placeholder="Buscar producto" className="input max-w-sm" />
          <button className="btn">Buscar</button>
        </form>
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Grupo</th>
                <th>Unidad</th>
                <th className="num">Costo ref. USD</th>
                <th className="num">Precio CUP</th>
                <th className="num">Existencia (Excel)</th>
              </tr>
            </thead>
            <tbody>
              {filas.slice((pagina - 1) * 100, pagina * 100).map((p) => (
                <tr key={p.nombre}>
                  <td className="text-xs text-muted-foreground">{p.codigo !== p.nombre ? p.codigo : ''}</td>
                  <td>{p.nombre}</td>
                  <td>{p.grupo}</td>
                  <td>{p.unidad}</td>
                  <td className="num">{p.costoUSD ?? ''}</td>
                  <td className="num">{p.precioCUP ?? ''}</td>
                  <td className="num">{p.existenciaRef ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Paginador pagina={pagina} total={filas.length} porPagina={100} base={(p) => url('/catalogos', sp, { p })} />
        {editar && (
          <div className="tarjeta mt-4 p-4">
            <h2 className="text-sm font-semibold">Nuevo producto / editar por nombre</h2>
            <FormAccion accion={accionProducto} className="mt-3">
              <div className="grid gap-3 sm:grid-cols-6">
                <label>
                  <span className="etiqueta">Código</span>
                  <input name="codigo" className="input" />
                </label>
                <label className="sm:col-span-2">
                  <span className="etiqueta">Nombre</span>
                  <input name="nombre" className="input" required />
                </label>
                <label>
                  <span className="etiqueta">Grupo</span>
                  <input name="grupo" className="input" />
                </label>
                <label>
                  <span className="etiqueta">Costo ref. USD</span>
                  <input name="costoUSD" inputMode="decimal" className="input" />
                </label>
                <label>
                  <span className="etiqueta">Precio CUP</span>
                  <input name="precioCUP" inputMode="decimal" className="input" />
                </label>
              </div>
            </FormAccion>
          </div>
        )}
      </>
    )
  } else if (tab === 'usuarios') {
    const usuarios = await leerUsuarios()
    const sel = usuarios.find((u) => u.id === sp.id)
    cuerpo = (
      <>
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Tiendas</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.nombre}</td>
                  <td>{u.email}</td>
                  <td>
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: ROLES[u.rol].color }}>
                      {ROLES[u.rol].label}
                    </span>
                  </td>
                  <td className="text-xs">{u.tiendas?.map((t) => ds.tiendas.find((x) => x.id === t)?.nombre ?? t).join(', ')}</td>
                  <td>{u.activo ? <Chip tono="verde">Activo</Chip> : <Chip>Inactivo</Chip>}</td>
                  <td>
                    <a className="text-xs text-primary hover:underline" href={`/catalogos?tab=usuarios&id=${u.id}`}>
                      Editar
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tarjeta mt-4 p-4" key={sel?.id ?? 'nuevo'}>
          <h2 className="text-sm font-semibold">{sel ? `Editar ${sel.email}` : 'Nuevo usuario'}</h2>
          <FormAccion accion={accionUsuario} className="mt-3" limpiar={!sel}>
            <div className="grid gap-3 sm:grid-cols-3">
              <label>
                <span className="etiqueta">Nombre</span>
                <input name="nombre" defaultValue={sel?.nombre} className="input" required />
              </label>
              <label>
                <span className="etiqueta">Correo</span>
                <input name="email" type="email" defaultValue={sel?.email} readOnly={Boolean(sel)} className="input" required />
              </label>
              <label>
                <span className="etiqueta">{sel ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'}</span>
                <input name="password" type="password" autoComplete="new-password" className="input" />
              </label>
              <label>
                <span className="etiqueta">Rol</span>
                <select name="rol" defaultValue={sel?.rol ?? 'contador_tienda'} className="input">
                  {ROLES_LISTA.map((r) => (
                    <option key={r} value={r}>
                      {ROLES[r].label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="etiqueta">Tiendas (contador de tienda)</span>
                <select name="tiendas" multiple defaultValue={sel?.tiendas ?? []} className="input h-24">
                  {ds.tiendas.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" name="activo" defaultChecked={sel?.activo ?? true} /> Activo
              </label>
            </div>
          </FormAccion>
        </div>
      </>
    )
  } else if (tab === 'config') {
    const st = ds.settings
    cuerpo = (
      <div className="space-y-4">
        <div className="tarjeta p-4">
          <h2 className="text-sm font-semibold">Parámetros contables</h2>
          <FormAccion accion={accionSettings} className="mt-3" limpiar={false}>
            <div className="grid gap-3 sm:grid-cols-4">
              <label>
                <span className="etiqueta">Empresa</span>
                <input name="empresa" defaultValue={st.empresa} className="input" />
              </label>
              <label>
                <span className="etiqueta">Inicio de la contabilidad</span>
                <input name="fechaInicio" type="date" defaultValue={st.fechaInicio} className="input" />
              </label>
              <label>
                <span className="etiqueta">Margen de la tasa de tienda (CUP)</span>
                <input name="margenTasa" defaultValue={st.margenTasa} className="input" />
              </label>
              <label>
                <span className="etiqueta">Impuesto sobre ventas por banco (%)</span>
                <input name="impuestoVentas" defaultValue={st.impuestoVentas * 100} className="input" />
              </label>
              <label>
                <span className="etiqueta">Margen mínimo por producto (%)</span>
                <input name="margenMinimo" defaultValue={st.margenMinimo * 100} className="input" />
              </label>
              <label>
                <span className="etiqueta">% reinversión por defecto</span>
                <input name="pctReinversionDefecto" defaultValue={st.pctReinversionDefecto * 100} className="input" />
              </label>
              <label>
                <span className="etiqueta">% inversionista por defecto</span>
                <input name="pctInversionistaDefecto" defaultValue={st.pctInversionistaDefecto * 100} className="input" />
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" name="revaluar" defaultChecked={st.revaluar} /> Revaluar CUP/EUR/MLC al cierre de mes
              </label>
            </div>
          </FormAccion>
        </div>
        {s.rol === 'propietario' && (
          <div className="tarjeta border-danger/40 p-4">
            <h2 className="text-sm font-semibold text-danger">Vaciar datos operativos</h2>
            <p className="mt-1 text-sm text-muted-foreground">Borra tasas, movimientos, ventas, compras, deudas, asientos, productos e importaciones. Se conservan usuarios, tiendas, categorías y configuración. Útil para volver a importar desde cero.</p>
            <FormAccion accion={accionVaciar} boton="Vaciar" claseBoton="btn btn-peligro" className="mt-3">
              <input name="confirmacion" placeholder="Escribe VACIAR" className="input max-w-xs" />
            </FormAccion>
          </div>
        )}
      </div>
    )
  } else if (tab === 'auditoria') {
    const aud = await leerAuditoria()
    const pagina = Math.max(1, Number(sp.p) || 1)
    cuerpo = (
      <>
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Tabla</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {aud.slice((pagina - 1) * 100, pagina * 100).map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap">{a.ts.slice(0, 19).replace('T', ' ')}</td>
                  <td>{a.usuario}</td>
                  <td>{a.accion}</td>
                  <td>{a.coleccion}</td>
                  <td className="max-w-xl truncate text-xs" title={a.detalle}>
                    {a.ref} {a.detalle}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Paginador pagina={pagina} total={aud.length} porPagina={100} base={(p) => url('/catalogos', sp, { p })} />
      </>
    )
  }
  return (
    <>
      <Encabezado titulo="Catálogos" descripcion="Tiendas y entidades del grupo, categorías (deciden a qué renglón del ER o del balance va cada movimiento), productos, usuarios y configuración." />
      <Pestanas activa={tab} items={tabs.map((t) => ({ ...t, href: `/catalogos?tab=${t.clave}` }))} />
      {cuerpo}
    </>
  )
}

function FormTienda({ t }: { t?: Tienda }) {
  return (
    <div className="tarjeta mt-4 p-4">
      <h2 className="text-sm font-semibold">{t ? `Editar ${t.nombre}` : 'Nueva tienda / entidad'}</h2>
      <FormAccion accion={accionTienda} className="mt-3" limpiar={!t}>
        {t && <input type="hidden" name="id" value={t.id} />}
        <div className="grid gap-3 sm:grid-cols-6">
          <label>
            <span className="etiqueta">Nombre</span>
            <input name="nombre" defaultValue={t?.nombre} className="input" required />
          </label>
          <label>
            <span className="etiqueta">Tipo</span>
            <select name="tipo" defaultValue={t?.tipo ?? 'local'} className="input">
              {Object.entries(TIPO_ENTIDAD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="etiqueta">Dirección</span>
            <input name="direccion" defaultValue={t?.direccion} className="input" />
          </label>
          <label className="sm:col-span-2">
            <span className="etiqueta">Alias (separados por coma)</span>
            <input name="alias" defaultValue={t?.alias?.join(', ')} className="input" />
          </label>
          <label>
            <span className="etiqueta">Código TPV (ObjectCode)</span>
            <input name="codigoTPV" defaultValue={t?.codigoTPV} className="input" />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" name="activa" defaultChecked={t?.activa ?? true} /> Activa
          </label>
        </div>
      </FormAccion>
    </div>
  )
}

function FormCategoria({ c }: { c?: Categoria }) {
  return (
    <div className="tarjeta mt-4 p-4">
      <h2 className="text-sm font-semibold">{c ? `Editar ${c.nombre}` : 'Nueva categoría'}</h2>
      <FormAccion accion={accionCategoria} className="mt-3" limpiar={!c}>
        <div className="grid gap-3 sm:grid-cols-6">
          <label>
            <span className="etiqueta">Nombre</span>
            <input name="nombre" defaultValue={c?.nombre} readOnly={Boolean(c)} className="input" required />
          </label>
          <label>
            <span className="etiqueta">Va a</span>
            <select name="contrapartida" defaultValue={c?.contrapartida ?? 'resultado'} className="input">
              <option value="resultado">Estado de Resultados</option>
              {Object.entries(ETIQUETA_CUENTA)
                .filter(([k]) => !['inventario', 'dividendos_declarados'].includes(k))
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    Balance · {v}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span className="etiqueta">Línea del ER</span>
            <select name="linea" defaultValue={c?.linea ?? 'gasto_admin'} className="input">
              {Object.entries(LINEA_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="etiqueta">Renglón del ER</span>
            <input name="rubro" defaultValue={c?.rubro} placeholder="p. ej. Otros gastos" className="input" />
          </label>
          <label>
            <span className="etiqueta">Grupo de flujo</span>
            <select name="flujo" defaultValue={c?.flujo ?? 'explotacion'} className="input">
              {Object.entries(FLUJO).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-3 pb-2 text-sm">
            <label className="flex items-center gap-1">
              <input type="checkbox" name="caja" defaultChecked={c?.caja ?? true} /> Caja
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="banco" defaultChecked={c?.banco ?? true} /> Banco
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="activa" defaultChecked={c?.activa ?? true} /> Activa
            </label>
          </div>
        </div>
      </FormAccion>
    </div>
  )
}
