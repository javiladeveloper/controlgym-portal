-- ============================================================================
-- 24 · Storage: bucket 'branding' para logos y favicons de cada empresa
--   Estructura de rutas: branding/<empresa_id>/logo.png, favicon.png, etc.
--   Bucket público (los logos se muestran en el portal y la app sin auth).
--   Escritura: solo usuarios de esa empresa, en su propia carpeta.
-- ============================================================================

-- Crear el bucket (idempotente)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 2097152,
        array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Lectura pública (bucket público, pero explicitamos la policy de select)
drop policy if exists "branding_public_read" on storage.objects;
create policy "branding_public_read" on storage.objects
  for select to public
  using (bucket_id = 'branding');

-- Escritura: el usuario solo puede subir/editar/borrar en la carpeta de una
-- empresa a la que pertenece (primer segmento de la ruta = empresa_id).
drop policy if exists "branding_insert_own_empresa" on storage.objects;
create policy "branding_insert_own_empresa" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] in (
      select ue.empresa_id::text from public.usuario_empresa ue
      where ue.usuario_id = auth.uid() and ue.activo
    )
  );

drop policy if exists "branding_update_own_empresa" on storage.objects;
create policy "branding_update_own_empresa" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] in (
      select ue.empresa_id::text from public.usuario_empresa ue
      where ue.usuario_id = auth.uid() and ue.activo
    )
  );

drop policy if exists "branding_delete_own_empresa" on storage.objects;
create policy "branding_delete_own_empresa" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] in (
      select ue.empresa_id::text from public.usuario_empresa ue
      where ue.usuario_id = auth.uid() and ue.activo
    )
  );
