// Respaldo diario del sistema en Dropbox (21-oct-2026, Mario: "la biblioteca
// de archivos en Dropbox como respaldo de todo lo que hay en el sistema, para
// que puedan leerse desde otras secciones de Claude").
//
// POST { accion }
//   - "respaldar": pg_cron (disparar_respaldo_dropbox, minuto 25) con
//     x-cron-secret, o el director general con "Respaldar ahora". Cada tabla
//     de fn_respaldo_tablas() va una vez al día (hora de México) a
//     <ruta>/Tablas/<tabla>.csv si cambió; luego LEEME.md; con el tiempo que
//     sobre, los archivos nuevos o cambiados de Storage a <ruta>/Archivos/.
//     Lo que no alcance sigue en la siguiente corrida.
//   - "estado" / "conectar" / "desconectar": solo el director general. La
//     app key, el secret y el refresh token quedan en config_sistema.
//
// Helpers en línea a propósito (el _shared desplegado difiere del repo); la
// parte pura vive en ./respaldo.ts, con pruebas en _shared/respaldo/.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { aCsv, argDropbox, archivoRespaldable, hoyMexico, leemeMarkdown, nombresCsv, rutaDropbox, type Fila, type TablaIndice } from "./respaldo.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

/** Tiempo de trabajo por corrida; lo que falte sigue en la siguiente. */
const PRESUPUESTO_MS = 110_000;
const RUTA_DEFAULT = "/Respaldo Acumulado";
const CLAVES = ["dropbox_app_key", "dropbox_app_secret", "dropbox_refresh_token", "dropbox_cuenta", "dropbox_ruta_base"] as const;

type Config = Partial<Record<(typeof CLAVES)[number], string>>;

interface TablaRespaldo {
  tabla: string;
  filtro: "empresa" | "grupo" | "todas";
  llave: string | null;
  columnas: string[];
  descripcion: string | null;
}

interface Item {
  tipo: "tabla" | "archivo";
  nombre: string;
  version: string | null;
  bytes: number | null;
  renglones: number | null;
  copiado_en: string | null;
  error: string | null;
}

async function leerConfig(db: SupabaseClient): Promise<Config> {
  const { data, error } = await db.from("config_sistema").select("clave, valor").in("clave", [...CLAVES]);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.clave, r.valor])) as Config;
}

