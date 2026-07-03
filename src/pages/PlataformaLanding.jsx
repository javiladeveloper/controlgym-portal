import { LogoMark } from '../components/icons.jsx'
import { ROOT_DOMAIN } from '../lib/tenant.js'

// Landing de la PLATAFORMA (fitcorecenter.com raíz): le vende FitControl a los
// dueños de gimnasios. Estática y pública — el CTA lleva al registro.
const APP_URL = `https://app.${ROOT_DOMAIN}`

const FEATURES = [
  { icon: '🖥️', t: 'Panel de gestión completo', d: 'Socios, membresías, cobros, clases, personal, inventario y finanzas — todo en un solo lugar.' },
  { icon: '🌐', t: 'Tu página web al instante', d: 'tugym.fitcorecenter.com con tu logo, colores, fotos, planes y mapa. Lista en minutos, sin diseñadores.' },
  { icon: '🎯', t: 'Capta clientes desde redes', d: 'Botón de inscripción en tu página: cada interesado cae a tu CRM con la red de donde vino (Instagram, TikTok…).' },
  { icon: '📧', t: 'Avisos automáticos', d: 'Te llega un email al instante con cada nuevo interesado. Respóndele en minutos y cierra más ventas.' },
  { icon: '💰', t: 'Caja clara', d: 'Cobros con Yape, Plin, efectivo o tarjeta. Promociones que descuentan solas. Todo cuadra en Finanzas.' },
  { icon: '🚪', t: 'Control de acceso', d: 'Check-in en recepción que valida la membresía al segundo. Listo para torniquetes y huella.' },
  { icon: '🎨', t: 'Tu marca, no la nuestra', d: 'Logo, colores y tipografía tuyos en el panel, la página y la app. 8 diseños de página para elegir.' },
  { icon: '📊', t: 'Reportes en Excel', d: 'Asistencia, ingresos, socios por vencer, inventario y prospectos — descarga con un clic.' },
]

const PASOS = [
  ['1', 'Regístrate gratis', 'Nombre de tu gym, elige tu dirección web y el tipo de gimnasio. 1 minuto.'],
  ['2', 'Personaliza', 'Sube tu logo, elige colores y fotos. Tus planes y horario ya vienen pre-armados.'],
  ['3', 'Comparte y crece', 'Manda tu página por WhatsApp e Instagram. Los interesados caen a tu CRM y tú los inscribes.'],
]

