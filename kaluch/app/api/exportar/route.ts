import * as XLSX from 'xlsx'
import { puedeVer, sesionActual, tiendaFija } from '@/lib/auth'
import { cargarContabilidad, preferencias } from '@/lib/data'
import { aniosDisponibles, capital, estadoResultados, estadoSituacion, etiquetaCuenta, flujoEfectivo, mesesDelAnio, type Informe } from '@/lib/informes'
import { PAGO_LABEL } from '@/lib/types'

const r2 = (n: number | undefined) => (n == null || !Number.isFinite(n) ? '' : Math.round(n * 100) / 100)

function hojaInforme(inf: Informe) {
  const filas: (string | number)[][] = [['Concepto', ...inf.columnas, ...(inf.conTotal ? ['Total'] : [])]]
  for (const f of inf.filas) {
    if (f.tipo === 'titulo') filas.push([f.label])
    else filas.push([f.label, ...f.valores.map(r2), ...(inf.conTotal ? [r2(f.total)] : [])])
  }
  const ws = XLSX.utils.aoa_to_sheet(filas)
  ws['!cols'] = [{ wch: 50 }, ...inf.columnas.map(() => ({ wch: 14 })), { wch: 14 }]
  return ws
}

export async function GET(req: Request) {
  const s = await sesionActual()
  if (!s) return new Response('No autorizado', { status: 401 })
  const sp = Object.fromEntries(new URL(req.url).searchParams)
  const pref = await preferencias()
  const tienda = tiendaFija(s) ?? pref.tienda
  const { ds, mayor, idx } = await cargarContabilidad()
  const nombreT = new Map(ds.tiendas.map((t) => [t.id, t.nombre]))
  const wb = XLSX.utils.book_new()
  let nombre = 'kaluch'
  const dentro = (x: { fecha: string; tienda: string }) => (!tienda || x.tienda === tienda) && (!sp.desde || x.fecha >= sp.desde) && (!sp.hasta || x.fecha <= sp.hasta)

  if (sp.informe) {
    if (!puedeVer(s, 'reportes')) return new Response('No autorizado', { status: 403 })
    const anios = aniosDisponibles(mayor)
    const anio = anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios.at(-1)!
    const meses = mesesDelAnio(mayor, anio)
    const o = { tienda, vista: pref.vista }
    const todos: Record<string, () => Informe> = {
      er: () => estadoResultados(ds, idx, meses, o),
      es: () => estadoSituacion(idx, meses, o),
      efe: () => flujoEfectivo(ds, mayor, meses, o),
      capital: () => capital(ds, idx, meses, o),
    }
    const lista = sp.informe === 'todos' ? Object.keys(todos) : [sp.informe].filter((k) => todos[k])
    for (const k of lista) {
      const inf = todos[k]()
      XLSX.utils.book_append_sheet(wb, hojaInforme(inf), inf.titulo.slice(0, 31))
    }
    nombre = `${lista.join('-')}-${anio}${tienda ? `-${tienda}` : ''}-${pref.vista}`
  } else if (sp.tabla === 'caja' || sp.tabla === 'banco') {
    if (!puedeVer(s, 'caja')) return new Response('No autorizado', { status: 403 })
    const filas = ds.movimientos
      .filter((m) => m.libro === sp.tabla && dentro(m) && (!sp.cat || m.categoria === sp.cat) && (!sp.moneda || m.moneda === sp.moneda) && (!sp.cuenta || m.cuenta === sp.cuenta))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .map((m) => ({ Fecha: m.fecha, Mercado: nombreT.get(m.tienda) ?? m.tienda, Cajero: m.cajero ?? '', Cuenta: m.cuenta ?? '', Comprobante: m.comprobante ?? '', Categoría: m.categoria, Concepto: m.concepto ?? '', Observaciones: m.observaciones ?? '', Tipo: m.tipo, Moneda: m.moneda, Monto: m.monto, 'Mov en USD': r2(mayor.usdMov.get(m.id)) }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), sp.tabla === 'caja' ? 'Efectivo en Caja' : 'Efectivo en Banco')
    nombre = sp.tabla
  } else if (sp.tabla === 'ventas') {
    if (!puedeVer(s, 'ventas')) return new Response('No autorizado', { status: 403 })
    const filas = ds.salidas
      .filter((x) => dentro(x) && (!sp.tipo || x.tipo === sp.tipo) && (!sp.q || x.producto?.toUpperCase().includes(sp.q.toUpperCase())))
      .map((x) => ({ Mercado: nombreT.get(x.tienda) ?? x.tienda, 'No. de Operación': x.operacion ?? '', Operación: x.tipo.toUpperCase(), Fecha: x.fecha, Mercancía: x.producto ?? x.nota ?? '', Cantidad: x.cantidad ?? '', Importe: x.importe ?? '', Moneda: x.moneda ?? '', 'Ingreso Tasa tienda (USD)': r2(x.ventaUSD), 'Ingreso Financiero (USD)': r2(x.ingresoTasaUSD), 'Costo (USD)': r2(x.costoUSD), Origen: x.origen }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Ventas')
    nombre = 'ventas'
  } else if (sp.tabla === 'compras') {
    if (!puedeVer(s, 'compras')) return new Response('No autorizado', { status: 403 })
    const filas = ds.compras
      .filter((c) => dentro(c))
      .map((c) => ({ Mercado: nombreT.get(c.tienda) ?? c.tienda, Fecha: c.fecha, Mercancía: c.producto ?? c.nota ?? '', 'Nombre de socio': c.proveedor ?? '', Factura: c.factura ?? '', Cantidad: c.cantidad ?? '', Moneda: c.moneda, Importe: c.importe, 'Importe USD': r2(c.importeUSD), Categoría: PAGO_LABEL[c.pago] ?? c.pago, Fiscal: c.fiscal ? 'Sí' : 'No' }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Compras')
    nombre = 'compras'
  } else if (sp.tabla === 'submayor') {
    if (!puedeVer(s, 'contabilidad')) return new Response('No autorizado', { status: 403 })
    const sel = (sp.cuenta ?? '').split(',').filter(Boolean)
    let saldo = 0
    const filas = mayor.lineas
      .filter((l) => sel.includes(l.cuenta) && dentro(l))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .map((l) => {
        saldo += l.usd
        return { Fecha: l.fecha, Entidad: nombreT.get(l.tienda) ?? l.tienda, Cuenta: etiquetaCuenta(l.cuenta), Descripción: l.concepto, Contrapartida: etiquetaCuenta(l.contra), Debe: l.usd > 0 ? r2(l.usd) : '', Haber: l.usd < 0 ? r2(-l.usd) : '', Saldo: r2(saldo) }
      })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Submayor')
    nombre = 'submayor'
  } else return new Response('Exportación no válida', { status: 400 })

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nombre}.xlsx"`,
    },
  })
}
