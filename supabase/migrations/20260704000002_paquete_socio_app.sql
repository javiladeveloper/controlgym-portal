-- ============================================================================
-- 73 (20260704000002) · PAQUETE BACKEND SOCIO — para la app móvil
-- Responde al PEDIDO 1 y PEDIDO 2 de docs/APP-BACKEND-REQUESTS.md:
--   A) vincular_socio: auth.users ↔ socio (por email o teléfono)
--   B) Policies de LECTURA para el socio logueado (sus datos + su gym)
--   C) RPCs: get_mi_app_bootstrap, reservar_clase, cancelar_reserva,
--      mi_qr / validar_qr (carnet firmado)
--   D) Push: tokens FCM + cola de notificaciones + triggers (rutina/dieta
--      enviada) + job diario (vence hoy/3d, cumpleaños)
--   E) Adherencia: registro_entreno / registro_comida (+ policies)
-- El ENVÍO real FCM queda pendiente de la service account de Firebase:
-- la cola (push_cola) ya queda lista para que un worker la procese.
-- ============================================================================

-- ── A) VINCULACIÓN ──────────────────────────────────────────────────────────
-- Al primer login en la app: engancha su cuenta con su(s) registro(s) de
-- socio en cualquier gym, por email o por teléfono (solo dígitos).
create or replace function public.vincular_socio()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_tel text;
  v_n int;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  select regexp_replace(coalesce(telefono, ''), '\D', '', 'g') into v_tel
  from public.usuario where id = v_uid;

  update public.socio s
     set usuario_id = v_uid
   where s.usuario_id is null and s.deleted_at is null
     and (
       (s.email is not null and lower(s.email) = v_email)
       or (coalesce(v_tel, '') <> '' and length(v_tel) >= 9
           and regexp_replace(coalesce(s.telefono, ''), '\D', '', 'g') = v_tel)
     );
  get diagnostics v_n = row_count;

  return jsonb_build_object(
    'vinculados_ahora', v_n,
    'total', (select count(*) from public.socio where usuario_id = v_uid and deleted_at is null)
  );
end;
$$;
grant execute on function public.vincular_socio() to authenticated;

-- ── B) POLICIES DEL SOCIO (lectura de lo suyo y de su gym) ──────────────────
-- Son ADITIVAS a las del staff (policies permisivas se combinan con OR).

-- Su(s) propio(s) registro(s)
create policy socio_app_self on public.socio for select to authenticated
  using (usuario_id = auth.uid());

-- Helper reutilizable: ¿el usuario es socio de esta empresa?
create or replace function public.es_socio_de(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.socio
                  where usuario_id = auth.uid() and empresa_id = p_empresa and deleted_at is null)
$$;

create policy socio_app_membresia on public.membresia for select to authenticated
  using (exists (select 1 from public.socio s where s.id = membresia.socio_id and s.usuario_id = auth.uid()));

create policy socio_app_plan on public.plan for select to authenticated
  using (public.es_socio_de(empresa_id));

create policy socio_app_plan_acceso on public.plan_acceso_clase for select to authenticated
  using (public.es_socio_de(empresa_id));

create policy socio_app_tipo_clase on public.tipo_clase for select to authenticated
  using (public.es_socio_de(empresa_id));

create policy socio_app_clase on public.clase for select to authenticated
  using (public.es_socio_de(empresa_id));

create policy socio_app_sede on public.sede for select to authenticated
  using (public.es_socio_de(empresa_id));

create policy socio_app_empresa on public.empresa for select to authenticated
  using (public.es_socio_de(id));

create policy socio_app_tema on public.empresa_tema for select to authenticated
  using (public.es_socio_de(empresa_id));

create policy socio_app_ejercicio on public.ejercicio for select to authenticated
  using (public.es_socio_de(empresa_id));

create policy socio_app_medidas on public.socio_medida for select to authenticated
  using (exists (select 1 from public.socio s where s.id = socio_medida.socio_id and s.usuario_id = auth.uid()));

create policy socio_app_checkin on public.checkin for select to authenticated
  using (exists (select 1 from public.socio s where s.id = checkin.socio_id and s.usuario_id = auth.uid()));

-- Rutina/dieta: SOLO lo que el staff ya le envió (enviado_at)
create policy socio_app_rutina on public.rutina for select to authenticated
  using (enviado_at is not null and exists
    (select 1 from public.socio s where s.id = rutina.socio_id and s.usuario_id = auth.uid()));

create policy socio_app_rutina_dia on public.rutina_dia for select to authenticated
  using (exists (select 1 from public.rutina r join public.socio s on s.id = r.socio_id
                  where r.id = rutina_dia.rutina_id and r.enviado_at is not null and s.usuario_id = auth.uid()));

