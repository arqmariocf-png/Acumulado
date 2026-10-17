// Mensaje de la semana de Mario (17-oct-2026): agradecimiento que Mario elige
// cada semana y sale el sábado a la 1 p. m. por notificación a todas las
// personas de su organización con push activado. Helpers en línea (sin
// _shared) para no depender de lo desplegado en otras funciones.
//
// Modos (body { modo }):
//   - "recordatorio" (pg_cron, x-cron-secret): si el mensaje del sábado
//     todavía no está elegido, avisa al director general.
//   - "enviar" (pg_cron, x-cron-secret): sábado 13:00 → manda el mensaje del
//     día a todos; si no hay, avisa al director general que no salió.
//   - "prueba" (sesión del director general, { texto }): se lo manda solo a él.
//   - "enviar_ahora" (sesión del director general, { fecha }): manda ya el
//     mensaje programado de ese sábado.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL_SUPABASE = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_SUPABASE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

/** Fecha de hoy en México (AAAA-MM-DD). */
const hoyMx = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
/** Hoy si es sábado; si no, el siguiente sábado. */
function proximoSabado(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

interface Sub { id: string; profile_id: string; endpoint: string; p256dh: string; auth: string }

async function enviarA(profileIds: string[], payload: { titulo: string; cuerpo: string; url: string }) {
  let enviados = 0;
  let fallidos = 0;
  const personas = new Set<string>();
  if (!profileIds.length) return { enviados, fallidos, personas: 0 };
  const { data: subs, error } = await db.from("push_subscripciones").select("id, profile_id, endpoint, p256dh, auth").in("profile_id", profileIds);
  if (error) throw new Error(error.message);
  const borrar: string[] = [];
  for (const s of (subs ?? []) as Sub[]) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
      enviados++;
      personas.add(s.profile_id);
    } catch (err) {
      fallidos++;
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) borrar.push(s.id);
    }
  }
  if (borrar.length) await db.from("push_subscripciones").delete().in("id", borrar);
  return { enviados, fallidos, personas: personas.size };
}

async function grupoMaestro(): Promise<string> {
  const { data, error } = await db.from("grupos").select("id").eq("es_maestro", true).limit(1).single();
  if (error || !data) throw new Error("No se encontró la organización maestra");
  return data.id as string;
}

async function directoresGenerales(grupoId: string): Promise<string[]> {
  const { data } = await db.from("profiles").select("id").eq("grupo_id", grupoId).eq("rol", "admin").eq("activo", true).eq("espectador", false);
  return (data ?? []).map((p) => p.id as string);
}

async function personasDelGrupo(grupoId: string): Promise<string[]> {
  const { data, error } = await db.from("profiles").select("id").eq("grupo_id", grupoId).eq("activo", true).eq("espectador", false).neq("rol", "pendiente");
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => p.id as string);
}

async function enviarMensaje(grupoId: string, fecha: string) {
  const { data: m } = await db.from("mensajes_semana").select("*").eq("grupo_id", grupoId).eq("fecha", fecha).maybeSingle();
  if (!m) return { enviado: false, motivo: "sin_mensaje" };
  if (m.enviado_en) return { enviado: false, motivo: "ya_enviado" };
  // Se marca antes de mandar para que dos corridas no lo dupliquen.
  const { data: tomado } = await db.from("mensajes_semana").update({ enviado_en: new Date().toISOString() }).eq("id", m.id).is("enviado_en", null).select("id");
  if (!tomado?.length) return { enviado: false, motivo: "ya_enviado" };
  const r = await enviarA(await personasDelGrupo(grupoId), { titulo: m.titulo, cuerpo: m.texto, url: "/" });
  await db.from("mensajes_semana").update({ enviados: r.personas, fallidos: r.fallidos }).eq("id", m.id);
  return { enviado: true, ...r };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { data: conf } = await db.from("config_sistema").select("clave, valor").in("clave", ["cron_secret", "vapid_public_key", "vapid_private_key", "vapid_subject"]);
    const config = Object.fromEntries((conf ?? []).map((f) => [f.clave, f.valor])) as Record<string, string>;
    if (!config.vapid_public_key || !config.vapid_private_key || !config.vapid_subject) return json({ error: "Faltan llaves VAPID en config_sistema" }, 500);
    webpush.setVapidDetails(config.vapid_subject, config.vapid_public_key, config.vapid_private_key);

    const cuerpo = (await req.json().catch(() => ({}))) as { modo?: string; texto?: string; fecha?: string };
    const porCron = !!config.cron_secret && req.headers.get("x-cron-secret") === config.cron_secret;

    if (porCron) {
      const grupo = await grupoMaestro();
      const sabado = proximoSabado(hoyMx());
      if (cuerpo.modo === "recordatorio") {
        const { data: m } = await db.from("mensajes_semana").select("id").eq("grupo_id", grupo).eq("fecha", sabado).maybeSingle();
        if (m) return json({ recordatorio: false, motivo: "ya_elegido" });
        const r = await enviarA(await directoresGenerales(grupo), {
          titulo: "Elige el agradecimiento de la semana",
          cuerpo: "El sábado a la 1 p. m. sale tu mensaje a todo el equipo. Toca para elegir la frase.",
          url: "/admin/mensaje-semana",
        });
        return json({ recordatorio: true, ...r });
      }
      if (cuerpo.modo === "enviar") {
        const r = await enviarMensaje(grupo, hoyMx());
        if (!r.enviado && r.motivo === "sin_mensaje") {
          await enviarA(await directoresGenerales(grupo), {
            titulo: "No salió el mensaje de la semana",
            cuerpo: "No había frase elegida para hoy. Puedes elegirla y mandarla ahora.",
            url: "/admin/mensaje-semana",
          });
        }
        return json(r);
      }
      return json({ error: "Modo no válido" }, 400);
    }

    // Desde la pantalla: solo el director general.
    const token = req.headers.get("Authorization") ?? "";
    const comoUsuario = createClient(URL_SUPABASE, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: token } }, auth: { persistSession: false } });
    const { data: usuario } = await comoUsuario.auth.getUser();
    const { data: esDirector } = await comoUsuario.rpc("auth_admin_global");
    if (!usuario?.user || esDirector !== true) return json({ error: "Solo el director general." }, 403);

    if (cuerpo.modo === "prueba") {
      const texto = (cuerpo.texto ?? "").trim();
      if (!texto) return json({ error: "Escribe el mensaje." }, 400);
      const r = await enviarA([usuario.user.id], { titulo: "Mensaje de Mario (prueba)", cuerpo: texto, url: "/admin/mensaje-semana" });
      if (!r.enviados) return json({ error: "Tu dispositivo no tiene notificaciones activadas." }, 400);
      return json(r);
    }
    if (cuerpo.modo === "enviar_ahora") {
      if (!cuerpo.fecha) return json({ error: "Falta la fecha." }, 400);
      const { data: perfil } = await db.from("profiles").select("grupo_id").eq("id", usuario.user.id).single();
      const r = await enviarMensaje(perfil!.grupo_id as string, cuerpo.fecha);
      if (!r.enviado) return json({ error: r.motivo === "ya_enviado" ? "Ese mensaje ya se envió." : "No hay mensaje programado para ese sábado." }, 400);
      return json(r);
    }
    return json({ error: "Modo no válido" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
