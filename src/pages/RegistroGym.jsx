import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { FitControlLogo } from '../components/icons.jsx'
import { ROOT_DOMAIN } from '../lib/tenant.js'

function normalizaSlug(s) {
  return (s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')       // sin tildes
    .replace(/[^a-z0-9-\s]/g, '').replace(/\s+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '')
}

import { planesPorCategoria } from '../config/planesComerciales.js'

export default function RegistroGym() {
  const navigate = useNavigate()
  const { usuario, empresas, reloadBootstrap } = useAuth()
  const [nombre, setNombre] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTocado, setSlugTocado] = useState(false)
  const [categoria, setCategoria] = useState('fitness')
  const [plan, setPlan] = useState('crecimiento')
  const [conApp, setConApp] = useState(false)

  // Planes disponibles según el tipo de negocio elegido
  const planesDisponibles = planesPorCategoria(categoria)
  const planActual = planesDisponibles.find((p) => p.slug === plan) || planesDisponibles[0]

  function onCategoria(codigo) {
    setCategoria(codigo)
    const disponibles = planesPorCategoria(codigo)
    // Si el plan elegido no aplica al nuevo segmento, tomar el default
    if (!disponibles.some((p) => p.slug === plan)) {
      setPlan(disponibles.find((p) => p.popular)?.slug || disponibles[0].slug)
    }
  }
  const [acepta, setAcepta] = useState(false)
  const [check, setCheck] = useState(null) // null | 'checking' | 'ok' | 'taken'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const categorias = useQuery({
    queryKey: ['categorias-gym'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categoria_gym').select('codigo, nombre, descripcion').order('nombre')
      if (error) throw error
      return data
    },
  })

  // Slug sugerido desde el nombre (mientras el usuario no lo edite a mano)
  useEffect(() => {
    if (!slugTocado) setSlug(normalizaSlug(nombre))
  }, [nombre, slugTocado])

  // Verificar disponibilidad del slug
  useEffect(() => {
    if (!slug) { setCheck(null); return }
    let active = true
    setCheck('checking')
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('slug_disponible', { p_slug: slug, p_empresa_id: '00000000-0000-0000-0000-000000000000' })
      if (active) setCheck(data ? 'ok' : 'taken')
    }, 350)
    return () => { active = false; clearTimeout(t) }
  }, [slug])

  async function onRegistrar(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('registrar_empresa', {
        p_nombre: nombre.trim(),
        p_slug: slug,
        p_categoria_codigo: categoria,
      })
      if (error) throw error
      // Guardar el plan elegido (no bloquea el registro si falla)
      if (data?.empresa_id) {
        await supabase.rpc('elegir_plan', { p_empresa_id: data.empresa_id, p_plan: plan, p_con_app: conApp })
      }
      await reloadBootstrap()
      navigate('/bienvenida', { replace: true })
    } catch (err) {
      setError(err?.message || 'No se pudo registrar el gimnasio')
    } finally {
      setBusy(false)
    }
  }

  const puede = nombre.trim().length >= 2 && slug.length >= 2 && check === 'ok' && acepta && !busy

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[480px]">
        <div className="mb-6 flex items-center gap-3">
          <a href="https://fitcorecenter.com" title="Ir a fitcorecenter.com" className="transition-opacity hover:opacity-75">
            <FitControlLogo size={44} />
          </a>
          <div>
            <div className="text-[20px] font-extrabold tracking-[-0.3px]">Registra tu gimnasio</div>
            <div className="text-[12px] font-semibold text-muted">
              {usuario?.nombre ? `Hola ${usuario.nombre.split(' ')[0]} · ` : ''}Crea tu espacio en minutos
            </div>
          </div>
        </div>

        <form onSubmit={onRegistrar} className="rounded-card border border-line bg-white p-7 shadow-[0_10px_40px_rgba(20,27,46,0.06)]">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Nombre del gimnasio</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="PowerGym" required
              className="rounded-[10px] border border-line bg-white px-3.5 py-3 text-[14px] outline-none focus:border-orange" />
          </label>

          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Tu dirección web</span>
            <div className="flex items-center overflow-hidden rounded-[10px] border border-line focus-within:border-orange">
              <input value={slug} onChange={(e) => { setSlugTocado(true); setSlug(normalizaSlug(e.target.value)) }} placeholder="powergym"
                className="flex-1 bg-white px-3.5 py-3 text-[14px] outline-none" />
              <span className="bg-surface px-3 py-3 text-[13px] font-bold text-muted">.{ROOT_DOMAIN}</span>
            </div>
            {check === 'checking' && <span className="text-[11.5px] font-semibold text-faint">Verificando…</span>}
            {check === 'ok' && <span className="text-[11.5px] font-extrabold text-green-600">✓ Disponible</span>}
            {check === 'taken' && <span className="text-[11.5px] font-extrabold text-red">Ya está en uso, prueba otro</span>}
          </label>

          <div className="mt-4">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Tipo de gimnasio</span>
            <div className="mt-2 flex flex-col gap-2">
              {(categorias.data || []).map((c) => (
                <label key={c.codigo}
                  className={`flex cursor-pointer items-start gap-3 rounded-[10px] border p-3 transition-colors ${categoria === c.codigo ? 'border-orange bg-orange-50' : 'border-line bg-white hover:border-orange'}`}>
                  <input type="radio" name="categoria" value={c.codigo} checked={categoria === c.codigo}
                    onChange={() => onCategoria(c.codigo)} className="mt-0.5 accent-orange-600" />
                  <span>
                    <span className="block text-[13.5px] font-extrabold">{c.nombre}</span>
                    <span className="block text-[11.5px] font-semibold text-muted">{c.descripcion}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* El mes gratis es EL mensaje — y es 1 por persona (correo Google) */}
          <div className={`mt-5 rounded-[10px] border px-4 py-3 ${empresas.length > 0 ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
            {empresas.length > 0 ? (
              <div className="text-[12.5px] font-bold text-amber-800">
                ℹ️ Tu mes gratis ya lo usaste con tu primer negocio. Este nuevo espacio se activa
                agregando tu tarjeta — y tu primer cobro igual sale recién en 1 mes.
              </div>
            ) : (
              <div className="text-[13px] font-extrabold text-green-700">
                🎁 Tu primer mes es GRATIS — todo incluido, sin tarjeta.
                <span className="block text-[11.5px] font-semibold text-green-800/80">
                  Un mes gratis por persona. Después, solo el plan que elijas abajo.
                </span>
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Tu plan</span>
            </div>
            <div className={`mt-2 grid gap-2 ${planesDisponibles.length === 1 ? 'grid-cols-1' : 'grid-cols-3'}`}>
              {planesDisponibles.map((p) => (
                <label key={p.slug}
                  className={`relative flex cursor-pointer flex-col rounded-[10px] border p-2.5 text-center transition-colors ${plan === p.slug ? 'border-orange bg-orange-50' : 'border-line bg-white hover:border-orange'}`}>
                  {p.popular && <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-orange px-2 py-[1px] text-[8.5px] font-extrabold uppercase text-white">Popular</span>}
                  <input type="radio" name="plan" value={p.slug} checked={plan === p.slug} onChange={() => setPlan(p.slug)} className="sr-only" />
                  <span className="text-[12.5px] font-extrabold">{p.nombre}</span>
                  <span className="text-[15px] font-extrabold text-orange">S/ {conApp ? p.conApp : p.base}<span className="text-[10px] font-bold text-muted">/mes</span></span>
                  <span className="mt-0.5 text-[9.5px] font-semibold leading-tight text-muted">{p.para}</span>
                </label>
              ))}
            </div>
            <label className="mt-2.5 flex items-start gap-2">
              <input type="checkbox" checked={conApp} onChange={(e) => setConApp(e.target.checked)} className="mt-0.5 h-4 w-4 accent-orange-600" />
              <span className="text-[12.5px] font-bold">
                📱 App para mis {categoria === 'personal_trainer' ? 'clientes' : categoria === 'ninos' ? 'apoderados' : 'socios'}{' '}
                <b className="text-orange">+S/ {(planActual?.conApp ?? 0) - (planActual?.base ?? 0)}/mes</b>{' '}
                <span className="font-semibold text-muted">— cubre a todos (disponible muy pronto; se cobra recién cuando la actives)</span>
              </span>
            </label>
            {conApp && (
              <ul className="ml-6 mt-2 space-y-1 rounded-[10px] bg-surface px-3.5 py-2.5 text-[11.5px] font-semibold text-muted">
                {(categoria === 'ninos' ? [
                  '👀 Los papás ven la asistencia de su hijo y las cámaras de la clase en vivo',
                  '📅 Reservan y consultan el horario de actividades desde el celular',
                  '💳 Ven el estado de su mensualidad y reciben recordatorios de pago',
                ] : categoria === 'personal_trainer' ? [
                  '🏋️ Tus clientes ven su rutina y su plan de alimentación en el celular',
                  '📅 Reservan sus sesiones contigo sin escribirte por WhatsApp',
                  '💳 Ven cuántas sesiones les quedan de su paquete',
                ] : categoria === 'clases' ? [
                  '📅 Tus alumnos reservan sus clases y ven los cupos en tiempo real',
                  '💳 Consultan su membresía y cuántas clases les quedan',
                  '🔔 Reciben avisos de cambios de horario y promociones',
                ] : [
                  '🏋️ Tus socios ven su rutina y dieta asignadas por tu entrenador',
                  '📅 Reservan clases y hacen check-in desde el celular',
                  '💳 Consultan su membresía y reciben recordatorio antes de vencer',
                ]).map((b) => <li key={b}>{b}</li>)}
                <li className="pt-0.5 text-[11px] text-faint">Todo con tu marca y tus colores — además apareces en el buscador de la app.</li>
              </ul>
            )}
          </div>

          <label className="mt-4 flex items-start gap-2">
            <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} className="mt-0.5 h-4 w-4 accent-orange-600" />
            <span className="text-[12px] font-semibold text-muted">
              Acepto los{' '}
              <a href={`https://${ROOT_DOMAIN}/terminos`} target="_blank" rel="noreferrer" className="font-extrabold text-orange underline">términos y condiciones</a>
              {' '}y la{' '}
              <a href={`https://${ROOT_DOMAIN}/privacidad`} target="_blank" rel="noreferrer" className="font-extrabold text-orange underline">política de privacidad</a>
            </span>
          </label>

          {error && <div className="mt-4 rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}

          <button type="submit" disabled={!puede}
            className="mt-5 w-full cursor-pointer rounded-[11px] border-none bg-orange py-3 text-[14.5px] font-extrabold text-white shadow-[0_4px_14px_rgba(255,107,53,0.32)] transition-colors hover:bg-orange-600 active:scale-[0.99] disabled:opacity-50">
            {busy ? 'Creando tu espacio…' : empresas.length > 0 ? 'Crear mi negocio' : 'Crear mi negocio — empezar mi mes gratis'}
          </button>

          <p className="mt-3 text-center text-[11.5px] font-semibold text-faint">
            Tendrás tu panel de gestión y tu página web {slug ? <b className="text-ink">{slug}.{ROOT_DOMAIN}</b> : 'propia'} al instante.
          </p>
        </form>

        {empresas.length > 0 && (
          <button onClick={() => navigate('/dashboard')} className="mx-auto mt-4 block text-[12.5px] font-extrabold text-muted hover:text-orange">
            ← Volver a mi panel
          </button>
        )}
      </div>
    </div>
  )
}
