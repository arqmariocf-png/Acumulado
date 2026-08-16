# Acumulado

App de conciliación bancaria de Grupo Loma. El detalle funcional completo
está en [`SPEC.md`](./SPEC.md) — este archivo es la guía técnica de cómo
está armado el proyecto y cómo desplegarlo.

## Arquitectura

```
supabase/migrations/   Esquema Postgres: tablas, RLS, vistas de reporting
supabase/functions/    Edge functions (Deno) + módulos puros compartidos
  _shared/motor/          Motor de conciliación (fases 4.1-4.6 del spec)
  _shared/ingesta/        Parsers de CSV/Excel (estado de cuenta, CFDI, OC/OV)
  motor-conciliacion/     Corre el motor sobre un lote de movimientos
  ingesta-estado-cuenta/  Sube y parsea un estado de cuenta
  ingesta-cfdi/           Sube y parsea CFDI Recibidos/Emitidos
  ingesta-oc-ov/          Carga manual de Excel para OC/OV (respaldo)
  proxy-backoffice/       Integración con la API de OC/OV del backoffice
web/                    Frontend (Vite + React + Tailwind + Supabase)
```

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

Después de crear el proyecto, hay que dar de alta al primer usuario `admin`
a mano (el trigger `handle_new_user` deja a todo usuario nuevo en rol
`pendiente`, sin acceso — es intencional, ver sección 6 del spec):

```sql
update public.profiles set rol = 'admin' where id = '<uuid del usuario en auth.users>';
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
npm test          # motor de conciliación + parsers de ingesta (35 pruebas)
cd web && npm run build   # type-check + build del frontend
```

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
