import Link from 'next/link'
import { Encabezado } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { tpConfigurado } from '@/lib/trackingpremium'
import { SincronizarTP } from './Sincronizar'

export const maxDuration = 300

export default async function TrackingPage() {
  await requerirUsuario(['admin', 'contador'])
  return (
    <>
      <Encabezado
        titulo="Facturas de Tracking Premium"
        descripcion="Trae las facturas del sistema logístico para el período elegido y las compara con la contabilidad: facturas nuevas, cobros y estatus que cambiaron, y facturas que ya no están en Tracking Premium. Nada se guarda hasta que confirmas."
      >
        <Link href="/facturacion" className="btn">
          Volver a Facturación
        </Link>
      </Encabezado>
      {tpConfigurado() ? (
        <SincronizarTP />
      ) : (
        <p className="tarjeta p-4 text-sm text-slate-600">Falta configurar el usuario de Tracking Premium (variables TP_USER y TP_PASS en Vercel).</p>
      )}
    </>
  )
}
