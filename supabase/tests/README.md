# Pruebas de esquema

`node --test` cubre los módulos puros de `functions/_shared`, pero no puede
decir nada del esquema: los triggers, las vistas de costeo y las políticas de
RLS son SQL y sólo Postgres sabe si hacen lo que dicen. Esto es lo que las
prueba.

```bash
supabase/tests/correr.sh
```

Crea una base limpia, aplica **todas** las migraciones en orden y corre
`pu_verificacion.sql`. Termina en `TODAS LAS VERIFICACIONES PASARON` o truena
en la primera aserción que falle.

Necesita un Postgres local al que apunten las variables `PG*` estándar y un
usuario que pueda crear bases. `bootstrap_local.sql` simula lo que Supabase da
de fábrica (esquema `auth`, roles `anon`/`authenticated`/`service_role`,
`auth.uid()`); no es parte del esquema de la app y no se despliega.

## Qué cubre `pu_verificacion.sql`

El módulo de Precios Unitarios (SPEC.md sección 11), que es donde vive la
lógica que no se puede leer de un vistazo:

- El costo vigente de un insumo, y que una cotización nueva no borre la
  anterior.
- La matemática del costeo: rendimientos, porcentajes sobre mano de obra,
  explosión de análisis básicos anidados, y que cotizar un material vuelva a
  costear solos los análisis que lo usan.
- La cascada de sobrecosto y que la tarjeta cuadre sumada a mano.
- El circuito de firmas completo, y cada acción que **no** se debe poder
  hacer (saltarse una etapa, publicar sin factor, que almacén cambie
  cantidades, editar un PU publicado, escribir una firma a mano).
- Que un supervisor de una empresa no vea los precios de otra.

Cada actor entra con su propio rol (`set local role authenticated` +
`request.jwt.claim.sub`), así que las políticas de RLS se ejercitan de
verdad, no se leen.

## Lo que no cubre

Auth, Storage y el runtime de edge functions: eso necesita un proyecto
Supabase real (ver "Pendientes conocidos" en el README de la raíz).
