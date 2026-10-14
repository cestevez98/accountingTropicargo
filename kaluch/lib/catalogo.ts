import type { Categoria, CuentaBalance, LineaER, Settings, Tienda } from './types'

export const DEFAULT_TIENDAS: Tienda[] = [
  { id: 'matriz', nombre: 'Casa Matriz', tipo: 'matriz', activa: true },
  { id: 'almacen', nombre: 'Almacén Central', tipo: 'almacen', activa: true },
  { id: 'km12', nombre: 'KM 12', tipo: 'local', activa: true },
  { id: 'km26', nombre: 'KM 26', tipo: 'local', direccion: 'Ave 26 y 41', alias: ['Ave26 y 41', 'Ave 26 y 41', 'KM-26', 'KM26'], activa: true },
  { id: 'slazaro', nombre: 'San Lázaro', tipo: 'local', activa: true },
  { id: 'ayestaran', nombre: 'Ayestarán', tipo: 'local', activa: true },
  { id: 'cerro', nombre: 'Cerro', tipo: 'local', activa: true },
  { id: 'playa', nombre: 'Playa', tipo: 'local', direccion: 'Pendiente de apertura', activa: true },
  { id: 'web', nombre: 'Tienda Web', tipo: 'web', activa: true },
]

export const TIPO_ENTIDAD_LABEL = { matriz: 'Casa Matriz', almacen: 'Almacén', local: 'Local', web: 'Web' } as const

const gasto = (nombre: string, linea: LineaER, rubro: string, caja = true, banco = true): Categoria => ({
  nombre,
  contrapartida: 'resultado',
  linea,
  rubro,
  flujo: 'explotacion',
  caja,
  banco,
  activa: true,
})
const balance = (nombre: string, cuenta: CuentaBalance, flujo: Categoria['flujo']): Categoria => ({
  nombre,
  contrapartida: cuenta,
  flujo,
  caja: true,
  banco: true,
  activa: true,
})

/** Catálogo de categorías (hoja Listados del Excel KM-26), cada una con su renglón del ER o su cuenta de balance. */
export const DEFAULT_CATEGORIAS: Categoria[] = [
  balance('VENTAS', 'ventas_por_depositar', 'explotacion'),
  balance('DEUDA', 'casa_matriz', 'financiacion'),
  balance('PAGO AL CONTADO', 'cxp_proveedores', 'explotacion'),
  balance('PAGO CONSIGNACIÓN', 'cxp_proveedores', 'explotacion'),
  balance('PAGO DE CRÉDITO', 'cxp_proveedores', 'explotacion'),
  balance('MERCANCIA', 'cxp_proveedores', 'explotacion'),
  balance('CXC', 'cxc', 'explotacion'),
  balance('TRASPASO', 'traspasos', 'interno'),
  balance('DEPOSITO', 'traspasos', 'interno'),
  balance('CAMBIO DIVISAS', 'traspasos', 'interno'),
  balance('CAPITAL', 'capital', 'financiacion'),
  balance('SALDO INICIAL', 'capital', 'interno'),
  balance('DIVIDENDOS', 'dividendos_por_pagar', 'financiacion'),
  balance('IMPUESTOS PAGADOS', 'impuestos_por_pagar', 'explotacion'),
  balance('COBRO ANTICIPADO', 'cobros_anticipados', 'explotacion'),
  balance('POR CLASIFICAR', 'por_clasificar', 'interno'),
  gasto('DEVOLUCION', 'ventas', 'Devoluciones de ventas'),
  gasto('SALARIO DEPENDIENTE', 'gasto_venta', 'Salarios variables (Dependientes)'),
  gasto('SALARIO ADMINISTRATIVO', 'gasto_admin', 'Salarios fijos (personal administrativo)'),
  gasto('SALARIO SEGURIDAD', 'gasto_admin', 'Salarios (seguridad y limpieza)'),
  gasto('SALARIO LIMPIEZA', 'gasto_admin', 'Salarios (seguridad y limpieza)'),
  gasto('MTTO', 'gasto_admin', 'Mtto'),
  gasto('TRANSPORTE', 'gasto_admin', 'Transporte'),
  gasto('MENSAJERIA', 'gasto_admin', 'Transporte'),
  gasto('COMUNICACIÓN', 'gasto_admin', 'Comunicación (Publicidad)'),
  gasto('MATERIALES DE OFICINA', 'gasto_admin', 'Otros gastos'),
  gasto('NAVES', 'gasto_admin', 'Otros gastos'),
  gasto('CONVENIO SAF', 'gasto_admin', 'Otros gastos'),
  gasto('USO TIENDA', 'gasto_admin', 'Otros gastos'),
  gasto('PAGO ADIESTRAMIENTO', 'gasto_admin', 'Otros gastos'),
  gasto('RRHH', 'gasto_admin', 'Otros gastos'),
  gasto('OTROS GASTOS', 'gasto_admin', 'Otros gastos'),
  gasto('GASTOS BANCARIOS', 'gasto_admin', 'Gastos bancarios'),
  gasto('MULTAS', 'gasto_financiero', 'Gastos Financieros'),
  gasto('INGRESOS FINANCIEROS', 'ingreso_financiero', 'Ingresos Financieros'),
  gasto('NÓMINA', 'gasto_admin', 'Nómina pagada por Casa Matriz'),
  gasto('IMPUESTO NÓMINA', 'impuesto', 'Nómina'),
  gasto('IMPUESTO VENTAS', 'impuesto', 'Ventas'),
  gasto('BONOS', 'bonos', 'Bonos'),
]

