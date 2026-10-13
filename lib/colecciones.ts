import { CUENTAS_BALANCE, GRUPOS_ER, GRUPOS_FLUJO } from './types'
import type { Rol } from './types'

export type TipoCampo = 'texto' | 'numero' | 'fecha' | 'mes' | 'bool' | 'select' | 'textarea' | 'lista'

/** Fuentes dinámicas de opciones para los desplegables. */
export type FuenteOpciones = 'categorias' | 'cuentas' | 'cuentasMayor' | 'proveedores'

export interface Campo {
  key: string
  label: string
  tipo: TipoCampo
  opciones?: readonly string[] | FuenteOpciones
  requerido?: boolean
  /** Visible como columna en la tabla. */
  tabla?: boolean
  /** Se puede filtrar con un desplegable. */
  filtro?: boolean
  ayuda?: string
  defecto?: string | number | boolean
  /** Columna numérica que se suma en el pie de la tabla. */
  sumar?: boolean
}

export interface ColeccionConfig {
  key: string
  titulo: string
  singular: string
  descripcion: string
  campos: Campo[]
  /** Campo de fecha principal (orden y filtro por mes). */
  campoFecha?: string
  /** Campos en los que busca el cuadro de texto. */
  busqueda: string[]
  rolesEditar: Rol[]
  /** Etiqueta del registro para auditoría. */
  etiqueta: (r: Record<string, unknown>) => string
}

const EDITORES: Rol[] = ['admin', 'contador']

