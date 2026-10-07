// e.firma del SAT por empresa (Mario, 7-oct-2026): primer paso de la
// descarga masiva automática de CFDI.
//
// POST multipart/form-data: empresaId, cer (.cer), key (.key), password.
//   Valida que el .cer sea un certificado del SAT vigente, que el .key abra
//   con la contraseña y que sean pareja; que el RFC coincida con el de la
//   empresa (si no tenía, se le pone). Guarda los archivos en el bucket
//   privado "cargas" (sat/<empresa>/…) y la contraseña en Vault
//   (fn_sat_efirma_guardar). Nunca devuelve la contraseña ni los archivos.
// DELETE ?empresa=<id>: quita la e.firma (renglón, archivos y contraseña).
//
// Solo admin o quien tiene el permiso por persona 'contabilidad' (Belén):
// auth_opera_sat(), preguntado con el token de quien llama.
//
// Helpers en línea a propósito (el _shared desplegado difiere del repo).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import forge from "npm:node-forge@1.3.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const TAMANO_MAXIMO = 64 * 1024;
const RFC_RE = /[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}/;

function aBinario(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

function texto(valor: unknown): string {
  const v = String(valor ?? "");
  try {
    return forge.util.decodeUtf8(v);
  } catch {
    return v;
  }
}

function atributo(attrs: forge.pki.CertificateField[], oid: string): string | null {
  const a = attrs.find((x) => x.type === oid);
  return a ? texto(a.value) : null;
}

/** El SAT codifica el número de certificado como dígitos ASCII dentro del serial. */
function numeroCertificado(serialHex: string): string {
  const hex = serialHex.length % 2 ? `0${serialHex}` : serialHex;
  const bytes = hex.match(/../g) ?? [];
  const ascii = bytes.map((b) => parseInt(b, 16));
  if (ascii.length > 0 && ascii.every((c) => c >= 0x30 && c <= 0x39)) return String.fromCharCode(...ascii);
  return hex.toUpperCase();
}

interface DatosCertificado {
  certificado: forge.pki.Certificate;
  rfc: string;
  titular: string | null;
  numero: string;
  desde: Date;
  hasta: Date;
  pareceCsd: boolean;
}

function leerCertificado(bytes: Uint8Array): DatosCertificado {
  let cert: forge.pki.Certificate;
  try {
    const bin = aBinario(bytes);
    cert = bin.startsWith("-----BEGIN") ? forge.pki.certificateFromPem(bin) : forge.pki.certificateFromAsn1(forge.asn1.fromDer(bin));
  } catch {
    throw new Error("El archivo .cer no se pudo leer. Sube el certificado (.cer) de la e.firma tal como lo dio el SAT.");
  }
  const emisor = cert.issuer.attributes.map((a) => texto(a.value)).join(" ");
  if (!/administraci[oó]n tributaria|SAT/i.test(emisor)) {
    throw new Error("El certificado no lo emitió el SAT.");
  }
  // RFC: x500UniqueIdentifier (2.5.4.45) = "RFC / RFC del representante"; si no, serialNumber (2.5.4.5).
  const fuente = `${atributo(cert.subject.attributes, "2.5.4.45") ?? ""} ${atributo(cert.subject.attributes, "2.5.4.5") ?? ""}`.toUpperCase();
  const rfc = fuente.match(RFC_RE)?.[0];
  if (!rfc) throw new Error("No se encontró el RFC dentro del certificado.");
  const titular = atributo(cert.subject.attributes, "2.5.4.41") ?? atributo(cert.subject.attributes, "2.5.4.3");
  // El CSD (sello digital de facturas) trae unidad organizacional (sucursal) y
  // no permite cifrar; la e.firma sí. Con las dos señales se rechaza.
  const uso = cert.getExtension("keyUsage") as { dataEncipherment?: boolean; keyAgreement?: boolean } | null;
  const tieneOu = cert.subject.attributes.some((a) => a.type === "2.5.4.11");
  const pareceCsd = tieneOu && !!uso && !uso.dataEncipherment && !uso.keyAgreement;
  return {
    certificado: cert,
    rfc,
    titular: titular ? titular.trim() : null,
    numero: numeroCertificado(cert.serialNumber),
    desde: cert.validity.notBefore,
    hasta: cert.validity.notAfter,
    pareceCsd,
  };
}

function abrirLlave(bytes: Uint8Array, password: string): forge.pki.rsa.PrivateKey {
  const bin = aBinario(bytes);
  const pem = bin.startsWith("-----BEGIN")
    ? bin
    : `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${(forge.util.encode64(bin).match(/.{1,64}/g) ?? []).join("\n")}\n-----END ENCRYPTED PRIVATE KEY-----\n`;
  let llave: forge.pki.rsa.PrivateKey | null = null;
  try {
    llave = forge.pki.decryptRsaPrivateKey(pem, password) as forge.pki.rsa.PrivateKey | null;
  } catch {
    llave = null;
  }
  if (!llave) throw new Error("La contraseña no abre el archivo .key (o el archivo no es la llave privada de la e.firma).");
  return llave;
}

async function perfilDe(usuario: SupabaseClient) {
  const { data: { user } } = await usuario.auth.getUser();
  if (!user) return null;
  const { data } = await usuario.from("profiles").select("id, nombre, rol").eq("id", user.id).maybeSingle();
  return data as { id: string; nombre: string | null; rol: string } | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const usuario = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const servicio = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const perfil = await perfilDe(usuario);
    if (!perfil) return json({ error: "No autenticado" }, 401);
    const { data: opera } = await usuario.rpc("auth_opera_sat");
    if (opera !== true) return json({ error: "Solo contabilidad o el administrador suben la e.firma." }, 403);
    const { data: soloConsulta, error: errSolo } = await usuario.rpc("auth_solo_consulta");
    if (errSolo || soloConsulta === true) return json({ error: "Cuenta de solo consulta." }, 403);

    if (req.method === "DELETE") {
      const empresa = new URL(req.url).searchParams.get("empresa");
      if (!empresa) return json({ error: "empresa requerida" }, 400);
      const { data: emp } = await usuario.from("empresas").select("id").eq("id", empresa).maybeSingle();
      if (!emp) return json({ error: "Empresa no encontrada o sin permiso" }, 404);
      const { data: ant, error } = await servicio.rpc("fn_sat_efirma_quitar", { p_empresa: empresa });
      if (error) return json({ error: error.message }, 500);
      if (ant) {
        const a = ant as { id: string; cer: string; key: string };
        const { error: errDel } = await servicio.from("sat_efirmas").delete().eq("id", a.id);
        if (errDel) return json({ error: errDel.message }, 500);
        await servicio.storage.from("cargas").remove([a.cer, a.key]);
      }
      return json({ ok: true });
    }

    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

    const form = await req.formData();
    const empresaId = String(form.get("empresaId") ?? "").trim();
    const cer = form.get("cer") as File | null;
    const key = form.get("key") as File | null;
    const password = String(form.get("password") ?? "");
    if (!empresaId) return json({ error: "Elige la empresa." }, 400);
    if (!cer || cer.size === 0) return json({ error: "Falta el archivo .cer." }, 400);
    if (!key || key.size === 0) return json({ error: "Falta el archivo .key." }, 400);
    if (!password) return json({ error: "Falta la contraseña de la llave privada." }, 400);
    if (cer.size > TAMANO_MAXIMO || key.size > TAMANO_MAXIMO) return json({ error: "Los archivos de la e.firma pesan unos cuantos KB; revisa que sean el .cer y el .key." }, 400);

    const { data: empresa } = await usuario.from("empresas").select("id, codigo, nombre, rfc").eq("id", empresaId).maybeSingle();
    if (!empresa) return json({ error: "Empresa no encontrada o sin permiso" }, 404);

    const cerBytes = new Uint8Array(await cer.arrayBuffer());
    const keyBytes = new Uint8Array(await key.arrayBuffer());
    let datos: DatosCertificado;
    let llave: forge.pki.rsa.PrivateKey;
    try {
      datos = leerCertificado(cerBytes);
      if (datos.pareceCsd) throw new Error("Este certificado es un sello digital (CSD) de facturación, no la e.firma. El SAT pide la e.firma para la descarga masiva.");
      if (datos.hasta.getTime() < Date.now()) throw new Error(`La e.firma venció el ${datos.hasta.toISOString().slice(0, 10)}. Hay que renovarla en el SAT.`);
      const rfcEmpresa = String(empresa.rfc ?? "").trim().toUpperCase();
      if (rfcEmpresa && rfcEmpresa !== datos.rfc) throw new Error(`Esta e.firma es del RFC ${datos.rfc} y la empresa ${empresa.codigo} tiene el RFC ${rfcEmpresa}.`);
      llave = abrirLlave(keyBytes, password);
      const publica = datos.certificado.publicKey as forge.pki.rsa.PublicKey;
      if (llave.n.compareTo(publica.n) !== 0) throw new Error("El .key no corresponde a este .cer: son de e.firmas distintas.");
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }

    const sello = Date.now();
    const cerPath = `sat/${empresa.id}/${sello}-efirma.cer`;
    const keyPath = `sat/${empresa.id}/${sello}-efirma.key`;
    const subir = async (ruta: string, bytes: Uint8Array) =>
      servicio.storage.from("cargas").upload(ruta, bytes, { contentType: "application/octet-stream", upsert: false });
    const r1 = await subir(cerPath, cerBytes);
    if (r1.error) return json({ error: `No se pudo guardar el .cer: ${r1.error.message}` }, 500);
    const r2 = await subir(keyPath, keyBytes);
    if (r2.error) {
      await servicio.storage.from("cargas").remove([cerPath]);
      return json({ error: `No se pudo guardar el .key: ${r2.error.message}` }, 500);
    }

    const { data: anterior, error: errGuardar } = await servicio.rpc("fn_sat_efirma_guardar", {
      p_empresa: empresa.id,
      p_rfc: datos.rfc,
      p_titular: datos.titular,
      p_numero: datos.numero,
      p_desde: datos.desde.toISOString(),
      p_hasta: datos.hasta.toISOString(),
      p_cer: cerPath,
      p_key: keyPath,
      p_password: password,
      p_por: perfil.id,
      p_por_nombre: perfil.nombre,
    });
    if (errGuardar) {
      await servicio.storage.from("cargas").remove([cerPath, keyPath]);
      return json({ error: errGuardar.message }, 500);
    }
    const ant = anterior as { cer_anterior: string | null; key_anterior: string | null } | null;
    const viejos = [ant?.cer_anterior, ant?.key_anterior].filter((x): x is string => !!x && x !== cerPath && x !== keyPath);
    if (viejos.length) await servicio.storage.from("cargas").remove(viejos);

    return json({
      ok: true,
      rfc: datos.rfc,
      titular: datos.titular,
      numero_certificado: datos.numero,
      vigente_hasta: datos.hasta.toISOString(),
      rfc_nuevo_en_empresa: !empresa.rfc,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
