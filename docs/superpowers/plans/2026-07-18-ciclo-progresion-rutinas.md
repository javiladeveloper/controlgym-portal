# Ciclo de progresión de rutinas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un ciclo donde el trainer asigna una rutina con vigencia, el socio registra su avance (ejercicios + carga), y antes de vencer el trainer ve el progreso y le asigna la siguiente rutina ajustada.

**Architecture:** Cuatro partes incrementales sobre lo que ya existe. La vigencia y el historial viven en la tabla `rutina` (nuevas columnas nullable, no cortan acceso). La adherencia por ejercicio es una tabla nueva que copia el patrón de `registro_entreno`/`marcar_entreno_libre`. El aviso reusa el `push_worker` y el cron diario. El panel de progreso combina datos que ya existen (`medida_personal`, `checkin`, `registro_entreno`) con los nuevos.

**Tech Stack:** Supabase Postgres (migraciones vía MCP `apply_migration` sobre proyecto `zlmqdubrjzmagslcsqvb`), React + @tanstack/react-query (panel), Playwright (verificación UI). App móvil KMP coordinada por handoff (repo aparte).

## Global Constraints

- **Migraciones**: nombre `snake_case`, archivo en `supabase/migrations/YYYYMMDDHHMMSS_*.sql`, aplicadas vía MCP `apply_migration`. Toda función `security definer` lleva `set search_path = public`.
- **RPC de billing/admin**: `revoke all ... from public, authenticated` explícito y `grant` solo a quien corresponde (default privilege del esquema concede execute a authenticated — ver `supabase-default-privileges-rpc`). Las RPC de socio/staff sí van a `authenticated`.
- **Verificación en BD**: siempre en transacción con `rollback`; simular sesión con `set local role authenticated` + `set local request.jwt.claims`. NO dejar datos de prueba.
- **Aislamiento multi-tenant**: toda lectura del panel filtra por `auth_empresa_id()`; el staff solo ve socios de su sede.
- **Commit trailer**: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Gates**: `npm test` y `npm run build` limpios antes de cada commit de front.
- **Datos de prueba**: socio jonathan.joan.avila en MaximusGym = socio_id `113851ca-f6d6-401a-a070-14e6e47c2559`, empresa `ad7a640f-4a82-4643-a0ed-4f6f1508be29`, sede `77496573-c230-449a-b11e-55cab3e2f6ac`.

## File Structure

- `supabase/migrations/*_rutina_vigencia.sql` — columnas de vigencia/historial en `rutina` (Parte A)
- `supabase/migrations/*_registro_entreno_ejercicio.sql` — tabla + RPC de adherencia por ejercicio (Parte B)
- `supabase/migrations/*_rutinas_por_vencer.sql` — RPC de la sección + encolado de aviso (Parte C)
- `supabase/migrations/*_progreso_socio.sql` — RPC de progreso + sugerencias (Parte D)
- `supabase/migrations/*_plantilla_editable.sql` — RPCs de edición de plantilla del gym (Parte D)
- `src/hooks/useProgresion.js` — hooks nuevos (por vencer, progreso, renovar, editar plantilla)
- `src/pages/Rutinas.jsx` — sección "por vencer", panel de progreso, botón renovar, editor de plantilla
- `docs/APP-BACKEND-REQUESTS.md` — PEDIDO: persistir check por ejercicio + carga
- `tests/progresion.test.js` — tests de la lógica de sugerencias (JS puro)

Cada Parte (A–D) es entregable por separado.

---

## PARTE A — Vigencia de la rutina del socio

### Task A1: Columnas de vigencia e historial en `rutina`

**Files:**
- Create: `supabase/migrations/20260718100000_rutina_vigencia.sql`

**Interfaces:**
- Produces: `rutina.vigencia_inicio date`, `rutina.vigencia_fin date`, `rutina.duracion_semanas int`, `rutina.rutina_anterior_id uuid`, `rutina.objetivo_id uuid`, `rutina.aviso_vencimiento_enviado_at timestamptz` — todas nullable.

- [ ] **Step 1: Escribir la migración**

