-- ============================================================================
-- 67 · Multi-empresa: fixes y límites del plan free
--  1) set_empresa_activa fallaba con "duplicate key uq_usuario_empresa_default"
--     (el UPDATE ponía dos defaults por un instante). Ahora es en dos pasos.
--  2) Trial: se otorga por CREADOR (email_contacto), no por cualquier
--     membresía — un recepcionista invitado a un gym no pierde su mes gratis;
--     y las empresas eliminadas no cuentan.
--  3) eliminar_empresa: borrado (soft) de un negocio creado por error.
--  4) Límite de sedes: en prueba/vencida solo 1 sede; pagando, según plan
--     (estudio/academia/niños/trainer 1 · crecimiento 3 · cadena ilimitado).
-- ============================================================================

-- ── 1) Cambio de empresa activa en dos pasos ────────────────────────────────
create or replace function public.set_empresa_activa(p_empresa_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.usuario_empresa
    where usuario_id = auth.uid() and empresa_id = p_empresa_id and activo
  ) then
    raise exception 'No perteneces a esa empresa o está inactiva';
  end if;

  -- Dos pasos: limpiar y luego marcar (el índice único parcial no tolera
  -- dos defaults ni por un instante dentro del mismo UPDATE)
  update public.usuario_empresa set es_default = false
   where usuario_id = auth.uid() and es_default;
  update public.usuario_empresa set es_default = true
   where usuario_id = auth.uid() and empresa_id = p_empresa_id;
end;
$$;

-- ── 4) Límite de sedes por suscripción ──────────────────────────────────────
create or replace function public.limite_sedes_empresa(p_empresa_id uuid)
returns int
language sql stable security definer
set search_path = public
as $$
  select case
    when sp.estado is distinct from 'activa' then 1  -- free/vencida: SOLO 1 sede
    when sp.plan_slug = 'cadena' then null           -- ilimitado
    when sp.plan_slug = 'crecimiento' then 3
    else 1                                           -- estudio, academia, niños, trainer
  end
  from public.suscripcion_plataforma sp
  where sp.empresa_id = p_empresa_id
$$;

create or replace function public.trg_check_limite_sedes()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_lim int;
  v_count int;
  v_estado text;
begin
  select public.limite_sedes_empresa(new.empresa_id) into v_lim;
  if v_lim is null then return new; end if;

  select count(*) into v_count from public.sede
   where empresa_id = new.empresa_id and deleted_at is null;

  if v_count >= v_lim then
    select estado into v_estado from public.suscripcion_plataforma where empresa_id = new.empresa_id;
    if v_estado is distinct from 'activa' then
      raise exception 'El plan gratuito incluye 1 sede. Activa tu plan (Configuración → Mi plan) para agregar más.';
    else
      raise exception 'Tu plan permite hasta % sede(s). Sube a un plan superior para agregar más.', v_lim;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sede_limite on public.sede;
create trigger trg_sede_limite
  before insert on public.sede
  for each row execute function public.trg_check_limite_sedes();

-- ── 3) Eliminar un negocio (creado por error) ───────────────────────────────
create or replace function public.eliminar_empresa(p_empresa_id uuid)
returns void
language plpgsql security invoker
set search_path = public
as $$
declare
  v_estado text;
