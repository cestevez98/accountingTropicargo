import Link from 'next/link'
import { InformeTabla } from '@/components/InformeTabla'
import { Encabezado, SelectorAnio } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { contextoInforme, type SP } from '@/lib/pagina'
import { flujoEfectivo } from '@/lib/reports'

export default async function EFEPage({ searchParams }: { searchParams: SP }) {
  await requerirUsuario(['admin', 'contador', 'lectura'])
  const { ds, idx, anio, anios, meses } = await contextoInforme(searchParams)
  const efe = flujoEfectivo(ds, idx, meses)
  return (
    <>
      <Encabezado
        titulo={`Flujo de Caja ${anio}`}
        descripcion="Entradas y salidas reales de dinero de todas las cajas, bancos, pasarelas y tarjetas, agrupadas por el grupo de flujo de su categoría. Los saldos iniciales cargados no cuentan como flujo."
      >
        <SelectorAnio anios={anios} anio={anio} base="/efe" />
        <Link className="btn" href={`/api/exportar?informe=efe&anio=${anio}`}>
          Exportar a Excel
        </Link>
      </Encabezado>
      <InformeTabla informe={efe} />
    </>
  )
}
