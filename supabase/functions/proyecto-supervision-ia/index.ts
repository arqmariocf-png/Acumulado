// Supervisión con IA por proyecto (Mario, 28-sep-2026). Cinco ayudas para
// el supervisor de obra, todas sobre el contexto del proyecto (nombre,
// cliente, empresa, responsable, y para el reporte al cliente también las
// tareas, requerimientos, precios unitarios y control de obra):
//   reporte_diario           notas sueltas de campo -> reporte diario
//   minuta                   notas de reunión -> decisiones, responsables,
//                            fechas y preguntas abiertas (+ acciones JSON
//                            para crear tarjetas)
//   resumen_documento        hilo/documento largo -> asunto, respuesta,
//                            pendientes
//   comparativa_cotizaciones cotizaciones pegadas -> tabla comparativa
//   avance_cliente           datos del proyecto + notas -> reporte de avance
// Cada corrida se guarda en proyecto_bitacora_ia con el cliente del usuario
// (RLS decide). Requiere ANTHROPIC_API_KEY en los secrets.
//
// POST JSON: { proyectoId, tipo, texto }  -> { salida, acciones, bitacoraId }

import Anthropic from "npm:@anthropic-ai/sdk@0.122.0";
import { respuestaCors, jsonResponse } from "../_shared/cors.ts";
import { clienteComoUsuario, clienteServicio, obtenerPerfilAutenticado, respuestaSoloConsulta } from "../_shared/supabase-clients.ts";

const TIPOS = ["reporte_diario", "minuta", "resumen_documento", "comparativa_cotizaciones", "avance_cliente"] as const;
type Tipo = (typeof TIPOS)[number];
const MODELO = "claude-opus-5";
const MAX_ENTRADA = 60_000;

// Estable para que el caché de prompt aplique entre corridas.
const SISTEMA = `Eres el asistente de supervisión de obra de una constructora mexicana (Grupo Loma y sus empresas). Escribes en español de México, claro y directo, para gente de obra y para clientes. Nunca inventas datos: si algo no está en las notas o en el contexto, lo marcas como "pendiente de confirmar". Usa unidades y montos tal como vengan. Formato: encabezados cortos con "##", listas con "-", tablas en Markdown cuando comparas. Sin introducciones ni despedidas.`;

const INSTRUCCION: Record<Tipo, string> = {
  reporte_diario: `Convierte las notas de campo en un REPORTE DIARIO con estas secciones: ## Trabajos ejecutados, ## Personal y equipo en obra, ## Materiales recibidos o faltantes, ## Retrasos e incidencias, ## Pendientes para mañana, ## Requiere decisión de dirección. Si una sección no tiene información, escribe "Sin novedad reportada".`,
  minuta: `Convierte las notas de la reunión en una MINUTA con: ## Asistentes, ## Acuerdos y decisiones, ## Responsables y fechas (tabla: Acción | Responsable | Fecha límite), ## Preguntas abiertas, ## Siguiente reunión. Al final agrega un bloque de código JSON (\`\`\`json) con un arreglo "acciones": [{"titulo": "...", "responsable": "nombre o null", "fecha_limite": "AAAA-MM-DD o null"}] para crear las tareas.`,
  resumen_documento: `Resume el hilo o documento técnico en: ## Asunto (una línea), ## Qué se pidió, ## Qué se respondió, ## Puntos sin resolver, ## Quién tiene la siguiente acción. Máximo una cuartilla.`,
  comparativa_cotizaciones: `Compara las cotizaciones. Entrega: ## Alcance de cada proveedor, ## Tabla comparativa (Concepto | Proveedor A | Proveedor B | ...), con precios, unidades, tiempos de entrega y condiciones de pago; ## Exclusiones y diferencias de alcance; ## Riesgos y preguntas para el proveedor; ## Recomendación (con la razón, sin decidir por dirección).`,
  avance_cliente: `Con el contexto del proyecto y las notas, redacta un REPORTE DE AVANCE para el cliente o dueño: ## Resumen ejecutivo (3 líneas), ## Avance físico, ## Suministro y materiales, ## Precios unitarios en autorización, ## Riesgos y retrasos, ## Decisiones que necesitamos del cliente, ## Próximos pasos. Tono profesional y sin jerga interna.`,
};

