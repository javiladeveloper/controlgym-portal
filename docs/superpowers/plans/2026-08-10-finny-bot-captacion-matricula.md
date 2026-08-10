# Finny — bot de captación y matrícula · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el WhatsApp de un gimnasio responda solo, califique al interesado
y lo lleve a visitar el gym o a pagar su matrícula, sin que nadie llegue a una
puerta cerrada.

**Architecture:** Un objetivo nuevo (`matricular_socio`) en el motor de LeadAI,
con su módulo de rubro y su guardarraíl de salida, espejando exactamente la
estructura que ya funciona para clínicas. FitCore expone una acción para
generar el link de cobro; el webhook que ya existe deja al socio en
`pendiente_activacion` y recepción completa el alta.

**Tech Stack:** LeadAI = Node 20 · TypeScript · Fastify · Prisma · PostgreSQL ·
Zod · vitest · Claude Haiku. FitCore = serverless en `api/` (Node) · Supabase
Postgres · MercadoPago.

**Spec:** `docs/superpowers/specs/2026-08-10-finny-bot-captacion-matricula-design.md`

## Global Constraints

- **Dos repos.** LeadAI vive en `d:/Personal Proyects/leadia`; FitCore en
  `d:/Personal Proyects/ControlGym`. Cada tarea dice en cuál se trabaja.
- **NO desplegar LeadAI sin coordinar con el owner.** Es el motor que Sania usa
  en producción. Commitear sí; `git push` y migraciones de BD, solo con su OK.
- **Nada de lo existente se rompe.** Todo es aditivo: los tenants de clínicas,
  restaurantes y captación clásica deben comportarse exactamente igual. La
  suite completa (1203 tests) tiene que seguir verde.
- **La regla que nunca se cruza:** Finny jamás afirma que alguien quedó
  matriculado, inscrito o activo. Dice que el pago entró y que en recepción lo
  activan.
- **Validación por código, no por prompt.** El guardarraíl revisa lo que la IA
  escribió ANTES de enviarlo. El prompt pide; el guardarraíl garantiza.
- **Nunca silencio.** Si la IA falla o se agota la cuota, sale un texto fijo.
- **Aserciones por propiedades, nunca por texto exacto.** Haiku varía la
  redacción y eso está bien: se afirma "contiene el precio real", no "dice esta
  frase".
- **Textos y números configurables por tenant** vía `configCaptacionDe()`, sin
  deploy.
- **Tenant real de prueba:** `cmsmmd8ua000nqj01xtgqagof` (MaximusGym) en
  `https://api.leadai-pe.com`, con perfil ya cargado: planes S/60 Básico, S/90
  Estándar, S/130 Premium, S/1300 Anual; promos "Verano -20%", "2x1 parejas",
  "3x2 entrena con tus patas", "Año Completo S/999".
- **BD de FitCore:** proyecto `zlmqdubrjzmagslcsqvb`. Toda prueba contra datos
  reales va en transacción con `rollback`.
- **Idioma:** el código, comentarios y textos del bot van en español, como el
  resto de ambos repos.

## Estructura de archivos

**LeadAI** (`d:/Personal Proyects/leadia`):

| Archivo | Responsabilidad |
|---|---|
| `src/core/objetivo.ts` (modificar) | Añadir `'matricular_socio'` al tipo y a la derivación |
| `src/core/guion-gimnasio.ts` (crear) | Guardarraíl de salida del rubro: qué NO puede decir Finny |
| `src/core/captacion-gimnasio.ts` (crear) | Comportamiento del rubro: escalera de precios, desvíos, ruido |
| `src/core/gimnasio-config.ts` (crear) | Textos y números por defecto del rubro, sobreescribibles por tenant |
| `src/core/venta-conversacion.ts` (crear) | Máquina de estados: interés → plan → datos → visita/link |
| `src/core/leads.ts` (modificar) | Enganchar el objetivo nuevo, junto a los que ya existen |
| `tests/guion-gimnasio.test.ts` (crear) | Unitarios del guardarraíl |
| `tests/captacion-gimnasio.test.ts` (crear) | Unitarios del comportamiento |
| `evals/golden-gimnasio.test.ts` (crear) | Suite dorada contra el tenant real |

**FitCore** (`d:/Personal Proyects/ControlGym`):

| Archivo | Responsabilidad |
|---|---|
| `api/leadia/index.js` (modificar) | Acción `?action=link-pago` |
| `supabase/migrations/…_finny_link_pago.sql` (crear) | RPC que valida y prepara el cobro |

## Orden de entrega

- **Tareas 1-5 → modo `visita`.** No toca dinero. Entregable con valor propio:
  el gym tiene un bot que responde, califica y lleva gente a visitar.
- **Tareas 6-8 → modo `matricula`.** Añade el cobro sobre lo anterior.
- **Tarea 9 → suite dorada.** Cierra ambos modos.

---

### Task 1: El objetivo `matricular_socio`

Hoy un gimnasio cae en `captar_y_derivar` (pipeline clásico: calificar, nutrir,
escalar). Finny necesita su propio objetivo para poder interceptar la
conversación, igual que `agendar_citas` hace con las clínicas.

**Files:**
- Modify: `d:/Personal Proyects/leadia/src/core/objetivo.ts`
- Test: `d:/Personal Proyects/leadia/tests/objetivo-gimnasio.test.ts` (crear)

**Interfaces:**
- Consumes: `ConfigPedidos` de `./pedidos-config.js`, `saniaActiva` de `./sania.js`
- Produces: `ObjetivoBot` ahora incluye `'matricular_socio'`; `fitcoreActiva(cfg): boolean`

- [ ] **Step 1: Escribir el test que falla**

Crear `d:/Personal Proyects/leadia/tests/objetivo-gimnasio.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { objetivoDe, fitcoreActiva } from '../src/core/objetivo.js';

/**
 * El objetivo del bot decide TODO su comportamiento. Un gimnasio con FitCore
 * conectado tiene que caer en 'matricular_socio'; sin conectar, sigue en el
 * pipeline clásico como hasta hoy (nadie se rompe).
 */

const VACIO = {
  objetivo: '', modoPedidos: false, saniaUrl: '', saniaApiKey: '',
  fitcoreUrl: '', fitcoreApiKey: '', fitcoreEmpresaId: '',
};

describe('objetivo del bot para gimnasios', () => {
  it('un tenant con FitCore conectado es matricular_socio', () => {
    expect(objetivoDe({
      ...VACIO,
      fitcoreUrl: 'https://fitcorecenter.com',
      fitcoreApiKey: 'k',
      fitcoreEmpresaId: 'emp-1',
    })).toBe('matricular_socio');
  });

  it('el objetivo explícito manda sobre la derivación', () => {
    expect(objetivoDe({ ...VACIO, objetivo: 'matricular_socio' })).toBe('matricular_socio');
  });

  it('sin FitCore conectado NO cambia de objetivo (no rompe a nadie)', () => {
    expect(objetivoDe(VACIO)).toBe('captar_y_derivar');
  });

  it('una clínica con Sania sigue siendo agendar_citas', () => {
    expect(objetivoDe({ ...VACIO, saniaUrl: 'https://s', saniaApiKey: 'k' }))
      .toBe('agendar_citas');
  });

  it('un restaurante sigue siendo vender_pedidos', () => {
    expect(objetivoDe({ ...VACIO, modoPedidos: true })).toBe('vender_pedidos');
  });

  it('fitcoreActiva exige las TRES credenciales', () => {
    expect(fitcoreActiva({ fitcoreUrl: 'u', fitcoreApiKey: 'k', fitcoreEmpresaId: 'e' })).toBe(true);
    expect(fitcoreActiva({ fitcoreUrl: 'u', fitcoreApiKey: '', fitcoreEmpresaId: 'e' })).toBe(false);
    expect(fitcoreActiva({ fitcoreUrl: '', fitcoreApiKey: 'k', fitcoreEmpresaId: 'e' })).toBe(false);
    expect(fitcoreActiva({ fitcoreUrl: 'u', fitcoreApiKey: 'k', fitcoreEmpresaId: '' })).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y ver que falla**

```bash
cd "d:/Personal Proyects/leadia" && npx vitest run tests/objetivo-gimnasio.test.ts
```

Esperado: FALLA — `fitcoreActiva` no existe y `'matricular_socio'` no es un
`ObjetivoBot` válido.

- [ ] **Step 3: Implementar**

Reemplazar el contenido de `d:/Personal Proyects/leadia/src/core/objetivo.ts`
por:

```typescript
import type { ConfigPedidos } from './pedidos-config.js';
import { saniaActiva } from './sania.js';

/**
 * CATEGORÍA DEL BOT POR INTENCIÓN (regla SaaS del dueño 2026-07-24): qué debe
 * LOGRAR este bot. Cada objetivo selecciona un paquete de comportamiento:
 *
 *  - 'agendar_citas'    → modo captación (clínicas): convertir el chat en una
 *                         CITA agendada (máquina de citas + escalera de precios
 *                         + guardarraíl de guion). Requiere backend de agenda
 *                         (hoy: Sania).
 *  - 'vender_pedidos'   → modo pedidos (restaurantes): cerrar la VENTA en el
 *                         chat (carta → carrito → pago Yape validado).
 *  - 'matricular_socio' → modo gimnasio (Finny, FitCore): llevar el chat a una
 *                         VISITA al gym o a la MATRÍCULA pagada. Requiere
 *                         backend de gimnasio (FitCore).
 *  - 'captar_y_derivar' → pipeline clásico: calificar al lead, nutrirlo y
 *                         escalarlo al vendedor HUMANO con borrador
 *                         (inmobiliaria, servicios generales).
 *
 * El campo Tenant.objetivo manda; si está vacío (tenants pre-existentes) se
 * deriva de los flags legacy — nadie se rompe.
 */

export type ObjetivoBot =
  | 'agendar_citas'
  | 'vender_pedidos'
  | 'matricular_socio'
  | 'captar_y_derivar';

/**
 * ¿Este tenant tiene un gimnasio de FitCore detrás de verdad?
 *
 * Se exigen las TRES credenciales porque sin cualquiera de ellas el bot no
 * puede hacer su trabajo: sin URL no sabe a dónde escribir, sin clave lo
 * rechazan, y sin empresa no sabe de qué gimnasio habla. Un bot que promete
 * matricular sin poder hacerlo es peor que uno que no lo intenta.
 */
export function fitcoreActiva(
  cfg: Pick<ConfigPedidos, 'fitcoreUrl' | 'fitcoreApiKey' | 'fitcoreEmpresaId'>,
): boolean {
  return Boolean(cfg.fitcoreUrl && cfg.fitcoreApiKey && cfg.fitcoreEmpresaId);
}

