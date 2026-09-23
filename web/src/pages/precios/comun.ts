import { supabase, urlFuncion } from "../../lib/supabase";
import type { AppRol, PuEstado, PuTipoInsumo } from "../../types/database";

// Etiquetas del circuito redactadas desde la perspectiva de quien espera, no
// desde el nombre técnico del estado: al supervisor le sirve más leer "esperando
// a almacén" que "en_revision_material".
export const ETIQUETA_ESTADO: Record<PuEstado, string> = {
  borrador: "Borrador",
  en_revision_material: "Esperando a almacén",
  material_confirmado: "Esperando autorización",
  autorizado: "Esperando publicación",
  publicado: "Publicado",
  obsoleto: "Obsoleto",
};

export const COLOR_ESTADO: Record<PuEstado, string> = {
  borrador: "bg-slate-100 text-slate-600",
  en_revision_material: "bg-amber-100 text-amber-700",
  material_confirmado: "bg-sky-100 text-sky-700",
  autorizado: "bg-indigo-100 text-indigo-700",
  publicado: "bg-emerald-100 text-emerald-700",
  obsoleto: "bg-red-100 text-red-700",
};

// Qué etapa le toca resolver a cada rol. Sirve sólo para ordenar la bandeja en
// "Me toca": el permiso real lo imponen las políticas RLS y el trigger
// validar_flujo_pu_analisis, nunca esta tabla.
export const ETAPA_DEL_ROL: Partial<Record<AppRol, PuEstado>> = {
  responsable: "borrador",
  almacen: "en_revision_material",
  direccion: "material_confirmado",
  admin: "autorizado",
  corporativo: "autorizado",
};

export const TITULO_GRUPO: Record<PuTipoInsumo, string> = {
  material: "Materiales",
  mano_obra: "Mano de obra",
  herramienta: "Herramienta y equipo",
  equipo: "Herramienta y equipo",
  auxiliar: "Básicos",
};

/** Orden de impresión de la tarjeta, igual que en el PDF. */
export const ORDEN_GRUPOS: PuTipoInsumo[] = ["material", "mano_obra", "herramienta", "equipo", "auxiliar"];

export function dinero(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function porcentaje(fraccion: number | null | undefined): string {
  return `${(Number(fraccion ?? 0) * 100).toFixed(2)}%`;
}

export function cifra(n: number | null | undefined, decimales = 4): string {
  return Number(Number(n ?? 0).toFixed(decimales)).toLocaleString("es-MX", {
    maximumFractionDigits: decimales,
  });
}

export function fechaCorta(v: string | null | undefined): string {
  if (!v) return "";
  return new Date(v).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Descarga la tarjeta en PDF de la Edge Function pu-pdf.
 *
 * Se llama con el token del usuario para que RLS decida qué puede bajar cada
 * quien: la función no reimplementa el permiso. Un supervisor que pida el id de
 * un PU de otra obra simplemente no lo encuentra.
 */
export async function descargarPdf(analisisId: string, codigo: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Tu sesión expiró, vuelve a entrar.");

  const respuesta = await fetch(`${urlFuncion("pu-pdf")}?analisis_id=${encodeURIComponent(analisisId)}&descarga=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => ({}) as { error?: string });
    throw new Error(cuerpo.error ?? `El servidor respondió ${respuesta.status}`);
  }

  const blob = await respuesta.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `PU-${codigo.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Se libera tarde a propósito: en iOS el visor todavía está leyendo el blob
  // cuando el usuario regresa a la app.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
