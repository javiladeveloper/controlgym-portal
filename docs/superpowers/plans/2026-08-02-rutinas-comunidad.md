# Rutinas de comunidad — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development
> (recomendado) o superpowers:executing-plans para ejecutar este plan tarea a
> tarea. Los pasos usan checkbox (`- [ ]`) para llevar el control.

**Objetivo:** convertir "Rutinas listas" de un catálogo cerrado de 5 rutinas
curadas en una comunidad: varias rutinas propias, publicar la tuya para que otros
la usen, puntuación y filtros.

**Arquitectura:** se reutiliza `rutina_predisenada` como tabla de rutinas
publicadas en vez de crear una paralela — ya tiene casi todos los campos y la
pantalla que la pinta; las 5 curadas son las que tienen `autor_id is null`. La
Parte A no cambia el esquema: reutiliza la columna `activa` (que ya es única por
usuario) con el significado de "en curso", y sustituye el `delete` de
`generar_rutina_libre` por un `update`.

**Stack:** Supabase/Postgres (migraciones por psql), app KMP/Compose
(`controlgym-app`), panel React/Vite (`ControlGym`).

**Spec:** `docs/superpowers/specs/2026-08-02-rutinas-comunidad-design.md`

## Global Constraints

Aplican a TODAS las tareas:

- **Migraciones:** verificar SIEMPRE en `begin; … rollback;` contra prod ANTES de
  aplicar, con **varios casos, no uno**. Solo el controlador aplica a prod, nunca
  un subagente.
- **Aplicar:** `psql "$DBURL" -q -v ON_ERROR_STOP=1 -f <archivo>.sql`. Sin
  `ON_ERROR_STOP=1` psql sigue tras un error y deja la BD a medias.
- **Conexión:** `DATABASE_URL` de `vercel env pull`, sustituyendo
  `sslmode=no-verify` por `sslmode=require` (psql no acepta `no-verify`).
- **RPC:** `security definer set search_path = public`, `revoke all from public`
  + `grant execute to authenticated`. Ojo: `revoke from public` NO protege nada
  en este repo; hay que revocar a `authenticated` explícitamente.
- **Cambiar la firma de una función = `drop function` de la vieja EN LA MISMA
  migración.** Añadir un parámetro con DEFAULT crea una sobrecarga, no
  reemplaza: PostgREST falla con "function is not unique" y el usuario ve un
  error genérico.
- **Nunca `DELETE`/`UPDATE` sin `WHERE`**: PostgREST corre con `safeupdate` y los
  rechaza aunque psql los acepte. Para vaciar temporales, `truncate`.
- **Shape del JSON = `@SerialName` de Kotlin, exacto.** Un desajuste compila, no
  lanza error y la pantalla simplemente no abre.
- **App:** compilar Android **e** iOS antes de dar nada por hecho:
  `./gradlew :composeApp:compileDebugKotlinAndroid` y
  `:composeApp:compileKotlinIosArm64`. Compilar no es probar: lo visual se
  verifica en emulador.
- **No correr gradle si el owner está compilando en Android Studio** (bloquea
  archivos y le rompe el build).
- **Panel:** `npm test` (83 tests) y `npm run build` limpios antes de commitear.
- **Categorías bloqueadas:** un usuario NUNCA puede publicar en `prenatal` ni
  `rehabilitacion`.

---

## Estructura de archivos

**Parte A** (BD + app):
- Crear: `supabase/migrations/20260803100000_varias_rutinas_propias.sql`
- Modificar: `composeApp/.../data/repositorio/RutinaLibreRepositorio.kt`
- Modificar: `composeApp/.../ui/libre/RutinaLibreViewModel.kt`
- Modificar: `composeApp/.../ui/libre/PantallaRutinaLibre.kt`

**Parte B** (BD + app + panel):
- Crear: `supabase/migrations/20260803110000_publicar_rutina.sql`
- Modificar: `composeApp/.../data/modelos/RutinaPredisenada.kt`
- Crear: `composeApp/.../ui/libre/DialogoPublicarRutina.kt`
- Crear: `src/hooks/useRutinasComunidad.js` (panel)
- Modificar: `src/pages/Rutinas.jsx` (panel — bandeja de aprobación)

**Parte C** (BD + app):
- Crear: `supabase/migrations/20260803120000_votos_y_filtros.sql`
- Modificar: `composeApp/.../data/repositorio/RutinaPredisenadaRepositorio.kt`
- Crear: `composeApp/.../ui/libre/FiltrosComunidad.kt`

---

# PARTE A — Varias rutinas propias

Entregable: la persona guarda varias rutinas y elige cuál sigue. Publicable sola.

### Task A1: la rutina anterior ya no se borra

**Files:**
- Create: `supabase/migrations/20260803100000_varias_rutinas_propias.sql`

**Interfaces:**
- Consumes: `generar_rutina_libre(text,text,integer,text,text)` (firma actual, no cambia)
- Produces: `mis_rutinas() → jsonb`, `marcar_rutina_en_curso(uuid) → jsonb`,
  `eliminar_mi_rutina(uuid) → jsonb`

- [ ] **Paso 1: escribir la migración**

En `generar_rutina_libre` (y en `crear_rutina_libre_vacia`), sustituir la línea:

```sql
  delete from public.rutina_libre where usuario_id = v_usuario and activa;
```

por:

```sql
  -- NO se borra la rutina anterior: se archiva. Antes, crear una rutina nueva
  -- destruía la que tenías, así que era imposible guardar varias.
  update public.rutina_libre set activa = false
   where usuario_id = v_usuario and activa;
```

Y añadir al final del archivo:

```sql
-- Lista las rutinas del usuario (la en curso primero, luego por fecha).
create or replace function public.mis_rutinas()
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(t order by t.activa desc, t.created_at desc), '[]'::jsonb)
  from (
    select rl.id, rl.nombre, rl.objetivo, rl.equipo, rl.enfoque,
           rl.activa, rl.created_at,
           (select count(*) from public.rutina_libre_dia d
             where d.rutina_libre_id = rl.id) as dias
    from public.rutina_libre rl
    where rl.usuario_id = auth.uid()
  ) t;
$$;

revoke all on function public.mis_rutinas() from public;
grant execute on function public.mis_rutinas() to authenticated;

-- Cambia cuál rutina se está siguiendo. El índice único
-- rutina_libre_usuario_activa_uq obliga a desmarcar la anterior ANTES de
-- marcar la nueva: hacerlo al revés viola la restricción.
create or replace function public.marcar_rutina_en_curso(p_rutina uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  if not exists (
    select 1 from public.rutina_libre
     where id = p_rutina and usuario_id = v_uid
  ) then
    raise exception 'Esa rutina no es tuya';
  end if;

  update public.rutina_libre set activa = false
   where usuario_id = v_uid and activa and id <> p_rutina;
  update public.rutina_libre set activa = true
   where id = p_rutina;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.marcar_rutina_en_curso(uuid) from public;
grant execute on function public.marcar_rutina_en_curso(uuid) to authenticated;

-- Borra una rutina propia. Si era la que estaba en curso, promueve la más
-- reciente de las que quedan: si no, la persona se queda sin rutina activa y
-- "Mi rutina" aparece vacía sin explicación.
create or replace function public.eliminar_mi_rutina(p_rutina uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_era_activa boolean; v_siguiente uuid;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;

  select activa into v_era_activa
  from public.rutina_libre where id = p_rutina and usuario_id = v_uid;
  if v_era_activa is null then raise exception 'Esa rutina no es tuya'; end if;

  delete from public.rutina_libre where id = p_rutina and usuario_id = v_uid;

  if v_era_activa then
    select id into v_siguiente from public.rutina_libre
     where usuario_id = v_uid order by created_at desc limit 1;
    if v_siguiente is not null then
      update public.rutina_libre set activa = true where id = v_siguiente;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'promovida', v_siguiente);
end;
$$;

revoke all on function public.eliminar_mi_rutina(uuid) from public;
grant execute on function public.eliminar_mi_rutina(uuid) to authenticated;
```

