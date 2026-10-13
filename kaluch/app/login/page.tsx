import { redirect } from 'next/navigation'
import { sesionActual } from '@/lib/auth'
import { FormLogin } from './FormLogin'

export default async function Login() {
  if (await sesionActual()) redirect('/')
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-base font-extrabold text-white">KA</span>
            <div>
              <p className="text-lg leading-none font-bold">Kaluch Accounting</p>
              <p className="text-sm text-muted-foreground">Panel de control comercial</p>
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Iniciar sesión</h1>
          <p className="mt-1 text-sm text-muted-foreground">Accede con tu cuenta de Kaluch Market.</p>
          <FormLogin />
          <p className="mt-4 text-center text-xs text-muted-foreground">¿Olvidaste tu contraseña? Contacta al administrador.</p>
        </div>
      </div>
      <div className="relative hidden items-center justify-center overflow-hidden bg-primary p-12 lg:flex">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.5) 1px, transparent 0)', backgroundSize: '22px 22px' }} />
        <div className="relative max-w-sm text-white">
          <p className="text-sm font-semibold tracking-widest text-accent uppercase">Kaluch Market</p>
          <h2 className="mt-3 text-3xl leading-tight font-bold">Contabilidad centralizada para tu cadena de tiendas.</h2>
          <p className="mt-4 text-sm text-white/70">Sube los archivos de cada tienda o conecta el TPV y deja que el sistema genere los estados de situación, resultados y flujo de efectivo — sin más hojas de Excel.</p>
        </div>
      </div>
    </div>
  )
}
