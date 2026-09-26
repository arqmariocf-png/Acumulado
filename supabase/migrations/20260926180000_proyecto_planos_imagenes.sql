-- Planos de proyecto: además de PDF y DWG se acepta una foto o captura del
-- plano (jpg, png, webp, heic), que es lo que hay a la mano en obra desde el
-- celular. Mario, 26-sep-2026: "los botones no sirven de subir plano".
-- Ya aplicado en producción (26-sep-2026).
alter table public.proyecto_planos drop constraint if exists proyecto_planos_tipo_archivo_check;
alter table public.proyecto_planos add constraint proyecto_planos_tipo_archivo_check check (tipo_archivo in ('pdf', 'dwg', 'imagen'));
comment on column public.proyecto_planos.tipo_archivo is 'pdf, dwg o imagen (foto/captura del plano: jpg, png, webp, heic).';