async function contextoProyecto(proyectoId: string, tipo: Tipo): Promise<string> {
  const db = clienteServicio();
  const { data: p } = await db.from("proyectos").select("nombre, cliente, tipo, responsable_nombre, comprador_nombre, empresas(nombre)").eq("id", proyectoId).single();
  if (!p) return "";
  const empresa = (p as { empresas?: { nombre: string } | null }).empresas?.nombre ?? "";
  const lineas = [`Proyecto: ${p.nombre}`, `Empresa: ${empresa}`, `Cliente: ${p.cliente ?? "sin capturar"}`, `Tipo: ${p.tipo ?? "—"}`, `Responsable: ${p.responsable_nombre ?? "—"}`, `Comprador: ${p.comprador_nombre ?? "—"}`];
  if (tipo !== "avance_cliente") return lineas.join("\n");

  const [{ data: tableros }, { data: reqs }, { data: pu }, { data: controles }, { data: planos }] = await Promise.all([
    db.from("tableros").select("id, nombre").eq("proyecto_id", proyectoId).eq("archivado", false),
    db.from("requisiciones").select("folio, fecha, etapa, estado, comentario").eq("proyecto_id", proyectoId).order("fecha", { ascending: false }).limit(50),
    db.from("pu_analisis").select("codigo, concepto, estado, cliente_autorizado_en").eq("proyecto_id", proyectoId).limit(100),
    db.from("proyecto_controles").select("id, especialidad, presupuesto, estatus").eq("proyecto_id", proyectoId),
    db.from("proyecto_planos").select("nombre_original, tipo_archivo").eq("proyecto_id", proyectoId).limit(30),
  ]);
  const tabIds = (tableros ?? []).map((t: { id: string }) => t.id);
  let tareasTxt = "Sin tablero de avance.";
  if (tabIds.length > 0) {
    const [{ data: columnas }, { data: tarjetas }] = await Promise.all([
      db.from("tablero_columnas").select("id, tablero_id, nombre, orden").in("tablero_id", tabIds).order("orden"),
      db.from("tarjetas").select("titulo, columna_id, fecha_limite, tablero_id").in("tablero_id", tabIds).eq("archivada", false).limit(150),
    ]);
    const nombreCol = new Map((columnas ?? []).map((c: { id: string; nombre: string }) => [c.id, c.nombre]));
    const ultima = new Map<string, string>();
    for (const c of columnas ?? []) ultima.set(c.tablero_id, c.id);
    const total = (tarjetas ?? []).length;
    const hechas = (tarjetas ?? []).filter((t: { tablero_id: string; columna_id: string }) => ultima.get(t.tablero_id) === t.columna_id).length;
    tareasTxt = `${hechas} de ${total} tareas hechas.\n` + (tarjetas ?? []).slice(0, 60).map((t: { titulo: string; columna_id: string; fecha_limite: string | null }) => `- ${t.titulo} [${nombreCol.get(t.columna_id) ?? "?"}${t.fecha_limite ? `, límite ${t.fecha_limite}` : ""}]`).join("\n");
  }
  const ctrlIds = (controles ?? []).map((c: { id: string }) => c.id);
  let finTxt = "Sin control de obra capturado.";
  if (ctrlIds.length > 0) {
    const [{ data: compras }, { data: nomina }] = await Promise.all([
      db.from("proyecto_control_compras").select("control_id, importe").in("control_id", ctrlIds),
      db.from("proyecto_control_nomina").select("control_id, sueldo").in("control_id", ctrlIds),
    ]);
    finTxt = (controles ?? [])
      .map((c: { id: string; especialidad: string; presupuesto: number; estatus: string }) => {
        const mat = (compras ?? []).filter((x: { control_id: string }) => x.control_id === c.id).reduce((s: number, x: { importe: number }) => s + Number(x.importe), 0);
        const nom = (nomina ?? []).filter((x: { control_id: string }) => x.control_id === c.id).reduce((s: number, x: { sueldo: number }) => s + Number(x.sueldo), 0);
        return `- ${c.especialidad}: presupuesto $${Number(c.presupuesto).toLocaleString("es-MX")}, materiales $${mat.toLocaleString("es-MX")}, nómina $${nom.toLocaleString("es-MX")}, estatus ${c.estatus}`;
      })
      .join("\n");
  }
  const reqTxt = (reqs ?? []).length === 0 ? "Sin requerimientos." : (reqs ?? []).map((r: { folio: number; fecha: string; etapa: string; estado: string; comentario: string | null }) => `- #${r.folio} (${r.fecha}) etapa: ${r.etapa}${r.estado === "cancelada" ? " (cancelada)" : ""}${r.comentario ? ` · ${r.comentario}` : ""}`).join("\n");
  const puTxt = (pu ?? []).length === 0 ? "Sin precios unitarios." : (pu ?? []).map((a: { codigo: string; concepto: string; estado: string; cliente_autorizado_en: string | null }) => `- ${a.codigo} ${a.concepto}: ${a.estado}${a.cliente_autorizado_en ? ", autorizado por el cliente" : ""}`).join("\n");
  const planosTxt = (planos ?? []).length === 0 ? "Sin planos." : (planos ?? []).map((x: { nombre_original: string; tipo_archivo: string }) => `- ${x.nombre_original} (${x.tipo_archivo})`).join("\n");
  return [...lineas, "", "## Tareas del tablero de avance", tareasTxt, "", "## Requerimientos (etapas: solicitada → autorizada → pagada → suministro → en_bodega → en_transito → recibida)", reqTxt, "", "## Precios unitarios (estados: borrador → en_revision_material → material_confirmado → autorizado → publicado; luego autorización del cliente)", puTxt, "", "## Control de obra (presupuesto y ejercido)", finTxt, "", "## Planos cargados", planosTxt].join("\n");
}

