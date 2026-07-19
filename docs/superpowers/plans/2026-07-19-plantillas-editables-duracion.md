# Plantillas editables + duración heredada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el admin pueda editar cualquier plantilla (rutina y dieta) aunque sea Global — creándose su copia del gym automáticamente — y que la plantilla lleve una duración sugerida que pre-llena la vigencia al asignarla a un socio.

**Architecture:** Copy-on-write: al editar una plantilla Global, una RPC idempotente (`plantilla_personalizar`) copia la plantilla completa al gym y se edita la copia; la global nunca se toca. La duración vive en una columna nueva de `plantilla_rutina`/`plantilla_dieta` y solo *sugiere* — el trainer puede cambiarla al asignar.

**Tech Stack:** Supabase Postgres (migraciones vía MCP `apply_migration`, proyecto `zlmqdubrjzmagslcsqvb`), plpgsql, React + `@tanstack/react-query`, Vitest.

## Global Constraints

- **RPC seguras:** toda RPC nueva debe `revoke all ... from public, authenticated` explícitamente y luego `grant execute ... to authenticated` — en este esquema `revoke from public` NO basta (hay default privilege a `authenticated`).
- **Aislamiento multi-tenant:** toda escritura valida `empresa_id = auth_empresa_id()`. Un gym jamás escribe la plantilla de otro.
- **La plantilla GLOBAL es inmutable:** `empresa_id is null` ⇒ ninguna RPC de escritura la modifica. Editarla siempre pasa por crear la copia del gym.
- **Solo admin** puede personalizar/editar plantillas: usar `auth_is_admin()` (existe, sin argumentos).
- **`duracion_semanas` es nullable:** plantilla sin duración = comportamiento actual. No romper plantillas existentes.
- **La duración SUGIERE, no impone:** al asignar, el trainer siempre puede cambiarla.
- **Valores de duración:** 4 / 8 / 12 / 16 semanas (los mismos que ya usa la vigencia de la rutina del socio), más "sin sugerencia" (null).
- **Sin dependencias nuevas.** Reusar patrones existentes (`usePlantillas.js`, `PlantillaEditor`, `EjercicioFilaPlantilla`, `InputEjercicio`, `useBancoEjercicios`).

---

## Estructura de archivos

- `supabase/migrations/20260719110000_plantilla_duracion.sql` (crear) — columna `duracion_semanas` en `plantilla_rutina` y `plantilla_dieta`.
- `supabase/migrations/20260719111000_plantilla_personalizar.sql` (crear) — RPC `plantilla_personalizar` (copy-on-write, idempotente) + `plantilla_set_duracion`.
- `supabase/migrations/20260719112000_plantilla_comidas.sql` (crear) — RPCs `plantilla_comida_agregar/editar/quitar`.
- `src/hooks/usePlantillas.js` (modificar) — traer `duracion_semanas` y las comidas; hooks de mutación nuevos.
- `src/pages/Rutinas.jsx` (modificar) — botón Editar siempre visible, selector de duración, `PlantillaDietaEditor` nuevo, pre-llenado en "Usar plantilla".

---

## Task 1: Columna `duracion_semanas` en las plantillas

La base de la duración heredada. Nullable para no tocar el comportamiento actual.

**Files:**
- Create: `supabase/migrations/20260719110000_plantilla_duracion.sql`

**Interfaces:**
- Consumes: tablas `plantilla_rutina`, `plantilla_dieta`.
- Produces: columna `duracion_semanas int null` en ambas tablas.

- [ ] **Step 1: Aplicar la migración**

Vía MCP `apply_migration` (project `zlmqdubrjzmagslcsqvb`, name `plantilla_duracion`):

```sql
-- Duración SUGERIDA del ciclo de la plantilla. Al asignarla a un socio pre-llena
-- la vigencia de su rutina (el trainer puede cambiarla). Nullable = sin sugerencia,
-- que es el comportamiento actual de todas las plantillas existentes.
alter table public.plantilla_rutina add column if not exists duracion_semanas int;
alter table public.plantilla_dieta  add column if not exists duracion_semanas int;

comment on column public.plantilla_rutina.duracion_semanas is
  'Duración sugerida en semanas (4/8/12/16). Pre-llena la vigencia al asignar; null = sin sugerencia.';
comment on column public.plantilla_dieta.duracion_semanas is
  'Duración sugerida en semanas (4/8/12/16). Pre-llena la vigencia al asignar; null = sin sugerencia.';
```

- [ ] **Step 2: Verificar que las columnas existen y son nullable**

Vía MCP `execute_sql`:
```sql
select table_name, column_name, is_nullable
from information_schema.columns
where table_schema='public' and column_name='duracion_semanas'
  and table_name in ('plantilla_rutina','plantilla_dieta')
order by table_name;
```
Expected: 2 filas, ambas `is_nullable = YES`.

- [ ] **Step 3: Escribir el archivo de migración a disco**

