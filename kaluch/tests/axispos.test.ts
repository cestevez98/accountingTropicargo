import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ClienteAxis, mapearOperaciones } from '../lib/axispos'
import { DEFAULT_TIENDAS } from '../lib/catalogo'

// Servidor que imita el SyncApi v2.1: token en minúscula, GZIP sin cabecera y estados con distinta caja.
let base = ''
const pedidos: { ruta: string; cuerpo: unknown; auth?: string }[] = []
const srv = createServer((req, res) => {
  let datos = ''
  req.on('data', (c) => (datos += c))
  req.on('end', () => {
    const ruta = req.url!.replace('/SyncApi/', '')
    const cuerpo = datos ? JSON.parse(datos) : undefined
    pedidos.push({ ruta, cuerpo, auth: req.headers.authorization })
    if (ruta === 'Auth') {
      if ((cuerpo as { Password: string }).Password !== 'ok') return res.writeHead(401).end()
      return res.end(JSON.stringify({ token: 'T1', minVersion: '', minVersionMandatory: false }))
    }
    if (req.headers.authorization !== 'Bearer T1') return res.writeHead(401).end()
    if (ruta === 'CheckConnection') return res.end(JSON.stringify({ status: 'ok', message: 'Connection successfully' }))
    if (ruta === 'ImportExportLocations') return res.end(gzipSync(JSON.stringify({ data: [{ Code: 'KM26', Name: 'Ave 26', DeletedDb: 0 }] })))
    if (ruta === 'ExportOperations')
      return res.end(
        JSON.stringify({
          SyncId: 'x',
          Operations: [
            { Acct: 7, Date: '2026-10-01', OperType: 2, ObjectCode: 'KM26', Items: [{ ItemName: 'OREO', Qtty: 2, Price: 1100, PriceIn: 700, AmountTotal: 2200 }], Payments: [{ PaymentMethod: '1', AmountTotal: 1400 }, { PaymentMethod: '1', AmountTotal: 800, CurrencyName: 'USD', CurrencyRate: 400 }] },
            { Acct: 8, Date: '2026-10-01', OperType: 8, ObjectCode: 'KM26', Items: [] },
          ],
          CashbookSyncs: [{ ObjectCode: 'KM26', Date: '2026-10-01T10:00:00', OperType: 3, AmountTotal: 5000, Note: 'turno' }],
          LastOperationsId: 120,
          LastPaymentId: 80,
          LastCashbookId: 9,
        }),
      )
    if (ruta === 'ImportShifts') return res.end(JSON.stringify({ Status: 'ERROR', Message: 'Location code not found X' }))
    res.writeHead(404).end()
  })
})

beforeAll(async () => {
  await new Promise<void>((r) => srv.listen(0, r))
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
})
afterAll(() => srv.close())

describe('cliente SyncApi', () => {
  it('rechaza credenciales malas con un mensaje claro', async () => {
    await expect(new ClienteAxis(base, 'u', 'mal').comprobar()).rejects.toThrow(/incorrectos/)
  })
  it('reutiliza el token, descomprime GZIP sin cabecera y pide con marcas de agua y opertypes', async () => {
    const c = new ClienteAxis(`${base}/SyncApi/`, 'u', 'ok')
    await c.comprobar()
    expect(await c.ubicaciones()).toEqual([{ Code: 'KM26', Name: 'Ave 26', DeletedDb: 0 }])
    const r = await c.exportarOperaciones('KM26', { marcas: { op: 100, pago: 50, caja: 0 } })
    expect(r.marcas).toEqual({ op: 120, pago: 80, caja: 9 })
    const exp = pedidos.find((p) => p.ruta === 'ExportOperations')!.cuerpo as Record<string, unknown>
    expect(exp).toMatchObject({ objectCode: 'KM26', opertypes: '1,2,3,11,34,39', idOperationFrom: 100, idPaymentFrom: 50, idCashbookFrom: 0 })
    expect(pedidos.filter((p) => p.ruta === 'Auth' && (p.cuerpo as { Password: string }).Password === 'ok')).toHaveLength(1)
  })
  it('un 200 con Status ERROR es un error', async () => {
    const c = new ClienteAxis(base, 'u', 'ok')
    await expect((c as unknown as { pedir: (r: string, i: object) => Promise<unknown> }).pedir('ImportShifts', { method: 'POST', cuerpo: { data: [] } })).rejects.toThrow(/Location code not found/)
  })
})

describe('mapeo de operaciones', () => {
  it('convierte ventas, cobros por moneda y caja; informa lo que no contabiliza', async () => {
    const c = new ClienteAxis(base, 'u', 'ok')
    const r = await c.exportarOperaciones('KM26', {})
    const tiendas = DEFAULT_TIENDAS.map((t) => (t.id === 'km26' ? { ...t, codigoTPV: 'KM26' } : t))
    const m = mapearOperaciones(r.operaciones, r.caja, tiendas, () => 700, { cobros: true })
    expect(m.salidas).toHaveLength(1)
    expect(m.salidas[0]).toMatchObject({ tipo: 'venta', tienda: 'km26', operacion: '7', importe: 2200, moneda: 'CUP', costoUSD: 2 })
    expect(m.movimientos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ libro: 'caja', moneda: 'CUP', monto: 1400, categoria: 'VENTAS', tipo: 'Entrada' }),
        expect.objectContaining({ libro: 'caja', moneda: 'USD', monto: 2, categoria: 'VENTAS' }),
        expect.objectContaining({ libro: 'caja', categoria: 'SALARIO DEPENDIENTE', tipo: 'Salida', monto: 5000 }),
      ]),
    )
    expect([...m.ignorados.keys()]).toEqual(['Traslado (salida)'])
  })
})
