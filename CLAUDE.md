# Acumulado (Grupo Loma) — contexto para Claude Code

Este archivo se lee al inicio de cada sesión. Es la memoria entre
conversaciones: lo que no esté aquí o en el código, una sesión nueva no lo sabe.

## Qué es
Backoffice **multi-organización**: cada cliente es una organización (tabla
`grupos`) con sus entidades, usuarios y datos aislados. Grupo Loma es la
organización **maestra** (opera la plataforma y es la de las 8 empresas);
ARSSA es el primer cliente de paga. App interna de Grupo Loma (8 empresas). Supabase (proyecto `zdqahpzijkkcnfehbggs`:
Postgres + RLS + Edge Functions en Deno) y React/Vite/TS en `web/`, desplegado en
Vercel (`https://acumulado-nine.vercel.app`) desde `main`. Dueño: Mario Contreras
Farfán (admin). Módulos: bancos/estados de cuenta, CFDI, OC/OV del backoffice,
inventario, precios unitarios, RH/checador, producción (Clavicón/Balken), BBVA.

## Reglas fijas (Mario)
- **Cuentas nuevas que se registran solas quedan en rol `pendiente`; nunca darles
  rol ni acceso hasta que Mario lo pida por nombre.**
- Secretos solo en `config_sistema` / secrets de Supabase, nunca en git.
- Nada de identidad del modelo ni de la sesión en commits, PRs o comentarios de código.
- Contestar en español, corto, y explicando qué decirle a la persona que reportó.

## Flujo de trabajo
- Rama de trabajo `claude/deploy-ingesta-bbva-tpxk1n`; cada cambio se hace commit
  ahí, se mezcla `--no-ff` a `main` y se empujan las dos ramas. Vercel despliega `main`.
- Migraciones: `supabase/migrations/*.sql`, y se aplican en producción con la
  herramienta `apply_migration` (MCP de Supabase). Cambios a funciones/vistas ya
  aplicados se dejan también en el archivo con nota "ya aplicado en producción".
- Edge functions: carpeta `supabase/functions/<nombre>`; se despliegan con
  `deploy_edge_function` (entrypoint `source/index.ts`). `ocr-nota-entrega` lleva
  sus helpers en línea (el bundler falla con imports de `_shared` ahí).
- Verificación antes de empujar: `npm test` en la raíz (node --test) y en `web/`:
  `npx tsc --noEmit -p tsconfig.app.json && npm run build` (encadenar con `&&` y
  revisar el código de salida).
- Pruebas de RLS por usuario: `set local role authenticated; select
  set_config('request.jwt.claims','{"sub":"<uuid>","role":"authenticated"}',true);`
  dentro de `begin … rollback`.
- El usuario `authenticated` tiene `statement_timeout=8s` en Supabase: nada pesado
  en RPC/consultas de la app; lo lento va a pg_cron (`sincronizaciones_oc_ov`).

## Decisiones importantes (2026-09)
- Backoffice (`reports.grupoloma.mx/dash/api_*_aut` y `_det_aut`): Laravel lento
  (30–60 s por endpoint, sin filtros ni caché). Se sincroniza cada hora (pg_cron
  `sync-catalogo-oc-ov-horario`, minuto 15) y bajo demanda en segundo plano
  (`solicitar_sincronizacion_oc_ov` + `sincronizaciones_oc_ov`). Llegan
  TODAS las OC con su estatus, también las "Pendiente de Autorización", y
  dirección las autoriza aquí en "Por autorizar" (Mario, 2-oct-2026:
  "autorizaremos desde Acumulado"). Otros endpoints (api_ocs, _pend,
  _noaut, _todas) no existen: 404. Lo que aún no está en `api_ocs_aut` se
  da de alta a mano con folio (fuente 'excel').
- Partidas de OC/OV en `ordenes_compra_lineas` / `ordenes_venta_lineas` con
  vistas `v_oc_lineas_avance` / `v_ov_lineas_avance` (recibido, pendiente,
  diferencia, estado incl. 'excedido'); `movimientos_inventario` apunta a la partida.
- Costeo de precios unitarios: funciones `fn_pu_*` son SECURITY DEFINER con guarda
  de rol (evitaban timeout por RLS recursivo). `pu_analisis_items.descripcion_manual`
  = descripción propia por renglón sin tocar el catálogo compartido.
- **Puestos por persona: contabilidad y tesorería (6-oct-2026, Mario: "no
  existe rol de Belén que sea el de contabilidad"; "a Belén no le sirve la
  tesorería")**: no es rol nuevo (cambiar `app_rol` movería decenas de
  policies): `permisos_modulo` 'contabilidad' (Belén Vergara, corporativo) y
  'tesoreria' (Delia, corporativo). `lib/puestos.ts` (con pruebas):
  Tesorería compacta en el inicio solo para dirección, admin o permiso
  tesorería (Allison, corporativo sin permiso, ya no la ve); contabilidad
  ve `MisActividades` + `finanzas/AcumuladoContable.tsx` (por empresa:
  último CFDI emitido/recibido, estado de cuenta, periodo OC/OV, Adquira de
  la semana) y SOLO los indicadores de `INDICADORES_CONTABILIDAD` (los que
  Mario dejó sin cruz + `cont_cfdi_atrasados` y `cont_adquira_semana`).
  Vista `v_cfdi_ultimo_por_empresa`. El encabezado muestra "contabilidad" /
  "tesorería" en vez de "corporativo". Belén ve todo OC/OV/CFDI/BBVA
  (corporativo + todas_las_empresas; verificado por RLS).
- **Cuentas duplicadas resueltas (7-oct-2026, Mario: "sí")**: el expediente
  de RH apuntaba a la cuenta que la persona NO usa, así que sus marcas y
  tareas no salían en RH. Expedientes ligados a la cuenta en uso (Belén,
  Allison y Jonathan Sánchez → la @grupoloma.mx; Salvador → 26.12.zamora;
  Gustavo y Eréndira no tenían liga); tareas y jefe directo pasados a la
  cuenta buena; cuentas duplicadas con `activo=false` y `banned_until`
  2999 (bellts1098@gmail, allisonsc_4@outlook, yonisanchezolivera@gmail,
  arturoda179@gmail). Plantilla 7-oct: 33 expedientes activos, 20 checan;
  sin expediente pero checando: Jaime, Timoteo, Fernando, Alberto
  Temalatzi, Alma García, Delia.
- **Actividades recurrentes (6-oct-2026)**: `actividades_recurrentes`
  (tablero, título, asignado, `dias_semana` ISO, `cierre_automatico`) +
  `actividades_recurrentes_generadas`; pg_cron `actividades-recurrentes-diarias`
  13:30 UTC llama `fn_generar_actividades_recurrentes()` (tarjeta con fecha
  límite hoy → el recordatorio push de las 14:00 UTC avisa). Belén: "Subir el
  archivo de Adquira (BBVA)" cada viernes en el tablero "Contabilidad ·
  Actividades" (CSC); se cierra sola al subir Adquira (trigger
  `bbva_adquira_cierra_actividad`). Se dan de alta por SQL (solo admin escribe).
- **Directo al problema, regla general (6-oct-2026)**: todo indicador con
  conteo lleva `?ver=<clave>` y `components/ProblemaDesdeTablero.tsx` (en el
  Layout) pinta arriba de CUALQUIER pantalla la lista exacta de lo contado
  (`PROBLEMAS`: cfdi_atrasados, cuentas_sin_movimientos, sin_estado_cuenta,
  cargas_error, ultimas_cargas, sincronizacion_oc_ov, prestamos_con_saldo,
  entradas_sin_oc, movimientos_hoy, productos_sin_costo,
  remisiones_por_confirmar, remisiones_planta_por_confirmar, órdenes de
  producción, pu_por_autorizar, pu_borrador_viejo, tareas_vencidas,
  cuentas_sin_rol, fotos_error). **Indicador nuevo con conteo → ?ver= y su
  entrada en `PROBLEMAS`** (o un filtro propio de la pantalla).
- **Notificaciones (6-oct-2026)**: solo 15 de 40 personas activas tenían
  push. `components/AvisoNotificaciones.tsx` en el Layout: al entrar, si el
  dispositivo no está suscrito, aviso "Activar notificaciones" (bloqueadas →
  cómo desbloquear; iPhone → instalar en pantalla de inicio); si ya estaba
  suscrito, vuelve a ligar la suscripción a la cuenta actual. Todo inicio
  muestra `MisActividades` (antes solo roles básicos).
- **Tareas: lo de fondo solo quien asigna (6-oct-2026)**: trigger
  `tarjetas_guarda_fondo`: título, responsables, supervisor,
  corresponsables, tablero, archivar y eliminar solo `creado_por` o admin;
  cualquiera mueve de columna, edita descripción, sube archivos y comenta.
  Eliminar ya no borra: `tarjetas.eliminada_en/_por` (+ archivada) y el
  tablero tiene "Ver archivadas y eliminadas" para reabrir/restaurar
  (`20261006170000`).
- **Cumplimiento de RH con todas las tareas (6-oct-2026)**: RH →
  Actividades (`rh/Actividades.tsx`) y el KPI `fn_rh_kpi_actividades()`
  cuentan las tarjetas de TODOS los tableros activos de la organización
  (hecha = última columna de su tablero), con columna/filtro de tablero y
  liga a cada tarjeta; lo nuevo que asigna RH sigue yendo a "RH ·
  Actividades" (`20261006180000`).
- **Escalamiento del semáforo de tareas (6-oct-2026)**: amarillo (vence en
  ≤3 días, sin terminar) → jefe inmediato (supervisor de la tarjeta, si no
  el jefe RH de la persona, si no quien asignó); rojo (vencida) → RH de la
  organización. Una vez por tarjeta/nivel/fecha (`tarjeta_alertas`);
  `fn_tarjetas_escalamientos()` (solo service_role) lo llama
  `push-enviar-recordatorios` v4 en el cron de las 14:00 UTC
  (`20261006190000`).
- **Recurrentes y programadas en cada tablero (6-oct-2026)**: botón
  "Actividades recurrentes y programadas" (`tareas/Recurrentes.tsx`,
  `lib/recurrentes.ts` con pruebas): semanal (días; diario), mensual (día
  del mes; mes corto → último día) o única (fecha; luego se desactiva).
  Cualquiera que vea el tablero las da de alta; las pausa/borra quien la
  creó o admin (`20261006200000`).