export function objetivoDe(
  cfg: Pick<
    ConfigPedidos,
    | 'objetivo' | 'modoPedidos' | 'saniaUrl' | 'saniaApiKey'
    | 'fitcoreUrl' | 'fitcoreApiKey' | 'fitcoreEmpresaId'
  >,
): ObjetivoBot {
  if (
    cfg.objetivo === 'agendar_citas' ||
    cfg.objetivo === 'vender_pedidos' ||
    cfg.objetivo === 'matricular_socio' ||
    cfg.objetivo === 'captar_y_derivar'
  ) {
    return cfg.objetivo;
  }
  // Legacy (objetivo vacío): derivar de los switches con los que nació cada modo.
  if (cfg.modoPedidos) return 'vender_pedidos';
  if (saniaActiva(cfg)) return 'agendar_citas';
  if (fitcoreActiva(cfg)) return 'matricular_socio';
  return 'captar_y_derivar';
}
```

- [ ] **Step 4: Añadir los campos a `ConfigPedidos`**

En `d:/Personal Proyects/leadia/src/core/pedidos-config.ts`, añadir al tipo
`ConfigPedidos` (junto a `saniaUrl` / `saniaApiKey`):

```typescript
  fitcoreUrl: string;
  fitcoreApiKey: string;
  fitcoreEmpresaId: string;
  fitcoreSedeId: string;
```

Y en la consulta que lo carga (buscar el `select` de Prisma que trae
`saniaUrl: true`), añadir:

```typescript
      fitcoreUrl: true,
      fitcoreApiKey: true,
      fitcoreEmpresaId: true,
      fitcoreSedeId: true,
```

- [ ] **Step 5: Correr el test y ver que pasa**

```bash
cd "d:/Personal Proyects/leadia" && npx vitest run tests/objetivo-gimnasio.test.ts
```

Esperado: PASA — 6 tests.

- [ ] **Step 6: Verificar que no se rompió nada**

```bash
cd "d:/Personal Proyects/leadia" && npx tsc --noEmit && npx vitest run
```

Esperado: `tsc` sin salida; vitest `Test Files 130 passed`, `Tests 1209 passed`
(1203 previos + 6 nuevos). Si algún test viejo falla, el objetivo nuevo rompió
una derivación — revisar antes de seguir.

- [ ] **Step 7: Commit**

```bash
cd "d:/Personal Proyects/leadia"
git add src/core/objetivo.ts src/core/pedidos-config.ts tests/objetivo-gimnasio.test.ts
git commit -m "feat(gimnasio): objetivo matricular_socio

Un gimnasio caia en captar_y_derivar (calificar, nutrir, escalar). Con su
propio objetivo, Finny puede interceptar la conversacion igual que las
clinicas con agendar_citas.

Se exigen las TRES credenciales de FitCore para activarlo: un bot que
promete matricular sin poder hacerlo es peor que uno que no lo intenta."
```

---

### Task 2: Textos y números del rubro gimnasio

Todo el guion de Finny vive en un solo sitio y cada gimnasio puede
sobreescribirlo desde su perfil sin que nadie despliegue nada. Es la misma
regla que Sania aplica con `captacion-config.ts`.

**Files:**
- Create: `d:/Personal Proyects/leadia/src/core/gimnasio-config.ts`
- Test: `d:/Personal Proyects/leadia/tests/gimnasio-config.test.ts`

**Interfaces:**
- Consumes: `PerfilNegocio` de `./types.js`, `tpl` de `./captacion-config.js`
- Produces: `TEXTOS_GIMNASIO_DEFAULT`, `NUMEROS_GIMNASIO_DEFAULT`,
  `configGimnasioDe(perfil): { textos: Record<string,string>; numeros: Record<string,number> }`

- [ ] **Step 1: Escribir el test que falla**

Crear `d:/Personal Proyects/leadia/tests/gimnasio-config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { configGimnasioDe, TEXTOS_GIMNASIO_DEFAULT } from '../src/core/gimnasio-config.js';

/**
 * El guion de cada gimnasio se ajusta SIN DESPLEGAR: los defaults son el
 * comportamiento del rubro y cada gym sobreescribe lo que quiera desde su
 * perfil.
 */
describe('config del rubro gimnasio', () => {
  it('sin perfil devuelve los defaults del rubro', () => {
    const c = configGimnasioDe(null);
    expect(c.textos.ganchoPrecio).toBe(TEXTOS_GIMNASIO_DEFAULT.ganchoPrecio);
    expect(c.numeros.maxPreguntasPrecio).toBe(2);
  });

  it('el gym puede cambiar un texto sin tocar el resto', () => {
    const c = configGimnasioDe({
      captacion: { textos: { ganchoPrecio: 'Ven, el primer día es gratis' } },
    } as never);
    expect(c.textos.ganchoPrecio).toBe('Ven, el primer día es gratis');
    // Los demás siguen siendo los del rubro.
    expect(c.textos.salud).toBe(TEXTOS_GIMNASIO_DEFAULT.salud);
  });

  it('el gym puede cambiar un número', () => {
    const c = configGimnasioDe({ captacion: { numeros: { maxPreguntasPrecio: 3 } } } as never);
    expect(c.numeros.maxPreguntasPrecio).toBe(3);
    expect(c.numeros.avisosRuido).toBe(2); // el resto intacto
  });

  it('una clave desconocida se ignora en vez de romper', () => {
    const c = configGimnasioDe({ captacion: { textos: { inventada: 'x' } } } as never);
    expect(c.textos.ganchoPrecio).toBe(TEXTOS_GIMNASIO_DEFAULT.ganchoPrecio);
  });
});
```

- [ ] **Step 2: Correr el test y ver que falla**

```bash
cd "d:/Personal Proyects/leadia" && npx vitest run tests/gimnasio-config.test.ts
```

Esperado: FALLA — `Cannot find module '../src/core/gimnasio-config.js'`.

- [ ] **Step 3: Implementar**

Crear `d:/Personal Proyects/leadia/src/core/gimnasio-config.ts`:

```typescript
import type { PerfilNegocio } from './types.js';

/**
 * TODAS LAS PERILLAS del rubro gimnasio en UN solo lugar (misma regla SaaS que
 * captacion-config.ts para clínicas: "en algún momento reutilizaremos esto
 * para otro bot").
 *
 * - Los DEFAULTS son el comportamiento del rubro: lo que diría un vendedor de
 *   gimnasio peruano que sabe lo que hace.
 * - Cada gym sobreescribe CUALQUIER texto o número desde la sección `captacion`
 *   de su perfil (PUT /perfil). Cero deploys para ajustar el guion.
 * - Los textos usan placeholders {plan} {precio} {promo} {nombre} que rellena
 *   tpl() de captacion-config.ts.
 */

export interface ConfigGimnasio {
  textos: Record<string, string>;
  numeros: Record<string, number>;
}

export const TEXTOS_GIMNASIO_DEFAULT: Record<string, string> = {
  // ── escalera de precios ──
  // 1er peldaño: FIJO, 0 tokens. Es la pregunta más frecuente del rubro, así
  // que responderla con IA sería quemar cuota en lo más previsible. Termina
  // preguntando el objetivo porque eso es lo que permite recomendar un plan.
  ganchoPrecio: '¡Hola! 💪 El pase de prueba es gratis, así conoces el gym sin compromiso. Cuéntame, ¿qué te gustaría lograr: bajar de peso, ganar músculo o mantenerte?',
  // Respaldo del 2º peldaño: si la IA falla o no hay cuota, el precio sale igual.
  precioRespaldo: 'Tenemos planes desde S/60 al mes 🙌 ¿Te cuento cuál te conviene según lo que buscas?',
  // 3er peldaño: quien pregunta el precio tres veces está regateando.
  precioTerceraVez: 'Déjame que te ayude mejor un asesor del gym con eso 🙌 En un momentito te escriben por aquí.',

  // ── desvíos ──
  // Salud: responde con calidez y SIGUE VENDIENDO, pero sin decir si puede o
  // no entrenar. Eso lo evalúa un profesional en el local.
  salud: 'Uy, con eso mejor que te vea uno de nuestros entrenadores en el local — ellos evalúan tu caso y te arman algo seguro 🙌 ¿Te separo un pase para esta semana?',
  fueraDeGuion: 'Buena pregunta 🙌 Déjame que te confirme eso un asesor del gym y te escriben por aquí en un momento.',

  // ── ruido ──
  // "No te entendí" es defensivo y no vende: quien escribe "mmm" está
  // titubeando, no confundido. Se le da una salida fácil y una razón para venir.
  ruidoAviso1: 'Cuéntame qué te gustaría lograr y te digo qué plan te conviene 😊 El pase de prueba es gratis.',
  ruidoAviso2: 'Cuando quieras me escribes y te armo tu pase de prueba 🙌 Aquí estamos.',

  // ── cierre modo VISITA ──
  visitaPideDia: '¡Buenísimo! 🙌 ¿Qué día te acomoda venir? (ej: *mañana*, *el sábado*)',
  visitaSeparada: '¡Listo! Te espero el {dia} 💪 Pregunta por recepción y te dan tu pase de prueba. ¡Nos vemos!',

  // ── cierre modo MATRÍCULA ──
  planSugerido: 'Por lo que me cuentas te va bien el {plan} ({precio}) 💪 {promo}¿Te mando el link para separarlo?',
  pideNombre: '¡Perfecto! Para dejarlo a tu nombre, ¿cómo te llamas? ✍️',
  linkPago: '¡Listo {nombre}! Aquí puedes pagar tu {plan}: {link}\n\nApenas entre tu pago te confirmo por aquí 🙌',
  // La frase MÁS importante del bot: nunca decir "ya estás matriculado".
  pagoRecibido: '¡Tu pago entró! ✅ Cuando vengas, pasa por recepción con tu DNI y te activan la membresía (te toman la foto para tu carnet). ¡Te esperamos! 💪',
  linkYaEnviado: 'Ya te mandé el link arriba 🙌 Si tuviste algún problema al pagar, dime y te ayudo.',
  cobroNoDisponible: 'Te separo un pase para que vengas a conocer el gym y ahí mismo te matriculas 🙌 ¿Qué día te acomoda?',
};

export const NUMEROS_GIMNASIO_DEFAULT: Record<string, number> = {
  /** preguntas de precio que atiende la escalera antes de pasar a un humano */
  maxPreguntasPrecio: 2,
  /** avisos de cortesía ante ruido antes del silencio anti-spam */
  avisosRuido: 2,
  /** minutos que se considera "ya le mandé el link" para no generar otro */
  minutosLinkVivo: 60,
};

/**
 * Config efectiva del gym: DEFAULTS + overrides de su perfil. Una clave
 * desconocida en el override se ignora en silencio (no rompe bots viejos ni
 * nuevos).
 */
