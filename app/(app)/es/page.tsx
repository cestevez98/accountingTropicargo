import Link from 'next/link'
import { InformeTabla } from '@/components/InformeTabla'
import { Encabezado, SelectorAnio } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { contextoInforme, type SP } from '@/lib/pagina'
import { estadoSituacion } from '@/lib/reports'

export default async function ESPage({ searchParams }: { searchParams: SP }) {
  await requerirUsuario(['admin', 'contador', 'lectura'])
  const { ds, idx, anio, anios, meses } = await contextoInforme(searchParams)
  const es = estadoSituacion(ds, idx, meses)
  return (
    <>
      <Encabezado
        titulo={`Estado de Situación ${anio}`}
        descripcion="Saldos al cierre de cada mes. Se arma desde el libro mayor de partida doble, así que el cuadre siempre da 0; lo que falta por aclarar aparece como «Partidas por clasificar», «Partidas en tránsito» o «Ajuste de apertura»."
      >
        <SelectorAnio anios={anios} anio={anio} base="/es" />
        <Link className="btn" href={`/api/exportar?informe=es&anio=${anio}`}>
          Exportar a Excel
        </Link>
      </Encabezado>
      <InformeTabla informe={es} saldos />
    </>
  )
}