- **Tareas por área (21-oct-2026, Mario: "agrega una barra de tareas a cada
  una de las áreas… muévelas para que sea más fácil para las áreas llevar el
  control en su propio menú")**: `tableros.area` = clave de la sección de
  `lib/menu.ts` (finanzas, contabilidad, legal, rh, almacen, compras,
  logistica, mantenimiento, operacion). Asignados: RH · Actividades → rh;
  Contabilidad · Actividades y CONTABILIDAD → contabilidad; BBVA
  Mantenimiento · Actividades → mantenimiento; los 18 de obras y de ERG
  (con Ergodinova) → operacion. No se movieron tarjetas ni ids (recurrentes y
  cierres automáticos siguen igual). Cada sección del menú trae al final
  "Tareas de <área>" (`VE_TAREAS_AREA` en `lib/menu.ts`) → `/tareas/area/<clave>`
  (`pages/tareas/TareasArea.tsx`): un tablero → se abre directo
  (`TableroDetalle` acepta `tableroId` por prop); varios (Operación) → lista
  con avance y "solo donde tengo actividades". `fn_tablero_area(area)`
  (definer; no pendiente/espectador; tableros del área en la organización —
  los sin empresa por la organización de quien los creó—) y si no hay, crea
  "<Área> · Actividades" con Por hacer / En progreso / Hecho
  (`20261021120000`). En `/tareas` los tableros salen agrupados por área y al
  crear uno se elige el área (`lib/tareasArea.ts`, con pruebas). **Área nueva
  en el menú → agregarla a `AREAS_TAREAS`, a `VE_TAREAS_AREA` y al `case` de
  `fn_tablero_area`.** Ojo: los tableros sin empresa siguen visibles para
  cualquier organización por la frontera de `tableros` (`empresa_id is null`);
  no se cambió aquí.
- **Ojo RLS al crear con `insert … select`**: la policy de select se evalúa
  sobre la fila nueva y un arreglo calculado al inicio de la sentencia no
  la trae → "new row violates row-level security policy" (Timoteo, 6-oct,
  requisiciones). Las policies con arreglo llevan también la condición por
  fila del dueño (`solicitado_por = auth.uid()`).
- **Correcciones de Laura a movimientos (7-oct-2026)**: en Movimientos NO
  hay forma de capturar la FACTURA/etiqueta a mano; lo "N/A" sale de
  `reglas_clasificacion` (palabra en concepto/nombre, por organización) al
  cargar o "Reclasificar". Reglas nuevas: `PENALIZ SDO PROM` → N/A - COMISION
  BANCARIA; `INTERES-CAPITAL DEL CREDITO` y `PAGO PARCIAL CREDITO` → N/A -
  PAGO A CREDITO; se aplicaron a 47 movimientos ya cargados (AEP, CSC, LRT,
  QX, VBB, MCC). Corrección de este tipo → regla nueva, no edición a mano.
  **Filtro de periodo y cuenta (20-oct-2026, Mario: "en contabilidad,
  movimientos, ponme un filtro de fecha por mes o semana o día para revisar
  la conciliación, y por cuenta bancaria")**: Movimientos tiene selector de
  cuenta (de la empresa elegida o de todas, `?cuenta=`) y Todo / Día /
  Semana (lun-dom) / Mes con flechas y fecha (`?periodo=&fecha=`;
  `lib/periodoFiltro.ts` con pruebas). Con periodo o cuenta sale arriba el
  resumen: movimientos, conciliados (resuelto) y %, cargos y abonos del
  periodo completo (no solo la página).
  **Ligar a su OC/OS/OV (20-oct-2026, Mario: "una vez que el estatus está
  en revisión tendría que abrir la lista de OC/OV por número para hacerlo en
  automático")**: en cada renglón no conciliado (revisión, ambiguo,
  esperado), "Ligar OC/OS" (cargo) u "Ligar OV" (abono) abre
  `components/LigarOrdenMovimiento.tsx`: órdenes de la misma empresa de 4
  meses antes a 2 semanas después del pago + las que nombra el concepto +
  búsqueda en todo el histórico; primero la que dice el concepto del banco
  ("…0191026OC 41492 CSC": 158 de 1,554 cargos en revisión lo traen), luego
  las del mismo monto (total o saldo ±$1) y la fecha más cercana
  (`lib/ligarOrden.ts`, con pruebas). "Ligar" →
  `fn_movimiento_ligar_orden(mov, tipo, orden)` (definer; admin/dirección/
  corporativo en su alcance; misma empresa): referencia, proyecto y nombre si
  faltaban, CFDI por monto como el motor (varios → el del mismo proveedor);
  con factura → resuelto, sin ella → `pendiente_esperado` "falta factura"
  (`20261020130000`). **Y solo, sin clic** (`20261020140000`):
  `fn_movimientos_ligar_por_concepto()` (definer, revocada; pg_cron
  `movimientos-ligar-por-concepto` minuto 50) liga los de revisión/ambiguo
  cuyo concepto o comentarios nombran UNA sola orden de la misma empresa
  (regex `OC|OS|OV|O.C.|ORDEN` + 4-6 dígitos; OC no rechazada/cancelada, OV no
  cancelada) con `fn_movimiento_ligar_orden_aplicar` (la misma lógica del
  botón). Primera corrida 20-oct: 267 (154 conciliados con su CFDI, 113
  esperando factura; AEP 98, CSC 75, ERG 62, MCF 20, MCC 6, VBB 6). También
  re-liga lo que "Reclasificar" (motor desplegado) regresa a revisión.
  **Botón "No lleva factura" (7-oct-2026, Mario: "sí")** en Movimientos
  (admin/dirección/corporativo; `components/MarcarSinFactura.tsx`,
  `lib/sinFactura.ts` con pruebas): motivo de la lista de reglas u otro, y
  opcional "siempre que el concepto diga…" → `fn_movimientos_sin_factura(ids,
  etiqueta, palabra_clave)` (definer: alcance de empresas, etiqueta "N/A -
  …", crea la regla de la organización y la aplica a lo pendiente con ese
  concepto; `20261007100000`). Dirección no tiene update directo en
  movimientos: todo por la función.
- **Backoffice caído 7-oct-2026**: `api_ocs_aut`/`api_ov_aut` responden 500
  con página HTML "Access denied for user 'dxjldwfg_backoffice'" (su Laravel
  no entra a su MySQL). En Acumulado se ve como "invalid input syntax for
  type json"; `lib/sincronizarOcOv.ts` ya lo traduce. Es de Gonzalo.
  **Restablecido 9-oct-2026 19:46 UTC**: sincronización manual OK (147 OC
  y 33 OV nuevas o cambiadas, última OC 41281 del 8-oct; nómina semanal,
  quincenal y mano de obra OK). Ahora la API responde en ~3 s.
  **Otra vez congelado 14-oct-2026 (Laura: "las OC no me salen
  actualizadas, no puedo programar")**: a las 15:16 MX `api_ocs_aut`
  responde (2,012 OC) pero la última es la 41422 del 13-oct 16:24; nada del
  14-oct. Acumulado tiene todo lo que la API da y con el mismo estatus
  (comparado OC por OC; ojo: las OS del backoffice se guardan con
  `tipo = 'OS'`, al cruzar por `id_orden` no filtrar solo 'OC'). Solo
  faltan 6 de "Empresa X / Proyecto X", canceladas (pruebas). Es de
  Gonzalo; mientras, alta manual de OC. Gonzalo (15:22): "no he tocado
  nada de los API". A las 15:26 `api_ov_aut` sí trae lo de hoy (OV 15340 y
  15341 de las 9:01/9:06, ya guardadas a las 9:15) y `api_ocs_aut` sigue
  en la 41422: o nadie capturó OC hoy, o las de hoy no cumplen lo que su
  consulta pide (proyecto, partidas, estatus). Se le preguntó por folios.
  **Lo que de verdad no veía Laura**: las OC nuevas llegan ya
  autorizadas ("Pendiente de Pago") y su pestaña "Por autorizar" solo
  traía pendientes; "De hoy" y "Con saldo" las escondían. Mario: "aunque
  estén autorizadas, que exista la opción de programar a pago". Ahora la
  pestaña es **"Por autorizar y programar"** (`OrdenesPorPagar`): pendientes
  + autorizadas con saldo, sin pago programado y no pagadas en el
  backoffice, con filtro Todas / Por autorizar / Autorizadas sin programar
  e indicador "Autorizadas sin programar N · $"; "De hoy" ya muestra todas.
  Órdenes por autorizar (`/finanzas/por-autorizar`) trae abajo esa misma
  lista (`OrdenesPorPagar soloAutorizadas`) con "Programar pago".
- **Correcciones de Laura, documento "CORRECCIONES SISTEMA GRUPO LOMA"
  (8-oct-2026)**: cada panel solo con lo suyo. Saldos por empresa ya no
  trae el flujo ni "Por autorizar" debajo. **Órdenes por autorizar** es
  pantalla propia `/finanzas/por-autorizar` (`OrdenesPorAutorizarPagina`,
  reutiliza `OcPorAutorizar`). **Efectivo por confirmar** `/finanzas/efectivo`
  (`finanzas/EfectivoPorConfirmar.tsx`): OC de `v_oc_pagos` con saldo,
  no rechazadas, no pagadas en el backoffice y efectivo (condición
  efectivo, o sin condición y `tipo_pago_backoffice` Efectivo;
  `FILTRO_OC_EFECTIVO`) → OC · proveedor · monto · ver orden · confirmar;
  varias con UN comprobante (`fn_oc_confirmar_pagadas` + edge
  `pagos-comprobante` con `pagoIds`). Cuentas por pagar: Proveedor ·
  Línea · Saldo registrado (`deudaCxp`) · Disponible (línea − saldo) ·
  Semáforo, clic = detalle. KPIs `fin_oc_pendiente_pago_banco`
  (transferencia y tarjetas) y `fin_oc_pendiente_pago_efectivo`.
  **Programación de pagos**: hoja del día → OC → préstamos/traspasos →
  nómina fiscal/mano de obra → lista. `pagos_programados.tipo`
  (proveedor|nomina|mano_obra|traspaso|prestamo) + `destino_empresa_id/
  _cuenta_id` (`20261008100000`); `finanzas/TraspasosNomina.tsx`; la hoja
  (`armarHojaPagos(…, entradas)`) carga el traspaso/préstamo en la empresa
  que manda y lo abona en la que recibe. KPIs que Laura pidió y aún no
  tienen datos: flujo por obra, DSO, DPO, obra ejecutada no estimada,
  retenciones por cobrar, margen real vs presupuestado (faltan ingresos/
  estimaciones/retenciones por obra).
- **Saldo inicial con su fecha (13-oct-2026, Laura: "sigue sin
  actualizarse aunque dice ya está actualizado")**: la sincronización de
  OC estaba bien (el backoffice no había mandado OC del 13-oct; sus cambios
  de estatus llegan cada hora o con el botón); lo "congelado" eran los
  saldos de banco, que salen del último estado de cuenta subido (Banorte
  1273 al 30-sep). La hoja de pagos del día pone en comentarios "estado de
  cuenta al dd/mm" y en ámbar "falta subir lo más reciente" si es anterior
  al día hábil previo (`fn_saldos_fecha_cuenta(fecha)`, RLS de quien
  consulta; `notaSaldoInicial` en `lib/hojaPagos.ts` con pruebas;
  `20261013090000`). "Actualizar OC/OV" NO toca bancos.
- **Christian, BBVA los viernes (8-oct-2026)**: actividad recurrente
  "Actualizar el sistema de BBVA Mantenimiento" (viernes) en el tablero
  "BBVA Mantenimiento · Actividades" (CSC); se cierra sola al subir el
  concentrado (`actividades_recurrentes.cierre_evento = 'bbva_concentrado'`,
  trigger en `bbva_mantenimiento_snapshots`; `20261008090000`).
- **Formato nuevo del control BBVA (10-oct-2026, Christian: "no me deja
  subir mi archivo, no lo reconoce")**: "BBVA MANTTO - KPIs.xlsm" trae el
  encabezado en la fila 12 con "Folio/UDA" (antes "FOLIO CLIENTE" en las
  primeras filas) y Obra Menor ya va en la misma hoja por la columna "Tipo
  de servicio" (la hoja "Histórico OM" dice "No se suma al control" y no
  se suma). `_shared/bbva-control.ts` acepta las dos variantes (busca en 40
  filas; columnas con alternativas) y guarda
  `bbva_folios_control.tipo_servicio` (`20261010090000`).
  `bbva-importar-folios` v6 desplegada con el `_shared` que ya corría +
  el bbva-control nuevo. Probado con su archivo: 324 folios, 19 Obra Menor,
  17 cancelados, $1,328,380.62.
  Mismo día, segundo archivo: "date/time field value out of range:
  2026-13-05" (una fecha escrita como texto mm/dd/aaaa). `fechaIso` ya
  voltea día/mes si el mes pasa de 12 y deja en blanco fechas que no
  existen; `bbva-importar-folios` v7.
- **Alberto Temalatzi (13-oct-2026, Mario: "necesita acceso a
  requisiciones")**: era operativo (ERG); un operativo no puede crear
  requisiciones aunque tenga el módulo (`auth_opera_proyectos_empresa` pide
  administrativo/supervisor/directivo con 'proyectos'). Quedó como Timoteo:
  `administrativo`, módulos requisiciones + proyectos, `alcance_propio` con
  ERG en "Maneja también" → ve las 53 obras de ERG y crea requisiciones
  (probado con su cuenta en rollback).
- **Christian con requisiciones (14-oct-2026, Mario: "habilita a
  christian las requisiciones")**: es `responsable` con BBVA, y el menú
  esconde todo a ese perfil (`esBbvaAcotado`) aunque la base ya lo dejaba
  (responsable opera los proyectos de su empresa). Permiso por persona
  `permisos_modulo` 'requisiciones' y en `lib/menu.ts` la entrada
  Requisiciones también se ve con ese permiso en cualquier rol
  (`conPermiso`). Ve las 43 obras de CSC y crea requisiciones (rollback).
  16-oct (Mario: "el proyecto asignado es BBVA Mantenimiento"): no
  existía; se dio de alta la obra **BBVA Mantenimiento** (CSC, cliente BBVA,
  responsable Christian, por SQL). Ojo: las OC de mantenimiento del
  backoffice siguen llegando a "BBVA Puebla" (135 OC); esta obra no
  recibe OC del backoffice salvo que allá se use el mismo nombre.
- **Supervisores con precios unitarios y tareas propias (16-oct-2026,
  Mario: "a todos los supervisores habilitarles el módulo de precios
  unitarios y que puedan asignarse tareas a ellos mismos")**: permiso
  `permisos_modulo` 'precios' a los 5 supervisores activos (Brenda,
  Guadalupe, Javier Monroy, Jonathan Cáceres, José Antonio) y trigger
  `profiles_supervisor_precios` (a quien pase a rol supervisor se le da
  solo; quitarlo después, desde RH → Accesos) (`20261016090000`). OJO:
  Guadalupe, Javier y José Antonio no tienen empresa principal ni "todas
  las empresas": entran al módulo pero no ven análisis (los 15 son de ERG)
  hasta que se les asigne empresa en Admin → Usuarios. Tareas: la base ya
  dejaba a cualquiera crear tarjetas en los tableros que ve y asignárselas
  (quien crea es "de fondo"); faltaba el camino: "+ Agregarme una
  actividad" en Mis actividades (`NuevaActividadPropia`: título, tablero
  de los que ve —se recuerda el último en localStorage—, fecha; primera
  columna, responsable y creador = la persona). Probado como Brenda.
- **Arturo Huerta (8-oct-2026)**: puesto Técnico en Seguridad Industrial,
  rol operativo, jefa inmediata Brenda.
- **Costeo de lotes con la nómina real (9-oct-2026, Mario: "vincula todo
  y replantea el lote uno, únicamente deja las fechas de inicio y
  término")**: la mano de obra del lote ya NO se captura: sale de
  `nomina_externa_renglones` (nómina semanal del backoffice, empresa = la
  de la planta por `normalizar_texto_sql`) entre `fecha_inicio` y
  `fecha_fin` (o hoy): pago semanal ÷ 6 por día lunes-sábado; semana que la
  API aún no trae → último pago, marcado `estimado`; varios lotes el mismo
  día → se reparte; solo lotes en_proceso/terminada.
  `fn_lotes_mano_obra_nomina()` (definer: produccion/admin/corporativo +
  alcance; sin usuario = procesos) alimenta `v_costeo_orden_produccion`
  (nuevas columnas al final: `costo_mano_obra_nomina`, `_captura`,
  `dias_nomina`, `personas_nomina`, `nomina_estimada`).
  `fn_lote_actualizar_costo(orden)` revalúa la entrada de producto
  terminado (la llama Editar lote al cambiar fechas de un lote cerrado).
  `personal.backoffice_empleado` liga expediente ↔ nómina (Alejandro Lilia y
  Cristian Herrera ligados; José Eduardo Lila e Isaac Vega no tienen
  expediente en RH). Nadie de Clavicón checa (no hay ubicación de checador
  en la planta). Lote 001: se quitó la captura de 112 h × $295
  ($33,040) → nómina del 25-sep $1,966.66; costo $1,263.16/pieza (entrada y
  RM-000001 revaluadas) (`20261009100000`).
- **Clavicón con Jaime (10-oct-2026, Mario)**: (1) **Cerrar lote = cargar
  la producción con fechas**: `CierreLote` pide término (inicio solo admin)
  y muestra en vivo días hábiles × nómina diaria = mano de obra y costo por
  pieza (`fn_lote_mano_obra_previa(orden, desde, hasta)`, mismo cálculo y
  reparto que el costeo; `20261010100000`); la entrada de producto
  terminado lleva la fecha de término. (2) **PEPS** (`20261010110000`):
  `v_peps_capas_materia_prima/_producto_terminado` (lo que queda de cada
  entrada), `v_peps_salidas_materia_prima` (costo PEPS de cada consumo; lo
  que rebase las entradas va al último costo); el consumo del lote ya no
  captura costo y `v_costeo_orden_produccion` usa el PEPS; `v_stock_*`
  traen `costo_peps`/`valor_peps` al final; la partida de remisión congela
  `costo_peps`; Costeo → "Margen promedio por producto" (precio promedio de
  remisiones vs costo PEPS, `lib/margenPlanta.ts` con pruebas). (3)
  **Costeo proyectado** de lotes planeados `fn_lote_costeo_proyectado`
  (receta × cantidad contra las capas PEPS, nómina diaria de las últimas 2
  semanas × días planeados, indirectos, precio promedio de venta) en el
  detalle del lote (margen deseado → precio sugerido) y en Costeo → "Lotes
  programados". Lote 002 (37 rollos, 7 días): $1,576.18/rollo vs venta
  promedio $1,500. (4) El selector de OC de la planta solo trae
  `proyectoOc` ("Corporativo CLAVICON" / "Corporativo Balken"): las de
  "Proyecto X" (Maqui Print, Yulitsadonce) no son de la planta. Lote 001
  quedó reabierto (en proceso, sin término) el 10-oct: al cerrarlo con su
  fecha real se recalcula todo.
  **IVA (10-oct, Mario: "consideramos precios con IVA y se costean contra
  precios sin IVA")**: en la base todo va sin IVA (costos de entrada,
  consumo PEPS, nómina, precio de remisión); lo que mezclaba era la
  pantalla: margen por partida y cotizador mostraban precio c/IVA junto al
  costo s/IVA. Ahora el costo se pinta en la misma base que el precio y el
  margen dice "s/IVA".
  El alambrón del 9-oct a $15.80 es sin IVA (Mario: "de la última OC").
- **Proyección anual de la planta, solo director general (10-oct-2026)**:
  pestaña "Proyección anual (director general)" en Producción (visible con
  `esAdminGlobal`; `produccion/ProyeccionAnualPlanta.tsx`). Datos de
  `fn_proyeccion_planta_datos(empresa)` (definer; null si no es admin
  maestro): personas de la última nómina semanal + `fecha_ingreso` de RH,
  lotes, MP por pieza (receta × PEPS/último costo), precio promedio de
  remisiones y gastos mensuales de OC "Corporativo…" sin IVA sin materia
  prima ni ISR (`20261010120000`). Cálculo en `lib/proyeccionPlanta.ts`
  (con pruebas): 12 meses desde hoy; días hábiles lun-sáb − festivos art. 74
  LFT − cierre de planta (semanas en diciembre) − vacaciones art. 76 en el
  mes del aniversario en días-planta (sin expediente: días al año
  repartidos); lotes programados en sus días y el resto al ritmo de los
  lotes; nómina completa todo el año. Supuestos editables en pantalla.
  Primera corrida: ~1,513 rollos, ventas $2.27 M, utilidad −$435 mil a
  $1,500/rollo (equilibrio ≈ $1,787 s/IVA).
  **Ajustes (10-oct, Mario)**: la capa PEPS de producto terminado de un
  lote vale lo que cuesta el lote HOY (`v_peps_capas_producto_terminado`
  lee `v_costeo_orden_produccion`); el costo de cada partida de remisión de
  salida se calcula por PEPS (`v_peps_remisiones_lineas`) y lo usa
  `v_margen_remisiones_produccion` (RM-000001: $1,611.49 vs venta $1,500 →
  −$111.49); `fn_lotes_mano_obra_nomina` ya incluye a dirección.
  `ordenes_compra.es_inversion` (OC 41094 Lázaro Carbarín $60,000 =
  inversión): fuera de indirectos y mostrada aparte con meses de
  recuperación; partidas con "MANTENIMIENTO" tampoco cuentan
  (`20261010130000`). Materia prima en kg por mes, existencia, por
  comprar y mes en que se acaba (`mesSinMateriaPrima`). Con eso: 115 t de
  alambrón al año, utilidad −$377 mil, equilibrio ≈ $1,749/rollo s/IVA.
  **Compras y financiamiento (10-oct, Mario: "las semanas donde tengo
  que comprar o tendría que llegar el producto para estudiar el tiempo de
  financiamiento")**: `semanasConsumo` reparte los kg del mes en sus días
  hábiles por semana; `planCompras` (PEPS, con pruebas) programa pedidos
  de N kg para que lleguen cuando la existencia ya no cubre esa semana y
  la siguiente: pedir = llega − días de entrega, pagar = llega + crédito
  del proveedor, cobro = mitad de su consumo + días de cobro, días
  financiados = cobro − pago. Supuestos en pantalla (5,700 kg, 7 días, 0
  crédito, 30 de cobro): 20 pedidos, $2.09 M c/IVA, ≈ 48 días financiados.
- **No se pierde lo capturado al cambiar de ventana (9-oct-2026, Mario)**:
  causa: al volver a la pestaña Supabase renueva el token (objeto de sesión
  nuevo) y `useAuth` recargaba el perfil con `cargando=true` →
  `ProtectedRoute` pintaba "Cargando…" y desmontaba la pantalla. Ahora el
  perfil depende de `session.user.id` y solo la primera carga bloquea
  (`lib/auth.tsx`). Respaldo para el celular (pestaña descartada):
  `components/BorradorFormularios.tsx` en el Layout guarda en sessionStorage
  lo escrito en cualquier `<form>` (por ruta y firma de campos; nunca
  contraseñas, archivos ni tarjeta; formularios repetidos por renglón no) y
  lo devuelve al volver, con aviso "Recuperamos… · Descartar"; se borra al
  enviar o con reset; 12 h de vigencia (`lib/borradores.ts`, con pruebas).
  Un form que no deba respaldarse lleva `data-sin-borrador`.
- **Alta manual de OC mientras el backoffice está caído (9-oct-2026,
  Laura: "sigue sin actualizarse, no puedo subir nada")**: los archivos sí
  subían; lo detenido era `api_ocs_aut` (500 "Access denied" desde 7-oct,
  última OC 41177 del 6-oct). Botón "+ Dar de alta OC a mano" en
  Programación de pagos y en Órdenes por autorizar
  (`components/AltaOcManual.tsx`) → `fn_oc_alta_manual(empresa, folio,
  proveedor, total, fecha, proyecto, forma_pago)` (definer: admin/
  dirección/corporativo + alcance; fuente 'excel'; folio repetido →
  error). Queda pendiente en "Por autorizar"; al volver el backoffice el
  upsert por `(id_orden, tipo)` la pasa a 'api' sin duplicarla y conserva
  autorización y pagos (`20261009120000`).
- **Reporte del checador horizontal (9-oct-2026, Mario)**: en las marcas
  del checador (RH y "Asistencia del equipo") la vista por defecto es "Por
  trabajador": una fila por persona y día con Entrada · Salida a comer ·
  Regreso de comer · Salida · Horas activas (salida − entrada − comida; sin
  comida cuenta el día completo; etapa faltante en ámbar) y total del
  periodo por trabajador; imprimir en hoja horizontal y Excel.
  `lib/reporteChecador.ts` (con pruebas; día en hora de México, anuladas
  fuera, primera entrada y última salida). "Lista de marcas" sigue para
  corregir/anular.
  **Día en hora de México también en el checador personal (14-oct-2026,
  Alberto: "cheque mi salida de hoy miércoles y me la marca para
  jueves")**: `Checador.tsx` agrupaba "Últimos 14 días" y "hoy" con
  `created_at.slice(0, 10)` (UTC): después de las 6 p. m. la marca caía en
  el día siguiente. Ahora usa `fechaLocal` de `lib/reporteChecador.ts`. La
  marca estaba bien guardada; solo se pintaba mal. Nunca agrupar por día
  con `slice(0, 10)` de un timestamp.
  **Marca atorada en el teléfono (17-oct-2026, Maria Fernanda: "no me
  aparece mi registro de hoy")**: su iPhone guardaba desde el 9-oct una
  copia local de la entrada de ese día que SÍ estaba en el servidor; cada
  vez que abría el checador la reenviaba y el servidor la rechazaba ("más de
  7 días"), y por esa pendiente toda marca nueva se iba a la cola offline
  (todas sus marcas salían "offline"). El sábado 17 no llegó ninguna marca
  suya, solo ese reenvío (400 a las 8:23, 12:41 y 13:00). Ahora
  (`lib/marcasPendientes.ts`, con pruebas): lo que ya está en el servidor
  (mismo tipo ±2 min) se borra del teléfono sin reenviar; lo rechazado no
  bloquea marcas nuevas ni se reenvía solo (solo con "Enviar ahora").
  **Cada día empieza en "fuera" (19-oct-2026, Mario: "Lau no puede marcar
  entrada")**: la secuencia entrada → salida se validaba contra la última
  marca de TODA la historia; Laura tenía una entrada del 28-sep sin salida y
  la pantalla la dejaba "Dentro" para siempre (y el servidor respondía 409 a
  la entrada). Había 7 así (Laura, Delia, Eréndira, Belén, Valery, Mauro,
  Arturo). Ahora la última marca solo cuenta si es del mismo día en hora de
  México: `estadoChecador` en `lib/reporteChecador.ts` (con pruebas; aviso
  "tu entrada del dd/mm quedó sin salida") y `checador-marcar` **v5**
  (desplegada desde el código de producción v4 + `diaMx`; el repo también).
- **SAT: descarga masiva automática (13-oct-2026)**: Belén subió la
  e.firma de las 8 empresas (AEP, CSC, ERG, LRT, MCC, MCF, QX, VBB). Edge
  `sat-descarga-masiva` (verify_jwt false: cron con `x-cron-secret` o sesión
  con `auth_opera_sat`; archivos `index.ts` + `sat.ts`, el puro con pruebas
  en `_shared/sat/descarga-masiva.test.ts`): web service del SAT **v1.5**
  (SolicitaDescargaEmitidos/Recibidos, Verifica, Descargar; firma RSA-SHA1
  con node-forge, formato de phpcfdi). Cada corrida: verifica lo abierto,
  baja los ZIP listos (fflate), lee cada XML (`leerCfdiXml`/`filaCfdi`:
  UUID = folio, RFC/nombre de la contraparte, complemento de pago = suma
  de Monto y FechaPago) y hace upsert en `cfdi` con su `archivos_cargados`
  (zip en `cargas/sat/<empresa>/descargas/…`); una vez al día por empresa y
  tipo pide CFDI vigentes desde 3 días antes de lo último descargado (o el
  1-ene-2026) hasta ayer. Bitácora `sat_descargas` (lee contabilidad/admin;
  escribe solo la edge). pg_cron `sat-descarga-masiva-horaria` (minuto 40) →
  `disparar_descarga_sat()` (`20261013100000`). "404 Error no controlado"
  del SAT se reintenta en la siguiente corrida. Pantalla: Contabilidad →
  e.firma del SAT, abajo "Descarga de CFDI del SAT" con "Descargar ahora".
  Primera corrida 13-oct: aceptadas todas menos **QX: 305 "Certificado
  Inválido"** (el SAT rechaza esa e.firma: revocada o sustituida; pedir a
  Belén la vigente). Pendiente: marcar cancelados posteriores (solicitud
  Metadata) y ver carga en Perfil fiscal/conciliación con datos reales.
  **"Al día hasta" por empresa (20-oct-2026, Mario: "cada cuándo se
  actualiza, para que pongas la última actualización")**: en e.firma del
  SAT cada empresa dice "CFDI del SAT al día hasta el <día>" (el menor de
  emitidos y recibidos entre solicitudes descargada/vacía), última consulta
  y, en rojo, atrasada (> 2 días) o el rechazo del SAT (QX: 305 → subir la
  e.firma vigente); `resumenDescargaSat` en `lib/efirmaSat.ts` (con pruebas).
  Texto arriba: cada hora al minuto 40 baja lo listo y ≈ 12:40 a. m. pide lo
  del día anterior; lo facturado hoy aparece mañana.
- **e.firma del SAT por empresa (7-oct-2026, Mario: "haz la pantalla para
  subirlas y dale acceso a Belén")**: Contabilidad → "e.firma del SAT"
  (`/contabilidad/efirmas-sat`, `finanzas/EfirmasSat.tsx`,
  `lib/efirmaSat.ts` con pruebas). Suben admin o permiso 'contabilidad'
  (`auth_opera_sat()`; Belén sí, Delia no). Edge `sat-efirma` (node-forge;
  helpers en línea): valida que el .cer lo emitió el SAT, que no sea CSD,
  vigente, RFC = el de la empresa (si la empresa no tenía RFC se le pone),
  que la contraseña abra el .key y que sean pareja. Archivos en `cargas`
  `sat/<empresa>/…` (sin lectura para authenticated); contraseña en Vault
  (`fn_sat_efirma_guardar`, solo service_role); `fn_sat_efirma_credenciales`
  la entrega a la futura descarga masiva; quitar = `fn_sat_efirma_quitar`
  (deja el secreto en blanco) + borrar renglón y archivos desde la edge.
  Tabla `sat_efirmas` (`20261007090000`). **Ojo MCP: cualquier SQL con
  `drop` o `delete` (aunque sea dentro del cuerpo de una función) se queda
  colgado 60 s pidiendo confirmación**; aplicar sin esas palabras o en
  partes. Siguiente paso: el trabajo de descarga masiva por empresa.
  Tarjeta "Subir la e.firma del SAT de cada empresa" a Belén en
  "Contabilidad · Actividades" (vence 9-oct). **Aviso push de una tarjeta
  dada de alta por SQL**: `net.http_post` a `push-enviar-recordatorios` (v5)
  con header `x-cron-secret` (de config_sistema) y body `{"tarjetaId": …}`
  → "Te asignaron una tarea" solo a sus involucrados.
- **Requisiciones otra vez lentas (6-oct-2026)**: 40 "statement timeout"
  cada 5 min (BIND) en requisicion_linea_eventos, requisicion_lineas,
  avance_resolucion_linea, v_requisicion_ordenes: cada hija hacía `exists
  (… requisiciones r …)` y arrastraba la policy de requisiciones, que a su
  vez preguntaba por proyectos (7 copias anidadas; 21 s para Alma). Ahora
  `auth_requisiciones_visibles()` / `_editables()` / `_organizacion()`
  (definer, uuid[], misma lógica que la policy) y las policies comparan
  `requisicion_id = any((select …)::uuid[])` (`20261006150000`; 0.02 s).
  **Si cambia quién ve requisiciones, cambiar `auth_requisiciones_visibles`.**
- **Finanzas de Laura (6-oct-2026, Mario con Laura)**:
  - Inicio de dirección = `finanzas/InicioDireccion.tsx` (`/` para rol
    direccion): atajos OC por autorizar / efectivo por confirmar / base de
    OC, `MisActividades`, `SaldosEmpresas` y resumen de cuentas por pagar
    por empresa. Menú Finanzas: "Órdenes por autorizar"
    (`/finanzas/pagos#ordenes`) y "Efectivo por confirmar" (`#efectivo`).
  - **Confirmar pagos con un comprobante para varios**:
    `pagos_programados.confirmado_en/_por` (`20261006130000`);
    `components/ConfirmarPagos.tsx` (efectivo en Programación de pagos,
    transferencias en Tesorería); edge `pagos-comprobante` v2 acepta
    `pagoIds` (coma), `confirmar=1`, `marcarPagado=1` y sube el archivo
    UNA vez para todos.
  - **Líneas de crédito por empresa** (Cemex en AEP ≠ Cemex en ERG):
    `proveedores_credito` con `id` y único `(empresa_id, clave)`; las 4
    líneas viejas quedaron en AEP. Vista **`v_cxp_empresa`** (una fila por
    empresa y proveedor; `pagado` = mayor entre pagado por OC —pagos de aquí
    o la OC completa si el backoffice ya la da por pagada— y lo detectado en
    complementos/bancos; `saldo_oc`; `deuda` = mayor entre por pagar y saldo
    de OC, la usa el semáforo). `v_cxp_proveedores` quedó **obsoleta** (no
    se pudo borrar: los DROP por el MCP se quedan colgados 60 s; borrarla
    cuando se pueda). `fn_cxp_proveedor_detalle(clave, empresa)`;
    `v_oc_pagos` y `fn_oc_programar_pago` toman la línea de la empresa de la OC.
  - **Confirmar OC pagadas que no se marcaron en el backoffice**:
    `fn_oc_confirmar_pagadas(ocs[], fecha, metodo, referencia, cuenta)`
    (lo pendiente pasa a pagado, lo que falte se registra pagado, todo
    confirmado; devuelve ids para el comprobante). Botón "Confirmar pagadas
    N" en la selección de `OrdenesPorPagar` (`20261006140000`).
  - **Base de OC y pagos** `/finanzas/historial-pagos`
    (`HistorialPagos.tsx` + `BaseOrdenes.tsx`, `lib/historialPagos.ts` con
    pruebas): por día/semana/mes con flechas; vista OC (OC · proveedor ·
    fecha · estatus · detalle · comprobante) y vista pagos por día; Excel.
  - Programación de pagos ya no muestra los saldos globales; la hoja de
    pagos del día usa la llave `["pagos-programados", "hoja", fecha]` para
    refrescarse al programar.
  - OC 41167 (6-oct): la API `api_ocs_aut` devolvía hasta 41166 a las 17:22
    UTC; no es de Acumulado. Para "al momento" hace falta que el backoffice
    avise (webhook) o un filtro por fecha.
  - **Ojo con el MCP de Supabase**: un `begin … rollback` en el MISMO
    `execute_sql` que un `create function` deshace la función. Pruebas de
    RLS en una llamada aparte.
- **Resumen físico-financiero de todas las obras (6-oct-2026, Mario: "solo
  como director general")**: arriba de `/proyectos`, solo `esAdminGlobal`
  (`proyectos/ResumenObrasDirector.tsx`): una fila por obra con semáforo,
  físico, financiero, presupuesto, ejercido, disponible y desfase; ordena
  rojas primero. Una sola RPC `fn_resumen_obras_director()` (definer; cero
  filas para cualquiera que no sea admin maestro) y el MISMO cálculo que la
  pestaña de cada obra (`lib/resumenObra.ts`, con pruebas; `ResumenObra.tsx`
  ya lo usa) (`20261006120000`).
  **Con OC y mano de obra, y para Laura (19-oct-2026, Mario: "agrégalas y
  también la parte del módulo de mano de obra… este reporte también
  autorízalo a Laura como parte de finanzas")** (`20261019120000`):
  `fn_obra_gasto_backoffice(proyecto|null)` (definer, revocada; CTE
  *materialized*: sin eso unir `v_oc_pagos` con `ordenes_compra` tardaba
  4.9 s, ahora 0.13 s) da por obra las OC/OS con el mismo nombre
  (`normalizar_texto_sql`, misma organización, sin canceladas/rechazadas;
  pagado = pagada en el backoffice o sin saldo) y la mano de obra pagada de
  `api_MO_period_aut` por semana y por partida (las 30 obras de la API
  empatan por nombre). Ejercido = OC + mano de obra API (si no hay, la nómina
  capturada) + compras del control de obra **sin** OC ligada
  (`calcularResumenObra` con `oc`/`manoObra` y `desglose`).
  `fn_resumen_obras_director()` trae `oc_num/oc_total/oc_pagado/mo_total` y
  lo ve el admin maestro **y dirección** en su alcance; `fn_obra_gasto(id)`
  alimenta la pestaña de la obra (secciones OC y "Mano de obra pagada por
  semana" + por partida). Menú Finanzas → **Físico-financiero de obras**
  (`/finanzas/obras`, `finanzas/ObrasFisicoFinanciero.tsx`, dirección y
  admin) y arriba de `/proyectos` para dirección. Probado como Laura: 55
  obras en 0.15 s; Parque Real 63 = 97 OC $594,865.81 (pagado $238,968.19)
  + mano de obra $314,369.71 en 14 semanas; Moni no ve nada.
  **Presupuestos de mano de obra**: la API solo trae lo pagado; probados
  api_MO_aut, _cat, _presupuesto, _presup, _project, _budget, _proyecto y
  api_presupuesto_aut → 404. El presupuesto sale de Control de obra hasta que
  Gonzalo exponga los autorizados.
  **Rol empresa (20-oct-2026, Mario: "agrega la pestaña de proyectos a
  Jorge")**: Jorge ya tenía Proyectos y cada obra; el resumen de todas las
  obras arriba de `/proyectos` ahora también lo ve el rol empresa en sus
  empresas (`fn_resumen_obras_director`, `20261020110000`; Jorge: 20 obras de
  ERG).
- **Precios unitarios en Proyectos (26-sep-2026)**: semáforo por análisis
  (`lib/puSemaforo.ts`, con pruebas) en la lista de proyectos, en Cotización y
  arriba de los tableros de Avance (`proyectos/SemaforoPreciosUnitarios.tsx`).
  Seis pasos: los cinco del circuito interno (borrador → almacén → dirección
  → publicado) y la autorización del cliente, que es posterior a publicado y
  se registra con `fn_pu_autorizar_cliente(id, bool, referencia)`
  (`pu_analisis.cliente_autorizado_en/_por/cliente_referencia`; roles:
  admin, direccion, corporativo, empresa o responsable/comprador del
  proyecto). Rojo = elaboración/almacén, ámbar = dirección/publicación,
  azul = espera al cliente, verde = autorizado por el cliente.
- **Quién administra los proyectos de su empresa (26-sep-2026)**: rol
  `empresa` (Jorge), `responsable` (Mauro) y los básicos con módulo
  `proyectos` (Jonathan, supervisor) ven los proyectos de SU empresa y crean
  tableros de avance, control de obra y planos (`auth_opera_proyectos_empresa`,
  `auth_administra_tableros_de`, `auth_administra_proyecto`; admin y
  corporativo en todas). Frontend: `administraProyectosDe(perfil, empresaId)`
  en `lib/modulos.ts`. Pestañas del proyecto: **Resumen físico-financiero**
  (solo admin/corporativo/direccion/empresa; `proyectos/ResumenObra.tsx`:
  presupuesto y ejercido de los controles de obra contra tareas hechas,
  suministro de requerimientos y PU) · Planos · Catálogo (precios del
  cliente) · Precios unitarios (semáforo) · Avance (semáforos de
  requerimientos y PU + tableros) · Control de obra.
- **Semáforo de requerimientos (26-sep-2026)**: `requisiciones.etapa`
  (solicitada → autorizada → pagada → suministro → en_bodega → en_transito →
  recibida) con bitácora `requisicion_etapas`; se avanza solo por
  `fn_requisicion_etapa(id, etapa, nota)` (autoriza dirección/empresa; paga
  dirección; suministro dirección/empresa/almacén; bodega y tránsito
  empresa/almacén; recibida empresa/almacén/responsable o quien la pidió;
  admin/corporativo todo; regresar solo admin/corporativo/dirección). Reglas
  replicadas en `lib/requisicionEtapa.ts` (con pruebas) para los botones.
- **Requerimientos (28-sep-2026)**: los crea quien opera los proyectos de
  su empresa (`auth_opera_proyectos_empresa`: empresa, responsable, básicos
  con módulo `proyectos`, ej. Jonathan) sobre proyectos de SU empresa, a su
  nombre; el responsable además en los suyos (`requisiciones_insert`,
  `20260928160000`). `/requisiciones` abre también con módulo `proyectos`
  (`ProtectedRoute oPermiso`). Renglones de **texto libre**:
  `requisicion_lineas.concepto_id` es nullable y hay `descripcion`
  (check: uno de los dos; `20260928170000`) porque casi ninguna empresa
  tiene catálogo de productos (solo AEP). Compras resuelve igual por
  `requisicion_linea_id`; `avance_resolucion_linea` trae `descripcion`.
- **Compras desde requisiciones por almacén (28-sep-2026)**: Alma (rol
  `almacen`) entra a Requisiciones → Resolución (antes solo admin/
  corporativo): resuelve compra/entrega, sube la **cotización** de cada
  necesidad (edge `requisiciones-cotizacion`: archivo al bucket `cargas/
  cotizaciones/…`, proveedor, costo unitario sin IVA, nota; columnas
  `necesidades_compra.cotizacion_*`) y genera la **orden de compra** con
  `fn_oc_desde_necesidades(p_lineas, proveedor, fecha, iva)`: folio propio
  **RQ-<codigo empresa>-0001** (`folios_series` + `fn_siguiente_folio`,
  definer), `ordenes_compra.fuente = 'requisicion'` (la sincronización del
  backoffice no las toca: solo borra/actualiza `fuente = 'api'`), partidas
  con `clave` = id de la necesidad, necesidades → `vinculada`. Pantalla:
  `requisiciones/ComprasPorOrdenar.tsx` dentro de Resolución.
  **Un solo paso** (`fn_oc_desde_lineas(p_lineas [{linea_id, cantidad,
  costo}], proveedor, fecha, iva, nota)`, `20260928200000`): desde el
  renglón, "Comprar en un paso" (`requisiciones/CompraEnUnPaso.tsx`) crea
  la necesidad con la cotización y la OC de una vez; el archivo se adjunta
  después por la edge (acepta `vinculada`). **Autorización de dirección**:
  `ordenes_compra.autorizada_en/_por/pago_programado_id/creada_por`;
  `fn_oc_autorizar(oc, bool, motivo, fecha_pago, cuenta)`: autorizar crea el
  `pagos_programados` (beneficiario = proveedor, concepto "OC RQ-…") y pasa
  la requisición a `autorizada`; rechazar borra la OC y regresa las
  necesidades a `pendiente` con el motivo en la nota. Laura lo ve en Saldos
  por empresa (`finanzas/OcPorAutorizar.tsx`) y KPI `fin_oc_por_autorizar`.
  **Una sola pantalla (29-sep-2026, Mario: "simplifica")**: ya no hay
  pestaña de resolución (`Resolucion.tsx` y `ComprasPorOrdenar.tsx` se
  borraron; `/requisiciones/oc-pendientes` y `/resolucion` redirigen). En la
  lista de `/requisiciones` cada renglón tiene "Abrir / comprar" →
  `requisiciones/DetalleRequisicion.tsx`: renglones con solicitado / en
  compra / surtido / falta, botón **Comprar** (= `CompraEnUnPaso`) y
  **Surtir** (necesidades_entrega, solo con producto de catálogo), y abajo
  las OC de esa requisición (`v_requisicion_ordenes`, security_invoker) con
  **Ver orden** (`requisiciones/VerOrdenCompra.tsx` → `lib/ordenCompraRq.ts`,
  HTML imprimible con pruebas; logo en `/logos/<codigo>.png`). Laura también
  tiene "Ver orden" en OC por autorizar. `requisiciones.solicitante_nombre`
  se llena por trigger al crear (profiles solo deja leer el renglón propio,
  así que el embed a profiles salía en blanco para almacén). Policies de
  `requisicion_lineas` / `necesidades_*` select: heredan de `requisiciones`
  (`exists … requisiciones r`), antes Jonathan no veía sus propios renglones
  ni almacén sin "todas las empresas" (`20260929100000`).
  **Captura de renglones (29-sep-2026)**: Enter en descripción, cantidad o
  unidad agrega el renglón; lo que quede escrito sin agregar se envía
  también (`filaPendiente`); y quien pidió la requisición (o admin/
  corporativo) puede agregar renglones desde el detalle mientras esté
  `enviada`. Motivo: Maria Fernanda mandó una con un solo renglón.
  **Editar sin abrir otro folio (29-sep-2026)**: en el detalle, quien pidió
  (o admin/corporativo) edita descripción/cantidad/unidad, quita renglones y
  cancela la requisición mientras esté `enviada`. Trigger
  `requisicion_lineas_guarda_resueltas` (`20260929110000`): con compra o
  entrega registrada no se borra, no se baja la cantidad por debajo de lo
  resuelto ni se cambia unidad/concepto; "Cancelar requisición" solo si
  nada está resuelto y no hay OC.
- **Seguimiento por renglón (29-sep-2026, Jonathan + Mario: "bases del
  punto de venta")**: bitácora `requisicion_linea_eventos` (tipo pedido /
  entregado / devolucion / cambio / comentario, cantidad, nota, quién;
  `20260929200000`). Totales calculados en `lib/seguimientoLinea.ts` (con
  pruebas): pedido = Σpedido − Σdevolución; entregado = Σentregado −
  Σdevolución − Σcambio; **devolución** no se repone, **cambio** sí (queda
  por entregar). Motivo obligatorio en devolución/cambio; no se devuelve más
  de lo entregado (trigger). Todos los renglones entregados → requisición
  `recibida`. Marca quien ve la requisición, a su nombre; borra quien la
  puso o admin/corporativo. Columnas Pedido / Entregado / Comentarios y
  panel `requisiciones/SeguimientoLinea.tsx` en el detalle. Independiente
  de "En compra"/"Surtido" (OC del sistema): sirve para lo comprado por fuera.
- **Requisición imprimible (15-oct-2026, Mario: "un descargable en PDF
  para que puedan imprimirlo los chavos y también en almacén para revisar
  entregas físicas")**: `lib/requisicionImpresa.ts` (con pruebas) +
  `requisiciones/ImprimirRequisicion.tsx` (`BotonImprimirRequisicion`,
  abre la pestaña en el clic y el navegador guarda PDF). Dos formatos:
  **requisición** (vertical: renglones, cantidad, casilla "recibido",
  observaciones, firmas solicitó / Vo. Bo. / almacén) y **hoja de entrega**
  para almacén (horizontal: solicitado, en bodega, en camino, recibido en
  obra y por entregar del seguimiento por renglón + "entregado hoy", OK y
  firmas entrega / transporta / recibe). Botones arriba del detalle de la
  requisición; "PDF" también en cada renglón de la lista.
- **Entrega a obra y avance por partida (5-oct-2026, Mario con Alma)**:
  recibir en BODEGA ya no completa la requisición; el destino final es la
  obra. El seguimiento por renglón suma `en_bodega`, `enviado_obra`,
  `directo_obra`, `queda_bodega`, `faltante`, `regreso_bodega` (y
  `entregado` = recibido en obra). Bodega la marca almacén; lo de obra, quien
  pidió o responsable/comprador del proyecto (+ empresa/admin/corporativo)
  (trigger `requisicion_linea_eventos_antes`; `puedeMarcarEvento` en
  `lib/seguimientoLinea.ts`). Cálculo por renglón en
  `v_requisicion_linea_entrega` (incluye OC del sistema recibidas en bodega
  u obra) y por requisición en `v_requisicion_avance` (avance % = promedio
  de pedido · bodega · en camino · en obra; conteo de partidas por etapa).
  La etapa la recalcula `fn_requisicion_recalcular_entrega` (todo en obra →
  recibida; algo en camino → en_transito; algo en bodega → en_bodega); los
  botones manuales de etapa ya no ofrecen bodega/tránsito/recibida. Los
  semáforos (MisRequisiciones, SemaforoRequisiciones, AlmacenProyectos,
  ResumenObra) usan el avance por partidas (`semaforoEtapa(etapa,
  cancelada, avance_pct)`). Las 18 marcas "entregado" de Alma pasaron a
  en_bodega (`20261005100000`, prueba `supabase/tests/requisicion_entrega.sql`).
- **La app se trababa (6-oct-2026, Mario)**: desde el 5-oct 19:00 UTC,
  cientos de "statement timeout" por hora, casi todos en BIND (planeación).
  Causa: `v_requisicion_linea_entrega` / `v_requisicion_avance` eran
  security_invoker sobre 7 tablas con RLS y planeaban sus policies anidadas en
  cada consulta (3.7 s para 19 requisiciones). Ahora el cálculo es
  `fn_requisicion_linea_entrega_base()` (definer, acotado a la organización)
  y la vista filtra contra `requisiciones` (13 ms) (`20261006110000`).
  **Regla: una vista que cruza varias tablas con RLS no se hace
  security_invoker; se calcula en una función definer acotada y se filtra
  contra UNA tabla con RLS.** Diagnóstico: `pg_stat_statements` + logs de
  postgres con `parsed.command_tag = 'BIND'`. React Query ya no usa los
  valores por defecto: `staleTime` 60 s y 1 reintento (`App.tsx`).
- **Notificaciones push llevan a lo que hay que atender (6-oct-2026)**:
  tareas → `/tareas/<tablero>?tarjeta=<id>` (abre la tarjeta);
  recordatorio diario → la tarjeta o `/tareas#mis-actividades`; gastos →
  `/gastos#por-revisar` (en repo; desplegar `gastos-comprobar` tras
  reconciliar su `_shared`). `sw.js` navega la pestaña abierta y, si no
  puede, abre otra.
- **Del tablero directo al problema (5-oct-2026, Mario: "dirígelos directo
  al problema")**: mosaicos de Inicio y KPIs (`lib/indicadores.ts`) llevan
  filtro: `?ver=` (requisiciones sin_resolver/pendientes/en_bodega/
  en_transito; match oc_parciales/partidas_faltantes/partidas_excedente/
  ov_parciales sin elegir empresa; folios sin_atender/viejos/en_ejecucion;
  movimientos revisar/ambiguos/duplicados/sin_cfdi), `?tab=` (RH) o
  `#sección` (`#ordenes`, `#pagos-vencidos`, `#pagos-semana` en pagos;
  `#sin-comprobante` en tesorería). `components/FiltroDesdeTablero.tsx`:
  `useVer()`, `AvisoFiltro` ("Mostrando solo… · Ver todo") e `IrAlAncla`
  (en el Layout: baja y resalta la sección). `rutaPermitida` ignora `?`/`#`.
  **KPI o mosaico nuevo con conteo → su ruta lleva el filtro.**
- **Barra de la sección en cada pantalla (21-oct-2026, Mario: "en el menú
  proyectos, ponle el menú básico de las áreas que puede dirigirnos, para no
  tener que hacer scroll; aplícalo para todos")**: `components/MenuSeccion.tsx`
  en el Layout, fija arriba (`sticky top-0`, 44 px = `h-11`), con las demás
  entradas de la sección del menú a la que pertenece la ruta actual
  (`seccionDeRuta`/`muestraBarra` en `lib/menuSeccion.ts`, con pruebas; usa
  `seccionesPara`, así que respeta rol, módulo, permisos y "Ver como"); no sale
  en el inicio, con una sola entrada, para espectador ni pendiente. Lo que deba
  quedar fijo debajo usa `top-11` (pestañas del detalle de obra). Proyectos
  trae atajos a Resumen de obras / Requerimientos por obra / Lista de obras;
  `index.css` da `scroll-margin-top` a todo `[id]` para que los `#ancla` no
  queden tapados. **Toda pantalla nueva entra a una sección de `lib/menu.ts` y
  sale sola en la barra.**
- **Obras asignadas para roles básicos (5-oct-2026, Mario: "a los
  supervisores muéstrales únicamente sus proyectos asignados")**: operativo,
  administrativo, supervisor y directivo ven en `proyectos` y
  `requisiciones` solo las obras donde son responsable o comprador, aquellas
  donde ya pidieron requisiciones (`auth_proyectos_propios()`, definer, una
  vez por consulta) y, con excepción, las de su empresa extra; ya no todas
  las de su empresa ni todo el grupo con `todas_las_empresas`. Responsable,
  empresa, dirección, almacén y demás no cambian. Para que un supervisor vea
  una obra hay que asignarlo en el encabezado de la obra. **Excepción por
  persona** `profiles.alcance_propio`: usa sus empresas de "Maneja también"
  aunque su rol sea de una sola (casilla "excepción: maneja otras" en Admin →
  Usuarios); Timoteo (administrativo, CSC) la tiene con MCF: ve las 22 obras
  de MCF y en CSC solo la suya. Trigger `profiles_guarda_alcance`: solo un
  admin cambia `alcance_propio` o `todas_las_empresas` (antes cualquiera se
  prendía `todas_las_empresas` a sí mismo). Frontend: `Proyectos.tsx` y
  `MisRequisiciones` no filtran por empresa a los básicos
  (`20261005110000`, prueba `supabase/tests/proyectos_asignados.sql`).
- **Membrete por empresa (5-oct-2026)**: `empresas.razon_social,
  domicilio_fiscal, telefono, correo, banco, cuenta_bancaria, clabe,
  sucursal_bancaria` (datos públicos que van impresos); la cotización de
  planta sale en hoja membretada con logo `/logos/<codigo>.png` y cuenta
  para depósito. Clavicón llenado (BBVA, CLABE 012650001127363818)
  (`20261005090000`).
- **Pagos por orden de compra (29-sep-2026)**: `pagos_programados.
  orden_compra_id` liga cada pago a su OC; `ordenes_compra.condicion_pago`
  (contado / credito / anticipo, la pone dirección) y el **saldo se
  calcula** en `v_oc_pagos` (total − pagos con estatus 'pagado'; trae
  programado, próximo pago y la línea de crédito del proveedor por
  `fn_proveedor_clave`). En Programación de pagos, arriba de los pagos:
  `finanzas/OrdenesPorPagar.tsx` con pestañas "De hoy" (fecha_creacion =
  hoy, todas las fuentes) y "Con saldo pendiente" (meses pasados incluidos,
  filtro por proveedor/folio y "solo con línea de crédito"); por OC:
  selector de condición (`fn_oc_condicion_pago`) y "Programar pago"
  (`fn_oc_programar_pago(oc, condicion, monto, fecha, cuenta, notas)`:
  beneficiario y concepto salen de la OC; crédito sugiere fecha OC + días
  de crédito; anticipo sugiere la mitad; valida monto ≤ saldo). Reglas
  puras en `lib/pagosOc.ts` (con pruebas). `fn_oc_autorizar` también liga
  el pago y deja condición contado por defecto; al rechazar borra los
  pagos pendientes de esa OC. **Seguimiento**: trigger
  `pagos_programados_avanza_requisicion` (pago → 'pagado') pasa la
  requisición ligada a `pagada`; almacén confirma cantidades por partida en
  `oc_recepciones` (`v_oc_rq_recepcion`, botón "Recibir" en el detalle de
  la requisición, `requisiciones/RecepcionOc.tsx`); trigger
  `oc_recepciones_avanza_requisicion`: parcial → `en_bodega`, todas las
  partidas de todas las OC de la requisición completas → `recibida`
  (`20260929120000`). Las OC del backoffice (api) siguen recibiéndose por
  inventario (`v_oc_lineas_avance`); `oc_recepciones` es solo para las RQ.
  **Autorización como factor de pago (29-sep-2026)**: `v_oc_pagos.
  autorizacion` = autorizada (api, o `autorizada_en`), pendiente (Excel y
  RQ sin autorizar) o rechazada (`ordenes_compra.rechazada_en/_por/
  rechazo_motivo`). `fn_oc_autorizar` acepta también fuente 'excel'
  (autoriza sin crear pago; el rechazo se registra, no se borra);
  `fn_oc_programar_pago` exige OC autorizada. Pestaña "Por autorizar" en
  Programación de pagos reutiliza `OcPorAutorizar` (RQ + Excel); KPI
  `fin_oc_por_autorizar` cuenta ambas. **Vencimiento por OC**:
  `v_oc_pagos.vence` = fecha OC + días de crédito del proveedor, para las
  OC a crédito y las sin condición cuyo proveedor tiene línea
  (`es_credito`); ojo, `proveedores_credito.vencimiento` es de la LÍNEA,
  no de la OC (Laura confundió las dos con la 41007 de Cruz Azul: 25-sep +
  15 días = 10-oct). Semáforo `vencimientoCredito` en `lib/pagosOc.ts`
  (rojo vencida, ámbar ≤7 días); pestaña "Crédito y vencimientos"
  (`20260929140000`).
  **La sincronización ya no bloquea (29-sep-2026)**: Laura recibía
  "canceling statement due to statement timeout" al poner condición
  mientras corría la sincronización: hacía http_get (30-60 s cada uno)
  intercalado con los upserts en UNA transacción y las 1,653 OC quedaban
  con candado ~2 min. `sincronizar_catalogo_oc_ov` ahora descarga los 4
  payloads primero y escribe al final solo las filas que cambiaron
  (`on conflict … do update … where … is distinct from`);
  `20260929150000`. Regla: en cualquier job que llame al backoffice, las
  descargas van antes de la primera escritura.
  **Las 188 OC 'excel' (29-sep-2026)**: venían de un solo archivo cargado
  por Mario el 25-ago ("OC S y Detalle del 1 al 29 jul 26.xlsx", CSC,
  julio); las que el backoffice autorizó se volvieron 'api' por el upsert
  y las 188 restantes no coincidían con nada. Se archivaron como
  rechazadas con motivo (`20260929170000`); "Ver archivadas" en Por
  autorizar las lista y "Autorizar" las reactiva. `v_cxp_proveedores` ya
  no cuenta OC rechazadas. El backoffice solo expone OC autorizadas
  (`api_ocs_aut`): las pendientes de autorización de allá NO llegan; si
  Laura las quiere aquí, pedir al desarrollador un endpoint de pendientes.
  **El backoffice sí manda el estatus (29-sep-2026, corrige lo de arriba)**:
  `api_ocs_aut` trae TODAS las OC con `Estatus` (Pendiente de Autorización,
  Pendiente de Pago, Pendiente Factura, Pendiente Comprobante, Completada,
  Cancelada) y `Tipo_pago` (Transferencia electrónica de fondos, Efectivo,
  Tarjeta de débito/crédito); también `Comprador`, `Categoria_orden`,
  `Fecha_entrega`, `Tipo_movimiento`, `saleOrder`. Se guardan en
  `ordenes_compra.estatus_backoffice` / `tipo_pago_backoffice`
  (`20260929180000`). `v_oc_pagos.autorizacion` para api: Pendiente de
  Autorización → pendiente (se lista aparte en "Por autorizar", solo
  lectura: se autorizan allá), Cancelada → rechazada; `pagada_backoffice`
  = Pendiente Factura / Pendiente Comprobante / Completada (ya pagada
  allá: oculta de "Con saldo" salvo el check "incluir pagadas en el
  backoffice"). Condición inicial: efectivo si el backoffice dice
  Efectivo. `fn_oc_programar_pago` bloquea api pendientes/canceladas;
  `v_cxp_proveedores` las excluye. **Ni el encabezado ni las partidas
  traen datos bancarios del proveedor**: se capturan en la app
  (`proveedores_datos_bancarios`) o se le piden a Gonzalo como campos
  nuevos (CLABE, banco, beneficiario, RFC) o un endpoint de proveedores.
  **Tesorería (Delia, rol corporativo; 29-sep-2026)**: `/finanzas/tesoreria`
  (`pages/finanzas/Tesoreria.tsx`, también compacta arriba del inicio de
  corporativo/dirección/admin): semáforo por empresa (`lib/tesoreria.ts`,
  con pruebas: saldo del banco de hoy vs pagos por transferencia
  pendientes de hoy y vencidos; rojo si no alcanza, ámbar si falta pagar o
  si lo pagado aún no aparece en el banco, verde cuando cuadra) y los pagos
  de hoy por empresa con **datos bancarios del proveedor** y "Pagado" con
  referencia. Dirección programa, tesorería paga. `proveedores_datos_
  bancarios` (clave = `fn_proveedor_clave`; beneficiario, banco, CLABE 18
  dígitos, cuenta, RFC, correo; nunca tarjeta; ven admin/corporativo/
  direccion/empresa, NO almacén; capturan admin/corporativo/direccion) con
  editor `components/DatosBancariosProveedor.tsx` en la OC y en el pago.
  Vistas `v_pagos_programados` (pago + OC + bancarios) y `v_oc_pagos` con
  bancarios. **Efectivo**: condición 'efectivo' en la OC y
  `pagos_programados.metodo` (transferencia/efectivo/cheque); el pago en
  efectivo no cuenta contra el saldo bancario. Pendiente: módulo completo
  de caja / pagos en efectivo a cargo de Jaime (`20260929160000`).
  **Cadena Laura → Delia → Alma (29-sep-2026)**: por autorizar → por
  programar → **programado a pago** (Laura) → **pagada** (Delia marca y sube
  el comprobante: `pagos_programados.comprobante_*`, edge
  `pagos-comprobante`, bucket `cargas/pagos/…`, componente
  `ComprobantePago`) → **recibida** (Alma u obra). `etapaOc()` en
  `lib/pagosOc.ts` pinta la barra de pasos en la lista de OC. Recepción de
  CUALQUIER OC: `v_oc_recepcion` (confirmaciones `oc_recepciones` con
  `lugar` bodega/obra + entradas de inventario ligadas a la partida),
  `v_oc_por_recibir` (pagadas aquí o en el backoffice), pestaña **Por
  recibir** en Inventario (`inventario/PorRecibir.tsx`, roles almacén,
  empresa, responsable, admin, corporativo) con `RecepcionOc` (partida por
  partida o "Recibir todo lo que falta" → `fn_oc_marcar_recibida(oc, lugar,
  nota)`; `ordenes_compra.recibida_*`). Tesorería muestra también los
  "programados a pago para después". Lista de OC: casillas con **suma
  automática** y "Programar a pago N" en lote (condición inicial de cada
  una y fecha sugerida); la OC impresa trae forma de pago, beneficiario,
  banco y CLABE (`20260929190000`).
  **IVA de las OC (30-sep-2026)**: el `TOTAL` de `api_ocs_aut` **ya
  incluye IVA** y el `Costo` de cada partida también (pantalla "Pago a
  Proveedores" del backoffice, OC 41054: subtotal 528.27 + IVA 84.52 =
  612.79). IVA api = Σ partidas con IVA × cant × costo × 0.16/1.16; en OC
  RQ el costo es sin IVA (× 0.16). Vista `v_oc_importes` (subtotal, iva,
  total = el mismo total) y `v_pagos_programados.oc_subtotal/oc_iva/
  oc_total`; Tesorería desglosa bajo cada monto (`lib/ivaPago.ts`, pago
  parcial en proporción). **No sumar 16 % encima del TOTAL** (se estuvo a
  punto; Mario lo detuvo). Forma de pago en Tesorería = `tipo_pago_backoffice`.
  **Datos bancarios**: el backoffice SÍ los tiene (catálogo de proveedores:
  RFC, banco, cuenta, CLABE; "Método de pago" y "Forma de pago") en la
  pantalla Pago a Proveedores, pero la API no los manda. Mientras Gonzalo
  no los agregue, se capturan en `proveedores_datos_bancarios` (origen
  'captura') o se aprenden de los SPEI ya enviados (`fn_bancarios_desde_spei`,
  cron diario 13:07 UTC, origen 'spei', solo CLABE con dígito verificador;
  nunca pisa 'captura'). **Importar el catálogo del backoffice** (30-sep):
  Tesorería → "Importar datos bancarios de proveedores" sube Excel/CSV
  (`components/ImportarBancariosProveedores.tsx`, `lib/importarBancarios.ts`
  con pruebas: encabezados Proveedor/RFC/Banco/Cuenta/CLABE, columna
  combinada "CUENTA: …, CLABE: …", dígito verificador, fuera tarjetas) →
  `fn_proveedores_bancarios_importar(jsonb)` (origen 'backoffice'; no pisa
  'captura'). No existe endpoint de proveedores en el backoffice
  (api_proveedores_aut y similares: 404). Pendiente: la fila "CONST SUPER Y CONSUL LOMA SA"
  (empresa propia) quedó aprendida; excluir por la palabra LOMA/RFC propio.
  **API ampliada por Gonzalo (30-sep-2026)**: `api_ocs_aut` trae además
  `SUBTOTAL`, `IVA`, `RFC_Proveedor`, `Banco_Proveedor`, `Cuenta_Proveedor`
  ("CUENTA: …, CLABE: …"), `Metodo_Pago` y `Forma_pago` (el encabezado ya
  NO trae `Tipo_pago`; las partidas sí). La sincronización guarda
  `ordenes_compra.subtotal_backoffice/iva_backoffice/metodo_pago_backoffice`,
  `tipo_pago_backoffice = coalesce(Forma_pago, Tipo_pago)`, y llena
  `proveedores_datos_bancarios` (origen 'backoffice', OC más reciente por
  proveedor, CLABE con dígito verificador, cuenta 6-14 dígitos, nunca pisa
  'captura'); `v_oc_importes` prefiere SUBTOTAL/IVA del backoffice
  (`20260930140000`). Con esos campos la API tarda ~95 s (encabezado) + 60 s
  (partidas): el `statement_timeout` general de 120 s cortaba la
  sincronización desde el 29-sep 21:15 UTC; los trabajos de pg_cron fijan
  `set statement_timeout = '10min'` antes de llamar (`20260930130000`; un
  SET dentro de la función no sirve).
  **Clic en la empresa (20-oct-2026, Mario: "en el reporte de tesorería de
  Delia, cuando doy click, debe llevarme a los pagos por hacer de la empresa
  específica")**: cada tarjeta del semáforo es clic: en `/finanzas/tesoreria`
  filtra por `?empresa=<id>` (por pagar hoy, pagados y programados para
  después; resaltada, "ver todas") y baja a `#por-pagar`; en el inicio
  (compacto) liga a `/finanzas/tesoreria?empresa=<id>#por-pagar`.
  **RFC en cada pago (20-oct-2026, Mario)**: bajo el proveedor sale "RFC …"
  (`v_pagos_programados.rfc_proveedor`, de `proveedores_datos_bancarios`) o
  en ámbar "sin RFC"; se captura en "editar" de los datos bancarios. Al
  20-oct solo 31 de 64 pagos pendientes lo tienen (fichas de proveedor: 0;
  CFDI recibidos con el mismo nombre: 1).
  **"Confirmar varios pagos" vacío (20-oct-2026, Mario: "no se puede dar
  click")**: la lista y la vista de pagos de la Base de OC embebían
  `ordenes_compra(…)` desde `pagos_programados`, pero hay DOS llaves entre
  esas tablas (`pagos_programados.orden_compra_id` y
  `ordenes_compra.pago_programado_id`) y PostgREST respondía 300
  (PGRST201, ambigua); la pantalla no mostraba el error y salía "No hay
  pagos por confirmar". Delia acabó subiendo comprobantes uno por uno (8 el
  19-oct) y ningún pago se había confirmado nunca. Ahora el embed lleva la
  llave: `ordenes_compra!pagos_programados_orden_compra_id_fkey(…)` y
  `ConfirmarPagos` pinta el error de carga. **Embed entre pagos_programados
  y ordenes_compra → siempre con `!<fkey>`.**
  **El efectivo no es de tesorería (20-oct-2026, Mario: "a Delia no le
  tocaría ver y confirmar pagos en efectivo")**: Tesorería (lista, tarjetas
  y "pagos sin comprobante") filtra `metodo <> 'efectivo'`; el efectivo lo ve
  y confirma dirección en Efectivo por confirmar. Trigger
  `pagos_programados_efectivo_guarda` (`20261020120000`): con usuario, solo
  admin o dirección dejan un pago en efectivo como pagado o confirmado
  (edge, `fn_oc_confirmar_pagadas` o update directo). Probado: Delia
  bloqueada, Laura sí.
  **Comprobantes (30-sep)**: aviso arriba de Tesorería (también en el
  inicio) con el % de pagos pagados sin comprobante y la lista para subirlos
  (`components/PagosSinComprobante.tsx`, `lib/comprobantesPago.ts`), KPI
  `fin_pagos_sin_comprobante` (ámbar ≥1 %, rojo ≥20 %).
  Botón **"Actualizar OC/OV"** en Programación de pagos
  (`components/BotonSincronizarOcOv.tsx`): dirección también puede pedir la
  sincronización (`solicitar_sincronizacion_oc_ov`, `20260929130000`).
- **Supervisión con IA por proyecto (28-sep-2026)**: pestaña "Supervisión
  IA" (`proyectos/SupervisionIA.tsx`) con reporte diario, minuta (con
  acciones → tarjetas del tablero de avance), resumen de hilo/documento,
  comparativa de cotizaciones y reporte de avance para el cliente (este
  último toma tareas, requerimientos, PU y control de obra del proyecto).
  Edge `proyecto-supervision-ia` (SDK Anthropic, `claude-opus-5`, effort
  medium, system prompt cacheado, sin fallbacks); guarda cada corrida en
  `proyecto_bitacora_ia` con el cliente del usuario (RLS). Requiere
  `ANTHROPIC_API_KEY` válida en secrets; si no, devuelve error claro.
- **Flujo de dirección / cuentas por pagar (28-sep-2026)**: Laura (rol
  `direccion`) arranca en `/finanzas/saldos` (`InicioSegunRol` la redirige;
  el inicio completo queda en `/inicio`). Cada empresa y cuenta de Saldos
  por empresa es un link a `/movimientos?empresa=&cuenta=` (Movimientos lee
  esos params y filtra por `cuenta_id`). "Primer candado" al revisar OC:
  `/finanzas/proveedores` (`pages/finanzas/CuentasPorPagar.tsx`) sobre la
  vista `v_cxp_proveedores`: comprometido (OC) → facturado (CFDI recibidos)
  → pagado detectado (complementos + cargos bancarios con el mismo nombre)
  → por pagar, contra `proveedores_credito` (línea y días; capturan admin/
  corporativo/direccion). Los nombres se agrupan con `fn_proveedor_clave`
  (quita acentos, puntuación y SA DE CV). Semáforo en `lib/cuentasPorPagar.ts`
  (con pruebas): gris sin línea, rojo si se rebasa o queda <10 %, ámbar <30 %.
  Detalle por proveedor con `fn_cxp_proveedor_detalle(clave)`. **Menú
  exclusivo de dirección** `/finanzas/lineas-credito`
  (`pages/finanzas/LineasCredito.tsx`, ruta con `roles={["direccion"]}`):
  captura de línea, días, `vencimiento` (date) y notas por renglón, con
  semáforo de vencimiento (`estadoVencimiento`: vencida / por vencer ≤30 d).
  Ojo: el banco
  rara vez trae el nombre del proveedor, así que "pagado" sale bajo y "por
  pagar" alto hasta que se capturen complementos de pago.
- **Organigrama de accesos por rol**: Admin → "Accesos por rol"
  (`pages/admin/Roles.tsx`, `lib/accesosRoles.ts`): "ve" se calcula del
  catálogo del menú con un perfil de muestra; "edita" es el mapa EDITA a
  mano. **Si cambia una policy, actualizar EDITA.** Los módulos puros que
  se prueban en node importan con extensión `.ts` (`menu.ts` incluido).
- **Archivos privados se ven en `/archivo` (6-oct-2026, Fernando: "InvalidJWT
  exp claim timestamp check failed")**: las funciones dan ligas firmadas de
  Storage de 1-60 min; abrirlas directo en una pestaña caducaba al volver o
  al recargar (Safari). Ahora los botones abren `/archivo?f=<fuente>&id=`
  (`pages/VerArchivo.tsx`, `lib/verArchivo.ts` con pruebas; fuentes rh,
  checador, tarea, plano, pago, cotizacion, gasto), que pide una liga nueva
  cada vez que carga y muestra imagen o PDF. **Visor nuevo de archivo →
  agregarlo a `FUENTES_ARCHIVO`, nunca `window.open(json.url)`.**
  **Descargar de verdad (20-oct-2026, Mario: "permite a los supervisores
  bajar archivos de los adjuntos en las tarjetas")**: el servidor ya les
  daba el archivo (RLS de `tarjeta_archivos` = la de `tarjetas`; edge
  `tareas-archivos` con 200), pero el visor solo lo mostraba y en el celular
  no se podía guardar. Ahora `rutaVerArchivo(fuente, id, { descargar:
  nombre })` → `/archivo?…&descargar=` y la página redirige a la liga
  firmada con `download=` (`urlDescarga`, Content-Disposition attachment);
  botón "Descargar" en cada archivo de la tarjeta (`TarjetaPanel`) y en el
  encabezado del visor para cualquier fuente.
- Impresión/PDF: HTML generado en `web/src/lib/*.ts` (puro, con pruebas) y
  abierto como URL blob (`lib/imprimir.ts`); la pestaña se abre durante el clic
  (móvil). QR con `qrcode` (import dinámico).
- `web/version.json` + `AvisoVersion`: aviso de "versión nueva" en pestañas viejas.
- Foto de nota de entrega: evidencia por defecto; lectura por IA opcional
  (requiere `ANTHROPIC_API_KEY` válida en secrets de Edge Functions; la actual
  daba `invalid x-api-key` el 21-sep-2026).

## Alcance por empresa: por persona y por rol (28-sep-2026)
- Mario: "cada empresa funciona por separado; yo activo qué roles manejan
  más de una". Tres piezas (`20260928180000_alcance_multiempresa.sql`):
  1. `roles_alcance(rol, multiempresa)`: interruptor por rol, lo prende el
     admin maestro en Admin → Accesos por rol. Apagado = cada persona ve
     solo su empresa principal aunque tenga otras asignadas.
  2. `profiles.empresa_id` = empresa **principal** (donde checa y está su
     expediente); `profiles.todas_las_empresas` = todas las de su
     organización; `profile_empresas(profile_id, empresa_id)` = las demás
     que maneja. Se asignan en Admin → Usuarios ("Maneja también").
  3. `empresa_en_alcance(e)` y `auth_ve_todas_empresas()` aplican esa regla
     en UNA consulta sobre profiles. `auth_ve_todas_empresas()` ahora
     significa "admin, o rol multiempresa con la marca todas"; alguien con
     dos empresas asignadas NO ve todas. `auth_empresas_alcance()` /
     `fn_mi_alcance()` alimentan `useAuth().empresasAlcance`,
     `veTodasLasEmpresas` y `rolMultiempresa`.
- **Ya no se escribe `empresa_id = auth_empresa_id()` en policies ni
  funciones**: la migración reescribió las 39 policies y 13 funciones que lo
  hacían por `empresa_en_alcance(empresa_id)` (regexp sobre pg_policy /
  pg_proc). Toda policy nueva usa `empresa_en_alcance()`.
- Siembra: quien tenía empresa en blanco quedó con `todas_las_empresas`, y
  su rol con `multiempresa = true` (incluye operativo y supervisor por
  Paola, Brenda, Fernanda y Mauro): nadie ve más ni menos que antes. Mario
  decide después qué apaga.
- **Empresa activa (fase C, 28-sep-2026)**: `useAuth().empresaActiva`
  (localStorage por usuario; una sola → fija; varias → la guardada, "todas"
  para quien ve todas). Selector compacto en el encabezado
  (`components/SelectorEmpresa.tsx`, `useEmpresasAlcance()` acota la lista
  al alcance). Las pantallas usan `useEmpresaFiltro()` (= empresa activa) y
  `<SelectorEmpresa>` en vez de su propio `useState(perfil.empresa_id)` +
  `veTodasLasEmpresas ? <select>`: carga, inventario (productos, existencias,
  match, movimientos, remisiones), gastos, perfil fiscal, proyectos,
  requisiciones, movimientos bancarios. Saldos por empresa, panel de
  indicadores y socio siguen consolidados. Toda pantalla nueva con filtro
  de empresa usa esos dos.
- **"Ver como" (solo admin, 28-sep-2026)**: botón en el encabezado
  (`Layout.tsx` → `VerComo`): elige rol y empresa y la app se pinta con ese
  perfil (`useAuth().perfil` simulado; `perfilReal` es el de la sesión;
  sessionStorage). Solo cambia la interfaz: RLS sigue siendo la del admin.
  Los roles básicos se ven con todos los módulos. Banner ámbar arriba y
  "Volver a mi vista".

## Nivel socio y organizaciones (25-sep-2026)
- `/` para admin = **vista de socio** (`pages/Socio.tsx`): organizaciones
  (`grupos`: LOMA maestro, ARSSA ejemplo) → empresas → KPIs por empresa, con
  `fn_socio_resumen()` (SECURITY DEFINER, solo admin) que llama
  `fn_kpis_empresa(uuid)`: mismas claves que `lib/indicadores.ts`, calculadas
  por empresa en SQL. El organigrama acepta `?empresa=<id>` y entonces pinta solo
  los KPIs que existen en ese mapa (`lib/kpisEmpresa.ts`).
- Multi-organización **ya está completo en producción** (25-sep-2026):
  `grupos`, `grupo_modulos`, frontera RLS restrictiva en ~77 tablas,
  suscripciones con escalones por usuario y logotipo por organización.
  `grupos` sí tiene policies: se puede leer desde el navegador.
- `fn_socio_resumen()` y `fn_kpis_empresa()` cuentan dinero por empresa: la
  primera se acota con `grupo_en_alcance()`, la segunda está revocada de
  `authenticated` (solo `service_role`) y se consulta por
  `fn_kpis_empresa_publica()`. Cualquier función nueva que sume dinero o gente
  necesita la misma guarda.
- Almacén: OC/OV se listan de la más reciente a la más vieja (`fecha` en
  `avance_recepcion_oc` / `avance_embarque_ov`, selector con fecha y filtro de
  texto). Match OC/OV: botón "Registrar entrada/salida" → `/inventario?empresa=
  &tipo=&oc=|ov=` (Movimientos lee esos params). Partidas de OV con
  `v_ov_lineas_avance`. `existencias` trae `costo_promedio` (ponderado de
  entradas con costo) y `valor`.
- **Socios**: tabla `socios_organizacion(profile_id, grupo_id, inicio)`; el admin
  los administra desde la vista de socio (RPC `fn_socios_listar/asignar/quitar`).
  `fn_socio_resumen()` devuelve todas las organizaciones al admin y solo las
  propias a un socio; `RutaSocio` protege `/socio`, `/organigrama`, `/area`.
  Laura es socia de ARSSA (sin `inicio`: conserva su inicio). Aldo pendiente de
  cuenta.
- **Comprobación de gastos / caja chica**: `comprobaciones_gasto` + vista
  `v_comprobaciones_gasto`; sube por edge function `gastos-comprobar`
  (archivo al bucket privado `cargas/comprobaciones/…`, push a admin/direccion/
  corporativo). Pueden comprobar: supervisor, responsable, directivo,
  administrativo, corporativo, direccion, empresa, admin
  (`auth_puede_comprobar_gasto`); revisan admin/corporativo/direccion. Página
  `/gastos`; KPI `fin_comprobaciones_por_revisar`.
- **Ojo**: la rama de ARSSA recrea policies en producción sin las de inventario
  (pasó el 25-sep: "new row violates RLS for productos"). Se restituyeron con
  `20260925130000_inventario_permisos_tras_frontera.sql`; si vuelve a pasar,
  volver a aplicar esa migración.
- **Rendimiento con la frontera (26-sep-2026)**: las policies llaman por fila
  a `empresa_en_alcance()` / `empresa_en_mi_organizacion()`; se reescribieron
  esas funciones (y `auth_admin_global`, `grupo_en_alcance`,
  `auth_modulo_habilitado`) como UNA consulta sobre `profiles` en vez de
  8-10 funciones anidadas (`20260926090000_rls_helpers_rapidos.sql`). No
  volver a anidarlas. `v_movimientos_cierre` ya no usa NOT EXISTS
  correlacionado (era cuadrático). Los KPIs del inicio y del organigrama a
  nivel grupo salen de `fn_kpis_alcance()` (una RPC, enmascara claves de
  finanzas/RH por rol); solo lo que no está ahí se consulta vista por vista.
  Síntoma si se rompe: "canceling statement due to statement timeout" en
  ráfagas al abrir el inicio.
- **Helpers una vez por consulta (28-sep-2026)**: Postgres evalúa
  `(select f())` dentro de una policy UNA vez por consulta (InitPlan); una
  llamada directa `f()` corre por fila (0.4-2 ms cada una: 1-8 s en tablas
  de 2-3 mil renglones). `20260928210000_rls_helpers_una_vez_por_consulta.sql`
  (aplicada en producción como `rls_helpers_en_policies`) reescribió las
  371 policies: `helper()` → `(select public.helper_definer())` (copias
  idénticas de los 19 helpers sin argumentos), `empresa_en_alcance(X)` →
  `X = any ((select public.auth_empresas_alcance())::uuid[])` (el `::uuid[]`
  es obligatorio), y lo mismo con `auth_empresas_organizacion()`,
  `auth_grupos_alcance()`, `auth_perfiles_alcance()`,
  `auth_modulos_habilitados()`, `auth_modulos_asignados()`. **Regla: en una
  policy nunca se llama a un helper directo por fila; y NO envolver el
  `(select …)` dentro de una función SQL (no se inlina y sale peor).**
  Medido como Laura: movimientos 4.4 s → 0.04 s, partidas de OC 6 s → 0.24 s.
- **Frontera por profile_id**: nunca `exists (select 1 from profiles …)`
  dentro de una policy (profiles solo deja leer el renglón propio y la
  frontera se vuelve invisible para RH). Usar `perfil_en_alcance(profile_id)`
  (definer; `20260926200000`). Síntoma: "Marca no encontrada o sin permiso".
- **Checador con cámara en página (28-sep-2026)**: `components/CamaraSelfie.tsx`
  (getUserMedia, cámara frontal, captura a canvas ≤1024 px). El botón de
  entrada/salida abre la cámara y al capturar marca solo; la foto se respalda
  en sessionStorage 15 min por si el navegador recarga; plan B: `<input
  type=file>` sin `capture` ("elegir de la galería"). Motivo: en el Android de
  Christian la app de cámara nunca regresaba el archivo y el botón "volvía a
  pedir foto".
- Evidencia (foto de nota/remisión) en Registrar movimiento es una sección
  siempre visible para entrada y salida (edge `ocr-nota-entrega` v8 valida con
  `auth_puede_escribir_inventario`). No se guardan líneas ni remisiones en 0.

## ARSSA, el primer cliente (25-sep-2026)

- Entra **solo con Proyectos**. `proyectos` ya es un módulo de verdad
  (`modulos` + `grupo_modulos`), abierto a LOMA y ARSSA y cerrado para
  cualquier organización futura. Sus cinco tablas piden
  `auth_modulo_habilitado('proyectos')` y, al escribir, suscripción.
- Aldo Rodríguez (arq.aldorodriguez@gmail.com) es **admin de ARSSA** y socio
  de ARSSA. ARSSA todavía no tiene empresa: su primer paso es Admin →
  Empresas.
- **La marca es de cada organización, no está escrita a mano.** El título, la
  pantalla de acceso y el manifiesto de la PWA se arman con `marca.ts` /
  `useMarcaDeEntrada.ts`. Antes de entrar no hay sesión, así que la
  organización se sabe por el `?org=<codigo>` del link o por la última sesión
  en ese dispositivo, y se lee con `fn_marca_publica(codigo)` -- la única
  función abierta a `anon`, y solo devuelve nombre y ruta del logotipo de UNA
  organización que se pide por código. Link de ARSSA:
  `https://acumulado-nine.vercel.app/?org=arssa`.
  Si algo vuelve a caer a un nombre fijo, que sea "Acumulado": **nunca** la
  marca de otro cliente.
- **El menú se acota por módulo**, no solo por rol (`seccionesPara(perfil,
  alcanceOrganizacion)` y `rutaPermitida`). Una entrada de menú sin `modulo`
  declarado no se le muestra a un cliente: es el default seguro, igual que en
  la base. Las de `personal: true` (checador, mis documentos, guía, admin de
  su propia cuenta) siempre se ven.
- **Crear cuentas por SQL**: si alguna vez hay que hacerlo sin poder llamar a
  `admin-crear-usuario`, las columnas de texto de `auth.users`
  (`confirmation_token`, `recovery_token`, `email_change*`, `phone_change*`,
  `reauthentication_token`) tienen que ir en `''`, **no en NULL**: el servicio
  de sesiones las lee como texto y responde "Database error querying schema"
  al intentar entrar. Pasó con la cuenta de Aldo.

## Roles de personal contratado (24-sep-2026)
- `operativo` (solo checador), `administrativo`, `supervisor` (ve el checador de
  su gente: `personal.supervisor_profile_id`), `directivo` (ve el checador de
  todos). Entran a Checador, Mis documentos y a los módulos de `permisos_modulo`
  (inventario, produccion, precios, requisiciones, tareas, proyectos, bbva);
  finanzas cerrado (`ProtectedRoute modulo="finanzas"`).
- **Tareas viene de fábrica para todo rol básico** (`MODULOS_BASE` en
  `lib/modulos.ts`, mezclado en `perfil.modulos` por `modulosEfectivos`); la
  base ya lo permitía (`tablero_visible`: cualquier rol ≠ pendiente ve los
  tableros de su empresa y los que no tienen empresa, como "RH · Actividades").
- Tarjetas: `asignado_a` = responsable principal (cuenta en cumplimiento),
  `supervisor_id` y `corresponsables uuid[]`. Avisos push de seguimiento por
  edge `tareas-notificar` (asignada, supervisor, corresponsables, comentario,
  movida; a todos los involucrados menos quien hizo el cambio) llamada en
  segundo plano desde `lib/tareasNotificar.ts`; el recordatorio diario
  (`push-enviar-recordatorios`, cron 14:00 UTC) también les llega a todos.
- **Fecha compromiso con autorización (28-sep-2026)**: la primera fecha de
  una tarjeta se pone libre; después, el trigger `tarjetas_fecha_guard`
  solo deja cambiarla directo al jefe inmediato (`auth_es_jefe_de_tarjeta`:
  supervisor de la tarjeta, jefe RH de la persona asignada, responsable del
  proyecto, rol empresa de esa empresa, admin/corporativo/direccion) y la
  registra; los demás solicitan con motivo (`fn_tarjeta_fecha_solicitar`) y
  el jefe resuelve (`fn_tarjeta_fecha_resolver`, no la propia). Tabla
  `tarjeta_cambios_fecha`; contador `tarjetas.fecha_cambios` (KPI de RH,
  Mis actividades, tarjeta del tablero). Frontend: `lib/fechaCompromiso.ts`
  (`cambiarFechaOSolicitar`) y `tareas/FechaCompromiso.tsx`.
- **Mis actividades** (`pages/tareas/MisActividades.tsx`): panel personal en
  `/tareas` y en el inicio del rol básico; lista lo que la persona tiene como
  responsable, supervisor o corresponsable, con su cumplimiento. El tablero
  acepta `?tarjeta=<id>` para abrir el panel directo. Archivos de tarjeta:
  sin límite de cantidad, 50 MB cada uno, ruta en Storage saneada a ASCII
  (`tareas-archivos` v2).
- RH crea la cuenta en RH > "Accesos al sistema" cuando el expediente tiene INE,
  CURP y comprobante de domicilio (`admin-crear-usuario` con `personalId`: correo
  generado `nombre.apellido@grupoloma.mx`, link por WhatsApp al celular). RH cambia
  rol dentro de la familia básica con `rh_asignar_rol_basico`, nunca a admin.
- **Contraseña temporal (29-sep-2026)**: RH (Accesos, "Contraseña temporal")
  y admin (Usuarios) la generan con `generar-link-acceso` tipo `contrasena`
  (formato `Loma-XXXX-9999`, se muestra una sola vez, botón WhatsApp). RH solo
  a personal con rol básico (`rh_administra_perfil`). La función ahora exige
  la **misma organización** salvo el admin maestro (`auth_admin_global`):
  antes un admin de otro cliente podía generar links para gente de LOMA.
  La persona la cambia con el botón "Contraseña" del encabezado
  (`cambiarContrasena()` en `useAuth` → `NuevaContrasena`).
- **RH administrativo da de alta y manda links (2-oct-2026, Mario: "Raúl
  también crea cuentas")**: Raúl Molina (rh, `rh_nivel` administrativo) ve
  RH → "Accesos al sistema": crea la cuenta (con rol básico), reenvía el
  link y pone contraseña temporal. `admin-crear-usuario` v6 ya no exige
  `auth_rh_directivo` y valida que la persona sea de la organización de RH.
  Cambiar rol, módulos y supervisor después sigue siendo de RH directivo
  (Eréndira, Fernando): `Accesos({ directivo })`, `rh_asignar_rol_basico`.
- **Link a cuentas operativas (2-oct-2026, Fernando con Carlos Sánchez
  Xilot, supervisor_bbva)**: `generar-link-acceso` v5 usa
  `rh_puede_mandar_acceso()` (personal contratado con rol básico,
  pendiente, supervisor_bbva, responsable, almacen, produccion o
  rh_documentos; nunca admin/direccion/corporativo/rh/empresa;
  `20261002090000`). `rh_administra_perfil()` no cambió.
- **Jefe directo sin importar el rol (2-oct-2026, Fernando con el equipo
  BBVA)**: `auth_ve_checador_de` ya no pide rol 'supervisor': quien está en
  `personal.supervisor_profile_id` ve el checador de esa persona
  (`20261002100000`). En Accesos la columna Supervisor ofrece a cualquiera
  con cuenta que no sea operativo (Christian, responsable+BBVA). Los roles
  de BBVA (supervisor_bbva = cuadrillas de folios, responsable con
  bbva_mantenimiento) no se cambian a básicos: mueven el módulo BBVA.
- **Responsable de checador (5-oct-2026, Mario: "más que directivo, un rol
  únicamente de responsable de checador")**: permiso por persona
  `permisos_modulo` 'checador' (no es rol): `auth_ve_checador_de` le abre
  las marcas de todo el personal de SU organización; entra a "Asistencia del
  equipo" (`/bbva/asistencia`); se asigna en RH → Accesos ("Responsable de
  checador"). Valery López (practicante de RH, administrativo) lo tiene
  (`20261006090000`). Bajas 5-oct: cuentas Gmail duplicadas de María
  Fernanda y Mauro (supervisor, nunca entraron) desactivadas y bloqueadas;
  sus expedientes de RH pasaron a la cuenta que sí usan (responsable).
- **Equipo de protección personal (6-oct-2026, Mario con Raúl)**: RH →
  Operación → "6. Equipo de protección (EPP)" (`pages/rh/EquipoProteccion.tsx`).
  Una entrega por persona (`epp_asignaciones`, folio EPP-<emp>-0001) con
  cargo a la obra que RH elige (para lo que no es de obra: proyectos
  "Corporativo …"; empresa = la de la obra) y piezas
  (`epp_asignacion_lineas`: talla, costo, vigencia en meses, origen bodega o
  compra; por_surtir → entregado → devuelto | sustituido | perdido; trigger
  calcula `vence_el` y propone descuento = cantidad × costo al perderse).
  "Pedir a compras" = `fn_epp_pedir_compra` (definer: RH no tiene permiso de
  requisiciones) crea la requisición en esa obra con las piezas a comprar y
  Alma la resuelve normal. Responsiva imprimible (`lib/epp.ts`, con pruebas;
  art. 110 LFT para el descuento), semáforo de vigencia (ámbar ≤30 días) y
  "Por descontar vía nómina" con "Marcar aplicado" (ya aplicado no se
  cambia). Operan RH y admin (`auth_opera_epp`); almacén solo ve
  (`20261006100000`, prueba `supabase/tests/epp.sql`). Pendiente: salida de
  inventario de bodega ligada a la entrega.
  **Solicitud de EPP (21-oct-2026, Mario: "da de alta a los supervisores y
  revisa que Christian tenga habilitada la solicitud de EPP"; eligió "que
  pidan EPP")**: menú RH → **Solicitar EPP** (`/epp/solicitar`,
  `pages/rh/SolicitarEpp.tsx`; visible a supervisor, responsable —Christian
  incluido— y RH): persona (de `fn_epp_personas_para_solicitar()`: personal
  activo de la organización, solo id/nombre/puesto/empresa, primero la gente
  a cargo por `supervisor_profile_id`), obra opcional, piezas (talla,
  cantidad) y nota → `fn_epp_solicitar` (folio SE-<emp>-0001; sin empresa
  conocida SE-0001 por organización); abajo "Mis solicitudes" con estado y
  motivo de rechazo. Puede pedir `auth_solicita_epp()`: rh/admin, supervisor,
  responsable o jefe directo de alguien; nunca pendiente/espectador (Alma no).
  En Equipo de protección (EPP) de RH, arriba, "Solicitudes por atender"
  (`pages/rh/SolicitudesEppPorAtender.tsx`): Atender (elige obra si no
  venía) → `fn_epp_atender_solicitud` crea la entrega EPP-… con sus piezas
  por surtir (luego bodega o "Pedir a compras" como siempre); Rechazar con
  motivo → `fn_epp_rechazar_solicitud`. Tablas `epp_solicitudes` /
  `_lineas` (frontera por grupo_id; quien pidió ve las suyas, RH todas; se
  escribe solo por las funciones) (`20261021100000`; validación en
  `lib/epp.ts` `limpiarPiezasSolicitud`/`revisarSolicitudEpp`, con pruebas).
  Probado en producción en rollback: Christian ve 44 personas (5 a su cargo)
  y pide SE-CSC-0001; Brenda (sin empresa) SE-0001; cada quien ve solo la
  suya; Fernando ve las dos, atiende la de Christian en BBVA Mantenimiento
  (EPP-CSC-0001 con 2 piezas) y rechaza la de Brenda; Alma no puede pedir.
- **Backoffice congelado (5-oct-2026, Delia/Laura)**: `api_ocs_aut` devolvió
  la última OC 41146 (2-oct 17:35); nada del fin de semana ni del lunes. No
  es de Acumulado: la sincronización corre bien y guarda lo que la API
  entrega. Si vuelve a pasar: `net.http_get` a la API y contar
  `ordersProject` antes de buscar el error aquí.
- **Editar datos del personal (2-oct-2026, Raúl)**: botón "Editar" en RH →
  Personal; reutiliza el formulario de alta prellenado (RLS de `personal`
  ya dejaba actualizar a cualquier rh).

## Costeo de obra del director general (30-sep-2026)
- Mario: reporte "único mío como director general", modelo para las obras
  de **Abarrotes Neto** (empieza con **Abarrotes Neto Rio Frio**, proyecto de
  CSC dado de alta el 30-sep: responsable y supervisor Miguel Angel Tepal;
  Timoteo Colapala pasó a `administrativo` con empresa principal CSC y
  módulos proyectos + requisiciones para planos y lo administrativo).
- `20260930170000_costeo_obra_director.sql` (aplicada): `proyecto_costeo`
  (folio, inicio/fin, subtotal, IVA, m², ubicación, lat/long, km, plano,
  % indirectos propio), `proyecto_presupuesto_cliente` (partidas; se pegan
  desde Excel), `proyecto_costeo_directos` (contratista / personal /
  material / otro, cantidad × costo), `proyecto_costeo_imss` (lo captura
  contabilidad, rol corporativo: Belén) e `indirectos_tabulador` (% por km,
  por organización). **Solo rol admin** lee y escribe; corporativo solo
  el IMSS y el personal/contratistas (`v_costeo_imss_pendiente`,
  `/finanzas/seguro-social-obras`).
- Cálculo en `lib/costeoObra.ts` (con pruebas): indirectos = % × (directos
  + IMSS); % = propio o el del tabulador por km; utilidad pronóstico =
  subtotal del contrato − (directos + IMSS + indirectos); venta y costo por
  m². Reporte imprimible `lib/reporteObra.ts` (contrato → presupuesto del
  cliente → costeo y utilidad → real a la fecha por OC con el mismo nombre de
  obra → alertas). Pestaña "Costeo (director general)" en el proyecto
  (`proyectos/CosteoObra.tsx`), solo admin.
- El ingreso de Abarrotes Neto no está en el sistema (ni CFDI emitidos ni
  depósitos con su nombre); las OV de "Abarrotes Neto" son internas (AEP →
  CSC). El tabulador de indirectos arranca vacío: lo captura Mario.

## Comedor (30-sep-2026)
- Mario: "una empresa aparte, vinculada a las aplicaciones de los
  trabajadores para ordenar y llevar su descuento vía nómina".
  `20260930150000_modulo_comedor.sql` (aplicada): módulo `comedor`
  (`grupo_modulos`, abierto a LOMA; también asignable por persona para los
  cocineros con rol básico), empresa **COM · Comedor** en LOMA
  (`comedor_config`: empresa y hora límite), `comedor_platillos` (precio),
  `comedor_menu` (platillos por fecha, cupo opcional), `comedor_pedidos` +
  `comedor_pedido_lineas` (precio congelado; totales en `v_comedor_pedidos`).
  Un pedido por persona por día, hasta la hora límite; el trabajador
  necesita expediente activo en RH y el descuento va a su empresa
  (`profiles.empresa_id`). **Solo lo entregado se descuenta.** Todo cambio
  pasa por `fn_comedor_pedir / _cancelar / _entregar /
  _aplicar_descuento`; guardas `auth_opera_comedor()` (cocina) y
  `auth_ve_nomina_comedor()` (RH, dirección, corporativo, admin).
- Frontend `/comedor` (`pages/comedor/Comedor.tsx`, pestañas según
  permiso): **Pedir comida** (hoy/mañana, historial y "por descontar"),
  **Cocina** (menú del día, copiar el de ayer, cupo, platillos y precios,
  lista de pedidos con "Entregado", "por preparar" sumado) y **Descuento
  vía nómina** (periodo, por empresa y trabajador, CSV para Excel, "Marcar
  aplicado en nómina"). Reglas puras en `lib/comedor.ts` (con pruebas).
  Acceso rápido en el inicio y entrada en el menú; permiso "Comedor
  (cocina)" asignable desde RH → Accesos. Prueba `supabase/tests/comedor.sql`.
- **Encargada de cocina (19-oct-2026, Mario: "Moni Moreno será la
  encargada de comedor; únicamente va a ver las comidas que el personal
  solicite")**: Monica Moreno Rojas (morenorojasmoni79@gmail.com, operativo,
  con expediente) con `permisos_modulo` 'comedor': ve Pedir comida + Cocina
  (pedidos, entregar, menú y platillos); no ve Descuento vía nómina ni nada de
  finanzas (probado en rollback). Al 19-oct el comedor está vacío: 0
  platillos, 0 menús, 0 pedidos; ella da de alta platillos y el menú del día.

## Director general (30-sep-2026)
- Mario: "genera un rol de director general; debo poder editar absolutamente
  todo". No es un valor nuevo de `app_rol`: es el **admin de la organización
  maestra** (`auth_admin_global`). `20260930190000_director_general_edita_todo.sql`
  crea `fn_director_general_policies()` (revocada de authenticated) que pone
  la policy permisiva `director_general` (for all, `auth_admin_global_definer()`)
  en TODAS las tablas de public con RLS, menos `config_sistema` (secretos),
  `audit_log`, `eventos_pasarela` y `push_subscripciones`. **Tabla nueva →
  volver a correr `select public.fn_director_general_policies();`** en su
  migración. Los triggers de integridad siguen aplicando. En la interfaz el
  admin maestro se muestra como "director general".
- Remisión de producción (salida): `remisiones_produccion.condicion_pago`
  (contado / credito, obligatoria desde el formulario) y `dias_credito`;
  salen en la remisión impresa (`20260930200000`).
- Lote 001 de Clavicón (30-sep): se registró la entrada de 5,695 kg de
  alambrón 5.5 ligada a la OC 40995 (Aceros y Envasados, $91,507.26 sin IVA =
  $16.068/kg) y se corrigió el consumo del lote de $15.60 al costo real; el
  producto terminado quedó valuado en $1,683.07 por pieza (antes $1,647.05).
  El costo real de materia prima es **sin IVA** (el IVA se acredita).
- Clavicón (30-sep): precio de venta por renglón de remisión y costo
  congelado (`20260930210000`, `v_margen_remisiones_produccion`,
  `produccion/MargenRemisiones.tsx`; se captura con IVA incluido y se guarda
  sin IVA); RM-000001 a $1,740 c/IVA = $1,500 vs costo $1,683.07 (−12.2 %).
  Cotizador (`20260930220000`, `lib/cotizacionPlanta.ts`, última pestaña de
  MCC). Inventario de planta en **Entradas / Salidas** con lista de
  remisiones (`produccion/RemisionesPlanta.tsx`) y **fotos de la entrega**
  (`remisiones_produccion_fotos`, edge `remisiones-produccion-foto`,
  `produccion/FotosRemision.tsx`; `20260930230000`). El admin **reabre** un
  lote terminado; al cerrarlo se actualiza su entrada de producto
  terminado en vez de duplicarla. Ojo: `v_remisiones_produccion` no es
  security_invoker (corre como dueño).
- **OC del backoffice pendientes de autorizar (30-sep-2026, Laura)**: las
  api con `estatus_backoffice = 'Pendiente de Autorización'` salen en "Por
  autorizar" (`OcPorAutorizar`, etiqueta backoffice) y dirección las
  autoriza AQUÍ: `fn_oc_autorizar` las acepta (solo ese estatus), registra
  `autorizada_en` y ya se les programa pago; `v_oc_pagos.autorizacion` y
  `v_cxp_proveedores` respetan esa autorización (`20260930240000`). En el
  backoffice siguen pendientes hasta que alguien las autorice allá. La OC
  impresa trae RFC del proveedor y, en las api, importes de `v_oc_importes`
  (antes sumaba 16 % encima: la 41074 salía en 2,764.75 en vez de 2,383.40).
- **Autorización interna (30-sep-2026, Mario: "no depender de backoffice,
  que no pare el flujo")**: `fn_oc_programar_pago` ya no bloquea las
  pendientes (backoffice "Pendiente de Autorización", RQ, Excel): al
  programar el pago las autoriza internamente (`autorizada_en/_por`; la
  requisición ligada pasa a 'autorizada'). Diferenciador
  `v_oc_pagos.autorizacion_origen` = 'backoffice' | 'interna' (etiqueta
  violeta "autorizada interna · backoffice pendiente" en la lista, sello
  "AUTORIZADA INTERNA" en la OC impresa); botón "Autorizar y programar" y
  el lote también las toma (`20260930250000`). Solo las rechazadas y las
  canceladas del backoffice no se programan.
- **No programar dos veces (30-sep-2026, Mario: "le picamos 3 veces y se
  cargó tres veces")**: la 41074 quedó con 3 pagos de $2,383.40 porque tras
  programar la fila seguía mostrando saldo completo y "Programar pago" (el
  saldo es total − pagado; lo programado no lo baja). Ahora
  `fn_oc_programar_pago` bloquea la OC (`for update`) y descuenta lo ya
  programado (pendiente); la lista usa `porProgramarOc` (`lib/pagosOc.ts`)
  y muestra "ya programada · $X" en vez del botón (`20260930260000`). Se
  borraron los 2 pagos repetidos (pendientes, sin comprobante).
- **Hoja de pagos del día (30-sep-2026, Excel "PAGOS 30.09.26" de Laura)**:
  `lib/hojaPagos.ts` (con pruebas, reproduce su AEP: 210,275.45 − 137,383.72
  = 72,891.73) y `finanzas/HojaPagosDia.tsx` arriba de las OC en
  Programación de pagos: por empresa, saldo inicial de cada cuenta
  (`fn_saldos_diario_cuenta`) como abono, pagos del día + pendientes
  vencidos como cargo (OC, proveedor, forma de pago = `tipo_pago_backoffice`,
  proyecto, comentarios), saldo corrido y totales; efectivo aparte.
  Imprimir y Excel (CSV). Lista de OC: abre en "Por autorizar" (tabla con
  Autorizar/Programar pago); "Pendiente de Pago" del backoffice solo como
  indicador; selector "Ordenar por" (`ordenarOcs`, folio como número).
- Proyecto: el admin asigna responsable y supervisor/comprador desde el
  encabezado de la obra (`EncargadosObra` en `ProyectoDetalle.tsx`; solo el
  admin puede listar profiles).

- **Proyectos al día con el backoffice (1-oct-2026, Mario: "no me sale
  PASEO 6 AMPLIACION")**: el catálogo se sembró una vez (27-ago) y nada lo
  alimentaba. `fn_proyectos_desde_backoffice()` (definer, revocada de
  authenticated) da de alta los nombres de proyecto de OC/OV api que no
  existan (sin mayúsculas/espacios; empresa = la de más documentos; cliente
  = el de su OV más reciente; nunca "PROYECTO X"; no toca existentes) y
  corre al final de `sync-catalogo-oc-ov-horario` (`20261001090000`). Al
  aplicarla entraron 10 (Paseo 6 Ampliación en MCF, Obra Felipe, Pisos
  Falla geológica N21, Colima…). Encargados: se asignan en el encabezado.
- Gustavo Camacho y Jonathan Sánchez (1-oct-2026, a petición de Christian):
  `operativo`, CSC, `bbva_mantenimiento`, sin expediente en RH todavía.
  Carlos Sánchez Xilot ya tenía cuenta (Gmail, supervisor_bbva); su registro
  carlos.xilot@grupoloma.mx se quedó en `pendiente`.
- **Dirección captura control de obra (1-oct-2026, Laura: "no me deja subir
  presupuestos a las obras")**: `auth_administra_proyecto` (solo la usan
  proyecto_controles / _compras / _nomina) acepta 'direccion' en proyectos
  de su alcance; `ControlObra.tsx` le muestra los botones
  (`20261001100000`). Planos, tableros y lo demás siguen igual.
- **Regla de orden (Mario, 30-sep-2026)**: toda lista de OC/OV va de la
  más reciente a la más vieja: fecha descendente y luego folio descendente
  (el folio es texto: compararlo como número, `localeCompare(…, { numeric:
  true })`; en SQL no ordenar solo por `id_orden`). Aplica a pantallas
  nuevas, selectores, reportes y la hoja de pagos del día.

## Órdenes propias OC / OS / OV con folio IA (10-oct-2026)
- Mario: "genera el módulo de backoffice ya directamente en nuestro sistema
  OC / OV / OS dentro del menú de almacén y compras; folio nuevo para que sea
  IA". Decisiones: folio por tipo compartido entre empresas **IA-OC-0001,
  IA-OS-0001, IA-OV-0001** (secuencias `folio_ia_oc/os/ov`, solo las usa la
  función); **OS = orden de servicio** (va en `ordenes_compra.tipo = 'OS'`:
  se autoriza y paga como OC, no entra a inventario); **conviven con el
  backoffice** (la sincronización solo toca fuente 'api'; lo de aquí es
  fuente **'acumulado'**); capturan admin, corporativo, dirección, almacén,
  empresa o permiso por persona 'compras' (`auth_captura_ordenes()`);
  autoriza dirección con `fn_oc_autorizar` en "Órdenes por autorizar".
- `20261010160000_ordenes_propias_ia.sql`: sin tablas nuevas (reusa
  `ordenes_compra/_lineas` y `ordenes_venta/_lineas`; columnas `notas`,
  `fecha_entrega`, `lugar_entrega`; en OV además `creada_por`,
  `condicion_pago`, `forma_pago`, `subtotal`, `iva`, `cancelada_*`;
  `ordenes_venta_lineas.iva`). Partidas SIN IVA; el IVA por partida y el
  total se calculan en `fn_orden_ia_guardar(id|null, tipo, empresa,
  contraparte, proyecto, fecha, lineas, forma_pago, condicion,
  fecha_entrega, lugar_entrega, notas)` y se guardan en
  `subtotal_backoffice/iva_backoffice` (v_oc_importes los toma). Editar solo
  quien la capturó o dirección, mientras no esté autorizada ni tenga pagos o
  movimientos; cambiar OC↔OS toma folio de la otra serie.
  `fn_orden_ia_cancelar(id, es_venta, motivo)`: OC/OS → rechazada con
  "Cancelada: …" (sin pagos hechos ni entradas; quita lo programado); OV →
  `cancelada_en` (sin salidas). `periodo` es columna generada: no se escribe.
- Frontend `/ordenes?tipo=OC|OS|OV` (`pages/ordenes/Ordenes.tsx`,
  `EditorOrden.tsx`, `VerOrdenVenta.tsx`; `lib/ordenesIa.ts` con pruebas):
  lista con etapa (por autorizar → autorizada → pago programado → pagada ·
  por recibir → recibida), "Ver también las del backoffice", captura con
  sugerencias de proveedores/clientes, obras y productos, imprimir (OC/OS con
  `BotonVerOc`, que ahora titula "ORDEN DE SERVICIO"; OV con el mismo
  formato, cliente y sin sello). Menú: sección nueva **Compras** (OC, OS, OV)
  y entrada en Almacén. "Por autorizar" y el KPI `fin_oc_por_autorizar`
  incluyen fuente 'acumulado' (etiqueta IA). Probado en producción dentro de
  transacciones revertidas; consecutivos reiniciados a 1.
- **Buscador al capturar (15-oct-2026, Mario: "pon el filtro para que
  busquen proveedores, items, para que sea fácil su captura")**: el editor
  ya no usa `datalist` (solo traía proveedores de la misma empresa y el
  catálogo de productos). `fn_ordenes_catalogo_captura(p_venta, empresa)`
  (invoker: RLS de quien captura; ~0.4 s, una vez al abrir) devuelve
  contrapartes de TODAS las OC (o clientes + OV) con RFC, veces, última
  fecha y misma empresa, y cada partida ya comprada/vendida por proveedor
  con unidad y último precio **s/IVA** (api: costo/1.16) + productos del
  catálogo (`20261015090000`). `lib/buscadorCaptura.ts` (con pruebas)
  filtra al instante sin acentos y por palabras en cualquier orden; con
  proveedor elegido gana su propio precio y, con la partida vacía, sugiere
  lo que se le compra. `components/CampoBuscador.tsx` (lista con posición
  fija, flechas/Enter/clic; texto libre permitido) en proveedor/cliente,
  obra y descripción de partida; elegir llena unidad y precio si estaban
  vacíos.
- **Catálogo de compras e histórico de costos (15-oct-2026, Mario: "en
  cuanto a los ítems fíltralos por proveedor para no ver todo el universo;
  necesitamos el módulo para agregar items y proveedores; también es
  importante tener el histórico por proveedor de costos")**
  (`20261015100000`, aplicada en 5 partes por el MCP): tablas
  `proveedores` (por organización, `clave` = `fn_proveedor_clave(nombre)`
  por trigger, la misma de datos bancarios y líneas de crédito; RFC, contacto,
  teléfono, correo, giro, activo) y `proveedor_articulos` (descripción,
  unidad, precio **s/IVA**, IVA; único por proveedor y descripción
  normalizada). Ven y capturan quienes capturan órdenes
  (`auth_captura_ordenes`); borrar proveedor solo admin/dirección (en
  pantalla se desactiva). Frontera, espectador, director general y
  solo_consulta incluidos (validar-sql en verde).
  `fn_proveedor_historico_costos(nombre)` (invoker; ~0.1 s) = cada partida
  de OC a ese proveedor con precio s/IVA. `fn_ordenes_catalogo_captura` ya
  suma fichas, artículos de lista y `obras` (proyecto de OC/OV de la empresa
  + proyectos activos). Pantalla **Compras → Proveedores y artículos**
  (`/compras/catalogo`, `pages/compras/CatalogoCompras.tsx`): lista con
  "con ficha / solo en órdenes", ficha, datos bancarios, artículos con
  precio (sugiere lo ya comprado) e histórico por concepto (último, anterior
  distinto, variación ▲▼, mín/máx, promedio ponderado, detalle por orden,
  "a la lista", Excel; `lib/historicoCostos.ts` con pruebas); pestaña
  "Comparar precios" (`compararPrecios`). En el editor de órdenes, con
  proveedor elegido solo salen SUS partidas (`filtrarItems(..., true)`;
  casilla "buscar partidas de todos"), aviso si no tiene, y liga a dar de
  alta. **Mario negó** agregar `clave` al JSON del catálogo por MCP: la
  ficha se busca con `rpc fn_proveedor_clave` desde la pantalla.
- **Catálogo propio de items (21-oct-2026, Mario: "para compras, un módulo
  para agregar nuevos items"; eligió "catálogo propio de items", sin
  proveedor)**: tabla `compras_items` (por organización: clave única —en blanco
  = IT-0001 consecutiva por trigger `compras_items_antes`—, descripción única
  sin acentos/mayúsculas, unidad, categoría material/consumible/herramienta/
  equipo/servicio/otro, IVA, `precio_referencia` s/IVA, notas, activo). La lee
  cualquiera de la organización que no sea pendiente (requisiciones la
  sugieren); alta y edición `auth_captura_ordenes()` o `auth_opera_cotizador()`;
  borrar solo admin/dirección (en pantalla se desactiva). Frontera, espectador,
  director_general y solo_consulta. `proveedor_articulos.item_id` liga el precio
  de un proveedor al item; `fn_item_ultimas_compras(descripcion)` (invoker,
  ~0.2 s) = últimas 20 partidas de OC con la misma descripción, precio s/IVA;
  `fn_ordenes_catalogo_captura` suma los items activos (buscador de OC/OS)
  (`20261021110000`). Pantalla Compras → **Catálogo de items**
  (`/compras/items`, `pages/compras/CatalogoItems.tsx`, misma ruta protegida
  que Proveedores y artículos; `lib/catalogoItems.ts` con pruebas): buscador,
  categoría, alta/edición con aviso de duplicado o parecidos, desactivar,
  detalle con precio por proveedor ("ligar al item") y últimas compras. En
  Proveedores y artículos el alta de artículo ofrece los items del catálogo y
  guarda `item_id` (o liga solo por descripción igual); en requisiciones la
  descripción sugiere items (`CampoBuscador` ahora acepta `inputRef`/
  `onKeyDown` para que Enter siga agregando el renglón). Probado en producción
  en rollback: Laura da de alta (IT-0001), edita y sale en el buscador de OC;
  Alma da de alta; Jonathan (supervisor) lee pero no da de alta.
- **Cancelar, impresión completa y clientes registrados (15-oct-2026,
  Mario)**: (1) `fn_orden_ia_cancelar` ya cancela CUALQUIER OC/OS
  (backoffice, Excel, RQ: solo admin/corporativo/dirección; IA también
  quien la capturó), sin pagos hechos ni entradas: quita pagos pendientes,
  RQ regresa sus necesidades a almacén, queda `rechazada_en` + "Cancelada:
  motivo" (la sincronización no toca `rechazada_en`)
  (`20261015110000`). Botón "cancelar" en Programación de pagos / Órdenes
  por autorizar (`OrdenesPorPagar`) y en `/ordenes` para todas sin pagos.
  La IA-OC-0001 de Laura (15-oct) era prueba: ella la canceló ("PRUEBA").
  (2) OC/OV impresas con membrete completo (`empresas` y, si falta,
  `empresas_perfil_legal`), ficha del proveedor (`proveedores`: domicilio
  —columna nueva—, contacto, teléfono, correo) o del cliente registrado
  (`clientes`: domicilio, C.P., régimen, teléfono, correo) y sello rojo
  CANCELADA (`pages/ordenes/datosImpresion.ts`, `htmlOrdenCompra` con
  `empresa_*`, `contraparte_datos`, `cancelada`). (3) En la OV no salían
  los clientes registrados (3: dos de MCC y RAMSICON de AEP) porque sin
  órdenes quedaban al final: `filtrarContrapartes` pone primero los de
  ficha ("registrado") y el editor muestra hasta 40.
- **Cotizador para todas las empresas (15-oct-2026, Mario: "los mismos
  productos y los mismos clientes y la lógica de la de Clavicón para cada
  una de las empresas; un módulo completo")**: `/cotizador`
  (`pages/cotizador/Cotizador.tsx`, menú Compras → Cotizador). Reusa
  `cotizaciones_produccion` / `_lineas` (folio COT-<emp>, precio s/IVA,
  captura c/IVA, costo congelado por partida) y la impresión
  `htmlCotizacionPlanta` con membrete (`empresas` + `empresas_perfil_legal`).
  Productos (`lib/cotizador.ts`, con pruebas): planta (PEPS) > catálogo
  `productos` > lo ya vendido en OV de la empresa; costo de lo que no es
  planta = última compra con la misma descripción (OC s/IVA) o costo de
  referencia. Clientes compartidos: los registrados de TODAS las empresas
  primero + los de OV; "+ dar de alta cliente" (queda en `clientes`).
  "Convertir en orden de venta" → `fn_orden_ia_guardar('OV')` y liga
  `cotizaciones_produccion.orden_venta_id` (la OV la genera quien captura
  órdenes; producción no). `20261015120000`: `auth_opera_cotizador()`
  (producción, admin, corporativo, dirección, empresa, almacén, permiso
  compras o 'cotizador' —nuevo en `permisos_modulo` y en
  `MODULOS_ASIGNABLES`—), policy de cotizaciones con ella, director_general
  en cotizaciones, clientes: ver/alta/corregir para quien cotiza. El
  cotizador de la pestaña de Clavicón (`CotizadorPlanta`) sigue igual y
  comparte el historial. Probado como Laura en rollback (COT-AEP-0001 →
  IA-OV-0001); `folio_ia_ov` reiniciado a 1 (las secuencias no se
  revierten con rollback).
- **Serie única OC/OS (19-oct-2026, Mario: "Alma y Laura cada una tiene sus
  órdenes de compra y de servicio, debiendo ser una serie global para
  todos")**: OC y OS llevaban contador propio (IA-OC-0002 e IA-OS-0002 a la
  vez) y las OC de requisiciones RQ-<emp>-0001. Ahora todas toman número de
  `folio_ia_oc` y conservan su prefijo (la siguiente es la 0003, sea OC u
  OS); `fn_orden_ia_guardar` y `fn_oc_desde_necesidades` reescritas por
  reemplazo sobre su definición (`20261019110000`). Las ya emitidas no se
  renumeraron; `folio_ia_os` queda sin uso.
- **Una serie y una lista para OC y OS (19-oct-2026, Mario: "Alma y Laura
  tienen cada una sus órdenes de compra y de servicio, debiendo ser una
  serie global"; "OC y OS dentro del mismo menú para revisarlo en un solo
  archivo")**: OC, OS y las OC de requisiciones toman el número de la
  secuencia `folio_ia_oc` y conservan su prefijo (IA-OC-0003, IA-OS-0004…;
  ya no RQ-…); `folio_ia_os` sin uso (`20261019110000`). En `/ordenes` la
  pestaña "Compras y servicios (OC / OS)" lista las dos juntas con columna
  Tipo, filtro Todas / Compras / Servicios (`?tipo=OC|OS` solo filtra;
  `?tipo=OV` = pestaña de ventas) y "Descargar Excel" (`csvOrdenes` en
  `lib/ordenesIa.ts`, con pruebas). Menú: una entrada "Órdenes de compra y
  de servicio (OC / OS)" + la de OV.
- **Tres de Laura (20-oct-2026, WhatsApp)**: (1) en su inicio, Cuentas por
  pagar arranca con "Vence hoy o ya venció": empresa · proveedor · OC ·
  días vencida · saldo (`vencimientosPorProveedor` en
  `lib/cuentasPorPagar.ts`, con pruebas; vence = la más antigua entre
  `v_oc_pagos.vence` —fecha OC + días de crédito— y `proximo_pago`; con
  saldo, no rechazada, no pagada en el backoffice). Al 20-oct: 8
  proveedores, ~$366 mil (Cruz Azul $221 mil desde el 8-ago). (2) Excel de
  órdenes en su orden: **Empresa · Folio · Tipo · Proveedor · Tipo de pago ·
  Proyecto · Monto · Fecha · Estatus** (`COLUMNAS_EXCEL_ORDENES`/`csvOrdenes`;
  tipo de pago = `tipo_pago_backoffice` u `ordenes_venta.forma_pago`); la
  Base de OC y pagos usa las mismas 9 primero y luego estatus backoffice,
  pagado, saldo y comprobantes. (3) **"Proyecto X"** sale siempre en la
  lista de obras al capturar (`fn_ordenes_catalogo_captura` lo excluía a
  propósito; es el proyecto de lo que no es de obra en el backoffice: 301 OC
  en 7 empresas) (`20261020090000`).
- **Efectivo que quedaba como transferencia (20-oct-2026, Laura: "las órdenes
  de efectivo las está poniendo como transferencia al momento de
  guardarlas")**: el editor traía "Transferencia" puesta de fábrica (de 33 OS
  de Laura del 19-oct, 31 quedaron así) y, con Efectivo + Condición
  "Contado", la OC no contaba como efectivo (los filtros solo miraban la forma
  de pago con condición vacía y `fn_oc_programar_pago` la programaba como
  transferencia). Ahora: Forma de pago sin valor de fábrica y obligatoria en
  OC/OS (`revisarOrden` con `formaPago`); elegir Efectivo pone condición
  efectivo; `fn_orden_ia_guardar` convierte Efectivo + contado/vacía en
  'efectivo' y `fn_oc_programar_pago` programa en efectivo (sin cuenta) toda
  OC con forma Efectivo (`20261020100000`; IA-OS-0035 e IA-OC-0007
  corregidas). Regla única **efectivo = condición efectivo O forma de pago
  Efectivo**: `esOcEfectivo`, `FILTRO_OC_EFECTIVO` / `FILTRO_OC_NO_EFECTIVO`
  en `lib/pagosOc.ts` (Efectivo por confirmar, inicio de dirección, KPIs
  banco/efectivo). Las OS ya guardadas como transferencia que en realidad
  eran efectivo se corrigen editándolas (Laura dice cuáles).
- Pendiente: que las vistas de avance de OV (`avance_embarque_ov`,
  `v_ov_lineas_avance`, Match) ignoren las OV canceladas; liga de partida a
  producto del catálogo.

## Legal (1-oct-2026)
- Mario: "módulo legal; que esté Belén con el rol para dar seguimiento, al
  igual que Eréndira" + el contrato de crédito de los abogados como machote
  que se llene solo cuando el cliente esté autorizado.
  `20261001110000_modulo_legal.sql` (aplicada en producción por partes: el
  MCP se atoraba con bloques grandes y con `fn_director_general_policies()`
  completa; la migración pone `director_general` solo en sus 5 tablas).
- Módulo `legal` (LOMA). **Permiso por persona**, no rol: `permisos_modulo`
  'legal' a Belén Vergara (corporativo, la de @grupoloma.mx) y Eréndira
  Solís (rh). `auth_opera_legal()` = admin o permiso; `auth_credito_clientes()`
  = eso o dirección; `auth_autoriza_credito()` = admin o dirección.
- `legal_asuntos` (folio LEG-<emp>-0001, tipo, contraparte, autoridad,
  expediente, abogado, monto en riesgo, estatus, próxima fecha/actuación),
  bitácora `legal_seguimiento` (la próxima fecha pasa al asunto por trigger)
  y `legal_documentos` (edge `legal-documentos`, bucket `cargas/legal/…`).
- Crédito a clientes: `clientes_credito` (línea, días, interés moratorio,
  representante, obligado solidario, `legales` jsonb con escritura y poder o
  el párrafo tal cual). Capturan legal y dirección; **autorizan solo admin y
  dirección** (trigger). `legal_contratos` (folio CTO-<emp>-0001, `datos` =
  foto de lo que se imprimió) solo con crédito autorizado.
- Machote: `lib/contratoCreditoTexto.ts` (texto de los abogados, 34
  cláusulas, marcadores {{MONTO}} {{INTERES}} {{OBLIGADO}}
  {{NOTIFICACIONES}} {{FIRMA}}; no se edita sin los abogados) y
  `lib/contratoCredito.ts` (con pruebas: números y fechas en letra,
  declaraciones de proveedor y cliente moral/físico, firmas; HTML para
  imprimir y .doc para Word). Datos del proveedor = `empresas_perfil_legal`
  (se agregaron rfc, objeto social, volúmenes, notaría del poder, correo,
  teléfono; AEP sembrada del contrato). RAMSICON quedó como cliente de AEP
  con línea de 150,000 autorizada.
- Pantalla `/legal` (`pages/legal/`): Asuntos y juicios · Crédito y
  contratos · Datos legales de la empresa. **Departamento propio** (2-oct):
  sección "Legal" del menú y área del organigrama (Belén / Eréndira), KPIs
  `legal_fechas_vencidas`, `legal_documentos_vencidos`,
  `legal_creditos_por_autorizar`.
- **Expediente legal por empresa (2-oct-2026, Eréndira)**: en Datos legales
  de la empresa (`legal/ExpedienteEmpresa.tsx`): observaciones y actas por
  protocolizar con motivo sugerido (`legal_empresa_observaciones`, estatus
  pendiente → en notaría → protocolizada) y documentos con vencimiento y
  archivo (`legal_empresa_documentos`; edge `legal-documentos` v2 con
  `empresaDocumentoId`, ruta `cargas/legal/<empresa>/expediente/…`).
  Semáforo y vencimiento sugerido por tipo en `lib/expedienteLegal.ts`
  (con pruebas). `20261002110000`.
- **Contrato de arrendamiento (2-oct-2026, Mario)**: machote del contrato
  CSC → Ergodinova del 1-sep-2023 en `lib/contratoArrendamiento.ts` (con
  pruebas; 21 cláusulas con fiador, 20 sin él; penas 10/20/20 por defecto;
  IVA incluido o más IVA; plazo en letra "un año forzoso"). Pestaña
  **Arrendamientos** en `/legal` (`legal/Arrendamientos.tsx`): nuestra
  empresa como arrendador o arrendatario (se llena de "Datos legales de la
  empresa"; la otra parte se elige del grupo o se captura), fiador
  opcional, generar e imprimir / Word, semáforo de vencimiento (60 días),
  "Renovar" (mismo plazo desde el día siguiente) y escaneado firmado.
  Tabla `legal_arrendamientos` (folio ARR-<emp>-0001, solo permiso legal y
  admin; firmado no se borra) y `legal_documentos.arrendamiento_id` (edge
  `legal-documentos` v3). `20261002120000`.

## Punto de venta de ferretería (10-oct-2026)
- Mario: "módulo estilo Odoo, con código de barras para cobrar y para
  entregar al cliente; es para todas las empresas ya que es el almacén
  general y debe ser el lugar para despachar e imprimir notas". Decisiones:
  inventario actual (productos/existencias), cobro en efectivo con corte de
  caja + tarjeta (terminal aparte) + transferencia + crédito, ticket y
  factura después (no hay PAC).
- `20261010140000_punto_venta.sql` (aplicada en 3 partes): módulo
  `punto_venta` (abierto a LOMA), `productos.precio_venta` (con IVA) e
  `iva_tasa`, permiso por persona `permisos_modulo` 'punto_venta'.
  Tablas `pv_turnos` (caja: fondo, cierre, contado), `pv_caja_movimientos`
  (retiros/ingresos), `pv_ventas` (folio PV-<emp>-0001 = código de barras
  del ticket; estado pagada|credito|cancelada; entrega
  pendiente|parcial|entregada; requiere_factura/factura_folio),
  `pv_venta_lineas` (precio c/IVA, descuento, costo congelado, entregado,
  movimiento de inventario) y `pv_pagos` (también los abonos). Totales
  calculados: `v_pv_ventas`, `v_pv_turnos` (corte: esperado y diferencia),
  `v_pv_saldos_clientes`. Se escribe SOLO por funciones: `fn_pv_abrir_turno`,
  `_cerrar_turno`, `_caja_movimiento`, `fn_pv_cobrar` (crea venta, pagos y
  la SALIDA de inventario del primer almacén activo de la empresa; cambio
  del efectivo; crédito solo a clientes con `clientes_credito.autorizado`
  sin rebasar la línea), `fn_pv_entregar` (todo o por partida),
  `fn_pv_cancelar` (regresa inventario con una entrada; solo admin/almacén/
  corporativo), `fn_pv_abono`, `fn_pv_marcar_facturada`. Operan
  `auth_opera_pv()` = admin, almacén, corporativo o permiso.
- Frontend `/punto-venta` (`pages/puntoVenta/`): Vender (buscador que
  recibe el lector de código de barras + Enter, tarjetas, carrito, cobro
  mixto, ticket automático), Despachar (escanear ticket → entregar),
  Ventas (día, reimprimir, cancelar, facturas pendientes), Caja (abrir,
  retiros/ingresos, corte), Crédito (saldos y abonos), Precios (precio c/IVA
  y código de barras por producto). `lib/code128.ts` (Code 128 B en SVG, sin
  dependencias) y `lib/puntoVenta.ts` (totales, pagos, búsqueda, corte,
  ticket 80 mm), ambos con pruebas. Pendientes: precios de los 112
  productos de AEP, catálogo de las demás empresas, CFDI con PAC.
- **Existencias reales y precio por utilidad (10-oct-2026, Mario: "vincula
  inventario con el punto de venta para tener existencias reales"; "déjame
  colocar el precio manual con porcentaje de utilidad positivo")**:
  `20261010150000`: `fn_pv_cobrar` no vende más de lo que hay en el almacén
  del punto de venta (`fn_pv_almacen(empresa)` = primer almacén activo, el
  mismo del que sale la venta; la pantalla pinta solo ese stock y bloquea
  "Cobrar"); `fn_pv_ajustar_existencia(producto, contado, nota)` = conteo
  físico (admin/almacén/corporativo) → movimiento `es_ajuste` por la
  diferencia. Precios: costo s/IVA (costo promedio del almacén o de
  referencia), utilidad % sobre el costo → precio c/IVA, o precio a mano;
  no se guarda sin utilidad positiva (`precioConUtilidad`,
  `utilidadDePrecio`, `revisarPrecio` en `lib/puntoVenta.ts`).
- **Resumen de inventario (10-oct-2026, Mario: "un resumen y qué días se
  cargó la información")**: Inventario → Resumen (`inventario/Resumen.tsx`,
  `lib/resumenInventario.ts` con pruebas): por empresa (productos, con
  existencia, negativos, valor, movimientos, primera/última carga, días sin
  capturar) y bitácora por día de captura (created_at en hora de México;
  entradas, salidas, valor, fecha de los movimientos, quién) con el detalle
  de cada día (origen OC/OV/remisión/punto de venta/conteo). Al 10-oct solo
  AEP y MCC tienen movimientos; última carga 7-oct.


## Herramienta y equipo (17-oct-2026)
- Mario: "dentro del almacén el área de herramienta y equipo; puede ser
  asignado y pedido por los supervisores para las diferentes obras".
  `20261017090000_herramienta_equipo.sql` (aplicada en 3 partes). Menú
  Almacén → **Herramienta y equipo** (`/almacen/herramienta`,
  `pages/herramienta/Herramienta.tsx`; `lib/herramientas.ts` con pruebas;
  prueba SQL `supabase/tests/herramienta.sql`).
- `herramientas`: una fila por pieza, folio **HE-<emp>-0001** (es la etiqueta
  con Code 128; se escanea en la pantalla), categoría, marca, modelo, serie,
  costo; estado disponible / asignada / reparacion / baja / extraviada, con
  obra, responsable (`responsable_id` + nombre, también sin cuenta) y
  `devolver_el`. Ese "dónde está" lo pone la bitácora
  `herramienta_movimientos` (alta, asignacion, traspaso, devolucion con
  condición, reparacion, fin_reparacion, baja, extravio); nadie lo edita.
- Solicitudes **SH-<emp>-0001** (`herramienta_solicitudes` / `_lineas`, texto
  libre + cantidad, fecha requerida y de regreso): pide quien VE la obra
  (`fn_herramienta_solicitar` es invoker; la policy de insert pregunta por
  `proyectos` con su RLS). Almacén surte por renglón con piezas disponibles
  (`fn_herramienta_asignar(…, p_linea)`: obra y responsable = la solicitud;
  `surtido` y estado se recalculan) y sale el **resguardo** para firma (art.
  110 LFT). También asigna directo a obra/persona, recibe de regreso
  (`fn_herramienta_devolver`, condición mala → reparación), reparación, baja
  y extravío con motivo (`fn_herramienta_estado`); pestaña "Por obra" con
  vencidas.
- Operan `auth_opera_herramienta()`: admin, corporativo, almacén, empresa o
  permiso por persona 'herramienta' (en `permisos_modulo` y
  `MODULOS_ASIGNABLES`). Ven: los que operan y dirección/responsable en su
  alcance; el supervisor lo que tiene a su cargo y lo de sus obras
  (`auth_herramienta_obras()`: responsable/comprador, `auth_proyectos_propios`
  y donde ya pidió). **Ojo (17-oct)**: de los 5 supervisores solo Jonathan
  Cáceres ve obras (2 de ERG, por sus requisiciones); los demás no están
  asignados a ninguna y no pueden pedir hasta que se les asigne en el
  encabezado de la obra. Probado en producción en rollback (Jonathan pide
  SH-ERG-0001, Alma da de alta y surte, Brenda no ve nada).
  **Desde Requisiciones (17-oct, Mario: "en las requisiciones agrega la
  opción de herramienta y equipo")**: "Nueva requisición" tiene el selector
  Material o servicio / **Herramienta y equipo**; con herramienta los
  renglones van en piezas, pide fecha en que se necesita y de regreso, y se
  envía como solicitud SH-… (`fn_herramienta_solicitar`), no como
  requisición de compra. Abajo de la lista, "Herramienta y equipo pedida"
  (abiertas + últimos 30 días, surtido/cantidad, liga a la pantalla del
  almacén) (`MisRequisiciones.tsx`).
- **Cada quien ve sus requisiciones (17-oct-2026, Mario: "cada quien
  debería poder ver únicamente las suyas, para no confundirlos")**: en
  `MisRequisiciones` la lista (y "Herramienta y equipo pedida") muestra solo
  lo que la persona pidió; casilla "ver también las que pidieron otras
  personas en mis obras". Admin, corporativo, almacén, dirección y empresa
  (los que procesan) siguen viendo todas, con casilla "solo las que yo
  pedí". Es filtro de pantalla, no RLS: el responsable de la obra todavía
  confirma lo recibido de requisiciones de otros.

## Personajes: avatar y misiones del día (18-oct-2026)
- Mario: "ponernos a todos un avatar, que tengan que tomarse su foto de
  frente para generarlo; una especie de NPC de videojuego con skills y
  trabajos pendientes, muy dinámico, de lo que deben avanzar durante el
  día". Sin servicio externo de imágenes: la selfie se vuelve **pixel-art en
  el navegador** (`components/personaje/datos.ts` `generarAvatar`: recorte
  cuadrado centrado con zoom, espejo, reducción a 28/40/56 px y
  `pixelar` de `lib/personaje.ts`: contraste, paleta de 24 colores con tonos
  de piel, óvalo transparente y contorno de sprite). **La foto nunca se
  sube**: solo se guarda el PNG chico.
  **Realista (19-oct-2026, Mario: "el avatar me gustaría más realista")**:
  estilo por defecto "📸 Realista" (el pixel-art queda como "👾 Videojuego"):
  retrato de 192 px con `retocarRetrato` (niveles 1-99 %, hasta ×1.8,
  color +12 %, viñeta) guardado en JPEG (calidad 0.86 → 0.58 hasta caber en
  60 KB); el check de `personajes.avatar` acepta png o jpeg
  (`20261018130000`). Ojo: el realista sí es un retrato reconocible que ve la
  organización (la foto original sigue sin subirse).
  **Personaje IA (19-oct-2026, Mario eligió "personaje de videojuego
  generado por IA")**: estilo por defecto "✨ Personaje IA". Con casilla de
  consentimiento, la selfie (768 px) va a la edge **`personaje-avatar-ia`**
  (verify_jwt; sesión, no pendiente/espectador/solo consulta; helpers en
  línea) que la manda a un servicio externo de imágenes con un prompt fijo
  (mismo rostro, personaje AAA, atuendo según el ROL que lee el servidor:
  casco y chaleco para supervisor, mandil de herrero para producción…, fondo
  del color de su clase) y regresa el retrato; el navegador lo reduce a 192
  px JPEG y se guarda como cualquier avatar. No se guarda la selfie. Secrets:
  **`IMAGENES_IA_API_KEY`** (obligatoria; sin ella responde 503 "falta la
  llave"), `IMAGENES_IA_PROVEEDOR` (`openai` | `gemini`; si falta se deduce:
  llave `AIza…` = Gemini) y `IMAGENES_IA_MODELO` (por defecto `gpt-image-1`
  con `input_fidelity=high`, o `gemini-2.5-flash-image`). Límite 5 intentos
  por persona por día en `personajes_ia_usos` (la escribe la edge; cada quien
  ve los suyos; `20261019100000`). Al 19-oct la llave **no está dada de
  alta**: la pone Mario en Supabase → Edge Functions → Secrets. Probado solo
  que arranca y pide sesión (401); falta la primera generación real.
- `20261018100000_personajes.sql` (aplicada): tabla `personajes`
  (profile_id, grupo por trigger, `avatar` data URL PNG ≤60 KB, título
  opcional); la ve su organización, la escribe solo su dueño (no pendiente);
  frontera, espectador, director_general, solo_consulta.
  `fn_personajes_stats(grupo, persona)` (definer, revocada; ~0.5 s para 46
  personas): XP = tarea terminada ×10 (última columna de su tablero,
  responsable o corresponsable) + día con entrada ×3 + tarjeta creada ×2 +
  comentario ×1; habilidades a 30 días (cumplimiento, constancia,
  iniciativa, colaboración), racha de días hábiles con entrada, hechas hoy,
  pendientes hoy y vencidas. `fn_mi_personaje()` (hoja + misiones: tareas
  vencidas o que vencen hoy, marcas de hoy, terminadas hoy, próximas 7
  días) y `fn_equipo_personajes()` (la organización ordenada por XP).
- `lib/personaje.ts` (con pruebas): nivel = 25·n·(n−1) XP, rangos
  (Aprendiz → Leyenda), clase por rol (supervisor "Capitán de obra",
  almacén "Intendente del almacén", producción "Herrero de la planta",
  dirección/tesorería "Guardiana del tesoro", contabilidad "Escriba del
  reino"…), oficios = módulos, misiones del día (atrasadas, checador, hoy,
  terminadas), `dialogoNpc` (lo que le dice el personaje según la hora y el
  avance) y logros.
- Pantallas: tarjeta `PersonajeDelDia` arriba del inicio (también en el de
  dirección), avatar en el encabezado → `/personaje` (menú personal "Mi
  personaje"; no para `pendiente`): crear/cambiar el avatar con la cámara
  (`CamaraSelfie`) o galería, hoja completa y pestaña **Equipo**. Al 18-oct
  nadie tiene avatar todavía; Jonathan Cáceres va primero (124 XP, racha 19).
- **Credencial QR (18-oct-2026, Mario: "una vez abran su NPC puedan ver su
  QR para tener acceso a servicios de la empresa como comedor o compra de
  materiales y herramienta")**: `20261018110000_credencial_qr.sql`
  (aplicada): `credenciales_qr` (código al azar `ACU1:…`, **dura 10 min**,
  la pantalla lo renueva cada minuto; nadie lee la tabla directo).
  `fn_mi_credencial()` y `fn_credencial_leer(codigo)` (solo admin o quien
  opera comedor, herramienta o punto de venta, misma organización; devuelve
  nombre, empresa, avatar, expediente, pedido del comedor de hoy y
  herramienta a su cargo). Pestaña "🪪 Mi QR" en `/personaje`
  (`components/personaje/CredencialQr.tsx`) y botón en la tarjeta del
  inicio. Lector `components/LectorCredencial.tsx` (cámara con `jsqr`, o
  lector de mano que escribe + Enter) en: Comedor → Cocina ("Entregar" el
  pedido de hoy), Herramienta → Asignar (llena quién recibe y muestra lo que
  ya tiene) y Punto de venta → Vender (cliente "Empleado: nombre").
  La compra del trabajador puede ir a su cuenta de nómina (sección
  siguiente).

## Cuentas de nómina y financiamiento (18-oct-2026)
- Mario: "llevaría una cuenta para descontarse vía nómina; por antigüedad y
  por buen comportamiento y pago daremos financiamiento estilo Mercado
  Pago". `20261018120000_cuentas_nomina.sql` (aplicada en 7 partes,
  `cuentas_nomina_1_tablas` … `_7_redondeo`).
- **Ley (no se negocia en pantalla)**: art. 111 LFT sin intereses; art.
  110-I la deuda no pasa de un mes de sueldo (sueldo semanal × 30/7) y cada
  descuento no pasa del 30 % del excedente del salario mínimo (2026: $315.04
  diarios, zona general; verificar contra el DOF). Configurable por
  organización en `nomina_financiamiento_config` (`fn_nomina_config`,
  `fn_nomina_topes`); lo valida la base: trigger `cuentas_nomina_antes`
  (línea ≤ un mes) y `fn_nomina_crear_cargo` (línea, atraso, plazo y tope
  semanal; redondea el descuento por pago hacia arriba al centavo).
- Tablas: `cuentas_nomina` (una por persona: sueldo_semanal, línea, plazo
  máximo, nivel sin_acceso/bronce/plata/oro/diamante, puntaje, estatus,
  quién autorizó), `nomina_cargos` (origen punto_venta/prestamo/anticipo/
  otro, monto, pagos, descuento por pago, primer viernes; nombre del
  trabajador guardado: profiles no se lee desde RH) y `nomina_descuentos`
  (triggers: no más del saldo; liquidado solo). `v_nomina_cargos` (pagado,
  saldo, atraso, siguiente descuento). Cancelar una venta del punto de venta
  cancela su cargo (falla si ya se descontó algo).
- Operan admin, dirección y RH (`auth_opera_cuentas_nomina`); el
  trabajador ve solo lo suyo; el cajero (`auth_opera_pv`) solo crea cargos
  de origen punto_venta. `fn_nomina_disponible`, `fn_nomina_aplicar_descuentos(
  fecha, cargos[], referencia)`, `fn_estudio_financiamiento()` (por persona
  activa: antigüedad, sueldo —capturado o el de la contratación vigente—,
  checador y tareas a 30 días, EPP/herramienta perdida o vencida, historial
  de cargos).
- Estudio en `lib/cuentaNomina.ts` (con pruebas): puntaje 0-100 =
  antigüedad 30 + asistencia 15 + cumplimiento 15 + cuidado 10 + historial
  de pago 30 (sin historial 12, +6 por cargo liquidado, 0 con atraso);
  niveles bronce ≥40 (25 % del tope, 2 semanas), plata ≥55 (50 %, 4), oro
  ≥70 (75 %, 8), diamante ≥85 (100 %, 12); línea = min(% × un mes,
  descuento máximo × plazo) redondeada a $50; bloqueos: <3 meses, atraso,
  sin sueldo, gana el mínimo.
- Pantalla RH → **Cuentas de nómina y financiamiento** (`/financiamiento`,
  `pages/financiamiento/Financiamiento.tsx`, roles dirección/RH + admin):
  Estudio (sueldo editable, desglose, Autorizar/Actualizar/Suspender),
  Cuentas y cargos (préstamo/anticipo), Descuentos de la semana (por
  empresa, CSV, "Marcar aplicado") y Reglas. Punto de venta: con el QR del
  empleado aparece la forma de pago "Cuenta de nómina" en pagos semanales
  (sube solo al mínimo legal); `fn_pv_cobrar` crea el cargo. El trabajador
  ve "Mi cuenta de nómina" en `/personaje` → Mi QR.
- Probado en producción en rollback (Fernando/RH, Jonathan Cáceres con
  $4,000: línea de 20,000 rechazada por ley, 4,300 oro aceptada; $1,000 en
  1 pago rechazado —máximo $538.42/semana—, en 2 aceptado; descuento
  aplicado deja saldo 500; Jonathan no ve el estudio ni cuentas ajenas;
  Alma crea cargo de punto de venta pero no préstamo).
- **El sueldo lo fija RH (19-oct-2026, Mario: "en recursos humanos Raúl,
  Eréndira y Fernando estipulan el salario de cada uno")**: trigger
  `cuentas_nomina_antes` solo deja poner o cambiar `sueldo_semanal` a rol
  rh o admin (dirección solo si es el mismo del contrato vigente) y guarda
  `sueldo_por/_por_nombre/_en`; en el Estudio el campo está bloqueado para
  dirección ("lo fijó RH" / "del contrato"). Dirección sigue autorizando
  líneas. Probado en rollback: Raúl fija $3,500 a Brenda, Laura autoriza
  la línea pero no puede cambiar el sueldo (`20261018130000`). El sueldo del
  contrato (`contrataciones.sueldo_semanal`) solo existe para 4 personas:
  las demás se capturan en el Estudio.
- **Ojo 18-oct**: solo 4 de 35 personas tienen sueldo (Fabricio, Jonathan
  Cáceres, José Luis Del Castillo, Raúl Molina) y varias salen con 0 meses
  de antigüedad (fecha de ingreso mal capturada): RH los corrige antes de
  autorizar.
- **Firma digital y préstamos con intereses (19-oct-2026, Mario: "cada
  trabajador que firme su pagaré, consentimiento y afiliación a crédito de
  manera digital; una vez pasando esa parte serán préstamos con intereses ya
  que será parte del negocio financiero")** (`20261019090000`, aplicada en
  6 partes `credito_firma_1` … `_6_datos`):
  - `credito_firmas` (afiliacion / consentimiento / pagare): texto tal cual
    se mostró, firma dibujada (PNG), `hash` SHA-256 de texto + firma, fecha,
    IP y navegador (de `request.headers`); **no se edita ni se borra**
    (trigger `credito_firmas_inmutable`; solo `fn_credito_revocar`, sin
    saldos, y nunca un pagaré). Firma solo la persona en su sesión
    (`fn_credito_firmar`, definer); ven ella y RH/dirección/admin.
  - Sin afiliación + consentimiento vigentes (`fn_credito_afiliado`,
    revocada de authenticated) `fn_nomina_crear_cargo` no crea nada.
    Préstamos/anticipos/otro nacen `por_firmar` (no se descuentan) y pasan a
    `vigente` al firmar el pagaré; compras del mostrador quedan vigentes (las
    cubre el consentimiento + ticket). `fn_nomina_cancelar_por_firmar`.
  - **Intereses solo de la financiera** (art. 111 LFT):
    `nomina_financiamiento_config.acreditante_empresa_id` + tasa ordinaria y
    moratoria anual, IVA de intereses, `capacidad_pago_pct` (tope semanal, %
    del sueldo) y `plazo_max_semanas_intereses`. Si la financiera es la misma
    empresa del trabajador → error. Pagos semanales iguales (francés, tasa/52),
    `nomina_cargos.interes/iva_interes/total` (generada)/`cat`/`acreditante_*`;
    saldo, atraso y liquidación ya van sobre `total`. Anticipos y compras
    siempre sin intereses. Al 19-oct no hay financiera configurada: todo sigue
    sin intereses hasta que Mario/Laura la elijan en Reglas.
  - `lib/creditoNomina.ts` (con pruebas; mismo cálculo que la base, probado
    al centavo: $1,000 a 60 % en 4 pagos = 1,033.65, CAT 81.6 %) arma la
    afiliación, el consentimiento y el pagaré (**borrador para los abogados**;
    al cambiar textos sube `VERSION_DOCUMENTOS`), y el HTML imprimible con la
    constancia. Datos de las partes: `fn_credito_datos_documentos(cargo)`
    (definer; razón social/RFC/domicilio de `empresas` o
    `empresas_perfil_legal`).
  - Pantallas: el trabajador firma en `/personaje` → Mi QR ("Mis documentos
    de crédito", `components/personaje/DocumentosCredito.tsx`,
    `components/FirmaDigital.tsx`); RH ve "afiliación firmada" en el Estudio,
    préstamos "espera firma del pagaré" con cancelar, vista previa de
    intereses, pestaña **Documentos firmados** (ver/imprimir, revocar) y en
    Reglas la financiera; el mostrador no cobra a la cuenta de nómina sin
    afiliación.
  - Probado en producción en rollback (Fernando/RH, Jonathan, financiera
    ficticia AEP a 60 %): sin afiliación rechaza; firma doble rechaza;
    préstamo queda por_firmar y no se descuenta; capacidad de pago rechaza
    $3,000 en 2; Jonathan firma el pagaré → vigente; editar una firma no
    cambia nada; descuento deja saldo 775.23; financiera = patrón rechaza.
  - Pendiente legal (abogados): que la financiera sea SOFOM registrada
    (CONDUSEF/REUS, contrato de adhesión en RECA, PLD), validez del pagaré
    electrónico (firma simple; para juicio ejecutivo conviene constancia
    NOM-151 o e.firma) y el interés moratorio (se escribe en el pagaré pero
    el sistema todavía no lo calcula).

## Cumplimiento (18-oct-2026)
- Mario mandó la imagen del curso "Domina Claude para responsables de
  cumplimiento" (cambios normativos, revisar controles, informe de
  incidencia, informe al comité, flujos de control): "implementar estos
  pasos en todos mis procesos". Pantalla **Legal → Cumplimiento**
  (`/cumplimiento`, `pages/cumplimiento/`, una pestaña por paso; lógica pura
  en `lib/cumplimientoNormativo.ts` con pruebas — OJO: `lib/cumplimiento.ts`
  es otra cosa, el cumplimiento de tareas de RH).
- `20261018090000_cumplimiento.sql` (aplicada en 4 partes): operan admin o
  permiso por persona 'legal' o 'cumplimiento' (nuevo en `permisos_modulo` y
  `MODULOS_ASIGNABLES`; `auth_opera_cumplimiento`); dirección consulta, prueba
  controles y registra incidencias (`auth_ve_cumplimiento`). Belén y Eréndira
  entran por su permiso legal. Frontera, espectador, director_general y
  solo_consulta en las 5 tablas.
  1. `cumplimiento_normas` (autoridad, publicación, entrada en vigor, qué
     cambia, áreas, responsable, estatus) → "Volverla tareas":
     `accionesSugeridas` propone 5 pasos (el primero el lunes, uno por semana,
     sin pasar de la entrada en vigor) y se crean como tarjetas del tablero que
     se elija (`cumplimiento_acciones` liga acción ↔ tarjeta;
     `v_cumplimiento_acciones` dice si ya está en la última columna).
  2. `cumplimiento_controles` (catálogo por organización, frecuencia mensual
     o trimestral, tolerancia %) + `cumplimiento_pruebas` (resultado,
     población, excepciones, muestra de 50 casos). **14 controles
     automáticos** sembrados para LOMA: `fn_cumplimiento_ejecutar(prueba,
     grupo, desde, hasta)` (definer, revocada) con pagos_con_comprobante,
     pagos_con_oc, oc_sin_sobrepago, estados_cuenta_al_dia, cfdi_sat_al_dia,
     efirma_vigente, expedientes_rh_completos, accesos_bajas,
     documentos_legales_vigentes, arrendamientos_vigentes, epp_vigente,
     herramienta_devuelta, inventario_sin_negativos, gastos_revisados.
     "Probar ahora" = `fn_cumplimiento_probar(control, periodo)`. Controles
     manuales: revisión con resultado, comentario y evidencia. **Prueba nueva
     → rama nueva en `fn_cumplimiento_ejecutar` + control sembrado.**
  3. `cumplimiento_incidencias` (folio INC-<emp>-0001; qué pasó, qué
     significa, causa, qué hicimos, qué sigue, próxima actualización,
     a quién se informó): informe imprimible y texto para WhatsApp; se
     registra también desde una revisión con excepciones; acciones
     correctivas → tarjetas.
  4. Informe al comité: una hoja (trimestral o mensual) con semáforo,
     controles vs periodo anterior, incidencias, normas pendientes y
     decisiones que se piden (`resumenComite`, `htmlInformeComite`).
  5. Flujos: pg_cron `cumplimiento-cierre-periodo` (día 1, 7:30 MX) corre los
     automáticos del periodo que cerró (trimestrales al cerrar mar/jun/sep/
     dic); la pestaña dice qué falta revisar y el histórico por control.
- Primera corrida 18-oct (oct / T4): no cumplen PAG-01 (16 de 74 pagos sin
  comprobante), ALM-02 (19 de 99 existencias negativas, varias de MCC),
  CON-01 (3 de 19 cuentas sin movimientos recientes) y **SIS-01: 2 personas
  dadas de baja con la cuenta activa** (Daissy Karina Sanchez Alazcano, baja 30-sep;
  Josafat Eduardo Lopez Garrido, baja 7-oct; no se desactivaron: esperar a
  Mario); RH-01 con 1 expediente
  incompleto (Gonzalo Xochimitl). Probado en producción en rollback: Belén
  ve y prueba (INC-CSC-0001), Laura ve y prueba pero no da de alta normas,
  Alma (almacén) no ve nada ni puede llamar la función.

## CRM de ventas por WhatsApp y redes (17-oct-2026)
- Mario: "módulo de ventas a través de redes sociales y de WhatsApp; un CRM
  de atención que genere las cotizaciones de manera automática". Decidió:
  la cotización **la revisa una persona** antes de enviarse; todavía **no
  hay cuenta de Meta** (WhatsApp Business / Facebook / Instagram); empezar
  con **Clavicón (MCC) y AEP**.
- `20261017110000_crm_ventas.sql` (aplicada): `crm_prospectos` (contacto
  por empresa: nombre, teléfono, canal, etapa nuevo → cotizado →
  negociacion → ganado | perdido con motivo, vendedor asignado, cliente
  registrado, `ultimo_entrante_en` / `ultimo_saliente_en`) y `crm_mensajes`
  (entrante/saliente, `cotizacion_id`, `externo_id` único reservado para el
  webhook de Meta). `cotizaciones_produccion.crm_prospecto_id`. Triggers:
  el mensaje hereda empresa/canal y el nombre de quien lo registró; mueve
  las fechas del prospecto y, si sale con cotización, nuevo → cotizado.
  Operan quienes cotizan (`auth_opera_cotizador()`) en su alcance; frontera,
  espectador, director_general y solo_consulta incluidos.
- Pantalla **Compras → CRM de ventas** (`/ventas/crm`, `pages/crm/Crm.tsx`,
  misma ruta protegida que el cotizador): lista ordenada por quién lleva
  más tiempo esperando respuesta (ámbar ≥30 min, rojo ≥2 h), filtros por
  etapa, alta de contacto con su primer mensaje; conversación (registrar lo
  que escribió el cliente, "Responder por WhatsApp" = abre wa.me y lo deja
  registrado); **cotización automática**: toma los mensajes del cliente
  desde nuestra última respuesta, `interpretarPedido` (`lib/crmVentas.ts`,
  con pruebas; reglas, sin IA: cantidades en número o letra, unidades,
  medidas como "10.5" o "3/8" pesan doble) propone producto, cantidad y
  precio de los productos del cotizador (`datosCotizador.ts`, compartido
  con `/cotizador`); lo dudoso queda en ámbar con alternativas; el vendedor
  corrige y guarda (folio COT-<emp>), luego "Enviar por WhatsApp" (texto
  con precios c/IVA) y "Aceptó → orden de venta" (`fn_orden_ia_guardar`
  OV; prospecto ganado). Probado como Laura en rollback (COT-MCC-0002).
- **Ojo precios**: al 17-oct MCC tiene 2 productos y AEP 113, **ninguno con
  precio de lista**; la cotización toma lo ya vendido en OV (22 de MCC, 421
  de AEP) o el costo de la planta. Cargar precios en Punto de venta →
  Precios para que salga completa.
- Siguiente paso cuando abran la cuenta de Meta Business: webhook de
  WhatsApp Cloud API / Messenger / Instagram que inserte en `crm_mensajes`
  con `externo_id` (sin duplicar) y envío por la API en vez de wa.me.

## Mensaje de la semana (17-oct-2026)
- Mario: "¿quiénes faltan por activar notificaciones?" → 17-oct: 47
  personas activas de LOMA, **25 con push y 22 sin** (lista con
  `push_subscripciones` vs `profiles`). Y "mándales el sábado a la 1 p. m. un
  mensaje de mi parte; programado, pero mándamelo primero a mí; genérame
  frases y las elijo semana con semana; solo notificación (los 25)".
- `20261017100000_mensaje_semana.sql`: tabla `mensajes_semana` (grupo,
  sábado, texto, enviado_en/enviados; solo director general),
  `fn_mensaje_semana_programar(fecha, texto)`, `fn_mensaje_semana_destinatarios()`
  y pg_cron (UTC; México UTC-6 fijo): `mensaje-semana-recordatorio-viernes`
  (vie 17:00 MX) y `-sabado` (sáb 10:00 MX) avisan a Mario si no ha elegido;
  `mensaje-semana-envio-sabado` (sáb 13:00 MX) lo manda a todos los de la
  organización con push; si no hubo frase, avisa a Mario. Edge
  **`push-mensaje-semana`** (verify_jwt false; x-cron-secret o sesión del
  director general; helpers en línea, sin `_shared`): modos recordatorio,
  enviar, prueba (solo a él) y enviar_ahora.
- Pantalla Sistemas → **Mensaje de la semana** (`/admin/mensaje-semana`,
  `pages/admin/MensajeSemana.tsx`, solo `esAdminGlobal`): sábados
  siguientes, texto (300 caracteres), banco de 30 frases
  (`lib/mensajeSemana.ts`, con pruebas; marca las ya usadas y sugiere una
  distinta cada semana), "Mandármelo a mí primero", "Programar" y "Mandar
  a todos ahora". 17-oct: el primer recordatorio llegó a Mario (4
  dispositivos).

- **Respaldo en Dropbox de los proyectos a cotizar (21-oct-2026, Mario: "la
  biblioteca de archivos en Dropbox como respaldo… para que pueda leerse desde
  otras secciones de Claude"; luego "únicamente por ahora de los proyectos a
  cotizar, para hacer más rápido esta dinámica")**: Sistemas → **Respaldo en
  Dropbox** (`/admin/respaldo-dropbox`, `pages/admin/RespaldoDropbox.tsx`,
  `lib/respaldoDropbox.ts` con pruebas; solo director general). Mario crea una
  app propia en dropbox.com/developers (App folder, permisos
  files.content.write/read), pega App key + secret y el código de
  autorización; la edge **`respaldo-dropbox`** (verify_jwt false: x-cron-secret
  o sesión de `auth_admin_global`; acciones estado/conectar/desconectar/
  respaldar) guarda app key, secret y refresh token en `config_sistema`. pg_cron
  `respaldo-dropbox-horario` (minuto 25, `disparar_respaldo_dropbox()`, no hace
  nada sin conexión): cada tabla de `fn_respaldo_tablas()` (lista CERRADA:
  proyectos, proyecto_planos, proyecto_presupuesto_cliente, pu_analisis/_items,
  pu_insumos, pu_insumo_precios, pu_factores, pu_precios_cliente,
  pu_aprobaciones, cotizaciones_produccion/_lineas, empresas, clientes; solo
  LOMA) va una vez al día a `<ruta>/Tablas/<tabla>.csv` si cambió (hash), luego
  `LEEME.md` (índice para Claude) y los archivos de `planos/`
  (`fn_respaldo_archivos`, `archivoRespaldable`) a `<ruta>/Archivos/`; bitácora
  `respaldos_dropbox` y estado por renglón `respaldo_dropbox_items`
  (`20261021090000`; parte pura `respaldo-dropbox/respaldo.ts`, pruebas en
  `_shared/respaldo/`). **Ampliar = agregar a la lista de `fn_respaldo_tablas` y,
  si son archivos, a `archivoRespaldable`**; nunca RH, bancos ni secretos sin
  que Mario lo pida. Al 21-oct falta que Mario conecte su Dropbox.
- Carpeta `/Acumulado · Claude` en el Dropbox de Mario (MCP de Dropbox):
  `01 Documentos base` (lo que Mario deja: formatos, Excel de referencia,
  logos), `02 Consultas` (lo que Claude prepara a pedido, nombre
  `AAAA-MM-DD tema`), `03 Del sistema` (exportaciones de la app) y
  `LEEME.md`. Antes de pedirle a Mario un archivo, revisar ahí. Nunca
  secretos ni datos de tarjeta en esa carpeta.

## Personas y roles (referencia rápida)
Mario (admin, todas las empresas) · Laura Orta (direccion/finanzas, todas) ·
Jorge Esperón (empresa, ERG: precios unitarios) · Eréndira / Fernando Gómez (rh) ·
Christian (bbva_mantenimiento) · Jaime Sierra (produccion) · Miguel Tepal
(responsable, Constructora) · Delia (contabilidad). Contraseñas iniciales se
comunican por chat a Mario, nunca se guardan en el repo.

## La frontera entre organizaciones (leer antes de tocar RLS)

Con más de un cliente en la misma base, esto es lo que separa a uno de otro:

1. **Organización.** Nadie ve datos de otra, ni siendo corporativo. La única
   excepción es el admin de la organización maestra.
2. **Módulo.** `grupo_modulos` dice qué tiene abierto cada organización
   (cubre conciliación, inventario y RH; los módulos más nuevos todavía no
   tienen interruptor, pero sí frontera de organización).
3. **Suscripción.** Sin pago al corriente se consulta y se exporta, pero no se
   captura ("gracia y luego solo lectura"). La maestra nunca se bloquea.

La frontera la impone una policy **restrictiva** llamada `frontera_organizacion`
en cada tabla de negocio: se evalúa en AND con todas las demás, así que una
policy nueva mal escrita no puede abrirla. Las permisivas de cada módulo
siguen decidiendo quién ve qué *dentro* de la organización.

**Toda tabla nueva de negocio necesita su `frontera_organizacion`.** No es
opcional: `supabase/tests/frontera_organizacion.sql` falla si falta, y la lista
blanca de tablas globales de plataforma vive ahí.

Otras reglas que no se rompen:

- **Nunca** guardar datos de tarjeta (PAN, CVV). La tarjeta se captura en el
  dominio de la pasarela; solo se guardan marca y últimos 4.
- **Nada que cuente dinero o usuarios de otra organización se expone por RPC.**
  Supabase publica toda función de `public`: o se acota por dentro, o se revoca
  de `public` y se le da `execute` solo a `service_role`.
- Los **totales se calculan**, no se capturan (saldo, existencias, mensualidad).

## Validar antes de dar algo por hecho

```bash
npm test                  # módulos puros (node --test)
./scripts/validar-sql.sh  # aplica TODAS las migraciones desde cero + pruebas de RLS
cd web && npm run build && npm run lint
```

(29-sep-2026: estaba roto desde `20260928180000`, que leía la definición
de agregados; ya filtra `prokind = 'f'`, y las pruebas de frontera y
aislamiento marcan `todas_las_empresas` al corporativo y limpian el claim
antes de preparar datos. Vuelve a pasar completo.)

`./scripts/validar-sql.sh` es el que importa para cualquier cambio de esquema o
de policies. Que aplique **desde cero** no es un detalle: es lo que permite
restaurar la base el día que haga falta. Si una migración depende de algo que
alguien creó a mano en Supabase, el repositorio ya no sabe reconstruir el
sistema — pasó con Precios Unitarios (6 tablas y 5 funciones que ninguna
migración creaba) y se reparó en `20260909125957/125958`.

## Varias sesiones a la vez

Ya pasó: se construyeron dos módulos de Inventario, dos de Proyectos y dos PWA
en paralelo, y el esquema combinado ni siquiera aplicaba. **Antes de agregar un
módulo, revisa `supabase/migrations/` y `web/src/pages/` a ver si ya está.**
Cambios chicos partiendo de `main`, mezclando pronto.

## Solo consulta: espectadores y organizaciones sin pago (29-sep-2026)
- Mario: "los que no han pagado no pueden manipular nada; genera un rol
  únicamente de espectador". `20260929170000_solo_consulta_espectador.sql`
  (aplicada en producción): trigger **a nivel sentencia** `solo_consulta` en
  las 98 tablas de public (menos `push_subscripciones`) que llama
  `bloquear_solo_consulta()` → `auth_solo_consulta()`: true si el perfil es
  `espectador` o si su organización no tiene suscripción que permita
  escribir (sin suscripción = no contratada). Nunca el admin maestro ni
  procesos sin usuario. Cubre también las funciones SECURITY DEFINER (no se
  saltan triggers). Antes, 66 tablas escribían sin revisar la suscripción.
  Storage: tres restrictivas `solo_consulta_*` en `storage.objects`.
- **Toda tabla nueva necesita su trigger `solo_consulta`**
  (`supabase/tests/solo_consulta.sql` falla si falta).
- `profiles.espectador` es una marca, no un valor de `app_rol`: así ve lo
  que su rol ve (un admin espectador ve toda su organización). Solo el admin
  maestro la cambia (trigger `profiles_guarda_espectador`; columna
  "Espectador" en Admin → Usuarios). Frontend: `useAuth().soloConsulta` y
  `suscripcionPermiteEscribir` la incluyen; `AvisoSuscripcion` lo avisa.
- Edge functions que escriben con la service_role se saltan el trigger: el
  código ya pregunta `perfil.soloConsulta` (`_shared/supabase-clients.ts`,
  `respuestaSoloConsulta()`), **pero falta desplegarlas**: el `_shared` de
  cada función desplegada difiere del repo (ingesta-*, motor-conciliacion
  importan `empresaOperableEnModulo`, que no está en git). Reconciliar con
  `get_edge_function` antes de desplegar; hasta entonces, por esas rutas un
  usuario sin pago puede escribir **solo en su propia organización**.
- ARSSA está en 'prueba' hasta 25-oct-2026: al vencer queda en solo
  consulta en TODO, no solo en proyectos.

- **Espectador sin datos (2-oct-2026, Mario: "solo ve barra principal y
  menús, no enseñes información de ninguna empresa")**:
  `20261002090000_espectador_sin_datos.sql` (aplicada en producción en
  partes, `espectador_sin_datos_1_funciones` y `_2_tablas_lote1..3`):
  restrictiva de lectura `espectador_sin_datos` en las 113 tablas salvo las
  del encabezado/menú (profiles —solo el propio—, grupos, grupo_modulos,
  modulos, suscripciones, planes, plan_escalones, permisos_modulo,
  roles_alcance, push_subscripciones); helpers de alcance vacíos;
  `auth_rol()` (la que usan las funciones; las policies usan
  `auth_rol_definer`) responde 'pendiente'; `auth_es_socio` y
  `auth_rh_directivo` false. En la app, `Layout` pinta
  `PantallaEspectador` en lugar de cualquier pantalla. **Menú de vitrina**
  (6-oct, Mario: "que vean los módulos que pueden contratar"): para el
  espectador `alcanceOrganizacion.modulos` = todo el catálogo `modulos`,
  no lo abierto de su organización. **Toda tabla nueva
  necesita también `espectador_sin_datos`.** Espectadores: María Alejandra
  y Paola Leticia (EK) y Aldo (ARSSA). Aplicar DDL sobre ~110 tablas de una vez rebasa los
  60 s de la herramienta: ir en lotes con `lock_timeout`.
- **Vistas que corren como su dueño** (se saltan RLS): las 11 ya no se
  leen sin sesión (`vistas_sin_acceso_anonimo`; antes cualquiera con la
  llave pública veía 1,887 renglones de OC). `avance_recepcion_oc`,
  `avance_embarque_ov`, `avance_resolucion_linea`, `v_pu_bandeja_almacen`,
  `v_pu_analisis_detalle` ya son `security_invoker`. **Pendiente**:
  `v_checador_marcas` y `v_remisiones_produccion` (pasarlas le quita
  marcas a RH y remisiones a almacén: corregir sus policies primero),
  `v_directorio`, `v_bbva_folio_paso`, `v_supervisores_bbva`,
  `v_personal_produccion`; y funciones definer sin frontera de
  organización: `fn_equilibrio_bbva_*` (sin guarda alguna),
  `fn_rh_kpi_*` (cualquier admin de cliente es "RH directivo"),
  `nomina_api_control_obra`.

## Estudio K (dado de alta 29-sep-2026)
- **Organización aparte** (`grupos.codigo = 'EK'`, link
  `https://acumulado-nine.vercel.app/?org=ek`), sin suscripción → solo
  consulta hasta que pague. Módulos abiertos: rh, conciliacion, inventario.
  Mario quiere además **punto de venta** (módulo nuevo, sin diseñar: faltan
  respuestas sobre servicios/productos, comisiones, formas de pago, caja,
  citas, CFDI).
- Empresa `EK`: ESPECIALISTA EN BELLEZA PLPA, S.A. de C.V., RFC
  EBP2208174A0, Cda. de la Carcaña 3202 int. 4, Col. Cholula, San Pedro
  Cholula, Pue., C.P. 72760 (salón de belleza). Falta `empresas_perfil_legal`
  (pide representante legal), cuentas bancarias y logo.
- María Alejandra Ibañez Alcocer (aialcocerspb@gmail.com): admin de Estudio
  K, **espectador** (no socia: la asignación de socia del 29-sep se perdió
  y no se rehízo). Estudio K tiene **todos los módulos cerrados**: Mario
  dice cuáles abrir cuando paguen.
- Paola Leticia Pérez Alcocer (7-oct-2026): admin de Estudio K,
  **espectador**, con correo inventado `paola.perez.ek@acumulado.invalid`
  (Mario: "créame uno temporal"; `.invalid` es dominio reservado, no recibe
  correo, así que no puede recuperar contraseña sola: se le dio contraseña
  temporal por chat a Mario). Cuando tenga correo real, cambiarlo.
- **Edge functions y el espectador (7-oct-2026, Mario: "recuerda, solo es
  espectador")**: `admin-crear-usuario` (v6) y `generar-link-acceso` (v5)
  desplegadas ya rechazan solo consulta. `checador-marcar` no lo hacía (un
  espectador podía marcar): v4 desplegada a partir del código que corría
  en producción + la pregunta `auth_solo_consulta` antes de marcar (ver
  fotos sigue igual). Probado en vivo con Paola: 403 y cero marcas.

## Estudio K (plan original, 28-sep-2026)
- Presentación del alcance por rol y plan de implementación (28-sep-2026):
  https://claude.ai/artifact/YUoceRAiht5pXw8VGTQyeP
- Toda la base para dar de alta una empresa nueva ya existe: alcance por
  empresa y por rol (`roles_alcance`, empresa principal + "Maneja también"),
  empresa activa, "Ver como" para probar cada rol, requisiciones → OC RQ →
  autorización de dirección, checador con cámara.
- Orden sugerido: 1) Mario confirma si Estudio K es una **empresa más de
  Grupo Loma** (Admin → Empresas, código corto p. ej. `EK`) o una
  **organización aparte** tipo ARSSA (skill `abrir-modulo`); 2) razón
  social, RFC, domicilio (`empresas_perfil_legal`), logo en
  `web/public/logos/<codigo>.png`; 3) cuentas bancarias; 4) personas y
  roles: quién es `empresa`, `responsable`, `almacen`, básicos con módulo
  `proyectos`; 5) proyectos iniciales; 6) Mario decide qué roles apaga en
  multiempresa (`roles_alcance`).
- Faltan de Mario: datos de Estudio K, `ANTHROPIC_API_KEY` válida, rol de
  Timoteo, cuenta de Aldo/ARSSA, si baja la frecuencia de la sincronización
  horaria del backoffice (~105 s por corrida).

## Pendientes conocidos
- Clave `ANTHROPIC_API_KEY` válida para lectura de fotos.
- Membrete por empresa (logo + razón social, RFC, domicilio, teléfono, correo):
  hoy solo ERG tiene logo (`web/public/logo-ergodinova.png`) y `remisionProduccion`
  busca `/logos/<codigo>.png`. `empresas_perfil_legal` guarda razón social y domicilio.
- Módulo "Abarrotes Neto" (nueva división tipo BBVA) sin definir.
- Módulo de pagos en efectivo / caja (Jaime): hoy solo existe la condición
  'efectivo' y `pagos_programados.metodo`; falta el fondo de caja, entregas
  a Jaime, comprobantes y arqueo.
- Backoffice (desarrollador: **Gonzalo**): las pendientes de autorización
  YA vienen en `api_ocs_aut` (campo `Estatus`); no hace falta endpoint
  nuevo para eso. Lo que sí pedirle: datos bancarios del proveedor
  (beneficiario, banco, CLABE, RFC) en la OC o un endpoint de proveedores,
  caché de 5–10 min y filtro por fecha.
