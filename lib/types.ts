export type Moneda = 'USD' | 'CUP' | 'EUR'

export const GRUPOS_ER = [
  'INGRESOS',
  'COSTO DE VENTAS',
  'GASTOS OPERATIVOS',
  'GASTOS FINANCIEROS',
  'IMPUESTOS',
  'NO AFECTA ER',
] as const
export type GrupoER = (typeof GRUPOS_ER)[number]

export const GRUPOS_FLUJO = ['Explotación', 'Inversión', 'Financiación', 'Interno'] as const
export type GrupoFlujo = (typeof GRUPOS_FLUJO)[number]

/** Cuentas de balance que actúan como contrapartida de los movimientos que no afectan el ER. */
export const CUENTAS_BALANCE = [
  'cxc',
  'cxc_manual',
  'cxp',
  'interco_kaluch',
  'interco_nextplus',
  'fondos_terceros',
  'anticipos',
  'socios',
  'activo_fijo',
  'dep_acumulada',
  'depositos',
  'inventario',
  'devengos',
  'impuestos_por_pagar',
  'transito',
  'por_clasificar',
  'capital',
  'apertura',
  'resultados_anteriores',
] as const
export type CuentaBalance = (typeof CUENTAS_BALANCE)[number]

export type Contrapartida = 'resultado' | CuentaBalance

export interface Categoria {
  id: string
  nombre: string
  grupoER: GrupoER
  grupoFlujo: GrupoFlujo
  contrapartida: Contrapartida
  orden: number
  activa: boolean
  nota?: string
}

export type TipoCuenta = 'caja' | 'banco' | 'tarjeta' | 'pasarela'

export interface Cuenta {
  id: string
  nombre: string
  tipo: TipoCuenta
  geografia: 'USA' | 'CUBA'
  orden: number
  activa: boolean
}

export interface Tasa {
  id: string
  fecha: string
  cupPorUsd: number
  usdPorEur: number
  confirmada: boolean
  /** 'eltoque' si la trajo la actualización automática; vacío si se cargó a mano. */
  fuente?: string
  /** Tasa del mercado informal publicada por elTOQUE (CUP por USD), antes del margen. */
  mercadoUsd?: number
  /** Tasa de elTOQUE para el EUR (CUP por EUR). */
  mercadoEur?: number
}

export interface Movimiento {
  id: string
  fecha: string
  cuenta: string
  categoria: string
  concepto: string
  referencia?: string
  moneda: Moneda
  entrada: number
  salida: number
  /** Tasa propia del movimiento (CUP por USD o USD por EUR). Si falta se usa la tabla de tasas. */
  tasa?: number
  observaciones?: string
  /** Línea duplicada de otra ya registrada: no va al ER (contrapartida = partidas en tránsito). */
  excluirER?: boolean
  extra?: Record<string, string | number | null>
}

export interface FacturaVenta {
  id: string
  numero: string
  cliente: string
  emision: string
  vencimiento?: string
  monto: number
  cobrado: number
  servicio?: string
  tipoEnvio?: string
  subtipo?: string
  detalle?: string
  estatusSistema?: string
  afectaER: boolean
  notas?: string
}

export interface FacturaCompra {
  id: string
  proveedor: string
  numero: string
  fecha: string
  vencimiento?: string
  descripcion?: string
  monto: number
  categoria: string
  pagado: number
}

export interface PagoProveedor {
  id: string
  fecha: string
  proveedor: string
  numero?: string
  monto: number
  cuenta?: string
  observaciones?: string
}

export interface CxcManual {
  id: string
  numero: string
  cliente: string
  descripcion?: string
  fecha: string
  vencimiento?: string
  facturado: number
  cobrado: number
}

export interface Activo {
  id: string
  descripcion: string
  categoria?: string
  geografia: 'USA' | 'CUBA'
  fechaAlta?: string
  costo?: number
  vidaUtil?: number
  depAcumApertura?: number
  notas?: string
}

export interface Paquete {
  id: string
  kgt: string
  cliente?: string
  descripcion?: string
  llegada?: string
  valorDeclarado?: number
  fechaAbandono?: string
  precioVenta?: number
  fechaVenta?: string
  estado: 'Disponible' | 'Vendido'
  comprador?: string
}

export interface Devengo {
  id: string
  fechaPago: string
  origen?: string
  concepto: string
  categoria: string
  importe: number
  /** Mes al que corresponde el gasto, formato YYYY-MM. */
  mesCorresponde: string
  notas?: string
}

export interface Asiento {
  id: string
  fecha: string
  concepto: string
  /** Clave de cuenta del mayor: `tes:<cuenta>`, `res:<categoría>` o una CuentaBalance. */
  cargo: string
  abono: string
  importe: number
  notas?: string
}

export type Rol = 'admin' | 'contador' | 'cajero' | 'lectura'

export interface Usuario {
  id: string
  email: string
  nombre: string
  rol: Rol
  hash: string
  activo: boolean
  /** Solo para cajeros: cuentas en las que puede registrar. */
  cuentas?: string[]
}

export interface Settings {
  empresa: string
  /** Primer día de la contabilidad en el sistema. Todo lo anterior entra como saldo de apertura. */
  fechaInicio: string
  capitalApertura: number
  /** Saldo de CxC de clientes del sistema de facturación al cierre anterior a fechaInicio. */
  cxcSistemaApertura: number
  mesesCerrados: string[]
  /** CUP que se suman a la tasa de elTOQUE para obtener la tasa de la empresa. */
  margenCupUsd: number
  /** Última actualización automática de la tasa (ISO) y su resultado. */
  ultimaTasaAuto?: { ts: string; ok: boolean; detalle: string }
}

export interface AuditEntry {
  id: string
  ts: string
  usuario: string
  accion: 'crear' | 'editar' | 'borrar' | 'importar' | 'cerrar' | 'abrir'
  coleccion: string
  registroId?: string
  detalle?: string
}

export interface Dataset {
  settings: Settings
  categorias: Categoria[]
  cuentas: Cuenta[]
  tasas: Tasa[]
  movimientos: Movimiento[]
  facturas: FacturaVenta[]
  facturasCompra: FacturaCompra[]
  pagosProveedor: PagoProveedor[]
  cxcManual: CxcManual[]
  activos: Activo[]
  paquetes: Paquete[]
  devengos: Devengo[]
  asientos: Asiento[]
}

export type DataCollection = Exclude<keyof Dataset, 'settings'>
