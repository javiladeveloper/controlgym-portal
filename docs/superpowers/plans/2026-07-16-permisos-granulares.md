# Permisos Granulares Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un usuario pueda tener permisos EXTRA además de los de su rol (ej. recepción que también atiende leads), vía un permiso `leads` que el reparto de leads respeta.

**Architecture:** Nueva función `auth_tiene_permiso(permiso)` = admin OR rol-base-lo-trae (mapa fijo) OR extra en tabla `usuario_permiso`. El reparto/rotación de leads y la agenda migran de "rol=comunicador" a "permiso leads" (aditivo: el comunicador tiene leads por base, no cambia). UI en Personal para sumar extras.

**Tech Stack:** Postgres (Supabase), migraciones vía `psql -f`, React+Vite panel.

## Global Constraints

- **Migraciones**: `supabase/migrations/AAAAMMDD######_nombre.sql`, aplicadas con `psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 -f <archivo>`. UTF-8.
- **NUNCA imprimir `DATABASE_URL`**.
- **Límite Vercel Hobby ≤12 funciones serverless** — NO agregar funciones nuevas (este feature no las necesita).
- **Commit trailer**: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- **Los 4 permisos válidos**: `leads`, `caja`, `reportes`, `rutinas`. Solo `leads` se cablea a lógica en esta entrega; los otros 3 quedan en el catálogo/UI como framework pero sin efecto todavía.
- **Mapa rol→permisos base FIJO** (en la función, no en tabla): admin=todos; recepcion=caja; comunicador=leads; entrenador=rutinas; nutricionista=rutinas; mantenimiento=ninguno.
- **Regla de oro (aditivo)**: ningún cambio quita capacidades. El comunicador tiene `leads` por base → su comportamiento se preserva EXACTO.
- **Funciones auxiliares existentes** (reusar): `auth_rol()` (text), `auth_is_admin()` (bool), `auth_empresa_id()` (uuid), `auth.uid()`.
- **Verificación DB**: probar en `begin; … rollback;` antes de aplicar cambios de comportamiento.
- **Tests/build**: al cerrar, `npm test` y `npm run build` limpios.
- **Referencia**: la función `asignar_lead_automatico` vigente está en `.superpowers/sdd/asignar-lead-ref.sql` (2 filtros `r.codigo = 'comunicador'`).

## File Structure

- `supabase/migrations/20260716000001_usuario_permiso.sql` — tabla + RLS + `auth_tiene_permiso`.
- `supabase/migrations/20260716000002_leads_por_permiso.sql` — migra reparto/rotación/agenda de leads a permiso `leads`.
- `supabase/migrations/20260716000003_bootstrap_permisos.sql` — `get_bootstrap` devuelve `permisos[]`.
- `supabase/migrations/20260716000004_usuario_permiso_rpcs.sql` — RPCs para que el admin sume/quite extras + listar.
- `src/pages/Personal.jsx` — checklist de permisos extra por empleado (modificar).

---

## Task 1: Tabla `usuario_permiso` + `auth_tiene_permiso`

**Files:**
- Create: `supabase/migrations/20260716000001_usuario_permiso.sql`

**Interfaces:**
- Produces: tabla `public.usuario_permiso`; función `public.auth_tiene_permiso(p_permiso text) returns boolean`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Permisos granulares: un usuario tiene los permisos de su ROL (mapa fijo) MÁS
-- los EXTRA que el admin le suma aquí. Solo suma, nunca quita. 4 permisos:
-- leads, caja, reportes, rutinas (solo 'leads' se cablea a lógica por ahora).
create table if not exists public.usuario_permiso (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  permiso    text not null check (permiso in ('leads','caja','reportes','rutinas')),
  created_at timestamptz not null default now(),
  created_by uuid references public.usuario(id),
  unique (empresa_id, usuario_id, permiso)
);
alter table public.usuario_permiso enable row level security;
-- El admin de la empresa gestiona los extras; el usuario lee los suyos.
drop policy if exists usuario_permiso_admin on public.usuario_permiso;
create policy usuario_permiso_admin on public.usuario_permiso for all to authenticated
  using (public.auth_is_admin() and empresa_id = public.auth_empresa_id())
  with check (public.auth_is_admin() and empresa_id = public.auth_empresa_id());
drop policy if exists usuario_permiso_propio on public.usuario_permiso;
create policy usuario_permiso_propio on public.usuario_permiso for select to authenticated
  using (usuario_id = auth.uid());

