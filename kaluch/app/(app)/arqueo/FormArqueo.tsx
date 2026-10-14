'use client'

import { upload } from '@vercel/blob/client'
import { useActionState, useEffect, useMemo, useState } from 'react'
import { accionArqueo, accionTurnoPreparar, type Resultado, type ResultadoTurno } from '../../acciones'
import { BILLETES_CUP, calcularCuadre, CHECKLIST, pagadoEnTurno, personalPorDefecto, porCuenta, reporteWhatsApp, ROL_TURNO_LABEL, totalPax, totalSalarios, turnoDeHora, TURNO_LABEL, type PersonaTurno, type ResumenTurno } from '@/lib/turno'
import type { Arqueo } from '@/lib/types'

const f2 = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (v: string | undefined) => Number((v ?? '').replace(/\s/g, '').replace(',', '.')) || 0
const hora = (h: string) => h.replace('T', ' ').slice(0, 16)

export interface CajaForm {
  code: string
  nombre: string
  /** Fin del último cierre de la caja (el nuevo turno empieza ahí). */
  ultimo?: string
}

type Turno = NonNullable<ResultadoTurno['turno']>

interface Comunes {
  cajeros: string[]
  cuentas: string[]
  categorias: string[]
  nombreTienda: Record<string, string>
}

/**
 * Cierre de cambio de turno en dos pasos:
 * 1. Elegir la caja → se traen del TPV las ventas (y los Pax) desde el cierre anterior.
 * 2. Rellenar la hoja: cuadre, ventas por tarjeta, check list, energía, firmas y fotos.
 */
export function FormArqueo({ tiendas, tienda, ...comunes }: { tiendas: { id: string; nombre: string; cajas: CajaForm[] }[]; tienda?: string } & Comunes) {
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
              <div className="py-2">{hora(cajaSel.ultimo)} (cierre anterior)</div>
            </div>
          ) : (
            <label>
              <span className="etiqueta">Inicio del turno (primer cierre)</span>
              <input name="desde" type="datetime-local" className="input" required />
            </label>
          )}
        </div>
        <button className="btn btn-primario mt-3" disabled={preparando || !caja}>
          {preparando ? 'Leyendo las ventas del TPV…' : 'Cerrar el turno: traer las ventas'}
        </button>
        {prep && !prep.ok && (
          <p role="status" className="mt-2 text-sm text-danger">
            {prep.error}
          </p>
        )}
      </form>
    )
  return <HojaCierre key={`${turno.caja}${turno.hasta}`} turno={turno} cajaNombre={cajaSel?.nombre ?? turno.caja} {...comunes} />
}

/** Turno de un cierre ya guardado (para que el contador lo corrija). */
export function turnoDeCierre(a: Arqueo): Turno {
  const resumen: ResumenTurno = { tickets: a.tpv.tickets, venta: a.tpv.venta, efectivo: a.tpv.efectivo, noEfectivo: a.tpv.noEfectivo, efectivoPorMoneda: a.tpv.efectivoPorMoneda, tasas: {}, porCajero: a.tpv.porCajero, pax: a.tpv.pax ?? {}, tramos: a.tpv.tramos ?? [] }
  return { tienda: a.tienda, caja: a.caja, desde: a.desde, hasta: a.hasta, resumen, salario: a.salario, tasaUSD: a.tasaUSD, tasaEUR: a.tasaEUR }
}

const PESTANAS = [
  ['cuadre', 'Cuadre'],
  ['tarjetas', 'Venta por tarjeta'],
  ['checklist', 'Check list'],
  ['entrega', 'Energía, firmas y fotos'],
] as const

