-- Fix de shape: el modelo Kotlin de la app exige socio_id (obligatorio) y el
-- jsonb no lo incluia -> la deserializacion fallaba con 'No se pudo cargar las
-- ayudas' AUN con la firma corregida. Se agrega socio_id.
-- (Historia: la version anterior arreglo la firma; esta arregla el shape.)
-- Original: la app llama bandeja_ayuda(p_empresa_id) pero la RPC se
-- definió sin argumentos → PostgREST no encuentra la firma → "No se pudo
-- cargar las ayudas". Se agrega el parámetro OPCIONAL (la app calza sin
-- recompilar; llamadas sin args siguen funcionando). Si viene una empresa
-- distinta a la de la sesión, se devuelve vacío (defensa multi-tenant).
drop function if exists public.bandeja_ayuda();

create or replace function public.bandeja_ayuda(p_empresa_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_empresa uuid := public.auth_empresa_id();
  v_metodo public.metodo_checkin;
  v_tz text; v_hoy date; v_mi_sede uuid;
begin
  if v_empresa is null then return '[]'::jsonb; end if;
  -- La empresa del caller manda; un p_empresa_id ajeno no expone otro gym.
  if p_empresa_id is not null and p_empresa_id <> v_empresa then return '[]'::jsonb; end if;
  select metodo_checkin, zona_horaria into v_metodo, v_tz from public.empresa where id = v_empresa;
  v_hoy := (now() at time zone coalesce(v_tz,'America/Lima'))::date;

  -- Mi sede = mi último check-in de entrada de hoy (si el gym usa control de acceso).
  if v_metodo in ('qr_kiosco','qr_lector','biometrico') then
    select c.sede_id into v_mi_sede from public.checkin c
      where c.empresa_id = v_empresa and c.usuario_id = v_uid
        and c.direccion='entrada' and c.resultado='permitido'
        and (c.ocurrido_en at time zone coalesce(v_tz,'America/Lima'))::date = v_hoy
      order by c.ocurrido_en desc limit 1;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', sa.id, 'socio_id', sa.socio_id, 'motivo', sa.motivo, 'ejercicio_nombre', sa.ejercicio_nombre,
      'ubicacion_texto', sa.ubicacion_texto, 'mensaje_socio', sa.mensaje_socio,
      'estado', sa.estado, 'atendida_por', sa.atendida_por, 'creado_at', sa.creado_at,
      'sede_id', sa.sede_id,
      'socio', jsonb_build_object('nombre', so.nombre, 'codigo', so.codigo),
      'atiende', (select jsonb_build_object('nombre', u.nombre) from public.usuario u where u.id = sa.atendida_por)
    ) order by sa.creado_at desc)
    from public.solicitud_ayuda sa
    join public.socio so on so.id = sa.socio_id
    where sa.empresa_id = v_empresa
      and sa.estado in ('pendiente','en_camino')
      -- si el gym enruta por sede y tengo sede de hoy, solo mi sede; si no, todas.
      and (v_mi_sede is null or sa.sede_id is null or sa.sede_id = v_mi_sede)
  ), '[]'::jsonb);
end;
$function$;
grant execute on function public.bandeja_ayuda(uuid) to authenticated;
