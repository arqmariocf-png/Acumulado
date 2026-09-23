// Expediente de personal (RH): sube el archivo de un documento (INE, CURP,
// NSS, constancia SAT, comprobante de domicilio, licencia...), lo guarda en
// el bucket privado "cargas", registra el documento en documentos_personal
// y le pide a Claude (visión / PDF) que extraiga los datos que trae. Lo
// extraído es una SUGERENCIA: la pantalla de Expediente lo muestra junto a
// lo que ya tiene la ficha de la persona y RH decide qué aplicar. Si la
// lectura falla, el archivo y el registro igual quedan guardados (se
// anota error_extraccion) -- nunca se bloquea la captura por la IA.
//
// POST multipart/form-data: file, personalId, tipoDocumentoId, fechaEntrega
//   -> { documento, extraccion, sugerencias }
// POST con tipoDocumentoIds (ids separados por coma) en vez de
//   tipoDocumentoId: un solo PDF con todo el expediente. El archivo se
//   guarda una vez, se registra un documento por cada tipo marcado (todos
//   apuntan al mismo archivo) y la IA lee el PDF completo una sola vez; lo
//   extraído queda en el primer documento de la lista.
//   -> { documentos, extraccion, sugerencias }
// GET  ?documentoId=<uuid> -> { url } (signed URL de 60 s para ver el archivo)

import Anthropic from "npm:@anthropic-ai/sdk@0.122.0";
import { respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado, type PerfilAutenticado } from "../_shared/supabase-clients.ts";

const TAMANO_MAXIMO_BYTES = 20 * 1024 * 1024;
const ROLES_SUBEN = new Set(["rh", "rh_documentos", "admin"]);
const IMAGENES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Campos que Claude intenta leer. Los nombres son estables: la pantalla y
 * el mapeo a `personal` (abajo) dependen de ellos. */
interface CamposExtraidos {
  nombre_completo: string | null;
  curp: string | null;
  rfc: string | null;
  nss: string | null;
  fecha_nacimiento: string | null;
  sexo: "M" | "F" | null;
  domicilio: string | null;
  codigo_postal: string | null;
  ine_clave_elector: string | null;
  ine_numero_identificacion: string | null;
  ine_vigencia: string | null;
  telefono: string | null;
  correo: string | null;
  regimen_fiscal: string | null;
  licencia_numero: string | null;
  licencia_tipo: string | null;
  licencia_vigencia: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  emisor: string | null;
}

interface Extraccion {
  tipo_detectado: string;
  campos: CamposExtraidos;
  coincide_con_persona: boolean | null;
  observaciones: string;
  confianza: "alta" | "media" | "baja";
}

const CAMPOS: (keyof CamposExtraidos)[] = [
  "nombre_completo", "curp", "rfc", "nss", "fecha_nacimiento", "sexo", "domicilio", "codigo_postal",
  "ine_clave_elector", "ine_numero_identificacion", "ine_vigencia", "telefono", "correo", "regimen_fiscal",
  "licencia_numero", "licencia_tipo", "licencia_vigencia", "fecha_emision", "fecha_vencimiento", "emisor",
];

/** Qué campo extraído alimenta qué columna de `personal`. El domicilio solo
 * se sugiere desde documentos que lo acreditan (INE, comprobante, SAT). */
const MAPEO_PERSONAL: Record<string, keyof CamposExtraidos> = {
  curp: "curp",
  rfc: "rfc",
  nss: "nss",
  fecha_nacimiento: "fecha_nacimiento",
  sexo: "sexo",
  ine_clave_elector: "ine_clave_elector",
  ine_numero_identificacion: "ine_numero_identificacion",
  telefono: "telefono",
  correo: "correo",
  licencia_chofer_numero: "licencia_numero",
  licencia_chofer_vigencia: "licencia_vigencia",
  domicilio_particular: "domicilio",
};

function base64DeBytes(bytes: Uint8Array): string {
  let binario = "";
  const TROZO = 8192;
  for (let i = 0; i < bytes.length; i += TROZO) binario += String.fromCharCode(...bytes.subarray(i, i + TROZO));
  return btoa(binario);
}

function limpiar(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s.toLowerCase() === "null" ? null : s;
}

