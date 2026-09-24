# Acumulado — guía para agentes

Backoffice maestro multi-organización. Cada cliente es una **organización**
(tabla `grupos`) con sus entidades, usuarios y datos aislados, y con módulos
que se abren conforme los ocupa. Grupo Loma es la organización **maestra**
(opera la plataforma); ARSSA es el primer cliente y paga suscripción por
usuario, con escalones por volumen.

El detalle funcional está en `SPEC.md` (secciones 11 a 13: organizaciones,
suscripción y marca).
`README.md` explica cómo desplegar. Este archivo es lo que hay que saber
**antes de tocar código**.

## Las tres fronteras

Todo cambio tiene que respetarlas, y las tres tienen que estar de acuerdo:

1. **Organización.** Ningún usuario ve datos de otra organización, ni siquiera
   siendo corporativo. La excepción es el admin de la organización maestra.
2. **Módulo.** Si la organización no tiene el módulo abierto, sus tablas no
   responden. Cubre conciliación, inventario y RH; los módulos más nuevos
   todavía no tienen interruptor (sí tienen frontera de organización).
3. **Suscripción.** Sin pago al corriente se consulta y se exporta, pero no se
   captura ("gracia y luego solo lectura").

Se imponen en tres capas, y **la de la base es la que manda**:

- **RLS.** La frontera de organización la impone una policy **restrictiva**
  llamada `frontera_organizacion` en cada tabla de negocio: se evalúa en AND
  con todas las demás, así que una policy nueva mal escrita no puede abrirla.
  Las permisivas de cada módulo siguen decidiendo quién ve qué *dentro* de la
  organización (`grupo_en_alcance`, `empresa_en_alcance`,
  `empresa_en_mi_organizacion`, `auth_modulo_habilitado`,
  `auth_suscripcion_permite_escribir`).

  **Toda tabla nueva de negocio necesita su `frontera_organizacion`.** No es
  opcional ni se olvida: `supabase/tests/frontera_organizacion.sql` falla si
  falta, y la lista blanca de tablas globales de plataforma vive ahí.
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
  importes de cotización, mensualidad de la suscripción. Un total guardado a
  mano se desincroniza.
- **Nada que cuente dinero o usuarios de otra organización se expone por RPC.**
  Supabase publica toda función de `public`: si una función responde datos de
  un grupo arbitrario, o se acota por dentro o se revoca de `public` y se le
  da `execute` solo a `service_role`.
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

## Antes de construir, busca si ya existe

Este repositorio lo tocan varias sesiones a la vez. Ya pasó una vez: se
construyeron dos módulos de Inventario, dos de Proyectos y dos PWA en paralelo,
y el esquema combinado ni siquiera aplicaba. **Antes de agregar un módulo,
revisa `supabase/migrations/` y `web/src/pages/` a ver si ya está.** Y trabaja
en cambios chicos partiendo de `main`, mezclando pronto: el problema no fue el
código, fue una rama que vivió semanas aparte.

## Validar antes de dar algo por hecho

```bash
npm test                  # módulos puros: motor, parsers, suscripción (node --test)
./scripts/validar-sql.sh  # migraciones + RLS contra un Postgres local real
cd web && npm run build   # type-check + build
cd web && npm run lint
```

`./scripts/validar-sql.sh` es el que importa para cualquier cambio de esquema o
de policies: aplica todas las migraciones **desde cero** y corre
`supabase/tests/`. **Toda frontera nueva necesita una prueba ahí** que
demuestre que bloquea, no solo que permite. Los archivos `zz_*` son
diagnósticos: imprimen estado, no afirman nada.

Que aplique desde cero no es un detalle: es lo que permite restaurar la base el
día que haga falta y probar RLS sin tocar producción. Si una migración depende
de algo que alguien creó a mano en el proyecto de Supabase, el repositorio ya
no sabe reconstruir el sistema. Pasó con Precios Unitarios (6 tablas y 5
funciones que ninguna migración creaba) y se reparó en
`20260909125957/125958`.

Lo que **no** se puede validar en este entorno, y hay que decirlo al reportar:
no hay Deno (los edge functions solo se revisan sintácticamente), no hay
proyecto Supabase real (Auth, Storage y los advisors de seguridad/rendimiento
se corren después de desplegar) y no hay llaves de pasarela (ningún cobro real
se ha ejecutado).

## Abrir un módulo nuevo

Hay una receta paso a paso en `.claude/skills/abrir-modulo/SKILL.md`.
