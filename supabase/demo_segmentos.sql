-- Demo de segmentos: Peniel (academia) poblado + KidsFit (niños) + Jonathan Trainer.
-- Se ejecuta una vez y se borra. Impersona al dueño para usar los RPCs reales.

-- ══ Impersonar a Jonathan para que registrar_empresa/inscribir_socio funcionen ══
select set_config('request.jwt.claims',
  '{"sub":"f0102dc8-0873-44e7-b36d-94b749f8c689","role":"authenticated"}', false);

-- ═══════════════ 1. PENIEL (academia, ya existe) ═══════════════
do $$
declare
  v_sede uuid := 'b3da8ad1-e9a8-4db1-8a83-e03811d38c7b';
  v_emp uuid := '4ce02a1e-942b-4836-b41b-862d4201e754';
  v_ilim uuid := '95d280d3-4703-419b-b23b-6fcae98fc8f3';
  v_m8 uuid := 'fb748ee9-08fb-4210-b393-f32aab4ced6e';
  v_suelta uuid := '4e2fb539-80ab-4f29-a205-c349328f242c';
  r jsonb;
begin
  -- Alumnas inscritas con distintos planes y métodos de pago
  r := inscribir_socio(v_sede, 'Valeria Espinoza Cruz', '987112233', 'valeria.esp@test.com', '70112233', '1996-04-12', 'Flexibilidad', v_ilim, null, null, 'yape');
  r := inscribir_socio(v_sede, 'Camila Rodríguez Paz', '976223344', 'camila.rp@test.com', '70223344', '1999-08-25', 'Reducir estrés', v_ilim, null, null, 'tarjeta');
  r := inscribir_socio(v_sede, 'Daniela Torres Luna', '965334455', 'dani.torres@test.com', '70334455', '2001-01-30', 'Tonificar', v_m8, null, null, 'plin');
  r := inscribir_socio(v_sede, 'Fernanda Gil Rojas', '954445566', 'fer.gil@test.com', '70445566', '1993-11-08', 'Salud general', v_m8, null, null, 'efectivo');
  r := inscribir_socio(v_sede, 'Rosa Mendieta Vega', '943556677', null, null, null, 'Flexibilidad', v_suelta, null, null, 'efectivo');
  r := inscribir_socio(v_sede, 'Lucía Paredes Soto', '932667788', 'lucia.par@test.com', '70667788', '1998-06-17', 'Postura', v_ilim, null, null, 'yape');

  -- Check-ins de hoy
  perform checkin_manual(s.id, v_sede, 'entrada') from socio s
   where s.empresa_id = v_emp and s.nombre in ('Valeria Espinoza Cruz', 'Daniela Torres Luna', 'Lucía Paredes Soto');

  -- Prospectos en el embudo
  insert into lead (empresa_id, sede_id, nombre, telefono, email, fuente, etapa, nota) values
  (v_emp, v_sede, 'Andrea Salas', '911223344', 'andrea.s@test.com', 'Instagram', 'nuevo', 'Pregunta por yoga prenatal'),
  (v_emp, v_sede, 'Karen Núñez', '922334455', null, 'Página web', 'contactado', 'Quiere el plan ilimitado'),
  (v_emp, v_sede, 'Paola Vidal', '933445566', 'paola.v@test.com', 'TikTok', 'clase_prueba', 'Viene el sábado a pilates');

  -- Kardex: compra y ventas de agua/toallas
  perform registrar_mov_inventario(v_sede, p.id, 'compra', 30, 60.00) from producto p where p.empresa_id = v_emp and p.nombre like 'Agua%';
  perform registrar_mov_inventario(v_sede, p.id, 'venta', 4, 12.00) from producto p where p.empresa_id = v_emp and p.nombre like 'Agua%';

  -- Sponsor local
  insert into sponsor (empresa_id, nombre, descripcion, tipo, aporte_monto, beneficio, estado)
  values (v_emp, 'Matería Té & Snacks', 'Cafetería saludable de la cuadra', 'canje', 150, 'Descuento 10% a alumnas', 'activo');
