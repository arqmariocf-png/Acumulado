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
  únicamente de espectador". `20260929140000_solo_consulta_espectador.sql`
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
- Backoffice: pedir a su desarrollador caché de 5–10 min y filtro por fecha en los API.
