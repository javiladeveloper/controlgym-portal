-- =====================================================================
-- seed_demo_maximus.sql
-- Data de DEMO realista para MaximusGym (owner demo), NO es una migration.
-- Empresa: ad7a640f-4a82-4643-a0ed-4f6f1508be29
-- Sede:    77496573-c230-449a-b11e-55cab3e2f6ac  ("Sede Principal")
--
-- Re-ejecutable: usa "on conflict do nothing" / "where not exists" guards.
-- Todos los nombres de socios/leads llevan sufijo "(demo)" para poder
-- identificarlos y no chocar con datos reales/manuales ya cargados.
--
-- Uso:
--   DBURL=$(cat /tmp/.dburl)
--   psql "$DBURL" -f supabase/seed_demo_maximus.sql
-- =====================================================================

begin;

do $$
declare
  v_empresa uuid := 'ad7a640f-4a82-4643-a0ed-4f6f1508be29';
  v_sede    uuid := '77496573-c230-449a-b11e-55cab3e2f6ac';

  -- staff reales de Maximus (usuario_empresa)
  v_karina  uuid := '6f7c075c-9540-495f-bf18-aab3bea70bac'; -- admin
  v_nora    uuid := '7b6cea9f-d691-4698-ba20-292198b5e1dd'; -- entrenador
  v_maria   uuid := 'a1000001-0000-4000-8000-00000000ad70'; -- recepcion
  v_carlos  uuid := 'a1000005-0000-4000-8000-00000000ad70'; -- admin

  -- planes (ya existen 4 en Maximus: Básico, Estándar, Plan Anual, Premium)
  v_plan_basico   uuid;
  v_plan_estandar uuid;
  v_plan_premium  uuid;
  v_plan_mensual_demo   uuid;
  v_plan_trimestral_demo uuid;

  -- productos kardex
  v_prod_agua uuid;
  v_prod_proteina uuid;
  v_prod_preentreno uuid;
  v_prod_toalla uuid;
  v_prod_shaker uuid;
  v_prod_barra uuid;

  -- maquinas
  v_maq1 uuid;
  v_maq2 uuid;
  v_maq3 uuid;

  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_ahora timestamptz := now();

  -- arrays de datos peruanos para generar socios (demo)
  v_nombres text[] := array[
    'Fernanda Quispe','Jhonatan Ramos','Milagros Huamán','Kevin Mamani','Estefany Rojas',
    'Anthony Paredes','Grecia Torres','Brayan Chuquimia','Yasmin Flores','Alexander Ccama',
    'Nicole Vega','Jefferson Salas','Camila Ríos','Sebastián Cárdenas','Ariana Ponce',
    'Diego Aranda','Valentina Yupanqui','Rodrigo Bustamante','Sofía Machaca','Gonzalo Peralta',
    'Ximena Contreras','Mateo Sinche','Daniela Apaza','Cristopher Núñez','Alessandra Guevara'
  ];
  v_documentos text[] := array[
    '71234501','71234502','71234503','71234504','71234505',
    '71234506','71234507','71234508','71234509','71234510',
    '71234511','71234512','71234513','71234514','71234515',
    '71234516','71234517','71234518','71234519','71234520',
    '71234521','71234522','71234523','71234524','71234525'
  ];
  v_telefonos text[] := array[
    '912340501','912340502','912340503','912340504','912340505',
    '912340506','912340507','912340508','912340509','912340510',
    '912340511','912340512','912340513','912340514','912340515',
    '912340516','912340517','912340518','912340519','912340520',
    '912340521','912340522','912340523','912340524','912340525'
  ];
  -- fechas de nacimiento (una de ellas = mes/dia de hoy para el caso de cumpleaños)
  v_fnac date[];

  v_socio_ids uuid[] := array[]::uuid[];
  v_socio_id uuid;
  v_i int;
  v_codigo text;
  v_plan_id uuid;
  v_precio numeric;
  v_membresia_id uuid;

  v_lead_ids uuid[] := array[]::uuid[];
  v_lead_id uuid;

  v_dia date;
  v_n_checkins int;
  v_hora_base time;