Guardar el SQL del Step 1 en `supabase/migrations/20260719110000_plantilla_duracion.sql`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260719110000_plantilla_duracion.sql
git commit -m "feat(plantillas): columna duracion_semanas (sugerida) en plantilla rutina y dieta"
```

---

## Task 2: RPC `plantilla_personalizar` (copy-on-write) + `plantilla_set_duracion`

El corazón del diseño: editar una Global crea la copia del gym. Idempotente para que pulsar dos veces no duplique.

**Files:**
- Create: `supabase/migrations/20260719111000_plantilla_personalizar.sql`

**Interfaces:**
- Consumes: `plantilla_rutina`, `plantilla_rutina_dia`, `plantilla_rutina_ejercicio`, `plantilla_dieta`, `plantilla_comida`, `auth_empresa_id()`, `auth_is_admin()`, `duracion_semanas` (Task 1).
- Produces:
  - `plantilla_personalizar(p_plantilla_id uuid, p_tipo text) → uuid` — devuelve el id de la plantilla del gym (nueva o la que ya existía). `p_tipo` ∈ `'rutina'|'dieta'`.
  - `plantilla_set_duracion(p_plantilla_id uuid, p_tipo text, p_semanas int) → void`.

- [ ] **Step 1: Aplicar la migración**

Vía MCP `apply_migration` (name `plantilla_personalizar`):

```sql
-- Copy-on-write de plantillas: editar una plantilla GLOBAL crea la copia del gym
-- y se edita esa. La global (empresa_id is null) es inmutable y compartida por
-- todos los gyms del SaaS. Idempotente: si el gym ya tiene su plantilla para ese
-- objetivo+tipo, la devuelve en vez de duplicar.
create or replace function public.plantilla_personalizar(p_plantilla_id uuid, p_tipo text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_objetivo uuid;
  v_nombre text;
  v_notas text;
  v_suplementos text;
  v_duracion int;
  v_es_global boolean;
  v_nueva uuid;
  v_dia record;
  v_nuevo_dia uuid;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  if not public.auth_is_admin() then raise exception 'Solo el administrador puede personalizar plantillas'; end if;
  if p_tipo not in ('rutina','dieta') then raise exception 'Tipo inválido'; end if;

  if p_tipo = 'rutina' then
    select objetivo_id, nombre, notas, duracion_semanas, (empresa_id is null)
      into v_objetivo, v_nombre, v_notas, v_duracion, v_es_global
    from public.plantilla_rutina
    where id = p_plantilla_id and (empresa_id is null or empresa_id = v_emp);
    if v_objetivo is null then raise exception 'plantilla no encontrada o sin acceso'; end if;

    -- ya es del gym → nada que copiar
    if not v_es_global then return p_plantilla_id; end if;

    -- idempotente: ¿el gym ya tiene la suya para este objetivo?
    select id into v_nueva from public.plantilla_rutina
    where empresa_id = v_emp and objetivo_id = v_objetivo limit 1;
    if v_nueva is not null then return v_nueva; end if;

    insert into public.plantilla_rutina (empresa_id, objetivo_id, nombre, notas, duracion_semanas)
    values (v_emp, v_objetivo, v_nombre, v_notas, v_duracion)
    returning id into v_nueva;

    -- copiar días y sus ejercicios
    for v_dia in
      select id, dia_semana, foco from public.plantilla_rutina_dia
      where plantilla_rutina_id = p_plantilla_id order by dia_semana
    loop
      insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
      values (v_nueva, v_dia.dia_semana, v_dia.foco)
      returning id into v_nuevo_dia;

      insert into public.plantilla_rutina_ejercicio
        (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden, notas)
      select v_nuevo_dia, ejercicio_id, nombre, series, reps, descanso, carga, orden, notas
      from public.plantilla_rutina_ejercicio
      where plantilla_rutina_dia_id = v_dia.id
      order by orden;
    end loop;

    return v_nueva;
  end if;

  -- dieta
  select objetivo_id, nombre, suplementos, duracion_semanas, (empresa_id is null)
    into v_objetivo, v_nombre, v_suplementos, v_duracion, v_es_global
  from public.plantilla_dieta
  where id = p_plantilla_id and (empresa_id is null or empresa_id = v_emp);
  if v_objetivo is null then raise exception 'plantilla no encontrada o sin acceso'; end if;

  if not v_es_global then return p_plantilla_id; end if;

  select id into v_nueva from public.plantilla_dieta
  where empresa_id = v_emp and objetivo_id = v_objetivo limit 1;
  if v_nueva is not null then return v_nueva; end if;

  insert into public.plantilla_dieta (empresa_id, objetivo_id, nombre, suplementos, duracion_semanas)
  values (v_emp, v_objetivo, v_nombre, v_suplementos, v_duracion)
  returning id into v_nueva;

  insert into public.plantilla_comida
    (plantilla_dieta_id, nombre, hora, descripcion, kcal, orden, dia_semana)
  select v_nueva, nombre, hora, descripcion, kcal, orden, dia_semana
  from public.plantilla_comida
  where plantilla_dieta_id = p_plantilla_id
  order by dia_semana nulls first, orden;

  return v_nueva;
end $$;

revoke all on function public.plantilla_personalizar(uuid, text) from public, authenticated;
grant execute on function public.plantilla_personalizar(uuid, text) to authenticated;

-- Fija la duración sugerida. Solo sobre una plantilla DEL GYM (el panel llama
-- antes a plantilla_personalizar si era global).
create or replace function public.plantilla_set_duracion(p_plantilla_id uuid, p_tipo text, p_semanas int)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_n int;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  if not public.auth_is_admin() then raise exception 'Solo el administrador puede cambiar la duración'; end if;
  if p_tipo not in ('rutina','dieta') then raise exception 'Tipo inválido'; end if;
  if p_semanas is not null and p_semanas not in (4,8,12,16) then
    raise exception 'Duración inválida (usa 4, 8, 12 o 16 semanas)';
  end if;

  if p_tipo = 'rutina' then
    update public.plantilla_rutina set duracion_semanas = p_semanas
    where id = p_plantilla_id and empresa_id = v_emp;
  else
    update public.plantilla_dieta set duracion_semanas = p_semanas
    where id = p_plantilla_id and empresa_id = v_emp;
  end if;

  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'plantilla no encontrada o sin acceso (¿es global?)'; end if;
end $$;

revoke all on function public.plantilla_set_duracion(uuid, text, int) from public, authenticated;
grant execute on function public.plantilla_set_duracion(uuid, text, int) to authenticated;
```

- [ ] **Step 2: Verificar la copia completa y la idempotencia (rollback)**

Vía MCP `execute_sql`. Buscar una plantilla global de rutina y un admin real:
```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"9331a716-597d-4847-96dd-b1eed52e0d93","role":"authenticated"}';
-- id de una plantilla GLOBAL de rutina
select public.plantilla_personalizar(
  (select id from public.plantilla_rutina where empresa_id is null limit 1), 'rutina') as copia1;
