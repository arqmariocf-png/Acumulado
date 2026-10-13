// Web service de Descarga Masiva del SAT (versión 1.5, vigente desde 2025:
// SolicitaDescargaEmitidos / SolicitaDescargaRecibidos). Módulo puro: arma
// los sobres SOAP firmados (la firma y el SHA-1 se inyectan, para probarlo en
// node sin la e.firma), lee las respuestas y convierte cada XML de CFDI en el
// renglón de `cfdi` que ya usa la carga manual de Compac.
//
// Formato de los sobres: el mismo de la librería de referencia
// phpcfdi/sat-ws-descarga-masiva (digest SHA-1 del nodo sin espacios,
// SignedInfo canónico, firma RSA-SHA1).

export const URL_AUTENTICACION = "https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/Autenticacion/Autenticacion.svc";
export const URL_SOLICITUD = "https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescargaService.svc";
export const URL_VERIFICACION = "https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/VerificaSolicitudDescargaService.svc";
export const URL_DESCARGA = "https://cfdidescargamasiva.clouda.sat.gob.mx/DescargaMasivaService.svc";

export const ACCION = {
  autentica: "http://DescargaMasivaTerceros.gob.mx/IAutenticacion/Autentica",
  emitidos: "http://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService/SolicitaDescargaEmitidos",
  recibidos: "http://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService/SolicitaDescargaRecibidos",
  verifica: "http://DescargaMasivaTerceros.sat.gob.mx/IVerificaSolicitudDescargaService/VerificaSolicitudDescarga",
  descarga: "http://DescargaMasivaTerceros.sat.gob.mx/IDescargaMasivaTercerosService/Descargar",
};

const NS_DES = "http://DescargaMasivaTerceros.sat.gob.mx";
const NS_DSIG = "http://www.w3.org/2000/09/xmldsig#";
const NS_U = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd";
const NS_O = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";
const X509 = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3";

/** Lo que pone la e.firma: SHA-1 en base64, firma RSA-SHA1 en base64 y datos del certificado. */
export interface Firmador {
  sha1Base64(texto: string): string;
  firmarBase64(texto: string): string;
  certificadoBase64: string;
  /** Emisor del certificado como texto RFC 4514 (CN=…,O=…). */
  emisorNombre: string;
  /** Número de serie del certificado en decimal. */
  numeroSerie: string;
}

export function escXml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function desescapar(t: string): string {
  return t
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** Atributos de una etiqueta de apertura (sin prefijos de espacio de nombres en la clave). */
export function atributos(etiqueta: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const m of etiqueta.matchAll(/([\w.:-]+)\s*=\s*"([^"]*)"/g)) {
    const clave = m[1].includes(":") ? m[1].split(":").pop()! : m[1];
    if (!(clave in r)) r[clave] = desescapar(m[2]);
  }
  return r;
}

function atributosOrdenados(attrs: Record<string, string | null | undefined>): string {
  return Object.keys(attrs)
    .filter((k) => attrs[k] != null && attrs[k] !== "")
    .sort()
    .map((k) => `${k}="${escXml(String(attrs[k]))}"`)
    .join(" ");
}

function signedInfo(digest: string, uri: string, exclusivo: boolean): string {
  const c14n = exclusivo ? "http://www.w3.org/2001/10/xml-exc-c14n#" : "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
  const transform = exclusivo ? "http://www.w3.org/2001/10/xml-exc-c14n#" : "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
  return (
    `<SignedInfo xmlns="${NS_DSIG}">` +
    `<CanonicalizationMethod Algorithm="${c14n}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>` +
    `<Reference URI="${uri}"><Transforms><Transform Algorithm="${transform}"></Transform></Transforms>` +
    `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod>` +
    `<DigestValue>${digest}</DigestValue></Reference></SignedInfo>`
  );
}

