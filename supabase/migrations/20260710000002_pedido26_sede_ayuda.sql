-- PEDIDO 26 - Sedes en el bootstrap del socio + ayuda enrutada por sede.
-- Parte 1: bootstrap expone restringe_sede + sede_nombre (carnet "Valido en X").
-- Parte 2: la ayuda del socio va SOLO a los trainers de su sede si el gym usa
-- control de acceso; si no, a todos (como hoy).

-- Parte 2: trainers a los que dirigir una ayuda segun la sede del socio.
create or replace function public.trainers_para_ayuda(p_empresa uuid, p_sede uuid)
returns setof uuid language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_metodo public.metodo_checkin; v_tz text; v_hoy date;
begin
  select metodo_checkin, zona_horaria into v_metodo, v_tz from public.empresa where id = p_empresa;
  v_hoy := (now() at time zone coalesce(v_tz, 'America/Lima'))::date;
  if v_metodo is null or v_metodo in ('sin_control','boton_app') or p_sede is null then
    return query select public.staff_disponible(p_empresa, array['entrenador']);
    return;
  end if;
  return query
    select distinct ue.usuario_id
    from public.usuario_empresa ue
    join public.rol ro on ro.id = ue.rol_id
    join public.asistencia_staff a on a.empresa_id = ue.empresa_id and a.usuario_id = ue.usuario_id
      and a.fecha = v_hoy and a.salida_at is null
    where ue.empresa_id = p_empresa and ue.activo and ro.codigo = 'entrenador'
      and coalesce(
        (select c.sede_id from public.checkin c
          where c.empresa_id = p_empresa and c.usuario_id = ue.usuario_id
            and c.direccion = 'entrada' and c.resultado = 'permitido'
            and (c.ocurrido_en at time zone coalesce(v_tz,'America/Lima'))::date = v_hoy
          order by c.ocurrido_en desc limit 1),
        a.sede_id) = p_sede;
end;
$function$;
grant execute on function public.trainers_para_ayuda(uuid, uuid) to authenticated;


CREATE OR REPLACE FUNCTION public.get_mi_app_bootstrap()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                      'cobros_habilitados', exists(select 1 from public.empresa_mp mp where mp.empresa_id = e.id),
                      'restringe_sede', coalesce(e.restringe_sede, false),
                      'sede_nombre', (select se.nombre from public.sede se where se.id = s.sede_id))
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



-- Parte 2b: el trigger de push usa el enrutamiento por sede
CREATE OR REPLACE FUNCTION public.trg_solicitud_ayuda_alta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$



declare



  v_socio record;



  v_motivo text;



  v_detalle text;



  v_usuario uuid;



  v_hay_presente boolean;

  v_sede_socio uuid;

begin



  select nombre, sede_id into v_socio from public.socio where id = new.socio_id;
  v_sede_socio := coalesce(
    new.sede_id,
    (select c.sede_id from public.checkin c
      where c.empresa_id = new.empresa_id and c.socio_id = new.socio_id
        and c.direccion = 'entrada' and c.resultado = 'permitido'
        and (c.ocurrido_en at time zone coalesce((select zona_horaria from public.empresa where id=new.empresa_id),'America/Lima'))::date
            = (now() at time zone coalesce((select zona_horaria from public.empresa where id=new.empresa_id),'America/Lima'))::date
      order by c.ocurrido_en desc limit 1),
    v_socio.sede_id);

  v_sede_socio := coalesce(

    new.sede_id,

    (select c.sede_id from public.checkin c

      where c.empresa_id = new.empresa_id and c.socio_id = new.socio_id

        and c.direccion = 'entrada' and c.resultado = 'permitido'

        and (c.ocurrido_en at time zone coalesce((select zona_horaria from public.empresa where id=new.empresa_id),'America/Lima'))::date

            = (now() at time zone coalesce((select zona_horaria from public.empresa where id=new.empresa_id),'America/Lima'))::date

      order by c.ocurrido_en desc limit 1),

    v_socio.sede_id);



  v_motivo := case new.motivo



    when 'tecnica' then 'Técnica'



    when 'pr' then 'Récord (PR)'



    when 'maquina' then 'Máquina/equipo'



    else 'Ayuda' end;



  v_detalle := v_motivo



    || coalesce(' en ' || new.ejercicio_nombre, '')



    || coalesce(' · ' || new.ubicacion_texto, '');







  select exists (



    select 1



    from public.usuario_empresa ue



    join public.rol ro on ro.id = ue.rol_id



    join public.asistencia_staff a



      on a.empresa_id = ue.empresa_id and a.usuario_id = ue.usuario_id



    where ue.empresa_id = new.empresa_id and ue.activo and ro.codigo = 'entrenador'



      and a.fecha = (now() at time zone coalesce(



        (select zona_horaria from public.empresa where id = new.empresa_id), 'America/Lima'))::date



      and a.salida_at is null



  ) into v_hay_presente;







  for v_usuario in



    select public.trainers_para_ayuda(new.empresa_id, v_sede_socio)



  loop



    perform public.encolar_push(



      v_usuario,



      '🆘 ' || v_socio.nombre || ' pide ayuda',



      v_detalle || ' — toca "Voy yo" para atenderlo',



      jsonb_build_object('tipo', 'solicitud_ayuda', 'ayuda_id', new.id,



                         'socio_id', new.socio_id, 'empresa_id', new.empresa_id)



    );



  end loop;







  if not v_hay_presente then



    insert into public.notificacion (empresa_id, sede_id, tipo, titulo, subtitulo, nivel, ref_tipo, ref_id)



    values (new.empresa_id, v_socio.sede_id, 'solicitud_ayuda',



            '🆘 ' || v_socio.nombre || ' pide ayuda y no hay trainer presente',



            v_detalle || ' — no hay entrenadores con entrada marcada, apoya desde recepción',



            'warning', 'solicitud_ayuda', new.id);







    for v_usuario in



      select ue.usuario_id



      from public.usuario_empresa ue



      join public.rol ro on ro.id = ue.rol_id



      where ue.empresa_id = new.empresa_id and ue.activo



        and ro.codigo in ('admin', 'recepcion')



    loop



      perform public.encolar_push(



        v_usuario,



        '🆘 ' || v_socio.nombre || ' pide ayuda',



        v_detalle || ' — no hay trainer presente, apoya tú',



        jsonb_build_object('tipo', 'solicitud_ayuda', 'ayuda_id', new.id,



                           'socio_id', new.socio_id, 'empresa_id', new.empresa_id)



      );



    end loop;



  end if;







  perform public.llamar_push_worker();



  return new;



end;



$function$;


