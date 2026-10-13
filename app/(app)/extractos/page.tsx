import { Encabezado } from '@/components/ui'
import { requerirUsuario } from '@/lib/auth'
import { cargarDataset } from '@/lib/data'
import { opcionesFormulario } from '@/lib/opciones'
import { paypalConfigurado } from '@/lib/paypal'
import { squareConfigurado } from '@/lib/square'
import { ImportadorExtractos } from './Importador'

export const maxDuration = 60

export default async function ExtractosPage() {
  const s = await requerirUsuario(['admin', 'contador'])
  const ds = await cargarDataset()
  const cuentas = ds.cuentas.filter((c) => c.activa && c.tipo !== 'caja').sort((a, b) => a.orden - b.orden).map((c) => c.nombre)
  return (
    <>
      <Encabezado
        titulo="Importar extracto bancario"
        descripcion="Sube el archivo que descargas de la banca online. El sistema reconoce el formato, descarta lo que ya está registrado, detecta importes que no coinciden con el banco y propone la categoría de cada movimiento nuevo. Nada se guarda hasta que confirmas."
      />
      <ImportadorExtractos cuentas={cuentas} categorias={opcionesFormulario(ds, s).categorias} paypalApi={paypalConfigurado()} squareApi={squareConfigurado()} />
    </>
  )
}
