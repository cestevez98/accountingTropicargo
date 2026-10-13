'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { cambiarEstadoRemesa, entregarRemesa, guardarAjustesRemesas, guardarRemesa, liquidarAgente } from '@/app/acciones'
import type { Remesa, Rol } from '@/lib/types'

export type RemesaVista = Remesa

const nf = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })
const fmt = (n: number | undefined) => (n == null || !Number.isFinite(n) ? '' : nf.format(n))
const hoy = () => new Date().toISOString().slice(0, 10)

const ESTADO: Record<Remesa['estado'], { t: string; c: string }> = {
  pendiente: { t: 'Pendiente', c: 'bg-amber-100 text-amber-800' },
  asignada: { t: 'Por entregar', c: 'bg-sky-100 text-sky-800' },
  entregada: { t: 'Entregada', c: 'bg-emerald-100 text-emerald-800' },
  cancelada: { t: 'Cancelada', c: 'bg-slate-200 text-slate-600' },
}

const PROVINCIAS = [
  'Pinar del Río',
  'Artemisa',
  'La Habana',
  'Mayabeque',
  'Matanzas',
  'Cienfuegos',
  'Villa Clara',
  'Sancti Spíritus',
  'Ciego de Ávila',
  'Camagüey',
  'Las Tunas',
  'Holguín',
  'Granma',
  'Santiago de Cuba',
  'Guantánamo',
  'Isla de la Juventud',
]

function useAviso() {
  const [aviso, setAviso] = useState<{ ok: boolean; t: string } | null>(null)
  const mostrar = (ok: boolean, t: string) => {
    setAviso({ ok, t })
    setTimeout(() => setAviso(null), 5000)
  }
  const nodo = aviso && <span className={`rounded-md px-3 py-1.5 text-sm ${aviso.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{aviso.t}</span>
  return { mostrar, nodo }
}

export function TablaRemesas({
  remesas,
  agentes,
  cuentas,
  comisionPct,
  rol,
  puedeCrear,
  puedeGestionar,
}: {
  remesas: RemesaVista[]
  agentes: string[]
  cuentas: string[]
  comisionPct: number
  rol: Rol
  puedeCrear: boolean
  puedeGestionar: boolean
}) {
  const router = useRouter()
  const [editando, setEditando] = useState<RemesaVista | 'nueva' | null>(null)
  const [entregando, setEntregando] = useState<RemesaVista | null>(null)
  const [viendo, setViendo] = useState<RemesaVista | null>(null)
  const [pendiente, start] = useTransition()
  const { mostrar, nodo } = useAviso()
  const esAgente = rol === 'agente'

  const estado = (r: RemesaVista, e: 'asignada' | 'cancelada') => {
    if (e === 'cancelada' && !confirm(`¿Cancelar la remesa ${r.numero}?`)) return
    start(async () => {
      const x = await cambiarEstadoRemesa(r.id, e)
      mostrar(x.ok, x.ok ? (x.mensaje ?? '') : x.error)
      if (x.ok) router.refresh()
    })
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {puedeCrear && (
          <button className="btn btn-primario" onClick={() => setEditando('nueva')}>
            + Nueva remesa
          </button>
        )}
        {nodo}
      </div>
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Nº</th>
              <th>Fecha</th>
              {!esAgente && <th>Remitente</th>}
              <th>Beneficiario</th>
              <th>Provincia</th>
              <th className="num">A entregar</th>
              {!esAgente && <th className="num">Monto USD</th>}
              {!esAgente && <th className="num">Comisión</th>}
              {!esAgente && <th>Agente</th>}
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {remesas.length === 0 && (
              <tr>
                <td colSpan={11} className="py-8 text-center text-slate-500">
                  No hay remesas con estos filtros.
                </td>
              </tr>
            )}
            {remesas.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap font-medium">
                  <button className="text-marca-600 hover:underline" onClick={() => setViendo(r)}>
                    {r.numero}
                  </button>
                </td>
                <td className="whitespace-nowrap">{r.fecha}</td>
                {!esAgente && <td>{r.remitente}</td>}
                <td>
                  {r.beneficiario}
                  {r.beneficiarioTelefono && <div className="text-xs text-slate-500">{r.beneficiarioTelefono}</div>}
                </td>
                <td className="whitespace-nowrap">{r.provincia}</td>
                <td className="num font-medium">
                  {r.monedaEntrega === 'CUP' ? nf0.format(r.montoEntregar) : fmt(r.montoEntregar)} {r.monedaEntrega}
                </td>
                {!esAgente && <td className="num">{fmt(r.monto)}</td>}
                {!esAgente && <td className="num">{fmt(r.comision)}</td>}
                {!esAgente && <td className="whitespace-nowrap">{r.agente}</td>}
                <td className="whitespace-nowrap">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${ESTADO[r.estado].c}`}>{ESTADO[r.estado].t}</span>
                  {r.estado === 'entregada' && <div className="text-[11px] text-slate-500">{r.fechaEntrega}{r.liquidacion ? ' · liquidada' : ''}</div>}
                </td>
                <td className="whitespace-nowrap text-right">
                  {(r.estado === 'asignada' || r.estado === 'pendiente') && (
                    <button className="px-1.5 font-medium text-emerald-700 hover:underline" onClick={() => setEntregando(r)}>
                      Entregada
                    </button>
                  )}
                  {puedeCrear && !r.liquidacion && r.estado !== 'cancelada' && (
                    <button className="px-1.5 text-marca-600 hover:underline" onClick={() => setEditando(r)}>
                      Editar
                    </button>
                  )}
                  {puedeGestionar && !r.liquidacion && r.estado !== 'cancelada' && (
                    <button className="px-1.5 text-red-600 hover:underline" disabled={pendiente} onClick={() => estado(r, 'cancelada')}>
                      Cancelar
                    </button>
                  )}
                  {puedeGestionar && !r.liquidacion && (r.estado === 'cancelada' || r.estado === 'entregada') && (
                    <button className="px-1.5 text-slate-500 hover:underline" disabled={pendiente} onClick={() => estado(r, 'asignada')}>
                      Reabrir
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando && (
        <FormRemesa
          remesa={editando === 'nueva' ? null : editando}
          agentes={agentes}
          cuentas={cuentas}
          comisionPct={comisionPct}
          onCerrar={() => setEditando(null)}
          onGuardado={(m) => {
            mostrar(true, m)
            router.refresh()
          }}
        />
      )}
      {entregando && (
        <FormEntrega
          remesa={entregando}
          onCerrar={() => setEntregando(null)}
          onGuardado={(m) => {
            mostrar(true, m)
            router.refresh()
          }}
        />
      )}
      {viendo && <Detalle remesa={viendo} esAgente={esAgente} onCerrar={() => setViendo(null)} />}
    </div>
  )
}