/** Firma "envuelta" de las peticiones (solicitud, verificación, descarga). */
function firmaEnvuelta(f: Firmador, nodoADigerir: string): string {
  const si = signedInfo(f.sha1Base64(nodoADigerir), "", false);
  return (
    `<Signature xmlns="${NS_DSIG}">${si}<SignatureValue>${f.firmarBase64(si)}</SignatureValue>` +
    `<KeyInfo><X509Data><X509IssuerSerial><X509IssuerName>${escXml(f.emisorNombre)}</X509IssuerName>` +
    `<X509SerialNumber>${f.numeroSerie}</X509SerialNumber></X509IssuerSerial>` +
    `<X509Certificate>${f.certificadoBase64}</X509Certificate></X509Data></KeyInfo></Signature>`
  );
}

function fechaSat(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export function sobreAutenticacion(f: Firmador, ahora: Date, tokenId: string): string {
  const creado = fechaSat(ahora);
  const vence = fechaSat(new Date(ahora.getTime() + 5 * 60 * 1000));
  const timestamp = `<u:Timestamp xmlns:u="${NS_U}" u:Id="_0"><u:Created>${creado}</u:Created><u:Expires>${vence}</u:Expires></u:Timestamp>`;
  const si = signedInfo(f.sha1Base64(timestamp), "#_0", true);
  const firma =
    `<Signature xmlns="${NS_DSIG}">${si}<SignatureValue>${f.firmarBase64(si)}</SignatureValue>` +
    `<KeyInfo><o:SecurityTokenReference><o:Reference URI="#${tokenId}" ValueType="${X509}"/></o:SecurityTokenReference></KeyInfo></Signature>`;
  return (
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:u="${NS_U}"><s:Header>` +
    `<o:Security xmlns:o="${NS_O}" s:mustUnderstand="1">` +
    `<u:Timestamp u:Id="_0"><u:Created>${creado}</u:Created><u:Expires>${vence}</u:Expires></u:Timestamp>` +
    `<o:BinarySecurityToken u:Id="${tokenId}" ValueType="${X509}" EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${f.certificadoBase64}</o:BinarySecurityToken>` +
    `${firma}</o:Security></s:Header><s:Body><Autentica xmlns="http://DescargaMasivaTerceros.gob.mx"/></s:Body></s:Envelope>`
  );
}

function sobre(cuerpo: string): string {
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="${NS_DES}" xmlns:xd="${NS_DSIG}"><s:Header/><s:Body>${cuerpo}</s:Body></s:Envelope>`;
}

/** Arma el nodo de operación con su firma dentro del nodo hijo. */
function operacionFirmada(f: Firmador, operacion: string, hijo: string, attrs: string): string {
  const aDigerir = `<des:${operacion} xmlns:des="${NS_DES}"><des:${hijo} ${attrs}></des:${hijo}></des:${operacion}>`;
  return sobre(`<des:${operacion}><des:${hijo} ${attrs}>${firmaEnvuelta(f, aDigerir)}</des:${hijo}></des:${operacion}>`);
}

export type TipoCfdi = "emitido" | "recibido";

export interface ParametrosSolicitud {
  rfc: string;
  tipo: TipoCfdi;
  /** "2026-01-01T00:00:00" (hora de México, sin zona). */
  fechaInicial: string;
  fechaFinal: string;
  tipoSolicitud: "CFDI" | "Metadata";
  /** "Vigente" para CFDI (el SAT no entrega XML de cancelados recibidos). */
  estadoComprobante?: "Vigente" | "Cancelado" | "Todos" | null;
}

export function sobreSolicitud(f: Firmador, p: ParametrosSolicitud): string {
  const attrs = atributosOrdenados({
    EstadoComprobante: p.estadoComprobante ?? null,
    FechaFinal: p.fechaFinal,
    FechaInicial: p.fechaInicial,
    RfcEmisor: p.tipo === "emitido" ? p.rfc : null,
    RfcReceptor: p.tipo === "recibido" ? p.rfc : null,
    RfcSolicitante: p.rfc,
    TipoSolicitud: p.tipoSolicitud,
  });
  return operacionFirmada(f, p.tipo === "emitido" ? "SolicitaDescargaEmitidos" : "SolicitaDescargaRecibidos", "solicitud", attrs);
}

export function sobreVerificacion(f: Firmador, rfc: string, idSolicitud: string): string {
  return operacionFirmada(f, "VerificaSolicitudDescarga", "solicitud", atributosOrdenados({ IdSolicitud: idSolicitud, RfcSolicitante: rfc }));
}

export function sobreDescarga(f: Firmador, rfc: string, idPaquete: string): string {
  return operacionFirmada(f, "PeticionDescargaMasivaTercerosEntrada", "peticionDescarga", atributosOrdenados({ IdPaquete: idPaquete, RfcSolicitante: rfc }));
}

// ---------- Respuestas ----------

function etiqueta(xml: string, nombre: string): string | null {
  const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${nombre}\\b([^>]*?)/?>`));
  return m ? m[0] : null;
}

/** Falla SOAP (certificado inválido, token vencido…) como texto. */
export function fallaSoap(xml: string): string | null {
  const m = xml.match(/<(?:[\w.-]+:)?faultstring\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?faultstring>/);
  return m ? desescapar(m[1].trim()) : null;
}

export function leerToken(xml: string): string | null {
  const m = xml.match(/<(?:[\w.-]+:)?AutenticaResult\b[^>]*>([^<]+)<\//);
  return m ? m[1].trim() : null;
}

export interface RespuestaSolicitud {
  idSolicitud: string | null;
  codEstatus: string | null;
  mensaje: string | null;
}

export function leerSolicitud(xml: string): RespuestaSolicitud {
  const e = etiqueta(xml, "SolicitaDescarga(?:Emitidos|Recibidos)Result");
  const a = e ? atributos(e) : {};
  return { idSolicitud: a.IdSolicitud || null, codEstatus: a.CodEstatus ?? null, mensaje: a.Mensaje ?? fallaSoap(xml) };
}

export interface RespuestaVerificacion {
  codEstatus: string | null;
  estadoSolicitud: number | null;
  codigoEstadoSolicitud: string | null;
  numeroCfdis: number | null;
  mensaje: string | null;
  paquetes: string[];
}

export function leerVerificacion(xml: string): RespuestaVerificacion {
  const e = etiqueta(xml, "VerificaSolicitudDescargaResult");
  const a = e ? atributos(e) : {};
  const paquetes = [...xml.matchAll(/<(?:[\w.-]+:)?IdsPaquetes\b[^>]*>([^<]+)<\//g)].map((m) => m[1].trim()).filter(Boolean);
  return {
    codEstatus: a.CodEstatus ?? null,
    estadoSolicitud: a.EstadoSolicitud != null ? Number(a.EstadoSolicitud) : null,
    codigoEstadoSolicitud: a.CodigoEstadoSolicitud ?? null,
    numeroCfdis: a.NumeroCFDIs != null ? Number(a.NumeroCFDIs) : null,
    mensaje: a.Mensaje ?? fallaSoap(xml),
    paquetes,
  };
}

export function leerDescarga(xml: string): { codEstatus: string | null; mensaje: string | null; paqueteBase64: string | null } {
  const e = etiqueta(xml, "respuesta");
  const a = e ? atributos(e) : {};
  const m = xml.match(/<(?:[\w.-]+:)?Paquete\b[^>]*>([^<]*)<\//);
  return { codEstatus: a.CodEstatus ?? null, mensaje: a.Mensaje ?? fallaSoap(xml), paqueteBase64: m && m[1].trim() ? m[1].trim() : null };
}

/** Estado de la bitácora según la verificación del SAT. */
export function estadoDeVerificacion(v: RespuestaVerificacion): "en_proceso" | "terminada" | "vacia" | "error" | "rechazada" | "vencida" {
  if (v.codigoEstadoSolicitud === "5004") return "vacia";
  switch (v.estadoSolicitud) {
    case 3:
      return v.paquetes.length === 0 ? "vacia" : "terminada";
    case 4:
      return "error";
    case 5:
      return "rechazada";
    case 6:
      return "vencida";
    default:
      return "en_proceso";
  }
}

// ---------- CFDI ----------

export interface CfdiLeido {
  uuid: string;
  tipoComprobante: string;
  fecha: string | null;
  total: number;
  emisorRfc: string | null;
  emisorNombre: string | null;
  receptorRfc: string | null;
  receptorNombre: string | null;
  /** Complemento de pago: suma de Monto de cada pago y la primera FechaPago. */
  montoPagos: number | null;
  fechaPago: string | null;
}

/** Lee lo necesario de un XML de CFDI 3.3/4.0 (sin DOM). */
export function leerCfdiXml(xml: string): CfdiLeido | null {
  const comp = xml.match(/<(?:[\w.-]+:)?Comprobante\b[^>]*>/);
  const tfd = xml.match(/<(?:[\w.-]+:)?TimbreFiscalDigital\b[^>]*>/);
  if (!comp || !tfd) return null;
  const c = atributos(comp[0]);
  const uuid = (atributos(tfd[0]).UUID ?? "").trim().toUpperCase();
  if (!uuid) return null;
  const emisor = xml.match(/<cfdi:Emisor\b[^>]*>/) ?? xml.match(/<(?:[\w.-]+:)?Emisor\b[^>]*>/);
  const receptor = xml.match(/<cfdi:Receptor\b[^>]*>/) ?? xml.match(/<(?:[\w.-]+:)?Receptor\b[^>]*>/);
  const e = emisor ? atributos(emisor[0]) : {};
  const r = receptor ? atributos(receptor[0]) : {};
  const pagos = [...xml.matchAll(/<pago\d+:Pago\s[^>]*>/g)].map((m) => atributos(m[0]));
  const montoPagos = pagos.length ? Math.round(pagos.reduce((s, p) => s + Number(p.Monto ?? 0), 0) * 100) / 100 : null;
  return {
    uuid,
    tipoComprobante: (c.TipoDeComprobante ?? "").toUpperCase(),
    fecha: c.Fecha ? c.Fecha.slice(0, 10) : null,
    total: Number(c.Total ?? 0),
    emisorRfc: e.Rfc ? e.Rfc.toUpperCase() : null,
    emisorNombre: e.Nombre ?? null,
    receptorRfc: r.Rfc ? r.Rfc.toUpperCase() : null,
    receptorNombre: r.Nombre ?? null,
    montoPagos,
    fechaPago: pagos[0]?.FechaPago ? pagos[0].FechaPago.slice(0, 10) : null,
  };
}

export interface FilaCfdi {
  tipo: TipoCfdi;
  rfc: string;
  folio: string;
  total: number;
  periodo: string;
  contraparte: string | null;
  fecha: string;
  es_complemento_pago: boolean;
}

/** Renglón de `cfdi` como lo deja la carga de Compac: UUID como folio, RFC y
 * nombre de la contraparte; en complementos de pago el monto pagado y la
 * fecha de pago. null si falta lo indispensable. */
export function filaCfdi(c: CfdiLeido, tipo: TipoCfdi): FilaCfdi | null {
  const esPago = c.tipoComprobante === "P";
  const fecha = (esPago ? c.fechaPago ?? c.fecha : c.fecha) ?? null;
  const rfc = tipo === "recibido" ? c.emisorRfc : c.receptorRfc;
  if (!fecha || !rfc) return null;
  return {
    tipo,
    rfc,
    folio: c.uuid,
    total: esPago ? c.montoPagos ?? 0 : Math.round(c.total * 100) / 100,
    periodo: fecha.slice(0, 7).replace("-", ""),
    contraparte: (tipo === "recibido" ? c.emisorNombre : c.receptorNombre) ?? null,
    fecha,
    es_complemento_pago: esPago,
  };
}

// ---------- Rangos ----------

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Siguiente rango a pedir: desde 3 días antes de lo último descargado (el
 * SAT a veces timbra tarde; lo repetido se reemplaza) o desde el inicio del
 * año, hasta ayer. null si no hay nada nuevo que pedir. */
export function rangoSiguiente(ultimaFechaFinal: string | null, hoy: string, inicio = "2026-01-01"): { fechaInicial: string; fechaFinal: string } | null {
  const ayer = sumarDias(hoy, -1);
  const desde = ultimaFechaFinal ? sumarDias(ultimaFechaFinal.slice(0, 10), -3) : inicio;
  if (desde > ayer) return null;
  return { fechaInicial: `${desde < inicio ? inicio : desde}T00:00:00`, fechaFinal: `${ayer}T23:59:59` };
}
