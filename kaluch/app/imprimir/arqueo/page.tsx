import { notFound } from 'next/navigation'
import { requerirUsuario, tiendaFija } from '@/lib/auth'
import { cargarDataset } from '@/lib/data'
import { params, type SP } from '@/lib/pagina'
import { revisaArqueos } from '@/lib/permisos'
import { BILLETES_CUP, ITEMS_CHECKLIST } from '@/lib/turno'
import { Imprimir } from '../Imprimir'

const f2 = (n: number | undefined) => (n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hora = (h: string) => h.replace('T', ' ').slice(0, 16)

function Fila({ label, valor, fuerte }: { label: React.ReactNode; valor?: React.ReactNode; fuerte?: boolean }) {
  return (
    <tr className="border-b border-gray-400">
      <td className={`px-2 py-0.5 ${fuerte ? 'font-bold' : ''}`}>{label}</td>
      <td className={`px-2 text-right ${fuerte ? 'font-bold' : ''}`}>{valor}</td>
    </tr>
  )
}

/** Comprobante del cuadre de cambio de turno (modelo «Cuadre diario»), imprimible o en PDF. */
export default async function ComprobanteCuadre({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('arqueo')
  const sp = await params(searchParams)
  const ds = await cargarDataset()
  const a = ds.arqueos.find((x) => x.id === sp.id)
  const fija = tiendaFija(s)
  if (!a || (fija && a.tienda !== fija) || (!revisaArqueos(s.rol) && a.usuario !== s.email)) notFound()
  const tienda = ds.tiendas.find((t) => t.id === a.tienda)?.nombre ?? a.tienda
  const cant = new Map(a.billetes.map((b) => [b.valor, b.cantidad]))
  const subtotal = a.ventaTienda + a.domicilio + a.plataforma
  const totalCUP = a.billetes.reduce((x, b) => x + b.valor * b.cantidad, 0) + a.sueltosCUP
  return (
    <div className="mx-auto max-w-3xl bg-white p-6 text-[13px] text-black">
      <Imprimir />
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold">{ds.settings.empresa}</h1>
          <div className="font-semibold">MODELO DE CUADRE DIARIO · cambio de turno</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">No. {String(a.numero).padStart(6, '0')}</div>
          <div>{a.estado === 'aprobado' ? `Aprobado por ${a.revisadoPor}` : 'Pendiente de revisión'}</div>
        </div>
      </div>
      <table className="mt-2 w-full border border-black">
        <tbody>
          <tr className="border-b border-black">
            <td className="px-2 py-1">
              <b>Tienda:</b> {tienda} · {a.cajaNombre}
            </td>
            <td className="px-2">
              <b>Cajero(a):</b> {a.cajero}
            </td>
          </tr>
          <tr>
            <td className="px-2 py-1">
              <b>Turno:</b> {a.turno === 'noche' ? 'NOCHE' : 'DÍA'} · {hora(a.desde)} → {hora(a.hasta)}
            </td>
            <td className="px-2">
              <b>Tickets en el TPV:</b> {a.tpv.tickets}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <table className="w-full border border-black">
          <tbody>
            <Fila label="Venta en tienda (TPV)" valor={f2(a.ventaTienda)} />
            <Fila label="Venta a domicilio" valor={a.domicilio ? f2(a.domicilio) : ''} />
            <Fila label="Venta en plataforma" valor={a.plataforma ? f2(a.plataforma) : ''} />
            <Fila label="Subtotal" valor={f2(subtotal)} fuerte />
            <Fila label={<b>Otros gastos</b>} />
            {a.gastos.map((g, i) => (
              <Fila key={i} label={g.concepto} valor={f2(g.importe)} />
            ))}
            <Fila label="Salario" valor={f2(a.salario)} />
            <Fila label="Cant. trabajadores" valor={a.trabajadores} />
            <Fila label={<b>Total transferencias</b>} valor={f2(a.transferencias.reduce((x, t) => x + t.importe, 0))} />
            {a.transferencias.map((t, i) => (
              <Fila key={i} label={t.cuenta} valor={f2(t.importe)} />
            ))}
            <Fila label="Ventas por cobrar" valor={a.porCobrar ? f2(a.porCobrar) : ''} />
          </tbody>
        </table>
        <table className="w-full border border-black">
          <tbody>
            {BILLETES_CUP.filter((b) => b >= 5 || cant.get(b)).map((b) => (
              <Fila key={b} label={`${b} ×  ${cant.get(b) ?? ''}`} valor={cant.get(b) ? f2(b * cant.get(b)!) : ''} />
            ))}
            {a.sueltosCUP ? <Fila label="Sueltos" valor={f2(a.sueltosCUP)} /> : null}
            <Fila label="Total efectivo CUP" valor={f2(totalCUP)} fuerte />
            <Fila label={`USD ${a.usd || ''} × ${a.usd ? a.tasaUSD : ''}`} valor={a.usd ? f2(a.usd * a.tasaUSD) : ''} />
            <Fila label={`EUR ${a.eur || ''} × ${a.eur ? a.tasaEUR : ''}`} valor={a.eur ? f2(a.eur * a.tasaEUR) : ''} />
            {a.otros ? <Fila label="Otros" valor={f2(a.otros)} /> : null}
            {a.fondo ? <Fila label="Fondo que queda en caja" valor={f2(a.fondo)} /> : null}
          </tbody>
        </table>
      </div>
      <table className="mt-3 w-full border-2 border-black text-sm">
        <tbody>
          <Fila label="Efectivo esperado (subtotal − transferencias − por cobrar − otros gastos)" valor={f2(a.esperado)} />
          <Fila label="Total de efectivo" valor={f2(a.contado)} fuerte />
          <Fila label="Diferencia" valor={Math.abs(a.diferencia) < 0.5 ? 'Cuadra' : `${a.diferencia > 0 ? 'Sobrante +' : 'Faltante '}${f2(a.diferencia)}`} fuerte />
          <Fila label={a.estado === 'aprobado' ? 'Salario aprobado (se paga en «Pagos al personal»)' : 'Salario propuesto (lo decide el contador)'} valor={f2(a.salario)} />
          <Fila label="A entregar a la caja central (efectivo − fondo)" valor={f2(a.contado - a.fondo)} fuerte />
        </tbody>
      </table>
      {Object.keys(a.tpv.porCajero).length > 1 && (
        <p className="mt-2">
          <b>Venta por cajero en el TPV:</b>{' '}
          {Object.entries(a.tpv.porCajero)
            .map(([k, v]) => `${k} ${f2(v)}`)
            .join(' · ')}
        </p>
      )}
      <p className="mt-1">
        <b>Cobros en el TPV:</b> efectivo {f2(a.tpv.efectivo)}
        {Object.entries(a.tpv.noEfectivo).map(([k, v]) => ` · ${k} ${f2(v)}`)}
      </p>
      {a.tpv.pax && Object.keys(a.tpv.pax).length > 0 && (
        <p className="mt-1">
          <b>Pax:</b>{' '}
          {Object.entries(a.tpv.pax)
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ')}
          {a.paxCompra ? ` · PAX COMPRA ${a.paxCompra}` : ''}
          {a.paxMuseo ? ` · PAX MUSEO ${a.paxMuseo}` : ''}
          {a.energia?.inversor != null ? ` · Inversor ${a.energia.inversor} %` : ''}
          {a.energia?.ecoflow != null ? ` · EcoFlow ${a.energia.ecoflow} %` : ''}
        </p>
      )}
      {a.tarjetas && a.tarjetas.length > 0 && (
        <>
          <h2 className="mt-3 font-semibold">Venta por tarjeta</h2>
          <table className="w-full border border-black text-xs">
            <tbody>
              {a.tarjetas.map((t, i) => (
                <tr key={i} className="border-b border-gray-400">
                  <td className="px-2">{i + 1}</td>
                  <td className="px-2">{t.cuenta}</td>
                  <td className="px-2 font-mono">{t.numero}</td>
                  <td className="px-2 text-right">{f2(t.importe)}</td>
                  <td className="px-2">{t.ci}</td>
                  <td className="px-2">{t.titular}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {a.checklist && (
        <p className="mt-2">
          <b>Check list:</b>{' '}
          {(() => {
            const malos = ITEMS_CHECKLIST.filter((i) => !a.checklist?.[i.id]?.ok || a.checklist?.[i.id]?.obs)
            return malos.length ? malos.map((i) => `${i.texto}${a.checklist?.[i.id]?.obs ? ` (${a.checklist[i.id].obs})` : ' (sin marcar)'}`).join(' · ') : 'todo bien.'
          })()}
        </p>
      )}
      {a.observaciones && (
        <p className="mt-1">
          <b>Observaciones:</b> {a.observaciones}
        </p>
      )}
      {a.avisoTPV && <p className="mt-1 italic">{a.avisoTPV}</p>}
      <table className="mt-6 w-full border border-black text-sm">
        <thead>
          <tr className="border-b border-black">
            <th className="px-2 py-1 text-left">Responsable</th>
            <th className="text-left">Entrega (nombre y firma)</th>
            <th className="text-left">Recibe (nombre y firma)</th>
          </tr>
        </thead>
        <tbody>
          {(['cajero', 'dependiente', 'seguridad'] as const).map((r) => (
            <tr key={r} className="h-10 border-b border-gray-400">
              <td className="px-2 capitalize">{r}</td>
              <td>{a.firmas?.[r]?.entrega}</td>
              <td>{a.firmas?.[r]?.recibe}</td>
            </tr>
          ))}
          <tr className="h-10">
            <td className="px-2">Revisa (contador/a)</td>
            <td colSpan={2}>{a.revisadoPor ?? ''}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
