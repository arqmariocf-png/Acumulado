import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { pixelar, recorteCentral, retocarRetrato, type HojaPersonaje } from "../../lib/personaje";

export interface MiAvatar {
  avatar: string;
  titulo: string | null;
}

export interface MiembroEquipo {
  profile_id: string;
  nombre: string;
  rol: string;
  avatar: string | null;
  titulo: string | null;
  xp: number;
  racha: number;
  hechas_hoy: number;
  pendientes_hoy: number;
  vencidas: number;
}

export function useMiAvatar() {
  const { perfilReal } = useAuth();
  const id = perfilReal?.id;
  return useQuery({
    queryKey: ["mi-avatar", id],
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("personajes").select("avatar, titulo").eq("profile_id", id!).maybeSingle();
      if (error) throw error;
      return (data as MiAvatar | null) ?? null;
    },
  });
}

export function useMiPersonaje() {
  const { perfilReal } = useAuth();
  return useQuery({
    queryKey: ["mi-personaje", perfilReal?.id],
    enabled: !!perfilReal?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_mi_personaje");
      if (error) throw error;
      return (data as HojaPersonaje | null) ?? null;
    },
  });
}

export function useEquipo(activo: boolean) {
  return useQuery({
    queryKey: ["equipo-personajes"],
    enabled: activo,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_equipo_personajes");
      if (error) throw error;
      return (data ?? []) as MiembroEquipo[];
    },
  });
}

function cargarImagen(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la foto."));
    };
    img.src = url;
  });
}

/** La selfie se vuelve pixel-art aquí mismo, en el teléfono: la foto nunca
 * sale del dispositivo; solo se guarda el PNG chico que resulta. */
export type EstiloAvatar = "realista" | "pixel" | "ia";

/** Lado del retrato realista: nítido en la tarjeta (128 px) y en pantallas
 * de alta densidad sin pasar de los 60 KB que acepta la base. */
const LADO_REALISTA = 192;

export async function generarAvatar(foto: Blob, lado: number, zoom: number, estilo: EstiloAvatar = "realista"): Promise<string> {
  const img = await cargarImagen(foto);
  const r = recorteCentral(img.naturalWidth, img.naturalHeight, zoom);
  const n = estilo === "realista" ? LADO_REALISTA : lado;
  const lienzo = document.createElement("canvas");
  lienzo.width = n;
  lienzo.height = n;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("Este navegador no puede procesar la imagen.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Como espejo, igual que se ve en la cámara frontal.
  ctx.translate(n, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, r.x, r.y, r.lado, r.lado, 0, 0, n, n);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const datos = ctx.getImageData(0, 0, n, n);
  const pix = estilo === "realista" ? retocarRetrato(datos.data, n) : pixelar(datos.data, n);
  ctx.clearRect(0, 0, n, n);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pix), n, n), 0, 0);
  if (estilo === "pixel") return lienzo.toDataURL("image/png");
  return jpegQueCabe(lienzo);
}

/** JPEG: un retrato en PNG pesa demasiado; baja la calidad hasta caber en 60 KB. */
function jpegQueCabe(lienzo: HTMLCanvasElement): string {
  for (const calidad of [0.86, 0.78, 0.68, 0.58]) {
    const url = lienzo.toDataURL("image/jpeg", calidad);
    if (url.startsWith("data:image/jpeg") && url.length <= 60000) return url;
  }
  throw new Error("No se pudo preparar el retrato en este navegador; prueba el estilo videojuego.");
}

/** Selfie recortada (768 px, como espejo) para mandarla al servicio de imágenes. */
async function selfieParaIa(foto: Blob, zoom: number): Promise<string> {
  const img = await cargarImagen(foto);
  const r = recorteCentral(img.naturalWidth, img.naturalHeight, zoom);
  const n = 768;
  const lienzo = document.createElement("canvas");
  lienzo.width = n;
  lienzo.height = n;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("Este navegador no puede procesar la imagen.");
  ctx.imageSmoothingQuality = "high";
  ctx.translate(n, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, r.x, r.y, r.lado, r.lado, 0, 0, n, n);
  return lienzo.toDataURL("image/jpeg", 0.88);
}

/** Personaje de videojuego generado por IA (19-oct-2026): la selfie va a la
 * edge personaje-avatar-ia (servicio externo, con consentimiento) y el retrato
 * que regresa se reduce aquí a 192 px para guardarlo como cualquier avatar. */
export async function generarAvatarIa(foto: Blob, zoom: number, color: string): Promise<{ avatar: string; restantes: number | null }> {
  const selfie = await selfieParaIa(foto, zoom);
  const { data, error } = await supabase.functions.invoke("personaje-avatar-ia", { body: { foto: selfie, color, consentimiento: true } });
  if (error) {
    const detalle = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(detalle?.error ?? error.message);
  }
  const resultado = data as { imagen: string; restantes?: number };
  const img = await new Promise<HTMLImageElement>((ok, mal) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => mal(new Error("No se pudo leer el retrato que regresó el servicio."));
    i.src = resultado.imagen;
  });
  const n = LADO_REALISTA;
  const lienzo = document.createElement("canvas");
  lienzo.width = n;
  lienzo.height = n;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("Este navegador no puede procesar la imagen.");
  ctx.imageSmoothingQuality = "high";
  const lado = Math.min(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, n, n);
  return { avatar: jpegQueCabe(lienzo), restantes: resultado.restantes ?? null };
}
