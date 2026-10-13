import { fmt } from '@/lib/reports'

/** Barras agrupadas de ingresos y utilidad neta por mes. SVG sin dependencias. */
export function GraficoMensual({ etiquetas, series }: { etiquetas: string[]; series: { nombre: string; color: string; valores: number[] }[] }) {
  const n = etiquetas.length
  if (!n) return null
  const max = Math.max(1, ...series.flatMap((s) => s.valores.map((v) => Math.abs(v))))
  const hayNeg = series.some((s) => s.valores.some((v) => v < 0))
  const W = 640
  const H = 220
  const pad = { t: 10, b: 28, l: 8, r: 8 }
  const alto = H - pad.t - pad.b
  const cero = pad.t + (hayNeg ? alto / 2 : alto)
  const escala = (hayNeg ? alto / 2 : alto) / max
  const grupo = (W - pad.l - pad.r) / n
  const bw = Math.min(28, (grupo * 0.7) / series.length)
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Ingresos y utilidad neta por mes">
        <line x1={pad.l} x2={W - pad.r} y1={cero} y2={cero} stroke="#cbd5e1" />
        {etiquetas.map((e, i) => {
          const x0 = pad.l + i * grupo + (grupo - bw * series.length) / 2
          return (
            <g key={e}>
              {series.map((s, j) => {
                const v = s.valores[i] ?? 0
                const h = Math.abs(v) * escala
                return (
                  <rect key={s.nombre} x={x0 + j * bw} y={v >= 0 ? cero - h : cero} width={bw - 2} height={Math.max(h, 0.5)} fill={s.color} rx={2}>
                    <title>{`${s.nombre} ${e}: ${fmt(v)} USD`}</title>
                  </rect>
                )
              })}
              <text x={pad.l + i * grupo + grupo / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#64748b">
                {e}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="mt-1 flex gap-4 text-xs text-slate-600">
        {series.map((s) => (
          <span key={s.nombre} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.nombre}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
