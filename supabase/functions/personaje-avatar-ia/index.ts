// Avatar de videojuego generado por IA (19-oct-2026, Mario: "el avatar me
// gustaría más realista" → "personaje de videojuego generado por IA").
//
// La persona (en su sesión, con consentimiento) manda su selfie; esta función
// la pasa a un servicio externo de imágenes y regresa el retrato como data URL.
// No se guarda la selfie ni el resultado: el navegador reduce el retrato y lo
// guarda en personajes.avatar como cualquier otro avatar.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   IMAGENES_IA_API_KEY   llave del servicio (obligatoria)
//   IMAGENES_IA_PROVEEDOR "openai" o "gemini" (si falta, se deduce de la llave)
//   IMAGENES_IA_MODELO    opcional (openai: gpt-image-1; gemini: gemini-2.5-flash-image)
// Límite: 5 intentos por persona por día (personajes_ia_usos).
// Helpers en línea (sin _shared).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL_SUPABASE = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_SUPABASE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const LIMITE_DIARIO = 5;

/** Ropa y accesorios del personaje según su puesto (el rol lo lee el servidor, no lo manda el navegador). */
function atuendo(rol: string): string {
  switch (rol) {
    case "admin":
      return "a commanding company director in a tailored dark suit, confident pose";
    case "direccion":
      return "a finance director in an elegant blazer holding a golden ledger";
    case "corporativo":
      return "a corporate officer in business attire holding a tablet";
    case "rh":
    case "rh_documentos":
      return "a people-and-culture officer in smart casual clothes with an ID badge lanyard";
    case "supervisor":
    case "responsable":
    case "empresa":
      return "a construction site captain wearing a white hard hat and a high-visibility vest, holding rolled blueprints";
    case "almacen":
      return "a warehouse quartermaster in a work vest with a clipboard and a barcode scanner";
    case "produccion":
      return "a steel mill blacksmith with a leather apron and safety goggles on the forehead";
    case "supervisor_bbva":
    case "bbva_mantenimiento":
      return "a building maintenance specialist in a navy technician uniform with a tool belt";
    case "administrativo":
      return "an office specialist in a neat shirt holding a tablet";
    case "directivo":
      return "a senior team leader in a sharp jacket";
    case "operativo":
      return "a skilled construction worker in work clothes, safety vest and gloves";
    default:
      return "a professional in work attire";
  }
}

function prompt(rol: string, color: string): string {
  return [
    "Turn the person in this photo into a realistic modern video game character portrait (AAA RPG style, high-quality 3D render, cinematic soft lighting).",
    "It must be clearly the SAME person: keep their exact face shape, facial features, skin tone, eyes, eyebrows, hair style and color, facial hair, glasses if any, and apparent age, so coworkers recognize them instantly.",
    `Character: ${atuendo(rol)}.`,
    "Framing: head and shoulders, facing the camera, centered, square image, friendly confident expression.",
    `Background: plain smooth solid color ${color}.`,
    "No text, no letters, no logos, no watermark, no frame.",
  ].join(" ");
}

function proveedorDe(llave: string): "openai" | "gemini" {
  const p = (Deno.env.get("IMAGENES_IA_PROVEEDOR") ?? "").toLowerCase();
  if (p === "openai" || p === "gemini") return p;
  return llave.startsWith("AIza") ? "gemini" : "openai";
}

function aBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function conOpenAi(llave: string, modelo: string, foto: string, texto: string): Promise<string> {
  const form = new FormData();
  form.append("model", modelo);
  form.append("image", new Blob([aBytes(foto)], { type: "image/jpeg" }), "selfie.jpg");
  form.append("prompt", texto);
  form.append("size", "1024x1024");
  if (modelo === "gpt-image-1") form.append("input_fidelity", "high");
  const r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${llave}` }, body: form });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${cuerpo?.error?.message ?? "sin detalle"}`);
  const b64 = cuerpo?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI no regresó imagen.");
  return `data:image/png;base64,${b64}`;
}

