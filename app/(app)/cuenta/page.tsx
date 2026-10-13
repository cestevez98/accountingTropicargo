import { Encabezado } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { FormPassword } from './FormPassword'

export default async function CuentaPage() {
  const s = await requerirUsuario()
  return (
    <>
      <Encabezado titulo="Mi contraseña" descripcion={`${s.nombre} · ${s.email}`} />
      <section className="tarjeta max-w-md p-5">
        <FormPassword />
      </section>
    </>
  )
}
