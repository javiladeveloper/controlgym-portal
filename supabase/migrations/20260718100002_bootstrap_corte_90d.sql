-- get_mi_app_bootstrap: corte 90 días. Una sede cuya membresía venció hace más
-- de 90 días (y sin ninguna vigente) se archiva de la lista del socio. Si
-- renueva, reaparece. Sedes con membresía vigente, vencida hace ≤90 días, o sin
-- ninguna membresía todavía (socio recién creado), se conservan.
--
-- Motivación: al vencer, el gym NO desaparece (el socio necesita poder renovar
-- desde la app). Pero acumular indefinidamente todas las sedes donde alguna vez
-- tuvo membresía ensucia la lista. 90 días es la ventana de "descansé un par de
-- meses y vuelvo".
--
-- Solo cambia el WHERE del subselect de 'gimnasios'; la forma del JSON no cambia.
create or replace function public.get_mi_app_bootstrap()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  return jsonb_build_object(
    'gimnasios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'socio', jsonb_build_object('id', s.id, 'codigo', s.codigo, 'nombre', s.nombre, 'estado', s.estado, 'sede_id', s.sede_id, 'documento', s.documento, 'telefono', s.telefono, 'email', s.email, 'objetivo_nota', s.objetivo_nota, 'objetivo_id', s.objetivo_id, 'foto_url', s.foto_url, 'foto_estado', s.foto_estado, 'fecha_nacimiento', s.fecha_nacimiento),
        'empresa', (select jsonb_build_object('id', e.id, 'nombre', e.nombre, 'slug', e.slug, 'eslogan', e.eslogan,
                      'direccion', e.direccion, 'telefono', e.telefono_contacto, 'horario', e.horario,
                      'horario_atencion', e.horario_atencion, 'redes', e.redes, 'moneda', e.moneda, 'usa_carnet_qr', e.usa_carnet_qr,
                      'cobros_habilitados', exists(select 1 from public.empresa_mp mp where mp.empresa_id = e.id),
                      'evento_social_activo', coalesce(e.evento_social_activo, false),
                      'evento_social', e.evento_social,
                      'restringe_sede', coalesce(e.restringe_sede, false),
                      'sede_nombre', (select se.nombre from public.sede se where se.id = s.sede_id),
                      'croquis_url', (select se.croquis_url from public.sede se where se.id = s.sede_id),
                      'unidad_peso', e.unidad_peso, 'unidad_talla', e.unidad_talla)
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
        and public.sede_con_app(s.sede_id)
        and (
          exists (
            select 1 from public.membresia m
            where m.socio_id = s.id and m.deleted_at is null
              and m.estado = 'activa'
              and (m.fecha_fin is null or m.fecha_fin >= current_date)
          )
          or not exists (
            select 1 from public.membresia m2
            where m2.socio_id = s.id and m2.deleted_at is null and m2.fecha_fin is not null
          )
          or (
            select max(m3.fecha_fin) from public.membresia m3
            where m3.socio_id = s.id and m3.deleted_at is null
          ) >= current_date - interval '90 days'
        )
    ), '[]'::jsonb)
  );
end;
$function$;