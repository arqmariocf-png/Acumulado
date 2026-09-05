# Especificación — App de Conciliación Bancaria Grupo LOMA

## 1. Contexto del negocio

Grupo Loma es un grupo empresarial con 8 entidades:
1. Aceros y Envasados de Puebla
2. Ergodinova
3. Constructora, Supervisión y Consultoría LOMA
4. Mario Contreras Farfán
5. Loma Racing Team
6. QX Soluciones Globales en Tecnología y Software Empresarial
7. Vigueta Bovedilla y Bloques Balken
8. Mallas y Clavos Clavicón

El proceso actual: tesorería concilia manualmente ~22 cuentas bancarias (BBVA, Banorte, Santander, BanBajío) contra órdenes de compra (OC), órdenes de servicio (OS), órdenes de venta (OV), y CFDI (facturas electrónicas mexicanas) recibidos/emitidos. Hoy se hace en un Excel maestro (`Acumulado_Bancos_2026.xlsx`) con hojas por mes.

**Objetivo de la app:** reemplazar el flujo de Excel por una aplicación web donde cada área/empresa pueda cargar su propia información (estados de cuenta, CFDI), y el sistema aplique automáticamente la lógica de conciliación y clasificación, con un dashboard consultable por rol.

---

## 2. Modelo de datos (tabla principal de movimientos bancarios)

| Campo | Tipo | Notas |
|---|---|---|
| Tipo de Movimiento | string | Siempre "Bancos" actualmente |
| Cuenta | string(4) | Últimos 4 dígitos de la cuenta bancaria |
| Folio | string, opcional | Folio interno consecutivo |
| Fecha de Pago | date | Fecha real del movimiento bancario |
| Fecha OC/OS/OV | date, opcional | Fecha de creación de la orden (puede ser de mes anterior) |
| Año / Mes | int / string | Derivados de Fecha de Pago |
| Empresa | string | Una de las 8 entidades |
| Proyecto | string, opcional | Viene del catálogo de OC/OV |
| Nombre o Razón Social | string | Cliente o proveedor |
| Cargo Total | decimal, nullable | Dinero que sale de la cuenta |
| Abono Total | decimal, nullable | Dinero que entra a la cuenta |
| Saldo | decimal | Saldo real reportado por el banco tras el movimiento |
| OC / OS / OV / OF | string, opcional | Referencia a la orden, formato `"OC 39408"`, `"OS 12345"`, `"OV 14628"` |
| FACTURA | string, opcional | Folio de CFDI, o etiqueta de clasificación (ver sección 4) |
| Comentarios | string, opcional | Descripción cruda del banco (ej. "SPEI ENVIADO BANORTE...") |
| Observación | string, opcional | Nota auto-generada explicando por qué falta un dato |

**Regla crítica de captura:** Cargo y Abono nunca deben confundirse. Cuando un movimiento no trae Proyecto (columna vacía naturalmente, ej. traspasos internos), NO debe quedar un hueco silencioso entre columnas — usar `NULL` explícito, nunca desplazar el resto de los valores una posición.

---

## 3. Fuentes de datos que la app debe poder ingerir

1. **Catálogo de OC (órdenes de compra/servicio)** — vía API del backoffice (`api_ocs_aut`, `api_ocs_det_aut`) o carga manual de Excel. Campos clave: `Id_Orden, Proyecto, Empresa_solicitante, Proveedor, Total, Creado`.
2. **Catálogo de OV (órdenes de venta)** — vía API (`api_ov_aut`, `api_ov_det_aut`) o Excel. Campos clave: `Id OV/Folio_orden_venta, Proyecto, Empresa, Cliente, Total, FechaOV`.
3. **Estados de cuenta bancarios** — PDF por cuenta/banco/empresa, cargados por el área de tesorería de cada empresa.
4. **CFDI Recibidos** (compras) y **CFDI Emitidos** (ventas) — archivo por empresa (RFC) y periodo, formato `Recibidos-{RFC}-{AAAAMM}.xls` / `Emitidos-{RFC}-{AAAAMM}.xls`.

La API del backoffice (`https://reports.grupoloma.mx/dash/`) responde JSON sin autenticación actualmente — **marcar como hallazgo de seguridad a resolver antes de producción** (ver sección 7).

---

## 4. Lógica de clasificación y conciliación (ya validada en producción manual)

