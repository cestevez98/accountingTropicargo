import { accionCambiarPassword } from '../../acciones'
import { FormAccion } from '@/components/FormAccion'
import { Encabezado } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { ROLES } from '@/lib/permisos'

export default async function Cuenta() {
  const s = await requerirUsuario()
  return (
    <>
      <Encabezado titulo="Mi cuenta" descripcion={`${s.nombre} · ${s.email} · ${ROLES[s.rol].label}`} />
      <div className="tarjeta max-w-md p-4">
        <h2 className="text-sm font-semibold">Cambiar contraseña</h2>
        <FormAccion accion={accionCambiarPassword} className="mt-3 space-y-3" boton="Cambiar contraseña">
          <label className="block">
            <span className="etiqueta">Contraseña actual</span>
            <input name="actual" type="password" className="input" autoComplete="current-password" required />
          </label>
          <label className="block">
            <span className="etiqueta">Nueva contraseña (mínimo 10 caracteres)</span>
            <input name="nueva" type="password" className="input" autoComplete="new-password" minLength={10} required />
          </label>
        </FormAccion>
      </div>
    </>
  )
}