export default function PlataformaLanding() {
  return (
    <div className="min-h-screen bg-white text-ink">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-orange"><LogoMark size={19} /></div>
            <span className="text-[17px] font-extrabold tracking-[-0.3px]">FitControl</span>
          </div>
          <div className="flex items-center gap-3">
            <a href={`${APP_URL}/login`} className="px-3 py-2 text-[13.5px] font-extrabold text-muted hover:text-ink">Entrar</a>
            <a href={`${APP_URL}/registro`} className="rounded-[10px] bg-orange px-4 py-2.5 text-[13.5px] font-extrabold text-white hover:bg-orange-600">
              Crear mi gimnasio
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-navy">
        <div className="mx-auto max-w-[900px] px-6 py-24 text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-[12px] font-extrabold text-white/80">
            <span className="h-2 w-2 rounded-full bg-orange" /> Hecho para gimnasios de Perú y Latinoamérica
          </div>
          <h1 className="text-[46px] font-extrabold leading-[1.08] tracking-[-1.5px] text-white">
            Tu gimnasio con sistema propio<br />
            <span className="text-orange">y página web en minutos</span>
          </h1>
          <p className="mx-auto mt-5 max-w-[600px] text-[16.5px] font-semibold text-white/70">
            Panel de gestión + página web con tu marca + captación de clientes desde redes.
            Todo conectado, sin conocimientos técnicos.
          </p>
          <div className="mt-9 flex items-center justify-center gap-3">
            <a href={`${APP_URL}/registro`}
              className="rounded-[12px] bg-orange px-7 py-4 text-[15.5px] font-extrabold text-white shadow-[0_10px_30px_rgba(255,107,53,0.4)] transition-transform hover:scale-[1.03]">
              Crear mi gimnasio gratis
            </a>
            <a href={`https://powergym.${ROOT_DOMAIN}`} target="_blank" rel="noreferrer"
              className="rounded-[12px] border border-white/25 px-6 py-4 text-[15px] font-extrabold text-white hover:bg-white/10">
              Ver un gym de ejemplo →
            </a>
          </div>
          <p className="mt-4 text-[12px] font-semibold text-white/50">Sin tarjeta · tu panel y tu web quedan listos hoy</p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-[1080px] px-6 py-20">
        <h2 className="text-center text-[30px] font-extrabold tracking-[-0.5px]">Todo lo que tu gimnasio necesita</h2>
        <p className="mt-2 text-center text-[14.5px] font-semibold text-muted">Deja los cuadernos y el Excel. Opera como los grandes.</p>
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.t} className="rounded-2xl border border-line bg-white p-5 transition hover:border-orange">
              <div className="text-[26px]">{f.icon}</div>
              <div className="mt-2.5 text-[14.5px] font-extrabold">{f.t}</div>
              <div className="mt-1.5 text-[12.5px] font-semibold leading-relaxed text-muted">{f.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="bg-surface py-20">
        <div className="mx-auto max-w-[900px] px-6">
          <h2 className="text-center text-[28px] font-extrabold tracking-[-0.5px]">Empieza en 3 pasos</h2>
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
            {PASOS.map(([n, t, d]) => (
              <div key={n} className="rounded-2xl border border-line bg-white p-6 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-orange text-[17px] font-extrabold text-white">{n}</div>
                <div className="mt-3.5 text-[15.5px] font-extrabold">{t}</div>
                <div className="mt-1.5 text-[13px] font-semibold leading-relaxed text-muted">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Precios */}
      <section className="mx-auto max-w-[1080px] px-6 py-20">
        <h2 className="text-center text-[28px] font-extrabold tracking-[-0.5px]">Un plan para cada tipo de gimnasio</h2>
        <p className="mt-2 text-center text-[14px] font-semibold text-muted">
          Estudio de yoga, gym de barrio o cadena multi-sede: paga solo por lo que necesitas.
        </p>
        <div className="mx-auto mt-10 grid max-w-[980px] grid-cols-1 gap-5 md:grid-cols-3">
          {[
            {
              nombre: 'Estudio', precio: 49, popular: false,
              para: 'Yoga, pilates, baile y gimnasios pequeños',
              features: ['1 sede · hasta 100 socios', '2 usuarios del panel', 'Socios, membresías y cobros', 'Clases y check-in de recepción', 'Tu página web con subdominio', 'Reportes básicos'],
              no: ['CRM y captación desde redes', 'App del socio'],
            },
            {
              nombre: 'Crecimiento', precio: 99, popular: true,
              para: 'El gimnasio que quiere captar y crecer',
              features: ['Hasta 3 sedes · 500 socios', 'Usuarios ilimitados', 'Todo lo de Estudio', 'CRM + captación desde redes con origen', 'Emails automáticos de interesados', 'Promociones aplicadas al cobro', 'Kardex, máquinas y finanzas', 'Personalización total (8 diseños)', 'Reportes en Excel'],
              no: ['App del socio'],
            },
            {
              nombre: 'Cadena', precio: 179, popular: false,
              para: 'Multi-sede, franquicias y gyms completos',
              features: ['Sedes y socios ilimitados', 'Todo lo de Crecimiento', 'App del socio: rutinas y dietas (próximamente)', 'Control de acceso: torniquete y huella', 'Varias marcas en una cuenta', 'Soporte prioritario por WhatsApp'],
              no: [],
            },
          ].map((p) => (
            <div key={p.nombre}
              className={`relative flex flex-col rounded-3xl border-2 bg-white p-7 ${p.popular ? 'border-orange shadow-[0_20px_50px_rgba(255,107,53,0.15)]' : 'border-line'}`}>
              {p.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-orange px-4 py-1 text-[11px] font-extrabold tracking-[0.5px] text-white">
                  MÁS POPULAR
                </div>
              )}
              <div className="text-[15px] font-extrabold">{p.nombre}</div>
              <div className="mt-0.5 text-[12px] font-semibold text-muted">{p.para}</div>
              <div className="mt-4 text-[40px] font-extrabold tracking-[-2px]">
                S/ {p.precio}<span className="text-[15px] font-semibold text-muted">/mes</span>
              </div>
              <ul className="mt-5 flex-1 space-y-2 text-left text-[13px] font-semibold text-muted">
                {p.features.map((x) => (
                  <li key={x} className="flex items-start gap-2"><span className="mt-0.5 text-green">✓</span>{x}</li>
                ))}
                {p.no.map((x) => (
                  <li key={x} className="flex items-start gap-2 opacity-45"><span className="mt-0.5">✕</span>{x}</li>
                ))}
              </ul>
              <a href={`${APP_URL}/registro`}
                className={`mt-6 block rounded-[12px] py-3 text-center text-[14px] font-extrabold ${p.popular ? 'bg-orange text-white hover:bg-orange-600' : 'border border-orange text-orange hover:bg-orange-50'}`}>
                Empezar gratis
              </a>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-[12px] font-semibold text-faint">
          Todos los planes incluyen 1 mes de prueba gratis, sin tarjeta. Cambia de plan cuando quieras.
        </p>
      </section>

      {/* Footer */}
      <footer className="border-t border-line bg-navy px-6 py-10">
        <div className="mx-auto flex max-w-[1080px] flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange"><LogoMark size={16} /></div>
            <span className="text-[15px] font-extrabold text-white">FitControl</span>
          </div>
          <div className="text-[12.5px] font-semibold text-white/60">El sistema todo-en-uno para gimnasios · {ROOT_DOMAIN}</div>
          <div className="text-[11px] font-semibold text-white/40">© 2026 FitControl. Todos los derechos reservados.</div>
        </div>
      </footer>
    </div>
  )
}
