'use client'

import { useState } from 'react'
import { FormAccion } from '@/components/FormAccion'
import { accionCompra } from '../../acciones'

export function FormCompra({ tiendas, tiendaDefecto, tasaToque, tasaTienda, hoy, pagos, proveedoresTPV = [], tpv = false }: { tiendas: { id: string; nombre: string }[]; tiendaDefecto: string; tasaToque?: number; tasaTienda?: number; hoy: string; pagos: [string, string][]; proveedoresTPV?: { code: string; nombre: string }[]; tpv?: boolean }) {
  const [modo, setModo] = useState<'USD' | 'CUP'>('USD')
  const [clase, setClase] = useState<'toque' | 'tienda'>('toque')
  const [importe, setImporte] = useState('')
  const [distribuida, setDistribuida] = useState(false)
  const [tienda, setTienda] = useState(tiendaDefecto)
  const alCentral = distribuida || tienda === 'almacen'
  const [cantidad, setCantidad] = useState('')
  const [reparto, setReparto] = useState<Record<string, string>>({})
  const tasa = clase === 'tienda' ? tasaTienda : tasaToque
  const n = Number(importe.replace(',', '.'))
  const asignado = Object.values(reparto).reduce((a, v) => a + (Number(v.replace(',', '.')) || 0), 0)
  const total = Number(cantidad.replace(',', '.')) || 0
  return (
    <FormAccion accion={accionCompra} className="mt-3">
      <input type="hidden" name="modo" value={modo} />
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={modo === 'USD'} onChange={() => setModo('USD')} /> Introducir en USD / EUR / MLC
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={modo === 'CUP'} onChange={() => setModo('CUP')} /> Introducir en CUP al cambio del día
        </label>
        {modo === 'CUP' && (
          <select name="claseTasa" value={clase} onChange={(e) => setClase(e.target.value as 'toque' | 'tienda')} className="input w-auto">
            <option value="toque">Tasa Toque: {tasaToque ?? '—'}</option>
            <option value="tienda">Tasa compra tienda: {tasaTienda ?? '—'}</option>
          </select>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <label>
          <span className="etiqueta">Fecha</span>
          <input name="fecha" type="date" defaultValue={hoy} className="input" required />
        </label>
        {!distribuida && (
          <label>
            <span className="etiqueta">Tienda</span>
            <select name="tienda" value={tienda} onChange={(e) => setTienda(e.target.value)} className="input">
              {tiendas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="sm:col-span-2">
          <span className="etiqueta">Mercancía</span>
          <input name="producto" list="productos" className="input" />
        </label>
        {proveedoresTPV.length ? (
          <label>
            <span className="etiqueta">Proveedor (AxisPOS)</span>
            <select name="codigoProveedor" className="input" defaultValue="">
              <option value="">— elegir —</option>
              {proveedoresTPV.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            <span className="etiqueta">Proveedor</span>
            <input name="proveedor" className="input" />
          </label>
        )}
        <label>
          <span className="etiqueta">Factura</span>
          <input name="factura" className="input" />
        </label>
        <label>
          <span className="etiqueta">Cantidad</span>
          <input name="cantidad" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="input" />
        </label>
        {modo === 'USD' && (
          <label>
            <span className="etiqueta">Moneda</span>
            <select name="moneda" className="input">
              <option>USD</option>
              <option>EUR</option>
              <option>MLC</option>
            </select>
          </label>
        )}
        <label>
          <span className="etiqueta">Importe total ({modo === 'CUP' ? 'CUP' : 'moneda'})</span>
          <input name="importe" inputMode="decimal" value={importe} onChange={(e) => setImporte(e.target.value)} className="input" required />
          {modo === 'CUP' && tasa && n > 0 && <span className="mt-1 block text-xs text-accent">≈ {(n / tasa).toLocaleString('es-ES', { maximumFractionDigits: 2 })} USD</span>}
        </label>
        <label>
          <span className="etiqueta">Categoría de pago</span>
          <select name="pago" className="input">
            {pagos.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm" title="Solo las compras y ventas marcadas Fiscal alimentan el módulo Fiscal.">
          <input type="checkbox" name="fiscal" /> Fiscal
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" name="distribuida" checked={distribuida} onChange={(e) => setDistribuida(e.target.checked)} /> Distribuir a mercados
        </label>
        {tpv && alCentral && (
          <label className="flex items-end gap-2 pb-2 text-sm" title="Sube la compra al ALMACEN CENTRAL de AxisPOS y los traslados a cada mercado.">
            <input type="checkbox" name="enviarAxis" defaultChecked /> Subir a AxisPOS
          </label>
        )}
      </div>
      {distribuida && (
        <div className="mt-3 rounded-lg border border-border p-3">
          <p className="mb-2 text-xs text-muted-foreground">La compra entra entera al Almacén Central y de ahí sale un traslado a cada mercado con las unidades que indiques (al costo de la factura). Lo que no repartas se queda en el central.</p>
          <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {tiendas
              .filter((t) => t.id !== 'almacen')
              .map((t) => (
              <label key={t.id}>
                <span className="etiqueta">{t.nombre}</span>
                <input name={`q_${t.id}`} inputMode="decimal" className="input" value={reparto[t.id] ?? ''} onChange={(e) => setReparto({ ...reparto, [t.id]: e.target.value })} />
              </label>
              ))}
          </div>
          <p className={`mt-2 text-sm font-medium ${total && asignado - total > 0.0001 ? 'text-danger' : 'text-accent'}`}>
            A mercados {asignado} {total ? `de ${total} · quedan ${total - asignado} en el central` : ''}
          </p>
        </div>
      )}
    </FormAccion>
  )
}