-- llamarla otra vez con la MISMA global debe devolver la MISMA copia (idempotente)
select public.plantilla_personalizar(
  (select id from public.plantilla_rutina where empresa_id is null limit 1), 'rutina') as copia2;
rollback;
```
Expected: `copia1 = copia2` (mismo uuid). Sin error.

- [ ] **Step 3: Verificar que la copia trae días y ejercicios**

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"9331a716-597d-4847-96dd-b1eed52e0d93","role":"authenticated"}';
with g as (select id from public.plantilla_rutina where empresa_id is null limit 1),
     c as (select public.plantilla_personalizar((select id from g), 'rutina') as id)
select
  (select count(*) from public.plantilla_rutina_dia where plantilla_rutina_id = (select id from g)) as dias_global,
  (select count(*) from public.plantilla_rutina_dia where plantilla_rutina_id = (select id from c)) as dias_copia,
  (select count(*) from public.plantilla_rutina_ejercicio e
     join public.plantilla_rutina_dia d on d.id = e.plantilla_rutina_dia_id
    where d.plantilla_rutina_id = (select id from g)) as ejs_global,
  (select count(*) from public.plantilla_rutina_ejercicio e
     join public.plantilla_rutina_dia d on d.id = e.plantilla_rutina_dia_id
    where d.plantilla_rutina_id = (select id from c)) as ejs_copia;
rollback;
```
Expected: `dias_global = dias_copia` y `ejs_global = ejs_copia` (copia completa).

- [ ] **Step 4: Verificar que la GLOBAL nunca se modifica**

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"9331a716-597d-4847-96dd-b1eed52e0d93","role":"authenticated"}';
-- intentar fijar duración sobre una GLOBAL debe fallar
do $$ begin
  perform public.plantilla_set_duracion(
    (select id from public.plantilla_rutina where empresa_id is null limit 1), 'rutina', 8);
  raise notice 'FALLO: no debió permitir escribir la global';
exception when others then
  raise notice 'OK global protegida: %', sqlerrm;
end $$;
rollback;
```
Expected: notice `OK global protegida: plantilla no encontrada o sin acceso (¿es global?)`.

- [ ] **Step 5: Verificar los grants**

```sql
select routine_name, grantee, privilege_type from information_schema.role_routine_grants
where routine_name in ('plantilla_personalizar','plantilla_set_duracion') order by routine_name, grantee;
```
Expected: `authenticated` con EXECUTE en ambas; NO aparece `PUBLIC`.

- [ ] **Step 6: Escribir el archivo de migración a disco y commit**

Guardar el SQL del Step 1 en `supabase/migrations/20260719111000_plantilla_personalizar.sql`.

```bash
git add supabase/migrations/20260719111000_plantilla_personalizar.sql
git commit -m "feat(plantillas): plantilla_personalizar (copy-on-write) + plantilla_set_duracion"
```

---

## Task 3: RPCs de comidas (para el editor de dieta)

Espejo de las de ejercicio, que ya existen. Sin esto no hay editor de dieta.

**Files:**
- Create: `supabase/migrations/20260719112000_plantilla_comidas.sql`

**Interfaces:**
- Consumes: `plantilla_comida` (columnas: id, plantilla_dieta_id, nombre, hora, descripcion, kcal, orden, dia_semana), `auth_empresa_id()`, `auth_is_admin()`.
- Produces:
  - `plantilla_comida_agregar(p_plantilla_dieta_id uuid, p_nombre text, p_hora text, p_descripcion text, p_kcal int, p_dia_semana int) → uuid`
  - `plantilla_comida_editar(p_comida_id uuid, p_nombre text, p_hora text, p_descripcion text, p_kcal int) → void`
  - `plantilla_comida_quitar(p_comida_id uuid) → void`

- [ ] **Step 1: Confirmar el tipo real de la columna `hora`**

Vía MCP `execute_sql`:
```sql
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='plantilla_comida' and column_name in ('hora','kcal','dia_semana');
```
Anotar los tipos. Si `hora` resulta ser `time` (no `text`), usar `time` en las firmas de las RPCs del Step 2 en lugar de `text`, y castear con `p_hora::time`. El resto del plan no cambia.

- [ ] **Step 2: Aplicar la migración**

Vía MCP `apply_migration` (name `plantilla_comidas`). Ajustar el tipo de `p_hora` según el Step 1:

```sql
-- Edición de comidas de la plantilla de dieta del gym. Espejo de las RPCs de
-- ejercicio. La plantilla global es inmutable: se valida que la dieta destino
-- tenga empresa_id = empresa del llamante (el panel personaliza antes si era global).
create or replace function public.plantilla_comida_agregar(
  p_plantilla_dieta_id uuid, p_nombre text, p_hora text,
  p_descripcion text, p_kcal int, p_dia_semana int)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_ok boolean;
  v_orden int;
  v_id uuid;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  if not public.auth_is_admin() then raise exception 'Solo el administrador'; end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'La comida necesita un nombre'; end if;

  select true into v_ok from public.plantilla_dieta
  where id = p_plantilla_dieta_id and empresa_id = v_emp;
  if not coalesce(v_ok,false) then raise exception 'plantilla no encontrada o sin acceso (¿es global?)'; end if;

  select coalesce(max(orden),0)+1 into v_orden from public.plantilla_comida
  where plantilla_dieta_id = p_plantilla_dieta_id
    and dia_semana is not distinct from p_dia_semana;

  insert into public.plantilla_comida
    (plantilla_dieta_id, nombre, hora, descripcion, kcal, orden, dia_semana)
  values (p_plantilla_dieta_id, trim(p_nombre), p_hora, p_descripcion, p_kcal, v_orden, p_dia_semana)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.plantilla_comida_editar(
  p_comida_id uuid, p_nombre text, p_hora text, p_descripcion text, p_kcal int)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_n int;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  if not public.auth_is_admin() then raise exception 'Solo el administrador'; end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'La comida necesita un nombre'; end if;

  update public.plantilla_comida c
     set nombre = trim(p_nombre), hora = p_hora, descripcion = p_descripcion, kcal = p_kcal
   where c.id = p_comida_id
     and exists (select 1 from public.plantilla_dieta d
                  where d.id = c.plantilla_dieta_id and d.empresa_id = v_emp);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'comida no encontrada o sin acceso (¿es global?)'; end if;
