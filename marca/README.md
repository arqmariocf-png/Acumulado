# Marca de las organizaciones

Archivos de origen de los logotipos. Aquí viven para que el logotipo no
dependa de que alguien conserve el archivo en su computadora: el que **usa** la
aplicación es el que está cargado en el bucket `branding` de Supabase.

## ARSSA

| Archivo | Para qué |
|---|---|
| `arssa-logo.png` | El que va en la aplicación. Trazo oscuro (slate-900, el mismo del texto) sobre fondo transparente, para el encabezado claro. |
| `arssa-logo-blanco.png` | Trazo blanco sobre transparente, para fondos oscuros, presentaciones y documentos impresos en negro. |

Los dos son de 512×512 con el trazo centrado y un poco de aire alrededor.
Salieron del original que entregó el cliente (blanco sobre negro): se tomó la
luminancia del trazo como canal alfa, lo que conserva el antialias en vez de
recortarlo con un umbral duro y dejar los bordes dentados.

**El original blanco sobre negro no sirve tal cual en la aplicación**: el
encabezado es claro, así que se vería como un recuadro negro.

## Cómo se carga

Desde la aplicación, no copiando archivos a mano:

- El admin de la organización: **Admin → Marca**.
- El admin de la organización maestra, para cualquier cliente:
  **Admin → Organizaciones**, columna *Logotipo*.

Los dos caminos suben a `branding/<grupo_id>/logo.<ext>` y dejan la ruta en
`grupos.logo_path`. El bucket es público (un logotipo no es información
reservada, y así se sirve por URL directa sin firmar nada en cada carga), pero
escribir en la carpeta de una organización está acotado a los admins que
corresponden.
