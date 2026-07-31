-- Realtime en la edición fina de la rutina + en la vinculación.
--
-- POR QUÉ (auditoría de realtime, pedida por el owner):
--
-- 1. HUECO GRAVE: cuando el trainer edita un ejercicio del socio (series, reps,
--    carga, descanso, notas) escribe en `rutina_ejercicio`, tabla que NO estaba
--    en la publicación de realtime. Resultado: el socio tenía que SALIR Y VOLVER
--    a la app para ver el ajuste. Enviar la rutina sí llegaba en vivo (tabla
--    `rutina`), pero ajustarla — que es el trabajo DIARIO del trainer — no.
--
-- 2. `solicitud_vinculacion` (bandeja de aprobación, creada el 30-jul) quedó sin
--    ningún refresco: el staff no veía las solicitudes hasta recargar la página,
--    y el socio no se enteraba de que lo habían aprobado.
--
-- DECISIÓN DEL OWNER sobre el filtrado: se añade `socio_id` a `rutina_ejercicio`
-- (en vez de filtrar por empresa) para que cada socio reciba SOLO sus cambios y
-- no eventos de los demás socios del gym. Es más trabajo pero es lo correcto a
-- escala: Realtime filtra server-side por esa columna.

-- ── 1. socio_id denormalizado en rutina_ejercicio ──────────────────────────
alter table public.rutina_ejercicio
  add column if not exists socio_id uuid references public.socio(id) on delete cascade;

comment on column public.rutina_ejercicio.socio_id is
  'Denormalizado desde rutina_dia→rutina.socio_id. Existe para que Realtime pueda filtrar por socio: la app escucha solo los ejercicios de SU rutina. Lo mantiene al día el trigger trg_rutina_ejercicio_socio.';

-- Backfill de lo existente.
update public.rutina_ejercicio re
set socio_id = r.socio_id
from public.rutina_dia d
join public.rutina r on r.id = d.rutina_id
where d.id = re.rutina_dia_id and re.socio_id is null;

create index if not exists rutina_ejercicio_socio_idx
  on public.rutina_ejercicio (socio_id);

-- Trigger: mantener socio_id siempre correcto (insert y cambio de día).
create or replace function public.rutina_ejercicio_set_socio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select r.socio_id into new.socio_id
  from public.rutina_dia d
  join public.rutina r on r.id = d.rutina_id
  where d.id = new.rutina_dia_id;
  return new;
end;
$$;

drop trigger if exists trg_rutina_ejercicio_socio on public.rutina_ejercicio;
create trigger trg_rutina_ejercicio_socio
  before insert or update of rutina_dia_id on public.rutina_ejercicio
  for each row execute function public.rutina_ejercicio_set_socio();

-- ── 2. Publicación de realtime: agregar las tablas que faltaban ────────────
-- rutina_ejercicio: la edición fina del trainer (el hueco grave).
-- rutina_dia: reordenar/renombrar días de la rutina del socio.
-- solicitud_vinculacion: bandeja del staff + aviso al socio cuando lo aprueban.
--
-- checkin y aforo NO se agregan aquí: son de ALTA FRECUENCIA y su coste a escala
-- se evalúa con la auditoría de rendimiento antes de habilitarlos.
do $$
declare
  t text;
  v_tablas text[] := array['rutina_ejercicio', 'rutina_dia', 'solicitud_vinculacion'];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array v_tablas loop
    -- replica identity full: Realtime necesita la fila completa para evaluar
    -- RLS en UPDATE/DELETE y para entregar el payload al cliente.
    execute format('alter table public.%I replica identity full;', t);

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', t);
    end if;
  end loop;
end $$;
