import { FitCoreLogo } from '../components/icons.jsx'
import { ROOT_DOMAIN } from '../lib/tenant.js'

// Páginas legales de la plataforma (fitcorecenter.com/terminos · /privacidad).
// Mismo tema dark de la landing.
const C = { bg: '#141B2E', surface: '#1F293D', primary: '#FF6B35', muted: '#8E9AA8', border: '1px solid rgba(255,255,255,0.08)' }

const TERMINOS = [
  ['1. El servicio', 'FitCore es una plataforma en línea para la gestión de gimnasios y centros deportivos: socios, membresías, cobros, clases, inventario, página web y captación de clientes. El servicio se ofrece bajo suscripción mensual por gimnasio (empresa).'],
  ['2. Tu cuenta', 'Para usar FitCore necesitas una cuenta de Google válida. Eres responsable de la actividad realizada con tu cuenta y de mantener el acceso restringido a tu personal autorizado. Cada colaborador debe usar su propia cuenta con el rol que le asignes.'],
  ['3. Prueba gratuita y pagos', 'Todos los planes incluyen un período de prueba gratuito de 30 días, sin tarjeta. Al finalizar, eliges un plan de pago para continuar. Puedes cambiar de plan o cancelar en cualquier momento; no hay permanencia mínima ni penalidades.'],
  ['4. Tus datos son tuyos', 'La información que registras (socios, cobros, inventario, etc.) te pertenece. FitCore no vende tus datos ni los de tus socios, y no cobra comisión por las membresías que gestionas en la plataforma.'],
  ['5. Uso aceptable', 'Te comprometes a usar la plataforma conforme a la ley peruana, a no intentar vulnerar su seguridad y a registrar únicamente información de personas que han dado su consentimiento (por ejemplo, tus socios e interesados).'],
  ['6. Disponibilidad', 'Trabajamos para mantener el servicio disponible de forma continua, pero no garantizamos disponibilidad ininterrumpida. Realizamos copias de seguridad periódicas de la base de datos.'],
  ['7. Cancelación', 'Si cancelas, tu información se conserva por 90 días por si decides volver; luego puede ser eliminada de forma definitiva. Puedes solicitar la exportación de tus datos escribiendo a soporte@' + ROOT_DOMAIN + '.'],
  ['8. Cambios a estos términos', 'Podemos actualizar estos términos; si el cambio es relevante te lo comunicaremos por correo con anticipación razonable.'],
]

const PRIVACIDAD = [
  ['1. Qué datos recopilamos', 'De los gimnasios: datos de contacto del negocio y de sus usuarios del panel (nombre, correo). De los socios de cada gimnasio: los datos que el propio gimnasio registra (nombre, documento, contacto, membresías, asistencia). De los visitantes de las páginas web de gimnasios: los datos que envían voluntariamente en los formularios de contacto.'],
  ['2. Para qué los usamos', 'Exclusivamente para operar el servicio: gestionar membresías, registrar asistencia, enviar notificaciones del negocio (por ejemplo, avisar al gimnasio de un nuevo interesado) y mejorar la plataforma. No vendemos datos a terceros ni hacemos publicidad con ellos.'],
  ['3. Dónde se almacenan', 'Los datos se almacenan en Supabase (infraestructura sobre Amazon Web Services) con cifrado en tránsito y en reposo, y con aislamiento por gimnasio: cada empresa solo puede ver su propia información.'],
  ['4. Quién puede verlos', 'El personal que cada gimnasio autoriza en su panel, según el rol asignado. Nuestro equipo técnico accede solo cuando es indispensable para soporte y de forma registrada.'],
  ['5. Autenticación con Google', 'El inicio de sesión usa tu cuenta de Google. Solo recibimos tu nombre, correo y foto de perfil; nunca tu contraseña.'],
  ['6. Tus derechos', 'Puedes solicitar acceso, corrección o eliminación de tus datos personales escribiendo a soporte@' + ROOT_DOMAIN + '. Si eres socio de un gimnasio, puedes ejercer estos derechos directamente con tu gimnasio o con nosotros.'],
  ['7. Cookies', 'Usamos únicamente el almacenamiento necesario para mantener tu sesión iniciada y tus preferencias del panel. No usamos cookies de publicidad.'],
  ['8. Contacto', 'Para cualquier consulta sobre privacidad: soporte@' + ROOT_DOMAIN + ' o WhatsApp +51 986 110 558.'],
]

