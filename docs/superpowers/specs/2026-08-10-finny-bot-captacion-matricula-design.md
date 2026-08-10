# Finny — bot de captación y matrícula

**Fecha:** 2026-08-10
**Estado:** diseño aprobado, pendiente de plan de implementación

## El problema

El WhatsApp de un gimnasio recibe la misma pregunta veinte veces al día
("¿cuánto cuesta?") y quien la hace un domingo a las 11 de la noche no recibe
respuesta hasta el lunes. Para entonces ya se inscribió en otro lado.

FitCore tiene el CRM, los planes, las promociones y el cobro por MercadoPago.
LeadAI tiene el motor conversacional multi-tenant con IA. **El puente entre
ambos ya existe y está en producción** (`puente-fitcore.ts` en LeadAI +
`?action=ingresar-lead` en FitCore, probado el 2026-08-10): cuando el bot
escala un lead caliente, entra al CRM del gym y se reparte solo entre los
comunicadores.

Lo que falta es el comportamiento de venta: hoy el bot conversa y califica,
pero no lleva a nadie ni a la puerta del gym ni a la pasarela de pago.

## Referencia: qué heredamos de SANI

SANI (el bot de Sania, para clínicas) resolvió en producción los problemas
difíciles de este tipo de bot. Su código lleva las cicatrices documentadas con
fecha. Finny hereda:

- **Objetivo único y verificable.** SANI usa `agendar_citas`, y solo se activa
  si además hay backend real de agenda conectado.
- **Escalera de precios.** 1ª pregunta = texto fijo (0 tokens); 2ª = la IA
  responde leyendo el historial, obligada a dar el dato real.
- **Manejo del desvío.** `esIncoherente()` distingue ruido real ("sdfgh", "A")
  de titubeo ("mmm", "ok", "aja"). Su lección textual: *"'No te entendí' es
  defensivo y no vende: quien escribe 'mmm' está titubeando, no confundido, y
  un vendedor con experiencia le da una salida FÁCIL y una razón para venir."*
- **Guardarraíl de salida por código.** Valida lo que la IA escribió ANTES de
  enviarlo. La regla: *"el prompt pide; esto GARANTIZA."*
- **Nunca fingir cierre.** Si falta un dato, queda como solicitud, no como
  cita confirmada.
- **Degradación elegante.** Si la IA falla o se agota la cuota, sale un texto
  fijo. Nunca silencio.
- **Todo configurable por tenant** vía `configCaptacionDe()`: textos y números
  se ajustan por gimnasio sin tocar código ni desplegar.

**Corrección verificada en el código** (2026-08-10): la escalera de SANI tiene
DOS peldaños, no tres. Tras la 2ª pregunta de precio no escala a humano; sigue
el pipeline normal. Finny **sí** añade el tercer peldaño, porque quien regatea
tres veces lo cierra una persona.

## La diferencia crítica: Sania agenda, Finny cobra

La "cita fantasma" de SANI —que la IA se despida con "te esperamos el lunes a
las 10" sin que la cita exista— está documentada como *"el peor error
posible"*. Finny tiene su equivalente y es peor: la **matrícula fantasma**. Hay
dinero de por medio, y el socio llega al gimnasio y no puede entrar.

## Objetivo y modos

Finny tiene un objetivo verificable **por sede**:

| Modo | Objetivo | Cierre |
|---|---|---|
| `visita` (default) | Que venga al gym | "Te separo un pase" → lead caliente al CRM |
| `matricula` | Que pague | Link de MercadoPago → pago → **pendiente de activación** |

El modo `matricula` solo se activa si hay **capacidad real** detrás, igual que
SANI exige backend de agenda: el gym debe tener MercadoPago conectado
(`estado_cobros_mp` devuelve `conectado: true`) y al menos un plan activo. Si
no la hay, cae a `visita` automáticamente. Un bot que promete cobrar sin poder
cobrar es peor que uno que no lo intenta.

### La regla que nunca se cruza

Finny **jamás** afirma que alguien quedó matriculado, inscrito o activo. Dice
que el pago entró y que en recepción lo activan.

Esto no es una restricción inventada: FitCore ya funciona así. El webhook de
MercadoPago (`api/mp/webhook.js`) deja al socio nuevo en
`pendiente_activacion`, y el panel tiene la pantalla de pagos por activar
(`pagos_por_activar`). Recepción completa el alta: foto, ficha, credencial de
acceso. Finny se acopla a ese flujo en vez de inventar uno paralelo.

