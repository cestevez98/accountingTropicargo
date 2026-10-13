import { CAT_POR_CLASIFICAR } from './catalogo'
import { hoy } from './fecha'
import { inventarioDerivado } from './inventario'
import type { Mayor } from './mayor'
import type { Dataset } from './types'

export interface Alerta {
  severidad: 'alta' | 'media' | 'baja'
  titulo: string
  detalle?: string
  href?: string
}

/** Reglas de alerta: se calculan al vuelo sobre los datos actuales. */
export function calcularAlertas(ds: Dataset, mayor: Mayor, tienda?: string): Alerta[] {
  const out: Alerta[] = []
  const filtra = <T extends { tienda: string }>(a: T[]) => (tienda ? a.filter((x) => x.tienda === tienda) : a)
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))

  const hoyISO = hoy()
  if (!ds.tasas.some((t) => t.fecha === hoyISO && t.cupUsd > 0))
    out.push({ severidad: 'alta', titulo: 'Sin tasa de cambio para hoy', detalle: 'Las conversiones usan la última tasa registrada. Registra la tasa del día.', href: '/tasas' })

  const porClasificar = filtra(ds.movimientos).filter((m) => m.categoria === CAT_POR_CLASIFICAR || !mayor.categorias.has(m.categoria))
  if (porClasificar.length) out.push({ severidad: 'media', titulo: `${porClasificar.length} movimientos por clasificar`, detalle: 'Sin categoría o con una categoría que no está en el catálogo.', href: '/caja?cat=POR%20CLASIFICAR' })

  for (const a of mayor.avisos) out.push({ severidad: 'media', titulo: a })

  const inv = inventarioDerivado(ds, tienda)
  const negativos = inv.filter((f) => f.existencia < -0.0001)
  if (negativos.length)
    out.push({
      severidad: 'alta',
      titulo: `Inventario negativo en ${negativos.length} productos`,
      detalle: negativos
        .slice(0, 5)
        .map((f) => `${f.producto} (${nombreT.get(f.tienda) ?? f.tienda}: ${f.existencia})`)
        .join(' · '),
      href: '/inventario?neg=1',
    })

  // Ventas por debajo del costo y margen mínimo, por producto (últimos 30 días).
  const desde = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const prod = new Map<string, { venta: number; costo: number }>()
  for (const s of filtra(ds.salidas)) {
    if (s.tipo !== 'venta' || !s.producto || s.fecha < desde || s.ventaUSD == null || s.costoUSD == null) continue
    const p = prod.get(s.producto) ?? { venta: 0, costo: 0 }
    p.venta += (s.ventaUSD ?? 0) + (s.ingresoTasaUSD ?? 0)
    p.costo += s.costoUSD
    prod.set(s.producto, p)
  }
  const bajoCosto = [...prod.entries()].filter(([, p]) => p.costo > p.venta + 0.01)
  if (bajoCosto.length)
    out.push({
      severidad: 'alta',
      titulo: `${bajoCosto.length} productos vendidos bajo costo (30 días)`,
      detalle: bajoCosto
        .slice(0, 5)
        .map(([n, p]) => `${n}: costo ${p.costo.toFixed(2)} vs venta ${p.venta.toFixed(2)} USD`)
        .join(' · '),
      href: '/ventas',
    })
  const min = ds.settings.margenMinimo
  const bajoMargen = [...prod.entries()].filter(([, p]) => p.venta > 0 && p.costo <= p.venta && (p.venta - p.costo) / p.venta < min)
  if (bajoMargen.length)
    out.push({
      severidad: 'media',
      titulo: `${bajoMargen.length} productos con margen por debajo del ${(min * 100).toFixed(0)} %`,
      detalle: bajoMargen
        .slice(0, 5)
        .map(([n, p]) => `${n} — margen ${(((p.venta - p.costo) / p.venta) * 100).toFixed(1)} %`)
        .join(' · '),
      href: '/ventas',
    })

  // Días sin reporte de ventas en tiendas con ventas.
  for (const t of ds.tiendas.filter((t) => t.tipo === 'local' && (!tienda || t.id === tienda))) {
    const fechas = ds.salidas.filter((s) => s.tienda === t.id && s.tipo === 'venta').map((s) => s.fecha)
    if (!fechas.length) continue
    const ultima = fechas.reduce((a, b) => (a > b ? a : b))
    const dias = Math.round((Date.parse(hoyISO) - Date.parse(ultima)) / 86400000)
    if (dias > 1) out.push({ severidad: dias > 7 ? 'alta' : 'baja', titulo: `${t.nombre}: último reporte de ventas el ${ultima}`, detalle: `${dias} días sin ventas registradas.`, href: '/importar' })
  }

  const pc = mayor.lineas.filter((l) => l.cuenta === 'por_clasificar' && (!tienda || l.tienda === tienda)).reduce((s, l) => s + l.usd, 0)
  if (Math.abs(pc) > 0.01) out.push({ severidad: 'media', titulo: `Partidas por clasificar en el balance: ${pc.toFixed(2)} USD`, detalle: 'Asientos o movimientos que esperan su contrapartida.', href: '/contabilidad?tab=submayor&cuenta=por_clasificar' })
  const tr = mayor.lineas.filter((l) => l.cuenta === 'traspasos' && (!tienda || l.tienda === tienda)).reduce((s, l) => s + l.usd, 0)
  if (Math.abs(tr) > 1)
    out.push({ severidad: 'media', titulo: `Traspasos y cambios de divisa sin cuadrar: ${tr.toFixed(2)} USD`, detalle: 'Cada salida por traspaso o cambio de divisas debería tener su entrada en otra caja o banco.', href: '/contabilidad?tab=submayor&cuenta=traspasos' })

  const orden = { alta: 0, media: 1, baja: 2 }
  return out.sort((a, b) => orden[a.severidad] - orden[b.severidad])
}
