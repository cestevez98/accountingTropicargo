import Link from 'next/link'
import { accionAsiento, accionBorrar, accionCerrarMes, accionDistribucion } from '../../acciones'
import { BotonAccion, FormAccion } from '@/components/FormAccion'
import { Chip, Encabezado, Importe, Paginador, Pestanas, url, Vacio } from '@/components/ui'
import { puedeRegistrar, requerirUsuario } from '@/lib/auth'
import { cargarContabilidad } from '@/lib/data'
import { finDeMes, hoy, mesesEntre, ym } from '@/lib/fecha'
import { aUSD } from '@/lib/fx'
import { CLASE_CUENTA, etiquetaCuenta, nombreMes } from '@/lib/informes'
import { distribucionDelMes, esEfectivo, FUENTE_LABEL, type Linea } from '@/lib/mayor'
import { params, tiendaActiva, type SP } from '@/lib/pagina'

const TABS = [
  { clave: 'nomenclador', label: 'Nomenclador de cuentas' },
  { clave: 'asientos', label: 'Asientos contables' },
  { clave: 'submayor', label: 'Submayores' },
  { clave: 'variacion', label: 'Variación de tasa de cambio' },
  { clave: 'cierre', label: 'Distribución y cierre' },
]

function clase(c: string) {
  if (c.startsWith('caja:') || c.startsWith('banco:')) return 'activo'
  if (c.startsWith('res:ventas') || c.startsWith('res:ingreso')) return 'ingresos'
  if (c.startsWith('res:')) return 'gastos'
  const k = CLASE_CUENTA[c]
  return k === 'mixta' ? 'pasivo' : (k ?? 'activo')
}
const CLASES = [
  ['activo', '1 · Activos'],
  ['pasivo', '2 · Pasivos'],
  ['patrimonio', '3 · Patrimonio'],
  ['ingresos', '4 · Ingresos'],
  ['gastos', '5 · Gastos'],
] as const