### 4.1 Cruce automático de Proyecto/Nombre
Para cada movimiento con referencia `OC ####` / `OS ####`, buscar en el catálogo de OC por `Id_Orden` y traer `Proyecto` → columna Proyecto, `Proveedor` → columna Nombre (si vacía).
Para `OV ####`, buscar en catálogo de OV por `Id OV`, traer `Proyecto` y `Cliente`.

### 4.2 Cruce automático de FACTURA
Buscar en CFDI Recibidos/Emitidos de la empresa correspondiente un registro cuyo `Total` coincida (tolerancia de centavos) con el Cargo o Abono del movimiento. Si hay **un solo** candidato → asignar `F- {Folio}`. Si hay **2 o más** candidatos con el mismo monto → marcar como **ambiguo**, no asignar automáticamente, dejar para revisión humana.

### 4.3 Movimientos que NUNCA requieren factura (clasificación automática, etiqueta `N/A - ...`)
| Tipo detectado por palabra clave en Comentarios/Referencia | Etiqueta a asignar |
|---|---|
| TRASPASO | `N/A - TRASPASO ENTRE CUENTAS PROPIAS` |
| COMISION | `N/A - COMISION BANCARIA` |
| PRESTAMO | `N/A - PRESTAMO INTERCOMPAÑIA` |
| SYS (nómina) | `N/A - NOMINA (SUELDOS Y SALARIOS)` |
| DEVOLUCION | `N/A - DEVOLUCION` |
| ESCRITURA | `N/A - PAGO NOTARIAL/ESCRITURA` |
| RENTA | `N/A - RENTA` |
| FINIQUITO | `N/A - FINIQUITO LABORAL` |
| DEPOSITO ERROR / DEVOLUCION ERROR | `N/A - DEPOSITO POR ERROR` / `N/A - DEVOLUCION POR ERROR` |
| COMPENSACION | `N/A - COMPENSACION` |
| RECUPERACION CREDITO | `N/A - RECUPERACION CREDITO` |
| SIN MOVIMIENTOS | `N/A - SIN MOVIMIENTOS` |

Estos movimientos deben tener **su propia vista/reporte** separado (Traspasos, Comisiones, Préstamos, Nómina, Devoluciones), no solo la etiqueta.

### 4.4 Proveedores con crédito (excepción temporal, NO cuenta como "falta factura")
| Proveedor | Regla |
|---|---|
| BBVA México | Factura hasta el mes siguiente |
| CEMEX | Complemento de pago dentro del mes o hasta 5 días después del corte |
| Bodega Cruz Azul del Centro | Igual que CEMEX |

### 4.5 Referencias de mes anterior
Si la OC/OS/OV referenciada en un movimiento de julio no existe en el catálogo de julio (porque es de junio, pagada en julio), no debe contar en contra del % de avance — marcar como "OC/OS/OV de mes anterior, pagado en este mes".

### 4.6 Deduplicación
Movimientos con mismo Cuenta + Fecha + Monto + Referencia deben marcarse como posible duplicado para revisión (ya se han encontrado varios duplicados reales en el proceso manual).

---

## 5. Dashboard y reportes

### 5.1 KPIs por mes y acumulado anual (YTD)
- % de movimientos con Proyecto completo
- % de movimientos con Nombre/Razón Social completo
- % de movimientos con FACTURA completo, **ajustado** (excluyendo las excepciones de la sección 4.3 y 4.4 del universo del cálculo)
- Totales de Cargo y Abono por mes

### 5.2 Vista por empresa
Movimientos y montos (Cargo/Abono/Neto) agrupados por cada una de las 8 empresas.

### 5.3 Saldo de cierre por cuenta
Última fecha con movimiento y su saldo, por cuenta bancaria — es el saldo inicial del mes siguiente.

### 5.4 Concentrado de pendientes
Lista de proveedores/clientes con movimientos sin factura real (excluyendo excepciones), con conteo y monto total, para dar seguimiento de cobranza/pago.

### 5.5 Semaforización visual
- 🔴 Rojo: falta el dato, sin explicación conocida — requiere revisión.
- 🟡 Amarillo: falta el dato pero es esperado (excepción documentada).
- 🟣 Morado: FACTURA ambigua (2+ candidatos), requiere decisión humana.

---

## 6. Roles y permisos (a definir con el cliente, punto de partida)

