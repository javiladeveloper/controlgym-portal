-- Arregla las RPCs que quedaron rotas tras el rename socio.objetivo/usuario.objetivo
-- -> objetivo_nota (y usuario.objetivo_id nuevo). Cambia SOLO las referencias a la
-- columna renombrada y agrega objetivo_id/objetivo_nombre donde el brief lo pide;
-- el resto del cuerpo de cada función queda idéntico al que había en producción.

-- 1) get_mi_perfil: objetivo -> objetivo_nota, + objetivo_id + objetivo_nombre.
create or replace function public.get_mi_perfil()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_perfil jsonb; v_email text;
begin
  if v_uid is null then raise exception 'usuario no autenticado'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  select jsonb_build_object(
    'id', u.id, 'nombre', u.nombre, 'email', coalesce(u.email, v_email),
    'telefono', u.telefono, 'documento', u.documento, 'objetivo_nota', u.objetivo_nota,
    'objetivo_id', u.objetivo_id,
    'objetivo_nombre', (select nombre from public.objetivo_entrenamiento o where o.id = u.objetivo_id),
    'foto_url', u.foto_url, 'foto_estado', u.foto_estado,
    'peso_kg', u.peso_kg, 'talla_m', u.talla_m, 'fecha_nacimiento', u.fecha_nacimiento
  ) into v_perfil
  from public.usuario u where u.id = v_uid;
  if v_perfil is null then
    v_perfil := jsonb_build_object('id', v_uid, 'email', v_email,
      'nombre', null, 'telefono', null, 'documento', null, 'objetivo_nota', null,
      'objetivo_id', null, 'objetivo_nombre', null,
      'foto_url', null, 'foto_estado', null, 'peso_kg', null, 'talla_m', null,
      'fecha_nacimiento', null);
  end if;
  return v_perfil;
end;
$function$;

-- 2) get_mi_app_bootstrap: en 'socio', objetivo -> objetivo_nota, + objetivo_id.
create or replace function public.get_mi_app_bootstrap()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  return jsonb_build_object(
    'gimnasios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'socio', jsonb_build_object('id', s.id, 'codigo', s.codigo, 'nombre', s.nombre, 'estado', s.estado, 'sede_id', s.sede_id, 'documento', s.documento, 'telefono', s.telefono, 'email', s.email, 'objetivo_nota', s.objetivo_nota, 'objetivo_id', s.objetivo_id, 'foto_url', s.foto_url, 'foto_estado', s.foto_estado, 'fecha_nacimiento', s.fecha_nacimiento),
        'empresa', (select jsonb_build_object('id', e.id, 'nombre', e.nombre, 'slug', e.slug, 'eslogan', e.eslogan,
                      'direccion', e.direccion, 'telefono', e.telefono_contacto, 'horario', e.horario,
                      'horario_atencion', e.horario_atencion, 'redes', e.redes, 'moneda', e.moneda, 'usa_carnet_qr', e.usa_carnet_qr,
                      -- ¿el gym cobra por app? true solo si conectó su cuenta MercadoPago.
                      -- La app usa esto para mostrar/ocultar los botones de pago y la tienda.
                      'cobros_habilitados', exists(select 1 from public.empresa_mp mp where mp.empresa_id = e.id),
                      'evento_social_activo', coalesce(e.evento_social_activo, false),
                      'evento_social', e.evento_social,
                      'restringe_sede', coalesce(e.restringe_sede, false),
                      'sede_nombre', (select se.nombre from public.sede se where se.id = s.sede_id),
                      'croquis_url', (select se.croquis_url from public.sede se where se.id = s.sede_id),
                      'unidad_peso', e.unidad_peso, 'unidad_talla', e.unidad_talla)
                    from public.empresa e where e.id = s.empresa_id),
        'tema', (select to_jsonb(t) - 'created_at' - 'updated_at' from public.empresa_tema t where t.empresa_id = s.empresa_id),
        'membresia', (select jsonb_build_object('id', m.id, 'estado', m.estado, 'fecha_fin', m.fecha_fin,
                        'plan', p.nombre, 'incluye_clases', p.incluye_clases, 'incluye_rutina', p.incluye_rutina,
                        'total', coalesce(m.precio_pagado,0) + coalesce(m.matricula_pagada,0),
                        'saldo', greatest(0, coalesce(m.precio_pagado,0) + coalesce(m.matricula_pagada,0) - coalesce(m.monto_pagado,0)))
                      from public.membresia m join public.plan p on p.id = m.plan_id
                      where m.socio_id = s.id and m.deleted_at is null
                      order by (m.estado = 'activa') desc, m.fecha_fin desc limit 1),
        'rutina_id', (select r.id from public.rutina r where r.socio_id = s.id and r.enviado_at is not null and r.activa order by r.updated_at desc limit 1),
        'dieta_id', (select d.id from public.dieta d where d.socio_id = s.id and d.enviado_at is not null and d.activa order by d.updated_at desc limit 1)
      ) order by s.created_at)
      from public.socio s
      where s.usuario_id = v_uid and s.deleted_at is null
    ), '[]'::jsonb)
  );
