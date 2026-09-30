import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";

export interface ConfigComedor {
  grupo_id: string;
  empresa_id: string;
  hora_limite: string;
  notas: string | null;
}

export function hoyMx(desplazarDias = 0): string {
  const d = new Date(Date.now() - 6 * 3600 * 1000 + desplazarDias * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

export function useConfigComedor() {
  return useQuery({
    queryKey: ["comedor", "config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("comedor_config").select("grupo_id, empresa_id, hora_limite, notas").maybeSingle();
      if (error) throw error;
      return data as ConfigComedor | null;
    },
  });
}

/** Qué puede hacer cada quien (la base lo vuelve a revisar). */
export function usePermisosComedor() {
  return useQuery({
    queryKey: ["comedor", "permisos"],
    queryFn: async () => {
      const [cocina, nomina] = await Promise.all([supabase.rpc("auth_opera_comedor"), supabase.rpc("auth_ve_nomina_comedor")]);
      return { cocina: cocina.data === true, nomina: nomina.data === true };
    },
  });
}

export function mensajeError(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  return m.replace(/^.*?ERROR:\s*/, "");
}
