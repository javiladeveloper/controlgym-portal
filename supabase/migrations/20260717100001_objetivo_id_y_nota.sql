-- El objetivo REAL es el del catálogo (objetivo_id). El texto libre pasa a ser
-- una NOTA descriptiva (conserva "Jiu-Jitsu · cinturón azul", "Baile infantil"…
-- que el catálogo no puede representar). usuario gana objetivo_id para ser la
-- fuente de verdad, igual que el resto de datos personales.
alter table public.usuario
  add column if not exists objetivo_id uuid references public.objetivo_entrenamiento(id);

alter table public.socio   rename column objetivo to objetivo_nota;
alter table public.usuario rename column objetivo to objetivo_nota;
