// Crédito de nómina con firma digital (19-oct-2026, Mario: "cada trabajador
// que firme su pagaré, consentimiento y afiliación a crédito de manera
// digital; una vez pasando esa parte serán préstamos con intereses ya que será
// parte del negocio financiero").
//
//   * amortizar(): pagos semanales iguales (sistema francés, tasa anual / 52),
//     IVA sobre intereses y CAT sin IVA. Es el MISMO cálculo que
//     fn_nomina_crear_cargo (interés total = pago × n − capital, redondeado;
//     descuento por pago redondeado hacia arriba al centavo).
//   * Textos de afiliación, consentimiento de descuento y pagaré: BORRADOR
//     para revisión de los abogados. Lo que se firma se guarda tal cual en
//     credito_firmas (con su huella SHA-256), así que cambiar un texto aquí
//     no altera lo ya firmado: sube VERSION_DOCUMENTOS.
//   * Art. 111 LFT: el patrón no cobra intereses. Con intereses, el acreedor es
//     la financiera (otra empresa); sin intereses, el patrón.

import { fechaEnLetras, montoEnLetras } from "./contratoCredito.ts";

export const VERSION_DOCUMENTOS = "borrador-2026-10-19";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface FilaAmortizacion {
  numero: number;
  fecha: string;
  capital: number;
  interes: number;
  iva: number;
  pago: number;
  saldo: number;
}

export interface Amortizacion {
  monto: number;
  pagos: number;
  tasaAnual: number;
  interes: number;
  iva: number;
  total: number;
  descuentoPorPago: number;
  /** Costo anual total sin IVA, en %. */
  cat: number;
  filas: FilaAmortizacion[];
}

function sumarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Tabla de pagos semanales. Sin tasa: el monto entre los pagos, sin intereses. */
export function amortizar(monto: number, tasaAnual: number, ivaPct: number, pagos: number, primerViernes: string): Amortizacion {
  const n = Math.max(1, Math.floor(pagos));
  const i = tasaAnual > 0 ? tasaAnual / 100 / 52 : 0;
  const pagoBase = i > 0 ? (monto * i) / (1 - Math.pow(1 + i, -n)) : monto / n;
  const interes = i > 0 ? r2(pagoBase * n - monto) : 0;
  const iva = r2((interes * ivaPct) / 100);
  const total = r2(monto + interes + iva);
  const descuentoPorPago = Math.ceil((total / n) * 100 - 1e-6) / 100;
  const filas: FilaAmortizacion[] = [];
  let saldoCapital = monto;
  let restaInteres = interes;
  let restaIva = iva;
  let restaTotal = total;
  for (let k = 1; k <= n && restaTotal > 0.004; k++) {
    const ultimo = k === n || restaTotal <= descuentoPorPago + 0.004;
    const pago = ultimo ? r2(restaTotal) : descuentoPorPago;
    let int = ultimo ? restaInteres : Math.min(restaInteres, r2(saldoCapital * i));
    let ivaK = ultimo ? restaIva : Math.min(restaIva, r2((int * ivaPct) / 100));
    let capital = r2(pago - int - ivaK);
    if (capital > saldoCapital) {
      capital = r2(saldoCapital);
      int = r2(pago - capital - ivaK);
    }
    if (capital < 0) {
      capital = 0;
      ivaK = r2(pago - int);
    }
    saldoCapital = r2(saldoCapital - capital);
    restaInteres = r2(restaInteres - int);
    restaIva = r2(restaIva - ivaK);
    restaTotal = r2(restaTotal - pago);
    filas.push({ numero: k, fecha: sumarDias(primerViernes, (k - 1) * 7), capital, interes: int, iva: ivaK, pago, saldo: Math.max(0, restaTotal) });
  }
  return { monto: r2(monto), pagos: n, tasaAnual, interes, iva, total, descuentoPorPago, cat: i > 0 ? Math.round((Math.pow(1 + i, 52) - 1) * 1000) / 10 : 0, filas };
}

/** Pagos mínimos para no pasar del tope semanal (ley o capacidad de pago). */
export function pagosMinimosConInteres(monto: number, tasaAnual: number, ivaPct: number, tope: number, maximo: number, primerViernes: string): number | null {
  for (let n = 1; n <= maximo; n++) {
    if (amortizar(monto, tasaAnual, ivaPct, n, primerViernes).descuentoPorPago <= tope + 0.005) return n;
  }
  return null;
}

// ── Documentos ──────────────────────────────────────────────────────────────

export interface ParteDocumento {
  razon_social: string;
  rfc?: string | null;
  domicilio?: string | null;
}

export interface DatosAfiliacion {
  trabajador: string;
  puesto?: string | null;
  patron: ParteDocumento;
  /** La financiera que presta con intereses (si ya está configurada). */
  financiera?: ParteDocumento | null;
  ciudad: string;
  fecha: string;
}

export interface DatosPagare extends DatosAfiliacion {
  acreedor: ParteDocumento;
  concepto: string;
  amortizacion: Amortizacion;
  tasaMoratoria: number;
}

