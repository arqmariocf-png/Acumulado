// Aviso push de seguimiento de una tarjeta (Mario, 26-sep-2026): cuando a
// alguien lo asignan, lo ponen de supervisor o corresponsable, comentan la
// tarjeta o la mueven de columna, se avisa al responsable principal, al
// supervisor a cargo, a los corresponsables y a quien la creó (menos a quien
// hizo el cambio). Nunca falla la acción por un push fallido: el frontend lo
// llama en segundo plano después de guardar.
//
// POST JSON: { tarjetaId, evento: 'asignada'|'supervisor'|'corresponsables'|
//   'comentario'|'movida', detalle?: string }
// Quién puede avisar: quien pueda leer la tarjeta según RLS (misma regla que
// para comentarla).

import webpush from "npm:web-push@3.6.7";
import { respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";

const EVENTOS = ["asignada", "supervisor", "corresponsables", "comentario", "movida"] as const;
type Evento = (typeof EVENTOS)[number];

function textoDe(evento: Evento, actor: string, titulo: string, detalle: string | null): { titulo: string; cuerpo: string } {
  switch (evento) {
    case "asignada":
      return { titulo: "Te asignaron una tarea", cuerpo: `${actor}: ${titulo}` };
    case "supervisor":
      return { titulo: "Quedaste como supervisor de una tarea", cuerpo: `${actor}: ${titulo}` };
    case "corresponsables":
      return { titulo: "Cambiaron los corresponsables de una tarea", cuerpo: `${actor}: ${titulo}` };
    case "comentario":
      return { titulo: `Comentario en "${titulo}"`, cuerpo: `${actor}: ${detalle ?? ""}`.slice(0, 160) };
    case "movida":
      return { titulo: `Avance en "${titulo}"`, cuerpo: `${actor} la movió a ${detalle ?? "otra etapa"}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();
  if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);

  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);

    const body = (await req.json().catch(() => ({}))) as { tarjetaId?: string; evento?: string; detalle?: string };
    const tarjetaId = String(body.tarjetaId ?? "");
    const evento = body.evento as Evento;
    if (!tarjetaId || !EVENTOS.includes(evento)) return jsonResponse({ error: "Faltan tarjetaId o evento" }, 400);
    const detalle = body.detalle ? String(body.detalle).slice(0, 300) : null;

    // RLS con el JWT de quien llama: si no ve la tarjeta, no avisa a nadie.
    const { data: visible } = await clienteComoUsuario(req).from("tarjetas").select("id").eq("id", tarjetaId).maybeSingle();
    if (!visible) return jsonResponse({ error: "Tarjeta no encontrada" }, 404);

    const dbServicio = clienteServicio();
    const { data: t } = await dbServicio
      .from("tarjetas")
      .select("id, titulo, tablero_id, asignado_a, supervisor_id, corresponsables, creado_por")
      .eq("id", tarjetaId)
      .single();
    if (!t) return jsonResponse({ error: "Tarjeta no encontrada" }, 404);

    const destinatarios = new Set<string>([t.asignado_a, t.supervisor_id, t.creado_por, ...((t.corresponsables as string[] | null) ?? [])].filter((x): x is string => !!x));
    destinatarios.delete(perfil.id);
    if (destinatarios.size === 0) return jsonResponse({ avisados: 0, enviados: 0 });

    const { data: config } = await dbServicio.from("config_sistema").select("clave, valor").in("clave", ["vapid_public_key", "vapid_private_key", "vapid_subject"]);
    const cfg = Object.fromEntries((config ?? []).map((f: { clave: string; valor: string }) => [f.clave, f.valor]));
    if (!cfg.vapid_public_key || !cfg.vapid_private_key || !cfg.vapid_subject) return jsonResponse({ avisados: destinatarios.size, enviados: 0, aviso: "Sin llaves VAPID" });
    webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public_key, cfg.vapid_private_key);

    const texto = textoDe(evento, perfil.nombre ?? "Alguien", t.titulo, detalle);
    const payload = JSON.stringify({ ...texto, url: `/tareas/${t.tablero_id}` });

    const { data: subs } = await dbServicio.from("push_subscripciones").select("id, endpoint, p256dh, auth").in("profile_id", [...destinatarios]);
    let enviados = 0;
    const borrar: string[] = [];
    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        enviados++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) borrar.push(sub.id);
      }
    }
    if (borrar.length > 0) await dbServicio.from("push_subscripciones").delete().in("id", borrar);

    return jsonResponse({ avisados: destinatarios.size, enviados });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
