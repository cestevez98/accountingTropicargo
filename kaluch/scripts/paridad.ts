import { readFileSync } from 'node:fs'
import { aplicarLote } from '../lib/aplicar'
import { DEFECTOS } from '../lib/defectos'
import { leerLibroKM } from '../lib/importar-km'
import { estadoResultados, estadoSituacion, Indice, mesesDelAnio, flujoEfectivo } from '../lib/informes'
import { construirMayor } from '../lib/mayor'
import { compararER } from '../lib/paridad'

const archivo = process.argv[2]
const ds = structuredClone(DEFECTOS)
const lote = leerLibroKM(readFileSync(archivo), ds)
console.log('movs', lote.movimientos.length, 'tasas', lote.tasas.length, 'prod', lote.productos.length, 'sal', lote.salidas.length, 'com', lote.compras.length, 'deu', lote.deudas.length, 'asi', lote.asientos.length)
const cnt = new Map<string, number>()
for (const p of lote.problemas) cnt.set(`${p.nivel}: ${p.mensaje.replace(/\d{4}-\d{2}-\d{2}.*$/, '…')}`, (cnt.get(`${p.nivel}: ${p.mensaje.replace(/\d{4}-\d{2}-\d{2}.*$/, '…')}`) ?? 0) + 1)
console.log(cnt)
console.log(lote.notas)
const { nuevo } = aplicarLote(ds, lote, { usuario: 'test', tipo: 'km', archivo })
Object.assign(ds, nuevo)
const mayor = construirMayor(ds, '2026-10-13')
console.log(mayor.avisos)
const idx = new Indice(mayor)
const meses = mesesDelAnio(mayor, 2026)
const er = estadoResultados(ds, idx, meses)
const fmt = (v: number) => v.toFixed(2).padStart(11)
console.log('ER', meses.join(' '))
for (const f of er.filas) console.log(f.label.padEnd(45), f.valores.map(fmt).join(''))
for (const p of compararER(lote.referencia!, er)) if (p.dif.some((d) => Math.abs(d) > 0.01)) console.log('DIF', p.label.padEnd(40), p.dif.map(fmt).join(''), p.nota ?? '')
const es = estadoSituacion(idx, meses)
console.log('ES')
for (const f of es.filas) console.log(f.label.padEnd(45), f.valores.map(fmt).join(''))
console.log('ref ES', lote.referencia!.es)
const efe = flujoEfectivo(ds, mayor, meses)
for (const f of efe.filas) console.log(f.label.padEnd(45), f.valores.map(fmt).join(''))