const fechaCorta = (iso: string) => iso.split("-").reverse().join("/");
const pesos = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

function parte(p: ParteDocumento): string {
  return [p.razon_social, p.rfc ? `RFC ${p.rfc}` : "", p.domicilio ? `con domicilio en ${p.domicilio}` : ""].filter(Boolean).join(", ");
}

export interface Documento {
  tipo: "afiliacion" | "consentimiento" | "pagare";
  titulo: string;
  texto: string;
}

export function documentoAfiliacion(d: DatosAfiliacion): Documento {
  const financiera = d.financiera
    ? ` y, para los préstamos con intereses, ${parte(d.financiera)} (en adelante "la Financiera")`
    : "";
  const texto = [
    `SOLICITUD DE AFILIACIÓN AL PROGRAMA DE CRÉDITO DE NÓMINA`,
    `En ${d.ciudad}, a ${fechaEnLetras(d.fecha)}.`,
    `Yo, ${d.trabajador}${d.puesto ? `, con puesto de ${d.puesto}` : ""}, trabajador(a) de ${parte(d.patron)} (en adelante "el Patrón"), solicito mi afiliación al programa de crédito de nómina que ofrecen el Patrón${financiera}.`,
    `1. ESTUDIO. Autorizo que, para decidir y revisar mi línea de crédito, se consulte la información que la empresa ya tiene de mí: antigüedad, sueldo, asistencia en el checador, cumplimiento de tareas, cuidado de la herramienta y del equipo de protección, y mi historial de pagos en este programa. Entiendo que la línea, el nivel y el plazo pueden subir, bajar o suspenderse según esa información.`,
    `2. CRÉDITOS SIN INTERESES. Las compras en el mostrador de la empresa y los anticipos de sueldo que me otorgue el Patrón no generan intereses (artículo 111 de la Ley Federal del Trabajo) y se descuentan dentro de los límites del artículo 110 de esa ley.`,
    `3. PRÉSTAMOS CON INTERESES. Los préstamos con intereses los otorga la Financiera, no el Patrón. Antes de cada uno se me mostrará el monto, la tasa de interés, el IVA de los intereses, el costo anual total (CAT), el número de pagos y la fecha de cada descuento, y solo se entregará si firmo el pagaré correspondiente.`,
    `4. FIRMA ELECTRÓNICA. Acepto firmar este y los demás documentos del programa por medios electrónicos, dentro de mi cuenta personal de la aplicación de la empresa, a la que solo yo tengo acceso. Reconozco que mi firma dibujada en la pantalla, junto con mi sesión, la fecha, la hora y la huella digital del documento que guarda el sistema, me identifican como firmante y tienen el mismo valor que mi firma autógrafa (artículos 89 a 114 del Código de Comercio y 1803 y 1834 bis del Código Civil Federal).`,
    `5. DATOS PERSONALES. Mis datos se usan solo para administrar este programa, conforme al aviso de privacidad de la empresa. Puedo pedir acceso, rectificación o cancelación con Recursos Humanos.`,
    `6. BAJA DEL PROGRAMA. Puedo pedir mi baja cuando no tenga saldos pendientes; mientras tenga saldo, sigue vigente lo que firmé.`,
    `Declaro que la información que he dado es verdadera.`,
    `Firma del trabajador(a): ${d.trabajador}`,
  ].join("\n\n");
  return { tipo: "afiliacion", titulo: "Afiliación al programa de crédito de nómina", texto };
}

export function documentoConsentimiento(d: DatosAfiliacion): Documento {
  const financiera = d.financiera ? `, y a entregar a ${d.financiera.razon_social} lo que corresponda a los préstamos que ella me otorgue` : "";
  const texto = [
    `CONSENTIMIENTO Y AUTORIZACIÓN DE DESCUENTO VÍA NÓMINA`,
    `En ${d.ciudad}, a ${fechaEnLetras(d.fecha)}.`,
    `Yo, ${d.trabajador}, autorizo expresamente a ${parte(d.patron)} a descontar de mi salario semanal las cantidades que yo deba por compras en el mostrador de la empresa, anticipos de sueldo y préstamos del programa de crédito de nómina${financiera}.`,
    `1. Cada descuento será por la cantidad y en las fechas que se me muestren en la aplicación al momento de cada compra o préstamo. En las deudas con el Patrón el descuento no pasará del 30 % del excedente de mi salario sobre el salario mínimo ni la deuda de un mes de mi salario (artículo 110, fracción I, de la Ley Federal del Trabajo).`,
    `2. Las compras en el mostrador las identifico con mi credencial (código QR) de la aplicación; el ticket de cada compra es parte de esta autorización.`,
    `3. Si mi relación de trabajo termina con saldo pendiente, autorizo que se descuente de lo que se me pague al terminar, en la medida que la ley lo permita, y me comprometo a pagar el resto conforme a lo que haya firmado.`,
    `4. Puedo consultar en todo momento mis saldos, mis descuentos y los documentos que firmé en la aplicación (Mi personaje → Mi QR).`,
    `5. Esta autorización sigue vigente mientras tenga saldos en el programa; la puedo revocar cuando no tenga saldos pendientes.`,
    `Firma del trabajador(a): ${d.trabajador}`,
  ].join("\n\n");
  return { tipo: "consentimiento", titulo: "Consentimiento de descuento vía nómina", texto };
}