- **Tesorería corporativo:** acceso de lectura/escritura a las 8 empresas, dashboard consolidado.
- **Tesorería por empresa:** acceso de lectura/escritura solo a su empresa asignada — pueden cargar sus estados de cuenta y CFDI, capturar/corregir sus propios movimientos.
- **Dirección/Gerencia:** solo lectura, dashboard y reportes, sin capturar.
- **Sistemas/Admin:** gestión de usuarios, roles, y configuración de reglas de clasificación (sección 4) para que sean editables sin tocar código.

Cada usuario necesita login individual (usuario/contraseña) con el rol asignado desde un panel de administración — **no hardcodear roles**, deben ser configurables por el admin.

---

## 7. Consideraciones de seguridad (importante, se detectaron en el proceso manual)

1. **La API del backoffice actual no pide autenticación** — cualquiera con la URL puede leer datos financieros del grupo. Debe corregirse (API key o token) antes de que la app dependa de ella en producción.
2. Las contraseñas de usuario deben almacenarse con hash seguro (bcrypt/argon2), nunca en texto plano.
3. Dado que esto maneja datos financieros de 8 empresas, considerar aislamiento de datos por empresa (row-level security) para que un usuario de una empresa nunca pueda ver datos de otra, salvo el rol corporativo.
4. Definir política de backups y de qué pasa si dos usuarios editan el mismo movimiento al mismo tiempo (last-write-wins vs. bloqueo optimista).

---

## 8. Stack sugerido (punto de partida, ajustar según lo que Claude Code recomiende)

- **Frontend:** React + Tailwind (dashboard, formularios de carga, tablas filtrables)
- **Backend/DB/Auth:** Supabase o Firebase (autenticación con roles, base de datos relacional o documental, storage para PDFs/Excel subidos)
- **Hosting:** Vercel o Netlify para el frontend; el backend gestionado va con el proveedor elegido (Supabase/Firebase)
- **Procesamiento de PDFs/Excel:** función backend (Node.js o Python) que aplique la lógica de la sección 4 al momento de la carga

---

## 9. Datos de referencia para pruebas

El archivo `Acumulado_Bancos_2026.xlsx` (ya construido manualmente) puede usarse como dataset de prueba/semilla: contiene ~600 movimientos reales de julio y agosto 2026 ya clasificados, y sirve para validar que la lógica de la app reproduce los mismos resultados.

---

## 10. Módulo de Inventario (extensión, agregada 2026-08-24)

**Objetivo:** llevar un registro de entradas y salidas de almacén, compatible
con lectura de código de barras, y que conviva con el módulo de conciliación
bancaria haciendo "match" contra el mismo catálogo de OC (compras) y OV
(ventas) que ya usa el motor de conciliación.

### 10.1 Modelo

- **Almacenes** — hoy un almacén por empresa (decisión del cliente); el
  esquema admite varios por empresa a futuro sin migrar tablas.
- **Productos** — catálogo por empresa: SKU, nombre, código de barras
  (opcional, único por empresa cuando existe), unidad de medida, costo de
  referencia.
- **Movimientos de inventario** — cada entrada o salida es una fila con
  producto, cantidad, costo unitario, fecha y (opcional) la orden de compra
  u orden de venta con la que se vincula. La existencia de cada producto
  **siempre se calcula de este historial** (vista `existencias`), nunca se
  guarda como contador aparte -- mismo criterio que ya usa este proyecto
  para el saldo bancario.

### 10.2 Escaneo de código de barras

Dos formas, ambas soportadas:
1. **Lector físico USB/Bluetooth** — funciona sin librerías: estos lectores
   actúan como teclado (escriben el código + Enter), así que un `<input>`
   de texto con autofoco y un handler de `Enter` es suficiente.
2. **Cámara del navegador** — vía `@zxing/browser`, cargado con `import()`
   dinámico para no engordar el bundle principal (solo se descarga cuando
   alguien abre la cámara).

### 10.3 Match con el acumulado (Sección 3-4 de este documento)