create policy socio_app_rutina_ej on public.rutina_ejercicio for select to authenticated
  using (exists (select 1 from public.rutina_dia rd
                   join public.rutina r on r.id = rd.rutina_id
                   join public.socio s on s.id = r.socio_id
                  where rd.id = rutina_ejercicio.rutina_dia_id and r.enviado_at is not null and s.usuario_id = auth.uid()));

create policy socio_app_dieta on public.dieta for select to authenticated
  using (enviado_at is not null and exists
    (select 1 from public.socio s where s.id = dieta.socio_id and s.usuario_id = auth.uid()));

create policy socio_app_comida on public.comida for select to authenticated
  using (exists (select 1 from public.dieta d join public.socio s on s.id = d.socio_id
                  where d.id = comida.dieta_id and d.enviado_at is not null and s.usuario_id = auth.uid()));

-- Sus reservas (lectura; alta/cancelación van por RPC con validaciones)
create policy socio_app_reserva on public.reserva_clase for select to authenticated
  using (exists (select 1 from public.socio s where s.id = reserva_clase.socio_id and s.usuario_id = auth.uid()));

-- ── C) RPCs DEL SOCIO ───────────────────────────────────────────────────────

-- Todo lo que la app necesita al abrir, en un solo viaje.
create or replace function public.get_mi_app_bootstrap()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  return jsonb_build_object(
    'gimnasios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'socio', jsonb_build_object('id', s.id, 'codigo', s.codigo, 'nombre', s.nombre, 'estado', s.estado, 'sede_id', s.sede_id),
        'empresa', (select jsonb_build_object('id', e.id, 'nombre', e.nombre, 'slug', e.slug, 'eslogan', e.eslogan,
                      'direccion', e.direccion, 'telefono', e.telefono_contacto, 'horario', e.horario,
                      'horario_atencion', e.horario_atencion, 'redes', e.redes, 'moneda', e.moneda)
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
$$;
grant execute on function public.get_mi_app_bootstrap() to authenticated;

-- Reservar un cupo: valida vínculo, membresía vigente, acceso del plan a esa
-- clase, día correcto y cupo disponible.
create or replace function public.reservar_clase(p_clase_id uuid, p_fecha date)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clase public.clase;
  v_socio public.socio;
  v_mem public.membresia;
  v_ocupados int;
  v_reserva uuid;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  select * into v_clase from public.clase where id = p_clase_id and activa and deleted_at is null;
  if v_clase.id is null then raise exception 'Clase no encontrada o inactiva'; end if;

  select * into v_socio from public.socio
   where usuario_id = v_uid and empresa_id = v_clase.empresa_id and deleted_at is null limit 1;
  if v_socio.id is null then raise exception 'No estás vinculado a este gimnasio'; end if;
  if v_socio.estado <> 'activo' then raise exception 'Tu registro de socio no está activo — consulta en recepción'; end if;

  if p_fecha < current_date then raise exception 'La fecha ya pasó'; end if;
  if p_fecha > current_date + 14 then raise exception 'Solo se puede reservar hasta con 2 semanas de anticipación'; end if;
  if extract(isodow from p_fecha) <> v_clase.dia_semana then
    raise exception 'Esa clase no se dicta ese día';
  end if;

  select * into v_mem from public.membresia
   where socio_id = v_socio.id and estado = 'activa' and deleted_at is null
     and fecha_fin >= p_fecha
   order by fecha_fin desc limit 1;
  if v_mem.id is null then raise exception 'Necesitas una membresía vigente para esa fecha'; end if;

  -- Acceso del plan: la clase es de área libre o está incluida en su plan
  if not exists (select 1 from public.tipo_clase tc where tc.id = v_clase.tipo_clase_id and tc.acceso_libre)
     and not exists (select 1 from public.plan_acceso_clase pac
                      where pac.plan_id = v_mem.plan_id and pac.tipo_clase_id = v_clase.tipo_clase_id and pac.incluido) then
    raise exception 'Tu plan no incluye esta clase';
  end if;

  if exists (select 1 from public.reserva_clase
              where socio_id = v_socio.id and clase_id = p_clase_id and fecha = p_fecha and estado <> 'cancelada') then
    raise exception 'Ya tienes reserva para esta clase';
  end if;

  select count(*) into v_ocupados from public.reserva_clase
   where clase_id = p_clase_id and fecha = p_fecha and estado <> 'cancelada';
  if v_clase.cupo_max is not null and v_ocupados >= v_clase.cupo_max then
    raise exception 'Clase llena (% de % cupos)', v_ocupados, v_clase.cupo_max;
  end if;

  insert into public.reserva_clase (empresa_id, sede_id, clase_id, socio_id, fecha, estado)
  values (v_clase.empresa_id, v_clase.sede_id, p_clase_id, v_socio.id, p_fecha, 'reservada')
  returning id into v_reserva;

  return jsonb_build_object('reserva_id', v_reserva, 'cupos_restantes',
    case when v_clase.cupo_max is null then null else v_clase.cupo_max - v_ocupados - 1 end);
end;
$$;
grant execute on function public.reservar_clase(uuid, date) to authenticated;

create or replace function public.cancelar_reserva(p_reserva_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.reserva_clase r set estado = 'cancelada'
   where r.id = p_reserva_id and r.estado = 'reservada' and r.fecha >= current_date
     and exists (select 1 from public.socio s where s.id = r.socio_id and s.usuario_id = auth.uid());
  if not found then raise exception 'Reserva no encontrada o ya no se puede cancelar'; end if;
end;
$$;
grant execute on function public.cancelar_reserva(uuid) to authenticated;

-- Carnet QR firmado: 'FC1.<socio>.<empresa>.<expira_epoch>.<firma hmac>'
insert into privado.secreto (clave, valor)
select 'qr_secret', encode(gen_random_bytes(32), 'hex')
where not exists (select 1 from privado.secreto where clave = 'qr_secret');

create or replace function public.mi_qr(p_empresa_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_socio public.socio;
  v_exp bigint := extract(epoch from now() + interval '7 days')::bigint;
  v_base text;
  v_firma text;
begin
  select * into v_socio from public.socio
   where usuario_id = auth.uid() and deleted_at is null
     and (p_empresa_id is null or empresa_id = p_empresa_id)
   limit 1;
  if v_socio.id is null then raise exception 'No estás vinculado como socio'; end if;

  v_base := v_socio.id || '.' || v_socio.empresa_id || '.' || v_exp;
  select encode(extensions.hmac(v_base, valor, 'sha256'), 'hex') into v_firma
  from privado.secreto where clave = 'qr_secret';

  return jsonb_build_object('qr', 'FC1.' || v_base || '.' || v_firma,
                            'socio', v_socio.nombre, 'codigo', v_socio.codigo,
                            'expira', to_timestamp(v_exp));
end;
$$;
grant execute on function public.mi_qr(uuid) to authenticated;

-- La recepción escanea el QR: valida firma + expiración y registra el check-in
-- con las mismas reglas de siempre (membresía vencida = denegado).
create or replace function public.validar_qr(p_qr text, p_sede_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_partes text[];
  v_base text;
  v_firma text;
  v_socio uuid;
begin
  v_partes := string_to_array(p_qr, '.');
  if array_length(v_partes, 1) <> 5 or v_partes[1] <> 'FC1' then
    return jsonb_build_object('resultado', 'denegado', 'motivo', 'QR inválido');
  end if;
  v_base := v_partes[2] || '.' || v_partes[3] || '.' || v_partes[4];
  select encode(extensions.hmac(v_base, valor, 'sha256'), 'hex') into v_firma
  from privado.secreto where clave = 'qr_secret';
  if v_firma is distinct from v_partes[5] then
    return jsonb_build_object('resultado', 'denegado', 'motivo', 'QR adulterado');
  end if;
  if v_partes[4]::bigint < extract(epoch from now())::bigint then
    return jsonb_build_object('resultado', 'denegado', 'motivo', 'QR expirado — que abra su app para renovarlo');
  end if;
  v_socio := v_partes[2]::uuid;
  return public.checkin_manual(v_socio, p_sede_id, 'entrada');
end;
$$;
grant execute on function public.validar_qr(text, uuid) to authenticated;

-- ── D) PUSH: tokens + cola + disparadores ───────────────────────────────────
create table if not exists public.push_token (
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  token      text not null,
  plataforma text,
  updated_at timestamptz not null default now(),
  primary key (usuario_id, token)
);
alter table public.push_token enable row level security;
create policy push_token_self on public.push_token for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- Cola: el worker (pendiente de la service account FCM) toma lo no enviado
create table if not exists public.push_cola (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null,
  titulo     text not null,
  cuerpo     text not null,
  data       jsonb not null default '{}'::jsonb,
  creado_at  timestamptz not null default now(),
  enviado_at timestamptz
);
alter table public.push_cola enable row level security; -- solo service_role/worker

create or replace function public.encolar_push(p_usuario uuid, p_titulo text, p_cuerpo text, p_data jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.push_cola (usuario_id, titulo, cuerpo, data)
  select p_usuario, p_titulo, p_cuerpo, p_data
  where p_usuario is not null
    and exists (select 1 from public.push_token where usuario_id = p_usuario);
$$;

-- "Enviar al socio" (rutina/dieta) → push al instante
create or replace function public.trg_push_envio()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_usuario uuid;
  v_gym text;
begin
  if new.enviado_at is not null and (old.enviado_at is null or old.enviado_at <> new.enviado_at) then
    select s.usuario_id, e.nombre into v_usuario, v_gym
    from public.socio s join public.empresa e on e.id = s.empresa_id
    where s.id = new.socio_id;
    if tg_table_name = 'rutina' then
      perform public.encolar_push(v_usuario, '💪 Nueva rutina', coalesce(v_gym,'Tu gym') || ' te envió tu plan de entrenamiento', jsonb_build_object('tipo','rutina','id', new.id));
    else
      perform public.encolar_push(v_usuario, '🥗 Nueva dieta', coalesce(v_gym,'Tu gym') || ' te envió tu plan de alimentación', jsonb_build_object('tipo','dieta','id', new.id));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_push_rutina on public.rutina;
create trigger trg_push_rutina after update on public.rutina
  for each row execute function public.trg_push_envio();
drop trigger if exists trg_push_dieta on public.dieta;
create trigger trg_push_dieta after update on public.dieta
  for each row execute function public.trg_push_envio();

-- Diario: vence hoy / en 3 días + cumpleaños (para socios con app)
create or replace function public.push_diario()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select s.usuario_id, s.nombre, e.nombre gym, m.fecha_fin
    from public.membresia m
    join public.socio s on s.id = m.socio_id and s.usuario_id is not null and s.deleted_at is null
    join public.empresa e on e.id = m.empresa_id
    where m.estado = 'activa' and m.deleted_at is null and m.fecha_fin in (current_date, current_date + 3)
  loop
    perform public.encolar_push(r.usuario_id,
      case when r.fecha_fin = current_date then '⏰ Tu membresía vence HOY' else '📅 Tu membresía vence en 3 días' end,
      'Renuévala en ' || r.gym || ' para seguir sin cortes 💪', jsonb_build_object('tipo','vencimiento'));
  end loop;

  for r in
    select s.usuario_id, e.nombre gym from public.socio s
    join public.empresa e on e.id = s.empresa_id
    where s.usuario_id is not null and s.estado = 'activo' and s.deleted_at is null
      and s.fecha_nacimiento is not null
      and extract(month from s.fecha_nacimiento) = extract(month from current_date)
      and extract(day from s.fecha_nacimiento) = extract(day from current_date)
  loop
    perform public.encolar_push(r.usuario_id, '🎂 ¡Feliz cumpleaños!',
      'Todo el equipo de ' || r.gym || ' te desea un gran día. ¡Ven a celebrarlo entrenando! 🎉',
      jsonb_build_object('tipo','cumple'));
  end loop;
end;
$$;

select cron.schedule('fitcontrol-push-diario', '5 15 * * *', $$select public.push_diario()$$)
where not exists (select 1 from cron.job where jobname = 'fitcontrol-push-diario');

-- ── E) ADHERENCIA (PEDIDO 2) ────────────────────────────────────────────────
create table if not exists public.registro_entreno (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresa(id) on delete cascade,
  socio_id     uuid not null references public.socio(id) on delete cascade,
  rutina_dia_id uuid references public.rutina_dia(id) on delete set null,
  fecha        date not null default current_date,
  completado   boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (socio_id, rutina_dia_id, fecha)
);
create table if not exists public.registro_comida (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  socio_id   uuid not null references public.socio(id) on delete cascade,
  comida_id  uuid references public.comida(id) on delete set null,
  fecha      date not null default current_date,
  cumplida   boolean not null default true,
  created_at timestamptz not null default now(),
  unique (socio_id, comida_id, fecha)
);
alter table public.registro_entreno enable row level security;
alter table public.registro_comida enable row level security;

-- El socio escribe LO SUYO; el staff lee lo de su gym
create policy reg_entreno_socio on public.registro_entreno for all to authenticated
  using (exists (select 1 from public.socio s where s.id = socio_id and s.usuario_id = auth.uid()))
  with check (exists (select 1 from public.socio s where s.id = socio_id and s.usuario_id = auth.uid()));
create policy reg_entreno_staff on public.registro_entreno for select to authenticated
  using (empresa_id = public.auth_empresa_id());
create policy reg_comida_socio on public.registro_comida for all to authenticated
  using (exists (select 1 from public.socio s where s.id = socio_id and s.usuario_id = auth.uid()))
  with check (exists (select 1 from public.socio s where s.id = socio_id and s.usuario_id = auth.uid()));
create policy reg_comida_staff on public.registro_comida for select to authenticated
  using (empresa_id = public.auth_empresa_id());

create index if not exists idx_reg_entreno_socio on public.registro_entreno (socio_id, fecha);
create index if not exists idx_reg_comida_socio on public.registro_comida (socio_id, fecha);