async function extraerConClaude(apiKey: string, bytes: Uint8Array, mime: string, tipoDocumento: string, nombrePersona: string): Promise<Extraccion> {
  const anthropic = new Anthropic({ apiKey });
  const bloqueArchivo: Anthropic.ContentBlockParam =
    mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64DeBytes(bytes) } }
      : { type: "image", source: { type: "base64", media_type: mime as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: base64DeBytes(bytes) } };

  const respuesta = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: [
          bloqueArchivo,
          {
            type: "text",
            text:
              `Este archivo es un documento del expediente laboral de una persona en México, registrado como "${tipoDocumento}" ` +
              `para la persona "${nombrePersona}". Extrae ÚNICAMENTE los datos que estén escritos literalmente en el documento; ` +
              "nunca inventes ni completes un dato que no se lea. Si el archivo trae varios documentos (expediente completo), lee todos y junta los datos. Normaliza: fechas en formato YYYY-MM-DD (si el documento solo trae " +
              "el año, ponlo como texto en ine_vigencia o fecha_vencimiento), CURP/RFC/NSS/clave de elector en mayúsculas sin espacios, " +
              "domicilio en una sola línea. En una credencial INE: 'ine_clave_elector' es la CLAVE DE ELECTOR (18 caracteres), " +
              "'ine_numero_identificacion' es el número de identificación/CIC u OCR que aparece al reverso, 'ine_vigencia' el año de vigencia. " +
              "En una constancia de situación fiscal (SAT): rfc, nombre, régimen fiscal, domicilio fiscal y código postal, fecha de emisión. " +
              "En un comprobante de domicilio (CFE, agua, teléfono, predial): domicilio, código postal, nombre del titular en nombre_completo, " +
              "fecha de emisión y emisor. En NSS/IMSS: nss (11 dígitos), curp, nombre. En licencia de conducir: licencia_numero, " +
              "licencia_tipo y licencia_vigencia. En carta de antecedentes no penales: fecha_emision, emisor, nombre. " +
              "En solicitud de empleo: nombre, teléfono, correo, domicilio, fecha de nacimiento, curp/rfc/nss si los trae. " +
              "Indica en coincide_con_persona si el nombre del documento corresponde razonablemente a la persona registrada " +
              "(true/false, o null si el documento no trae nombre). Responde ÚNICAMENTE con un objeto JSON, sin markdown ni texto " +
              'extra, con esta forma exacta: {"tipo_detectado": string, "campos": {' +
              CAMPOS.map((c) => `"${c}": string o null`).join(", ") +
              '}, "coincide_con_persona": true/false/null, "observaciones": string, "confianza": "alta"|"media"|"baja"}. ' +
              "En observaciones anota en una o dos frases qué se leyó bien, qué está ilegible y cualquier alerta (documento vencido, " +
              "nombre distinto, copia incompleta). Si el archivo no es legible o no es el documento indicado, deja los campos en null y explícalo.",
          },
        ],
      },
    ],
  });

  const bloqueTexto = respuesta.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  const crudo = (bloqueTexto?.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const parsed = JSON.parse(crudo);
  const campos = {} as CamposExtraidos;
  for (const c of CAMPOS) (campos as Record<string, string | null>)[c] = limpiar(parsed?.campos?.[c]);
  if (campos.sexo && campos.sexo !== "M" && campos.sexo !== "F") {
    const s = campos.sexo.toUpperCase();
    campos.sexo = s.startsWith("H") || s.startsWith("M") && s !== "MUJER" ? "M" : s.startsWith("F") || s === "MUJER" ? "F" : null;
  }
  const confianza = parsed?.confianza === "alta" || parsed?.confianza === "baja" ? parsed.confianza : "media";
  return {
    tipo_detectado: limpiar(parsed?.tipo_detectado) ?? tipoDocumento,
    campos,
    coincide_con_persona: typeof parsed?.coincide_con_persona === "boolean" ? parsed.coincide_con_persona : null,
    observaciones: limpiar(parsed?.observaciones) ?? "",
    confianza,
  };
}

/** Compara lo extraído con la ficha actual: solo se sugiere lo que trae
 * valor y es distinto de lo que ya hay. */
function sugerenciasParaPersonal(campos: CamposExtraidos, persona: Record<string, unknown>) {
  const sugerencias: Record<string, { actual: string | null; nuevo: string }> = {};
  for (const [columna, campo] of Object.entries(MAPEO_PERSONAL)) {
    const nuevo = campos[campo];
    if (!nuevo) continue;
    const actual = limpiar(persona[columna]);
    if (actual && actual.toUpperCase() === nuevo.toUpperCase()) continue;
    sugerencias[columna] = { actual, nuevo };
  }
  return sugerencias;
}

