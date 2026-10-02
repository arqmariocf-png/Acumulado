// Machote del "Contrato de arrendamiento" (Mario, 2-oct-2026: "ya tienes el
// de crédito, ahora va el de arrendamiento"). Texto tomado del contrato
// firmado CSC → Ergodinova del 1-sep-2023 (Contrato_de_arrendamiento_ergo_1.pdf),
// con las erratas de captura corregidas; lo variable sale de los datos que
// se capturan en Legal → Crédito y contratos. Sin DOM: se prueba en node.

import { montoEnLetras, numeroALetras, type FilaPerfilLegal } from "./contratoCredito.ts";

export interface ParteArrendamiento {
  tipo_persona: "moral" | "fisica";
  razon_social: string;
  rfc: string | null;
  representante: string | null; // "MARIO CONTRERAS FARFAN"
  cargo: string | null; // "ADMINISTRADOR ÚNICO"
  domicilio: string | null;
}

export interface DatosArrendamiento {
  folio?: string | null;
  arrendador: ParteArrendamiento;
  arrendatario: ParteArrendamiento;
  fiador: { nombre: string; domicilio: string | null } | null;
  inmueble: { domicilio: string; metros: number | null; uso: string };
  renta: number;
  iva_incluido: boolean;
  dia_pago: number;
  forma_pago: "efectivo" | "transferencia" | "deposito";
  inicio: string; // ISO
  fin: string; // ISO
  /** Gastos de cobranza por pago tardío (% de la renta). */
  pena_atraso_pct: number;
  /** Cheque devuelto (art. 193 LGTOC). */
  pena_cheque_pct: number;
  /** Aumento si no desocupa al vencer. */
  aumento_no_desocupa_pct: number;
  /** El arrendador no renta otro local con el mismo giro. */
  exclusividad_giro: boolean;
  ciudad_firma: string;
  fecha_firma: string; // ISO
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const hueco = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "____________");

/** "2023-09-01" → "el día primero del mes de septiembre del año 2023". */
export function fechaContrato(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `el día ${d === 1 ? "primero" : numeroALetras(d)} del mes de ${MESES[m - 1]} del año ${a}`;
}

/** Meses completos entre inicio y fin (fin es el último día del plazo). */
export function mesesDePlazo(inicio: string, fin: string): number {
  const [a1, m1, d1] = inicio.split("-").map(Number);
  const [a2, m2, d2] = fin.split("-").map(Number);
  // El día siguiente al fin marca el aniversario: 2023-09-01 → 2024-08-31 = 12 meses.
  const siguiente = new Date(Date.UTC(a2, m2 - 1, d2 + 1));
  return (siguiente.getUTCFullYear() - a1) * 12 + (siguiente.getUTCMonth() - (m1 - 1)) - (siguiente.getUTCDate() < d1 ? 1 : 0);
}

/** "un año forzoso", "dos años forzosos", "seis meses forzosos". */
export function textoPlazo(inicio: string, fin: string): string {
  const meses = mesesDePlazo(inicio, fin);
  if (meses > 0 && meses % 12 === 0) {
    const anios = meses / 12;
    return anios === 1 ? "un año forzoso" : `${numeroALetras(anios)} años forzosos`;
  }
  return meses === 1 ? "un mes forzoso" : `${numeroALetras(Math.max(meses, 0))} meses forzosos`;
}

