import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { ResumenSocio } from "./kpisEmpresa";

/** Resumen de socio: organizaciones → empresas → KPIs por empresa, en una
 * sola llamada (fn_socio_resumen, solo admin). Lo usan la pantalla de socio y
 * el organigrama cuando se filtra por empresa. */
export function useResumenSocio(habilitado = true) {
  return useQuery({
    queryKey: ["socio-resumen"],
    enabled: habilitado,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_socio_resumen");
      if (error) throw new Error(error.message);
      return data as ResumenSocio;
    },
  });
}

export interface SocioPropio {
  grupo_id: string;
  inicio: boolean;
}

/** Organizaciones donde la persona es socio (RLS: solo sus filas). Vacío si
 * no es socio. El admin no lo necesita: entra a la vista de socio siempre. */
export function useEsSocio(profileId: string | undefined) {
  return useQuery({
    queryKey: ["socio-propio", profileId],
    enabled: !!profileId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("socios_organizacion").select("grupo_id, inicio").eq("profile_id", profileId!);
      if (error) throw new Error(error.message);
      return (data ?? []) as SocioPropio[];
    },
  });
}

export interface GrupoAdmin {
  id: string;
  codigo: string;
  nombre: string;
  marca_comercial: string | null;
  es_maestro: boolean;
}

export interface SocioAdmin {
  profile_id: string;
  nombre: string | null;
  rol: string;
  grupo_id: string;
  grupo_nombre: string;
  grupo_codigo: string;
  inicio: boolean;
  created_at: string;
}

/** Listado de organizaciones y socios para administrarlos (solo admin). */
export function useSociosAdmin(habilitado: boolean) {
  return useQuery({
    queryKey: ["socios-admin"],
    enabled: habilitado,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_socios_listar");
      if (error) throw new Error(error.message);
      return data as { grupos: GrupoAdmin[]; socios: SocioAdmin[] };
    },
  });
}
