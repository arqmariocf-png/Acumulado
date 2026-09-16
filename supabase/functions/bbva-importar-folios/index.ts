// Carga del maestro de folios BBVA (mantenimiento Puebla-Tlaxcala): recibe
// el Excel, calcula los agregados del dashboard (ver _shared/bbva-folios.ts)
// y los guarda como un snapshot nuevo -- cada subida es un "corte" nuevo,
// nunca se sobreescribe uno anterior, así queda el histórico para comparar.
//
// POST multipart/form-data: file
// -> { ok: true, id, fecha_corte, kpi }

import { clienteComoUsuario, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";
import { procesarLibroFoliosBbva } from "../_shared/bbva-folios.ts";

const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    // Mismo criterio que la policy bbva_mantenimiento_insert -- se valida
    // aquí también para poder devolver un mensaje claro en vez de que la
    // RLS lo rechace en silencio con un 42501 genérico.
    if (perfil.rol !== "admin" && perfil.rol !== "corporativo" && !perfil.bbvaMantenimiento) {
      return jsonResponse({ error: "Sin permiso para cargar el maestro de folios BBVA" }, 403);
    }

    const form = await req.formData();
    const archivo = form.get("file") as File | null;
    if (!archivo) return jsonResponse({ error: "file es requerido" }, 400);
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return jsonResponse({ error: `El archivo excede el tamaño máximo permitido (${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB)` }, 400);
    }

    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const cliente = clienteComoUsuario(req);

    const fechaCorte = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

    const { data: anterior } = await cliente
      .from("bbva_mantenimiento_snapshots")
      .select("datos")
      .order("creado_en", { ascending: false })
      .limit(1)
      .maybeSingle();
    const kpiAntes = (anterior?.datos as { kpi?: unknown } | undefined)?.kpi;

    const datos = procesarLibroFoliosBbva(bytes, archivo.name, fechaCorte, kpiAntes);

    const { data: insertado, error: errInsert } = await cliente
      .from("bbva_mantenimiento_snapshots")
      .insert({ fecha_corte: fechaCorte, region: "Puebla-Tlaxcala", datos, creado_por: perfil.id })
      .select("id, fecha_corte")
      .single();
    if (errInsert) return jsonResponse({ error: `No se pudo guardar el corte: ${errInsert.message}` }, 500);

    return jsonResponse({ ok: true, id: insertado.id, fecha_corte: insertado.fecha_corte, kpi: datos.kpi });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