- [ ] **Paso 2: verificar en rollback — varios casos**

```bash
ENVF=".../scratchpad/.env.prod"
DBURL=$(grep -E "^DATABASE_URL=" "$ENVF" | head -1 | sed 's/^DATABASE_URL=//; s/^"//; s/"$//' \
        | sed 's/sslmode=no-verify/sslmode=require/')
psql "$DBURL" -q <<'SQL'
begin;
\i 'd:/Personal Proyects/ControlGym/supabase/migrations/20260803100000_varias_rutinas_propias.sql'
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','f0102dc8-0873-44e7-b36d-94b749f8c689','role','authenticated')::text, true);

-- CASO 1: generar dos rutinas seguidas -> deben quedar LAS DOS
select public.generar_rutina_libre('ganar_masa','intermedio',3,'gym_completo','equilibrado');
select public.generar_rutina_libre('fuerza','avanzado',4,'gym_completo','equilibrado');
select 'caso1: rutinas guardadas' as t, count(*), count(*) filter (where activa) as en_curso
from public.rutina_libre where usuario_id='f0102dc8-0873-44e7-b36d-94b749f8c689';

-- CASO 2: mis_rutinas devuelve las dos, la en curso primero
select 'caso2' as t, jsonb_array_length(public.mis_rutinas()) as cuantas,
       public.mis_rutinas()->0->>'activa' as primera_es_la_en_curso;

-- CASO 3: cambiar de rutina en curso
select public.marcar_rutina_en_curso(
  (select id from public.rutina_libre
    where usuario_id='f0102dc8-0873-44e7-b36d-94b749f8c689' and not activa limit 1));
select 'caso3: sigue habiendo UNA en curso' as t,
       count(*) filter (where activa) from public.rutina_libre
 where usuario_id='f0102dc8-0873-44e7-b36d-94b749f8c689';

-- CASO 4: borrar la EN CURSO promueve otra
select public.eliminar_mi_rutina(
  (select id from public.rutina_libre
    where usuario_id='f0102dc8-0873-44e7-b36d-94b749f8c689' and activa limit 1));
select 'caso4: quedo una en curso tras borrar' as t,
       count(*) filter (where activa) from public.rutina_libre
 where usuario_id='f0102dc8-0873-44e7-b36d-94b749f8c689';
rollback;
SQL
```

Esperado: caso1 → 2 rutinas, 1 en curso. caso2 → `cuantas` ≥ 2 y
`primera_es_la_en_curso` = `true`. caso3 → sigue 1. caso4 → sigue 1.

- [ ] **Paso 3: aplicar a prod (CHECKPOINT — confirmar con el owner antes)**

```bash
psql "$DBURL" -q -v ON_ERROR_STOP=1 -f 'supabase/migrations/20260803100000_varias_rutinas_propias.sql' \
  && echo "APLICADA OK"
```

- [ ] **Paso 4: verificar firmas y permisos tras aplicar**

```bash
psql "$DBURL" -c "select p.oid::regprocedure as firma,
  has_function_privilege('authenticated', p.oid,'execute') as auth
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('mis_rutinas','marcar_rutina_en_curso','eliminar_mi_rutina',
                    'generar_rutina_libre','crear_rutina_libre_vacia')
order by 1;"
```

Esperado: **una sola firma por nombre** y `auth = t` en todas.

- [ ] **Paso 5: commit**

```bash
git add supabase/migrations/20260803100000_varias_rutinas_propias.sql
git commit -m "feat(rutinas): guardar varias rutinas propias, una en curso"
```

### Task A2: la app lista y cambia entre rutinas

**Files:**
- Modify: `composeApp/src/commonMain/kotlin/pe/fitcore/app/data/repositorio/RutinaLibreRepositorio.kt`
- Modify: `composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/RutinaLibreViewModel.kt`
- Modify: `composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/PantallaRutinaLibre.kt`

**Interfaces:**
- Consumes: `mis_rutinas()`, `marcar_rutina_en_curso(uuid)`, `eliminar_mi_rutina(uuid)` (Task A1)
- Produces: `MiRutinaCard` (modelo), sección "MIS RUTINAS" en la pantalla

- [ ] **Paso 1: modelo de la tarjeta**

En `RutinaLibreRepositorio.kt`, añadir arriba del interface:

```kotlin
/**
 * Una rutina guardada del usuario, para la lista "Mis rutinas".
 * Los @SerialName tienen que coincidir EXACTO con el JSON de `mis_rutinas()`:
 * un desajuste compila, no lanza error y la lista sale vacía sin explicación.
 */
@Serializable
data class MiRutinaCard(
    val id: String,
    val nombre: String? = null,
    val objetivo: String? = null,
    val equipo: String? = null,
    val enfoque: String? = null,
    val activa: Boolean = false,
    val dias: Int = 0,
)
```

- [ ] **Paso 2: métodos en el repositorio**

Añadir al interface `RutinaLibreRepositorio`:

```kotlin
    /** Rutinas guardadas del usuario (la en curso primero). */
    suspend fun misRutinas(): Resultado<List<MiRutinaCard>>
    /** Cambia cuál rutina se está siguiendo. */
    suspend fun marcarEnCurso(rutinaId: String): Resultado<Unit>
    /** Borra una rutina propia (si era la en curso, el backend promueve otra). */
    suspend fun eliminar(rutinaId: String): Resultado<Unit>
```

Y su implementación:

```kotlin
    override suspend fun misRutinas(): Resultado<List<MiRutinaCard>> =
        resultadoDe("No se pudieron cargar tus rutinas.") {
            cliente.postgrest.rpc("mis_rutinas").decodeAs<List<MiRutinaCard>>()
        }

    override suspend fun marcarEnCurso(rutinaId: String): Resultado<Unit> =
        resultadoDe("No se pudo cambiar de rutina.") {
            cliente.postgrest.rpc(
                "marcar_rutina_en_curso",
                buildJsonObject { put("p_rutina", rutinaId) },
            )
            Unit
        }

    override suspend fun eliminar(rutinaId: String): Resultado<Unit> =
        resultadoDe("No se pudo eliminar la rutina.") {
            cliente.postgrest.rpc(
                "eliminar_mi_rutina",
                buildJsonObject { put("p_rutina", rutinaId) },
            )
            Unit
        }
```

- [ ] **Paso 3: estado en el ViewModel**

En `RutinaLibreViewModel.kt`, añadir al data class de estado:

```kotlin
    val misRutinas: List<MiRutinaCard> = emptyList(),
```

Y los métodos:

