-- Bucket privado para todos los archivos cargados (estados de cuenta, CFDI,
-- Excel de OC/OV). Es PRIVADO y sin policies para anon/authenticated a
-- propósito: el frontend nunca escribe/lee este bucket directamente, solo
-- lo hacen los edge functions con la service_role key (que bypassa RLS de
-- Storage). Si en el futuro se necesita que el frontend descargue el
-- archivo original directamente, se genera un signed URL desde un edge
-- function autenticado, no acceso directo al bucket.
insert into storage.buckets (id, name, public)
values ('cargas', 'cargas', false)
on conflict (id) do nothing;
