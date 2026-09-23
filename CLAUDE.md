# Acumulado — guía para agentes

Backoffice maestro multi-organización. Cada cliente es una **organización**
(tabla `grupos`) con sus entidades, usuarios y datos aislados, y con módulos
que se abren conforme los ocupa. Grupo Loma es la organización **maestra**
(opera la plataforma); ARSSA es el primer cliente y paga suscripción.

El detalle funcional está en `SPEC.md` (sección 11: organizaciones y módulos).
`README.md` explica cómo desplegar. Este archivo es lo que hay que saber
**antes de tocar código**.

## Las tres fronteras

Todo cambio tiene que respetarlas, y las tres tienen que estar de acuerdo:

1. **Organización.** Ningún usuario ve datos de otra organización, ni siquiera
   siendo corporativo. La excepción es el admin de la organización maestra.
2. **Módulo.** Si la organización no tiene el módulo abierto, sus tablas no
   responden.
3. **Suscripción.** Sin pago al corriente se consulta y se exporta, pero no se
   captura ("gracia y luego solo lectura").

Se imponen en tres capas, y **la de la base es la que manda**:

- **RLS** (`grupo_en_alcance`, `empresa_en_alcance`, `auth_modulo_habilitado`,
  `auth_suscripcion_permite_escribir`).
- **Edge functions**: escriben con la `service_role` key, que bypassa RLS, así
  que validan explícitamente (`empresaOperableEnModulo`).
- **Frontend**: no arma menú ni rutas de lo que no aplica. Es comodidad, no
  seguridad — nunca la única defensa.

## Reglas que no se rompen

- **Nunca** guardar datos de tarjeta (PAN, CVV) en la base ni en logs. La
  tarjeta se captura en el dominio de la pasarela. De ella solo se guardan
  marca y últimos 4, que es lo que la pasarela devuelve.
- **Nunca** debilitar el aislamiento entre organizaciones "para que sea más
  fácil". Si algo no se ve, es que falta `grupo_id`, no que sobre una policy.
- Los **totales se calculan**, no se capturan: saldo bancario, existencias,
  importes de cotización. Un total guardado a mano se desincroniza.
- Los **roles y permisos son datos**, no código: se asignan desde el panel de
  admin. Nunca hardcodear un usuario, un rol ni una empresa.
- Una policy `for all` que sea la **única** de su tabla impide el "solo
  lectura": hay que partirla en select + insert/update/delete.

## Convenciones

- **Todo en español**: nombres de tablas, columnas, funciones, variables,
  componentes, comentarios y mensajes. El dominio es español; mezclar idiomas
  obliga a traducir mentalmente en cada lectura.
- **Migraciones**: `supabase/migrations/AAAAMMDDHHMMSS_descripcion.sql`, en
  orden, nunca se edita una ya aplicada — se agrega otra encima.
- **Lógica de negocio en módulos puros** bajo `supabase/functions/_shared/`,
  sin dependencias de Deno ni de Node, para poder probarla con `node --test`.
  Los `index.ts` de los edge functions son deliberadamente mecánicos: leer,
  mapear, llamar al módulo puro, escribir.
- **Adaptadores por proveedor**: la lógica de suscripción (`pagos/suscripcion.ts`)
  no menciona a Stripe; Stripe vive en `pagos/stripe.ts`. Cambiar de pasarela
  es escribir otro adaptador.
- **Comentarios que expliquen el porqué**, no el qué. Si una decisión tiene una
  alternativa obvia que se descartó, se dice por qué se descartó.
- **Tipos del frontend** a mano en `web/src/types/database.ts`, sincronizados
  con las migraciones.

## Validar antes de dar algo por hecho

```bash
npm test                  # módulos puros: motor, parsers, suscripción (node --test)
./scripts/validar-sql.sh  # migraciones + RLS contra un Postgres local real
cd web && npm run build   # type-check + build
cd web && npm run lint
```

`./scripts/validar-sql.sh` es el que importa para cualquier cambio de esquema o
de policies: aplica todas las migraciones desde cero y corre `supabase/tests/`.
**Toda frontera nueva necesita una prueba ahí** que demuestre que bloquea, no
solo que permite.

Lo que **no** se puede validar en este entorno, y hay que decirlo al reportar:
no hay Deno (los edge functions solo se revisan sintácticamente), no hay
proyecto Supabase real (Auth, Storage y los advisors de seguridad/rendimiento
se corren después de desplegar) y no hay llaves de pasarela (ningún cobro real
se ha ejecutado).

## Abrir un módulo nuevo

Hay una receta paso a paso en `.claude/skills/abrir-modulo/SKILL.md`.
