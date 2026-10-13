import { accionLogout } from '../acciones'
import { Nav, type ItemNav } from '@/components/Nav'
import { ROL_LABEL, requerirUsuario } from '@/lib/auth'
import type { Rol } from '@/lib/types'

const TODOS: Rol[] = ['admin', 'contador', 'cajero', 'lectura']
const LECTORES: Rol[] = ['admin', 'contador', 'lectura']

const SECCIONES: { titulo: string; items: (ItemNav & { roles: Rol[] })[] }[] = [
  { titulo: 'Resumen', items: [{ href: '/', label: 'Panel y pendientes', roles: LECTORES }] },
  {
    titulo: 'Informes',
    items: [
      { href: '/er', label: 'Estado de Resultados', roles: LECTORES },
      { href: '/efe', label: 'Flujo de Caja', roles: LECTORES },
      { href: '/es', label: 'Estado de Situación', roles: LECTORES },
      { href: '/capital', label: 'Capital', roles: LECTORES },
      { href: '/bancos', label: 'Bancos y cajas', roles: LECTORES },
      { href: '/mayor', label: 'Libro mayor', roles: LECTORES },
    ],
  },
  {
    titulo: 'Registro',
    items: [
      { href: '/movimientos', label: 'Movimientos', roles: TODOS },
      { href: '/facturacion', label: 'Facturación', roles: LECTORES },
      { href: '/registros/facturasCompra', label: 'Facturas de proveedores', roles: LECTORES },
      { href: '/registros/pagosProveedor', label: 'Pagos a proveedores', roles: LECTORES },
      { href: '/registros/cxcManual', label: 'CxC fuera del sistema', roles: LECTORES },
      { href: '/registros/devengos', label: 'Devengos', roles: LECTORES },
      { href: '/registros/asientos', label: 'Asientos manuales', roles: LECTORES },
      { href: '/registros/activos', label: 'Activos fijos', roles: LECTORES },
      { href: '/registros/paquetes', label: 'Paquetes en abandono', roles: LECTORES },
    ],
  },
  {
    titulo: 'Configuración',
    items: [
      { href: '/registros/tasas', label: 'Tasas de cambio', roles: LECTORES },
      { href: '/registros/categorias', label: 'Categorías', roles: LECTORES },
      { href: '/registros/cuentas', label: 'Cajas y bancos', roles: LECTORES },
      { href: '/apertura', label: 'Apertura y cierres', roles: LECTORES },
      { href: '/importar', label: 'Importar / vaciar datos', roles: ['admin'] },
      { href: '/usuarios', label: 'Usuarios', roles: ['admin'] },
      { href: '/auditoria', label: 'Auditoría', roles: ['admin'] },
      { href: '/cuenta', label: 'Mi contraseña', roles: TODOS },
    ],
  },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requerirUsuario()
  const secciones = SECCIONES.map((sec) => ({ titulo: sec.titulo, items: sec.items.filter((i) => i.roles.includes(s.rol)).map(({ href, label }) => ({ href, label })) })).filter(
    (sec) => sec.items.length,
  )
  const usuario = (
    <div className="border-t border-white/10 pt-4 text-xs text-marca-50/80">
      <div className="font-medium text-white">{s.nombre}</div>
      <div>
        {s.email} · {ROL_LABEL[s.rol]}
      </div>
      <form action={accionLogout} className="mt-2">
        <button className="rounded border border-white/20 px-2 py-1 text-white/90 hover:bg-white/10">Cerrar sesión</button>
      </form>
    </div>
  )
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-60 shrink-0 flex-col gap-6 bg-marca-900 p-4 lg:sticky lg:top-0 lg:flex lg:h-screen lg:overflow-y-auto">
        <div className="flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-marca-500 font-bold text-white">T</div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Tropicargo</div>
            <div className="text-[11px] text-marca-100/70">Contabilidad</div>
          </div>
        </div>
        <Nav secciones={secciones} />
        <div className="mt-auto">{usuario}</div>
      </aside>
      <details className="group bg-marca-900 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-white">
          <span className="font-semibold">Tropicargo · Contabilidad</span>
          <span className="rounded border border-white/30 px-2 py-0.5 text-xs">Menú</span>
        </summary>
        <div className="space-y-4 px-4 pb-4">
          <Nav secciones={secciones} />
          {usuario}
        </div>
      </details>
      <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">{children}</main>
    </div>
  )
}
