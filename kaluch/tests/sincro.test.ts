import { describe, expect, it } from 'vitest'
import { DEFAULT_TIENDAS } from '../lib/catalogo'
import { compararCatalogo, cuadreCaja, cuadreExistencias, gruposPorTienda, itemParaTPV, movimientosEntrega, precioEnTienda, precioWeb, productoDesdeItem, type ItemTPV } from '../lib/sincro'
import type { Movimiento, Producto } from '../lib/types'

const item = (o: Partial<ItemTPV>): ItemTPV => ({ Code: '100', Name: 'ARROZ', Category: '|PASTAS', Unit: 'kg', Currency: 'CUP', Price: 500, Price1: 0, Price2: 520, Price3: 0, Cost: 300, ...o })

describe('catálogo maestro', () => {
  it('carga un artículo del TPV con sus precios por grupo', () => {
    const p = productoDesdeItem(item({}))
    expect(p).toMatchObject({ codigo: '100', nombre: 'ARROZ', grupo: 'PASTAS', precioCUP: 500, precios: { '2': 520 }, costoCUP: 300 })
    expect(precioEnTienda(p, '2')).toBe(520)
    expect(precioEnTienda(p, '3')).toBe(500)
  })

  it('compara: altas, cambios campo a campo y lo que solo está en el TPV', () => {
    const productos: Producto[] = [
      { ...productoDesdeItem(item({})), precioCUP: 550, precios: { '2': 520, '4': 600 } },
      { codigo: 'PAN', nombre: 'PAN' },
    ]
    const { altas, cambios, soloTPV } = compararCatalogo(productos, [item({}), item({ Code: '200', Name: 'FRIJOL' })])
    expect(altas.map((p) => p.nombre)).toEqual(['PAN'])
    expect(cambios.map((c) => `${c.campo}:${c.kaluch}/${c.tpv}`)).toEqual(['Precio base:550/500', 'Precio grupo 4:600/undefined'])
    expect(soloTPV.map((i) => i.Name)).toEqual(['FRIJOL'])
  })

  it('el registro de ensayo conserva lo del TPV y pisa lo que manda Kaluch', () => {
    const r = itemParaTPV({ codigo: '100', nombre: 'ARROZ', grupo: 'PASTAS', precioCUP: 550, precios: { '4': 600 } }, item({ Barcode: '123' }))
    expect(r).toMatchObject({ Code: '100', Barcode: '123', Category: '|PASTAS', Price: 550, Price2: 520, Price4: 600 })
  })

  it('precio web = costo del central + margen', () => {
    expect(precioWeb({ codigo: '1', nombre: 'X', costoCUP: 300 }, 0.25, 780)).toBe(375)
    expect(precioWeb({ codigo: '1', nombre: 'X', costoUSD: 1 }, 0.25, 780)).toBe(975)
    expect(precioWeb({ codigo: '1', nombre: 'X', costoCUP: 300 }, undefined, 780)).toBeUndefined()
  })

  it('grupo de precios de cada tienda sale de su piso de venta', () => {
    const tiendas = DEFAULT_TIENDAS.map((t) => (t.id === 'km26' ? { ...t, codigoTPV: '2,10,12' } : t))
    const g = gruposPorTienda(tiendas, [
      { code: '2', nombre: 'ALMACEN 26', tipo: 3, precioGrupo: 2 },
      { code: '10', nombre: 'Caja', tipo: 1, precioGrupo: 1 },
      { code: '12', nombre: 'PISO 26', tipo: 7, precioGrupo: 2 },
    ])
    // PriceGroup 2 = «grupo 1» = Price1; el 1 es el minorista (precio base).
    expect(g.get('km26')).toBe('1')
    expect(gruposPorTienda(tiendas, [{ code: '12', nombre: 'PISO 26', tipo: 7, precioGrupo: 1 }]).has('km26')).toBe(false)
  })
})

describe('cuadre de existencias', () => {
  it('suma las áreas de la tienda y casa por código', () => {
    const tiendas = DEFAULT_TIENDAS.map((t) => (t.id === 'km26' ? { ...t, codigoTPV: '2,12' } : t.id === 'almacen' ? { ...t, codigoTPV: '1' } : t))
    const { filas, resumen } = cuadreExistencias(
      [
        { producto: 'ARROZ', tienda: 'km26', entradas: 10, ventas: 2, ajustes: 0, existencia: 8, costo: 0.5 },
        { producto: 'ARROZ', tienda: 'almacen', entradas: 5, ventas: 0, ajustes: 0, existencia: 5 },
      ],
      [
        { objectCode: '2', ItemsAvailability: [{ Code: '100', Amount: 6 }] },
        { objectCode: '12', ItemsAvailability: [{ Code: '100', Amount: 1 }] },
        { objectCode: '1', ItemsAvailability: [{ Code: '100', Amount: 5 }] },
      ],
      [{ codigo: '100', nombre: 'ARROZ' }],
      tiendas,
    )
    expect(filas.find((f) => f.tienda === 'km26')).toMatchObject({ codigo: '100', kaluch: 8, tpv: 7, diferencia: 1, valorUSD: 0.5 })
    expect(resumen.find((r) => r.tienda === 'almacen')).toMatchObject({ coinciden: 1, distintos: 0 })
  })
})

