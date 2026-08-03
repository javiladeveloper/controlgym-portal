# Rutinas de comunidad — diseño

**Fecha:** 2026-08-02
**Estado:** aprobado por el owner, pendiente de plan de implementación

## Qué se construye

Hoy "Rutinas listas" es un catálogo cerrado: 5 rutinas curadas por FitCore y nada
más. La app permite tener **una sola** rutina propia — al crear otra, se borra la
anterior.

Esto lo convierte en tres cosas:

1. **Varias rutinas propias**, con una marcada como "en curso".
2. **Rutinas globales**: cualquiera comparte la suya y, tras aprobación, la
   comunidad la ve, la puntúa y la usa.
3. **Filtros y orden** para que el catálogo siga siendo usable cuando crezca.

## Decisiones tomadas

| Decisión | Elegido | Por qué |
|---|---|---|
| Varias rutinas propias | Varias guardadas, una "en curso" | "Mi rutina" sigue teniendo sentido: hay una rutina del día a la que entrar directo |
| Moderación | El owner aprueba antes de publicar | Mismo patrón que las fotos de socios, que ya funciona. Con temas de salud, publicar primero y corregir después es un riesgo real |
| Puntuación | Estrellas 1-5, solo si adoptaste la rutina | La nota mide si la rutina sirve, no si el título suena bien |
| Organización | Tres secciones en una pantalla | Sin pestañas que escondan la comunidad justo cuando está arrancando |

## Estado actual del código (verificado en prod)

- `rutina_libre` (15 filas, 15 activas, 15 personas) + `rutina_libre_dia` +
  `rutina_libre_ejercicio`. **Índice `rutina_libre_usuario_activa_uq`: único por
  usuario donde `activa`** — es lo que fuerza una sola rutina.
- `generar_rutina_libre` hace `delete from rutina_libre where usuario_id = ... and activa`
  antes de crear la nueva: **borra**, no archiva.
- `rutina_predisenada` ya tiene: `slug, nombre, categoria, descripcion, nivel,
  dias_por_semana, equipo, disclaimer_salud, imagen, orden, activa`.
- `adoptar_rutina_predisenada` copia una curada a la rutina del usuario.
- `objetivo_entrenamiento` tiene 8 objetivos: `bajar_peso, fuerza, ganar_masa,
  prep_deportiva, rehabilitacion, resistencia, salud_general, tonificar`.

## Arquitectura

Se reutiliza `rutina_predisenada` como tabla de rutinas publicadas en vez de
crear una paralela: ya tiene casi todos los campos y la pantalla que la pinta.
Las 5 curadas son, simplemente, las que tienen `autor_id is null`.

### Parte A — Varias rutinas propias

- **Se reutiliza la columna `activa` con su nuevo significado: "en curso".** No
  se añade `en_curso` ni se renombra nada: `activa` ya es única por usuario
  (`rutina_libre_usuario_activa_uq`), que es exactamente la semántica que hace
  falta. Renombrar obligaría a tocar todas las RPCs y el código Kotlin que ya la
  leen, a cambio de nada. El cambio real es de comportamiento, no de esquema.
- `generar_rutina_libre` deja de **borrar** la anterior: hace
  `update rutina_libre set activa = false where usuario_id = ... and activa`
  y crea la nueva ya activa. Ese `delete` es lo único que impide tener varias.
- Las 15 rutinas existentes se conservan intactas: ya cumplen la regla (una
  activa por persona), así que **no hace falta backfill**.
- RPCs nuevas: `mis_rutinas()`, `marcar_rutina_en_curso(rutina_id)`,
  `eliminar_mi_rutina(rutina_id)`.

**Gotcha:** al eliminar la rutina en curso hay que promover otra, o la persona
se queda sin ninguna activa y "Mi rutina" aparece vacía.

### Parte B — Publicar y aprobar

Campos nuevos en `rutina_predisenada`:

| Campo | Tipo | Nota |
|---|---|---|
| `autor_id` | uuid null | FK a `usuario`. `null` = curada por FitCore |
| `estado` | text | `pendiente` / `aprobada` / `rechazada` / `retirada` |
| `objetivo` | text | FK a `objetivo_entrenamiento.codigo` |
| `motivo_rechazo` | text null | Para poder decirle al autor por qué |

Flujo:

1. En su rutina, el usuario pulsa "Compartir con la comunidad".
2. Rellena descripción y objetivo; nivel, días y equipo se deducen de la rutina.
3. `publicar_mi_rutina(rutina_libre_id, descripcion, objetivo)` **copia** la
   rutina (días + ejercicios) a `rutina_predisenada` con `estado = 'pendiente'`.
4. El owner aprueba o rechaza desde el panel (misma bandeja que las fotos).
5. Aprobada → aparece en "De la comunidad".

**Se copia, no se enlaza.** Si el autor luego edita su rutina personal, la
publicada no cambia: nadie ve mutar bajo sus pies una rutina que ya está
siguiendo.

**Categorías bloqueadas:** un usuario NO puede publicar en `prenatal` ni
`rehabilitacion`. Esas quedan reservadas a las curadas — son las que más daño
pueden hacer mal hechas.

### Parte C — Puntuación, filtros y orden

