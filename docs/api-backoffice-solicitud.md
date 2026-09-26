# API del backoffice para Acumulado — solicitud de cambios

Para: Gonzalo (QX Soluciones, backoffice `reports.grupoloma.mx`)
De: Mario Contreras Farfán / Grupo Loma
Fecha: 25 de septiembre de 2026

## 1. Qué consumimos hoy

Acumulado (la app interna de Grupo Loma) sincroniza cada hora, y bajo demanda,
estos cuatro endpoints, sin parámetros y sin autenticación:

| Endpoint | Uso en Acumulado | Campos que leemos |
|---|---|---|
| `GET /dash/api_ocs_aut` | Catálogo de OC/OS (encabezado) | `Id_Orden`, `Tipo_orden`, `Empresa_solicitante`, `Proyecto`, `Proveedor`, `TOTAL`, `Creado` |
| `GET /dash/api_ocs_det_aut` | Partidas de cada OC/OS | `Id_Orden`, `Tipo_orden`, `Empresa_solicitante`, `Item`, `Unidad`, `Cantidad`, `Costo`, `IVA` |
| `GET /dash/api_ov_aut` | Catálogo de OV (encabezado) | `Folio_orden_venta`, `Id_cotizacion`, `empresa`, `Project`, `Cliente_nombre`, `Cliente_apellido`, `OV_Subtotal`, `FechaOV` |
| `GET /dash/api_ov_det_aut` | Partidas de cada OV | `Folio_orden_venta`, `Id_cotizacion`, `empresa`, `concepto`, `Unidad`, `Cantidad`, `PrecioBase`, `SATcode` |

Con esos datos el almacén registra entradas y salidas partida por partida
(qué llegó, qué falta, qué sobró) y finanzas cruza los pagos bancarios con
la OC/OV.

## 2. Problemas medidos (25-sep-2026)

| Endpoint | Tiempo de respuesta | Tamaño | Filas |
|---|---|---|---|
| `api_ocs_aut` | 30 s | 765 KB | 1,574 |
| `api_ocs_det_aut` | 56 s | 1.6 MB | ~3,000 |
| `api_ov_aut` | 13 s | | 492 |
| `api_ov_det_aut` | 8 s | | ~1,500 |

1. **No trae las órdenes del día.** La última fila publicada es del 24-sep
   22:58 aunque la consulta se hizo el 25-sep a las 14:00. La OC 40995
   (autorizada hoy) no aparece. Si la consulta lleva `Creado < CURDATE()` o
   el JSON se regenera de noche, necesitamos que incluya el día en curso.
2. **Sin filtros**: cada llamada baja el catálogo completo desde julio,
   aunque solo cambien 10 órdenes.
3. **Sin caché ni compresión**: `Cache-Control: no-cache, private`, sin gzip.
   Cada llamada recalcula todo en Laravel.
4. **Sin autenticación**: cualquiera con la URL ve compras, proveedores y
   precios de las 8 empresas.
5. `Costo` viene como número con 30 decimales (float sin redondear).

## 3. Lo que pedimos

Mantener los cuatro endpoints y los nombres de campo actuales (para no
romper lo que ya funciona) y agregar lo siguiente.

### 3.1 Incluir el día en curso
Que la consulta incluya las órdenes creadas/modificadas hoy. Es lo más
urgente: el almacén recibe material el mismo día que se autoriza la OC.

### 3.2 Filtros por query string (todos opcionales)

| Parámetro | Ejemplo | Efecto |
|---|---|---|
| `modificado_desde` | `?modificado_desde=2026-09-25T13:00:00` | Solo órdenes creadas o actualizadas desde esa fecha-hora (sincronización incremental). Es el que más carga quita. |
| `desde` / `hasta` | `?desde=2026-09-01&hasta=2026-09-30` | Rango por fecha de creación (`Creado` / `FechaOV`). |
| `id_orden` | `?id_orden=40995` | Una sola orden (para consultas puntuales). En OV: `folio`. |
| `empresa` | `?empresa=Mallas y Clavos Clavicón` | Solo una empresa solicitante. |

Los endpoints `_det_aut` aceptan los mismos parámetros y devuelven las
partidas de las órdenes que cumplan el filtro.

