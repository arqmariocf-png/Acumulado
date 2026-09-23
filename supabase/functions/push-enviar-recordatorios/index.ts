// Manda un push de "tienes tareas para hoy" a cada persona con tarjetas
// (del módulo Tareas) que vencen hoy. Pensado para dispararse una vez al
// día desde un cron job de Postgres (pg_cron + pg_net), nunca desde el
// navegador -- por eso no valida un JWT de Supabase (verify_jwt=false) y en
// su lugar exige un secreto propio en el header `x-cron-secret`, guardado
// en config_sistema (ver supabase/migrations/20260909100000_push_y_
// checador.sql -- no hay forma de fijar "secrets" de edge function desde
// este entorno).
//
// POST (sin body), header: x-cron-secret: <el secreto>

import webpush from "npm:web-push@3.6.7";
import { corsHeaders, respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteServicio } from "../_shared/supabase-clients.ts";

async function leerConfig(dbServicio: ReturnType<typeof clienteServicio>): Promise<Record<string, string>> {
  const { data, error } = await dbServicio.from("config_sistema").select("clave, valor");
  if (error) throw new Error(`No se pudo leer config_sistema: ${error.message}`);
  return Object.fromEntries((data ?? []).map((f) => [f.clave, f.valor]));
}

interface TarjetaHoy {
  id: string;
  titulo: string;
  tablero_id: string;
  asignado_a: string | null;
  creado_por: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const dbServicio = clienteServicio();
    const config = await leerConfig(dbServicio);

    const secretoEsperado = config.cron_secret;
    const secretoRecibido = req.headers.get("x-cron-secret");
    if (!secretoEsperado || secretoRecibido !== secretoEsperado) {
      return jsonResponse({ error: "No autorizado" }, 401);
    }

    if (!config.vapid_public_key || !config.vapid_private_key || !config.vapid_subject) {
      return jsonResponse({ error: "Faltan llaves VAPID en config_sistema" }, 500);
    }

    webpush.setVapidDetails(config.vapid_subject, config.vapid_public_key, config.vapid_private_key);

    const hoyIso = new Date().toISOString().slice(0, 10);

    const { data: tarjetas, error: errTarjetas } = await dbServicio
      .from("tarjetas")
      .select("id, titulo, tablero_id, asignado_a, creado_por")
      .eq("archivada", false)
      .eq("fecha_limite", hoyIso);
    if (errTarjetas) throw new Error(errTarjetas.message);

    const porPersona = new Map<string, TarjetaHoy[]>();
    for (const t of (tarjetas ?? []) as TarjetaHoy[]) {
      const destinatario = t.asignado_a ?? t.creado_por;
      const lista = porPersona.get(destinatario) ?? [];
      lista.push(t);
      porPersona.set(destinatario, lista);
    }

    let enviados = 0;
    let fallidos = 0;
    const suscripcionesABorrar: string[] = [];

    for (const [profileId, tarjetasPersona] of porPersona) {
      const { data: subs, error: errSubs } = await dbServicio
        .from("push_subscripciones")
        .select("id, endpoint, p256dh, auth")
        .eq("profile_id", profileId);
      if (errSubs || !subs || subs.length === 0) continue;

      const titulos = tarjetasPersona.map((t) => t.titulo);
      const cuerpo =
        titulos.length <= 3
          ? titulos.join(" · ")
          : `${titulos.slice(0, 3).join(" · ")} y ${titulos.length - 3} más`;
      const url = tarjetasPersona.length === 1 ? `/tareas/${tarjetasPersona[0].tablero_id}` : "/tareas";
      const payload = JSON.stringify({
        titulo: `Tienes ${tarjetasPersona.length} tarea${tarjetasPersona.length > 1 ? "s" : ""} para hoy`,
        cuerpo,
        url,
      });

      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
          enviados++;
        } catch (err) {
          fallidos++;
          const status = (err as { statusCode?: number }).statusCode;
          // 404/410: el navegador invalidó esa suscripción (desinstaló la
          // app, borró datos, etc.) -- ya no sirve, se limpia.
          if (status === 404 || status === 410) suscripcionesABorrar.push(sub.id);
        }
      }
    }

    if (suscripcionesABorrar.length > 0) {
      await dbServicio.from("push_subscripciones").delete().in("id", suscripcionesABorrar);
    }

    return jsonResponse({ personas: porPersona.size, enviados, fallidos, suscripcionesLimpiadas: suscripcionesABorrar.length });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
