/** Modelo de datos de Kaluch Accounting. Todas las fechas son ISO (AAAA-MM-DD) y la moneda funcional es el USD. */

export type Moneda = 'CUP' | 'USD' | 'EUR' | 'MLC'
export const MONEDAS: Moneda[] = ['CUP', 'USD', 'EUR', 'MLC']

export type TipoEntidad = 'matriz' | 'almacen' | 'local' | 'web'

export interface Tienda {
  id: string
  nombre: string
  tipo: TipoEntidad
  direccion?: string
  /** Nombres con los que aparece en los Excel o en el TPV (p. ej. «Ave26 y 41»). */
  alias?: string[]
  /** Códigos de las áreas de AxisPOS (ObjectCode) de esta tienda, separados por coma (almacén, piso de venta…). */
  codigoTPV?: string
  activa: boolean
}

/** Renglón del Estado de Resultados en el que cae una categoría. */
export type LineaER =
  | 'ventas'
  | 'ingreso_tasa'
  | 'costo_ventas'
  | 'gasto_venta'
  | 'gasto_admin'
  | 'ingreso_financiero'
  | 'gasto_financiero'
  | 'impuesto'
  | 'bonos'

/** Cuenta de balance contra la que se registra un movimiento cuando no afecta el resultado. */
export type CuentaBalance =
  | 'ventas_por_depositar'
  | 'cxc'
  | 'cxp_proveedores'
  | 'casa_matriz'
  | 'cobros_anticipados'
  | 'impuestos_por_pagar'
  | 'dividendos_por_pagar'
  | 'capital'
  | 'traspasos'
  | 'por_clasificar'

export type GrupoFlujo = 'explotacion' | 'inversion' | 'financiacion' | 'interno'

export interface Categoria {
  nombre: string
  /** «resultado» = va al ER en el renglón `rubro`; si no, la cuenta de balance. */
  contrapartida: 'resultado' | CuentaBalance
  linea?: LineaER
  /** Fila del ER (p. ej. «Salarios variables (Dependientes)»). */
  rubro?: string
  flujo: GrupoFlujo
  caja: boolean
  banco: boolean
  activa: boolean
}

/** Tasas del día: CUP por USD (Toque), CUP por EUR, CUP por MLC y la tasa fiscal. */
export interface Tasa {
  fecha: string
  cupUsd: number
  cupEur?: number
  cupMlc?: number
  fiscal?: number
  /** Si se fijó a mano la tasa de compra/venta de la tienda; si no, Toque ∓ margen. */
  kmCompra?: number
  kmVenta?: number
  fuente?: string
}

export type Libro = 'caja' | 'banco'

/** Movimiento de efectivo en caja o banco. */
export interface Movimiento {
  id: string
  libro: Libro
  fecha: string
  tienda: string
  /** Para banco: la cuenta («FISCAL», «FISCAL DMILIO»…). Para caja: vacío. */
  cuenta?: string
  fiscal?: boolean
  cajero?: string
  comprobante?: string
  categoria: string
  concepto?: string
  observaciones?: string
  tipo: 'Entrada' | 'Salida'
  moneda: Moneda
  /** Importe positivo en la moneda original. */
  monto: number
  /** Tasa CUP/USD fijada a mano (si no, la del día). */
  tasa?: number
  origen?: Origen
  lote?: string
}

export type Origen = 'manual' | 'importado' | 'tpv' | 'resumen'

/** Salidas de inventario: ventas, mermas, consumo interno y devoluciones (equivale a la tabla «Salidas»). */
/** `ajuste`: diferencia de conteo (costo positivo = faltante). `traslado`: mercancía enviada a otra tienda. */
export type TipoSalida = 'venta' | 'merma' | 'consumo' | 'devolucion' | 'ajuste' | 'traslado'

export interface Salida {
  id: string
  tipo: TipoSalida
  fecha: string
  tienda: string
  operacion?: string
  producto?: string
  cantidad?: number
  /** Importe cobrado en la moneda original (0 para merma/consumo). */
  importe?: number
  moneda?: Moneda
  /** Importe valorado a tasa Toque (USD). Si falta se calcula. */
  ventaUSD?: number
  /** Diferencia entre la tasa de la tienda y la Toque (USD). */
  ingresoTasaUSD?: number
  /** Costo de lo que salió (USD). Si falta se toma el costo promedio del producto. */
  costoUSD?: number
  pago?: string
  /** Traslados: tienda de destino y compra distribuida de la que salen. */
  destino?: string
  grupo?: string
  codigoProducto?: string
  axis?: EnvioAxis
  origen: Origen
  nota?: string
  lote?: string
}