export function configGimnasioDe(
  perfil?: Pick<PerfilNegocio, 'captacion'> | null,
): ConfigGimnasio {
  const ov = perfil?.captacion;
  return {
    textos: { ...TEXTOS_GIMNASIO_DEFAULT, ...(ov?.textos ?? {}) },
    numeros: { ...NUMEROS_GIMNASIO_DEFAULT, ...(ov?.numeros ?? {}) },
  };
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

```bash
cd "d:/Personal Proyects/leadia" && npx vitest run tests/gimnasio-config.test.ts
```

Esperado: PASA — 4 tests.

- [ ] **Step 5: Commit**

```bash
cd "d:/Personal Proyects/leadia"
git add src/core/gimnasio-config.ts tests/gimnasio-config.test.ts
git commit -m "feat(gimnasio): textos y numeros del rubro, configurables por gym

Mismo patron que captacion-config.ts: los defaults son el comportamiento
del rubro y cada gimnasio los sobreescribe desde su perfil sin desplegar."
```

---

### Task 3: Guardarraíl de salida del gimnasio

Lo que impide que la IA prometa lo que el gym no puede cumplir. **Valida el
texto ANTES de enviarlo**, porque el prompt pide pero el código garantiza.

**Files:**
- Create: `d:/Personal Proyects/leadia/src/core/guion-gimnasio.ts`
- Test: `d:/Personal Proyects/leadia/tests/guion-gimnasio.test.ts`

**Interfaces:**
- Consumes: nada de tareas previas (módulo puro)
- Produces:
  - `esPreguntaDePrecio(texto: string): boolean`
  - `esTemaDeSalud(texto: string): boolean`
  - `violaGuionGimnasio(texto: string, preciosValidos: string[]): string | null`
  - `velarGuionGimnasio(texto: string, opts: { preciosValidos: string[]; respaldo: string }): { texto: string; sustituido: boolean; motivo: string | null }`

- [ ] **Step 1: Escribir el test que falla**

Crear `d:/Personal Proyects/leadia/tests/guion-gimnasio.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  esPreguntaDePrecio,
  esTemaDeSalud,
  violaGuionGimnasio,
  velarGuionGimnasio,
} from '../src/core/guion-gimnasio.js';

/**
 * GUARDARRAÍL DE SALIDA. Sania documenta la "cita fantasma" como el peor error
 * posible: que la IA se despida confirmando algo que no existe. En un gimnasio
 * es peor, porque hay dinero: el socio paga, le dicen que ya está inscrito,
 * llega al gym y no puede entrar.
 */

const PRECIOS = ['60', '90', '130', '1300'];

describe('detección de intención', () => {
  it('reconoce preguntas de precio', () => {
    expect(esPreguntaDePrecio('cuanto cuesta?')).toBe(true);
    expect(esPreguntaDePrecio('cuánto sale la mensualidad')).toBe(true);
    expect(esPreguntaDePrecio('que precio tiene')).toBe(true);
    expect(esPreguntaDePrecio('cuanto es al mes')).toBe(true);
  });

  it('no confunde otras preguntas con precio', () => {
    expect(esPreguntaDePrecio('a que hora abren?')).toBe(false);
    expect(esPreguntaDePrecio('donde quedan')).toBe(false);
  });

  it('reconoce temas de salud', () => {
    expect(esTemaDeSalud('tengo una hernia, puedo entrenar?')).toBe(true);
    expect(esTemaDeSalud('estoy embarazada')).toBe(true);
    expect(esTemaDeSalud('me opere la rodilla hace poco')).toBe(true);
    expect(esTemaDeSalud('tengo lesion en el hombro')).toBe(true);
  });

  it('no marca como salud una charla normal', () => {
    expect(esTemaDeSalud('quiero ganar musculo')).toBe(false);
    expect(esTemaDeSalud('cuanto cuesta')).toBe(false);
  });
});

describe('violaciones del guion', () => {
  it('MATRÍCULA FANTASMA: afirmar que ya está inscrito', () => {
    expect(violaGuionGimnasio('¡Listo! Ya estás matriculado, te esperamos.', PRECIOS))
      .toBe('matricula_fantasma');
    expect(violaGuionGimnasio('Tu membresía ya está activa 🙌', PRECIOS))
      .toBe('matricula_fantasma');
    expect(violaGuionGimnasio('Quedaste inscrito en el plan Premium', PRECIOS))
      .toBe('matricula_fantasma');
  });

  it('decir que el pago entró SÍ se permite (es la verdad)', () => {
    expect(violaGuionGimnasio(
      '¡Tu pago entró! ✅ Pasa por recepción y te activan la membresía.', PRECIOS,
    )).toBeNull();
  });

  it('presentarse como bot', () => {
    expect(violaGuionGimnasio('Soy un asistente virtual del gimnasio', PRECIOS))
      .toBe('se_presenta_como_bot');
  });

  it('precio inventado que no está en el catálogo', () => {
    expect(violaGuionGimnasio('El plan sale S/45 al mes', PRECIOS)).toBe('precio_inventado');
  });

  it('un precio real del catálogo pasa limpio', () => {
    expect(violaGuionGimnasio('El Premium está S/130 al mes', PRECIOS)).toBeNull();
  });

  it('prometer acciones de recepción', () => {
    expect(violaGuionGimnasio('Te congelo la membresía dos semanas', PRECIOS))
      .toBe('promete_accion_de_recepcion');
    expect(violaGuionGimnasio('Ya te apliqué el descuento 2x1', PRECIOS))
      .toBe('promete_accion_de_recepcion');
  });

  it('opinar si puede o no entrenar (salud)', () => {
    expect(violaGuionGimnasio('Sí puedes entrenar con esa hernia, tranquilo', PRECIOS))
      .toBe('opina_de_salud');
    expect(violaGuionGimnasio('No deberías entrenar en tu estado', PRECIOS))
      .toBe('opina_de_salud');
  });

  it('invitar NO es confirmar (falso positivo que no debe saltar)', () => {
    expect(violaGuionGimnasio('¿Te espero el martes? Dime qué día te acomoda 🙌', PRECIOS))
      .toBeNull();
  });
});

describe('velado: sustituye y avisa', () => {
  it('sustituye por el respaldo cuando hay violación', () => {
    const r = velarGuionGimnasio('Ya estás matriculado', {
      preciosValidos: PRECIOS, respaldo: 'Tu pago entró, pasa por recepción.',
    });
    expect(r.sustituido).toBe(true);
    expect(r.motivo).toBe('matricula_fantasma');
    expect(r.texto).toBe('Tu pago entró, pasa por recepción.');
  });

  it('deja pasar el texto limpio sin tocarlo', () => {
    const bueno = 'El Premium está S/130 al mes 💪 ¿Te mando el link?';
    const r = velarGuionGimnasio(bueno, { preciosValidos: PRECIOS, respaldo: 'x' });
    expect(r.sustituido).toBe(false);
    expect(r.motivo).toBeNull();
    expect(r.texto).toBe(bueno);
  });
});
```

- [ ] **Step 2: Correr el test y ver que falla**

```bash
cd "d:/Personal Proyects/leadia" && npx vitest run tests/guion-gimnasio.test.ts
```

Esperado: FALLA — `Cannot find module '../src/core/guion-gimnasio.js'`.

- [ ] **Step 3: Implementar**

Crear `d:/Personal Proyects/leadia/src/core/guion-gimnasio.ts`:

```typescript
/**
 * GUARDARRAÍL DE SALIDA para gimnasios (Finny/FitCore): valida lo que la IA
 * arroja ANTES de enviarlo y de guardarlo. Doble propósito:
 *  1) el cliente nunca recibe una respuesta fuera del guion del gym, y
 *  2) el corpus del que aprende el sistema no se contamina con alucinaciones.
 *
 * Validación por CÓDIGO, no por prompt: el prompt pide; esto GARANTIZA.
 * (Mismo principio que guion-clinica.ts, otro rubro.)
 *
 * LA REGLA QUE NUNCA SE CRUZA: Finny no afirma que alguien quedó matriculado.
 * Sania documenta la "cita fantasma" como el peor error posible; acá es peor,
 * porque hay dinero: el socio paga, le dicen que ya está inscrito, llega al
 * gimnasio y no puede entrar.
 */

function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ── Detección de intención del CLIENTE ──────────────────────────────────────

const RE_PRECIO_INTENT =
  /\b(cuanto|cuánto|precio|precios|cuesta|cuestan|sale|valen?|vale|mensualidad|tarifa|costo)\b/;

/** ¿El cliente está preguntando por el precio? */
export function esPreguntaDePrecio(texto: string): boolean {
  return RE_PRECIO_INTENT.test(normalizar(texto));
}

// Condiciones y situaciones sobre las que el gym NO puede opinar por chat.
const RE_SALUD =
  /\b(hernia|lesion|lesionad|opere|opero|operacion|cirugia|embarazad|gestant|diabet|hipertens|cardiac|corazon|rodilla|columna|lumbar|cervical|tendinitis|artrosis|fractur|esguince|desgarr|rehabilitacion|fisioterapia|dolor de (espalda|rodilla|hombro|cuello))\b/;

/** ¿El mensaje toca un tema de salud que requiere criterio profesional? */
export function esTemaDeSalud(texto: string): boolean {
  return RE_SALUD.test(normalizar(texto));
}

// ── Violaciones del guion (lo que la IA NO puede decir) ─────────────────────

// MATRÍCULA FANTASMA: afirmar que la inscripción ya está hecha. Solo recepción
// activa una membresía; el bot como mucho confirma que el PAGO entró.
const RE_MATRICULA_FANTASMA =
  /\b(ya (estas|quedaste|quedas) (matriculad|inscrit|registrad|afiliad)|(estas|quedaste) (matriculad|inscrit)|tu (membresia|matricula|inscripcion) (ya )?(esta|quedo) (activ|list|confirmad)|(te )?(matricule|inscribi|registre|afilie))\b/;

// Se presenta como bot: mata la calidez que hace que la gente responda.
const RE_BOT =
  /\b(soy (el|la|un|una) (asistente|bot|robot|ia)|asistente virtual|soy un sistema|chatbot|inteligencia artificial)\b/;

// Acciones que ejecuta RECEPCIÓN, no el bot: congelar, aplicar promos, dar de alta.
const RE_ACCION_DE_RECEPCION =
  /\b(te (congelo|congele|apliqu[eé]|aplico|active|activo|di de alta|doy de alta|descuento ya)|ya te (aplique|active|congele|di de alta)|(te lo|te la) (congelo|active|aplique))\b/;

// Opinar si la persona PUEDE o NO puede entrenar: eso lo evalúa un profesional.
const RE_OPINA_SALUD =
  /\b((si|sí) puedes entrenar|puedes entrenar (sin problema|tranquil)|no (puedes|deberias|debes) entrenar|no hay problema (con|para) (tu|esa) (lesion|hernia|operacion|embarazo)|es seguro (que )?entrenes)\b/;

// Cualquier cifra en soles que el texto menciona como precio.
const RE_CIFRA_SOLES = /\b(?:s\/\s*|soles\s*)?(\d{2,5})(?:\s*soles)?\b/g;

/**
 * Motivo de violación, o null si la respuesta es válida.
 *
 * @param preciosValidos cifras del catálogo real del gym ("60", "130"…). Una
 *   cifra en soles que no esté aquí es un precio inventado.
 */
export function violaGuionGimnasio(texto: string, preciosValidos: string[]): string | null {
  const t = normalizar(texto);

  if (RE_MATRICULA_FANTASMA.test(t)) return 'matricula_fantasma';
  if (RE_BOT.test(t)) return 'se_presenta_como_bot';
  if (RE_OPINA_SALUD.test(t)) return 'opina_de_salud';
  if (RE_ACCION_DE_RECEPCION.test(t)) return 'promete_accion_de_recepcion';

  // Precios: solo se revisan las cifras presentadas COMO precio (con S/ o
  // "soles"), para no marcar "45 minutos" o "3 veces por semana".
  const conMoneda = t.match(/\b(?:s\/\s*\d{2,5}|\d{2,5}\s*soles)\b/g) ?? [];
  for (const bruto of conMoneda) {
    const cifra = bruto.replace(/\D/g, '');
    if (cifra && !preciosValidos.includes(cifra)) return 'precio_inventado';
  }

  return null;
}

/**
 * Valida y, si hace falta, SUSTITUYE por un texto seguro del gym.
 * Nunca devuelve vacío: el cliente siempre recibe algo (regla "nunca silencio").
 */
export function velarGuionGimnasio(
  texto: string,
  opts: { preciosValidos: string[]; respaldo: string },
): { texto: string; sustituido: boolean; motivo: string | null } {
  const motivo = violaGuionGimnasio(texto, opts.preciosValidos);
  if (!motivo) return { texto, sustituido: false, motivo: null };
  return { texto: opts.respaldo, sustituido: true, motivo };
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

```bash
cd "d:/Personal Proyects/leadia" && npx vitest run tests/guion-gimnasio.test.ts
```

Esperado: PASA — 13 tests. Si `precio_inventado` falla en el caso "S/45",
revisar que la regex `conMoneda` capture `s/ 45` con y sin espacio.

- [ ] **Step 5: Commit**

```bash
cd "d:/Personal Proyects/leadia"
git add src/core/guion-gimnasio.ts tests/guion-gimnasio.test.ts
git commit -m "feat(gimnasio): guardarrail de salida

Valida lo que la IA escribio ANTES de enviarlo: el prompt pide, esto
garantiza. Bloquea la matricula fantasma (el peor error posible: el socio
paga, le dicen que ya esta inscrito y llega a una puerta cerrada),
presentarse como bot, precios inventados, prometer lo que hace recepcion
y opinar si alguien puede o no entrenar."
```

---

### Task 4: Comportamiento del rubro (escalera, desvíos, ruido)

El módulo que decide qué hace Finny con cada mensaje, antes de que hable la IA.

**Files:**
- Create: `d:/Personal Proyects/leadia/src/core/captacion-gimnasio.ts`
- Test: `d:/Personal Proyects/leadia/tests/captacion-gimnasio.test.ts`

**Interfaces:**
- Consumes: `configGimnasioDe` (Task 2); `esPreguntaDePrecio`, `esTemaDeSalud`,
  `velarGuionGimnasio` (Task 3); `fitcoreActiva` (Task 1)
- Produces:
  - `modoGimnasioActivo(cfg): boolean`
  - `esRuido(texto: string): boolean`
  - `decidirRespuestaGimnasio(entrada): Promise<{ manejado: boolean; accion: string; texto: string | null }>`

- [ ] **Step 1: Escribir el test que falla**

Crear `d:/Personal Proyects/leadia/tests/captacion-gimnasio.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { esRuido, decidirRespuestaGimnasio } from '../src/core/captacion-gimnasio.js';
import { TEXTOS_GIMNASIO_DEFAULT } from '../src/core/gimnasio-config.js';

/**
 * Comportamiento del rubro: la escalera de precios, los desvíos y el ruido.
 * La lección de Sania: "No te entendí" es defensivo y no vende — quien escribe
 * "mmm" está titubeando, no confundido.
 */

const BASE = {
  cap: { textos: TEXTOS_GIMNASIO_DEFAULT, numeros: { maxPreguntasPrecio: 2, avisosRuido: 2, minutosLinkVivo: 60 } },
  vecesPrecio: 0,
  avisosRuidoDados: 0,
  primerContacto: true,
};

describe('detección de ruido', () => {
  it('marca ruido real', () => {
    expect(esRuido('sdfgh')).toBe(true);
    expect(esRuido('A')).toBe(true);
    expect(esRuido('...')).toBe(true);
  });

  it('NO marca titubeo (está dudando, no confundido)', () => {
    expect(esRuido('mmm')).toBe(false);
    expect(esRuido('ok')).toBe(false);
    expect(esRuido('ya')).toBe(false);
    expect(esRuido('aja')).toBe(false);
  });

  it('NO marca un teléfono o DNI suelto (es un dato, no ruido)', () => {
    expect(esRuido('987654321')).toBe(false);
    expect(esRuido('46027897')).toBe(false);
  });
});

describe('escalera de precios', () => {
  it('1ª pregunta: gancho fijo, sin IA', async () => {
    const r = await decidirRespuestaGimnasio({ ...BASE, texto: 'cuanto cuesta?' });
    expect(r.manejado).toBe(true);
    expect(r.accion).toBe('gancho_precio');
    expect(r.texto).toBe(TEXTOS_GIMNASIO_DEFAULT.ganchoPrecio);
  });

  it('2ª pregunta: la deja pasar para que responda la IA con el dato', async () => {
    const r = await decidirRespuestaGimnasio({
      ...BASE, texto: 'ya pero cuanto sale exactamente', vecesPrecio: 1, primerContacto: false,
    });
    expect(r.manejado).toBe(false);
    expect(r.accion).toBe('precio_a_la_ia');
  });

  it('3ª pregunta: escala a humano (esto Sania no lo tiene)', async () => {
    const r = await decidirRespuestaGimnasio({
      ...BASE, texto: 'pero cuanto es lo minimo que me puedes dejar', vecesPrecio: 2, primerContacto: false,
    });
    expect(r.manejado).toBe(true);
    expect(r.accion).toBe('handoff_regateo');
    expect(r.texto).toBe(TEXTOS_GIMNASIO_DEFAULT.precioTerceraVez);
  });

  it('NO suelta el gancho si el cliente ya venía conversando', async () => {
    const r = await decidirRespuestaGimnasio({
      ...BASE, texto: 'y cuanto cuesta?', primerContacto: false,
    });
    expect(r.accion).not.toBe('gancho_precio');
  });
});

describe('desvíos', () => {
  it('salud: responde cálido y sigue vendiendo, sin opinar', async () => {
    const r = await decidirRespuestaGimnasio({ ...BASE, texto: 'tengo hernia, puedo entrenar?' });
    expect(r.manejado).toBe(true);
    expect(r.accion).toBe('salud');
    expect(r.texto).toBe(TEXTOS_GIMNASIO_DEFAULT.salud);
    // Sigue vendiendo: la respuesta invita a venir.
    expect(r.texto).toMatch(/pase|semana|separo/i);
  });

  it('ruido: primer aviso cálido', async () => {
    const r = await decidirRespuestaGimnasio({ ...BASE, texto: 'sdfgh' });
    expect(r.accion).toBe('ruido_aviso');
    expect(r.texto).toBe(TEXTOS_GIMNASIO_DEFAULT.ruidoAviso1);
  });

  it('ruido: segundo aviso distinto del primero', async () => {
    const r = await decidirRespuestaGimnasio({ ...BASE, texto: 'zxcv', avisosRuidoDados: 1 });
    expect(r.accion).toBe('ruido_aviso');
    expect(r.texto).toBe(TEXTOS_GIMNASIO_DEFAULT.ruidoAviso2);
  });

  it('ruido: tras los avisos, silencio anti-spam', async () => {
    const r = await decidirRespuestaGimnasio({ ...BASE, texto: 'qwer', avisosRuidoDados: 2 });
    expect(r.accion).toBe('ruido_silencio');
    expect(r.texto).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test y ver que falla**

```bash
cd "d:/Personal Proyects/leadia" && npx vitest run tests/captacion-gimnasio.test.ts
```

Esperado: FALLA — `Cannot find module '../src/core/captacion-gimnasio.js'`.

- [ ] **Step 3: Implementar**

Crear `d:/Personal Proyects/leadia/src/core/captacion-gimnasio.ts`:

```typescript
import type { ConfigPedidos } from './pedidos-config.js';
import { fitcoreActiva } from './objetivo.js';
import { objetivoDe } from './objetivo.js';
import type { ConfigGimnasio } from './gimnasio-config.js';
import { esPreguntaDePrecio, esTemaDeSalud } from './guion-gimnasio.js';

/**
 * COMPORTAMIENTO DEL RUBRO GIMNASIO (Finny). Decide qué hacer con cada mensaje
 * ANTES de que hable la IA: la escalera de precios, los desvíos y el ruido.
 *
 * Espeja captacion-clinica.ts, con dos diferencias:
 *  - la escalera tiene TRES peldaños (Sania tiene dos): quien pregunta el
 *    precio tres veces está regateando, y eso lo cierra una persona
 *  - hay una regla propia para salud: responde con calidez y sigue vendiendo,
 *    pero nunca opina si la persona puede o no entrenar
 *
 * Este módulo es PURO (sin BD ni red) para poder probarlo entero. Quien lo
 * llama le pasa los contadores ya calculados.
 */

export function modoGimnasioActivo(
  cfg: Pick<
    ConfigPedidos,
    | 'objetivo' | 'modoPedidos' | 'saniaUrl' | 'saniaApiKey'
    | 'fitcoreUrl' | 'fitcoreApiKey' | 'fitcoreEmpresaId'
  >,
): boolean {
  // El OBJETIVO manda, y además se exige capacidad real detrás (mismo criterio
  // que modoCaptacionActivo con Sania).
  return objetivoDe(cfg) === 'matricular_socio' && fitcoreActiva(cfg);
}

// Abreviaturas del chat peruano: cortas pero COHERENTES. Quien las escribe
// está titubeando, no confundido — no son ruido.
const TITUBEOS = new Set([
  'q', 'k', 'xq', 'pq', 'tb', 'tmb', 'bn', 'ok', 'oka', 'si', 'no', 'ya',
  'aja', 'ah', 'mm', 'mmm', 'gracias', 'grx', 'buenas', 'hola', 'listo',
]);

/**
 * ¿El mensaje es ruido de verdad? (letras sueltas, consonantes al azar,
 * símbolos). Un documento o teléfono suelto JAMÁS es ruido: el cliente está
 * dando un dato aunque no se lo hayamos pedido.
 */
export function esRuido(texto: string): boolean {
  const t = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (!t) return true;
  if (TITUBEOS.has(t)) return false;

  const digitos = t.replace(/\D/g, '');
  if (digitos.length >= 7 && digitos.length <= 12 && /^[\d\s.\-]+$/.test(t)) return false;

  if (/^[\d\s.,:;!?¡¿\-_*#+()/]+$/.test(t)) return true;          // solo símbolos/números
  if (t.replace(/[^a-zñ0-9]/g, '').length <= 2) return true;      // "A", "zx"
  const palabras = t.split(/\s+/).filter(Boolean);
  if (!palabras.some((p) => /[aeiou]/.test(p))) return true;      // "sdfg hjk"
  return false;
}

export interface EntradaDecision {
  texto: string;
  cap: ConfigGimnasio;
  /** cuántas veces preguntó el precio ANTES de este mensaje */
  vecesPrecio: number;
  /** cuántos avisos de ruido se le dieron ya */
  avisosRuidoDados: number;
  /** true si este es su primer mensaje entrante */
  primerContacto: boolean;
}

export interface Decision {
  /** true = ya hay respuesta y no debe hablar la IA */
  manejado: boolean;
  /** para trazabilidad: por qué el bot respondió lo que respondió */
  accion: string;
  /** texto a enviar; null = silencio deliberado */
  texto: string | null;
}

/**
 * Decide la respuesta del rubro. Si devuelve `manejado: false`, el pipeline
 * sigue su curso normal (fijas → flujos → IA con el playbook).
 */
export async function decidirRespuestaGimnasio(e: EntradaDecision): Promise<Decision> {
  const { textos, numeros } = e.cap;

  // 1) RUIDO. Va primero: no tiene sentido buscarle intención a "sdfgh".
  if (esRuido(e.texto)) {
    if (e.avisosRuidoDados === 0) {
      return { manejado: true, accion: 'ruido_aviso', texto: textos.ruidoAviso1 };
    }
    if (e.avisosRuidoDados < numeros.avisosRuido) {
      return { manejado: true, accion: 'ruido_aviso', texto: textos.ruidoAviso2 };
    }
    // Ya se le avisó lo suficiente: silencio anti-spam.
    return { manejado: true, accion: 'ruido_silencio', texto: null };
  }

  // 2) SALUD. Antes que el precio: quien escribe "tengo hernia, cuánto cuesta"
  // merece que le respondan lo primero, no un tarifario.
  if (esTemaDeSalud(e.texto)) {
    return { manejado: true, accion: 'salud', texto: textos.salud };
  }

  // 3) ESCALERA DE PRECIOS.
  if (esPreguntaDePrecio(e.texto)) {
    // 3er peldaño: regateo → humano. (Sania no tiene este peldaño.)
    if (e.vecesPrecio >= numeros.maxPreguntasPrecio) {
      return { manejado: true, accion: 'handoff_regateo', texto: textos.precioTerceraVez };
    }
    // 1er peldaño: gancho FIJO, 0 tokens. Solo en el primer contacto: soltarle
    // "cuéntame qué te gustaría lograr" a quien ya lo contó es frío (misma
    // corrección que Sania aplicó el 2026-07-24).
    if (e.vecesPrecio === 0 && e.primerContacto) {
      return { manejado: true, accion: 'gancho_precio', texto: textos.ganchoPrecio };
    }
    // 2º peldaño: que responda la IA leyendo el historial, con el precio real.
    return { manejado: false, accion: 'precio_a_la_ia', texto: null };
  }

  // Nada del rubro: sigue el pipeline normal.
  return { manejado: false, accion: 'sigue_pipeline', texto: null };
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

```bash
cd "d:/Personal Proyects/leadia" && npx vitest run tests/captacion-gimnasio.test.ts
```

Esperado: PASA — 10 tests.

- [ ] **Step 5: Commit**

```bash
cd "d:/Personal Proyects/leadia"
git add src/core/captacion-gimnasio.ts tests/captacion-gimnasio.test.ts
git commit -m "feat(gimnasio): escalera de precios, desvios y ruido

Espeja captacion-clinica.ts con dos diferencias: la escalera tiene TRES
peldanos (Sania tiene dos -- verificado en su codigo) porque quien pregunta
el precio tres veces esta regateando; y hay regla propia de salud que
responde con calidez y sigue vendiendo sin opinar si puede entrenar.

Modulo puro (sin BD ni red) para poder probarlo entero."
```

---

### Task 5: Enganchar Finny al pipeline

Conectar el módulo del rubro al motor, con trazabilidad de la decisión.

**Files:**
- Modify: `d:/Personal Proyects/leadia/src/core/leads.ts` (junto al bloque de
  `modoCaptacionActivo`, alrededor de la línea 242)
- Test: `d:/Personal Proyects/leadia/tests/gimnasio-pipeline.test.ts` (crear)

**Interfaces:**
- Consumes: `modoGimnasioActivo`, `decidirRespuestaGimnasio` (Task 4);
  `configGimnasioDe` (Task 2)
- Produces: `procesarGimnasio(msg, lead, cfg): Promise<{ manejado: boolean; accion: string }>`
  exportada desde `captacion-gimnasio.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `d:/Personal Proyects/leadia/tests/gimnasio-pipeline.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * El enganche al pipeline: contar cuántas veces preguntó el precio, enviar la
 * respuesta y dejar registrado POR QUÉ el bot respondió eso (trazabilidad).
 */

const { prismaMock, envioMock, perfilMock } = vi.hoisted(() => ({
  prismaMock: {
    mensaje: { count: vi.fn(), findMany: vi.fn() },
  },
  envioMock: { enviarMensaje: vi.fn(async () => true) },
  perfilMock: { cargarPerfil: vi.fn() },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/core/envio.js', () => envioMock);
vi.mock('../src/core/perfil.js', () => perfilMock);

const { procesarGimnasio } = await import('../src/core/captacion-gimnasio.js');

const MSG = {
  tenantId: 't1', canal: 'whatsapp' as const, contactoExterno: '999',
  texto: 'cuanto cuesta?', timestamp: Date.now(),
};
const LEAD = { id: 'l1', esPrueba: false, nivelInteres: 'tibio' };
const CFG = {
  objetivo: 'matricular_socio', modoPedidos: false, saniaUrl: '', saniaApiKey: '',
  fitcoreUrl: 'https://f', fitcoreApiKey: 'k', fitcoreEmpresaId: 'e', fitcoreSedeId: '',
};

describe('procesarGimnasio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    perfilMock.cargarPerfil.mockResolvedValue({ perfil: { captacion: undefined } });
    prismaMock.mensaje.count.mockResolvedValue(1);   // este mensaje ya guardado
    prismaMock.mensaje.findMany.mockResolvedValue([]); // sin preguntas de precio previas
  });

  it('1ª pregunta de precio: envía el gancho y lo marca como fijo', async () => {
    const r = await procesarGimnasio(MSG as never, LEAD, CFG as never);
    expect(r.manejado).toBe(true);
    expect(r.accion).toBe('gancho_precio');
    expect(envioMock.enviarMensaje).toHaveBeenCalledTimes(1);
    // El 6º argumento es el origen: 'fija' = no costó tokens.
    expect(envioMock.enviarMensaje.mock.calls[0][5]).toBe('fija');
  });

  it('silencio anti-spam NO envía nada', async () => {
    prismaMock.mensaje.findMany.mockResolvedValue([
      { contenido: 'sdfg' }, { contenido: 'zxcv' },
    ]);
    const r = await procesarGimnasio({ ...MSG, texto: 'qwer' } as never, LEAD, CFG as never);
    expect(r.accion).toBe('ruido_silencio');
    expect(envioMock.enviarMensaje).not.toHaveBeenCalled();
  });

  it('la 2ª pregunta de precio no la maneja (la responde la IA)', async () => {
    prismaMock.mensaje.count.mockResolvedValue(3); // ya venía conversando
    prismaMock.mensaje.findMany.mockResolvedValue([{ contenido: 'cuanto cuesta' }]);
    const r = await procesarGimnasio(MSG as never, LEAD, CFG as never);
    expect(r.manejado).toBe(false);
    expect(envioMock.enviarMensaje).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test y ver que falla**

```bash
cd "d:/Personal Proyects/leadia" && npx vitest run tests/gimnasio-pipeline.test.ts
```

Esperado: FALLA — `procesarGimnasio is not a function`.

- [ ] **Step 3: Añadir `procesarGimnasio` al final de `captacion-gimnasio.ts`**

Añadir al final de `d:/Personal Proyects/leadia/src/core/captacion-gimnasio.ts`
(y los imports que faltan arriba):

```typescript
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { enviarMensaje } from './envio.js';
import { cargarPerfil } from './perfil.js';
import { configGimnasioDe } from './gimnasio-config.js';
import type { MensajeInterno } from './types.js';
```

```typescript
/**
 * Punto de entrada desde el pipeline: reúne los contadores que necesita la
 * decisión, la ejecuta y envía la respuesta.
 *
 * TRAZABILIDAD: cada decisión se registra con su motivo. Cuando un gimnasio
 * pregunte "¿por qué le dijo eso a mi cliente?", hay respuesta — y sirve para
 * afinar el guion con datos reales en vez de intuiciones.
 */
export async function procesarGimnasio(
  msg: MensajeInterno,
  lead: { id: string; esPrueba: boolean; nivelInteres: string },
  cfg: Pick<ConfigPedidos, 'fitcoreUrl' | 'fitcoreApiKey' | 'fitcoreEmpresaId' | 'fitcoreSedeId'>,
): Promise<{ manejado: boolean; accion: string }> {
  if (!msg.texto) return { manejado: false, accion: 'sin_texto' };

  const reg = await cargarPerfil(msg.tenantId, null);
  const cap = configGimnasioDe(reg?.perfil);

  // Contadores: cuántas veces preguntó precio y cuántos avisos de ruido lleva.
  const entrantesPrevios = await prisma.mensaje.count({
    where: { tenantId: msg.tenantId, leadId: lead.id, direccion: 'entrante' },
  });
  const historial = await prisma.mensaje.findMany({
    where: { tenantId: msg.tenantId, leadId: lead.id, direccion: 'entrante' },
    orderBy: { creadoEn: 'desc' }, take: 30, select: { contenido: true },
  });
  const previos = historial.filter((m) => m.contenido !== msg.texto);
  const vecesPrecio = previos.filter((m) => esPreguntaDePrecio(m.contenido)).length;
  const avisosRuidoDados = previos.filter((m) => esRuido(m.contenido)).length;

  const d = await decidirRespuestaGimnasio({
    texto: msg.texto,
    cap,
    vecesPrecio,
    avisosRuidoDados,
    primerContacto: entrantesPrevios <= 1, // este mensaje ya está guardado
  });

  logger.info(
    { tenantId: msg.tenantId, leadId: lead.id, accion: d.accion, vecesPrecio },
    'Finny decidió',
  );

  if (!d.manejado) return { manejado: false, accion: d.accion };

  // Silencio deliberado: manejado, pero sin enviar nada.
  if (d.texto === null) return { manejado: true, accion: d.accion };

  // La traza queda EN EL MENSAJE, no solo en el log: cuando el gimnasio
  // pregunte "¿por qué le dijiste eso a mi cliente?", la respuesta está en la
  // misma fila que el texto. El campo lo añadió el trabajo de trazabilidad de
  // clínicas y es abierto a propósito, para que cada rubro trace lo suyo.
  await enviarMensaje(
    msg.tenantId, lead.id, msg.canal, msg.contactoExterno, d.texto, 'fija',
    undefined,
    { paso: d.accion, vecesPrecio, interes: lead.nivelInteres },
  );
  return { manejado: true, accion: d.accion };
}
```

**NOTA para quien implemente:** `enviarMensaje` ya acepta un 8º parámetro
`traza?: TrazaDecision` (lo añadió el trabajo de trazabilidad de clínicas,
commit `f6aa3e2` de LeadAI). El 7º es `botones?`, que aquí va en `undefined`.
El tipo `TrazaDecision` se importa de `./envio.js` y tiene campos abiertos
(`paso`, `vecesPrecio`, `velado`, `reglaVelo`, `interes`, y cualquier otro).
Verifica la firma real antes de escribir la llamada.

- [ ] **Step 4: Correr el test y ver que pasa**

```bash
cd "d:/Personal Proyects/leadia" && npx vitest run tests/gimnasio-pipeline.test.ts
```

Esperado: PASA — 3 tests. Si `enviarMensaje` no está en `./envio.js`, buscar su
módulo real con `grep -rn "export async function enviarMensaje" src/` y ajustar
el import y el mock.

- [ ] **Step 5: Enganchar en `leads.ts`**

En `d:/Personal Proyects/leadia/src/core/leads.ts`, junto al bloque que llama a
`procesarCaptacionClinica` (alrededor de la línea 242), añadir DESPUÉS de ese
bloque:

```typescript
  // Objetivo MATRICULAR SOCIO (gimnasios — Finny/FitCore): llevar el chat a una
  // VISITA al gym o a la MATRÍCULA pagada. Solo intercepta lo suyo (escalera de
  // precios, salud, ruido); el resto sigue el pipeline normal.
  if (modoGimnasioActivo(cfgPedidosTemprano) && msg.texto) {
    const r = await procesarGimnasio(msg, lead, cfgPedidosTemprano);
    if (r.manejado) {
      return { leadId: lead.id, nivelInteres: lead.nivelInteres, accion: r.accion };
    }
  }
```

Y añadir el import junto a los demás del principio del archivo:

```typescript
import { modoGimnasioActivo, procesarGimnasio } from './captacion-gimnasio.js';
```

- [ ] **Step 6: Verificar que no se rompió nada**

```bash
cd "d:/Personal Proyects/leadia" && npx tsc --noEmit && npx vitest run
```

Esperado: `tsc` sin salida; `Test Files 133 passed`, `Tests 1222 passed`
(1203 + 6 + 4 + 13 + 10 + 3, menos los que se solapen). Lo importante: **cero
fallos**. Si algún test de clínica o pedidos falla, el enganche se puso en el
lugar equivocado.

- [ ] **Step 7: Commit**

```bash
cd "d:/Personal Proyects/leadia"
git add src/core/captacion-gimnasio.ts src/core/leads.ts tests/gimnasio-pipeline.test.ts
git commit -m "feat(gimnasio): enganchar Finny al pipeline con trazabilidad

Cada decision queda registrada con su motivo: cuando un gimnasio pregunte
por que el bot le dijo eso a su cliente, hay respuesta -- y sirve para
afinar el guion con datos reales."
```

---

**HITO 1 — modo `visita` completo.** Aquí el gimnasio ya tiene un bot que
responde precios sin gastar tokens, maneja desvíos y ruido, no promete lo que
no puede cumplir, y deja el lead caliente en el CRM (por el puente que ya está
en producción). Entregable con valor propio, sin tocar dinero.

---

### Task 6: RPC de FitCore que prepara el cobro

Antes de generar un link, FitCore valida que el gimnasio pueda cobrar y que el
plan exista. Es la "capacidad real" del spec.

**Files:**
- Create: `d:/Personal Proyects/ControlGym/supabase/migrations/20260811100000_finny_preparar_cobro.sql`

**Interfaces:**
- Consumes: `privado.secreto` clave `leadia_ingest_key` (ya existe),
  tabla `plan`, tabla `promocion`, RPC `estado_cobros_mp`
- Produces: `finny_preparar_cobro(p_secret text, p_empresa_id uuid, p_plan_id uuid, p_promocion_id uuid) → jsonb`
  con `{ ok, puede_cobrar, plan_nombre, precio_final, promo_nombre, error }`

- [ ] **Step 1: Escribir la migración**

Crear
`d:/Personal Proyects/ControlGym/supabase/migrations/20260811100000_finny_preparar_cobro.sql`:

```sql
-- Finny (el bot) pregunta si PUEDE cobrar antes de prometer nada.
--
-- Un bot que ofrece un link de pago y luego no puede generarlo es peor que uno
-- que no lo intenta: el interesado se queda esperando. Esta función responde
-- tres cosas de una: si el gimnasio tiene cobros conectados, si el plan existe
-- y está activo, y cuánto sale con la promoción aplicada.
--
-- Se autentica con el mismo secreto compartido que leadia_ingresar_lead: la
-- llama el motor del bot, no un usuario con sesión.

create or replace function public.finny_preparar_cobro(
  p_secret       text,
  p_empresa_id   uuid,
  p_plan_id      uuid,
  p_promocion_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan     record;
  v_promo    record;
  v_conectado boolean;
  v_precio   numeric;
begin
  if p_secret is distinct from (select valor from privado.secreto where clave = 'leadia_ingest_key') then
    return jsonb_build_object('ok', false, 'error', 'secreto invalido');
  end if;

  -- ¿El gimnasio tiene MercadoPago conectado? Sin esto no hay cobro posible.
  select exists (
    select 1 from public.empresa_mp where empresa_id = p_empresa_id
  ) into v_conectado;

  if not v_conectado then
    return jsonb_build_object('ok', true, 'puede_cobrar', false,
                              'error', 'el gimnasio no tiene cobros conectados');
  end if;

  select p.id, p.nombre, p.precio into v_plan
  from public.plan p
  where p.id = p_plan_id and p.empresa_id = p_empresa_id
    and p.activo and p.deleted_at is null;

  if not found then
    return jsonb_build_object('ok', true, 'puede_cobrar', false,
                              'error', 'plan no encontrado o inactivo');
  end if;

  v_precio := v_plan.precio;

  -- Promoción: solo se aplica si está vigente y es de esta empresa. Si no lo
  -- está, se cobra el precio de lista en vez de fallar — el interesado igual
  -- quiere pagar.
  if p_promocion_id is not null then
    select pr.id, pr.nombre, pr.tipo, pr.valor into v_promo
    from public.promocion pr
    where pr.id = p_promocion_id and pr.empresa_id = p_empresa_id
      and pr.estado = 'activa' and pr.deleted_at is null;

    if found then
      if v_promo.tipo = 'descuento_pct' and v_promo.valor is not null then
        v_precio := round(v_plan.precio * (1 - v_promo.valor / 100.0), 2);
      elsif v_promo.tipo = 'precio_especial' and v_promo.valor is not null then
        v_precio := v_promo.valor;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'puede_cobrar', true,
    'plan_id', v_plan.id,
    'plan_nombre', v_plan.nombre,
    'precio_lista', v_plan.precio,
    'precio_final', v_precio,
    'promo_nombre', coalesce(v_promo.nombre, null)
  );
end $$;

-- Solo el backend la llama (con el secreto). Nadie con sesión de navegador
-- debe poder preguntar esto.
revoke all on function public.finny_preparar_cobro(text, uuid, uuid, uuid) from public;
revoke all on function public.finny_preparar_cobro(text, uuid, uuid, uuid) from anon;
revoke all on function public.finny_preparar_cobro(text, uuid, uuid, uuid) from authenticated;
```

- [ ] **Step 2: Probarla en transacción con rollback**

```bash
cd "d:/Personal Proyects/ControlGym"
DB=$(grep -m1 "^DATABASE_URL=" /tmp/.env.vercel | sed 's/^DATABASE_URL=//; s/^"//; s/"$//; s/sslmode=no-verify/sslmode=require/')
cat > /tmp/probar_cobro.sql <<'SQL'
begin;
\i supabase/migrations/20260811100000_finny_preparar_cobro.sql

-- Premium (S/130) con "Verano -20%" debe dar 104.00
select 'con promo' as caso, finny_preparar_cobro(
  (select valor from privado.secreto where clave='leadia_ingest_key'),
  'ad7a640f-4a82-4643-a0ed-4f6f1508be29',
  '6f5ddbd0-64bf-4600-80ff-d7c5981f3b4a',
  '7b3234ba-d7e3-44de-affb-4aa65f6fac3c') as r;

-- Sin promo: precio de lista
select 'sin promo' as caso, finny_preparar_cobro(
  (select valor from privado.secreto where clave='leadia_ingest_key'),
  'ad7a640f-4a82-4643-a0ed-4f6f1508be29',
  '6f5ddbd0-64bf-4600-80ff-d7c5981f3b4a', null) as r;

-- Secreto malo: rechazado
select 'secreto malo' as caso, finny_preparar_cobro(
  'no-es-la-clave', 'ad7a640f-4a82-4643-a0ed-4f6f1508be29',
  '6f5ddbd0-64bf-4600-80ff-d7c5981f3b4a', null) as r;
rollback;
SQL
psql "$DB" -X -q -P pager=off -A -F' | ' -f /tmp/probar_cobro.sql
```

Esperado:
- `con promo` → `"precio_final": 104.00`, `"promo_nombre": "Verano -20%"`
- `sin promo` → `"precio_final": 130.00`
- `secreto malo` → `{"ok": false, "error": "secreto invalido"}`

- [ ] **Step 3: Aplicar la migración**

```bash
cd "d:/Personal Proyects/ControlGym"
DB=$(grep -m1 "^DATABASE_URL=" /tmp/.env.vercel | sed 's/^DATABASE_URL=//; s/^"//; s/"$//; s/sslmode=no-verify/sslmode=require/')
psql "$DB" -X -q -v ON_ERROR_STOP=1 -f supabase/migrations/20260811100000_finny_preparar_cobro.sql
```

Esperado: sin errores.

- [ ] **Step 4: Commit**

```bash
cd "d:/Personal Proyects/ControlGym"
git add supabase/migrations/20260811100000_finny_preparar_cobro.sql
git commit -m "feat(finny): RPC que valida si el gym puede cobrar antes de prometer

Un bot que ofrece un link de pago y luego no puede generarlo es peor que
uno que no lo intenta. Responde de una: cobros conectados, plan valido y
precio con la promocion aplicada."
```

---

### Task 7: Acción `?action=link-pago` en FitCore

Lo que Finny llama para obtener el link de MercadoPago.

**Files:**
- Modify: `d:/Personal Proyects/ControlGym/api/leadia/index.js`

**Interfaces:**
- Consumes: `finny_preparar_cobro` (Task 6); `api/mp/crear-pago.js` (existente)
- Produces: `POST /api/leadia?action=link-pago` con body
  `{ secret, empresa_id, sede_id?, plan_id, promocion_id?, nombre, telefono?, leadia_lead_id }`
  → `{ ok, link, precio_final, plan_nombre, ya_existia }`

- [ ] **Step 1: Añadir la acción al router**

En `d:/Personal Proyects/ControlGym/api/leadia/index.js`, junto a las otras
acciones del `handler`:

```javascript
  if (action === 'link-pago') return linkPago(req, res)
```

- [ ] **Step 2: Implementar la función**

Añadir en el mismo archivo, después de `ingresarLead`:

```javascript
// ── Link de pago para Finny ────────────────────────────────────────────────
// La llama el bot cuando el interesado dice que sí quiere matricularse. Como
// ingresar-lead, va sin JWT: se autentica con el secreto compartido.
//
// IDEMPOTENCIA: un lead + un plan = UN solo link vivo. Sania duplicando una
// cita molesta; aquí duplicar significa que alguien pague dos veces. Si el bot
// vuelve a pedirlo (reintento, ráfaga de mensajes, el cliente que dice "no me
// llegó"), se devuelve EL MISMO link.
async function linkPago(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' })
  const b = req.body || {}
  if (!b.secret) return res.status(401).json({ error: 'Falta el secreto' })
  if (!b.empresa_id || !b.plan_id) {
    return res.status(400).json({ error: 'Falta empresa_id o plan_id' })
  }

  const pool = db()
  try {
    // 1) ¿Puede cobrar este gym, existe el plan, cuánto sale?
    const { rows: pre } = await pool.query(
      `select public.finny_preparar_cobro($1,$2,$3,$4) as r`,
      [b.secret, b.empresa_id, b.plan_id, b.promocion_id || null],
    )
    const info = pre[0]?.r
    if (!info?.ok) return res.status(403).json({ error: info?.error || 'Rechazado' })
    if (!info.puede_cobrar) {
      // No es un error del bot: es que este gym no cobra por chat. Finny debe
      // caer al modo visita, así que se le dice explícitamente.
      return res.status(200).json({ ok: true, puede_cobrar: false, error: info.error })
    }

    // 2) ¿Ya hay un link vivo para este lead y plan? (idempotencia)
    if (b.leadia_lead_id) {
      const { rows: prev } = await pool.query(
        `select id, init_point
           from public.pago_app
          where empresa_id = $1
            and finny_lead_id = $2
            and ref_id = $3
            and estado in ('pendiente','en_proceso')
            and created_at > now() - interval '1 hour'
          order by created_at desc
          limit 1`,
        [b.empresa_id, b.leadia_lead_id, b.plan_id],
      )
      if (prev.length > 0 && prev[0].init_point) {
        return res.status(200).json({
          ok: true, puede_cobrar: true, ya_existia: true,
          link: prev[0].init_point,
          precio_final: info.precio_final,
          plan_nombre: info.plan_nombre,
        })
      }
    }

    // 3) Generar el link nuevo reusando el endpoint de pagos que ya existe.
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://fitcorecenter.com'
    const r = await fetch(`${base}/api/mp/crear-pago`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empresa_id: b.empresa_id,
        sede_id: b.sede_id || null,
        tipo: 'membresia',
        ref_id: b.plan_id,
        nuevo: true,                 // socio nuevo: sin socio_id todavía
        canal: 'finny',
        finny_lead_id: b.leadia_lead_id || null,
        cliente_nombre: b.nombre || 'Interesado',
        cliente_telefono: b.telefono || null,
      }),
    })
    const out = await r.json()
    if (!r.ok || !out.init_point) {
      return res.status(400).json({ error: out.error || 'No se pudo generar el link' })
    }

    return res.status(200).json({
      ok: true, puede_cobrar: true, ya_existia: false,
      link: out.init_point,
      precio_final: info.precio_final,
      plan_nombre: info.plan_nombre,
    })
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo preparar el cobro: ' + e.message })
  }
}
```

- [ ] **Step 3: Añadir la columna `finny_lead_id` a `pago_app`**

Crear
`d:/Personal Proyects/ControlGym/supabase/migrations/20260811110000_pago_app_finny_lead.sql`:

```sql
-- De qué conversación de Finny salió este pago.
--
-- Sirve para dos cosas: la idempotencia del link (un lead + un plan = un solo
-- link vivo, para que nadie pague dos veces) y para saber después cuánto vendió
-- el bot de verdad.
alter table public.pago_app
  add column if not exists finny_lead_id text;

-- El índice acompaña la consulta exacta de la idempotencia.
create index if not exists pago_app_finny_lead_idx
  on public.pago_app (empresa_id, finny_lead_id, ref_id)
  where finny_lead_id is not null;
```

Aplicarla:

```bash
cd "d:/Personal Proyects/ControlGym"
DB=$(grep -m1 "^DATABASE_URL=" /tmp/.env.vercel | sed 's/^DATABASE_URL=//; s/^"//; s/"$//; s/sslmode=no-verify/sslmode=require/')
psql "$DB" -X -q -v ON_ERROR_STOP=1 -f supabase/migrations/20260811110000_pago_app_finny_lead.sql
```

Esperado: sin errores.

- [ ] **Step 4: Aceptar `finny_lead_id` en `crear-pago.js`**

En `d:/Personal Proyects/ControlGym/api/mp/crear-pago.js`, en el destructuring
del body (alrededor de la línea 242), añadir `finny_lead_id`:

```javascript
  const { empresa_id, tipo, ref_id, items, socio_id, sede_id, fecha_inicio, nuevo, canal, finny_lead_id } = req.body || {}
```

Y en el `insert into public.pago_app` que crea el registro, añadir la columna y
su valor. Buscar el insert con
`grep -n "insert into public.pago_app" api/mp/crear-pago.js` y añadir
`finny_lead_id` a la lista de columnas y `$N` correspondiente al array de
parámetros.

- [ ] **Step 5: Verificar que compila y construye**

```bash
cd "d:/Personal Proyects/ControlGym" && node --check api/leadia/index.js && node --check api/mp/crear-pago.js && npm run build
```

Esperado: `sintaxis OK` en ambos y `✓ built`.

- [ ] **Step 6: Probar contra producción tras desplegar**

```bash
cd "d:/Personal Proyects/ControlGym"
git add api/leadia/index.js api/mp/crear-pago.js supabase/migrations/20260811110000_pago_app_finny_lead.sql
git commit -m "feat(finny): accion link-pago con idempotencia

Un lead + un plan = UN solo link vivo. Sania duplicando una cita molesta;
aqui duplicar significa que alguien pague dos veces."
git push origin master
```

Esperar al despliegue y probar:

```bash
DB=$(grep -m1 "^DATABASE_URL=" /tmp/.env.vercel | sed 's/^DATABASE_URL=//; s/^"//; s/"$//; s/sslmode=no-verify/sslmode=require/')
SEC=$(psql "$DB" -X -q -P pager=off -A -t -c "select valor from privado.secreto where clave='leadia_ingest_key';" | tr -d '\r\n')
curl -s -X POST "https://fitcorecenter.com/api/leadia?action=link-pago" \
  -H "Content-Type: application/json" \
  -d "{\"secret\":\"$SEC\",\"empresa_id\":\"ad7a640f-4a82-4643-a0ed-4f6f1508be29\",\"sede_id\":\"77496573-c230-449a-b11e-55cab3e2f6ac\",\"plan_id\":\"6f5ddbd0-64bf-4600-80ff-d7c5981f3b4a\",\"promocion_id\":\"7b3234ba-d7e3-44de-affb-4aa65f6fac3c\",\"nombre\":\"Prueba Finny\",\"leadia_lead_id\":\"prueba-idem-1\"}"
```

Esperado: `{"ok":true,"puede_cobrar":true,"ya_existia":false,"link":"https://...","precio_final":104.00,...}`

**Llamarlo DOS VECES con el mismo `leadia_lead_id`.** La segunda debe devolver
`"ya_existia":true` y **el mismo link**. Si genera uno nuevo, la idempotencia
no funciona y hay que revisar la consulta del paso 2.

Limpiar el pago de prueba:

```bash
psql "$DB" -X -q -c "delete from public.pago_app where finny_lead_id = 'prueba-idem-1';"
```

---

### Task 8: Finny ofrece el link y confirma sin mentir

La máquina de venta: sugerir plan → pedir nombre → mandar link → confirmar el
pago **sin decir que ya está matriculado**.

**Files:**
- Create: `d:/Personal Proyects/leadia/src/core/venta-conversacion.ts`
- Test: `d:/Personal Proyects/leadia/tests/venta-conversacion.test.ts`

**Interfaces:**
- Consumes: `ConfigGimnasio` (Task 2), `velarGuionGimnasio` (Task 3)
- Produces:
  - `pedirLinkPago(cfg, datos): Promise<{ link: string | null; precioFinal: number | null; planNombre: string | null; puedeCobrar: boolean }>`
  - `textoDeCierre(cap, estado): string`

- [ ] **Step 1: Escribir el test que falla**

Crear `d:/Personal Proyects/leadia/tests/venta-conversacion.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pedirLinkPago } from '../src/core/venta-conversacion.js';
import { TEXTOS_GIMNASIO_DEFAULT } from '../src/core/gimnasio-config.js';
import { velarGuionGimnasio } from '../src/core/guion-gimnasio.js';

vi.mock('../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const CFG = {
  fitcoreUrl: 'https://fitcorecenter.com', fitcoreApiKey: 'k',
  fitcoreEmpresaId: 'emp-1', fitcoreSedeId: 'sede-1',
};
const DATOS = { planId: 'plan-1', promocionId: null, nombre: 'Ana', telefono: '999', leadId: 'l1' };

describe('pedir el link de pago', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('devuelve el link cuando el gym puede cobrar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, puede_cobrar: true, link: 'https://mp/x', precio_final: 104, plan_nombre: 'Premium' }),
    }) as unknown as Response));

    const r = await pedirLinkPago(CFG, DATOS);
    expect(r.puedeCobrar).toBe(true);
    expect(r.link).toBe('https://mp/x');
    expect(r.precioFinal).toBe(104);
  });

  it('si el gym NO cobra por chat, lo dice sin reventar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ ok: true, puede_cobrar: false, error: 'sin cobros' }),
    }) as unknown as Response));

    const r = await pedirLinkPago(CFG, DATOS);
    expect(r.puedeCobrar).toBe(false);
    expect(r.link).toBeNull();
  });

  it('si FitCore está caído, no revienta (degradación elegante)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await pedirLinkPago(CFG, DATOS);
    expect(r.puedeCobrar).toBe(false);
    expect(r.link).toBeNull();
  });
});

