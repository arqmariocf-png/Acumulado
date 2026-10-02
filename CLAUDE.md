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
  (`solicitar_sincronizacion_oc_ov` + `sincronizaciones_oc_ov`). Solo llegan
  OC ya autorizadas; las pendientes se dan de alta a mano con folio (fuente 'excel').
- Partidas de OC/OV en `ordenes_compra_lineas` / `ordenes_venta_lineas` con
  vistas `v_oc_lineas_avance` / `v_ov_lineas_avance` (recibido, pendiente,
  diferencia, estado incl. 'excedido'); `movimientos_inventario` apunta a la partida.
- Costeo de precios unitarios: funciones `fn_pu_*` son SECURITY DEFINER con guarda
  de rol (evitaban timeout por RLS recursivo). `pu_analisis_items.descripcion_manual`
  = descripción propia por renglón sin tocar el catálogo compartido.
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

## Dropbox de trabajo (1-oct-2026)
- Carpeta `/Acumulado · Claude` en el Dropbox de Mario (MCP de Dropbox):
  `01 Documentos base` (lo que Mario deja: formatos, Excel de referencia,
  logos), `02 Consultas` (lo que Claude prepara a pedido, nombre
  `AAAA-MM-DD tema`), `03 Del sistema` (exportaciones de la app) y
  `LEEME.md`. Antes de pedirle a Mario un archivo, revisar ahí. Nunca
  secretos ni datos de tarjeta en esa carpeta.

## Personas y roles (referencia rápida)
Mario (admin, todas las empresas) · Laura Ortaza (direccion/finanzas, todas) ·
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
  K, **espectador**, socia (inicio en vista de socio).

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
