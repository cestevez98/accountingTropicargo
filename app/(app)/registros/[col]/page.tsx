import { notFound } from 'next/navigation'
import { Filtros, Paginacion } from '@/components/Filtros'
import { TablaRegistros } from '@/components/TablaRegistros'
import { PanelTasas } from '@/components/PanelTasas'
import { Encabezado } from '@/components/ui'
import { hoyCuba, tokenConfigurado } from '@/lib/eltoque'
import { prepararTasas, tasaVigente } from '@/lib/fx'
import { requerirUsuario } from '@/lib/auth'
import { nombreCuentaMayor } from '@/lib/catalog'
import { COLECCIONES } from '@/lib/colecciones'
import { cargarDataset } from '@/lib/data'
import { listar } from '@/lib/listado'
import { opcionesFormulario } from '@/lib/opciones'
import type { SP } from '@/lib/pagina'
import type { Dataset } from '@/lib/types'

export const maxDuration = 120

const DEDICADAS: Record<string, string> = { movimientos: '/movimientos', facturas: '/facturacion' }

export default async function RegistrosPage({ params, searchParams }: { params: Promise<{ col: string }>; searchParams: SP }) {
  const { col } = await params
  const cfg = COLECCIONES[col]
  if (!cfg || DEDICADAS[col]) notFound()
  const s = await requerirUsuario(['admin', 'contador', 'lectura'])
  const sp = await searchParams
  const ds = await cargarDataset()
  const datos = (ds[col as keyof Dataset] as unknown as (Record<string, unknown> & { id: string })[]) ?? []
  const extras: { key: string; label: string; tipo: 'numero' | 'texto' | 'badge'; despues?: string }[] = []
  let filasBase = datos

  if (col === 'facturasCompra') {
    filasBase = datos.map((r) => {
      const pend = (Number(r.monto) || 0) - (Number(r.pagado) || 0)
      return { ...r, _pendiente: pend, _estado: pend <= 0.01 ? 'Pagada' : r.vencimiento && String(r.vencimiento) < new Date().toISOString().slice(0, 10) ? 'Vencida' : 'Vigente' }
    })
    extras.push({ key: '_pendiente', label: 'Pendiente', tipo: 'numero', despues: 'pagado' }, { key: '_estado', label: 'Estado', tipo: 'badge' })
  }
  if (col === 'cxcManual') {
    filasBase = datos.map((r) => {
      const pend = (Number(r.facturado) || 0) - (Number(r.cobrado) || 0)
      return { ...r, _pendiente: pend, _estado: pend <= 0.01 ? 'Cobrada' : r.vencimiento && String(r.vencimiento) < new Date().toISOString().slice(0, 10) ? 'Vencida' : 'Vigente' }
    })
    extras.push({ key: '_pendiente', label: 'Pendiente', tipo: 'numero', despues: 'cobrado' }, { key: '_estado', label: 'Estado', tipo: 'badge' })
  }
  if (col === 'activos') {
    filasBase = datos.map((r) => ({ ...r, _neto: r.costo ? (Number(r.costo) || 0) - (Number(r.depAcumApertura) || 0) : undefined }))
    extras.push({ key: '_neto', label: 'Valor neto al inicio', tipo: 'numero', despues: 'depAcumApertura' })
  }
  if (col === 'asientos') {
    filasBase = datos.map((r) => ({ ...r, _cargo: nombreCuentaMayor(String(r.cargo)), _abono: nombreCuentaMayor(String(r.abono)) }))
    extras.push({ key: '_cargo', label: 'Cargo (debe)', tipo: 'texto', despues: 'concepto' }, { key: '_abono', label: 'Abono (haber)', tipo: 'texto', despues: 'concepto' })
  }
  if (col === 'categorias' || col === 'cuentas') {
    filasBase = [...datos].sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0))
  }

  const sumarExtra = extras.filter((e) => e.tipo === 'numero').map((e) => e.key)
  const listado = listar(cfg, filasBase, sp, undefined, sumarExtra)
  const puede = cfg.rolesEditar.includes(s.rol)
  const base = `/registros/${col}`
  return (
    <>
      <Encabezado titulo={cfg.titulo} descripcion={cfg.descripcion} />
      {col === 'tasas' && (
        <PanelTasas
          token={tokenConfigurado()}
          margen={ds.settings.margenCupUsd}
          ultima={ds.settings.ultimaTasaAuto}
          hoy={hoyCuba()}
          vigente={tasaVigente(prepararTasas(ds.tasas), hoyCuba())}
          fechaInicio={ds.settings.fechaInicio}
          esAdmin={s.rol === 'admin'}
          puedeActualizar={s.rol === 'admin' || s.rol === 'contador'}
        />
      )}
      <Filtros cfg={cfg} listado={listado} base={base} />
      <TablaRegistros
        coleccion={col}
        singular={cfg.singular}
        campos={cfg.campos}
        extras={extras}
        filas={listado.filas}
        sumas={listado.sumas}
        opciones={opcionesFormulario(ds, s)}
        puedeEditar={puede}
      />
      <Paginacion listado={listado} base={base} sp={sp} />
    </>
  )
}
