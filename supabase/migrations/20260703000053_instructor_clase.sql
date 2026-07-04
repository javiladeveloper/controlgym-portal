-- 053: Instructor de la clase — puede ser staff del panel (instructor_id) o
-- un contratado externo que solo viene a dictar (instructor_nombre, sin cuenta).
alter table public.clase
  add column if not exists instructor_nombre text;
