# Acumulado (Grupo Loma) — contexto para Claude Code

Este archivo se lee al inicio de cada sesión. Es la memoria entre
conversaciones: lo que no esté aquí o en el código, una sesión nueva no lo sabe.

## Qué es
App interna de Grupo Loma (8 empresas). Supabase (proyecto `zdqahpzijkkcnfehbggs`:
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
- Impresión/PDF: HTML generado en `web/src/lib/*.ts` (puro, con pruebas) y
  abierto como URL blob (`lib/imprimir.ts`); la pestaña se abre durante el clic
  (móvil). QR con `qrcode` (import dinámico).
- `web/version.json` + `AvisoVersion`: aviso de "versión nueva" en pestañas viejas.
- Foto de nota de entrega: evidencia por defecto; lectura por IA opcional
  (requiere `ANTHROPIC_API_KEY` válida en secrets de Edge Functions; la actual
  daba `invalid x-api-key` el 21-sep-2026).

## Nivel socio y organizaciones (25-sep-2026)
- `/` para admin = **vista de socio** (`pages/Socio.tsx`): organizaciones
  (`grupos`: LOMA maestro, ARSSA ejemplo) → empresas → KPIs por empresa, con
  `fn_socio_resumen()` (SECURITY DEFINER, solo admin) que llama
  `fn_kpis_empresa(uuid)`: mismas claves que `lib/indicadores.ts`, calculadas
  por empresa en SQL. El organigrama acepta `?empresa=<id>` y entonces pinta solo
  los KPIs que existen en ese mapa (`lib/kpisEmpresa.ts`).
- Otra sesión trabaja la rama `claude/arssa-backoffice-acumulado-6wa90r`
  (multi-organización: `grupos`, `grupo_modulos`, frontera RLS, suscripciones).
  En producción solo está aplicada `grupos_modulos` (tabla `grupos` con RLS sin
  policies: no leerla desde el navegador; usar la RPC). No mezclar esa rama
  desde aquí.
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
- Evidencia (foto de nota/remisión) en Registrar movimiento es una sección
  siempre visible para entrada y salida (edge `ocr-nota-entrega` v8 valida con
  `auth_puede_escribir_inventario`). No se guardan líneas ni remisiones en 0.

## Roles de personal contratado (24-sep-2026)
- `operativo` (solo checador), `administrativo`, `supervisor` (ve el checador de
  su gente: `personal.supervisor_profile_id`), `directivo` (ve el checador de
  todos). Entran a Checador, Mis documentos y a los módulos de `permisos_modulo`
  (inventario, produccion, precios, requisiciones, tareas, proyectos, bbva);
  finanzas cerrado (`ProtectedRoute modulo="finanzas"`).
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

## Pendientes conocidos
- Clave `ANTHROPIC_API_KEY` válida para lectura de fotos.
- Membrete por empresa (logo + razón social, RFC, domicilio, teléfono, correo):
  hoy solo ERG tiene logo (`web/public/logo-ergodinova.png`) y `remisionProduccion`
  busca `/logos/<codigo>.png`. `empresas_perfil_legal` guarda razón social y domicilio.
- Módulo "Abarrotes Neto" (nueva división tipo BBVA) sin definir.
- Backoffice: pedir a su desarrollador caché de 5–10 min y filtro por fecha en los API.
