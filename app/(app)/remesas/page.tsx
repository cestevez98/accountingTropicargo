import Link from 'next/link'
import { Encabezado, Kpi } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { cargarDataset } from '@/lib/data'
import { hoy } from '@/lib/fecha'
import { AGENTE_PROPIO } from '@/lib/ledger'
import { param, type SP } from '@/lib/pagina'
import { fmt } from '@/lib/reports'
import type { Remesa } from '@/lib/types'
import { AjustesRemesas, Liquidacion, TablaRemesas, type RemesaVista } from './Remesas'

const POR_PAGINA = 100

export default async function RemesasPage({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario(['admin', 'contador', 'cajero', 'lectura', 'agente'])
  const sp = await searchParams
  const ds = await cargarDataset()
  const esAgente = s.rol === 'agente'
  let todas = ds.remesas ?? []
  if (esAgente) todas = todas.filter((r) => r.agente === s.agente)

  const f = {
    estado: param(sp, 'estado') ?? (esAgente ? 'asignada' : ''),
    agente: param(sp, 'agente') ?? '',
    mes: param(sp, 'mes') ?? '',
    q: (param(sp, 'q') ?? '').toLowerCase(),
    id: param(sp, 'id') ?? '',
  }
  const filtradas = todas
    .filter((r) => {
      if (f.id) return r.id === f.id
      if (f.estado === 'sin-liquidar') return r.estado === 'entregada' && !r.liquidacion
      if (f.estado && r.estado !== f.estado) return false
      if (f.agente && r.agente !== f.agente) return false
      if (f.mes && !r.fecha.startsWith(f.mes)) return false
      if (f.q && !`${r.numero} ${r.remitente} ${r.beneficiario} ${r.beneficiarioTelefono ?? ''} ${r.beneficiarioCI ?? ''} ${r.provincia ?? ''}`.toLowerCase().includes(f.q)) return false
      return true
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.numero.localeCompare(a.numero))
  const pagina = Math.max(1, Number(param(sp, 'p')) || 1)
  const visibles = filtradas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)

  // El agente no ve la comisión ni por dónde pagó el cliente.
  const vista = (r: Remesa): RemesaVista => (esAgente ? { ...r, comision: 0, cuentaCobro: undefined, remitenteTelefono: undefined, creadoPor: undefined } : r)

  const porEntregar = todas.filter((r) => r.estado === 'asignada' || r.estado === 'pendiente')
  const sinLiquidar = todas.filter((r) => r.estado === 'entregada' && !r.liquidacion && r.agente !== AGENTE_PROPIO)
  const mes = hoy().slice(0, 7)
  const comisionesMes = todas.filter((r) => r.estado !== 'cancelada' && r.fecha.startsWith(mes)).reduce((a, r) => a + r.comision, 0)
  const agentes = ds.settings.agentesRemesas ?? ['DVA']
  const puedeCrear = ['admin', 'contador', 'cajero'].includes(s.rol)
  const puedeGestionar = s.rol === 'admin' || s.rol === 'contador'
  const cuentas = ds.cuentas.filter((c) => c.activa).sort((a, b) => a.orden - b.orden).map((c) => c.nombre)
  const qs = (extra: Record<string, string>) => `/remesas?${new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), ...extra })}`

  return (
    <>
      <Encabezado
        titulo={esAgente ? `Remesas de ${s.agente}` : 'Remesas'}
        descripcion={
          esAgente
            ? 'Remesas asignadas para entregar. Al entregar una, márcala como entregada e indica quién la recibió (puedes añadir una foto).'
            : `El cliente paga aquí (el cobro se registra como movimiento «Remesa»), el agente la entrega en Cuba con su dinero y luego se le liquida. Comisión: ${ds.settings.comisionRemesasPct ?? 10}% sobre el monto.`
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi titulo="Por entregar" valor={String(porEntregar.length)} sub={`${fmt(porEntregar.reduce((a, r) => a + r.monto, 0))} USD`} href="/remesas?estado=asignada" tono={porEntregar.length ? 'malo' : 'bueno'} />
        <Kpi
          titulo={esAgente ? 'Entregadas pendientes de pago' : 'Entregadas sin liquidar al agente'}
          valor={`${fmt(sinLiquidar.reduce((a, r) => a + r.monto, 0))} USD`}
          sub={`${sinLiquidar.length} remesas`}
          href="/remesas?estado=sin-liquidar"
        />
        {!esAgente && <Kpi titulo={`Comisiones de ${mes}`} valor={`${fmt(comisionesMes)} USD`} href="/er" />}
        <Kpi titulo="Total de remesas" valor={String(todas.length)} sub={`${todas.filter((r) => r.estado === 'entregada').length} entregadas`} />
      </div>

      <form className="tarjeta mb-3 flex flex-wrap items-end gap-3 p-3">
        <div className="min-w-48 flex-1">
          <label className="etiqueta">Buscar (nº, remitente, beneficiario, teléfono, CI, provincia)</label>
          <input name="q" defaultValue={param(sp, 'q') ?? ''} className="input" />
        </div>
        <div>
          <label className="etiqueta">Estado</label>
          <select name="estado" defaultValue={f.estado} className="input">
            <option value="">Todos</option>
            <option value="asignada">Por entregar</option>
            <option value="entregada">Entregadas</option>
            <option value="sin-liquidar">Entregadas sin liquidar</option>
            <option value="cancelada">Canceladas</option>
          </select>
        </div>
        {!esAgente && (
          <div>
            <label className="etiqueta">Agente</label>
            <select name="agente" defaultValue={f.agente} className="input">
              <option value="">Todos</option>
              {[...agentes, AGENTE_PROPIO].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="etiqueta">Mes</label>
          <input type="month" name="mes" defaultValue={f.mes} className="input" />
        </div>
        <button className="btn btn-primario">Filtrar</button>
        <Link className="btn" href="/remesas?estado=">
          Ver todas
        </Link>
      </form>

      <TablaRemesas
        remesas={visibles.map(vista)}
        agentes={[...agentes, AGENTE_PROPIO]}
        cuentas={cuentas}
        comisionPct={ds.settings.comisionRemesasPct ?? 10}
        rol={s.rol}
        puedeCrear={puedeCrear}
        puedeGestionar={puedeGestionar}
      />
      <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
        <span>
          {filtradas.length} remesas · página {pagina} de {Math.max(1, Math.ceil(filtradas.length / POR_PAGINA))}
        </span>
        <div className="flex gap-1">
          {pagina > 1 && (
            <Link className="btn !py-1" href={qs({ p: String(pagina - 1) })}>
              ← Anterior
            </Link>
          )}
          {pagina * POR_PAGINA < filtradas.length && (
            <Link className="btn !py-1" href={qs({ p: String(pagina + 1) })}>
              Siguiente →
            </Link>
          )}
        </div>
      </div>

      {puedeGestionar && (
        <div className="mt-8 grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <Liquidacion
              agentes={agentes}
              cuentas={cuentas}
              pendientes={sinLiquidar.map((r) => ({ id: r.id, numero: r.numero, agente: r.agente, fechaEntrega: r.fechaEntrega ?? '', beneficiario: r.beneficiario, monto: r.monto }))}
            />
          </div>
          {s.rol === 'admin' && <AjustesRemesas pct={ds.settings.comisionRemesasPct ?? 10} agentes={agentes} />}
        </div>
      )}
    </>
  )
}