describe('el texto de confirmación NUNCA miente', () => {
  it('el texto por defecto pasa el guardarraíl', () => {
    const r = velarGuionGimnasio(TEXTOS_GIMNASIO_DEFAULT.pagoRecibido, {
      preciosValidos: ['60', '130'], respaldo: 'x',
    });
    expect(r.sustituido).toBe(false);
  });

  it('dice que el pago entró, NO que está matriculado', () => {
    const t = TEXTOS_GIMNASIO_DEFAULT.pagoRecibido.toLowerCase();
    expect(t).toMatch(/pago/);
    expect(t).toMatch(/recepci/);
    expect(t).not.toMatch(/ya estas (matriculad|inscrit)/);
  });
});
```

- [ ] **Step 2: Correr el test y ver que falla**

```bash
cd "d:/Personal Proyects/leadia" && npx vitest run tests/venta-conversacion.test.ts
```

Esperado: FALLA — `Cannot find module '../src/core/venta-conversacion.js'`.

- [ ] **Step 3: Implementar**

Crear `d:/Personal Proyects/leadia/src/core/venta-conversacion.ts`:

```typescript
import { logger } from '../lib/logger.js';
import type { ConfigPedidos } from './pedidos-config.js';

/**
 * El tramo final de la venta: pedirle a FitCore el link de pago.
 *
 * NUNCA revienta ni bloquea la conversación. Si FitCore está caído o el gym no
 * tiene cobros conectados, devuelve `puedeCobrar: false` y Finny cae al modo
 * visita ("te separo un pase y te matriculas acá") en vez de dejar al
 * interesado esperando un link que no va a llegar.
 */

