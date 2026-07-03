-- ============================================================================
-- SEED de demostración — empresa "FitCore" (tipo fitness) con 3 sedes.
-- Datos portados del prototipo (src/data/fitcore.js).
-- IDs fijos (UUID hex válidos) para pruebas reproducibles.
--   empresa   e0000001
--   sede      5ede0001..3
--   plan      b1a70001..4   (plan)
--   tipo_clase c1a50001..4
--   socio     50c10001..6
--   producto  4a7d0001..3
--   maquina   3a710001..3
-- NOTA: el vínculo con auth.users (staff con login) se crea aparte vía Supabase Auth.
-- ============================================================================

-- ── Empresa y sedes ─────────────────────────────────────────────────────────
insert into public.empresa (id, nombre, slug, categoria_id, moneda, staff_multisede, permite_planes_multisede)
select 'e0000001-0000-4000-8000-000000000001', 'FitCore', 'fitcore',
       (select id from public.categoria_gym where codigo='fitness'), 'PEN', true, true;

insert into public.sede (id, empresa_id, nombre, aforo_max, activa) values
  ('5ede0001-0000-4000-8000-000000000001', 'e0000001-0000-4000-8000-000000000001', 'Sede Centro', 76, true),
  ('5ede0002-0000-4000-8000-000000000002', 'e0000001-0000-4000-8000-000000000001', 'Sede Norte',  64, true),
  ('5ede0003-0000-4000-8000-000000000003', 'e0000001-0000-4000-8000-000000000001', 'Sede Sur',    46, true);

-- Módulos: la empresa fitness hereda todos por categoría; no hace falta override.

-- ── Planes ──────────────────────────────────────────────────────────────────
insert into public.plan (id, empresa_id, nombre, precio, unidad, descripcion, dias_congelamiento_anio, incluye_clases, incluye_rutina, badge, orden) values
  ('b1a70001-0000-4000-8000-000000000001','e0000001-0000-4000-8000-000000000001','Básico',   60, 'mes','Acceso a sala de máquinas',              0,  false,false,null,1),
  ('b1a70002-0000-4000-8000-000000000002','e0000001-0000-4000-8000-000000000001','Estándar', 90, 'mes','Sala + clases grupales',                 15, true, false,null,2),
  ('b1a70003-0000-4000-8000-000000000003','e0000001-0000-4000-8000-000000000001','Premium', 130, 'mes','Sala + clases + rutina y dieta en la app',30, true, true,'MÁS POPULAR',3),
  ('b1a70004-0000-4000-8000-000000000004','e0000001-0000-4000-8000-000000000001','Pase del día',15,'dia','Acceso completo + clases del día',      0,  true, false,null,4);

-- ── Tipos de clase ──────────────────────────────────────────────────────────
insert into public.tipo_clase (id, empresa_id, nombre, color) values
  ('c1a50001-0000-4000-8000-000000000001','e0000001-0000-4000-8000-000000000001','Funcional','#FF6B35'),
  ('c1a50002-0000-4000-8000-000000000002','e0000001-0000-4000-8000-000000000001','Baile','#141B2E'),
  ('c1a50003-0000-4000-8000-000000000003','e0000001-0000-4000-8000-000000000001','Spinning','#1D9E75'),
  ('c1a50004-0000-4000-8000-000000000004','e0000001-0000-4000-8000-000000000001','Yoga','#8A93A3');

-- Acceso a clases por plan (matriz DEFAULT_ACCESO)
insert into public.plan_acceso_clase (empresa_id, plan_id, tipo_clase_id, incluido)
select 'e0000001-0000-4000-8000-000000000001', p.id, t.id,
  case
    when p.nombre = 'Básico' then false
    when p.nombre = 'Estándar' and t.nombre = 'Spinning' then false
    when p.nombre in ('Estándar','Premium','Pase del día') then true
    else false
  end
from public.plan p cross join public.tipo_clase t
where p.empresa_id = 'e0000001-0000-4000-8000-000000000001'
  and t.empresa_id = 'e0000001-0000-4000-8000-000000000001';

-- ── Socios (Sede Centro) ────────────────────────────────────────────────────
insert into public.socio (id, empresa_id, sede_id, codigo, nombre, fecha_nacimiento, telefono, objetivo, talla_m, peso_kg, estado) values
  ('50c10001-0000-4000-8000-000000000001','e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','0482','Carlos Mendoza','1997-01-01','987 234 511','Pérdida de grasa',1.75,78.4,'activo'),
  ('50c10002-0000-4000-8000-000000000002','e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','0517','Lucía Ramos','2000-01-01','941 880 273','Tonificación',1.62,61.0,'activo'),
  ('50c10003-0000-4000-8000-000000000003','e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','0339','Jorge Paredes','1992-01-01','999 410 662','Ganancia muscular',1.80,88.2,'moroso'),
  ('50c10004-0000-4000-8000-000000000004','e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','0561','María Torres','1995-01-01','956 118 340','Resistencia',1.58,55.6,'activo'),
  ('50c10005-0000-4000-8000-000000000005','e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','0602','Diego Salas','2002-01-01','912 774 508','Pérdida de grasa',1.71,74.8,'activo'),
  ('50c10006-0000-4000-8000-000000000006','e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','0448','Ana Castillo','1988-01-01','987 660 194','Tonificación',1.66,63.9,'activo');

