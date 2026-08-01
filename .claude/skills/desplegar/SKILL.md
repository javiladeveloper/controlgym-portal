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
| App (KMP/Compose) | `controlgym-app` | Tag `interna-*` / `cerrada-*` / `produccion-*` → GitHub Actions → Play |
| BD (Supabase) | `ControlGym/supabase/migrations/` | `psql` contra prod (solo el controlador, nunca un subagente) |
| Panel (React/Vite) | `ControlGym` | Push a `master` → Vercel despliega solo (no hay workflow) |

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

## A. Desplegar la app a Play

### A1. Antes de crear el tag

- [ ] **El `versionName` debe coincidir con el tag.** `composeApp/build.gradle.kts`
      → `versionName = "0.9.7"` para el tag `cerrada-v0.9.7`.

      **POR QUÉ:** se quedó congelado en `0.9.1` durante 5 tags. Los builds
      subían bien, pero el celular mostraba la misma versión de siempre y el
      owner reportó "no está actualizando". El `versionCode` (que decide la
      instalación) sí subía; lo que engañaba era el nombre visible. Si no
      coinciden, se repite el mismo reporte.

- [ ] **Compilar los dos targets** antes de tagear:
      ```bash
      cd "d:/Personal Proyects/controlgym-app"
      ./gradlew :composeApp:compileDebugKotlinAndroid --console=plain -q
      ./gradlew :composeApp:compileKotlinIosArm64 --console=plain -q
      ```
      **POR QUÉ:** el código en `commonMain` compila para Android y iOS. Un
      arreglo que solo se probó en Android puede romper el build de iOS y
      tumbar el CI a los 4 minutos.

      **NUNCA correr gradle mientras el owner compila en Android Studio** — se
      bloquean los archivos (`Unable to delete file ... R.jar`) y le rompes su
      build. Si está trabajando, pregunta antes.

- [ ] **Todo commiteado y pusheado.** El CI compila el commit al que apunta el
      tag, no tu working tree.

### A2. Crear el tag

```bash
git tag -a cerrada-v0.9.7 -m "Prueba cerrada v0.9.7

<qué incluye, en lenguaje de usuario>"
git push origin cerrada-v0.9.7
```

Prefijos: `interna-*` (equipo) · `cerrada-*` (testers invitados) ·
`produccion-*` (**todos, al instante** — checkpoint).

**NO borrar y recrear un tag ya pusheado.** Borrar + recrear cuenta como dos
pushes y dispara **dos builds con el mismo tag**. El viejo puede terminar
después del bueno y machacar la ficha con la versión equivocada. Si te
equivocaste, sube el número (`v0.9.8`), no reutilices el tag. Si ya pasó:
cancela el run del commit viejo (`gh run cancel <id>`) y verifica que quedó
`✗ cancelled` sin subir nada.

### A3. Verificar DESPUÉS del build — obligatorio

"CI verde" **no** significa "le llegó al usuario". Verifica en la fuente, nunca
solo en el log:

```bash
gh run watch <run-id> --exit-status
gh run view <run-id> --log | grep -E "Canal de despliegue: |Updating track|Successfully finished" | grep -v '\^\[\[36'
```

Debe aparecer:
- `Canal de despliegue: cerrada (ref cerrada-v0.9.7)` — el canal correcto
- `Updating track 'alpha'...` + `Successfully finished the upload to Google Play`

Y el popup de actualización, **en la BD** (no en el log del CI):

```sql
select plataforma, version_code, version_name, actualizado_at
from public.app_version where plataforma='android';
```

- `version_code` mayor que el anterior (= `run_number` + 26)
- `version_name` **igual al tag** ← el que falló y nadie miró
- `actualizado_at` de hace un momento

Al filtrar logs de GitHub Actions usa `grep -v '\^\[\[36'`: sin eso salen las
líneas del *comando* (con códigos de color ANSI) y no su salida real — es fácil
creer que verificaste algo cuando solo leíste el `echo`.

### A4. Lo que NO puedes verificar desde aquí

La clave de Play vive solo en GitHub secrets (correcto), así que **no se puede
consultar el track desde local**. Si el owner dice "no me sale actualizar" y el
CI subió bien, el problema es de entrega, no de build. Antes de mandarlo a
buscar, pregunta: **¿la app instalada vino de la prueba cerrada, o de la interna
/ instalada a mano?** Esa respuesta discrimina entre:

1. No está en la lista de testers de *esa* prueba (interna ≠ cerrada)
2. La cuenta de Google del celular no es la de la lista
3. Play tarda en propagar (minutos a horas) — lo más común
4. La instalada vino de otro track: Play no cruza tracks solo

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

**POR QUÉ:** se dio por arreglado un bug de foto que en el celular del owner
seguía fallando, y lo descubrió él. Compilar no es probar. Si algo solo se puede
comprobar en un dispositivo, dilo y pide que lo prueben — no lo declares hecho.

Y lista lo que depende del owner: regenerar datos que la migración no toca,
rotar secretos, probar en dispositivo.
