import 'server-only'
import type { Opciones } from '@/components/FormRegistro'
import { CUENTA_BALANCE_INFO } from './catalog'
import { GRUPOS_ER, type CuentaBalance, type Dataset } from './types'
import type { Sesion } from './auth'

export function opcionesFormulario(ds: Dataset, s?: Sesion): Opciones {
  const activas = ds.categorias.filter((c) => c.activa).sort((a, b) => a.orden - b.orden)
  const categorias = GRUPOS_ER.map((g) => ({ grupo: g, nombres: activas.filter((c) => c.grupoER === g).map((c) => c.nombre) })).filter((g) => g.nombres.length)
  let cuentas = ds.cuentas.filter((c) => c.activa).sort((a, b) => a.orden - b.orden).map((c) => c.nombre)
  if (s?.rol === 'cajero') cuentas = cuentas.filter((c) => s.cuentas?.includes(c))
  const cuentasMayor = [
    { grupo: 'Tesorería', items: ds.cuentas.map((c) => ({ value: `tes:${c.nombre}`, label: c.nombre })) },
    {
      grupo: 'Balance',
      items: (Object.entries(CUENTA_BALANCE_INFO) as [CuentaBalance, { nombre: string }][]).map(([k, v]) => ({ value: k, label: v.nombre })),
    },
    {
      grupo: 'Resultados (ER)',
      items: ds.categorias.filter((c) => c.contrapartida === 'resultado').map((c) => ({ value: `res:${c.nombre}`, label: `${c.grupoER} · ${c.nombre}` })),
    },
  ]
  return { categorias, cuentas, cuentasMayor }
}
