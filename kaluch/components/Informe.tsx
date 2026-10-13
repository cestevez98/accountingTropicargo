import Link from 'next/link'
import { fmt, rangoMes, type Informe } from '@/lib/informes'

export function TablaInforme({ inf, drill, porcentajes = true }: { inf: Informe; drill?: (cuentas: string[], mes?: string) => string; porcentajes?: boolean }) {
  return (
    <div className="tarjeta overflow-x-auto">
      <table className="tabla">
        <thead>
          <tr>
            <th className="min-w-64">Concepto</th>
            {inf.columnas.map((c) => (
              <th key={c} className="num">
                {c}
              </th>
            ))}
            {inf.conTotal && <th className="num">Total</th>}
          </tr>
        </thead>
        <tbody>
          {inf.filas.map((f, i) => {
            if (f.tipo === 'titulo')
              return (
                <tr key={i}>
                  <td colSpan={inf.columnas.length + 2} className="pt-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {f.label}
                  </td>
                </tr>
              )
            const pct = f.tipo === 'memo' && f.label.includes('%')
            const cls =
              f.tipo === 'total'
                ? 'bg-primary-soft font-bold'
                : f.tipo === 'sub'
                  ? 'font-semibold'
                  : f.tipo === 'control'
                    ? 'font-semibold'
                    : f.tipo === 'memo'
                      ? 'text-muted-foreground italic'
                      : ''
            return (
              <tr key={i} className={cls}>
                <td style={{ paddingLeft: f.nivel ? 12 + f.nivel * 10 : undefined }}>{f.label}</td>
                {f.valores.map((v, j) => {
                  const control = f.tipo === 'control'
                  const malo = control && Math.abs(v) > 0.01
                  const texto = Math.abs(v) < 0.005 ? '–' : pct ? `${fmt(v, 1)} %` : fmt(v)
                  const color = malo ? 'text-danger' : control ? 'text-accent' : v < -0.005 && !pct ? 'text-danger' : ''
                  const href = drill && f.cuentas?.length && Math.abs(v) >= 0.005 ? drill(f.cuentas, inf.meses[j]) : undefined
                  return (
                    <td key={j} className={`num ${color}`}>
                      {href ? (
                        <Link href={href} className="hover:underline">
                          {texto}
                        </Link>
                      ) : control && !malo ? (
                        '✓ 0,00'
                      ) : (
                        texto
                      )}
                    </td>
                  )
                })}
                {inf.conTotal && <td className="num font-semibold">{f.total == null || !porcentajes ? '' : Math.abs(f.total) < 0.005 ? '–' : fmt(f.total)}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export const rango = rangoMes
