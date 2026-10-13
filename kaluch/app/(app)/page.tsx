import Link from 'next/link'
import { Barras, Ranking } from '@/components/Grafico'
import { Aviso, Chip, Encabezado, Kpi, Vacio } from '@/components/ui'
import { calcularAlertas } from '@/lib/alertas'
import { requerirUsuario } from '@/lib/auth'
import { cargarContabilidad } from '@/lib/data'
import { ym } from '@/lib/fecha'
import { estadoResultados, estadoSituacion, fmt, mesesDelAnio, nombreMes } from '@/lib/informes'
import { params, tiendaActiva, type SP } from '@/lib/pagina'

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('dashboard')
  const sp = await params(searchParams)
  const { tienda, vista } = await tiendaActiva(s)
  const { ds, mayor, idx } = await cargarContabilidad()
  if (!ds.movimientos.length && !ds.salidas.length && !ds.compras.length)
    return (
      <>
        <Encabezado titulo="Dashboard" />
        <Vacio>
          Todavía no hay datos. <Link href="/importar" className="font-semibold text-primary underline">Importa el Excel de la tienda</Link> o conecta el TPV en Integraciones.
        </Vacio>
      </>
    )
  const anio = Number(mayor.ultimoMes.slice(0, 4))
  const meses = mesesDelAnio(mayor, anio).filter((m) => m <= ym(new Date().toISOString()))
  const er = estadoResultados(ds, idx, meses, { tienda, vista })
  const es = estadoSituacion(idx, meses, { tienda, vista })
  const fila = (inf: typeof er, label: string) => inf.filas.find((f) => f.label === label)?.valores ?? meses.map(() => 0)
  // El mes de referencia es el último con ventas (el mes en curso puede estar vacío todavía).
  const ventasNetas = fila(er, 'Ventas netas')
  let i = meses.length - 1
  while (i > 0 && Math.abs(ventasNetas[i]) < 0.005) i--
  const mes = meses[i]
  const delta = (v: number[]) => {
    if (i < 1 || !v[i - 1]) return undefined
    const d = ((v[i] - v[i - 1]) / Math.abs(v[i - 1])) * 100
    return <span className={d >= 0 ? 'text-accent' : 'text-danger'}>{`${d >= 0 ? '▲' : '▼'} ${fmt(Math.abs(d), 1)} % vs ${nombreMes(meses[i - 1])}`}</span>
  }
  const bruta = fila(er, 'Utilidad Bruta')
  const neto = fila(er, 'Beneficio neto después de bonos')
  const caja = fila(es, 'Efectivo en Caja')
  const banco = fila(es, 'Efectivo en Banco')
  const cxp = fila(es, 'PASIVOS')
  const inventario = fila(es, 'Inventario')
  const compras = meses.map(() => 0)
  for (const l of mayor.lineas) {
    if (l.fuente !== 'com' || l.cuenta !== 'inventario' || (tienda && l.tienda !== tienda)) continue
    const k = meses.indexOf(ym(l.fecha))
    if (k >= 0) compras[k] += vista === 'CUP' ? l.cup : l.usd
  }
  const alertas = calcularAlertas(ds, mayor, tienda)
  const gastos = er.filas.filter((f) => f.tipo === 'linea' && f.cuentas?.[0]?.startsWith('res:gasto_') && Math.abs(f.valores[i]) > 0.005).map((f) => ({ label: f.label, valor: -f.valores[i] }))
  gastos.sort((a, b) => b.valor - a.valor)
  const porTienda = tienda
    ? []
    : ds.tiendas
        .map((t) => ({ label: t.nombre, valor: -idx.suma((c) => c.startsWith('res:ventas:') || c.startsWith('res:ingreso_tasa:'), mes, { tienda: t.id, vista }) }))
        .filter((x) => Math.abs(x.valor) > 0.005)
  const cuadre = es.filas.find((f) => f.tipo === 'control')?.valores ?? []
  const u = vista
  return (
    <>
      <Encabezado titulo="Dashboard" descripcion={`${tienda ? (ds.tiendas.find((t) => t.id === tienda)?.nombre ?? tienda) : 'Todo el grupo'} · ${nombreMes(mes)} · cifras en ${u}`}>
        <Link href="/reportes" className="btn">
          Ver estados financieros
        </Link>
      </Encabezado>
      {sp.sinPermiso && <Aviso tono="rojo">No tienes permiso para esa sección.</Aviso>}
      {cuadre.some((v) => Math.abs(v) > 0.01) && <Aviso tono="rojo">El Estado de Situación no cuadra. Revisa Contabilidad.</Aviso>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi titulo="Ventas netas" valor={fmt(ventasNetas[i], 0)} sub={delta(ventasNetas)} href="/ventas" />
        <Kpi titulo="Compras del mes" valor={fmt(compras[i], 0)} sub={delta(compras)} href="/compras" />
        <Kpi titulo="Margen bruto" valor={`${ventasNetas[i] ? fmt((bruta[i] / ventasNetas[i]) * 100, 1) : '0'} %`} sub={`Utilidad bruta ${fmt(bruta[i], 0)}`} tono={bruta[i] >= 0 ? 'bueno' : 'malo'} href="/reportes" />
        <Kpi titulo="Beneficio neto" valor={fmt(neto[i], 0)} sub={delta(neto)} tono={neto[i] >= 0 ? 'bueno' : 'malo'} href="/reportes" />
        <Kpi titulo="Efectivo (caja + banco)" valor={fmt(caja[i] + banco[i], 0)} sub={`Caja ${fmt(caja[i], 0)} · Banco ${fmt(banco[i], 0)}`} href="/caja" />
        <Kpi titulo="Inventario · Pasivos" valor={fmt(inventario[i], 0)} sub={`Pasivos ${fmt(cxp[i], 0)}`} href="/inventario" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="tarjeta p-4 lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold">Ventas, utilidad bruta y beneficio por mes ({u})</h2>
          <Barras
            etiquetas={meses.map(nombreMes)}
            series={[
              { nombre: 'Ventas netas', valores: ventasNetas },
              { nombre: 'Utilidad bruta', valores: bruta },
              { nombre: 'Beneficio neto', valores: neto },
            ]}
          />
        </div>
        <div className="tarjeta p-4">
          <h2 className="mb-3 text-sm font-semibold">{porTienda.length > 1 ? `Ventas por tienda · ${nombreMes(mes)}` : `Gastos de ${nombreMes(mes)}`}</h2>
          <Ranking filas={porTienda.length > 1 ? porTienda : gastos.slice(0, 8)} />
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="tarjeta p-4">
          <h2 className="mb-2 text-sm font-semibold">Posición de efectivo al cierre de cada mes ({u})</h2>
          <Barras
            etiquetas={meses.map(nombreMes)}
            series={[
              { nombre: 'Caja', valores: caja },
              { nombre: 'Banco', valores: banco },
            ]}
            alto={170}
          />
        </div>
        <div className="tarjeta p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Alertas activas</h2>
            <Link href="/alertas" className="text-xs text-primary hover:underline">
              Ver todas
            </Link>
          </div>
          {alertas.length ? (
            <ul className="space-y-2">
              {alertas.slice(0, 6).map((a, k) => (
                <li key={k} className="flex items-start gap-2 text-sm">
                  <Chip tono={a.severidad === 'alta' ? 'rojo' : a.severidad === 'media' ? 'ambar' : 'verde'}>{a.severidad === 'alta' ? 'Alta' : a.severidad === 'media' ? 'Media' : 'Baja'}</Chip>
                  {a.href ? (
                    <Link href={a.href} className="hover:underline">
                      {a.titulo}
                    </Link>
                  ) : (
                    <span>{a.titulo}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Sin alertas.</p>
          )}
        </div>
      </div>
      <div className="tarjeta mt-4 overflow-x-auto">
        <div className="flex items-center justify-between px-4 pt-3">
          <h2 className="text-sm font-semibold">Importaciones recientes</h2>
          <Link href="/importar" className="text-xs text-primary hover:underline">
            Importar
          </Link>
        </div>
        <table className="tabla mt-2">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Archivo</th>
              <th>Tipo</th>
              <th>Tienda</th>
              <th>Usuario</th>
              <th className="num">Filas</th>
            </tr>
          </thead>
          <tbody>
            {ds.importaciones.slice(0, 6).map((imp) => (
              <tr key={imp.id}>
                <td className="whitespace-nowrap">{imp.ts.slice(0, 16).replace('T', ' ')}</td>
                <td className="max-w-64 truncate">{imp.archivo}</td>
                <td>
                  <Chip tono="azul">{imp.tipo}</Chip>
                </td>
                <td>{ds.tiendas.find((t) => t.id === imp.tienda)?.nombre ?? imp.tienda}</td>
                <td>{imp.usuario}</td>
                <td className="num">{imp.filas.toLocaleString('es-ES')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
