import type { Categoria, Contrapartida, Cuenta, CuentaBalance, GrupoER, GrupoFlujo, Settings } from './types'

export const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

/** Categoría especial: ingresos que vienen de la hoja de facturación. */
export const CAT_INGRESOS_FACTURADOS = 'Ingresos facturados'
export const CAT_DEPRECIACION = 'Depreciación'
export const CAT_VENTAS_FUERA = 'Ventas fuera del sistema'
export const CAT_SALDO_INICIAL = 'Saldo inicial'
export const CAT_POR_CLASIFICAR = 'Por clasificar'

type Def = [string, GrupoER, GrupoFlujo, Contrapartida, string?]

const DEFS: Def[] = [
  [CAT_INGRESOS_FACTURADOS, 'INGRESOS', 'Explotación', 'resultado', 'Se calcula desde Facturación (Afecta ER = Sí)'],
  ['Otros ingresos', 'INGRESOS', 'Explotación', 'resultado', 'Pasajes, remesas, carros y otros ingresos no facturados'],
  [CAT_VENTAS_FUERA, 'INGRESOS', 'Explotación', 'resultado', 'Contrapartida de las CxC fuera del sistema'],

  ['Proveedores Logisticos USA-Cuba', 'COSTO DE VENTAS', 'Explotación', 'resultado'],
  ['Proveedor Delivery', 'COSTO DE VENTAS', 'Explotación', 'resultado'],
  ['Compras Asistidas', 'COSTO DE VENTAS', 'Explotación', 'resultado'],
  ['Servicio Turistico', 'COSTO DE VENTAS', 'Explotación', 'resultado'],
  ['Mensajería Cuba', 'COSTO DE VENTAS', 'Explotación', 'resultado'],

  ['Alquileres', 'GASTOS OPERATIVOS', 'Explotación', 'resultado'],
  ['Nómina USA', 'GASTOS OPERATIVOS', 'Explotación', 'resultado'],
  ['Nómina Cuba', 'GASTOS OPERATIVOS', 'Explotación', 'resultado'],
  ['Pasarelas de pago', 'GASTOS OPERATIVOS', 'Explotación', 'resultado'],
  ['Software y suscripciones', 'GASTOS OPERATIVOS', 'Explotación', 'resultado'],
  ['Comunicación y Marketing', 'GASTOS OPERATIVOS', 'Explotación', 'resultado'],
  ['Gastos bancarios', 'GASTOS OPERATIVOS', 'Explotación', 'resultado'],
  ['Transporte', 'GASTOS OPERATIVOS', 'Explotación', 'resultado'],
  ['Limpieza y mantenimiento', 'GASTOS OPERATIVOS', 'Explotación', 'resultado'],
  ['Materiales de oficina', 'GASTOS OPERATIVOS', 'Explotación', 'resultado'],
  ['Reposición', 'GASTOS OPERATIVOS', 'Explotación', 'resultado'],
  ['Otros gastos', 'GASTOS OPERATIVOS', 'Explotación', 'resultado'],
  [CAT_DEPRECIACION, 'GASTOS OPERATIVOS', 'Explotación', 'resultado', 'Se calcula desde la hoja Activos'],

  ['Financiamiento', 'GASTOS FINANCIEROS', 'Explotación', 'resultado'],
  ['Diferencia cambiaria', 'GASTOS FINANCIEROS', 'Explotación', 'resultado'],

  ['Impuestos', 'IMPUESTOS', 'Explotación', 'resultado'],

  ['Cobro cliente', 'NO AFECTA ER', 'Explotación', 'cxc', 'Cobro de facturas del sistema: baja la CxC'],
  ['Vuelto a cliente', 'NO AFECTA ER', 'Explotación', 'cxc'],
  ['Cobro de CxC', 'NO AFECTA ER', 'Explotación', 'cxc_manual', 'Cobro de CxC fuera del sistema'],
  ['Pago de CxP', 'NO AFECTA ER', 'Explotación', 'cxp', 'Pago de facturas de compra: baja la CxP'],
  ['PAGO PROVEEDOR NO AFECTA ER', 'NO AFECTA ER', 'Explotación', 'cxp'],
  ['Boleteria', 'NO AFECTA ER', 'Explotación', 'fondos_terceros'],
  ['Remesa', 'NO AFECTA ER', 'Explotación', 'fondos_terceros'],
  ['Recarga de billetera', 'NO AFECTA ER', 'Explotación', 'fondos_terceros'],

  ['Compra de activo fijo', 'NO AFECTA ER', 'Inversión', 'activo_fijo'],
  ['Venta de activo fijo', 'NO AFECTA ER', 'Inversión', 'activo_fijo'],

  ['Aporte de capital', 'NO AFECTA ER', 'Financiación', 'capital'],
  ['Retiro de capital / Dividendos', 'NO AFECTA ER', 'Financiación', 'capital'],
  ['Préstamo Kaluch', 'NO AFECTA ER', 'Financiación', 'interco_kaluch'],
  ['Deuda Kaluch', 'NO AFECTA ER', 'Financiación', 'interco_kaluch'],
  ['Préstamo Nextplus', 'NO AFECTA ER', 'Financiación', 'interco_nextplus'],
  ['Deuda Nextplus', 'NO AFECTA ER', 'Financiación', 'interco_nextplus'],

  ['Cambio de divisas', 'NO AFECTA ER', 'Interno', 'transito'],
  ['Traspaso entre cajas', 'NO AFECTA ER', 'Interno', 'transito'],
  ['Depósito bancario', 'NO AFECTA ER', 'Interno', 'transito'],
  ['Pago Tarjeta de Credito', 'NO AFECTA ER', 'Interno', 'transito', 'Pago de la tarjeta desde un banco: movimiento interno'],
  ['Reembolso', 'NO AFECTA ER', 'Interno', 'transito'],
  ['Anticipo / Fondo', 'NO AFECTA ER', 'Interno', 'anticipos'],
  ['EXTERNO MOV IVAN', 'NO AFECTA ER', 'Interno', 'socios', 'Gastos personales pagados con fondos de la empresa'],
  [CAT_SALDO_INICIAL, 'NO AFECTA ER', 'Interno', 'apertura'],
  [CAT_POR_CLASIFICAR, 'NO AFECTA ER', 'Interno', 'por_clasificar'],
]