```kotlin
    /** Carga la lista de rutinas guardadas (para la sección "Mis rutinas"). */
    fun cargarMisRutinas() {
        viewModelScope.launch {
            val r = repo.misRutinas()
            if (r is Resultado.Exito) _estado.value = _estado.value.copy(misRutinas = r.dato)
        }
    }

    /** Cambia de rutina en curso y recarga para que la pantalla muestre la nueva. */
    fun cambiarA(rutinaId: String) {
        viewModelScope.launch {
            when (val r = repo.marcarEnCurso(rutinaId)) {
                is Resultado.Exito -> { cargar(); cargarMisRutinas() }
                is Resultado.Fallo -> _estado.value = _estado.value.copy(mensaje = r.mensaje)
            }
        }
    }

    /** Borra una rutina propia y refresca ambas vistas. */
    fun eliminarRutina(rutinaId: String) {
        viewModelScope.launch {
            when (val r = repo.eliminar(rutinaId)) {
                is Resultado.Exito -> { cargar(); cargarMisRutinas() }
                is Resultado.Fallo -> _estado.value = _estado.value.copy(mensaje = r.mensaje)
            }
        }
    }
```

- [ ] **Paso 4: sección "MIS RUTINAS" en la pantalla**

En `PantallaRutinaLibre.kt`, dentro de la subpantalla `"predisenadas"`, ANTES de
la lista de curadas:

```kotlin
        if (estado.misRutinas.size > 1) {
            Text(
                "MIS RUTINAS",
                style = MaterialTheme.typography.labelMedium,
                color = ColoresFitCore.Atenuado,
                modifier = Modifier.padding(vertical = 8.dp),
            )
            estado.misRutinas.forEach { r ->
                Tarjeta(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                    Row(
                        Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                r.nombre ?: "Mi rutina",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold,
                                color = ColoresFitCore.Tinta,
                            )
                            Text(
                                "${r.dias} días",
                                style = MaterialTheme.typography.bodySmall,
                                color = ColoresFitCore.Atenuado,
                            )
                        }
                        if (r.activa) {
                            Text(
                                "En curso",
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                                color = ColoresFitCore.Primario,
                            )
                        } else {
                            TextButton(onClick = { vm.cambiarA(r.id) }) { Text("Usar") }
                        }
                    }
                }
            }
        }
```

Y llamar a `vm.cargarMisRutinas()` en el `LaunchedEffect(Unit)` que ya existe
junto a `vm.cargar()`.

**Nota:** la sección solo aparece con **más de una** rutina. Con una sola no
aporta nada y añade ruido a la pantalla.

- [ ] **Paso 5: compilar los dos targets**

```bash
cd "d:/Personal Proyects/controlgym-app"
./gradlew :composeApp:compileDebugKotlinAndroid --console=plain -q
./gradlew :composeApp:compileKotlinIosArm64 --console=plain -q
```

Esperado: sin líneas `e:`.

- [ ] **Paso 6: probar en emulador**

```bash
"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -avd Pixel_8_HD -no-snapshot-load &
# esperar boot, luego:
./gradlew :composeApp:installDebug --console=plain -q
```

Comprobar: generar una rutina nueva NO borra la anterior; "Mis rutinas" lista
las dos; "Usar" cambia la en curso.

- [ ] **Paso 7: commit**

```bash
git add composeApp/src/commonMain/kotlin/pe/fitcore/app/
git commit -m "feat(rutinas): la app lista y cambia entre varias rutinas propias"
```

---

# PARTE B — Publicar y aprobar

Entregable: se publica una rutina, el owner la aprueba y aparece en la comunidad.
Depende de la Parte A.

### Task B1: campos y RPC de publicación

**Files:**
- Create: `supabase/migrations/20260803110000_publicar_rutina.sql`

**Interfaces:**
- Consumes: `rutina_predisenada`, `rutina_libre` (Task A1)
- Produces: `publicar_mi_rutina(uuid,text,text) → jsonb`,
  `rutinas_pendientes() → jsonb`, `resolver_rutina(uuid,boolean,text) → jsonb`

- [ ] **Paso 1: escribir la migración**

```sql
-- Campos para que rutina_predisenada aloje también rutinas de usuarios.
-- Las 5 curadas quedan como están: autor_id null + estado 'aprobada'.
alter table public.rutina_predisenada
  add column if not exists autor_id uuid references public.usuario(id) on delete set null,
  add column if not exists estado text not null default 'aprobada'
    check (estado in ('pendiente','aprobada','rechazada','retirada')),
  add column if not exists objetivo text references public.objetivo_entrenamiento(codigo),
  add column if not exists motivo_rechazo text,
  add column if not exists aprobada_at timestamptz;

-- Alias público del autor: usuario.nombre es el nombre REAL, y publicar con
-- nombre y apellido expone a la gente más de lo que espera.
alter table public.usuario add column if not exists nombre_publico text;

-- De qué rutina publicada salió una rutina adoptada. Hace falta para saber
-- quién puede votar (solo vota quien la usó) y para el contador de adopciones.
alter table public.rutina_libre
  add column if not exists origen_predisenada_id uuid
    references public.rutina_predisenada(id) on delete set null;

create index if not exists rutina_predisenada_estado_idx
  on public.rutina_predisenada(estado) where estado = 'aprobada';

-- Publica una copia de tu rutina. Se COPIA, no se enlaza: si luego editas la
-- tuya, la publicada no cambia — nadie ve mutar bajo sus pies una rutina que
-- ya está siguiendo.
create or replace function public.publicar_mi_rutina(
  p_rutina_libre uuid,
  p_descripcion text,
  p_objetivo text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_rl record;
  v_nueva uuid;
  v_dia record;
  v_dia_nuevo uuid;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  if coalesce(trim(p_descripcion),'') = '' then
    raise exception 'Escribe una descripción para que otros sepan de qué va';
  end if;
  if not exists (select 1 from public.objetivo_entrenamiento where codigo = p_objetivo) then
    raise exception 'Objetivo inválido';
  end if;

  select * into v_rl from public.rutina_libre
   where id = p_rutina_libre and usuario_id = v_uid;
  if not found then raise exception 'Esa rutina no es tuya'; end if;

  if exists (
    select 1 from public.rutina_predisenada
     where autor_id = v_uid and estado = 'pendiente'
  ) then
    raise exception 'Ya tienes una rutina esperando aprobación';
  end if;

  insert into public.rutina_predisenada
    (slug, nombre, categoria, descripcion, nivel, dias_por_semana, equipo,
     activa, autor_id, estado, objetivo)
  values (
    'u-' || replace(gen_random_uuid()::text, '-', ''),
    coalesce(nullif(trim(v_rl.nombre),''), 'Rutina de la comunidad'),
    -- categoria 'comunidad' SIEMPRE: prenatal y rehabilitacion quedan
    -- reservadas a las curadas, son las que más daño hacen mal hechas.
    'comunidad',
    trim(p_descripcion),
    'intermedio',
    (select count(*) from public.rutina_libre_dia where rutina_libre_id = v_rl.id),
    coalesce(v_rl.equipo, 'gym_completo'),
    true, v_uid, 'pendiente', p_objetivo
  )
  returning id into v_nueva;

  for v_dia in
    select * from public.rutina_libre_dia
     where rutina_libre_id = v_rl.id order by dia_semana
  loop
    insert into public.rutina_predisenada_dia (rutina_predisenada_id, dia_semana, foco)
    values (v_nueva, v_dia.dia_semana, v_dia.foco)
    returning id into v_dia_nuevo;

    insert into public.rutina_predisenada_ejercicio
      (rutina_predisenada_dia_id, catalogo_id, nombre, series, reps, descanso, orden)
    select v_dia_nuevo, e.catalogo_id, e.nombre, e.series, e.reps, e.descanso, e.orden
    from public.rutina_libre_ejercicio e
    where e.rutina_libre_dia_id = v_dia.id;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_nueva, 'estado', 'pendiente');
end;
$$;

revoke all on function public.publicar_mi_rutina(uuid, text, text) from public;
grant execute on function public.publicar_mi_rutina(uuid, text, text) to authenticated;

-- Bandeja del owner: rutinas esperando aprobación.
create or replace function public.rutinas_pendientes()
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(t order by t.created_at), '[]'::jsonb)
  from (
    select rp.id, rp.nombre, rp.descripcion, rp.objetivo, rp.nivel,
           rp.dias_por_semana, rp.equipo, rp.created_at,
           coalesce(u.nombre_publico, split_part(u.nombre, ' ', 1)) as autor
    from public.rutina_predisenada rp
    join public.usuario u on u.id = rp.autor_id
    where rp.estado = 'pendiente'
  ) t;
$$;

revoke all on function public.rutinas_pendientes() from public;
grant execute on function public.rutinas_pendientes() to authenticated;

-- Aprobar o rechazar. Solo el dueño de la plataforma (no hay rol de moderador
-- todavía): se comprueba contra privado.secreto para no cablear un uuid.
create or replace function public.resolver_rutina(
  p_rutina uuid, p_aprobar boolean, p_motivo text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  -- es_superadmin() YA EXISTE y es la que usa get_plataforma_dashboard para lo
  -- mismo. No crear otra función de permiso: dos criterios distintos de "quién
  -- manda" acaban divergiendo.
  if not public.es_superadmin() then
    raise exception 'Solo el administrador de la plataforma puede moderar rutinas';
  end if;

  update public.rutina_predisenada
     set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
         motivo_rechazo = case when p_aprobar then null else p_motivo end,
         aprobada_at = case when p_aprobar then now() else null end
   where id = p_rutina and estado = 'pendiente';
  if not found then raise exception 'Esa rutina no está pendiente'; end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.resolver_rutina(uuid, boolean, text) from public;
grant execute on function public.resolver_rutina(uuid, boolean, text) to authenticated;
```

