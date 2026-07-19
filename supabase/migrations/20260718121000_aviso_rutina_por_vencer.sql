-- Encola un aviso al entrenador (o admin) por cada rutina que entra en la
-- ventana de 3 días y aún no fue avisada. Idempotente: marca la rutina para
-- no repetir. Reusa el mecanismo de push existente (mismo patrón que los
-- recordatorios de vencimiento de membresía). RPC de cron: solo service_role.
create or replace function public.encolar_avisos_rutina_por_vencer()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  for r in
    select ru.id, ru.socio_id, ru.entrenador_id, ru.empresa_id, s.nombre as socio, ru.vigencia_fin
    from public.rutina ru join public.socio s on s.id = ru.socio_id
    where ru.activa and ru.vigencia_fin is not null
      and ru.vigencia_fin <= current_date + 3
      and ru.aviso_vencimiento_enviado_at is null
      and s.deleted_at is null
  loop
    -- encolar push al entrenador asignado (o admin si no hay). push_cola real =
    -- (usuario_id, titulo, cuerpo, data, creado_at, enviado_at) — sin empresa_id.
    insert into public.push_cola (usuario_id, titulo, cuerpo, data)
    select coalesce(r.entrenador_id, (select ue.usuario_id from public.usuario_empresa ue
              join public.rol rr on rr.id=ue.rol_id where ue.empresa_id=r.empresa_id and rr.codigo='admin' and ue.activo limit 1)),
           'Rutina por vencer',
           r.socio || ' — su plan vence el ' || to_char(r.vigencia_fin,'DD/MM') || '. Revisa su progreso y asígnale el siguiente.',
           jsonb_build_object('tipo','rutina_por_vencer','socio_id',r.socio_id,'rutina_id',r.id);
    update public.rutina set aviso_vencimiento_enviado_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('encolados', v_n);
end $$;
revoke all on function public.encolar_avisos_rutina_por_vencer() from public, authenticated;
grant execute on function public.encolar_avisos_rutina_por_vencer() to service_role;
