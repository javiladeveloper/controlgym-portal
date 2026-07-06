-- 20260704000020_carnet_qr_flag
-- Flag por gimnasio: usa carnet QR / control de acceso?
-- Default true para no cambiar el comportamiento de los gyms existentes.
-- La app lee esta columna (defensiva: si no existe, asume true).
alter table public.empresa
  add column if not exists usa_carnet_qr boolean not null default true;