describe('cuadre de caja', () => {
  it('cobrado − gastos − entregado = saldo, y la entrega entra en la caja central', () => {
    const mov = (o: Partial<Movimiento>): Movimiento => ({ id: Math.random().toString(), libro: 'caja', fecha: '2026-10-02', tienda: 'km26', categoria: 'VENTAS', tipo: 'Entrada', moneda: 'CUP', monto: 0, ...o })
    const ent = movimientosEntrega({ id: 'abc12345-x', fecha: '2026-10-02', tienda: 'km26', nombreTienda: 'KM 26', matriz: 'matriz', moneda: 'CUP', monto: 7000 })
    const ms = [
      mov({ fecha: '2026-10-01', monto: 1000 }),
      mov({ monto: 10000 }),
      mov({ categoria: 'TRANSPORTE', tipo: 'Salida', monto: 500 }),
      ...ent,
    ]
    const c = cuadreCaja(ms, 'km26', '2026-10-02', '2026-10-02')
    expect(c.saldoInicial).toEqual({ CUP: 1000 })
    expect(c.dias).toEqual([{ fecha: '2026-10-02', moneda: 'CUP', cobrado: 10000, gastos: 500, otrasEntradas: 0, entregado: 7000, saldo: 3500 }])
    expect(cuadreCaja(ms, 'matriz', '2026-10-01', '2026-10-31').saldoFinal).toEqual({ CUP: 7000 })
    expect(ent[0].comprobante).toBe(ent[1].comprobante)
  })
})

import { indiceEscaner, resultadoConteo, sumarLectura, catalogoEscaner } from '../lib/conteo'

describe('conteo a ciegas', () => {
  it('reconoce código interno y códigos de barras, y acumula lecturas', () => {
    const idx = indiceEscaner(catalogoEscaner([{ codigo: '100', nombre: 'ARROZ', barras: ['7501', '7502'] }, { codigo: 'PAN', nombre: 'PAN' }]))
    expect(idx.get('7502')).toEqual({ codigo: '100', nombre: 'ARROZ' })
    expect(idx.get('100')?.nombre).toBe('ARROZ')
    expect(idx.has('PAN')).toBe(false)
    let ls = sumarLectura([], { codigo: '100', nombre: 'ARROZ', cantidad: 1 })
    ls = sumarLectura(ls, { codigo: '200', nombre: 'FRIJOL', cantidad: 24 })
    ls = sumarLectura(ls, { codigo: '100', nombre: 'ARROZ', cantidad: 1 })
    expect(ls).toEqual([
      { codigo: '100', nombre: 'ARROZ', cantidad: 2 },
      { codigo: '200', nombre: 'FRIJOL', cantidad: 24 },
    ])
  })

  it('compara solo lo contado contra las áreas de la tienda', () => {
    const r = resultadoConteo(
      [{ codigo: '100', nombre: 'ARROZ', cantidad: 8 }],
      [
        { objectCode: '2', ItemsAvailability: [{ Code: '100', Amount: 6 }, { Code: '200', Amount: 3 }] },
        { objectCode: '12', ItemsAvailability: [{ Code: '100', Amount: 3 }] },
        { objectCode: '15', ItemsAvailability: [{ Code: '100', Amount: 50 }] },
      ],
      ['2', '12'],
      [{ codigo: '100', nombre: 'ARROZ', costoUSD: 0.5 }],
    )
    expect(r).toEqual([{ codigo: '100', nombre: 'ARROZ', contado: 8, sistema: 9, diferencia: -1, costoUSD: 0.5 }])
  })
})


import { calcularCuadre, horaCuba, resumenTurno, salarioSugerido } from '../lib/turno'

