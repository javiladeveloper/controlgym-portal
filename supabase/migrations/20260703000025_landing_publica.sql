-- ============================================================================
-- 25 · Landing pública por subdominio
--   · flag `landing_activa` en empresa (mostrar u ocultar la landing)
--   · get_landing_by_slug(slug): datos PÚBLICOS del gym para su landing.
--     Es SECURITY DEFINER y solo expone campos públicos (no datos sensibles).
--   · slug_disponible(slug): valida unicidad para el editor de Configuración.
-- ============================================================================

alter table public.empresa
  add column if not exists landing_activa boolean not null default true;

-- Normaliza el slug de FitCore por si viene con mayúsculas/espacios
update public.empresa set slug = lower(slug) where slug is not null;

-- Índice único case-insensitive para el slug (subdominio)
create unique index if not exists uq_empresa_slug_lower on public.empresa (lower(slug));

-- ── Datos públicos de la landing por slug (sin auth) ────────────────────────
create or replace function public.get_landing_by_slug(p_slug text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_empresa public.empresa;
  result jsonb;
begin
  select * into v_empresa from public.empresa
   where lower(slug) = lower(p_slug) and estado = 'activa' and deleted_at is null
   limit 1;

  if v_empresa.id is null or not v_empresa.landing_activa then
    return null;
  end if;

  select jsonb_build_object(
    'nombre', v_empresa.nombre,
    'slug', v_empresa.slug,
    'eslogan', v_empresa.eslogan,
    'mensaje_bienvenida', v_empresa.mensaje_bienvenida,
    'direccion', v_empresa.direccion,
    'horario_atencion', v_empresa.horario_atencion,
    'telefono', v_empresa.telefono_contacto,
    'email', v_empresa.email_contacto,
    'redes', v_empresa.redes,
    'moneda', v_empresa.moneda,
    'landing', v_empresa.landing,
    'tema', (select to_jsonb(t) - 'created_at' - 'updated_at' from public.empresa_tema t where t.empresa_id = v_empresa.id),
    'sedes', (select coalesce(jsonb_agg(jsonb_build_object(
                'nombre', s.nombre, 'direccion', s.direccion, 'telefono', s.telefono, 'foto_url', s.foto_url
              ) order by s.nombre), '[]'::jsonb)
              from public.sede s where s.empresa_id = v_empresa.id and s.activa and s.deleted_at is null),
    'planes', (select coalesce(jsonb_agg(jsonb_build_object(
                'nombre', p.nombre, 'precio', p.precio, 'unidad', p.unidad,
                'descripcion', p.descripcion, 'badge', p.badge, 'orden', p.orden
              ) order by p.orden), '[]'::jsonb)
              from public.plan p where p.empresa_id = v_empresa.id and p.activo and p.deleted_at is null),
    'clases', (select coalesce(jsonb_agg(distinct tc.nombre), '[]'::jsonb)
               from public.tipo_clase tc where tc.empresa_id = v_empresa.id)
  ) into result;

  return result;
end;
$$;

-- Ejecutable por usuarios anónimos (la landing es pública)
grant execute on function public.get_landing_by_slug(text) to anon, authenticated;

-- ── Validación de disponibilidad de slug (para el editor) ───────────────────
create or replace function public.slug_disponible(p_slug text, p_empresa_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.empresa
    where lower(slug) = lower(p_slug) and id <> p_empresa_id
  );
$$;

grant execute on function public.slug_disponible(text, uuid) to authenticated;
