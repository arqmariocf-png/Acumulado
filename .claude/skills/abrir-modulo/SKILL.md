---
name: abrir-modulo
description: Receta para abrir un módulo nuevo en Acumulado (o abrirle a una organización uno que ya existe), respetando las tres fronteras — organización, módulo y suscripción. Úsala cuando se pida agregar un área funcional nueva (proyectos, compras, mantenimiento…), activarle un módulo a un cliente, o cuando un cambio agregue tablas que deban quedar aisladas por organización.
---

# Abrir un módulo en Acumulado

Acumulado es multi-organización: cada cliente ve solo lo suyo, con los módulos
que tiene abiertos, y captura solo si su suscripción está al corriente. Un
módulo nuevo que se salte cualquiera de esas tres cosas es una fuga.

Lee `CLAUDE.md` antes de empezar. Esta receta supone esas reglas.

## Caso A — solo activarle a una organización un módulo que ya existe

No se toca código. Es un renglón en `grupo_modulos`, desde Admin →
Organizaciones (solo el admin de la organización maestra) o por SQL:

```sql
update public.grupo_modulos set habilitado = true, habilitado_at = now()
 where grupo_id = (select id from public.grupos where codigo = 'XXX')
   and modulo_clave = 'inventario';
```

Si la organización se dio de alta por SQL y no tiene renglones, se crean con un
`insert ... select` contra `modulos` (ver `20260923090001_grupos_modulos.sql`).

## Caso B — módulo nuevo

### 1. Registrarlo

En una migración nueva:

```sql
insert into public.modulos (clave, nombre, descripcion, orden) values
  ('<clave>', '<Nombre>', '<qué incluye>', <orden>);

insert into public.grupo_modulos (grupo_id, modulo_clave, habilitado, habilitado_at)
select g.id, '<clave>', g.codigo = '<ORG QUE LO ESTRENA>',
       case when g.codigo = '<ORG QUE LO ESTRENA>' then now() end
from public.grupos g;
```

Las organizaciones que no lo estrenan quedan en `false`: un módulo nuevo no se
le abre a nadie por default.

### 2. Tablas

- Si la fila cuelga de una empresa → `empresa_id not null`. La empresa ya
  pertenece a un grupo; con eso queda aislada.
- Si no cuelga de una empresa → `grupo_id not null` más un trigger
  `set_grupo_id_del_usuario` para llenarlo solo.
- Si cuelga de otra fila del módulo (un plano cuelga del proyecto) → escribe
  una función `*_en_alcance(id)` SECURITY DEFINER que resuelva la frontera una
  sola vez, como `proyecto_en_alcance`.
- **Unicidad**: cualquier `unique` sobre un nombre, clave o folio tiene que ser
  `(grupo_id, ...)`. Un unique global deja a la primera organización dueña del
  valor y las demás no pueden usarlo.
- Los totales se calculan (columna generada o vista), no se capturan.

### 3. RLS — cuatro policies por tabla, nunca una `for all`

```sql
alter table public.<tabla> enable row level security;

create policy <tabla>_select on public.<tabla> for select
  using (
    public.auth_rol() <> 'pendiente'
    and public.auth_modulo_habilitado('<clave>')
    and public.empresa_en_alcance(empresa_id)   -- o grupo_en_alcance(grupo_id)
  );

create policy <tabla>_insert on public.<tabla> for insert
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('<clave>')
    and public.empresa_en_alcance(empresa_id)
  );
-- update: las dos condiciones (using y with check). delete: solo using.
```

La lectura **no** lleva `auth_suscripcion_permite_escribir()`: quien no paga
sigue consultando y exportando lo suyo. Partir en cuatro policies es lo que
hace posible esa distinción.

Índice para cada FK nueva (el advisor de rendimiento de Supabase los reclama) y
`security_invoker = true` en toda vista.

### 4. Archivos, si el módulo los tiene

Bucket propio, privado, con el `grupo_id` como primer folder de la ruta, y
policies sobre `storage.objects` usando `grupo_de_ruta(name)` — nunca un cast
directo a uuid, que revienta con objetos de otros buckets.

### 5. Pruebas — antes de darlo por hecho

Agrega casos en `supabase/tests/` que demuestren que **bloquea**:

- un usuario de otra organización no ve nada del módulo;
- con el módulo cerrado no se escribe;
- con la suscripción suspendida se **lee** pero no se escribe.

Corre `./scripts/validar-sql.sh`. Una prueba que solo demuestra que el camino
feliz funciona no sirve para esto.

### 6. Frontend

1. `ModuloClave` en `web/src/types/database.ts` más los tipos de las tablas.
2. Enlace en `ENLACES` de `Layout.tsx` con su `modulo`.
3. Rutas envueltas en `<ProtectedRoute modulo="<clave>" />` en `App.tsx`.
4. `RUTA_DEL_MODULO` en `Inicio.tsx`.
5. En las pantallas, esconder los botones de captura cuando
   `suscripcionPermiteEscribir` es false — la base ya lo rechaza, pero ofrecer
   un botón que va a fallar es una mala pantalla.

### 7. Documentar

Sección nueva en `SPEC.md` y, si cambia el despliegue, en `README.md`.

## Antes de reportar

```bash
npm test && ./scripts/validar-sql.sh && (cd web && npm run build && npm run lint)
```

Y di explícitamente qué **no** quedó validado (Deno, Supabase real, pasarela).
