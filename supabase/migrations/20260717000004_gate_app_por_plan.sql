-- Gate de la app del socio por plan de la SEDE.
--
-- Hasta ahora `con_app` solo servía para calcular el precio: ningún RPC lo
-- consultaba, así que un gym sin la app contratada igual tenía a sus socios
-- usándola. Con el plan 'miembros' eso deja de ser aceptable — se vende
-- diciendo "tus socios no se conectan a la app", así que tiene que ser verdad.
--
-- La app del socio NO se apaga: sigue siendo gratis para él (catálogo, rutinas
-- propias, modo libre). Lo que se corta es el VÍNCULO con el gym: en un plan sin
-- app, el gym no existe para la app.

-- ¿La sede tiene la app del socio contratada?
create or replace function public.sede_con_app(p_sede_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((public.estado_suscripcion_sede(p_sede_id))->>'con_app', 'false')::boolean;
$$;
revoke all on function public.sede_con_app(uuid) from public;
grant execute on function public.sede_con_app(uuid) to authenticated, service_role;

-- vincular_socio: solo engancha socios de sedes con app. Un socio de un gym en
-- plan 'miembros' queda sin vincular → la app lo trata como usuario libre.
-- Mantiene el resto del comportamiento vigente (propagación de datos incluida).
create or replace function public.vincular_socio()
returns jsonb language plpgsql security definer set search_path = public as $$
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
           and regexp_replace(coalesce(s.telefono,''), '\D', '', 'g') = v_tel))
     and public.sede_con_app(s.sede_id);      -- ← el gym debe tener la app
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
    'total', (select count(*) from public.socio s
              where s.usuario_id = v_uid and s.deleted_at is null
                and public.sede_con_app(s.sede_id)));
end $$;

-- Un socio YA vinculado cuyo gym baja a un plan sin app deja de verlo.
--
-- El gate va en la POLICY, no en un RPC: `socio_app_self` deja al socio leer su
-- fila por PostgREST directamente (select * from socio), así que filtrar dentro
-- de un RPC no serviría de nada — la app puede saltárselo consultando la tabla.
-- La policy es el único punto por el que pasan todas las lecturas.
--
-- El staff del gym no se ve afectado: su acceso va por `socio_scope`, aparte.
drop policy if exists socio_app_self on public.socio;
create policy socio_app_self on public.socio for select to authenticated
  using (usuario_id = auth.uid() and public.sede_con_app(sede_id));
