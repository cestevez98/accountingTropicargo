import Link from 'next/link'
import { Encabezado, Importe, Vacio } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { nombreCuentaMayor } from '@/lib/catalog'
import { cargarContabilidad } from '@/lib/data'
import { FUENTE_LABEL, type Fuente, type Linea } from '@/lib/ledger'
import { param, type SP } from '@/lib/pagina'
import { fmt } from '@/lib/reports'

const POR_PAGINA = 300

function enlaceOrigen(l: Linea): string {
  const q = encodeURIComponent
  switch (l.fuente) {
    case 'mov':
      return `/movimientos?id=${q(l.ref)}`
    case 'fv':
      return `/facturacion?id=${q(l.ref)}`
    case 'fc':
      return `/registros/facturasCompra?id=${q(l.ref)}`
    case 'cxm':
      return `/registros/cxcManual?id=${q(l.ref)}`
    case 'dev':
      return `/registros/devengos?id=${q(l.ref)}`
    case 'asi':
      return `/registros/asientos?id=${q(l.ref)}`
    case 'dep':
      return `/registros/activos?id=${q(l.ref)}`
    default:
      return '/apertura'
  }
}

export default async function MayorPage({ searchParams }: { searchParams: SP }) {
  await requerirUsuario(['admin', 'contador', 'lectura'])
  const sp = await searchParams
  const { mayor } = await cargarContabilidad()
  const cuenta = param(sp, 'cuenta') ?? ''
  const categoria = param(sp, 'categoria') ?? ''
  const fuente = param(sp, 'fuente') ?? ''
  const desde = param(sp, 'desde') ?? ''
  const hasta = param(sp, 'hasta') ?? ''
  const q = (param(sp, 'q') ?? '').toLowerCase()
  const pagina = Math.max(1, Number(param(sp, 'p')) || 1)

  const cuentas = [...new Set(mayor.lineas.map((l) => l.cuenta))].sort((a, b) => nombreCuentaMayor(a).localeCompare(nombreCuentaMayor(b)))
  const filtroCuenta = (k: string) => !cuenta || (cuenta.endsWith(':*') ? k.startsWith(cuenta.slice(0, -1)) : k === cuenta)
  const hayFiltro = cuenta || categoria || fuente || q
  const lineas = hayFiltro
    ? mayor.lineas
        .filter(
          (l) =>
            filtroCuenta(l.cuenta) &&
            (!categoria || l.categoria === categoria) &&
            (!fuente || l.fuente === fuente) &&
            (!desde || l.fecha >= desde) &&
            (!hasta || l.fecha <= hasta) &&
            (!q || l.concepto.toLowerCase().includes(q)),
        )
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
    : []
  // Saldo anterior al período (solo con una cuenta concreta).
  const unaCuenta = cuenta && !cuenta.endsWith(':*')
  const saldoAnterior = unaCuenta && desde ? mayor.lineas.filter((l) => l.cuenta === cuenta && l.fecha < desde && (!categoria || l.categoria === categoria)).reduce((a, l) => a + l.importe, 0) : 0
  const debe = lineas.reduce((a, l) => a + (l.importe > 0 ? l.importe : 0), 0)
  const haber = lineas.reduce((a, l) => a + (l.importe < 0 ? -l.importe : 0), 0)
  let saldo = saldoAnterior
  const conSaldo = lineas.map((l) => ({ l, saldo: (saldo += l.importe) }))
  const visibles = conSaldo.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  const paginas = Math.ceil(lineas.length / POR_PAGINA)
  const urlPagina = (p: number) => {
    const u = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === 'string') as [string, string][])
    u.set('p', String(p))
    return `/mayor?${u}`
  }

  return (
    <>
      <Encabezado
        titulo="Libro mayor"
        descripcion="Todas las partidas que forman los informes. Debe = aumenta activos y gastos; Haber = aumenta pasivos, patrimonio e ingresos. En las cuentas de resultado, el ER muestra el importe con el signo contrario al debe."
      />
      <form className="tarjeta mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <label className="etiqueta">Cuenta</label>
          <select name="cuenta" defaultValue={cuenta} className="input">
            <option value="">— elige una cuenta —</option>
            <option value="res:*">Todas las cuentas de resultado (ER)</option>
            <option value="tes:*">Toda la tesorería</option>
            {cuentas.map((c) => (
              <option key={c} value={c}>
                {nombreCuentaMayor(c)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiqueta">Categoría</label>
          <input name="categoria" defaultValue={categoria} className="input" />
        </div>
        <div>
          <label className="etiqueta">Desde</label>
          <input type="date" name="desde" defaultValue={desde} className="input" />
        </div>
        <div>
          <label className="etiqueta">Hasta</label>
          <input type="date" name="hasta" defaultValue={hasta} className="input" />
        </div>
        <div>
          <label className="etiqueta">Origen</label>
          <select name="fuente" defaultValue={fuente} className="input">
            <option value="">Todos</option>
            {(Object.keys(FUENTE_LABEL) as Fuente[]).map((f) => (
              <option key={f} value={f}>
                {FUENTE_LABEL[f]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-5">
          <label className="etiqueta">Texto en el concepto</label>
          <input name="q" defaultValue={param(sp, 'q') ?? ''} className="input" />
        </div>
        <div className="flex items-end">
          <button className="btn btn-primario w-full justify-center">Filtrar</button>
        </div>
      </form>

      {!hayFiltro ? (
        <Vacio>Elige una cuenta o haz clic en una cifra de cualquier informe para ver su detalle.</Vacio>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-4 text-sm text-slate-600">
            <span>{lineas.length} partidas</span>
            <span>Debe: {fmt(debe)}</span>
            <span>Haber: {fmt(haber)}</span>
            <span className="font-medium text-slate-900">Neto (debe − haber): {fmt(debe - haber)}</span>
            {unaCuenta && desde && <span>Saldo anterior: {fmt(saldoAnterior)}</span>}
          </div>
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cuenta</th>
                  <th>Concepto</th>
                  <th>Categoría</th>
                  <th>Contrapartida</th>
                  <th>Origen</th>
                  <th className="num">Debe</th>
                  <th className="num">Haber</th>
                  {unaCuenta && <th className="num">Saldo</th>}
                </tr>
              </thead>
              <tbody>
                {visibles.map(({ l, saldo }, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap">{l.fecha}</td>
                    <td className="whitespace-nowrap">{nombreCuentaMayor(l.cuenta)}</td>
                    <td className="max-w-md">{l.concepto}</td>
                    <td className="whitespace-nowrap text-slate-500">{l.categoria}</td>
                    <td className="whitespace-nowrap text-slate-500">{nombreCuentaMayor(l.contra)}</td>
                    <td className="whitespace-nowrap">
                      <Link className="text-marca-600 hover:underline" href={enlaceOrigen(l)}>
                        {FUENTE_LABEL[l.fuente]}
                      </Link>
                    </td>
                    <td className="num">{l.importe > 0 ? <Importe v={l.importe} /> : ''}</td>
                    <td className="num">{l.importe < 0 ? <Importe v={-l.importe} /> : ''}</td>
                    {unaCuenta && (
                      <td className="num">
                        <Importe v={saldo} colorear />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {paginas > 1 && (
            <div className="mt-3 flex flex-wrap gap-1 text-sm">
              {Array.from({ length: paginas }, (_, i) => i + 1).map((p) => (
                <Link key={p} href={urlPagina(p)} className={`rounded px-2 py-1 ${p === pagina ? 'bg-marca-600 text-white' : 'bg-white hover:bg-slate-100'}`}>
                  {p}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
