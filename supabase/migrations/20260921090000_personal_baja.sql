-- Baja de personal desde RH (pedido 21-sep-2026): además de activo=false se
-- guarda cuándo y por qué, para que el expediente y la antigüedad tengan
-- historial. La reactivación (recontratación) limpia estos campos.
alter table public.personal
  add column fecha_baja date,
  add column motivo_baja text;

comment on column public.personal.fecha_baja is 'Fecha en que causó baja. NULL mientras esté activo o si se reactivó.';
comment on column public.personal.motivo_baja is 'renuncia | termino_contrato | despido | abandono | otro, con nota libre opcional después de dos puntos.';