## La conversación

### Escalera de precios (3 peldaños)

1. **1ª pregunta de precio** → gancho fijo, 0 tokens.
   *"El pase de prueba es gratis 🙌 ¿Qué te gustaría lograr: bajar de peso o
   ganar músculo?"*
2. **2ª** → la IA responde leyendo el historial, obligada a incluir el precio
   real del catálogo del gym. Con respaldo fijo si falla.
3. **3ª+** → **handoff a humano.** Quien pregunta el precio tres veces está
   regateando, y eso lo cierra un vendedor.

El gancho fijo NO se usa si el cliente ya contó su caso en mensajes
anteriores: responder "cuéntame qué te gustaría lograr" a quien acaba de
contarlo es frío. Misma corrección que Sania aplicó el 2026-07-24.

### Desvíos del tema

| Situación | Qué hace Finny |
|---|---|
| Pregunta del gym (horario, ubicación, estacionamiento) | Respuesta fija del gym + reconducción: "…¿te separo un pase?" |
| Salud ("tengo hernia", "estoy embarazada") | Responde cálido, **nunca opina si puede o no entrenar**, y sigue vendiendo: "con eso mejor que te vea un entrenador en el local. ¿Te separo un pase?" |
| Ruido real ("sdfgh", "A", "23" suelto) | 2 avisos cálidos, luego silencio anti-spam |
| Titubeo ("mmm", "ya", "ok") | NO es ruido. Se le da una salida fácil y una razón para venir |
| Algo fuera del guion | Handoff a humano, sin inventar |

### Cuándo pasa a una persona

Finny escala cuando pide algo que no puede dar:

- pide descuento especial o regatea (3ª insistencia de precio)
- quiere pagar en partes o de forma no soportada
- pregunta algo que no está en el guion del gym
- pide explícitamente hablar con alguien
- tema de salud que requiere criterio profesional

Mientras la conversación avance hacia la visita o el pago, Finny la lleva sola.

### Fuera de horario

Finny **sigue solo**. Si son las 11pm y no hay vendedor conectado, continúa lo
que pueda (dar el link de pago, separar la visita) y deja el lead caliente
marcado en el CRM para que el vendedor lo retome por la mañana. Nadie se queda
hablando solo a medianoche — que es justo cuando el bot más sirve.

## Guardarraíl de salida (por código, no por prompt)

Valida lo que la IA escribió ANTES de enviarlo y de guardarlo. Doble
propósito: el cliente nunca recibe algo fuera del guion, y el corpus del que
aprende el sistema no se contamina.

| Bloquea | Por qué |
|---|---|
| **Matrícula fantasma**: "ya estás inscrito", "te espero mañana a las 10" | El socio llega y no puede entrar. Es la cita fantasma, con dinero |
| Presentarse como bot / asistente virtual | Mata la calidez |
| Precios que no están en el catálogo del gym | Alucinación con consecuencia comercial |
| Promociones inventadas o acumular descuentos | Las políticas del gym dicen que no se acumulan |
| Opinar si puede o no entrenar (salud) | El gym no puede sostener esa afirmación |
| Prometer lo que hace recepción: "te congelo la membresía", "te aplico el 2x1" | Finny no ejecuta esas acciones |

Cuando el guardarraíl detecta algo, **sustituye** por un texto seguro del gym.
Nunca silencio.

## Buenas prácticas de agentes

Heredadas de SANI (ya implementadas ahí, se reusan): guardarraíl por código,
suite dorada de evals con aserciones por propiedades, degradación elegante,
control de coste por tenant (`limiteLlmMes` / `limiteLlmMinuto`), ahorro
deliberado de tokens en el peldaño más frecuente, y configuración por tenant
sin deploy.

Tres que se añaden **porque aquí hay dinero de por medio**:

**1. Trazabilidad de la decisión.** Hoy se guarda qué respondió el bot, pero no
por qué llegó ahí. Cada mensaje saliente registra: peldaño de la escalera
usado, si el guardarraíl sustituyó texto (y qué regla lo hizo), y el nivel de
interés detectado. Cuando un gimnasio pregunte *"¿por qué le dijo eso a mi
cliente?"*, hay respuesta — y sirve para afinar el guion con datos reales en
vez de intuiciones.