end $$;

create or replace function public.plantilla_comida_quitar(p_comida_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_n int;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  if not public.auth_is_admin() then raise exception 'Solo el administrador'; end if;

  delete from public.plantilla_comida c
   where c.id = p_comida_id
     and exists (select 1 from public.plantilla_dieta d
                  where d.id = c.plantilla_dieta_id and d.empresa_id = v_emp);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'comida no encontrada o sin acceso (¿es global?)'; end if;
end $$;

revoke all on function public.plantilla_comida_agregar(uuid, text, text, text, int, int) from public, authenticated;
revoke all on function public.plantilla_comida_editar(uuid, text, text, text, int) from public, authenticated;
revoke all on function public.plantilla_comida_quitar(uuid) from public, authenticated;
grant execute on function public.plantilla_comida_agregar(uuid, text, text, text, int, int) to authenticated;
grant execute on function public.plantilla_comida_editar(uuid, text, text, text, int) to authenticated;
grant execute on function public.plantilla_comida_quitar(uuid) to authenticated;
```

- [ ] **Step 3: Verificar agregar/editar/quitar sobre una dieta DEL GYM (rollback)**

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"9331a716-597d-4847-96dd-b1eed52e0d93","role":"authenticated"}';
-- personalizar una dieta global para tener una del gym
with c as (select public.plantilla_personalizar(
  (select id from public.plantilla_dieta where empresa_id is null limit 1), 'dieta') as id)
select public.plantilla_comida_agregar((select id from c), 'Desayuno test', '08:00', 'Avena', 400, 1) as nueva;
rollback;
```
Expected: devuelve un uuid, sin error.

- [ ] **Step 4: Verificar que NO se puede tocar la comida de una plantilla global**

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"9331a716-597d-4847-96dd-b1eed52e0d93","role":"authenticated"}';
do $$ begin
  perform public.plantilla_comida_agregar(
    (select id from public.plantilla_dieta where empresa_id is null limit 1),
    'Hack', '08:00', 'x', 100, 1);
  raise notice 'FALLO: no debió permitir escribir la global';
exception when others then
  raise notice 'OK global protegida: %', sqlerrm;
end $$;
rollback;
```
Expected: notice `OK global protegida: plantilla no encontrada o sin acceso (¿es global?)`.

- [ ] **Step 5: Escribir el archivo de migración a disco y commit**

Guardar el SQL del Step 2 (con el tipo de `hora` ya ajustado) en `supabase/migrations/20260719112000_plantilla_comidas.sql`.

```bash
git add supabase/migrations/20260719112000_plantilla_comidas.sql
git commit -m "feat(plantillas): RPCs de comidas para editar la plantilla de dieta"
```

---

## Task 4: Hooks — traer duración/comidas y exponer las mutaciones

Conecta el backend nuevo con el panel.

**Files:**
- Modify: `src/hooks/usePlantillas.js`

**Interfaces:**
- Consumes: `plantilla_personalizar`, `plantilla_set_duracion` (Task 2); `plantilla_comida_*` (Task 3); columna `duracion_semanas` (Task 1).
- Produces (todos exportados de `src/hooks/usePlantillas.js`):
  - `usePlantillasRutina(empresaId)` — ahora incluye `duracion_semanas` en cada fila.
  - `usePlantillasDieta(empresaId)` — ahora incluye `duracion_semanas` y `comidas:[{id,nombre,hora,descripcion,kcal,orden,dia_semana}]`.
  - `usePersonalizarPlantilla(empresaId)` → `mutate({ plantillaId, tipo })`, resuelve al uuid de la plantilla del gym.
  - `useSetDuracionPlantilla(empresaId)` → `mutate({ plantillaId, tipo, semanas })`.
  - `useComidaAgregar(empresaId)` → `mutate({ plantillaDietaId, nombre, hora, descripcion, kcal, diaSemana })`.
  - `useComidaEditar(empresaId)` → `mutate({ id, nombre, hora, descripcion, kcal })`.
  - `useComidaQuitar(empresaId)` → `mutate(id)`.

- [ ] **Step 1: Añadir `duracion_semanas` y comidas a los selects**

En `src/hooks/usePlantillasRutina`, cambiar el `.select(...)` para incluir `duracion_semanas`:

```javascript
        .select(`id, empresa_id, objetivo_id, nombre, notas, duracion_semanas, objetivo:objetivo_entrenamiento(codigo, nombre),
          dias:plantilla_rutina_dia(id, dia_semana, foco,
            ejercicios:plantilla_rutina_ejercicio(id, nombre, series, reps, descanso, carga, orden, notas))`)
