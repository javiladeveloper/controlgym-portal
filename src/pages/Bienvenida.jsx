import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { FitControlLogo } from '../components/icons.jsx'
import LoadingOverlay from '../components/LoadingOverlay.jsx'
import { ROOT_DOMAIN } from '../lib/tenant.js'

// Asistente de bienvenida: 3-4 preguntas según el TIPO de negocio y armamos
// su espacio con datos reales (disciplinas, planes con sus precios, contacto,
// marca). Todo saltable — si salta, se queda el seed genérico del registro.

// El tipo de negocio se infiere del plan comercial (columna empresa.plan_slug)
const TIPO_POR_PLAN = { academia: 'clases', ninos: 'ninos', trainer: 'personal_trainer' }

// ── Preguntas por tipo ───────────────────────────────────────────────────────
const DISCIPLINAS = {
  fitness: [
    { nombre: 'Musculación', color: '#E24B4A', acceso_libre: true, fijo: true },
    { nombre: 'Funcional', color: '#FF6B35' }, { nombre: 'Spinning', color: '#1D9E75' },
    { nombre: 'Box', color: '#374151' }, { nombre: 'CrossFit', color: '#7C3AED' },
    { nombre: 'Zumba', color: '#E11D48' }, { nombre: 'Yoga', color: '#8B5CF6' },
    { nombre: 'HIIT', color: '#F59E0B' }, { nombre: 'Pilates', color: '#059669' },
    { nombre: 'Baile', color: '#EC4899' },
  ],
  clases: [
    { nombre: 'Yoga', color: '#8B5CF6' }, { nombre: 'Pilates', color: '#059669' },
    { nombre: 'Baile', color: '#E11D48' }, { nombre: 'Ballet', color: '#EC4899' },
    { nombre: 'Marinera', color: '#B45309' }, { nombre: 'Jiu-Jitsu Brasileño', color: '#1D4ED8' },
    { nombre: 'Muay Thai', color: '#DC2626' }, { nombre: 'Karate', color: '#0C0A09' },
    { nombre: 'Box', color: '#374151' }, { nombre: 'MMA', color: '#111827' },
    { nombre: 'Zumba', color: '#F97316' }, { nombre: 'Stretching', color: '#2563EB' },
  ],
  ninos: [
    { nombre: 'Psicomotricidad', color: '#2563EB' }, { nombre: 'Baile infantil', color: '#E11D48' },
    { nombre: 'Karate niños', color: '#0C0A09' }, { nombre: 'Mini funcional', color: '#F97316' },
    { nombre: 'Ballet', color: '#EC4899' }, { nombre: 'Fútbol', color: '#16A34A' },
    { nombre: 'Gimnasia', color: '#8B5CF6' }, { nombre: 'Vacaciones útiles', color: '#0EA5E9' },
  ],
  personal_trainer: [
    { nombre: 'Sesión personal', color: '#FF6B35' }, { nombre: 'Sesión en pareja', color: '#2563EB' },
    { nombre: 'Grupo pequeño', color: '#059669' }, { nombre: 'Entrenamiento online', color: '#8B5CF6' },
  ],
}

const PLANES_SUGERIDOS = {
  fitness: [
    { nombre: 'Mensual', precio: 80, unidad: 'mes', popular: true, congela: 15 },
    { nombre: 'Trimestral', precio: 210, unidad: 'trimestre', congela: 15 },
    { nombre: 'Anual', precio: 700, unidad: 'anual', congela: 30 },
    { nombre: 'Por día', precio: 10, unidad: 'dia' },
  ],
  clases: [
    { nombre: 'Mensual ilimitado', precio: 150, unidad: 'mes', popular: true, congela: 15 },
    { nombre: 'Mensual 8 clases', precio: 100, unidad: 'mes' },
    { nombre: 'Clase suelta', precio: 20, unidad: 'dia' },
  ],
  ninos: [
    { nombre: 'Mensual', precio: 150, unidad: 'mes', popular: true },
    { nombre: 'Plan Hermanos', precio: 250, unidad: 'mes', descripcion: 'Hasta 2 hermanos' },
    { nombre: 'Vacaciones útiles', precio: 200, unidad: 'mes' },
  ],
  personal_trainer: [
    { nombre: 'Mensual 12 sesiones', precio: 350, unidad: 'mes', popular: true },
    { nombre: 'Paquete 8 sesiones', precio: 260, unidad: 'mes' },
    { nombre: 'Sesión suelta', precio: 40, unidad: 'dia' },
  ],
}

