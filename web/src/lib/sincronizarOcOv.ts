import { supabase } from "./supabase";

export interface ResultadoSincronizacionOcOv {
  oc_procesadas?: number;
  oc_guardadas?: number;
  ov_procesadas?: number;
  ov_guardadas?: number;
  oc_empresas_no_encontradas?: string[];
  ov_empresas_no_encontradas?: string[];
}

// Solicita la sincronización del catálogo OC/OV con el backoffice y espera a
// que termine. Corre en segundo plano (pg_cron, ver
// solicitar_sincronizacion_oc_ov): el API tarda 30-60 s y esperarlo en una
// sola petición HTTP terminaba en "HTTP request cancelled" (23-sep-2026).
// Se usa desde Carga (admin) y desde Inventario > Registrar movimiento.
export async function sincronizarCatalogoOcOv(maxEsperaMs = 4 * 60 * 1000): Promise<ResultadoSincronizacionOcOv> {
  const { data: id, error: errSolicitud } = await supabase.rpc("solicitar_sincronizacion_oc_ov");
  if (errSolicitud) throw errSolicitud;
  const inicio = Date.now();
  while (Date.now() - inicio < maxEsperaMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const { data: fila, error: errEstado } = await supabase
      .from("sincronizaciones_oc_ov")
      .select("terminada_en, resultado, error")
      .eq("id", id)
      .single();
    if (errEstado) throw errEstado;
    if (fila?.terminada_en) {
      if (fila.error) throw new Error(fila.error);
      return (fila.resultado as ResultadoSincronizacionOcOv | null) ?? {};
    }
  }
  throw new Error("La sincronización sigue corriendo en segundo plano; vuelve a intentar en unos minutos.");
}
