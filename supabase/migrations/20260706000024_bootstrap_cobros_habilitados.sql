-- La app del socio no debe mostrar botones de pago/compra si el gym NO conectó
-- su cuenta de MercadoPago (el pago fallaría: no hay a dónde mandar el dinero).
-- El backend YA rechaza el pago (crear-pago valida empresa_mp), pero la app no
-- tenía cómo saberlo antes de intentar → mala UX. Exponemos un flag en el
-- bootstrap del socio: cobros_habilitados = ¿el gym cobra por app?
--
-- Solo agrega la clave 'cobros_habilitados' dentro de cada 'empresa'; el resto
-- del bootstrap queda idéntico.

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
        'socio', jsonb_build_object('id', s.id, 'codigo', s.codigo, 'nombre', s.nombre, 'estado', s.estado, 'sede_id', s.sede_id, 'documento', s.documento, 'telefono', s.telefono, 'email', s.email, 'objetivo', s.objetivo),
        'empresa', (select jsonb_build_object('id', e.id, 'nombre', e.nombre, 'slug', e.slug, 'eslogan', e.eslogan,
                      'direccion', e.direccion, 'telefono', e.telefono_contacto, 'horario', e.horario,
                      'horario_atencion', e.horario_atencion, 'redes', e.redes, 'moneda', e.moneda, 'usa_carnet_qr', e.usa_carnet_qr,
                      -- ¿el gym cobra por app? true solo si conectó su cuenta MercadoPago.
                      -- La app usa esto para mostrar/ocultar los botones de pago y la tienda.
                      'cobros_habilitados', exists(select 1 from public.empresa_mp mp where mp.empresa_id = e.id))
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
$function$;

comment on function public.get_mi_app_bootstrap is
  'Bootstrap del socio para la app. Incluye empresa.cobros_habilitados: si es false, la app NO debe mostrar botones de pago/compra (el gym no conectó MercadoPago).';
