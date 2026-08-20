// Edge function: proxy autenticado hacia la API del backoffice de Grupo Loma
// (reports.grupoloma.mx) para traer el catálogo de OC/OS y OV.
//
// Por qué existe este proxy en vez de que el frontend llame directo a la API:
// 1. La API hoy NO exige autenticación (hallazgo de seguridad, sección 7.1
//    del spec) -- cuando eso se corrija del lado del backoffice, el token
//    necesario debe vivir como secret de Supabase (BACKOFFICE_API_TOKEN),
//    nunca en el bundle del frontend.
// 2. Permite mapear la respuesta al modelo de la app (oc-ov.ts) y hacer
//    upsert directo, sin exponerle al cliente los detalles del backoffice.
//
// ESTADO: el spec no documenta el contrato exacto de la API (parámetros,
// paginación, endpoints exactos más allá de los nombres api_ocs_aut /
// api_ocs_det_aut / api_ov_aut / api_ov_det_aut, ni cómo distingue OC de OS
// en la respuesta). Esta función asume un contrato razonable (GET con
// query param empresa=<codigo>, respuesta JSON array) marcado con TODO
// donde hace falta confirmar contra la API real antes de usarse.
//
// MODO DIAGNÓSTICO: para no tener que adivinar el mapeo a ciegas (como pasó
// con los PDF de banco, donde primero se validó contra un archivo real antes
// de escribir el parser final), este endpoint acepta `modo: 'diagnostico'`.
// En ese modo NO mapea ni inserta nada -- solo hace la llamada real a la API
// del backoffice y regresa la respuesta cruda (status, headers, texto, y si
// parece JSON, las claves del primer registro) para poder ver el contrato
// real y ajustar oc-ov.ts con datos reales, no supuestos.
//
// POST body: { recurso: 'oc' | 'ov', empresaId: string, modo?: 'diagnostico' }

import { clienteServicio, obtenerPerfilAutenticado, puedeEscribirEnEmpresa } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";
import { mapearOrdenCompraDesdeApi, mapearOrdenVentaDesdeApi } from "../_shared/ingesta/oc-ov.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const { recurso, empresaId, modo } = await req.json();
    if (recurso !== "oc" && recurso !== "ov") return jsonResponse({ error: "recurso debe ser 'oc' u 'ov'" }, 400);
    if (!empresaId) return jsonResponse({ error: "empresaId es requerido" }, 400);

    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
    if (!puedeEscribirEnEmpresa(perfil, empresaId)) return jsonResponse({ error: "Sin permiso" }, 403);

    const baseUrl = Deno.env.get("BACKOFFICE_API_BASE_URL"); // TODO: confirmar valor real, ej. https://reports.grupoloma.mx/dash
    const token = Deno.env.get("BACKOFFICE_API_TOKEN"); // Vacío mientras el backoffice no exija auth (inseguro, ver sección 7.1)
    if (!baseUrl) return jsonResponse({ error: "BACKOFFICE_API_BASE_URL no está configurado" }, 500);

    const dbServicio = clienteServicio();

    // El backoffice no conoce los UUID internos de Supabase -- usa el
    // "codigo" corto de la empresa (mismo campo que ya se usa para casar la
    // columna "Empresa" de las cargas manuales). TODO: confirmar que la API
    // real espera justo este valor y no el RFC u otro identificador.
    const { data: empresaRow, error: errEmpresa } = await dbServicio.from("empresas").select("codigo, rfc, nombre").eq("id", empresaId).single();
    if (errEmpresa || !empresaRow) return jsonResponse({ error: "No se encontró la empresa" }, 400);

    // TODO: confirmar el endpoint y los query params reales contra la API.
    const endpoint = recurso === "oc" ? "api_ocs_det_aut" : "api_ov_det_aut";
    const url = `${baseUrl.replace(/\/$/, "")}/${endpoint}?empresa=${encodeURIComponent(empresaRow.codigo)}`;

    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const respuesta = await fetch(url, { headers });
    const textoCrudo = await respuesta.text();

    if (modo === "diagnostico") {
      let parseable = false;
      let camposDelPrimerRegistro: string[] | null = null;
      let cantidadDeRegistros: number | null = null;
      try {
        const parsed = JSON.parse(textoCrudo);
        parseable = true;
        const items = Array.isArray(parsed) ? parsed : (parsed.data ?? parsed.results ?? null);
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
    }

    if (!respuesta.ok) {
      return jsonResponse({ error: `La API del backoffice respondió ${respuesta.status}` }, 502);
    }
    const payload = JSON.parse(textoCrudo);
    const items: Record<string, unknown>[] = Array.isArray(payload) ? payload : (payload.data ?? payload.results ?? []);

    let insertados = 0;
    const errores: string[] = [];

    if (recurso === "oc") {
      const filas = items
        .map(mapearOrdenCompraDesdeApi)
        .filter((o) => {
          if (!o.idOrden) {
            errores.push("Registro sin Id_Orden, se descarta");
            return false;
          }
          return true;
        })
        .map((o) => ({
          id_orden: o.idOrden,
          tipo: o.tipo,
          empresa_id: empresaId,
          proyecto: o.proyecto,
          proveedor: o.proveedor,
          total: o.total,
          fecha_creacion: o.fechaCreacion,
          fuente: "api",
        }));
      if (filas.length > 0) {
        const { error, count } = await dbServicio.from("ordenes_compra").upsert(filas, { onConflict: "id_orden,tipo", count: "exact" });
        if (error) errores.push(error.message);
        else insertados = count ?? filas.length;
      }
    } else {
      const filas = items
        .map(mapearOrdenVentaDesdeApi)
        .filter((o) => {
          if (!o.idOv) {
            errores.push("Registro sin Id OV, se descarta");
            return false;
          }
          return true;
        })
        .map((o) => ({
          id_ov: o.idOv,
          empresa_id: empresaId,
          proyecto: o.proyecto,
          cliente: o.cliente,
          total: o.total,
          fecha_ov: o.fechaOv,
          fuente: "api",
        }));
      if (filas.length > 0) {
        const { error, count } = await dbServicio.from("ordenes_venta").upsert(filas, { onConflict: "id_ov", count: "exact" });
        if (error) errores.push(error.message);
        else insertados = count ?? filas.length;
      }
    }

    const mensaje = errores.length > 0
      ? `Catálogo cargado. ${insertados} de ${items.length} registro(s) guardados, ${errores.length} con problema -- no bloquean la carga.`
      : `Catálogo cargado. ${insertados} registro(s) guardados sin pendientes.`;

    return jsonResponse({ archivoCargado: true, mensaje, insertados, totalRecibido: items.length, errores });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