```

En `usePlantillasDieta`, incluir `duracion_semanas` y las comidas, y ordenarlas igual que se ordenan los días/ejercicios de rutina:

```javascript
export function usePlantillasDieta(empresaId) {
  return useQuery({
    queryKey: ['plantillas-dieta', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plantilla_dieta')
        .select(`id, empresa_id, objetivo_id, nombre, suplementos, duracion_semanas,
          objetivo:objetivo_entrenamiento(codigo, nombre),
          comidas:plantilla_comida(id, nombre, hora, descripcion, kcal, orden, dia_semana)`)
        .order('nombre')
      if (error) throw error
      data?.forEach((d) => {
        d.comidas?.sort((a, b) =>
          (a.dia_semana ?? 0) - (b.dia_semana ?? 0) || (a.orden ?? 0) - (b.orden ?? 0))
      })
      return data
    },
  })
}
```

- [ ] **Step 2: Agregar los hooks de mutación**

Al inicio del archivo cambiar el import para incluir mutaciones:

```javascript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
```

Y agregar al final de `src/hooks/usePlantillas.js`:

```javascript
// Invalida ambas listas de plantillas tras una escritura.
function invalidarPlantillas(qc, empresaId) {
  qc.invalidateQueries({ queryKey: ['plantillas-rutina', empresaId] })
  qc.invalidateQueries({ queryKey: ['plantillas-dieta', empresaId] })
}

// Copy-on-write: devuelve el id de la plantilla DEL GYM. Si la que se pasa es
// global, la copia; si ya era del gym, devuelve la misma. Idempotente.
export function usePersonalizarPlantilla(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ plantillaId, tipo }) => {
      const { data, error } = await supabase.rpc('plantilla_personalizar', {
        p_plantilla_id: plantillaId, p_tipo: tipo })
      if (error) throw error
      return data // uuid de la plantilla del gym
    },
    onSuccess: () => invalidarPlantillas(qc, empresaId),
  })
}

// Duración sugerida de la plantilla (4/8/12/16 o null). Solo sobre plantilla del gym.
export function useSetDuracionPlantilla(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ plantillaId, tipo, semanas }) => {
      const { error } = await supabase.rpc('plantilla_set_duracion', {
        p_plantilla_id: plantillaId, p_tipo: tipo, p_semanas: semanas })
      if (error) throw error
    },
    onSuccess: () => invalidarPlantillas(qc, empresaId),
  })
}

export function useComidaAgregar(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ plantillaDietaId, nombre, hora, descripcion, kcal, diaSemana }) => {
      const { error } = await supabase.rpc('plantilla_comida_agregar', {
        p_plantilla_dieta_id: plantillaDietaId, p_nombre: nombre, p_hora: hora || null,
        p_descripcion: descripcion || null, p_kcal: kcal ?? null, p_dia_semana: diaSemana ?? null })
      if (error) throw error
    },
    onSuccess: () => invalidarPlantillas(qc, empresaId),
  })
}

export function useComidaEditar(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, nombre, hora, descripcion, kcal }) => {
      const { error } = await supabase.rpc('plantilla_comida_editar', {
        p_comida_id: id, p_nombre: nombre, p_hora: hora || null,
        p_descripcion: descripcion || null, p_kcal: kcal ?? null })
      if (error) throw error
    },
    onSuccess: () => invalidarPlantillas(qc, empresaId),
  })
}

export function useComidaQuitar(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.rpc('plantilla_comida_quitar', { p_comida_id: id })
      if (error) throw error
    },
    onSuccess: () => invalidarPlantillas(qc, empresaId),
  })
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npm run build`
Expected: build limpio, sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePlantillas.js
git commit -m "feat(plantillas): hooks de personalizar, duracion y comidas"
```

---

## Task 5: Panel — botón Editar siempre visible + selector de duración

El arreglo que el owner pidió: hoy el botón solo sale en plantillas ya personalizadas, por eso no se ve nada cuando todas son Globales.

**Files:**
- Modify: `src/pages/Rutinas.jsx` (bloque de la pestaña Plantillas, ~líneas 1240-1290, y `PlantillaEditor` ~1296)

**Interfaces:**
- Consumes: `usePersonalizarPlantilla`, `useSetDuracionPlantilla` (Task 4).
- Produces: el editor de rutina abre también sobre plantillas Globales (personalizándolas primero) y permite fijar la duración.

- [ ] **Step 1: Importar los hooks nuevos**

En los imports de `src/pages/Rutinas.jsx`, añadir a la línea que ya importa de `usePlantillas.js`:

```javascript
import { useObjetivos, usePlantillasRutina, usePlantillasDieta,
  usePersonalizarPlantilla, useSetDuracionPlantilla } from '../hooks/usePlantillas.js'
```
(Conservar los nombres que ya estuvieran importados en esa línea; solo agregar los dos nuevos.)

- [ ] **Step 2: Hacer el botón "Editar" visible siempre (rutina)**

En el bloque de la rutina (donde hoy está `{rGym && (<button ...>✎ Editar ejercicios</button>)}`), reemplazar por un botón que funcione con global o propia. Dentro del componente de la pestaña Plantillas, agregar el hook y el handler:

