-- ============================================================================
-- 57 · Invitación con datos del colaborador (nombre, teléfono, sueldo)
--
-- El admin conoce a la persona: al invitarla puede dejar registrados su
-- nombre, teléfono y sueldo mensual. Se guardan en la invitación y se
-- aplican al perfil/vínculo cuando la persona entra con su Google
-- (o de inmediato si ya tiene cuenta).
-- ============================================================================

alter table public.invitacion add column if not exists nombre  text;
alter table public.invitacion add column if not exists telefono text;
alter table public.invitacion add column if not exists sueldo_mensual numeric(12,2);

-- ── RPC con los nuevos campos (se reemplaza la firma anterior) ──────────────
drop function if exists public.invitar_colaborador(text, text, uuid);

create or replace function public.invitar_colaborador(
  p_email text,
  p_rol_codigo text,
  p_sede_id uuid default null,
  p_nombre text default null,
  p_telefono text default null,
  p_sueldo numeric default null
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_rol uuid;
  v_id uuid;
begin
  if not public.auth_is_admin() then
    raise exception 'Solo un administrador puede invitar colaboradores';
  end if;
  select id into v_rol from public.rol
   where codigo = p_rol_codigo and (empresa_id is null or empresa_id = v_empresa)
   order by empresa_id nulls last limit 1;
  if v_rol is null then raise exception 'Rol % no existe', p_rol_codigo; end if;

  insert into public.invitacion (empresa_id, email, rol_id, sede_id, invitado_por, nombre, telefono, sueldo_mensual)
  values (v_empresa, p_email, v_rol, p_sede_id, auth.uid(), nullif(trim(p_nombre), ''), nullif(trim(p_telefono), ''), p_sueldo)
  on conflict (empresa_id, email) do update
    set rol_id = excluded.rol_id, estado = 'pendiente',
        nombre = coalesce(excluded.nombre, invitacion.nombre),
        telefono = coalesce(excluded.telefono, invitacion.telefono),
        sueldo_mensual = coalesce(excluded.sueldo_mensual, invitacion.sueldo_mensual)
  returning id into v_id;

  -- Si la persona ya tiene cuenta, vincularla y aplicar los datos de una vez
  update public.invitacion set estado = 'aceptada', aceptada_at = now()
   where id = v_id and exists (select 1 from public.usuario u where u.email = p_email);
  insert into public.usuario_empresa (usuario_id, empresa_id, rol_id, activo, sueldo_mensual)
  select u.id, v_empresa, v_rol, true, p_sueldo from public.usuario u where u.email = p_email
  on conflict (usuario_id, empresa_id) do update
    set sueldo_mensual = coalesce(excluded.sueldo_mensual, usuario_empresa.sueldo_mensual);
  update public.usuario u
     set telefono = coalesce(u.telefono, nullif(trim(p_telefono), ''))
   where u.email = p_email;

  return v_id;
end;
$$;

grant execute on function public.invitar_colaborador(text, text, uuid, text, text, numeric) to authenticated;

-- ── El primer login también aplica los datos de la invitación ───────────────
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_iniciales text;
  inv record;
begin
  v_nombre := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(new.email, '@', 1)
  );
  v_iniciales := upper(left(regexp_replace(v_nombre, '[^A-Za-zÁÉÍÓÚÑáéíóúñ ]', '', 'g'), 1));
  if position(' ' in v_nombre) > 0 then
    v_iniciales := v_iniciales || upper(substr(split_part(v_nombre, ' ', 2), 1, 1));
  end if;

  insert into public.usuario (id, nombre, email, avatar_iniciales, activo)
  values (new.id, v_nombre, new.email, v_iniciales, true)
  on conflict (id) do nothing;

  for inv in
    select * from public.invitacion where email = new.email and estado = 'pendiente'
  loop
    insert into public.usuario_empresa (usuario_id, empresa_id, rol_id, es_default, activo, sueldo_mensual)
    values (new.id, inv.empresa_id, inv.rol_id, false, true, inv.sueldo_mensual)
    on conflict (usuario_id, empresa_id) do nothing;

    if inv.sede_id is not null then
      insert into public.usuario_sede (usuario_id, empresa_id, sede_id)
      values (new.id, inv.empresa_id, inv.sede_id)
      on conflict do nothing;
    end if;

    -- Teléfono de la invitación si Google no lo trae (siempre pasa)
    update public.usuario set telefono = coalesce(telefono, inv.telefono) where id = new.id;

    update public.invitacion set estado = 'aceptada', aceptada_at = now() where id = inv.id;
  end loop;

  update public.usuario_empresa ue
     set es_default = true
   where ue.usuario_id = new.id
     and (select count(*) from public.usuario_empresa where usuario_id = new.id) = 1;

  return new;
end;
$$;