El catálogo de OC/OS/OV que ya ingiere este proyecto (`ordenes_compra`,
`ordenes_venta`, sección 2-3) **solo trae el total en dinero de la orden**,
no el detalle línea por producto (ese detalle vendría de
`api_ocs_det_aut`/`api_ov_det_aut`, ver TODO en
`supabase/functions/proxy-backoffice/index.ts`). Por eso el match de
inventario es **por monto acumulado de la orden completa**, no por línea de
producto: cada movimiento vinculado a una orden aporta `cantidad ×
costo_unitario`, y las vistas `avance_recepcion_oc` / `avance_embarque_ov`
comparan esa suma contra el total de la orden para marcar
`sin_recibir` / `parcial` / `completo` (mismo criterio de semaforización que
la sección 5.5 de este documento). Si más adelante se confirma el contrato
de `api_ocs_det_aut`, se puede evolucionar a match por línea sin romper lo
ya construido -- las tablas de inventario no dependen del detalle de la OC,
solo la vista de avance tendría que ganar granularidad.

### 10.4 Pendiente de validar

- Nunca se probó contra un dispositivo real con cámara (solo se validó que
  compila y hace lazy-load correcto del chunk de `@zxing/browser`).
- El match por monto asume que el costo unitario capturado en el almacén es
  representativo del precio de la orden -- si difiere sistemáticamente
  (impuestos, fletes incluidos en el total de la OC pero no en el costo del
  producto, etc.) el % de avance puede no cuadrar exactamente contra el
  total de la orden aunque físicamente ya se haya recibido/embarcado todo.

---

## 11. Módulo de Precios Unitarios (extensión, agregada 2026-09-05)

El frontend de este módulo (`web/src/pages/precios/`) se había integrado
antes que su esquema, así que la pantalla existía pero consultaba tablas que
no estaban en la base -- aparecía desconectada. Esta sección documenta el
modelo con el que quedó conectado (migraciones `*_pu_*.sql`).

Un análisis de precio unitario (APU) es la tarjeta que dice cuánto cuesta
producir una unidad de un concepto de obra -- un metro cuadrado de muro, un
metro cúbico de excavación -- desglosada en materiales, mano de obra,
herramienta y equipo, más el sobrecosto que convierte el costo en precio de
venta.

### 11.1 El precio nunca se guarda

La regla que gobierna todo el módulo: **no hay una sola columna donde viva un
precio unitario**. `v_pu_analisis_costeo` lo recalcula de la explosión de
insumos cada vez que se consulta, y el costo de cada insumo sale de su
historial de cotizaciones (`pu_insumo_precios`, append-only).

La consecuencia práctica es la que pidió el negocio: corregir un rendimiento
o cotizar un material vuelve a costear solos todos los análisis en borrador
que lo usan, sin tener que abrirlos uno por uno. Y un análisis viejo sigue
siendo reproducible, porque la cotización con la que se armó sigue en el
historial con su fecha.

Lo único que sí se congela es lo que alguien firmó a mano:
`pu_analisis_items.costo_congelado` -- el precio y proveedor que almacén
autoriza para un renglón concreto. Si mañana sube el catálogo, ese análisis
conserva el precio con el que se cotizó.

### 11.2 Modelo

| Tabla | Qué es |
|---|---|
| `pu_insumos` | Catálogo de insumos **del grupo**, no de cada empresa: un jornal de albañil cuesta lo mismo lo capture quien lo capture. No guarda costo. |
| `pu_insumo_precios` | Historial de cotizaciones. `empresa_id` NULL = precio de grupo; una empresa puede tener el suyo (gana sobre el de grupo) porque el flete cambia el costo real según dónde esté la obra. |
| `pu_factores` | Indirectos, financiamiento, utilidad y cargos adicionales, como fracción (18% = 0.18). Por empresa y con vigencia. |
| `pu_analisis` | La tarjeta: empresa, obra, clave, concepto, unidad, estado y factor asignado. |
| `pu_analisis_items` | Los renglones. Cada uno es un insumo del catálogo **o** un análisis básico consumido dentro de éste, nunca los dos. |
| `pu_aprobaciones` | Bitácora de firmas. La escribe sólo un trigger; no hay policy de INSERT para nadie, ni para admin. |

**Básicos (análisis auxiliares).** Un mortero, una cuadrilla o un habilitado
de acero se capturan como análisis con `es_auxiliar = true` y se consumen
dentro de otros a costo directo, **sin indirectos ni utilidad**: el
sobrecosto se cobra una sola vez, en el concepto que sí se vende. Se pueden
anidar, y un trigger corta los ciclos (un básico no puede contener, ni
indirectamente, al análisis que lo contiene).

