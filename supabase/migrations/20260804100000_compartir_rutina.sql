-- Compartir una rutina propia por enlace/QR sin publicarla a la comunidad.
--
-- El contenido se guarda CONGELADO en jsonb: si el autor edita su rutina, quien
-- ya abrió el enlace no ve cambiar el plan bajo sus pies. Además, así la página
-- pública lee UNA tabla y no cinco con permisos de invitado.
--
-- El token es aleatorio y NO el id de la rutina: con el id, cualquiera podría
-- probar identificadores para leer rutinas ajenas.
create table if not exists public.rutina_compartida (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  -- set null: si el autor borra su rutina, el enlace ya compartido sigue
  -- funcionando (el contenido está congelado aquí, no allá).
  rutina_libre_id uuid references public.rutina_libre(id) on delete set null,
  nombre text not null,
  contenido jsonb not null,
  activo boolean not null default true,
  aperturas int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists rutina_compartida_usuario_idx
  on public.rutina_compartida(usuario_id);

alter table public.rutina_compartida enable row level security;

-- El autor ve las suyas (para poder revocarlas). NADIE más lee esta tabla
-- directamente: la página pública entra por la RPC `security definer`, así un
-- invitado no puede enumerar tokens ni listar lo que comparten otros.
drop policy if exists rutina_compartida_propia on public.rutina_compartida;
create policy rutina_compartida_propia on public.rutina_compartida
  for select to authenticated
  using (usuario_id = (select auth.uid()));

-- Token corto y legible: sin caracteres ambiguos (0/O, 1/l) porque la gente los
-- dicta y los teclea. 8 caracteres de este alfabeto ≈ 2.8 billones de valores.
create or replace function public.generar_token_compartir()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('23456789abcdefghijkmnpqrstuvwxyz', (get_byte(extensions.gen_random_bytes(1), 0) % 32) + 1, 1),
    ''
  )
  from generate_series(1, 8);
$$;