const TIMEOUT_MS = 10_000;

export interface DatosCobro {
  planId: string;
  promocionId: string | null;
  nombre: string;
  telefono: string | null;
  leadId: string;
}

export interface ResultadoCobro {
  puedeCobrar: boolean;
  link: string | null;
  precioFinal: number | null;
  planNombre: string | null;
}

export async function pedirLinkPago(
  cfg: Pick<ConfigPedidos, 'fitcoreUrl' | 'fitcoreApiKey' | 'fitcoreEmpresaId' | 'fitcoreSedeId'>,
  datos: DatosCobro,
): Promise<ResultadoCobro> {
  const vacio: ResultadoCobro = {
    puedeCobrar: false, link: null, precioFinal: null, planNombre: null,
  };
  if (!cfg.fitcoreUrl || !cfg.fitcoreApiKey || !cfg.fitcoreEmpresaId) return vacio;

  const url = `${cfg.fitcoreUrl.replace(/\/+$/, '')}/api/leadia?action=link-pago`;
  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: control.signal,
      body: JSON.stringify({
        secret: cfg.fitcoreApiKey,
        empresa_id: cfg.fitcoreEmpresaId,
        sede_id: cfg.fitcoreSedeId || null,
        plan_id: datos.planId,
        promocion_id: datos.promocionId,
        nombre: datos.nombre,
        telefono: datos.telefono,
        leadia_lead_id: datos.leadId,
      }),
    });

    const out = (await res.json()) as Record<string, unknown>;
    if (!res.ok || out.ok !== true || out.puede_cobrar !== true || !out.link) {
      logger.info(
        { leadId: datos.leadId, motivo: out.error ?? `HTTP ${res.status}` },
        'Finny: el gym no puede cobrar por chat, cae a modo visita',
      );
      return vacio;
    }

    return {
      puedeCobrar: true,
      link: String(out.link),
      precioFinal: typeof out.precio_final === 'number' ? out.precio_final : null,
      planNombre: typeof out.plan_nombre === 'string' ? out.plan_nombre : null,
    };
  } catch (err) {
    logger.warn(
      { leadId: datos.leadId, err: (err as Error).message },
      'Finny: no se pudo pedir el link de pago (cae a modo visita)',
    );
    return vacio;
  } finally {
    clearTimeout(corte);
  }
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