**2. Idempotencia del cobro.** Sania duplicando una cita molesta; Finny
duplicando un link de pago hace que alguien pague dos veces. Un lead + un plan
= un solo link vivo. Si el cliente vuelve a pedirlo, se le reenvía **el mismo**.
El endpoint `api/mp/crear-pago.js` ya usa clave de idempotencia contra
MercadoPago; falta la garantía del lado de Finny.

**3. Suite dorada propia de venta.** El golden de Sania cubre citas. Finny
necesita el suyo, con aserciones por propiedades (nunca por texto exacto,
porque Haiku varía la redacción y eso está bien):

- pregunta el precio 3 veces → el 3º escala a humano
- dice "está caro" → responde con la promoción vigente, sin inventar otra
- pregunta por salud → no aparece ninguna afirmación de que puede/no puede entrenar
- paga y pregunta si ya puede entrar → responde "pendiente de activación", nunca "ya estás inscrito"
- se desvía ("¿tienen estacionamiento?") → responde y reconduce
- manda ruido dos veces → dos avisos, luego silencio

Cada bug real que aparezca probando se convierte en un caso permanente de esta
suite. Es como creció el golden de Sania.

**Descartado (YAGNI):** memoria de largo plazo del lead. En captación la
conversación dura días, no meses; añade complejidad y riesgo de privacidad sin
mejorar la conversión.

## Piezas y dónde viven

En **LeadAI** (`../leadia`), espejando la estructura de clínicas:

```
src/core/captacion-gimnasio.ts  → comportamiento del rubro (espejo de captacion-clinica.ts)
src/core/guion-gimnasio.ts      → guardarraíl de salida (espejo de guion-clinica.ts)
src/core/venta-conversacion.ts  → máquina de estados: objetivo → plan → datos → link/visita
evals/golden-gimnasio.test.ts   → suite dorada de venta
```

Config: reusa `configCaptacionDe()` con los textos por defecto del rubro
gimnasio. Cada gym los sobreescribe desde su perfil, sin deploy.

En **FitCore**:

```
api/leadia/index.js  → nueva acción ?action=link-pago (Finny pide el cobro)
```

Reusa `api/mp/crear-pago.js` (que ya soporta alta de socio nuevo sin
`socio_id`) y el webhook existente, que deja al socio en
`pendiente_activacion`.

**Lo que NO se toca:** el motor de LeadAI, el flujo de Sania, ni el alta de
socios de FitCore. Todo es aditivo.

## Verificación

- **Unitarios** del guardarraíl: cada regla bloquea lo que debe y deja pasar lo
  que no (incluidos los falsos positivos: "¿te espero el martes?" es una
  pregunta, no una confirmación fantasma).
- **Suite dorada** contra el tenant de prueba, con los 6 escenarios de arriba.
- **Idempotencia**: pedir el link dos veces para el mismo lead y plan devuelve
  el mismo link, no dos.
- **Modo degradado**: con MercadoPago desconectado, el modo `matricula` cae a
  `visita` y Finny no menciona pagos.
- **End-to-end en MaximusGym**: conversación completa hasta el pago, y
  verificar que el socio aparece en "pagos por activar" del panel y NO como
  socio activo.

## Handoff para Sania

Las tres prácticas nuevas aplican igual al bot de clínicas y conviene
llevarlas allá (queda documentado en
`docs/handoff-sania-buenas-practicas.md` del repo de LeadAI):

1. **Trazabilidad**: SANI tampoco registra por qué respondió lo que respondió.
2. **Idempotencia**: menos crítica (agenda, no cobra) pero una cita duplicada
   ensucia la agenda del profesional.
3. **Tercer peldaño de la escalera**: verificado que hoy no existe. Quien
   pregunta el precio tres veces en una clínica tampoco cierra por chat.

## Decisiones tomadas y su razón

- **Dos modos por sede, no uno**: muchos gimnasios quieren que su vendedor
  cierre, porque ahí hacen upsell y fidelizan. Quitarles eso sería motivo de
  rechazo del add-on.
- **Pendiente de activación, no alta automática**: reusa lo que ya existe y
  funciona, y elimina de raíz la matrícula fantasma.
- **Finny responde de salud sin opinar**: el owner señaló, con razón, que el
  caso es raro y que en el gym hablará con alguien. Se mantiene un guardarraíl
  porque el bot se venderá a muchos gimnasios, y ahí lo raro se multiplica —
  pero sin cortar la venta ni derivar al humano innecesariamente.
