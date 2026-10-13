import Link from 'next/link'
import { Encabezado } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { tpConfigurado } from '@/lib/trackingpremium'
import { ConciliarCobros } from './Conciliar'

export const maxDuration = 300

export default async function CobrosTPPage() {
  await requerirUsuario(['admin', 'contador'])
  return (
    <>
      <Encabezado
        titulo="Cobros de Tracking Premium"
        descripcion="Compara los pagos verificados en Tracking Premium con los cobros registrados en cada caja. Pagos y cobros que citan la misma factura o multipago se comparan juntos, porque la caja suele agrupar varias facturas en un movimiento. Los pagos que falten en la caja se pueden registrar desde aquí."
      >
        <Link href="/facturacion" className="btn">
          Volver a Facturación
        </Link>
      </Encabezado>
      {tpConfigurado() ? (
        <ConciliarCobros cajas={['Caja Cuba', 'Caja Miami']} />
      ) : (
        <p className="tarjeta p-4 text-sm text-slate-600">Falta configurar el usuario de Tracking Premium (variables TP_USER y TP_PASS en Vercel).</p>
      )}
    </>
  )
}
