import { describe, expect, it } from 'vitest'
import { conciliarCobros } from '../lib/conciliar-cobros'
import type { PagoTP } from '../lib/trackingpremium'

const pago = (id: number, refs: string[], monto: number, fecha = '2026-10-01'): PagoTP => ({ id, numero: `P${id}`, fecha, cliente: 'X', tipo: 'Efectivo', cuentaTP: 'EFECTIVO CUBA USD', monto, refs })
const cobro = (id: string, refs: string[], usd: number, fecha = '2026-10-01') => ({ id, fecha, concepto: refs.join(', '), usd, refs })

describe('conciliarCobros', () => {
  it('compara como un bloque los pagos y cobros que comparten facturas', () => {
    const g = conciliarCobros([pago(1, ['INV1'], 58.78), pago(2, ['INV2'], 192.78)], [cobro('a', ['INV1', 'INV2'], 252)])
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ estado: 'cuadra', totalTP: 251.56, totalCaja: 252 })
  })

  it('separa lo que falta en la caja, lo que sobra y las diferencias', () => {
    const g = conciliarCobros(
      [pago(1, ['INV1'], 10), pago(2, ['MUTIPAYMENT-5'], 40), pago(3, ['INV3'], 7)],
      [cobro('a', ['MUTIPAYMENT-5'], 30), cobro('b', ['INV9'], 12), cobro('c', [], 5)],
    )
    const por = Object.fromEntries(g.map((x) => [x.pagos[0]?.numero ?? x.cobros[0].id, x.estado]))
    expect(por).toEqual({ P1: 'solo_tp', P2: 'difiere', P3: 'solo_tp', b: 'solo_caja', c: 'solo_caja' })
  })
})

describe('emparejarSinNota (links generales de Square)', () => {
  it('reconoce un cobro que paga varias facturas con el recargo de tarjeta', async () => {
    const { emparejarSinNota } = await import('../lib/conciliar-cobros')
    const pagos = [
      { ...pago(1, ['INV10'], 100, '2026-10-01'), cliente: 'Ana Perez', tipo: 'Square' },
      { ...pago(2, ['INV11'], 50, '2026-10-01'), cliente: 'Ana Perez', tipo: 'Square' },
      { ...pago(3, ['INV12'], 80, '2026-10-01'), cliente: 'Luis Gomez', tipo: 'Square' },
    ]
    const r = emparejarSinNota([{ id: 'sq1', fecha: '2026-10-01', importe: 155.25, email: 'anaperez@x.com' }], pagos)
    expect(r.get('sq1')).toEqual(['INV10', 'INV11'])
  })
})
