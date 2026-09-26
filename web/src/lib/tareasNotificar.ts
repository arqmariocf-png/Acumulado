import { supabase, urlFuncion } from "./supabase";

export type EventoTarjeta = "asignada" | "supervisor" | "corresponsables" | "comentario" | "movida";

/** Aviso push de seguimiento (edge `tareas-notificar`) al responsable,
 * supervisor, corresponsables y creador de la tarjeta. Va en segundo plano:
 * nunca detiene ni falla la acción que lo dispara. */
export function notificarTarjeta(tarjetaId: string, evento: EventoTarjeta, detalle?: string | null): void {
  void (async () => {
    try {
      const { data: sesion } = await supabase.auth.getSession();
      const token = sesion.session?.access_token;
      if (!token) return;
      await fetch(urlFuncion("tareas-notificar"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tarjetaId, evento, detalle: detalle ?? undefined }),
      });
    } catch {
      // Es un aviso; si no sale, la tarjeta ya quedó guardada.
    }
  })();
}
