-- ============================================================================
-- 16 · Row Level Security en bloque para TODAS las tablas de negocio
--
-- Patrón:
--   · Aislamiento por tenant: empresa_id = auth_empresa_id()  (claim del JWT)
--   · Aislamiento por sede (tablas con sede_id): sede_id IN (auth_sede_ids())
--   · Escritura: mismas condiciones (con WITH CHECK)
--
-- Se usan políticas permisivas para authenticated. Admin ve todas las sedes de
-- su empresa vía auth_sede_ids().
-- ============================================================================

-- Helper para reducir repetición: activa RLS + política tenant-only.
-- (No hay macros en SQL puro, así que se escriben explícitas por tabla.)

-- ── Tablas SOLO tenant (sin sede) ───────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'empresa','rol','usuario_empresa','usuario_sede','empresa_modulo',
    'apoderado','apoderado_socio','socio_medida','credencial_acceso',
    'plan','tipo_clase','plan_acceso_clase','membresia_integrante','congelamiento',
    'ejercicio','rutina','rutina_dia','rutina_ejercicio','dieta','comida',
    'promocion','sponsor','producto','inventario_sede','lead_tarea'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    -- idempotencia: eliminar policies previas de esta tabla
    execute format('drop policy if exists "%1$s_tenant" on public.%1$I;', t);
    execute format('drop policy if exists "%1$s_read" on public.%1$I;', t);
    execute format('drop policy if exists "%1$s_write" on public.%1$I;', t);
    -- empresa es especial (su columna de tenant es id, no empresa_id)
    if t = 'empresa' then
      execute format($f$
        create policy "%1$s_tenant" on public.%1$I
        for all to authenticated
        using (id = public.auth_empresa_id())
        with check (id = public.auth_empresa_id());
      $f$, t);
    elsif t = 'rol' then
      -- rol: ver roles de sistema (empresa_id null) o de la empresa activa
      execute format($f$
        create policy "%1$s_read" on public.%1$I
        for select to authenticated
        using (empresa_id is null or empresa_id = public.auth_empresa_id());
      $f$, t);
      execute format($f$
        create policy "%1$s_write" on public.%1$I
        for all to authenticated
        using (empresa_id = public.auth_empresa_id())
        with check (empresa_id = public.auth_empresa_id());
      $f$, t);
    else
      execute format($f$
        create policy "%1$s_tenant" on public.%1$I
        for all to authenticated
        using (empresa_id = public.auth_empresa_id())
        with check (empresa_id = public.auth_empresa_id());
      $f$, t);
    end if;
  end loop;
end $$;

-- ── Tablas tenant + sede ────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'sede','socio','dispositivo_acceso','checkin',
    'membresia','clase','reserva_clase',
    'lead',
    'movimiento_inventario','maquina','mantenimiento',
    'caja','movimiento_financiero','notificacion'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "%1$s_scope" on public.%1$I;', t);
    if t = 'sede' then
      -- sede: su propio id debe estar dentro de las sedes visibles
      execute format($f$
        create policy "%1$s_scope" on public.%1$I
        for all to authenticated
        using (empresa_id = public.auth_empresa_id()
               and (id in (select public.auth_sede_ids()) or public.auth_is_admin()))
        with check (empresa_id = public.auth_empresa_id());
      $f$, t);
    else
      -- tablas con columna sede_id (puede ser NULL en lead/notificacion → se permite)
      execute format($f$
        create policy "%1$s_scope" on public.%1$I
        for all to authenticated
        using (empresa_id = public.auth_empresa_id()
               and (sede_id is null
                    or sede_id in (select public.auth_sede_ids())
                    or public.auth_is_admin()))
        with check (empresa_id = public.auth_empresa_id());
      $f$, t);
    end if;
  end loop;
end $$;

-- ── usuario: cada quien ve/edita su propio perfil; staff de la empresa visible
alter table public.usuario enable row level security;

drop policy if exists "usuario_self" on public.usuario;
drop policy if exists "usuario_colegas_read" on public.usuario;

create policy "usuario_self" on public.usuario
  for all to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Ver perfiles de colaboradores de la empresa activa (para Personal, instructores, etc.)
create policy "usuario_colegas_read" on public.usuario
  for select to authenticated
  using (
    exists (
      select 1 from public.usuario_empresa ue
      where ue.usuario_id = public.usuario.id
        and ue.empresa_id = public.auth_empresa_id()
    )
  );
