import { Encabezado } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { cargarDataset, leerUsuarios } from '@/lib/data'
import { GestionUsuarios } from './GestionUsuarios'

export default async function UsuariosPage() {
  const s = await requerirUsuario(['admin'])
  const usuarios = (await leerUsuarios()).map(({ hash: _h, ...u }) => u)
  const ds = await cargarDataset()
  return (
    <>
      <Encabezado
        titulo="Usuarios"
        descripcion="Administrador: todo. Contador: registra y corrige todo menos usuarios e importación. Cajero: solo registra movimientos en las cajas que se le asignen. Solo lectura: ve informes y registros. Agente de remesas: solo ve y entrega las remesas de su agente."
      />
      <GestionUsuarios usuarios={usuarios} cuentas={ds.cuentas.map((c) => c.nombre)} agentes={ds.settings.agentesRemesas ?? ['DVA']} yo={s.id} />
    </>
  )
}