export const DEFAULT_CATEGORIAS: Categoria[] = DEFS.map(([nombre, grupoER, grupoFlujo, contrapartida, nota], i) => ({
  id: `cat-${i + 1}`,
  nombre,
  grupoER,
  grupoFlujo,
  contrapartida,
  orden: (i + 1) * 10,
  activa: true,
  ...(nota ? { nota } : {}),
}))

/** Alias de categorías encontradas en el Excel que no coinciden exactamente con el catálogo. */
export const CATEGORIA_ALIAS: Record<string, string> = {
  'compras asistidas': 'Compras Asistidas',
}

export const DEFAULT_CUENTAS: Cuenta[] = (
  [
    ['Caja Cuba', 'caja', 'CUBA'],
    ['Caja Miami', 'caja', 'USA'],
    ['Bank of America', 'banco', 'USA'],
    ['Regions', 'banco', 'USA'],
    ['Truist', 'banco', 'USA'],
    ['Revolut', 'banco', 'USA'],
    ['PayPal', 'pasarela', 'USA'],
    ['Square', 'pasarela', 'USA'],
    ['AMEX Next Plus', 'tarjeta', 'USA'],
    ['BOFA Next Plus', 'tarjeta', 'USA'],
  ] as const
).map(([nombre, tipo, geografia], i) => ({ id: `cta-${i + 1}`, nombre, tipo, geografia, orden: (i + 1) * 10, activa: true }))

