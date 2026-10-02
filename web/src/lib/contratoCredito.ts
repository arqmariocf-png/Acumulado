// Machote del "Contrato mercantil de suministro con línea de crédito
// comercial" (abogados, 1-oct-2026). Se llena solo con los datos legales de la
// empresa que vende (empresas_perfil_legal) y del cliente con crédito
// autorizado (clientes_credito). Sin DOM: se prueba en node y arma el HTML
// imprimible y el .doc que abre Word.
//
// Las cláusulas fijas viven en contratoCreditoTexto.ts; aquí van el proemio,
// antecedentes, declaraciones, lo variable de las cláusulas y las firmas.

import { CLAUSULAS_CONTRATO_CREDITO } from "./contratoCreditoTexto.ts";

export interface EscrituraProveedor {
  numero: string | null;
  volumen: string | null;
  fecha: string | null; // ISO
  notario: string | null; // con título: "Licenciado Arturo Díaz González"
  notaria: string | null;
  distrito: string | null;
}

export interface ProveedorContrato {
  razon_social: string;
  representante_nombre: string;
  representante_puesto: string; // "ADMINISTRADOR ÚNICO"
  representante_tratamiento: string | null; // "LA C." / "EL C."
  representante_titulo: string | null; // "LICENCIADA" (en la firma)
  objeto_social: string | null;
  rfc: string | null;
  constitucion: EscrituraProveedor;
  poderes: EscrituraProveedor;
  domicilio: string | null;
  correo: string | null;
  telefono: string | null;
}

/** clientes_credito.legales (jsonb). Si el abogado redactó el párrafo tal
 * cual, va en *_texto y tiene prioridad sobre los datos sueltos. */
export interface LegalesCliente {
  constitutiva_texto?: string;
  constitutiva_numero?: string;
  constitutiva_volumen?: string;
  constitutiva_fecha?: string;
  constitutiva_notario?: string;
  constitutiva_notaria?: string;
  constitutiva_ciudad?: string;
  registro_lugar?: string;
  registro_numero?: string;
  registro_tomo?: string;
  registro_fecha?: string;
  poder_texto?: string;
  poder_numero?: string;
  poder_volumen?: string;
  poder_fecha?: string;
  poder_notario?: string;
  poder_notaria?: string;
  poder_ciudad?: string;
  poder_otorgante?: string;
  poder_facultades?: string;
  /** Persona física: con qué se identifica (INE número …). */
  identificacion?: string;
}

export interface CompradorContrato {
  razon_social: string;
  tipo_persona: "moral" | "fisica";
  representante_nombre: string | null;
  representante_cargo: string | null; // "APODERADO LEGAL"
  representante_tratamiento: string | null; // "EL C."
  rfc: string | null;
  domicilio_legal: string | null;
  correos: string | null;
  telefonos: string | null;
  obligado_solidario_nombre: string | null;
  legales: LegalesCliente;
}

export interface DatosContrato {
  folio?: string | null;
  proveedor: ProveedorContrato;
  comprador: CompradorContrato;
  monto: number;
  interes_moratorio_pct: number;
  fecha_firma: string; // ISO
  ciudad_firma: string;
}

// ── Números y fechas en letra ───────────────────────────────────────────────

const UNIDADES = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function menorAMil(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const c = Math.floor(n / 100);
  const r = n % 100;
  let resto = "";
  if (r < 30) resto = UNIDADES[r];
  else resto = DECENAS[Math.floor(r / 10)] + (r % 10 ? ` y ${UNIDADES[r % 10]}` : "");
  return [CENTENAS[c], resto].filter(Boolean).join(" ");
}

/** "uno" → "un" (y "veintiuno" → "veintiún") delante de mil / millones. */
function apocope(t: string): string {
  return t.replace(/veintiuno$/, "veintiún").replace(/(^|\s)uno$/, "$1un");
}

/** Entero en letra, en minúsculas: 71040 → "setenta y un mil cuarenta". */
export function numeroALetras(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "cero";
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? "un millón" : `${apocope(numeroALetras(millones))} millones`);
  if (miles) partes.push(miles === 1 ? "mil" : `${apocope(menorAMil(miles))} mil`);
  if (resto) partes.push(menorAMil(resto));
  return partes.join(" ");
}

