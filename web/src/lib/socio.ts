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