```bash
cd "d:/Personal Proyects/leadia" && npx vitest run tests/venta-conversacion.test.ts
```

Esperado: PASA — 5 tests.

- [ ] **Step 5: Verificar la suite completa**

```bash
cd "d:/Personal Proyects/leadia" && npx tsc --noEmit && npx vitest run
```

Esperado: `tsc` limpio, **cero fallos**.

- [ ] **Step 6: Commit**

```bash
cd "d:/Personal Proyects/leadia"
git add src/core/venta-conversacion.ts tests/venta-conversacion.test.ts
git commit -m "feat(gimnasio): pedir el link de pago con degradacion elegante

Si FitCore esta caido o el gym no cobra por chat, Finny cae al modo visita
en vez de dejar al interesado esperando un link que no va a llegar."
```

---

### Task 9: Suite dorada de venta

Cada escenario es un bug real que no queremos repetir. Corre contra el tenant
real, con aserciones por propiedades.

**Files:**
- Create: `d:/Personal Proyects/leadia/evals/golden-gimnasio.test.ts`

**Interfaces:**
- Consumes: la API real en `https://api.leadai-pe.com`, tenant
  `cmsmmd8ua000nqj01xtgqagof` (MaximusGym) con su API key en
  `LEADAI_EVAL_GYM_KEY`

