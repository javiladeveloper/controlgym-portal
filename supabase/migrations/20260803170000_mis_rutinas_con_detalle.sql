-- "Mis rutinas" debe mostrar QUÉ tiene cada rutina, no solo el nombre.
--
-- PEDIDO del owner: "lo mismo que tiene rutinas listas... la zona Mis rutinas
-- debe salir todos los ejercicios que tiene cada rutina, luego de eso me
-- permite escoger".
--
-- Hoy `mis_rutinas` devuelve nombre + número de días, así que la persona elige
-- a ciegas entre "powermom · 2 días" y "probando · 1 días": no hay forma de
-- recordar cuál era cuál sin entrar a cada una.
--
-- Se añade un resumen por día (foco + nombres de los ejercicios) en vez de la
-- rutina completa: la lista tiene que seguir siendo liviana, y para entrenar ya
-- está `mi_rutina_libre`. Con el foco y los ejercicios se reconoce la rutina de
-- un vistazo, que es lo que se pidió.
create or replace function public.mis_rutinas()
returns jsonb
language sql
security definer
set search_path to 'public'
stable
as $$
  select coalesce(jsonb_agg(t order by t.activa desc, t.created_at desc), '[]'::jsonb)
  from (
    select rl.id, rl.nombre, rl.objetivo, rl.equipo, rl.enfoque,
           rl.activa, rl.created_at,
           (select count(*) from public.rutina_libre_dia d
             where d.rutina_libre_id = rl.id) as dias,
           -- Total de ejercicios: distingue de un vistazo una rutina real de
           -- una que se quedó a medias (el owner tenía varias vacías).
           (select count(*)
              from public.rutina_libre_dia d
              join public.rutina_libre_ejercicio e on e.rutina_libre_dia_id = d.id
             where d.rutina_libre_id = rl.id) as total_ejercicios,
           -- Resumen por día: qué se trabaja y con qué ejercicios.
           coalesce((
             select jsonb_agg(dd order by dd.dia_semana)
             from (
               select d.dia_semana,
                      d.foco,
                      coalesce((
                        select jsonb_agg(e.nombre order by e.orden)
                        from public.rutina_libre_ejercicio e
                        where e.rutina_libre_dia_id = d.id
                      ), '[]'::jsonb) as ejercicios
               from public.rutina_libre_dia d
               where d.rutina_libre_id = rl.id
             ) dd
           ), '[]'::jsonb) as detalle
    from public.rutina_libre rl
    where rl.usuario_id = auth.uid()
  ) t;
$$;

revoke all on function public.mis_rutinas() from public;
grant execute on function public.mis_rutinas() to authenticated;