**No hay que crear ninguna función de permisos.** `public.es_superadmin()` ya
existe en prod (verificado) y es la que usa `get_plataforma_dashboard()` para
exactamente lo mismo. Reutilizarla evita que dos criterios distintos de "quién
manda" acaben divergiendo.

- [ ] **Paso 2: verificar en rollback — varios casos**

```bash
psql "$DBURL" -q <<'SQL'
begin;
\i 'd:/Personal Proyects/ControlGym/supabase/migrations/20260803110000_publicar_rutina.sql'
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','f0102dc8-0873-44e7-b36d-94b749f8c689','role','authenticated')::text, true);

-- CASO 1: publicar copia días y ejercicios, y queda PENDIENTE
select public.publicar_mi_rutina(
  (select id from public.rutina_libre
    where usuario_id='f0102dc8-0873-44e7-b36d-94b749f8c689' and activa limit 1),
  'Rutina de prueba para la comunidad', 'ganar_masa');
select 'caso1' as t, estado, categoria, dias_por_semana,
       (select count(*) from public.rutina_predisenada_dia d
         where d.rutina_predisenada_id = rp.id) as dias_copiados
from public.rutina_predisenada rp where rp.estado='pendiente';

-- CASO 2: publicar dos veces seguidas debe FALLAR (una pendiente por persona)
do $$ begin
  perform public.publicar_mi_rutina(
    (select id from public.rutina_libre
      where usuario_id='f0102dc8-0873-44e7-b36d-94b749f8c689' and activa limit 1),
    'Segunda', 'fuerza');
  raise notice 'CASO2 MAL: dejó publicar dos veces';
exception when others then raise notice 'CASO2 OK: %', sqlerrm;
end $$;

-- CASO 3: objetivo inválido debe FALLAR
do $$ begin
  perform public.publicar_mi_rutina(
    (select id from public.rutina_libre
      where usuario_id='f0102dc8-0873-44e7-b36d-94b749f8c689' limit 1),
    'X', 'objetivo_que_no_existe');
  raise notice 'CASO3 MAL: aceptó objetivo inválido';
exception when others then raise notice 'CASO3 OK: %', sqlerrm;
end $$;

-- CASO 4: las 5 curadas siguen visibles y sin autor
reset role;
select 'caso4: curadas intactas' as t, count(*)
from public.rutina_predisenada where autor_id is null and estado='aprobada';
rollback;
SQL
```

Esperado: caso1 → `pendiente`, `comunidad`, con días copiados > 0. caso2 y caso3
→ "OK" (fallan como deben). caso4 → 5.

- [ ] **Paso 3: aplicar a prod (CHECKPOINT — confirmar antes)**

```bash
psql "$DBURL" -q -v ON_ERROR_STOP=1 -f 'supabase/migrations/20260803110000_publicar_rutina.sql' \
  && echo "APLICADA OK"
```

- [ ] **Paso 4: verificar firmas, permisos y que nada se rompió**

```bash
psql "$DBURL" -c "select p.oid::regprocedure as firma,
  has_function_privilege('authenticated', p.oid,'execute') as auth
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('publicar_mi_rutina','rutinas_pendientes','resolver_rutina')
order by 1;"
psql "$DBURL" -c "select count(*) as curadas_visibles
from public.rutina_predisenada where estado='aprobada' and autor_id is null;"
```

Esperado: una firma por nombre, `auth = t`, y **5** curadas visibles.

- [ ] **Paso 5: commit**

```bash
git add supabase/migrations/20260803110000_publicar_rutina.sql
git commit -m "feat(rutinas): publicar una rutina propia a la comunidad, con aprobación"
```

### Task B2: bandeja de aprobación en el panel

**Files:**
- Create: `src/hooks/useRutinasComunidad.js`
- Modify: `src/pages/Rutinas.jsx`

**Interfaces:**
- Consumes: `rutinas_pendientes()`, `resolver_rutina(uuid,boolean,text)` (Task B1)
- Produces: card "Rutinas de la comunidad" en la página de Rutinas

- [ ] **Paso 1: el hook**

Crear `src/hooks/useRutinasComunidad.js`:

```js
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'

/** Rutinas que los usuarios enviaron y esperan aprobación. */
export function useRutinasPendientes() {
  return useQuery({
    queryKey: ['rutinas-pendientes'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rutinas_pendientes')
      if (error) throw error
      return data ?? []
    },
  })
}

/** Aprueba o rechaza una rutina. Al rechazar, el motivo es obligatorio: sin él
 *  el autor no sabe qué corregir. */
export function useResolverRutina() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, aprobar, motivo }) => {
      const { error } = await supabase.rpc('resolver_rutina', {
        p_rutina: id,
        p_aprobar: aprobar,
        p_motivo: motivo ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rutinas-pendientes'] }),
  })
}
```

- [ ] **Paso 2: la card en Rutinas.jsx**

Añadir el import y, al principio del render de la página:

```jsx
import { useRutinasPendientes, useResolverRutina } from '../hooks/useRutinasComunidad.js'
```

