---
name: desplegar
description: Use when publishing FitCore to production - app to Play Store (interna/cerrada/produccion), Supabase migrations, or the Vercel panel. Enforces verify-before-publish and verify-after-publish so "CI verde" never gets confused with "le llegó al usuario".
---

# Desplegar FitCore

Publica los tres componentes de FitCore sin repetir los fallos que ya nos costaron
tiempo. Cada regla de aquí nació de un incidente real, y la causa está anotada
para que no se relaje "porque esta vez es rápido".

**Anuncia al empezar:** "Uso la skill desplegar para publicar [componente]."

## Los tres componentes

| Componente | Repo | Cómo se publica |
|---|---|---|
| BD (Supabase) | `ControlGym/supabase/migrations/` | `psql` contra prod (solo el controlador, nunca un subagente) |
| Panel (React/Vite) | `ControlGym` | Push a `master` → Vercel despliega solo (no hay workflow) |
| App (Android + iOS) | `controlgym-app` | Por tags — **ver la skill `lanzar-release` de ESE repo** |

**La app se publica con su propia skill.** `controlgym-app/.claude/skills/lanzar-release/`
tiene los tags de cada canal, la trampa del "What's New" de iOS y el diagnóstico
de "no me sale actualizar". No dupliques esas reglas aquí: si divergen, la de
aquél repo manda para la app. Lo que sí importa desde este lado:

- **La app va DESPUÉS de la BD** (ver el orden abajo).
- **iOS se olvida fácil** — llegó a acumular 42 commits de atraso mientras
  Android publicaba sin parar. Al tocar `commonMain`, pregunta si también toca
  publicar iOS.

Se despliegan en este orden: **BD primero, luego app y panel**. La app nueva
puede llamar RPCs que la vieja no usa; el revés rompe a los que aún no
actualizaron.

## Checkpoints — dónde SÍ hay que parar

Estos tres puntos son irreversibles o visibles para usuarios reales. Pide
confirmación explícita antes de cada uno; no los agrupes en una sola pregunta:

1. **Aplicar una migración a prod** (`psql -f` sin rollback)
2. **Tag `produccion-*`** — publica al 100% de los usuarios al instante
3. **Force-push o retag** de algo ya publicado

Todo lo demás (verificar en rollback, compilar, tags de interna/cerrada) va
seguido sin preguntar.

## A. Publicar la app (Android / iOS)

**Lo lleva la skill `lanzar-release` del repo `controlgym-app`.** Ahí están los
tags de cada canal, el `versionName` que debe ir a la par del tag, la trampa del
"What's New" de iOS y el diagnóstico de "no me sale actualizar". Aquí solo lo que
toca a este repo:

- **Publica la app DESPUÉS de aplicar las migraciones** (ver el orden arriba).
- Un tag `produccion-*` sigue siendo checkpoint: publica al 100% al instante.

## B. Aplicar migraciones a Supabase

### B1. Conexión

```bash
ENVF=".../scratchpad/.env.prod"   # de `vercel env pull`
DBURL=$(grep -E "^DATABASE_URL=" "$ENVF" | head -1 | sed 's/^DATABASE_URL=//; s/^"//; s/"$//' \
        | sed 's/sslmode=no-verify/sslmode=require/')
```

El `sslmode=no-verify` → `require` es obligatorio: psql no acepta `no-verify`.

### B2. Verificar en rollback ANTES de aplicar — sin excepción

```bash
psql "$DBURL" -q <<'SQL'
begin;
\i 'd:/Personal Proyects/ControlGym/supabase/migrations/<archivo>.sql'
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','<uuid-usuario>','role','authenticated')::text, true);
-- probar la RPC con datos reales y VARIOS casos
rollback;
SQL
```

**POR QUÉ:** un subagente aplicó una migración directo a prod saltándose este
paso. No rompió nada, pero fue suerte. **Solo el controlador aplica a prod**,
nunca un subagente.

Prueba **varias combinaciones**, no una. El bug de "9 ejercicios por día" habría
saltado antes con solo probar dos niveles distintos.

### B3. Aplicar (checkpoint — confirmar antes)

```bash
psql "$DBURL" -q -v ON_ERROR_STOP=1 -f '<ruta>.sql' && echo "APLICADA OK"
```

`ON_ERROR_STOP=1` es obligatorio: sin él psql sigue tras un error y deja la BD a
medias.

### B4. Verificar después

Para funciones nuevas o modificadas:

```sql
select p.oid::regprocedure as firma,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='<nombre>';
```

- **Una sola firma.** Añadir un parámetro con DEFAULT crea una *sobrecarga*, no
  reemplaza: PostgREST falla con "function is not unique" y el usuario ve "No se
  pudo crear tu rutina". Si cambias la firma, `drop function` de la vieja dentro
  de la misma migración.
- **`authenticated` = t.** El patrón es `revoke all from public` +
  `grant execute to authenticated`. Ojo: `revoke from public` **no** protege
  nada en este repo — hay que revocar a `authenticated` explícitamente.

### B5. Trampas de PostgREST que psql no detecta

Lo que funciona por psql puede fallar por la app:

- **`DELETE`/`UPDATE` sin `WHERE`**: PostgREST corre con `safeupdate` y los
  rechaza; psql no. Usa `truncate` para vaciar tablas temporales. Este costó
  muchas rondas de depuración persiguiendo hipótesis falsas.
- **Nombres de campos del JSON**: deben coincidir *exactos* con los `@SerialName`
  de Kotlin. Un `'id'` donde la app espera `'rutina_id'` compila, no da error y
  la pantalla simplemente no abre.

**Las migraciones no reescriben datos existentes.** Si el arreglo cambia cómo se
genera algo, lo ya generado se queda como estaba. Comprueba el impacto y dilo:

```sql
-- ej.: ¿queda alguna rutina con el problema viejo?
select count(*), max(<metrica>) from ...;
```

## C. Desplegar el panel

No hay workflow: **push a `master` → Vercel despliega solo.**

- [ ] `npm test` (debe pasar entero)
- [ ] `npm run build` (limpio)
- [ ] Push a `master`

El remoto responde `This repository moved` (→ `controlgym-portal`); es un aviso,
no un fallo — el push funciona.

## Al terminar: reportar sin adornos

Di **qué se verificó y qué no**. Concreto:

- ✅ Verificado en la fuente: "`version_name` = 0.9.7 en la BD", "track alpha,
  `Successfully finished`"
- ⚠️ Sin verificar: "el arreglo de la foto compila y el flujo es correcto, pero
  **no lo probé en un dispositivo real**"

**POR QUÉ:** un bug de foto se dio por arreglado **tres veces seguidas** y en el
celular del owner seguía fallando; lo descubrió él cada vez. Las tres causas eran
distintas (caché de Coil, un spinner, y un splash decorativo de 2,2 s), y cada
arreglo parecía "el definitivo". **Compilar no es probar.** Si algo solo se
comprueba en un dispositivo (cámara, muerte de proceso, notificaciones), dilo y
pide que lo prueben — no lo declares hecho.

Corolario: cuando el owner dice que un bug **sigue**, no repitas el mismo
diagnóstico. Sus palabras exactas suelen traer la pista nueva ("pantalla de carga
FITCORE" era el splash, no un spinner; "es como si reiniciara" era literal).

Y lista lo que depende del owner: regenerar datos que la migración no toca,
rotar secretos, probar en dispositivo.
