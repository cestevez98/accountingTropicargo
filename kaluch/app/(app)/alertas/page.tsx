import Link from 'next/link'
import { Chip, Encabezado, Vacio } from '@/components/ui'
import { calcularAlertas } from '@/lib/alertas'
import { requerirUsuario } from '@/lib/auth'
import { cargarContabilidad } from '@/lib/data'
import { tiendaActiva } from '@/lib/pagina'

export default async function Alertas() {
  const s = await requerirUsuario('alertas')
  const { tienda } = await tiendaActiva(s)
  const { ds, mayor } = await cargarContabilidad()
  const alertas = calcularAlertas(ds, mayor, tienda)
  return (
    <>
      <Encabezado titulo="Alertas" descripcion={`Reglas activas: inventario negativo, ventas bajo costo, margen por producto por debajo del ${(ds.settings.margenMinimo * 100).toFixed(0)} %, tiendas sin reporte, tasa del día, movimientos sin clasificar y partidas sin cuadrar. Los umbrales se cambian en Catálogos → Configuración.`} />
      {!alertas.length ? (
        <Vacio>Sin alertas. Todo en orden.</Vacio>
      ) : (
        <div className="space-y-2">
          {alertas.map((a, i) => (
            <div key={i} className="tarjeta flex items-start gap-3 p-4">
              <Chip tono={a.severidad === 'alta' ? 'rojo' : a.severidad === 'media' ? 'ambar' : 'verde'}>{a.severidad === 'alta' ? 'Alta' : a.severidad === 'media' ? 'Intermedia' : 'Baja'}</Chip>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{a.titulo}</div>
                {a.detalle && <p className="mt-0.5 text-sm text-muted-foreground">{a.detalle}</p>}
              </div>
              {a.href && (
                <Link href={a.href} className="btn text-xs">
                  Revisar
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
