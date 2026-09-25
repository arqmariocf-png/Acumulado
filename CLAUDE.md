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
  `avance_recepcion_oc` / `avance_embarque_ov`, selector con fecha).

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

## Pendientes conocidos
- Clave `ANTHROPIC_API_KEY` válida para lectura de fotos.
- Membrete por empresa (logo + razón social, RFC, domicilio, teléfono, correo):
  hoy solo ERG tiene logo (`web/public/logo-ergodinova.png`) y `remisionProduccion`
  busca `/logos/<codigo>.png`. `empresas_perfil_legal` guarda razón social y domicilio.
- Módulo "Abarrotes Neto" (nueva división tipo BBVA) sin definir.
- Backoffice: pedir a su desarrollador caché de 5–10 min y filtro por fecha en los API.