export function HojaCierre({ turno, cajaNombre, inicial, cajeros, cuentas, categorias, nombreTienda }: { turno: Turno; cajaNombre: string; inicial?: Arqueo } & Comunes) {
  const r = turno.resumen
  const noEfectivo = Object.values(r.noEfectivo).reduce((s, v) => s + v, 0)
  const ini = inicial
  const [pest, setPest] = useState<(typeof PESTANAS)[number][0]>('cuadre')
  const [v, setV] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = { salario: String(turno.salario), tasaUSD: String(turno.tasaUSD || ''), tasaEUR: String(turno.tasaEUR || ''), trabajadores: '1' }
    if (ini) {
      for (const k of ['domicilio', 'plataforma', 'porCobrar', 'sueltosCUP', 'usd', 'eur', 'otros', 'fondo', 'salario', 'tasaUSD', 'tasaEUR', 'trabajadores', 'paxCompra', 'paxMuseo'] as const) {
        const x = (ini as unknown as Record<string, number | undefined>)[k]
        if (x != null && x !== 0) o[k] = String(x)
      }
      for (const b of ini.billetes) o[`b_${b.valor}`] = String(b.cantidad)
      if (ini.energia?.inversor != null) o.inversor = String(ini.energia.inversor)
      if (ini.energia?.ecoflow != null) o.ecoflow = String(ini.energia.ecoflow)
    }
    return o
  })
  const [turnoSel, setTurnoSel] = useState<'dia' | 'noche'>(ini?.turno ?? turnoDeHora(turno.hasta))
  const cajeroTPV = Object.entries(r.porCajero).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  const [personal, setPersonal] = useState<PersonaTurno[]>(() => ini?.personal ?? personalPorDefecto(turnoSel, r.venta, ini?.cajero ?? cajeroTPV))
  // Al cambiar de turno se proponen los salarios de ese turno; se conservan los nombres ya escritos.
  const cambiarTurno = (t: 'dia' | 'noche') => {
    setTurnoSel(t)
    setPersonal((ps) => personalPorDefecto(t, r.venta, '').map((p) => ({ ...p, nombre: ps.find((x) => x.rol === p.rol)?.nombre ?? p.nombre })))
  }
  const setPersona = (i: number, cambio: Partial<PersonaTurno>) => setPersonal((ps) => ps.map((p, j) => (j === i ? { ...p, ...cambio } : p)))
  const [gastos, setGastos] = useState(ini?.gastos.length ? ini.gastos.map((g) => ({ concepto: g.concepto, importe: String(g.importe), categoria: g.categoria ?? 'OTROS GASTOS' })) : [{ concepto: '', importe: '', categoria: 'OTROS GASTOS' }])
  const [tarjetas, setTarjetas] = useState(
    ini?.tarjetas?.length
      ? ini.tarjetas.map((t) => ({ cuenta: t.cuenta, numero: t.numero, importe: String(t.importe), ci: t.ci ?? '', titular: t.titular ?? '' }))
      : ini?.transferencias.length
        ? ini.transferencias.map((t) => ({ cuenta: t.cuenta, numero: '', importe: String(t.importe), ci: '', titular: '' }))
        : [{ cuenta: cuentas[0] ?? 'FISCAL', numero: '', importe: '', ci: '', titular: '' }],
  )
  const [ck, setCk] = useState<Record<string, { ok: boolean; obs: string }>>(() => Object.fromEntries(Object.entries(ini?.checklist ?? {}).map(([k, x]) => [k, { ok: x.ok, obs: x.obs ?? '' }])))
  const [fotos, setFotos] = useState<string[]>(ini?.fotos ?? [])
  const [subiendo, setSubiendo] = useState('')
  const [estado, enviar, enviando] = useActionState<(Resultado & { id?: string }) | null, FormData>(accionArqueo, null)
  useEffect(() => {
    if (estado?.ok && estado.id) window.location.href = `/arqueo?id=${estado.id}`
  }, [estado])

  const campo = (k: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => ({ name: k, value: v[k] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value })), inputMode: 'decimal' as const, className: 'input text-right', ...extra })
  const transferencias = porCuenta(tarjetas.map((t) => ({ cuenta: t.cuenta.toUpperCase(), importe: num(t.importe) })))
  const c = useMemo(
    () =>
      calcularCuadre({
        ventaTienda: r.venta,
        domicilio: num(v.domicilio),
        plataforma: num(v.plataforma),
        gastos: gastos.map((g) => ({ concepto: g.concepto, importe: num(g.importe) })),
        salario: totalSalarios(personal),
        pagadoTurno: pagadoEnTurno(personal),
        transferencias,
        porCobrar: num(v.porCobrar),
        billetes: BILLETES_CUP.map((b) => ({ valor: b, cantidad: num(v[`b_${b}`]) })),
        sueltosCUP: num(v.sueltosCUP),
        usd: num(v.usd),
        tasaUSD: num(v.tasaUSD),
        eur: num(v.eur),
        tasaEUR: num(v.tasaEUR),
        otros: num(v.otros),
        fondo: num(v.fondo),
      }),
    [r.venta, v, gastos, transferencias, personal],
  )
  const transfDistinta = Math.abs(c.transferencias - noEfectivo) > 0.5
  const pendientesCk = CHECKLIST.flatMap((s) => s.grupos.flatMap((g) => g.items)).filter((i) => !ck[i.id]?.ok).length

  async function subirFotos(files: FileList | null) {
    if (!files?.length) return
    try {
      for (const f of Array.from(files).slice(0, 12 - fotos.length)) {
        setSubiendo(`Subiendo ${f.name}…`)
        const b = await upload(`fotos/${turno.caja}-${turno.hasta.slice(0, 10)}-${f.name.replace(/[^\w.-]+/g, '_')}`, f, { access: 'private', handleUploadUrl: '/api/subir' })
        setFotos((x) => [...x, b.pathname])
      }
      setSubiendo('')
    } catch (e) {
      setSubiendo(`No se pudo subir: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <form
      action={enviar}
      onSubmit={(e) => {
        if (!confirm(`¿Guardar el cierre? Diferencia: ${f2(c.diferencia)} CUP.${pendientesCk ? ` Quedan ${pendientesCk} tareas del check list sin marcar.` : ''}`)) e.preventDefault()
      }}
      className="mx-auto max-w-4xl"
    >
      {ini ? <input type="hidden" name="id" value={ini.id} /> : ['tienda', 'caja', 'desde', 'hasta'].map((k) => <input key={k} type="hidden" name={k} value={turno[k as 'tienda']} />)}
      {fotos.map((f) => (
        <input key={f} type="hidden" name="fotos" value={f} />
      ))}
      <div className="tarjeta mb-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">
            {nombreTienda[turno.tienda]} · {cajaNombre} · {hora(turno.desde)} → {hora(turno.hasta)}
          </h2>
          <span className="text-xs text-muted-foreground">{r.tickets} tickets en el TPV</span>
        </div>
        <div className="mt-2 grid gap-3 sm:grid-cols-4">
          <label>
            <span className="etiqueta">Turno</span>
            <select name="turno" value={turnoSel} onChange={(e) => cambiarTurno(e.target.value as 'dia' | 'noche')} className="input">
              <option value="dia">{TURNO_LABEL.dia}</option>
              <option value="noche">{TURNO_LABEL.noche}</option>
            </select>
          </label>
          <input type="hidden" name="cajero" value={personal.find((p) => p.rol === 'cajero')?.nombre ?? ''} />
          <input type="hidden" name="trabajadores" value={personal.filter((p) => p.nombre).length || 1} />
          <datalist id="cajeros">
            {cajeros.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          <div className="text-xs text-muted-foreground sm:col-span-3">
            Venta por usuario del TPV:
            {Object.entries(r.porCajero).map(([k, x]) => (
              <div key={k}>
                {k}: {f2(x)}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1 border-b border-border">
        {PESTANAS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setPest(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${pest === k ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground'}`}>
            {l}
            {k === 'checklist' && pendientesCk > 0 && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-900">{pendientesCk}</span>}
          </button>
        ))}
      </div>

      {/* Todas las pestañas se quedan montadas (ocultas) para que sus campos se envíen. */}
      <div className={pest === 'cuadre' ? 'grid gap-3 md:grid-cols-2' : 'hidden'}>
        <div className="tarjeta p-4">
          <h3 className="mb-2 text-sm font-semibold">Ventas</h3>
          <Fila label="Venta en tienda (TPV)">
            <div className="py-2 text-right font-semibold">{f2(r.venta)}</div>
          </Fila>
          <div className="mb-2 text-right text-xs text-muted-foreground">
            Efectivo {f2(r.efectivo)}
            {Object.entries(r.noEfectivo).map(([k, x]) => ` · ${k} ${f2(x)}`)}
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

          <h3 className="mb-1 mt-4 text-sm font-semibold">Personal del turno</h3>
          <p className="mb-1 text-xs text-muted-foreground">{turnoSel === 'dia' ? 'Día: cajero y dependiente 1,5 % de la venta cada uno.' : 'Noche: el cajero 3 % de la venta.'} Seguridad fija. «Pagado» = se cobró de la caja en el turno (se resta del esperado).</p>
          {personal.map((p, i) => (
            <div key={p.rol + i} className="mb-1 grid grid-cols-[5.5rem_1fr_6rem_3.5rem] items-center gap-1 text-sm">
              <input type="hidden" name="p_rol" value={p.rol} />
              <input type="hidden" name="p_pagado" value={p.pagadoEnTurno ? '1' : '0'} />
              <span>{ROL_TURNO_LABEL[p.rol]}</span>
              <input name="p_nombre" value={p.nombre} onChange={(e) => setPersona(i, { nombre: e.target.value })} list="cajeros" placeholder="Nombre" className="input" required={p.rol === 'cajero'} />
              <input name="p_salario" value={p.salario || ''} onChange={(e) => setPersona(i, { salario: num(e.target.value) })} list={p.rol === 'seguridad' ? 'fijos-seguridad' : undefined} inputMode="decimal" className="input text-right" />
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={p.pagadoEnTurno} onChange={(e) => setPersona(i, { pagadoEnTurno: e.target.checked })} />
                Pagado
              </label>
            </div>
          ))}
          <datalist id="fijos-seguridad">
            <option value="2500" />
            <option value="3500" />
          </datalist>
          <div className="text-right text-xs text-muted-foreground">
            Salarios {f2(totalSalarios(personal))} · pagados en el turno {f2(pagadoEnTurno(personal))}
          </div>

          <h3 className="mb-1 mt-4 text-sm font-semibold">Total transferencias {f2(c.transferencias)}</h3>
          {transferencias.map((t) => (
            <div key={t.cuenta} className="flex justify-between text-sm">
              <span>{t.cuenta}</span>
              <span>{f2(t.importe)}</span>
            </div>
          ))}
          <div className={`text-xs ${transfDistinta ? 'text-danger' : 'text-muted-foreground'}`}>
            Se rellenan en «Venta por tarjeta».{transfDistinta && ` El TPV dice ${f2(noEfectivo)} cobrados sin efectivo.`}
          </div>
          <Fila label="Ventas por cobrar">
            <input {...campo('porCobrar')} />
          </Fila>
        </div>

        <div className="tarjeta p-4">
          <h3 className="mb-2 text-sm font-semibold">Total de efectivo</h3>
          {BILLETES_CUP.filter((b) => b >= 5).map((b) => (
            <div key={b} className="mb-1 grid grid-cols-[4.5rem_6rem_1fr] items-center gap-2 text-sm">
              <span className="text-right">{b} ×</span>
              <input {...campo(`b_${b}`, { inputMode: 'numeric', placeholder: '0', className: 'input text-center' })} />
              <span className="text-right text-xs text-muted-foreground">{num(v[`b_${b}`]) ? f2(num(v[`b_${b}`]) * b) : ''}</span>
            </div>
          ))}
          <Fila label="Monedas y sueltos CUP">
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
          <p className="mb-2 text-xs text-muted-foreground">Divisas a la tasa de la tienda (con la que vende el TPV); la diferencia con el Toque la registra la contabilidad.</p>
          <Fila label="Otros (vales…)">
            <input {...campo('otros')} />
          </Fila>
          <Fila label="Fondo que queda en caja">
            <input {...campo('fondo')} />
          </Fila>
          <label className="mt-2 block">
            <span className="etiqueta">Observaciones</span>
            <input name="observaciones" defaultValue={ini?.observaciones} className="input" />
          </label>
        </div>
      </div>

      <div className={pest === 'tarjetas' ? 'tarjeta overflow-x-auto p-4' : 'hidden'}>
        <h3 className="mb-2 text-sm font-semibold">Venta por tarjeta / transferencia</h3>
        <div className="mb-1 grid min-w-[40rem] grid-cols-[7rem_1fr_7rem_9rem_1fr_2rem] gap-1 text-xs text-muted-foreground">
          <span>Cuenta</span>
          <span>Número de transferencia</span>
          <span className="text-right">Importe</span>
          <span>Carnet de identidad</span>
          <span>Titular de la tarjeta</span>
          <span />
        </div>
        {tarjetas.map((t, i) => {
          const set = (k: keyof typeof t) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setTarjetas((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))
          return (
            <div key={i} className="mb-1 grid min-w-[40rem] grid-cols-[7rem_1fr_7rem_9rem_1fr_2rem] gap-1">
              <select name="tj_cuenta" value={t.cuenta} onChange={set('cuenta')} className="input text-xs">
                {[...new Set([...cuentas, t.cuenta])].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
              <input name="tj_numero" value={t.numero} onChange={set('numero')} className="input font-mono text-xs" autoCapitalize="characters" />
              <input name="tj_importe" value={t.importe} onChange={set('importe')} inputMode="decimal" className="input text-right" />
              <input name="tj_ci" value={t.ci} onChange={set('ci')} inputMode="numeric" className="input text-xs" />
              <input name="tj_titular" value={t.titular} onChange={set('titular')} className="input text-xs" />
              <button type="button" className="text-danger" aria-label="Quitar" onClick={() => setTarjetas((xs) => xs.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          )
        })}
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setTarjetas((xs) => [...xs, { cuenta: xs.at(-1)?.cuenta ?? cuentas[0] ?? 'FISCAL', numero: '', importe: '', ci: '', titular: '' }])}>
          + otra transferencia
        </button>
        <p className={`mt-2 text-sm ${transfDistinta ? 'text-danger' : ''}`}>
          Total {f2(c.transferencias)} · el TPV registró {f2(noEfectivo)} sin efectivo.
        </p>
      </div>

      <div className={pest === 'checklist' ? 'tarjeta p-4' : 'hidden'}>
        <p className="mb-2 text-xs text-muted-foreground">Marca lo que quedó bien; escribe observación solo si hay problema.</p>
        {CHECKLIST.map((sec) => (
          <div key={sec.rol} className="mb-4">
            <h3 className="text-sm font-semibold">{sec.titulo}</h3>
            {sec.grupos.map((g) => (
              <div key={g.titulo} className="mt-1">
                <div className="text-xs font-semibold uppercase text-muted-foreground">{g.titulo}</div>
                {g.items.map((it) => (
                  <div key={it.id} className="grid grid-cols-[1.5rem_1fr_14rem] items-center gap-2 border-b border-border py-1 text-sm">
                    <input type="checkbox" name={`ck_${it.id}`} checked={ck[it.id]?.ok ?? false} onChange={(e) => setCk((x) => ({ ...x, [it.id]: { ok: e.target.checked, obs: x[it.id]?.obs ?? '' } }))} />
                    <span>{it.texto}</span>
                    <input name={`obs_${it.id}`} value={ck[it.id]?.obs ?? ''} onChange={(e) => setCk((x) => ({ ...x, [it.id]: { ok: x[it.id]?.ok ?? false, obs: e.target.value } }))} placeholder="Observación" className="input py-1 text-xs" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className={pest === 'entrega' ? 'grid gap-3 md:grid-cols-2' : 'hidden'}>
        <div className="tarjeta p-4">
          <h3 className="mb-2 text-sm font-semibold">Energía</h3>
          <Fila label="Carga del inversor (%)">
            <input {...campo('inversor', { inputMode: 'numeric' })} />
          </Fila>
          <Fila label="Carga del EcoFlow (%)">
            <input {...campo('ecoflow', { inputMode: 'numeric' })} />
          </Fila>
          <h3 className="mb-2 mt-4 text-sm font-semibold">Clientes que no salen en el TPV</h3>
          <Fila label="Pax Compra">
            <input {...campo('paxCompra', { inputMode: 'numeric' })} />
          </Fila>
          <Fila label="Pax Museo">
            <input {...campo('paxMuseo', { inputMode: 'numeric' })} />
          </Fila>
          <h3 className="mb-2 mt-4 text-sm font-semibold">Fotos (inversor, tickets del TPV, hoja firmada)</h3>
          <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => void subirFotos(e.target.files)} className="text-sm" />
          {subiendo && <p className="text-xs text-muted-foreground">{subiendo}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {fotos.map((f) => (
              <div key={f} className="relative">
                <img src={`/api/foto?p=${encodeURIComponent(f)}`} alt="" className="h-20 w-20 rounded border border-border object-cover" />
                <button type="button" className="absolute right-0 top-0 rounded bg-white px-1 text-xs text-danger" onClick={() => setFotos((x) => x.filter((y) => y !== f))}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="tarjeta p-4">
          <h3 className="mb-2 text-sm font-semibold">Firmas del cambio de turno</h3>
          <div className="mb-1 grid grid-cols-[6rem_1fr_1fr] gap-1 text-xs text-muted-foreground">
            <span>Responsable</span>
            <span>Entrega</span>
            <span>Recibe</span>
          </div>
          {(['cajero', 'dependiente', 'seguridad'] as const).map((rol) => (
            <div key={rol} className="mb-1 grid grid-cols-[6rem_1fr_1fr] items-center gap-1">
              <span className="text-sm capitalize">{rol}</span>
              <input name={`f_${rol}_entrega`} defaultValue={ini?.firmas?.[rol]?.entrega} className="input" placeholder="Nombre" />
              <input name={`f_${rol}_recibe`} defaultValue={ini?.firmas?.[rol]?.recibe} className="input" placeholder="Nombre" />
            </div>
          ))}
        </div>
      </div>

      <div className="tarjeta sticky bottom-2 mt-3 grid grid-cols-4 gap-2 p-3 text-center">
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
        <div>
          <div className="text-xs text-muted-foreground">A entregar (− fondo)</div>
          <div className="font-semibold">{f2(c.aEntregar)}</div>
        </div>
        <button className="btn btn-exito col-span-4" disabled={enviando}>
          {enviando ? 'Guardando…' : ini ? 'Guardar corrección' : 'Guardar cierre'}
        </button>
        {estado && !estado.ok && <p className="col-span-4 text-sm text-danger">{estado.error}</p>}
      </div>
    </form>
  )
}

/** Botones para mandar el cierre al grupo de WhatsApp (abre WhatsApp con el texto; se elige el grupo). */
export function CompartirWhatsApp({ datos }: { datos: Parameters<typeof reporteWhatsApp>[0] }) {
  const texto = reporteWhatsApp(datos)
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="tarjeta p-4">
      <h3 className="mb-2 text-sm font-semibold">Reporte para el grupo de WhatsApp</h3>
      <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-sm">{texto}</pre>
      <p className="mt-1 text-xs text-muted-foreground">Clientes en total: {totalPax(datos.pax, { compra: datos.paxCompra, museo: datos.paxMuseo })}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <a className="btn btn-exito" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer">
          Enviar por WhatsApp
        </a>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void navigator.clipboard?.writeText(texto).then(() => setCopiado(true))
          }}
        >
          {copiado ? 'Copiado' : 'Copiar texto'}
        </button>
      </div>
    </div>
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
