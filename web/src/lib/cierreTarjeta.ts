import { supabase } from "./supabase";

// Candado para terminar tareas (Mario, 5-nov-2026: "mover las tarjetas de en
// proceso a hecho únicamente con autorización de su jefe directo"). La base
// decide (trigger tarjetas_cierre_guard): a la última columna del tablero
// (Hecho) pasan directo el jefe inmediato o quien asignó la tarea a otra
// persona; los demás piden terminarla con una nota
// (fn_tarjeta_terminar_solicitar) y el jefe la autoriza o rechaza
// (fn_tarjeta_terminar_resolver). Mismo molde que la fecha compromiso.

import { esErrorDeCandado, type CierrePendiente } from "./cierreTarjetaReglas";

export * from "./cierreTarjetaReglas";

export type ResultadoMover = "movida" | "solicitada" | "cancelada";

/** Intenta mover la tarjeta; si la base pide autorización para terminarla,
 * crea la solicitud con la nota que se le pase (o la pregunta). */
export async function moverOSolicitarCierre(
  tarjetaId: string,
  cambios: { columna_id: string; orden?: number },
  pedirNota: () => string | null = () => window.prompt("Dar por terminada esta tarea requiere autorización de tu jefe. Escribe una nota de lo que hiciste (opcional) para pedirla:", ""),
): Promise<ResultadoMover> {
  const { error } = await supabase.from("tarjetas").update(cambios).eq("id", tarjetaId);
  if (!error) return "movida";
  if (!esErrorDeCandado(error.message)) throw error;
  const nota = pedirNota();
  if (nota === null) return "cancelada";
  const { error: errSol } = await supabase.rpc("fn_tarjeta_terminar_solicitar", { p_tarjeta_id: tarjetaId, p_nota: nota || null });
  if (errSol) throw errSol;
  return "solicitada";
}

export async function solicitarCierre(tarjetaId: string, nota: string | null): Promise<void> {
  const { error } = await supabase.rpc("fn_tarjeta_terminar_solicitar", { p_tarjeta_id: tarjetaId, p_nota: nota || null });
  if (error) throw error;
}

export async function resolverCierre(solicitudId: string, aprobar: boolean, comentario?: string | null): Promise<void> {
  const { error } = await supabase.rpc("fn_tarjeta_terminar_resolver", { p_solicitud_id: solicitudId, p_aprobar: aprobar, p_comentario: comentario ?? null });
  if (error) throw error;
}

export async function puedeCerrarTarjeta(tarjetaId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("auth_puede_cerrar_tarjeta", { p_tarjeta_id: tarjetaId });
  if (error) return false;
  return !!data;
}

/** Lo que la persona tiene por autorizar (como jefe) y lo que pidió y espera. */
export async function cierresPendientes(): Promise<CierrePendiente[]> {
  const { data, error } = await supabase.rpc("fn_tarjeta_cierres_pendientes");
  if (error) throw error;
  return (data ?? []) as CierrePendiente[];
}