```sql
-- Vigencia e historial de la rutina del socio. Todo nullable: las rutinas
-- viejas sin vigencia NUNCA aparecen en "por vencer" (el filtro exige
-- vigencia_fin not null). No hay backfill: sería inventar fechas no pactadas.
alter table public.rutina
  add column if not exists vigencia_inicio date,
  add column if not exists vigencia_fin date,
  add column if not exists duracion_semanas int,
  add column if not exists rutina_anterior_id uuid references public.rutina(id) on delete set null,
  add column if not exists objetivo_id uuid references public.objetivo_entrenamiento(id),
  add column if not exists aviso_vencimiento_enviado_at timestamptz;

create index if not exists rutina_vigencia_idx on public.rutina (vigencia_fin)
  where vigencia_fin is not null and activa;
create index if not exists rutina_anterior_idx on public.rutina (rutina_anterior_id)
  where rutina_anterior_id is not null;

comment on column public.rutina.vigencia_fin is
  'Fecha de vencimiento de la rutina. NO corta acceso: la rutina sigue activa y visible; solo aparece en "por vencer" y dispara aviso al trainer.';
```

- [ ] **Step 2: Aplicar vía MCP y verificar las columnas**

Aplicar con `apply_migration` (name: `rutina_vigencia`). Luego:
```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='rutina'
  and column_name in ('vigencia_inicio','vigencia_fin','duracion_semanas','rutina_anterior_id','objetivo_id','aviso_vencimiento_enviado_at');
```
Expected: 6 filas.

- [ ] **Step 3: Verificar que las rutinas viejas quedaron con vigencia null (no rompió nada)**

```sql
select count(*) as rutinas_sin_vigencia from public.rutina where vigencia_fin is null;
```
Expected: todas las existentes (columna recién creada) — confirma que nada se cortó.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260718100000_rutina_vigencia.sql
git commit -m "feat(rutinas): columnas de vigencia e historial en rutina

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task A2: RPC `asignar_rutina_con_vigencia`

**Files:**
- Modify: `supabase/migrations/20260718100000_rutina_vigencia.sql` (agregar al mismo archivo) o nuevo `*_asignar_vigencia.sql`

**Interfaces:**
- Consumes: columnas de A1.
- Produces: `asignar_rutina_con_vigencia(p_rutina_id uuid, p_duracion_semanas int) → jsonb {ok, vigencia_fin}` — fija vigencia a una rutina recién creada, enlaza la rutina activa previa del socio como `rutina_anterior_id` y la desactiva.

- [ ] **Step 1: Escribir la RPC**

```sql
-- Fija vigencia a una rutina y cierra el ciclo con la anterior. La llama el
-- panel al asignar/renovar. security definer + validación explícita de empresa.
create or replace function public.asignar_rutina_con_vigencia(
  p_rutina_id uuid, p_duracion_semanas int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid := auth_empresa_id(); v_socio uuid; v_fin date; v_prev uuid;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  select socio_id into v_socio from public.rutina
   where id = p_rutina_id and empresa_id = v_emp;
  if v_socio is null then raise exception 'rutina no encontrada o sin acceso'; end if;
  if coalesce(p_duracion_semanas,0) < 1 then raise exception 'duración inválida'; end if;

  v_fin := current_date + (p_duracion_semanas * 7);

  -- la rutina activa previa del socio (distinta de esta) se enlaza y desactiva
  select id into v_prev from public.rutina
   where socio_id = v_socio and empresa_id = v_emp and activa and id <> p_rutina_id
   order by created_at desc limit 1;
  if v_prev is not null then
    update public.rutina set activa = false where id = v_prev;
  end if;

  update public.rutina
     set vigencia_inicio = current_date, vigencia_fin = v_fin,
         duracion_semanas = p_duracion_semanas, rutina_anterior_id = v_prev,
         activa = true, aviso_vencimiento_enviado_at = null
   where id = p_rutina_id;

  return jsonb_build_object('ok', true, 'vigencia_fin', v_fin, 'rutina_anterior_id', v_prev);
end $$;
revoke all on function public.asignar_rutina_con_vigencia(uuid,int) from public;
grant execute on function public.asignar_rutina_con_vigencia(uuid,int) to authenticated, service_role;
```

- [ ] **Step 2: Verificar en BD con rollback (una sola rutina activa tras asignar)**

