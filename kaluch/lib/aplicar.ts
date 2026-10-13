import type { LoteKM } from './importar-km'
import type { Dataset, Importacion } from './types'

const uid = () => crypto.randomUUID()

/**
 * Incorpora un lote importado al dataset. `soloValidas` deja fuera las filas con error.
 * Las tasas del archivo reemplazan a las del mismo día; los productos se fusionan por nombre.
 * Un nuevo resumen mensual reconstruido sustituye al anterior de la misma tienda.
 */
export function aplicarLote(ds: Dataset, lote: LoteKM, meta: Omit<Importacion, 'id' | 'ts' | 'lote' | 'filas' | 'totalUSD'>, soloValidas = true) {
  const loteId = uid()
  const conError = new Set(lote.problemas.filter((p) => p.nivel === 'error').map((p) => `${p.hoja}|${p.fila}`))
  const movs = lote.movimientos
    .filter((m) => !soloValidas || !conError.has(`${m._hoja}|${m._fila}`))
    .map(({ _fila, _hoja, ...m }) => ({ ...m, id: uid(), lote: loteId }))
  const tasas = new Map(ds.tasas.map((t) => [t.fecha, t]))
  for (const t of lote.tasas) tasas.set(t.fecha, t)
  const productos = new Map(ds.productos.map((p) => [p.nombre, p]))
  for (const p of lote.productos) productos.set(p.nombre, { ...productos.get(p.nombre), ...p })
  const esResumen = (o: { origen?: string; tienda: string }) => o.origen === 'resumen' && o.tienda === lote.tienda
  const hayResumen = lote.salidas.some((s) => s.origen === 'resumen') || lote.compras.some((c) => c.origen === 'resumen')
  const quitar = <T extends { origen?: string; tienda: string }>(arr: T[]) => (hayResumen ? arr.filter((x) => !esResumen(x)) : arr)
  const nuevo: Partial<Dataset> = {
    tasas: [...tasas.values()].sort((a, b) => a.fecha.localeCompare(b.fecha)),
    movimientos: [...ds.movimientos, ...movs],
    productos: [...productos.values()],
    salidas: [...quitar(ds.salidas), ...lote.salidas.map((s) => ({ ...s, id: uid(), lote: loteId }))],
    compras: [...quitar(ds.compras), ...lote.compras.map((c) => ({ ...c, id: uid(), lote: loteId }))],
    deudas: [...quitar(ds.deudas), ...lote.deudas.map((d) => ({ ...d, id: uid() }))],
    asientos: [...quitar(ds.asientos), ...lote.asientos.map((a) => ({ ...a, id: uid() }))],
  }
  if (lote.distribuciones?.length) {
    const d = new Map(ds.distribuciones.map((x) => [x.mes, x]))
    for (const x of lote.distribuciones) d.set(x.mes, x)
    nuevo.distribuciones = [...d.values()].sort((a, b) => a.mes.localeCompare(b.mes))
  }
  if (lote.referencia) nuevo.referencias = { ...ds.referencias, [lote.tienda]: { meses: lote.referencia.meses, er: lote.referencia.er, archivo: meta.archivo } }
  const imp: Importacion = { ...meta, id: uid(), ts: new Date().toISOString(), lote: loteId, filas: movs.length + lote.salidas.length + lote.compras.length + lote.tasas.length }
  nuevo.importaciones = [imp, ...ds.importaciones].slice(0, 500)
  return { nuevo, importacion: imp, omitidas: lote.movimientos.length - movs.length }
}