```jsx
function RutinasComunidadPendientes() {
  const { data: pendientes = [], isLoading } = useRutinasPendientes()
  const resolver = useResolverRutina()

  // Sin pendientes no se pinta nada: una card vacía es ruido permanente en una
  // pantalla que se usa todos los días.
  if (isLoading || pendientes.length === 0) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="font-semibold text-slate-800">
        Rutinas de la comunidad · {pendientes.length} por revisar
      </h3>
      <ul className="mt-3 space-y-3">
        {pendientes.map((r) => (
          <li key={r.id} className="rounded-lg border border-slate-100 p-3">
            <p className="font-medium text-slate-800">{r.nombre}</p>
            <p className="text-sm text-slate-500">{r.descripcion}</p>
            <p className="mt-1 text-xs text-slate-400">
              por {r.autor} · {r.objetivo} · {r.dias_por_semana} días · {r.equipo}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => resolver.mutate({ id: r.id, aprobar: true })}
                disabled={resolver.isPending}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Aprobar
              </button>
              <button
                onClick={() => {
                  const motivo = window.prompt('¿Por qué la rechazas? (lo verá el autor)')
                  if (motivo) resolver.mutate({ id: r.id, aprobar: false, motivo })
                }}
                disabled={resolver.isPending}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
              >
                Rechazar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

Y renderizarla arriba del contenido existente de la página: `<RutinasComunidadPendientes />`.

- [ ] **Paso 3: tests y build**

```bash
cd "d:/Personal Proyects/ControlGym"
npm test
npm run build
```

Esperado: 83 tests pasando y build sin errores.

- [ ] **Paso 4: commit**

```bash
git add src/hooks/useRutinasComunidad.js src/pages/Rutinas.jsx
git commit -m "feat(panel): bandeja de aprobación de rutinas de la comunidad"
```

### Task B3: publicar desde la app

**Files:**
- Create: `composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/DialogoPublicarRutina.kt`
- Modify: `composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/PantallaRutinaLibre.kt`
- Modify: `composeApp/src/commonMain/kotlin/pe/fitcore/app/data/repositorio/RutinaLibreRepositorio.kt`

**Interfaces:**
- Consumes: `publicar_mi_rutina(uuid,text,text)` (Task B1)
- Produces: botón "Compartir con la comunidad" + su diálogo

- [ ] **Paso 1: método en el repositorio**

En `RutinaLibreRepositorio.kt`, al interface:

```kotlin
    /** Publica una copia de la rutina para la comunidad (queda pendiente). */
    suspend fun publicar(rutinaId: String, descripcion: String, objetivo: String): Resultado<Unit>
```

Implementación:

```kotlin
    override suspend fun publicar(
        rutinaId: String,
        descripcion: String,
        objetivo: String,
    ): Resultado<Unit> = resultadoDe("No se pudo publicar tu rutina.") {
        cliente.postgrest.rpc(
            "publicar_mi_rutina",
            buildJsonObject {
                put("p_rutina_libre", rutinaId)
                put("p_descripcion", descripcion)
                put("p_objetivo", objetivo)
            },
        )
        Unit
    }
```

- [ ] **Paso 2: el diálogo**

Crear `DialogoPublicarRutina.kt`:

```kotlin
package pe.fitcore.app.ui.libre

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Objetivos del catálogo (`objetivo_entrenamiento`), en el orden que se ve. */
private val OBJETIVOS = listOf(
    "ganar_masa" to "Ganar masa muscular",
    "bajar_peso" to "Bajar de peso",
    "fuerza" to "Fuerza",
    "resistencia" to "Resistencia / cardio",
    "tonificar" to "Tonificar",
    "salud_general" to "Salud general",
    "prep_deportiva" to "Preparación deportiva",
)

/**
 * Pide lo mínimo para publicar: descripción y objetivo. El resto (nivel, días,
 * equipo) se deduce de la rutina — pedirlo otra vez sería redundante.
 *
 * NO se ofrecen 'prenatal' ni 'rehabilitacion': son las categorías que más daño
 * pueden hacer mal hechas y quedan reservadas a las rutinas curadas.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DialogoPublicarRutina(
    onCerrar: () -> Unit,
    onPublicar: (descripcion: String, objetivo: String) -> Unit,
) {
    var descripcion by remember { mutableStateOf("") }
    var objetivo by remember { mutableStateOf(OBJETIVOS.first().first) }
    var abierto by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onCerrar,
        title = { Text("Compartir con la comunidad") },
        text = {
            Column {
                Text(
                    "Otros podrán verla y usarla. La revisamos antes de publicarla.",
                    Modifier.padding(bottom = 12.dp),
                )
                OutlinedTextField(
                    value = descripcion,
                    onValueChange = { descripcion = it },
                    label = { Text("¿De qué va tu rutina?") },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                )
                ExposedDropdownMenuBox(
                    expanded = abierto,
                    onExpandedChange = { abierto = it },
                    modifier = Modifier.padding(top = 12.dp),
                ) {
                    OutlinedTextField(
                        value = OBJETIVOS.first { it.first == objetivo }.second,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Objetivo") },
                        modifier = Modifier.fillMaxWidth().menuAnchor(),
                    )
                    androidx.compose.material3.ExposedDropdownMenu(
                        expanded = abierto,
                        onDismissRequest = { abierto = false },
                    ) {
                        OBJETIVOS.forEach { (codigo, etiqueta) ->
                            DropdownMenuItem(
                                text = { Text(etiqueta) },
                                onClick = { objetivo = codigo; abierto = false },
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onPublicar(descripcion.trim(), objetivo) },
                enabled = descripcion.trim().length >= 10,
            ) { Text("Publicar") }
        },
        dismissButton = { TextButton(onClick = onCerrar) { Text("Cancelar") } },
    )
}
```

- [ ] **Paso 3: botón en la pantalla**

En `PantallaRutinaLibre.kt`, junto a "Ver rutinas listas":

```kotlin
                OutlinedButton(
                    onClick = { mostrarPublicar = true },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Compartir con la comunidad") }
```

Con su estado `var mostrarPublicar by remember { mutableStateOf(false) }` y:

```kotlin
    if (mostrarPublicar) {
        DialogoPublicarRutina(
            onCerrar = { mostrarPublicar = false },
            onPublicar = { desc, obj ->
                mostrarPublicar = false
                vm.publicar(desc, obj)
            },
        )
    }
```

Y en el ViewModel:

```kotlin
    /** Publica la rutina en curso. Queda pendiente de aprobación. */
    fun publicar(descripcion: String, objetivo: String) {
        val id = _estado.value.rutina?.rutinaId ?: return
        viewModelScope.launch {
            _estado.value = _estado.value.copy(
                mensaje = when (val r = repo.publicar(id, descripcion, objetivo)) {
                    is Resultado.Exito ->
                        "✅ ¡Enviada! La revisamos y te avisamos cuando esté publicada."
                    is Resultado.Fallo -> r.mensaje
                },
            )
        }
    }
