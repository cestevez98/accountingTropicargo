import { Encabezado } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { leer } from '@/lib/store'
import type { AuditEntry } from '@/lib/types'

export default async function AuditoriaPage() {
  await requerirUsuario(['admin'])
  const entradas = (await leer<AuditEntry[]>('auditoria', [])).slice(0, 500)
  return (
    <>
      <Encabezado titulo="Auditoría" descripcion="Últimos 500 cambios: quién creó, editó, borró o importó qué y cuándo." />
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Fecha y hora (UTC)</th>
              <th>Usuario</th>
              <th>Acción</th>
              <th>Tabla</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {entradas.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap">{e.ts.replace('T', ' ').slice(0, 19)}</td>
                <td>{e.usuario}</td>
                <td>{e.accion}</td>
                <td>{e.coleccion}</td>
                <td className="max-w-xl">{e.detalle}</td>
              </tr>
            ))}
            {!entradas.length && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-500">
                  Sin cambios registrados todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
