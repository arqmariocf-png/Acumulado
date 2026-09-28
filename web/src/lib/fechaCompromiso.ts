import { supabase } from "./supabase";

// Fecha compromiso con autorización (Mario, 28-sep-2026). La base decide:
// la primera fecha se pone libre; después, solo el jefe inmediato la cambia
// directo (trigger tarjetas_fecha_guard) y los demás la solicitan con motivo
// (fn_tarjeta_fecha_solicitar) para que el jefe la resuelva
// (fn_tarjeta_fecha_resolver). Cada cambio aprobado suma tarjetas.fecha_cambios.

export const MENSAJE_REQUIERE_AUTORIZACION = "requiere autorización";

/** Intenta el cambio directo; si la base pide autorización, crea la
 * solicitud con el motivo que se le pase (o lo pregunta). Devuelve qué pasó. */
export async function cambiarFechaOSolicitar(tarjetaId: string, nuevaFecha: string | null, pedirMotivo: () => string | null = () => window.prompt("La fecha compromiso ya está fijada. Escribe el motivo del cambio para pedir autorización a tu jefe:")): Promise<"cambiada" | "solicitada" | "cancelada"> {
  const { error } = await supabase.from("tarjetas").update({ fecha_limite: nuevaFecha }).eq("id", tarjetaId);
  if (!error) return "cambiada";
  if (!error.message.includes(MENSAJE_REQUIERE_AUTORIZACION)) throw error;
  if (!nuevaFecha) throw new Error("Para quitar la fecha compromiso pide el cambio a tu jefe.");
  const motivo = pedirMotivo();
  if (motivo === null) return "cancelada";
  const { error: errSol } = await supabase.rpc("fn_tarjeta_fecha_solicitar", { p_tarjeta_id: tarjetaId, p_fecha: nuevaFecha, p_motivo: motivo });
  if (errSol) throw errSol;
  return "solicitada";
}

export async function resolverSolicitudFecha(solicitudId: string, aprobar: boolean, comentario?: string | null): Promise<void> {
  const { error } = await supabase.rpc("fn_tarjeta_fecha_resolver", { p_solicitud_id: solicitudId, p_aprobar: aprobar, p_comentario: comentario ?? null });
  if (error) throw error;
}

export async function esJefeDeTarjeta(tarjetaId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("auth_es_jefe_de_tarjeta", { p_tarjeta_id: tarjetaId });
  if (error) return false;
  return !!data;
}
