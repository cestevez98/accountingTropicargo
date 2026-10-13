/**
 * Uso: npm run import:excel -- <archivo.xlsx> [salida.json]
 * Convierte el Excel en un dataset JSON y muestra la comparación con los valores del Excel.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { importarLibro, leerLibro } from '../lib/import-excel'
import { construirMayor } from '../lib/ledger'
import { compararConExcel } from '../lib/paridad'

const [archivo, salida = '.data/seed.json'] = process.argv.slice(2)
if (!archivo) {
  console.error('Uso: npm run import:excel -- <archivo.xlsx> [salida.json]')
  process.exit(1)
}
const res = importarLibro(leerLibro(readFileSync(archivo)))
mkdirSync(path.dirname(salida), { recursive: true })
writeFileSync(salida, JSON.stringify(res.dataset))
console.table(res.resumen)
for (const n of res.notas) console.log('•', n)
const mayor = construirMayor(res.dataset)
for (const a of mayor.avisos) console.log('!', a)
const cmp = compararConExcel(res.dataset, mayor, res.referencia)
for (const c of cmp) console.log(`${c.informe.padEnd(4)} ${c.fila.padEnd(48).slice(0, 48)} ${c.mes}  sistema=${c.sistema.toFixed(2).padStart(12)}  excel=${c.excel.toFixed(2).padStart(12)}  dif=${c.diferencia.toFixed(2).padStart(10)}`)
writeFileSync(salida.replace(/\.json$/, '.paridad.json'), JSON.stringify(cmp, null, 1))
console.log(`\nGuardado en ${salida}`)