export const COLECCIONES: Record<string, ColeccionConfig> = {
  movimientos: {
    key: 'movimientos',
    titulo: 'Movimientos de caja y bancos',
    singular: 'movimiento',
    descripcion:
      'Una línea por entrada o salida de dinero en cualquier caja, banco, pasarela o tarjeta. La categoría decide si el importe va al Estado de Resultados y a qué parte del Flujo de Caja.',
    campoFecha: 'fecha',
    busqueda: ['concepto', 'referencia', 'observaciones'],
    rolesEditar: ['admin', 'contador', 'cajero'],
    etiqueta: (r) => `${r.fecha} ${r.cuenta} ${r.concepto}`,
    campos: [
      { key: 'fecha', label: 'Fecha', tipo: 'fecha', requerido: true, tabla: true },
      { key: 'cuenta', label: 'Caja / banco', tipo: 'select', opciones: 'cuentas', requerido: true, tabla: true, filtro: true },
      { key: 'categoria', label: 'Categoría', tipo: 'select', opciones: 'categorias', requerido: true, tabla: true, filtro: true },
      { key: 'concepto', label: 'Concepto', tipo: 'texto', requerido: true, tabla: true },
      { key: 'moneda', label: 'Moneda', tipo: 'select', opciones: ['USD', 'CUP', 'EUR'], requerido: true, tabla: true, filtro: true, defecto: 'USD' },
      { key: 'entrada', label: 'Entrada', tipo: 'numero', tabla: true, sumar: true },
      { key: 'salida', label: 'Salida', tipo: 'numero', tabla: true, sumar: true },
      { key: 'tasa', label: 'Tasa propia (opcional)', tipo: 'numero', ayuda: 'CUP por USD o USD por EUR. Si la dejas vacía se usa la tabla de tasas.' },
      { key: 'referencia', label: 'Referencia', tipo: 'texto' },
      { key: 'observaciones', label: 'Observaciones', tipo: 'textarea', tabla: true },
      { key: 'excluirER', label: 'Línea duplicada (no va al ER)', tipo: 'bool', ayuda: 'Márcalo solo si este mismo gasto ya está registrado en otra cuenta.' },
    ],
  },
  facturas: {
    key: 'facturas',
    titulo: 'Facturación',
    singular: 'factura',
    descripcion: 'Una fila por factura del sistema de facturación. Las que tienen «Afecta ER» son los ingresos del Estado de Resultados (por fecha de emisión).',
    campoFecha: 'emision',
    busqueda: ['numero', 'cliente', 'detalle', 'notas'],
    rolesEditar: EDITORES,
    etiqueta: (r) => `${r.numero} ${r.cliente}`,
    campos: [
      { key: 'numero', label: 'Nº factura', tipo: 'texto', requerido: true, tabla: true },
      { key: 'cliente', label: 'Cliente', tipo: 'texto', requerido: true, tabla: true },
      { key: 'emision', label: 'F. emisión', tipo: 'fecha', requerido: true, tabla: true },
      { key: 'vencimiento', label: 'F. vencimiento', tipo: 'fecha', tabla: true },
      { key: 'monto', label: 'Monto USD', tipo: 'numero', requerido: true, tabla: true, sumar: true },
      { key: 'cobrado', label: 'Cobrado USD', tipo: 'numero', tabla: true, sumar: true },
      { key: 'servicio', label: 'Servicio', tipo: 'texto', tabla: true, filtro: true },
      { key: 'tipoEnvio', label: 'Tipo de envío', tipo: 'texto' },
      { key: 'subtipo', label: 'Subtipo', tipo: 'texto' },
      { key: 'detalle', label: 'Guías y detalle', tipo: 'textarea' },
      { key: 'estatusSistema', label: 'Estatus del sistema', tipo: 'texto', filtro: true },
      { key: 'afectaER', label: 'Afecta ER', tipo: 'bool', defecto: true, tabla: true },
      { key: 'notas', label: 'Notas', tipo: 'textarea' },
    ],
  },
  facturasCompra: {
    key: 'facturasCompra',
    titulo: 'Facturas de proveedores',
    singular: 'factura de proveedor',
    descripcion:
      'Facturas de compra. Cada factura lleva el gasto al ER en su fecha y crea la cuenta por pagar. El pago desde el banco o la caja se registra como movimiento con la categoría «Pago de CxP».',
    campoFecha: 'fecha',
    busqueda: ['proveedor', 'numero', 'descripcion'],
    rolesEditar: EDITORES,
    etiqueta: (r) => `${r.numero} ${r.proveedor}`,
    campos: [
      { key: 'proveedor', label: 'Proveedor', tipo: 'texto', requerido: true, tabla: true, filtro: true },
      { key: 'numero', label: 'Nº factura', tipo: 'texto', requerido: true, tabla: true },
      { key: 'fecha', label: 'Fecha', tipo: 'fecha', requerido: true, tabla: true },
      { key: 'vencimiento', label: 'Vencimiento', tipo: 'fecha', tabla: true },
      { key: 'descripcion', label: 'Descripción', tipo: 'texto', tabla: true },
      { key: 'categoria', label: 'Categoría del gasto', tipo: 'select', opciones: 'categorias', requerido: true, tabla: true, filtro: true },
      { key: 'monto', label: 'Monto USD', tipo: 'numero', requerido: true, tabla: true, sumar: true },
      { key: 'pagado', label: 'Pagado USD', tipo: 'numero', tabla: true, sumar: true, ayuda: 'Control informativo; el pago real es el movimiento «Pago de CxP».' },
    ],
  },
  pagosProveedor: {
    key: 'pagosProveedor',
    titulo: 'Pagos a proveedores',
    singular: 'pago',
    descripcion: 'Registro de control de los pagos hechos a proveedores (informativo: el dinero sale en los movimientos con categoría «Pago de CxP»).',
    campoFecha: 'fecha',
    busqueda: ['proveedor', 'numero', 'observaciones'],
    rolesEditar: EDITORES,
    etiqueta: (r) => `${r.fecha} ${r.proveedor}`,
    campos: [
      { key: 'fecha', label: 'Fecha', tipo: 'fecha', requerido: true, tabla: true },
      { key: 'proveedor', label: 'Proveedor', tipo: 'texto', requerido: true, tabla: true, filtro: true },
      { key: 'numero', label: 'Nº factura', tipo: 'texto', tabla: true },
      { key: 'monto', label: 'Monto USD', tipo: 'numero', requerido: true, tabla: true, sumar: true },
      { key: 'cuenta', label: 'Cuenta', tipo: 'select', opciones: 'cuentas', tabla: true },
      { key: 'observaciones', label: 'Observaciones', tipo: 'textarea', tabla: true },
    ],
  },
  cxcManual: {
    key: 'cxcManual',
    titulo: 'CxC fuera del sistema',
    singular: 'cuenta por cobrar',
    descripcion:
      'Cobros pendientes que no pasan por el sistema de facturación (acuerdos, informales). Cada línea suma a «Ventas fuera del sistema» del ER; el cobro se registra como movimiento «Cobro de CxC».',
    campoFecha: 'fecha',
    busqueda: ['numero', 'cliente', 'descripcion'],
    rolesEditar: EDITORES,
    etiqueta: (r) => `${r.numero} ${r.cliente}`,
    campos: [
      { key: 'numero', label: 'Nº', tipo: 'texto', requerido: true, tabla: true },
      { key: 'cliente', label: 'Cliente', tipo: 'texto', requerido: true, tabla: true },
      { key: 'descripcion', label: 'Descripción', tipo: 'texto', tabla: true },
      { key: 'fecha', label: 'Fecha', tipo: 'fecha', requerido: true, tabla: true },
      { key: 'vencimiento', label: 'Vencimiento', tipo: 'fecha', tabla: true },
      { key: 'facturado', label: 'Facturado USD', tipo: 'numero', requerido: true, tabla: true, sumar: true },
      { key: 'cobrado', label: 'Cobrado USD', tipo: 'numero', tabla: true, sumar: true },
    ],
  },
  devengos: {
    key: 'devengos',
    titulo: 'Devengos',
    singular: 'devengo',
    descripcion:
      'Pagos cuyo gasto pertenece a otro mes (por ejemplo, el salario de agosto pagado en septiembre). El importe sale del ER del mes de pago y entra en el mes al que corresponde.',
    campoFecha: 'fechaPago',
    busqueda: ['concepto', 'origen', 'notas'],
    rolesEditar: EDITORES,
    etiqueta: (r) => `${r.fechaPago} ${r.concepto}`,
    campos: [
      { key: 'fechaPago', label: 'Fecha de pago', tipo: 'fecha', requerido: true, tabla: true },
      { key: 'origen', label: 'Origen', tipo: 'select', opciones: 'cuentas', tabla: true },
      { key: 'concepto', label: 'Concepto', tipo: 'texto', requerido: true, tabla: true },
      { key: 'categoria', label: 'Categoría', tipo: 'select', opciones: 'categorias', requerido: true, tabla: true, filtro: true },
      { key: 'importe', label: 'Importe USD', tipo: 'numero', requerido: true, tabla: true, sumar: true },
      { key: 'mesCorresponde', label: 'Mes al que corresponde', tipo: 'mes', requerido: true, tabla: true },
      { key: 'notas', label: 'Notas', tipo: 'textarea', tabla: true },
    ],
  },
  asientos: {
    key: 'asientos',
    titulo: 'Asientos manuales',
    singular: 'asiento',
    descripcion:
      'Ajustes que no son movimientos de dinero: saldos de apertura, otros ingresos no facturados, intercompañía sin pago, reclasificaciones. El cargo aumenta activos y gastos; el abono aumenta pasivos, patrimonio e ingresos.',
    campoFecha: 'fecha',
    busqueda: ['concepto', 'notas', 'cargo', 'abono'],
    rolesEditar: EDITORES,
    etiqueta: (r) => `${r.fecha} ${r.concepto}`,
    campos: [
      { key: 'fecha', label: 'Fecha', tipo: 'fecha', requerido: true, tabla: true },
      { key: 'concepto', label: 'Concepto', tipo: 'texto', requerido: true, tabla: true },
      { key: 'cargo', label: 'Cargo (debe)', tipo: 'select', opciones: 'cuentasMayor', requerido: true, filtro: true },
      { key: 'abono', label: 'Abono (haber)', tipo: 'select', opciones: 'cuentasMayor', requerido: true, filtro: true },
      { key: 'importe', label: 'Importe USD', tipo: 'numero', requerido: true, tabla: true, sumar: true },
      { key: 'notas', label: 'Notas', tipo: 'textarea', tabla: true },
    ],
  },
  activos: {
    key: 'activos',
    titulo: 'Activos fijos',
    singular: 'activo',
    descripcion: 'Equipos y mobiliario de USA y Cuba. Con costo y vida útil se calcula la depreciación mensual en línea recta.',
    busqueda: ['descripcion', 'categoria', 'notas'],
    rolesEditar: EDITORES,
    etiqueta: (r) => String(r.descripcion),
    campos: [
      { key: 'descripcion', label: 'Descripción', tipo: 'texto', requerido: true, tabla: true },
      { key: 'categoria', label: 'Categoría', tipo: 'texto', tabla: true, filtro: true },
      { key: 'geografia', label: 'Geografía', tipo: 'select', opciones: ['USA', 'CUBA'], requerido: true, tabla: true, filtro: true, defecto: 'USA' },
      { key: 'fechaAlta', label: 'Fecha de alta', tipo: 'fecha', tabla: true, ayuda: 'Vacía o anterior al inicio = activo de apertura.' },
      { key: 'costo', label: 'Costo USD', tipo: 'numero', tabla: true, sumar: true },
      { key: 'vidaUtil', label: 'Vida útil (años)', tipo: 'numero', tabla: true },
      { key: 'depAcumApertura', label: 'Depreciación acumulada al inicio', tipo: 'numero', tabla: true, sumar: true },
      { key: 'notas', label: 'Notas', tipo: 'textarea', tabla: true },
    ],
  },
  paquetes: {
    key: 'paquetes',
    titulo: 'Paquetes en abandono',
    singular: 'paquete',
    descripcion: 'Inventario de paquetes en condición de abandono y su venta.',
    campoFecha: 'llegada',
    busqueda: ['kgt', 'cliente', 'descripcion', 'comprador'],
    rolesEditar: EDITORES,
    etiqueta: (r) => `KGT ${r.kgt}`,
    campos: [
      { key: 'kgt', label: '# KGT', tipo: 'texto', requerido: true, tabla: true },
      { key: 'cliente', label: 'Cliente original', tipo: 'texto', tabla: true },
      { key: 'descripcion', label: 'Descripción', tipo: 'texto', tabla: true },
      { key: 'llegada', label: 'Llegada a Miami', tipo: 'fecha', tabla: true },
      { key: 'valorDeclarado', label: 'Valor declarado USD', tipo: 'numero', tabla: true, sumar: true },
      { key: 'fechaAbandono', label: 'F. declarado abandono', tipo: 'fecha' },
      { key: 'precioVenta', label: 'Precio venta USD', tipo: 'numero', tabla: true, sumar: true },
      { key: 'fechaVenta', label: 'F. venta', tipo: 'fecha', tabla: true },
      { key: 'estado', label: 'Estado', tipo: 'select', opciones: ['Disponible', 'Vendido'], requerido: true, tabla: true, filtro: true, defecto: 'Disponible' },
      { key: 'comprador', label: 'Comprador / notas', tipo: 'texto', tabla: true },
    ],
  },
  tasas: {
    key: 'tasas',
    titulo: 'Tasas de cambio',
    singular: 'tasa',
    descripcion: 'Cada movimiento en CUP o EUR se convierte con la tasa de la fecha más reciente igual o anterior a la del movimiento. Marca «Confirmada» cuando la tasa sea la real.',
    campoFecha: 'fecha',
    busqueda: [],
    rolesEditar: EDITORES,
    etiqueta: (r) => String(r.fecha),
    campos: [
      { key: 'fecha', label: 'Desde la fecha', tipo: 'fecha', requerido: true, tabla: true },
      { key: 'cupPorUsd', label: 'CUP por 1 USD', tipo: 'numero', requerido: true, tabla: true },
      { key: 'usdPorEur', label: 'USD por 1 EUR', tipo: 'numero', requerido: true, tabla: true },
      { key: 'confirmada', label: 'Confirmada', tipo: 'bool', tabla: true, filtro: true },
    ],
  },
  categorias: {
    key: 'categorias',
    titulo: 'Catálogo de categorías',
    singular: 'categoría',
    descripcion:
      'La categoría es la pieza central: su grupo del ER decide si el importe va al Estado de Resultados; su grupo de flujo, a qué parte del Flujo de Caja; y la contrapartida, a qué cuenta del balance va cuando no afecta el ER.',
    busqueda: ['nombre', 'nota'],
    rolesEditar: ['admin'],
    etiqueta: (r) => String(r.nombre),
    campos: [
      { key: 'nombre', label: 'Nombre', tipo: 'texto', requerido: true, tabla: true, ayuda: 'Si cambias el nombre, los movimientos con el nombre anterior se actualizan.' },
      { key: 'grupoER', label: 'Grupo ER', tipo: 'select', opciones: GRUPOS_ER, requerido: true, tabla: true, filtro: true },
      { key: 'grupoFlujo', label: 'Grupo flujo', tipo: 'select', opciones: GRUPOS_FLUJO, requerido: true, tabla: true, filtro: true },
      { key: 'contrapartida', label: 'Contrapartida', tipo: 'select', opciones: ['resultado', ...CUENTAS_BALANCE], requerido: true, tabla: true, filtro: true, ayuda: '«resultado» para las categorías del ER; si no, la cuenta del balance que mueve.' },
      { key: 'orden', label: 'Orden', tipo: 'numero', tabla: true, defecto: 1000 },
      { key: 'activa', label: 'Activa', tipo: 'bool', tabla: true, defecto: true },
      { key: 'nota', label: 'Nota', tipo: 'textarea', tabla: true },
    ],
  },
  cuentas: {
    key: 'cuentas',
    titulo: 'Cajas, bancos y tarjetas',
    singular: 'cuenta',
    descripcion: 'Cuentas de tesorería. Las tarjetas de crédito aparecen en el pasivo del balance.',
    busqueda: ['nombre'],
    rolesEditar: ['admin'],
    etiqueta: (r) => String(r.nombre),
    campos: [
      { key: 'nombre', label: 'Nombre', tipo: 'texto', requerido: true, tabla: true, ayuda: 'Si cambias el nombre, los movimientos se actualizan.' },
      { key: 'tipo', label: 'Tipo', tipo: 'select', opciones: ['caja', 'banco', 'pasarela', 'tarjeta'], requerido: true, tabla: true },
      { key: 'geografia', label: 'Geografía', tipo: 'select', opciones: ['USA', 'CUBA'], requerido: true, tabla: true },
      { key: 'orden', label: 'Orden', tipo: 'numero', tabla: true, defecto: 1000 },
      { key: 'activa', label: 'Activa', tipo: 'bool', tabla: true, defecto: true },
    ],
  },
}

export function campo(col: ColeccionConfig, key: string) {
  return col.campos.find((c) => c.key === key)
}