begin
  -- Solo un admin de ESA empresa
  if not exists (
    select 1 from public.usuario_empresa ue
    join public.rol r on r.id = ue.rol_id
    where ue.usuario_id = auth.uid() and ue.empresa_id = p_empresa_id
      and ue.activo and r.codigo = 'admin'
  ) then
    raise exception 'Solo un administrador puede eliminar el negocio';
  end if;

  -- Con suscripción de pago viva no se elimina (evita cobros fantasma)
  select estado into v_estado from public.suscripcion_plataforma where empresa_id = p_empresa_id;
  if v_estado = 'activa' then
    raise exception 'Este negocio tiene una suscripción activa. Cancélala primero desde Configuración → Mi plan.';
  end if;

  update public.empresa
     set deleted_at = now(), landing_activa = false
   where id = p_empresa_id and deleted_at is null;

  update public.suscripcion_plataforma set estado = 'cancelada' where empresa_id = p_empresa_id;

  -- Quitar los vínculos: desaparece del selector de todos sus usuarios,
  -- y a quien la tenía como default se le asigna otra empresa
  delete from public.usuario_sede where empresa_id = p_empresa_id;
  delete from public.usuario_empresa where empresa_id = p_empresa_id;

  update public.usuario_empresa ue set es_default = true
   where ue.usuario_id = auth.uid()
     and not exists (select 1 from public.usuario_empresa x where x.usuario_id = auth.uid() and x.es_default)
     and ue.empresa_id = (
       select empresa_id from public.usuario_empresa
       where usuario_id = auth.uid() order by created_at limit 1
     );
end;
$$;

grant execute on function public.eliminar_empresa(uuid) to authenticated;