export const DEFAULT_SETTINGS: Settings = {
  empresa: 'Tropicargo Express',
  fechaInicio: '2026-08-01',
  capitalApertura: 94449.68,
  cxcSistemaApertura: 0,
  mesesCerrados: [],
  margenCupUsd: 30,
}

export type LadoBalance = 'activo' | 'activo_nc' | 'pasivo' | 'patrimonio' | 'segun_signo'

/**
 * Presentación de cada cuenta de balance. Las de lado «segun_signo» se muestran en el activo cuando
 * su saldo es deudor y en el pasivo cuando es acreedor (con el nombre que corresponde a cada caso).
 */
export const CUENTA_BALANCE_INFO: Record<CuentaBalance, { nombre: string; lado: LadoBalance; nombrePasivo?: string }> = {
  cxc: { nombre: 'Cuentas por cobrar — clientes (facturación)', lado: 'segun_signo', nombrePasivo: 'Cobros de clientes sin factura (anticipos de clientes)' },
  cxc_manual: { nombre: 'Cuentas por cobrar — fuera del sistema', lado: 'segun_signo', nombrePasivo: 'Cobros fuera del sistema sin CxC registrada' },
  interco_kaluch: { nombre: 'Cuenta por cobrar — Kaluch', lado: 'segun_signo', nombrePasivo: 'Cuenta por pagar — Kaluch' },
  interco_nextplus: { nombre: 'Cuenta por cobrar — Nextplus', lado: 'segun_signo', nombrePasivo: 'Cuenta por pagar — Nextplus' },
  anticipos: { nombre: 'Anticipos y fondos entregados', lado: 'segun_signo', nombrePasivo: 'Anticipos y fondos recibidos' },
  socios: { nombre: 'Cuentas por cobrar — socios / externos', lado: 'segun_signo', nombrePasivo: 'Cuentas por pagar — socios / externos' },
  inventario: { nombre: 'Inventario — paquetes en abandono', lado: 'activo' },
  devengos: { nombre: 'Gastos pagados por anticipado', lado: 'segun_signo', nombrePasivo: 'Gastos devengados por pagar' },
  transito: { nombre: 'Partidas en tránsito (traspasos sin contrapartida)', lado: 'segun_signo', nombrePasivo: 'Partidas en tránsito (traspasos sin contrapartida)' },
  por_clasificar: { nombre: 'Partidas por clasificar (salidas)', lado: 'segun_signo', nombrePasivo: 'Partidas por clasificar (entradas)' },
  activo_fijo: { nombre: 'Equipos y mobiliario (costo)', lado: 'activo_nc' },
  dep_acumulada: { nombre: 'Depreciación acumulada (−)', lado: 'activo_nc' },
  depositos: { nombre: 'Depósitos y garantías', lado: 'activo_nc' },
  cxp: { nombre: 'Pagos a proveedores sin factura registrada', lado: 'segun_signo', nombrePasivo: 'Cuentas por pagar — proveedores' },
  fondos_terceros: { nombre: 'Fondos de clientes entregados de más (remesas, boletería)', lado: 'segun_signo', nombrePasivo: 'Fondos de clientes por entregar (remesas, boletería, billetera)' },
  impuestos_por_pagar: { nombre: 'Impuestos a favor', lado: 'segun_signo', nombrePasivo: 'Impuestos por pagar' },
  capital: { nombre: 'Capital y aportes', lado: 'patrimonio' },
  apertura: { nombre: 'Ajuste de apertura', lado: 'patrimonio' },
  resultados_anteriores: { nombre: 'Resultados de períodos anteriores', lado: 'patrimonio' },
}

/** Nombre legible de una clave de cuenta del mayor. */
export function nombreCuentaMayor(key: string): string {
  if (key.startsWith('tes:')) return key.slice(4)
  if (key.startsWith('res:')) return `ER · ${key.slice(4)}`
  return CUENTA_BALANCE_INFO[key as CuentaBalance]?.nombre ?? key
}

export function mesLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MESES[Number(m) - 1]} ${y}`
}
