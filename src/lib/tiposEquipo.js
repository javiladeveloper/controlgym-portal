// Los 28 tipos de equipo del catálogo de ejercicios. `codigo` (en inglés) es lo
// que se guarda en BD y casa con ejercicio_catalogo.equipment; `es` + `emoji` son
// para la UI. Cada máquina del inventario elige su tipo de aquí; de esos tipos se
// deriva qué puede hacer la sede en rutinas (una sola fuente = el inventario).
export const TIPOS_EQUIPO = [
  { codigo: 'body weight', es: 'Peso corporal', emoji: '🤸' },
  { codigo: 'dumbbell', es: 'Mancuernas', emoji: '🏋️' },
  { codigo: 'barbell', es: 'Barra', emoji: '🏋️‍♂️' },
  { codigo: 'ez barbell', es: 'Barra Z (EZ)', emoji: '💪' },
  { codigo: 'olympic barbell', es: 'Barra olímpica', emoji: '🥇' },
  { codigo: 'trap bar', es: 'Barra hexagonal', emoji: '⬡' },
  { codigo: 'cable', es: 'Poleas / cables', emoji: '🔗' },
  { codigo: 'smith machine', es: 'Máquina Smith', emoji: '🏗️' },
  { codigo: 'leverage machine', es: 'Máquina de palanca', emoji: '⚙️' },
  { codigo: 'kettlebell', es: 'Pesa rusa (kettlebell)', emoji: '🔔' },
  { codigo: 'band', es: 'Banda elástica', emoji: '➰' },
  { codigo: 'resistance band', es: 'Banda de resistencia', emoji: '🎗️' },
  { codigo: 'medicine ball', es: 'Balón medicinal', emoji: '⚽' },
  { codigo: 'stability ball', es: 'Pelota de estabilidad', emoji: '🟠' },
  { codigo: 'bosu ball', es: 'Bosu', emoji: '🔵' },
  { codigo: 'hammer', es: 'Martillo (hammer)', emoji: '🔨' },
  { codigo: 'weighted', es: 'Con lastre / peso extra', emoji: '⚖️' },
  { codigo: 'assisted', es: 'Asistido', emoji: '🤝' },
  { codigo: 'rope', es: 'Cuerda', emoji: '🪢' },
  { codigo: 'roller', es: 'Rodillo', emoji: '🧻' },
  { codigo: 'wheel roller', es: 'Rueda abdominal', emoji: '☸️' },
  { codigo: 'tire', es: 'Neumático', emoji: '🛞' },
  { codigo: 'sled machine', es: 'Trineo (sled)', emoji: '🛷' },
  { codigo: 'stationary bike', es: 'Bicicleta estática', emoji: '🚴' },
  { codigo: 'elliptical machine', es: 'Elíptica', emoji: '🏃' },
  { codigo: 'stepmill machine', es: 'Escaladora', emoji: '🪜' },
  { codigo: 'skierg machine', es: 'SkiErg', emoji: '⛷️' },
  { codigo: 'upper body ergometer', es: 'Ergómetro de brazos', emoji: '💺' },
]

// Etiqueta legible (emoji + español) de un código de equipo.
export function labelEquipo(codigo) {
  const t = TIPOS_EQUIPO.find((x) => x.codigo === codigo)
  return t ? `${t.emoji} ${t.es}` : codigo
}
