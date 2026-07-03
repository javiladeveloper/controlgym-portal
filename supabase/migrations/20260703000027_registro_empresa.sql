-- ============================================================================
-- 27 · Registro self-service de gimnasios
--   Un usuario autenticado (Google) crea su propia empresa (tenant nuevo):
--   empresa + sede inicial + membership como admin + tema default (trigger).
--   La nueva empresa queda como su empresa ACTIVA (es_default).
--   También sirve para dueños multi-gym: crear una segunda empresa.
-- ============================================================================

create or replace function public.registrar_empresa(
  p_nombre text,
  p_slug text,
  p_categoria_codigo text default 'fitness',
  p_nombre_sede text default 'Sede Principal'
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_slug text;
  v_cat uuid;
  v_rol uuid;
  v_empresa uuid;
  v_sede uuid;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para registrar un gimnasio';
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'El nombre del gimnasio es obligatorio';
  end if;

  -- Normalizar y validar slug (subdominio)
  v_slug := lower(trim(p_slug));
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,48}$' then
    raise exception 'Subdominio inválido: usa solo letras, números y guiones (2-49 caracteres)';
  end if;
  if exists (select 1 from public.empresa where lower(slug) = v_slug) then
    raise exception 'El subdominio "%" ya está en uso', v_slug;
  end if;

  select id into v_cat from public.categoria_gym where codigo = p_categoria_codigo;
  if v_cat is null then
    raise exception 'Categoría de gimnasio "%" no existe', p_categoria_codigo;
  end if;

  select id into v_rol from public.rol where codigo = 'admin' and es_sistema;

  -- Crear empresa (el trigger crea su empresa_tema con defaults)
  insert into public.empresa (nombre, slug, categoria_id, landing)
  values (trim(p_nombre), v_slug, v_cat, jsonb_build_object(
    'hero_overlay', 0.55,
    'secciones', jsonb_build_object('planes',true,'clases',true,'sedes',true,'galeria',true,'stats',true,'mapa',true)
  ))
  returning id into v_empresa;

  -- Sede inicial
  insert into public.sede (empresa_id, nombre, activa)
  values (v_empresa, coalesce(nullif(trim(p_nombre_sede), ''), 'Sede Principal'), true)
  returning id into v_sede;

  -- Membership como admin y empresa activa (es_default único por usuario)
  update public.usuario_empresa set es_default = false where usuario_id = v_uid;
  insert into public.usuario_empresa (usuario_id, empresa_id, rol_id, es_default, activo)
  values (v_uid, v_empresa, v_rol, true, true);

  insert into public.usuario_sede (usuario_id, empresa_id, sede_id)
  values (v_uid, v_empresa, v_sede);

  return jsonb_build_object('empresa_id', v_empresa, 'slug', v_slug, 'sede_id', v_sede);
end;
$$;

grant execute on function public.registrar_empresa(text, text, text, text) to authenticated;

comment on function public.registrar_empresa is
  'Registro self-service: crea un tenant nuevo (empresa+sede) y vincula al usuario actual como admin.';
