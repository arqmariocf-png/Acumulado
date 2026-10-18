import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { pixelar, recorteCentral, type HojaPersonaje } from "../../lib/personaje";

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
export async function generarAvatar(foto: Blob, lado: number, zoom: number): Promise<string> {
  const img = await cargarImagen(foto);
  const r = recorteCentral(img.naturalWidth, img.naturalHeight, zoom);
  const lienzo = document.createElement("canvas");
  lienzo.width = lado;
  lienzo.height = lado;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("Este navegador no puede procesar la imagen.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Como espejo, igual que se ve en la cámara frontal.
  ctx.translate(lado, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, r.x, r.y, r.lado, r.lado, 0, 0, lado, lado);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const datos = ctx.getImageData(0, 0, lado, lado);
  const pix = pixelar(datos.data, lado);
  ctx.clearRect(0, 0, lado, lado);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pix), lado, lado), 0, 0);
  return lienzo.toDataURL("image/png");
}
