import { Filtros, Paginacion } from '@/components/Filtros'
import { TablaRegistros } from '@/components/TablaRegistros'
import { Encabezado, Kpi } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { COLECCIONES } from '@/lib/colecciones'
import { cargarContabilidad } from '@/lib/data'
import { listar } from '@/lib/listado'
import { opcionesFormulario } from '@/lib/opciones'
import { param, type SP } from '@/lib/pagina'
import { estadoFactura, fmt } from '@/lib/reports'

const RE_REF = /\b(INV\d+|MUTIPAYMENT-\d+|MULTIPAYMENT-\d+)\b/gi

export default async function FacturacionPage({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario(['admin', 'contador', 'lectura'])
  const sp = await searchParams
  const { ds, mayor } = await cargarContabilidad()
  const cfg = COLECCIONES.facturas

  // Cobros localizados: movimientos cuyo concepto, referencia u observaciones citan el número de factura.
  const localizados = new Map<string, number>()
  for (const m of ds.movimientos) {
    const txt = `${m.concepto} ${m.referencia ?? ''} ${m.observaciones ?? ''}`
    const refs = new Set((txt.match(RE_REF) ?? []).map((r) => r.toUpperCase()))
    for (const r of refs) localizados.set(r, (localizados.get(r) ?? 0) + (mayor.usd.get(m.id) ?? 0))
  }

  const estado = param(sp, 'estado') ?? ''
  const conc = param(sp, 'conciliacion') ?? ''
  const datos = ds.facturas.map((f) => {
    const e = estadoFactura(f)
    const loc = /^INV/i.test(f.numero) ? (localizados.get(f.numero.toUpperCase()) ?? 0) : undefined
    let conciliacion = ''
    if (loc !== undefined && (f.cobrado || loc)) {
      if (Math.abs(f.cobrado - loc) <= 1) conciliacion = 'Cuadra'
      else if (!loc) conciliacion = 'Sin referencia en el libro'
      else if (loc > f.monto + 1) conciliacion = 'Movimiento compartido'
      else if (!f.cobrado) conciliacion = 'Cobro no aplicado'
      else conciliacion = `Descuadre ${fmt(f.cobrado - loc)}`
    }
    return { ...f, _pendiente: e.pendiente, _dias: e.dias || undefined, _estado: e.estado, _localizado: loc, _conciliacion: conciliacion }
  })
  const listado = listar(
    cfg,
    datos as never,
    sp,
    (r: Record<string, unknown>) => (!estado || r._estado === estado) && (!conc || String(r._conciliacion).startsWith(conc)),
    ['_pendiente', '_localizado'],
  )
  const conER = ds.facturas.filter((f) => f.afectaER)
  const pend = conER.reduce((a, f) => a + Math.max(0, f.monto - f.cobrado), 0)
  const vencidas = datos.filter((f) => f.afectaER && f._estado === 'Vencida')
  return (
    <>
      <Encabezado titulo={cfg.titulo} descripcion={cfg.descripcion} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Kpi titulo="Facturas" valor={ds.facturas.length.toLocaleString('es-ES')} sub={`${conER.length.toLocaleString('es-ES')} afectan el ER`} />
        <Kpi titulo="Pendiente de cobro (según sistema)" valor={`${fmt(pend)} USD`} />
        <Kpi titulo="Vencidas" valor={vencidas.length.toLocaleString('es-ES')} sub={`${fmt(vencidas.reduce((a, f) => a + f._pendiente, 0))} USD`} tono={vencidas.length ? 'malo' : 'normal'} href="/facturacion?estado=Vencida" />
      </div>
      <Filtros
        cfg={cfg}
        listado={listado}
        base="/facturacion"
        extra={
          <>
            <div>
              <label className="etiqueta">Estado</label>
              <select name="estado" defaultValue={estado} className="input">
                <option value="">Todos</option>
                <option>Vigente</option>
                <option>Vencida</option>
                <option>Cobrada</option>
              </select>
            </div>
            <div>
              <label className="etiqueta">Conciliación del cobro</label>
              <select name="conciliacion" defaultValue={conc} className="input">
                <option value="">Todas</option>
                <option>Cuadra</option>
                <option>Sin referencia en el libro</option>
                <option>Cobro no aplicado</option>
                <option>Movimiento compartido</option>
                <option>Descuadre</option>
              </select>
            </div>
          </>
        }
      />
      <TablaRegistros
        coleccion="facturas"
        singular={cfg.singular}
        campos={cfg.campos}
        extras={[
          { key: '_pendiente', label: 'Pendiente', tipo: 'numero', despues: 'cobrado' },
          { key: '_dias', label: 'Días venc.', tipo: 'numero', despues: 'cobrado' },
          { key: '_estado', label: 'Estado', tipo: 'badge' },
          { key: '_localizado', label: 'Cobros localizados', tipo: 'numero' },
          { key: '_conciliacion', label: 'Conciliación', tipo: 'badge' },
        ]}
        filas={listado.filas as never}
        sumas={listado.sumas}
        opciones={opcionesFormulario(ds, s)}
        puedeEditar={cfg.rolesEditar.includes(s.rol)}
      />
      <Paginacion listado={listado} base="/facturacion" sp={sp} />
    </>
  )
}