-- ── 2) Trial por CREADOR y sin contar empresas eliminadas ───────────────────
-- (solo cambia el cálculo de v_trial_usado; el resto es idéntico a v5)
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
  v_email text;
  v_slug text;
  v_cat uuid;
  v_rol uuid;
  v_empresa uuid;
  v_sede uuid;
  v_plan_full uuid;
  v_plan_mid uuid;
  v_plan_base uuid;
  v_plan_comercial text;
  v_trial_usado boolean;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para registrar un gimnasio';
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'El nombre del gimnasio es obligatorio';
  end if;

  v_slug := lower(trim(p_slug));
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,48}$' then
    raise exception 'Subdominio inválido: usa solo letras, números y guiones (2-49 caracteres)';
  end if;
  if exists (select 1 from public.empresa where lower(slug) = v_slug and deleted_at is null) then
    raise exception 'El subdominio "%" ya está en uso', v_slug;
  end if;

  select id into v_cat from public.categoria_gym where codigo = p_categoria_codigo;
  if v_cat is null then
    raise exception 'Categoría de gimnasio "%" no existe', p_categoria_codigo;
  end if;

  select id into v_rol from public.rol where codigo = 'admin' and es_sistema;
  select email into v_email from public.usuario where id = v_uid;

  -- ¿Ya usó su mes gratis como CREADOR de otro negocio? Solo cuentan los
  -- negocios que ÉL creó (email_contacto) y que siguen existiendo.
  select exists (
    select 1 from public.empresa e
    where e.email_contacto = v_email and e.deleted_at is null and e.id is not null
      and exists (select 1 from public.suscripcion_plataforma sp where sp.empresa_id = e.id)
  ) into v_trial_usado;

  v_plan_comercial := case p_categoria_codigo
    when 'clases' then 'academia'
    when 'ninos' then 'ninos'
    when 'personal_trainer' then 'trainer'
    else 'crecimiento'
  end;

  insert into public.empresa (nombre, slug, categoria_id, plan_slug, email_contacto, landing)
  values (trim(p_nombre), v_slug, v_cat, v_plan_comercial, v_email, jsonb_build_object(
    'hero_overlay', 0.55,
    'secciones', jsonb_build_object('planes',true,'clases',true,'sedes',true,'galeria',true,'stats',true,'mapa',true,'promociones',true,'testimonios',true)
  ))
  returning id into v_empresa;

  insert into public.suscripcion_plataforma (empresa_id, plan_slug, con_app, monto, estado, trial_hasta)
  values (
    v_empresa, v_plan_comercial, false,
    public.precio_plan(v_plan_comercial, false),
    case when v_trial_usado then 'vencida' else 'prueba' end,
    case when v_trial_usado then current_date else (current_date + 30) end
  );

  insert into public.sede (empresa_id, nombre, activa)
  values (v_empresa, coalesce(nullif(trim(p_nombre_sede), ''),
          case when p_categoria_codigo = 'personal_trainer' then 'Estudio personal' else 'Sede Principal' end), true)
  returning id into v_sede;

  update public.usuario_empresa set es_default = false where usuario_id = v_uid;
  insert into public.usuario_empresa (usuario_id, empresa_id, rol_id, es_default, activo)
  values (v_uid, v_empresa, v_rol, true, true);

  insert into public.usuario_sede (usuario_id, empresa_id, sede_id)
  values (v_uid, v_empresa, v_sede);

  -- ══════════ DATOS INICIALES (editables) según la categoría ══════════

  if p_categoria_codigo = 'personal_trainer' then
    insert into public.plan (empresa_id, nombre, precio, unidad, descripcion, incluye_rutina, orden) values
      (v_empresa, 'Sesión suelta', 40, 'dia', 'Una sesión personalizada', true, 1) returning id into v_plan_base;
    insert into public.plan (empresa_id, nombre, precio, unidad, descripcion, incluye_rutina, orden) values
      (v_empresa, 'Paquete 8 sesiones', 260, 'mes', '2 sesiones por semana', true, 2) returning id into v_plan_mid;
    insert into public.plan (empresa_id, nombre, precio, unidad, descripcion, incluye_rutina, badge, orden) values
      (v_empresa, 'Mensual 12 sesiones', 350, 'mes', '3 por semana + rutina y dieta', true, 'MAS POPULAR', 3) returning id into v_plan_full;

    insert into public.tipo_clase (empresa_id, nombre, color) values
      (v_empresa, 'Sesión personal', '#FF6B35'), (v_empresa, 'Sesión en pareja', '#2563EB');

    insert into public.plan_acceso_clase (empresa_id, plan_id, tipo_clase_id, incluido)
    select v_empresa, p.id, tc.id, true
    from public.plan p cross join public.tipo_clase tc
    where p.empresa_id = v_empresa and tc.empresa_id = v_empresa;

    insert into public.promocion (empresa_id, nombre, descripcion, canal, tipo, estado, fecha_fin)
    values (v_empresa, 'Primera sesión gratis', 'Prueba una sesión de evaluación sin costo',
            'Página web y redes', 'otro', 'activa', current_date + 60);

  else
    if p_categoria_codigo = 'clases' then
      insert into public.plan (empresa_id, nombre, precio, unidad, descripcion, dias_congelamiento_anio, incluye_clases, orden) values
        (v_empresa, 'Clase suelta', 25, 'dia', 'Una clase, sin compromiso', 0, true, 1) returning id into v_plan_base;
      insert into public.plan (empresa_id, nombre, precio, unidad, descripcion, dias_congelamiento_anio, incluye_clases, orden) values
        (v_empresa, 'Mensual 8 clases', 120, 'mes', '8 clases al mes en cualquier horario', 0, true, 2) returning id into v_plan_mid;
      insert into public.plan (empresa_id, nombre, precio, unidad, descripcion, dias_congelamiento_anio, incluye_clases, badge, orden) values
        (v_empresa, 'Ilimitado', 180, 'mes', 'Todas las clases, todos los días', 15, true, 'MAS POPULAR', 3) returning id into v_plan_full;
    elsif p_categoria_codigo = 'ninos' then
      insert into public.plan (empresa_id, nombre, precio, unidad, descripcion, cobra_matricula, precio_matricula, incluye_clases, orden) values
        (v_empresa, 'Mensual', 150, 'mes', 'Todas las actividades para tu hijo', true, 50, true, 1) returning id into v_plan_mid;
      insert into public.plan (empresa_id, nombre, precio, unidad, descripcion, cobra_matricula, precio_matricula, incluye_clases, es_familiar, max_integrantes, badge, orden) values
        (v_empresa, 'Plan Hermanos', 250, 'mes', 'Hasta 2 hermanos, matrícula única', true, 50, true, true, 2, 'MAS POPULAR', 2) returning id into v_plan_full;
      v_plan_base := v_plan_mid;
    else
      insert into public.plan (empresa_id, nombre, precio, unidad, descripcion, dias_congelamiento_anio, orden) values
        (v_empresa, 'Básico', 60, 'mes', 'Acceso a sala de máquinas', 0, 1) returning id into v_plan_base;
      insert into public.plan (empresa_id, nombre, precio, unidad, descripcion, dias_congelamiento_anio, incluye_clases, orden) values
        (v_empresa, 'Estándar', 90, 'mes', 'Sala + clases grupales', 15, true, 2) returning id into v_plan_mid;
      insert into public.plan (empresa_id, nombre, precio, unidad, descripcion, dias_congelamiento_anio, incluye_clases, incluye_rutina, badge, orden) values
        (v_empresa, 'Premium', 130, 'mes', 'Sala + clases + rutina y dieta en la app', 30, true, true, 'MAS POPULAR', 3) returning id into v_plan_full;
    end if;

    if p_categoria_codigo = 'clases' then
      insert into public.tipo_clase (empresa_id, nombre, color) values
        (v_empresa, 'Yoga', '#8B5CF6'), (v_empresa, 'Pilates', '#059669'),
        (v_empresa, 'Baile', '#E11D48'), (v_empresa, 'Stretching', '#2563EB');
    elsif p_categoria_codigo = 'ninos' then
      insert into public.tipo_clase (empresa_id, nombre, color) values
        (v_empresa, 'Psicomotricidad', '#2563EB'), (v_empresa, 'Baile infantil', '#E11D48'),
        (v_empresa, 'Karate', '#0C0A09'), (v_empresa, 'Mini funcional', '#F97316');
    else
      insert into public.tipo_clase (empresa_id, nombre, color, acceso_libre) values
        (v_empresa, 'Musculación', '#E24B4A', true);
      insert into public.tipo_clase (empresa_id, nombre, color) values
        (v_empresa, 'Funcional', '#FF6B35'), (v_empresa, 'Spinning', '#1D9E75'),
        (v_empresa, 'Yoga', '#8A93A3'), (v_empresa, 'Baile', '#141B2E');
    end if;

    insert into public.plan_acceso_clase (empresa_id, plan_id, tipo_clase_id, incluido)
    select v_empresa, p.id, tc.id,
           not (p_categoria_codigo = 'fitness' and p.id = v_plan_base and not tc.acceso_libre)
    from public.plan p cross join public.tipo_clase tc
    where p.empresa_id = v_empresa and tc.empresa_id = v_empresa;

    insert into public.clase (empresa_id, sede_id, tipo_clase_id, nombre, dia_semana, hora, cupo_max, activa)
    select v_empresa, v_sede, x.id, x.nombre, x.dia, x.hora, 15, true
    from (
      select tc.id, tc.nombre,
             (row_number() over (order by tc.nombre))::int as rn
      from public.tipo_clase tc
      where tc.empresa_id = v_empresa and not tc.acceso_libre limit 4
    ) tc2
    join lateral (
      select tc2.id, tc2.nombre,
             case tc2.rn when 1 then 1 when 2 then 2 when 3 then 3 else 6 end as dia,
             case tc2.rn when 1 then time '19:00' when 2 then time '07:00' when 3 then time '19:00' else time '09:00' end as hora
    ) x on true;

    insert into public.promocion (empresa_id, nombre, descripcion, canal, tipo, estado, fecha_fin)
    values (v_empresa, 'Primera semana gratis', 'Prueba todas nuestras clases sin costo durante 7 días',
            'Página web y redes', 'semana_gratis', 'activa', current_date + 60);

    insert into public.producto (empresa_id, nombre, categoria, precio, stock_minimo) values
      (v_empresa, 'Agua mineral 625 ml', 'Bebidas', 3, 0),
      (v_empresa, 'Bebida isotónica 500 ml', 'Bebidas', 6, 0),
      (v_empresa, 'Toalla deportiva', 'Accesorios', 25, 0);
  end if;

  return jsonb_build_object(
    'empresa_id', v_empresa, 'slug', v_slug, 'sede_id', v_sede, 'seed', true,
    'plan', v_plan_comercial, 'trial', not v_trial_usado
  );
end;
$$;
