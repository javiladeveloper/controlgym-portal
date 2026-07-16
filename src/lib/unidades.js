// Conversión de unidades para PESO CORPORAL y TALLA del socio.
//
// PRINCIPIO CLAVE: la BD siempre guarda en métrico (socio.peso_kg en kg,
// socio.talla_m en metros). Estas funciones son SOLO de presentación: convierten
// entre el valor guardado (métrico) y la unidad que el gym eligió mostrar
// (empresa.unidad_peso / empresa.unidad_talla). Nunca cambian lo que se persiste.
//
// Elección de formato para talla en pies ('ft'): se muestra como PIES DECIMALES
// (ej. 1.75 m → 5.7 ft), no como pies+pulgadas ("5'9\""). Un solo campo numérico
// decimal es mucho más simple de editar en un <input type="number"> que un par
// pies/pulgadas — evita un segundo input y toda la lógica de combinarlos/parsearlos.
// El usuario ingresa "5.7" igual que ingresaría "1.75", solo cambia la escala.

const KG_POR_LB = 2.20462
const M_POR_FT = 3.28084 // 1 m = 3.28084 ft

function aNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

function redondear(n, decimales) {
  const f = 10 ** decimales
  return Math.round(n * f) / f
}

// kg (métrico, BD) → unidad de display del gym
export function kgADisplay(kg, unidad) {
  const n = aNumero(kg)
  if (n === null) return null
  if (unidad === 'lb') return redondear(n * KG_POR_LB, 1)
  return n
}

// unidad de display del gym → kg (métrico, BD)
export function displayAKg(valor, unidad) {
  const n = aNumero(valor)
  if (n === null) return null
  if (unidad === 'lb') return n / KG_POR_LB
  return n
}

// metros (métrico, BD) → unidad de display del gym (pies decimales si 'ft')
export function mADisplay(m, unidad) {
  const n = aNumero(m)
  if (n === null) return null
  if (unidad === 'ft') return redondear(n * M_POR_FT, 1)
  return n
}

// unidad de display del gym → metros (métrico, BD)
export function displayAM(valor, unidad) {
  const n = aNumero(valor)
  if (n === null) return null
  if (unidad === 'ft') return n / M_POR_FT
  return n
}

export function labelPeso(unidad) {
  return unidad === 'lb' ? 'lb' : 'kg'
}

export function labelTalla(unidad) {
  return unidad === 'ft' ? 'ft' : 'm'
}
