import { NavLink } from 'react-router-dom'
import { LogoMark } from './icons.jsx'
import { groupedModules } from '../config/modules.js'
import { useAuth } from '../context/AuthContext.jsx'
import { usePanel } from '../store.jsx'

const ROL_LABEL = {
  admin: 'Administrador',
  recepcion: 'Recepción',
  entrenador: 'Entrenador',
  nutricionista: 'Nutricionista',
  mantenimiento: 'Mantenimiento',
}

function iniciales(nombre) {
  if (!nombre) return '?'
  return nombre.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
}

export default function Sidebar() {
  const { empresa, usuario, rol, tema, enabledModules, empresas, esSuperadmin, setEmpresaActiva, signOut } = useAuth()
  const { sedes, sedeId, setSede } = usePanel()

  const grupos = groupedModules(enabledModules, rol, esSuperadmin)
  const marca = tema?.nombre_marca || empresa?.nombre || 'FitCore'

  return (
    <aside className="flex h-full w-[230px] flex-shrink-0 flex-col overflow-y-auto bg-navy px-3.5 py-[22px]">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-2.5 pb-[22px]">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-orange">
          {tema?.logo_url
            ? <img src={tema.logo_url} alt="logo" className="h-full w-full object-cover" />
            : <LogoMark size={19} />}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[16px] font-extrabold tracking-[-0.3px] text-white">{marca}</div>
          <div className="text-[10.5px] font-semibold text-faint">Panel de gestión</div>
        </div>
      </div>

      {/* Selector de empresa (solo si el usuario pertenece a varias) */}
      {empresas.length > 1 && (
        <select
          value={empresa?.id || ''}
          onChange={async (e) => {
            try { await setEmpresaActiva(e.target.value) }
            catch (err) { alert('No se pudo cambiar de negocio: ' + err.message) }
          }}
          className="mx-0.5 mb-2 cursor-pointer rounded-[10px] border border-white/[0.14] bg-navy-700 px-[11px] py-2 text-[12px] font-extrabold text-white outline-none"
        >
          {empresas.map((em) => (
            <option key={em.empresa_id} value={em.empresa_id}>{em.nombre}</option>
          ))}
        </select>
      )}

      {/* Selector de sede */}
      {sedes.length > 0 && (
        <select
          value={sedeId || ''}
          onChange={(e) => setSede(e.target.value)}
          className="mx-0.5 mb-4 cursor-pointer rounded-[10px] border border-white/[0.14] bg-navy-700 px-[11px] py-[9px] text-[12.5px] font-extrabold text-white outline-none"
        >
          {sedes.map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      )}

      {/* Menú dinámico agrupado por categorías */}
      <nav className="flex flex-col gap-0.5">
        {grupos.map((g, gi) => (
          <div key={g.key}>
            {/* Encabezado de categoría: resaltado con color de marca + separador */}
            <div
              className={`flex items-center gap-2 px-3 pb-1.5 ${gi === 0 ? 'pt-1' : 'mt-2 border-t border-white/[0.07] pt-3'}`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-primary, #FF6B35)' }} />
              <span className="text-[11px] font-extrabold uppercase tracking-[1.2px] text-white/90">
                {g.label}
              </span>
            </div>
            <div className="flex flex-col gap-[3px]">
              {g.items.map((m) => (
                <NavLink
                  key={m.slug}
                  to={`/${m.slug}`}
                  className={({ isActive }) =>
                    `relative flex items-center rounded-[10px] px-3.5 py-2.5 text-[13.5px] transition-colors ${
                      isActive
                        ? 'bg-navy-700 font-extrabold text-white'
                        : 'font-semibold text-faint hover:bg-navy-700 hover:text-white'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className="absolute -left-3.5 bottom-[9px] top-[9px] w-[3.5px] rounded-r-[3px]"
                        style={{ background: isActive ? 'var(--color-primary, #FF6B35)' : 'transparent' }}
                      />
                      {m.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Usuario real + logout */}
      <div className="mt-auto flex items-center gap-2.5 px-2.5 pt-3.5">
        <div className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-navy-700 text-[13px] font-extrabold text-orange">
          {usuario?.avatar_iniciales || iniciales(usuario?.nombre)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-bold text-white">{usuario?.nombre || 'Usuario'}</div>
          <div className="text-[10.5px] font-semibold text-faint">{ROL_LABEL[rol] || rol || ''}</div>
        </div>
        <button
          onClick={signOut}
          title="Cerrar sesión"
          className="flex-shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-navy-700 hover:text-white"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <path d="M16 17l5-5-5-5M21 12H9" />
          </svg>
        </button>
      </div>
    </aside>
  )
}