describe('cuadre de cambio de turno', () => {
  it('reproduce la hoja del 11/10 (César): esperado 148.250 y contado 153.065', () => {
    const c = calcularCuadre({
      ventaTienda: 160560,
      domicilio: 0,
      plataforma: 0,
      gastos: [{ concepto: 'Seguridad', importe: 2500 }],
      salario: salarioSugerido(160560, 0.03),
      transferencias: [{ cuenta: 'FISCAL', importe: 5000 }],
      porCobrar: 0,
      billetes: [
        { valor: 5000, cantidad: 4 },
        { valor: 2000, cantidad: 3 },
        { valor: 1000, cantidad: 40 },
        { valor: 500, cantidad: 35 },
        { valor: 200, cantidad: 171 },
        { valor: 100, cantidad: 39 },
        { valor: 50, cantidad: 153 },
        { valor: 20, cantidad: 2 },
      ],
      sueltosCUP: 0,
      usd: 5,
      tasaUSD: 755,
      eur: 0,
      tasaEUR: 0,
      otros: 20000,
    })
    expect(salarioSugerido(160560, 0.03)).toBe(4810)
    expect(c).toMatchObject({ subtotal: 160560, esperado: 148250, billetesCUP: 129290, usdCUP: 3775, contado: 153065, diferencia: 4815 })
  })

  it('suma solo los tickets de la caja dentro del turno, por moneda y por cajero', () => {
    const ops = [
      { OperType: 2, Date: '2026-10-11', DateIssued: '2026-10-11T07:59:59', UserCode: '5', Payments: [{ PaymentMethod: '1', AmountTotal: 999 }] },
      { OperType: 2, Date: '2026-10-11', DateIssued: '2026-10-11T08:30:00', UserCode: '5', Payments: [{ PaymentMethod: '1', AmountTotal: 1000, CurrencyName: 'CUP', CurrencyRate: 1 }] },
      { OperType: 2, Date: '2026-10-11', DateIssued: '2026-10-11T09:00:00', UserCode: '6', Payments: [{ PaymentMethod: '1', AmountTotal: 7700, CurrencyName: 'USD', CurrencyRate: 770 }, { PaymentMethod: '2', PaymentTypeName: 'Tarjeta', AmountTotal: 500 }] },
      { OperType: 34, Date: '2026-10-11', DateIssued: '2026-10-11T10:00:00', UserCode: '5', Payments: [{ PaymentMethod: '1', AmountTotal: 200 }] },
      { OperType: 3, Date: '2026-10-11', DateIssued: '2026-10-11T10:00:00', Payments: [] },
    ]
    const r = resumenTurno(ops, '2026-10-11T08:00:00', '2026-10-11T20:00:00', new Map([['5', 'YARA'], ['6', 'CESAR']]))
    expect(r).toMatchObject({ tickets: 3, venta: 9000, efectivo: 8500, noEfectivo: { Tarjeta: 500 }, efectivoPorMoneda: { CUP: 800, USD: 10 }, tasas: { USD: 770 }, porCajero: { YARA: 800, CESAR: 8200 } })
  })

  it('hora de Cuba', () => {
    expect(horaCuba(new Date('2026-10-13T04:30:00Z'))).toBe('2026-10-13T00:30:00')
  })
})

import { operacionAjuste } from '../lib/axispos-envio'

describe('ajuste de conteo', () => {
  it('una línea por diferencia, con signo y costo en CUP', () => {
    const op = operacionAjuste(
      { id: 'c1', numero: 1, tienda: 'km26', fecha: '2026-10-13', usuario: 'x', estado: 'cerrado', inicio: '2026-10-13T05:00:00Z', cierre: '2026-10-13T06:00:00Z', lineas: [], resultado: [
        { codigo: '100', nombre: 'ARROZ', contado: 8, sistema: 9, diferencia: -1, costoUSD: 0.5 },
        { codigo: '200', nombre: 'FRIJOL', contado: 5, sistema: 5, diferencia: 0 },
        { codigo: '300', nombre: 'PAN', contado: 3, sistema: 1, diferencia: 2 },
      ] },
      900001, '12', '2', [{ codigo: '300', nombre: 'PAN', costoCUP: 50, precioCUP: 80 }], 780,
    )
    expect(op).toMatchObject({ OperType: 4, ObjectCode: '12', Note: 'KA:c1', Acct: 900001 })
    expect(op.Items).toEqual([
      { ItemCode: '100', ItemName: 'ARROZ', Qtty: -1, Discount: 0, Price: 390, PriceIn: 390, AmountTotal: -390 },
      { ItemCode: '300', ItemName: 'PAN', Qtty: 2, Discount: 0, Price: 80, PriceIn: 50, AmountTotal: 100 },
    ])
  })
})

import { propuestasCasar } from '../lib/casar'

describe('casar productos del Excel con el TPV', () => {
  it('seguro solo si coincide salvo tildes, signos u orden; el resto se sugiere', () => {
    const productos = [
      { codigo: '1', nombre: 'LAVAVAJILLAS PASTA TOTAL CARE 200G' },
      { codigo: '2', nombre: 'GEL DE BAÑO ORCHID SIMPLY' },
      { codigo: '3', nombre: 'ACONDICIONADOR VOLUMEN SIMPLY BODYCARE' },
      { codigo: 'LAVAVAJILLAS PASTA 200G TOTAL CARE', nombre: 'LAVAVAJILLAS PASTA 200G TOTAL CARE' },
      { codigo: 'GEL DE BANO ORCHID', nombre: 'GEL DE BANO ORCHID' },
      { codigo: 'CHAMPU VOLUMEN SIMPLY BODYCARE', nombre: 'CHAMPU VOLUMEN SIMPLY BODYCARE' },
    ]
    const r = propuestasCasar(productos, new Map([['CHAMPU VOLUMEN SIMPLY BODYCARE', 9]]))
    const de = (n: string) => r.find((x) => x.nombre === n)!
    expect(de('LAVAVAJILLAS PASTA 200G TOTAL CARE')).toMatchObject({ seguro: true, candidatos: [{ codigo: '1' }] })
    expect(de('GEL DE BANO ORCHID').seguro).toBe(false)
    expect(de('GEL DE BANO ORCHID').candidatos[0].codigo).toBe('2')
    expect(de('CHAMPU VOLUMEN SIMPLY BODYCARE')).toMatchObject({ seguro: false, uso: 9 })
    expect(r[0].seguro).toBe(true)
  })
})