```javascript
  const personalizar = usePersonalizarPlantilla(empresaId)

  // Abre el editor de una plantilla: si es global, primero crea la copia del gym.
  const abrirEditor = (plantilla, tipo) => {
    if (plantilla.empresa_id) { setEditando(editando === plantilla.id ? null : plantilla.id); return }
    personalizar.mutate({ plantillaId: plantilla.id, tipo }, {
      onSuccess: (nuevoId) => setEditando(nuevoId),
      onError: (e) => toast.error(e.message),
    })
  }
```

Y el JSX del botón de rutina (reemplaza el bloque `{rGym && (...)}`):

```jsx
                          <button onClick={() => abrirEditor(rutinaUsada, 'rutina')}
                            disabled={personalizar.isPending}
                            className="cursor-pointer rounded-[7px] border border-orange bg-transparent px-2 py-1 text-[10.5px] font-extrabold text-orange hover:bg-orange-50 disabled:opacity-50">
                            {editando === rutinaUsada.id ? '✕ Cerrar' : '✎ Editar'}
                          </button>
```

- [ ] **Step 3: Renderizar el editor sobre la plantilla del gym**

Reemplazar el bloque `{rGym && editando === rGym.id && (<PlantillaEditor .../>)}` por uno que use la plantilla efectiva del gym (que tras personalizar ya existe en la lista):

```jsx
                {rGym && editando === rGym.id && (
                  <PlantillaEditor plantilla={rGym} empresaId={empresaId} tipo="rutina" />
                )}
```
(Tras `personalizar`, la query se invalida y `rGym` pasa a existir con ese id, así que el editor se abre solo.)

- [ ] **Step 4: Agregar el selector de duración dentro de `PlantillaEditor`**

En `PlantillaEditor`, aceptar `tipo` y añadir el selector arriba de las pestañas de días:

```javascript
function PlantillaEditor({ plantilla, empresaId, tipo = 'rutina' }) {
  const [diaId, setDiaId] = useState(plantilla.dias?.[0]?.id ?? null)
  const [catalogoOpen, setCatalogoOpen] = useState(false)
  const [nuevoEj, setNuevoEj] = useState('')
  const banco = useBancoEjercicios(empresaId)
  const agregar = usePlantillaAgregarEj(empresaId)
  const editar = usePlantillaEditarEj(empresaId)
  const quitar = usePlantillaQuitarEj(empresaId)
  const setDuracion = useSetDuracionPlantilla(empresaId)
```

Y el JSX del selector, como primer hijo del `<div className="mt-2.5 rounded-xl border border-line bg-white p-[13px]">`:

```jsx
      <label className="mb-2.5 flex flex-wrap items-center gap-2 border-b border-line2 pb-2.5 text-[12px] font-bold text-muted">
        ⏳ Duración sugerida del plan:
        <select
          value={plantilla.duracion_semanas ?? ''}
          onChange={(e) => setDuracion.mutate({
            plantillaId: plantilla.id, tipo,
            semanas: e.target.value === '' ? null : Number(e.target.value),
          }, { onError: (er) => toast.error(er.message) })}
          className="rounded-[7px] border border-line bg-white px-2 py-1 text-[12px] font-extrabold text-ink outline-none focus:border-orange">
          <option value="">Sin sugerencia</option>
          {[4, 8, 12, 16].map((n) => <option key={n} value={n}>{n} semanas</option>)}
        </select>
        <span className="text-[11px] font-semibold text-faint">
          Se usará al asignar esta plantilla a un socio (el trainer puede cambiarla).
        </span>
      </label>
```

- [ ] **Step 5: Verificar build y tests**

Run: `npm run build && npm test`
Expected: build limpio; tests siguen pasando (83+).

- [ ] **Step 6: Verificar en el navegador (Playwright)**

Levantar `npm run dev`, entrar como admin de MaximusGym, ir a **Rutinas y dietas → Plantillas**. Confirmar:
- El botón "✎ Editar" aparece en las plantillas **Global**.
- Al pulsarlo, el badge cambia a "Personalizada (tu gym)" y se abre el editor.
- El selector de duración aparece y al elegir "8 semanas" persiste tras refrescar.
- 0 errores de consola. Tomar screenshot.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Rutinas.jsx
git commit -m "feat(plantillas): editar plantillas globales (copy-on-write) + duracion sugerida"
```

---

## Task 6: Editor de plantilla de DIETA

Lo que falta para cumplir "rutinas y dietas". Espejo del de rutina, con comidas.

**Files:**
- Modify: `src/pages/Rutinas.jsx` (nuevo componente `PlantillaDietaEditor` + botón en el bloque de dieta)

**Interfaces:**
- Consumes: `useComidaAgregar`, `useComidaEditar`, `useComidaQuitar`, `useSetDuracionPlantilla`, `usePersonalizarPlantilla` (Task 4).
- Produces: `PlantillaDietaEditor({ plantilla, empresaId })`.

- [ ] **Step 1: Importar los hooks de comidas**

Añadir a la línea de import de `usePlantillas.js` en `src/pages/Rutinas.jsx`:

```javascript
import { useObjetivos, usePlantillasRutina, usePlantillasDieta,
  usePersonalizarPlantilla, useSetDuracionPlantilla,
  useComidaAgregar, useComidaEditar, useComidaQuitar } from '../hooks/usePlantillas.js'
```

- [ ] **Step 2: Botón "✎ Editar" en el bloque de dieta**

En el bloque de dieta (donde hoy solo se muestra el nombre y el badge), agregar el botón tras el `<Badge>`:

```jsx
                          <button onClick={() => abrirEditor(dietaUsada, 'dieta')}
                            disabled={personalizar.isPending}
                            className="cursor-pointer rounded-[7px] border border-orange bg-transparent px-2 py-1 text-[10.5px] font-extrabold text-orange hover:bg-orange-50 disabled:opacity-50">
                            {editando === dietaUsada.id ? '✕ Cerrar' : '✎ Editar'}
                          </button>
