import 'server-only'
import { gunzipSync, gzipSync } from 'node:zlib'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * Almacenamiento de colecciones JSON.
 *
 * - En Vercel se usa Vercel Blob (privado). Cada versión de una colección se guarda como un blob
 *   inmutable `db/<colección>/<versión>.json.gz`, y un manifiesto `db/manifest.json` apunta a la
 *   versión vigente. Las escrituras actualizan el manifiesto con `ifMatch` (control optimista), así que
 *   dos usuarios que guardan a la vez no se pisan: el segundo reintenta sobre la versión nueva.
 * - En local (sin BLOB_READ_WRITE_TOKEN) se guarda en la carpeta .data/.
 */

export interface Manifest {
  version: number
  colecciones: Record<string, { v: number; path: string; n?: number; hist?: string[] }>
}

interface Backend {
  leerManifest(): Promise<{ manifest: Manifest; etag: string | null }>
  escribirManifest(m: Manifest, etag: string | null): Promise<boolean>
  leerBlob(p: string): Promise<Buffer | null>
  escribirBlob(p: string, data: Buffer): Promise<void>
  borrarBlobs(paths: string[]): Promise<void>
}

const VACIO: Manifest = { version: 0, colecciones: {} }

class FileBackend implements Backend {
  constructor(private dir: string) {}
  private ruta(p: string) {
    return path.join(this.dir, p)
  }
  async leerManifest() {
    try {
      const txt = await fs.readFile(this.ruta('db/manifest.json'), 'utf8')
      const manifest = JSON.parse(txt) as Manifest
      return { manifest, etag: String(manifest.version) }
    } catch {
      return { manifest: VACIO, etag: null }
    }
  }
  async escribirManifest(m: Manifest, etag: string | null) {
    const actual = await this.leerManifest()
    if (actual.etag !== etag) return false
    await fs.mkdir(path.dirname(this.ruta('db/manifest.json')), { recursive: true })
    await fs.writeFile(this.ruta('db/manifest.json'), JSON.stringify(m))
    return true
  }
  async leerBlob(p: string) {
    try {
      return await fs.readFile(this.ruta(p))
    } catch {
      return null
    }
  }
  async escribirBlob(p: string, data: Buffer) {
    await fs.mkdir(path.dirname(this.ruta(p)), { recursive: true })
    await fs.writeFile(this.ruta(p), data)
  }
  async borrarBlobs(paths: string[]) {
    await Promise.all(paths.map((p) => fs.rm(this.ruta(p), { force: true })))
  }
}

class BlobBackend implements Backend {
  private blob = import('@vercel/blob')
  async leerManifest() {
    const { get } = await this.blob
    const r = await get('db/manifest.json', { access: 'private', useCache: false })
    if (!r || !r.stream) return { manifest: VACIO, etag: null }
    const txt = await new Response(r.stream).text()
    return { manifest: JSON.parse(txt) as Manifest, etag: r.blob.etag }
  }
  async escribirManifest(m: Manifest, etag: string | null) {
    const { put, BlobPreconditionFailedError } = await this.blob
    try {
      await put('db/manifest.json', JSON.stringify(m), {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
        ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
      })
      return true
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) return false
      if (e instanceof Error && /already exists|precondition/i.test(e.message)) return false
      throw e
    }
  }
  async leerBlob(p: string) {
    const { get } = await this.blob
    // Las versiones son inmutables: se puede usar la caché.
    const r = await get(p, { access: 'private' })
    if (!r || !r.stream) return null
    return Buffer.from(await new Response(r.stream).arrayBuffer())
  }
  async escribirBlob(p: string, data: Buffer) {
    const { put } = await this.blob
    await put(p, data, { access: 'private', contentType: 'application/gzip', addRandomSuffix: false, allowOverwrite: true })
  }
  async borrarBlobs(paths: string[]) {
    if (!paths.length) return
    const { del } = await this.blob
    await del(paths)
  }
}

const backend: Backend = process.env.BLOB_READ_WRITE_TOKEN ? new BlobBackend() : new FileBackend(path.join(process.cwd(), '.data'))

