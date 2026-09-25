import { supabase } from "./supabase";

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
