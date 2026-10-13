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

export const ROLES: Record<Rol, { label: string; color: string; ver: Seccion[]; registrar: Seccion[] }> = {
  propietario: {
    label: 'Propietario',
    color: '#0a1f38',
    ver: ['dashboard', 'importar', 'ventas', 'compras', 'caja', 'deudas', 'inventario', 'reportes', 'contabilidad', 'tasas', 'catalogos', 'integraciones', 'alertas', 'conteo', 'arqueo'],
    registrar: ['importar', 'ventas', 'compras', 'caja', 'deudas', 'inventario', 'contabilidad', 'tasas', 'catalogos', 'integraciones', 'conteo', 'arqueo'],
  },
  admin: {
    label: 'Administrador',
    color: '#1d4ed8',
    ver: ['dashboard', 'importar', 'ventas', 'compras', 'caja', 'deudas', 'inventario', 'reportes', 'contabilidad', 'tasas', 'catalogos', 'integraciones', 'alertas', 'conteo', 'arqueo'],
    registrar: ['importar', 'ventas', 'compras', 'caja', 'deudas', 'inventario', 'contabilidad', 'tasas', 'catalogos', 'integraciones', 'conteo', 'arqueo'],
  },
  comercial: { label: 'Comercial', color: '#d97706', ver: ['dashboard', 'compras', 'inventario', 'reportes', 'alertas'], registrar: ['compras'] },
  contador_tienda: {
    label: 'Contador de tienda',
    color: '#0d9488',
    ver: ['dashboard', 'importar', 'ventas', 'compras', 'caja', 'inventario', 'alertas', 'conteo', 'arqueo'],
    registrar: ['importar', 'ventas', 'compras', 'caja', 'inventario', 'conteo', 'arqueo'],
  },
  dependiente: { label: 'Dependiente (conteo y arqueo)', color: '#0891b2', ver: ['conteo', 'arqueo'], registrar: ['conteo', 'arqueo'] },
  contador_fiscal: { label: 'Contador fiscal', color: '#7c3aed', ver: ['dashboard', 'caja', 'reportes', 'contabilidad', 'tasas'], registrar: [] },
  lectura: {
    label: 'Solo lectura',
    color: '#6b7280',
    ver: ['dashboard', 'ventas', 'compras', 'caja', 'deudas', 'inventario', 'reportes', 'contabilidad', 'tasas', 'alertas'],
    registrar: [],
  },
}

export const ROLES_LISTA = Object.keys(ROLES) as Rol[]