export function documentoPagare(d: DatosPagare): Documento {
  const a = d.amortizacion;
  const ultimo = a.filas[a.filas.length - 1]?.fecha ?? d.fecha;
  const conInteres = a.tasaAnual > 0;
  const tabla = a.filas
    .map((f) => `   ${String(f.numero).padStart(2, " ")}. ${fechaCorta(f.fecha)}  ${pesos(f.pago)}${conInteres ? `  (capital ${pesos(f.capital)}, interés ${pesos(f.interes)}, IVA ${pesos(f.iva)})` : ""}`)
    .join("\n");
  const texto = [
    `PAGARÉ`,
    `Bueno por ${pesos(a.total)}`,
    `En ${d.ciudad}, a ${fechaEnLetras(d.fecha)}.`,
    `Debo y pagaré incondicionalmente a la orden de ${parte(d.acreedor)}, en su domicilio o en el lugar que me indique, la cantidad de ${pesos(a.total)} (${montoEnLetras(a.total)}), que se integra por ${pesos(a.monto)} de capital${conInteres ? `, ${pesos(a.interes)} de intereses ordinarios a la tasa fija de ${a.tasaAnual} % anual y ${pesos(a.iva)} de IVA sobre los intereses (CAT ${a.cat} % sin IVA, para fines informativos y de comparación)` : ", sin intereses"}, por concepto de: ${d.concepto}.`,
    `Esta cantidad se pagará mediante ${a.pagos} pago(s) semanal(es) de ${pesos(a.descuentoPorPago)} (el último por el saldo), que autorizo descontar de mi salario, en estas fechas:\n${tabla}`,
    `El vencimiento final es el ${fechaEnLetras(ultimo)}. Si dejo de cubrir cualquier pago a su vencimiento, el tenedor podrá dar por vencido anticipadamente el saldo y exigir el pago total${d.tasaMoratoria > 0 ? `, y la cantidad vencida causará intereses moratorios a la tasa de ${d.tasaMoratoria} % anual hasta su pago total` : ""}.`,
    `Puedo pagar anticipadamente, en todo o en parte, sin penalización${conInteres ? "; los intereses se recalcularán sobre el saldo de capital" : ""}.`,
    `Suscriptor: ${d.trabajador}${d.puesto ? `, ${d.puesto}` : ""}, trabajador(a) de ${d.patron.razon_social}.`,
    `Firmado electrónicamente por el suscriptor en su cuenta personal de la aplicación, conforme a su afiliación al programa de crédito de nómina.`,
  ].join("\n\n");
  return { tipo: "pagare", titulo: `Pagaré · ${d.concepto} · ${pesos(a.total)}`, texto };
}

// ── Impresión ───────────────────────────────────────────────────────────────

export interface FirmaGuardada {
  titulo: string;
  contenido: string;
  firma: string;
  hash: string;
  firmante_nombre: string | null;
  firmado_en: string;
  ip: string | null;
  version: string;
  revocada_en?: string | null;
  revocada_motivo?: string | null;
}

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** HTML imprimible de un documento firmado: el texto tal cual, la firma y la constancia. */
export function htmlDocumentoFirmado(f: FirmaGuardada): string {
  const fecha = new Date(f.firmado_en).toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long", timeStyle: "medium" });
  const parrafos = f.contenido
    .split(/\n{2,}/)
    .map((p, k) => (k === 0 ? `<h1>${escapar(p)}</h1>` : `<p>${escapar(p).replace(/\n/g, "<br>")}</p>`))
    .join("\n");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapar(f.titulo)}</title>
<style>body{font:12pt/1.45 Georgia,serif;max-width:720px;margin:24px auto;padding:0 16px;color:#111}h1{font-size:14pt;text-align:center}
p{text-align:justify;white-space:normal}.firma{margin-top:24px;text-align:center}.firma img{max-width:320px;border-bottom:1px solid #111}
.constancia{margin-top:24px;font:9pt/1.4 monospace;color:#444;border-top:1px solid #999;padding-top:8px;word-break:break-all}
.revocada{color:#b91c1c;font-weight:bold;text-align:center}@media print{body{margin:0}}</style></head><body>
${f.revocada_en ? `<p class="revocada">REVOCADO el ${escapar(new Date(f.revocada_en).toLocaleDateString("es-MX"))}: ${escapar(f.revocada_motivo ?? "")}</p>` : ""}
${parrafos}
<div class="firma"><img src="${escapar(f.firma)}" alt="firma"><div>${escapar(f.firmante_nombre ?? "")}</div></div>
<div class="constancia">Firmado electrónicamente el ${escapar(fecha)} (hora del centro de México)${f.ip ? ` desde la IP ${escapar(f.ip)}` : ""}.<br>
Versión del texto: ${escapar(f.version)} · Huella SHA-256 del texto y la firma: ${escapar(f.hash)}</div>
</body></html>`;
}
