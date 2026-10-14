import type { ApunteNomina, Arqueo, Conteo } from './types'

/** Pagos al personal: saldos por trabajador. Funciones puras. */

export const nombreTrabajador = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase()

const r2 = (n: number) => Math.round(n * 100) / 100

export interface CuentaTrabajador {
  trabajador: string
  tiendas: string[]
  devengado: number
  descuentos: number
  pagado: number
  porPagar: number
  turnos: number
  ultimo?: string
}

export function cuentasTrabajadores(apuntes: ApunteNomina[]): CuentaTrabajador[] {
  const m = new Map<string, CuentaTrabajador>()
  for (const a of apuntes) {
    const c = m.get(a.trabajador) ?? { trabajador: a.trabajador, tiendas: [], devengado: 0, descuentos: 0, pagado: 0, porPagar: 0, turnos: 0 }
    if (!c.tiendas.includes(a.tienda)) c.tiendas.push(a.tienda)
    if (a.tipo === 'devengo') {
      c.devengado += a.importe
      c.turnos++
    } else if (a.tipo === 'descuento') c.descuentos += a.importe
    else c.pagado += a.importe
    if (!c.ultimo || a.fecha > c.ultimo) c.ultimo = a.fecha
    m.set(a.trabajador, c)
  }
  return [...m.values()]
    .map((c) => ({ ...c, devengado: r2(c.devengado), descuentos: r2(c.descuentos), pagado: r2(c.pagado), porPagar: r2(c.devengado - c.descuentos - c.pagado) }))
    .sort((a, b) => b.porPagar - a.porPagar || a.trabajador.localeCompare(b.trabajador))
}

/**
 * ¿Ya se revisó el inventario después de este turno? Hay un conteo cerrado de la misma tienda que empezó
 * después del cierre. Mientras no lo haya, el salario de ese turno puede llevarse un descuento por faltantes.
 */
export function inventarioRevisado(cierre: Pick<Arqueo, 'tienda' | 'hasta'>, conteos: Conteo[]) {
  return conteos.some((c) => c.tienda === cierre.tienda && c.estado === 'cerrado' && c.inicio.slice(0, 16) >= isoUTC(cierre.hasta).slice(0, 16))
}

/** Hora local de Cuba (sin zona) → ISO UTC aproximado (Cuba: UTC−4 en horario de verano, −5 en invierno). */
function isoUTC(local: string) {
  const d = new Date(`${local}Z`)
  const mes = Number(local.slice(5, 7))
  const desfase = mes >= 3 && mes <= 10 ? 4 : 5
  return new Date(d.getTime() + desfase * 3600000).toISOString()
}

/** Faltante valorado de un conteo (CUP): solo las diferencias negativas, a costo. */
export function faltanteConteo(c: Conteo, costoCUP: (codigo: string, costoUSD?: number) => number) {
  return r2((c.resultado ?? []).filter((r) => r.diferencia < 0).reduce((s, r) => s + -r.diferencia * costoCUP(r.codigo, r.costoUSD), 0))
}
