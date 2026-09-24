-- Jorge Esperón (ERG, 23-sep-2026): "No me deja cambiar los conceptos, las
-- posiciones, solo el general; pero si cambian medidas hay que editar". Cada
-- renglón del análisis puede llevar su propia descripción (medidas, lado,
-- acabado) sin tocar el insumo del catálogo, que es compartido entre
-- empresas. Vacío = se usa la del catálogo.

alter table public.pu_analisis_items add column if not exists descripcion_manual text;

create or replace view public.v_pu_analisis_detalle as
 SELECT i.id AS item_id,
    i.analisis_id,
    i.orden,
    i.base_calculo,
    COALESCE(ins.codigo, hijo.codigo) AS codigo,
    COALESCE(nullif(i.descripcion_manual, ''), ins.descripcion, hijo.concepto) AS descripcion,
        CASE
            WHEN i.base_calculo = 'pct_mano_obra'::pu_base_calculo THEN '%'::text
            ELSE COALESCE(ins.unidad, hijo.unidad)
        END AS unidad,
    COALESCE(ins.tipo, 'auxiliar'::pu_tipo_insumo) AS tipo,
    i.cantidad,
    i.rendimiento,
        CASE
            WHEN i.base_calculo = 'pct_mano_obra'::pu_base_calculo THEN i.cantidad
            ELSE round(i.cantidad / i.rendimiento, 6)
        END AS aportacion,
    COALESCE(c.costo, 0::numeric) AS costo_unitario,
    round(
        CASE
            WHEN i.base_calculo = 'pct_mano_obra'::pu_base_calculo THEN i.cantidad
            ELSE i.cantidad / i.rendimiento
        END * COALESCE(c.costo, 0::numeric), 4) AS importe,
    i.costo_congelado IS NOT NULL AS costo_cerrado,
    c.costo IS NULL AS sin_precio,
    i.proveedor,
    i.precio_autorizado_en,
    -- columnas nuevas al final: create or replace view no permite reordenar
    COALESCE(ins.descripcion, hijo.concepto) AS descripcion_catalogo,
    nullif(i.descripcion_manual, '') IS NOT NULL AS descripcion_personalizada
   FROM pu_analisis_items i
     JOIN pu_analisis a ON a.id = i.analisis_id
     LEFT JOIN pu_insumos ins ON ins.id = i.insumo_id
     LEFT JOIN pu_analisis hijo ON hijo.id = i.analisis_hijo_id
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN i.base_calculo = 'pct_mano_obra'::pu_base_calculo THEN fn_pu_mano_obra_directa(a.id)
                    ELSE COALESCE(i.costo_congelado,
                    CASE
                        WHEN i.insumo_id IS NOT NULL THEN fn_pu_costo_insumo(i.insumo_id, a.empresa_id)
                        ELSE fn_pu_costo_directo(i.analisis_hijo_id)
                    END)
                END AS costo) c;

-- La bandeja de almacén (revisión de material) ve la misma descripción que
-- el análisis.
create or replace view public.v_pu_bandeja_almacen as
 SELECT i.id AS item_id,
    a.id AS analisis_id,
    a.codigo AS analisis_codigo,
    a.concepto,
    a.unidad AS analisis_unidad,
    e.codigo AS empresa_codigo,
    py.nombre AS proyecto_nombre,
    perfil.nombre AS supervisor_nombre,
    ins.codigo AS insumo_codigo,
    COALESCE(nullif(i.descripcion_manual, ''), ins.descripcion) AS insumo_descripcion,
    ins.unidad AS insumo_unidad,
    ins.tipo,
    i.cantidad,
    fn_pu_costo_insumo(i.insumo_id, a.empresa_id) AS costo_catalogo,
    i.costo_congelado AS precio_autorizado,
    i.proveedor,
    i.precio_autorizado_en,
    i.costo_congelado IS NULL OR i.proveedor IS NULL AS pendiente
   FROM pu_analisis_items i
     JOIN pu_analisis a ON a.id = i.analisis_id
     JOIN pu_insumos ins ON ins.id = i.insumo_id
     JOIN empresas e ON e.id = a.empresa_id
     LEFT JOIN proyectos py ON py.id = a.proyecto_id
     LEFT JOIN profiles perfil ON perfil.id = a.creado_por
  WHERE a.estado = 'en_revision_material'::text AND fn_pu_item_es_de_almacen(i.*);