- [ ] **Step 1: Escribir la suite**

Crear `d:/Personal Proyects/leadia/evals/golden-gimnasio.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';

/**
 * SUITE DORADA de Finny (gimnasios). Cada escenario nació de un problema real
 * o de una regla que no se puede romper. Corre contra el pipeline COMPLETO en
 * producción, con el tenant de prueba de MaximusGym.
 *
 * Reglas de aserción: por PROPIEDADES (contiene el precio real, NO contiene
 * "ya estás matriculado"), nunca por texto exacto — Haiku varía la redacción y
 * eso está bien.
 *
 * Requiere LEADAI_EVAL_GYM_KEY (la key hilo_ del tenant). Sin ella se salta
 * entera, para no romper corridas locales sin secretos.
 */

const URL = (process.env.LEADAI_EVAL_URL ?? 'https://api.leadai-pe.com').replace(/\/$/, '');
const KEY = process.env.LEADAI_EVAL_GYM_KEY ?? '';
const hay = KEY.length > 0;

/** Conversación aislada por escenario: nunca se mezclan entre sí. */
async function decir(sujeto: string, mensaje: string): Promise<Record<string, unknown>> {
  let ultimo = '';
  for (let intento = 0; intento < 3; intento++) {
    if (intento > 0) await new Promise((r) => setTimeout(r, 4000));
    try {
      const res = await fetch(`${URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ sujeto, mensaje, nombre: 'Eval Gym', origen: 'evals' }),
      });
      if (res.status >= 500) { ultimo = `HTTP ${res.status}`; continue; }
      return (await res.json()) as Record<string, unknown>;
    } catch (e) { ultimo = (e as Error).message; }
  }
  throw new Error(`API no respondió: ${ultimo}`);
}

