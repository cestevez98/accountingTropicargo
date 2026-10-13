import { accionArqueoAprobar, accionArqueoBorrar } from '../../acciones'
import { BotonAccion, FormAccion } from '@/components/FormAccion'
import { Chip, Encabezado, Vacio } from '@/components/ui'
import { requerirUsuario, tiendaFija } from '@/lib/auth'
import { cargarDataset, preferencias } from '@/lib/data'
import { params, type SP } from '@/lib/pagina'
import { revisaArqueos } from '@/lib/permisos'
import { FormArqueo } from './FormArqueo'

const f2 = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hora = (h: string) => h.replace('T', ' ').slice(0, 16)

/** Cuadre de cambio de turno de cada caja, con comprobante numerado y revisión del contador. */
export default async function PaginaArqueo({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('arqueo')
  const sp = await params(searchParams)
  const ds = await cargarDataset()
  const fija = tiendaFija(s)
  const pref = await preferencias()
  const revisa = revisaArqueos(s.rol)
  const ubic = new Map((ds.settings.axispos?.ubicaciones ?? []).map((u) => [u.code, u]))
  const ultimo = new Map<string, string>()
  for (const a of ds.arqueos) if (!ultimo.has(a.caja) || a.hasta > ultimo.get(a.caja)!) ultimo.set(a.caja, a.hasta)
  const tiendas = ds.tiendas
    .filter((t) => t.activa && t.tipo === 'local' && t.codigoTPV && (!fija || t.id === fija))
    .map((t) => {
      const areas = (t.codigoTPV ?? '').split(',').map((c) => c.trim()).filter(Boolean)
      const pisos = areas.filter((c) => ubic.get(c)?.tipo === 7)
      return { id: t.id, nombre: t.nombre, cajas: (pisos.length ? pisos : areas).map((c) => ({ code: c, nombre: ubic.get(c)?.nombre ?? `Área ${c}`, ultimo: ultimo.get(c) })) }
    })
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))
  const verPendientes = sp.f === 'pendientes'
  // El dependiente ve sus propios cuadres; el contador, los de su tienda; administración, todos.
  const lista = ds.arqueos
    .filter((a) => (revisa ? !fija || a.tienda === fija : a.usuario === s.email) && (!verPendientes || a.estado === 'pendiente'))
    .sort((a, b) => b.hasta.localeCompare(a.hasta))
    .slice(0, 100)
  const pendientes = ds.arqueos.filter((a) => a.estado === 'pendiente' && (!fija || a.tienda === fija)).length
  const categorias = ds.categorias.filter((c) => c.activa && c.caja && c.contrapartida === 'resultado').map((c) => c.nombre)
  return (
    <>
      <Encabezado
        titulo="Cuadre de turno"
        descripcion="Al cambiar de turno se cuadra la caja: la venta sale del TPV desde el cuadre anterior; se ponen los gastos, el salario, las transferencias y los billetes. El contador lo revisa y lo aprueba."
      />
      {tiendas.length ? (
        <FormArqueo
          tiendas={tiendas}
          tienda={fija ?? (tiendas.some((t) => t.id === pref.tienda) ? pref.tienda : undefined)}
          cajeros={(ds.settings.axispos?.usuariosTPV ?? []).map((u) => u.nombre)}
          cuentas={ds.settings.cuentasTransferencia ?? ['FISCAL']}
          categorias={[...new Set(['OTROS GASTOS', 'SALARIO SEGURIDAD', 'SALARIO LIMPIEZA', 'TRANSPORTE', ...categorias])]}
        />
      ) : (
        <Vacio>No hay tiendas con cajas del TPV asignadas.</Vacio>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">{revisa ? 'Cuadres' : 'Mis cuadres'}</h2>
        {revisa && (
          <a className="text-xs text-primary hover:underline" href={verPendientes ? '/arqueo' : '/arqueo?f=pendientes'}>
            {verPendientes ? 'Ver todos' : `Solo pendientes de revisar (${pendientes})`}
          </a>
        )}
      </div>
      {lista.length ? (
        <div className="tarjeta mt-2 overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>#</th>
                <th>Turno</th>
                <th>Caja</th>
                <th>Cajero(a)</th>
                <th className="num">Venta</th>
                <th className="num">Esperado</th>
                <th className="num">Contado</th>
                <th className="num">Diferencia</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id}>
                  <td>{a.numero}</td>
                  <td className="text-xs">
                    {hora(a.desde)} → {hora(a.hasta).slice(11)}
                  </td>
                  <td className="text-xs">
                    {nombreT.get(a.tienda)} · {a.cajaNombre}
                  </td>
                  <td className="text-xs">{a.cajero}</td>
                  <td className="num">{f2(a.ventaTienda + a.domicilio + a.plataforma)}</td>
                  <td className="num">{f2(a.esperado)}</td>
                  <td className="num">{f2(a.contado)}</td>
                  <td className={`num font-semibold ${a.diferencia < -0.5 ? 'text-danger' : a.diferencia > 0.5 ? 'text-amber-600' : 'text-accent'}`}>{Math.abs(a.diferencia) < 0.5 ? 'Cuadra' : f2(a.diferencia)}</td>
                  <td>{a.estado === 'aprobado' ? <Chip tono="verde" title={`${a.revisadoPor} · ${a.revisadoEn?.slice(0, 16)}`}>Aprobado</Chip> : <Chip tono="ambar">Pendiente</Chip>}</td>
                  <td className="whitespace-nowrap text-xs">
                    <a className="text-primary hover:underline" href={`/imprimir/arqueo?id=${a.id}`}>
                      Comprobante
                    </a>
                    {revisa && a.estado === 'pendiente' && (
                      <div className="mt-1 flex items-center gap-2">
                        <FormAccion accion={accionArqueoAprobar} boton="Aprobar" claseBoton="btn btn-exito px-2 py-0.5 text-xs" confirmar={`¿Aprobar el cuadre #${a.numero}? Se registran sus gastos y salario en la caja.`} limpiar={false}>
                          <input type="hidden" name="id" value={a.id} />
                          <label className="mr-1 inline-flex items-center gap-1">
                            <input type="checkbox" name="entregar" defaultChecked /> entregar a caja central
                          </label>
                        </FormAccion>
                        <BotonAccion accion={accionArqueoBorrar} campos={{ id: a.id }} confirmar={`¿Borrar el cuadre #${a.numero}? La caja se vuelve a cuadrar desde el anterior.`} className="text-danger hover:underline">
                          Borrar
                        </BotonAccion>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Vacio>Todavía no hay cuadres.</Vacio>
      )}
    </>
  )
}
