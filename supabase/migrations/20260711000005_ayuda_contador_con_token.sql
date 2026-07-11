-- Hardening: el contador de notificados solo cuenta trainers CON token push.
-- Antes, un trainer elegido pero sin token (sesion cerrada) contaba como
-- notificado y suprimia el respaldo a recepcion -> silencio de nuevo.

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
  v_notificados int := 0;

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



    -- Solo cuenta si el trainer PUEDE recibir el push (tiene token registrado);
    -- un trainer elegido pero deslogueado no debe suprimir el respaldo.
    if exists (select 1 from public.push_token where usuario_id = v_usuario) then
      v_notificados := v_notificados + 1;
    end if;
    perform public.encolar_push(



      v_usuario,



      '🆘 ' || v_socio.nombre || ' pide ayuda',



      v_detalle || ' — toca "Voy yo" para atenderlo',



      jsonb_build_object('tipo', 'solicitud_ayuda', 'ayuda_id', new.id,



                         'socio_id', new.socio_id, 'empresa_id', new.empresa_id)



    );



  end loop;







  -- Respaldo: dispara si NINGUN trainer fue notificado (antes dependia de
  -- v_hay_presente y un trainer 'presente' pero filtrado por sede lo suprimia).
  if v_notificados = 0 then



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