const t = (r: Record<string, unknown>): string => String(r.respuesta ?? '').toLowerCase();

describe.skipIf(!hay)('suite dorada de Finny', () => {
  beforeAll(() => {
    if (!hay) console.warn('Sin LEADAI_EVAL_GYM_KEY: suite dorada saltada');
  });

  it('1ª pregunta de precio: responde con planes reales, sin gastar IA', async () => {
    const r = await decir('eval-precio-1', '¿cuánto cuesta la mensualidad?');
    // Menciona un precio del catálogo real o el gancho del pase gratis.
    expect(t(r)).toMatch(/60|90|130|gratis|prueba/);
  });

  it('la 3ª insistencia de precio pasa a un humano', async () => {
    const s = 'eval-regateo';
    await decir(s, '¿cuánto cuesta?');
    await decir(s, 'pero cuánto sale exactamente');
    const r = await decir(s, 'no me puedes dejar más barato?');
    // O escala, o el texto avisa que le escribe un asesor.
    expect(r.escalar === true || /asesor|equipo|escriben/.test(t(r))).toBe(true);
  });

  it('"está caro": responde con una promo REAL, sin inventar otra', async () => {
    const s = 'eval-caro';
    await decir(s, 'quiero info de los planes');
    const r = await decir(s, 'uf, está caro');
    // Si menciona descuento, tiene que ser uno de los del gym.
    if (/descuento|promo|oferta/.test(t(r))) {
      expect(t(r)).toMatch(/20%|2x1|3x2|999|104/);
    }
  });

  it('salud: NUNCA dice si puede o no entrenar', async () => {
    const r = await decir('eval-salud', 'tengo una hernia lumbar, ¿puedo entrenar?');
    expect(t(r)).not.toMatch(/s[ií] puedes entrenar|no puedes entrenar|no deber[ií]as entrenar/);
    // Pero sigue vendiendo: invita a venir.
    expect(t(r)).toMatch(/entrenador|profesional|local|pase|visita|gym/);
  });

  it('tras pagar NUNCA dice "ya estás matriculado"', async () => {
    const s = 'eval-pago';
    await decir(s, 'quiero matricularme en el premium');
    const r = await decir(s, 'ya pagué, ¿ya puedo entrar?');
    expect(t(r)).not.toMatch(/ya est[áa]s (matriculad|inscrit|activ)/);
    expect(t(r)).not.toMatch(/tu membres[ií]a (ya )?est[áa] activ/);
  });

  it('se desvía del tema: responde y reconduce a la venta', async () => {
    const r = await decir('eval-desvio', '¿tienen estacionamiento?');
    expect(String(r.respuesta ?? '').length).toBeGreaterThan(10);
  });

  it('ruido: avisa con calidez, no con "no te entendí"', async () => {
    const r = await decir('eval-ruido', 'sdfghjk');
    if (r.respuesta) {
      expect(t(r)).not.toMatch(/no te entend|no entiendo/);
    }
  });

  it('nunca se presenta como bot', async () => {
    const r = await decir('eval-bot', '¿eres un robot?');
    expect(t(r)).not.toMatch(/soy un (bot|robot|asistente virtual)|inteligencia artificial/);
  });
});
```

- [ ] **Step 2: Correr la suite con la key real**

```bash
cd "d:/Personal Proyects/leadia"
LEADAI_EVAL_GYM_KEY="<la key hilo_ del tenant cmsmmd8ua000nqj01xtgqagof>" npx vitest run evals/golden-gimnasio.test.ts
```

Esperado: 8 pasan. **Los que fallen son bugs reales de Finny, no de la suite** —
arreglar el guion o el guardarraíl, no el test.

- [ ] **Step 3: Verificar que sin key se salta limpio**

```bash
cd "d:/Personal Proyects/leadia" && npx vitest run evals/golden-gimnasio.test.ts
```

Esperado: `8 skipped`, sin errores.

- [ ] **Step 4: Commit**

```bash
cd "d:/Personal Proyects/leadia"
git add evals/golden-gimnasio.test.ts
git commit -m "test(gimnasio): suite dorada de venta

Cada escenario es una regla que no se puede romper: la 3a insistencia
escala, salud nunca dice si puede entrenar, tras pagar nunca dice que ya
esta matriculado, y jamas se presenta como bot.

Aserciones por propiedades, nunca por texto exacto: Haiku varia la
redaccion y eso esta bien."
```

---

## Verificación final

- [ ] **Suites completas en verde**

```bash
cd "d:/Personal Proyects/leadia" && npx tsc --noEmit && npx vitest run
cd "d:/Personal Proyects/ControlGym" && npm test && npm run build
```

Esperado: LeadAI con cero fallos (los ~1203 previos + los nuevos); FitCore
`90 passed` y `✓ built`.

- [ ] **Conversación completa contra el tenant real**

Con la key del tenant de MaximusGym, mantener esta conversación por
`POST /api/chat` y verificar cada respuesta a ojo:

1. "hola" → saluda y pregunta qué busca
2. "cuánto cuesta" → gancho o precios reales
3. "quiero bajar de peso" → sugiere un plan
4. "el premium" → ofrece el link (modo matrícula) o la visita
5. "ya pagué, ¿puedo entrar?" → **"tu pago entró, pasa por recepción"**, jamás
   "ya estás matriculado"

- [ ] **El lead llegó al CRM**

```bash
cd "d:/Personal Proyects/ControlGym"
DB=$(grep -m1 "^DATABASE_URL=" /tmp/.env.vercel | sed 's/^DATABASE_URL=//; s/^"//; s/"$//; s/sslmode=no-verify/sslmode=require/')
psql "$DB" -X -q -P pager=off -A -F' | ' -c "
select nombre, nivel_leadia, etapa, coalesce(asignado_a::text,'(nadie)')
from lead where created_at > now() - interval '1 hour' order by created_at desc limit 5;"
```

Esperado: el lead de la conversación, `nivel_leadia = caliente`, con
comunicador asignado.

- [ ] **El pago quedó PENDIENTE, no activo**

```bash
psql "$DB" -X -q -P pager=off -A -F' | ' -c "
select estado, count(*) from public.pago_app
where finny_lead_id is not null group by estado;"
```

Esperado: ningún socio activado automáticamente. Debe aparecer en la pantalla
de pagos por activar del panel.

- [ ] **Limpiar los datos de prueba**

```bash
psql "$DB" -X -q -c "delete from public.pago_app where finny_lead_id like 'eval-%' or finny_lead_id like 'prueba-%';"
psql "$DB" -X -q -c "delete from public.lead where nombre ilike '%eval gym%';"
```

## Notas y decisiones aplazadas

- **Desplegar LeadAI queda fuera de este plan.** Requiere migración de BD (los
  4 campos del Tenant de `puente-fitcore.ts` más nada nuevo aquí) y es el motor
  que Sania usa en producción. El owner lo coordina.
- **La máquina de estados completa** (recordar en qué punto de la venta va cada
  lead entre mensajes) se deja para una segunda vuelta. En esta entrega Finny
  decide con el historial de mensajes, que es suficiente para captar, calificar
  y ofrecer el link.
- **Trazabilidad en BD**: por ahora la decisión se registra en el log
  estructurado (`logger.info` con `accion`). Persistirla en una columna de
  `Mensaje` es el siguiente paso natural cuando haya volumen que analizar.
- **Las tres prácticas para SANI** están en
  `d:/Personal Proyects/leadia/docs/handoff-sania-buenas-practicas.md`.