```

Y renderizar el editor tras el bloque de rutina:

```jsx
                {dGym && editando === dGym.id && (
                  <PlantillaDietaEditor plantilla={dGym} empresaId={empresaId} />
                )}
```

- [ ] **Step 3: Crear el componente `PlantillaDietaEditor`**

Agregar en `src/pages/Rutinas.jsx`, junto a `PlantillaEditor`:

```jsx
// Editor de comidas de la plantilla de DIETA del gym: pestañas por día (o "Todos
// los días" cuando dia_semana es null) + filas editables con nombre, hora, kcal y
// descripción. Espejo de PlantillaEditor para que se sienta igual.
function PlantillaDietaEditor({ plantilla, empresaId }) {
  const comidas = plantilla.comidas || []
  const diasConComida = [...new Set(comidas.map((c) => c.dia_semana ?? 0))].sort((a, b) => a - b)
  const dias = diasConComida.length ? diasConComida : [0]
  const [dia, setDia] = useState(dias[0])
  const [nueva, setNueva] = useState('')

  const agregar = useComidaAgregar(empresaId)
  const editar = useComidaEditar(empresaId)
  const quitar = useComidaQuitar(empresaId)
  const setDuracion = useSetDuracionPlantilla(empresaId)

  const delDia = comidas.filter((c) => (c.dia_semana ?? 0) === dia)
  const label = (n) => (n === 0 ? 'Todos los días' : ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'][n])

  const agregarComida = (nombre) => {
    agregar.mutate(
      { plantillaDietaId: plantilla.id, nombre, hora: null, descripcion: null, kcal: null,
        diaSemana: dia === 0 ? null : dia },
      { onError: (er) => toast.error(er.message) },
    )
  }

  return (
    <div className="mt-2.5 rounded-xl border border-line bg-white p-[13px]">
      <label className="mb-2.5 flex flex-wrap items-center gap-2 border-b border-line2 pb-2.5 text-[12px] font-bold text-muted">
        ⏳ Duración sugerida del plan:
        <select
          value={plantilla.duracion_semanas ?? ''}
          onChange={(e) => setDuracion.mutate({
            plantillaId: plantilla.id, tipo: 'dieta',
            semanas: e.target.value === '' ? null : Number(e.target.value),
          }, { onError: (er) => toast.error(er.message) })}
          className="rounded-[7px] border border-line bg-white px-2 py-1 text-[12px] font-extrabold text-ink outline-none focus:border-orange">
          <option value="">Sin sugerencia</option>
          {[4, 8, 12, 16].map((n) => <option key={n} value={n}>{n} semanas</option>)}
        </select>
      </label>

      <div className="flex flex-wrap gap-1.5">
        {dias.map((d) => (
          <button key={d} onClick={() => setDia(d)}
            className={`cursor-pointer rounded-[7px] border-none px-2.5 py-1 text-[11px] font-extrabold transition-colors ${dia === d ? 'bg-orange text-white' : 'bg-surface text-muted hover:text-orange'}`}>
            {label(d)}
          </button>
        ))}
      </div>

      <div className="mt-3 border-t border-line2 pt-2.5">
        <div className="mb-1 text-[10.5px] font-bold text-faint">nombre · hora · kcal · descripción — se guarda al salir del campo</div>
        {delDia.map((c) => (
          <ComidaFilaPlantilla key={c.id} comida={c}
            onGuardar={(v) => editar.mutate(
              { id: c.id, nombre: v.nombre, hora: v.hora, descripcion: v.descripcion, kcal: v.kcal },
              { onError: (er) => toast.error(er.message) },
            )}
            onEliminar={() => quitar.mutate(c.id, { onError: (er) => toast.error(er.message) })} />
        ))}
        {delDia.length === 0 && (
          <div className="py-2 text-[12px] font-semibold text-faint">Sin comidas aún — agrega la primera:</div>
        )}
        <div className="mt-2 flex gap-2 border-t border-line2 pt-2.5">
          <input value={nueva} onChange={(e) => setNueva(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && nueva.trim()) { agregarComida(nueva.trim()); setNueva('') } }}
            placeholder="Nueva comida (ej. Desayuno) y Enter…"
            className="flex-1 rounded-[9px] border border-dashed border-line bg-[#FAFBFC] px-3 py-2 text-[12.5px] font-bold outline-none focus:border-orange" />
          <button onClick={() => { if (nueva.trim()) { agregarComida(nueva.trim()); setNueva('') } }}
            className="cursor-pointer rounded-[9px] border-none bg-orange px-4 py-2 text-[12px] font-extrabold text-white hover:bg-orange-600">
            + Agregar
          </button>
        </div>
      </div>
    </div>
  )
}