-- Lee una rutina compartida. SIN SESIÓN: es lo que hace funcionar la página web
-- para quien todavía no tiene la app (que es el caso que se quiere captar).
create or replace function public.ver_rutina_compartida(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_rc record; v_autor text;
begin
  select * into v_rc from public.rutina_compartida
   where token = p_token and activo;
  if not found then
    raise exception 'Este enlace ya no está disponible';
  end if;

  select coalesce(u.nombre_publico, split_part(u.nombre, ' ', 1))
    into v_autor
  from public.usuario u where u.id = v_rc.usuario_id;

  update public.rutina_compartida
     set aperturas = aperturas + 1
   where id = v_rc.id;

  return jsonb_build_object(
    'nombre', v_rc.nombre,
    'autor', coalesce(v_autor, 'un usuario de FitCore'),
    'dias', jsonb_array_length(v_rc.contenido),
    'contenido', v_rc.contenido
  );
end;
$function$;

revoke all on function public.ver_rutina_compartida(text) from public;
grant execute on function public.ver_rutina_compartida(text) to authenticated;
-- El grant a anon es DELIBERADO y es el núcleo de la feature: sin él la página
-- pública no puede leer nada y el enlace solo sirve a quien ya tiene cuenta.
grant execute on function public.ver_rutina_compartida(text) to anon;

-- Apaga un enlace sin borrar la rutina.
create or replace function public.revocar_rutina_compartida(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;

  update public.rutina_compartida
     set activo = false
   where token = p_token and usuario_id = v_uid and activo;
  if not found then raise exception 'Ese enlace no es tuyo o ya estaba revocado'; end if;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.revocar_rutina_compartida(text) from public;
grant execute on function public.revocar_rutina_compartida(text) to authenticated;

-- ── Idempotencia a prueba de concurrencia ──────────────────────────────────
-- HALLAZGO DE LA REVISIÓN: el "¿ya existe?" y el `insert` de
-- `compartir_mi_rutina` son dos sentencias separadas. Bajo READ COMMITTED, dos
-- llamadas a la vez (doble toque del botón, o un reintento de red del cliente)
-- pueden ver ambas que no existe y ambas insertar: dos tokens activos para la
-- misma rutina, rompiendo la garantía de que compartir dos veces devuelve el
-- MISMO enlace. El test no lo detecta porque es secuencial.
--
-- El índice único lo hace imposible a nivel de BD, y la RPC captura el choque
-- para devolver el token del que ganó la carrera en vez de un error.
create unique index if not exists rutina_compartida_activa_uq
  on public.rutina_compartida(rutina_libre_id) where activo;

-- Comparte la rutina y devuelve el enlace.
create or replace function public.compartir_mi_rutina(p_rutina_libre uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rl record;
  v_token text;
  v_contenido jsonb;
  v_existente record;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;

  select * into v_rl from public.rutina_libre
   where id = p_rutina_libre and usuario_id = v_uid;
  if not found then raise exception 'Esa rutina no es tuya'; end if;

  -- IDEMPOTENTE: si ya se compartió y sigue activa, se devuelve el MISMO
  -- enlace. Sin esto, cada toque del botón generaría un token nuevo y el que
  -- la persona ya mandó por WhatsApp quedaría huérfano.
  select * into v_existente from public.rutina_compartida
   where rutina_libre_id = p_rutina_libre and usuario_id = v_uid and activo
   limit 1;
  if found then
    return jsonb_build_object(
      'ok', true, 'token', v_existente.token,
      'url', 'https://fitcorecenter.com/r/' || v_existente.token
    );
  end if;

  if not exists (
    select 1 from public.rutina_libre_dia d
    join public.rutina_libre_ejercicio e on e.rutina_libre_dia_id = d.id
    where d.rutina_libre_id = p_rutina_libre
  ) then
    raise exception 'Tu rutina no tiene ejercicios todavía';
  end if;

  -- Copia congelada: días con su foco y sus ejercicios.
  select coalesce(jsonb_agg(dd order by dd.dia_semana), '[]'::jsonb)
    into v_contenido
  from (
    select d.dia_semana, d.foco,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'nombre', e.nombre, 'series', e.series,
               'reps', e.reps, 'descanso', e.descanso
             ) order by e.orden)
             from public.rutina_libre_ejercicio e
             where e.rutina_libre_dia_id = d.id
           ), '[]'::jsonb) as ejercicios
    from public.rutina_libre_dia d
    where d.rutina_libre_id = p_rutina_libre
  ) dd;

  -- Reintento por si el token choca (improbable, pero el unique lo haría fallar).
  for i in 1..5 loop
    v_token := public.generar_token_compartir();
    exit when not exists (select 1 from public.rutina_compartida where token = v_token);
  end loop;

  -- El insert va en su propio bloque para poder capturar el choque de
  -- concurrencia del índice único (ver comentario más arriba): dos llamadas
  -- simultáneas pueden llegar hasta aquí ambas creyendo que no existe enlace.
  begin
    insert into public.rutina_compartida
      (token, usuario_id, rutina_libre_id, nombre, contenido)
    values (
      v_token, v_uid, p_rutina_libre,
      coalesce(nullif(trim(v_rl.nombre), ''), 'Rutina de FitCore'),
      v_contenido
    );
  exception when unique_violation then
    -- Otra llamada simultánea ganó la carrera: se devuelve SU token, que es lo
    -- que la idempotencia promete. Fallar aquí sería peor que compartir.
    select * into v_existente from public.rutina_compartida
     where rutina_libre_id = p_rutina_libre and activo limit 1;
    if v_existente.token is null then raise; end if;
    return jsonb_build_object(
      'ok', true, 'token', v_existente.token,
      'url', 'https://fitcorecenter.com/r/' || v_existente.token
    );
  end;

  return jsonb_build_object(
    'ok', true, 'token', v_token,
    'url', 'https://fitcorecenter.com/r/' || v_token
  );
end;
$function$;

revoke all on function public.compartir_mi_rutina(uuid) from public;
grant execute on function public.compartir_mi_rutina(uuid) to authenticated;

-- HALLAZGO MENOR de la revisión: esta función se quedó con los privilegios por
-- defecto de Postgres (ejecutable por public/anon). Hoy es inocua —no es
-- security definer ni toca datos—, pero rompe la regla del repo de que ninguna
-- función queda abierta por omisión, y un futuro `security definer` sobre ella
-- heredaría ese grant sin que nadie lo note.
revoke all on function public.generar_token_compartir() from public;
grant execute on function public.generar_token_compartir() to authenticated;
