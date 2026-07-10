# Plan Automático por Objetivo e IMC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al inscribir un socio, asignarle automáticamente rutina + dieta según su objetivo e IMC, con plantillas semilla editables desde el panel.

**Architecture:** Catálogo de objetivos + tablas `plantilla_*` (globales, sin empresa) con semilla de contenido real. Una RPC `asignar_plan_automatico` copia la plantilla del objetivo al socio y modula las kcal de la dieta por categoría IMC (OMS). `inscribir_socio` la llama. El panel gana una pestaña "Plantillas" en Rutinas.

**Tech Stack:** Supabase Postgres (migraciones vía psql), React + Vite (panel), React Query.

## Global Constraints

- Migraciones con prefijo de fecha `20260706NNNNNN` (siguiente correlativo tras `…028`).
- Conexión psql: `PGPASSWORD='jonimon321jojo' PGCLIENTENCODING=UTF8 psql "host=db.zlmqdubrjzmagslcsqvb.supabase.co port=5432 dbname=postgres user=postgres sslmode=require" -f <archivo>`. Tildes/emojis SOLO vía archivo UTF-8, nunca `-c` inline.
- RLS: tablas de negocio con `empresa_id`. Las `plantilla_*` globales NO llevan `empresa_id` obligatorio (nullable: null=global, set=gym).
- Clasificación IMC (OMS): <18.5 bajo peso · 18.5–25 normal · 25–30 sobrepeso · 30–35 obesidad I · 35–40 obesidad II · ≥40 obesidad III.
- Cada plan generado lleva la nota: "Plan sugerido según tu objetivo e IMC. Consulta a tu entrenador; no reemplaza indicación médica."
- Verificación E2E: cada migración se aplica y se prueba con un bloque `DO`/`select` en psql (patrón "N/N verde"); limpiar datos de prueba al final.
- El panel: build con `npm run build` debe pasar sin errores tras cada cambio de UI.
- MaximusGym para pruebas: empresa `ad7a640f-4a82-4643-a0ed-4f6f1508be29`, sede `77496573-c230-449a-b11e-55cab3e2f6ac`.

---

### Task 1: Catálogo de objetivos + columna en socio

**Files:**
- Create: `supabase/migrations/20260706000029_catalogo_objetivos.sql`

**Interfaces:**
- Produces: tabla `objetivo_entrenamiento(id uuid, codigo text unique, nombre text, enfoque text, orden int, tiene_plan boolean)`; columna `socio.objetivo_id uuid` (FK, nullable).

- [ ] **Step 1: Escribir la migración**

```sql
-- Catálogo de objetivos estándar con plan automático. codigo estable para
-- mapear plantillas; tiene_plan=false para objetivos "Otro"/disciplina sin plan.
create table if not exists public.objetivo_entrenamiento (
  id        uuid primary key default gen_random_uuid(),
  codigo    text not null unique,
  nombre    text not null,
  enfoque   text,
  orden     int not null default 0,
  tiene_plan boolean not null default true
);

insert into public.objetivo_entrenamiento (codigo, nombre, enfoque, orden) values
  ('bajar_peso',      'Bajar de peso',          'Déficit calórico + cardio + fullbody', 1),
  ('ganar_masa',      'Ganar masa muscular',    'Superávit + hipertrofia + split',      2),
  ('tonificar',       'Tonificar',              'Mantenimiento + circuitos',            3),
  ('fuerza',          'Fuerza',                 'Cargas altas, pocas reps',             4),
  ('resistencia',     'Resistencia / cardio',   'Alto volumen, poco descanso',          5),
  ('salud_general',   'Salud general',          'Equilibrado, moderado',                6),
  ('rehabilitacion',  'Rehabilitación',         'Bajo impacto, movilidad',              7),
  ('prep_deportiva',  'Preparación deportiva',  'Funcional, potencia',                  8)
on conflict (codigo) do nothing;

-- Objetivo del socio como FK (además del texto libre que se conserva)
alter table public.socio add column if not exists objetivo_id uuid references public.objetivo_entrenamiento(id);

-- Lectura del catálogo para authenticated (es global, no sensible)
alter table public.objetivo_entrenamiento enable row level security;
drop policy if exists objetivo_lectura on public.objetivo_entrenamiento;
create policy objetivo_lectura on public.objetivo_entrenamiento for select to authenticated using (true);

comment on table public.objetivo_entrenamiento is 'Catálogo de objetivos con plan automático (rutina+dieta por objetivo, modulado por IMC).';
```

