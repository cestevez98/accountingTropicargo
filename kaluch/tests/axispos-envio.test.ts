import { describe, expect, it } from 'vitest'
import { areaAlmacen, monedasConTasa, operacionCompra, operacionTraslado } from '../lib/axispos-envio'
import { DEFAULT_TIENDAS } from '../lib/catalogo'
import { prepararTasas } from '../lib/fx'
import type { Compra, Salida } from '../lib/types'

const tabla = prepararTasas([{ fecha: '2026-10-01', cupUsd: 700, cupEur: 800 }], 15)
const productos = new Map([['HUEVOS', { codigo: '330', nombre: 'HUEVOS', precioCUP: 170 }]])
const ctx = { areaCentral: '23', usuario: '2', productos, tabla }

describe('envío a AxisPOS', () => {
  it('manda la tasa de la tienda (Toque + 15) y conserva los demás campos', () => {
    const r = monedasConTasa([{ Name: 'CUP', ExchangeRate: 1 }, { Name: 'USD', ExchangeRate: 770, ExchangeRateOut: 1, Symbol: '$' }, { Name: 'EUR', ExchangeRate: 870 }], tabla, '2026-10-13')
    expect(r.data).toEqual([
      { Name: 'USD', ExchangeRate: 715, ExchangeRateOut: 1, Symbol: '$' },
      { Name: 'EUR', ExchangeRate: 815 },
    ])
    expect(r.cambios[0]).toEqual({ moneda: 'USD', antes: 770, despues: 715 })
  })

  it('compra del Almacén Central en CUP, con su nota KA y el pago al contado', () => {
    const c: Compra = { id: 'c1', fecha: '2026-10-02', tienda: 'almacen', producto: 'HUEVOS', cantidad: 720, moneda: 'USD', importe: 133.41, importeUSD: 133.41, pago: 'contado', fiscal: false, origen: 'manual', codigoProveedor: '21', factura: 'F-1' }
    const o = operacionCompra(c, 900001, ctx)
    expect(o).toMatchObject({ Acct: 900001, OperType: 1, ObjectCode: '23', PartnerCode: '21', UserCode: '2', Note: 'KA:c1', InvoiceNumber: 'F-1' })
    expect(o.Items![0]).toMatchObject({ ItemCode: '330', Qtty: 720, Price: 170 })
    expect(o.Items![0].PriceIn).toBeCloseTo((133.41 * 700) / 720, 2)
    expect(o.Payments![0]).toMatchObject({ PaymentMethod: '1', AmountTotal: 93387, CurrencyName: 'CUP' })
  })

  it('exige códigos de AxisPOS', () => {
    const c = { id: 'c2', fecha: '2026-10-02', tienda: 'almacen', producto: 'NUEVO', cantidad: 1, moneda: 'USD', importe: 1, importeUSD: 1, pago: 'credito', fiscal: false, origen: 'manual', codigoProveedor: '21' } as Compra
    expect(() => operacionCompra(c, 1, ctx)).toThrow(/código de AxisPOS/)
    expect(() => operacionCompra({ ...c, producto: 'HUEVOS', codigoProveedor: undefined }, 1, ctx)).toThrow(/proveedor/)
  })

  it('traslado del central al almacén del mercado', () => {
    const s: Salida = { id: 's1', tipo: 'traslado', fecha: '2026-10-02', tienda: 'almacen', producto: 'HUEVOS', cantidad: 100, costoUSD: 18.53, destino: 'km26', origen: 'manual' }
    const o = operacionTraslado(s, 900002, '2', ctx)
    expect(o).toMatchObject({ OperType: 8, ObjectCode: '23', TransferObjectCode: '2', Note: 'KA:s1' })
    expect(o.Items![0]).toMatchObject({ ItemCode: '330', Qtty: 100 })
  })

  it('elige el área de almacén de la tienda', () => {
    const t = { ...DEFAULT_TIENDAS.find((x) => x.id === 'km26')!, codigoTPV: '2,10,12' }
    expect(areaAlmacen(t, [{ code: '12', nombre: 'PISO DE VENTA 26', tipo: 7 }, { code: '2', nombre: 'ALMACEN 26', tipo: 3 }])).toBe('2')
  })
})

import { inventarioDerivado } from '../lib/inventario'

describe('inventario de la Tienda Web', () => {
  it('descuenta del Almacén Central o del local de recogida', () => {
    const ds = {
      tiendas: DEFAULT_TIENDAS,
      productos: [],
      compras: [
        { id: 'c1', fecha: '2026-10-01', tienda: 'almacen', producto: 'ARROZ', cantidad: 10, moneda: 'USD' as const, importe: 10, importeUSD: 10, pago: 'contado' as const, fiscal: false, origen: 'manual' as const },
        { id: 'c2', fecha: '2026-10-01', tienda: 'km26', producto: 'ARROZ', cantidad: 5, moneda: 'USD' as const, importe: 5, importeUSD: 5, pago: 'contado' as const, fiscal: false, origen: 'manual' as const },
      ],
      salidas: [
        { id: 's1', tipo: 'venta' as const, fecha: '2026-10-02', tienda: 'web', producto: 'ARROZ', cantidad: 3, origen: 'manual' as const },
        { id: 's2', tipo: 'venta' as const, fecha: '2026-10-02', tienda: 'web', destino: 'km26', producto: 'ARROZ', cantidad: 2, origen: 'manual' as const },
      ],
    }
    const inv = inventarioDerivado(ds)
    expect(inv.find((f) => f.tienda === 'almacen')?.existencia).toBe(7)
    expect(inv.find((f) => f.tienda === 'km26')?.existencia).toBe(3)
    expect(inv.some((f) => f.tienda === 'web')).toBe(false)
  })
})

import { ClienteAxis } from '../lib/axispos'

describe('modo solo lectura', () => {
  it('no deja escribir en AxisPOS sin AXISPOS_ESCRITURA=1', async () => {
    delete process.env.AXISPOS_ESCRITURA
    const c = new ClienteAxis('https://ejemplo.invalid', 'u', 'p')
    await expect(c.guardarMonedas([{ Name: 'USD', ExchangeRate: 1 }])).rejects.toThrow(/solo lectura/)
    await expect(c.importarOperaciones([])).rejects.toThrow(/solo lectura/)
    await expect(c.guardarUbicaciones([])).rejects.toThrow(/solo lectura/)
  })
})
