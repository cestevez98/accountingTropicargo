import { accionAxisArea, accionAxisConfig, accionAxisProbar, accionAxisProductos, accionAxisSync } from '../../acciones'
import { FormAccion } from '@/components/FormAccion'
import { Aviso, Chip, Encabezado } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { CAJA_TIPO, OPER_TYPE, OPER_TYPES_SYNC } from '@/lib/axispos'
import { cargarDataset } from '@/lib/data'
import { hoy } from '@/lib/fecha'

export default async function Integraciones() {
  await requerirUsuario('integraciones')
  const ds = await cargarDataset()
  const cfg = ds.settings.axispos
  const conCodigo = ds.tiendas.filter((t) => t.codigoTPV)
  const conectada = Boolean(cfg?.url && cfg.usuario && process.env.AXISPOS_PASSWORD)
  const lista = conectada && conCodigo.length > 0
  const areas = cfg?.ubicaciones ?? []
  // Fecha de corte sugerida: el día siguiente a la última venta que no vino del TPV (la del Excel).
  const ultimaExcel = ds.salidas.filter((x) => x.origen !== 'tpv').reduce((m, x) => (x.fecha > m ? x.fecha : m), '')
  const corte = ultimaExcel ? new Date(Date.parse(`${ultimaExcel}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : ds.settings.fechaInicio
  return (
    <>
      <Encabezado titulo="Integraciones" descripcion="Conexión con AxisPOS / AxisCloud por el SyncApi (API de integración v2.1). Trae ventas, mermas, consumo interno, devoluciones, compras y los gastos e ingresos de caja de cada área." />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="tarjeta p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">1 · Conexión con el tenant</h2>
            {conectada ? <Chip tono="verde">Configurada</Chip> : <Chip tono="ambar">Pendiente</Chip>}
          </div>
          <FormAccion accion={accionAxisConfig} className="mt-3" limpiar={false}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="etiqueta">Dirección del tenant</span>
                <input name="url" defaultValue={cfg?.url} placeholder="https://kaluch.axissoft.cloud" className="input" />
              </label>
              <label>
                <span className="etiqueta">Usuario del tenant</span>
                <input name="usuario" defaultValue={cfg?.usuario} autoComplete="off" className="input" />
              </label>
              <div className="text-xs text-muted-foreground">
                <span className="etiqueta">Contraseña</span>
                {process.env.AXISPOS_PASSWORD ? '✓ definida en la variable AXISPOS_PASSWORD' : 'Defínela en Vercel como variable de entorno AXISPOS_PASSWORD (no se guarda en la base de datos).'}
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="cobros" defaultChecked={cfg?.cobros} /> Registrar en caja (efectivo) y banco (tarjeta/transferencia) los cobros de las ventas y los pagos de las compras del TPV
              </label>
              <label>
                <span className="etiqueta">Cuenta bancaria de los cobros</span>
                <input name="cuentaBanco" defaultValue={cfg?.cuentaBanco ?? 'FISCAL'} className="input" />
              </label>
              <label>
                <span className="etiqueta">Traer del TPV a partir del</span>
                <input name="desde" type="date" defaultValue={cfg?.desde ?? corte} className="input" />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Lo anterior a esa fecha ya entró con el Excel de la tienda; empezar antes duplicaría ventas y compras. Si marcas los cobros, deja de anotar a mano en caja las entregas de «VENTAS» de los días que vengan del TPV, o se contarán dos veces.</p>
          </FormAccion>
          <div className="mt-3 flex flex-wrap gap-2">
            <FormAccion accion={accionAxisProbar} boton="Probar conexión y leer áreas" claseBoton="btn" limpiar={false}>
              <span />
            </FormAccion>
            <FormAccion accion={accionAxisProductos} boton="Traer catálogo de mercancías" claseBoton="btn" limpiar={false}>
              <span />
            </FormAccion>
          </div>
          {cfg?.ultimoSync && <p className="mt-2 text-xs text-muted-foreground">Última sincronización: {cfg.ultimoSync.slice(0, 16).replace('T', ' ')}</p>}
        </div>
        <div className="tarjeta p-4">
          <h2 className="text-sm font-semibold">2 · Área del TPV de cada tienda</h2>
          <p className="mt-1 text-xs text-muted-foreground">Cada tienda puede tener varias áreas en AxisPOS (almacén, piso de venta, caja interna). Al probar la conexión se proponen solas por el grupo del tenant. {areas.length ? `El tenant tiene ${areas.length} áreas.` : 'Pulsa «Probar conexión» para leer las áreas del tenant.'}</p>
          <ul className="mt-3 space-y-3">
            {ds.tiendas
              .filter((t) => t.activa)
              .map((t) => {
                const mias = new Set((t.codigoTPV ?? '').split(',').filter(Boolean))
                return (
                  <li key={t.id} className="text-sm">
                    <FormAccion accion={accionAxisArea} boton="Guardar" claseBoton="btn px-2 py-1 text-xs" limpiar={false} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <input type="hidden" name="tienda" value={t.id} />
                      <span className="w-28 shrink-0 font-medium">{t.nombre}</span>
                      {areas.length ? (
                        areas.map((a) => (
                          <label key={a.code} className={`flex items-center gap-1 text-xs ${mias.has(a.code) ? '' : 'text-muted-foreground'}`}>
                            <input type="checkbox" name="codigo" value={a.code} defaultChecked={mias.has(a.code)} />
                            {a.code} · {a.nombre}
                          </label>
                        ))
                      ) : (
                        <input name="codigo" defaultValue={t.codigoTPV} placeholder="códigos de área, p. ej. 2,12" className="input w-48" />
                      )}
                    </FormAccion>
                  </li>
                )
              })}
          </ul>
        </div>
      </div>
      <div className="tarjeta mt-4 p-4">
        <h2 className="text-sm font-semibold">3 · Sincronizar operaciones</h2>
        {!lista && <Aviso>Completa la dirección, el usuario, la variable AXISPOS_PASSWORD y asigna al menos un área para sincronizar.</Aviso>}
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">Novedades</h3>
            <p className="mt-1 text-xs text-muted-foreground">Trae lo nuevo de cada área desde el día anterior a la última pasada hasta hoy, sin duplicar tickets ya guardados. Es lo que conviene hacer cada día.</p>
            <FormAccion accion={accionAxisSync} boton="Traer novedades" className="mt-2" limpiar={false}>
              <input type="hidden" name="modo" value="novedades" />
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {conCodigo.map((t) => {
                  const dias = (t.codigoTPV ?? '').split(',').filter(Boolean).map((a) => `${a}: ${cfg?.ultimoDia?.[a] ?? `desde ${cfg?.desde ?? corte}`}`)
                  return (
                    <li key={t.id}>
                      {t.nombre} — {dias.join(' · ')}
                    </li>
                  )
                })}
              </ul>
            </FormAccion>
          </div>
          <div>
            <h3 className="text-sm font-medium">Rango de fechas</h3>
            <p className="mt-1 text-xs text-muted-foreground">Vuelve a traer un periodo completo y sustituye lo que se trajo antes del TPV en esas fechas.</p>
            <FormAccion accion={accionAxisSync} boton="Traer el rango" className="mt-2" limpiar={false}>
              <input type="hidden" name="modo" value="rango" />
              <div className="flex flex-wrap gap-3">
                <label className="w-40">
                  <span className="etiqueta">Desde</span>
                  <input name="desde" type="date" defaultValue={hoy()} className="input" />
                </label>
                <label className="w-40">
                  <span className="etiqueta">Hasta</span>
                  <input name="hasta" type="date" defaultValue={hoy()} className="input" />
                </label>
              </div>
            </FormAccion>
          </div>
        </div>
        <div className="mt-4 grid gap-4 text-xs text-muted-foreground lg:grid-cols-2">
          <p>
            Se contabilizan: {OPER_TYPES_SYNC.map((k) => `${k} ${OPER_TYPE[k]}`).join(', ')}. Los importes del TPV van en CUP (moneda base del tenant) y el costo (PriceIn) se pasa a USD con la tasa Toque del día. Los ajustes de conteo van a «Ajustes de inventario»; los traslados de almacén a piso de la misma tienda no generan asiento y los traslados a otra tienda pasan el inventario de una a otra contra Casa Matriz. Producción y consignación se informan pero todavía no se contabilizan.
          </p>
          <p>
            Gastos e ingresos de caja del TPV (CashbookSyncs): {Object.values(CAJA_TIPO)
              .map((c) => `${c.label} → ${c.categoria}`)
              .join(' · ')}
            . Puedes reclasificarlos después en Caja y Banco.
          </p>
        </div>
      </div>
    </>
  )
}
