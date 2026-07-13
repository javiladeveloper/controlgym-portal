// Plantilla del árbol de decisiones del bot para GIMNASIOS. Formato de Leadia:
// grafo { nodos:[{id,tipo,pos:{x,y},datos}], conexiones:[{id,desde,hacia,puerto}] }.
// Tipos válidos: inicio, mensaje, opciones, fija, ia, pedir_dato, escalar…
// Regla de Leadia: exactamente UN nodo 'inicio'.
//
// Flujo: saludo → opciones (precios / horarios / hablar con la IA) → la rama
// libre entra al nodo IA (donde el gym decide meter el bot); "quiero inscribirme"
// escala directo al humano. El gym ajusta los textos y en qué rama va la IA
// desde el panel; esta es solo la base para arrancar rápido.
export const FLUJO_PLANTILLA_GYM = {
  nodos: [
    { id: 'inicio', tipo: 'inicio', pos: { x: 0, y: 0 }, datos: {} },
    { id: 'saludo', tipo: 'mensaje', pos: { x: 0, y: 120 },
      datos: { texto: '¡Hola! 👋 Bienvenido a nuestro gimnasio. ¿En qué te ayudo?' } },
    { id: 'menu', tipo: 'opciones', pos: { x: 0, y: 240 },
      datos: { opciones: ['Precios y planes', 'Horarios', 'Quiero inscribirme', 'Otra consulta'] } },
    { id: 'precios', tipo: 'fija', pos: { x: -220, y: 380 },
      datos: { texto: 'Estos son nuestros planes: [el gym completa aquí sus precios].' } },
    { id: 'horarios', tipo: 'fija', pos: { x: -20, y: 380 },
      datos: { texto: 'Nuestro horario es: [el gym completa aquí sus horarios].' } },
    // Nodo IA: la rama libre la atiende la IA de Leadia (aquí "entra el bot").
    { id: 'ia', tipo: 'ia', pos: { x: 200, y: 380 },
      datos: { instruccion: 'Responde dudas del interesado sobre el gimnasio con tono cercano. Si detectas intención de compra o pide un humano, escala.' } },
    // Inscribirse = caliente → al humano (recepción/comunicador).
    { id: 'escalar', tipo: 'escalar', pos: { x: 420, y: 380 },
      datos: { motivo: 'Quiere inscribirse — pásalo a recepción.' } },
  ],
  conexiones: [
    { id: 'c1', desde: 'inicio', hacia: 'saludo' },
    { id: 'c2', desde: 'saludo', hacia: 'menu' },
    { id: 'c3', desde: 'menu', hacia: 'precios', puerto: 'Precios y planes' },
    { id: 'c4', desde: 'menu', hacia: 'horarios', puerto: 'Horarios' },
    { id: 'c5', desde: 'menu', hacia: 'escalar', puerto: 'Quiero inscribirme' },
    { id: 'c6', desde: 'menu', hacia: 'ia', puerto: 'Otra consulta' },
  ],
}