export type CategoriaPago = 'contado' | 'credito' | 'exterior' | 'consignacion' | 'mercados' | 'transferencia'

export const PAGO_LABEL: Record<CategoriaPago, string> = {
  contado: 'Al contado',
  credito: 'A crédito',
  exterior: 'Pago en exterior',
  consignacion: 'Consignación',
  mercados: 'Mov. entre mercados',
  transferencia: 'Transferencia',
}

export interface Compra {
  id: string
  fecha: string
  tienda: string
  producto?: string
  proveedor?: string
  factura?: string
  cantidad?: number
  moneda: Moneda
  /** Importe total en la moneda original. */
  importe: number
  /** Tasa usada si se registró en CUP/EUR/MLC (CUP por unidad). */
  tasa?: number
  importeUSD?: number
  pago: CategoriaPago
  fiscal: boolean
  /** Mercancía aportada como capital (inventario inicial) en lugar de deuda con el proveedor. */
  aporte?: boolean
  /** Compras distribuidas: todas las partes comparten este id. */
  grupo?: string
  /** Códigos de AxisPOS de la mercancía y del proveedor (para subirla al TPV). */
  codigoProducto?: string
  codigoProveedor?: string
  /** Estado del envío a AxisPOS. */
  axis?: EnvioAxis
  origen: Origen
  nota?: string
  lote?: string
}

export interface EnvioAxis {
  /** Número de documento usado en AxisPOS (serie propia). */
  acct: number
  enviada?: string
  error?: string
}

/** Deudas que no salen de un movimiento de caja (préstamos, impuestos de nómina, deudas con Casa Matriz…). */
export interface Deuda {
  id: string
  clase: 'pagar' | 'cobrar'
  fecha: string
  vence?: string
  tienda: string
  contraparte: string
  /** Categoría del gasto/ingreso si afecta el ER («IMPUESTO NÓMINA»…) o la cuenta de balance. */
  categoria: string
  concepto?: string
  moneda: Moneda
  monto: number
  /** Pagado o cobrado (moneda original). Los pagos que salen de caja/banco se registran como movimientos. */
  saldado?: number
  origen?: Origen
}

export interface Asiento {
  id: string
  fecha: string
  tienda: string
  concepto: string
  lineas: { cuenta: string; debe: number; haber: number }[]
  origen?: Origen
}

export interface Producto {
  codigo: string
  nombre: string
  grupo?: string
  unidad?: string
  /** Costo de referencia (USD) cuando no hay compras registradas. */
  costoUSD?: number
  /** Precio base de venta en CUP (Price del TPV). */
  precioCUP?: number
  /** Precio por grupo de precios del TPV («1»…«8» = Price1…Price8). Cada tienda usa el grupo de sus áreas. */
  precios?: Record<string, number>
  /** Costo en CUP según el TPV (Cost). */
  costoCUP?: number
  /** Códigos de barras (Barcode, Barcode2, Barcode3 del TPV). */
  barras?: string[]
  /** Foto del producto (URL, p. ej. de MiBarcode) y descripción para la web. */
  imagen?: string
  descripcion?: string
  /** Fecha en que se cambió aquí (catálogo maestro): queda pendiente de pasar al TPV. */
  modificado?: string
  /** Existencia que traía el Excel o el último conteo (referencia). */
  existenciaRef?: number
}

/** Distribución de utilidades de un mes (hoja Capital / bloque final del ER). */
export interface Distribucion {
  mes: string
  pctReinversion: number
  pctInversionista: number
  ajusteInversionista?: number
}

/** Línea de un conteo: lo que contó el trabajador (sin ver la existencia del sistema). */
export interface LineaConteo {
  codigo: string
  nombre: string
  cantidad: number
  /** Código escaneado que no está en el catálogo (se identificó con MiBarcode o a mano). */
  desconocido?: boolean
}