/** "$15,000.00 (QUINCE MIL PESOS 00/100 M.N.)". */
export function rentaEnLetras(monto: number): string {
  const cifra = monto.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${cifra} (${montoEnLetras(monto).replace("MONEDA NACIONAL", "M.N.")})`;
}

const FORMA_PAGO: Record<DatosArrendamiento["forma_pago"], string> = {
  efectivo: "en efectivo, con moneda del cuño corriente",
  transferencia: "mediante transferencia electrónica a la cuenta que designe el arrendador",
  deposito: "mediante depósito bancario a la cuenta que designe el arrendador",
};

function pct(n: number): string {
  return `${n}% (${numeroALetras(n)} por ciento)`;
}

function parteProemio(p: ParteArrendamiento): string {
  if (p.tipo_persona === "fisica") {
    return `${p.razon_social.toUpperCase()}, por su propio derecho, con Registro Federal de Contribuyentes ${hueco(p.rfc)} y domicilio en ${hueco(p.domicilio)}`;
  }
  return `${p.razon_social.toUpperCase()} con Registro Federal de Contribuyentes ${hueco(p.rfc)}, representada por su ${hueco(p.cargo).toLowerCase()} el C. ${hueco(p.representante).toUpperCase()}, con domicilio fiscal en ${hueco(p.domicilio)}`;
}

function declaracionParte(rol: "ARRENDADOR" | "ARRENDATARIO", p: ParteArrendamiento, propietario: boolean, domicilioInmueble: string): string {
  const base =
    p.tipo_persona === "moral"
      ? "Ser una persona moral legalmente constituida con apego a las leyes mexicanas, de nacionalidad mexicana, con capacidad legal para celebrar el presente contrato de arrendamiento"
      : "Ser una persona física de nacionalidad mexicana, mayor de edad, con capacidad legal para celebrar el presente contrato de arrendamiento";
  const extra = propietario ? ` y ser propietario del bien inmueble ubicado en ${domicilioInmueble}` : "";
  return `DECLARA “EL ${rol}”. ${base}${extra}.`;
}

export function faltantesArrendamiento(d: DatosArrendamiento): string[] {
  const f: string[] = [];
  for (const [rol, p] of [["arrendador", d.arrendador], ["arrendatario", d.arrendatario]] as const) {
    if (!p.razon_social.trim()) f.push(`Nombre o razón social del ${rol}`);
    if (!p.rfc) f.push(`RFC del ${rol}`);
    if (!p.domicilio) f.push(`Domicilio del ${rol}`);
    if (p.tipo_persona === "moral" && !p.representante) f.push(`Representante del ${rol}`);
  }
  if (!d.inmueble.domicilio.trim()) f.push("Domicilio del inmueble");
  if (!d.inmueble.uso.trim()) f.push("Uso o giro del inmueble");
  if (!(d.renta > 0)) f.push("Renta mensual");
  if (!d.inicio || !d.fin) f.push("Inicio y fin del arrendamiento");
  else if (d.fin <= d.inicio) f.push("La fecha de fin debe ser posterior al inicio");
  if (d.fiador && !d.fiador.domicilio) f.push("Domicilio del fiador");
  return f;
}

/** Contrato completo como lista de párrafos: [tipo, texto]. */
export function textoArrendamiento(d: DatosArrendamiento): { tipo: "titulo" | "seccion" | "clausula" | "parrafo" | "inciso"; texto: string; encabezado?: string }[] {
  const out: { tipo: "titulo" | "seccion" | "clausula" | "parrafo" | "inciso"; texto: string; encabezado?: string }[] = [];
  const inm = d.inmueble;
  const metros = inm.metros ? ` que consta de ${inm.metros.toLocaleString("es-MX")} metros cuadrados` : "";
  const arrtario = d.arrendatario.razon_social.toUpperCase();
  const fiador = d.fiador?.nombre?.trim() ? d.fiador : null;
  const iva = d.iva_incluido ? "incluyendo el 16% de impuesto al valor agregado (IVA)" : "más el 16% de impuesto al valor agregado (IVA)";

  out.push({
    tipo: "titulo",
    texto: `CONTRATO DE ARRENDAMIENTO DEL INMUEBLE UBICADO EN ${inm.domicilio.toUpperCase()}${metros.toUpperCase()}, QUE CELEBRAN COMO ARRENDADOR ${parteProemio(d.arrendador).toUpperCase()}; Y COMO ARRENDATARIO ${parteProemio(d.arrendatario).toUpperCase()}${fiador ? `, Y COMO FIADOR EL SEÑOR ${fiador.nombre.toUpperCase()}` : ""}, LOS PARTICIPANTES AQUÍ DESCRITOS HAN CONVENIDO PARA LA CELEBRACIÓN DE ESTE CONTRATO EN SUJETARSE VOLUNTARIAMENTE, BAJO LOS TÉRMINOS DISPUESTOS EN LAS SIGUIENTES DECLARACIONES Y CLÁUSULAS:`,
  });
  out.push({ tipo: "seccion", texto: "DECLARACIONES" });
  out.push({ tipo: "parrafo", encabezado: "I.", texto: declaracionParte("ARRENDADOR", d.arrendador, true, inm.domicilio) });
  out.push({ tipo: "parrafo", encabezado: "II.", texto: declaracionParte("ARRENDATARIO", d.arrendatario, false, inm.domicilio) });
  if (fiador) {
    out.push({
      tipo: "parrafo",
      encabezado: "III.",
      texto: "DECLARA “EL FIADOR”. Ser una persona física, mexicano por nacimiento, con capacidad legal para celebrar el presente contrato de arrendamiento, ser solvente económica y moralmente, y estar en aptitud de garantizar las obligaciones que se derivan del presente contrato de arrendamiento.",
    });
  }
  out.push({ tipo: "seccion", texto: "CLÁUSULAS" });

  const c: [string, string][] = [];
  c.push([
    "PRIMERA.",
    `El arrendador declara dar y otorgar en arrendamiento para el uso exclusivo de ${arrtario}, como ${inm.uso.trim()}, el inmueble mencionado en las declaraciones iniciales.${d.exclusividad_giro ? " Asimismo, se compromete a no dar en arrendamiento otro local con el mismo giro." : ""}`,
  ]);
  c.push(["SEGUNDA.", "El arrendatario declara haber recibido el inmueble en cita en perfectas condiciones y con los servicios funcionales."]);
  c.push([
    "TERCERA.",
    `Ambas partes declaran que el valor de la renta mensual es de ${rentaEnLetras(d.renta)} ${iva}, que pagará la arrendataria por adelantado, sin excusa ni pretexto, el día ${d.dia_pago === 1 ? "primero" : numeroALetras(d.dia_pago)} de cada mes en el domicilio del arrendador citado en las declaraciones iniciales; dicho pago se realizará ${FORMA_PAGO[d.forma_pago]}.`,
  ]);
  c.push([
    "CUARTA.",
    `La localidad de que se trata se arrienda por ${textoPlazo(d.inicio, d.fin)}, contando como fecha de inicio ${fechaContrato(d.inicio)} y como fecha de vencimiento ${fechaContrato(d.fin)}.`,
  ]);
  c.push([
    "QUINTA.",
    `El arrendatario pagará la cantidad convenida como renta mensual a partir de que entre en vigor el presente contrato, de acuerdo con lo establecido por los artículos 2268, 2290 fracción I y 2291 del Código Civil para el Estado de Puebla, renunciando expresamente al contenido del artículo 2293 del cuerpo legal en cita.\nPor falta de pago oportuno de la renta en el plazo señalado, el arrendatario cubrirá el ${pct(d.pena_atraso_pct)} de su importe cada vez que se produzca, para cubrir los gastos de cobranza especial. Si por algún motivo se llegara a recibir la renta en abonos o en fechas diferentes a la estipulada, no se entenderá como novado el presente contrato. Si por motivo justificado el arrendador admite que el arrendatario cubra el importe de la renta mensual con un cheque y éste es devuelto por la institución bancaria correspondiente por carecer de fondos suficientes para cubrirlo, el arrendador se reserva el derecho de cobrar el ${pct(d.pena_cheque_pct)} sobre documentos devueltos, en los términos del artículo 193 de la Ley General de Títulos y Operaciones de Crédito.`,
  ]);
  c.push(["SEXTA.", "El arrendatario no podrá retener la renta en ningún caso, bajo ningún título judicial o extrajudicial."]);
  if (fiador) {
    c.push([
      "SÉPTIMA.",
      `Forma parte del presente contrato el señor ${fiador.nombre.toUpperCase()}, con domicilio en ${hueco(fiador.domicilio)}, en su carácter de fiador, y se obliga solidaria y mancomunadamente con el arrendatario al pago de las responsabilidades que se derivan del presente contrato, responsabilidad que no cesará hasta que el arrendador se dé por recibido del inmueble arrendado.`,
    ]);
  }
  c.push([
    "",
    `Queda expresamente pactado que la parte arrendadora podrá rescindir el contrato si la parte arrendataria destina el inmueble arrendado a otro fin distinto al señalado en este contrato, o sea al de ${inm.uso.trim()}, o si:\nA) Subarrienda o de cualquier otra forma cede todo o parte de la localidad arrendada, sin consentimiento de la parte arrendadora otorgado por escrito.\nB) Falta al pago de la renta en la forma estipulada, conforme al artículo 2334 fracciones I, II y IV del Código Civil del Estado.\nC) Utiliza la localidad rentada para prostíbulo, cabaret, colegio, casa de huéspedes, círculo de juego, etcétera; es decir, si dedica dicho inmueble a un objeto distinto del señalado en este contrato.\nD) Tiene en el inmueble cualquier clase de animales.\nE) La parte arrendadora necesita el inmueble arrendado para reparaciones o cualquier otro uso.`,
  ]);
  c.push([
    "",
    "El arrendatario se obliga a acreditar el pago del último pago de renta, o del lapso del tiempo que haya ocupado el inmueble si éste fuere menor, mediante la exhibición de los recibos correspondientes debidamente firmados por el arrendador o por la persona que se autorice en este contrato, si le es solicitado por cualquiera de ellos, obligándose a cubrir los meses cuyo pago no esté debidamente justificado, aceptando el hecho de que si obra en su poder un recibo posterior no le exime de las deudas anteriores.",
  ]);
  c.push([
    "",
    `El término del arrendamiento es forzoso y concluye el día fijado sin necesidad de juicio, como lo previene el artículo 2319 del Código Civil vigente; pero si el arrendatario no desocupa por cualquier causa con oposición del arrendador, conviene que aumentará el precio de la renta en un ${pct(d.aumento_no_desocupa_pct)}, sin que esto implique novación del contrato o prórroga del mismo, siendo voluntad expresa de las partes tan sólo el aumento del precio del arrendamiento. Este incremento se producirá en igual proporción en cada anualidad que transcurra sin que la arrendataria la desocupe, subsistiendo además todas las obligaciones señaladas, hasta el momento en que la localidad arrendada sea devuelta conforme a lo estipulado en el presente contrato.`,
  ]);
  c.push([
    "",
    "La renta aumentará anualmente con un incremento estipulado de la siguiente manera: el monto original de la renta se incrementará anualmente según lo que resulte mayor entre el incremento del Índice Nacional de Precios al Consumidor (INPC) publicado por el Banco de México, el promedio anual de la Tasa de Interés Interbancaria de Equilibrio (TIIE) o el promedio de los Certificados de la Tesorería de la Federación, para cada año de vigencia de este contrato; el monto así fijado servirá de base para el cálculo de la renta del siguiente año.",
  ]);
  c.push([
    "",
    "Si el arrendatario desea desocupar el inmueble antes de su terminación, para hacerlo deberá estar al corriente en el pago de las rentas, así como también si opta por hacer depósitos de las rentas a nivel judicial.",
  ]);
  c.push([
    "",
    "Si el arrendatario desea desocupar el inmueble antes de su terminación u opta por la cancelación del mismo, cualquiera que sea la causa, se obliga a acudir al domicilio del arrendador para recabar su firma y la constancia de finiquito correspondiente, ya que en caso contrario seguirá produciendo todos sus efectos.",
  ]);
  c.push([
    "",
    "No podrá el arrendatario hacer uso del inmueble diferente al convenido, como lo previene la fracción III del artículo 2290 del Código Civil para el Estado, ni contravenir lo señalado en el plan director o en los decretos de destinos, usos y reservas establecidos, aceptando que en caso de hacerlo será causa de rescisión del contrato en términos de la fracción III del artículo 2290 del Código Civil para el Estado; ni contravenir lo señalado en las leyes municipales que dieren motivo a la clausura del local arrendado y que fueren por causas imputables al arrendatario.",
  ]);
  c.push([
    "",
    "Expresamente se prohíbe al arrendatario traspasar o subarrendar toda o parte de la localidad arrendada sin el previo permiso por escrito del arrendador, conservando aquélla en todo caso las responsabilidades que adquiere en este contrato en los términos del artículo 2331 del Código Civil vigente, siendo causa de rescisión cualquier acto en contravención a esta cláusula conforme a lo dispuesto por la fracción IV del artículo 2334 del mencionado código.",
  ]);
  c.push([
    "",
    "La arrendataria conviene en que el inmueble arrendado lo recibe en buen estado, todo lo cual lo devolverá al terminar el arrendamiento con el deterioro natural del uso, siendo por cuenta suya los gastos de reparación en los términos del artículo 2302 del Código Civil, obligándose a indemnizar al arrendador por cualquier daño a la localidad causado por su culpa o por la de sus empleados, parientes y demás personas que concurran a la misma, comprometiéndose a mantener aseados y en buen estado los servicios e instalaciones existentes.",
  ]);
  c.push([
    "",
    "No podrá el arrendatario, sin consentimiento por escrito del arrendador, variar la forma del inmueble arrendado, comprometiéndose a devolverlo en el estado en que lo recibe, conforme lo dispone el artículo 2299 del Código Civil. Para efectuar cualquier mejora o instalación en la finca arrendada deberá obtener previamente autorización por escrito del arrendador, ya que en caso contrario todas aquellas que puedan ser aprovechables quedarán en beneficio de la finca, sin que exista obligación del propietario del inmueble a cubrir el importe pagado por las mismas, en los términos del artículo 2303 del Código Civil vigente.",
  ]);
  c.push([
    "",
    "Si se requiere alguna reparación necesaria para el uso a que está destinada la localidad arrendada, en los términos de la fracción II del artículo 2273 del Código Civil, el arrendatario se obliga a poner oportunamente en conocimiento del arrendador dicha situación por escrito, recabando copia con acuse de recibo, pues en caso contrario será responsable de los daños y perjuicios que ocasione su omisión.",
  ]);
  c.push(["", "El arrendador no es responsable de la seguridad de los bienes muebles que introduzca el arrendatario en el inmueble."]);
  c.push([
    "",
    "Ambas partes manifiestan su expresa voluntad, sin coacción, de sujetarse a la cláusula de sujeción en caso de haber algún incumplimiento al clausulado del presente contrato, según lo establecen los artículos 574 y 575 del Código de Procedimientos Civiles del Estado de Puebla, que a la letra dicen: “Artículo 574. Pueden las partes por voluntad expresa dirimir su controversia en el juicio sumarísimo.” “Artículo 575. La voluntad a que se refiere el artículo anterior deberá constar en la celebración de un acto jurídico anterior a la controversia, siempre que se pacte que para el caso de que ésta surja, las partes se someterán a este procedimiento.”",
  ]);
  c.push([
    "",
    "Las partes que intervienen en el presente contrato declaran su conformidad en someterse, para la interpretación y cumplimiento del mismo, a la jurisdicción de las leyes aplicables y de los tribunales competentes de esta ciudad de Puebla, Pue., renunciando expresamente al fuero de su domicilio presente o futuro. Asimismo, declaran expresamente que al firmar el presente documento tuvieron a la vista el Código Civil citado y que se impusieron de la lectura de los artículos mencionados.",
  ]);

  const ORD = ["PRIMERA", "SEGUNDA", "TERCERA", "CUARTA", "QUINTA", "SEXTA", "SÉPTIMA", "OCTAVA", "NOVENA", "DÉCIMA", "DÉCIMA PRIMERA", "DÉCIMA SEGUNDA", "DÉCIMA TERCERA", "DÉCIMA CUARTA", "DÉCIMA QUINTA", "DÉCIMA SEXTA", "DÉCIMA SÉPTIMA", "DÉCIMA OCTAVA", "DÉCIMA NOVENA", "VIGÉSIMA", "VIGÉSIMA PRIMERA", "VIGÉSIMA SEGUNDA"];
  c.forEach(([, texto], i) => {
    const [primero, ...resto] = texto.split("\n");
    out.push({ tipo: "clausula", encabezado: `${ORD[i]}.`, texto: primero });
    for (const r of resto) out.push({ tipo: /^[A-E]\)/.test(r) ? "inciso" : "parrafo", texto: r });
  });
  out.push({ tipo: "parrafo", texto: `Firmado en la ciudad de ${d.ciudad_firma}, ${fechaContrato(d.fecha_firma)}.` });
  return out;
}

function firma(rol: string, nombre: string, cargo: string | null, empresa: string | null): string {
  return `<div class="firma"><div class="rol">${esc(rol)}</div><div class="linea"></div><div class="nombre">${esc(nombre)}</div>${cargo ? `<div>${esc(cargo)}</div>` : ""}${empresa ? `<div class="nombre">${esc(empresa)}</div>` : ""}</div>`;
}

function firmaParte(rol: string, p: ParteArrendamiento): string {
  return p.tipo_persona === "moral"
    ? firma(rol, hueco(p.representante).toUpperCase(), hueco(p.cargo).toUpperCase(), p.razon_social.toUpperCase())
    : firma(rol, p.razon_social.toUpperCase(), null, null);
}

const ESTILO = `
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.45; color: #000; margin: 0; }
  .hoja { max-width: 17cm; margin: 0 auto; padding: 1.5cm 0; }
  p { text-align: justify; margin: 0 0 8pt; }
  p.titulo { font-weight: bold; }
  h2 { font-size: 11pt; text-align: center; letter-spacing: 0.4em; margin: 16pt 0 10pt; }
  p.inciso { margin-left: 1cm; }
  .folio { text-align: right; font-size: 9pt; color: #444; margin-bottom: 6pt; }
  .firmas { margin-top: 30pt; text-align: center; page-break-inside: avoid; }
  .firma { margin: 0 auto 30pt; width: 60%; font-size: 10pt; }
  .rol { margin-bottom: 44pt; }
  .linea { border-top: 1px solid #000; margin-bottom: 4pt; }
  .nombre { font-weight: bold; }
  .btn { position: fixed; top: 8px; right: 8px; padding: 6px 12px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
  @page { size: letter; margin: 2.5cm 2.5cm 2cm; }
  @media print { .btn { display: none; } .hoja { padding: 0; } }
`;

function cuerpo(d: DatosArrendamiento): string {
  const html = textoArrendamiento(d)
    .map((p) => {
      if (p.tipo === "titulo") return `<p class="titulo">${esc(p.texto)}</p>`;
      if (p.tipo === "seccion") return `<h2>${esc(p.texto)}</h2>`;
      if (p.tipo === "inciso") return `<p class="inciso">${esc(p.texto)}</p>`;
      return `<p>${p.encabezado ? `<b>${esc(p.encabezado)}</b> ` : ""}${esc(p.texto)}</p>`;
    })
    .join("\n");
  const firmas = [firmaParte("ARRENDADOR", d.arrendador), firmaParte("ARRENDATARIO", d.arrendatario), d.fiador?.nombre?.trim() ? firma("FIADOR", d.fiador.nombre.toUpperCase(), null, null) : ""].join("");
  return `${d.folio ? `<div class="folio">${esc(d.folio)}</div>` : ""}${html}<div class="firmas">${firmas}</div>`;
}

export function htmlContratoArrendamiento(d: DatosArrendamiento): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Arrendamiento ${esc(d.folio ?? "")} ${esc(d.arrendatario.razon_social)}</title><style>${ESTILO}</style></head><body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
<div class="hoja">${cuerpo(d)}</div></body></html>`;
}

export function docContratoArrendamiento(d: DatosArrendamiento): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Contrato de arrendamiento</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${ESTILO.replace(/\.btn[^}]*}/, "")}</style></head><body><div>${cuerpo(d)}</div></body></html>`;
}

export function nombreArchivoArrendamiento(d: DatosArrendamiento, ext: "doc" | "html"): string {
  const nombre = d.arrendatario.razon_social.replace(/,?\s*S\.?\s*A\.?.*$/i, "").replace(/[^\p{L}\d ]/gu, "").trim();
  return `Arrendamiento ${d.folio ?? ""} ${nombre}`.replace(/\s+/g, " ").trim() + `.${ext}`;
}

/** Valores de inicio del formulario (los del contrato de Ergodinova). */
export const PENAS_DEFAULT = { pena_atraso_pct: 10, pena_cheque_pct: 20, aumento_no_desocupa_pct: 20 };

/** Nuestra empresa (o una del grupo) como parte del contrato, desde
 * empresas_perfil_legal (pestaña "Datos legales de la empresa"). */
export function parteDesdePerfil(f: Partial<FilaPerfilLegal> | null, nombreEmpresa: string): ParteArrendamiento {
  return {
    tipo_persona: "moral",
    razon_social: f?.razon_social || nombreEmpresa,
    rfc: f?.rfc ?? null,
    representante: f?.representante_legal_nombre ?? null,
    cargo: f?.representante_legal_puesto ?? null,
    domicilio: f?.domicilio_legal ?? null,
  };
}

/** Renovación: empieza el día siguiente al fin y dura los mismos meses. */
export function periodoRenovacion(inicio: string, fin: string): { inicio: string; fin: string } {
  const meses = Math.max(mesesDePlazo(inicio, fin), 1);
  const [a, m, d] = fin.split("-").map(Number);
  const nuevoInicio = new Date(Date.UTC(a, m - 1, d + 1));
  const ni = nuevoInicio.toISOString().slice(0, 10);
  // Mismo día del mes `meses` después, menos un día (sin desbordar fin de mes).
  const ai = nuevoInicio.getUTCFullYear();
  const mi = nuevoInicio.getUTCMonth() + meses;
  const di = nuevoInicio.getUTCDate();
  const ultimo = new Date(Date.UTC(ai, mi + 1, 0)).getUTCDate();
  const nf = new Date(Date.UTC(ai, mi, Math.min(di, ultimo) - 1));
  return { inicio: ni, fin: nf.toISOString().slice(0, 10) };
}
