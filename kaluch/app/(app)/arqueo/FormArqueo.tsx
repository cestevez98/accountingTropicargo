'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { accionArqueo, accionTurnoPreparar, type Resultado, type ResultadoTurno } from '../../acciones'
import { BILLETES_CUP, calcularCuadre } from '@/lib/turno'

const f2 = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (v: string | undefined) => Number((v ?? '').replace(/\s/g, '').replace(',', '.')) || 0
const hora = (h: string) => h.replace('T', ' ').slice(0, 16)

export interface CajaForm {
  code: string
  nombre: string
  /** Fin del último cuadre de la caja (el nuevo turno empieza ahí). */
  ultimo?: string
}

/**
 * Cuadre de cambio de turno en dos pasos:
 * 1. Elegir la caja → se traen del TPV las ventas desde el cuadre anterior.
 * 2. Rellenar gastos, salario, transferencias y billetes → esperado, contado y diferencia en vivo.
 */
export function FormArqueo({ tiendas, tienda, cajeros, cuentas, categorias }: { tiendas: { id: string; nombre: string; cajas: CajaForm[] }[]; tienda?: string; cajeros: string[]; cuentas: string[]; categorias: string[] }) {
  const [t, setT] = useState(tienda ?? tiendas[0]?.id ?? '')
  const cajas = tiendas.find((x) => x.id === t)?.cajas ?? []
  const [caja, setCaja] = useState(cajas[0]?.code ?? '')
  const cajaSel = cajas.find((c) => c.code === caja)
  const [prep, preparar, preparando] = useActionState<ResultadoTurno | null, FormData>(accionTurnoPreparar, null)
  const turno = prep?.ok ? prep.turno : undefined
  useEffect(() => setCaja(cajas[0]?.code ?? ''), [t]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!turno || turno.caja !== caja || turno.tienda !== t)
    return (
      <form action={preparar} className="tarjeta mx-auto max-w-3xl p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label>
            <span className="etiqueta">Tienda</span>
            <select name="tienda" value={t} onChange={(e) => setT(e.target.value)} className="input">
              {tiendas.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nombre}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="etiqueta">Caja</span>
            <select name="caja" value={caja} onChange={(e) => setCaja(e.target.value)} className="input">
              {cajas.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
          {cajaSel?.ultimo ? (
            <div className="text-sm">
              <span className="etiqueta">Turno desde</span>
              <div className="py-2">{hora(cajaSel.ultimo)} (cuadre anterior)</div>
            </div>
          ) : (
            <label>
              <span className="etiqueta">Inicio del turno (primer cuadre)</span>
              <input name="desde" type="datetime-local" className="input" required />
            </label>
          )}
        </div>
        <button className="btn btn-primario mt-3" disabled={preparando || !caja}>
          {preparando ? 'Leyendo las ventas del TPV…' : 'Traer las ventas del turno'}
        </button>
        {prep && !prep.ok && (
          <p role="status" className="mt-2 text-sm text-danger">
            {prep.error}
          </p>
        )}
      </form>
    )
  return <PasoCuadre key={`${turno.caja}${turno.hasta}`} turno={turno} cajaNombre={cajaSel?.nombre ?? turno.caja} cajeros={cajeros} cuentas={cuentas} categorias={categorias} />
}

function PasoCuadre({ turno, cajaNombre, cajeros, cuentas, categorias }: { turno: NonNullable<ResultadoTurno['turno']>; cajaNombre: string; cajeros: string[]; cuentas: string[]; categorias: string[] }) {
  const r = turno.resumen
  const noEfectivo = Object.values(r.noEfectivo).reduce((s, v) => s + v, 0)
  const [v, setV] = useState<Record<string, string>>({ salario: String(turno.salario), tasaUSD: String(turno.tasaUSD || ''), tasaEUR: String(turno.tasaEUR || ''), trabajadores: '1' })
  const [gastos, setGastos] = useState([{ concepto: '', importe: '', categoria: 'OTROS GASTOS' }])
  const [transf, setTransf] = useState(cuentas.map((c, i) => ({ cuenta: c, importe: i === 0 && noEfectivo ? String(noEfectivo) : '' })))
  const [estado, enviar, enviando] = useActionState<(Resultado & { id?: string }) | null, FormData>(accionArqueo, null)
  useEffect(() => {
    if (estado?.ok && estado.id) window.location.href = `/imprimir/arqueo?id=${estado.id}`
  }, [estado])
  const campo = (k: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => ({ name: k, value: v[k] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value })), inputMode: 'decimal' as const, className: 'input text-right', ...extra })
  const c = useMemo(
    () =>
      calcularCuadre({
        ventaTienda: r.venta,
        domicilio: num(v.domicilio),
        plataforma: num(v.plataforma),
        gastos: gastos.map((g) => ({ concepto: g.concepto, importe: num(g.importe) })),
        salario: num(v.salario),
        transferencias: transf.map((x) => ({ cuenta: x.cuenta, importe: num(x.importe) })),
        porCobrar: num(v.porCobrar),
        billetes: BILLETES_CUP.map((b) => ({ valor: b, cantidad: num(v[`b_${b}`]) })),
        sueltosCUP: num(v.sueltosCUP),
        usd: num(v.usd),
        tasaUSD: num(v.tasaUSD),
        eur: num(v.eur),
        tasaEUR: num(v.tasaEUR),
        otros: num(v.otros),
      }),
    [r.venta, v, gastos, transf],
  )
  const transfDistinta = Math.abs(c.transferencias - noEfectivo) > 0.5
  return (
    <form
      action={enviar}
      onSubmit={(e) => {
        if (!confirm(`¿Guardar el cuadre? Diferencia: ${f2(c.diferencia)} CUP.`)) e.preventDefault()
      }}
      className="mx-auto max-w-4xl"
    >
      {['tienda', 'caja', 'desde', 'hasta'].map((k) => (
        <input key={k} type="hidden" name={k} value={turno[k as 'tienda']} />
      ))}
      <div className="tarjeta mb-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">
            {cajaNombre} · turno {hora(turno.desde)} → {hora(turno.hasta)}
          </h2>
          <span className="text-xs text-muted-foreground">{r.tickets} tickets en el TPV</span>
        </div>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <label>
            <span className="etiqueta">Cajero(a)</span>
            <input name="cajero" list="cajeros" defaultValue={Object.entries(r.porCajero).sort((a, b) => b[1] - a[1])[0]?.[0]} className="input" required />
            <datalist id="cajeros">
              {cajeros.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </label>
          <label>
            <span className="etiqueta">Cantidad de trabajadores</span>
            <input {...campo('trabajadores', { inputMode: 'numeric' })} />
          </label>
          <div className="text-xs text-muted-foreground">
            Por cajero en el TPV:
            {Object.entries(r.porCajero).map(([k, x]) => (
              <div key={k}>
                {k}: {f2(x)}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="tarjeta p-4">
          <h3 className="mb-2 text-sm font-semibold">Ventas</h3>
          <Fila label="Venta en tienda (TPV)">
            <div className="py-2 text-right font-semibold">{f2(r.venta)}</div>
          </Fila>
          <div className="mb-2 text-right text-xs text-muted-foreground">
            Efectivo {f2(r.efectivo)}
            {Object.entries(r.noEfectivo).map(([k, x]) => ` · ${k} ${f2(x)}`)}
            {Object.entries(r.efectivoPorMoneda)
              .filter(([m]) => m !== 'CUP')
              .map(([m, x]) => ` · cobrado en ${m}: ${f2(x ?? 0)}`)}
          </div>
          <Fila label="Venta a domicilio">
            <input {...campo('domicilio')} />
          </Fila>
          <Fila label="Venta en plataforma">
            <input {...campo('plataforma')} />
          </Fila>
          <Fila label="Subtotal">
            <div className="py-2 text-right font-semibold">{f2(c.subtotal)}</div>
          </Fila>

          <h3 className="mb-2 mt-4 text-sm font-semibold">Otros gastos</h3>
          {gastos.map((g, i) => (
            <div key={i} className="mb-1 grid grid-cols-[1fr_7rem_8rem] gap-1">
              <input name="gasto_concepto" value={g.concepto} onChange={(e) => setGastos((xs) => xs.map((x, k) => (k === i ? { ...x, concepto: e.target.value } : x)))} placeholder="Concepto (p. ej. Seguridad)" className="input" />
              <input name="gasto_importe" value={g.importe} onChange={(e) => setGastos((xs) => xs.map((x, k) => (k === i ? { ...x, importe: e.target.value } : x)))} inputMode="decimal" className="input text-right" />
              <select name="gasto_categoria" value={g.categoria} onChange={(e) => setGastos((xs) => xs.map((x, k) => (k === i ? { ...x, categoria: e.target.value } : x)))} className="input text-xs">
                {categorias.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </div>
          ))}
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setGastos((xs) => [...xs, { concepto: '', importe: '', categoria: 'OTROS GASTOS' }])}>
            + otro gasto
          </button>
          <Fila label={`Salario (sugerido ${f2(turno.salario)})`}>
            <input {...campo('salario')} />
          </Fila>

          <h3 className="mb-2 mt-4 text-sm font-semibold">Transferencias</h3>
          {transf.map((x, i) => (
            <div key={i} className="mb-1 grid grid-cols-[1fr_8rem] gap-1">
              <input name="transf_cuenta" value={x.cuenta} onChange={(e) => setTransf((xs) => xs.map((y, k) => (k === i ? { ...y, cuenta: e.target.value } : y)))} className="input" />
              <input name="transf_importe" value={x.importe} onChange={(e) => setTransf((xs) => xs.map((y, k) => (k === i ? { ...y, importe: e.target.value } : y)))} inputMode="decimal" className="input text-right" />
            </div>
          ))}
          <div className={`text-right text-xs ${transfDistinta ? 'text-danger' : 'text-muted-foreground'}`}>
            Total {f2(c.transferencias)}
            {transfDistinta && ` · el TPV dice ${f2(noEfectivo)} cobrados sin efectivo`}
          </div>
          <Fila label="Ventas por cobrar">
            <input {...campo('porCobrar')} />
          </Fila>
        </div>

        <div className="tarjeta p-4">
          <h3 className="mb-2 text-sm font-semibold">Efectivo</h3>
          {BILLETES_CUP.map((b) => (
            <div key={b} className="mb-1 grid grid-cols-[4rem_6rem_1fr] items-center gap-2 text-sm">
              <span className="text-right">{b} ×</span>
              <input {...campo(`b_${b}`, { inputMode: 'numeric', placeholder: '0', className: 'input text-center' })} />
              <span className="text-right text-xs text-muted-foreground">{num(v[`b_${b}`]) ? f2(num(v[`b_${b}`]) * b) : ''}</span>
            </div>
          ))}
          <Fila label="Sueltos / monedas CUP">
            <input {...campo('sueltosCUP')} />
          </Fila>
          <Fila label="Total efectivo CUP">
            <div className="py-2 text-right font-semibold">{f2(c.totalCUP)}</div>
          </Fila>
          <div className="mb-1 grid grid-cols-[3rem_1fr_1fr_1fr] items-center gap-1 text-sm">
            <span>USD</span>
            <input {...campo('usd', { placeholder: 'cantidad' })} />
            <input {...campo('tasaUSD', { placeholder: 'tasa' })} />
            <span className="text-right">{f2(c.usdCUP)}</span>
          </div>
          <div className="mb-1 grid grid-cols-[3rem_1fr_1fr_1fr] items-center gap-1 text-sm">
            <span>EUR</span>
            <input {...campo('eur', { placeholder: 'cantidad' })} />
            <input {...campo('tasaEUR', { placeholder: 'tasa' })} />
            <span className="text-right">{f2(c.eurCUP)}</span>
          </div>
          <Fila label="Otros (paquetes, vales…)">
            <input {...campo('otros')} />
          </Fila>
          <Fila label="Fondo que queda en caja">
            <input {...campo('fondo')} />
          </Fila>
          <label className="mt-2 block">
            <span className="etiqueta">Observaciones</span>
            <input name="observaciones" className="input" />
          </label>
        </div>
      </div>

      <div className="tarjeta sticky bottom-2 mt-3 grid grid-cols-3 gap-2 p-3 text-center">
        <div>
          <div className="text-xs text-muted-foreground">Efectivo esperado</div>
          <div className="font-semibold">{f2(c.esperado)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Total de efectivo</div>
          <div className="font-semibold">{f2(c.contado)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Diferencia</div>
          <div className={`font-semibold ${c.diferencia < -0.5 ? 'text-danger' : c.diferencia > 0.5 ? 'text-amber-600' : 'text-accent'}`}>{Math.abs(c.diferencia) < 0.5 ? 'Cuadra' : f2(c.diferencia)}</div>
        </div>
        <button className="btn btn-exito col-span-3" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar cuadre y ver comprobante'}
        </button>
        {estado && !estado.ok && <p className="col-span-3 text-sm text-danger">{estado.error}</p>}
      </div>
    </form>
  )
}

function Fila({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-1 grid grid-cols-[1fr_9rem] items-center gap-2 text-sm">
      <span>{label}</span>
      {children}
    </label>
  )
}
