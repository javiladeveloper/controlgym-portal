-- Meta de peso del usuario (a nivel cuenta, sin empresa). El socio se traza una
-- meta y la app le proyecta según su ritmo real de medida_personal.
create table if not exists public.meta_peso (
  id               uuid primary key default gen_random_uuid(),
  usuario_id       uuid not null default auth.uid(),
  peso_objetivo_kg numeric not null,
  peso_inicial_kg  numeric,
  fecha_inicio     date not null default current_date,
  activa           boolean not null default true,
  creado_at        timestamptz not null default now()
);

create index if not exists meta_peso_usuario_activa_idx
  on public.meta_peso (usuario_id, activa);

alter table public.meta_peso enable row level security;

drop policy if exists meta_peso_self on public.meta_peso;
create policy meta_peso_self on public.meta_peso
  for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- Define/reemplaza la meta activa. Si p_peso_inicial_kg es null, toma la última
-- medida del usuario como punto de partida.
create or replace function public.definir_mi_meta(
  p_peso_objetivo_kg numeric, p_peso_inicial_kg numeric default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_inicial numeric;
begin
  if v_uid is null then raise exception 'usuario no autenticado'; end if;
  v_inicial := coalesce(
    p_peso_inicial_kg,
    (select peso_kg from public.medida_personal
      where usuario_id = v_uid and peso_kg is not null
      order by fecha desc limit 1)
  );
  update public.meta_peso set activa = false where usuario_id = v_uid and activa;
  insert into public.meta_peso (usuario_id, peso_objetivo_kg, peso_inicial_kg)
  values (v_uid, p_peso_objetivo_kg, v_inicial);
end;
$function$;

grant execute on function public.definir_mi_meta(numeric, numeric) to authenticated;
