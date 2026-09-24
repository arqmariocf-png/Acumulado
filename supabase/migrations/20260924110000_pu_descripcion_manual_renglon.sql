-- Un renglón de análisis siempre heredaba la descripción del insumo del
-- catálogo (o del concepto del análisis básico anidado) sin poder
-- ajustarla -- así que cuando cambian las medidas reales de una puerta ya
-- capturada (p.ej. de 1.35x2.93 a otra medida), no había forma de reflejarlo
-- en ese renglón: solo se podía cambiar cantidad, precio o quitarlo y volver
-- a agregar uno nuevo. Se agrega un override opcional por renglón que, si se
-- captura, sustituye la descripción del catálogo SOLO en esta tarjeta --
-- nunca se toca pu_insumos, así que ningún otro análisis que use el mismo
-- insumo se ve afectado.
alter table pu_analisis_items add column descripcion_manual text;

create or replace view v_pu_analisis_detalle as
 SELECT i.id AS item_id,
    i.analisis_id,
    i.orden,
    i.base_calculo,
    COALESCE(ins.codigo, hijo.codigo) AS codigo,
    COALESCE(i.descripcion_manual, ins.descripcion, hijo.concepto) AS descripcion,
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
    i.precio_autorizado_en
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