```sql
begin;
-- crear una rutina de prueba para el socio y asignarle vigencia
do $$ declare v_r uuid;
begin
  insert into public.rutina (empresa_id, socio_id, nombre, activa)
  values ('ad7a640f-4a82-4643-a0ed-4f6f1508be29','113851ca-f6d6-401a-a070-14e6e47c2559','TEST vigencia', true)
  returning id into v_r;
  perform set_config('request.jwt.claims', json_build_object('sub',(select ue.usuario_id from public.usuario_empresa ue join public.rol r on r.id=ue.rol_id where ue.empresa_id='ad7a640f-4a82-4643-a0ed-4f6f1508be29' and r.codigo='admin' and ue.activo limit 1),'role','authenticated')::text, true);
  perform public.asignar_rutina_con_vigencia(v_r, 8);
end $$;
select count(*) filter (where activa) as activas,
       max(vigencia_fin) filter (where nombre='TEST vigencia') as fin
from public.rutina where socio_id='113851ca-f6d6-401a-a070-14e6e47c2559';
rollback;
```
Expected: `activas=1` (la nueva desactivó la previa), `fin = hoy+56 días`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/*asignar*.sql
git commit -m "feat(rutinas): asignar_rutina_con_vigencia enlaza y cierra el ciclo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task A3: Panel — elegir duración al asignar/renovar rutina

**Files:**
- Modify: `src/hooks/useRutinas.js` (agregar `useAsignarVigencia`)
- Modify: `src/pages/Rutinas.jsx` (selector de duración donde se asigna/envía la rutina)

**Interfaces:**
- Consumes: `asignar_rutina_con_vigencia` de A2.
- Produces: hook `useAsignarVigencia(socioId)` → mutación `{ rutinaId, semanas }`.

- [ ] **Step 1: Agregar el hook**

```js
// src/hooks/useRutinas.js
export function useAsignarVigencia(socioId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ rutinaId, semanas }) => {
      const { data, error } = await supabase.rpc('asignar_rutina_con_vigencia', {
        p_rutina_id: rutinaId, p_duracion_semanas: semanas })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rutina-socio', socioId] })
      qc.invalidateQueries({ queryKey: ['rutinas-por-vencer'] })
    },
  })
}
```

- [ ] **Step 2: Agregar el selector de duración en el flujo de asignar rutina**

En `Rutinas.jsx`, donde hoy se envía/asigna la rutina (buscar `useEnviarPlan`), agregar un `<select>` de duración (4/8/12/16 semanas, default 8) y al confirmar llamar `useAsignarVigencia`. El texto: "Vigencia del plan: [8 semanas ▾] — al vencer, te avisamos para renovarlo."

- [ ] **Step 3: Build + verificar en navegador**

Run: `npm run build` — Expected: `✓ built`. Luego levantar dev, entrar a un socio en Rutinas, verificar que el selector aparece y que al asignar se guarda la vigencia (revisar en BD que `vigencia_fin` quedó seteada).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useRutinas.js src/pages/Rutinas.jsx
git commit -m "feat(rutinas): elegir vigencia al asignar la rutina del socio

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## PARTE B — Adherencia por ejercicio + carga

### Task B1: Tabla `registro_entreno_ejercicio` + RPC

**Files:**
- Create: `supabase/migrations/20260718110000_registro_entreno_ejercicio.sql`

**Interfaces:**
- Produces: tabla `registro_entreno_ejercicio(id, empresa_id, socio_id, rutina_ejercicio_id, fecha, completado, carga_usada, created_at)`; RPC `marcar_entreno_ejercicio(p_rutina_ejercicio_id uuid, p_fecha date, p_completado boolean, p_carga_usada numeric) → jsonb {ok, completado}`.

- [ ] **Step 1: Escribir la migración (tabla + RLS + RPC), copiando el patrón de registro_entreno**

```sql
-- Adherencia POR EJERCICIO de la rutina asignada, con la carga usada. Copia el
-- patrón de registro_entreno (por día) + marcar_entreno_libre (upsert). La app
-- persiste aquí su check por ejercicio (hoy solo visual) y la carga.
create table if not exists public.registro_entreno_ejercicio (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  socio_id uuid not null references public.socio(id) on delete cascade,
  rutina_ejercicio_id uuid not null references public.rutina_ejercicio(id) on delete cascade,
  fecha date not null,
  completado boolean not null default true,
  carga_usada numeric,
  created_at timestamptz not null default now(),
  unique (socio_id, rutina_ejercicio_id, fecha)
);
create index if not exists ree_socio_fecha_idx on public.registro_entreno_ejercicio (socio_id, fecha);

alter table public.registro_entreno_ejercicio enable row level security;
-- el socio maneja lo suyo
drop policy if exists ree_socio on public.registro_entreno_ejercicio;
create policy ree_socio on public.registro_entreno_ejercicio for all to authenticated
  using (exists (select 1 from public.socio s where s.id = registro_entreno_ejercicio.socio_id and s.usuario_id = auth.uid()))
  with check (exists (select 1 from public.socio s where s.id = registro_entreno_ejercicio.socio_id and s.usuario_id = auth.uid()));
-- el staff lee lo de su empresa
drop policy if exists ree_staff on public.registro_entreno_ejercicio;
create policy ree_staff on public.registro_entreno_ejercicio for select to authenticated
  using (empresa_id = public.auth_empresa_id());

-- RPC: la app la llama al marcar. Valida que el ejercicio es de una rutina del
-- socio autenticado; upsert por (socio, ejercicio, fecha).
create or replace function public.marcar_entreno_ejercicio(
  p_rutina_ejercicio_id uuid, p_fecha date, p_completado boolean, p_carga_usada numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_socio uuid; v_emp uuid; v_completado boolean;
begin
  if v_uid is null then raise exception 'usuario no autenticado'; end if;
  if p_rutina_ejercicio_id is null or p_fecha is null then raise exception 'faltan datos'; end if;

  -- el ejercicio debe ser de una rutina de un socio de este usuario
  select s.id, s.empresa_id into v_socio, v_emp
  from public.rutina_ejercicio re
  join public.rutina_dia rd on rd.id = re.rutina_dia_id
  join public.rutina r on r.id = rd.rutina_id
  join public.socio s on s.id = r.socio_id
  where re.id = p_rutina_ejercicio_id and s.usuario_id = v_uid
  limit 1;
  if v_socio is null then raise exception 'el ejercicio no pertenece a tu rutina'; end if;

  insert into public.registro_entreno_ejercicio
    (empresa_id, socio_id, rutina_ejercicio_id, fecha, completado, carga_usada)
  values (v_emp, v_socio, p_rutina_ejercicio_id, p_fecha, coalesce(p_completado, true), p_carga_usada)
  on conflict (socio_id, rutina_ejercicio_id, fecha)
  do update set completado = excluded.completado, carga_usada = excluded.carga_usada
  returning completado into v_completado;

  return jsonb_build_object('ok', true, 'completado', v_completado);
end $$;
revoke all on function public.marcar_entreno_ejercicio(uuid,date,boolean,numeric) from public;
grant execute on function public.marcar_entreno_ejercicio(uuid,date,boolean,numeric) to authenticated, service_role;
```

- [ ] **Step 2: Aplicar y verificar el upsert idempotente con sesión de socio**

Aplicar con `apply_migration` (name: `registro_entreno_ejercicio`). Luego, con un `rutina_ejercicio_id` real de la rutina de jonathan y su usuario `f0102dc8`:
```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0102dc8-0873-44e7-b36d-94b749f8c689","role":"authenticated"}';
-- tomar un ejercicio real de su rutina activa
with ej as (
  select re.id from public.rutina_ejercicio re
  join public.rutina_dia rd on rd.id=re.rutina_dia_id
  join public.rutina r on r.id=rd.rutina_id
  where r.socio_id='113851ca-f6d6-401a-a070-14e6e47c2559' and r.activa limit 1)
select public.marcar_entreno_ejercicio((select id from ej), current_date, true, 60),
       public.marcar_entreno_ejercicio((select id from ej), current_date, true, 65);  -- 2ª vez = update
select socio_id, carga_usada from public.registro_entreno_ejercicio
where socio_id='113851ca-f6d6-401a-a070-14e6e47c2559';
rollback;
```
Expected: 1 sola fila (upsert), `carga_usada=65` (la 2ª pisó a la 1ª).

- [ ] **Step 3: Verificar aislamiento (otro usuario NO puede marcar el ejercicio ajeno)**

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
-- intentar marcar un ejercicio de la rutina de jonathan con OTRO usuario
select public.marcar_entreno_ejercicio(
  (select re.id from public.rutina_ejercicio re
   join public.rutina_dia rd on rd.id=re.rutina_dia_id join public.rutina r on r.id=rd.rutina_id
   where r.socio_id='113851ca-f6d6-401a-a070-14e6e47c2559' and r.activa limit 1),
  current_date, true, 50);
rollback;
```
Expected: `ERROR: el ejercicio no pertenece a tu rutina`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260718110000_registro_entreno_ejercicio.sql
git commit -m "feat(rutinas): adherencia por ejercicio con carga (tabla + RPC)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task B2: Handoff a la app

**Files:**
- Modify: `docs/APP-BACKEND-REQUESTS.md`

- [ ] **Step 1: Escribir el PEDIDO arriba del archivo**

Agregar (bajo el header, antes del primer pedido) un bloque `## PANEL → APP (fecha): PEDIDO 46 — persistir check por ejercicio + carga` explicando: la tabla/RPC ya está montada (`marcar_entreno_ejercicio(p_rutina_ejercicio_id, p_fecha, p_completado, p_carga_usada)`); la app debe cambiar su `ejerciciosMarcados` de visual a persistido llamando esa RPC, y agregar un campo para que el socio anote la carga al marcar. Incluir el ejemplo de llamada.

- [ ] **Step 2: Commit**

```bash
git add docs/APP-BACKEND-REQUESTS.md
git commit -m "docs(app): PEDIDO 46 — persistir check por ejercicio + carga

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## PARTE C — Sección "por vencer" + aviso

### Task C1: RPC `rutinas_por_vencer`

**Files:**
- Create: `supabase/migrations/20260718120000_rutinas_por_vencer.sql`

**Interfaces:**
- Consumes: columnas de vigencia (A1).
- Produces: `rutinas_por_vencer(p_sede_id uuid) → jsonb` — array de socios con rutina activa que vence en ≤3 días o ya venció.

- [ ] **Step 1: Escribir la RPC**

```sql
-- Socios cuya rutina activa vence en <=3 días o ya venció. Para la sección
-- "por vencer" del panel. Filtra por empresa (aislamiento) y sede.
create or replace function public.rutinas_por_vencer(p_sede_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id();
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'rutina_id', r.id, 'socio_id', s.id, 'socio', s.nombre,
      'rutina', r.nombre, 'vigencia_fin', r.vigencia_fin,
      'dias_restantes', (r.vigencia_fin - current_date),
      'objetivo', coalesce(o.nombre, r.objetivo))
      order by r.vigencia_fin)
    from public.rutina r
    join public.socio s on s.id = r.socio_id
    left join public.objetivo_entrenamiento o on o.id = r.objetivo_id
    where r.empresa_id = v_emp and r.activa
      and r.vigencia_fin is not null
      and r.vigencia_fin <= current_date + 3
      and (p_sede_id is null or s.sede_id = p_sede_id)
      and s.deleted_at is null
  ), '[]'::jsonb);
end $$;
revoke all on function public.rutinas_por_vencer(uuid) from public;
grant execute on function public.rutinas_por_vencer(uuid) to authenticated, service_role;
```

- [ ] **Step 2: Aplicar y verificar (una rutina que vence en 2 días aparece; una a 30 días no)**

```sql
begin;
update public.rutina set vigencia_fin = current_date + 2, activa = true
 where socio_id='113851ca-f6d6-401a-a070-14e6e47c2559' and activa;
set local role authenticated;
set local request.jwt.claims = (select json_build_object('sub',ue.usuario_id,'role','authenticated')::text
  from public.usuario_empresa ue join public.rol r on r.id=ue.rol_id
  where ue.empresa_id='ad7a640f-4a82-4643-a0ed-4f6f1508be29' and r.codigo='admin' and ue.activo limit 1);
select jsonb_array_length(public.rutinas_por_vencer('77496573-c230-449a-b11e-55cab3e2f6ac')) as aparecen;
rollback;
```
Expected: `aparecen >= 1`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260718120000_rutinas_por_vencer.sql
git commit -m "feat(rutinas): RPC rutinas_por_vencer para la sección del panel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task C2: Encolado del aviso en el cron

**Files:**
- Create: `supabase/migrations/20260718121000_aviso_rutina_por_vencer.sql`
- Modify: el worker del cron diario (verificar cuál: `api/facturacion/index.js` o el push_worker) para llamar la RPC de encolado

**Interfaces:**
- Produces: `encolar_avisos_rutina_por_vencer() → jsonb {encolados}` — encola un aviso por rutina que entra en la ventana y aún no fue avisada; marca `aviso_vencimiento_enviado_at`.

- [ ] **Step 1: Escribir la RPC de encolado (idempotente por `aviso_vencimiento_enviado_at`)**

```sql
-- Encola un aviso al entrenador (o admin) por cada rutina que entra en la
-- ventana de 3 días y aún no fue avisada. Idempotente: marca la rutina para
-- no repetir. Reusa el mecanismo de push existente (mismo patrón que los
-- recordatorios de vencimiento de membresía).
create or replace function public.encolar_avisos_rutina_por_vencer()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  for r in
    select ru.id, ru.socio_id, ru.entrenador_id, ru.empresa_id, s.nombre as socio, ru.vigencia_fin
    from public.rutina ru join public.socio s on s.id = ru.socio_id
    where ru.activa and ru.vigencia_fin is not null
      and ru.vigencia_fin <= current_date + 3
      and ru.aviso_vencimiento_enviado_at is null
  loop
    -- encolar push al entrenador asignado (o admin si no hay). push_cola real =
    -- (usuario_id, titulo, cuerpo, data, creado_at, enviado_at) — sin empresa_id.
    insert into public.push_cola (usuario_id, titulo, cuerpo, data)
    select coalesce(r.entrenador_id, (select ue.usuario_id from public.usuario_empresa ue
              join public.rol rr on rr.id=ue.rol_id where ue.empresa_id=r.empresa_id and rr.codigo='admin' and ue.activo limit 1)),
           'Rutina por vencer',
           r.socio || ' — su plan vence el ' || to_char(r.vigencia_fin,'DD/MM') || '. Revisa su progreso y asígnale el siguiente.',
           jsonb_build_object('tipo','rutina_por_vencer','socio_id',r.socio_id,'rutina_id',r.id);
    update public.rutina set aviso_vencimiento_enviado_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('encolados', v_n);
end $$;
revoke all on function public.encolar_avisos_rutina_por_vencer() from public, authenticated;
grant execute on function public.encolar_avisos_rutina_por_vencer() to service_role;
```

> Verificado: la cola es `public.push_cola (usuario_id, titulo, cuerpo, data, creado_at, enviado_at)` — el `push_worker` la vacía y envía. El insert de arriba usa esas columnas reales.

- [ ] **Step 2: Enganchar en el cron diario**

Leer `api/facturacion/index.js` — agregar en el worker diario (`action=cierre-mes` o el default, según cuál corre a diario) una llamada `select public.encolar_avisos_rutina_por_vencer()`. Verificar que ese endpoint ya valida `CRON_SECRET`.

- [ ] **Step 3: Verificar idempotencia (correr 2 veces encola 1 sola vez)**

```sql
begin;
update public.rutina set vigencia_fin = current_date + 2, aviso_vencimiento_enviado_at = null, activa = true
 where socio_id='113851ca-f6d6-401a-a070-14e6e47c2559' and activa;
select public.encolar_avisos_rutina_por_vencer() as vez1;
select public.encolar_avisos_rutina_por_vencer() as vez2;
rollback;
```
Expected: `vez1 = {encolados:1}`, `vez2 = {encolados:0}` (ya avisada).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260718121000_aviso_rutina_por_vencer.sql api/facturacion/index.js
git commit -m "feat(rutinas): aviso al trainer 3 días antes del vencimiento

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task C3: Panel — sección "por vencer"

**Files:**
- Modify: `src/hooks/useProgresion.js` (crear) — `useRutinasPorVencer(sedeId)`
- Modify: `src/pages/Rutinas.jsx` — badge/sección "Por vencer (N)"

**Interfaces:**
- Consumes: `rutinas_por_vencer` de C1.
- Produces: hook `useRutinasPorVencer(sedeId)`.

- [ ] **Step 1: Hook**

```js
// src/hooks/useProgresion.js
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

export function useRutinasPorVencer(sedeId) {
  return useQuery({
    queryKey: ['rutinas-por-vencer', sedeId],
    enabled: !!sedeId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rutinas_por_vencer', { p_sede_id: sedeId })
      if (error) throw error
      return data || []
    },
  })
}
```

- [ ] **Step 2: Sección en Rutinas.jsx**

Agregar, arriba de la lista de socios, un bloque "⏰ Por vencer (N)" que lista los socios de `useRutinasPorVencer`, cada uno con días restantes (rojo si ≤0) y un botón "Ver progreso y renovar" que abre el panel de progreso (Parte D). Si N=0, no se muestra.

- [ ] **Step 3: Build + verificar en navegador**

Run: `npm run build`. Poner una rutina a vencer en 2 días en BD, entrar a Rutinas, confirmar que el socio aparece en "por vencer".

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useProgresion.js src/pages/Rutinas.jsx
git commit -m "feat(rutinas): sección 'por vencer' en el panel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## PARTE D — Progreso, sugerencias, editar plantilla, renovar

### Task D1: RPC `progreso_socio`

**Files:**
- Create: `supabase/migrations/20260718130000_progreso_socio.sql`

**Interfaces:**
- Consumes: `medida_personal`, `checkin`, `registro_entreno`, `registro_entreno_ejercicio` (B1), vigencia (A1).
- Produces: `progreso_socio(p_socio_id uuid) → jsonb {peso:{serie,delta,meta}, asistencia:{dias,semanas}, adherencia_dia:{completados,esperados}, adherencia_ejercicio:[{ejercicio,veces,carga_prom}], periodo:{inicio,fin}}`.

- [ ] **Step 1: Escribir la RPC** (combina las 4 fuentes en el periodo de la rutina activa del socio; filtra por empresa del staff)

Detalle: derivar el periodo de `rutina.vigencia_inicio..vigencia_fin` de la rutina activa; peso = serie de `medida_personal` del usuario del socio en ese rango + comparación con `meta_peso`; asistencia = count de `checkin` entrada; adherencia_dia = `registro_entreno` completados vs días×semanas; adherencia_ejercicio = agregación de `registro_entreno_ejercicio` por ejercicio (veces completado + `avg(carga_usada)`). Validar `empresa_id = auth_empresa_id()`.

- [ ] **Step 2: Verificar con datos reales de jonathan (tiene peso, checkins, rutina)**

```sql
begin;
set local role authenticated;
set local request.jwt.claims = (select json_build_object('sub',ue.usuario_id,'role','authenticated')::text
  from public.usuario_empresa ue join public.rol r on r.id=ue.rol_id
  where ue.empresa_id='ad7a640f-4a82-4643-a0ed-4f6f1508be29' and r.codigo='admin' and ue.activo limit 1);
select public.progreso_socio('113851ca-f6d6-401a-a070-14e6e47c2559');
rollback;
```
Expected: jsonb con las 4 secciones pobladas (o vacías si el socio no tiene datos, sin error).

- [ ] **Step 3: Verificar aislamiento (admin de otro gym no ve el progreso)**

```sql
begin;
set local role authenticated;
set local request.jwt.claims = (select json_build_object('sub',ue.usuario_id,'role','authenticated')::text
  from public.usuario_empresa ue join public.rol r on r.id=ue.rol_id
  join public.empresa e on e.id=ue.empresa_id where e.nombre='Peniel' and r.codigo='admin' and ue.activo limit 1);
select public.progreso_socio('113851ca-f6d6-401a-a070-14e6e47c2559');
rollback;
```
Expected: error o vacío (no es de su empresa).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260718130000_progreso_socio.sql
git commit -m "feat(rutinas): RPC progreso_socio (peso+asistencia+adherencia+carga)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task D2: Sugerencias (lógica JS, testeable)

**Files:**
- Create: `src/lib/sugerenciasRutina.js`
- Create: `tests/progresion.test.js`

**Interfaces:**
- Consumes: el jsonb de `progreso_socio`.
- Produces: `sugerenciasDeProgreso(progreso, objetivoCodigo) → [{tipo, texto}]`.

- [ ] **Step 1: Escribir los tests primero (reglas del spec)**

```js
import { describe, it, expect } from 'vitest'
import { sugerenciasDeProgreso } from '../src/lib/sugerenciasRutina.js'

describe('sugerencias de progreso', () => {
  it('alta adherencia + carga subiendo → sube intensidad', () => {
    const p = { adherencia_dia: { completados: 22, esperados: 24 },
      adherencia_ejercicio: [{ ejercicio:'Press', veces:8, carga_prom:70 }] }
    const s = sugerenciasDeProgreso(p, 'ganar_masa')
    expect(s.some(x => /intensidad|carga|series/i.test(x.texto))).toBe(true)
  })
  it('objetivo bajar peso pero peso estancado → más volumen/cardio', () => {
    const p = { peso: { delta: 0 }, adherencia_dia:{completados:20,esperados:24} }
    const s = sugerenciasDeProgreso(p, 'bajar_peso')
    expect(s.some(x => /cardio|volumen/i.test(x.texto))).toBe(true)
  })
  it('baja asistencia → rutina más corta', () => {
    const p = { asistencia: { dias: 4, semanas: 8 }, adherencia_dia:{completados:4,esperados:24} }
    const s = sugerenciasDeProgreso(p, 'ganar_masa')
    expect(s.some(x => /corta|menos días|reenganch/i.test(x.texto))).toBe(true)
  })
  it('sin datos suficientes → no inventa sugerencias', () => {
    expect(sugerenciasDeProgreso({}, 'ganar_masa')).toEqual([])
  })
})
```

- [ ] **Step 2: Correr los tests — deben fallar** (`npm test` → FAIL: sugerenciasDeProgreso no existe)

- [ ] **Step 3: Implementar `sugerenciasDeProgreso`** con las reglas simples que satisfacen los tests (sin IA — reglas sobre los números). Cada regla devuelve `{tipo, texto}`; vacío si no hay datos suficientes.

- [ ] **Step 4: Correr los tests — deben pasar** (`npm test` → PASS)

- [ ] **Step 5: Commit**

```bash
git add src/lib/sugerenciasRutina.js tests/progresion.test.js
git commit -m "feat(rutinas): sugerencias de ajuste según el progreso (reglas + tests)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task D3: Panel de progreso + renovar

**Files:**
- Modify: `src/hooks/useProgresion.js` — `useProgresoSocio(socioId)`, `useRenovarRutina(socioId)`
- Modify: `src/pages/Rutinas.jsx` — modal/panel de progreso con las sugerencias y el botón "Asignar siguiente rutina"

**Interfaces:**
- Consumes: `progreso_socio` (D1), `sugerenciasDeProgreso` (D2), `asignar_rutina_con_vigencia` (A2), el flujo de generar/copiar plantilla existente.
- Produces: hooks `useProgresoSocio`, y el flujo de renovación que crea la nueva rutina + `asignar_rutina_con_vigencia` enlazando la anterior.

- [ ] **Step 1: Hooks de progreso y renovación** (query de progreso + mutación que genera/copia la nueva rutina y le fija vigencia)

- [ ] **Step 2: Panel de progreso en Rutinas.jsx** — muestra peso (mini-serie), asistencia, adherencia por día y por ejercicio (con carga), y arriba las `sugerenciasDeProgreso`. Botón "Asignar siguiente rutina" que abre el flujo de generar/editar y al guardar enlaza la anterior.

- [ ] **Step 3: Build + verificar en navegador** — abrir el progreso de jonathan (tiene datos), ver que se pinta; renovar y confirmar en BD que la nueva rutina tiene `rutina_anterior_id` a la que venció.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useProgresion.js src/pages/Rutinas.jsx
git commit -m "feat(rutinas): panel de progreso con sugerencias + renovar enlazando historial

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task D4: Editar la plantilla del gym

**Files:**
- Create: `supabase/migrations/20260718140000_plantilla_editable.sql`
- Modify: `src/hooks/useRutinas.js` — hooks de edición de plantilla
- Modify: `src/pages/Rutinas.jsx` (tab plantillas) — botones agregar/quitar/cambiar ejercicio

**Interfaces:**
- Produces: RPCs `plantilla_agregar_ejercicio`, `plantilla_editar_ejercicio`, `plantilla_quitar_ejercicio` sobre `plantilla_rutina_ejercicio` (validando empresa); hooks equivalentes.

- [ ] **Step 1: RPCs de edición de plantilla** (patrón de `useGuardarEjercicio`/`useEliminarEjercicio` pero sobre `plantilla_rutina_ejercicio`, validando `empresa_id = auth_empresa_id()`)

- [ ] **Step 2: Verificar en BD** — agregar/editar/quitar un ejercicio de una plantilla; aislamiento (otro gym no puede tocarla).

- [ ] **Step 3: Hooks + UI en el tab de plantillas** — reusa `BancoEjercicios` para agregar; editar series/reps/descanso inline; quitar.

- [ ] **Step 4: Build + verificar en navegador** — editar una plantilla generada, confirmar que los cambios persisten y que regenerar ya no es la única opción.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260718140000_plantilla_editable.sql src/hooks/useRutinas.js src/pages/Rutinas.jsx
git commit -m "feat(rutinas): editar los ejercicios de una plantilla generada

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Notas de implementación

- **Orden de entrega**: A → B → C → D. Cada una funciona sola: A da vigencia visible; B da adherencia por ejercicio (la app la consume); C da la sección + aviso; D cierra el ciclo con progreso/renovación/edición.
- **Coordinación con la app**: B2 deja el PEDIDO 46. La app persiste el check y la carga cuando pueda; el panel (D) muestra lo que haya (si aún no persiste por ejercicio, `adherencia_ejercicio` viene vacío y las sugerencias usan solo día+peso+asistencia — degradación limpia).
- **Push (C2)**: confirmado — la cola es `public.push_cola (usuario_id, titulo, cuerpo, data, ...)`, que `push_worker` procesa. El aviso encola ahí al entrenador (o admin).