```

- [ ] **Paso 4: compilar los dos targets**

```bash
./gradlew :composeApp:compileDebugKotlinAndroid --console=plain -q
./gradlew :composeApp:compileKotlinIosArm64 --console=plain -q
```

- [ ] **Paso 5: probar en emulador**

Publicar una rutina y comprobar que sale el mensaje de éxito. Luego, en el
panel, que aparece en la bandeja y que al aprobarla desaparece de ahí.

- [ ] **Paso 6: commit**

```bash
git add composeApp/src/commonMain/kotlin/pe/fitcore/app/
git commit -m "feat(rutinas): compartir tu rutina con la comunidad desde la app"
```

---

# PARTE C — Puntuación, filtros y orden

Entregable: la comunidad puntúa y el catálogo se puede filtrar y ordenar.
Depende de la Parte B.

### Task C1: votos y listado con filtros

**Files:**
- Create: `supabase/migrations/20260803120000_votos_y_filtros.sql`

**Interfaces:**
- Consumes: `rutina_predisenada` con `estado`/`autor_id` (Task B1)
- Produces: `votar_rutina(uuid,int) → jsonb`,
  `listar_rutinas_comunidad(text,text,text,int,text,text) → jsonb`

- [ ] **Paso 1: escribir la migración**

```sql
create table if not exists public.rutina_voto (
  rutina_id uuid not null references public.rutina_predisenada(id) on delete cascade,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  estrellas int not null check (estrellas between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (rutina_id, usuario_id)
);

alter table public.rutina_voto enable row level security;

-- Cada quien ve y gestiona SUS votos; el agregado va por RPC.
drop policy if exists rutina_voto_propio on public.rutina_voto;
create policy rutina_voto_propio on public.rutina_voto
  for all to authenticated
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));

-- Denormalizado para ordenar sin recalcular en cada consulta.
alter table public.rutina_predisenada
  add column if not exists puntuacion_prom numeric(3,2) not null default 0,
  add column if not exists votos int not null default 0,
  add column if not exists veces_adoptada int not null default 0;

-- Solo vota quien ADOPTÓ la rutina: así la nota mide si sirve, no si el título
-- suena bien.
create or replace function public.votar_rutina(p_rutina uuid, p_estrellas int)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  if p_estrellas < 1 or p_estrellas > 5 then
    raise exception 'La puntuación va de 1 a 5';
  end if;
  if not exists (
    select 1 from public.rutina_libre
     where usuario_id = v_uid and origen_predisenada_id = p_rutina
  ) then
    raise exception 'Solo puedes puntuar una rutina que hayas usado';
  end if;

  insert into public.rutina_voto (rutina_id, usuario_id, estrellas)
  values (p_rutina, v_uid, p_estrellas)
  on conflict (rutina_id, usuario_id)
  do update set estrellas = excluded.estrellas, created_at = now();

  update public.rutina_predisenada rp
     set votos = v.n, puntuacion_prom = v.prom
    from (select count(*) n, round(avg(estrellas), 2) prom
          from public.rutina_voto where rutina_id = p_rutina) v
   where rp.id = p_rutina;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.votar_rutina(uuid, int) from public;
grant execute on function public.votar_rutina(uuid, int) to authenticated;

-- Catálogo de comunidad con filtros y orden.
-- El orden 'puntuacion' usa promedio BAYESIANO: sin él, una rutina con un único
-- 5★ encabeza la lista por delante de una con 4.5★ y 200 votos.
create or replace function public.listar_rutinas_comunidad(
  p_orden text default 'puntuacion',
  p_objetivo text default null,
  p_nivel text default null,
  p_dias int default null,
  p_equipo text default null,
  p_buscar text default null
) returns jsonb
language sql
security definer
set search_path to 'public'
stable
as $$
  with params as (
    select 5::numeric as m,
           coalesce((select avg(puntuacion_prom) from public.rutina_predisenada
                      where estado='aprobada' and autor_id is not null and votos > 0), 3.5) as c
  )
  select coalesce(jsonb_agg(t order by
           case when p_orden = 'usadas' then t.veces_adoptada end desc nulls last,
           case when p_orden = 'nuevas' then extract(epoch from t.aprobada_at) end desc nulls last,
           case when p_orden not in ('usadas','nuevas') then t.ranking end desc nulls last
         ), '[]'::jsonb)
  from (
    select rp.id, rp.nombre, rp.descripcion, rp.objetivo, rp.nivel,
           rp.dias_por_semana, rp.equipo, rp.puntuacion_prom, rp.votos,
           rp.veces_adoptada, rp.aprobada_at,
           coalesce(u.nombre_publico, split_part(u.nombre, ' ', 1)) as autor,
           (rp.votos / (rp.votos + p.m)) * rp.puntuacion_prom
             + (p.m / (rp.votos + p.m)) * p.c as ranking
    from public.rutina_predisenada rp
    join public.usuario u on u.id = rp.autor_id
    cross join params p
    where rp.estado = 'aprobada'
      and rp.autor_id is not null
      and (p_objetivo is null or rp.objetivo = p_objetivo)
      and (p_nivel is null or rp.nivel = p_nivel)
      and (p_equipo is null or rp.equipo = p_equipo)
      and (p_dias is null or
           (p_dias = 2 and rp.dias_por_semana <= 2) or
           (p_dias = 4 and rp.dias_por_semana between 3 and 4) or
           (p_dias = 5 and rp.dias_por_semana >= 5))
      and (p_buscar is null or
           rp.nombre ilike '%' || p_buscar || '%' or
           coalesce(rp.descripcion,'') ilike '%' || p_buscar || '%')
  ) t;
$$;

revoke all on function public.listar_rutinas_comunidad(text, text, text, int, text, text) from public;
grant execute on function public.listar_rutinas_comunidad(text, text, text, int, text, text) to authenticated;
```

Además, en `adoptar_rutina_predisenada` hay que **añadir dos cosas**: guardar
`origen_predisenada_id` en la rutina creada e incrementar `veces_adoptada`.
Leer la definición actual y añadir, tras el insert de `rutina_libre`:

```sql
  update public.rutina_libre set origen_predisenada_id = p_rutina
   where id = v_nueva_rutina;
  update public.rutina_predisenada set veces_adoptada = veces_adoptada + 1
   where id = p_rutina;
```

- [ ] **Paso 2: verificar en rollback — varios casos**

```bash
psql "$DBURL" -q <<'SQL'
begin;
\i 'd:/Personal Proyects/ControlGym/supabase/migrations/20260803120000_votos_y_filtros.sql'
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','f0102dc8-0873-44e7-b36d-94b749f8c689','role','authenticated')::text, true);

-- CASO 1: votar SIN haber adoptado debe FALLAR
do $$ begin
  perform public.votar_rutina(
    (select id from public.rutina_predisenada limit 1), 5);
  raise notice 'CASO1 MAL: dejó votar sin adoptar';
exception when others then raise notice 'CASO1 OK: %', sqlerrm;
end $$;

-- CASO 2: adoptar y luego votar debe FUNCIONAR
select public.adoptar_rutina_predisenada(
  (select id from public.rutina_predisenada where estado='aprobada' limit 1));
select public.votar_rutina(
  (select id from public.rutina_predisenada where estado='aprobada' limit 1), 4);
select 'caso2' as t, votos, puntuacion_prom, veces_adoptada
from public.rutina_predisenada where estado='aprobada' limit 1;

-- CASO 3: estrellas fuera de rango debe FALLAR
do $$ begin
  perform public.votar_rutina(
    (select id from public.rutina_predisenada limit 1), 9);
  raise notice 'CASO3 MAL: aceptó 9 estrellas';
exception when others then raise notice 'CASO3 OK: %', sqlerrm;
end $$;

-- CASO 4: los tres órdenes y un filtro devuelven JSON válido
select 'caso4' as t,
  jsonb_typeof(public.listar_rutinas_comunidad('puntuacion')) as o1,
  jsonb_typeof(public.listar_rutinas_comunidad('usadas')) as o2,
  jsonb_typeof(public.listar_rutinas_comunidad('nuevas')) as o3,
  jsonb_typeof(public.listar_rutinas_comunidad('puntuacion','ganar_masa',null,null,'peso_corporal')) as filtrado;

