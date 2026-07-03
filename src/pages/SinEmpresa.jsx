import { useAuth } from '../context/AuthContext.jsx'
import { LogoMark } from '../components/icons.jsx'

// Fallback: usuario autenticado pero sin empresa asignada.
export default function SinEmpresa() {
  const { signOut, usuario } = useAuth()
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-[420px] rounded-card border border-line bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-orange">
          <LogoMark size={24} />
        </div>
        <h1 className="text-[18px] font-extrabold">Sin empresa asignada</h1>
        <p className="mt-2 text-[13px] font-semibold text-muted">
          {usuario?.nombre ? `Hola ${usuario.nombre}. ` : ''}
          Tu cuenta aún no está vinculada a ningún gimnasio. Contacta al administrador.
        </p>
        <button
          onClick={signOut}
          className="mt-5 cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2.5 text-[13px] font-extrabold text-ink hover:border-orange"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