async function conGemini(llave: string, modelo: string, foto: string, texto: string): Promise<string> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": llave },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: foto } }, { text: texto }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${cuerpo?.error?.message ?? "sin detalle"}`);
  const partes = cuerpo?.candidates?.[0]?.content?.parts ?? [];
  for (const p of partes) {
    const d = p.inlineData ?? p.inline_data;
    if (d?.data) return `data:${d.mimeType ?? d.mime_type ?? "image/png"};base64,${d.data}`;
  }
  throw new Error("Gemini no regresó imagen (puede haberla rechazado por sus filtros; prueba otra foto).");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const token = req.headers.get("Authorization") ?? "";
    const comoUsuario = createClient(URL_SUPABASE, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: token } }, auth: { persistSession: false } });
    const { data: usuario } = await comoUsuario.auth.getUser();
    if (!usuario?.user) return json({ error: "Inicia sesión." }, 401);
    const { data: perfil } = await db.from("profiles").select("id, grupo_id, rol, activo, espectador").eq("id", usuario.user.id).single();
    if (!perfil || !perfil.activo || perfil.espectador || perfil.rol === "pendiente") return json({ error: "Tu cuenta no puede crear personaje." }, 403);
    const { data: soloConsulta } = await comoUsuario.rpc("auth_solo_consulta");
    if (soloConsulta === true) return json({ error: "Tu organización está en solo consulta." }, 403);

    const body = await req.json().catch(() => ({}));
    if (body?.consentimiento !== true) return json({ error: "Falta tu consentimiento para mandar la foto al servicio de imágenes." }, 400);
    const foto = String(body?.foto ?? "").replace(/^data:image\/jpeg;base64,/, "");
    if (!/^[A-Za-z0-9+/=]+$/.test(foto) || foto.length < 1000 || foto.length > 2_500_000) return json({ error: "La foto no es válida." }, 400);
    const color = /^#[0-9a-fA-F]{6}$/.test(String(body?.color ?? "")) ? String(body.color) : "#475569";

    const llave = Deno.env.get("IMAGENES_IA_API_KEY") ?? "";
    if (!llave) return json({ error: "Todavía no está configurado el servicio de imágenes (falta la llave IMAGENES_IA_API_KEY en Supabase)." }, 503);
    const proveedor = proveedorDe(llave);
    const modelo = Deno.env.get("IMAGENES_IA_MODELO") || (proveedor === "gemini" ? "gemini-2.5-flash-image" : "gpt-image-1");

    const desde = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" })}T06:00:00Z`).toISOString();
    const { count } = await db.from("personajes_ia_usos").select("id", { count: "exact", head: true }).eq("profile_id", perfil.id).gte("creado_en", desde);
    if ((count ?? 0) >= LIMITE_DIARIO) return json({ error: `Ya usaste tus ${LIMITE_DIARIO} intentos de hoy; mañana puedes volver a intentar.`, restantes: 0 }, 429);

    let imagen: string | null = null;
    let detalle: string | null = null;
    try {
      imagen = proveedor === "gemini" ? await conGemini(llave, modelo, foto, prompt(perfil.rol, color)) : await conOpenAi(llave, modelo, foto, prompt(perfil.rol, color));
    } catch (e) {
      detalle = (e as Error).message.slice(0, 500);
    }
    await db.from("personajes_ia_usos").insert({ grupo_id: perfil.grupo_id, profile_id: perfil.id, ok: !!imagen, proveedor, modelo, detalle });
    const restantes = Math.max(0, LIMITE_DIARIO - (count ?? 0) - 1);
    if (!imagen) return json({ error: `El servicio de imágenes no pudo crear tu personaje. ${detalle ?? ""}`.trim(), restantes }, 502);
    return json({ imagen, restantes, proveedor });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
