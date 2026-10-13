import Link from 'next/link'
import { InformeTabla } from '@/components/InformeTabla'
import { Encabezado, SelectorAnio } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { contextoInforme, type SP } from '@/lib/pagina'
import { estadoResultados } from '@/lib/reports'

export default async function ERPage({ searchParams }: { searchParams: SP }) {
  await requerirUsuario(['admin', 'contador', 'lectura'])
  const { ds, idx, anio, anios, meses } = await contextoInforme(searchParams)
  const er = estadoResultados(ds, idx, meses)
  return (
    <>
      <Encabezado
        titulo={`Estado de Resultados ${anio}`}
        descripcion="Ingresos por fecha de emisión de las facturas; gastos por categoría desde movimientos, facturas de proveedores, devengos, asientos y depreciación. Haz clic en una cifra para ver de qué movimientos sale."
      >
        <SelectorAnio anios={anios} anio={anio} base="/er" />
        <Link className="btn" href={`/api/exportar?informe=er&anio=${anio}`}>
          Exportar a Excel
        </Link>
      </Encabezado>
      <InformeTabla informe={er} />
    </>
  )
}
