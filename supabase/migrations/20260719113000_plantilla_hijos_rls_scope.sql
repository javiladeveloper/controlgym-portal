-- Aislamiento de los HIJOS de las plantillas. Los padres (plantilla_rutina /
-- plantilla_dieta) ya estaban correctamente scoped por empresa, pero sus hijos
-- tenían `using (true)`: cualquier gym autenticado podía leer por API directa
-- los días/ejercicios/comidas de las plantillas de OTRO gym.
--
-- Era deuda preexistente (nadie los consultaba desde el cliente), pero al montar
-- el editor de plantillas estos hijos pasan a contener el contenido propio y
-- personalizado de cada gym — ahora sí hay algo que proteger.
--
-- Regla: se ve un hijo si su plantilla padre es GLOBAL (empresa_id is null, el
-- catálogo compartido del sistema) o es de TU empresa. Misma condición que el padre.

drop policy if exists prd_read on public.plantilla_rutina_dia;
create policy prd_read on public.plantilla_rutina_dia for select to authenticated
using (exists (
  select 1 from public.plantilla_rutina p
  where p.id = plantilla_rutina_dia.plantilla_rutina_id
    and (p.empresa_id is null or p.empresa_id = public.auth_empresa_id())
));

drop policy if exists pre_read on public.plantilla_rutina_ejercicio;
create policy pre_read on public.plantilla_rutina_ejercicio for select to authenticated
using (exists (
  select 1 from public.plantilla_rutina_dia d
  join public.plantilla_rutina p on p.id = d.plantilla_rutina_id
  where d.id = plantilla_rutina_ejercicio.plantilla_rutina_dia_id
    and (p.empresa_id is null or p.empresa_id = public.auth_empresa_id())
));

drop policy if exists pc_read on public.plantilla_comida;
create policy pc_read on public.plantilla_comida for select to authenticated
using (exists (
  select 1 from public.plantilla_dieta d
  where d.id = plantilla_comida.plantilla_dieta_id
    and (d.empresa_id is null or d.empresa_id = public.auth_empresa_id())
));
