import Link from 'next/link'
import { GraficoMensual } from '@/components/Grafico'
import { Encabezado, Kpi } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { CAT_POR_CLASIFICAR } from '@/lib/catalog'
import { mesesEntre, ym } from '@/lib/fecha'
import { contextoInforme, param, type SP } from '@/lib/pagina'
import { avisos, estadoResultados, etiquetaMes, fmt } from '@/lib/reports'
import { almacenamiento } from '@/lib/store'
import { redirect } from 'next/navigation'

export default async function PanelPage({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario()
  if (s.rol === 'cajero') redirect('/movimientos')
  const { ds, mayor, idx, anio, meses, sp } = await contextoInforme(searchParams)
  const er = estadoResultados(ds, idx, meses)
  const ultimoConDatos = ds.movimientos.reduce((a, m) => (m.fecha > a ? m.fecha : a), ds.settings.fechaInicio)
  const mesDefecto = meses.includes(ym(ultimoConDatos)) ? ym(ultimoConDatos) : meses.at(-1)
  const mes = meses.includes(param(sp, 'mes') ?? '') ? param(sp, 'mes')! : mesDefecto
  const i = mes ? meses.indexOf(mes) : -1
  const lista = avisos(ds, mayor, idx)
  const tes = mes ? idx.saldoDonde((k) => k.startsWith('tes:'), mes) : 0
  const cxc = mes ? idx.saldo('cxc', mes) + idx.saldo('cxc_manual', mes) : 0
  const cxp = mes ? -idx.saldo('cxp', mes) : 0
  const nSin = ds.movimientos.filter((m) => m.categoria === CAT_POR_CLASIFICAR).length
  const vacio = !ds.movimientos.length && !ds.facturas.length

  return (
    <>
      <Encabezado titulo={`${ds.settings.empresa} — Panel`} descripcion={`Contabilidad desde el ${ds.settings.fechaInicio}. Datos guardados en ${almacenamiento}.`}>
        {meses.length > 0 && (
          <form className="flex items-center gap-2">
            <input type="hidden" name="anio" value={anio} />
            <select name="mes" defaultValue={mes} className="input !w-auto">
              {meses.map((m) => (
                <option key={m} value={m}>
                  {etiquetaMes(m)}
                </option>
              ))}
            </select>
            <button className="btn">Ver</button>
          </form>
        )}
      </Encabezado>

      {vacio && (
        <div className="tarjeta mb-6 p-5 text-sm">
          <p className="font-medium text-slate-900">Todavía no hay datos.</p>
          <p className="mt-1 text-slate-600">
            {s.rol === 'admin' ? (
              <>
                Empieza en <Link className="text-marca-600 underline" href="/importar">Importar</Link> para cargar el Excel, o registra los movimientos en{' '}
                <Link className="text-marca-600 underline" href="/movimientos">Movimientos</Link>.
              </>
            ) : (
              'El administrador todavía no ha cargado datos.'
            )}
          </p>
        </div>
      )}

      {i >= 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Kpi titulo={`Ingresos ${etiquetaMes(mes!)}`} valor={fmt(er.ingresos[i], 0)} sub="USD" href="/er" />
          <Kpi
            titulo={`Utilidad neta ${etiquetaMes(mes!)}`}
            valor={fmt(er.neta[i], 0)}
            sub={er.ingresos[i] ? `Margen ${((er.neta[i] / er.ingresos[i]) * 100).toFixed(1)}%` : 'USD'}
            tono={er.neta[i] >= 0 ? 'bueno' : 'malo'}
            href="/er"
          />
          <Kpi titulo="Tesorería al cierre" valor={fmt(tes, 0)} sub="Cajas + bancos − tarjetas" tono={tes >= 0 ? 'normal' : 'malo'} href="/bancos" />
          <Kpi titulo="Cuentas por cobrar" valor={fmt(cxc, 0)} sub="Según el libro mayor" href="/mayor?cuenta=cxc" />
          <Kpi titulo="Cuentas por pagar" valor={fmt(cxp, 0)} sub="Proveedores" href="/mayor?cuenta=cxp" />
          <Kpi titulo="Por clasificar" valor={String(nSin)} sub="movimientos" tono={nSin ? 'malo' : 'bueno'} href="/movimientos?categoria=__sin__" />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-5">
        <section className="tarjeta p-5 xl:col-span-3">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Ingresos y utilidad neta por mes ({anio})</h2>
          {meses.length ? (
            <GraficoMensual
              etiquetas={meses.map(etiquetaMes)}
              series={[
                { nombre: 'Ingresos', color: '#1f8a83', valores: er.ingresos },
                { nombre: 'Utilidad neta', color: '#f59e0b', valores: er.neta },
              ]}
            />
          ) : (
            <p className="text-sm text-slate-500">Sin datos.</p>
          )}
        </section>
        <section className="tarjeta p-5 xl:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Pendientes y controles ({lista.length})</h2>
          {lista.length === 0 ? (
            <p className="text-sm text-emerald-700">Todo en orden: no hay pendientes.</p>
          ) : (
            <ul className="space-y-2.5">
              {lista.map((a, k) => (
                <li key={k} className={`rounded-md border-l-4 px-3 py-2 text-sm ${a.nivel === 'error' ? 'border-red-500 bg-red-50' : a.nivel === 'aviso' ? 'border-amber-400 bg-amber-50' : 'border-sky-400 bg-sky-50'}`}>
                  <div className="font-medium text-slate-900">{a.href ? <Link href={a.href} className="hover:underline">{a.titulo}</Link> : a.titulo}</div>
                  <div className="text-slate-600">{a.detalle}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="mt-6 text-xs text-slate-400">Meses con datos: {mesesEntre(ym(mayor.inicio), mayor.ultimoMes).map(etiquetaMes).join(' · ')}</p>
    </>
  )
}
