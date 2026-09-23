-- RLS para el rol 'rh_documentos' (ver 20260828020000): solo puede ver el
-- catálogo de personal (para elegir a quién le sube un documento), ver/subir
-- tipos de documento y documentos_personal -- NUNCA contrataciones ni
-- asignaciones_diarias (sueldo y asignación diaria, fuera de su alcance), y
-- NUNCA puede marcar un documento como verificado: eso se queda para 'rh'/
-- 'admin' (Eréndira), quien supervisa su trabajo.
--
-- Se agregan políticas NUEVAS (permisivas, se combinan con OR) en vez de
-- tocar personal_all/documentos_personal_all -- así 'rh'/'admin' conservan
-- exactamente el mismo acceso de hoy, sin riesgo de aflojarlo por accidente.

create policy personal_select_rh_documentos on public.personal
  for select
  using (public.auth_rol() = 'rh_documentos');

alter policy tipos_documento_personal_select on public.tipos_documento_personal
  using (public.auth_rol() in ('rh', 'admin', 'rh_documentos'));

create policy documentos_personal_select_rh_documentos on public.documentos_personal
  for select
  using (public.auth_rol() = 'rh_documentos');

-- with check exige verificado=false y verificado_por=null -- ambos son el
-- default de la columna y el formulario actual no los toca al insertar, así
-- que esto no cambia el flujo de captura, solo bloquea que 'rh_documentos'
-- pueda insertar (o que alguien intente forzar vía API) un documento que ya
-- nazca marcado como verificado.
create policy documentos_personal_insert_rh_documentos on public.documentos_personal
  for insert
  with check (
    public.auth_rol() = 'rh_documentos'
    and verificado = false
    and verificado_por is null
  );
