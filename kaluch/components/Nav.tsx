'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

const ICONOS: Record<string, string> = {
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  importar: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3',
  ventas: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5',
  compras: 'M3 4h2l2.4 11h11L21 7H6.2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm9 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  caja: 'M3 7h18v12H3zM3 7l3-3h12l3 3M16 13h2',
  deudas: 'M4 19V5M9 19v-7M14 19V9M19 19v-4',
  inventario: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8',
  reportes: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  contabilidad: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16',
  tasas: 'M4 12a8 8 0 0 1 14-5l2-2v6h-6l2-2a5 5 0 0 0-9 3M20 12a8 8 0 0 1-14 5l-2 2v-6h6l-2 2a5 5 0 0 0 9-3',
  catalogos: 'M3 7l9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4',
  integraciones: 'M9 7V3M15 7V3M7 7h10v5a5 5 0 0 1-10 0zM12 17v4',
  alertas: 'M12 3l9 16H3zM12 10v4M12 17v.01',
}

export function Nav({ items, nombre, rol, color, salir }: { items: { href: string; label: string; clave: string; badge?: number }[]; nombre: string; rol: string; color: string; salir: React.ReactNode }) {
  const path = usePathname()
  const [abierto, setAbierto] = useState(false)
  const activo = (href: string) => (href === '/' ? path === '/' : path.startsWith(href))
  const lista = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
      {items.map((i) => {
        const on = activo(i.href)
        return (
          <Link
            key={i.href}
            href={i.href}
            onClick={() => setAbierto(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${on ? 'bg-sidebar-active text-white' : 'text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-white'}`}
          >
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
              <path d={ICONOS[i.clave] ?? ICONOS.reportes} />
            </svg>
            <span className="truncate">{i.label}</span>
            {i.badge ? <span className="ml-auto rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">{i.badge}</span> : on ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" /> : null}
          </Link>
        )
      })}
    </nav>
  )
  const pie = (
    <div className="border-t border-white/10 p-4 text-xs text-sidebar-foreground">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: color }}>
          {nombre
            .split(/\s+/)
            .map((p) => p[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate font-semibold text-white">{nombre}</div>
          <div>{rol}</div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Link href="/cuenta" className="rounded border border-white/20 px-2 py-1 text-white/90 hover:bg-white/10">
          Mi cuenta
        </Link>
        {salir}
      </div>
    </div>
  )
  const logo = (
    <div className="flex h-16 items-center gap-2.5 px-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-extrabold text-white">KA</span>
      <span className="text-[15px] leading-tight font-bold text-white">
        Kaluch<span className="block text-xs font-medium text-sidebar-foreground">Accounting</span>
      </span>
    </div>
  )
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar lg:flex">
        {logo}
        {lista}
        {pie}
      </aside>
      <div className="bg-sidebar lg:hidden">
        <div className="flex items-center justify-between pr-4">
          {logo}
          <button onClick={() => setAbierto(!abierto)} className="rounded border border-white/30 px-3 py-1 text-xs text-white" aria-expanded={abierto}>
            Menú
          </button>
        </div>
        {abierto && (
          <div className="flex flex-col pb-2">
            {lista}
            {pie}
          </div>
        )}
      </div>
    </>
  )
}
