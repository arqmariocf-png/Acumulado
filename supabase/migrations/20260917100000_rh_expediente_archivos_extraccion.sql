-- Expediente de personal: de "check de entregado" a almacén de documentos.
--
-- Hasta ahora documentos_personal solo registraba que un documento se
-- entregó (storage_path existía pero nada lo llenaba). Ahora cada documento
-- se sube como archivo (bucket privado "cargas", vía el edge function
-- rh-documentos), Claude le extrae los datos (CURP, RFC, NSS, clave de
-- elector, domicilio, vigencias...) y RH decide qué aplicar a la ficha de
-- la persona -- la IA sugiere, la persona confirma, igual que en el resto
-- del sistema (notas de entrega, planos).

-- ── documentos_personal: el archivo y lo que se le extrajo ──────────────
alter table public.documentos_personal
  add column nombre_original text,
  add column mime_type text,
  add column datos_extraidos jsonb,
  add column texto_extraido text,
  add column extraido_en timestamptz,
  add column error_extraccion text,
  -- Cuándo RH aplicó (alguno de) los datos extraídos a la ficha de personal.
  add column aplicado_en timestamptz,
  add column subido_por uuid references public.profiles (id);

comment on column public.documentos_personal.datos_extraidos is 'Campos que Claude leyó del archivo (JSON). Son una sugerencia: RH los revisa y aplica a personal desde la pantalla.';

-- RH (no rh_documentos) puede corregir/verificar/aplicar: la política
-- documentos_personal_all (rh/admin, for all) ya lo cubre. rh_documentos
-- solo inserta y lee (políticas de 20260828020001).

-- ── personal: campos que hoy no tenían dónde vivir ──────────────────────
alter table public.personal
  add column nss text,
  add column licencia_chofer_numero text,
  add column licencia_chofer_vigencia date;

-- ── Vista: el expediente completo de cada persona ───────────────────────
-- Una fila por persona × tipo de documento aplicable, con el documento
-- vigente (el más reciente) y su estado. Es lo que pinta la pantalla de
-- Expediente; v_documentos_faltantes_personal sigue existiendo para la
-- lista global de pendientes.
create view public.v_expediente_personal with (security_invoker = true) as
select
  p.id as personal_id,
  p.nombre as personal_nombre,
  p.activo as personal_activo,
  td.id as tipo_documento_id,
  td.nombre as tipo_documento_nombre,
  td.vigencia_meses,
  td.orden,
  d.id as documento_id,
  d.fecha_entrega,
  d.fecha_vigencia,
  d.storage_path,
  d.nombre_original,
  d.mime_type,
  d.verificado,
  d.datos_extraidos,
  d.extraido_en,
  d.error_extraccion,
  d.aplicado_en,
  case
    when d.id is null then 'falta'
    when d.fecha_vigencia is not null and d.fecha_vigencia < current_date then 'vencido'
    else 'vigente'
  end as estado
from public.personal p
cross join public.tipos_documento_personal td
left join lateral (
  select x.*
  from public.documentos_personal x
  where x.personal_id = p.id and x.tipo_documento_id = td.id
  order by x.fecha_entrega desc, x.created_at desc
  limit 1
) d on true
where td.activo
  and (td.aplica_a = 'todos' or (td.aplica_a = 'chofer' and p.puesto ilike '%chofer%'));
