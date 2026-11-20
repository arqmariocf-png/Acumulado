-- Productos de producción de Balken para poder emitir remisiones de salida de
-- vigueta y bovedilla (20-nov-2026, Mario: "permite que pueda generar la
-- remisión de salida de viguetas y bovedilla"). VBB no tenía ningún producto
-- dado de alta, así que en Producción › Balken › Inventario › Salidas la
-- remisión no tenía qué elegir. Se dan de alta los tres que vende hoy; la
-- descripción de cada partida lleva además la longitud (ej. "Vigueta sencilla
-- 12 cm × 2.70 m"). Si ya existieran con el mismo nombre no se duplican.
-- Ya aplicada en producción como `balken_productos_remision`.

insert into public.productos_produccion (empresa_id, tipo, nombre, calibre, presentacion, unidad_medida, activo)
select e.id, v.tipo, v.nombre, v.calibre, v.presentacion, v.unidad, true
  from public.empresas e
  join public.grupos g on g.id = e.grupo_id and g.codigo = 'LOMA'
  cross join (values
    ('vigueta', 'Vigueta sencilla 12 cm', '12 cm', 'Pieza (largo según despiece)', 'pza'),
    ('vigueta', 'Vigueta reforzada 12 cm', '12 cm', 'Pieza (largo según despiece)', 'pza'),
    ('bovedilla', 'Bovedilla de cemento 15×25×56', '15×25×56 cm', 'Pieza', 'pza')
  ) as v(tipo, nombre, calibre, presentacion, unidad)
 where e.codigo = 'VBB'
   and not exists (
     select 1 from public.productos_produccion p
      where p.empresa_id = e.id and public.normalizar_texto_sql(p.nombre) = public.normalizar_texto_sql(v.nombre)
   );