Tabla nueva `rutina_voto (rutina_id, usuario_id, estrellas 1-5, created_at)`,
única por `(rutina_id, usuario_id)`.

- **Solo vota quien adoptó** la rutina: la RPC comprueba que la persona tenga
  una `rutina_libre` copiada de esa rutina.
  **Campo nuevo necesario:** `rutina_libre.origen_predisenada_id uuid null` —
  hoy NO existe (verificado en prod), así que al adoptar no queda rastro de
  cuál fue el origen. Lo escribe `adoptar_rutina_predisenada`.
- Denormalizado en `rutina_predisenada`: `puntuacion_prom`, `votos`,
  `veces_adoptada` (contador que sube en `adoptar_rutina_predisenada`).

**Orden:**

| Orden | Cómo |
|---|---|
| Mejor puntuadas | Promedio **bayesiano**: `(v/(v+m))*R + (m/(v+m))*C`, con `m` = mínimo de votos (5) y `C` = media global. Sin esto, una rutina con un único 5★ encabeza la lista |
| Más usadas | `veces_adoptada` desc — el dato más honesto |
| Nuevas | `aprobada_at` desc, para que las recién llegadas tengan oportunidad |

**Filtros** (combinables): objetivo (los 8), nivel, días/semana (1-2, 3-4, 5+),
equipo (sin equipo / mancuernas / gimnasio completo). Más **búsqueda por texto**
sobre nombre y descripción.

El filtro de **equipo** es el más útil: quien entrena en casa no quiere ver
rutinas con máquinas que no tiene.

### La pantalla

```
Rutinas listas
├─ MIS RUTINAS
│   Full body A          [En curso]
│   Pierna intensa       → Usar
│   [+ Crear una rutina]
│
├─ RECOMENDADAS POR FITCORE
│   Full body en casa · Pilates core · Prenatal…
│
└─ DE LA COMUNIDAD          [orden ▾] [filtros]
    Glúteos 4 días    ★4.6 (23)  por María G.
    Push/Pull/Legs    ★4.2 (11)  por Coach Luis
```

Cada tarjeta de comunidad: nombre del autor, descripción, objetivo, las
etiquetas que ya existen (nivel, días/semana, equipo) y su puntuación.

## Riesgos y cómo se tratan

**Catálogo vacío el día 1.** Con aprobación previa, "De la comunidad" estará
vacía al lanzar, y una sección vacía comunica "esto está muerto". Mientras haya
**menos de 5 rutinas aprobadas la sección no se muestra** — solo un texto
discreto invitando a compartir la tuya. Aparece sola cuando hay qué enseñar.

**Salud.** Toda rutina de comunidad lleva un aviso visible: *"Creada por un
usuario de FitCore, no revisada por un profesional. Consulta a tu médico antes
de empezar"*. Más las categorías bloqueadas (arriba) y un **botón de reportar**,
porque el owner puede aprobar algo que luego resulte problemático.

**Borrar una rutina publicada.** Quien ya la adoptó tiene su propia copia y no
se ve afectado. Retirarla solo la oculta del catálogo (`estado = 'retirada'`);
nunca se borran filas que otros estén usando.

**Privacidad del autor.** `usuario.nombre` es el nombre real y es el único campo
de nombre que existe (verificado en prod). Publicar con nombre y apellido expone
a la gente más de lo que espera: **campo nuevo `usuario.nombre_publico text null`**
(alias), editable en el perfil. Si está vacío, se muestra solo el primer nombre
(`split_part(nombre, ' ', 1)`), nunca el apellido.

## Entrega por partes

Cada parte aporta valor sola y se puede publicar por separado:

| Parte | Qué entrega | Depende de |
|---|---|---|
| **A** | Varias rutinas propias + "en curso" | — |
| **B** | Publicar + bandeja de aprobación en el panel | A |
| **C** | Puntuación + filtros + orden | B |

## Verificación

- **BD:** cada migración se prueba en transacción con `rollback` contra prod
  ANTES de aplicarla, con varios casos (no uno). Tras aplicar: firma única de
  cada RPC y `execute` concedido a `authenticated`.
- **Casos que hay que probar explícitamente:** eliminar la rutina en curso;
  votar sin haber adoptado (debe fallar); publicar en categoría bloqueada (debe
  fallar); orden bayesiano con 1 voto vs muchos votos.
- **PostgREST:** nada de `DELETE`/`UPDATE` sin `WHERE` (los rechaza aunque psql
  los acepte), y los nombres del JSON deben coincidir exactos con los
  `@SerialName` de Kotlin — un desajuste ahí no da error, simplemente la
  pantalla no abre.
- **App:** compilar Android **e** iOS, y probar en emulador. Compilar no es
  probar: en esta misma sesión un arreglo se dio por bueno tres veces seguidas y
  seguía fallando en el dispositivo.
- **Panel:** `npm test` y `npm run build` limpios.

## Fuera de alcance (a propósito)

- **Comentarios** en las rutinas: multiplican la moderación y no se pidieron.
- **Seguir a un autor**: tiene sentido con volumen, no al arrancar.
- **Editar una rutina ya publicada**: mejor publicar otra versión que cambiarla
  bajo quien la está usando.
- **Rutinas de pago**: nada en este diseño cobra por publicar ni por adoptar.