function sumarMeses(fechaIso: string, meses: number): string {
  const d = new Date(`${fechaIso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 10);
}

async function subir(req: Request, perfil: PerfilAutenticado): Promise<Response> {
  if (!ROLES_SUBEN.has(perfil.rol)) return jsonResponse({ error: "Tu rol no puede subir documentos de personal" }, 403);

  const form = await req.formData();
  const archivo = form.get("file") as File | null;
  const personalId = String(form.get("personalId") ?? "");
  const tipoDocumentoId = String(form.get("tipoDocumentoId") ?? "");
  const tipoDocumentoIds = String(form.get("tipoDocumentoIds") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const ids = tipoDocumentoIds.length > 0 ? tipoDocumentoIds : tipoDocumentoId ? [tipoDocumentoId] : [];
  const expedienteCompleto = tipoDocumentoIds.length > 0;
  const fechaEntrega = String(form.get("fechaEntrega") ?? "") || new Date().toISOString().slice(0, 10);
  if (!archivo || !personalId || ids.length === 0) return jsonResponse({ error: "file, personalId y tipoDocumentoId(s) son requeridos" }, 400);
  if (archivo.size > TAMANO_MAXIMO_BYTES) return jsonResponse({ error: `El archivo pesa más de ${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB` }, 400);

  const mime = archivo.type || "application/octet-stream";
  if (mime !== "application/pdf" && !IMAGENES.has(mime)) {
    return jsonResponse({ error: "Sube el documento en PDF o foto JPG/PNG (las fotos HEIC del iPhone hay que convertirlas primero)." }, 400);
  }

  // Lo que el usuario puede ver (RLS) decide si puede subirle a esa persona.
  const cliente = clienteComoUsuario(req);
  const [{ data: persona }, { data: tipos }] = await Promise.all([
    cliente.from("personal").select("*").eq("id", personalId).maybeSingle(),
    cliente.from("tipos_documento_personal").select("id, nombre, vigencia_meses").in("id", ids),
  ]);
  if (!persona) return jsonResponse({ error: "Persona no encontrada o sin acceso" }, 404);
  const tiposOrdenados = ids.map((id) => (tipos ?? []).find((t) => t.id === id)).filter((t) => !!t) as { id: string; nombre: string; vigencia_meses: number | null }[];
  if (tiposOrdenados.length !== ids.length) return jsonResponse({ error: "Tipo de documento no encontrado" }, 404);
  const tipo = tiposOrdenados[0];

  const dbServicio = clienteServicio();
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const nombreSeguro = archivo.name.replace(/[^\w.\-]+/g, "_");
  const rutaStorage = `rh/expedientes/${personalId}/${Date.now()}-${nombreSeguro}`;
  const { error: errUpload } = await dbServicio.storage.from("cargas").upload(rutaStorage, bytes, { contentType: mime });
  if (errUpload) return jsonResponse({ error: `No se pudo guardar el archivo: ${errUpload.message}` }, 500);

  const { data: documentos, error: errInsert } = await dbServicio
    .from("documentos_personal")
    .insert(
      tiposOrdenados.map((t) => ({
        personal_id: personalId,
        tipo_documento_id: t.id,
        fecha_entrega: fechaEntrega,
        fecha_vigencia: t.vigencia_meses ? sumarMeses(fechaEntrega, t.vigencia_meses) : null,
        storage_path: rutaStorage,
        nombre_original: archivo.name,
        mime_type: mime,
        created_by: perfil.id,
        subido_por: perfil.id,
      })),
    )
    .select("*");
  if (errInsert || !documentos || documentos.length === 0) return jsonResponse({ error: errInsert?.message ?? "No se pudo registrar el documento" }, 500);
  const documento = documentos.find((d) => d.tipo_documento_id === tipo.id) ?? documentos[0];

  // Extracción: si falla, el documento ya quedó guardado y se anota el error.
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  let extraccion: Extraccion | null = null;
  let errorExtraccion: string | null = null;
  if (!apiKey) errorExtraccion = "ANTHROPIC_API_KEY no está configurado";
  else {
    try {
      const etiquetaTipo = expedienteCompleto ? `Expediente completo en un solo archivo (${tiposOrdenados.map((t) => t.nombre).join("; ")})` : tipo.nombre;
      extraccion = await extraerConClaude(apiKey, bytes, mime, etiquetaTipo, persona.nombre);
    } catch (err) {
      errorExtraccion = (err as Error).message;
    }
  }
  const { data: actualizado } = await dbServicio
    .from("documentos_personal")
    .update({ datos_extraidos: extraccion, extraido_en: extraccion ? new Date().toISOString() : null, error_extraccion: errorExtraccion })
    .eq("id", documento.id)
    .select("*")
    .single();

  return jsonResponse({
    documento: actualizado ?? documento,
    documentos: documentos.map((d) => (d.id === documento.id ? actualizado ?? d : d)),
    extraccion,
    error_extraccion: errorExtraccion,
    sugerencias: extraccion ? sugerenciasParaPersonal(extraccion.campos, persona) : {},
  });
}

async function verArchivo(req: Request, documentoId: string): Promise<Response> {
  const cliente = clienteComoUsuario(req);
  const { data: fila, error } = await cliente.from("documentos_personal").select("storage_path").eq("id", documentoId).maybeSingle();
  if (error || !fila?.storage_path) return jsonResponse({ error: "Documento no encontrado, sin archivo o sin acceso" }, 404);
  const { data: firmada, error: errFirma } = await clienteServicio().storage.from("cargas").createSignedUrl(fila.storage_path, 60);
  if (errFirma || !firmada) return jsonResponse({ error: `No se pudo generar el enlace: ${errFirma?.message ?? ""}` }, 500);
  return jsonResponse({ url: firmada.signedUrl });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();
  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);

    if (req.method === "GET") {
      const documentoId = new URL(req.url).searchParams.get("documentoId");
      if (!documentoId) return jsonResponse({ error: "documentoId es requerido" }, 400);
      return await verArchivo(req, documentoId);
    }
    if (req.method === "POST") return await subir(req, perfil);
    return jsonResponse({ error: "Método no soportado" }, 405);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
