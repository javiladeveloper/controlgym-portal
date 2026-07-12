-- Fix: la foto del socio no subía (403 RLS). Las policies de INSERT/UPDATE del
-- bucket 'branding' solo dejaban subir a STAFF (usuario_empresa); un socio NO
-- está en esa tabla. Se agregan policies para que el SOCIO suba/actualice SU foto
-- en <su_empresa>/socios/<su_socio_id>.jpg (empresa por carpeta [1], socio_id por
-- nombre de archivo; foldername solo da [empresa,'socios']). Aplicado en prod vía MCP.
drop policy if exists "branding_socio_insert_su_foto" on storage.objects;
drop policy if exists "branding_socio_update_su_foto" on storage.objects;

create policy "branding_socio_insert_su_foto"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'branding'
  and (storage.foldername(name))[2] = 'socios'
  and exists (
    select 1 from public.socio s
    where s.usuario_id = auth.uid() and s.deleted_at is null
      and (storage.foldername(name))[1] = s.empresa_id::text
      and storage.filename(name) like s.id::text || '.%'
  )
);

create policy "branding_socio_update_su_foto"
on storage.objects for update to authenticated
using (
  bucket_id = 'branding'
  and (storage.foldername(name))[2] = 'socios'
  and exists (
    select 1 from public.socio s
    where s.usuario_id = auth.uid() and s.deleted_at is null
      and (storage.foldername(name))[1] = s.empresa_id::text
      and storage.filename(name) like s.id::text || '.%'
  )
);