-- CASO 5: las curadas NO salen en el listado de comunidad
select 'caso5: curadas fuera' as t,
  jsonb_array_length(public.listar_rutinas_comunidad('nuevas')) as de_comunidad;
rollback;
SQL
```

Esperado: casos 1 y 3 → "OK" (fallan como deben). caso2 → `votos=1`,
`puntuacion_prom=4.00`, `veces_adoptada=1`. caso4 → `array` en los cuatro.
caso5 → 0 (aún no hay rutinas de comunidad aprobadas; las 5 curadas no cuentan).

- [ ] **Paso 3: aplicar a prod (CHECKPOINT — confirmar antes)**

```bash
psql "$DBURL" -q -v ON_ERROR_STOP=1 -f 'supabase/migrations/20260803120000_votos_y_filtros.sql' \
  && echo "APLICADA OK"
```

- [ ] **Paso 4: verificar firmas, permisos y RLS**

```bash
psql "$DBURL" -c "select p.oid::regprocedure as firma,
  has_function_privilege('authenticated', p.oid,'execute') as auth
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('votar_rutina','listar_rutinas_comunidad')
order by 1;"
psql "$DBURL" -c "select relrowsecurity from pg_class where relname='rutina_voto';"
```

Esperado: una firma por nombre, `auth = t`, y RLS activo (`t`) en `rutina_voto`.

- [ ] **Paso 5: commit**

```bash
git add supabase/migrations/20260803120000_votos_y_filtros.sql
git commit -m "feat(rutinas): puntuación por estrellas y catálogo con filtros"
```

### Task C2: la app muestra comunidad, filtros y estrellas

**Files:**
- Modify: `composeApp/src/commonMain/kotlin/pe/fitcore/app/data/modelos/RutinaPredisenada.kt`
- Modify: `composeApp/src/commonMain/kotlin/pe/fitcore/app/data/repositorio/RutinaPredisenadaRepositorio.kt`
- Create: `composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/FiltrosComunidad.kt`
- Modify: `composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/PantallaRutinaLibre.kt`

**Interfaces:**
- Consumes: `listar_rutinas_comunidad(...)`, `votar_rutina(uuid,int)` (Task C1)
- Produces: sección "DE LA COMUNIDAD" con filtros y estrellas

- [ ] **Paso 1: modelo**

En `RutinaPredisenada.kt`, añadir:

```kotlin
/**
 * Tarjeta de una rutina publicada por la comunidad (RPC
 * `listar_rutinas_comunidad`). Los @SerialName tienen que coincidir EXACTO con
 * el JSON: un desajuste compila, no lanza error y la lista sale vacía.
 */
@Serializable
data class RutinaComunidadCard(
    val id: String,
    val nombre: String,
    val descripcion: String? = null,
    val objetivo: String? = null,
    val nivel: String,
    @SerialName("dias_por_semana") val diasPorSemana: Int,
    val equipo: String,
    val autor: String,
    @SerialName("puntuacion_prom") val puntuacionProm: Double = 0.0,
    val votos: Int = 0,
    @SerialName("veces_adoptada") val vecesAdoptada: Int = 0,
)
```

- [ ] **Paso 2: repositorio**

En `RutinaPredisenadaRepositorio.kt`, al interface:

```kotlin
    /** Catálogo de la comunidad con filtros y orden. */
    suspend fun comunidad(
        orden: String = "puntuacion",
        objetivo: String? = null,
        nivel: String? = null,
        dias: Int? = null,
        equipo: String? = null,
        buscar: String? = null,
    ): Resultado<List<RutinaComunidadCard>>

    /** Puntúa una rutina (solo si la adoptaste). */
    suspend fun votar(rutinaId: String, estrellas: Int): Resultado<Unit>
```

Implementación:

```kotlin
    override suspend fun comunidad(
        orden: String, objetivo: String?, nivel: String?,
        dias: Int?, equipo: String?, buscar: String?,
    ): Resultado<List<RutinaComunidadCard>> =
        resultadoDe("No se pudo cargar la comunidad.") {
            cliente.postgrest.rpc(
                "listar_rutinas_comunidad",
                buildJsonObject {
                    put("p_orden", orden)
                    put("p_objetivo", objetivo)
                    put("p_nivel", nivel)
                    put("p_dias", dias)
                    put("p_equipo", equipo)
                    put("p_buscar", buscar)
                },
            ).decodeAs<List<RutinaComunidadCard>>()
        }

    override suspend fun votar(rutinaId: String, estrellas: Int): Resultado<Unit> =
        resultadoDe("No se pudo guardar tu puntuación.") {
            cliente.postgrest.rpc(
                "votar_rutina",
                buildJsonObject {
                    put("p_rutina", rutinaId)
                    put("p_estrellas", estrellas)
                },
            )
            Unit
        }
```

- [ ] **Paso 3: filtros**

Crear `FiltrosComunidad.kt`:

```kotlin
package pe.fitcore.app.ui.libre

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Cómo se ordena el catálogo. Etiquetas en lenguaje de usuario, no de BD. */
val ORDENES = listOf(
    "puntuacion" to "Mejor puntuadas",
    "usadas" to "Más usadas",
    "nuevas" to "Nuevas",
)

/** Equipo disponible: el filtro más útil — quien entrena en casa no quiere ver
 *  rutinas con máquinas que no tiene. */
val EQUIPOS = listOf(
    "peso_corporal" to "Sin equipo",
    "mancuernas" to "Mancuernas",
    "gym_completo" to "Gimnasio",
)

