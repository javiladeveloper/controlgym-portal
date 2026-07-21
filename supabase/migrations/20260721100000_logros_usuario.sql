-- Logros desbloqueados por el usuario (gamificación de la Constancia).
-- Pedido en docs/FEATURES-USUARIO-LIBRE-HANDOFF.md (feature 4) del repo de la app.
--
-- Diseño acordado: los logros se CALCULAN en el cliente a partir de datos que ya
-- existen (constancia, nº de entrenos, PRs, metas de peso). Aquí solo se persiste
-- CUÁL ya se desbloqueó, para no volver a celebrarlo cada vez que abre la app.
-- Nada de reglas de negocio en la tabla: si mañana cambian los logros o se suman
-- nuevos, no hace falta migración.
--
-- Es del USUARIO, no del socio: aplica también a quien no pertenece a ningún gym
-- (el usuario libre, que es justamente a quien apunta esta feature).
create table if not exists public.logro_usuario (
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  logro_codigo text not null,
  desbloqueado_en timestamptz not null default now(),
  visto boolean not null default false,   -- para celebrar una sola vez
  primary key (usuario_id, logro_codigo)
);

comment on table public.logro_usuario is
  'Logros ya desbloqueados por el usuario. La app calcula cuáles corresponden; esto solo evita re-celebrarlos.';

alter table public.logro_usuario enable row level security;

-- Cada quien ve y gestiona SOLO los suyos.
drop policy if exists lu_sel on public.logro_usuario;
create policy lu_sel on public.logro_usuario for select to authenticated
using (usuario_id = auth.uid());

drop policy if exists lu_ins on public.logro_usuario;
create policy lu_ins on public.logro_usuario for insert to authenticated
with check (usuario_id = auth.uid());

drop policy if exists lu_upd on public.logro_usuario;
create policy lu_upd on public.logro_usuario for update to authenticated
using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- Desbloquea un logro (idempotente) y dice si es la PRIMERA vez, que es lo que
-- la app necesita para lanzar la celebración una sola vez.
create or replace function public.desbloquear_logro(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_nuevo boolean;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if coalesce(trim(p_codigo), '') = '' then raise exception 'Falta el código del logro'; end if;

  insert into public.logro_usuario (usuario_id, logro_codigo)
  values (v_uid, trim(p_codigo))
  on conflict (usuario_id, logro_codigo) do nothing;

  v_nuevo := found;   -- true solo si realmente insertó

  return jsonb_build_object('codigo', trim(p_codigo), 'nuevo', v_nuevo);
end $$;

-- Los logros que el usuario ya tiene (para no re-celebrar al abrir la app).
create or replace function public.mis_logros()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'codigo', logro_codigo, 'desbloqueado_en', desbloqueado_en, 'visto', visto
    ) order by desbloqueado_en)
    from public.logro_usuario where usuario_id = v_uid
  ), '[]'::jsonb);
end $$;

-- Marca como vistos los logros ya celebrados (null = todos).
create or replace function public.marcar_logros_vistos(p_codigos text[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  update public.logro_usuario set visto = true
   where usuario_id = v_uid
     and (p_codigos is null or logro_codigo = any(p_codigos));
end $$;

revoke all on function public.desbloquear_logro(text) from public, authenticated;
revoke all on function public.mis_logros() from public, authenticated;
revoke all on function public.marcar_logros_vistos(text[]) from public, authenticated;
grant execute on function public.desbloquear_logro(text) to authenticated;
grant execute on function public.mis_logros() to authenticated;
grant execute on function public.marcar_logros_vistos(text[]) to authenticated;
