// Descarga masiva automática de CFDI del SAT (13-oct-2026). Usa la e.firma
// que contabilidad subió por empresa (sat_efirmas + Vault) y el web service
// del SAT v1.5. Cada corrida, por empresa con e.firma:
//   1. Verifica las solicitudes abiertas; las terminadas se descargan (ZIP de
//      XML), se leen y se guardan en `cfdi` (upsert por tipo+rfc+folio+periodo,
//      igual que la carga manual) con su renglón en archivos_cargados.
//   2. Una vez al día por empresa y tipo (emitidos / recibidos) pide lo nuevo:
//      desde 3 días antes de lo último descargado (o el 1-ene-2026) hasta ayer.
// Bitácora: sat_descargas. Errores de la empresa: sat_efirmas.ultimo_error.
//
// POST { empresaId?: string }
//   - pg_cron (disparar_descarga_sat) con header x-cron-secret.
//   - O contabilidad / admin (auth_opera_sat) con su sesión: "Descargar ahora".
//
// Helpers en línea a propósito (el _shared desplegado difiere del repo); la
// parte pura vive en ./sat.ts, con pruebas en _shared/sat/.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import forge from "npm:node-forge@1.3.1";
import { unzipSync } from "npm:fflate@0.8.2";
import {
  ACCION,
  URL_AUTENTICACION,
  URL_DESCARGA,
  URL_SOLICITUD,
  URL_VERIFICACION,
  estadoDeVerificacion,
  fallaSoap,
  filaCfdi,
  leerCfdiXml,
  leerDescarga,
  leerSolicitud,
  leerToken,
  leerVerificacion,
  rangoSiguiente,
  sobreAutenticacion,
  sobreDescarga,
  sobreSolicitud,
  sobreVerificacion,
  type Firmador,
  type FilaCfdi,
  type TipoCfdi,
} from "./sat.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

/** Tiempo máximo de trabajo por corrida; lo que falte sigue en la siguiente. */
const PRESUPUESTO_MS = 110_000;

function aBinario(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

function hoyMexico(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}

const NOMBRES_OID: Record<string, string> = {
  "2.5.4.3": "CN", "2.5.4.6": "C", "2.5.4.7": "L", "2.5.4.8": "ST", "2.5.4.9": "street", "2.5.4.10": "O", "2.5.4.11": "OU",
  "2.5.4.17": "postalCode", "2.5.4.45": "x500UniqueIdentifier", "1.2.840.113549.1.9.1": "emailAddress", "1.2.840.113549.1.9.2": "unstructuredName",
};

function firmadorDe(cerBytes: Uint8Array, keyBytes: Uint8Array, password: string): Firmador {
  const cerBin = aBinario(cerBytes);
  const cert = cerBin.startsWith("-----BEGIN") ? forge.pki.certificateFromPem(cerBin) : forge.pki.certificateFromAsn1(forge.asn1.fromDer(cerBin));
  const keyBin = aBinario(keyBytes);
  const pem = keyBin.startsWith("-----BEGIN")
    ? keyBin
    : `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${(forge.util.encode64(keyBin).match(/.{1,64}/g) ?? []).join("\n")}\n-----END ENCRYPTED PRIVATE KEY-----\n`;
  const llave = forge.pki.decryptRsaPrivateKey(pem, password) as forge.pki.rsa.PrivateKey | null;
  if (!llave) throw new Error("La contraseña guardada ya no abre la llave de la e.firma; súbela de nuevo.");
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const emisor = [...cert.issuer.attributes]
    .reverse()
    .map((a) => `${a.shortName ?? NOMBRES_OID[a.type ?? ""] ?? a.type}=${forge.util.decodeUtf8(String(a.value ?? ""))}`)
    .join(",");
  return {
    sha1Base64: (t) => {
      const md = forge.md.sha1.create();
      md.update(t, "utf8");
      return forge.util.encode64(md.digest().getBytes());
    },
    firmarBase64: (t) => {
      const md = forge.md.sha1.create();
      md.update(t, "utf8");
      return forge.util.encode64(llave.sign(md));
    },
    certificadoBase64: forge.util.encode64(der),
    emisorNombre: emisor,
    numeroSerie: BigInt(`0x${cert.serialNumber}`).toString(),
  };
}

async function llamar(url: string, accion: string, xml: string, token?: string): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "text/xml; charset=utf-8", SOAPAction: accion };
  if (token) headers.Authorization = `WRAP access_token="${token}"`;
  const r = await fetch(url, { method: "POST", headers, body: xml });
  const texto = await r.text();
  if (!r.ok) throw new Error(`SAT ${r.status}: ${fallaSoap(texto) ?? texto.slice(0, 300)}`);
  return texto;
}

