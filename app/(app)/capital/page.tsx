import Link from 'next/link'
import { InformeTabla } from '@/components/InformeTabla'
import { Encabezado, SelectorAnio } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { contextoInforme, type SP } from '@/lib/pagina'
import { capital, estadoResultados } from '@/lib/reports'

export default async function CapitalPage({ searchParams }: { searchParams: SP }) {
  await requerirUsuario(['admin', 'contador', 'lectura'])
  const { ds, idx, anio, anios, meses } = await contextoInforme(searchParams)
  const er = estadoResultados(ds, idx, meses)
  return (
    <>
      <Encabezado
        titulo={`Capital y resultados ${anio}`}
        descripcion="Los aportes y retiros salen de los movimientos con categoría «Aporte de capital» y «Retiro de capital / Dividendos»; el capital de apertura se fija en Apertura y cierres."
      >
        <SelectorAnio anios={anios} anio={anio} base="/capital" />
        <Link className="btn" href={`/api/exportar?informe=capital&anio=${anio}`}>
          Exportar a Excel
        </Link>
      </Encabezado>
      <InformeTabla informe={capital(ds, idx, meses, er)} />
    </>
  )
}
