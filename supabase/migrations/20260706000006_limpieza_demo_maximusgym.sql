-- Limpieza de datos de DEMO de MaximusGym (el gym que se muestra en vivo a
-- prospectos). No afecta la lógica del producto — solo normaliza datos que se
-- verían mal frente a un cliente: precios absurdos (0 y 999) y un socio de
-- prueba con el correo del dueño. Acotado a MaximusGym por slug.
do $demo$
declare
  v_emp uuid := (select id from empresa where slug = 'maximusgym');
begin
  if v_emp is null then return; end if;

  -- Precios de membresía coherentes con el plan (Básico 60 / Estándar 90 / Premium 130).
  update membresia m
     set precio_pagado = p.precio,
         monto_pagado = case when m.monto_pagado is null or m.monto_pagado = 0
                             then p.precio else least(m.monto_pagado, p.precio) end
    from socio s, plan p
   where m.socio_id = s.id and s.empresa_id = v_emp
     and m.plan_id = p.id and m.deleted_at is null
     and (m.precio_pagado = 0 or m.precio_pagado >= 500);

  -- Socio de prueba "Jonathan Avila" (código 0021): es la cuenta de socio
  -- vinculada a la app del emulador — NO tocar email ni usuario_id (rompería
  -- el vínculo de prueba). Solo se le da un nombre y datos creíbles para que
  -- en la demo se vea como un socio real más, conservando el vínculo.
  update socio
     set nombre = 'Luis Fernández',
         documento = coalesce(nullif(documento, ''), '44712233'),
         telefono = coalesce(nullif(telefono, ''), '987654321')
   where empresa_id = v_emp
     and codigo = '0021'
     and email = 'jonathan.joan.avila@gmail.com';
end
$demo$;

-- Rellena DNI faltantes de socios demo (el DNI es obligatorio hoy; que 15 de 20
-- no lo tuvieran se veía inconsistente). Documentos 4XXXXXXX únicos por empresa.
do $dni$
declare
  v_emp uuid := (select id from empresa where slug='maximusgym');
  r record; v_doc text; v_base int := 40000000;
begin
  if v_emp is null then return; end if;
  for r in select id from socio where empresa_id=v_emp and deleted_at is null
    and (documento is null or btrim(documento)='') order by created_at loop
    loop
      v_base := v_base + 1; v_doc := v_base::text;
      exit when not exists (select 1 from socio where empresa_id=v_emp and documento=v_doc and deleted_at is null);
    end loop;
    update socio set documento=v_doc where id=r.id;
  end loop;
end
$dni$;
