'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface ItemNav {
  href: string
  label: string
}

export function Nav({ secciones }: { secciones: { titulo: string; items: ItemNav[] }[] }) {
  const path = usePathname()
  return (
    <nav className="space-y-5 text-sm">
      {secciones.map((s) => (
        <div key={s.titulo}>
          <div className="mb-1 px-3 text-[11px] font-semibold tracking-wider text-marca-100/60 uppercase">{s.titulo}</div>
          <ul className="space-y-0.5">
            {s.items.map((i) => {
              const activo = i.href === '/' ? path === '/' : path === i.href || path.startsWith(`${i.href}/`)
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    className={`block rounded-md px-3 py-1.5 transition ${activo ? 'bg-white/15 font-medium text-white' : 'text-marca-50/80 hover:bg-white/10 hover:text-white'}`}
                  >
                    {i.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
