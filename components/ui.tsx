import Link from 'next/link'
import { fmt } from '@/lib/reports'

export function Encabezado({ titulo, descripcion, children }: { titulo: string; descripcion?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold text-slate-900">{titulo}</h1>
        {descripcion && <p className="mt-1 text-sm text-slate-500">{descripcion}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function SelectorAnio({ anios, anio, base }: { anios: number[]; anio: number; base: string }) {
  if (anios.length < 2) return null
  return (
    <div className="flex overflow-hidden rounded-md border border-slate-300 bg-white text-sm">
      {anios.map((a) => (
        <Link key={a} href={`${base}?anio=${a}`} className={`px-3 py-1.5 ${a === anio ? 'bg-marca-600 text-white' : 'hover:bg-slate-50'}`}>
          {a}
        </Link>
      ))}
    </div>
  )
}

export function Importe({ v, dec = 2, colorear = false }: { v: number | undefined | null; dec?: number; colorear?: boolean }) {
  if (v == null || !Number.isFinite(v)) return <span className="text-slate-300">—</span>
  const cero = Math.abs(v) < 0.005
  const cls = cero ? 'text-slate-300' : colorear && v < 0 ? 'text-red-600' : ''
  return <span className={cls}>{cero ? '–' : fmt(v, dec)}</span>
}

export function Vacio({ children }: { children: React.ReactNode }) {
  return <div className="tarjeta p-8 text-center text-sm text-slate-500">{children}</div>
}

export function Kpi({ titulo, valor, sub, tono = 'normal', href }: { titulo: string; valor: string; sub?: string; tono?: 'normal' | 'bueno' | 'malo'; href?: string }) {
  const color = tono === 'bueno' ? 'text-emerald-700' : tono === 'malo' ? 'text-red-600' : 'text-slate-900'
  const inner = (
    <div className="tarjeta h-full p-4 transition hover:border-marca-500/50">
      <div className="text-xs font-medium text-slate-500">{titulo}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{valor}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}
