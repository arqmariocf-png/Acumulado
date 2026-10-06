// Manda un push de "tienes tareas para hoy" a cada persona con tarjetas
// (del módulo Tareas) que vencen hoy. Pensado para dispararse una vez al
// día desde un cron job de Postgres (pg_cron + pg_net), nunca desde el
// navegador -- por eso no valida un JWT de Supabase (verify_jwt=false) y en
// su lugar exige un secreto propio en el header `x-cron-secret`, guardado
// en config_sistema (ver supabase/migrations/20260909100000_push_y_
// checador.sql -- no hay forma de fijar "secrets" de edge function desde
// este entorno).
//
// Además escala el semáforo (6-oct-2026): tarjetas que entran en amarillo
// (vencen en 3 días o menos) → jefe inmediato; vencidas (rojo) → RH. Una vez
// por tarjeta, nivel y fecha límite (fn_tarjetas_escalamientos).
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
  supervisor_id: string | null;
  corresponsables: string[] | null;
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
      .select("id, titulo, tablero_id, asignado_a, supervisor_id, corresponsables, creado_por")
      .eq("archivada", false)
      .eq("fecha_limite", hoyIso);
    if (errTarjetas) throw new Error(errTarjetas.message);

    const porPersona = new Map<string, TarjetaHoy[]>();
    for (const t of (tarjetas ?? []) as TarjetaHoy[]) {
      // Principal (o quien la creó), supervisor a cargo y corresponsables:
      // todos reciben el aviso, una sola vez cada uno.
      const destinatarios = new Set<string>([t.asignado_a ?? t.creado_por, ...(t.supervisor_id ? [t.supervisor_id] : []), ...(t.corresponsables ?? [])]);
      for (const destinatario of destinatarios) {
        const lista = porPersona.get(destinatario) ?? [];
        lista.push(t);
        porPersona.set(destinatario, lista);
      }
    }

    let enviados = 0;
    let fallidos = 0;
    const suscripcionesABorrar: string[] = [];

    async function enviar(profileId: string, payload: string): Promise<void> {
      const { data: subs, error: errSubs } = await dbServicio
        .from("push_subscripciones")
        .select("id, endpoint, p256dh, auth")
        .eq("profile_id", profileId);
      if (errSubs || !subs || subs.length === 0) return;
      for (const sub of subs) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
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

    for (const [profileId, tarjetasPersona] of porPersona) {
      const titulos = tarjetasPersona.map((t) => t.titulo);
      const cuerpo =
        titulos.length <= 3
          ? titulos.join(" · ")
          : `${titulos.slice(0, 3).join(" · ")} y ${titulos.length - 3} más`;
      // Una tarjeta → se abre ella misma; varias → su lista en "Mis actividades".
      const url = tarjetasPersona.length === 1 ? `/tareas/${tarjetasPersona[0].tablero_id}?tarjeta=${tarjetasPersona[0].id}` : "/tareas#mis-actividades";
      await enviar(
        profileId,
        JSON.stringify({ titulo: `Tienes ${tarjetasPersona.length} tarea${tarjetasPersona.length > 1 ? "s" : ""} para hoy`, cuerpo, url }),
      );
    }

    // Escalamiento del semáforo: un aviso por persona y nivel con sus tareas.
    const { data: escalar, error: errEsc } = await dbServicio.rpc("fn_tarjetas_escalamientos");
    if (errEsc) throw new Error(`Escalamiento: ${errEsc.message}`);
    interface Escalada { tarjeta_id: string; tablero_id: string; titulo: string; nivel: "amarillo" | "rojo"; fecha_limite: string; responsable: string | null; destinatarios: string[] }
    const porDestino = new Map<string, Escalada[]>();
    for (const e of (escalar ?? []) as Escalada[]) {
      for (const d of e.destinatarios ?? []) {
        const k = `${d}|${e.nivel}`;
        porDestino.set(k, [...(porDestino.get(k) ?? []), e]);
      }
    }
    for (const [k, lista] of porDestino) {
      const [profileId, nivel] = k.split("|");
      const rojo = nivel === "rojo";
      const linea = (e: Escalada) => `${e.titulo}${e.responsable ? ` (${e.responsable})` : ""}`;
      const cuerpo = lista.length <= 3 ? lista.map(linea).join(" · ") : `${lista.slice(0, 3).map(linea).join(" · ")} y ${lista.length - 3} más`;
      const url = lista.length === 1 ? `/tareas/${lista[0].tablero_id}?tarjeta=${lista[0].tarjeta_id}` : rojo ? "/tareas?ver=tareas_vencidas" : "/tareas#mis-actividades";
      await enviar(
        profileId,
        JSON.stringify({
          titulo: rojo
            ? `${lista.length} tarea${lista.length > 1 ? "s" : ""} vencida${lista.length > 1 ? "s" : ""} (RH)`
            : `${lista.length} tarea${lista.length > 1 ? "s" : ""} de tu equipo por vencer`,
          cuerpo,
          url,
        }),
      );
    }

    if (suscripcionesABorrar.length > 0) {
      await dbServicio.from("push_subscripciones").delete().in("id", suscripcionesABorrar);
    }

    return jsonResponse({ personas: porPersona.size, escalamientos: (escalar ?? []).length, enviados, fallidos, suscripcionesLimpiadas: suscripcionesABorrar.length });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