function extraerAcciones(salida: string): { titulo: string; responsable: string | null; fecha_limite: string | null }[] {
  const m = salida.match(/```json\s*([\s\S]*?)```/i);
  if (!m) return [];
  try {
    const obj = JSON.parse(m[1]);
    const lista = Array.isArray(obj) ? obj : Array.isArray(obj?.acciones) ? obj.acciones : [];
    return lista
      .filter((a: unknown) => a && typeof a === "object" && typeof (a as { titulo?: unknown }).titulo === "string")
      .map((a: { titulo: string; responsable?: string | null; fecha_limite?: string | null }) => ({
        titulo: a.titulo.slice(0, 200),
        responsable: typeof a.responsable === "string" && a.responsable.trim() ? a.responsable.trim() : null,
        fecha_limite: typeof a.fecha_limite === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.fecha_limite) ? a.fecha_limite : null,
      }));
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();
  if (req.method !== "POST") return jsonResponse({ error: "Método no permitido" }, 405);

  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    if (perfil.soloConsulta) return respuestaSoloConsulta();
    if (perfil.rol === "pendiente") return jsonResponse({ error: "Tu cuenta todavía no tiene acceso." }, 403);

    const body = (await req.json().catch(() => ({}))) as { proyectoId?: string; tipo?: string; texto?: string };
    const proyectoId = String(body.proyectoId ?? "");
    const tipo = body.tipo as Tipo;
    const texto = String(body.texto ?? "").trim();
    if (!proyectoId || !TIPOS.includes(tipo)) return jsonResponse({ error: "Faltan proyectoId o tipo" }, 400);
    if (tipo !== "avance_cliente" && texto.length < 10) return jsonResponse({ error: "Pega las notas o el documento a procesar (mínimo unas palabras)." }, 400);
    if (texto.length > MAX_ENTRADA) return jsonResponse({ error: `El texto es muy largo (${texto.length} caracteres; máximo ${MAX_ENTRADA}). Divídelo en partes.` }, 400);

    const dbUsuario = clienteComoUsuario(req);
    const { data: visible } = await dbUsuario.from("proyectos").select("id").eq("id", proyectoId).maybeSingle();
    if (!visible) return jsonResponse({ error: "Sin acceso a este proyecto" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return jsonResponse({ error: "Falta ANTHROPIC_API_KEY en los secrets de Edge Functions." }, 500);

    const contexto = await contextoProyecto(proyectoId, tipo);
    const hoy = new Date().toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", year: "numeric", month: "long", day: "numeric" });
    const usuario = `${INSTRUCCION[tipo]}\n\nFecha de hoy: ${hoy}. Quien reporta: ${perfil.nombre ?? "supervisor"}.\n\n# Contexto del proyecto\n${contexto}\n\n# Notas / texto de entrada\n${texto || "(sin notas adicionales; usa solo el contexto del proyecto)"}`;

    const anthropic = new Anthropic({ apiKey });
    let respuesta;
    try {
      respuesta = await anthropic.messages.create({
        model: MODELO,
        max_tokens: 8000,
        output_config: { effort: "medium" },
        system: [{ type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: usuario }],
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) return jsonResponse({ error: "La clave de Anthropic (ANTHROPIC_API_KEY) no es válida. Hay que actualizarla en los secrets de Supabase." }, 502);
      if (err instanceof Anthropic.RateLimitError) return jsonResponse({ error: "El servicio de IA está saturado, intenta en un minuto." }, 503);
      if (err instanceof Anthropic.APIError) return jsonResponse({ error: `Error del servicio de IA (${err.status}): ${err.message}` }, 502);
      throw err;
    }
    if (respuesta.stop_reason === "refusal") return jsonResponse({ error: "El modelo declinó procesar este texto." }, 422);
    const salida = respuesta.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!salida) return jsonResponse({ error: "El modelo no devolvió texto." }, 502);
    const acciones = tipo === "minuta" ? extraerAcciones(salida) : [];
    const salidaLimpia = tipo === "minuta" ? salida.replace(/```json[\s\S]*?```/i, "").trim() : salida;

    // Con el cliente del usuario: la policy decide si puede guardar en este proyecto.
    const { data: fila, error: errInsert } = await dbUsuario
      .from("proyecto_bitacora_ia")
      .insert({ proyecto_id: proyectoId, tipo, entrada: texto || "(solo contexto del proyecto)", salida: salidaLimpia, acciones, modelo: respuesta.model, creado_por: perfil.id })
      .select("id")
      .single();
    if (errInsert) return jsonResponse({ salida: salidaLimpia, acciones, bitacoraId: null, aviso: `Se generó pero no se guardó en la bitácora: ${errInsert.message}` });

    return jsonResponse({ salida: salidaLimpia, acciones, bitacoraId: fila.id, uso: { entrada: respuesta.usage.input_tokens, salida: respuesta.usage.output_tokens, cache: respuesta.usage.cache_read_input_tokens ?? 0 } });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