async function autenticar(f: Firmador): Promise<string> {
  const xml = sobreAutenticacion(f, new Date(), `uuid-${crypto.randomUUID()}-1`);
  const resp = await llamar(URL_AUTENTICACION, ACCION.autentica, xml);
  const token = leerToken(resp);
  if (!token) throw new Error(`El SAT no dio token: ${fallaSoap(resp) ?? resp.slice(0, 300)}`);
  return token;
}

interface Efirma {
  empresa_id: string;
  rfc: string;
  subido_por: string | null;
  empresas: { codigo: string; grupo_id: string } | null;
}

interface Descarga {
  id: string;
  empresa_id: string;
  tipo: TipoCfdi;
  fecha_inicial: string;
  fecha_final: string;
  id_solicitud: string | null;
  estado: string;
  paquetes: string[];
  paquetes_descargados: string[];
  cfdi_guardados: number;
  intentos: number;
  solicitada_por: string | null;
}

async function guardarPaquete(
  db: SupabaseClient,
  ef: Efirma,
  d: Descarga,
  paquete: string,
  zip: Uint8Array,
): Promise<number> {
  const archivos = unzipSync(zip);
  const filas = new Map<string, FilaCfdi>();
  let ilegibles = 0;
  for (const [nombre, contenido] of Object.entries(archivos)) {
    if (!nombre.toLowerCase().endsWith(".xml")) continue;
    const leido = leerCfdiXml(new TextDecoder("utf-8").decode(contenido));
    const fila = leido ? filaCfdi(leido, d.tipo) : null;
    if (!fila) {
      ilegibles++;
      continue;
    }
    filas.set(`${fila.tipo}|${fila.rfc}|${fila.folio}|${fila.periodo}`, fila);
  }
  const ruta = `sat/${ef.empresa_id}/descargas/${d.tipo}/${paquete}.zip`;
  await db.storage.from("cargas").upload(ruta, zip, { contentType: "application/zip", upsert: true });
  const { data: archivo, error: errArchivo } = await db
    .from("archivos_cargados")
    .insert({
      empresa_id: ef.empresa_id,
      grupo_id: ef.empresas?.grupo_id,
      tipo: d.tipo === "recibido" ? "cfdi_recibidos" : "cfdi_emitidos",
      nombre_original: `SAT descarga masiva ${d.fecha_inicial.slice(0, 10)} a ${d.fecha_final.slice(0, 10)} · ${paquete}.zip`,
      storage_path: ruta,
      cargado_por: d.solicitada_por ?? ef.subido_por,
      estado: "procesando",
    })
    .select("id")
    .single();
  if (errArchivo) throw new Error(`archivos_cargados: ${errArchivo.message}`);
  const lista = [...filas.values()].map((f) => ({ ...f, empresa_id: ef.empresa_id, archivo_id: archivo.id }));
  for (let i = 0; i < lista.length; i += 500) {
    const { error } = await db.from("cfdi").upsert(lista.slice(i, i + 500), { onConflict: "tipo,rfc,folio,periodo" });
    if (error) {
      await db.from("archivos_cargados").update({ estado: "error", detalle_error: error.message }).eq("id", archivo.id);
      throw new Error(`cfdi: ${error.message}`);
    }
  }
  await db
    .from("archivos_cargados")
    .update({
      estado: "completado",
      filas_procesadas: lista.length,
      filas_error: ilegibles,
      detalle_error: ilegibles ? `${ilegibles} XML sin UUID, fecha o RFC legible` : null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", archivo.id);
  return lista.length;
}

async function procesarEmpresa(db: SupabaseClient, ef: Efirma, inicio: number, porUsuario: string | null) {
  const resumen: Record<string, unknown> = { empresa: ef.empresas?.codigo, rfc: ef.rfc };
  const { data: cred, error: errCred } = await db.rpc("fn_sat_efirma_credenciales", { p_empresa: ef.empresa_id });
  if (errCred) throw new Error(errCred.message);
  const c = (cred as { rfc: string; cer_path: string; key_path: string; password: string | null }[])[0];
  if (!c?.password) throw new Error("Falta la contraseña de la e.firma; súbela de nuevo.");
  const [cer, key] = await Promise.all([db.storage.from("cargas").download(c.cer_path), db.storage.from("cargas").download(c.key_path)]);
  if (cer.error || key.error) throw new Error("No se pudieron leer los archivos de la e.firma.");
  const f = firmadorDe(new Uint8Array(await cer.data.arrayBuffer()), new Uint8Array(await key.data.arrayBuffer()), c.password);
  let token = await autenticar(f);
  let tokenEn = Date.now();
  const vigente = async () => {
    if (Date.now() - tokenEn > 4 * 60 * 1000) {
      token = await autenticar(f);
      tokenEn = Date.now();
    }
    return token;
  };

  // 1. Solicitudes abiertas.
  const { data: abiertas } = await db
    .from("sat_descargas")
    .select("*")
    .eq("empresa_id", ef.empresa_id)
    .in("estado", ["solicitada", "en_proceso"])
    .order("created_at");
  const verificadas: unknown[] = [];
  for (const d of (abiertas ?? []) as Descarga[]) {
    if (Date.now() - inicio > PRESUPUESTO_MS) break;
    const v = leerVerificacion(await llamar(URL_VERIFICACION, ACCION.verifica, sobreVerificacion(f, ef.rfc, d.id_solicitud!), await vigente()));
    const estado = estadoDeVerificacion(v);
    const cambios: Record<string, unknown> = {
      intentos: d.intentos + 1,
      numero_cfdis: v.numeroCfdis,
      mensaje: [v.codigoEstadoSolicitud, v.mensaje].filter(Boolean).join(" · ") || null,
      updated_at: new Date().toISOString(),
    };
    if (estado === "terminada") {
      const paquetes = v.paquetes;
      const hechos = new Set(d.paquetes_descargados);
      let guardados = d.cfdi_guardados;
      for (const p of paquetes) {
        if (hechos.has(p)) continue;
        if (Date.now() - inicio > PRESUPUESTO_MS) break;
        const r = leerDescarga(await llamar(URL_DESCARGA, ACCION.descarga, sobreDescarga(f, ef.rfc, p), await vigente()));
        if (!r.paqueteBase64) throw new Error(`Paquete ${p}: ${r.codEstatus ?? ""} ${r.mensaje ?? "vacío"}`);
        const zip = Uint8Array.from(atob(r.paqueteBase64), (ch) => ch.charCodeAt(0));
        guardados += await guardarPaquete(db, ef, d, p, zip);
        hechos.add(p);
        await db.from("sat_descargas").update({ paquetes_descargados: [...hechos], cfdi_guardados: guardados, updated_at: new Date().toISOString() }).eq("id", d.id);
      }
      const completa = paquetes.every((p) => hechos.has(p));
      Object.assign(cambios, {
        paquetes,
        paquetes_descargados: [...hechos],
        cfdi_guardados: guardados,
        estado: completa ? "descargada" : "en_proceso",
        terminada_en: completa ? new Date().toISOString() : null,
      });
    } else {
      cambios.estado = estado;
      if (estado !== "en_proceso") cambios.terminada_en = new Date().toISOString();
    }
    await db.from("sat_descargas").update(cambios).eq("id", d.id);
    verificadas.push({ tipo: d.tipo, estado: cambios.estado, cfdi: cambios.numero_cfdis, mensaje: cambios.mensaje });
  }
  resumen.verificadas = verificadas;

  // 2. Solicitudes nuevas (una por día por tipo).
  const hoy = hoyMexico();
  const nuevas: unknown[] = [];
  for (const tipo of ["recibido", "emitido"] as TipoCfdi[]) {
    const { data: previas } = await db
      .from("sat_descargas")
      .select("estado, fecha_final, created_at, mensaje")
      .eq("empresa_id", ef.empresa_id)
      .eq("tipo", tipo)
      .order("created_at", { ascending: false })
      .limit(50);
    const filas = (previas ?? []) as { estado: string; fecha_final: string; created_at: string; mensaje: string | null }[];
    const pendiente = filas.some((x) => ["pendiente", "solicitada", "en_proceso"].includes(x.estado));
    // "404 · Error no controlado" es falla del SAT: se reintenta en la siguiente corrida.
    const deHoy = filas.some(
      (x) =>
        new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date(x.created_at)) === hoy &&
        !(x.estado === "error" && (x.mensaje ?? "").startsWith("404")),
    );
    if (pendiente || deHoy) continue;
    const ultima = filas.filter((x) => x.estado === "descargada" || x.estado === "vacia").map((x) => x.fecha_final).sort().pop() ?? null;
    const rango = rangoSiguiente(ultima, hoy);
    if (!rango) continue;
    const p = { rfc: ef.rfc, tipo, ...rango, tipoSolicitud: "CFDI" as const, estadoComprobante: "Vigente" as const };
    const s = leerSolicitud(await llamar(URL_SOLICITUD, tipo === "emitido" ? ACCION.emitidos : ACCION.recibidos, sobreSolicitud(f, p), await vigente()));
    const aceptada = s.codEstatus === "5000" && !!s.idSolicitud;
    await db.from("sat_descargas").insert({
      empresa_id: ef.empresa_id,
      tipo,
      fecha_inicial: rango.fechaInicial,
      fecha_final: rango.fechaFinal,
      id_solicitud: s.idSolicitud,
      estado: aceptada ? "solicitada" : "error",
      mensaje: [s.codEstatus, s.mensaje].filter(Boolean).join(" · ") || null,
      solicitada_por: porUsuario,
      terminada_en: aceptada ? null : new Date().toISOString(),
    });
    nuevas.push({ tipo, desde: rango.fechaInicial, hasta: rango.fechaFinal, cod: s.codEstatus, mensaje: s.mensaje });
  }
  resumen.nuevas = nuevas;
  return resumen;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const inicio = Date.now();
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let porUsuario: string | null = null;
    const secreto = req.headers.get("x-cron-secret");
    if (secreto) {
      const { data } = await db.from("config_sistema").select("valor").eq("clave", "cron_secret").maybeSingle();
      if (!data?.valor || data.valor !== secreto) return json({ error: "No autorizado" }, 401);
    } else {
      const usuario = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      });
      const { data: { user } } = await usuario.auth.getUser();
      if (!user) return json({ error: "No autenticado" }, 401);
      const { data: opera } = await usuario.rpc("auth_opera_sat");
      if (opera !== true) return json({ error: "Solo contabilidad o el administrador descargan del SAT." }, 403);
      porUsuario = user.id;
    }

    const cuerpo = (await req.json().catch(() => ({}))) as { empresaId?: string };
    let q = db.from("sat_efirmas").select("empresa_id, rfc, subido_por, empresas(codigo, grupo_id)");
    if (cuerpo.empresaId) q = q.eq("empresa_id", cuerpo.empresaId);
    const { data: efirmas, error } = await q;
    if (error) return json({ error: error.message }, 500);

    const resultados: unknown[] = [];
    for (const ef of (efirmas ?? []) as unknown as Efirma[]) {
      if (Date.now() - inicio > PRESUPUESTO_MS) {
        resultados.push({ empresa: ef.empresas?.codigo, pendiente: "sin tiempo; sigue en la próxima corrida" });
        continue;
      }
      try {
        resultados.push(await procesarEmpresa(db, ef, inicio, porUsuario));
        await db.from("sat_efirmas").update({ ultima_descarga_en: new Date().toISOString(), ultimo_error: null }).eq("empresa_id", ef.empresa_id);
      } catch (e) {
        const mensaje = (e as Error).message;
        resultados.push({ empresa: ef.empresas?.codigo, error: mensaje });
        await db.from("sat_efirmas").update({ ultimo_error: mensaje.slice(0, 500) }).eq("empresa_id", ef.empresa_id);
      }
    }
    return json({ ok: true, segundos: Math.round((Date.now() - inicio) / 1000), resultados });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
