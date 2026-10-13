import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIAS, DEFAULT_CUENTAS, DEFAULT_SETTINGS } from '@/lib/catalog'
import { movUSD, prepararTasas } from '@/lib/fx'
import { construirMayor } from '@/lib/ledger'
import { Indice, estadoResultados, estadoSituacion, flujoEfectivo, mesesDelAnio } from '@/lib/reports'
import type { Dataset, Movimiento } from '@/lib/types'

let n = 0
const mov = (p: Partial<Movimiento>): Movimiento => ({
  id: `m${++n}`,
  fecha: '2026-08-05',
  cuenta: 'Truist',
  categoria: 'Otros gastos',
  concepto: 'x',
  moneda: 'USD',
  entrada: 0,
  salida: 0,
  ...p,
})

function base(extra: Partial<Dataset> = {}): Dataset {
  return {
    settings: { ...DEFAULT_SETTINGS, capitalApertura: 1000, cxcSistemaApertura: 0 },
    categorias: DEFAULT_CATEGORIAS,
    cuentas: DEFAULT_CUENTAS,
    tasas: [{ id: 't1', fecha: '2026-07-01', cupPorUsd: 500, usdPorEur: 1.1, confirmada: true }],
    movimientos: [],
    facturas: [],
    facturasCompra: [],
    pagosProveedor: [],
    cxcManual: [],
    activos: [],
    paquetes: [],
    devengos: [],
    asientos: [],
    reglas: [],
    ...extra,
  }
}

function informes(ds: Dataset) {
  const mayor = construirMayor(ds)
  const idx = new Indice(mayor)
  const meses = mesesDelAnio(mayor, 2026)
  return { mayor, idx, meses, er: estadoResultados(ds, idx, meses), efe: flujoEfectivo(ds, idx, meses), es: estadoSituacion(ds, idx, meses) }
}

const val = (inf: { filas: { key: string; valores: number[] }[] }, key: string, i = 0) => inf.filas.find((f) => f.key === key)?.valores[i] ?? 0

describe('conversión de moneda', () => {
  const t = prepararTasas([
    { id: 'a', fecha: '2026-08-01', cupPorUsd: 600, usdPorEur: 1.1, confirmada: true },
    { id: 'b', fecha: '2026-09-01', cupPorUsd: 700, usdPorEur: 1.2, confirmada: true },
  ])
  it('usa la tasa vigente más reciente', () => {
    expect(movUSD({ moneda: 'CUP', entrada: 0, salida: 7000, fecha: '2026-09-15' }, t)).toBeCloseTo(-10)
    expect(movUSD({ moneda: 'CUP', entrada: 6000, salida: 0, fecha: '2026-08-31' }, t)).toBeCloseTo(10)
    expect(movUSD({ moneda: 'EUR', entrada: 100, salida: 0, fecha: '2026-09-02' }, t)).toBeCloseTo(120)
  })
  it('una tasa propia del movimiento manda', () => {
    expect(movUSD({ moneda: 'CUP', entrada: 785, salida: 0, fecha: '2026-09-15', tasa: 785 }, t)).toBeCloseTo(1)
  })
})

describe('libro mayor e informes', () => {
  const ds = base({
    movimientos: [
      mov({ fecha: '2026-07-28', categoria: 'Saldo inicial', entrada: 5000, concepto: 'saldo' }),
      mov({ cuenta: 'Caja Cuba', fecha: '2026-08-01', categoria: 'Saldo inicial', moneda: 'CUP', entrada: 50000 }),
      mov({ categoria: 'Cobro cliente', entrada: 800 }),
      mov({ categoria: 'Alquileres', salida: 650 }),
      mov({ cuenta: 'Caja Cuba', categoria: 'Nómina Cuba', moneda: 'CUP', salida: 25000 }),
      mov({ categoria: 'Traspaso entre cajas', salida: 300 }),
      mov({ cuenta: 'Regions', categoria: 'Traspaso entre cajas', entrada: 300 }),
      mov({ categoria: 'Pago de CxP', salida: 400, fecha: '2026-09-03' }),
      mov({ categoria: 'Por clasificar', salida: 99, fecha: '2026-09-04' }),
    ],
    facturas: [
      { id: 'f1', numero: 'INV1', cliente: 'A', emision: '2026-08-10', monto: 1200, cobrado: 800, afectaER: true },
      { id: 'f2', numero: 'INV2', cliente: 'Tropicargo Express', emision: '2026-08-10', monto: 999, cobrado: 0, afectaER: false },
      { id: 'f0', numero: 'INV0', cliente: 'B', emision: '2026-07-20', monto: 5000, cobrado: 0, afectaER: true },
    ],
    facturasCompra: [{ id: 'c1', proveedor: 'SeaSky', numero: '1', fecha: '2026-08-20', monto: 400, categoria: 'Proveedores Logisticos USA-Cuba', pagado: 400 }],
  })
  const { er, efe, es, meses } = informes(ds)

  it('el período empieza en agosto', () => {
    expect(meses[0]).toBe('2026-08')
    expect(meses).toContain('2026-09')
  })

  it('ingresos solo de facturas que afectan el ER y desde el inicio', () => {
    expect(val(er, `res:Ingresos facturados`)).toBeCloseTo(1200)
  })

  it('gastos con signo negativo y costo desde facturas de compra', () => {
    expect(val(er, 'res:Alquileres')).toBeCloseTo(-650)
    expect(val(er, 'res:Nómina Cuba')).toBeCloseTo(-50)
    expect(val(er, 'res:Proveedores Logisticos USA-Cuba')).toBeCloseTo(-400)
    expect(val(er, 'neta')).toBeCloseTo(1200 - 650 - 50 - 400)
  })

  it('el control del ER cuadra', () => {
    for (const v of er.filas.find((f) => f.key === 'f-dif')!.valores) expect(Math.abs(v)).toBeLessThan(0.005)
  })

  it('el balance cuadra todos los meses', () => {
    for (const v of es.cuadre) expect(Math.abs(v)).toBeLessThan(0.005)
  })

  it('el flujo de caja cuadra con los saldos', () => {
    for (const v of efe.filas.find((f) => f.key === 'chk')!.valores) expect(Math.abs(v)).toBeLessThan(0.005)
    // Saldo inicial agosto: 5000 (Truist) + 100 (Caja Cuba 50000 CUP / 500).
    expect(val(efe, 'ini')).toBeCloseTo(5100)
  })

  it('los cobros bajan la CxC y los pagos la CxP', () => {
    expect(val(es, 'cxc')).toBeCloseTo(1200 - 800)
    // Agosto: CxP 400; septiembre: pagada.
    expect(val(es, 'cxp-p', 0)).toBeCloseTo(400)
    expect(es.filas.find((f) => f.key === 'cxp-p')!.valores[1]).toBeCloseTo(0)
  })

  it('los traspasos con sus dos lados no dejan saldo en tránsito', () => {
    expect(es.filas.find((f) => f.key === 'transito')).toBeUndefined()
  })

  it('lo no clasificado queda visible en el balance', () => {
    expect(es.filas.find((f) => f.key === 'por_clasificar')?.valores[1]).toBeCloseTo(99)
  })
})