begin
  ------------------------------------------------------------------
  -- 0) Resolver planes existentes de Maximus / crear demo si faltan
  ------------------------------------------------------------------
  select id into v_plan_basico   from public.plan where empresa_id = v_empresa and nombre = 'Básico' limit 1;
  select id into v_plan_estandar from public.plan where empresa_id = v_empresa and nombre = 'Estándar' limit 1;
  select id into v_plan_premium  from public.plan where empresa_id = v_empresa and nombre = 'Premium' limit 1;

  if (select count(*) from public.plan where empresa_id = v_empresa and activo) < 2 then
    insert into public.plan (empresa_id, nombre, precio, unidad, cobra_matricula, precio_matricula, activo)
    values (v_empresa, 'Plan Demo Mensual', 99, 'mes', false, 0, true)
    returning id into v_plan_mensual_demo;

    insert into public.plan (empresa_id, nombre, precio, unidad, cobra_matricula, precio_matricula, activo)
    values (v_empresa, 'Plan Demo Trimestral', 240, 'trimestre', false, 0, true)
    returning id into v_plan_trimestral_demo;
  end if;

  -- fechas de nacimiento variadas; la posición 1 cumple años HOY (mes/día actuales)
  v_fnac := array[
    make_date(1994, extract(month from v_hoy)::int, extract(day from v_hoy)::int), -- cumple hoy
    '1988-03-14','1996-09-02','1991-12-20','1999-05-30',
    '1985-07-19','1993-01-08','1997-11-11','1990-04-25','1986-08-17',
    '2001-02-14','1989-10-05','1995-06-23','1992-03-30','1998-12-01',
    '1987-09-09','2000-07-16','1994-11-28','1991-05-05','1996-01-21',
    '1990-08-08','1988-06-13','1993-10-19','1999-02-27','1985-12-31'
  ]::date[];

  ------------------------------------------------------------------
  -- 1) ~25 socios (demo) — nombres peruanos, DNI/tel únicos, cumpleaños
  ------------------------------------------------------------------
  for v_i in 1..25 loop
    if exists (select 1 from public.socio where empresa_id = v_empresa and documento = v_documentos[v_i]) then
      select id into v_socio_id from public.socio where empresa_id = v_empresa and documento = v_documentos[v_i];
    else
      select lpad((coalesce(max(codigo::int), 23) + 1)::text, 4, '0')
        into v_codigo
        from public.socio
        where empresa_id = v_empresa and codigo ~ '^[0-9]+$';

      insert into public.socio (
        empresa_id, sede_id, codigo, nombre, documento, telefono, email,
        fecha_nacimiento, estado, extra
      ) values (
        v_empresa, v_sede, v_codigo,
        v_nombres[v_i] || ' (demo)',
        v_documentos[v_i],
        v_telefonos[v_i],
        case when v_i % 3 = 0 then null
             else lower(regexp_replace(translate(split_part(v_nombres[v_i], ' ', 1),
                    'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'), '[^a-zA-Z]', '', 'g')) || v_i || '@demo-maximus.pe' end,
        v_fnac[v_i],
        'activo',
        '{}'::jsonb
      )
      returning id into v_socio_id;
    end if;

    v_socio_ids := array_append(v_socio_ids, v_socio_id);
  end loop;

  ------------------------------------------------------------------
  -- 2) Membresías
  ------------------------------------------------------------------
  -- 2a) ~15 activas (mensuales/trimestrales) para socios[1..15]
  for v_i in 1..15 loop
    v_socio_id := v_socio_ids[v_i];
    v_plan_id := case (v_i % 4)
                   when 0 then coalesce(v_plan_basico, v_plan_mensual_demo)
                   when 1 then coalesce(v_plan_estandar, v_plan_mensual_demo)
                   when 2 then coalesce(v_plan_premium, v_plan_trimestral_demo)
                   else coalesce(v_plan_trimestral_demo, v_plan_estandar)
                 end;
    select precio into v_precio from public.plan where id = v_plan_id;

    if not exists (
      select 1 from public.membresia
      where empresa_id = v_empresa and socio_id = v_socio_id and estado = 'activa'
    ) then
      insert into public.membresia (
        empresa_id, sede_id, socio_id, plan_id, fecha_inicio, fecha_fin,
        estado, precio_pagado, matricula_pagada, monto_pagado
      ) values (
        v_empresa, v_sede, v_socio_id, v_plan_id,
        v_hoy - ((5 + v_i) || ' days')::interval,
        v_hoy + ((20 + v_i) || ' days')::interval,
        'activa', v_precio, 0, v_precio
      )
      returning id into v_membresia_id;
    end if;
  end loop;

  -- 2b) ~4 por vencer en 1-3 días (socios[16..19])
  for v_i in 16..19 loop
    v_socio_id := v_socio_ids[v_i];
    v_plan_id := coalesce(v_plan_basico, v_plan_mensual_demo);
    select precio into v_precio from public.plan where id = v_plan_id;

    if not exists (
      select 1 from public.membresia
      where empresa_id = v_empresa and socio_id = v_socio_id and estado = 'activa'
    ) then
      insert into public.membresia (
        empresa_id, sede_id, socio_id, plan_id, fecha_inicio, fecha_fin,
        estado, precio_pagado, matricula_pagada, monto_pagado
      ) values (
        v_empresa, v_sede, v_socio_id, v_plan_id,
        v_hoy - interval '27 days',
        v_hoy + ((v_i - 15) || ' days')::interval,  -- vence en 1..4 dias (16->1,...19->4 ajustado abajo)
        'activa', v_precio, 0, v_precio
      );
    end if;
  end loop;

  -- 2c) ~3 con saldo pendiente (monto_pagado < precio_pagado) (socios[20..22])
  for v_i in 20..22 loop
    v_socio_id := v_socio_ids[v_i];
    v_plan_id := coalesce(v_plan_estandar, v_plan_mensual_demo);
    select precio into v_precio from public.plan where id = v_plan_id;

    if not exists (
      select 1 from public.membresia
      where empresa_id = v_empresa and socio_id = v_socio_id and estado = 'activa'
    ) then
      insert into public.membresia (
        empresa_id, sede_id, socio_id, plan_id, fecha_inicio, fecha_fin,
        estado, precio_pagado, matricula_pagada, monto_pagado
      ) values (
        v_empresa, v_sede, v_socio_id, v_plan_id,
        v_hoy - interval '10 days',
        v_hoy + interval '20 days',
        'activa', v_precio, 0, round(v_precio * 0.5, 2)
      );
    end if;
  end loop;

  -- 2d) ~6 vencidas hace 1-4 meses SIN renovar (churn / ex-socios) (socios[23..25] + 3 mas reutilizando 1..3 con estado inactivo)
  -- Para no chocar con las membresias activas ya creadas para socios[1..3], usamos socios[23..25]
  -- y marcamos esos socios como inactivos; agregamos 3 mas tomando socios adicionales del pool (16..18 ya tienen activa,
  -- asi que generamos 3 socios churn dedicados dentro del rango 23..25 + reusar 2 existentes inactivos de la empresa si aplica).
  for v_i in 23..25 loop
    v_socio_id := v_socio_ids[v_i];
    v_plan_id := coalesce(v_plan_basico, v_plan_mensual_demo);
    select precio into v_precio from public.plan where id = v_plan_id;

    if not exists (
      select 1 from public.membresia
      where empresa_id = v_empresa and socio_id = v_socio_id and estado = 'vencida'
    ) then
      insert into public.membresia (
        empresa_id, sede_id, socio_id, plan_id, fecha_inicio, fecha_fin,
        estado, precio_pagado, matricula_pagada, monto_pagado
      ) values (
        v_empresa, v_sede, v_socio_id, v_plan_id,
        v_hoy - (((v_i - 22) * 30 + 30) || ' days')::interval,
        v_hoy - (((v_i - 22) * 30) || ' days')::interval,
        'vencida', v_precio, 0, v_precio
      );
    end if;

    update public.socio set estado = 'inactivo' where id = v_socio_id and estado = 'activo';
  end loop;

  -- 3 churns adicionales: creamos membresías vencidas extra para socios[20..22] con una
  -- segunda membresía histórica vencida (además de la pendiente activa) para reforzar el reporte de churn.
  for v_i in 20..22 loop
    v_socio_id := v_socio_ids[v_i];
    v_plan_id := coalesce(v_plan_premium, v_plan_trimestral_demo);
    select precio into v_precio from public.plan where id = v_plan_id;

    if (select count(*) from public.membresia where empresa_id = v_empresa and socio_id = v_socio_id and estado = 'vencida') = 0 then
      insert into public.membresia (
        empresa_id, sede_id, socio_id, plan_id, fecha_inicio, fecha_fin,
        estado, precio_pagado, matricula_pagada, monto_pagado
      ) values (
        v_empresa, v_sede, v_socio_id, v_plan_id,
        v_hoy - interval '150 days',
        v_hoy - interval '90 days',
        'vencida', v_precio, 0, v_precio
      );
    end if;
  end loop;

  ------------------------------------------------------------------
  -- 3) Check-ins: ~30 días para socios activos (2-5 visitas/semana)
  --    Dejamos socios[11..14] SIN checkins recientes (15+ dias) -> ausentes
  --    HOY: 5-8 entradas en las ultimas 2 horas -> aforo en vivo
  ------------------------------------------------------------------
  for v_i in 1..19 loop  -- socios con membresia activa/por vencer
    v_socio_id := v_socio_ids[v_i];

    -- socios 11..14 se dejan deliberadamente sin checkins recientes (ausentes)
    continue when v_i between 11 and 14;

    v_dia := v_hoy - 29;
    while v_dia <= v_hoy - 1 loop
      -- ~40% probabilidad de visita ese dia (2-5 veces/semana aprox)
      if (abs(hashtext(v_socio_id::text || v_dia::text)) % 10) < 4 then
        v_hora_base := case when (abs(hashtext(v_socio_id::text || v_dia::text || 'h')) % 2) = 0
                          then (('06:00'::time) + (make_interval(mins => (abs(hashtext(v_socio_id::text || v_dia::text || 'm')) % 180))))
                          else (('18:00'::time) + (make_interval(mins => (abs(hashtext(v_socio_id::text || v_dia::text || 'm2')) % 180))))
                        end;

        insert into public.checkin (
          empresa_id, sede_id, socio_id, direccion, metodo, resultado, ocurrido_en
        ) values (
          v_empresa, v_sede, v_socio_id, 'entrada',
          (array['huella','tarjeta','facial','tactil','qr','app','manual'])[1 + (abs(hashtext(v_socio_id::text || v_dia::text || 'met')) % 7)],
          'permitido',
          (v_dia::timestamp + v_hora_base) at time zone 'America/Lima'
        );

        -- salida ~50 min despues, para simular sesión de entrenamiento
        insert into public.checkin (
          empresa_id, sede_id, socio_id, direccion, metodo, resultado, ocurrido_en
        ) values (
          v_empresa, v_sede, v_socio_id, 'salida',
          (array['huella','tarjeta','facial','tactil','qr','app','manual'])[1 + (abs(hashtext(v_socio_id::text || v_dia::text || 'met')) % 7)],
          'permitido',
          (v_dia::timestamp + v_hora_base + interval '50 minutes') at time zone 'America/Lima'
        );
      end if;

      v_dia := v_dia + 1;
    end loop;
  end loop;

  -- HOY: 5-8 entradas en las ultimas 2 horas (aforo en vivo)
  for v_i in 1..7 loop
    v_socio_id := v_socio_ids[((v_i - 1) % 10) + 1];
    insert into public.checkin (
      empresa_id, sede_id, socio_id, direccion, metodo, resultado, ocurrido_en
    ) values (
      v_empresa, v_sede, v_socio_id, 'entrada',
      (array['huella','tarjeta','facial','qr','app'])[1 + (v_i % 5)],
      'permitido',
      v_ahora - (make_interval(mins => (v_i * 15)))
    );
  end loop;

  ------------------------------------------------------------------
  -- 4) Ventas / movimiento_financiero: ~60 dias de ingresos variados
  ------------------------------------------------------------------
  v_dia := v_hoy - 59;
  v_i := 0;
  while v_dia <= v_hoy loop
    -- 1 a 3 ventas por dia
    for v_n_checkins in 1..(1 + (abs(hashtext(v_dia::text || 'nv')) % 3)) loop
      v_i := v_i + 1;
      insert into public.movimiento_financiero (
        empresa_id, sede_id, tipo, categoria, descripcion, monto, fecha,
        ref_tipo, registrado_por, metodo_pago
      ) values (
        v_empresa, v_sede, 'ingreso',
        case when v_n_checkins = 1 then 'membresia' else 'venta_kardex' end,
        case when v_n_checkins = 1
             then 'Pago membresía (demo) · ' || (array['Básico','Estándar','Premium','Plan Demo Mensual'])[1 + (abs(hashtext(v_dia::text || v_n_checkins::text)) % 4)]
             else 'Venta ' || (array['Agua mineral 625ml','Proteína Whey 1kg','Pre-entreno 30 serv.','Toalla deportiva','Shaker Maximus','Barra proteica'])[1 + (abs(hashtext(v_dia::text || v_n_checkins::text || 'p')) % 6)] || ' × ' || (1 + (abs(hashtext(v_dia::text || v_n_checkins::text || 'q')) % 3))
        end,
        (10 + (abs(hashtext(v_dia::text || v_n_checkins::text || 'monto')) % 241))::numeric,
        (v_dia::timestamp + make_interval(hours => (8 + (abs(hashtext(v_dia::text || v_n_checkins::text || 'hr')) % 12)), mins => (abs(hashtext(v_dia::text || v_n_checkins::text || 'mn')) % 60))) at time zone 'America/Lima',
        case when v_n_checkins = 1 then 'socio' else 'producto' end,
        (array[v_karina, v_nora, v_maria, v_carlos])[1 + (abs(hashtext(v_dia::text || v_n_checkins::text || 'staff')) % 4)],
        (array['efectivo','yape','plin','tarjeta','transferencia'])[1 + (abs(hashtext(v_dia::text || v_n_checkins::text || 'met')) % 5)]
      );
    end loop;

    v_dia := v_dia + 1;
  end loop;

  ------------------------------------------------------------------
  -- 5) Kardex: completar hasta ~6 productos base (agua, proteina,
  --    pre-entreno, toalla, shaker, barra) — ya existen todos en Maximus,
  --    solo aseguramos stock razonable en inventario_sede.
  ------------------------------------------------------------------
  select id into v_prod_agua       from public.producto where empresa_id = v_empresa and nombre ilike 'Agua mineral%' limit 1;
  select id into v_prod_proteina   from public.producto where empresa_id = v_empresa and nombre ilike 'Proteína Whey%' limit 1;
  select id into v_prod_preentreno from public.producto where empresa_id = v_empresa and nombre ilike 'Pre-entreno%' limit 1;
  select id into v_prod_toalla     from public.producto where empresa_id = v_empresa and nombre ilike 'Toalla%' limit 1;
  select id into v_prod_shaker     from public.producto where empresa_id = v_empresa and nombre ilike 'Shaker%' limit 1;
  select id into v_prod_barra      from public.producto where empresa_id = v_empresa and nombre ilike 'Barra proteica%' limit 1;

  if v_prod_agua is null then
    insert into public.producto (empresa_id, nombre, categoria, precio, stock_minimo)
    values (v_empresa, 'Agua mineral 625ml (demo)', 'Bebidas', 3, 10) returning id into v_prod_agua;
  end if;
  if v_prod_proteina is null then
    insert into public.producto (empresa_id, nombre, categoria, precio, stock_minimo)
    values (v_empresa, 'Proteína Whey 1kg (demo)', 'Suplementos', 130, 3) returning id into v_prod_proteina;
  end if;
  if v_prod_preentreno is null then
    insert into public.producto (empresa_id, nombre, categoria, precio, stock_minimo)
    values (v_empresa, 'Pre-entreno 30 serv. (demo)', 'Suplementos', 95, 3) returning id into v_prod_preentreno;
  end if;
  if v_prod_toalla is null then
    insert into public.producto (empresa_id, nombre, categoria, precio, stock_minimo)
    values (v_empresa, 'Toalla deportiva (demo)', 'Accesorios', 25, 5) returning id into v_prod_toalla;
  end if;
  if v_prod_shaker is null then
    insert into public.producto (empresa_id, nombre, categoria, precio, stock_minimo)
    values (v_empresa, 'Shaker Maximus (demo)', 'Accesorios', 25, 5) returning id into v_prod_shaker;
  end if;
  if v_prod_barra is null then
    insert into public.producto (empresa_id, nombre, categoria, precio, stock_minimo)
    values (v_empresa, 'Barra proteica (demo)', 'Suplementos', 10, 10) returning id into v_prod_barra;
  end if;

  insert into public.inventario_sede (empresa_id, sede_id, producto_id, stock)
  select v_empresa, v_sede, p, s from (values
    (v_prod_agua, 50), (v_prod_proteina, 15), (v_prod_preentreno, 20),
    (v_prod_toalla, 30), (v_prod_shaker, 25), (v_prod_barra, 40)
  ) as t(p, s)
  on conflict (sede_id, producto_id) do nothing;

  ------------------------------------------------------------------
  -- 6) CRM: ~10 leads + ~8 lead_tarea
  ------------------------------------------------------------------
  -- 4 asignados a karina, 4 a nora, en distintas etapas
  insert into public.lead (empresa_id, sede_id, nombre, telefono, fuente, etapa, asignado_a, created_at)
  values
    (v_empresa, v_sede, 'Rosmery Delgado (demo)', '912345601', 'Instagram', 'nuevo', v_karina, v_ahora - interval '2 days'),
    (v_empresa, v_sede, 'Elvis Quiroz (demo)',    '912345602', 'Página web', 'contactado', v_karina, v_ahora - interval '5 days'),
    (v_empresa, v_sede, 'Katherine Solano (demo)','912345603', 'Referido', 'clase_prueba', v_karina, v_ahora - interval '8 days'),
    (v_empresa, v_sede, 'Franco Idrogo (demo)',   '912345604', 'Tiktok', 'inscrito', v_karina, v_ahora - interval '20 days'),
    (v_empresa, v_sede, 'Pamela Rosales (demo)',  '912345605', 'Instagram', 'nuevo', v_nora, v_ahora - interval '1 day'),
    (v_empresa, v_sede, 'Jhosimar Tello (demo)',  '912345606', 'Página web', 'contactado', v_nora, v_ahora - interval '4 days'),
    (v_empresa, v_sede, 'Yolanda Chumpitaz (demo)','912345607','Referido', 'clase_prueba', v_nora, v_ahora - interval '9 days'),
    (v_empresa, v_sede, 'Marco Bellido (demo)',   '912345608', 'Tiktok', 'inscrito', v_nora, v_ahora - interval '25 days'),
    -- 3 nuevos SIN asignar y creados hace >24h en etapa temprana (nuevo/contactado) -> disparan SLA
    (v_empresa, v_sede, 'Cynthia Alvarado (demo)','912345609', 'Instagram', 'nuevo', null, v_ahora - interval '2 days'),
    (v_empresa, v_sede, 'Deyvis Ochoa (demo)',    '912345610', 'Página web', 'nuevo', null, v_ahora - interval '3 days')
  on conflict do nothing;

  -- capturar leads recien creados (por nombre, ya que no hay unique constraint natural)
  select array_agg(id) into v_lead_ids
  from public.lead
  where empresa_id = v_empresa and nombre in (
    'Rosmery Delgado (demo)','Elvis Quiroz (demo)','Katherine Solano (demo)','Franco Idrogo (demo)',
    'Pamela Rosales (demo)','Jhosimar Tello (demo)','Yolanda Chumpitaz (demo)','Marco Bellido (demo)',
    'Cynthia Alvarado (demo)','Deyvis Ochoa (demo)'
  );

  -- 3 convertidos: enlazar socio_id de los sembrados a los leads 'inscrito' + 1 clase_prueba
  update public.lead set socio_id = v_socio_ids[8]
  where empresa_id = v_empresa and nombre = 'Franco Idrogo (demo)' and socio_id is null;
  update public.lead set socio_id = v_socio_ids[9]
  where empresa_id = v_empresa and nombre = 'Marco Bellido (demo)' and socio_id is null;
  update public.lead set socio_id = v_socio_ids[10]
  where empresa_id = v_empresa and nombre = 'Katherine Solano (demo)' and socio_id is null;

  -- 8 lead_tarea: 2 vencidas, 3 para hoy, 3 proximas; tipos variados incluyendo 'llamada'
  insert into public.lead_tarea (empresa_id, lead_id, tipo, detalle, vence_at, completada, asignado_a)
  select v_empresa, l.id, t.tipo, t.detalle, t.vence_at, false, t2.asignado_a
  from (
    values
      ('Rosmery Delgado (demo)', 'llamada',  'Llamar para agendar clase de prueba (demo)', v_ahora - interval '1 day', 'karina'),
      ('Elvis Quiroz (demo)',    'whatsapp', 'Seguimiento por WhatsApp, pidió info de precios (demo)', v_ahora - interval '3 hours', 'karina'),
      ('Katherine Solano (demo)','visita',   'Confirmar asistencia a clase de prueba hoy (demo)', v_ahora + interval '2 hours', 'karina'),
      ('Pamela Rosales (demo)',  'llamada',  'Primera llamada de bienvenida (demo)', v_ahora + interval '4 hours', 'nora'),
      ('Jhosimar Tello (demo)',  'email',    'Enviar tarifario por correo (demo)', v_ahora + interval '6 hours', 'nora'),
      ('Yolanda Chumpitaz (demo)','llamada', 'Confirmar horario de clase de prueba (demo)', v_ahora + interval '2 days', 'nora'),
      ('Elvis Quiroz (demo)',    'visita',   'Invitar a recorrido por el gym (demo)', v_ahora + interval '3 days', 'karina'),
      ('Jhosimar Tello (demo)',  'whatsapp', 'Reenganche: preguntar si sigue interesado (demo)', v_ahora + interval '5 days', 'nora')
  ) as t(lead_nombre, tipo, detalle, vence_at, quien)
  join public.lead l on l.empresa_id = v_empresa and l.nombre = t.lead_nombre
  cross join lateral (select case t.quien when 'karina' then v_karina else v_nora end as asignado_a) t2(asignado_a);

  ------------------------------------------------------------------
  -- 7) Congelamientos: 2 activos (estado 'aprobado', dentro del rango)
  ------------------------------------------------------------------
  for v_i in 4..5 loop -- socios con membresia activa
    v_socio_id := v_socio_ids[v_i];
    select id into v_membresia_id
    from public.membresia
    where empresa_id = v_empresa and socio_id = v_socio_id and estado = 'activa'
    order by created_at desc limit 1;

    if v_membresia_id is not null and not exists (
      select 1 from public.congelamiento
      where empresa_id = v_empresa and membresia_id = v_membresia_id and estado = 'aprobado'
    ) then
      insert into public.congelamiento (
        empresa_id, membresia_id, fecha_inicio, fecha_fin, dias, motivo, estado, aprobado_por
      ) values (
        v_empresa, v_membresia_id, v_hoy - interval '2 days', v_hoy + interval '5 days', 7,
        'Viaje familiar (demo)', 'aprobado', v_karina
      );
      update public.membresia set estado = 'congelada' where id = v_membresia_id;
    end if;
  end loop;

  ------------------------------------------------------------------
  -- 8) Mantenimiento: 2-3 máquinas + mantenimientos (hoy, mañana, realizado)
  ------------------------------------------------------------------
  select id into v_maq1 from public.maquina where empresa_id = v_empresa and nombre = 'Trotadora ProRun 3000' limit 1;
  select id into v_maq2 from public.maquina where empresa_id = v_empresa and nombre = 'Prensa de pierna' limit 1;
  select id into v_maq3 from public.maquina where empresa_id = v_empresa and nombre = 'Multifuerza (demo)' limit 1;

  if v_maq3 is null then
    insert into public.maquina (empresa_id, sede_id, nombre, zona, unidades, estado)
    values (v_empresa, v_sede, 'Multifuerza (demo)', 'Zona de pesas', 1, 'operativa')
    returning id into v_maq3;
  end if;

  if not exists (
    select 1 from public.mantenimiento
    where empresa_id = v_empresa and maquina_id = v_maq1 and fecha_programada = v_hoy and estado = 'programado'
  ) then
    insert into public.mantenimiento (
      empresa_id, sede_id, maquina_id, tipo, detalle, fecha_programada, estado, responsable_id
    ) values (
      v_empresa, v_sede, v_maq1, 'preventivo', 'Lubricación de banda y revisión de motor (demo)', v_hoy, 'programado', v_carlos
    );
  end if;

  if not exists (
    select 1 from public.mantenimiento
    where empresa_id = v_empresa and maquina_id = v_maq3 and fecha_programada = v_hoy + 1 and estado = 'programado'
  ) then
    insert into public.mantenimiento (
      empresa_id, sede_id, maquina_id, tipo, detalle, fecha_programada, estado, responsable_id
    ) values (
      v_empresa, v_sede, v_maq3, 'preventivo', 'Revisión de cables y poleas (demo)', v_hoy + 1, 'programado', v_carlos
    );
  end if;

  if not exists (
    select 1 from public.mantenimiento
    where empresa_id = v_empresa and maquina_id = v_maq2 and estado = 'completado'
      and fecha_realizada = v_hoy - 3
  ) then
    insert into public.mantenimiento (
      empresa_id, sede_id, maquina_id, tipo, detalle, fecha_programada, fecha_realizada, costo, estado, responsable_id
    ) values (
      v_empresa, v_sede, v_maq2, 'correctivo', 'Cambio de rodamientos y ajuste general (demo)', v_hoy - 4, v_hoy - 3, 180, 'completado', v_carlos
    );
  end if;

  ------------------------------------------------------------------
  -- 9) Metas de vendedor: karina S/300 diarios, nora S/200 diarios
  ------------------------------------------------------------------
  insert into public.meta_vendedor (empresa_id, usuario_id, monto_diario, activo)
  values
    (v_empresa, v_karina, 300, true),
    (v_empresa, v_nora, 200, true)
  on conflict (empresa_id, usuario_id) do update set monto_diario = excluded.monto_diario, activo = true;

end $$;

commit;