end $$;

-- ═══════════════ 2. KIDSFIT CLUB (niños) ═══════════════
select registrar_empresa('KidsFit Club', 'kidsfit', 'ninos', 'Local Miraflores');

do $$
declare
  v_emp uuid;
  v_sede uuid;
  v_plan_mensual uuid;
  v_plan_hnos uuid;
  v_apod1 uuid; v_apod2 uuid; v_apod3 uuid;
  v_nino uuid;
  r jsonb;
begin
  select id into v_emp from empresa where slug = 'kidsfit';
  select id into v_sede from sede where empresa_id = v_emp limit 1;
  select id into v_plan_mensual from plan where empresa_id = v_emp and nombre = 'Mensual';
  select id into v_plan_hnos from plan where empresa_id = v_emp and nombre = 'Plan Hermanos';

  -- Demo: dejarlo en prueba vigente (el candado anti-abuso lo marcó vencida por ser 2do negocio)
  update suscripcion_plataforma set estado = 'prueba', trial_hasta = current_date + 30 where empresa_id = v_emp;

  -- Apoderados
  insert into apoderado (empresa_id, nombre, documento, telefono, email) values
    (v_emp, 'Marcos Rivera Díaz', '40112233', '999887766', 'marcos.rivera@test.com') returning id into v_apod1;
  insert into apoderado (empresa_id, nombre, documento, telefono, email) values
    (v_emp, 'Susana Quispe Flores', '41223344', '988776655', 'susana.q@test.com') returning id into v_apod2;
  insert into apoderado (empresa_id, nombre, documento, telefono, email) values
    (v_emp, 'Elena Castro Ruiz', '42334455', '977665544', 'elena.cr@test.com') returning id into v_apod3;

  -- Niños (hijos de Marcos: 2 hermanos con Plan Hermanos)
  r := inscribir_socio(v_sede, 'Mateo Rivera Gómez', null, null, null, '2016-03-14', 'Psicomotricidad', v_plan_hnos, null, null, 'yape');
  v_nino := (r->>'socio_id')::uuid;
  update socio set es_menor = true where id = v_nino;
  insert into apoderado_socio (apoderado_id, socio_id, empresa_id, parentesco, autorizado_recogida, es_contacto_emergencia)
  values (v_apod1, v_nino, v_emp, 'padre', true, true);

  r := inscribir_socio(v_sede, 'Luana Rivera Gómez', null, null, null, '2018-07-22', 'Baile infantil', v_plan_hnos, null, null, 'yape');
  v_nino := (r->>'socio_id')::uuid;
  update socio set es_menor = true where id = v_nino;
  insert into apoderado_socio (apoderado_id, socio_id, empresa_id, parentesco, autorizado_recogida, es_contacto_emergencia)
  values (v_apod1, v_nino, v_emp, 'padre', true, true);

  -- Hijo de Susana
  r := inscribir_socio(v_sede, 'Thiago Ramos Quispe', null, null, null, '2015-11-02', 'Karate', v_plan_mensual, null, null, 'efectivo');
  v_nino := (r->>'socio_id')::uuid;
  update socio set es_menor = true where id = v_nino;
  insert into apoderado_socio (apoderado_id, socio_id, empresa_id, parentesco, autorizado_recogida, es_contacto_emergencia)
  values (v_apod2, v_nino, v_emp, 'madre', true, true);

  -- Hija de Elena
  r := inscribir_socio(v_sede, 'Alessia Torres Castro', null, null, null, '2017-05-19', 'Mini funcional', v_plan_mensual, null, null, 'tarjeta');
  v_nino := (r->>'socio_id')::uuid;
  update socio set es_menor = true where id = v_nino;
  insert into apoderado_socio (apoderado_id, socio_id, empresa_id, parentesco, autorizado_recogida, es_contacto_emergencia)
  values (v_apod3, v_nino, v_emp, 'madre', true, true);

  -- Check-ins de hoy y prospectos
  perform checkin_manual(s.id, v_sede, 'entrada') from socio s
   where s.empresa_id = v_emp and s.nombre in ('Mateo Rivera Gómez', 'Thiago Ramos Quispe');
  insert into lead (empresa_id, sede_id, nombre, telefono, fuente, etapa, nota) values
  (v_emp, v_sede, 'Papá de gemelos (Jorge)', '966554433', 'Facebook', 'contactado', 'Pregunta si hay descuento por 2 niños'),
  (v_emp, v_sede, 'Mamá de Renata', '955443322', 'Página web', 'nuevo', 'Niña de 6 años, tímida, quiere probar');
