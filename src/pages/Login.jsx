import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { LogoMark } from '../components/icons.jsx'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0012 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 010-4.2V7.06H2.18a11 11 0 000 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 002.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  )
}

export default function Login() {
  const { session, signInWithGoogle, loading } = useAuth()
  const location = useLocation()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const from = location.state?.from?.pathname || '/dashboard'
  if (!loading && session) return <Navigate to={from} replace />

  async function handleGoogle() {
    setError('')
    setBusy(true)
    try {
      await signInWithGoogle() // redirige a Google
    } catch (err) {
      setError(err?.message || 'No se pudo iniciar sesión con Google')
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange">
            <LogoMark size={22} />
          </div>
          <div>
            <div className="text-[20px] font-extrabold tracking-[-0.3px]">FitCore</div>
            <div className="text-[12px] font-semibold text-muted">Panel de gestión</div>
          </div>
        </div>

        <div className="rounded-card border border-line bg-white p-7 shadow-[0_10px_40px_rgba(20,27,46,0.06)]">
          <h1 className="text-[19px] font-extrabold">Iniciar sesión</h1>
          <p className="mt-1 text-[13px] font-semibold text-muted">Ingresa con tu cuenta de Google</p>

          <button
            onClick={handleGoogle}
            disabled={busy}
            className="mt-5 flex w-full cursor-pointer items-center justify-center gap-3 rounded-[11px] border border-line bg-white py-3 text-[14.5px] font-extrabold text-ink transition-colors hover:bg-surface active:scale-[0.99] disabled:opacity-60"
          >
            <GoogleIcon />
            {busy ? 'Redirigiendo…' : 'Continuar con Google'}
          </button>

          {error && (
            <div className="mt-4 rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">
              {error}
            </div>
          )}

          <p className="mt-5 text-center text-[12px] font-semibold text-faint">
            Solo cuentas autorizadas por tu gimnasio pueden ingresar.
          </p>

          <div className="mt-4 border-t border-line2 pt-4 text-center text-[12.5px] font-semibold text-muted">
            ¿Tienes un gimnasio?{' '}
            <a href="/registro" className="font-extrabold text-orange hover:underline">Regístralo gratis</a>
          </div>
        </div>

        <p className="mt-4 text-center text-[12px] font-semibold text-faint">
          FitCore · Sistema de gestión de gimnasios
        </p>
      </div>
    </div>
  )
}