- [ ] **Step 2: Aplicar y verificar**

Run: `psql … -f supabase/migrations/20260706000029_catalogo_objetivos.sql`
Luego: `psql … -c "select codigo, nombre from public.objetivo_entrenamiento order by orden;"`
Expected: 8 filas en orden (bajar_peso … prep_deportiva). `socio.objetivo_id` existe.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260706000029_catalogo_objetivos.sql
git commit -m "Plan auto (1/6): catalogo objetivo_entrenamiento + socio.objetivo_id"
```

---

### Task 2: Tablas plantilla_* (esquema)

**Files:**
- Create: `supabase/migrations/20260706000030_tablas_plantilla.sql`

**Interfaces:**
- Consumes: `objetivo_entrenamiento(id)` de Task 1.
- Produces: tablas `plantilla_rutina`, `plantilla_rutina_dia`, `plantilla_rutina_ejercicio`, `plantilla_dieta`, `plantilla_comida`. Todas con `empresa_id uuid` nullable (null=global, set=gym).

- [ ] **Step 1: Escribir la migración**

```sql
-- Plantillas de rutina/dieta por objetivo. empresa_id nullable: NULL = global
-- (semilla del sistema); set = versión personalizada del gym (pisa la global).
create table if not exists public.plantilla_rutina (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresa(id) on delete cascade,
  objetivo_id uuid not null references public.objetivo_entrenamiento(id),
  nombre text not null,
  notas text,
  created_at timestamptz not null default now()
);
create table if not exists public.plantilla_rutina_dia (
  id uuid primary key default gen_random_uuid(),
  plantilla_rutina_id uuid not null references public.plantilla_rutina(id) on delete cascade,
  dia_semana int not null,
  foco text
);
create table if not exists public.plantilla_rutina_ejercicio (
  id uuid primary key default gen_random_uuid(),
  plantilla_rutina_dia_id uuid not null references public.plantilla_rutina_dia(id) on delete cascade,
  ejercicio_id uuid references public.ejercicio(id),
  nombre text not null,
  series int, reps text, descanso text, carga text, orden int not null default 0, notas text
);
create table if not exists public.plantilla_dieta (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresa(id) on delete cascade,
  objetivo_id uuid not null references public.objetivo_entrenamiento(id),
  nombre text not null,
  suplementos text,
  created_at timestamptz not null default now()
);
create table if not exists public.plantilla_comida (
  id uuid primary key default gen_random_uuid(),
  plantilla_dieta_id uuid not null references public.plantilla_dieta(id) on delete cascade,
  nombre text not null, hora time, descripcion text, kcal int, orden int not null default 0, dia_semana int
);

-- Unicidad: una plantilla por objetivo por ámbito (global o gym).
create unique index if not exists uq_plantilla_rutina_objetivo
  on public.plantilla_rutina (objetivo_id, coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid));
