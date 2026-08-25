# Acumulado — Frontend

App de conciliación bancaria de Grupo Loma. Ver `/SPEC.md` en la raíz del
repo para el detalle funcional completo.

## Setup

```bash
npm install
cp .env.example .env.local   # completar con las credenciales del proyecto Supabase
npm run dev
```

`.env.local` necesita:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Ambas son públicas por diseño (la seguridad la da RLS en Postgres, no el
secreto de estas claves) — nunca poner ahí la `service_role` key.

## Build

```bash
npm run build   # tsc -b && vite build
```

## Estructura

- `src/lib/supabase.ts` — cliente de Supabase.
- `src/lib/auth.tsx` — contexto de sesión + profile (rol/empresa) del usuario.
- `src/pages/` — una página por ruta; `src/pages/admin/` son las pantallas
  restringidas a `rol='admin'`.
- `src/types/database.ts` — tipos escritos a mano reflejando el esquema de
  `supabase/migrations/`. Si el esquema cambia, hay que actualizarlos a mano
  (o generarlos con `supabase gen types typescript` una vez que exista un
  proyecto Supabase real vinculado).

Los edge functions que este frontend llama (`ingesta-*`, `motor-conciliacion`,
`proxy-backoffice`) viven en `/supabase/functions`.
