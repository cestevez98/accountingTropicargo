import Link from 'next/link'
import { InformeTabla } from '@/components/InformeTabla'
import { Encabezado, SelectorAnio } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { contextoInforme, type SP } from '@/lib/pagina'
import { bancos } from '@/lib/reports'

export default async function BancosPage({ searchParams }: { searchParams: SP }) {
  await requerirUsuario(['admin', 'contador', 'lectura'])
  const { ds, idx, anio, anios, meses } = await contextoInforme(searchParams)
  return (
    <>
      <Encabezado titulo={`Bancos y cajas ${anio}`} descripcion="Saldo al cierre de cada mes de cada caja (convertida a USD), banco, pasarela y tarjeta, y su movimiento neto del mes.">
        <SelectorAnio anios={anios} anio={anio} base="/bancos" />
        <Link className="btn" href={`/api/exportar?informe=bancos&anio=${anio}`}>
          Exportar a Excel
        </Link>
      </Encabezado>
      <InformeTabla informe={bancos(ds, idx, meses)} />
    </>
  )
}
