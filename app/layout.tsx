import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Tropicargo — Contabilidad',
  description: 'Contabilidad integrada de Tropicargo Express',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
