import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { aplicarLote } from '../lib/aplicar'
import { DEFECTOS } from '../lib/defectos'
import { aUSD, prepararTasas, valorarVenta } from '../lib/fx'
import { leerLibroKM } from '../lib/importar-km'
import { estadoResultados, estadoSituacion, flujoEfectivo, Indice, mesesDelAnio } from '../lib/informes'
import { construirMayor } from '../lib/mayor'
import { compararER } from '../lib/paridad'
import type { Dataset } from '../lib/types'

const base = (): Dataset => structuredClone(DEFECTOS)

describe('tasas', () => {
  const t = prepararTasas([{ fecha: '2026-06-13', cupUsd: 655, cupEur: 750 }], 15)
  it('convierte CUP y EUR a USD con la tasa Toque', () => {
    expect(aUSD(t, 655, 'CUP', '2026-06-13')).toBeCloseTo(1)
    expect(aUSD(t, 100, 'EUR', '2026-06-20')).toBeCloseTo(750 / 6.55)
  })
  it('valora la venta en CUP a la tasa de venta de la tienda y separa el ingreso por tasa', () => {
    const v = valorarVenta(t, 1100, 'CUP', '2026-06-13')
    expect(v.ventaUSD).toBeCloseTo(1100 / 670)
    expect(v.ventaUSD + v.ingresoTasaUSD).toBeCloseTo(1100 / 655)
  })
})

describe('libro mayor', () => {
  it('cuadra el balance y lleva cada movimiento a su renglón', () => {
    const ds = base()
    ds.settings.revaluar = false
    ds.tasas = [{ fecha: '2026-06-01', cupUsd: 600 }]
    ds.movimientos = [
      { id: 'a', libro: 'caja', fecha: '2026-06-02', tienda: 'km26', categoria: 'VENTAS', tipo: 'Entrada', moneda: 'CUP', monto: 60000 },
      { id: 'b', libro: 'caja', fecha: '2026-06-03', tienda: 'km26', categoria: 'SALARIO DEPENDIENTE', tipo: 'Salida', moneda: 'CUP', monto: 6000 },
      { id: 'c', libro: 'banco', fecha: '2026-06-04', tienda: 'km26', cuenta: 'FISCAL', categoria: 'VENTAS', tipo: 'Entrada', moneda: 'USD', monto: 200 },
    ]
    ds.compras = [{ id: 'k', fecha: '2026-06-01', tienda: 'km26', moneda: 'USD', importe: 300, importeUSD: 300, pago: 'credito', fiscal: false, origen: 'manual', producto: 'X', cantidad: 10 }]
    ds.salidas = [{ id: 's', tipo: 'venta', fecha: '2026-06-02', tienda: 'km26', producto: 'X', cantidad: 4, ventaUSD: 100, ingresoTasaUSD: 2, origen: 'manual' }]
    const mayor = construirMayor(ds, '2026-06-30')
    expect(mayor.lineas.reduce((a, l) => a + l.usd, 0)).toBeCloseTo(0)
    const idx = new Indice(mayor)
    const er = estadoResultados(ds, idx, ['2026-06'])
    const v = (label: string) => er.filas.find((f) => f.label === label)!.valores[0]
    expect(v('Venta')).toBeCloseTo(100)
    expect(v('Ingreso por tasa de cambio')).toBeCloseTo(2)
    expect(v('Costo de Ventas')).toBeCloseTo(-120) // 4 × costo promedio 30
    expect(v('Salarios variables (Dependientes)')).toBeCloseTo(-10)
    expect(v('Ventas')).toBeCloseTo(-22) // 11 % de 200 cobrados por banco
    const es = estadoSituacion(idx, ['2026-06'])
    expect(es.filas.find((f) => f.tipo === 'control')!.valores[0]).toBeCloseTo(0)
    const efe = flujoEfectivo(ds, mayor, ['2026-06'])
    expect(efe.filas.find((f) => f.tipo === 'control')!.valores[0]).toBeCloseTo(0)
  })
})

// Paridad con el libro real de KM-26 (solo si el archivo está disponible localmente).
const KM = process.env.KM_XLSX
describe.skipIf(!KM || !existsSync(KM))('paridad con el Excel KM-26', () => {
  it('ventas, ingreso por tasa y gastos de caja coinciden con el ER del Excel', () => {
    const ds = base()
    const lote = leerLibroKM(readFileSync(KM!), ds)
    Object.assign(ds, aplicarLote(ds, lote, { usuario: 't', tipo: 'km', archivo: 'km' }).nuevo)
    const mayor = construirMayor(ds, '2026-10-13')
    const idx = new Indice(mayor)
    const meses = mesesDelAnio(mayor, 2026)
    const p = compararER(lote.referencia!, estadoResultados(ds, idx, meses))
    for (const label of ['Venta', 'Ingreso por tasa de cambio', 'Salarios variables (Dependientes)', 'Salarios fijos (personal administrativo)', 'Comunicación (Publicidad)', 'Consumo interno', 'Bonos', 'Gastos Financieros']) {
      const f = p.find((x) => x.label === label)!
      for (const d of f.dif) expect(Math.abs(d)).toBeLessThan(0.01)
    }
    for (const v of estadoSituacion(idx, meses).filas.find((f) => f.tipo === 'control')!.valores) expect(Math.abs(v)).toBeLessThan(0.01)
  }, 60_000)
})
