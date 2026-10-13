import { redirect } from 'next/navigation'
import { sesionActual } from '@/lib/auth'
import { FormLogin } from './FormLogin'

export default async function LoginPage() {
  if (await sesionActual()) redirect('/')
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-marca-900 to-marca-700 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-marca-600 text-xl font-bold text-white">T</div>
          <h1 className="text-lg font-semibold text-slate-900">Tropicargo Express</h1>
          <p className="text-sm text-slate-500">Contabilidad integrada</p>
        </div>
        <FormLogin />
      </div>
    </main>
  )
}
