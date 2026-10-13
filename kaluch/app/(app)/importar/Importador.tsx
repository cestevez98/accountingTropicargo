'use client'

import { upload } from '@vercel/blob/client'
import { useState } from 'react'
import { accionImportar, accionPrevisualizar, type Previa, type Resultado } from '../../acciones'

type Tipo = { clave: string; titulo: string; descripcion: string; plantilla: boolean }

const fmt = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 2 })

export function Importador({ tipos, tiendas, tiendaFija, blob }: { tipos: Tipo[]; tiendas: { id: string; nombre: string }[]; tiendaFija?: string; blob: boolean }) {
  const [tipo, setTipo] = useState('km')
  const [tienda, setTienda] = useState(tiendaFija ?? 'km26')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [subido, setSubido] = useState<string | null>(null)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [estado, setEstado] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [hecho, setHecho] = useState<string>('')
  const [ocupado, setOcupado] = useState(false)

  const paso = hecho ? 4 : previa ? 3 : archivo ? 2 : 1

  async function formulario(extra: Record<string, string> = {}) {
    const f = new FormData()
    f.set('tipo', tipo)
    f.set('tienda', tienda)
    let ruta = subido
    // Vercel limita el cuerpo de las peticiones a 4,5 MB: los archivos grandes van antes a Blob.
    if (archivo && archivo.size > 3.5 * 1024 * 1024 && blob && !ruta) {
      setEstado('Subiendo el archivo…')
      const r = await upload(`importaciones/${archivo.name.replace(/[^\w.-]+/g, '_')}`, archivo, { access: 'private', handleUploadUrl: '/api/subir', multipart: archivo.size > 8 * 1024 * 1024 })
      ruta = r.pathname
      setSubido(ruta)
    }
    if (ruta) {
      f.set('blob', ruta)
      f.set('nombre', archivo?.name ?? '')
    } else if (archivo) f.set('archivo', archivo)
    for (const [k, v] of Object.entries(extra)) f.set(k, v)
    return f
  }

  async function validar() {
    if (!archivo) return
    setOcupado(true)
    setError('')
    try {
      const f = await formulario()
      setEstado('Leyendo y validando el archivo…')
      const r = (await accionPrevisualizar(null, f)) as Previa | Resultado
      if ('resumen' in r) setPrevia(r)
      else if (!r.ok) setError(r.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(false)
      setEstado('')
    }
  }

  async function importar(modo: 'validas' | 'todas') {
    setOcupado(true)
    setError('')
    try {
      const f = await formulario({ modo })
      setEstado('Guardando…')
      const r = await accionImportar(null, f)
      if (r.ok) {
        setHecho(r.mensaje ?? 'Importado.')
        setSubido(null)
      } else setError(r.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(false)
      setEstado('')
    }
  }

  function reiniciar() {
    setArchivo(null)
    setSubido(null)
    setPrevia(null)
    setHecho('')
    setError('')
  }

  const pasos = ['Tipo de reporte', 'Subir archivo', 'Validación', 'Listo']
  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-xs font-semibold">
        {pasos.map((p, i) => (
          <li key={p} className={`rounded-full px-3 py-1 ${paso === i + 1 ? 'bg-primary text-white' : paso > i + 1 ? 'bg-accent-soft text-accent' : 'bg-muted text-muted-foreground'}`}>
            {i + 1}. {p}
          </li>
        ))}
      </ol>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tipos.map((t) => (
          <button
            key={t.clave}
            type="button"
            disabled={ocupado || Boolean(previa)}
            onClick={() => setTipo(t.clave)}
            className={`tarjeta p-4 text-left transition ${tipo === t.clave ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/40'}`}
          >
            <div className="font-semibold">{t.titulo}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t.descripcion}</p>
            {t.plantilla && (
              <a href={`/api/plantilla?tipo=${t.clave}`} onClick={(e) => e.stopPropagation()} className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">
                ⬇ Descargar plantilla .xlsx
              </a>
            )}
          </button>
        ))}
      </div>

      <div className="tarjeta p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
          <label
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border p-6 text-center hover:border-primary/50"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (f) {
                setArchivo(f)
                setSubido(null)
                setPrevia(null)
                setHecho('')
              }
            }}
          >
            <span className="text-sm font-medium">{archivo ? archivo.name : 'Arrastra aquí el .xlsx / .csv o haz clic para elegirlo'}</span>
            {archivo && <span className="mt-1 text-xs text-muted-foreground">{(archivo.size / 1024 / 1024).toFixed(1)} MB</span>}
            <input
              type="file"
              accept=".xlsx,.xls,.xlsm,.csv"
              className="hidden"
              onChange={(e) => {
                setArchivo(e.target.files?.[0] ?? null)
                setSubido(null)
                setPrevia(null)
                setHecho('')
              }}
            />
          </label>
          <div className="space-y-2">
            <label className="block">
              <span className="etiqueta">Tienda (si el archivo no la indica)</span>
              <select className="input" value={tienda} disabled={Boolean(tiendaFija) || Boolean(previa)} onChange={(e) => setTienda(e.target.value)}>
                {tiendas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </label>
            {!previa && (
              <button className="btn btn-primario w-full" disabled={!archivo || ocupado} onClick={validar}>
                {ocupado ? 'Validando…' : 'Validar archivo'}
              </button>
            )}
            {previa && !hecho && (
              <button className="btn w-full" disabled={ocupado} onClick={reiniciar}>
                Descartar
              </button>
            )}
          </div>
        </div>
        {estado && <p className="mt-3 text-sm text-muted-foreground">{estado}</p>}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>

      {previa && !hecho && (
        <div className="space-y-3">
          <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${previa.resumen.errores ? 'border-warning/30 bg-warning-soft text-warning' : 'border-accent/30 bg-accent-soft text-accent'}`}>
            {[
              previa.resumen.movimientos && `${fmt(previa.resumen.movimientos)} movimientos`,
              previa.resumen.salidas && `${fmt(previa.resumen.salidas)} líneas de venta/salida`,
              previa.resumen.compras && `${fmt(previa.resumen.compras)} compras`,
              previa.resumen.tasas && `${fmt(previa.resumen.tasas)} tasas`,
              previa.resumen.productos && `${fmt(previa.resumen.productos)} productos`,
              previa.resumen.deudas && `${previa.resumen.deudas} deudas`,
            ]
              .filter(Boolean)
              .join(' · ')}
            {' · '}
            {previa.resumen.errores} con errores · {previa.resumen.avisos} avisos · Total CUP {fmt(previa.resumen.totalCUP)} · Total USD {fmt(previa.resumen.totalUSD)}
          </div>
          {previa.notas.map((n) => (
            <p key={n} className="rounded-lg bg-info-soft px-4 py-2 text-sm text-info">
              {n}
            </p>
          ))}
          {previa.problemas.length > 0 && (
            <details className="tarjeta p-3" open={previa.resumen.errores > 0}>
              <summary className="cursor-pointer text-sm font-semibold">Errores y avisos ({previa.problemas.length})</summary>
              <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-sm">
                {previa.problemas.map((p, k) => (
                  <li key={k} className={p.nivel === 'error' ? 'text-danger' : 'text-warning'}>
                    {p.hoja && `${p.hoja} · `}fila {p.fila}: {p.mensaje}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="tarjeta max-h-96 overflow-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Fecha</th>
                  <th>Descripción</th>
                  <th className="num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {previa.muestra.map((m, k) => (
                  <tr key={k} className={m.error ? 'bg-danger-soft' : ''} title={m.error}>
                    <td className="text-xs text-muted-foreground">{m.fila || ''}</td>
                    <td className="whitespace-nowrap">{m.fecha}</td>
                    <td>
                      {m.descripcion}
                      {m.error && <div className="text-xs text-danger">{m.error}</div>}
                    </td>
                    <td className="num">{m.importe}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-exito" disabled={ocupado || previa.resumen.errores > 0} onClick={() => importar('todas')}>
              Confirmar e importar
            </button>
            {previa.resumen.errores > 0 && (
              <button className="btn btn-primario" disabled={ocupado} onClick={() => importar('validas')}>
                Importar solo filas válidas
              </button>
            )}
            <button className="btn" disabled={ocupado} onClick={reiniciar}>
              Corregir y volver a subir
            </button>
          </div>
        </div>
      )}

      {hecho && (
        <div className="rounded-xl border border-accent/30 bg-accent-soft p-4 text-sm text-accent">
          <p className="font-semibold">✓ {hecho}</p>
          <button className="btn mt-3" onClick={reiniciar}>
            Importar otro archivo
          </button>
        </div>
      )}
    </div>
  )
}
