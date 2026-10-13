import type { Referencia } from './importar-km'
import type { Informe } from './informes'

export interface FilaParidad {
  label: string
  excel: number[]
  app: number[]
  dif: number[]
  nota?: string
}

/** Diferencias conocidas entre el Excel y el sistema (decisiones contables documentadas). */
export const NOTAS_PARIDAD: Record<string, string> = {
  'Costo de Ventas': 'Las líneas de venta sin costo en el Excel (costo 0) se costean con el costo promedio de compra del producto.',
  Merma: 'El Excel no sumaba las mermas escritas «MERMA » (con espacio al final); el sistema sí.',
  'Gastos Administrativos': 'Incluye la nómina pagada por Casa Matriz (hoja Deuda CM) y los gastos que el Excel dejaba fuera del ER.',
  Transporte: 'El sistema suma MENSAJERIA en Transporte; el Excel no la llevaba al ER.',
  'Otros gastos': 'El sistema suma NAVES, RRHH, PAGO ADIESTRAMIENTO y demás gastos que el Excel no llevaba al ER.',
  'Gastos bancarios': 'El sistema registra la «venta» negativa del banco como gasto bancario; el impuesto se calcula sobre los cobros positivos.',
  Ventas: 'Impuesto: 11 % de lo cobrado por banco en el mes (sin restar los cargos del banco).',
  'Beneficio neto': 'Incluye la «Diferencia» escrita a mano en el Excel y las diferencias anteriores.',
  'Ingresos Financieros': 'El sistema revalúa el efectivo en CUP y EUR al cierre de mes (resultado por tenencia de moneda); el Excel no.',
}

export function compararER(ref: Pick<Referencia, 'meses' | 'er'>, er: Informe): FilaParidad[] {
  const out: FilaParidad[] = []
  const cols = ref.meses.map((m) => er.meses.indexOf(m))
  for (const [label, excel] of Object.entries(ref.er)) {
    const fila = er.filas.find((f) => f.label.trim() === label.trim() && f.valores.length)
    if (!fila) continue
    const app = cols.map((c) => (c >= 0 ? fila.valores[c] : 0))
    out.push({ label, excel, app, dif: app.map((v, i) => v - excel[i]), nota: NOTAS_PARIDAD[label] })
  }
  return out
}
