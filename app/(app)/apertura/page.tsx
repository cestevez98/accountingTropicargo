import { Encabezado, Importe } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { nombreCuentaMayor } from '@/lib/catalog'
import { cargarContabilidad } from '@/lib/data'
import { diaAnterior, mesesEntre, ym } from '@/lib/fecha'
import { etiquetaMes } from '@/lib/reports'
import { BotonCierre, FormApertura } from './FormApertura'

export default async function AperturaPage() {
  const s = await requerirUsuario(['admin', 'contador', 'lectura'])
  const { ds, mayor } = await cargarContabilidad()
  const corte = diaAnterior(ds.settings.fechaInicio)
  // Saldos de apertura: todo lo registrado hasta el día anterior al inicio + saldos iniciales cargados después.
  const saldos = new Map<string, number>()
  for (const l of mayor.lineas) {
    const esApertura = l.fecha <= corte || l.categoria === 'Saldo inicial' || l.fuente === 'ape'
    if (!esApertura) continue
    saldos.set(l.cuenta, (saldos.get(l.cuenta) ?? 0) + l.importe)
  }
  const filas = [...saldos.entries()].filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => a[0].localeCompare(b[0]))
  const meses = mesesEntre(ym(ds.settings.fechaInicio), mayor.ultimoMes)
  const admin = s.rol === 'admin'
  return (
    <>
      <Encabezado
        titulo="Apertura y cierres"
        descripcion="La contabilidad del sistema empieza en la fecha de inicio. Todo lo anterior entra como saldo de apertura; los resultados anteriores van al patrimonio."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="tarjeta p-5">
          <h2 className="mb-3 font-semibold text-slate-900">Datos de apertura</h2>
          <FormApertura settings={ds.settings} editable={admin} />
        </section>
        <section className="tarjeta p-5">
          <h2 className="mb-1 font-semibold text-slate-900">Saldos de apertura (al {corte})</h2>
          <p className="mb-3 text-sm text-slate-500">
            Salen de los «Saldo inicial» de cada caja y banco, la CxC de apertura, las facturas de proveedor anteriores al inicio, los activos y los asientos de
            apertura. Positivo = saldo deudor (activo); negativo = acreedor (pasivo o patrimonio).
          </p>
          <table className="tabla">
            <tbody>
              {filas.map(([k, v]) => (
                <tr key={k}>
                  <td>{nombreCuentaMayor(k)}</td>
                  <td className="num">
                    <Importe v={v} colorear />
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td>Suma (debe ser 0)</td>
                <td className="num">
                  <Importe v={filas.reduce((a, [, v]) => a + v, 0)} />
                </td>
              </tr>
            </tbody>
          </table>
        </section>
        <section className="tarjeta p-5 xl:col-span-2">
          <h2 className="mb-1 font-semibold text-slate-900">Cierre de meses</h2>
          <p className="mb-3 text-sm text-slate-500">Un mes cerrado queda bloqueado: solo el administrador puede crear, cambiar o borrar registros con fecha de ese mes.</p>
          <div className="flex flex-wrap gap-2">
            {meses.map((m) => (
              <BotonCierre key={m} mes={m} etiqueta={etiquetaMes(m)} cerrado={ds.settings.mesesCerrados.includes(m)} editable={admin} />
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
