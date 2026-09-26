import { supabase } from "./supabase";
import { manifiestoDeMarca } from "./marcaManifiesto";

export { manifiestoDeMarca } from "./marcaManifiesto";

// Marca de una organización (nombre visible y logotipo). Vive aparte de las
// pantallas porque hay dos caminos para lo mismo: el admin de una
// organización edita la suya en Admin → Marca, y el admin de la organización
// maestra edita la de cualquier cliente desde Admin → Organizaciones. Las
// reglas del archivo tienen que ser las mismas por los dos lados.

export const TIPOS_LOGOTIPO = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

/** 1 MB: es un logotipo de encabezado, no un render. */
export const TAMANO_MAXIMO_LOGOTIPO = 1024 * 1024;

export function urlPublicaDelLogo(logoPath: string | null | undefined): string | null {
  if (!logoPath) return null;
  return supabase.storage.from("branding").getPublicUrl(logoPath).data.publicUrl;
}

/** Sube el logotipo y deja la ruta en el grupo. Lanza Error con el motivo.
 *
 * La ruta es fija por organización (`<grupo_id>/logo.<ext>`): subir uno nuevo
 * reemplaza al anterior en vez de ir dejando archivos huérfanos en el bucket.
 * Ese primer folder es además la frontera que revisan las policies de Storage
 * (ver 20260923090006_branding_logotipo.sql), así que no es cosmético. */
export async function subirLogotipo(grupoId: string, archivo: File): Promise<string> {
  if (!TIPOS_LOGOTIPO.includes(archivo.type)) {
    throw new Error("El logotipo tiene que ser PNG, JPG, SVG o WebP.");
  }
  if (archivo.size > TAMANO_MAXIMO_LOGOTIPO) {
    throw new Error("El logotipo no puede pesar más de 1 MB.");
  }

  const extension = archivo.name.split(".").pop()?.toLowerCase() ?? "png";
  const ruta = `${grupoId}/logo.${extension}`;

  const { error: errSubida } = await supabase.storage
    .from("branding")
    .upload(ruta, archivo, { upsert: true, contentType: archivo.type });
  if (errSubida) throw new Error(errSubida.message);

  const { error: errGrupo } = await supabase.from("grupos").update({ logo_path: ruta }).eq("id", grupoId);
  if (errGrupo) throw new Error(errGrupo.message);

  return ruta;
}

export async function quitarLogotipo(grupoId: string): Promise<void> {
  const { error } = await supabase.from("grupos").update({ logo_path: null }).eq("id", grupoId);
  if (error) throw new Error(error.message);
}

// ── La marca en el documento ────────────────────────────────────────────
// Un cliente instala la aplicación en su teléfono desde el navegador, y lo
// que queda debajo del icono es el `name` del manifiesto. Con un manifiesto
// estático, ese nombre es el de otra empresa -- que fue justo lo que pasó con
// ARSSA el 25-sep-2026: a Aldo le aparecía "Grupo Loma". Por eso el
// manifiesto se rearma en tiempo de ejecución con la marca de quien está
// entrando, y el título de la pestaña también.

let urlManifiestoAnterior: string | null = null;

/** Deja el título y el manifiesto con la marca de la organización. */
export function aplicarMarca(nombre: string | null | undefined, logoUrl: string | null = null): void {
  if (typeof document === "undefined") return;
  const limpio = (nombre ?? "").trim() || "Acumulado";

  document.title = limpio;
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", limpio);

  const enlace = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!enlace) return;
  try {
    const blob = new Blob([JSON.stringify(manifiestoDeMarca(limpio, logoUrl))], { type: "application/manifest+json" });
    const url = URL.createObjectURL(blob);
    enlace.href = url;
    if (urlManifiestoAnterior) URL.revokeObjectURL(urlManifiestoAnterior);
    urlManifiestoAnterior = url;
  } catch {
    // Si el navegador no deja, se queda el manifiesto estático: peor nombre,
    // pero la aplicación sigue funcionando.
  }
}

// ── La marca antes de entrar ────────────────────────────────────────────
// En la pantalla de acceso todavía no hay sesión, así que la organización no
// se puede deducir del perfil. Se sabe por dos caminos: el `?org=` del link
// con el que el cliente recibió su aplicación, y el recuerdo de la última vez
// que alguien entró en este teléfono.

const CLAVE_ORG = "acumulado.organizacion";

export interface MarcaPublica {
  codigo: string;
  nombre: string;
  logo_path: string | null;
}

export function recordarOrganizacion(codigo: string | null | undefined): void {
  try {
    if (codigo) localStorage.setItem(CLAVE_ORG, codigo);
  } catch {
    // Modo privado: no es grave, solo no se recuerda.
  }
}

/** El código de organización a usar en la pantalla de acceso: primero el del
 * link (y se recuerda), si no el de la última sesión en este dispositivo. */
export function organizacionDeEntrada(busqueda: string = window.location.search): string | null {
  const delLink = new URLSearchParams(busqueda).get("org")?.trim();
  if (delLink) {
    recordarOrganizacion(delLink);
    return delLink;
  }
  try {
    return localStorage.getItem(CLAVE_ORG);
  } catch {
    return null;
  }
}

export async function marcaPublica(codigo: string): Promise<MarcaPublica | null> {
  const { data, error } = await supabase.rpc("fn_marca_publica", { p_codigo: codigo });
  if (error || !data) return null;
  return data as MarcaPublica;
}