describe('devengos', () => {
  it('mueve el gasto del mes de pago al mes que corresponde', () => {
    const ds = base({
      movimientos: [
        mov({ cuenta: 'Caja Cuba', categoria: 'Nómina Cuba', salida: 1000, fecha: '2026-09-10' }),
        mov({ cuenta: 'Caja Cuba', categoria: 'Nómina Cuba', salida: 700, fecha: '2026-08-12' }),
      ],
      devengos: [
        { id: 'd1', fechaPago: '2026-09-10', concepto: 'Salario agosto', categoria: 'Nómina Cuba', importe: 1000, mesCorresponde: '2026-08' },
        { id: 'd2', fechaPago: '2026-08-12', concepto: 'Salario julio', categoria: 'Nómina Cuba', importe: 700, mesCorresponde: '2026-07' },
      ],
    })
    const { er, es } = informes(ds)
    // Agosto: paga 700 de julio (sale) y devenga 1000 de agosto.
    expect(val(er, 'res:Nómina Cuba', 0)).toBeCloseTo(-1000)
    // Septiembre: el pago de 1000 ya estaba en agosto.
    expect(val(er, 'res:Nómina Cuba', 1)).toBeCloseTo(0)
    // Agosto: queda por pagar el salario de agosto.
    expect(es.filas.find((f) => f.key === 'devengos-p')?.valores[0]).toBeCloseTo(1000)
    for (const v of es.cuadre) expect(Math.abs(v)).toBeLessThan(0.005)
  })
})

describe('apertura', () => {
  it('la diferencia entre saldos iniciales y capital va al ajuste de apertura', () => {
    const ds = base({ movimientos: [mov({ fecha: '2026-07-28', categoria: 'Saldo inicial', entrada: 1500 })] })
    const { es } = informes(ds)
    expect(val(es, 'capital')).toBeCloseTo(1000)
    expect(val(es, 'apertura')).toBeCloseTo(500)
    for (const v of es.cuadre) expect(Math.abs(v)).toBeLessThan(0.005)
  })

  it('deprecia los activos en línea recta', () => {
    const ds = base({ activos: [{ id: 'a', descripcion: 'Laptop', geografia: 'USA', costo: 1200, vidaUtil: 1 }] })
    const { er, es } = informes(ds)
    expect(val(er, 'res:Depreciación', 0)).toBeCloseTo(-100)
    expect(val(es, 'dep_acumulada', 0)).toBeCloseTo(-100)
  })
})

describe('tasa de elTOQUE', async () => {
  const { leerRespuesta, tasaEmpresa } = await import('@/lib/fx')
  it('lee USD y EUR (ECU) de la respuesta', () => {
    expect(leerRespuesta({ tasas: { USD: 520, ECU: 560, MLC: 300 }, date: '2026-10-13' })).toEqual({ usd: 520, eur: 560 })
  })
  it('falla si no viene el USD', () => {
    expect(() => leerRespuesta({ tasas: { ECU: 560 } })).toThrow()
  })
  it('suma el margen al USD y deriva el EUR por relación de mercado', () => {
    const t = tasaEmpresa({ usd: 520, eur: 572 }, 30)
    expect(t.cupPorUsd).toBe(550)
    expect(t.usdPorEur).toBeCloseTo(1.1)
  })
})

describe('tasas vacías', () => {
  it('ignora una tasa en 0 y usa la anterior válida', () => {
    const t = prepararTasas([
      { id: 'a', fecha: '2026-10-12', cupPorUsd: 815, usdPorEur: 1.08, confirmada: false },
      { id: 'b', fecha: '2026-10-13', cupPorUsd: 0, usdPorEur: 1.08, confirmada: false },
    ])
    expect(movUSD({ moneda: 'CUP', entrada: 815, salida: 0, fecha: '2026-10-20' }, t)).toBeCloseTo(1)
  })
})
