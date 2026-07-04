// WhatsApp a 1 clic con mensajes pre-armados.
// Los teléfonos peruanos de 9 dígitos reciben el prefijo 51 automáticamente.
export function waLink(telefono, texto) {
  const digitos = String(telefono || '').replace(/\D/g, '')
  if (!digitos) return null
  const numero = digitos.length === 9 ? `51${digitos}` : digitos
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
}

const fmtFecha = (iso) =>
  iso ? new Date(iso).toLocaleDateString('es-PE', { day: 'numeric', month: 'long' }) : ''

// Recordatorio de renovación (Membresías)
export function msgRenovacion({ socio, gym, plan, vence }) {
  const nombre = (socio || '').split(' ')[0]
  return `Hola ${nombre}! 👋 Te escribimos de ${gym}. Tu plan${plan ? ` ${plan}` : ''} vence el ${fmtFecha(vence)} — ¿lo renovamos para que no pierdas tu ritmo? 💪`
}

// Comprobante de pago (inscripción, renovación o abono)
export function msgRecibo({ socio, gym, concepto, monto, metodo, saldo, vence, moneda = 'S/' }) {
  const nombre = (socio || '').split(' ')[0]
  const fmt = (n) => `${moneda} ${Number(n).toFixed(2)}`
  let m = `Hola ${nombre}! ✅ ${gym} te confirma tu pago:\n\n` +
    `🧾 ${concepto}\n💵 Monto: ${fmt(monto)}${metodo ? ` (${metodo})` : ''}\n📅 Fecha: ${new Date().toLocaleDateString('es-PE')}`
  if (Number(saldo) > 0) m += `\n⏳ Saldo pendiente: ${fmt(saldo)}`
  if (vence) m += `\n🗓 Tu membresía vence el ${fmtFecha(vence)}`
  m += `\n\n¡Gracias por confiar en nosotros! 💪`
  return m
}

// Saludo de cumpleaños 🎂
export function msgCumple({ socio, gym }) {
  const nombre = (socio || '').split(' ')[0]
  return `¡Feliz cumpleaños, ${nombre}! 🎂🎉 Todo el equipo de ${gym} te desea un día increíble. ¡Te esperamos para celebrarlo entrenando! 💪`
}

// Primer contacto a un interesado (CRM)
export function msgLead({ lead, gym, etapa }) {
  const nombre = (lead || '').split(' ')[0]
  if (etapa === 'clase_prueba') {
    return `Hola ${nombre}! Te escribimos de ${gym} 🤸 ¿Confirmamos tu clase de prueba gratis? Dinos qué día te acomoda y te esperamos.`
  }
  return `Hola ${nombre}! 👋 Vimos que te interesa ${gym}. Tenemos una clase de prueba GRATIS para que nos conozcas — ¿qué día te gustaría venir?`
}
