import Link from 'next/link'
import type { ColeccionConfig } from '@/lib/colecciones'
import type { Listado } from '@/lib/listado'

export function Filtros({
  cfg,
  listado,
  base,
  extra,
  exportar = true,
}: {
  cfg: ColeccionConfig
  listado: Listado<unknown>
  base: string
  extra?: React.ReactNode
  exportar?: boolean
}) {
  const f = listado.filtros
  const qs = new URLSearchParams(f).toString()
  return (
    <form className="tarjeta mb-3 flex flex-wrap items-end gap-3 p-3" action={base}>
      {cfg.busqueda.length > 0 && (
        <div className="min-w-48 flex-1">
          <label className="etiqueta">Buscar texto o importe</label>
          <input name="q" defaultValue={f.q ?? ''} className="input" placeholder={cfg.busqueda.join(', ')} />
        </div>
      )}
      {cfg.campoFecha && (
        <>
          <div>
            <label className="etiqueta">Mes</label>
            <input type="month" name="mes" defaultValue={f.mes ?? ''} className="input" />
          </div>
          <div>
            <label className="etiqueta">Desde</label>
            <input type="date" name="desde" defaultValue={f.desde ?? ''} className="input" />
          </div>
          <div>
            <label className="etiqueta">Hasta</label>
            <input type="date" name="hasta" defaultValue={f.hasta ?? ''} className="input" />
          </div>
        </>
      )}
      {cfg.campos
        .filter((c) => c.filtro)
        .map((c) => (
          <div key={c.key} className="max-w-56">
            <label className="etiqueta">{c.label}</label>
            <select name={c.key} defaultValue={f[c.key] ?? ''} className="input">
              <option value="">Todos</option>
              {listado.opcionesFiltro[c.key]?.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </div>
        ))}
      {extra}
      <div className="flex gap-2">
        <button className="btn btn-primario">Filtrar</button>
        <Link href={base} className="btn">
          Limpiar
        </Link>
        {exportar && (
          <a className="btn" href={`/api/exportar?coleccion=${cfg.key}${qs ? `&${qs}` : ''}`}>
            Excel
          </a>
        )}
      </div>
    </form>
  )
}

export function Paginacion({ listado, base, sp }: { listado: Listado<unknown>; base: string; sp: Record<string, string | string[] | undefined> }) {
  const { pagina, paginas, total } = listado
  const url = (p: number) => {
    const u = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === 'string') as [string, string][])
    u.set('p', String(p))
    return `${base}?${u}`
  }
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
      <span>
        {total.toLocaleString('es-ES')} registros · página {pagina} de {paginas}
      </span>
      {paginas > 1 && (
        <div className="flex gap-1">
          {pagina > 1 && (
            <Link className="btn !py-1" href={url(pagina - 1)}>
              ← Anterior
            </Link>
          )}
          {pagina < paginas && (
            <Link className="btn !py-1" href={url(pagina + 1)}>
              Siguiente →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