@Composable
fun FiltrosComunidad(
    orden: String,
    equipo: String?,
    onOrden: (String) -> Unit,
    onEquipo: (String?) -> Unit,
) {
    Row(
        Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ORDENES.forEach { (codigo, etiqueta) ->
            FilterChip(
                selected = orden == codigo,
                onClick = { onOrden(codigo) },
                label = { Text(etiqueta) },
            )
        }
    }
    Row(
        Modifier.horizontalScroll(rememberScrollState()).padding(bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        EQUIPOS.forEach { (codigo, etiqueta) ->
            FilterChip(
                // Volver a tocar el chip activo lo desactiva: sin esto no hay
                // forma de quitar el filtro sin un botón "todos" extra.
                selected = equipo == codigo,
                onClick = { onEquipo(if (equipo == codigo) null else codigo) },
                label = { Text(etiqueta) },
            )
        }
    }
}
```

- [ ] **Paso 4: sección en la pantalla**

En `PantallaRutinaLibre.kt`, tras las curadas:

```kotlin
        // La sección NO se muestra con menos de 5 rutinas: un apartado vacío
        // comunica "esto está muerto", justo cuando la comunidad arranca.
        if (estado.comunidad.size >= 5) {
            Text(
                "DE LA COMUNIDAD",
                style = MaterialTheme.typography.labelMedium,
                color = ColoresFitCore.Atenuado,
                modifier = Modifier.padding(top = 16.dp),
            )
            FiltrosComunidad(
                orden = estado.ordenComunidad,
                equipo = estado.equipoComunidad,
                onOrden = { vm.cambiarOrden(it) },
                onEquipo = { vm.cambiarEquipo(it) },
            )
            estado.comunidad.forEach { r ->
                TarjetaComunidad(rutina = r, onUsar = { vm.adoptar(r.id) })
            }
        }
```

`TarjetaComunidad` muestra: nombre, descripción, `por ${r.autor}`, las etiquetas
(nivel · días · equipo), `★${r.puntuacionProm} (${r.votos})` y el aviso de salud:

```kotlin
                Text(
                    "Creada por un usuario de FitCore, no revisada por un " +
                        "profesional. Consulta a tu médico antes de empezar.",
                    style = MaterialTheme.typography.labelSmall,
                    color = ColoresFitCore.Atenuado,
                )
```

- [ ] **Paso 5: compilar los dos targets**

```bash
./gradlew :composeApp:compileDebugKotlinAndroid --console=plain -q
./gradlew :composeApp:compileKotlinIosArm64 --console=plain -q
```

- [ ] **Paso 6: probar en emulador**

Comprobar: con menos de 5 rutinas la sección NO aparece; los chips de orden y
equipo recargan la lista; adoptar una rutina de comunidad la copia a "Mis
rutinas"; puntuar sin haber adoptado da error claro.

- [ ] **Paso 7: commit**

```bash
git add composeApp/src/commonMain/kotlin/pe/fitcore/app/
git commit -m "feat(rutinas): catálogo de comunidad con filtros y puntuación"
```

---

### Task C3: reportar una rutina y alias público

Cierra los dos puntos del spec que las tareas anteriores dejan sin cubrir:
el botón de reportar y poder editar el `nombre_publico` que se creó en B1.

**Files:**
- Create: `supabase/migrations/20260803130000_reportar_y_alias.sql`
- Modify: `composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/perfil/PantallaPerfilPersonal.kt`

**Interfaces:**
- Consumes: `rutina_predisenada.estado`, `usuario.nombre_publico` (Task B1)
- Produces: `reportar_rutina(uuid,text) → jsonb`

- [ ] **Paso 1: migración**

```sql
create table if not exists public.rutina_reporte (
  id uuid primary key default gen_random_uuid(),
  rutina_id uuid not null references public.rutina_predisenada(id) on delete cascade,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  motivo text not null,
  created_at timestamptz not null default now(),
  unique (rutina_id, usuario_id)
);

alter table public.rutina_reporte enable row level security;

drop policy if exists rutina_reporte_propio on public.rutina_reporte;
create policy rutina_reporte_propio on public.rutina_reporte
  for insert to authenticated
  with check (usuario_id = (select auth.uid()));

-- Reportar existe AUNQUE haya aprobación previa: el owner puede aprobar algo
-- que luego resulte problemático, y hace falta una vía para enterarse.
-- A los 3 reportes la rutina se retira sola y deja de verse hasta revisarla.
create or replace function public.reportar_rutina(p_rutina uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_total int;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  if coalesce(trim(p_motivo),'') = '' then
    raise exception 'Cuéntanos qué está mal con esta rutina';
  end if;

  insert into public.rutina_reporte (rutina_id, usuario_id, motivo)
  values (p_rutina, v_uid, trim(p_motivo))
  on conflict (rutina_id, usuario_id) do nothing;

  select count(*) into v_total from public.rutina_reporte where rutina_id = p_rutina;
  if v_total >= 3 then
    update public.rutina_predisenada set estado = 'retirada'
     where id = p_rutina and estado = 'aprobada';
  end if;

  return jsonb_build_object('ok', true, 'reportes', v_total);
end;
$$;

revoke all on function public.reportar_rutina(uuid, text) from public;
grant execute on function public.reportar_rutina(uuid, text) to authenticated;

-- Alias público. actualizar_mi_perfil ya existe con 7 parámetros; añadir uno
-- con DEFAULT crearía una SOBRECARGA y PostgREST fallaría con "function is not
-- unique". Por eso se hace una RPC aparte, pequeña y sin ambigüedad.
create or replace function public.actualizar_mi_nombre_publico(p_alias text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  update public.usuario
     set nombre_publico = nullif(trim(p_alias), ''), updated_at = now()
   where id = v_uid;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.actualizar_mi_nombre_publico(text) from public;
grant execute on function public.actualizar_mi_nombre_publico(text) to authenticated;
```

- [ ] **Paso 2: verificar en rollback**

```bash
psql "$DBURL" -q <<'SQL'
begin;
\i 'd:/Personal Proyects/ControlGym/supabase/migrations/20260803130000_reportar_y_alias.sql'
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','f0102dc8-0873-44e7-b36d-94b749f8c689','role','authenticated')::text, true);

-- CASO 1: reportar sin motivo debe FALLAR
do $$ begin
  perform public.reportar_rutina((select id from public.rutina_predisenada limit 1), '   ');
  raise notice 'CASO1 MAL: aceptó motivo vacío';
exception when others then raise notice 'CASO1 OK: %', sqlerrm;
end $$;

-- CASO 2: reportar dos veces la misma rutina no duplica
select public.reportar_rutina((select id from public.rutina_predisenada limit 1), 'prueba');
select public.reportar_rutina((select id from public.rutina_predisenada limit 1), 'otra vez');
select 'caso2: sin duplicados' as t, count(*) from public.rutina_reporte;

-- CASO 3: el alias se guarda y vaciarlo lo deja NULL (no cadena vacía)
select public.actualizar_mi_nombre_publico('  CoachJona  ');
select 'caso3a' as t, nombre_publico from public.usuario
 where id='f0102dc8-0873-44e7-b36d-94b749f8c689';
select public.actualizar_mi_nombre_publico('');
select 'caso3b: vacio -> null' as t, nombre_publico is null from public.usuario
 where id='f0102dc8-0873-44e7-b36d-94b749f8c689';
rollback;
SQL
```

Esperado: caso1 → "OK". caso2 → 1 fila. caso3a → `CoachJona` (recortado).
caso3b → `t`.

- [ ] **Paso 3: aplicar a prod (CHECKPOINT — confirmar antes)**

```bash
psql "$DBURL" -q -v ON_ERROR_STOP=1 -f 'supabase/migrations/20260803130000_reportar_y_alias.sql' \
  && echo "APLICADA OK"
```

- [ ] **Paso 4: campo de alias en el perfil de la app**

En `PantallaPerfilPersonal.kt`, dentro del diálogo de editar datos:

```kotlin
                OutlinedTextField(
                    value = alias,
                    onValueChange = { alias = it },
                    label = { Text("Nombre público (opcional)") },
                    supportingText = {
                        Text("Con el que apareces al compartir rutinas. Si lo dejas vacío, se usa tu primer nombre.")
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
```

- [ ] **Paso 5: compilar los dos targets y commit**

```bash
./gradlew :composeApp:compileDebugKotlinAndroid --console=plain -q
./gradlew :composeApp:compileKotlinIosArm64 --console=plain -q
git add supabase/migrations/20260803130000_reportar_y_alias.sql composeApp/src/
git commit -m "feat(rutinas): reportar una rutina y alias público del autor"
```

---

## Publicación

Cada parte se publica por separado siguiendo la skill `lanzar-release` del repo
`controlgym-app`. Recordatorio de lo que más ha fallado:

- Subir el `versionName` en `composeApp/build.gradle.kts` **y** el
  `CFBundleShortVersionString` del `Info.plist`, a la par del tag.
- **Primero la BD, luego la app.** La app nueva llama RPCs que la vieja no usa;
  al revés rompe a quien todavía no actualizó.
- Verificar `app_version` **en la BD**, no en el log del CI.
