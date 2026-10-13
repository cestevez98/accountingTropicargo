import { fmt } from '@/lib/informes'

const COLORES = ['var(--primary-700)', 'var(--accent-600)', 'var(--warning-600)', 'var(--primary-500)', 'var(--danger-600)', 'var(--text-secondary)']

/** Barras agrupadas en SVG (sin librerías). */
export function Barras({ etiquetas, series, alto = 200 }: { etiquetas: string[]; series: { nombre: string; valores: number[] }[]; alto?: number }) {
  const max = Math.max(1, ...series.flatMap((s) => s.valores.map((v) => Math.abs(v))))
  const ancho = 640
  const grupo = ancho / Math.max(1, etiquetas.length)
  const barra = Math.min(36, (grupo - 16) / series.length)
  const y0 = alto - 24
  return (
    <figure>
      <svg viewBox={`0 0 ${ancho} ${alto}`} className="w-full" role="img" aria-label={series.map((s) => s.nombre).join(', ')}>
        <line x1={0} x2={ancho} y1={y0} y2={y0} stroke="var(--line)" />
        {etiquetas.map((e, i) => (
          <g key={e}>
            {series.map((s, k) => {
              const v = s.valores[i] ?? 0
              const h = (Math.abs(v) / max) * (y0 - 16)
              const x = i * grupo + (grupo - barra * series.length) / 2 + k * barra
              return (
                <rect key={s.nombre} x={x} y={v >= 0 ? y0 - h : y0} width={barra - 3} height={Math.max(h, 0.5)} rx={3} fill={v < 0 ? 'var(--danger-600)' : COLORES[k % COLORES.length]}>
                  <title>{`${s.nombre} · ${e}: ${fmt(v)}`}</title>
                </rect>
              )
            })}
            <text x={i * grupo + grupo / 2} y={alto - 6} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">
              {e}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {series.map((s, k) => (
          <span key={s.nombre} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLORES[k % COLORES.length] }} />
            {s.nombre}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

/** Barras horizontales (ranking). */
export function Ranking({ filas }: { filas: { label: string; valor: number }[] }) {
  const max = Math.max(1, ...filas.map((f) => Math.abs(f.valor)))
  return (
    <ul className="space-y-2">
      {filas.map((f) => (
        <li key={f.label} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate">{f.label}</span>
            <span className="tabular-nums text-muted-foreground">{fmt(f.valor)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${(Math.abs(f.valor) / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
