-- Clasifica la nota al catálogo donde falte objetivo_id. Los textos que no
-- corresponden a ningún objetivo (disciplinas: Jiu-Jitsu, Karate, Baile
-- infantil…) quedan sin objetivo_id a propósito; su nota se conserva.
with mapeo as (
  select s.id,
    (select o.id from public.objetivo_entrenamiento o where o.codigo =
      case
        when s.objetivo_nota ilike '%baj%peso%' or s.objetivo_nota ilike '%grasa%' or s.objetivo_nota ilike '%adelgaz%' then 'bajar_peso'
        when s.objetivo_nota ilike '%masa%' or s.objetivo_nota ilike '%hipertrof%' or s.objetivo_nota ilike '%volumen%' then 'ganar_masa'
        when s.objetivo_nota ilike '%tonific%' then 'tonificar'
        when s.objetivo_nota ilike '%fuerza%' then 'fuerza'
        when s.objetivo_nota ilike '%resist%' or s.objetivo_nota ilike '%cardio%' then 'resistencia'
        when s.objetivo_nota ilike '%rehab%' or s.objetivo_nota ilike '%postura%' then 'rehabilitacion'
        when s.objetivo_nota ilike '%deport%' then 'prep_deportiva'
        when s.objetivo_nota ilike '%salud%' then 'salud_general'
        else null
      end) as obj_id
  from public.socio s
  where s.objetivo_id is null and nullif(trim(s.objetivo_nota),'') is not null and s.deleted_at is null
)
update public.socio s set objetivo_id = m.obj_id
from mapeo m where s.id = m.id and m.obj_id is not null;

-- El usuario hereda el objetivo_id del socio más reciente que tenga uno.
update public.usuario u
   set objetivo_id = (
     select s.objetivo_id from public.socio s
     where s.usuario_id = u.id and s.objetivo_id is not null and s.deleted_at is null
     order by s.created_at desc limit 1)
 where u.objetivo_id is null
   and exists (select 1 from public.socio s where s.usuario_id = u.id and s.objetivo_id is not null and s.deleted_at is null);
