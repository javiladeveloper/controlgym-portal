import { describe, it, expect } from 'vitest'
import { tokenDesdeRuta, diasOrdenados } from '../src/lib/compartir.js'

describe('tokenDesdeRuta', () => {
  it('extrae el token de /r/<token>', () => {
    expect(tokenDesdeRuta('/r/a7k2m9x3')).toBe('a7k2m9x3')
  })

  it('devuelve null si la ruta no es de compartir', () => {
    expect(tokenDesdeRuta('/planes')).toBeNull()
  })

  // Sin esto la página llamaría a la RPC con una cadena vacía y mostraría un
  // error feo en vez de un "enlace no válido".
  it('devuelve null si /r/ viene sin token', () => {
    expect(tokenDesdeRuta('/r/')).toBeNull()
    expect(tokenDesdeRuta('/r')).toBeNull()
  })

  it('ignora una barra final', () => {
    expect(tokenDesdeRuta('/r/a7k2m9x3/')).toBe('a7k2m9x3')
  })
})

describe('diasOrdenados', () => {
  const contenido = [
    { dia_semana: 2, foco: 'Espalda', ejercicios: [{ nombre: 'remo' }] },
    { dia_semana: 1, foco: 'Pecho', ejercicios: [{ nombre: 'press' }] },
  ]

  it('ordena los días por dia_semana', () => {
    expect(diasOrdenados(contenido).map((d) => d.foco)).toEqual(['Pecho', 'Espalda'])
  })

  it('una rutina sin días devuelve lista vacía en vez de reventar', () => {
    expect(diasOrdenados(null)).toEqual([])
    expect(diasOrdenados([])).toEqual([])
  })

  it('un día sin ejercicios no rompe', () => {
    const conVacio = [{ dia_semana: 1, foco: 'Descanso', ejercicios: [] }]
    expect(diasOrdenados(conVacio)[0].ejercicios).toEqual([])
  })
})