const TITULOS = {
  fitness: { q1: '¿Qué tiene tu gimnasio?', q2: '¿Cómo cobras a tus socios?', gente: 'socios' },
  clases: { q1: '¿Qué clases dictas?', q2: '¿Cómo cobras a tus alumnos?', gente: 'alumnos' },
  ninos: { q1: '¿Qué actividades tienen los niños?', q2: '¿Cómo cobras a los papás?', gente: 'alumnos' },
  personal_trainer: { q1: '¿Qué tipos de sesión ofreces?', q2: '¿Cómo cobras tus paquetes?', gente: 'clientes' },
}

const COLORES_MARCA = ['#FF6B35', '#E11D48', '#DC2626', '#7C3AED', '#2563EB', '#0EA5E9', '#059669', '#F59E0B', '#0C0A09']

const chipCls = (on) =>
  `cursor-pointer rounded-full border px-4 py-2 text-[13px] font-extrabold transition-colors ${on ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-muted hover:border-orange'}`

export default function Bienvenida() {
  const navigate = useNavigate()
  const { empresa, reloadBootstrap } = useAuth()
  const tipo = TIPO_POR_PLAN[empresa?.plan_slug] || 'fitness'
  const esCadena = empresa?.plan_slug === 'cadena'
  const t = TITULOS[tipo]

  const [paso, setPaso] = useState(0)
  const [aplicando, setAplicando] = useState(false)
  const [error, setError] = useState('')

  // P1: disciplinas (las fijas empiezan elegidas)
  const [elegidas, setElegidas] = useState(() => DISCIPLINAS[tipo].filter((d) => d.fijo).map((d) => d.nombre))
  const [extra, setExtra] = useState('')
  const [extras, setExtras] = useState([])
  // P2: planes con precio editable
  const [planes, setPlanes] = useState(() => PLANES_SUGERIDOS[tipo].map((p) => ({ ...p, on: !!p.popular, precio: String(p.precio) })))
  const [matricula, setMatricula] = useState('')
  // P3: contacto
  const [horario, setHorario] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [direccion, setDireccion] = useState('')
  const [sedesExtra, setSedesExtra] = useState(esCadena ? [''] : [])
  // P4: color
  const [color, setColor] = useState('#FF6B35')

  const total = 4
  const toggleDisciplina = (n, fijo) => {
    if (fijo) return
    setElegidas((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]))
  }

  async function aplicar() {
    setAplicando(true); setError('')
    try {
      // Geocodificar la dirección para el mapa (best effort)
      let ubicacion = null
      if (direccion.trim()) {
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&q=${encodeURIComponent(direccion + ', Perú')}`)
          const j = await r.json()
          if (j?.[0]) ubicacion = { lat: j[0].lat, lng: j[0].lon, direccion: direccion.trim() }
        } catch { /* sin mapa, no pasa nada */ }
      }

      const catalogo = DISCIPLINAS[tipo]
      const config = {
        disciplinas: [
          ...catalogo.filter((d) => elegidas.includes(d.nombre)).map(({ nombre, color, acceso_libre }) => ({ nombre, color, acceso_libre: !!acceso_libre })),
          ...extras.map((nombre, i) => ({ nombre, color: COLORES_MARCA[i % COLORES_MARCA.length] })),
        ],
        planes: planes.filter((p) => p.on && Number(p.precio) > 0).map((p) => ({
          nombre: p.nombre, precio: Number(p.precio), unidad: p.unidad,
          popular: !!p.popular, congela: p.congela || 0,
          matricula: Number(matricula) || 0, descripcion: p.descripcion || '',
        })),
        horario: horario.trim(), whatsapp: whatsapp.trim(), direccion: direccion.trim(),
        ubicacion,
        sedes: sedesExtra.map((s) => s.trim()).filter(Boolean),
        color,
      }

      const { error } = await supabase.rpc('aplicar_onboarding', { p_empresa_id: empresa.id, p_config: config })
      if (error) throw error
      await reloadBootstrap()
      setPaso(total) // pantalla final
    } catch (e) {
      setError(e.message)
    } finally {
      setAplicando(false)
    }
  }

  if (!empresa) return null

  return (
    <div className="flex min-h-screen items-start justify-center bg-canvas px-4 py-10">
      {aplicando && <LoadingOverlay texto="Armando tu espacio…" sub="Creando tus clases, planes y página web" />}
      <div className="w-full max-w-[560px]">
        <div className="mb-6 flex items-center gap-3">
          <FitControlLogo size={44} />
          <div>
            <div className="text-[20px] font-extrabold tracking-[-0.3px]">¡Bienvenido, {empresa.nombre}! 🎉</div>
            <div className="text-[12px] font-semibold text-muted">
              {paso < total ? `Cuéntanos de tu negocio y te lo dejamos armado · paso ${paso + 1} de ${total}` : 'Tu espacio está listo'}
            </div>
          </div>
        </div>

        {/* Barra de progreso */}
        {paso < total && (
          <div className="mb-5 flex gap-1.5">
            {Array.from({ length: total }).map((_, i) => (
              <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= paso ? 'bg-orange' : 'bg-line'}`} />
            ))}
          </div>
        )}

        <div className="rounded-card border border-line bg-white p-7 shadow-[0_10px_40px_rgba(20,27,46,0.06)]">
          {/* ── PASO 1: disciplinas ── */}
          {paso === 0 && (
            <>
              <h2 className="text-[18px] font-extrabold">{t.q1}</h2>
              <p className="mt-1 text-[12.5px] font-semibold text-muted">Marca todo lo que ofreces — creamos tus servicios y un horario de ejemplo.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {DISCIPLINAS[tipo].map((d) => (
                  <button key={d.nombre} onClick={() => toggleDisciplina(d.nombre, d.fijo)}
                    className={chipCls(elegidas.includes(d.nombre)) + (d.fijo ? ' opacity-90' : '')}
                    title={d.fijo ? 'Incluida siempre en un gimnasio' : ''}>
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: d.color }} />
                    {d.nombre}{d.fijo ? ' ✓' : ''}
                  </button>
                ))}
                {extras.map((n) => (
                  <button key={n} onClick={() => setExtras((s) => s.filter((x) => x !== n))} className={chipCls(true)}>{n} ✕</button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input value={extra} onChange={(e) => setExtra(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && extra.trim()) { setExtras((s) => [...s, extra.trim()]); setExtra('') } }}
                  placeholder="¿Otra? Escríbela y Enter"
                  className="flex-1 rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[13px] outline-none focus:border-orange" />
              </div>
            </>
          )}

          {/* ── PASO 2: planes y precios ── */}
          {paso === 1 && (
            <>
              <h2 className="text-[18px] font-extrabold">{t.q2}</h2>
              <p className="mt-1 text-[12.5px] font-semibold text-muted">Activa los que ofreces y pon TUS precios — así tus planes nacen reales.</p>
              <div className="mt-4 flex flex-col gap-2">
                {planes.map((p, i) => (
                  <div key={p.nombre} className={`flex items-center gap-3 rounded-[10px] border p-3 ${p.on ? 'border-orange bg-orange-50/50' : 'border-line'}`}>
                    <input type="checkbox" checked={p.on}
                      onChange={(e) => setPlanes((s) => s.map((x, j) => j === i ? { ...x, on: e.target.checked } : x))}
                      className="h-4 w-4 accent-orange-600" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-extrabold">{p.nombre} {p.popular && <span className="ml-1 rounded-full bg-orange px-2 py-0.5 text-[9px] font-extrabold text-white">POPULAR</span>}</div>
                      {p.descripcion && <div className="text-[11px] font-semibold text-muted">{p.descripcion}</div>}
                    </div>
                    <div className="flex items-center gap-1 text-[13px] font-extrabold">
                      S/ <input type="number" min="0" value={p.precio} disabled={!p.on}
                        onChange={(e) => setPlanes((s) => s.map((x, j) => j === i ? { ...x, precio: e.target.value } : x))}
                        className="w-[76px] rounded-[8px] border border-line bg-white px-2 py-1.5 text-[13px] font-extrabold outline-none focus:border-orange disabled:opacity-40" />
                    </div>
                  </div>
                ))}
              </div>
              {tipo !== 'personal_trainer' && (
                <label className="mt-3.5 flex items-center gap-2 text-[13px] font-bold">
                  ¿Cobras matrícula (pago único al inscribirse)? S/
                  <input type="number" min="0" value={matricula} onChange={(e) => setMatricula(e.target.value)}
                    placeholder="0" className="w-[80px] rounded-[8px] border border-line bg-white px-2 py-1.5 text-[13px] font-extrabold outline-none focus:border-orange" />
                </label>
              )}
            </>
          )}

          {/* ── PASO 3: contacto (+sedes si es cadena) ── */}
          {paso === 2 && (
            <>
              <h2 className="text-[18px] font-extrabold">Datos de tu negocio</h2>
              <p className="mt-1 text-[12.5px] font-semibold text-muted">Con esto tu página web sale completa: contacto, horario y mapa.</p>
              <div className="mt-4 flex flex-col gap-3.5">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">WhatsApp del negocio</span>
                  <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="999 888 777"
                    className="rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-orange" />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Dirección (para el mapa de tu página)</span>
                  <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Av. Principal 123, Tacna"
                    className="rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-orange" />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Horario de atención</span>
                  <input value={horario} onChange={(e) => setHorario(e.target.value)} placeholder="Lun–Vie 6:00–22:00 · Sáb 8:00–13:00"
                    className="rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-orange" />
                </label>
                {esCadena && (
                  <div>
                    <span className="text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">¿Tienes más sedes? Agrégalas</span>
                    {sedesExtra.map((s, i) => (
                      <input key={i} value={s}
                        onChange={(e) => setSedesExtra((arr) => arr.map((x, j) => j === i ? e.target.value : x))}
                        placeholder={`Sede ${i + 2} (ej. Sede Norte)`}
                        className="mt-2 w-full rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-orange" />
                    ))}
                    <button onClick={() => setSedesExtra((s) => [...s, ''])}
                      className="mt-2 cursor-pointer rounded-[9px] border border-dashed border-line bg-white px-3 py-1.5 text-[12px] font-extrabold text-muted hover:border-orange hover:text-orange">
                      + Otra sede
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── PASO 4: color de marca ── */}
          {paso === 3 && (
            <>
              <h2 className="text-[18px] font-extrabold">El color de tu marca</h2>
              <p className="mt-1 text-[12.5px] font-semibold text-muted">Tu panel y tu página web lo usarán en botones y detalles. (El logo lo subes después en Configuración → Marca.)</p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                {COLORES_MARCA.map((c) => (
                  <button key={c} onClick={() => setColor(c)}
                    className={`h-11 w-11 cursor-pointer rounded-full border-4 transition-transform hover:scale-110 ${color === c ? 'border-navy' : 'border-white shadow'}`}
                    style={{ background: c }} title={c} />
                ))}
                <label className="flex h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-white px-3 text-[12px] font-extrabold text-muted hover:border-orange">
                  Otro <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-9 cursor-pointer border-none bg-transparent p-0" />
                </label>
              </div>
              <div className="mt-5 rounded-[12px] border border-line p-4">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.5px] text-muted">Así se verá</div>
                <button className="mt-2 rounded-[10px] border-none px-5 py-2.5 text-[13.5px] font-extrabold text-white" style={{ background: color }}>
                  Inscríbete ahora
                </button>
              </div>
            </>
          )}

          {/* ── FINAL ── */}
          {paso === total && (
            <div className="text-center">
              <div className="text-[52px]">🎉</div>
              <h2 className="mt-2 text-[20px] font-extrabold">¡{empresa.nombre} está listo!</h2>
              <p className="mx-auto mt-2 max-w-[380px] text-[13px] font-semibold text-muted">
                Tus {t.gente}, clases, planes y página web ya están armados con tu información. Todo se puede afinar desde el panel.
              </p>
              <div className="mt-6 flex flex-col gap-2.5">
                <a href={`/?g=${empresa.slug}`} target="_blank" rel="noreferrer"
                  className="rounded-[11px] border border-orange bg-orange-50 py-3 text-[14px] font-extrabold text-orange hover:bg-orange-100">
                  🌐 Ver mi página web
                </a>
                <button onClick={() => navigate('/dashboard', { replace: true })}
                  className="cursor-pointer rounded-[11px] border-none bg-orange py-3 text-[14.5px] font-extrabold text-white shadow-[0_4px_14px_rgba(255,107,53,0.32)] hover:bg-orange-600">
                  Ir a mi panel →
                </button>
              </div>
            </div>
          )}

          {error && <div className="mt-4 rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}

          {/* Navegación */}
          {paso < total && (
            <div className="mt-6 flex items-center justify-between">
              <button onClick={() => navigate('/dashboard', { replace: true })}
                className="cursor-pointer border-none bg-transparent text-[12.5px] font-extrabold text-faint hover:text-muted">
                Configurar después
              </button>
              <div className="flex gap-2">
                {paso > 0 && (
                  <button onClick={() => setPaso(paso - 1)}
                    className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2.5 text-[13px] font-extrabold text-muted">← Atrás</button>
                )}
                <button onClick={() => (paso === total - 1 ? aplicar() : setPaso(paso + 1))}
                  disabled={aplicando}
                  className="cursor-pointer rounded-[10px] border-none bg-orange px-6 py-2.5 text-[13.5px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
                  {paso === total - 1 ? '✨ Armar mi espacio' : 'Siguiente →'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