/** 150000 → "CIENTO CINCUENTA MIL PESOS 00/100 MONEDA NACIONAL". */
export function montoEnLetras(monto: number): string {
  const centavos = Math.round(monto * 100) % 100;
  const enteros = Math.floor(Math.round(monto * 100) / 100);
  const letras = numeroALetras(enteros);
  const de = /(millón|millones)$/.test(letras) ? " DE" : "";
  const pesos = enteros === 1 ? "PESO" : "PESOS";
  return `${apocope(letras).toUpperCase()}${de} ${pesos} ${String(centavos).padStart(2, "0")}/100 MONEDA NACIONAL`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function partesFecha(iso: string): [number, number, number] {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [a, m, d];
}

/** "2013-10-23" → "veintitrés de octubre de dos mil trece". */
export function fechaEnLetras(iso: string): string {
  const [a, m, d] = partesFecha(iso);
  return `${d === 1 ? "primero" : numeroALetras(d)} de ${MESES[m - 1]} de ${numeroALetras(a)}`;
}

/** "2002-10-04" → "4 (cuatro) de octubre de 2002 (dos mil dos)". */
export function fechaCifraYLetra(iso: string): string {
  const [a, m, d] = partesFecha(iso);
  return `${d} (${numeroALetras(d)}) de ${MESES[m - 1]} de ${a} (${numeroALetras(a)})`;
}

function digitos(v: string | null | undefined): number | null {
  const s = String(v ?? "").replace(/[^\d]/g, "");
  return s ? Number(s) : null;
}

function miles(n: number): string {
  return n.toLocaleString("en-US");
}

/** "7354" → "siete mil trescientos cincuenta y cuatro (7,354)". */
export function letraYCifra(v: string | null | undefined): string {
  const n = digitos(v);
  return n == null ? "____" : `${numeroALetras(n)} (${miles(n)})`;
}

/** "12652" → "12,652 (doce mil seiscientos cincuenta y dos)". */
export function cifraYLetra(v: string | null | undefined): string {
  const n = digitos(v);
  return n == null ? "____" : `${miles(n)} (${numeroALetras(n)})`;
}

// ── Nombres ────────────────────────────────────────────────────────────────

/** "RAMSICON, S.A. DE C.V." → `“RAMSICON”, S.A. DE C.V.` */
export function sociedadEntreComillas(razon: string): string {
  const t = razon.trim().replace(/[“”"]/g, "");
  const m = t.match(/^(.*?)[,\s]+((?:S\.?\s*A\.?\s*P\.?\s*I\.?|S\.?\s*A\.?|S\.?\s*DE\s*R\.?\s*L\.?|S\.?\s*C\.?|A\.?\s*C\.?)(?:\s*DE\s*C\.?\s*V\.?)?\.?)$/i);
  if (!m) return `“${t}”`;
  const sufijo = m[2].toUpperCase().replace(/\.?$/, ".");
  return `“${m[1]}”, ${sufijo}`;
}

/** Nombre sin comillas para la firma: "RAMSICON, S.A. DE C.V." */
function razonLimpia(razon: string): string {
  return razon.replace(/[“”"]/g, "").trim();
}

/** "ADMINISTRADOR ÚNICO" → "Administrador Único". */
function tipoTitulo(t: string): string {
  return t.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, e, l) => e + l.toUpperCase());
}

/** "del Licenciado X" / "de la Licenciada X". */
function anteLaFe(notario: string | null | undefined): string {
  const n = (notario ?? "").trim();
  if (!n) return "del Notario Público";
  if (/^(licenciada|maestra|doctora|notaria)\b/i.test(n)) return `de la ${n}`;
  if (/^(licenciado|maestro|doctor|notario)\b/i.test(n)) return `del ${n}`;
  return `del Licenciado ${n}`;
}

// ── Faltantes ──────────────────────────────────────────────────────────────

/** Lo que falta capturar para que el contrato salga completo. */
export function faltantesContrato(d: DatosContrato): string[] {
  const f: string[] = [];
  const p = d.proveedor;
  const c = d.comprador;
  if (!p.representante_nombre) f.push("Representante legal de la empresa");
  if (!p.rfc) f.push("RFC de la empresa");
  if (!p.domicilio) f.push("Domicilio de la empresa");
  if (!p.constitucion.numero || !p.constitucion.fecha || !p.constitucion.notario) f.push("Escritura constitutiva de la empresa");
  if (!p.poderes.numero || !p.poderes.fecha || !p.poderes.notario) f.push("Escritura de poderes de la empresa");
  if (!p.objeto_social) f.push("Objeto social de la empresa");
  if (!c.rfc) f.push("RFC del cliente");
  if (!c.domicilio_legal) f.push("Domicilio legal del cliente");
  if (c.tipo_persona === "moral") {
    if (!c.representante_nombre) f.push("Representante del cliente");
    if (!c.legales.constitutiva_texto && !(c.legales.constitutiva_numero && c.legales.constitutiva_fecha)) f.push("Escritura constitutiva del cliente");
    if (!c.legales.poder_texto && !(c.legales.poder_numero && c.legales.poder_fecha)) f.push("Poder del representante del cliente");
  } else if (!c.legales.identificacion) f.push("Identificación del cliente");
  if (!c.correos) f.push("Correo del cliente para notificaciones");
  if (!(d.monto > 0)) f.push("Monto de la línea de crédito");
  return f;
}

// ── Párrafos variables ─────────────────────────────────────────────────────

function esc(t: string | number | null | undefined): string {
  return String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const hueco = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "____________");

function proemio(d: DatosContrato): string {
  const p = d.proveedor;
  const c = d.comprador;
  const prov = `LA PERSONA MORAL DENOMINADA ${sociedadEntreComillas(p.razon_social)}, REPRESENTADA EN ESTE ACTO POR SU ${p.representante_puesto.toUpperCase()} ${hueco(p.representante_tratamiento ?? "EL C.")} ${hueco(p.representante_nombre)}`;
  const comp =
    c.tipo_persona === "moral"
      ? `LA PERSONA MORAL DENOMINADA ${sociedadEntreComillas(c.razon_social)}, REPRESENTADA EN ESTE ACTO POR SU ${hueco(c.representante_cargo).toUpperCase()} ${hueco(c.representante_tratamiento ?? "EL C.")} ${hueco(c.representante_nombre)}`
      : `${hueco(c.representante_tratamiento ?? "EL C.")} ${c.razon_social.toUpperCase()}, POR SU PROPIO DERECHO`;
  return `CONTRATO MERCANTIL DE SUMINISTRO CON LÍNEA DE CRÉDITO COMERCIAL, QUE CELEBRAN, POR UNA PARTE, ${prov}, A QUIEN EN LO SUCESIVO SE LE DENOMINARÁ “EL PROVEEDOR”; Y, POR LA OTRA PARTE, ${comp}, A QUIEN EN LO SUCESIVO SE LE DENOMINARÁ “EL COMPRADOR”; Y CUANDO ACTÚEN CONJUNTAMENTE SE LES DENOMINARÁ “LAS PARTES”, SUJETÁNDOSE AL TENOR DE LOS SIGUIENTES ANTECEDENTES, DECLARACIONES Y CLÁUSULAS:`;
}

function antecedentes(d: DatosContrato): string[] {
  return [
    `I. Manifiesta “EL PROVEEDOR” que su objeto social lo es; ${hueco(d.proveedor.objeto_social)} por lo cual desarrolla actividades de carácter comercial relacionadas con la producción, distribución, comercialización, venta y/o suministro de los productos y mercancías que se describen más adelante y sean solicitados por “EL COMPRADOR”, contando para ello con la capacidad jurídica, técnica, administrativa, logística y material necesaria para atender los pedidos que sean formalmente aceptados.`,
    "II. Manifiesta “EL COMPRADOR” que, dentro del desarrollo ordinario de sus actividades comerciales, requiere adquirir de manera periódica y sucesiva determinados productos y mercancías para su comercialización, distribución, transformación o utilización dentro de sus operaciones.",
    "III. “EL COMPRADOR” ha solicitado a “EL PROVEEDOR” el otorgamiento de una facilidad de pago consistente en una línea de crédito comercial, con el objeto de que las mercancías que sean efectivamente suministradas y recibidas puedan ser cubiertas dentro de los plazos establecidos en la correspondiente Solicitud de Crédito Comercial, misma que se adjunta como anexo al presente.",
    "IV. “EL PROVEEDOR”, después de realizar las evaluaciones comerciales, financieras y de solvencia que estime convenientes, ha determinado otorgar a “EL COMPRADOR” una línea de crédito comercial de carácter revolvente, sujeta al límite, condiciones, plazo y demás parámetros establecidos en el presente contrato y en la Solicitud de Crédito Comercial, misma que formará parte integrante del presente instrumento como Anexo “A”.",
    "V. “LAS PARTES” reconocen que las operaciones derivadas del presente instrumento tendrán naturaleza mercantil, toda vez que se celebran con motivo y para el desarrollo de sus respectivas actividades comerciales, por lo que su interpretación, cumplimiento y ejecución se sujetarán primordialmente a la legislación mercantil aplicable.",
  ];
}

function declaracionesProveedor(p: ProveedorContrato): { encabezado: string; incisos: string[] } {
  const e = p.constitucion;
  const po = p.poderes;
  const puesto = tipoTitulo(p.representante_puesto);
  return {
    encabezado: `1. DECLARA “EL PROVEEDOR”, POR CONDUCTO DE SU ${p.representante_puesto.toUpperCase()}:`,
    incisos: [
      `a) Que es una sociedad mercantil legalmente constituida bajo las leyes mexicanas tal y como lo acredita mediante instrumento notarial número ${letraYCifra(e.numero)}${e.volumen ? ` volumen número ${letraYCifra(e.volumen)}` : ""} otorgado ante la fe pública ${anteLaFe(e.notario)}, titular de la Notaría Pública número ${digitos(e.notaria) != null ? numeroALetras(digitos(e.notaria)!) : "____"} del Distrito Judicial de ${hueco(e.distrito)} el día ${e.fecha ? fechaEnLetras(e.fecha) : "____"}.`,
      `b) Que su ${puesto}, cuenta con las facultades suficientes para celebrar el presente contrato según lo acredita mediante instrumento notarial número ${letraYCifra(po.numero)}${po.volumen ? ` volumen número ${letraYCifra(po.volumen)}` : ""} pasado ante la fe pública ${anteLaFe(po.notario)}, titular de la Notaría Pública número ${digitos(po.notaria) != null ? numeroALetras(digitos(po.notaria)!) : "____"} del Distrito Judicial de ${hueco(po.distrito)} de fecha de protocolización el día ${po.fecha ? fechaEnLetras(po.fecha) : "____"}. Bajo protesta de decir verdad, mismas facultades no le han sido revocadas, limitadas o modificadas.`,
      "c) Que tiene capacidad jurídica y material suficiente para obligarse en los términos del presente contrato y para suministrar los productos objeto de las operaciones comerciales que se celebren con “EL COMPRADOR”.",
      `d) Que para efectos fiscales señala como su Registro Federal de Contribuyentes el número; ${hueco(p.rfc)}.`,
      `e) Que señala como domicilio para efectos del presente contrato el ubicado en; ${hueco(p.domicilio)}.`,
      "f) Que es su voluntad celebrar el presente contrato bajo los términos y condiciones que en él se establecen.",
    ],
  };
}

function declaracionesComprador(c: CompradorContrato): { encabezado: string; incisos: string[] } {
  const l = c.legales;
  const nombre = sociedadEntreComillas(c.razon_social);
  const trat = (c.representante_tratamiento ?? "EL C.").replace(/^(EL|LA)\s+/i, (m) => m.toLowerCase());
  let a: string;
  let poder: string | null = null;
  if (c.tipo_persona === "fisica") {
    a = `a) Que es una persona física de nacionalidad mexicana, mayor de edad, con plena capacidad legal para obligarse en los términos del presente contrato, que se identifica con ${hueco(l.identificacion)}, y que cuenta con capacidad económica suficiente para asumir las obligaciones derivadas de la adquisición de los productos y del otorgamiento de la línea de crédito comercial materia del presente instrumento.`;
  } else {
    if (l.constitutiva_texto?.trim()) a = `a) ${l.constitutiva_texto.trim().replace(/^a\)\s*/i, "")}`;
    else {
      const registro =
        l.registro_numero || l.registro_fecha
          ? `, inscrito en el Registro Público de la Propiedad y del Comercio de ${hueco(l.registro_lugar)} bajo el número ${l.registro_numero ? cifraYLetra(l.registro_numero) : "____"}${l.registro_tomo ? `, del tomo ${l.registro_tomo}` : ""}${l.registro_fecha ? `, de fecha ${fechaCifraYLetra(l.registro_fecha)}` : ""}`
          : "";
      const notario = l.constitutiva_notario?.trim() ? `${anteLaFe(l.constitutiva_notario)}, Notario Titular` : "del Notario Titular";
      a = `a) Que ${nombre} es una sociedad mercantil legalmente constituida conforme a las leyes mexicanas, según consta en el instrumento notarial número ${cifraYLetra(l.constitutiva_numero)}${l.constitutiva_volumen ? `, volumen número ${cifraYLetra(l.constitutiva_volumen)}` : ""}, de fecha ${l.constitutiva_fecha ? fechaCifraYLetra(l.constitutiva_fecha) : "____"}, otorgado ante la fe ${notario} de la Notaría Pública número ${hueco(l.constitutiva_notaria)} de ${hueco(l.constitutiva_ciudad)}${registro}, contando con capacidad económica y legal suficiente para asumir las obligaciones derivadas de la adquisición de los productos y del otorgamiento de la línea de crédito comercial materia del presente instrumento.`;
    }
    if (l.poder_texto?.trim()) poder = l.poder_texto.trim();
    else
      poder = `Que su ${tipoTitulo(hueco(c.representante_cargo))}, ${trat} ${hueco(c.representante_nombre)}, cuenta con las facultades suficientes para celebrar el presente contrato en representación de “EL COMPRADOR”, según consta en el instrumento notarial número ${cifraYLetra(l.poder_numero)}${l.poder_volumen ? `, volumen número ${cifraYLetra(l.poder_volumen)}` : ""}, de fecha ${l.poder_fecha ? fechaCifraYLetra(l.poder_fecha) : "____"}, otorgado ante la fe ${anteLaFe(l.poder_notario)}, Notario Titular de la Notaría Pública número ${l.poder_notaria ? cifraYLetra(l.poder_notaria) : "____"} de ${hueco(l.poder_ciudad)}${l.poder_otorgante ? `, mediante el cual ${l.poder_otorgante.trim()} otorgó a favor ${trat.startsWith("la") ? "de la C." : "del C."} ${hueco(c.representante_nombre)} ${hueco(l.poder_facultades)}` : ""}, facultades que, bajo protesta de decir verdad, no le han sido revocadas, limitadas o modificadas a la fecha del presente.`;
  }
  const incisos = [
    a,
    ...(poder ? [poder] : []),
    "b) Que manifiesta conocer de manera suficiente los productos, mercancías y bienes que son objeto de las operaciones comerciales con “EL PROVEEDOR”, así como sus características, condiciones de comercialización, calidad y demás especificaciones que, en su caso, correspondan, por lo que manifiesta expresamente su conformidad para adquirirlos en los términos y condiciones que sean pactados en cada operación.",
    "c) Que es su voluntad obtener de “EL PROVEEDOR” una línea de crédito comercial para la adquisición de los productos objeto del presente contrato, manifestando expresamente que, previo a la celebración del mismo, ha sido informado y conoce el monto, límite, plazo, forma de disposición, condiciones de pago, intereses moratorios, garantías y demás términos aplicables al crédito, así como los derechos, obligaciones, alcances y consecuencias jurídicas y económicas que se derivan de su otorgamiento y, particularmente, de su eventual incumplimiento.",
    `d) Que el Registro Federal de Contribuyentes de “EL COMPRADOR” es; ${hueco(c.rfc)}.`,
    `e) Que señala como domicilio legal y fiscal el ubicado en; ${hueco(c.domicilio_legal)}.`,
    "f) Que reconoce haber solicitado a “EL PROVEEDOR” el otorgamiento de una línea de crédito comercial y que, para tal efecto, ha proporcionado información corporativa, fiscal, financiera y comercial que considera cierta, completa y actualizada.",
    "g) Que reconoce que la información proporcionada a “EL PROVEEDOR” constituye uno de los elementos considerados para la autorización y conservación de la línea de crédito comercial, por lo que se obliga a informar oportunamente cualquier modificación sustancial en su situación jurídica, corporativa, financiera o patrimonial que pudiera afectar el cumplimiento de sus obligaciones.",
    "h) Que es su voluntad adquirir las mercancías que sean solicitadas y aceptadas, así como cubrir íntegramente los precios, impuestos, gastos y demás conceptos que correspondan conforme al presente contrato.",
    "i) Que ha tenido oportunidad suficiente para conocer, revisar y, en su caso, solicitar las aclaraciones correspondientes respecto del contenido del presente contrato, la Solicitud de Crédito Comercial (Anexo “A”) y los documentos que, en su caso, se suscriban como garantía del pago, manifestando que comprende plenamente su contenido, alcance y consecuencias legales, por lo que expresa su consentimiento libre, informado y sin reserva alguna para obligarse en los términos aquí establecidos.",
  ];
  return {
    encabezado: c.tipo_persona === "fisica" ? "2. DECLARA “EL COMPRADOR”, POR SU PROPIO DERECHO:" : `2. DECLARA “EL COMPRADOR”, POR CONDUCTO DE SU ${hueco(c.representante_cargo).toUpperCase()}:`,
    incisos,
  };
}

const DECLARACIONES_PARTES = [
  "a) Que se reconocen mutuamente la personalidad y capacidad jurídica con la que comparecen.",
  "b) Que en la celebración del presente contrato no existe error, dolo, mala fe, violencia, lesión o cualquier otro vicio del consentimiento que pudiera afectar su validez.",
  "c) Que conocen el alcance jurídico y económico de las obligaciones que asumen.",
  "d) Que el presente contrato constituye el acuerdo marco que regulará las operaciones de suministro y compraventa mercantil que se realicen entre “LAS PARTES”.",
  "e) Que las operaciones que se celebren al amparo del presente instrumento se sujetarán, en lo conducente, al Código de Comercio, a las demás leyes mercantiles aplicables y, en aquello no previsto por éstas, conformidad con las disposiciones de supletoriedad correspondientes.",
];

/** "3% (tres por ciento)"; con decimales, "2.5% (dos punto cinco por ciento)". */
export function interesEnLetras(pct: number): string {
  const [e, dec] = String(Math.round(pct * 100) / 100).split(".");
  const letras = numeroALetras(Number(e)) + (dec ? ` punto ${dec.split("").map((x) => (x === "0" ? "cero" : numeroALetras(Number(x)))).join(" ")}` : "");
  return `${String(Math.round(pct * 100) / 100)}% (${letras} por ciento)`;
}

/** Día con dos dígitos y mes con mayúscula, como lo escribieron los abogados:
 * "a los 01 días del mes de Agosto de 2026". */
export function textoFirma(ciudad: string, fechaIso: string): string {
  const [a, m, d] = partesFecha(fechaIso);
  const mes = MESES[m - 1];
  return `En consecuencia, lo firman por duplicado en la ${ciudad}, a los ${String(d).padStart(2, "0")} días del mes de ${mes[0].toUpperCase()}${mes.slice(1)} de ${a}, quedando un ejemplar en poder de cada una de “LAS PARTES”.`;
}

function sustituir(parrafo: string, d: DatosContrato): string[] {
  const p = d.proveedor;
  const c = d.comprador;
  if (parrafo === "{{OBLIGADO}}") {
    if (!c.obligado_solidario_nombre?.trim()) return [];
    return [`En este acto, el C. ${c.obligado_solidario_nombre.trim().toUpperCase()} comparece adicionalmente en su carácter personal, constituyéndose como Obligado Solidario y/o Avalista de las obligaciones de pago que se deriven del presente contrato y de la línea de crédito comercial otorgada a “EL COMPRADOR”.`];
  }
  if (parrafo === "{{NOTIFICACIONES}}") {
    return [
      "“EL PROVEEDOR”:",
      `• Domicilio: ${hueco(p.domicilio)}.`,
      `• Correo electrónico: ${hueco(p.correo)}`,
      `• Teléfono: ${hueco(p.telefono)}`,
      "“EL COMPRADOR”:",
      `• Domicilio: ${hueco(c.domicilio_legal)}`,
      `• Correo electrónico: ${hueco(c.correos)}`,
      `• Teléfono: ${hueco(c.telefonos)}`,
    ];
  }
  if (parrafo === "{{FIRMA}}") return [textoFirma(d.ciudad_firma, d.fecha_firma)];
  const monto = `${d.monto.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${montoEnLetras(d.monto)})`;
  return [parrafo.replace("{{MONTO}}", monto).replace("{{INTERES}}", interesEnLetras(d.interes_moratorio_pct))];
}

/** Proemio, antecedentes, declaraciones y cláusulas ya llenas, como texto
 * plano (para pruebas y para revisar diferencias contra el machote). */
export function textoContrato(d: DatosContrato): string[] {
  const dp = declaracionesProveedor(d.proveedor);
  const dc = declaracionesComprador(d.comprador);
  const out = [
    "CONTRATO MERCANTIL DE SUMINISTRO CON LÍNEA DE CRÉDITO COMERCIAL",
    proemio(d),
    "ANTECEDENTES",
    ...antecedentes(d),
    "En virtud de lo anterior, “LAS PARTES” formulan las siguientes:",
    "DECLARACIONES",
    dp.encabezado,
    ...dp.incisos,
    dc.encabezado,
    ...dc.incisos,
    "3. DECLARAN “LAS PARTES”:",
    ...DECLARACIONES_PARTES,
    "En consecuencia, “LAS PARTES” se sujetan a las siguientes:",
    "CLÁUSULAS",
  ];
  for (const cl of CLAUSULAS_CONTRATO_CREDITO) {
    out.push(cl.titulo);
    for (const par of cl.parrafos) out.push(...sustituir(par, d));
  }
  return out;
}

// ── HTML (imprimir / PDF) y Word ───────────────────────────────────────────

function firmas(d: DatosContrato): string {
  const p = d.proveedor;
  const c = d.comprador;
  const bloque = (rol: string, razon: string, nombre: string, cargo: string) => `
    <td class="firma"><div class="rol">${esc(rol)}</div><div class="linea"></div>
      <div class="nombre">${esc(razon)}</div><div class="nombre">${esc(nombre)}</div><div class="cargo">${esc(cargo)}</div></td>`;
  const nombreProv = [p.representante_titulo, p.representante_nombre].filter(Boolean).join(" ").toUpperCase();
  const comprador =
    c.tipo_persona === "moral"
      ? bloque("“EL COMPRADOR”", razonLimpia(c.razon_social).toUpperCase(), hueco(c.representante_nombre).toUpperCase(), hueco(c.representante_cargo).toUpperCase())
      : bloque("“EL COMPRADOR”", "", c.razon_social.toUpperCase(), "POR SU PROPIO DERECHO");
  const obligado = c.obligado_solidario_nombre?.trim()
    ? `<table class="firmas obligado"><tr><td class="firma solo"><div class="rol">“OBLIGADO SOLIDARIO”</div><div class="linea"></div><div class="nombre">C. ${esc(c.obligado_solidario_nombre.trim().toUpperCase())}</div></td></tr></table>`
    : "";
  return `<table class="firmas"><tr>${bloque("“EL PROVEEDOR”", razonLimpia(p.razon_social).toUpperCase(), nombreProv, p.representante_puesto.toUpperCase())}${comprador}</tr></table>${obligado}`;
}

const ESTILO = `
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.45; color: #000; margin: 0; }
  .hoja { max-width: 17cm; margin: 0 auto; padding: 1.5cm 0; }
  h1 { font-size: 12pt; text-align: center; margin: 0 0 14pt; }
  h2 { font-size: 11pt; text-align: center; margin: 16pt 0 8pt; }
  h3 { font-size: 11pt; margin: 12pt 0 4pt; }
  p { text-align: justify; margin: 0 0 7pt; }
  p.proemio { font-weight: bold; }
  p.lista { margin-left: 1cm; }
  .folio { text-align: right; font-size: 9pt; color: #444; margin-bottom: 6pt; }
  table.firmas { width: 100%; margin-top: 36pt; border-collapse: collapse; page-break-inside: avoid; }
  td.firma { width: 50%; text-align: center; vertical-align: top; padding: 0 12pt; font-size: 10pt; }
  table.firmas.obligado { width: 50%; margin: 24pt auto 0; }
  td.firma.solo { width: auto; }
  .rol { font-weight: bold; margin-bottom: 48pt; }
  .linea { border-top: 1px solid #000; width: 75%; margin: 0 auto 4pt; }
  .nombre { font-weight: bold; }
  .btn { position: fixed; top: 8px; right: 8px; padding: 6px 12px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; cursor: pointer; font-family: Arial, sans-serif; }
  @page { size: letter; margin: 2.5cm 2.5cm 2cm; }
  @media print { .btn { display: none; } .hoja { padding: 0; } }
`;

function cuerpo(d: DatosContrato): string {
  const parrafos = textoContrato(d);
  const titulos = new Set(["ANTECEDENTES", "DECLARACIONES", "CLÁUSULAS"]);
  const encabezados = new Set(CLAUSULAS_CONTRATO_CREDITO.map((c) => c.titulo));
  const html: string[] = [];
  parrafos.forEach((t, i) => {
    if (i === 0) html.push(`<h1>${esc(t)}</h1>`);
    else if (i === 1) html.push(`<p class="proemio">${esc(t)}</p>`);
    else if (titulos.has(t)) html.push(`<h2>${esc(t)}</h2>`);
    else if (encabezados.has(t) || /^\d\. DECLARA/.test(t)) html.push(`<h3>${esc(t)}</h3>`);
    else if (/^([a-o]\.|•)\s/.test(t)) html.push(`<p class="lista">${esc(t)}</p>`);
    else html.push(`<p>${esc(t)}</p>`);
  });
  return html.join("\n");
}

/** Página imprimible (Imprimir / guardar PDF). */
export function htmlContratoCredito(d: DatosContrato): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Contrato ${esc(d.folio ?? "")} ${esc(razonLimpia(d.comprador.razon_social))}</title>
<style>${ESTILO}</style></head><body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
<div class="hoja">
${d.folio ? `<div class="folio">${esc(d.folio)}</div>` : ""}
${cuerpo(d)}
${firmas(d)}
</div></body></html>`;
}

/** Documento que abre Word (.doc en HTML): para que los abogados lo editen. */
export function docContratoCredito(d: DatosContrato): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Contrato</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${ESTILO.replace(/\.btn[^}]*}/, "")} @page Section1 { size: 8.5in 11in; margin: 1in 1in 0.8in 1in; } div.Section1 { page: Section1; }</style></head>
<body><div class="Section1">
${d.folio ? `<p class="folio">${esc(d.folio)}</p>` : ""}
${cuerpo(d)}
${firmas(d)}
</div></body></html>`;
}

/** Nombre de archivo: "Contrato CTO-AEP-0001 RAMSICON.doc". */
export function nombreArchivoContrato(d: DatosContrato, ext: "doc" | "html"): string {
  const cliente = razonLimpia(d.comprador.razon_social).replace(/,?\s*S\.?\s*A\.?.*$/i, "").replace(/[^\p{L}\d ]/gu, "").trim();
  return `Contrato ${d.folio ?? ""} ${cliente}`.replace(/\s+/g, " ").trim() + `.${ext}`;
}

// ── Desde las filas de la base ─────────────────────────────────────────────

export interface FilaPerfilLegal {
  razon_social: string | null;
  representante_legal_nombre: string | null;
  representante_legal_puesto: string | null;
  representante_tratamiento: string | null;
  representante_titulo: string | null;
  objeto_social: string | null;
  rfc: string | null;
  escritura_constitucion_numero: string | null;
  escritura_constitucion_volumen: string | null;
  escritura_constitucion_fecha: string | null;
  escritura_constitucion_notario: string | null;
  escritura_constitucion_notaria_numero: string | null;
  escritura_constitucion_distrito_judicial: string | null;
  escritura_poderes_numero: string | null;
  escritura_poderes_volumen: string | null;
  escritura_poderes_fecha: string | null;
  escritura_poderes_notario: string | null;
  escritura_poderes_notaria_numero: string | null;
  escritura_poderes_distrito_judicial: string | null;
  domicilio_legal: string | null;
  ciudad_firma: string | null;
  correo: string | null;
  telefono: string | null;
}

export function proveedorDesdePerfil(f: FilaPerfilLegal, nombreEmpresa: string): ProveedorContrato {
  return {
    razon_social: f.razon_social || nombreEmpresa,
    representante_nombre: f.representante_legal_nombre ?? "",
    representante_puesto: f.representante_legal_puesto || "REPRESENTANTE LEGAL",
    representante_tratamiento: f.representante_tratamiento,
    representante_titulo: f.representante_titulo,
    objeto_social: f.objeto_social,
    rfc: f.rfc,
    constitucion: {
      numero: f.escritura_constitucion_numero,
      volumen: f.escritura_constitucion_volumen,
      fecha: f.escritura_constitucion_fecha,
      notario: f.escritura_constitucion_notario,
      notaria: f.escritura_constitucion_notaria_numero,
      distrito: f.escritura_constitucion_distrito_judicial,
    },
    poderes: {
      numero: f.escritura_poderes_numero,
      volumen: f.escritura_poderes_volumen,
      fecha: f.escritura_poderes_fecha,
      notario: f.escritura_poderes_notario,
      notaria: f.escritura_poderes_notaria_numero,
      distrito: f.escritura_poderes_distrito_judicial,
    },
    domicilio: f.domicilio_legal,
    correo: f.correo,
    telefono: f.telefono,
  };
}

export const CIUDAD_FIRMA_DEFAULT = "Heroica Puebla de Zaragoza, Estado de Puebla";
