# Acumulado

Backoffice maestro donde cada cliente vive como una **organización** propia,
con sus entidades, usuarios y datos aislados, y con los módulos que se le van
abriendo conforme los ocupe. Hoy operan dos: **Grupo Loma** (organización
maestra, con conciliación bancaria, inventario y RH abiertos) y **ARSSA**
(organización cliente, con el módulo de Proyectos y suscripción de pago por
usuario).

El detalle funcional completo está en [`SPEC.md`](./SPEC.md) — la sección 11
describe el modelo de organizaciones y el interruptor de módulos; este archivo
es la guía técnica de cómo está armado el proyecto y cómo desplegarlo.

## Arquitectura

```
supabase/migrations/   Esquema Postgres: tablas, RLS, vistas de reporting
supabase/functions/    Edge functions (Deno) + módulos puros compartidos
  _shared/motor/          Motor de conciliación (fases 4.1-4.6 del spec)
  _shared/ingesta/        Parsers de CSV/Excel (estado de cuenta, CFDI, OC/OV)
  _shared/pagos/          Suscripción: reglas puras + adaptador de pasarela
  motor-conciliacion/     Corre el motor sobre un lote de movimientos
  suscripcion-checkout/   Manda al admin a capturar/cambiar tarjeta en la pasarela
  suscripcion-webhook/    Recibe los avisos de cobro y mueve el estado de la suscripción
  usuarios-alta/          El admin de una organización invita a su gente
  usuarios-sincronizar/   Reporta a la pasarela cuántos usuarios se están cobrando
  ingesta-estado-cuenta/  Sube y parsea un estado de cuenta
  ingesta-cfdi/           Sube y parsea CFDI Recibidos/Emitidos
  ingesta-oc-ov/          Carga manual de Excel para OC/OV (respaldo)
  proxy-backoffice/       Integración con la API de OC/OV del backoffice
web/                    Frontend (Vite + React + Tailwind + Supabase)
  src/pages/Inicio.tsx      Portada base de una organización: entidades y qué
                            módulos tiene abiertos (SPEC.md sección 11)
  src/pages/admin/          Usuarios, entidades, organizaciones (interruptor de
                            módulos), reglas y excepciones
  src/pages/proyectos/      Proyectos, planos con revisiones y cotizaciones
  src/pages/inventario/     Entradas/salidas de almacén (con escaneo de código de
                            barras), existencias, catálogo de productos, y match
                            de recepción/embarque contra OC/OV (SPEC.md sección 10)
supabase/tests/         Pruebas SQL que necesitan un Postgres con las migraciones
                        aplicadas (aislamiento entre organizaciones)
```

La frontera entre organizaciones está en tres capas, y las tres tienen que
estar de acuerdo: RLS en la base (`grupo_en_alcance`, `empresa_en_alcance`,
`auth_modulo_habilitado`), la validación explícita de los edge functions
(`empresaOperableEnModulo`, porque escriben con la `service_role` key que
bypassa RLS), y el armado de menú y rutas en el frontend.

Los módulos en `_shared/motor` y `_shared/ingesta` son TypeScript puro sin
dependencias de Deno ni de Node — por eso se pueden probar directo con
`node --test` sin levantar nada, y son los mismos que corren dentro de los
edge functions en producción.

## Requisitos

- Un proyecto de [Supabase](https://supabase.com) (plan gratuito alcanza para
  desarrollo).
- Node.js 22+ (para correr pruebas y el frontend).
- `npx supabase` (CLI) — no requiere instalación global.

## Desplegar el backend

```bash
npx supabase login
npx supabase link --project-ref <tu-project-ref>
npx supabase db push              # aplica supabase/migrations/*.sql en orden
npx supabase functions deploy     # despliega todos los edge functions
```

Secrets que los edge functions necesitan (`npx supabase secrets set NOMBRE=valor`):

