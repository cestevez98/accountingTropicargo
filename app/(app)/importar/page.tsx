import { Encabezado } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { cargarDataset } from '@/lib/data'
import { Importador, Vaciar } from './Importador'

export default async function ImportarPage() {
  await requerirUsuario(['admin'])
  const ds = await cargarDataset()
  const conteo = { movimientos: ds.movimientos.length, facturas: ds.facturas.length, facturasCompra: ds.facturasCompra.length }
  return (
    <>
      <Encabezado
        titulo="Importar y vaciar datos"
        descripcion="Carga el libro TROPICARGO_Contabilidad_Integrada.xlsx. El archivo se lee en tu navegador; solo se envían los datos ya convertidos. La importación REEMPLAZA los datos actuales."
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <section className="tarjeta p-5 xl:col-span-2">
          <h2 className="mb-1 font-semibold text-slate-900">Importar desde el Excel</h2>
          <p className="mb-4 text-sm text-slate-500">
            Datos actuales: {conteo.movimientos.toLocaleString('es-ES')} movimientos, {conteo.facturas.toLocaleString('es-ES')} facturas de venta,{' '}
            {conteo.facturasCompra} facturas de proveedores.
          </p>
          <Importador />
        </section>
        <section className="tarjeta border-red-200 p-5">
          <h2 className="mb-1 font-semibold text-red-700">Vaciar datos de prueba</h2>
          <p className="mb-4 text-sm text-slate-600">
            Borra movimientos, facturas, devengos, asientos, activos, paquetes y tasas para empezar a registrar desde cero. Se conservan el catálogo de categorías,
            las cuentas, los usuarios y los saldos de apertura. El sistema guarda las 5 versiones anteriores de cada tabla como respaldo.
          </p>
          <Vaciar />
        </section>
      </div>
    </>
  )
}
