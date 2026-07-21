-- Puente entre el catálogo del GYM (public.ejercicio) y el catálogo GLOBAL
-- (public.ejercicio_catalogo, 1369 ejercicios).
--
-- Bloqueante detectado por la app (PEDIDO 51): sin este link, una rutina que el
-- socio importa de otro gym llega solo por NOMBRE — pierde el GIF/video del gym y,
-- peor, el historial de progresión (que se ata a rutina_ejercicio_id).
--
-- Nullable a propósito: un gym puede tener ejercicios propios que no están en el
-- catálogo global ("Press en máquina Hammer del rincón"), y eso es válido.
alter table public.ejercicio add column if not exists catalogo_id uuid references public.ejercicio_catalogo(id);

comment on column public.ejercicio.catalogo_id is
  'Link al catálogo global. Permite mapear ejercicios entre gyms (rutina portable) y heredar GIF/instrucciones. Null = ejercicio propio del gym.';

create index if not exists ix_ejercicio_catalogo on public.ejercicio(catalogo_id) where catalogo_id is not null;

-- Backfill por nombre normalizado. Medido: 374 de 390 (96%) matchean.
with norm as (
  select id, lower(trim(translate(nombre,
    'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))) as n
  from public.ejercicio where catalogo_id is null
), cat as (
  select id, lower(trim(translate(coalesce(nombre_es, nombre),
    'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))) as n
  from public.ejercicio_catalogo where activo
), match as (
  select distinct on (norm.id) norm.id as ej_id, cat.id as cat_id
  from norm join cat on cat.n = norm.n
  order by norm.id, cat.id
)
update public.ejercicio e set catalogo_id = m.cat_id
from match m where e.id = m.ej_id;

-- Busca (o crea) el ejercicio del gym equivalente a uno del catálogo global.
-- Es la pieza que hace portable una rutina: al importar, cada ejercicio del socio
-- se resuelve al del gym para conservar GIF y progresión; si el gym no lo tiene,
-- se agrega a su catálogo desde el global.
create or replace function public.ejercicio_del_gym_desde_catalogo(
  p_empresa_id uuid, p_catalogo_id uuid, p_nombre text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_cat record;
  v_nom text;
begin
  if p_empresa_id is null then raise exception 'falta la empresa'; end if;

  -- 1) por link directo (lo ideal)
  if p_catalogo_id is not null then
    select id into v_id from public.ejercicio
    where empresa_id = p_empresa_id and catalogo_id = p_catalogo_id limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  -- 2) por nombre normalizado (gyms que cargaron su catálogo a mano)
  v_nom := coalesce(nullif(trim(p_nombre), ''), (
    select coalesce(nombre_es, nombre) from public.ejercicio_catalogo where id = p_catalogo_id));
  if v_nom is not null then
    select id into v_id from public.ejercicio
    where empresa_id = p_empresa_id
      and lower(trim(translate(nombre,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')))
        = lower(trim(translate(v_nom,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')))
    limit 1;
    if v_id is not null then
      if p_catalogo_id is not null then
        update public.ejercicio set catalogo_id = p_catalogo_id
        where id = v_id and catalogo_id is null;
      end if;
      return v_id;
    end if;
  end if;

  -- 3) no lo tiene: lo agregamos a su catálogo desde el global (con su media)
  if p_catalogo_id is not null then
    select coalesce(nombre_es, nombre) as nombre, grupo_muscular, gif_url, foto_url
      into v_cat
    from public.ejercicio_catalogo where id = p_catalogo_id;

    if v_cat.nombre is not null then
      insert into public.ejercicio (empresa_id, nombre, grupo_muscular, video_url, foto_url, catalogo_id)
      values (p_empresa_id, v_cat.nombre, v_cat.grupo_muscular, v_cat.gif_url, v_cat.foto_url, p_catalogo_id)
      returning id into v_id;
      return v_id;
    end if;
  end if;

  return null;
end $$;

revoke all on function public.ejercicio_del_gym_desde_catalogo(uuid, uuid, text) from public, authenticated;
grant execute on function public.ejercicio_del_gym_desde_catalogo(uuid, uuid, text) to authenticated;