create unique index if not exists uq_plantilla_dieta_objetivo
  on public.plantilla_dieta (objetivo_id, coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- RLS: lectura de globales (empresa_id null) para todos; las del gym solo su empresa.
alter table public.plantilla_rutina enable row level security;
alter table public.plantilla_dieta  enable row level security;
drop policy if exists pr_scope on public.plantilla_rutina;
create policy pr_scope on public.plantilla_rutina for all to authenticated
  using (empresa_id is null or empresa_id = public.auth_empresa_id())
  with check (empresa_id = public.auth_empresa_id());
drop policy if exists pd_scope on public.plantilla_dieta;
create policy pd_scope on public.plantilla_dieta for all to authenticated
  using (empresa_id is null or empresa_id = public.auth_empresa_id())
  with check (empresa_id = public.auth_empresa_id());
-- Las tablas hijas heredan el acceso vía join en las RPC (SECURITY DEFINER); RLS
-- directa no necesaria para v1 (no se leen sueltas desde el cliente).
alter table public.plantilla_rutina_dia enable row level security;
alter table public.plantilla_rutina_ejercicio enable row level security;
alter table public.plantilla_comida enable row level security;
drop policy if exists prd_read on public.plantilla_rutina_dia;
create policy prd_read on public.plantilla_rutina_dia for select to authenticated using (true);
drop policy if exists pre_read on public.plantilla_rutina_ejercicio;
create policy pre_read on public.plantilla_rutina_ejercicio for select to authenticated using (true);
drop policy if exists pc_read on public.plantilla_comida;
create policy pc_read on public.plantilla_comida for select to authenticated using (true);
```

- [ ] **Step 2: Aplicar y verificar**

Run: `psql … -f supabase/migrations/20260706000030_tablas_plantilla.sql`
Luego: `psql … -c "select count(*) from information_schema.tables where table_name like 'plantilla_%';"`
Expected: 5 tablas creadas.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260706000030_tablas_plantilla.sql
git commit -m "Plan auto (2/6): tablas plantilla_* (rutina/dia/ejercicio, dieta/comida)"
```

---

### Task 3: Semilla de las 8 plantillas de rutina + 8 de dieta

**Files:**
- Create: `supabase/migrations/20260706000031_semilla_plantillas.sql`

**Interfaces:**
- Consumes: `objetivo_entrenamiento`, tablas `plantilla_*`.
- Produces: 8 `plantilla_rutina` globales (con días+ejercicios) y 8 `plantilla_dieta` globales (con comidas), una por objetivo. Ejercicios referenciados por nombre desde el catálogo `ejercicio` (tomando cualquier id que matchee; si no existe, ejercicio_id null + nombre).

- [ ] **Step 1: Escribir la migración (contenido real)**

Estructura por objetivo (ejemplo `bajar_peso`; replicar el patrón para los 8 con contenido apropiado a cada enfoque):
- `plantilla_rutina` (nombre "Bajar de peso — plan base", notas con enfoque).
- 3 `plantilla_rutina_dia` (Lun/Mié/Vie con foco: fullbody + cardio).
- 4-6 `plantilla_rutina_ejercicio` por día (series/reps/descanso/carga reales).
- `plantilla_dieta` (nombre "Bajar de peso — nutrición base").
- 4-5 `plantilla_comida` (desayuno/media mañana/almuerzo/cena con kcal base que
  sumen ~2000 kcal de MANTENIMIENTO — el déficit lo aplica la RPC por IMC).

Patrón SQL (usar un DO con variables para resolver objetivo_id y ejercicio_id por nombre):

```sql
-- Helper: id de ejercicio por nombre (cualquiera si hay duplicados), null si no.
-- Se usa dentro del DO. La semilla es idempotente (borra plantillas globales y recrea).
do $$
declare v_obj uuid; v_pr uuid; v_dia uuid; v_pd uuid;
  function ej(text) ... -- ver implementación inline con subselect
begin
  -- Limpia plantillas GLOBALES previas (empresa_id null) para recargar limpio
  delete from public.plantilla_rutina where empresa_id is null;
  delete from public.plantilla_dieta  where empresa_id is null;

  -- ══ BAJAR DE PESO ══
  select id into v_obj from public.objetivo_entrenamiento where codigo='bajar_peso';
  insert into public.plantilla_rutina (empresa_id, objetivo_id, nombre, notas)
    values (null, v_obj, 'Bajar de peso — plan base',
            'Fullbody 3x/semana con cardio. Prioriza constancia y técnica.') returning id into v_pr;
  -- Día Lunes (dia_semana=1)
  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
    values (v_pr, 1, 'Fullbody + cardio') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Sentadilla%' limit 1), 'Sentadilla', 3, '12-15', '60s', 'Moderada', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Press banca%' limit 1), 'Press banca', 3, '10-12', '60s', 'Moderada', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Remo%' limit 1), 'Remo con barra', 3, '10-12', '60s', 'Moderada', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Plancha%' limit 1), 'Plancha abdominal', 3, '30-45s', '45s', 'Peso corporal', 4),
    (v_dia, null, 'Caminadora / cardio', 1, '20 min', '-', 'Ritmo moderado', 5);
  -- ... Días Miércoles(3) y Viernes(5) análogos con variación
  -- Dieta (kcal de MANTENIMIENTO ~2000; el déficit lo aplica la RPC)
  insert into public.plantilla_dieta (empresa_id, objetivo_id, nombre, suplementos)
    values (null, v_obj, 'Bajar de peso — nutrición base', 'Opcional: multivitamínico, omega-3.') returning id into v_pd;
  insert into public.plantilla_comida (plantilla_dieta_id, nombre, hora, descripcion, kcal, orden) values
    (v_pd, 'Desayuno', '07:30', 'Avena con fruta + huevos', 450, 1),
    (v_pd, 'Media mañana', '10:30', 'Yogur griego + almendras', 250, 2),
    (v_pd, 'Almuerzo', '13:30', 'Pollo a la plancha + arroz + ensalada', 650, 3),
    (v_pd, 'Cena', '19:30', 'Pescado + verduras al vapor', 450, 4),
    (v_pd, 'Snack noche', '21:30', 'Requesón / caseína', 200, 5);

  -- ══ (repetir bloque para: ganar_masa, tonificar, fuerza, resistencia,
  --     salud_general, rehabilitacion, prep_deportiva) con contenido propio ══
end $$;
```

(El implementador escribe los 8 bloques completos con contenido coherente a cada enfoque: ganar_masa = split 4 días + dieta ~2600 kcal superávit base; fuerza = 5x5 cargas altas; resistencia = circuitos/cardio; rehabilitacion = movilidad/bajo impacto; etc. Todas las dietas en kcal de MANTENIMIENTO para su perfil; la RPC modula.)

- [ ] **Step 2: Aplicar y verificar**

Run: `psql … -f supabase/migrations/20260706000031_semilla_plantillas.sql`
Luego:
```sql
select o.codigo,
  (select count(*) from plantilla_rutina_dia d join plantilla_rutina r on r.id=d.plantilla_rutina_id where r.objetivo_id=o.id and r.empresa_id is null) as dias,
  (select count(*) from plantilla_comida c join plantilla_dieta dt on dt.id=c.plantilla_dieta_id where dt.objetivo_id=o.id and dt.empresa_id is null) as comidas
from objetivo_entrenamiento o order by orden;
```
Expected: 8 filas, cada una con dias≥3 y comidas≥4.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260706000031_semilla_plantillas.sql
git commit -m "Plan auto (3/6): semilla de 8 plantillas rutina + 8 dieta (contenido real)"
```

---

### Task 4: RPC asignar_plan_automatico (con modulación IMC)

**Files:**
- Create: `supabase/migrations/20260706000032_rpc_asignar_plan.sql`

**Interfaces:**
- Consumes: `socio(objetivo_id, peso_kg, talla_m, empresa_id, sede_id)`, plantillas `plantilla_*`.
- Produces: `asignar_plan_automatico(p_socio_id uuid) returns jsonb` con `{asignado bool, motivo?, objetivo?, imc?, categoria?, rutina_dias?, dieta_kcal_dia?}`. SECURITY DEFINER.

- [ ] **Step 1: Escribir la RPC**

Lógica:
1. Cargar socio; si `objetivo_id` null o su objetivo `tiene_plan=false` o falta `peso_kg`/`talla_m` → `{asignado:false, motivo}`.
2. `v_imc := peso / (talla*talla)`. Categoría OMS (ver Global Constraints).
3. `v_factor_kcal`: bajo peso → 1.15; normal → según objetivo (bajar 0.85 / ganar 1.15 / resto 1.0); sobrepeso → 0.80; obesidad I → 0.75; obesidad II-III → 0.70.
4. Resolver plantilla de rutina/dieta del objetivo: preferir `empresa_id = socio.empresa_id`, si no `empresa_id is null`.
5. Idempotencia: si el socio ya tiene rutina activa creada por plantilla (marca vía `notas` con el prefijo, o simplemente si ya tiene rutina activa) → no duplicar; devolver `{asignado:false, motivo:'ya_tiene_plan'}`.
6. Copiar rutina: insert `rutina` (socio, activa, enviado_at=now, notas=nota_seguridad + nota IMC si ≥35) → copiar `rutina_dia` → `rutina_ejercicio` (con carga "Progresiva/suave" si IMC≥35).
7. Copiar dieta: insert `dieta` (socio, activa, enviado_at=now) → copiar `comida` con `kcal := round(kcal * v_factor)`.
8. Devolver resumen con `rutina_dias`, `dieta_kcal_dia` (suma de kcal ajustadas del día 1 o sin día).

```sql
create or replace function public.asignar_plan_automatico(p_socio_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_socio public.socio; v_obj public.objetivo_entrenamiento;
  v_imc numeric; v_cat text; v_factor numeric := 1.0;
  v_pr uuid; v_pd uuid; v_rut uuid; v_die uuid;
  v_nota text := 'Plan sugerido según tu objetivo e IMC. Consulta a tu entrenador; no reemplaza indicación médica.';
  v_nota_imc text := ''; v_carga_suave boolean := false;
  v_dia record; v_new_dia uuid; v_kcal_dia int;
begin
  select * into v_socio from public.socio where id = p_socio_id;
  if v_socio.id is null then return jsonb_build_object('asignado', false, 'motivo', 'socio_inexistente'); end if;
  if v_socio.objetivo_id is null then return jsonb_build_object('asignado', false, 'motivo', 'sin_objetivo'); end if;
  select * into v_obj from public.objetivo_entrenamiento where id = v_socio.objetivo_id;
  if not coalesce(v_obj.tiene_plan, false) then return jsonb_build_object('asignado', false, 'motivo', 'objetivo_sin_plan'); end if;
  if coalesce(v_socio.peso_kg,0) <= 0 or coalesce(v_socio.talla_m,0) <= 0 then
    return jsonb_build_object('asignado', false, 'motivo', 'sin_peso_talla'); end if;

  v_imc := round(v_socio.peso_kg / (v_socio.talla_m * v_socio.talla_m), 1);
  v_cat := case when v_imc < 18.5 then 'bajo_peso' when v_imc < 25 then 'normal'
                when v_imc < 30 then 'sobrepeso' when v_imc < 35 then 'obesidad_1'
                when v_imc < 40 then 'obesidad_2' else 'obesidad_3' end;

  v_factor := case v_cat
    when 'bajo_peso' then 1.15
    when 'normal' then case v_obj.codigo when 'bajar_peso' then 0.85 when 'ganar_masa' then 1.15 else 1.0 end
    when 'sobrepeso' then 0.80 when 'obesidad_1' then 0.75 else 0.70 end;
  if v_cat in ('obesidad_2','obesidad_3') then
    v_nota_imc := ' Arranque progresivo: prioriza cardio de bajo impacto y cargas suaves las primeras semanas para proteger tus articulaciones.';
    v_carga_suave := true;
  end if;

  -- Idempotencia: no duplicar si ya tiene rutina activa
  if exists (select 1 from public.rutina where socio_id = p_socio_id and activa) then
    return jsonb_build_object('asignado', false, 'motivo', 'ya_tiene_plan');
  end if;

  -- Plantilla del gym o global
  select id into v_pr from public.plantilla_rutina where objetivo_id=v_obj.id and (empresa_id=v_socio.empresa_id or empresa_id is null) order by empresa_id nulls last limit 1;
  select id into v_pd from public.plantilla_dieta  where objetivo_id=v_obj.id and (empresa_id=v_socio.empresa_id or empresa_id is null) order by empresa_id nulls last limit 1;

  -- Copiar RUTINA
  if v_pr is not null then
    insert into public.rutina (empresa_id, socio_id, nombre, objetivo, activa, enviado_at, notas)
      values (v_socio.empresa_id, p_socio_id, v_obj.nombre || ' — plan', v_obj.nombre, true, now(), v_nota || v_nota_imc)
      returning id into v_rut;
    for v_dia in select * from public.plantilla_rutina_dia where plantilla_rutina_id=v_pr order by dia_semana loop
      insert into public.rutina_dia (empresa_id, rutina_id, dia_semana, foco)
        values (v_socio.empresa_id, v_rut, v_dia.dia_semana, v_dia.foco) returning id into v_new_dia;
      insert into public.rutina_ejercicio (empresa_id, rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden, notas)
        select v_socio.empresa_id, v_new_dia, e.ejercicio_id, e.nombre, e.series, e.reps, e.descanso,
               case when v_carga_suave and e.carga not ilike '%corporal%' and e.carga not ilike '%cardio%' and e.carga not ilike '%ritmo%' then 'Suave / progresiva' else e.carga end,
               e.orden, e.notas
        from public.plantilla_rutina_ejercicio e where e.plantilla_rutina_dia_id = v_dia.id;
    end loop;
  end if;

  -- Copiar DIETA con kcal moduladas
  if v_pd is not null then
    insert into public.dieta (empresa_id, socio_id, nombre, activa, enviado_at, suplementos)
      select v_socio.empresa_id, p_socio_id, v_obj.nombre || ' — nutrición', true, now(), suplementos
      from public.plantilla_dieta where id=v_pd returning id into v_die;
    insert into public.comida (empresa_id, dieta_id, nombre, hora, descripcion, kcal, orden, dia_semana)
      select v_socio.empresa_id, v_die, nombre, hora, descripcion, round(coalesce(kcal,0) * v_factor)::int, orden, dia_semana
      from public.plantilla_comida where plantilla_dieta_id=v_pd;
    select coalesce(sum(kcal),0) into v_kcal_dia from public.comida where dieta_id=v_die and coalesce(dia_semana,1)=1;
    if v_kcal_dia = 0 then select coalesce(sum(kcal),0) into v_kcal_dia from public.comida where dieta_id=v_die; end if;
  end if;

  return jsonb_build_object('asignado', true, 'objetivo', v_obj.nombre, 'imc', v_imc,
    'categoria', v_cat, 'rutina_dias', (select count(*) from public.rutina_dia where rutina_id=v_rut),
    'dieta_kcal_dia', v_kcal_dia);
end;
$function$;
grant execute on function public.asignar_plan_automatico(uuid) to authenticated;
```

Nota (verificado): `rutina` NO tiene `deleted_at` (por eso el filtro de idempotencia solo usa `activa`). `rutina_dia`/`rutina_ejercicio`/`comida` SÍ tienen `empresa_id` (se setea en cada insert). `socio` tiene `peso_kg` y `talla_m`.

- [ ] **Step 2: Aplicar y probar E2E**

Crear un socio de prueba en MaximusGym con objetivo bajar_peso + peso/talla de sobrepeso, llamar la RPC, verificar rutina+dieta copiadas y kcal reducidas. Limpiar.
Expected: `{asignado:true, categoria:'sobrepeso', rutina_dias:3, dieta_kcal_dia:~1600}`; comidas del socio con kcal = plantilla×0.80.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260706000032_rpc_asignar_plan.sql
git commit -m "Plan auto (4/6): RPC asignar_plan_automatico con modulacion por IMC"
```

---

### Task 5: Integrar en inscribir_socio + mapear objetivos existentes

**Files:**
- Create: `supabase/migrations/20260706000033_inscribir_asigna_plan.sql`

**Interfaces:**
- Consumes: `asignar_plan_automatico`, `inscribir_socio`.
- Produces: `inscribir_socio` acepta `p_objetivo_id uuid default null`, lo guarda en el socio, llama `asignar_plan_automatico`, y agrega `plan` al jsonb de retorno. Backfill de `socio.objetivo_id` desde el texto de objetivos existentes.

- [ ] **Step 1: Escribir la migración**

1. `create or replace function inscribir_socio(...)` — tomar la definición actual (`pg_get_functiondef`), agregar parámetro `p_objetivo_id uuid default null`, setearlo en el insert del socio, y antes del `return` hacer `perform` no — usar `select ... into` para capturar el resumen: `v_plan := public.asignar_plan_automatico(v_socio);` y añadir `'plan', v_plan` al jsonb de retorno. (Solo si `p_objetivo_id` no es null.)
2. Backfill: mapear los textos de objetivo actuales a codigos:
```sql
update public.socio s set objetivo_id = o.id
from public.objetivo_entrenamiento o
where s.objetivo_id is null and o.codigo = case
  when s.objetivo ilike '%baj%peso%' or s.objetivo ilike '%grasa%' or s.objetivo ilike '%perd%' then 'bajar_peso'
  when s.objetivo ilike '%masa%' or s.objetivo ilike '%muscul%' or s.objetivo ilike '%ganar%' then 'ganar_masa'
  when s.objetivo ilike '%tonific%' then 'tonificar'
  when s.objetivo ilike '%fuerza%' then 'fuerza'
  when s.objetivo ilike '%resist%' or s.objetivo ilike '%cardio%' then 'resistencia'
  when s.objetivo ilike '%rehab%' or s.objetivo ilike '%postura%' then 'rehabilitacion'
  when s.objetivo ilike '%deport%' or s.objetivo ilike '%prepar%' then 'prep_deportiva'
  when s.objetivo ilike '%salud%' or s.objetivo ilike '%general%' then 'salud_general'
  else null end;
```

- [ ] **Step 2: Aplicar y probar E2E**

Llamar `inscribir_socio` con un objetivo_id y peso/talla → verificar que el socio queda con rutina+dieta y el retorno trae `plan.asignado=true`. Limpiar.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260706000033_inscribir_asigna_plan.sql
git commit -m "Plan auto (5/6): inscribir_socio asigna plan automatico + backfill objetivos"
```

---

### Task 6: Panel — selector de objetivo al inscribir + pestaña Plantillas

**Files:**
- Modify: `src/pages/Clientes.jsx` (form de inscripción: selector de objetivo del catálogo → pasar `p_objetivo_id`; mostrar el aviso del plan asignado)
- Modify: `src/pages/Rutinas.jsx` (agregar pestaña/sección "Plantillas")
- Create: `src/hooks/usePlantillas.js` (hooks: catálogo objetivos, plantillas, editar/restaurar)

**Interfaces:**
- Consumes: RPCs `asignar_plan_automatico` (indirecto vía inscribir), catálogo `objetivo_entrenamiento`, tablas `plantilla_*`.
- Produces: UI de inscripción con objetivo estándar + UI de plantillas editable.

- [ ] **Step 1: Hook de catálogo de objetivos + plantillas**

`src/hooks/usePlantillas.js`: `useObjetivos()` (lee objetivo_entrenamiento), `usePlantillasRutina(empresaId)` / `usePlantillasDieta(empresaId)` (lee plantilla_* global + del gym), `useGuardarPlantillaGym()` (duplica global → gym al editar), `useRestaurarPlantilla()` (borra la del gym).

- [ ] **Step 2: Inscripción con objetivo estándar**

En `Clientes.jsx`, el campo objetivo pasa de texto libre a un `<select>` del catálogo (con opción "Otro" que deja texto libre). Al inscribir, pasar `p_objetivo_id`. Tras inscribir, si `resp.plan?.asignado`, mostrar toast: `Plan asignado: ${objetivo} · ${rutina_dias} días + dieta ${dieta_kcal_dia} kcal (IMC ${imc}, ${categoria})`.

- [ ] **Step 3: Pestaña Plantillas en Rutinas**

Nueva sección que lista las 8 plantillas (rutina + dieta por objetivo), indica global vs. personalizada, permite editar (reusa el editor de rutina/dieta existente) y "Restaurar a la original".

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: sin errores.

- [ ] **Step 5: Commit + deploy**

```bash
git add src/pages/Clientes.jsx src/pages/Rutinas.jsx src/hooks/usePlantillas.js
git commit -m "Plan auto (6/6): panel — objetivo estandar al inscribir + pestana Plantillas"
git push origin master && vercel --prod --yes
```

---

## Verificación final (todo junto)

- Inscribir un socio en el panel con objetivo "Bajar de peso" + peso/talla de sobrepeso → toast muestra el plan; la ficha del socio tiene rutina de 3 días + dieta con déficit.
- Un socio obeso II → dieta con mayor déficit + rutina con nota de arranque progresivo y cargas "suave/progresiva".
- Objetivo "Otro" o sin peso → inscribe sin plan, sin error.
- Editar la plantilla global de "Ganar masa" en el panel → crea copia del gym; inscribir un socio de ese gym con ganar_masa → recibe la versión editada.
- `npm run build` verde; E2E de cada RPC verde contra la BD.