// Caché en memoria por instancia: colección → versión y datos.
const cache = new Map<string, { v: number; data: unknown }>()
let manifestCache: { manifest: Manifest; etag: string | null; t: number } | null = null

async function manifest(fresco = false) {
  if (!fresco && manifestCache && Date.now() - manifestCache.t < 1500) return manifestCache
  const r = await backend.leerManifest()
  manifestCache = { ...r, t: Date.now() }
  return manifestCache
}

async function cargar<T>(m: Manifest, nombre: string, defecto: T): Promise<T> {
  const ent = m.colecciones[nombre]
  if (!ent) return defecto
  const c = cache.get(nombre)
  if (c && c.v === ent.v) return c.data as T
  let buf = await backend.leerBlob(ent.path)
  if (!buf) {
    // El manifiesto en caché pudo quedar viejo: se relee y se reintenta una vez.
    const fresco = (await manifest(true)).manifest.colecciones[nombre]
    if (fresco && fresco.path !== ent.path) return cargar({ ...m, colecciones: { ...m.colecciones, [nombre]: fresco } }, nombre, defecto)
    if (!buf) throw new Error(`No se pudo leer la colección «${nombre}».`)
  }
  const data = JSON.parse(gunzipSync(buf).toString('utf8')) as T
  cache.set(nombre, { v: ent.v, data })
  return data
}

export async function leer<T>(nombre: string, defecto: T): Promise<T> {
  const { manifest: m } = await manifest()
  return cargar(m, nombre, defecto)
}

export async function leerVarias<T extends Record<string, unknown>>(defectos: T): Promise<T> {
  const { manifest: m } = await manifest()
  const entries = await Promise.all(Object.entries(defectos).map(async ([k, d]) => [k, await cargar(m, k, d)] as const))
  return Object.fromEntries(entries) as T
}

export async function versionDatos(): Promise<number> {
  return (await manifest()).manifest.version
}

/**
 * Aplica cambios a una o varias colecciones de forma atómica respecto al manifiesto.
 * `fn` recibe los datos actuales y devuelve los nuevos valores de las colecciones que cambian.
 * Si otro usuario guardó en medio, se reintenta con los datos frescos.
 */
export async function mutar<T extends Record<string, unknown>>(defectos: T, fn: (actual: T) => Partial<T> | Promise<Partial<T>>): Promise<Partial<T>> {
  for (let intento = 0; intento < 6; intento++) {
    const { manifest: m, etag } = await manifest(true)
    const actual = Object.fromEntries(await Promise.all(Object.entries(defectos).map(async ([k, d]) => [k, await cargar(m, k, d)] as const))) as T
    const cambios = await fn(actual)
    const nuevo: Manifest = { version: m.version + 1, colecciones: { ...m.colecciones } }
    const viejos: string[] = []
    for (const [k, data] of Object.entries(cambios)) {
      const p = `db/${k}/${nuevo.version}-${Math.random().toString(36).slice(2, 8)}.json.gz`
      await backend.escribirBlob(p, gzipSync(Buffer.from(JSON.stringify(data))))
      const anterior = m.colecciones[k]
      // Se conservan las 5 versiones anteriores de cada colección como respaldo.
      const hist = anterior ? [anterior.path, ...(anterior.hist ?? [])] : []
      viejos.push(...hist.slice(5))
      nuevo.colecciones[k] = { v: nuevo.version, path: p, n: Array.isArray(data) ? data.length : undefined, hist: hist.slice(0, 5) }
      cache.set(k, { v: nuevo.version, data })
    }
    if (await backend.escribirManifest(nuevo, etag)) {
      manifestCache = null
      await backend.borrarBlobs(viejos).catch(() => {})
      return cambios
    }
    await backend.borrarBlobs(Object.keys(cambios).map((k) => nuevo.colecciones[k].path)).catch(() => {})
    await new Promise((r) => setTimeout(r, 150 * (intento + 1)))
  }
  throw new Error('No se pudo guardar: hay demasiadas escrituras simultáneas. Inténtalo de nuevo.')
}

export const almacenamiento = process.env.BLOB_READ_WRITE_TOKEN ? 'Vercel Blob' : 'carpeta local .data'
