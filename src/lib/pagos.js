// Métodos de pago aceptados en cobros (inscripción, membresías) y egresos
// (planilla del personal). Lista única para que los módulos no diverjan.
// Formato [valor, etiqueta] para usar directo en <option>.
export const METODOS_PAGO = [
  ['efectivo', 'Efectivo'],
  ['yape', 'Yape'],
  ['plin', 'Plin'],
  ['tarjeta', 'Tarjeta (POS)'],
  ['transferencia', 'Transferencia'],
]

// Etiqueta legible de un método (ej. para recibos): metodoPagoLabel('yape') → 'Yape'
export function metodoPagoLabel(valor) {
  return METODOS_PAGO.find(([v]) => v === valor)?.[1] || valor
}
