import { accionLogout, accionPreferencia } from '../acciones'
import { Nav } from '@/components/Nav'
import { Conmutador, SelectorPreferencia } from '@/components/Selector'
import { tiendaFija, requerirUsuario } from '@/lib/auth'
import { TIPO_ENTIDAD_LABEL } from '@/lib/catalogo'
import { cargarDataset, preferencias } from '@/lib/data'
import { ROLES, type Seccion } from '@/lib/permisos'
import { cookies } from 'next/headers'

const NAV: { href: string; label: string; clave: Seccion }[] = [
  { href: '/', label: 'Dashboard', clave: 'dashboard' },
  { href: '/importar', label: 'Importar', clave: 'importar' },
  { href: '/ventas', label: 'Ventas', clave: 'ventas' },
  { href: '/compras', label: 'Compras', clave: 'compras' },
  { href: '/caja', label: 'Caja y Banco', clave: 'caja' },
  { href: '/deudas', label: 'Deudas', clave: 'deudas' },
  { href: '/inventario', label: 'Inventario', clave: 'inventario' },
  { href: '/conteo', label: 'Conteo', clave: 'conteo' },
  { href: '/arqueo', label: 'Cierre de turno', clave: 'arqueo' },
  { href: '/personal', label: 'Pagos al personal', clave: 'personal' },
  { href: '/reportes', label: 'Reportes', clave: 'reportes' },
  { href: '/contabilidad', label: 'Contabilidad', clave: 'contabilidad' },
  { href: '/tasas', label: 'Tasas de cambio', clave: 'tasas' },
  { href: '/catalogos', label: 'Catálogos', clave: 'catalogos' },
  { href: '/integraciones', label: 'Integraciones', clave: 'integraciones' },
  { href: '/sincronizacion', label: 'Sincronización', clave: 'integraciones' },
  { href: '/alertas', label: 'Alertas', clave: 'alertas' },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requerirUsuario()
  const ds = await cargarDataset()
  const pref = await preferencias()
  const rol = ROLES[s.rol]
  const fija = tiendaFija(s)
  const oscuro = (await cookies()).get('ka_tema')?.value === 'oscuro'
  const items = NAV.filter((n) => rol.ver.includes(n.clave))
  const opcionesTienda = [
    { valor: 'all', label: 'Todo el grupo' },
    ...ds.tiendas.filter((t) => t.activa).map((t) => ({ valor: t.id, label: t.nombre, grupo: TIPO_ENTIDAD_LABEL[t.tipo] })),
  ]
  const salir = (
    <form action={accionLogout}>
      <button className="rounded border border-white/20 px-2 py-1 text-white/90 hover:bg-white/10">Salir</button>
    </form>
  )
  return (
    <div className="min-h-screen lg:flex">
      <Nav items={items} nombre={s.nombre} rol={rol.label} color={rol.color} salir={salir} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-border bg-card/90 px-4 py-2.5 backdrop-blur lg:px-6">
          {fija ? (
            <span className="rounded-lg border border-border bg-muted px-3 py-1.5 text-sm font-semibold">🔒 {ds.tiendas.find((t) => t.id === fija)?.nombre ?? fija}</span>
          ) : (
            <SelectorPreferencia accion={accionPreferencia} nombre="tienda" valor={pref.tienda ?? 'all'} opciones={opcionesTienda} titulo="Entidad" />
          )}
          <span className="hidden text-xs text-muted-foreground sm:inline">{ds.settings.empresa}</span>
          <div className="ml-auto flex items-center gap-2">
            <Conmutador
              accion={accionPreferencia}
              nombre="vista"
              valor={pref.vista}
              opciones={[
                { valor: 'USD', label: 'USD' },
                { valor: 'CUP', label: 'CUP' },
              ]}
            />
            <Conmutador
              accion={accionPreferencia}
              nombre="tema"
              valor={oscuro ? 'oscuro' : 'claro'}
              opciones={[
                { valor: 'claro', label: '☀' },
                { valor: 'oscuro', label: '☾' },
              ]}
            />
            <span className="hidden rounded px-1.5 py-0.5 text-[10px] font-bold text-white sm:inline" style={{ background: rol.color }}>
              {rol.label}
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}