### 3.3 Campos nuevos en cada fila

| Campo | Tipo | Para qué |
|---|---|---|
| `Actualizado` | fecha-hora `YYYY-MM-DD HH:MM:SS` | Saber qué cambió (estatus, total, partidas) sin volver a bajar todo. |
| `Estatus` en encabezado | texto | Hoy solo viene en el detalle. Nos sirve en el encabezado para mostrar "pendiente de autorización", "cancelada", etc. |
| `Id_Linea` (o `Numero_partida`) en `_det_aut` | entero | Identificador estable de la partida. Hoy identificamos la partida por el texto del `Item`; si lo editan en el backoffice, la partida se duplica. |
| `Fecha_autorizacion` | fecha | Para reportes de tiempos. |

### 3.4 Caché y compresión
- Caché en el servidor de 5 a 10 minutos por combinación de parámetros
  (`Cache-Control: public, max-age=300`), o guardar el JSON precalculado y
  regenerarlo cuando cambie una orden.
- `Content-Encoding: gzip` (el JSON de partidas baja de 1.6 MB a ~150 KB).
- Meta: menos de 3 segundos con filtro `modificado_desde`; menos de 15 s el
  catálogo completo.

### 3.5 Autenticación
Header `X-Api-Key: <clave>` (o `Authorization: Bearer <clave>`). Una clave
por consumidor; sin header o con clave inválida, `401`. Nosotros la
guardamos en la configuración del sistema, nunca en código.

### 3.6 Formato de respuesta
Mismo arreglo JSON de hoy, con números redondeados a 4 decimales en
`Costo` y `PrecioBase`, y a 2 en `TOTAL` / `OV_Subtotal`. Fechas en formato
`YYYY-MM-DD` y fecha-hora `YYYY-MM-DD HH:MM:SS` (hora de Puebla).

Si prefieren un sobre, este también nos sirve:

```json
{
  "generado_en": "2026-09-25 14:05:12",
  "total": 12,
  "data": [ { "Id_Orden": 40995, "Tipo_orden": "Compra", "Estatus": "Autorizada", "...": "..." } ]
}
```

### 3.7 Ejemplos

```
GET /dash/api_ocs_aut?modificado_desde=2026-09-25T13:00:00
X-Api-Key: ********

[
  {
    "Id_Orden": 40995,
    "Tipo_orden": "Compra",
    "Estatus": "Autorizada",
    "Empresa_solicitante": "Mallas y Clavos Clavicón",
    "Proyecto": "Planta Clavicón",
    "Proveedor": "ACEREXPRESS DEL SURESTE SA DE CV",
    "TOTAL": 18450.00,
    "Creado": "2026-09-25 09:12:40",
    "Actualizado": "2026-09-25 13:40:02",
    "Fecha_autorizacion": "2026-09-25"
  }
]
```

```
GET /dash/api_ocs_det_aut?id_orden=40995
X-Api-Key: ********

[
  {
    "Id_Orden": 40995,
    "Id_Linea": 1,
    "Tipo_orden": "Compra",
    "Empresa_solicitante": "Mallas y Clavos Clavicón",
    "Item": "Alambrón 5.5 mm",
    "Unidad": "KG",
    "Cantidad": 5000,
    "Costo": 18.0900,
    "IVA": 1,
    "Actualizado": "2026-09-25 13:40:02"
  }
]
```

## 4. Cómo lo vamos a usar
- Cada 5 minutos: `?modificado_desde=<última sincronización>` en los cuatro
  endpoints (hoy es cada hora porque el catálogo completo tarda un minuto).
- Una vez al día en la madrugada: catálogo completo, por si algo se perdió.
- Bajo demanda desde el almacén: `?id_orden=<folio>` cuando llega material
  de una OC que todavía no vemos.

## 5. Orden sugerido
1. Incluir el día en curso (sin esto el almacén no puede trabajar el mismo día).
2. `modificado_desde` + `Actualizado`.
3. `id_orden` / `folio`.
4. Caché, gzip y API key.
5. `Id_Linea`, `Estatus` en encabezado y `Fecha_autorizacion`.

Cualquier duda técnica: los cuatro endpoints los consume una función en
Postgres (Supabase) vía HTTP; podemos probar en cuanto haya un ambiente.
