// Facturación con factura.com (23-nov-2026, Mario: "conexión con factura.com
// para que las órdenes de venta se agreguen de inmediato y podamos facturar
// con un clic"). Parte pura: arma el cuerpo de /v4/cfdi40/create a partir de
// la OV y los datos fiscales capturados, interpreta la respuesta y decide qué
// cliente de factura.com corresponde al receptor. Sin red ni Deno: se prueba
// con node --test. La edge `facturacion-factura-com` hace las llamadas.

export const F_PLUGIN = "9d4095c8f7ed5785cb14c0e3b033eeb8252416ed";
export const HOSTS = { sandbox: "https://sandbox.factura.com/api", produccion: "https://api.factura.com" } as const;
export type Entorno = keyof typeof HOSTS;

export function hostDe(entorno: string): string {
  return entorno === "produccion" ? HOSTS.produccion : HOSTS.sandbox;
}

export function cabeceras(apiKey: string, secretKey: string): Record<string, string> {
  return { "Content-Type": "application/json", "F-PLUGIN": F_PLUGIN, "F-Api-Key": apiKey, "F-Secret-Key": secretKey };
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r6 = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;

export interface ConceptoFactura {
  linea_id?: string | null;
  descripcion: string;
  clave_prod_serv: string;
  clave_unidad: string;
  unidad: string;
  cantidad: number;
  /** Precio unitario s/IVA. */
  precio: number;
  iva: boolean;
  no_identificacion?: string | null;
}

export interface DatosFactura {
  receptor_uid: string;
  conceptos: ConceptoFactura[];
  uso_cfdi: string;
  serie_id: number;
  forma_pago: string;
  metodo_pago: "PUE" | "PPD";
  condiciones_pago?: string | null;
  num_orden?: string | null;
  comentarios?: string | null;
  enviar_correo: boolean;
  regimen_fiscal_emisor?: string | null;
  lugar_expedicion?: string | null;
  regimen_fiscal_receptor?: string | null;
}

export interface TotalesFactura {
  subtotal: number;
  iva: number;
  total: number;
}

export function totalesConceptos(conceptos: Pick<ConceptoFactura, "cantidad" | "precio" | "iva">[]): TotalesFactura {
  let subtotal = 0;
  let iva = 0;
  for (const c of conceptos) {
    const importe = r2(c.cantidad * c.precio);
    subtotal = r2(subtotal + importe);
    if (c.iva) iva = r2(iva + r2(importe * 0.16));
  }
  return { subtotal, iva, total: r2(subtotal + iva) };
}

/** Cuerpo exacto que pide factura.com para un CFDI 4.0 de ingreso. Importes
 * con hasta 6 decimales; el IVA por concepto se calcula sobre la base
 * cantidad × precio. */
export function construirCfdi(d: DatosFactura): Record<string, unknown> {
  const Conceptos = d.conceptos.map((c) => {
    const base = r6(c.cantidad * c.precio);
    const concepto: Record<string, unknown> = {
      ClaveProdServ: c.clave_prod_serv,
      Cantidad: r6(c.cantidad),
      ClaveUnidad: c.clave_unidad,
      Unidad: c.unidad,
      ValorUnitario: r6(c.precio),
      Descripcion: c.descripcion,
      Importe: base,
      Descuento: "0",
      ObjetoImp: c.iva ? "02" : "01",
    };
    if (c.no_identificacion) concepto.NoIdentificacion = c.no_identificacion;
    if (c.iva) {
      concepto.Impuestos = { Traslados: [{ Base: base, Impuesto: "002", TipoFactor: "Tasa", TasaOCuota: "0.16", Importe: r6(base * 0.16) }], Retenidos: [], Locales: [] };
    }
    return concepto;
  });
  const cuerpo: Record<string, unknown> = {
    Receptor: d.regimen_fiscal_receptor ? { UID: d.receptor_uid, RegimenFiscalR: d.regimen_fiscal_receptor } : { UID: d.receptor_uid },
    TipoDocumento: "factura",
    Conceptos,
    UsoCFDI: d.uso_cfdi,
    Serie: d.serie_id,
    FormaPago: d.forma_pago,
    MetodoPago: d.metodo_pago,
    Moneda: "MXN",
    EnviarCorreo: d.enviar_correo,
  };
  if (d.regimen_fiscal_emisor) cuerpo.RegimenFiscal = Number(d.regimen_fiscal_emisor);
  if (d.lugar_expedicion) cuerpo.LugarExpedicion = d.lugar_expedicion;
  if (d.condiciones_pago) cuerpo.CondicionesDePago = d.condiciones_pago.slice(0, 1000);
  if (d.num_orden) cuerpo.NumOrder = d.num_orden;
  if (d.comentarios) cuerpo.Comentarios = d.comentarios;
  return cuerpo;
}

export interface RespuestaTimbrado {
  ok: boolean;
  uid: string | null;
  uuid: string | null;
  serie: string | null;
  folio: string | null;
  fecha_timbrado: string | null;
  mensaje: string;
}

/** Lee la respuesta de /v4/cfdi40/create: éxito ({response: "success", UUID,
 * uid, INV: {Serie, Folio}, SAT: {FechaTimbrado}}) o error (message puede ser
 * texto u objeto con message/messageDetail). */
export function interpretarTimbrado(r: unknown): RespuestaTimbrado {
  const j = (r ?? {}) as Record<string, unknown>;
  const ok = j.response === "success" && typeof j.UUID === "string";
  const inv = (j.INV ?? {}) as Record<string, unknown>;
  const sat = (j.SAT ?? {}) as Record<string, unknown>;
  return {
    ok,
    uid: typeof j.uid === "string" ? j.uid : typeof j.invoice_uid === "string" ? j.invoice_uid : null,
    uuid: typeof j.UUID === "string" ? j.UUID.toUpperCase() : null,
    serie: inv.Serie != null ? String(inv.Serie) : null,
    folio: inv.Folio != null ? String(inv.Folio) : null,
    fecha_timbrado: typeof sat.FechaTimbrado === "string" ? sat.FechaTimbrado : null,
    mensaje: mensajeDe(j),
  };
}

export function mensajeDe(j: Record<string, unknown>): string {
  const m = j.message;
  if (typeof m === "string") return m;
  if (m && typeof m === "object") {
    const mm = m as Record<string, unknown>;
    const partes = [mm.message, mm.messageDetail].filter((x) => typeof x === "string" && x) as string[];
    if (partes.length) return partes.join(" · ");
    // Errores de validación tipo {rfc: ["El campo rfc es requerido"]}
    const listas = Object.entries(mm)
      .filter(([, v]) => Array.isArray(v))
      .map(([k, v]) => `${k}: ${(v as unknown[]).join(", ")}`);
    if (listas.length) return listas.join(" · ");
  }
  if (typeof j.error === "string") return j.error;
  return j.response === "success" || j.status === "success" ? "ok" : "factura.com no explicó el error";
}

const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
export function rfcValido(rfc: string | null | undefined): boolean {
  return RFC_RE.test(String(rfc ?? "").trim().toUpperCase());
}

export function normalizarNombre(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[.,;:()"']/g, " ")
    .replace(/\b(S\s*A\s*(DE)?\s*C\s*V|S\s*DE\s*R\s*L\s*(DE)?\s*C\s*V|SAPI\s*(DE)?\s*C\s*V|S\s*C|A\s*C)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** La razón social como la pide factura.com: sin la forma societaria. */
export function razonSocialSinRegimen(s: string): string {
  return s
    .replace(/,?\s*(S\.?\s*A\.?\s*(DE\s*)?C\.?\s*V\.?|S\.?\s*DE\s*R\.?\s*L\.?\s*(DE\s*)?C\.?\s*V\.?|S\.?\s*A\.?\s*P\.?\s*I\.?\s*(DE\s*)?C\.?\s*V\.?|S\.?\s*C\.?|A\.?\s*C\.?)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ClienteFacturaCom {
  UID: string;
  RazonSocial?: string;
  RFC?: string;
  RegimenId?: string | number;
  CodigoPostal?: string | number;
}

/** De los clientes de factura.com con ese RFC, el que mejor empata: misma
 * razón social normalizada; si no, el único; si hay varios distintos, null
 * (se crea uno nuevo para no facturar a un nombre equivocado). */
export function elegirClienteFacturaCom(lista: ClienteFacturaCom[], razonSocial: string, rfc: string): ClienteFacturaCom | null {
  const delRfc = lista.filter((c) => String(c.RFC ?? "").toUpperCase() === rfc.toUpperCase());
  if (delRfc.length === 0) return null;
  const n = normalizarNombre(razonSocial);
  const exacto = delRfc.find((c) => normalizarNombre(c.RazonSocial) === n);
  if (exacto) return exacto;
  return delRfc.length === 1 ? delRfc[0] : null;
}

export interface ReceptorDatos {
  rfc: string;
  razon_social: string;
  regimen_fiscal: string;
  codigo_postal: string;
  email?: string | null;
  uso_cfdi?: string | null;
  pais?: string | null;
}

/** Cuerpo de /v1/clients/create (o /v1/clients/{UID}/update). */
export function cuerpoCliente(r: ReceptorDatos): Record<string, unknown> {
  return {
    rfc: r.rfc.toUpperCase().trim(),
    razons: razonSocialSinRegimen(r.razon_social),
    codpos: String(r.codigo_postal).trim(),
    email: (r.email ?? "").trim() || "sinreply@grupoloma.mx",
    usocfdi: r.uso_cfdi ?? "G03",
    regimen: String(r.regimen_fiscal).trim(),
    pais: r.pais ?? "MEX",
  };
}

/** Qué le falta al receptor para poder timbrarle. */
export function revisarReceptor(r: Partial<ReceptorDatos>): string[] {
  const p: string[] = [];
  if (!rfcValido(r.rfc)) p.push("El RFC del cliente no es válido (12 o 13 caracteres).");
  if (!(r.razon_social ?? "").trim()) p.push("Falta la razón social del cliente.");
  if (!/^\d{3}$/.test(String(r.regimen_fiscal ?? "").trim())) p.push("Falta el régimen fiscal del cliente (clave de 3 dígitos, p. ej. 601).");
  if (!/^\d{5}$/.test(String(r.codigo_postal ?? "").trim())) p.push("Falta el código postal fiscal del cliente (5 dígitos).");
  if (!(r.uso_cfdi ?? "").trim()) p.push("Elige el uso del CFDI.");
  return p;
}

/** Qué le falta a los conceptos. */
export function revisarConceptos(cs: Partial<ConceptoFactura>[]): string[] {
  const p: string[] = [];
  if (cs.length === 0) p.push("La orden no tiene partidas.");
  cs.forEach((c, i) => {
    const n = i + 1;
    if (!(c.descripcion ?? "").trim()) p.push(`Partida ${n}: falta la descripción.`);
    if (!/^\d{8}$/.test(String(c.clave_prod_serv ?? "").trim())) p.push(`Partida ${n}: la clave de producto/servicio del SAT debe tener 8 dígitos.`);
    if (!/^[A-Z0-9]{2,3}$/.test(String(c.clave_unidad ?? "").trim().toUpperCase())) p.push(`Partida ${n}: falta la clave de unidad del SAT (p. ej. H87).`);
    if (!(Number(c.cantidad) > 0)) p.push(`Partida ${n}: la cantidad debe ser mayor a cero.`);
    if (!(Number(c.precio) >= 0)) p.push(`Partida ${n}: el precio no es válido.`);
  });
  return p;
}
