// Edge function: genera la tarjeta en PDF de un análisis de precio unitario
// (web/src/pages/precios/comun.ts -> descargarPdf).
//
// GET ?analisis_id=<uuid>[&descarga=1]. Devuelve el PDF binario directo
// (Content-Type application/pdf), no JSON -- igual que reporte-saldos-diario
// y a diferencia del resto de funciones de este proyecto, así que el
// frontend lo lee como blob. Los errores sí van en JSON, que es lo que
// descargarPdf intenta parsear cuando la respuesta no es ok.
//
// No reimplementa ni un solo permiso: lee con el JWT de quien llama, así que
// RLS decide qué análisis existen para cada quien. Un supervisor que pida el
// id de un PU de otra empresa simplemente no lo encuentra, y recibe el mismo
// "no existe o no tienes acceso" que si el id fuera inventado -- no se
// distingue un caso del otro a propósito.
//
// Tampoco decide el precio: lo lee ya calculado de v_pu_analisis_costeo /
// v_pu_analisis_detalle. El precio unitario tiene una sola definición y vive
// en la base (20260905100100_pu_costeo.sql).

import { clienteComoUsuario } from "../_shared/supabase-clients.ts";
import { corsHeaders, respuestaCors } from "../_shared/cors.ts";
import { construirTarjetaPu, type CabeceraPu, type RenglonPu } from "../_shared/reportes/pu-tarjeta.ts";
import { generarPdfTarjetaPu } from "../_shared/reportes/pdf-pu.ts";

function jsonError(mensaje: string, status: number): Response {
  return new Response(JSON.stringify({ error: mensaje }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface FilaCosteo {
  empresa_nombre: string;
  proyecto_nombre: string | null;
  codigo: string;
  concepto: string;
  unidad: string;
  es_auxiliar: boolean;
  estado: CabeceraPu["estado"];
  creado_por_nombre: string | null;
  factor_nombre: string | null;
  indirectos_pct: string | number;
  financiamiento_pct: string | number;
  utilidad_pct: string | number;
  cargos_adicionales_pct: string | number;
  costo_directo: string | number;
  importe_indirectos: string | number;
  importe_financiamiento: string | number;
  importe_utilidad: string | number;
  importe_cargos_adicionales: string | number;
  precio_unitario: string | number;
  insumos_sin_precio: string | number;
}

interface FilaDetalle {
  orden: number;
  base_calculo: RenglonPu["baseCalculo"];
  codigo: string | null;
  descripcion: string | null;
  unidad: string | null;
  tipo: RenglonPu["tipo"];
  aportacion: string | number;
  costo_unitario: string | number;
  importe: string | number;
  sin_precio: boolean;
  proveedor: string | null;
}

// PostgREST devuelve `numeric` como string para no perder precisión; el
// shaping trabaja con números, así que la conversión se hace aquí y en un
// solo lugar.
function num(v: string | number | null | undefined): number {
  return Number(v ?? 0);
}

function mapearCabecera(f: FilaCosteo): CabeceraPu {
  return {
    empresaNombre: f.empresa_nombre,
    proyectoNombre: f.proyecto_nombre,
    codigo: f.codigo,
    concepto: f.concepto,
    unidad: f.unidad,
    esAuxiliar: f.es_auxiliar,
    estado: f.estado,
    creadoPorNombre: f.creado_por_nombre,
    factorNombre: f.factor_nombre,
    indirectosPct: num(f.indirectos_pct),
    financiamientoPct: num(f.financiamiento_pct),
    utilidadPct: num(f.utilidad_pct),
    cargosAdicionalesPct: num(f.cargos_adicionales_pct),
    costoDirecto: num(f.costo_directo),
    importeIndirectos: num(f.importe_indirectos),
    importeFinanciamiento: num(f.importe_financiamiento),
    importeUtilidad: num(f.importe_utilidad),
    importeCargosAdicionales: num(f.importe_cargos_adicionales),
    precioUnitario: num(f.precio_unitario),
    insumosSinPrecio: num(f.insumos_sin_precio),
  };
}

function mapearRenglon(f: FilaDetalle): RenglonPu {
  return {
    orden: f.orden,
    baseCalculo: f.base_calculo,
    codigo: f.codigo,
    descripcion: f.descripcion,
    unidad: f.unidad,
    tipo: f.tipo,
    aportacion: num(f.aportacion),
    costoUnitario: num(f.costo_unitario),
    importe: num(f.importe),
    sinPrecio: f.sin_precio,
    proveedor: f.proveedor,
  };
}

/** Nombre de archivo seguro: el código lo escribe un usuario y acaba en una
 * cabecera HTTP, así que sólo pasan caracteres inofensivos. */
function nombreArchivo(codigo: string): string {
  const limpio = codigo.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `PU-${limpio || "analisis"}.pdf`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return respuestaCors();
  if (req.method !== "GET") return jsonError("Usa GET.", 405);

  const url = new URL(req.url);
  const analisisId = url.searchParams.get("analisis_id");
  if (!analisisId) return jsonError("Falta analisis_id.", 400);

  if (!req.headers.get("Authorization")) return jsonError("Tu sesión expiró, vuelve a entrar.", 401);

  const cliente = clienteComoUsuario(req);

  const [cabecera, detalle] = await Promise.all([
    cliente.from("v_pu_analisis_costeo").select("*").eq("analisis_id", analisisId).maybeSingle(),
    cliente.from("v_pu_analisis_detalle").select("*").eq("analisis_id", analisisId).order("orden"),
  ]);

  if (cabecera.error) return jsonError(cabecera.error.message, 400);
  if (detalle.error) return jsonError(detalle.error.message, 400);
  if (!cabecera.data) return jsonError("Ese análisis no existe o no tienes acceso.", 404);

  const tarjeta = construirTarjetaPu(
    mapearCabecera(cabecera.data as unknown as FilaCosteo),
    ((detalle.data ?? []) as unknown as FilaDetalle[]).map(mapearRenglon),
  );

  const pdf = await generarPdfTarjetaPu(tarjeta);

  // `descarga=1` fuerza el "guardar como" del navegador; sin el parámetro el
  // PDF se puede abrir en el visor de la misma pestaña.
  const disposicion = url.searchParams.get("descarga") === "1" ? "attachment" : "inline";

  return new Response(pdf, {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposicion}; filename="${nombreArchivo(tarjeta.cabecera.codigo)}"`,
      // Un PU en borrador cambia de precio con cada cotización: que nadie lo
      // guarde en caché y enseñe un precio viejo.
      "Cache-Control": "no-store",
    },
  });
});