**Herramienta menor.** Se captura con `base_calculo = 'pct_mano_obra'`: su
costo es el subtotal de mano de obra **del propio análisis**, no un precio de
proveedor. Por eso se recalcula sola cuando alguien corrige un rendimiento,
que es exactamente la razón de capturarla así y no como un importe fijo.

### 11.3 Cómo se arma el precio

La aportación de un renglón es `cantidad / rendimiento` (en mano de obra:
jornadas entre unidades que produce la cuadrilla por jornada). El costo
directo es la suma de los importes de todos los renglones.

Sobre el costo directo va el sobrecosto **en cascada**, cada porcentaje sobre
el subtotal que ya trae los anteriores, que es el orden de la Ley de Obras
Públicas:

```
PU = ((((CD + indirectos) + financiamiento) + utilidad) + cargos adicionales)
```

Los importes se redondean a centavos renglón por renglón y el precio es la
suma de esos importes ya redondeados -- no el redondeo de la suma. La tarjeta
impresa tiene que cuadrar cuando alguien la sume a mano, que es justo lo que
hace quien la revisa.

Sin factor asignado los cuatro porcentajes son cero y el precio unitario es
el costo directo pelón. La pantalla y el PDF lo avisan explícitamente, para
que nadie confunda un PU sin factor con un precio de venta.

### 11.4 Circuito de firmas

```
borrador ──▶ en_revision_material ──▶ material_confirmado ──▶ autorizado ──▶ publicado
(supervisión)      (almacén)             (dirección)        (dirección general)
```

Quién resuelve cada etapa lo decide `pu_puede_actuar(estado)`, que usan por
igual el trigger de flujo y las políticas de RLS -- una sola definición, para
que no haya dos versiones de la regla que se puedan desincronizar. El
frontend pinta los botones que cree que aplican, pero lo que manda es la
base: si alguien fuerza una acción, la rechaza con su propio mensaje y la
pantalla lo muestra tal cual.

Reglas que impone el trigger:

- Sólo se avanza de una etapa a la siguiente, nunca se saltan pasos.
- Regresar a borrador (el rechazo) lo puede hacer quien tenía que resolver la
  etapa en la que está. Borra el avance: las firmas anteriores ya no
  sostienen esta versión, porque las cantidades pueden cambiar antes de
  reenviarlo.
- No se envía a revisión un análisis sin renglones.
- No se publica un concepto sin factor de sobrecosto asignado.
- Dar de baja (`obsoleto`) sólo desde `publicado`, y sólo dirección general.

Qué se puede tocar y cuándo: en borrador se captura todo; en revisión de
material el análisis está congelado salvo precio y proveedor (lo que almacén
tiene que resolver); de ahí en adelante no se toca nada -- si hay que
corregir, se regresa a borrador y el circuito vuelve a empezar.

**El circuito no va en el PDF.** La tarjeta se le entrega al cliente, y quién
autorizó internamente es gobierno interno de Grupo Loma, no información del
entregable. Eso se ve en pantalla (`CircuitoFirmas.tsx`).

### 11.5 Quién ve qué

A diferencia de Requisiciones (donde un `responsable` sólo ve sus proyectos),
aquí la lectura es **por empresa**: un precio unitario no es el documento de
una obra, es el catálogo de precios de la empresa y quien trabaja ahí lo
consulta completo. Se suman las obras donde el usuario esté asignado aunque
sean de otra empresa.

- `responsable` (supervisión): elabora y envía a revisión.
- `almacen`: pone precio y proveedor. No entra al catálogo de insumos -- no
  es suyo.
- `direccion`: autoriza.
- `admin` (dirección general): define los factores, publica y da de baja.
- `rh` / `rh_documentos` / `pendiente`: no entran.

### 11.6 Pendiente de validar

- Los porcentajes del factor sembrado son un punto de partida, no los del
  grupo: hay que confirmarlos con Dirección General antes de publicar un
  precio real (ver "Pendientes conocidos" en README.md).
- El PDF (`pu-pdf`) se validó dibujando las variantes reales de la tarjeta
  (borrador con marca de agua, publicado, básico, vacío y de varias páginas)
  pero nunca corriendo bajo Deno, porque este entorno de desarrollo no lo
  tiene instalado.
- El catálogo de insumos arranca casi vacío a propósito: sólo trae
  "Herramienta menor" y "Equipo de seguridad", que son los dos renglones que
  prácticamente todo análisis lleva. El resto se captura conforme se use.