| Secret | Para qué | Notas |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Todos los edge functions | Supabase los inyecta automáticamente, no hace falta configurarlos a mano |
| `BACKOFFICE_API_BASE_URL` | `proxy-backoffice` | URL base de la API del backoffice (`reports.grupoloma.mx` o la que corresponda) |
| `BACKOFFICE_API_TOKEN` | `proxy-backoffice` | Token una vez que se corrija la falta de autenticación de la API (sección 7.1 del spec) |
| `STRIPE_SECRET_KEY` | `suscripcion-checkout` | Llave secreta de Stripe (`sk_...`) |
| `STRIPE_PRECIO_ID` | `suscripcion-checkout` | Id del precio recurrente en Stripe (`price_...`), con tarifa **escalonada por volumen** (ver SPEC.md sección 13) |
| `STRIPE_WEBHOOK_SECRET` | `suscripcion-webhook` | Secreto de firma del webhook (`whsec_...`), que da Stripe al registrar la URL de la función |

Para que el cobro corra hay que, además, dar de alta en Stripe el producto con
su precio recurrente mensual y registrar la URL de `suscripcion-webhook` como
endpoint, suscrito a `invoice.payment_succeeded`, `invoice.payment_failed`,
`customer.subscription.updated`, `customer.subscription.deleted` y
`payment_method.attached`.

Después de crear el proyecto, hay que dar de alta al primer usuario `admin`
a mano (el trigger `handle_new_user` deja a todo usuario nuevo en rol
`pendiente` y sin organización, sin acceso — es intencional, ver sección 6 del
spec). Tiene que quedar en la organización **maestra**: es la única que puede
dar de alta clientes y abrirles módulos.

```sql
update public.profiles
   set rol = 'admin',
       grupo_id = (select id from public.grupos where es_maestro)
 where id = '<uuid del usuario en auth.users>';
```

## Frontend

```bash
cd web
npm install
cp .env.example .env.local   # completar con la URL y anon key del proyecto
npm run dev
```

## Pruebas

```bash
npm test          # motor de conciliación + parsers de ingesta (90 pruebas)
cd web && npm run build   # type-check + build del frontend
```

Las pruebas de RLS (aislamiento entre organizaciones, interruptor de módulos y
suscripción) son SQL y necesitan un Postgres con las migraciones aplicadas, así
que van aparte de `npm test`. Un solo comando levanta el Postgres, aplica todas
las migraciones desde cero y corre todo `supabase/tests/`:

```bash
./scripts/validar-sql.sh
```

Es el comando que importa para cualquier cambio de esquema o de policies: ahí
es donde vive casi toda la lógica de seguridad del proyecto.

Los edge functions (Deno) no se pueden ejecutar en este flujo de pruebas —
solo se verifican sintácticamente (`node --check`) porque este entorno de
desarrollo no tiene Deno instalado. Su lógica de negocio vive en los módulos
`_shared/*` ya probados; los `index.ts` de cada función son deliberadamente
mecánicos (leer, mapear, llamar al módulo puro, escribir).

## Pendientes conocidos antes de producción

1. **Sin validación end-to-end contra un proyecto Supabase real todavía.**
   Todo lo anterior se probó con Postgres local + `node --test`, nunca contra
   Supabase en sí (Auth, Storage, Edge Functions runtime).
2. **Formato exacto de CFDI y contrato de la API del backoffice sin
   confirmar** — el spec no da encabezados/parámetros exactos; los parsers en
   `_shared/ingesta/cfdi.ts` y `_shared/ingesta/oc-ov.ts` usan alias
   razonables marcados con TODO. Hay que ajustarlos contra un archivo/API
   real.
3. **Adaptadores de estado de cuenta por banco** (BBVA/Banorte/Santander/
   BanBajío) no implementados — el parser actual asume el formato canónico
   de la sección 2 del spec (que coincide con el Excel maestro real). Si
   tesorería exporta en el formato crudo de cada banco en vez de mantener
   ese formato, hacen falta adaptadores por banco (requieren archivos de
   muestra reales).
4. **API del backoffice sin autenticación** (hallazgo de seguridad, sección
   7.1 del spec) — corregirlo es un prerequisito para que `proxy-backoffice`
   se use en producción con datos reales.
5. **Módulo de inventario (SPEC.md sección 10) sin probar contra un
   dispositivo real con cámara** — el escaneo por cámara (`@zxing/browser`)
   solo se validó en build; falta probar en un teléfono/tablet real del
   almacén. El match contra OC/OV es por monto total de la orden, no por
   línea de producto, porque el catálogo de OC/OV todavía no trae detalle de
   línea (ver sección 10.3 del spec).