async function tokenDropbox(cfg: Config): Promise<string> {
  if (!cfg.dropbox_refresh_token || !cfg.dropbox_app_key || !cfg.dropbox_app_secret) throw new Error("Dropbox no está conectado.");
  const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.dropbox_refresh_token,
      client_id: cfg.dropbox_app_key,
      client_secret: cfg.dropbox_app_secret,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Dropbox rechazó la llave (${j.error_description ?? j.error ?? r.status}). Vuelve a conectarlo.`);
  return j.access_token as string;
}

async function subir(token: string, ruta: string, cuerpo: Uint8Array | string): Promise<void> {
  for (let intento = 0; intento < 3; intento++) {
    const r = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": argDropbox({ path: ruta, mode: "overwrite", autorename: false, mute: true }),
      },
      body: cuerpo,
    });
    if (r.ok) return;
    const texto = await r.text();
    if (r.status === 429 || r.status >= 500) {
      const espera = Number(r.headers.get("Retry-After") ?? "2");
      await new Promise((ok) => setTimeout(ok, Math.min(espera, 10) * 1000));
      continue;
    }
    throw new Error(`Dropbox ${r.status}: ${texto.slice(0, 300)}`);
  }
  throw new Error("Dropbox no respondió después de 3 intentos");
}

async function sha256(texto: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function leerTabla(db: SupabaseClient, t: TablaRespaldo, grupo: string, empresas: string[]): Promise<Fila[]> {
  const filas: Fila[] = [];
  for (let desde = 0; ; desde += 1000) {
    let q = db.from(t.tabla).select(t.columnas.join(","));
    if (t.filtro === "grupo") q = q.eq("grupo_id", grupo);
    if (t.filtro === "empresa") q = q.or(`empresa_id.is.null,empresa_id.in.(${empresas.join(",")})`);
    if (t.llave) q = q.order(t.llave);
    const { data, error } = await q.range(desde, desde + 999);
    if (error) throw new Error(error.message);
    filas.push(...((data ?? []) as unknown as Fila[]));
    if (!data || data.length < 1000) return filas;
  }
}

async function respaldar(db: SupabaseClient, origen: "cron" | "manual"): Promise<Record<string, unknown>> {
  const inicio = Date.now();
  const sobraTiempo = () => Date.now() - inicio < PRESUPUESTO_MS;
  const cfg = await leerConfig(db);
  const token = await tokenDropbox(cfg);
  const base = cfg.dropbox_ruta_base || RUTA_DEFAULT;

  const { data: g } = await db.from("grupos").select("id").eq("es_maestro", true).limit(1).single();
  const grupo = g!.id as string;
  const { data: emps } = await db.from("empresas").select("id").eq("grupo_id", grupo);
  const empresas = (emps ?? []).map((e) => e.id as string);
  const { data: corrida } = await db.from("respaldos_dropbox").insert({ grupo_id: grupo, origen }).select("id").single();

  const { data: itemsData } = await db.from("respaldo_dropbox_items").select("tipo, nombre, version, bytes, renglones, copiado_en, error").eq("grupo_id", grupo);
  const items = new Map(((itemsData ?? []) as Item[]).map((i) => [`${i.tipo}:${i.nombre}`, i]));
  const guardar = async (i: Item) => {
    items.set(`${i.tipo}:${i.nombre}`, i);
    await db.from("respaldo_dropbox_items").upsert({ grupo_id: grupo, ...i }, { onConflict: "grupo_id,tipo,nombre" });
  };

  const hoy = hoyMexico();
  const delDia = (i?: Item) => !!i?.copiado_en && !i.error && hoyMexico(new Date(i.copiado_en)) === hoy;
  let tablas = 0, renglones = 0, archivos = 0, bytes = 0, errores = 0, cambiaron = 0;
  const mensajes: string[] = [];

  // 1. Tablas, una vez al día.
  const { data: lista, error: errLista } = await db.rpc("fn_respaldo_tablas");
  if (errLista) throw errLista;
  const tablasRespaldo = (lista ?? []) as TablaRespaldo[];
  const indice: TablaIndice[] = [];
  for (const t of tablasRespaldo) {
    const previo = items.get(`tabla:${t.tabla}`);
    if (delDia(previo)) {
      indice.push({ tabla: t.tabla, renglones: previo!.renglones ?? 0, columnas: t.columnas, descripcion: t.descripcion, archivos: nombresCsv(t.tabla, Math.max(1, Math.ceil((previo!.bytes ?? 0) / 4_500_000))).map((n) => `Tablas/${n}`) });
      continue;
    }
    if (!sobraTiempo()) continue;
    try {
      const filas = await leerTabla(db, t, grupo, empresas);
      const partes = aCsv(t.columnas, filas);
      const huella = await sha256(partes.join(""));
      const nombres = nombresCsv(t.tabla, partes.length);
      const tam = partes.reduce((s, p) => s + new TextEncoder().encode(p).length, 0);
      if (huella !== previo?.version) {
        for (let i = 0; i < partes.length; i++) await subir(token, rutaDropbox(base, "Tablas", nombres[i]), partes[i]);
        cambiaron++;
        bytes += tam;
      }
      await guardar({ tipo: "tabla", nombre: t.tabla, version: huella, bytes: tam, renglones: filas.length, copiado_en: new Date().toISOString(), error: null });
      indice.push({ tabla: t.tabla, renglones: filas.length, columnas: t.columnas, descripcion: t.descripcion, archivos: nombres.map((n) => `Tablas/${n}`) });
      tablas++;
      renglones += filas.length;
    } catch (e) {
      errores++;
      mensajes.push(`${t.tabla}: ${(e as Error).message}`);
      await guardar({ tipo: "tabla", nombre: t.tabla, version: previo?.version ?? null, bytes: previo?.bytes ?? null, renglones: previo?.renglones ?? null, copiado_en: previo?.copiado_en ?? null, error: (e as Error).message.slice(0, 500) });
    }
  }
  const tablasPendientes = tablasRespaldo.length - indice.length;

  // 2. Archivos de Storage nuevos o cambiados.
  const { data: objetos, error: errObj } = await db.rpc("fn_respaldo_archivos");
  if (errObj) throw errObj;
  const candidatos = ((objetos ?? []) as { nombre: string; tam: number; actualizado: string }[]).filter((o) => archivoRespaldable(o.nombre));
  const porCopiar = candidatos.filter((o) => items.get(`archivo:${o.nombre}`)?.version !== o.actualizado);
  for (const o of porCopiar) {
    if (!sobraTiempo()) break;
    try {
      const { data: blob, error } = await db.storage.from("cargas").download(o.nombre);
      if (error || !blob) throw new Error(error?.message ?? "no se pudo leer de Storage");
      await subir(token, rutaDropbox(base, "Archivos", o.nombre), new Uint8Array(await blob.arrayBuffer()));
      await guardar({ tipo: "archivo", nombre: o.nombre, version: o.actualizado, bytes: o.tam, renglones: null, copiado_en: new Date().toISOString(), error: null });
      archivos++;
      bytes += o.tam ?? 0;
    } catch (e) {
      errores++;
      if (mensajes.length < 20) mensajes.push(`${o.nombre}: ${(e as Error).message}`);
      await guardar({ tipo: "archivo", nombre: o.nombre, version: "error", bytes: o.tam, renglones: null, copiado_en: null, error: (e as Error).message.slice(0, 500) });
    }
  }
  const copiados = candidatos.filter((o) => items.get(`archivo:${o.nombre}`)?.version === o.actualizado).length;

  // 3. Índice cuando ya están todas las tablas del día.
  const leeme = items.get("tabla:LEEME.md");
  if (tablasPendientes === 0 && (cambiaron > 0 || archivos > 0 || !delDia(leeme))) {
    const md = leemeMarkdown(indice.sort((a, b) => a.tabla.localeCompare(b.tabla)), { total: candidatos.length, copiados }, new Date());
    await subir(token, rutaDropbox(base, "LEEME.md"), md);
    await guardar({ tipo: "tabla", nombre: "LEEME.md", version: null, bytes: md.length, renglones: null, copiado_en: new Date().toISOString(), error: null });
  }

  const pendientes = tablasPendientes + (candidatos.length - copiados);
  const mensaje = mensajes.length ? mensajes.join(" · ").slice(0, 2000) : null;
  await db.from("respaldos_dropbox").update({ fin: new Date().toISOString(), tablas, renglones, archivos, bytes, pendientes, errores, mensaje }).eq("id", corrida!.id);
  return { ok: true, segundos: Math.round((Date.now() - inicio) / 1000), tablas, cambiaron, archivos, pendientes, errores };
}

async function conectar(db: SupabaseClient, cuerpo: { appKey?: string; appSecret?: string; codigo?: string; ruta?: string }) {
  const appKey = cuerpo.appKey?.trim();
  const appSecret = cuerpo.appSecret?.trim();
  const codigo = cuerpo.codigo?.trim();
  if (!appKey || !appSecret || !codigo) return json({ error: "Faltan la App key, el App secret o el código de Dropbox." }, 400);
  const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: codigo, client_id: appKey, client_secret: appSecret }),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.refresh_token) {
    return json({ error: `Dropbox no aceptó el código (${t.error_description ?? t.error ?? r.status}). El código dura unos minutos y sirve una sola vez: pide uno nuevo.` }, 400);
  }
  const cuenta = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
    method: "POST",
    headers: { Authorization: `Bearer ${t.access_token}` },
  }).then((x) => x.json()).catch(() => ({}));
  const ruta = rutaDropbox(cuerpo.ruta?.trim() || RUTA_DEFAULT);
  const filas = [
    { clave: "dropbox_app_key", valor: appKey },
    { clave: "dropbox_app_secret", valor: appSecret },
    { clave: "dropbox_refresh_token", valor: t.refresh_token as string },
    { clave: "dropbox_cuenta", valor: [cuenta?.name?.display_name, cuenta?.email].filter(Boolean).join(" · ") || "cuenta de Dropbox" },
    { clave: "dropbox_ruta_base", valor: ruta },
  ].map((f) => ({ ...f, updated_at: new Date().toISOString() }));
  const { error } = await db.from("config_sistema").upsert(filas, { onConflict: "clave" });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, cuenta: filas[3].valor, ruta });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const cuerpo = (await req.json().catch(() => ({}))) as { accion?: string; appKey?: string; appSecret?: string; codigo?: string; ruta?: string };
    const secreto = req.headers.get("x-cron-secret");
    if (secreto) {
      const { data } = await db.from("config_sistema").select("valor").eq("clave", "cron_secret").maybeSingle();
      if (!data?.valor || data.valor !== secreto) return json({ error: "No autorizado" }, 401);
      return json(await respaldar(db, "cron"));
    }
    const usuario = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await usuario.auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);
    const { data: esDirector } = await usuario.rpc("auth_admin_global");
    if (esDirector !== true) return json({ error: "Solo el director general maneja el respaldo." }, 403);

    if (cuerpo.accion === "estado") {
      const cfg = await leerConfig(db);
      return json({ conectado: !!cfg.dropbox_refresh_token, cuenta: cfg.dropbox_cuenta ?? null, ruta: cfg.dropbox_ruta_base || RUTA_DEFAULT });
    }
    if (cuerpo.accion === "conectar") return await conectar(db, cuerpo);
    if (cuerpo.accion === "desconectar") {
      const { error } = await db.from("config_sistema").delete().in("clave", [...CLAVES]);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (cuerpo.accion === "respaldar") return json(await respaldar(db, "manual"));
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
