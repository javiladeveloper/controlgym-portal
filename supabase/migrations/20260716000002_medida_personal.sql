-- Medidas personales del usuario (peso/talla), atadas a auth.uid() — no a un gym.
-- El socio lleva SU historial, visible en todos sus gimnasios (PEDIDO 41).
-- Ya aplicada en Supabase (la app la consume desde el Perfil personal).
create table if not exists public.medida_personal (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null default auth.uid(),
  fecha        date not null default current_date,
  peso_kg      numeric,
  talla_m      numeric,
  creado_at    timestamptz not null default now()
);

create index if not exists medida_personal_usuario_fecha_idx
  on public.medida_personal (usuario_id, fecha);

alter table public.medida_personal enable row level security;

drop policy if exists medida_personal_self on public.medida_personal;
create policy medida_personal_self on public.medida_personal
  for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

create or replace function public.registrar_mi_medida(p_peso_kg numeric, p_talla_m numeric)
 returns void
 language sql security definer
 set search_path to 'public'
as $function$
  insert into public.medida_personal (usuario_id, fecha, peso_kg, talla_m)
  values (auth.uid(), current_date, p_peso_kg, p_talla_m);
$function$;

grant execute on function public.registrar_mi_medida(numeric, numeric) to authenticated;

create or replace function public.mis_medidas_personales()
 returns jsonb
 language sql stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(
    jsonb_build_object('id', id, 'fecha', fecha, 'peso_kg', peso_kg, 'talla_m', talla_m)
    order by fecha asc
  ), '[]'::jsonb)
  from public.medida_personal
  where usuario_id = auth.uid();
$function$;

grant execute on function public.mis_medidas_personales() to authenticated;
