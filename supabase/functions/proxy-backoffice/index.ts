// Edge function: proxy autenticado hacia la API del backoffice de Grupo Loma
// (reports.grupoloma.mx) -- SOLO modo diagnóstico (inspeccionar la respuesta
// cruda para un empresaId, sin guardar nada).
//
// La sincronización real del catálogo OC/OS y OV ya no pasa por aquí: usa
// sync-catalogo-oc-ov (o directo public.sincronizar_catalogo_oc_ov() por
// SQL), porque se confirmó contra la API real (2026-08-25) que los
// endpoints "_aut" devuelven las 8 empresas de una sola vez, sin filtrar por
// el query param `empresa` -- este proxy, si se le pedía insertar para UNA
// empresa, terminaba atribuyéndole a esa empresa los registros de las OTRAS
// 7 también. Se quitó ese camino a propósito en vez de dejarlo como código
// muerto peligroso.
//
// POST body: { recurso: 'oc' | 'ov', empresaId: string, modo: 'diagnostico' }

import { clienteServicio, obtenerPerfilAutenticado, puedeEscribirEnEmpresa } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const { recurso, empresaId, modo } = await req.json();
    if (recurso !== "oc" && recurso !== "ov") return jsonResponse({ error: "recurso debe ser 'oc' u 'ov'" }, 400);
    if (!empresaId) return jsonResponse({ error: "empresaId es requerido" }, 400);
    if (modo !== "diagnostico") {
      return jsonResponse(
        { error: "Este endpoint solo soporta modo: 'diagnostico'. Para sincronizar el catálogo real usa sync-catalogo-oc-ov (trae las 8 empresas de una sola vez)." },
        400,
      );
    }

    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    if (!puedeEscribirEnEmpresa(perfil, empresaId)) return jsonResponse({ error: "Sin permiso" }, 403);

    const baseUrl = Deno.env.get("BACKOFFICE_API_BASE_URL");
    const token = Deno.env.get("BACKOFFICE_API_TOKEN"); // Vacío mientras el backoffice no exija auth.
    if (!baseUrl) return jsonResponse({ error: "BACKOFFICE_API_BASE_URL no está configurado" }, 500);

    const dbServicio = clienteServicio();
    const { data: empresaRow, error: errEmpresa } = await dbServicio.from("empresas").select("codigo, rfc, nombre").eq("id", empresaId).single();
    if (errEmpresa || !empresaRow) return jsonResponse({ error: "No se encontró la empresa" }, 400);

    const endpoint = recurso === "oc" ? "api_ocs_aut" : "api_ov_aut";
    const url = `${baseUrl.replace(/\/$/, "")}/${endpoint}?empresa=${encodeURIComponent(empresaRow.codigo)}`;

    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const respuesta = await fetch(url, { headers });
    const textoCrudo = await respuesta.text();

    let parseable = false;
    let camposDelPrimerRegistro: string[] | null = null;
    let cantidadDeRegistros: number | null = null;
    try {
      const parsed = JSON.parse(textoCrudo);
      parseable = true;
      const items = Array.isArray(parsed) ? parsed : (parsed.ordersProject ?? parsed.ordenVentaDashModel ?? parsed.data ?? parsed.results ?? null);
      if (Array.isArray(items)) {
        cantidadDeRegistros = items.length;
        if (items.length > 0) camposDelPrimerRegistro = Object.keys(items[0]);
      }
    } catch {
      // No es JSON -- se regresa el texto crudo tal cual para inspección.
    }
    return jsonResponse({
      diagnostico: true,
      urlLlamada: url,
      empresaEnviada: { codigo: empresaRow.codigo, rfc: empresaRow.rfc, nombre: empresaRow.nombre },
      statusHttp: respuesta.status,
      contentType: respuesta.headers.get("content-type"),
      pareceJson: parseable,
      cantidadDeRegistros,
      camposDelPrimerRegistro,
      textoCrudo: textoCrudo.slice(0, 5000),
    });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
