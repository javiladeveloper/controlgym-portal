-- Task 4: get_bootstrap devuelve 'permisos'[] + RPCs de gestión de permisos.
--
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

-- get_bootstrap: recreado a partir del cuerpo vigente (via pg_get_functiondef),
-- agregando únicamente el campo 'permisos' al jsonb de retorno. Ningún otro
-- campo existente (usuario, es_superadmin, empresa_activa, rol, tema,
-- empresas, modulos, sedes) se modifica ni se elimina.
CREATE OR REPLACE FUNCTION public.get_bootstrap()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_empresa uuid := public.auth_empresa_id();
  result jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  select jsonb_build_object(
    'usuario', (
      select to_jsonb(u) - 'created_at' - 'updated_at'
      from public.usuario u where u.id = v_uid
    ),
    'es_superadmin', public.es_superadmin(),
    'empresa_activa', (
      select to_jsonb(e) from public.empresa e where e.id = v_empresa
    ),
    'rol', public.auth_rol(),
    'permisos', public.mis_permisos(),
    'tema', (
      select to_jsonb(t) - 'created_at' - 'updated_at'
      from public.empresa_tema t where t.empresa_id = v_empresa
    ),
    'empresas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'empresa_id', ue.empresa_id,
        'nombre', e.nombre,
        'rol', r.codigo,
        'es_default', ue.es_default
      )), '[]'::jsonb)
      from public.usuario_empresa ue
      join public.empresa e on e.id = ue.empresa_id
      join public.rol r on r.id = ue.rol_id
      where ue.usuario_id = v_uid and ue.activo
    ),
    'modulos', public.get_modulos_activos(),
    'sedes', (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre) order by s.nombre), '[]'::jsonb)
      from public.sede s
      where s.empresa_id = v_empresa
        and s.deleted_at is null
        and (s.id in (select public.auth_sede_ids()) or public.auth_is_admin())
    )
  ) into result;

  return result;
end;
$function$;
