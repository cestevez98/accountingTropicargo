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
    expect(g.get('km26')).toBe('2')
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

import { indiceEscaner, resultadoConteo, sumarLectura, totalArqueo, catalogoEscaner } from '../lib/conteo'

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

describe('arqueo', () => {
  it('suma billetes y sueltos por moneda', () => {
    expect(
      totalArqueo(
        [
          { moneda: 'CUP', valor: 1000, cantidad: 3 },
          { moneda: 'CUP', valor: 20, cantidad: 2 },
          { moneda: 'USD', valor: 20, cantidad: 1 },
        ],
        { CUP: 2.5 },
      ),
    ).toEqual({ CUP: 3042.5, USD: 20 })
  })
})
