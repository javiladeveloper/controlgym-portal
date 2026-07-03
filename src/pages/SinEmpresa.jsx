import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { LogoMark } from '../components/icons.jsx'

// Fallback: usuario autenticado pero sin empresa asignada.
export default function SinEmpresa() {
  const { signOut, usuario } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-[420px] rounded-card border border-line bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-orange">
          <LogoMark size={24} />
        </div>
        <h1 className="text-[18px] font-extrabold">Sin gimnasio vinculado</h1>
        <p className="mt-2 text-[13px] font-semibold text-muted">
          {usuario?.nombre ? `Hola ${usuario.nombre}. ` : ''}
          Tu cuenta aún no pertenece a ningún gimnasio. Pide una invitación a tu administrador… o crea el tuyo.
        </p>
        <button
          onClick={() => navigate('/registro')}
          className="mt-5 w-full cursor-pointer rounded-[11px] border-none bg-orange py-3 text-[14px] font-extrabold text-white shadow-[0_4px_14px_rgba(255,107,53,0.32)] transition-colors hover:bg-orange-600"
        >
          Registrar mi gimnasio
        </button>
        <button
          onClick={signOut}
          className="mt-3 cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2.5 text-[13px] font-extrabold text-muted hover:border-orange"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
