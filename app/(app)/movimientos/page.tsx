import Link from 'next/link'
import { Filtros, Paginacion } from '@/components/Filtros'
import { TablaRegistros } from '@/components/TablaRegistros'
import { Encabezado } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { CAT_POR_CLASIFICAR } from '@/lib/catalog'
import { COLECCIONES } from '@/lib/colecciones'
import { cargarContabilidad } from '@/lib/data'
import { listar } from '@/lib/listado'
import { opcionesFormulario } from '@/lib/opciones'
import { param, type SP } from '@/lib/pagina'

export default async function MovimientosPage({ searchParams }: { searchParams: SP }) {
  const s = await requerirUsuario(['admin', 'contador', 'cajero', 'lectura'])
  const sp = { ...(await searchParams) }
  const { ds, mayor } = await cargarContabilidad()
  const cfg = COLECCIONES.movimientos
  const cats = new Map(ds.categorias.map((c) => [c.nombre, c]))

  let datos = ds.movimientos.map((m) => {
    const c = cats.get(m.categoria)
    return { ...m, _usd: mayor.usd.get(m.id), _grupo: m.excluirER ? 'Excluido del ER' : (c?.grupoER ?? 'Sin categoría válida') } as typeof m & Record<string, unknown>
  })
  if (s.rol === 'cajero') datos = datos.filter((m) => s.cuentas?.includes(m.cuenta))
  const sinClasificar = param(sp, 'categoria') === '__sin__'
  if (sinClasificar) {
    delete sp.categoria
    datos = datos.filter((m) => m.categoria === CAT_POR_CLASIFICAR || !cats.has(m.categoria))
  }
  const listado = listar(cfg, datos as never, sp, undefined, ['_usd'])
  const nSin = ds.movimientos.filter((m) => m.categoria === CAT_POR_CLASIFICAR || !cats.has(m.categoria)).length

  return (
    <>
      <Encabezado titulo={cfg.titulo} descripcion={cfg.descripcion}>
        {s.rol !== 'cajero' && (
          <Link href={sinClasificar ? '/movimientos' : '/movimientos?categoria=__sin__'} className={`btn ${sinClasificar ? 'btn-primario' : ''}`}>
            Por clasificar ({nSin})
          </Link>
        )}
      </Encabezado>
      {sinClasificar && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Bandeja de movimientos sin clasificar: marca varios con la casilla y asígnales la categoría de una vez.
        </p>
      )}
      <Filtros cfg={cfg} listado={listado} base="/movimientos" />
      <TablaRegistros
        coleccion="movimientos"
        singular={cfg.singular}
        campos={cfg.campos}
        extras={[
          { key: '_usd', label: 'Importe USD', tipo: 'numero', despues: 'salida' },
          { key: '_grupo', label: 'Grupo ER', tipo: 'texto', despues: 'categoria' },
        ]}
        filas={listado.filas as never}
        sumas={listado.sumas}
        opciones={opcionesFormulario(ds, s)}
        puedeEditar={cfg.rolesEditar.includes(s.rol)}
        seleccion={s.rol === 'admin' || s.rol === 'contador'}
      />
      <Paginacion listado={listado} base="/movimientos" sp={sp} />
    </>
  )
}
