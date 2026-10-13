import Link from 'next/link'
import { TablaInforme } from '@/components/Informe'
import { Aviso, Encabezado, Pestanas } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { cargarContabilidad } from '@/lib/data'
import { aniosDisponibles, capital, estadoResultados, estadoSituacion, flujoEfectivo, fmt, mesesDelAnio, nombreMes, rangoMes, type Informe } from '@/lib/informes'
import { params, tiendaActiva, type SP } from '@/lib/pagina'
import { compararER } from '@/lib/paridad'

const TABS = [
  { clave: 'es', label: 'Estado de Situación' },
  { clave: 'er', label: 'Estado de Resultados' },
  { clave: 'efe', label: 'Flujo de Efectivo' },
  { clave: 'capital', label: 'Capital' },
  { clave: 'excel', label: 'Comparación con el Excel' },
]

export default async function Reportes({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('reportes')
  const sp = await params(searchParams)
  const r = TABS.some((t) => t.clave === sp.r) ? sp.r! : 'er'
  const { tienda, vista } = await tiendaActiva(s)
  const { ds, mayor, idx } = await cargarContabilidad()
  const anios = aniosDisponibles(mayor)
  const anio = anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios.at(-1)!
  const meses = mesesDelAnio(mayor, anio)
  const o = { tienda, vista }
  const drill = (cuentas: string[], mes?: string) => {
    const { desde, hasta } = mes ? rangoMes(mes) : { desde: undefined, hasta: undefined }
    const p = new URLSearchParams({ tab: 'submayor', cuenta: cuentas.join(','), ...(r === 'es' ? { hasta: hasta! } : desde ? { desde, hasta: hasta! } : {}) })
    return `/contabilidad?${p}`
  }
  let inf: Informe | undefined
  if (r === 'er') inf = estadoResultados(ds, idx, meses, o)
  else if (r === 'es') inf = estadoSituacion(idx, meses, o)
  else if (r === 'efe') inf = flujoEfectivo(ds, mayor, meses, o)
  else if (r === 'capital') inf = capital(ds, idx, meses, o)
  const q = new URLSearchParams({ informe: r, anio: String(anio) })
  return (
    <>
      <Encabezado titulo="Reportes" descripcion={`${tienda ? (ds.tiendas.find((t) => t.id === tienda)?.nombre ?? tienda) : 'Consolidado del grupo'} · ${vista}${vista === 'CUP' ? ' (a tasa histórica de cada operación)' : ''} · haz clic en una cifra para ver los asientos que la forman.`}>
        {anios.length > 1 &&
          anios.map((a) => (
            <Link key={a} href={`/reportes?r=${r}&anio=${a}`} className={`btn ${a === anio ? 'btn-primario' : ''}`}>
              {a}
            </Link>
          ))}
        {inf && (
          <a className="btn" href={`/api/exportar?${q}`}>
            Exportar a Excel
          </a>
        )}
        {inf && (
          <a className="btn" href={`/imprimir?${q}`} target="_blank">
            Exportar a PDF
          </a>
        )}
      </Encabezado>
      <Pestanas activa={r} items={TABS.map((t) => ({ ...t, href: `/reportes?r=${t.clave}&anio=${anio}` }))} />
      {mayor.avisos.map((a) => (
        <Aviso key={a}>{a}</Aviso>
      ))}
      {inf && <TablaInforme inf={inf} drill={drill} />}
      {r === 'er' && (
        <p className="mt-3 text-xs text-muted-foreground">
          Ventas a la tasa de venta de la tienda (Toque + {ds.settings.margenTasa} CUP); la diferencia hasta la tasa Toque es el ingreso por tasa de cambio. Impuesto sobre ventas: {(ds.settings.impuestoVentas * 100).toFixed(0)} % de lo cobrado por banco.
          {ds.settings.revaluar && ' El efectivo en CUP/EUR/MLC se revalúa al cierre de cada mes (resultado por tenencia de moneda).'}
        </p>
      )}
      {r === 'excel' && <Comparacion ds={ds} er={estadoResultados(ds, idx, meses, { tienda: undefined })} />}
    </>
  )
}

function Comparacion({ ds, er }: { ds: Awaited<ReturnType<typeof cargarContabilidad>>['ds']; er: Informe }) {
  const refs = Object.entries(ds.referencias ?? {})
  if (!refs.length) return <p className="text-sm text-muted-foreground">Importa un libro Excel de tienda para comparar su ER con el del sistema.</p>
  return (
    <div className="space-y-6">
      {refs.map(([tienda, ref]) => {
        const filas = compararER(ref, er)
        return (
          <div key={tienda}>
            <h2 className="mb-2 text-sm font-semibold">
              {ds.tiendas.find((t) => t.id === tienda)?.nombre ?? tienda} · {ref.archivo}
            </h2>
            <div className="tarjeta overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Renglón del ER</th>
                    {ref.meses.map((m) => (
                      <th key={m} className="num" colSpan={3}>
                        {nombreMes(m)}
                      </th>
                    ))}
                    <th>Explicación</th>
                  </tr>
                  <tr>
                    <th />
                    {ref.meses.map((m) => [
                      <th key={`${m}e`} className="num">
                        Excel
                      </th>,
                      <th key={`${m}s`} className="num">
                        Sistema
                      </th>,
                      <th key={`${m}d`} className="num">
                        Dif.
                      </th>,
                    ])}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => {
                    const hay = f.dif.some((d) => Math.abs(d) > 0.01)
                    return (
                      <tr key={f.label}>
                        <td className={hay ? 'font-medium' : ''}>{f.label}</td>
                        {f.excel.map((v, i) => [
                          <td key={`e${i}`} className="num text-muted-foreground">
                            {fmt(v)}
                          </td>,
                          <td key={`s${i}`} className="num">
                            {fmt(f.app[i])}
                          </td>,
                          <td key={`d${i}`} className={`num ${Math.abs(f.dif[i]) > 0.01 ? 'text-warning font-semibold' : 'text-accent'}`}>
                            {Math.abs(f.dif[i]) > 0.01 ? fmt(f.dif[i]) : '✓'}
                          </td>,
                        ])}
                        <td className="max-w-96 text-xs text-muted-foreground">{hay ? f.nota : ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">La comparación se hace con el consolidado (todas las tiendas). Las filas con ✓ coinciden al centavo.</p>
          </div>
        )
      })}
    </div>
  )
}
