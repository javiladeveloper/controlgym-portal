-- La foto pasa a ser del usuario (fuente de verdad). El socio ya tenía
-- foto_estado/foto_actualizada_at; usuario necesita las mismas para no divergir.
alter table public.usuario
  add column if not exists foto_estado text,
  add column if not exists foto_actualizada_at timestamptz;
