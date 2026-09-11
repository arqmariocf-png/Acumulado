// Lee un plano PDF ya subido (proyecto_planos) con Claude (visión) y
// sugiere un primer borrador de conceptos de material/mano de obra para
// Precios Unitarios -- es SOLO una sugerencia editable, igual que
// ocr-nota-entrega con las notas de entrega: nunca inventa cantidades ni
// mide el plano, solo extrae lo que ya está anotado por escrito (cuadros de
// acabados, notas generales, cédulas de material). El usuario siempre
// confirma/corrige antes de que cuente como cotización real.
//
// DWG no se puede leer -- no hay parser/visor de CAD en este runtime.
//
// POST json: { planoId }

import Anthropic from "npm:@anthropic-ai/sdk@0.122.0";
import { corsHeaders, respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteComoUsuario, clienteServicio } from "../_shared/supabase-clients.ts";

const TAMANO_MAXIMO_BYTES = 20 * 1024 * 1024; // límite práctico para no pegarle a los topes de la API de documentos

interface ConceptoSugerido {
  concepto: string;
  unidad: string | null;
  cantidad: number | null;
  tipo: "material" | "mano_obra" | "no_determinado";
  fuente: string;
}

function base64DeBytes(bytes: Uint8Array): string {
  let binario = "";
  const TAMANO_TROZO = 8192;
  for (let i = 0; i < bytes.length; i += TAMANO_TROZO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TAMANO_TROZO));
  }
  return btoa(binario);
}

async function leerPlanoConClaude(apiKey: string, bytes: Uint8Array): Promise<{ conceptos: ConceptoSugerido[]; advertencia: string }> {
  const anthropic = new Anthropic({ apiKey });
  const respuesta = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64DeBytes(bytes) },
          },
          {
            type: "text",
            text:
              "Este es un plano de construcción en PDF. Necesito un primer borrador de conceptos de material y mano de obra " +
              "para empezar a cotizar, basado SOLO en lo que está escrito literalmente en el plano (notas generales, cuadros " +
              "de acabados, cédulas de material, especificaciones). " +
              "NUNCA midas distancias, calcules áreas/volúmenes a partir del dibujo, ni inventes una cantidad que no esté " +
              "anotada por escrito -- si el plano no dice la cantidad, repórtala como null. No adivines escalas ni acotaciones. " +
              "Para cada concepto que identifiques, indica de dónde lo sacaste (ej. 'cuadro de acabados', 'nota general 4'). " +
              "Responde ÚNICAMENTE con un objeto JSON (sin explicación, sin markdown, sin texto antes o después) con esta forma " +
              'exacta: {"conceptos": [{"concepto": string, "unidad": string o null, "cantidad": number o null, ' +
              '"tipo": "material" o "mano_obra" o "no_determinado", "fuente": string}], "advertencia": string}. ' +
              "El campo advertencia es un mensaje corto para el usuario explicando qué tan completo es este borrador y qué " +
              "falta por levantar/medir manualmente. Si el PDF no es un plano legible o no tiene especificaciones escritas, " +
              "responde con conceptos: [] y explica por qué en advertencia.",
          },
        ],
      },
    ],
  });

  const bloqueTexto = respuesta.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  const crudo = (bloqueTexto?.text ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  const parsed = JSON.parse(crudo);
  const conceptos: ConceptoSugerido[] = Array.isArray(parsed.conceptos)
    ? parsed.conceptos.map((c: any) => ({
        concepto: String(c?.concepto ?? "").trim(),
        unidad: c?.unidad ? String(c.unidad).trim() : null,
        cantidad: typeof c?.cantidad === "number" ? c.cantidad : null,
        tipo: c?.tipo === "material" || c?.tipo === "mano_obra" ? c.tipo : "no_determinado",
        fuente: String(c?.fuente ?? "").trim(),
      }))
    : [];
  return { conceptos, advertencia: String(parsed.advertencia ?? "") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const cliente = clienteComoUsuario(req);
    const {
      data: { user },
    } = await cliente.auth.getUser();
    if (!user) return jsonResponse({ error: "No autenticado" }, 401);

    const body = await req.json().catch(() => null);
    const planoId = body?.planoId as string | undefined;
    if (!planoId) return jsonResponse({ error: "planoId es requerido" }, 400);

    // RLS de proyecto_planos_select decide si el usuario puede ver este
    // plano -- si la consulta no trae la fila, no tiene acceso.
    const { data: plano, error: errPlano } = await cliente.from("proyecto_planos").select("storage_path, tipo_archivo, nombre_original").eq("id", planoId).maybeSingle();
    if (errPlano || !plano) return jsonResponse({ error: "Plano no encontrado o sin acceso" }, 404);

    if (plano.tipo_archivo !== "pdf") {
      return jsonResponse({ error: "Solo se pueden leer planos en PDF -- los DWG no se pueden procesar con IA en este sistema." }, 400);
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return jsonResponse({ error: "ANTHROPIC_API_KEY no está configurado" }, 500);

    const dbServicio = clienteServicio();
    const { data: archivo, error: errDescarga } = await dbServicio.storage.from("cargas").download(plano.storage_path);
    if (errDescarga || !archivo) return jsonResponse({ error: `No se pudo leer el plano guardado: ${errDescarga?.message ?? ""}` }, 500);

    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return jsonResponse({ error: `Este PDF pesa más de ${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB -- muy grande para leerlo con IA por ahora.` }, 400);
    }

    const bytes = new Uint8Array(await archivo.arrayBuffer());

    try {
      const resultado = await leerPlanoConClaude(apiKey, bytes);
      return jsonResponse(resultado);
    } catch (err) {
      return jsonResponse({ error: `No se pudo leer el plano con IA: ${(err as Error).message}` }, 500);
    }
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
