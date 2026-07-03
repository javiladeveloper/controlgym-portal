import { LogoMark } from '../../components/icons.jsx'

// Preview aislado de la marca: mini-app con los colores EN EDICIÓN.
export default function BrandPreview({ t }) {
  const font = t.font_family || 'Manrope'
  return (
    <div className="overflow-hidden rounded-card border border-line" style={{ fontFamily: font, background: t.color_canvas }}>
      <div className="flex h-[380px]">
        {/* sidebar */}
        <div className="flex w-[132px] flex-shrink-0 flex-col p-3" style={{ background: t.color_navy }}>
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg" style={{ background: t.color_primary }}>
              {t.logo_url ? <img src={t.logo_url} alt="" className="h-full w-full object-cover" /> : <LogoMark size={15} />}
            </div>
            <div className="truncate text-[12px] font-extrabold text-white">{t.nombre_marca || 'Marca'}</div>
          </div>
          <div className="mt-1 text-[8px] font-extrabold uppercase tracking-wider" style={{ color: t.color_primary }}>Socios</div>
          {['Clientes', 'Membresías', 'Clases'].map((it, i) => (
            <div key={it} className="mt-1 rounded-md px-2 py-1.5 text-[11px] font-bold"
              style={i === 0 ? { background: t.color_navy_soft || '#1D2740', color: '#fff' } : { color: '#9AA3B5' }}>
              {it}
            </div>
          ))}
        </div>
        {/* contenido */}
        <div className="flex-1 p-3.5" style={{ background: t.color_canvas }}>
          <div className="text-[14px] font-extrabold" style={{ color: t.color_navy }}>Dashboard</div>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            <div className="rounded-lg border p-2" style={{ background: '#fff', borderColor: t.color_line }}>
              <div className="text-[8px] font-extrabold uppercase" style={{ color: '#5B6472' }}>Socios</div>
              <div className="text-[16px] font-extrabold" style={{ color: t.color_navy }}>312</div>
            </div>
            <div className="rounded-lg border p-2" style={{ background: '#fff', borderColor: t.color_line }}>
              <div className="text-[8px] font-extrabold uppercase" style={{ color: '#5B6472' }}>Activos</div>
              <div className="text-[16px] font-extrabold" style={{ color: t.color_success }}>+18</div>
            </div>
            <div className="rounded-lg border p-2" style={{ background: t.color_surface, borderColor: t.color_line }}>
              <div className="text-[8px] font-extrabold uppercase" style={{ color: t.color_primary }}>Por vencer</div>
              <div className="text-[16px] font-extrabold" style={{ color: t.color_primary }}>23</div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button className="rounded-lg px-3 py-1.5 text-[11px] font-extrabold text-white" style={{ background: t.color_primary }}>Renovar</button>
            <button className="rounded-lg border px-3 py-1.5 text-[11px] font-extrabold" style={{ borderColor: t.color_primary, color: t.color_primary, background: 'transparent' }}>Congelar</button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: '#E6F5EF', color: t.color_success }}>Activa</span>
            <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: '#FCEAEA', color: t.color_danger }}>Vencida</span>
          </div>
          <div className="mt-3 rounded-lg border" style={{ borderColor: t.color_line, background: '#fff' }}>
            <div className="flex items-center gap-2 px-2.5 py-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-extrabold" style={{ background: t.color_surface, color: t.color_navy }}>CM</div>
              <div className="text-[11px] font-bold" style={{ color: t.color_navy }}>Carlos Mendoza</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
