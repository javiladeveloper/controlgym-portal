-- Elimina la tabla ejercicio_maestro (catálogo viejo de 47 ejercicios), ya
-- deprecada. Sus datos se migraron a ejercicio_catalogo (ext_id 'maestro-*') y
-- ninguna función, trigger o FK la referencia — el trigger de herencia se
-- re-apuntó al catálogo nuevo en 20260714000003. Reemplazada por completo.
drop table if exists public.ejercicio_maestro;
