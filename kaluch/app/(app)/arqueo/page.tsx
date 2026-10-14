import { accionArqueoAprobar, accionArqueoBorrar } from '../../acciones'
import { BotonAccion, FormAccion } from '@/components/FormAccion'
import { Chip, Encabezado, Vacio } from '@/components/ui'
import { requerirUsuario, tiendaFija } from '@/lib/auth'
import { cargarDataset, preferencias } from '@/lib/data'
import { params, type SP } from '@/lib/pagina'
import { revisaArqueos } from '@/lib/permisos'
import { inventarioRevisado } from '@/lib/nomina'
import { CompartirWhatsApp, FormArqueo, HojaCierre, turnoDeCierre } from './FormArqueo'
import { CHECKLIST, ITEMS_CHECKLIST, ROL_TURNO_LABEL, TURNO_LABEL } from '@/lib/turno'
import type { Arqueo, Dataset } from '@/lib/types'

const f2 = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hora = (h: string) => h.replace('T', ' ').slice(0, 16)

/** Cuadre de cambio de turno de cada caja, con comprobante numerado y revisión del contador. */
export default async function PaginaArqueo({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario('arqueo')
  const sp = await params(searchParams)
  const ds = await cargarDataset()
  const fija = tiendaFija(s)
  const pref = await preferencias()
  const revisa = revisaArqueos(s.rol)
  const ubic = new Map((ds.settings.axispos?.ubicaciones ?? []).map((u) => [u.code, u]))
  const ultimo = new Map<string, string>()
  for (const a of ds.arqueos) if (!ultimo.has(a.caja) || a.hasta > ultimo.get(a.caja)!) ultimo.set(a.caja, a.hasta)
  const tiendas = ds.tiendas
    .filter((t) => t.activa && t.tipo === 'local' && t.codigoTPV && (!fija || t.id === fija))
    .map((t) => {
      const areas = (t.codigoTPV ?? '').split(',').map((c) => c.trim()).filter(Boolean)
      const pisos = areas.filter((c) => ubic.get(c)?.tipo === 7)
      return { id: t.id, nombre: t.nombre, cajas: (pisos.length ? pisos : areas).map((c) => ({ code: c, nombre: ubic.get(c)?.nombre ?? `Área ${c}`, ultimo: ultimo.get(c) })) }
    })
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))
  const verPendientes = sp.f === 'pendientes'
  // El dependiente ve sus propios cuadres; el contador, los de su tienda; administración, todos.
  const lista = ds.arqueos
    .filter((a) => (revisa ? !fija || a.tienda === fija : a.usuario === s.email) && (!verPendientes || a.estado === 'pendiente'))
    .sort((a, b) => b.hasta.localeCompare(a.hasta))
    .slice(0, 100)
  const pendientes = ds.arqueos.filter((a) => a.estado === 'pendiente' && (!fija || a.tienda === fija)).length
  const categorias = ds.categorias.filter((c) => c.activa && c.caja && c.contrapartida === 'resultado').map((c) => c.nombre)
  const comunes = {
    cajeros: (ds.settings.axispos?.usuariosTPV ?? []).map((u) => u.nombre),
    cuentas: ds.settings.cuentasTransferencia ?? ['FISCAL'],
    categorias: [...new Set(['OTROS GASTOS', 'SALARIO SEGURIDAD', 'SALARIO LIMPIEZA', 'TRANSPORTE', ...categorias])],
    nombreTienda: Object.fromEntries(ds.tiendas.map((t) => [t.id, t.nombre])),
  }
  const sel = sp.id ? ds.arqueos.find((a) => a.id === sp.id && (!fija || a.tienda === fija) && (revisa || a.usuario === s.email)) : undefined
  if (sel && sp.editar && sel.estado === 'pendiente' && (revisa || sel.usuario === s.email))
    return (
      <>
        <Encabezado titulo={`Corregir cierre #${sel.numero}`} descripcion="El contador registra lo que trajo el dependiente: corrige lo que haga falta y guarda. La venta del TPV se vuelve a leer del mismo turno.">
          <a className="btn" href={`/arqueo?id=${sel.id}`}>
            Volver
          </a>
        </Encabezado>
        <HojaCierre turno={turnoDeCierre(sel)} cajaNombre={sel.cajaNombre ?? sel.caja} inicial={sel} {...comunes} />
      </>
    )
  if (sel) return <Detalle a={sel} ds={ds} revisa={revisa} puedeEditar={sel.estado === 'pendiente' && (revisa || sel.usuario === s.email)} />
  return (
    <>
      <Encabezado
        titulo="Cierre de turno"
        descripcion="Al cambiar de turno se cierra la caja: la venta y los Pax salen del TPV desde el cierre anterior; se rellenan la hoja del cuadre, la venta por tarjeta, el check list, la energía y las firmas. Al día siguiente el contador de la tienda lo revisa y lo aprueba."
      />
      {tiendas.length ? (
        <FormArqueo tiendas={tiendas} tienda={fija ?? (tiendas.some((t) => t.id === pref.tienda) ? pref.tienda : undefined)} {...comunes} />
      ) : (
        <Vacio>No hay tiendas con cajas del TPV asignadas.</Vacio>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">{revisa ? 'Cierres' : 'Mis cierres'}</h2>
        {revisa && (
          <a className="text-xs text-primary hover:underline" href={verPendientes ? '/arqueo' : '/arqueo?f=pendientes'}>
            {verPendientes ? 'Ver todos' : `Solo pendientes de revisar (${pendientes})`}
          </a>
        )}
      </div>
      {lista.length ? (
        <div className="tarjeta mt-2 overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>#</th>
                <th>Turno</th>
                <th>Caja</th>
                <th>Cajero(a)</th>
                <th className="num">Venta</th>
                <th className="num">Esperado</th>
                <th className="num">Contado</th>
                <th className="num">Diferencia</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id}>
                  <td>{a.numero}</td>
                  <td className="text-xs">
                    {hora(a.desde)} → {hora(a.hasta).slice(11)}
                  </td>
                  <td className="text-xs">
                    {nombreT.get(a.tienda)} · {a.cajaNombre}
                  </td>
                  <td className="text-xs">{a.cajero}</td>
                  <td className="num">{f2(a.ventaTienda + a.domicilio + a.plataforma)}</td>
                  <td className="num">{f2(a.esperado)}</td>
                  <td className="num">{f2(a.contado)}</td>
                  <td className={`num font-semibold ${a.diferencia < -0.5 ? 'text-danger' : a.diferencia > 0.5 ? 'text-amber-600' : 'text-accent'}`}>{Math.abs(a.diferencia) < 0.5 ? 'Cuadra' : f2(a.diferencia)}</td>
                  <td>{a.estado === 'aprobado' ? <Chip tono="verde" title={`${a.revisadoPor} · ${a.revisadoEn?.slice(0, 16)}`}>Aprobado</Chip> : <Chip tono="ambar">Pendiente</Chip>}</td>
                  <td className="whitespace-nowrap text-xs">
                    <a className="text-primary hover:underline" href={`/arqueo?id=${a.id}`}>
                      Ver
                    </a>
                    {' · '}
                    <a className="text-primary hover:underline" href={`/imprimir/arqueo?id=${a.id}`}>
                      Comprobante
                    </a>
                    {revisa && a.estado === 'pendiente' && (
                      <div className="mt-1 flex items-center gap-2">
                        <a className="btn btn-exito px-2 py-0.5 text-xs" href={`/arqueo?id=${a.id}`}>
                          Revisar
                        </a>
                        <BotonAccion accion={accionArqueoBorrar} campos={{ id: a.id }} confirmar={`¿Borrar el cuadre #${a.numero}? La caja se vuelve a cuadrar desde el anterior.`} className="text-danger hover:underline">
                          Borrar
                        </BotonAccion>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Vacio>Todavía no hay cierres.</Vacio>
      )}
    </>
  )
}

const personalDe = (a: Arqueo) => (a.personal?.length ? a.personal : [{ rol: 'cajero' as const, nombre: a.cajero ?? '', salario: a.salario, pagadoEnTurno: false }])

function Detalle({ a, ds, revisa, puedeEditar }: { a: Arqueo; ds: Dataset; revisa: boolean; puedeEditar: boolean }) {
  const tienda = ds.tiendas.find((t) => t.id === a.tienda)?.nombre ?? a.tienda
  const problemas = ITEMS_CHECKLIST.filter((i) => a.checklist && (!a.checklist[i.id]?.ok || a.checklist[i.id]?.obs)).map((i) => `${i.texto}${a.checklist?.[i.id]?.obs ? ` — ${a.checklist[i.id].obs}` : ' (sin marcar)'}`)
  const incidencias = ITEMS_CHECKLIST.filter((i) => a.checklist?.[i.id]?.obs).map((i) => a.checklist![i.id].obs!)
  return (
    <>
      <Encabezado titulo={`Cierre #${a.numero} · ${tienda}`} descripcion={`${a.cajaNombre} · ${TURNO_LABEL[a.turno ?? 'dia']} · ${hora(a.desde)} → ${hora(a.hasta)} · ${a.cajero ?? ''}`}>
        <a className="btn" href="/arqueo">
          Volver
        </a>
        <a className="btn" href={`/imprimir/arqueo?id=${a.id}`}>
          Comprobante
        </a>
        {puedeEditar && (
          <a className="btn" href={`/arqueo?id=${a.id}&editar=1`}>
            {revisa ? 'Revisar y corregir' : 'Corregir'}
          </a>
        )}
      </Encabezado>
      <div className="grid gap-4 lg:grid-cols-2">
        <CompartirWhatsApp
          datos={{
            tienda,
            turno: a.turno ?? 'dia',
            desde: a.desde,
            hasta: a.hasta,
            cajero: personalDe(a).filter((p) => p.rol !== 'seguridad' && p.nombre).map((p) => p.nombre).join(' y ') || a.cajero,
            venta: a.ventaTienda + a.domicilio + a.plataforma,
            pax: a.tpv.pax ?? {},
            paxCompra: a.paxCompra,
            paxMuseo: a.paxMuseo,
            tramos: a.tpv.tramos ?? [],
            inversor: a.energia?.inversor,
            ecoflow: a.energia?.ecoflow,
            incidencias,
          }}
        />
        <div className="tarjeta p-4 text-sm">
          <div className="grid grid-cols-2 gap-y-1">
            <span>Venta (subtotal)</span>
            <span className="text-right">{f2(a.ventaTienda + a.domicilio + a.plataforma)}</span>
            <span>Transferencias</span>
            <span className="text-right">{f2(a.transferencias.reduce((x, t) => x + t.importe, 0))}</span>
            <span>Otros gastos</span>
            <span className="text-right">{f2(a.gastos.reduce((x, g) => x + g.importe, 0))}</span>
            <span>Efectivo esperado</span>
            <span className="text-right font-semibold">{f2(a.esperado)}</span>
            <span>Total de efectivo</span>
            <span className="text-right font-semibold">{f2(a.contado)}</span>
            <span>Diferencia</span>
            <span className={`text-right font-semibold ${a.diferencia < -0.5 ? 'text-danger' : a.diferencia > 0.5 ? 'text-amber-600' : 'text-accent'}`}>{Math.abs(a.diferencia) < 0.5 ? 'Cuadra' : f2(a.diferencia)}</span>
            {personalDe(a).map((p, i) => (
              <span key={i} className="col-span-2 flex justify-between text-xs">
                <span>
                  {ROL_TURNO_LABEL[p.rol]}: {p.nombre || '—'} {p.pagadoEnTurno ? '(cobrado en el turno)' : ''}
                </span>
                <span>{f2(p.salario)}</span>
              </span>
            ))}
            <span>A entregar a la caja central</span>
            <span className="text-right">{f2(a.contado - a.fondo)}</span>
          </div>
          <div className="mt-3">
            {a.estado === 'aprobado' ? (
              <Chip tono="verde">
                Aprobado por {a.revisadoPor} el {a.revisadoEn?.slice(0, 10)}
              </Chip>
            ) : (
              <Chip tono="ambar">Pendiente de revisión del contador</Chip>
            )}
            {a.editadoPor && <span className="ml-2 text-xs text-muted-foreground">Corregido por {a.editadoPor}</span>}
          </div>
          {revisa && a.estado === 'pendiente' && (
            <div className="mt-3 rounded border border-border p-3">
              <h3 className="mb-2 font-semibold">Revisión del contador</h3>
              <FormAccion accion={accionArqueoAprobar} boton="Aprobar y registrar" claseBoton="btn btn-exito mt-2" confirmar={`¿Aprobar el cierre #${a.numero}?`} limpiar={false}>
                <input type="hidden" name="id" value={a.id} />
                <div className="mb-2 text-xs font-semibold">Salario de cada uno (se suma a su cuenta)</div>
                {personalDe(a).map((p, i) => (
                  <div key={i} className="mb-1 grid grid-cols-[6rem_1fr_7rem_5rem] items-center gap-2">
                    <span className="text-xs">{ROL_TURNO_LABEL[p.rol]}</span>
                    <input name="ap_nombre" defaultValue={p.nombre} className="input" />
                    <input name="ap_salario" defaultValue={p.salario} inputMode="decimal" className="input text-right" />
                    <span className="text-xs text-muted-foreground">{p.pagadoEnTurno ? 'ya cobrado' : 'por pagar'}</span>
                  </div>
                ))}
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label>
                    <span className="etiqueta">Descontar faltante de caja (CUP)</span>
                    <input name="faltante" defaultValue={a.diferencia < -0.5 ? Math.round(-a.diferencia * 100) / 100 : ''} inputMode="decimal" className="input text-right" placeholder="0" />
                  </label>
                  <label>
                    <span className="etiqueta">A quién</span>
                    <select name="faltanteA" defaultValue={personalDe(a).find((p) => p.rol === 'cajero')?.nombre} className="input">
                      {personalDe(a)
                        .filter((p) => p.nombre && p.rol !== 'seguridad')
                        .map((p) => (
                          <option key={p.nombre}>{p.nombre}</option>
                        ))}
                    </select>
                  </label>
                </div>
                <label className="mt-2 inline-flex items-center gap-1 text-xs">
                  <input type="checkbox" name="entregar" defaultChecked /> entregar el efectivo ({f2(a.contado - a.fondo)} menos el fondo) a la caja central
                </label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Los gastos van a la caja de la tienda; el salario queda «por pagar» en la cuenta del trabajador (Pagos al personal), donde también se le pueden descontar faltantes de inventario que aparezcan después.
                  {!inventarioRevisado(a, ds.conteos) && ' Todavía no hay un conteo de la tienda posterior a este turno.'}
                </p>
              </FormAccion>
            </div>
          )}
          {a.energia && (a.energia.inversor != null || a.energia.ecoflow != null) && (
            <p className="mt-3">
              Inversor {a.energia.inversor ?? '—'} % · EcoFlow {a.energia.ecoflow ?? '—'} %
            </p>
          )}
          {a.firmas && (
            <p className="mt-1 text-xs">
              {(['cajero', 'dependiente', 'seguridad'] as const)
                .filter((r) => a.firmas?.[r])
                .map((r) => `${r}: entrega ${a.firmas![r]!.entrega ?? '—'}, recibe ${a.firmas![r]!.recibe ?? '—'}`)
                .join(' · ')}
            </p>
          )}
        </div>
      </div>
      {a.checklist && (
        <div className="tarjeta mt-4 p-4 text-sm">
          <h3 className="font-semibold">Check list {problemas.length ? `· ${problemas.length} a revisar` : '· todo bien'}</h3>
          <ul className="mt-1 list-disc pl-5">
            {problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">{CHECKLIST.map((c) => c.titulo).join(' · ')}</p>
        </div>
      )}
      {a.tarjetas && a.tarjetas.length > 0 && (
        <div className="tarjeta mt-4 overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Número</th>
                <th className="num">Importe</th>
                <th>Carnet</th>
                <th>Titular</th>
              </tr>
            </thead>
            <tbody>
              {a.tarjetas.map((t, i) => (
                <tr key={i}>
                  <td>{t.cuenta}</td>
                  <td className="font-mono text-xs">{t.numero}</td>
                  <td className="num">{f2(t.importe)}</td>
                  <td className="text-xs">{t.ci}</td>
                  <td className="text-xs">{t.titular}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {a.fotos && a.fotos.length > 0 && (
        <div className="tarjeta mt-4 flex flex-wrap gap-2 p-4">
          {a.fotos.map((f) => (
            <a key={f} href={`/api/foto?p=${encodeURIComponent(f)}`} target="_blank" rel="noreferrer">
              <img src={`/api/foto?p=${encodeURIComponent(f)}`} alt="" className="h-32 w-32 rounded border border-border object-cover" />
            </a>
          ))}
        </div>
      )}
    </>
  )
}