function Modal({ titulo, children, onCerrar }: { titulo: string; children: React.ReactNode; onCerrar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => ref.current?.showModal(), [])
  return (
    <dialog ref={ref} onClose={onCerrar} className="m-auto w-full max-w-2xl rounded-xl p-0 shadow-2xl backdrop:bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h2 className="font-semibold text-slate-900">{titulo}</h2>
        <button type="button" onClick={onCerrar} className="rounded px-2 text-xl leading-none text-slate-400 hover:text-slate-700" aria-label="Cerrar">
          ×
        </button>
      </div>
      {children}
    </dialog>
  )
}

function Campo({ label, children, ancho }: { label: string; children: React.ReactNode; ancho?: boolean }) {
  return (
    <div className={ancho ? 'sm:col-span-2' : ''}>
      <label className="etiqueta">{label}</label>
      {children}
    </div>
  )
}

function FormRemesa({
  remesa,
  agentes,
  cuentas,
  comisionPct,
  onCerrar,
  onGuardado,
}: {
  remesa: RemesaVista | null
  agentes: string[]
  cuentas: string[]
  comisionPct: number
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const [monto, setMonto] = useState(remesa ? String(remesa.monto) : '')
  const [comision, setComision] = useState(remesa ? String(remesa.comision) : '')
  const [moneda, setMoneda] = useState<string>(remesa?.monedaEntrega ?? 'USD')
  const [tasa, setTasa] = useState(remesa?.tasaEntrega ? String(remesa.tasaEntrega) : '')
  const [error, setError] = useState<string | null>(null)
  const [pendiente, start] = useTransition()
  const m = Number(monto.replace(',', '.')) || 0
  const comisionCalc = comision === '' ? Math.round(m * comisionPct) / 100 : Number(comision.replace(',', '.')) || 0
  const aEntregar = moneda === 'CUP' ? Math.round(m * (Number(tasa) || 0)) : m

  return (
    <Modal titulo={remesa ? `Editar remesa ${remesa.numero}` : 'Nueva remesa'} onCerrar={onCerrar}>
      <form
        className="flex max-h-[85vh] flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          const fd = Object.fromEntries(new FormData(e.currentTarget))
          setError(null)
          start(async () => {
            const r = await guardarRemesa(remesa?.id ?? null, { ...fd, comision })
            if (!r.ok) return setError(r.error)
            onGuardado(r.mensaje ?? '')
            onCerrar()
          })
        }}
      >
        <div className="grid gap-4 overflow-y-auto px-5 py-4 sm:grid-cols-2">
          <Campo label="Fecha *">
            <input type="date" name="fecha" required defaultValue={remesa?.fecha ?? hoy()} className="input" />
          </Campo>
          <Campo label="Cliente pagó por (cuenta)">
            <select name="cuentaCobro" defaultValue={remesa?.cuentaCobro ?? ''} className="input">
              <option value="">—</option>
              {cuentas.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Remitente (cliente) *">
            <input name="remitente" required defaultValue={remesa?.remitente} className="input" autoFocus />
          </Campo>
          <Campo label="Teléfono del remitente">
            <input name="remitenteTelefono" defaultValue={remesa?.remitenteTelefono} className="input" />
          </Campo>
          <Campo label="Beneficiario *">
            <input name="beneficiario" required defaultValue={remesa?.beneficiario} className="input" />
          </Campo>
          <Campo label="Teléfono del beneficiario">
            <input name="beneficiarioTelefono" defaultValue={remesa?.beneficiarioTelefono} className="input" />
          </Campo>
          <Campo label="Carnet de identidad">
            <input name="beneficiarioCI" defaultValue={remesa?.beneficiarioCI} className="input" />
          </Campo>
          <Campo label="Provincia">
            <select name="provincia" defaultValue={remesa?.provincia ?? ''} className="input">
              <option value="">—</option>
              {PROVINCIAS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Dirección de entrega" ancho>
            <input name="direccion" defaultValue={remesa?.direccion} className="input" />
          </Campo>
          <Campo label="Monto a enviar (USD) *">
            <input name="monto" type="number" step="0.01" required value={monto} onChange={(e) => setMonto(e.target.value)} className="input" />
          </Campo>
          <Campo label={`Comisión (vacío = ${comisionPct}%)`}>
            <input type="number" step="0.01" value={comision} placeholder={fmt(comisionCalc)} onChange={(e) => setComision(e.target.value)} className="input" />
          </Campo>
          <Campo label="Se entrega en">
            <select name="monedaEntrega" value={moneda} onChange={(e) => setMoneda(e.target.value)} className="input">
              <option value="USD">USD en efectivo</option>
              <option value="CUP">CUP</option>
              <option value="MLC">MLC / tarjeta</option>
              <option value="EUR">EUR</option>
            </select>
          </Campo>
          {moneda === 'CUP' ? (
            <Campo label="Tasa de entrega (CUP por USD) *">
              <input name="tasaEntrega" type="number" step="0.01" required value={tasa} onChange={(e) => setTasa(e.target.value)} className="input" />
            </Campo>
          ) : (
            <div />
          )}
          <Campo label="Agente que la entrega *">
            <select name="agente" required defaultValue={remesa?.agente ?? agentes[0]} className="input">
              {agentes.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Notas">
            <input name="notas" defaultValue={remesa?.notas} className="input" />
          </Campo>
          <div className="rounded-md bg-marca-50 px-3 py-2 text-sm sm:col-span-2">
            El cliente paga <b>{fmt(m + comisionCalc)} USD</b> ({fmt(m)} + {fmt(comisionCalc)} de comisión). El beneficiario recibe{' '}
            <b>
              {moneda === 'CUP' ? nf0.format(aEntregar) : fmt(aEntregar)} {moneda}
            </b>
            . Al entregarla se le deben {fmt(m)} USD al agente.
          </div>
        </div>
        {error && <p className="mx-5 mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button type="button" className="btn" onClick={onCerrar}>
            Cancelar
          </button>
          <button className="btn btn-primario" disabled={pendiente}>
            {pendiente ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** Reduce la foto en el navegador (máx. 1600 px, JPEG) para que suba rápido desde el móvil. */
async function comprimir(file: File): Promise<string> {
  const img = await createImageBitmap(file)
  const escala = Math.min(1, 1600 / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * escala)
  c.height = Math.round(img.height * escala)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.8)
}

function FormEntrega({ remesa, onCerrar, onGuardado }: { remesa: RemesaVista; onCerrar: () => void; onGuardado: (m: string) => void }) {
  const [fotos, setFotos] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pendiente, start] = useTransition()
  return (
    <Modal titulo={`Entregar ${remesa.numero}`} onCerrar={onCerrar}>
      <form
        className="space-y-4 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget)
          setError(null)
          start(async () => {
            const r = await entregarRemesa(remesa.id, String(fd.get('fecha')), String(fd.get('comprobante') ?? ''), fotos)
            if (!r.ok) return setError(r.error)
            onGuardado(r.mensaje ?? '')
            onCerrar()
          })
        }}
      >
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
          <b>{remesa.beneficiario}</b> {remesa.beneficiarioTelefono && `· ${remesa.beneficiarioTelefono}`}
          <br />
          {remesa.direccion} {remesa.provincia && `(${remesa.provincia})`}
          <br />
          Entregar:{' '}
          <b>
            {remesa.monedaEntrega === 'CUP' ? nf0.format(remesa.montoEntregar) : fmt(remesa.montoEntregar)} {remesa.monedaEntrega}
          </b>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Fecha de entrega *">
            <input type="date" name="fecha" required defaultValue={hoy()} className="input" />
          </Campo>
          <Campo label="Quién recibió / observaciones">
            <input name="comprobante" className="input" placeholder="p. ej. Recibió su hija Ana, CI 85…" />
          </Campo>
          <Campo label="Fotos del comprobante (opcional, hasta 4)" ancho>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-marca-600 file:px-3 file:py-1.5 file:text-white"
              onChange={async (e) => {
                const fs = [...(e.target.files ?? [])].slice(0, 4)
                try {
                  setFotos(await Promise.all(fs.map(comprimir)))
                } catch {
                  setError('No se pudo leer la foto.')
                }
              }}
            />
            {fotos.length > 0 && (
              <div className="mt-2 flex gap-2">
                {fotos.map((f, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={f} alt="" className="h-20 w-20 rounded object-cover" />
                ))}
              </div>
            )}
          </Campo>
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onCerrar}>
            Cancelar
          </button>
          <button className="btn btn-primario" disabled={pendiente}>
            {pendiente ? 'Guardando…' : 'Confirmar entrega'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Detalle({ remesa: r, esAgente, onCerrar }: { remesa: RemesaVista; esAgente: boolean; onCerrar: () => void }) {
  const filas: [string, React.ReactNode][] = [
    ['Fecha', r.fecha],
    ['Remitente', `${r.remitente}${r.remitenteTelefono ? ` · ${r.remitenteTelefono}` : ''}`],
    ['Beneficiario', `${r.beneficiario}${r.beneficiarioTelefono ? ` · ${r.beneficiarioTelefono}` : ''}${r.beneficiarioCI ? ` · CI ${r.beneficiarioCI}` : ''}`],
    ['Dirección', `${r.direccion ?? ''} ${r.provincia ? `(${r.provincia})` : ''}`],
    ['A entregar', `${r.monedaEntrega === 'CUP' ? nf0.format(r.montoEntregar) : fmt(r.montoEntregar)} ${r.monedaEntrega}${r.tasaEntrega ? ` (tasa ${r.tasaEntrega})` : ''}`],
    ...(!esAgente
      ? ([
          ['Monto / comisión', `${fmt(r.monto)} + ${fmt(r.comision)} USD`],
          ['Cobrado por', r.cuentaCobro ?? '—'],
          ['Creada por', r.creadoPor ?? '—'],
        ] as [string, React.ReactNode][])
      : []),
    ['Agente', r.agente],
    ['Estado', `${ESTADO[r.estado].t}${r.fechaEntrega ? ` el ${r.fechaEntrega}` : ''}${r.liquidacion ? ' · liquidada al agente' : ''}`],
    ['Comprobante', r.comprobante ?? '—'],
    ['Notas', r.notas ?? '—'],
  ]
  return (
    <Modal titulo={`Remesa ${r.numero}`} onCerrar={onCerrar}>
      <div className="px-5 py-4">
        <table className="w-full text-sm">
          <tbody>
            {filas.map(([k, v]) => (
              <tr key={k} className="border-b border-slate-100">
                <td className="w-40 py-1.5 text-slate-500">{k}</td>
                <td className="py-1.5">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.fotos && r.fotos.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {r.fotos.map((f) => (
              <a key={f} href={`/api/archivo?ruta=${encodeURIComponent(f)}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/archivo?ruta=${encodeURIComponent(f)}`} alt="Comprobante" className="h-28 w-28 rounded object-cover" />
              </a>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

export function Liquidacion({
  agentes,
  cuentas,
  pendientes,
}: {
  agentes: string[]
  cuentas: string[]
  pendientes: { id: string; numero: string; agente: string; fechaEntrega: string; beneficiario: string; monto: number }[]
}) {
  const router = useRouter()
  const [agente, setAgente] = useState(agentes[0] ?? '')
  const [marcadas, setMarcadas] = useState<Set<string> | null>(null)
  const [cuenta, setCuenta] = useState('')
  const [fecha, setFecha] = useState(hoy())
  const [pendiente, start] = useTransition()
  const { mostrar, nodo } = useAviso()
  const lista = useMemo(() => pendientes.filter((p) => p.agente === agente).sort((a, b) => a.fechaEntrega.localeCompare(b.fechaEntrega)), [pendientes, agente])
  const sel = marcadas ?? new Set(lista.map((p) => p.id))
  const total = lista.filter((p) => sel.has(p.id)).reduce((a, p) => a + p.monto, 0)
  return (
    <section className="tarjeta p-5">
      <h2 className="mb-1 font-semibold text-slate-900">Pagar al agente</h2>
      <p className="mb-3 text-sm text-slate-500">Remesas entregadas que todavía no se le han pagado. Al registrar el pago se crea la salida de dinero en la cuenta elegida.</p>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="etiqueta">Agente</label>
          <select
            value={agente}
            onChange={(e) => {
              setAgente(e.target.value)
              setMarcadas(null)
            }}
            className="input"
          >
            {agentes.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiqueta">Se paga desde</label>
          <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} className="input">
            <option value="">— elige —</option>
            {cuentas.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiqueta">Fecha del pago</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="input" />
        </div>
        <button
          className="btn btn-primario"
          disabled={pendiente || !cuenta || !sel.size || !lista.length}
          onClick={() => {
            if (!confirm(`Registrar pago de ${fmt(total)} USD a ${agente} desde ${cuenta}?`)) return
            start(async () => {
              const r = await liquidarAgente(agente, [...sel].filter((id) => lista.some((p) => p.id === id)), cuenta, fecha)
              mostrar(r.ok, r.ok ? (r.mensaje ?? '') : r.error)
              if (r.ok) {
                setMarcadas(null)
                router.refresh()
              }
            })
          }}
        >
          Registrar pago de {fmt(total)} USD
        </button>
        {nodo}
      </div>
      <div className="max-h-80 overflow-auto rounded border border-slate-200">
        <table className="tabla">
          <thead>
            <tr>
              <th className="w-8" />
              <th>Nº</th>
              <th>Entregada</th>
              <th>Beneficiario</th>
              <th className="num">USD</th>
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-slate-500">
                  No hay nada pendiente de pagar a {agente}.
                </td>
              </tr>
            )}
            {lista.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={sel.has(p.id)}
                    onChange={() => {
                      const s = new Set(sel)
                      if (s.has(p.id)) s.delete(p.id)
                      else s.add(p.id)
                      setMarcadas(s)
                    }}
                  />
                </td>
                <td>{p.numero}</td>
                <td>{p.fechaEntrega}</td>
                <td>{p.beneficiario}</td>
                <td className="num">{fmt(p.monto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function AjustesRemesas({ pct, agentes }: { pct: number; agentes: string[] }) {
  const router = useRouter()
  const [p, setP] = useState(String(pct))
  const [a, setA] = useState(agentes.join(', '))
  const [pendiente, start] = useTransition()
  const { mostrar, nodo } = useAviso()
  return (
    <section className="tarjeta space-y-3 p-5">
      <h2 className="font-semibold text-slate-900">Ajustes</h2>
      <div>
        <label className="etiqueta">Comisión por defecto (%)</label>
        <input type="number" step="0.1" value={p} onChange={(e) => setP(e.target.value)} className="input !w-28" />
      </div>
      <div>
        <label className="etiqueta">Agentes que entregan (separados por coma)</label>
        <input value={a} onChange={(e) => setA(e.target.value)} className="input" />
        <p className="mt-1 text-xs text-slate-400">Para dar acceso a un agente, crea un usuario con rol «Agente de remesas» en Usuarios.</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="btn"
          disabled={pendiente}
          onClick={() =>
            start(async () => {
              const r = await guardarAjustesRemesas(Number(p), a.split(','))
              mostrar(r.ok, r.ok ? (r.mensaje ?? '') : r.error)
              if (r.ok) router.refresh()
            })
          }
        >
          Guardar
        </button>
        {nodo}
      </div>
    </section>
  )
}
