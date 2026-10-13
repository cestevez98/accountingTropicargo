import Link from 'next/link'
import { fmt } from '@/lib/informes'

export function Encabezado({ titulo, descripcion, children }: { titulo: string; descripcion?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
        {descripcion && <p className="mt-1 text-sm text-muted-foreground">{descripcion}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function Importe({ v, dec = 2, colorear = false, moneda }: { v: number | undefined | null; dec?: number; colorear?: boolean; moneda?: string }) {
  if (v == null || !Number.isFinite(v)) return <span className="text-muted-foreground/50">—</span>
  const cero = Math.abs(v) < 0.005
  const cls = cero ? 'text-muted-foreground/50' : colorear ? (v < 0 ? 'text-danger' : 'text-accent') : ''
  return (
    <span className={`tabular-nums ${cls}`}>
      {cero ? '–' : fmt(v, dec)}
      {moneda && !cero ? <span className="ml-1 text-[10px] text-muted-foreground">{moneda}</span> : null}
    </span>
  )
}

export function Vacio({ children }: { children: React.ReactNode }) {
  return <div className="tarjeta p-10 text-center text-sm text-muted-foreground">{children}</div>
}

export function Kpi({ titulo, valor, sub, tono = 'normal', href }: { titulo: string; valor: string; sub?: React.ReactNode; tono?: 'normal' | 'bueno' | 'malo'; href?: string }) {
  const color = tono === 'bueno' ? 'text-accent' : tono === 'malo' ? 'text-danger' : ''
  const inner = (
    <div className="tarjeta h-full p-4 transition hover:border-primary/40">
      <div className="text-xs font-medium text-muted-foreground">{titulo}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{valor}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}

const TONOS = {
  gris: 'bg-muted text-muted-foreground',
  azul: 'bg-primary-soft text-primary',
  verde: 'bg-accent-soft text-accent',
  rojo: 'bg-danger-soft text-danger',
  ambar: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
} as const

export function Chip({ tono = 'gris', children, title }: { tono?: keyof typeof TONOS; children: React.ReactNode; title?: string }) {
  return (
    <span className={`chip ${TONOS[tono]}`} title={title}>
      {children}
    </span>
  )
}

export function Pestanas({ items, activa }: { items: { href: string; label: string; clave: string }[]; activa: string }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
      {items.map((i) => (
        <Link
          key={i.clave}
          href={i.href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${i.clave === activa ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          {i.label}
        </Link>
      ))}
    </div>
  )
}

export function Paginador({ pagina, total, porPagina, base }: { pagina: number; total: number; porPagina: number; base: (p: number) => string }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina))
  if (paginas <= 1) return <div className="mt-2 text-xs text-muted-foreground">{total} filas</div>
  return (
    <div className="mt-3 flex items-center gap-2 text-sm">
      <span className="text-xs text-muted-foreground">
        {total.toLocaleString('es-ES')} filas · página {pagina} de {paginas}
      </span>
      {pagina > 1 && (
        <Link className="btn" href={base(pagina - 1)}>
          ← Anterior
        </Link>
      )}
      {pagina < paginas && (
        <Link className="btn" href={base(pagina + 1)}>
          Siguiente →
        </Link>
      )}
    </div>
  )
}

export function Aviso({ tono = 'ambar', children }: { tono?: 'ambar' | 'rojo' | 'verde' | 'info'; children: React.ReactNode }) {
  const cls = { ambar: 'border-warning/30 bg-warning-soft text-warning', rojo: 'border-danger/30 bg-danger-soft text-danger', verde: 'border-accent/30 bg-accent-soft text-accent', info: 'border-info/30 bg-info-soft text-info' }[tono]
  return <div className={`mb-4 rounded-lg border px-4 py-2.5 text-sm ${cls}`}>{children}</div>
}

/** Construye una URL conservando los parámetros actuales. */
export function url(base: string, actuales: Record<string, string | undefined>, cambios: Record<string, string | number | undefined>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...actuales, ...cambios })) if (v != null && v !== '') p.set(k, String(v))
  const q = p.toString()
  return q ? `${base}?${q}` : base
}
