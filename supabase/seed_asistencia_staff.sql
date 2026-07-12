-- Seed demo: horarios semanales + asistencia de julio para el staff de
-- MaximusGym, para que el cuadro "Vacaciones y permisos" se vea lleno:
-- puntos verdes (asistió, con hora), aspas rojas (le tocaba y no vino).
-- NO idempotente en turnos (usa NOT EXISTS) y asistencia con ON CONFLICT.

do $$
declare
  v_emp uuid; v_sede uuid;
begin
  select id into v_emp from empresa where nombre ilike '%maximus%';
  select id into v_sede from sede where empresa_id = v_emp and activa order by created_at limit 1;

  -- 1) Horarios semanales para quien no tiene (Lucía ya tiene Lun/Mié 07-13)
  --    María (recepción) Lun-Sáb 07-15 · Diego (trainer) Lun-Vie 06-13
  --    Jonathan Avila trainer Lun-Vie 14-21 · Andrés (nutri) Mar/Jue 09-13
  --    Carlos (admin) Lun-Vie 09-18 · Alexandra L-V 09-17 · Fiorella L-V 13-21
  --    Renato Lun-Sáb 08-14
  insert into turno_staff (empresa_id, usuario_id, sede_id, dia_semana, hora_inicio, hora_fin)
  select v_emp, x.uid::uuid, v_sede, d.dia, x.h1::time, x.h2::time
  from (values
    ('a1000001-0000-4000-8000-00000000ad70', '07:00', '15:00', array[1,2,3,4,5,6]),
    ('a1000002-0000-4000-8000-00000000ad70', '06:00', '13:00', array[1,2,3,4,5]),
    ('7b6cea9f-d691-4698-ba20-292198b5e1dd', '14:00', '21:00', array[1,2,3,4,5]),
    ('a1000004-0000-4000-8000-00000000ad70', '09:00', '13:00', array[2,4]),
    ('a1000005-0000-4000-8000-00000000ad70', '09:00', '18:00', array[1,2,3,4,5]),
    ('c1000003-0000-4000-8000-00000000ad70', '09:00', '17:00', array[1,2,3,4,5]),
    ('c1000001-0000-4000-8000-00000000ad70', '13:00', '21:00', array[1,2,3,4,5]),
    ('c1000002-0000-4000-8000-00000000ad70', '08:00', '14:00', array[1,2,3,4,5,6])
  ) as x(uid, h1, h2, dias)
  cross join lateral unnest(x.dias) as d(dia)
  where not exists (select 1 from turno_staff t where t.usuario_id = x.uid::uuid and t.empresa_id = v_emp);

  -- 2) Asistencia de julio: cada día que LE TOCABA (según su horario), ~88%
  --    de probabilidad de haber venido; entrada -10..+20 min del inicio,
  --    salida -20..+10 min del fin (15% se olvida de marcar salida).
  insert into asistencia_staff (empresa_id, sede_id, usuario_id, fecha, entrada_at, salida_at)
  select v_emp, v_sede, t.usuario_id, d::date,
    ((d::date + t.hora_inicio)::timestamp at time zone 'America/Lima')
      + make_interval(mins => (random() * 30 - 10)::int),
    case when random() < 0.85
      then ((d::date + t.hora_fin)::timestamp at time zone 'America/Lima')
        + make_interval(mins => (random() * 30 - 20)::int)
      else null end
  from generate_series('2026-07-01'::date,
        (now() at time zone 'America/Lima')::date - 1, interval '1 day') as d
  join turno_staff t on t.empresa_id = v_emp
    and t.dia_semana = extract(isodow from d)::int
  where random() < 0.88
  on conflict (empresa_id, usuario_id, fecha) do nothing;
end $$;

select 'turnos ahora: ' || count(*) from turno_staff;
select 'asistencias julio: ' || count(*) from asistencia_staff where fecha >= '2026-07-01';
