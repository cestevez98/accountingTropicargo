import { TablaInforme } from '@/components/Informe'
import { requerirUsuario } from '@/lib/auth'
import { cargarContabilidad } from '@/lib/data'
import { aniosDisponibles, capital, estadoResultados, estadoSituacion, flujoEfectivo, mesesDelAnio } from '@/lib/informes'
import { params, tiendaActiva, type SP } from '@/lib/pagina'
import { Imprimir } from './Imprimir'

/** Versión imprimible de un informe (Guardar como PDF desde el navegador). */
export default async function PaginaImprimir({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('reportes')
  const sp = await params(searchParams)
  const { tienda, vista } = await tiendaActiva(s)
  const { ds, mayor, idx } = await cargarContabilidad()
  const anios = aniosDisponibles(mayor)
  const anio = anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios.at(-1)!
  const meses = mesesDelAnio(mayor, anio)
  const o = { tienda, vista }
  const inf = sp.informe === 'es' ? estadoSituacion(idx, meses, o) : sp.informe === 'efe' ? flujoEfectivo(ds, mayor, meses, o) : sp.informe === 'capital' ? capital(ds, idx, meses, o) : estadoResultados(ds, idx, meses, o)
  return (
    <div className="bg-white p-6 text-black">
      <Imprimir />
      <h1 className="text-xl font-bold">
        {ds.settings.empresa} — {inf.titulo} {anio}
      </h1>
      <p className="mb-4 text-sm">
        {tienda ? ds.tiendas.find((t) => t.id === tienda)?.nombre : 'Consolidado del grupo'} · {vista} · generado el {new Date().toISOString().slice(0, 10)}
      </p>
      <TablaInforme inf={inf} />
    </div>
  )
}
