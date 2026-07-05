-- ============================================================================
-- 86 (20260704000021) · Catálogo MAESTRO global de ejercicios (herencia)
--
-- Pedido del cliente: que el banco de ejercicios crezca CON contenido genérico
-- (no vacío), PERO sin mezclar jamás lo que un gym sube con el de otros.
--
-- Diseño (aislamiento estricto):
--   · ejercicio_maestro = catálogo GLOBAL (sin empresa_id) con la media
--     genérica de arranque. Lo curamos nosotros; crece con el tiempo y
--     beneficia a todos. Solo lectura para los gyms.
--   · Cuando en un gym NACE un ejercicio nuevo (por nombre), si el maestro lo
--     tiene, se COPIA su media a la fila del gym UNA sola vez (herencia de
--     arranque). A partir de ahí esa media es del gym: si la edita, es SUYA y
--     nadie más la ve; el maestro nunca vuelve a pisarla.
--   · Lo que un gym sube (descripcion/video/foto propios) vive solo en su fila
--     `ejercicio` (empresa_id) — NUNCA toca el maestro ni a otros gyms.
-- ============================================================================

create table if not exists public.ejercicio_maestro (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null unique,
  grupo_muscular text,
  descripcion    text,
  video_url      text,
  foto_url       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Búsqueda por nombre normalizado (case-insensitive) para la herencia
create index if not exists idx_ejercicio_maestro_nombre_lower
  on public.ejercicio_maestro (lower(nombre));

alter table public.ejercicio_maestro enable row level security;

-- Todos los autenticados LEEN el maestro; solo service_role escribe (lo
-- curamos por migración/panel-admin, no los gyms)
drop policy if exists ejercicio_maestro_lectura on public.ejercicio_maestro;
create policy ejercicio_maestro_lectura on public.ejercicio_maestro
  for select to authenticated using (true);

-- ── Herencia: al insertar un ejercicio en un gym sin media, hereda del maestro
create or replace function public.trg_ejercicio_hereda_maestro()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_m public.ejercicio_maestro;
begin
  -- Solo si la fila nueva viene "vacía" de media (no pisa lo que el gym ya trae)
  if new.descripcion is null and new.video_url is null and new.foto_url is null then
    select * into v_m from public.ejercicio_maestro
     where lower(nombre) = lower(new.nombre) limit 1;
    if v_m.id is not null then
      new.descripcion    := v_m.descripcion;
      new.video_url      := v_m.video_url;
      new.foto_url       := v_m.foto_url;
      new.grupo_muscular := coalesce(new.grupo_muscular, v_m.grupo_muscular);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ejercicio_hereda_maestro on public.ejercicio;
create trigger trg_ejercicio_hereda_maestro
  before insert on public.ejercicio
  for each row execute function public.trg_ejercicio_hereda_maestro();

comment on table public.ejercicio_maestro is
  'Catálogo global de ejercicios con media genérica. Los ejercicios nuevos de cada gym heredan de aquí al nacer (por nombre); luego cada gym personaliza SU copia sin afectar a otros.';