end;
$function$;

-- 3) actualizar_mi_perfil: mantiene firma (p_objetivo text) pero ahora escribe la nota.
create or replace function public.actualizar_mi_perfil(p_nombre text default null::text, p_telefono text default null::text, p_objetivo text default null::text, p_peso_kg numeric default null::numeric, p_talla_m numeric default null::numeric, p_fecha_nacimiento date default null::date, p_documento text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'usuario no autenticado'; end if;
  update public.usuario u
     set nombre = coalesce(p_nombre, u.nombre),
         telefono = coalesce(p_telefono, u.telefono),
         objetivo_nota = coalesce(p_objetivo, u.objetivo_nota),
         peso_kg = coalesce(p_peso_kg, u.peso_kg),
         talla_m = coalesce(p_talla_m, u.talla_m),
         fecha_nacimiento = coalesce(p_fecha_nacimiento, u.fecha_nacimiento),
         documento = coalesce(p_documento, u.documento),
         updated_at = now()
   where u.id = v_uid;
  if not found then
    insert into public.usuario (id, nombre, telefono, objetivo_nota, peso_kg, talla_m, fecha_nacimiento, documento)
    values (v_uid, coalesce(p_nombre,''), p_telefono, p_objetivo, p_peso_kg, p_talla_m, p_fecha_nacimiento, p_documento);
  end if;
  return public.get_mi_perfil();
end;
$function$;

-- 4) actualizar_mis_datos (sobrecarga de 5 params).
create or replace function public.actualizar_mis_datos(p_socio_id uuid, p_nombre text default null::text, p_telefono text default null::text, p_email text default null::text, p_objetivo text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_row socio;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;

  update public.socio s
     set nombre   = coalesce(nullif(btrim(p_nombre), ''), s.nombre),
         telefono = coalesce(p_telefono, s.telefono),
         email    = coalesce(p_email, s.email),
         objetivo_nota = coalesce(p_objetivo, s.objetivo_nota),
         updated_at = now()
   where s.id = p_socio_id
     and s.usuario_id = v_uid          -- solo el dueño de la ficha
     and s.deleted_at is null
   returning s.* into v_row;

  if v_row.id is null then
    raise exception 'No puedes editar estos datos';
  end if;

  return jsonb_build_object(
    'id', v_row.id, 'nombre', v_row.nombre, 'telefono', v_row.telefono,
    'email', v_row.email, 'objetivo_nota', v_row.objetivo_nota, 'documento', v_row.documento
  );
end;
$function$;

-- 4) actualizar_mis_datos (sobrecarga de 6 params, con fecha_nacimiento).
create or replace function public.actualizar_mis_datos(p_socio_id uuid, p_nombre text default null::text, p_telefono text default null::text, p_email text default null::text, p_objetivo text default null::text, p_fecha_nacimiento date default null::date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_row socio;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;

  update public.socio s
     set nombre   = coalesce(nullif(btrim(p_nombre), ''), s.nombre),
         telefono = coalesce(p_telefono, s.telefono),
         email    = coalesce(p_email, s.email),
         objetivo_nota = coalesce(p_objetivo, s.objetivo_nota),
         fecha_nacimiento = coalesce(p_fecha_nacimiento, s.fecha_nacimiento),
         updated_at = now()
   where s.id = p_socio_id
     and s.usuario_id = v_uid          -- solo el dueño de la ficha
     and s.deleted_at is null
   returning s.* into v_row;

  if v_row.id is null then
    raise exception 'No puedes editar estos datos';
  end if;

  return jsonb_build_object(
    'id', v_row.id, 'nombre', v_row.nombre, 'telefono', v_row.telefono,
    'email', v_row.email, 'objetivo_nota', v_row.objetivo_nota, 'documento', v_row.documento,
    'fecha_nacimiento', v_row.fecha_nacimiento
  );
end;
$function$;

-- 5) propagar_usuario_a_socio: dispara también con objetivo_id; propaga objetivo_nota + objetivo_id.
create or replace function public.propagar_usuario_a_socio()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Solo si cambió algún campo personal (evita trabajo en updates irrelevantes).
  if new.nombre is distinct from old.nombre
     or new.telefono is distinct from old.telefono
     or new.documento is distinct from old.documento
     or new.fecha_nacimiento is distinct from old.fecha_nacimiento
     or new.objetivo_nota is distinct from old.objetivo_nota
     or new.objetivo_id is distinct from old.objetivo_id
     or new.peso_kg is distinct from old.peso_kg
     or new.talla_m is distinct from old.talla_m
     or new.foto_url is distinct from old.foto_url
     or new.foto_estado is distinct from old.foto_estado then
    update public.socio s
       set nombre              = coalesce(new.nombre, s.nombre),
           telefono            = new.telefono,
           documento           = coalesce(new.documento, s.documento),
           fecha_nacimiento    = new.fecha_nacimiento,
           objetivo_nota       = new.objetivo_nota,
           objetivo_id         = new.objetivo_id,
           peso_kg             = new.peso_kg,
           talla_m             = new.talla_m,
           foto_url            = new.foto_url,
           foto_estado         = new.foto_estado,
           foto_actualizada_at = new.foto_actualizada_at
     where s.usuario_id = new.id and s.deleted_at is null;
  end if;
  return new;