end $$;

-- ═══════════════ 3. JONATHAN TRAINER (personal trainer) ═══════════════
select registrar_empresa('Jonathan Trainer', 'jonathantrainer', 'personal_trainer', null);

do $$
declare
  v_emp uuid;
  v_sede uuid;
  v_p12 uuid; v_p8 uuid; v_suelta uuid;
  r jsonb;
begin
  select id into v_emp from empresa where slug = 'jonathantrainer';
  select id into v_sede from sede where empresa_id = v_emp limit 1;
  select id into v_p12 from plan where empresa_id = v_emp and nombre = 'Mensual 12 sesiones';
  select id into v_p8 from plan where empresa_id = v_emp and nombre = 'Paquete 8 sesiones';
  select id into v_suelta from plan where empresa_id = v_emp and nombre = 'Sesión suelta';

  update suscripcion_plataforma set estado = 'prueba', trial_hasta = current_date + 30 where empresa_id = v_emp;

  -- Clientes con sus paquetes
  r := inscribir_socio(v_sede, 'Ricardo Palma Vega', '999111000', 'ricardo.pv@test.com', '10111222', '1990-02-10', 'Ganar masa muscular', v_p12, null, null, 'transferencia');
  r := inscribir_socio(v_sede, 'Sofía Del Águila', '988222111', 'sofia.da@test.com', '10222333', '1995-09-03', 'Bajar de peso · Fuerza', v_p8, null, null, 'yape');
  r := inscribir_socio(v_sede, 'Miguel Chávez Toro', '977333222', 'miguel.ct@test.com', '10333444', '1987-12-28', 'Rehabilitación', v_p8, null, null, 'plin');
  r := inscribir_socio(v_sede, 'Carla Bustamante', '966444333', null, null, null, 'Preparación deportiva', v_suelta, null, null, 'efectivo');

  -- Sesiones de hoy (check-ins) y prospectos desde su página
  perform checkin_manual(s.id, v_sede, 'entrada') from socio s
   where s.empresa_id = v_emp and s.nombre in ('Ricardo Palma Vega', 'Sofía Del Águila');
  insert into lead (empresa_id, sede_id, nombre, telefono, fuente, etapa, nota) values
  (v_emp, v_sede, 'Diego Fuentes', '944333222', 'Instagram', 'nuevo', 'Quiere bajar 10 kg antes de su boda (nov)'),
  (v_emp, v_sede, 'Brenda Osorio', '933222111', 'Página web', 'contactado', 'Entrenamiento en pareja con su esposo');
end $$;

-- Resumen
select e.nombre, e.slug, c.codigo as categoria, e.plan_slug,
  (select count(*) from socio s where s.empresa_id = e.id and s.deleted_at is null) as socios,
  (select count(*) from lead l where l.empresa_id = e.id) as leads,
  (select estado from suscripcion_plataforma sp where sp.empresa_id = e.id) as suscripcion
from empresa e join categoria_gym c on c.id = e.categoria_id
where e.slug in ('peniel', 'kidsfit', 'jonathantrainer')
order by e.created_at;
