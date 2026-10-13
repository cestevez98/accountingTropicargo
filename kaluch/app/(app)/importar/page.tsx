import { Chip, Encabezado } from '@/components/ui'
import { BotonAccion } from '@/components/FormAccion'
import { accionDeshacerImportacion } from '../../acciones'
import { requerirUsuario, tiendaFija } from '@/lib/auth'
import { cargarDataset } from '@/lib/data'
import { PLANTILLAS } from '@/lib/plantillas'
import { Importador } from './Importador'

export const maxDuration = 300

export default async function Importar() {
  const s = await requerirUsuario('importar')
  const ds = await cargarDataset()
  const tipos = [
    { clave: 'km', titulo: 'Libro completo de la tienda (Excel KM)', descripcion: 'El libro «Operaciones KM-xx»: tasas, caja, banco, ventas, compras, deuda con Casa Matriz e inventario.', plantilla: false },
    ...Object.entries(PLANTILLAS).map(([clave, p]) => ({ clave, titulo: p.titulo, descripcion: p.descripcion, plantilla: true })),
  ]
  const admin = s.rol === 'propietario' || s.rol === 'admin'
  return (
    <>
      <Encabezado titulo="Importar" descripcion="Sube los archivos de cada tienda: el sistema valida cada fila, te enseña los errores antes de guardar y genera los estados financieros solo." />
      <Importador tipos={tipos} tiendas={ds.tiendas.filter((t) => t.activa).map((t) => ({ id: t.id, nombre: t.nombre }))} tiendaFija={tiendaFija(s)} blob={Boolean(process.env.BLOB_READ_WRITE_TOKEN)} />
      <div className="tarjeta mt-6 overflow-x-auto">
        <h2 className="px-4 pt-3 text-sm font-semibold">Historial de importaciones</h2>
        <table className="tabla mt-2">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Archivo</th>
              <th>Tipo</th>
              <th>Tienda</th>
              <th>Usuario</th>
              <th className="num">Filas</th>
              {admin && <th />}
            </tr>
          </thead>
          <tbody>
            {ds.importaciones.map((imp) => (
              <tr key={imp.id}>
                <td className="whitespace-nowrap">{imp.ts.slice(0, 16).replace('T', ' ')}</td>
                <td className="max-w-72 truncate">{imp.archivo}</td>
                <td>
                  <Chip tono="azul">{imp.tipo}</Chip>
                </td>
                <td>{ds.tiendas.find((t) => t.id === imp.tienda)?.nombre ?? imp.tienda}</td>
                <td>{imp.usuario}</td>
                <td className="num">{imp.filas.toLocaleString('es-ES')}</td>
                {admin && (
                  <td>
                    <BotonAccion accion={accionDeshacerImportacion} campos={{ lote: imp.lote }} confirmar="¿Deshacer esta importación? Se borran los movimientos, ventas y compras que entraron con ella." className="btn btn-peligro text-xs">
                      Deshacer
                    </BotonAccion>
                  </td>
                )}
              </tr>
            ))}
            {!ds.importaciones.length && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted-foreground">
                  Sin importaciones todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