// Fila editable de una comida de plantilla. Guarda al salir del campo (onBlur),
// mismo patrón que EjercicioFilaPlantilla.
function ComidaFilaPlantilla({ comida, onGuardar, onEliminar }) {
  const [nombre, setNombre] = useState(comida.nombre || '')
  const [hora, setHora] = useState(comida.hora || '')
  const [kcal, setKcal] = useState(comida.kcal ?? '')
  const [descripcion, setDescripcion] = useState(comida.descripcion || '')

  const guardar = () => {
    if (!nombre.trim()) { setNombre(comida.nombre || ''); return }
    onGuardar({
      nombre: nombre.trim(), hora: hora || null,
      descripcion: descripcion || null, kcal: kcal === '' ? null : Number(kcal),
    })
  }

  const input = 'rounded-[7px] border border-line bg-white px-2 py-1 text-[12px] font-bold outline-none focus:border-orange'

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-line2 py-1.5 first:border-0">
      <input value={nombre} onChange={(e) => setNombre(e.target.value)} onBlur={guardar}
        className={`${input} min-w-[130px] flex-1`} placeholder="Comida" />
      <input value={hora} onChange={(e) => setHora(e.target.value)} onBlur={guardar}
        className={`${input} w-[74px]`} placeholder="08:00" />
      <input value={kcal} onChange={(e) => setKcal(e.target.value)} onBlur={guardar}
        className={`${input} w-[70px]`} placeholder="kcal" inputMode="numeric" />
      <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} onBlur={guardar}
        className={`${input} min-w-[150px] flex-[2]`} placeholder="Descripción" />
      <button onClick={onEliminar} title="Quitar"
        className="cursor-pointer rounded-[7px] border-none bg-transparent px-2 py-1 text-[13px] text-faint hover:text-red-600">
        ✕
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Verificar build y tests**

Run: `npm run build && npm test`
Expected: build limpio; tests pasando.

- [ ] **Step 5: Verificar en el navegador (Playwright)**

En **Plantillas**, pulsar "✎ Editar" en la **Dieta** de un objetivo Global. Confirmar:
- Se crea la copia del gym (badge cambia) y abre el editor de comidas.
- Agregar una comida ("Desayuno"), editarle hora/kcal/descripción, y quitarla.
- El selector de duración funciona.
- 0 errores de consola. Screenshot.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Rutinas.jsx
git commit -m "feat(plantillas): editor de plantilla de dieta (comidas por dia)"
```

---

## Task 7: "Usar plantilla" pre-llena la vigencia con la duración de la plantilla

Cierra el ciclo: la duración de la plantilla efectivamente se hereda al socio.

**Files:**
- Modify: `src/pages/Rutinas.jsx` (modal "⚡ Usar plantilla", ~línea 634, y el selector de vigencia ~línea 800s)

**Interfaces:**
- Consumes: `duracion_semanas` de `usePlantillasRutina` (Task 4).
- Produces: el estado `semanasVigencia` arranca con la duración de la plantilla del objetivo del socio.

- [ ] **Step 1: Localizar el estado de vigencia y el modal**

Run: `grep -n "semanasVigencia\|Usar plantilla\|AsignarPlantillaModal" src/pages/Rutinas.jsx`
Leer esas zonas para ubicar dónde se inicializa `semanasVigencia` y dónde el modal conoce el objetivo del socio.

- [ ] **Step 2: Pre-llenar la vigencia con la duración de la plantilla**

En el componente que tiene `semanasVigencia` (el de la rutina del socio), derivar el valor inicial de la plantilla del objetivo del socio. Agregar junto a los otros hooks:

```javascript
  const plantillasRutina = usePlantillasRutina(empresaId)
  // Duración sugerida por la plantilla del objetivo del socio (prioriza la del gym
  // sobre la global). Solo SUGIERE: el trainer puede cambiar el selector.
  const duracionSugerida = (() => {
    const lista = plantillasRutina.data || []
    const delGym = lista.find((p) => p.objetivo_id === objetivoId && p.empresa_id)
    const global = lista.find((p) => p.objetivo_id === objetivoId && !p.empresa_id)
    return (delGym || global)?.duracion_semanas ?? null
  })()
```

Donde `objetivoId` es el id del objetivo del socio (ya disponible en ese componente como `objetivoCodigo`/objetivo; si solo hay el código, buscar el objetivo por código con `useObjetivos()` y mapear a id).

Y aplicar la sugerencia cuando llegue, sin pisar lo que el trainer ya eligió a mano:

```javascript
  const [semanasVigencia, setSemanasVigencia] = useState(8)
  const [vigenciaTocada, setVigenciaTocada] = useState(false)
  useEffect(() => {
    if (!vigenciaTocada && duracionSugerida) setSemanasVigencia(duracionSugerida)
  }, [duracionSugerida, vigenciaTocada])
```

Y en el `onChange` del selector de vigencia existente, marcar que el trainer lo tocó:

```jsx
          onChange={(e) => { setVigenciaTocada(true); setSemanasVigencia(Number(e.target.value)) }}
```

- [ ] **Step 3: Verificar build y tests**

Run: `npm run build && npm test`
Expected: build limpio; tests pasando.

- [ ] **Step 4: Verificar el ciclo completo (Playwright)**

1. En **Plantillas**, poner duración **12 semanas** a la plantilla de rutina de un objetivo (ej. "Ganar masa muscular").
2. Ir a **Por socio**, elegir un socio con ese objetivo.
3. Confirmar que el selector "Vigencia del plan" muestra **12 semanas** por defecto.
4. Cambiarlo a 4 y confirmar que respeta la elección manual.
5. 0 errores de consola. Screenshot.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Rutinas.jsx
git commit -m "feat(plantillas): la duracion de la plantilla pre-llena la vigencia al asignar"
```

---

## Notas de verificación final (para el whole-branch review)

- La plantilla **global nunca se modifica**: probado que `plantilla_set_duracion` y `plantilla_comida_*` la rechazan.
- `plantilla_personalizar` es **idempotente** (dos llamadas → mismo uuid) y copia días+ejercicios / comidas completos.
- Solo **admin** puede personalizar/editar (`auth_is_admin()`), y solo dentro de su empresa.
- La duración **sugiere pero no impone**: el trainer puede cambiarla al asignar.
- `duracion_semanas` es nullable: las plantillas existentes siguen funcionando igual.
- Grants: todas las RPCs nuevas revocadas a `public, authenticated` y regranteadas a `authenticated`.
