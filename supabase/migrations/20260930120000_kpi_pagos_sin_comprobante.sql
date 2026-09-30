-- KPI de finanzas: porcentaje de pagos pagados sin comprobante (Mario,
-- 30-sep-2026: avisarle a Delia en el dashboard para que el acumulado se
-- haga en automático). Se calcula en lib/indicadores.ts
-- (fin_pagos_sin_comprobante); aquí solo se registra en el organigrama de
-- Grupo Loma (kpis_organigrama es por organización) con sus umbrales:
-- ámbar desde 1 %, rojo desde 20 %.
--
-- Ya aplicado en producción.

insert into public.kpis_organigrama (area, indicador, orden, umbral_ambar, umbral_rojo, grupo_id)
select 'finanzas', 'fin_pagos_sin_comprobante', 7, 1, 20, g.id
from public.grupos g
where g.codigo = 'LOMA'
  and not exists (select 1 from public.kpis_organigrama k where k.area = 'finanzas' and k.indicador = 'fin_pagos_sin_comprobante' and k.grupo_id = g.id);
