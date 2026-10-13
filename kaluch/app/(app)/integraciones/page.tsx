import { accionAxisConfig, accionAxisProbar, accionAxisSync } from '../../acciones'
import { FormAccion } from '@/components/FormAccion'
import { Aviso, Chip, Encabezado } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { OPER_TYPE } from '@/lib/axispos'
import { cargarDataset } from '@/lib/data'
import { hoy } from '@/lib/fecha'

async function probar(_prev: unknown, _f: FormData) {
  'use server'
  return accionAxisProbar()
}

export default async function Integraciones() {
  await requerirUsuario('integraciones')
  const ds = await cargarDataset()
  const cfg = ds.settings.axispos
  const conCodigo = ds.tiendas.filter((t) => t.codigoTPV)
  const lista = Boolean(cfg?.url && cfg.usuario && process.env.AXISPOS_PASSWORD && conCodigo.length)
  return (
    <>
      <Encabezado titulo="Integraciones" descripcion="Conexión con el TPV AxisPOS / ERP Microinvest (API SyncApi v1.2). Trae ventas, mermas, consumo interno, devoluciones y compras de cada área." />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="tarjeta p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">AxisPOS / Microinvest</h2>
            {lista ? <Chip tono="verde">Configurado</Chip> : <Chip tono="ambar">Pendiente</Chip>}
          </div>
          <FormAccion accion={accionAxisConfig} className="mt-3" limpiar={false}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="etiqueta">URL del servidor (sin /SyncApi)</span>
                <input name="url" defaultValue={cfg?.url} placeholder="https://servidor-axis.ejemplo.cu" className="input" />
              </label>
              <label>
                <span className="etiqueta">Usuario</span>
                <input name="usuario" defaultValue={cfg?.usuario} className="input" />
              </label>
              <div className="text-xs text-muted-foreground">
                <span className="etiqueta">Contraseña</span>
                {process.env.AXISPOS_PASSWORD ? '✓ definida en la variable AXISPOS_PASSWORD' : 'Defínela en Vercel como variable de entorno AXISPOS_PASSWORD (no se guarda en la base de datos).'}
              </div>
            </div>
          </FormAccion>
          <FormAccion accion={probar} boton="Probar conexión" claseBoton="btn mt-2" limpiar={false}>
            <span />
          </FormAccion>
          {cfg?.ultimoSync && <p className="mt-2 text-xs text-muted-foreground">Última sincronización: {cfg.ultimoSync.slice(0, 16).replace('T', ' ')}</p>}
        </div>
        <div className="tarjeta p-4">
          <h2 className="text-sm font-semibold">Áreas del TPV por tienda</h2>
          <p className="mt-1 text-xs text-muted-foreground">Cada tienda necesita su «Código TPV» (ObjectCode del área en AxisPOS). Se edita en Catálogos → Tiendas.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {ds.tiendas.map((t) => (
              <li key={t.id} className="flex justify-between">
                <span>{t.nombre}</span>
                {t.codigoTPV ? <Chip tono="verde">{t.codigoTPV}</Chip> : <span className="text-xs text-muted-foreground">sin código</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="tarjeta mt-4 p-4">
        <h2 className="text-sm font-semibold">Sincronizar operaciones</h2>
        {!lista && <Aviso>Completa la URL, el usuario, la variable AXISPOS_PASSWORD y al menos un Código TPV para sincronizar.</Aviso>}
        <FormAccion accion={accionAxisSync} boton="Traer del TPV" className="mt-3" limpiar={false}>
          <div className="flex flex-wrap gap-3">
            <label className="w-44">
              <span className="etiqueta">Desde</span>
              <input name="desde" type="date" defaultValue={hoy()} className="input" />
            </label>
            <label className="w-44">
              <span className="etiqueta">Hasta</span>
              <input name="hasta" type="date" defaultValue={hoy()} className="input" />
            </label>
          </div>
        </FormAccion>
        <p className="mt-3 text-xs text-muted-foreground">
          Se piden las operaciones {[1, 2, 3, 11, 34, 39].map((k) => `${k} (${OPER_TYPE[k]})`).join(', ')}. Lo que ya se trajo del TPV en ese rango se sustituye, así que se puede repetir sin duplicar. Los importes del TPV se toman en CUP y el costo (PriceIn) se pasa a USD con la tasa Toque del día.
        </p>
      </div>
    </>
  )
}
