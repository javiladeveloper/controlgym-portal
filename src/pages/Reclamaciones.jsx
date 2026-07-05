import { useState } from 'react'
import { FitCoreLogo } from '../components/icons.jsx'
import { ROOT_DOMAIN } from '../lib/tenant.js'
import { supabase } from '../lib/supabaseClient.js'

// Libro de Reclamaciones virtual (Ley N° 29571 — Código de Protección y
// Defensa del Consumidor / INDECOPI). Nativo: guarda en nuestra BD y
// devuelve un correlativo LR-AAAA-####.
const C = { bg: '#141B2E', surface: '#1F293D', primary: '#FF6B35', muted: '#8E9AA8', border: '1px solid rgba(255,255,255,0.08)' }

const inputCls = 'w-full rounded-lg px-3.5 py-2.5 text-[13.5px] font-semibold text-white outline-none placeholder:text-white/25'
const inputStyle = { background: 'rgba(255,255,255,0.04)', border: C.border }

function Campo({ label, obligatorio, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-extrabold uppercase tracking-[0.6px]" style={{ color: C.muted }}>
        {label}{obligatorio && <span style={{ color: C.primary }}> *</span>}
      </span>
      {children}
    </label>
  )
}

export default function Reclamaciones() {
  const [f, setF] = useState({
    tipo: 'reclamo', nombre: '', documento: '', direccion: '', telefono: '', email: '',
    es_menor: false, apoderado: '', bien: '', monto: '', detalle: '', pedido: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [correlativo, setCorrelativo] = useState(null)

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  async function onEnviar(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const { data, error } = await supabase.rpc('crear_reclamacion', {
        p_tipo: f.tipo, p_nombre: f.nombre, p_documento: f.documento, p_email: f.email,
        p_bien: f.bien, p_detalle: f.detalle, p_pedido: f.pedido,
        p_direccion: f.direccion || null, p_telefono: f.telefono || null,
        p_monto: f.monto ? Number(f.monto) : null,
        p_es_menor: f.es_menor, p_apoderado: f.apoderado || null,
      })
      if (error) throw error
      setCorrelativo(data.correlativo)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err.message || 'No se pudo registrar. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen text-white" style={{ background: C.bg, fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <header className="sticky top-0 z-20 backdrop-blur" style={{ background: 'rgba(20,27,46,0.85)', borderBottom: C.border }}>
        <div className="mx-auto flex max-w-[840px] items-center justify-between px-6 py-3.5">
          <a href="/" className="flex items-center gap-2.5">
            <FitCoreLogo size={32} />
            <span className="text-[16px] font-extrabold tracking-[-0.3px]">FitCore</span>
          </a>
          <a href="/" className="text-[13px] font-extrabold transition-colors hover:text-white" style={{ color: C.muted }}>← Volver</a>
        </div>
      </header>

      <main className="mx-auto max-w-[840px] px-6 py-14">
        <div className="flex items-center gap-4">
          <span className="text-[42px]">📖</span>
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.8px]">Libro de Reclamaciones</h1>
            <p className="text-[13px] font-semibold" style={{ color: C.muted }}>
              Conforme al Código de Protección y Defensa del Consumidor (Ley N° 29571) — INDECOPI
            </p>
          </div>
        </div>
        <p className="mt-4 text-[13.5px] font-semibold leading-relaxed" style={{ color: C.muted }}>
          Razón social: <b className="text-white">FitCore · {ROOT_DOMAIN}</b> · Lima, Perú ·
          soporte@{ROOT_DOMAIN} · WhatsApp +51 986 110 558.
          Responderemos tu {f.tipo === 'queja' ? 'queja' : 'reclamo'} en un plazo máximo de <b className="text-white">15 días hábiles</b>.
        </p>

        {correlativo ? (
          <div className="mt-8 rounded-xl p-8 text-center" style={{ background: C.surface, border: C.border }}>
            <div className="text-[46px]">✅</div>
            <h2 className="mt-2 text-[22px] font-extrabold">Hoja registrada</h2>
            <p className="mt-2 text-[14px] font-semibold" style={{ color: C.muted }}>
              Tu número de {f.tipo} es
            </p>
            <div className="mt-2 text-[30px] font-extrabold" style={{ color: C.primary }}>{correlativo}</div>
            <p className="mx-auto mt-3 max-w-[420px] text-[13px] font-semibold leading-relaxed" style={{ color: C.muted }}>
              Guarda este número. Te responderemos al correo <b className="text-white">{f.email}</b> dentro
              de los 15 días hábiles establecidos por ley.
            </p>
            <a href="/" className="mt-6 inline-block rounded-lg px-6 py-3 text-[14px] font-extrabold text-white" style={{ background: C.primary }}>
              Volver al inicio
            </a>
          </div>
        ) : (
          <form onSubmit={onEnviar} className="mt-8 rounded-xl p-7" style={{ background: C.surface, border: C.border }}>
            {/* Tipo */}
            <div className="grid grid-cols-2 gap-3">
              {[
                ['reclamo', 'Reclamo', 'Disconformidad con el servicio contratado'],
                ['queja', 'Queja', 'Malestar respecto a la atención al público'],
              ].map(([v, t, d]) => (
                <label key={v} className="cursor-pointer rounded-lg p-4 transition-colors"
                  style={{ border: f.tipo === v ? `2px solid ${C.primary}` : C.border, background: f.tipo === v ? 'rgba(255,107,53,0.08)' : 'transparent' }}>
                  <input type="radio" name="tipo" value={v} checked={f.tipo === v} onChange={set('tipo')} className="sr-only" />
                  <div className="text-[14.5px] font-extrabold">{t}</div>
                  <div className="mt-0.5 text-[11.5px] font-semibold" style={{ color: C.muted }}>{d}</div>
                </label>
              ))}
            </div>

            {/* Datos del consumidor */}
            <div className="mt-6 text-[13px] font-extrabold uppercase tracking-[1px]" style={{ color: C.primary }}>1 · Tus datos</div>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo label="Nombre completo" obligatorio><input required value={f.nombre} onChange={set('nombre')} className={inputCls} style={inputStyle} placeholder="Juan Pérez García" /></Campo>
              <Campo label="DNI / CE" obligatorio><input required value={f.documento} onChange={set('documento')} className={inputCls} style={inputStyle} placeholder="12345678" /></Campo>
              <Campo label="Correo electrónico" obligatorio><input required type="email" value={f.email} onChange={set('email')} className={inputCls} style={inputStyle} placeholder="tucorreo@gmail.com" /></Campo>
              <Campo label="Teléfono"><input value={f.telefono} onChange={set('telefono')} className={inputCls} style={inputStyle} placeholder="999 999 999" /></Campo>
              <div className="sm:col-span-2">
                <Campo label="Dirección"><input value={f.direccion} onChange={set('direccion')} className={inputCls} style={inputStyle} placeholder="Av. Principal 123, Lima" /></Campo>
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2">
              <input type="checkbox" checked={f.es_menor} onChange={set('es_menor')} className="h-4 w-4 accent-orange-500" />
              <span className="text-[12.5px] font-bold" style={{ color: C.muted }}>Soy menor de edad</span>
            </label>
            {f.es_menor && (
              <div className="mt-3">
                <Campo label="Nombre del padre, madre o apoderado" obligatorio>
                  <input required value={f.apoderado} onChange={set('apoderado')} className={inputCls} style={inputStyle} />
                </Campo>
              </div>
            )}

            {/* Bien contratado */}
            <div className="mt-7 text-[13px] font-extrabold uppercase tracking-[1px]" style={{ color: C.primary }}>2 · Servicio contratado</div>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo label="Producto / servicio" obligatorio>
                <select required value={f.bien} onChange={set('bien')} className={inputCls} style={inputStyle}>
                  <option value="" disabled>Elige…</option>
                  <option value="Plan Estudio">Plan Estudio</option>
                  <option value="Plan Crecimiento">Plan Crecimiento</option>
                  <option value="Plan Cadena">Plan Cadena</option>
                  <option value="App del socio (adicional)">App del socio (adicional)</option>
                  <option value="Página web del gimnasio">Página web del gimnasio</option>
                  <option value="Otro">Otro</option>
                </select>
              </Campo>
              <Campo label="Monto reclamado (S/)"><input type="number" step="0.01" min="0" value={f.monto} onChange={set('monto')} className={inputCls} style={inputStyle} placeholder="0.00" /></Campo>
            </div>

            {/* Detalle */}
            <div className="mt-7 text-[13px] font-extrabold uppercase tracking-[1px]" style={{ color: C.primary }}>3 · Detalle de tu {f.tipo}</div>
            <div className="mt-3 flex flex-col gap-4">
              <Campo label={`Descripción de ${f.tipo === 'queja' ? 'la queja' : 'lo ocurrido'}`} obligatorio>
                <textarea required rows={4} value={f.detalle} onChange={set('detalle')} className={inputCls} style={inputStyle} placeholder="Cuéntanos con detalle qué pasó…" />
              </Campo>
              <Campo label="Tu pedido concreto" obligatorio>
                <textarea required rows={2} value={f.pedido} onChange={set('pedido')} className={inputCls} style={inputStyle} placeholder="¿Qué solución esperas? (devolución, corrección, disculpas…)" />
              </Campo>
            </div>

            {error && <div className="mt-5 rounded-lg bg-red-500/10 px-4 py-3 text-[13px] font-bold text-red-400">{error}</div>}

            <button type="submit" disabled={busy}
              className="mt-6 w-full rounded-lg py-3.5 text-[15px] font-extrabold text-white transition-transform hover:scale-[1.01] disabled:opacity-50"
              style={{ background: C.primary, boxShadow: '0 10px 30px rgba(255,107,53,0.3)' }}>
              {busy ? 'Registrando…' : 'Registrar hoja de reclamación'}
            </button>
            <p className="mt-3 text-center text-[11px] font-semibold" style={{ color: 'rgba(142,154,168,0.6)' }}>
              La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito
              previo para interponer una denuncia ante INDECOPI.
            </p>
          </form>
        )}
      </main>
    </div>
  )
}