/** Conteo físico diario a ciegas de una tienda (con escáner). */
export interface Conteo {
  id: string
  numero: number
  tienda: string
  fecha: string
  usuario: string
  nombreUsuario?: string
  estado: 'abierto' | 'cerrado'
  inicio: string
  cierre?: string
  lineas: LineaConteo[]
  /** Al cerrar: lo contado contra la existencia del TPV en ese momento (solo lo ve administración). */
  resultado?: { codigo: string; nombre: string; contado: number; sistema: number; diferencia: number; costoUSD?: number }[]
  /** Si no se pudo leer el TPV al cerrar. */
  errorSistema?: string
  nota?: string
}

/** Arqueo de caja: efectivo contado por denominaciones contra lo que debería haber. */
export interface Arqueo {
  id: string
  numero: number
  tienda: string
  fecha: string
  ts: string
  usuario: string
  nombreUsuario?: string
  cajero?: string
  /** Billetes y monedas contados. */
  detalle: { moneda: Moneda; valor: number; cantidad: number }[]
  /** Sueltos u otros importes por moneda (monedas fraccionarias, vales…). */
  otros?: Partial<Record<Moneda, number>>
  contado: Partial<Record<Moneda, number>>
  /** Saldo de la caja según Kaluch (cobros del TPV − gastos − entregas) al momento del arqueo. */
  esperado: Partial<Record<Moneda, number>>
  /** Si el esperado no incluye lo último del TPV (no se pudo leer). */
  avisoEsperado?: string
  nota?: string
}

export interface Settings {
  empresa: string
  fechaInicio: string
  /** Margen de la tasa de la tienda respecto a la Toque (CUP). */
  margenTasa: number
  /** Impuesto sobre las ventas cobradas por banco fiscal (fracción). */
  impuestoVentas: number
  /** Revaluar al cierre de mes los saldos en CUP/EUR/MLC (resultado por tenencia de moneda). */
  revaluar: boolean
  margenMinimo: number
  pctReinversionDefecto: number
  pctInversionistaDefecto: number
  /** Margen de la Tienda Web sobre el costo del Almacén Central (fracción). */
  margenWeb?: number
  axispos?: {
    url: string
    usuario: string
    ultimoSync?: string
    /** Registrar los cobros de las ventas del TPV en caja/banco (si no, se siguen anotando a mano). */
    cobros?: boolean
    /** Cuenta bancaria a la que van los cobros por transferencia o tarjeta. */
    cuentaBanco?: string
    /** Último día traído del TPV, por área. */
    ultimoDia?: Record<string, string>
    /** Áreas que devolvió la central la última vez (para asignarlas a las tiendas). */
    ubicaciones?: { code: string; nombre: string; grupo?: string; tipo?: number; precioGrupo?: number }[]
    /** Proveedores del TPV (código y nombre). */
    proveedores?: { code: string; nombre: string }[]
    /** Usuario de AxisPOS con el que se firman las operaciones que se suben. */
    usuarioCodigo?: string
    /** Siguiente número de documento de la serie propia (no choca con los tickets del TPV). */
    siguienteAcct?: number
    /** Primera fecha que se trae del TPV (lo anterior ya vino del Excel). */
    desde?: string
  }
  mesesCerrados: string[]
}

export type Rol = 'propietario' | 'admin' | 'comercial' | 'contador_tienda' | 'dependiente' | 'contador_fiscal' | 'lectura'

export interface Usuario {
  id: string
  email: string
  nombre: string
  rol: Rol
  hash: string
  activo: boolean
  /** Para contador de tienda: tiendas que puede ver y registrar. */
  tiendas?: string[]
}

export interface AuditEntry {
  id: string
  ts: string
  usuario: string
  accion: string
  coleccion: string
  ref?: string
  detalle?: string
}

export interface Importacion {
  id: string
  ts: string
  usuario: string
  tipo: string
  archivo: string
  tienda?: string
  filas: number
  totalUSD?: number
  lote: string
}

export interface Dataset {
  settings: Settings
  tiendas: Tienda[]
  categorias: Categoria[]
  tasas: Tasa[]
  movimientos: Movimiento[]
  salidas: Salida[]
  compras: Compra[]
  deudas: Deuda[]
  asientos: Asiento[]
  productos: Producto[]
  distribuciones: Distribucion[]
  importaciones: Importacion[]
  conteos: Conteo[]
  arqueos: Arqueo[]
  /** Totales guardados del ER del último Excel importado por tienda (para la comparación). */
  referencias: Record<string, { meses: string[]; er: Record<string, number[]>; archivo: string }>
}
