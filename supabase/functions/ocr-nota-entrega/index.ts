// Recibe la foto de una nota de entrega (remisión en papel) para
// proveedores que no traen QR ni código de barras: la guarda en el bucket
// "cargas" (mismo bucket privado que el resto de las cargas de archivos) y
// le pide a Claude (visión) que lea los conceptos/cantidades/proveedor de
// la foto -- son SOLO una sugerencia: el usuario los confirma o los busca
// por nombre a mano desde Movimientos antes de agregarlos al carrito. Si la
// lectura falla (foto ilegible, IA no disponible, etc.) la foto igual queda
// guardada y el usuario puede seguir capturando manual -- nunca se bloquea
// el flujo por un error de OCR.
//
// POST multipart/form-data: file, empresaId

import Anthropic from "npm:@anthropic-ai/sdk@0.122.0";
import { clienteServicio, obtenerPerfilAutenticado, type PerfilAutenticado } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";

// No se reutiliza puedeEscribirEnEmpresa() de _shared: esa función no sabe
// del rol 'almacen' (agregado solo para inventario -- ver
// auth_puede_escribir_inventario() en la base de datos) porque otras
// funciones que sí la usan (ingesta-cfdi, ingesta-oc-ov, estados de cuenta)
// son datos bancarios/financieros donde 'almacen' NO debe tener acceso.
function puedeSubirNotaEnEmpresa(perfil: PerfilAutenticado, empresaId: string): boolean {
  if (perfil.rol === "corporativo" || perfil.rol === "admin") return true;
  if (perfil.rol === "empresa" || perfil.rol === "almacen") return perfil.empresaId === empresaId;
  return false;
}

const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;
// HEIC/HEIF (formato nativo de fotos de iPhone) queda fuera a propósito:
// Claude solo decodifica jpeg/png/webp/gif, y convertir HEIC->JPEG en este
// runtime (Deno, sin librería de imágenes nativa) no es viable -- mandar los
// bytes HEIC crudos con un media_type falso solo produce un error de lectura
// silencioso más adelante. El <input> del navegador debe pedir estos 3
// formatos directamente (la mayoría de cámaras ya ofrecen JPEG).
const TIPOS_PERMITIDOS = ["image/jpeg", "image/png", "image/webp"];

interface ItemSugerido {
  descripcion: string;
  cantidad: number | null;
  unidad: string | null;
}

function base64DeBytes(bytes: Uint8Array): string {
  // btoa espera un string binario -- en trozos para no reventar el stack
  // con archivos grandes (String.fromCharCode(...bytes) falla arriba de
  // ~100k elementos en algunos runtimes).
  let binario = "";
  const TAMANO_TROZO = 8192;
  for (let i = 0; i < bytes.length; i += TAMANO_TROZO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TAMANO_TROZO));
  }
  return btoa(binario);
}

async function leerNotaConClaude(apiKey: string, bytes: Uint8Array, mediaType: string) {
  const anthropic = new Anthropic({ apiKey });
  const respuesta = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data: base64DeBytes(bytes) },
          },
          {
            type: "text",
            text:
              "Esta es la foto de una nota o remisión de entrega de un proveedor a un almacén de construcción en México. " +
              "Extrae cada línea de producto/material que puedas leer, con su cantidad y unidad si están visibles. " +
              "También el nombre del proveedor y la fecha si aparecen. " +
              "Responde ÚNICAMENTE con un objeto JSON (sin explicación, sin markdown, sin texto antes o después) con esta forma exacta: " +
              '{"proveedor": string o null, "fecha": string (AAAA-MM-DD) o null, "items": [{"descripcion": string, "cantidad": number o null, "unidad": string o null}]}. ' +
              "Si no puedes leer algo con confianza (letra ilegible, foto borrosa, etc.), usa null en ese campo en vez de adivinar. " +
              "Si no logras identificar ninguna línea de producto, responde con items: [].",
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
  const items: ItemSugerido[] = Array.isArray(parsed.items)
    ? parsed.items.map((it: any) => ({
        descripcion: String(it?.descripcion ?? "").trim(),
        cantidad: typeof it?.cantidad === "number" ? it.cantidad : null,
        unidad: it?.unidad ? String(it.unidad).trim() : null,
      }))
    : [];
  return {
    proveedor: parsed.proveedor ? String(parsed.proveedor).trim() : null,
    fecha: parsed.fecha ? String(parsed.fecha).trim() : null,
    items,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);

    const form = await req.formData();
    const empresaId = String(form.get("empresaId") ?? "");
    const archivo = form.get("file") as File | null;

    if (!empresaId || !archivo) return jsonResponse({ error: "empresaId y file son requeridos" }, 400);
    if (!puedeSubirNotaEnEmpresa(perfil, empresaId)) return jsonResponse({ error: "Sin permiso para cargar en esta empresa" }, 403);
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return jsonResponse({ error: `La foto excede el tamaño máximo permitido (${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB)` }, 400);
    }
    if (!TIPOS_PERMITIDOS.includes(archivo.type)) {
      return jsonResponse({ error: "Formato de imagen no soportado -- usa JPG, PNG o WEBP" }, 400);
    }

    const dbServicio = clienteServicio();
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const rutaStorage = `notas-entrega/${empresaId}/${Date.now()}-${archivo.name}`;

    const { error: errUpload } = await dbServicio.storage.from("cargas").upload(rutaStorage, bytes, {
      contentType: archivo.type,
    });
    if (errUpload) return jsonResponse({ error: `No se pudo guardar la foto: ${errUpload.message}` }, 500);

    let proveedorSugerido: string | null = null;
    let fechaSugerida: string | null = null;
    let itemsSugeridos: ItemSugerido[] = [];
    let errorLectura: string | null = null;

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      errorLectura = "ANTHROPIC_API_KEY no está configurado -- la foto se guardó, pero sin lectura automática.";
    } else {
      try {
        const leido = await leerNotaConClaude(apiKey, bytes, archivo.type);
        proveedorSugerido = leido.proveedor;
        fechaSugerida = leido.fecha;
        itemsSugeridos = leido.items;
      } catch (err) {
        errorLectura = `No se pudo leer automáticamente la nota: ${(err as Error).message}. Puedes capturar los productos a mano.`;
      }
    }

    const { data: notaRow, error: errNota } = await dbServicio
      .from("notas_entrega")
      .insert({
        empresa_id: empresaId,
        storage_path: rutaStorage,
        proveedor_sugerido: proveedorSugerido,
        fecha_sugerida: fechaSugerida,
        texto_extraido: { items: itemsSugeridos, error: errorLectura },
        subido_por: perfil.id,
      })
      .select("id")
      .single();
    if (errNota) return jsonResponse({ error: errNota.message }, 500);

    return jsonResponse({
      notaEntregaId: notaRow.id,
      storagePath: rutaStorage,
      proveedorSugerido,
      fechaSugerida,
      itemsSugeridos,
      errorLectura,
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