export const CAT_POR_CLASIFICAR = 'POR CLASIFICAR'

/** Renglones fijos del ER que no salen de categorías sino de las salidas de inventario y de cálculos. */
export const RUBRO = {
  venta: 'Venta',
  tasa: 'Ingreso por tasa de cambio',
  costo: 'Costo de Ventas',
  consumo: 'Consumo interno',
  merma: 'Merma',
  ajusteInv: 'Ajustes de inventario',
  impVentas: 'Ventas',
  tenencia: 'Resultado por tenencia de moneda',
  ajuste: 'Ajustes manuales',
} as const

export const ETIQUETA_CUENTA: Record<string, string> = {
  ventas_por_depositar: 'Ventas por depositar (TPV → caja/banco)',
  inventario: 'Inventario',
  cxc: 'Cuentas por cobrar',
  cxp_proveedores: 'Cuentas por pagar — proveedores',
  casa_matriz: 'Casa Matriz (deuda entre mercados)',
  cobros_anticipados: 'Cobros anticipados',
  impuestos_por_pagar: 'Impuestos por pagar',
  dividendos_por_pagar: 'Dividendos por pagar',
  capital: 'Capital',
  dividendos_declarados: 'Dividendos declarados',
  traspasos: 'Traspasos en tránsito',
  por_clasificar: 'Partidas por clasificar',
}

export const LINEA_LABEL: Record<LineaER, string> = {
  ventas: 'Ventas',
  ingreso_tasa: 'Ingreso por tasa de cambio',
  costo_ventas: 'Costo de ventas',
  gasto_venta: 'Gastos de venta',
  gasto_admin: 'Gastos administrativos',
  ingreso_financiero: 'Ingresos financieros',
  gasto_financiero: 'Gastos financieros',
  impuesto: 'Carga impositiva',
  bonos: 'Bonos',
}

export const DEFAULT_SETTINGS: Settings = {
  empresa: 'Kaluch Market',
  fechaInicio: '2026-06-01',
  margenTasa: 15,
  impuestoVentas: 0.11,
  revaluar: true,
  margenMinimo: 0.3,
  pctSalarioCajero: 0.03,
  cuentasTransferencia: ['FISCAL', 'CARLOS', 'ROLY'],
  cortesTurno: ['02:00'],
  pctReinversionDefecto: 0.05,
  pctInversionistaDefecto: 0.15,
  mesesCerrados: [],
}