export default async function Contabilidad({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('contabilidad')
  const sp = await params(searchParams)
  const tab = TABS.some((t) => t.clave === sp.tab) ? sp.tab! : 'nomenclador'
  const { tienda } = await tiendaActiva(s)
  const { ds, mayor } = await cargarContabilidad()
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))
  const lineas = tienda ? mayor.lineas.filter((l) => l.tienda === tienda) : mayor.lineas
  const registrar = puedeRegistrar(s, 'contabilidad')
  const cuentas = [...new Set(mayor.lineas.map((l) => l.cuenta))].sort()

  let cuerpo: React.ReactNode
  if (tab === 'nomenclador') {
    const saldo = new Map<string, { debe: number; haber: number }>()
    for (const l of lineas) {
      const e = saldo.get(l.cuenta) ?? { debe: 0, haber: 0 }
      if (l.usd > 0) e.debe += l.usd
      else e.haber -= l.usd
      saldo.set(l.cuenta, e)
    }
    cuerpo = (
      <div className="space-y-4">
        {CLASES.map(([k, titulo]) => {
          const cs = cuentas.filter((c) => clase(c) === k)
          if (!cs.length) return null
          return (
            <div key={k} className="tarjeta overflow-x-auto">
              <h2 className="px-4 pt-3 text-sm font-semibold">{titulo}</h2>
              <table className="tabla mt-2">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Cuenta</th>
                    <th className="num">Debe</th>
                    <th className="num">Haber</th>
                    <th className="num">Saldo USD</th>
                  </tr>
                </thead>
                <tbody>
                  {cs.map((c) => {
                    const e = saldo.get(c) ?? { debe: 0, haber: 0 }
                    return (
                      <tr key={c}>
                        <td className="font-mono text-xs text-muted-foreground">{c}</td>
                        <td>
                          <Link className="text-primary hover:underline" href={`/contabilidad?tab=submayor&cuenta=${encodeURIComponent(c)}`}>
                            {etiquetaCuenta(c)}
                          </Link>
                        </td>
                        <td className="num">
                          <Importe v={e.debe} />
                        </td>
                        <td className="num">
                          <Importe v={e.haber} />
                        </td>
                        <td className="num font-semibold">
                          <Importe v={e.debe - e.haber} colorear />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    )
  } else if (tab === 'asientos') {
    // Un asiento = todas las líneas de un mismo documento (ref).
    const porRef = new Map<string, Linea[]>()
    for (const l of lineas) {
      if (sp.desde && l.fecha < sp.desde) continue
      if (sp.hasta && l.fecha > sp.hasta) continue
      if (sp.fuente && l.fuente !== sp.fuente) continue
      const arr = porRef.get(l.ref) ?? []
      arr.push(l)
      porRef.set(l.ref, arr)
    }
    const asientos = [...porRef.entries()].sort((a, b) => b[1][0].fecha.localeCompare(a[1][0].fecha))
    const pagina = Math.max(1, Number(sp.p) || 1)
    const vista = asientos.slice((pagina - 1) * 50, pagina * 50)
    const manuales = new Set(ds.asientos.filter((a) => a.origen === 'manual').map((a) => a.id))
    cuerpo = (
      <>
        <form className="tarjeta mb-4 flex flex-wrap items-end gap-2 p-3" action="/contabilidad">
          <input type="hidden" name="tab" value="asientos" />
          <label className="w-40">
            <span className="etiqueta">Desde</span>
            <input type="date" name="desde" defaultValue={sp.desde} className="input" />
          </label>
          <label className="w-40">
            <span className="etiqueta">Hasta</span>
            <input type="date" name="hasta" defaultValue={sp.hasta} className="input" />
          </label>
          <label className="w-48">
            <span className="etiqueta">Origen</span>
            <select name="fuente" defaultValue={sp.fuente ?? ''} className="input">
              <option value="">Todos</option>
              {Object.entries(FUENTE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primario">Filtrar</button>
        </form>
        <div className="space-y-2">
          {vista.map(([ref, ls], n) => {
            const debe = ls.filter((l) => l.usd > 0)
            const haber = ls.filter((l) => l.usd < 0)
            const total = debe.reduce((a, l) => a + l.usd, 0)
            return (
              <details key={ref} className="tarjeta">
                <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-2 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">#{(pagina - 1) * 50 + n + 1}</span>
                  <span className="whitespace-nowrap">{ls[0].fecha}</span>
                  <span className="text-muted-foreground">{nombreT.get(ls[0].tienda) ?? ls[0].tienda}</span>
                  <span className="min-w-0 flex-1 truncate">{ls[0].concepto}</span>
                  <Chip tono={ls[0].fuente === 'asi' ? 'ambar' : 'azul'}>{ls[0].fuente === 'asi' ? 'Manual' : `Automático · ${FUENTE_LABEL[ls[0].fuente]}`}</Chip>
                  <span className="tabular-nums font-semibold">
                    <Importe v={total} />
                  </span>
                </summary>
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Cuenta</th>
                      <th className="num">Debe</th>
                      <th className="num">Haber</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...debe, ...haber].map((l, k) => (
                      <tr key={k}>
                        <td style={{ paddingLeft: l.usd < 0 ? 36 : undefined }}>{etiquetaCuenta(l.cuenta)}</td>
                        <td className="num">{l.usd > 0 ? <Importe v={l.usd} /> : ''}</td>
                        <td className="num">{l.usd < 0 ? <Importe v={-l.usd} /> : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {registrar && manuales.has(ref) && (
                  <div className="px-4 py-2">
                    <BotonAccion accion={accionBorrar} campos={{ col: 'asientos', id: ref }} confirmar="¿Borrar este asiento manual?" className="btn btn-peligro text-xs">
                      Borrar asiento
                    </BotonAccion>
                  </div>
                )}
              </details>
            )
          })}
        </div>
        <Paginador pagina={pagina} total={asientos.length} porPagina={50} base={(p) => url('/contabilidad', sp, { p })} />
        {registrar && (
          <details className="tarjeta mt-4 p-4">
            <summary className="cursor-pointer text-sm font-semibold">+ Nuevo asiento manual</summary>
            <FormAccion accion={accionAsiento} className="mt-3">
              <div className="grid gap-3 sm:grid-cols-4">
                <label>
                  <span className="etiqueta">Fecha</span>
                  <input type="date" name="fecha" defaultValue={hoy()} className="input" />
                </label>
                <label>
                  <span className="etiqueta">Entidad</span>
                  <select name="tienda" defaultValue={tienda ?? 'matriz'} className="input">
                    {ds.tiendas.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="sm:col-span-2">
                  <span className="etiqueta">Descripción</span>
                  <input name="concepto" className="input" required />
                </label>
              </div>
              <div className="mt-3 space-y-2">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="grid grid-cols-[1fr_120px_120px] gap-2">
                    <input name={`cuenta_${i}`} list="cuentas-mayor" placeholder={i < 2 ? 'Cuenta (p. ej. res:gasto_admin:Otros gastos)' : ''} className="input" />
                    <input name={`debe_${i}`} inputMode="decimal" placeholder="Debe" className="input text-right" />
                    <input name={`haber_${i}`} inputMode="decimal" placeholder="Haber" className="input text-right" />
                  </div>
                ))}
              </div>
              <datalist id="cuentas-mayor">
                {cuentas.map((c) => (
                  <option key={c} value={c}>
                    {etiquetaCuenta(c)}
                  </option>
                ))}
              </datalist>
              <p className="mt-2 text-xs text-muted-foreground">Importes en USD. Debe = Haber. Las cuentas de resultado empiezan por «res:» (línea del ER : renglón).</p>
            </FormAccion>
          </details>
        )}
      </>
    )
  } else if (tab === 'submayor') {
    const sel = (sp.cuenta ?? '').split(',').filter(Boolean)
    const filtradas = lineas.filter((l) => sel.some((c) => l.cuenta === c || (c.endsWith(':') && l.cuenta.startsWith(c)))).sort((a, b) => a.fecha.localeCompare(b.fecha))
    const conSaldo: (Linea & { saldo: number })[] = []
    let inicial = 0
    for (const l of filtradas) if (sp.desde && l.fecha < sp.desde) inicial += l.usd
    let saldo = inicial
    for (const l of filtradas) {
      if ((sp.desde && l.fecha < sp.desde) || (sp.hasta && l.fecha > sp.hasta)) continue
      saldo += l.usd
      conSaldo.push({ ...l, saldo })
    }
    conSaldo.reverse()
    const pagina = Math.max(1, Number(sp.p) || 1)
    const vista = conSaldo.slice((pagina - 1) * 150, pagina * 150)
    cuerpo = (
      <>
        <form className="tarjeta mb-4 flex flex-wrap items-end gap-2 p-3" action="/contabilidad">
          <input type="hidden" name="tab" value="submayor" />
          <label className="w-80">
            <span className="etiqueta">Cuenta</span>
            <select name="cuenta" defaultValue={sel.length === 1 ? sel[0] : ''} className="input">
              {sel.length > 1 && <option value={sel.join(',')}>{sel.length} cuentas seleccionadas</option>}
              <option value="">Elige una cuenta…</option>
              {cuentas.map((c) => (
                <option key={c} value={c}>
                  {etiquetaCuenta(c)} ({c})
                </option>
              ))}
            </select>
          </label>
          <label className="w-40">
            <span className="etiqueta">Desde</span>
            <input type="date" name="desde" defaultValue={sp.desde} className="input" />
          </label>
          <label className="w-40">
            <span className="etiqueta">Hasta</span>
            <input type="date" name="hasta" defaultValue={sp.hasta} className="input" />
          </label>
          <button className="btn btn-primario">Ver</button>
          {sel.length > 0 && (
            <a className="btn" href={`/api/exportar?tabla=submayor&${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])}`}>
              Exportar
            </a>
          )}
        </form>
        {!sel.length ? (
          <Vacio>Elige una cuenta del nomenclador para ver todos sus movimientos.</Vacio>
        ) : (
          <>
            <p className="mb-2 text-sm text-muted-foreground">
              {sel.map(etiquetaCuenta).join(' + ')} · {conSaldo.length} líneas{sp.desde ? ` · saldo anterior ${inicial.toFixed(2)}` : ''}
            </p>
            <div className="tarjeta overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Entidad</th>
                    <th>Comprobante</th>
                    <th>Descripción</th>
                    <th>Contrapartida</th>
                    <th className="num">Debe</th>
                    <th className="num">Haber</th>
                    <th className="num">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {vista.map((l, k) => (
                    <tr key={k}>
                      <td className="whitespace-nowrap">{l.fecha}</td>
                      <td>{nombreT.get(l.tienda) ?? l.tienda}</td>
                      <td className="text-xs text-muted-foreground">{FUENTE_LABEL[l.fuente]}</td>
                      <td className="max-w-96">{l.concepto}</td>
                      <td className="text-xs">{etiquetaCuenta(l.contra)}</td>
                      <td className="num">{l.usd > 0 ? <Importe v={l.usd} /> : ''}</td>
                      <td className="num">{l.usd < 0 ? <Importe v={-l.usd} /> : ''}</td>
                      <td className="num font-medium">
                        <Importe v={l.saldo} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginador pagina={pagina} total={conSaldo.length} porPagina={150} base={(p) => url('/contabilidad', sp, { p })} />
          </>
        )}
      </>
    )
  } else if (tab === 'variacion') {
    const fin = sp.hasta ?? hoy()
    const saldos = new Map<string, { orig: number; usd: number; moneda: string; tienda: string }>()
    for (const l of lineas) {
      if (!esEfectivo(l.cuenta) || !l.moneda || l.moneda === 'USD' || l.fecha > fin) continue
      const e = saldos.get(l.cuenta) ?? { orig: 0, usd: 0, moneda: l.moneda, tienda: l.tienda }
      e.orig += l.orig ?? 0
      e.usd += l.fuente === 'rev' ? 0 : l.usd
      saldos.set(l.cuenta, e)
    }
    const rev = lineas.filter((l) => l.fuente === 'rev' && l.cuenta.startsWith('res:') && ym(l.fecha) === ym(fin))
    const mesRes = -rev.reduce((a, l) => a + l.usd, 0)
    const filas = [...saldos.entries()].map(([c, e]) => {
      const actual = aUSD(mayor.tasas, e.orig, e.moneda as 'CUP', fin)
      return { c, ...e, actual, tasaReg: e.usd ? e.orig / e.usd : 0, tasaAct: actual ? e.orig / actual : 0 }
    })
    cuerpo = (
      <>
        <div className={`tarjeta mb-4 p-4 ${mesRes >= 0 ? 'text-accent' : 'text-danger'}`}>
          <div className="text-xs text-muted-foreground">Resultado por tenencia de moneda en {nombreMes(ym(fin))}</div>
          <div className="text-2xl font-bold tabular-nums">
            {mesRes >= 0 ? '+' : ''}
            {mesRes.toLocaleString('es-ES', { maximumFractionDigits: 2 })} USD
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {ds.settings.revaluar ? 'El asiento de variación se genera solo al cierre de cada mes (Revaluación de moneda).' : 'La revaluación automática está desactivada en Catálogos → Configuración.'}
          </p>
        </div>
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Moneda</th>
                <th className="num">Saldo en moneda original</th>
                <th className="num">Tasa media al registro</th>
                <th className="num">Tasa al {fin}</th>
                <th className="num">Valor al registro (USD)</th>
                <th className="num">Valor actual (USD)</th>
                <th className="num">Variación</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.c}>
                  <td>{etiquetaCuenta(f.c)}</td>
                  <td>{f.moneda}</td>
                  <td className="num">
                    <Importe v={f.orig} />
                  </td>
                  <td className="num">
                    <Importe v={f.tasaReg} />
                  </td>
                  <td className="num">
                    <Importe v={f.tasaAct} />
                  </td>
                  <td className="num">
                    <Importe v={f.usd} />
                  </td>
                  <td className="num">
                    <Importe v={f.actual} />
                  </td>
                  <td className="num font-semibold">
                    <Importe v={f.actual - f.usd} colorear />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  } else {
    const meses = mesesEntre(ds.settings.fechaInicio.slice(0, 7), mayor.ultimoMes)
    const admin = s.rol === 'propietario' || s.rol === 'admin'
    cuerpo = (
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Mes</th>
              <th>Distribución del beneficio</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {meses.map((m) => {
              const d = distribucionDelMes(ds, m)
              const cerrado = ds.settings.mesesCerrados.includes(m)
              return (
                <tr key={m}>
                  <td className="font-medium whitespace-nowrap">{nombreMes(m)}</td>
                  <td>
                    {registrar ? (
                      <FormAccion accion={accionDistribucion} boton="Guardar" claseBoton="btn text-xs" limpiar={false} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="mes" value={m} />
                        <label className="w-28">
                          <span className="etiqueta">% reinversión</span>
                          <input name="pctReinversion" defaultValue={(d.pctReinversion * 100).toFixed(2)} className="input text-right" />
                        </label>
                        <label className="w-28">
                          <span className="etiqueta">% inversionista</span>
                          <input name="pctInversionista" defaultValue={(d.pctInversionista * 100).toFixed(2)} className="input text-right" />
                        </label>
                        <label className="w-32">
                          <span className="etiqueta">Ajuste inversionista</span>
                          <input name="ajusteInversionista" defaultValue={d.ajusteInversionista || ''} className="input text-right" />
                        </label>
                      </FormAccion>
                    ) : (
                      `${(d.pctReinversion * 100).toFixed(1)} % reinversión · ${(d.pctInversionista * 100).toFixed(1)} % inversionista`
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      {cerrado ? <Chip tono="verde">Cerrado</Chip> : finDeMes(m) < hoy() ? <Chip tono="ambar">Abierto</Chip> : <Chip>En curso</Chip>}
                      {admin && (
                        <BotonAccion accion={accionCerrarMes} campos={{ mes: m, abrir: cerrado ? '1' : '0' }} confirmar={cerrado ? `¿Reabrir ${m}?` : `¿Cerrar ${m}? Solo el propietario podrá modificarlo.`} className="btn text-xs">
                          {cerrado ? 'Reabrir' : 'Cerrar mes'}
                        </BotonAccion>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="px-4 py-2 text-xs text-muted-foreground">Al cerrar un mes se declara como dividendo la parte del beneficio que no se reinvierte (cuenta «Dividendos por pagar»). Los meses cerrados solo los modifica el propietario.</p>
      </div>
    )
  }
  return (
    <>
      <Encabezado titulo="Contabilidad" descripcion="Libro mayor de partida doble: cada venta, compra y movimiento de caja genera su asiento automático." />
      <Pestanas activa={tab} items={TABS.map((t) => ({ ...t, href: `/contabilidad?tab=${t.clave}` }))} />
      {cuerpo}
    </>
  )
}