end;
$function$;

-- 6) vincular_socio: propaga también objetivo_nota + objetivo_id.
create or replace function public.vincular_socio()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_email text; v_tel text; v_n int;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  select regexp_replace(coalesce(telefono, ''), '\D', '', 'g') into v_tel
  from public.usuario where id = v_uid;

  update public.socio s set usuario_id = v_uid
   where s.usuario_id is null and s.deleted_at is null
     and ((s.email is not null and lower(s.email) = v_email)
       or (coalesce(v_tel,'') <> '' and length(v_tel) >= 9
           and regexp_replace(coalesce(s.telefono,''), '\D', '', 'g') = v_tel));
  get diagnostics v_n = row_count;

  -- Propaga los datos del usuario a TODOS sus socios (incluye los recién vinculados).
  update public.socio s
     set nombre = coalesce(u.nombre, s.nombre), telefono = u.telefono,
         documento = coalesce(u.documento, s.documento), fecha_nacimiento = u.fecha_nacimiento,
         objetivo_nota = u.objetivo_nota, objetivo_id = u.objetivo_id, peso_kg = u.peso_kg, talla_m = u.talla_m,
         foto_url = u.foto_url, foto_estado = u.foto_estado, foto_actualizada_at = u.foto_actualizada_at
    from public.usuario u
   where s.usuario_id = v_uid and u.id = v_uid and s.deleted_at is null;

  return jsonb_build_object('vinculados_ahora', v_n,
    'total', (select count(*) from public.socio where usuario_id = v_uid and deleted_at is null));
end;
$function$;

-- 7) elegir_mi_objetivo: ahora escribe usuario.objetivo_id (el trigger propaga a todos
-- los socios del usuario). El push sigue usando el socio del usuario, como antes.
create or replace function public.elegir_mi_objetivo(p_objetivo_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_socio public.socio;
  v_obj public.objetivo_entrenamiento;
  v_trainer record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sin_sesion'); end if;

  -- Ficha del socio en sesión (la más vigente si tiene varias).
  select * into v_socio from public.socio s
   where s.usuario_id = v_uid and s.deleted_at is null
   order by (select max(m.fecha_fin) from public.membresia m
              where m.socio_id = s.id and m.estado='activa' and m.deleted_at is null) desc nulls last,
            s.created_at desc
   limit 1;
  if v_socio.id is null then return jsonb_build_object('ok', false, 'motivo', 'sin_socio'); end if;

  -- Validar el objetivo.
  select * into v_obj from public.objetivo_entrenamiento where id = p_objetivo_id;
  if v_obj.id is null then return jsonb_build_object('ok', false, 'motivo', 'objetivo_invalido'); end if;

  -- Guardar en el usuario (fuente de verdad); el trigger propaga a todos sus socios.
  update public.usuario set objetivo_id = p_objetivo_id, updated_at = now()
   where id = v_uid;

  -- Avisar a los entrenadores del gym del socio (los que atienden).
  for v_trainer in
    select distinct ue.usuario_id
    from public.usuario_empresa ue
    join public.rol r on r.id = ue.rol_id
    where ue.empresa_id = v_socio.empresa_id
      and ue.activo
      and r.codigo in ('entrenador','nutricionista')
  loop
    perform public.encolar_push(
      v_trainer.usuario_id,
      'Nuevo objetivo de un socio 🎯',
      v_socio.nombre || ' definió su objetivo: ' || v_obj.nombre || '. Ármale su plan.',
      jsonb_build_object('tipo','objetivo_socio','socio_id', v_socio.id::text)
    );
  end loop;

  return jsonb_build_object('ok', true, 'objetivo', v_obj.nombre);
end;
$function$;
