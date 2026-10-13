import { describe, expect, it } from 'vitest'
import { convertir, detectarFormato, leerArchivo, mapear, marcarDiferencias, marcarDuplicados, parseFecha, parseImporte, sugerirCategoria } from '@/lib/extractos'

const buf = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

describe('importes y fechas', () => {
  it('lee importes con símbolos, paréntesis y coma decimal', () => {
    expect(parseImporte('$1,234.56')).toBe(1234.56)
    expect(parseImporte('-87.6300')).toBe(-87.63)
    expect(parseImporte('(12.00)')).toBe(-12)
    expect(parseImporte('1.234,56')).toBe(1234.56)
    expect(parseImporte('')).toBeNaN()
  })
  it('lee fechas de EE. UU., ISO y deduce el orden cuando no hay duda', () => {
    expect(parseFecha('09/11/2026', 'MDY')).toBe('2026-09-11')
    expect(parseFecha('2026-10-13 09:00:00', 'MDY')).toBe('2026-10-13')
    expect(parseFecha('25/08/2026', 'MDY')).toBe('2026-08-25')
    expect(parseFecha('Aug 5, 2026', 'MDY')).toBe('2026-08-05')
  })
})

const OFX = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>Debit
<DTPOSTED>20260820120000
<TRNAMT>-31123.45
<FITID>6300000001
<NAME>WIRE REF# 20260820-00019432 BUS
</STMTTRN>
<STMTTRN>
<TRNTYPE>Credit
<DTPOSTED>20260821120000
<TRNAMT>9578.00
<FITID>6300000002
<NAME>TROPI Square Inc 171R IVAN SOTO
</STMTTRN>
<STMTTRN>
<TRNTYPE>Debit
<DTPOSTED>20260822120000
<TRNAMT>-49.00
<FITID>6300000003
<NAME>CANVA* 04512 SYDNEY
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1894.59<DTASOF>20261013120000</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

describe('extracto OFX (Truist)', () => {
  const t = leerArchivo('truist.qfx', buf(OFX))
  const f = detectarFormato(t)
  const lineas = convertir(t, mapear(t, f), { fecha: f!.fecha })
  it('detecta el formato, las líneas y el saldo final', () => {
    expect(f?.id).toBe('ofx')
    expect(lineas).toHaveLength(3)
    expect(lineas[0]).toMatchObject({ fecha: '2026-08-20', importe: -31123.45, referencia: '6300000001' })
    expect(t.saldoFinal).toEqual({ importe: 1894.59, fecha: '2026-10-13' })
  })
  it('separa ya registrados, importes distintos y nuevos', () => {
    const existentes = [
      { id: 'a', fecha: '2026-08-20', importe: -31132.45, concepto: 'WIRE REF# 20260820-00019432 BUS ONLINE INTERNATIONAL WIRE' },
      { id: 'b', fecha: '2026-08-21', importe: 9578, concepto: 'TROPI Square Inc' },
    ]
    const usados = new Set<string>()
    const dup = marcarDuplicados(lineas, existentes, usados)
    const dif = marcarDiferencias(lineas, existentes, dup, usados)
    expect([...dup]).toEqual([1])
    expect(dif.get(0)).toMatchObject({ id: 'a', porReferencia: true })
    expect(lineas.filter((l) => !dup.has(l.n) && !dif.has(l.n)).map((l) => l.importe)).toEqual([-49])
  })
  it('dos movimientos iguales el mismo día cuentan como dos', () => {
    const dobles = [lineas[2], { ...lineas[2], n: 9, referencia: undefined }]
    const dup = marcarDuplicados(dobles, [{ id: 'x', fecha: '2026-08-22', importe: -49, concepto: 'CANVA* 04512 SYDNEY' }])
    expect(dup.size).toBe(1)
  })
})

describe('extracto CSV (Regions)', () => {
  const CSV = `"Account","Transaction Date","Posted Date","No.","Description","Debit","Credit","Long Description"
"LIFEGREEN BUSINESS CHECKING * 1547","09/11/2026","09/14/2026","","Amazon","","266.1800","AMAZON MKTPLACE 5942"
"LIFEGREEN BUSINESS CHECKING * 1547","08/17/2026","09/14/2026","","PayPal","-87.6300","","PAYPAL *SHEINUS 5621"`
  it('usa débito/crédito y la fecha de contabilización', () => {
    const t = leerArchivo('regions.csv', buf(CSV))
    const f = detectarFormato(t)
    const ls = convertir(t, mapear(t, f), { fecha: f?.fecha ?? 'MDY' })
    expect(f?.id).toBe('regions')
    expect(ls.map((l) => [l.fecha, l.importe])).toEqual([
      ['2026-09-14', 266.18],
      ['2026-09-14', -87.63],
    ])
    expect(ls[1].extra.Detalle).toContain('SHEINUS')
  })
})

describe('categoría sugerida', () => {
  it('las reglas mandan sobre lo aprendido', () => {
    const l = { concepto: 'GOOGLE *ADS8602090464', importe: -52.75, extra: {} }
    expect(sugerirCategoria(l, 'Truist', [{ id: '1', contiene: 'google', categoria: 'Comunicación y Marketing' }], { 'Truist|-|google ads': 'Otros gastos' })?.categoria).toBe('Comunicación y Marketing')
    expect(sugerirCategoria({ ...l, concepto: 'AMAZON MKTPL*5N3R67VT0' }, 'Truist', [], { '*|-|amazon mktpl': 'Compras Asistidas' })?.categoria).toBe('Compras Asistidas')
  })
})

describe('extracto tarjeta corporativa BofA (Kiara ·6512)', () => {
  const CSV = `Description,,,,Summary Amt.
Total credits,,,,"-44.31"
Total debits,,,,"6312.96"

CardHolder Name,Account/Card Number - last 4 digits,Posting Date,Trans. Date,Reference ID,Description,Amount,MCC,Merchant Category,Transaction Type,Expense Category
KIARA I SOLINO,6512,10/12/2026,10/10/2026,Ref: 82711096283000538673645,"idrama","3.99",5815,"DIGITAL GOODS",D,Amusement
KIARA I SOLINO,6512,10/07/2026,10/06/2026,Ref: 55432866279209905617350,"AMAZON MKTPLACE PMTS","-44.31",5942,"BOOK STORES",C,Retail Stores`
  it('salta el resumen, invierte el signo y limpia la referencia', () => {
    const t = leerArchivo('amex.csv', buf(CSV))
    const f = detectarFormato(t)
    const ls = convertir(t, mapear(t, f), { fecha: f!.fecha, invertir: f!.invertir })
    expect(f?.id).toBe('tarjeta-corporativa')
    expect(ls.map((l) => [l.fecha, l.importe, l.referencia])).toEqual([
      ['2026-10-12', -3.99, '82711096283000538673645'],
      ['2026-10-07', 44.31, '55432866279209905617350'],
    ])
    expect(String(ls[0].extra.MCC)).toBe('5815')
  })
})