-- ¿El usuario logueado tiene el permiso? admin siempre; o el rol base lo trae
-- (mapa FIJO); o tiene el extra en usuario_permiso. Único punto de verdad.
create or replace function public.auth_tiene_permiso(p_permiso text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_rol text;
begin
  if public.auth_is_admin() then return true; end if;  -- admin tiene todo
  v_rol := public.auth_rol();
  -- Mapa fijo rol -> permisos base.
  if (v_rol = 'recepcion'    and p_permiso = 'caja')
  or (v_rol = 'comunicador'  and p_permiso = 'leads')
  or (v_rol = 'entrenador'   and p_permiso = 'rutinas')
  or (v_rol = 'nutricionista' and p_permiso = 'rutinas') then
    return true;
  end if;
  -- Extra sumado por el admin.
  return exists (
    select 1 from public.usuario_permiso up
    where up.usuario_id = auth.uid()
      and up.empresa_id = public.auth_empresa_id()
      and up.permiso = p_permiso);
end $$;
revoke all on function public.auth_tiene_permiso(text) from public;
grant execute on function public.auth_tiene_permiso(text) to authenticated, service_role;
```

- [ ] **Step 2: Aplicar**

Run: `psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 -f supabase/migrations/20260716000001_usuario_permiso.sql`
Expected: `CREATE TABLE`, `CREATE POLICY` x2, `CREATE FUNCTION`, `GRANT`, sin error.

- [ ] **Step 3: Probar la resolución en rollback (simulando roles)**

```bash
psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 <<'SQL'
begin;
-- tomar un usuario comunicador y uno recepcion reales, con su empresa
select ue.usuario_id as com, ue.empresa_id as emp from public.usuario_empresa ue
  join public.rol r on r.id=ue.rol_id where r.codigo='comunicador' and ue.activo limit 1 \gset
-- simular JWT del comunicador
select set_config('request.jwt.claims', json_build_object('sub', :'com', 'rol', 'comunicador')::text, true);
select set_config('role','authenticated', true);
select public.auth_tiene_permiso('leads') as comunicador_tiene_leads;   -- debe ser true (base)
select public.auth_tiene_permiso('caja')  as comunicador_tiene_caja;    -- debe ser false
rollback;
SQL
```
Expected: `comunicador_tiene_leads = t`, `comunicador_tiene_caja = f`.

- [ ] **Step 4: Probar el extra (recepción + leads)**

```bash
psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 <<'SQL'
begin;
select ue.usuario_id as rec, ue.empresa_id as emp from public.usuario_empresa ue
  join public.rol r on r.id=ue.rol_id where r.codigo='recepcion' and ue.activo limit 1 \gset
-- sin extra: recepción NO tiene leads
select set_config('request.jwt.claims', json_build_object('sub', :'rec', 'rol', 'recepcion')::text, true);
select set_config('role','authenticated', true);
select public.auth_tiene_permiso('leads') as sin_extra;   -- false
-- sumar el extra (como service_role, saltando RLS para la prueba)
select set_config('role','postgres', true);
insert into public.usuario_permiso(empresa_id, usuario_id, permiso) values (:'emp', :'rec', 'leads');
-- ahora sí
select set_config('request.jwt.claims', json_build_object('sub', :'rec', 'rol', 'recepcion')::text, true);
select set_config('role','authenticated', true);
select public.auth_tiene_permiso('leads') as con_extra;   -- true
rollback;
SQL
```
Expected: `sin_extra = f`, `con_extra = t`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260716000001_usuario_permiso.sql
git commit -m "feat(permisos): tabla usuario_permiso + auth_tiene_permiso

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Reparto y rotación de leads por permiso `leads`

**Files:**
- Create: `supabase/migrations/20260716000002_leads_por_permiso.sql`

**Interfaces:**
- Consumes: `auth_tiene_permiso` (Task 1), función vigente `asignar_lead_automatico` (ver `.superpowers/sdd/asignar-lead-ref.sql`).
- Produces: `asignar_lead_automatico` reescrita para repartir entre usuarios con permiso `leads` (no solo rol comunicador).

- [ ] **Step 1: Leer la función vigente**

Run: `cat .superpowers/sdd/asignar-lead-ref.sql`
Identifica los 2 puntos con `join public.rol r on r.id = ue.rol_id and r.codigo = 'comunicador'`: (a) "¿el que registra es comunicador? es su prospecto"; (b) "el comunicador activo menos cargado".

- [ ] **Step 2: Escribir la migración (CREATE OR REPLACE con el cuerpo real)**

Copia el cuerpo VIGENTE de `asignar_lead_automatico` desde `.superpowers/sdd/asignar-lead-ref.sql` y reemplaza los DOS filtros de comunicador. En vez de:
```sql
    join public.rol r on r.id = ue.rol_id and r.codigo = 'comunicador'
```
usa un EXISTS de permiso (un usuario_empresa activo cuyo usuario tenga permiso leads). Como `auth_tiene_permiso` depende del JWT del caller (no sirve dentro del trigger para OTROS usuarios), define un helper que evalúa el permiso de un usuario ARBITRARIO:

```sql
-- ¿El usuario u (en la empresa e) tiene el permiso? Igual que auth_tiene_permiso
-- pero para un usuario dado (para usar dentro de triggers/reparto). NO mira admin
-- del JWT: mira el rol y los extras de ESE usuario.
create or replace function public.usuario_tiene_permiso(p_usuario uuid, p_empresa uuid, p_permiso text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- admin de la empresa tiene todo
    exists (select 1 from public.usuario_empresa ue join public.rol r on r.id=ue.rol_id
            where ue.usuario_id=p_usuario and ue.empresa_id=p_empresa and ue.activo and r.codigo='admin')
    -- rol base
    or exists (select 1 from public.usuario_empresa ue join public.rol r on r.id=ue.rol_id
            where ue.usuario_id=p_usuario and ue.empresa_id=p_empresa and ue.activo and (
              (r.codigo='recepcion' and p_permiso='caja') or
              (r.codigo='comunicador' and p_permiso='leads') or
              (r.codigo='entrenador' and p_permiso='rutinas') or
              (r.codigo='nutricionista' and p_permiso='rutinas')))
    -- extra
    or exists (select 1 from public.usuario_permiso up
            where up.usuario_id=p_usuario and up.empresa_id=p_empresa and up.permiso=p_permiso);
$$;
revoke all on function public.usuario_tiene_permiso(uuid,uuid,text) from public;
grant execute on function public.usuario_tiene_permiso(uuid,uuid,text) to authenticated, service_role;
```

Luego, en `asignar_lead_automatico`, cada bloque que hacía
`join public.rol r on r.id = ue.rol_id and r.codigo = 'comunicador'`
se cambia por filtrar los `usuario_empresa` activos de la empresa cuyo usuario cumpla `public.usuario_tiene_permiso(ue.usuario_id, ue.empresa_id, 'leads')`. Mantén TODO el resto del cuerpo idéntico (dedup, carga mínima, push, etc.). Pega el CREATE OR REPLACE completo en la migración.

- [ ] **Step 3: Aplicar**

Run: `psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 -f supabase/migrations/20260716000002_leads_por_permiso.sql`
Expected: `CREATE FUNCTION` x2 (helper + asignar), sin error.

- [ ] **Step 4: Probar que el comportamiento del comunicador se preserva + recepción con extra entra**

```bash
psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 <<'SQL'
begin;
select id as emp from public.empresa order by created_at limit 1 \gset
-- universo de "atiende leads" = comunicadores (base) + quien tenga extra
select count(*) as atienden_leads from public.usuario_empresa ue
  where ue.empresa_id=:'emp'::uuid and ue.activo
    and public.usuario_tiene_permiso(ue.usuario_id, ue.empresa_id, 'leads');
-- agregar extra a un recepcionista y ver que sube el conteo
select ue.usuario_id as rec from public.usuario_empresa ue join public.rol r on r.id=ue.rol_id
  where ue.empresa_id=:'emp'::uuid and r.codigo='recepcion' and ue.activo limit 1 \gset
insert into public.usuario_permiso(empresa_id, usuario_id, permiso) values (:'emp'::uuid, :'rec'::uuid, 'leads');
select count(*) as atienden_leads_tras_extra from public.usuario_empresa ue
  where ue.empresa_id=:'emp'::uuid and ue.activo
    and public.usuario_tiene_permiso(ue.usuario_id, ue.empresa_id, 'leads');
rollback;
SQL
```
Expected: `atienden_leads_tras_extra` = `atienden_leads` + 1 (si había un recepcionista sin el extra).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260716000002_leads_por_permiso.sql
git commit -m "feat(permisos): reparto de leads por permiso 'leads' (no solo rol comunicador)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Rotación de leads sin contacto + agenda por permiso

**Files:**
- Create: `supabase/migrations/20260716000003_leads_rotacion_agenda_permiso.sql`

**Interfaces:**
- Consumes: `usuario_tiene_permiso` (Task 2).
- Produces: la función de rotación (`stamp_lead_asignado_at` / la que rota a "otro comunicador menos cargado") y las 3 vistas/funciones de la agenda migradas a permiso `leads`.

- [ ] **Step 1: Leer las funciones vigentes**

Run:
```bash
psql "$(cat /tmp/.dburl)" -tAc "select pg_get_functiondef('public.stamp_lead_asignado_at'::regproc);" > .superpowers/sdd/rotacion-ref.sql 2>&1; cat .superpowers/sdd/rotacion-ref.sql | grep -n comunicador
grep -n "auth_rol() <> 'comunicador'" supabase/migrations/20260711000025_agenda_solo_mis_tareas_comunicador.sql
```
Expected: ubicar el filtro `r.codigo='comunicador'` en la rotación y los 3 `auth_rol() <> 'comunicador' or t.asignado_a = auth.uid()` en la agenda.

- [ ] **Step 2: Escribir la migración**

Para la ROTACIÓN: CREATE OR REPLACE de la función vigente (cópiala de `.superpowers/sdd/rotacion-ref.sql`), reemplazando `join public.rol ro on ro.id = ue.rol_id and ro.codigo = 'comunicador'` por el filtro `public.usuario_tiene_permiso(ue.usuario_id, ue.empresa_id, 'leads')` (mismo criterio que Task 2). Resto idéntico.

Para la AGENDA: las funciones que hoy usan `(public.auth_rol() <> 'comunicador' or t.asignado_a = auth.uid())` cambian a `(not public.auth_tiene_permiso('leads') or t.asignado_a = auth.uid())`. Localiza esas funciones con:
```bash
psql "$(cat /tmp/.dburl)" -tAc "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and pg_get_functiondef(p.oid) ilike '%auth_rol() <> ''comunicador''%';"
```
Para cada una, CREATE OR REPLACE con el `<>` cambiado. Semántica preservada: quien atiende leads solo ve SUS tareas; quien no, ve todas (admin/otros roles) — igual que hoy, pero ahora "atiende leads" = permiso, no rol.

- [ ] **Step 3: Aplicar**

Run: `psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 -f supabase/migrations/20260716000003_leads_rotacion_agenda_permiso.sql`
Expected: `CREATE FUNCTION` (varias), sin error.

- [ ] **Step 4: Verificar que compila y la agenda no rompe (rollback, JWT comunicador)**

```bash
psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 <<'SQL'
begin;
select ue.usuario_id as com from public.usuario_empresa ue join public.rol r on r.id=ue.rol_id
  where r.codigo='comunicador' and ue.activo limit 1 \gset
select set_config('request.jwt.claims', json_build_object('sub', :'com', 'rol', 'comunicador')::text, true);
select set_config('role','authenticated', true);
-- llamar la función de agenda vigente (usa el nombre real hallado en Step 2); debe devolver sin error
-- (sustituye <agenda_fn> por el nombre real, ej. agenda_comercial)
select public.auth_tiene_permiso('leads') as com_atiende;  -- true
rollback;
SQL
```
Expected: `com_atiende = t`, sin error en la función de agenda.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260716000003_leads_rotacion_agenda_permiso.sql
git commit -m "feat(permisos): rotación de leads y agenda por permiso 'leads'

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: `get_bootstrap` devuelve `permisos[]` + RPCs de gestión

**Files:**
- Create: `supabase/migrations/20260716000004_bootstrap_y_rpcs_permisos.sql`

**Interfaces:**
- Consumes: `auth_tiene_permiso` (Task 1).
- Produces: `get_bootstrap` con campo `permisos` (array de los 4 que el usuario tiene); RPCs `set_permiso_usuario(p_usuario_id, p_permiso, p_activo)` (admin suma/quita extra) y `permisos_de_usuario(p_usuario_id)` (para la UI: base + extras).

- [ ] **Step 1: Escribir la migración**

```sql
-- get_bootstrap: agregar 'permisos' = los 4 permisos que el usuario tiene.
-- (CREATE OR REPLACE copiando el cuerpo vigente y sumando el campo — usa
--  pg_get_functiondef para partir del real.)
-- Helper reutilizable: lista de permisos efectivos del usuario logueado.
create or replace function public.mis_permisos()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(p), '[]'::jsonb) from (
    select unnest(array['leads','caja','reportes','rutinas']) as p
  ) x where public.auth_tiene_permiso(x.p);
$$;
grant execute on function public.mis_permisos() to authenticated, service_role;

-- RPC admin: sumar/quitar un extra a un usuario de su empresa.
create or replace function public.set_permiso_usuario(p_usuario_id uuid, p_permiso text, p_activo boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id();
begin
  if not public.auth_is_admin() then raise exception 'solo el administrador'; end if;
  if p_permiso not in ('leads','caja','reportes','rutinas') then raise exception 'permiso inválido'; end if;
  -- el usuario debe pertenecer a la empresa del admin
  if not exists (select 1 from public.usuario_empresa where usuario_id=p_usuario_id and empresa_id=v_emp and activo) then
    raise exception 'ese usuario no es de tu empresa';
  end if;
  if p_activo then
    insert into public.usuario_permiso(empresa_id, usuario_id, permiso, created_by)
    values (v_emp, p_usuario_id, p_permiso, auth.uid())
    on conflict (empresa_id, usuario_id, permiso) do nothing;
  else
    delete from public.usuario_permiso where empresa_id=v_emp and usuario_id=p_usuario_id and permiso=p_permiso;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.set_permiso_usuario(uuid,text,boolean) from public;
grant execute on function public.set_permiso_usuario(uuid,text,boolean) to authenticated, service_role;

-- RPC para la UI: por cada permiso, si lo tiene por su ROL (base, no editable)
-- o como EXTRA (editable). Solo admin de la empresa.
create or replace function public.permisos_de_usuario(p_usuario_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); v_rol text;
begin
  if not public.auth_is_admin() then raise exception 'solo el administrador'; end if;
  select r.codigo into v_rol from public.usuario_empresa ue join public.rol r on r.id=ue.rol_id
    where ue.usuario_id=p_usuario_id and ue.empresa_id=v_emp and ue.activo
    order by ue.es_default desc limit 1;
  return (
    select jsonb_agg(jsonb_build_object(
      'permiso', p,
      'por_rol', (v_rol='admin')
        or (v_rol='recepcion' and p='caja') or (v_rol='comunicador' and p='leads')
        or (v_rol in ('entrenador','nutricionista') and p='rutinas'),
      'extra', exists (select 1 from public.usuario_permiso up where up.usuario_id=p_usuario_id and up.empresa_id=v_emp and up.permiso=p)
    ))
    from (select unnest(array['leads','caja','reportes','rutinas']) as p) x
  );
end $$;
revoke all on function public.permisos_de_usuario(uuid) from public;
grant execute on function public.permisos_de_usuario(uuid) to authenticated, service_role;
```
Además: CREATE OR REPLACE de `get_bootstrap` agregando `'permisos', public.mis_permisos()` al jsonb que devuelve (parte del cuerpo real con `pg_get_functiondef('public.get_bootstrap'::regproc)`).

- [ ] **Step 2: Aplicar**

Run: `psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 -f supabase/migrations/20260716000004_bootstrap_y_rpcs_permisos.sql`
Expected: `CREATE FUNCTION` (varias), `GRANT`, sin error.

- [ ] **Step 3: Probar las RPCs (rollback, JWT admin)**

```bash
psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 <<'SQL'
begin;
select ue.usuario_id as adm, ue.empresa_id as emp from public.usuario_empresa ue join public.rol r on r.id=ue.rol_id
  where r.codigo='admin' and ue.activo limit 1 \gset
select ue.usuario_id as rec from public.usuario_empresa ue join public.rol r on r.id=ue.rol_id
  where r.codigo='recepcion' and ue.empresa_id=:'emp' and ue.activo limit 1 \gset
select set_config('request.jwt.claims', json_build_object('sub', :'adm', 'rol', 'admin')::text, true);
select set_config('role','authenticated', true);
select public.set_permiso_usuario(:'rec'::uuid, 'leads', true)->>'ok' as sumado;
select public.permisos_de_usuario(:'rec'::uuid);  -- 'leads' debe salir extra=true
rollback;
SQL
```
Expected: `sumado = true`; en `permisos_de_usuario`, el permiso `leads` con `extra: true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260716000004_bootstrap_y_rpcs_permisos.sql
git commit -m "feat(permisos): bootstrap.permisos + RPCs set_permiso_usuario/permisos_de_usuario

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: UI de permisos extra en Personal

**Files:**
- Modify: `src/pages/Personal.jsx`

**Interfaces:**
- Consumes: RPCs `permisos_de_usuario`, `set_permiso_usuario` (Task 4).
- Produces: en la ficha de un empleado, un bloque "Permisos" con checkboxes de los 4; los `por_rol` se muestran marcados y deshabilitados (etiqueta "por su rol"); los `extra` son editables.

- [ ] **Step 1: Ubicar dónde se edita/ve un empleado en Personal.jsx**

Run: `grep -nE "rol|usuario_id|EditarStaff|StaffModal|Modal|ficha|empleado" src/pages/Personal.jsx | head -20`
Expected: localizar el modal/panel de detalle de un empleado.

- [ ] **Step 2: Agregar el bloque de permisos**

En el detalle del empleado, agrega (adaptando a los componentes del archivo — `Campo`, `Card`, `toast`, `supabase`):
```jsx
// Permisos extra: el rol da un piso; el admin puede sumar capacidades.
function PermisosEmpleado({ usuarioId }) {
  const qc = useQueryClient()
  const LABELS = { leads: 'Atender leads (CRM)', caja: 'Cobrar / caja', reportes: 'Ver reportes', rutinas: 'Rutinas y socios' }
  const q = useQuery({
    queryKey: ['permisos-usuario', usuarioId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('permisos_de_usuario', { p_usuario_id: usuarioId })
      if (error) throw error
      return data || []
    },
  })
  async function toggle(permiso, activar) {
    try {
      await supabase.rpc('set_permiso_usuario', { p_usuario_id: usuarioId, p_permiso: permiso, p_activo: activar })
      qc.invalidateQueries({ queryKey: ['permisos-usuario', usuarioId] })
    } catch (e) { toast.error(e.message) }
  }
  return (
    <div className="mt-4">
      <div className="mb-2 text-[13px] font-extrabold">Permisos</div>
      <p className="mb-2 text-[12px] font-semibold text-muted">Su rol ya trae algunos permisos. Puedes sumarle otros.</p>
      <div className="flex flex-col gap-1.5">
        {(q.data || []).map((p) => (
          <label key={p.permiso} className={`flex items-center gap-2 text-[12.5px] font-bold ${p.por_rol ? 'text-muted' : ''}`}>
            <input type="checkbox" checked={p.por_rol || p.extra} disabled={p.por_rol}
              onChange={(e) => toggle(p.permiso, e.target.checked)} className="accent-[#FF6B35]" />
            {LABELS[p.permiso]}
            {p.por_rol && <span className="text-[10.5px] font-extrabold text-faint">(por su rol)</span>}
          </label>
        ))}
      </div>
    </div>
  )
}
```
Y móntalo en el detalle del empleado: `<PermisosEmpleado usuarioId={empleado.usuario_id} />`. Asegura los imports (`useQuery`, `useQueryClient`, `supabase`, `toast`) si no están.

- [ ] **Step 3: Verificar build + test**

Run: `npm run build 2>&1 | grep -iE "error|built in" | tail -2 && npm test 2>&1 | grep -iE "Tests" | tail -1`
Expected: build OK, tests pasan.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Personal.jsx
git commit -m "feat(permisos): checklist de permisos extra por empleado en Personal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review (cobertura del spec)

- Tabla `usuario_permiso` + `auth_tiene_permiso` → Task 1 ✅
- Reparto de leads por permiso → Task 2 (+ helper `usuario_tiene_permiso` para usuarios arbitrarios) ✅
- Rotación + agenda por permiso → Task 3 ✅
- `bootstrap.permisos` + RPCs de gestión → Task 4 ✅
- UI en Personal → Task 5 ✅
- Solo `leads` cableado; caja/reportes/rutinas quedan en catálogo/UI sin efecto (framework) → consistente con el spec ✅
- Aditivo (comunicador preservado) → probado en Task 2 Step 4 y Task 1 Step 3 ✅

**Nota de consistencia:** `auth_tiene_permiso` (usa JWT del caller) y `usuario_tiene_permiso` (usa un usuario arbitrario) comparten el MISMO mapa fijo — si se cambia el mapa, actualizar AMBAS. Documentado en las funciones.
