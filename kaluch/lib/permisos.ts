import type { Rol } from './types'

export type Seccion =
  | 'dashboard'
  | 'importar'
  | 'ventas'
  | 'compras'
  | 'caja'
  | 'deudas'
  | 'inventario'
  | 'reportes'
  | 'contabilidad'
  | 'tasas'
  | 'catalogos'
  | 'integraciones'
  | 'alertas'
  | 'conteo'
  | 'arqueo'

const TODO: Seccion[] = ['dashboard', 'importar', 'ventas', 'compras', 'caja', 'deudas', 'inventario', 'reportes', 'contabilidad', 'tasas', 'catalogos', 'integraciones', 'alertas', 'conteo', 'arqueo']

/**
 * Roles de Kaluch Market (abre 24 horas):
 * - Administración económica y comercial: ven todo. La económica registra todo; la comercial, lo de mercancía.
 * - Contador de tienda: su tienda; ajusta inventario, revisa los cuadres diarios y los conteos de los dependientes.
 * - Dependiente: cuenta mercancía y hace el arqueo de su caja; ve sus propios comprobantes.
 */
export const ROLES: Record<Rol, { label: string; color: string; ver: Seccion[]; registrar: Seccion[] }> = {
  propietario: { label: 'Propietario', color: '#0a1f38', ver: TODO, registrar: TODO.filter((s) => s !== 'dashboard' && s !== 'reportes' && s !== 'alertas') },
  admin: { label: 'Administración económica', color: '#1d4ed8', ver: TODO, registrar: TODO.filter((s) => s !== 'dashboard' && s !== 'reportes' && s !== 'alertas') },
  comercial: { label: 'Administración comercial', color: '#d97706', ver: TODO, registrar: ['importar', 'ventas', 'compras', 'inventario', 'catalogos', 'integraciones', 'conteo'] },
  contador_tienda: {
    label: 'Contador de tienda',
    color: '#0d9488',
    ver: ['dashboard', 'importar', 'ventas', 'compras', 'caja', 'inventario', 'alertas', 'conteo', 'arqueo'],
    registrar: ['importar', 'ventas', 'compras', 'caja', 'inventario', 'conteo', 'arqueo'],
  },
  dependiente: { label: 'Dependiente', color: '#0891b2', ver: ['conteo', 'arqueo'], registrar: ['conteo', 'arqueo'] },
  contador_fiscal: { label: 'Contador fiscal', color: '#7c3aed', ver: ['dashboard', 'caja', 'reportes', 'contabilidad', 'tasas'], registrar: [] },
  lectura: {
    label: 'Solo lectura',
    color: '#6b7280',
    ver: ['dashboard', 'ventas', 'compras', 'caja', 'deudas', 'inventario', 'reportes', 'contabilidad', 'tasas', 'alertas'],
    registrar: [],
  },
}

export const ROLES_LISTA = Object.keys(ROLES) as Rol[]

/** Administración (económica o comercial) y propietario: ven todo el grupo. */
export const esAdministracion = (rol: Rol) => rol === 'propietario' || rol === 'admin' || rol === 'comercial'

/** Quien gestiona usuarios, configuración, cierres de mes e importaciones: propietario y administración económica. */
export const esAdminEconomica = (rol: Rol) => rol === 'propietario' || rol === 'admin'

/** Quien ve lo que reportan los conteos (diferencias contra el TPV) y aprueba ajustes. */
export const revisaConteos = (rol: Rol) => esAdministracion(rol) || rol === 'contador_tienda'

/** Quien revisa los arqueos de toda la tienda (el dependiente solo ve los suyos). */
export const revisaArqueos = (rol: Rol) => esAdministracion(rol) || rol === 'contador_tienda'
