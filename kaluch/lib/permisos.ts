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

export const ROLES: Record<Rol, { label: string; color: string; ver: Seccion[]; registrar: Seccion[] }> = {
  propietario: {
    label: 'Propietario',
    color: '#0a1f38',
    ver: ['dashboard', 'importar', 'ventas', 'compras', 'caja', 'deudas', 'inventario', 'reportes', 'contabilidad', 'tasas', 'catalogos', 'integraciones', 'alertas'],
    registrar: ['importar', 'ventas', 'compras', 'caja', 'deudas', 'inventario', 'contabilidad', 'tasas', 'catalogos', 'integraciones'],
  },
  admin: {
    label: 'Administrador',
    color: '#1d4ed8',
    ver: ['dashboard', 'importar', 'ventas', 'compras', 'caja', 'deudas', 'inventario', 'reportes', 'contabilidad', 'tasas', 'catalogos', 'integraciones', 'alertas'],
    registrar: ['importar', 'ventas', 'compras', 'caja', 'deudas', 'inventario', 'contabilidad', 'tasas', 'catalogos', 'integraciones'],
  },
  comercial: { label: 'Comercial', color: '#d97706', ver: ['dashboard', 'compras', 'inventario', 'reportes', 'alertas'], registrar: ['compras'] },
  contador_tienda: {
    label: 'Contador de tienda',
    color: '#0d9488',
    ver: ['dashboard', 'importar', 'ventas', 'compras', 'caja', 'inventario', 'alertas'],
    registrar: ['importar', 'ventas', 'compras', 'caja', 'inventario'],
  },
  contador_fiscal: { label: 'Contador fiscal', color: '#7c3aed', ver: ['dashboard', 'caja', 'reportes', 'contabilidad', 'tasas'], registrar: [] },
  lectura: {
    label: 'Solo lectura',
    color: '#6b7280',
    ver: ['dashboard', 'ventas', 'compras', 'caja', 'deudas', 'inventario', 'reportes', 'contabilidad', 'tasas', 'alertas'],
    registrar: [],
  },
}

export const ROLES_LISTA = Object.keys(ROLES) as Rol[]
