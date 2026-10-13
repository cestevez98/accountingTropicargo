'use client'

import { useEffect } from 'react'

export function Imprimir() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [])
  return (
    <button className="btn mb-4 print:hidden" onClick={() => window.print()}>
      Imprimir / Guardar PDF
    </button>
  )
}
