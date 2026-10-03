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
// Se usa desde Carga (admin), Inventario > Registrar movimiento y Finanzas >
// Programación de pagos. Desde el 29-sep-2026 la función descarga primero y
// escribe al final solo lo que cambió, así que ya no bloquea las OC mientras
// espera al backoffice.
/** Texto para la pantalla: desde el 29-sep-2026 "guardadas" son solo las
 * filas que cambiaron, así que se dice cuántas se revisaron y cuántas
 * cambiaron. */
export function textoResultadoSincronizacion(res: ResultadoSincronizacionOcOv): string {
  const cambios = (res.oc_guardadas ?? 0) + (res.ov_guardadas ?? 0);
  return `Catálogo al día: ${res.oc_procesadas ?? 0} OC/OS y ${res.ov_procesadas ?? 0} OV revisadas del backoffice (autorizadas y también las pendientes de autorizar, que se autorizan aquí en “Por autorizar”); ${cambios === 0 ? "sin cambios" : `${cambios} con cambios`}.`;
}

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