const DEVOLUCIONES = [
  ['1. Naturaleza del servicio', 'FitCore es un servicio de software por suscripción mensual (SaaS). No vendemos productos físicos: no hay envíos ni cambios de mercadería. Esta política regula los cobros de la suscripción.'],
  ['2. Prueba gratuita', 'Todos los planes incluyen 30 días de prueba gratis sin tarjeta. Durante la prueba no se realiza ningún cobro, por lo que no hay nada que devolver: puedes dejar de usar el servicio sin costo alguno.'],
  ['3. Cancelación', 'Puedes cancelar tu suscripción en cualquier momento, sin penalidad ni permanencia mínima, desde tu panel o escribiendo a soporte@' + ROOT_DOMAIN + '. Al cancelar, mantienes acceso hasta el final del ciclo ya pagado y no se generan nuevos cobros.'],
  ['4. Devoluciones', 'Reembolsamos el 100% del cobro en un máximo de 7 días hábiles, al mismo medio de pago, en estos casos: (a) cobro duplicado o por un monto distinto al contratado; (b) cobros posteriores a una cancelación confirmada; (c) primer cobro luego de la prueba, si nos lo solicitas dentro de los 7 días siguientes y no usaste el servicio en ese período.'],
  ['5. Cambios de plan', 'Puedes subir de plan cuando quieras (el nuevo monto aplica desde el siguiente cobro) o bajar de plan para el siguiente ciclo. Los meses ya consumidos no son reembolsables.'],
  ['6. Cómo solicitarlo', 'Escríbenos a soporte@' + ROOT_DOMAIN + ' o al WhatsApp +51 986 110 558 indicando el nombre de tu gimnasio y el motivo. Confirmamos la solicitud en un máximo de 2 días hábiles.'],
  ['7. Reclamos', 'Si no estás conforme con la atención, puedes registrar tu reclamo en nuestro Libro de Reclamaciones virtual (enlace en el pie de página), conforme a la Ley N° 29571.'],
]

const DOCS = {
  terminos: { titulo: 'Términos y condiciones', secciones: TERMINOS },
  privacidad: { titulo: 'Política de privacidad', secciones: PRIVACIDAD },
  devoluciones: { titulo: 'Política de cambios y devoluciones', secciones: DEVOLUCIONES },
}

export default function LegalPage({ doc = 'terminos' }) {
  const { titulo, secciones } = DOCS[doc] || DOCS.terminos
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
        <h1 className="text-[32px] font-extrabold tracking-[-1px]">{titulo}</h1>
        <p className="mt-2 text-[13px] font-semibold" style={{ color: C.muted }}>Última actualización: julio de 2026</p>

        <div className="mt-9 space-y-7">
          {secciones.map(([t, cuerpo]) => (
            <section key={t}>
              <h2 className="text-[16.5px] font-extrabold">{t}</h2>
              <p className="mt-1.5 text-[14px] font-semibold leading-relaxed" style={{ color: C.muted }}>{cuerpo}</p>
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-lg px-6 py-5 text-[13.5px] font-semibold" style={{ background: C.surface, border: C.border, color: C.muted }}>
          ¿Dudas? Escríbenos a{' '}
          <a href={`mailto:soporte@${ROOT_DOMAIN}`} className="font-extrabold" style={{ color: C.primary }}>soporte@{ROOT_DOMAIN}</a>
          {' '}o al WhatsApp{' '}
          <a href="https://wa.me/51986110558" target="_blank" rel="noreferrer" className="font-extrabold" style={{ color: C.primary }}>+51 986 110 558</a>.
        </div>

        <div className="mt-8 flex flex-wrap gap-5 text-[13px] font-bold">
          <a href="/terminos" style={{ color: doc === 'terminos' ? C.primary : C.muted }}>Términos</a>
          <a href="/privacidad" style={{ color: doc === 'privacidad' ? C.primary : C.muted }}>Privacidad</a>
          <a href="/devoluciones" style={{ color: doc === 'devoluciones' ? C.primary : C.muted }}>Cambios y devoluciones</a>
          <a href="/reclamaciones" style={{ color: C.muted }}>📖 Libro de Reclamaciones</a>
        </div>
      </main>
    </div>
  )
}
