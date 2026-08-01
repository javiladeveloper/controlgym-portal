-- La foto de perfil es de la PERSONA, no del gym.
--
-- REPORTADO por el owner: "mi foto está en perfil!! imagínate que si no estoy en
-- ninguna gym... entiendes?" — y tiene razón, el diseño era incoherente:
--
--   1. `subir_mi_foto` guarda la foto en `usuario` (correcto: es de la persona).
--   2. Pero la subida al Storage usa la ruta `<empresa_id>/socios/<socio_id>.jpg`,
--      que EXIGE un gym; las policies del bucket piden ser socio de esa empresa.
--   3. Y la marca SIEMPRE como 'pendiente', aunque no exista ningún gym que pueda
--      aprobarla → sin gym, la foto se queda "en revisión" PARA SIEMPRE.
--
-- La revisión existe por una razón válida: la foto sale en el carnet y (a futuro)
-- en el reconocimiento facial del molinete, así que el gym valida que sea una
-- foto de la cara y no cualquier cosa. Pero eso solo aplica si HAY un gym.
--
-- FIX: `subir_mi_foto` decide el estado según el contexto real de la persona:
--   - Con gym  → 'pendiente' (recepción la aprueba, como hasta ahora).
--   - Sin gym  → 'aprobada'  (no hay a quién pedirle permiso; es su perfil).
-- Y al vincularse a un gym más tarde, la foto vuelve a 'pendiente' para que ese
-- gym la valide antes de usarla en su carnet (lo hace el trigger de abajo).
--
-- La ruta del Storage se arregla en la app (carpeta `usuarios/<uid>.jpg`), con su
-- policy nueva aquí abajo.

-- ── 1. Estado de la foto según haya gym o no ────────────────────────────────
create or replace function public.subir_mi_foto(p_foto_url text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tiene_gym boolean;
  v_estado text;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  if coalesce(trim(p_foto_url),'') = '' then raise exception 'Falta la foto'; end if;

  -- ¿Pertenece a algún gym? Solo entonces hay alguien que pueda revisarla.
  select exists (
    select 1 from public.socio s
    where s.usuario_id = v_uid and s.deleted_at is null
  ) into v_tiene_gym;

  v_estado := case when v_tiene_gym then 'pendiente' else 'aprobada' end;

  update public.usuario
     set foto_url = p_foto_url,
         foto_estado = v_estado,
         foto_actualizada_at = now(),
         updated_at = now()
   where id = v_uid;
  if not found then raise exception 'Usuario no encontrado'; end if;

  -- Refleja la foto en las fichas de socio de sus gyms (el carnet las lee de ahí).
  update public.socio s
     set foto_url = p_foto_url,
         foto_estado = v_estado,
         foto_actualizada_at = now()
   where s.usuario_id = v_uid and s.deleted_at is null;

  return jsonb_build_object('ok', true, 'estado', v_estado);
end;
$function$;

revoke all on function public.subir_mi_foto(text) from public;
grant execute on function public.subir_mi_foto(text) to authenticated;

-- ── 2. Al entrar a un gym, su foto pasa a revisión de ESE gym ───────────────
-- Alguien sin gym tiene la foto 'aprobada' (nadie a quien pedir permiso). Si
-- luego se matricula, ese gym sí debe validarla antes de ponerla en su carnet.
create or replace function public.socio_hereda_foto_usuario()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_url text; v_estado text;
begin
  select u.foto_url, u.foto_estado into v_url, v_estado
  from public.usuario u where u.id = new.usuario_id;

  if v_url is not null and coalesce(new.foto_url,'') = '' then
    new.foto_url := v_url;
    -- Siempre 'pendiente': este gym no ha visto esa foto todavía, aunque para la
    -- persona estuviera 'aprobada' por no tener gym.
    new.foto_estado := 'pendiente';
    new.foto_actualizada_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists socio_hereda_foto on public.socio;
create trigger socio_hereda_foto
  before insert on public.socio
  for each row
  when (new.usuario_id is not null)
  execute function public.socio_hereda_foto_usuario();

-- ── 3. Storage: poder subir la foto SIN pertenecer a un gym ─────────────────
-- Ruta nueva `usuarios/<uid>.jpg` en el mismo bucket público `branding`. Las
-- policies viejas (`<empresa_id>/socios/...`) se quedan: las fotos ya subidas
-- siguen sirviéndose y el gym sigue pudiendo gestionarlas.
drop policy if exists branding_usuario_sube_su_foto on storage.objects;
create policy branding_usuario_sube_su_foto
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = 'usuarios'
    and storage.filename(name) like (auth.uid()::text || '.%')
  );

drop policy if exists branding_usuario_actualiza_su_foto on storage.objects;
create policy branding_usuario_actualiza_su_foto
  on storage.objects for update to authenticated
  using (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = 'usuarios'
    and storage.filename(name) like (auth.uid()::text || '.%')
  );

-- ── 4. Arreglar a quien ya quedó colgado ────────────────────────────────────
-- Personas SIN gym con la foto atascada en 'pendiente': nadie iba a aprobarla.
update public.usuario u
   set foto_estado = 'aprobada'
 where u.foto_url is not null
   and u.foto_estado = 'pendiente'
   and not exists (
     select 1 from public.socio s
     where s.usuario_id = u.id and s.deleted_at is null
   );