-- Membresías
insert into public.membresia (empresa_id, sede_id, socio_id, plan_id, fecha_inicio, fecha_fin, estado, precio_pagado) values
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','50c10001-0000-4000-8000-000000000001','b1a70003-0000-4000-8000-000000000003', current_date - 25, current_date + 5, 'activa',130),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','50c10002-0000-4000-8000-000000000002','b1a70002-0000-4000-8000-000000000002', current_date - 10, current_date + 20,'activa',90),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','50c10003-0000-4000-8000-000000000003','b1a70003-0000-4000-8000-000000000003', current_date - 40, current_date - 3, 'vencida',130),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','50c10004-0000-4000-8000-000000000004','b1a70002-0000-4000-8000-000000000002', current_date - 5,  current_date + 25,'activa',90),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','50c10005-0000-4000-8000-000000000005','b1a70001-0000-4000-8000-000000000001', current_date - 12, current_date - 5, 'activa',60),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','50c10006-0000-4000-8000-000000000006','b1a70003-0000-4000-8000-000000000003', current_date - 8,  current_date + 22,'activa',130);

-- ── Clases (Sede Centro) ────────────────────────────────────────────────────
insert into public.clase (empresa_id, sede_id, tipo_clase_id, nombre, dia_semana, hora, cupo_max, activa) values
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','c1a50001-0000-4000-8000-000000000001','Funcional',1,'07:00',20,true),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','c1a50002-0000-4000-8000-000000000002','Baile · Salsa',1,'19:00',25,true),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','c1a50003-0000-4000-8000-000000000003','Spinning',1,'20:00',10,true),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','c1a50004-0000-4000-8000-000000000004','Yoga',2,'07:00',15,true);

-- ── CRM: leads ──────────────────────────────────────────────────────────────
insert into public.lead (empresa_id, sede_id, nombre, fuente, etapa, nota) values
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','Gabriela Torres','Instagram','nuevo','Preguntó por clases de baile y precios del plan Estándar'),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','Felipe Ríos','Caminó a recepción','nuevo','Quiere bajar de peso · le interesa el Premium con rutina'),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','Daniela Quiroz','Referido de Carlos M.','contactado','Amiga del socio 0482 · aplica promo refiere a un amigo'),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','Camila Ponce','Convenio universitario','clase_prueba','Agendada para funcional del jueves 7:00 am'),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','Vanessa Silva','Referida','inscrito','Se inscribió al plan Estándar · inicia el lunes');

-- ── Kardex ──────────────────────────────────────────────────────────────────
insert into public.producto (id, empresa_id, nombre, categoria, precio, stock_minimo) values
  ('4a7d0001-0000-4000-8000-000000000001','e0000001-0000-4000-8000-000000000001','Proteína en polvo 1 kg','Suplementos',145,5),
  ('4a7d0002-0000-4000-8000-000000000002','e0000001-0000-4000-8000-000000000001','Bebida isotónica 500 ml','Bebidas',6,10),
  ('4a7d0003-0000-4000-8000-000000000003','e0000001-0000-4000-8000-000000000001','Creatina 300 g','Suplementos',95,4);

insert into public.inventario_sede (empresa_id, sede_id, producto_id, stock) values
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','4a7d0001-0000-4000-8000-000000000001',4),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','4a7d0002-0000-4000-8000-000000000002',5),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','4a7d0003-0000-4000-8000-000000000003',12);

-- ── Máquinas ────────────────────────────────────────────────────────────────
insert into public.maquina (empresa_id, sede_id, nombre, detalle, zona, unidades, estado) values
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','Caminadora ProRun 400','6 unidades · N.º 1-6','Cardio',6,'operativa'),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','Multifuncional Smith','Revisión de poleas','Fuerza',1,'mantenimiento'),
  ('e0000001-0000-4000-8000-000000000001','5ede0001-0000-4000-8000-000000000001','Polea cruzada doble','Repuesto en camino','Fuerza',1,'fuera_servicio');

-- ── Sponsors ────────────────────────────────────────────────────────────────
insert into public.sponsor (empresa_id, nombre, descripcion, tipo, aporte_monto, aporte_detalle, fecha_vencimiento, estado) values
  ('e0000001-0000-4000-8000-000000000001','NutriMax Suplementos','Auspicio · exhibición en recepción','auspicio',800,'S/ 800/mes','2026-12-31','activo'),
  ('e0000001-0000-4000-8000-000000000001','Clínica San Rafael','Convenio corporativo · 40 socios referidos','convenio_corporativo',null,'S/ 75/socio','2026-08-15','por_renovar');

-- ── Promociones ─────────────────────────────────────────────────────────────
insert into public.promocion (empresa_id, nombre, descripcion, canal, tipo, estado, canjes) values
  ('e0000001-0000-4000-8000-000000000001','2×1 en matrícula','Nuevos socios pagan una matrícula y entran dos','Recepción y redes','2x1','activa',14),
  ('e0000001-0000-4000-8000-000000000001','Refiere a un amigo','Socio y referido ganan 1 semana gratis en su plan','App del socio','semana_gratis','activa',9);
