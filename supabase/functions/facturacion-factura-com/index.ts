// Facturación con factura.com (23-nov-2026, Mario: "conexión con factura.com
// para que las órdenes de venta se agreguen de inmediato y podamos facturar
// con un clic").
//
// POST JSON { accion, ... } con la sesión de quien factura (auth_opera_facturacion):
//   credenciales  { empresa_id, entorno, api_key, secret_key } → prueba las llaves
//                 contra /v4/series y las guarda en Vault (fn_facturacion_credenciales_guardar).
//   quitar        { empresa_id } → deja la empresa sin llaves.
//   series        { empresa_id } → las series de la cuenta (para elegir con cuál timbrar).
//   facturar      { orden_venta_id, cliente_id?, receptor {rfc, razon_social, regimen_fiscal,
//                   codigo_postal, email, uso_cfdi}, conceptos [{linea_id, descripcion,
//                   clave_prod_serv, clave_unidad, unidad, cantidad, precio, iva}],
//                   forma_pago, metodo_pago, condiciones_pago, comentarios, enviar_correo }
//                 → cliente en factura.com (busca por RFC o lo crea), /v4/cfdi40/create,
//                 XML y PDF a Storage (cargas/facturas/<empresa>/…), fn_factura_registrar
//                 (facturas_emitidas + cfdi emitido + memoria de claves SAT).
//   cancelar      { factura_id, motivo, folio_sustituto? } → /v4/cfdi40/{uid}/cancel.
//   reenviar      { factura_id } → /v4/cfdi40/{uid}/email.
// GET ?id=<factura_id>[&tipo=pdf|xml] → { url } firmada (visor /archivo, fuente 'factura').
//
// Las llaves nunca salen al navegador. Helpers de Supabase en línea (el
// _shared desplegado difiere del repo); la parte pura va en
// ../_shared/facturacion/factura-com.ts (con pruebas).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { cabeceras, construirCfdi, cuerpoCliente, elegirClienteFacturaCom, hostDe, interpretarTimbrado, mensajeDe, revisarConceptos, revisarReceptor, totalesConceptos, type ClienteFacturaCom, type ConceptoFactura, type ReceptorDatos } from "../_shared/facturacion/factura-com.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function comoUsuario(req: Request): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
}
function servicio(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

interface Credenciales {
  entorno: string;
  api_key: string | null;
  secret_key: string | null;
  serie_id: number | null;
  serie_nombre: string | null;
  regimen_fiscal: string | null;
  lugar_expedicion: string | null;
  enviar_correo: boolean;
  clave_prod_serv_default: string | null;
  clave_unidad_default: string | null;
}

class ErrorUsuario extends Error {
  status: number;
  constructor(m: string, status = 400) {
    super(m);
    this.status = status;
  }
}

async function llamar(host: string, llaves: { api: string; secret: string }, metodo: "GET" | "POST", ruta: string, cuerpo?: unknown): Promise<{ status: number; json: Record<string, unknown> | null; texto: string; contentType: string }> {
  const r = await fetch(`${host}${ruta}`, { method: metodo, headers: cabeceras(llaves.api, llaves.secret), body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const contentType = r.headers.get("content-type") ?? "";
  const texto = await r.text();
  let j: Record<string, unknown> | null = null;
  try {
    j = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    j = null;
  }
  return { status: r.status, json: j, texto, contentType };
}

async function series(host: string, llaves: { api: string; secret: string }) {
  const r = await llamar(host, llaves, "GET", "/v4/series");
  if (r.status === 429) throw new ErrorUsuario("factura.com limitó las peticiones; espera un minuto y vuelve a intentar.", 429);
  if (!r.json) throw new ErrorUsuario(`factura.com respondió ${r.status} sin JSON: ${r.texto.slice(0, 160)}`, 502);
  if (r.json.status !== "success") throw new ErrorUsuario(`factura.com rechazó las llaves: ${mensajeDe(r.json)}`, 400);
  const data = (r.json.data ?? []) as { SerieID: number; SerieName: string; SerieType: string; SerieDescription?: string; SerieStatus?: string }[];
  return data.map((s) => ({ id: s.SerieID, nombre: s.SerieName, tipo: s.SerieType, descripcion: s.SerieDescription ?? null, activa: (s.SerieStatus ?? "Activa") === "Activa" }));
}

async function credencialesDe(srv: SupabaseClient, empresaId: string): Promise<Credenciales> {
  const { data, error } = await srv.rpc("fn_facturacion_credenciales", { p_empresa: empresaId });
  if (error) throw new ErrorUsuario(`No pude leer la configuración: ${error.message}`, 500);
  const c = (Array.isArray(data) ? data[0] : data) as Credenciales | undefined;
  if (!c || !c.api_key || !c.secret_key) throw new ErrorUsuario("Esta empresa no tiene llaves de factura.com. Captúralas en Contabilidad › Facturación.", 400);
  return c;
}

/** Cliente de factura.com para el receptor: por RFC (misma razón social), si no se crea. */
async function clienteFacturaCom(host: string, llaves: { api: string; secret: string }, receptor: ReceptorDatos, uidGuardado: string | null): Promise<{ uid: string; creado: boolean }> {
  if (uidGuardado) {
    const r = await llamar(host, llaves, "GET", `/v1/clients/${encodeURIComponent(uidGuardado)}`);
    const d = (r.json?.Data ?? null) as ClienteFacturaCom | null;
    if (r.json?.status === "success" && d && String(d.RFC ?? "").toUpperCase() === receptor.rfc.toUpperCase()) {
      // Datos fiscales cambiaron (CP, régimen): se actualizan allá.
      if (String(d.CodigoPostal ?? "") !== receptor.codigo_postal || String(d.RegimenId ?? "") !== receptor.regimen_fiscal) {
        await llamar(host, llaves, "POST", `/v1/clients/${encodeURIComponent(uidGuardado)}/update`, cuerpoCliente(receptor));
      }
      return { uid: uidGuardado, creado: false };
    }
  }
  const lista = await llamar(host, llaves, "GET", `/v1/clients/rfc/${encodeURIComponent(receptor.rfc.toUpperCase())}`);
  const candidatos = ((lista.json?.Data ?? lista.json?.data ?? []) as ClienteFacturaCom[]) ?? [];
  const elegido = Array.isArray(candidatos) ? elegirClienteFacturaCom(candidatos, receptor.razon_social, receptor.rfc) : null;
  if (elegido) return { uid: elegido.UID, creado: false };
  const alta = await llamar(host, llaves, "POST", "/v1/clients/create", cuerpoCliente(receptor));
  const creado = (alta.json?.Data ?? null) as ClienteFacturaCom | null;
  if (alta.json?.status !== "success" || !creado?.UID) {
    throw new ErrorUsuario(`factura.com no dio de alta al cliente: ${alta.json ? mensajeDe(alta.json) : alta.texto.slice(0, 200)}`, 400);
  }
  return { uid: creado.UID, creado: true };
}

/** Baja XML y PDF del CFDI a Storage; si algo falla, se sigue sin archivo. */
async function guardarArchivos(srv: SupabaseClient, host: string, llaves: { api: string; secret: string }, uid: string, empresaId: string, uuid: string): Promise<{ xml_path: string | null; pdf_path: string | null }> {
  const base = `facturas/${empresaId}/${uuid}`;
  const out: { xml_path: string | null; pdf_path: string | null } = { xml_path: null, pdf_path: null };
  for (const tipo of ["xml", "pdf"] as const) {
    try {
      const r = await fetch(`${host}/v4/cfdi40/${encodeURIComponent(uid)}/${tipo}`, { headers: cabeceras(llaves.api, llaves.secret) });
      if (!r.ok) continue;
      const ct = r.headers.get("content-type") ?? "";
      let bytes: Uint8Array;
      let contentType = tipo === "xml" ? "application/xml" : "application/pdf";
      if (ct.includes("application/json")) {
        // Algunas cuentas regresan {data: "<base64>"} o {data: "<xml…>"}
        const j = (await r.json()) as Record<string, unknown>;
        const dato = (j.data ?? j.xml ?? j.pdf ?? j.file ?? "") as string;
        if (!dato || typeof dato !== "string") continue;
        if (tipo === "xml" && dato.trim().startsWith("<")) bytes = new TextEncoder().encode(dato);
        else bytes = Uint8Array.from(atob(dato.replace(/^data:[^,]+,/, "")), (c) => c.charCodeAt(0));
      } else {
        bytes = new Uint8Array(await r.arrayBuffer());
        if (ct.includes("xml") || ct.includes("pdf")) contentType = ct.split(";")[0];
      }
      const ruta = `${base}.${tipo}`;
      const { error } = await srv.storage.from("cargas").upload(ruta, bytes, { contentType, upsert: true });
      if (!error) out[`${tipo}_path`] = ruta;
    } catch {
      // sin archivo; se puede volver a bajar después
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const usuario = comoUsuario(req);
    const { data: auth } = await usuario.auth.getUser();
    if (!auth?.user) return json({ error: "No autenticado" }, 401);
    const { data: opera } = await usuario.rpc("auth_opera_facturacion");
    if (opera !== true) return json({ error: "Sin permiso para facturar (contabilidad, dirección, corporativo o admin)." }, 403);
    const srv = servicio();
    const { data: perfil } = await usuario.from("profiles").select("id, nombre").eq("id", auth.user.id).maybeSingle();

    // GET: liga firmada del PDF/XML para el visor /archivo
    if (req.method === "GET") {
      const url = new URL(req.url);
      let id = url.searchParams.get("id") ?? "";
      let tipo = url.searchParams.get("tipo") ?? "pdf";
      if (id.endsWith(":xml")) {
        id = id.slice(0, -4);
        tipo = "xml";
      }
      const { data: f, error } = await usuario.from("facturas_emitidas").select("id, empresa_id, proveedor_uid, uuid, xml_path, pdf_path, entorno").eq("id", id).maybeSingle();
      if (error || !f) return json({ error: "Factura no encontrada o sin acceso" }, 404);
      let ruta = tipo === "xml" ? f.xml_path : f.pdf_path;
      if (!ruta && f.proveedor_uid && f.uuid) {
        const c = await credencialesDe(srv, f.empresa_id);
        const archivos = await guardarArchivos(srv, hostDe(c.entorno), { api: c.api_key!, secret: c.secret_key! }, f.proveedor_uid, f.empresa_id, f.uuid);
        if (archivos.xml_path || archivos.pdf_path) await srv.from("facturas_emitidas").update({ xml_path: archivos.xml_path ?? f.xml_path, pdf_path: archivos.pdf_path ?? f.pdf_path }).eq("id", f.id);
        ruta = tipo === "xml" ? archivos.xml_path : archivos.pdf_path;
      }
      if (!ruta) return json({ error: `factura.com no entregó el ${tipo.toUpperCase()} todavía; vuelve a intentar.` }, 404);
      const { data: firmada, error: e2 } = await srv.storage.from("cargas").createSignedUrl(ruta, 300);
      if (e2 || !firmada) return json({ error: e2?.message ?? "No pude firmar la liga" }, 500);
      return json({ url: firmada.signedUrl, nombre: `${f.uuid}.${tipo}` });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const accion = String(body.accion ?? "");
    const { data: soloConsulta } = await usuario.rpc("auth_solo_consulta");
    if (soloConsulta === true && accion !== "series") return json({ error: "Cuenta de solo consulta: puedes ver la información, pero no capturar ni timbrar." }, 403);

    if (accion === "credenciales") {
      const empresaId = String(body.empresa_id ?? "");
      const entorno = body.entorno === "produccion" ? "produccion" : "sandbox";
      const apiKey = String(body.api_key ?? "").trim();
      const secretKey = String(body.secret_key ?? "").trim();
      if (!empresaId || !apiKey || !secretKey) return json({ error: "Faltan empresa, API key o secret key." }, 400);
      const { data: emp } = await usuario.from("empresas").select("id").eq("id", empresaId).maybeSingle();
      if (!emp) return json({ error: "Empresa fuera de tu alcance." }, 403);
      const lista = await series(hostDe(entorno), { api: apiKey, secret: secretKey });
      const { error } = await srv.rpc("fn_facturacion_credenciales_guardar", { p_empresa: empresaId, p_entorno: entorno, p_api_key: apiKey, p_secret_key: secretKey, p_por: auth.user.id, p_por_nombre: perfil?.nombre ?? null });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, series: lista });
    }

    if (accion === "quitar") {
      const empresaId = String(body.empresa_id ?? "");
      const { data: emp } = await usuario.from("empresas").select("id").eq("id", empresaId).maybeSingle();
      if (!emp) return json({ error: "Empresa fuera de tu alcance." }, 403);
      const { error } = await srv.rpc("fn_facturacion_credenciales_quitar", { p_empresa: empresaId });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (accion === "series") {
      const empresaId = String(body.empresa_id ?? "");
      const { data: emp } = await usuario.from("empresas").select("id").eq("id", empresaId).maybeSingle();
      if (!emp) return json({ error: "Empresa fuera de tu alcance." }, 403);
      const c = await credencialesDe(srv, empresaId);
      return json({ ok: true, entorno: c.entorno, series: await series(hostDe(c.entorno), { api: c.api_key!, secret: c.secret_key! }) });
    }

    if (accion === "facturar") {
      const ovId = String(body.orden_venta_id ?? "");
      const { data: ov, error: eOv } = await usuario.from("ordenes_venta").select("id, id_ov, empresa_id, cliente, proyecto, fecha_ov, cancelada_en, condicion_pago").eq("id", ovId).maybeSingle();
      if (eOv || !ov) return json({ error: "Orden de venta no encontrada o fuera de tu alcance." }, 404);
      if (ov.cancelada_en) return json({ error: `La ${ov.id_ov} está cancelada.` }, 400);
      const { data: previa } = await srv.from("facturas_emitidas").select("id, uuid, serie, folio").eq("orden_venta_id", ovId).eq("estado", "timbrada").maybeSingle();
      if (previa) return json({ error: `La ${ov.id_ov} ya tiene la factura ${previa.serie ?? ""}${previa.folio ?? ""} (${previa.uuid}). Cancélala primero si hay que volver a timbrar.` }, 409);

      const receptor = (body.receptor ?? {}) as Partial<ReceptorDatos>;
      const receptorLimpio: ReceptorDatos = {
        rfc: String(receptor.rfc ?? "").trim().toUpperCase(),
        razon_social: String(receptor.razon_social ?? "").trim(),
        regimen_fiscal: String(receptor.regimen_fiscal ?? "").trim().slice(0, 3),
        codigo_postal: String(receptor.codigo_postal ?? "").trim(),
        email: String(receptor.email ?? "").trim() || null,
        uso_cfdi: String(receptor.uso_cfdi ?? "").trim() || null,
        pais: "MEX",
      };
      const conceptos = ((body.conceptos ?? []) as Partial<ConceptoFactura>[]).map((c) => ({
        linea_id: c.linea_id ?? null,
        descripcion: String(c.descripcion ?? "").trim(),
        clave_prod_serv: String(c.clave_prod_serv ?? "").trim(),
        clave_unidad: String(c.clave_unidad ?? "").trim().toUpperCase(),
        unidad: String(c.unidad ?? "").trim() || "Pieza",
        cantidad: Number(c.cantidad),
        precio: Number(c.precio),
        iva: c.iva !== false,
        no_identificacion: c.no_identificacion ?? null,
      }));
      const problemas = [...revisarReceptor(receptorLimpio), ...revisarConceptos(conceptos)];
      const formaPago = String(body.forma_pago ?? "").trim();
      const metodoPago = body.metodo_pago === "PPD" ? "PPD" : "PUE";
      if (!/^\d{2}$/.test(formaPago)) problemas.push("Elige la forma de pago del SAT (01 efectivo, 03 transferencia, 99 por definir…).");
      if (problemas.length) return json({ error: problemas.join(" "), problemas }, 400);

      const c = await credencialesDe(srv, ov.empresa_id);
      if (!c.serie_id) return json({ error: "Elige la serie con la que se timbra en Contabilidad › Facturación." }, 400);
      const host = hostDe(c.entorno);
      const llaves = { api: c.api_key!, secret: c.secret_key! };

      // Cliente aquí: se guarda lo fiscal capturado (RFC, régimen, CP, correo, uso) y el UID de factura.com.
      let clienteId = String(body.cliente_id ?? "") || null;
      let uidGuardado: string | null = null;
      if (clienteId) {
        const { data: cl } = await srv.from("clientes").select("id, factura_com_uid, factura_com_entorno").eq("id", clienteId).eq("empresa_id", ov.empresa_id).maybeSingle();
        if (!cl) clienteId = null;
        else if (cl.factura_com_entorno === c.entorno) uidGuardado = cl.factura_com_uid;
      }
      const cliente = await clienteFacturaCom(host, llaves, receptorLimpio, uidGuardado);
      const datosCliente = { rfc: receptorLimpio.rfc, regimen_fiscal: receptorLimpio.regimen_fiscal, codigo_postal: receptorLimpio.codigo_postal, email: receptorLimpio.email, uso_cfdi: receptorLimpio.uso_cfdi, factura_com_uid: cliente.uid, factura_com_entorno: c.entorno, updated_at: new Date().toISOString() };
      if (clienteId) {
        await srv.from("clientes").update(datosCliente).eq("id", clienteId);
      } else {
        const { data: nuevo } = await srv.from("clientes").insert({ empresa_id: ov.empresa_id, razon_social: receptorLimpio.razon_social, activo: true, created_by: auth.user.id, ...datosCliente }).select("id").maybeSingle();
        clienteId = nuevo?.id ?? null;
      }

      const totales = totalesConceptos(conceptos);
      const peticion = construirCfdi({
        receptor_uid: cliente.uid,
        regimen_fiscal_receptor: receptorLimpio.regimen_fiscal,
        conceptos,
        uso_cfdi: receptorLimpio.uso_cfdi!,
        serie_id: c.serie_id,
        forma_pago: formaPago,
        metodo_pago: metodoPago,
        condiciones_pago: String(body.condiciones_pago ?? "").trim() || null,
        num_orden: ov.id_ov,
        comentarios: String(body.comentarios ?? "").trim() || null,
        enviar_correo: body.enviar_correo === undefined ? c.enviar_correo : body.enviar_correo === true,
        regimen_fiscal_emisor: c.regimen_fiscal,
        lugar_expedicion: c.lugar_expedicion,
      });
      const r = await llamar(host, llaves, "POST", "/v4/cfdi40/create", peticion);
      const t = interpretarTimbrado(r.json ?? { response: "error", message: `factura.com respondió ${r.status}: ${r.texto.slice(0, 300)}` });
      const base = {
        empresa_id: ov.empresa_id,
        orden_venta_id: ov.id,
        cliente_id: clienteId,
        entorno: c.entorno,
        proveedor_uid: t.uid,
        uuid: t.uuid,
        serie: t.serie,
        folio: t.folio,
        rfc_receptor: receptorLimpio.rfc,
        nombre_receptor: receptorLimpio.razon_social,
        uso_cfdi: receptorLimpio.uso_cfdi,
        forma_pago: formaPago,
        metodo_pago: metodoPago,
        subtotal: totales.subtotal,
        iva: totales.iva,
        total: totales.total,
        mensaje: t.mensaje,
        peticion: { ...peticion, Receptor: { ...(peticion.Receptor as Record<string, unknown>), RFC: receptorLimpio.rfc } },
        respuesta: r.json ?? { status: r.status, texto: r.texto.slice(0, 2000) },
        creado_por: auth.user.id,
        creado_por_nombre: perfil?.nombre ?? null,
        conceptos: conceptos.map((x) => ({ linea_id: x.linea_id, descripcion: x.descripcion, clave_prod_serv: x.clave_prod_serv, clave_unidad: x.clave_unidad, unidad: x.unidad })),
      };
      if (!t.ok) {
        await srv.rpc("fn_factura_registrar", { p: { ...base, estado: "error" } });
        return json({ error: `factura.com no timbró: ${t.mensaje}`, detalle: r.json }, 400);
      }
      const archivos = await guardarArchivos(srv, host, llaves, t.uid!, ov.empresa_id, t.uuid!);
      const { data: facturaId, error: eReg } = await srv.rpc("fn_factura_registrar", {
        p: { ...base, estado: "timbrada", fecha: (t.fecha_timbrado ?? "").slice(0, 10) || null, xml_path: archivos.xml_path, pdf_path: archivos.pdf_path },
      });
      if (eReg) return json({ ok: true, aviso: `Se timbró (${t.uuid}) pero no pude registrarla aquí: ${eReg.message}. Avísale a Mario.`, uuid: t.uuid, serie: t.serie, folio: t.folio }, 200);
      return json({ ok: true, factura_id: facturaId, uuid: t.uuid, serie: t.serie, folio: t.folio, total: totales.total, entorno: c.entorno, cliente_creado: cliente.creado, pdf: !!archivos.pdf_path, xml: !!archivos.xml_path, mensaje: t.mensaje });
    }

    if (accion === "cancelar" || accion === "reenviar") {
      const facturaId = String(body.factura_id ?? "");
      const { data: f, error } = await usuario.from("facturas_emitidas").select("id, empresa_id, proveedor_uid, uuid, estado, serie, folio, cfdi_id").eq("id", facturaId).maybeSingle();
      if (error || !f) return json({ error: "Factura no encontrada o sin acceso." }, 404);
      if (!f.proveedor_uid) return json({ error: "Esta factura no tiene UID en factura.com." }, 400);
      const c = await credencialesDe(srv, f.empresa_id);
      const host = hostDe(c.entorno);
      const llaves = { api: c.api_key!, secret: c.secret_key! };
      if (accion === "reenviar") {
        const r = await llamar(host, llaves, "GET", `/v4/cfdi40/${encodeURIComponent(f.proveedor_uid)}/email`);
        if (r.json?.response !== "success") return json({ error: r.json ? mensajeDe(r.json) : r.texto.slice(0, 200) }, 400);
        return json({ ok: true, mensaje: mensajeDe(r.json) });
      }
      if (f.estado !== "timbrada") return json({ error: "Solo se cancela una factura timbrada." }, 400);
      const motivo = String(body.motivo ?? "").trim();
      if (!/^0[1-4]$/.test(motivo)) return json({ error: "Elige el motivo de cancelación del SAT (01 a 04)." }, 400);
      const sustituto = String(body.folio_sustituto ?? "").trim();
      if (motivo === "01" && !sustituto) return json({ error: "Con el motivo 01 hay que indicar el UUID de la factura que la sustituye." }, 400);
      const cuerpo: Record<string, unknown> = { motivo };
      if (sustituto) cuerpo.folioSustituto = sustituto;
      const r = await llamar(host, llaves, "POST", `/v4/cfdi40/${encodeURIComponent(f.proveedor_uid)}/cancel`, cuerpo);
      if (r.json?.response !== "success") return json({ error: `factura.com no canceló: ${r.json ? mensajeDe(r.json) : r.texto.slice(0, 200)}`, detalle: r.json }, 400);
      const acuse = ((r.json?.respuestaapi ?? {}) as Record<string, unknown>).acuse;
      await srv.from("facturas_emitidas").update({ estado: "cancelada", cancelada_en: new Date().toISOString(), cancelada_por: auth.user.id, cancelacion_motivo: motivo, cancelacion_sustituto: sustituto || null, acuse_cancelacion: typeof acuse === "string" ? acuse : null, mensaje: mensajeDe(r.json!) }).eq("id", f.id);
      return json({ ok: true, mensaje: mensajeDe(r.json!) });
    }

    return json({ error: `Acción desconocida: ${accion}` }, 400);
  } catch (e) {
    const err = e as ErrorUsuario;
    return json({ error: err.message ?? String(e) }, err.status ?? 500);
  }
});
