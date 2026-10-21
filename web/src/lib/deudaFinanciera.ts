// Deuda financiera (21-oct-2026, Mario: "crear un módulo de deuda financiera
// para subir los préstamos"). Créditos de bancos, arrendadoras o particulares
// por empresa: tabla de amortización proyectada, próximo pago y vencidos,
// resumen del grupo y carga desde Excel/CSV. El saldo lo calcula la base
// (v_deuda_creditos); aquí solo se proyecta. Puro, con pruebas.

export type TipoCredito = "simple" | "revolvente" | "arrendamiento" | "hipotecario" | "tarjeta" | "factoraje" | "particular" | "otro";
export type Periodicidad = "semanal" | "quincenal" | "mensual" | "bimestral" | "trimestral" | "semestral" | "anual" | "al_vencimiento";
export type Amortizacion = "pagos_iguales" | "capital_igual" | "al_vencimiento" | "personalizado";
export type EstatusCredito = "vigente" | "liquidado" | "reestructurado" | "cancelado";

export const TIPOS_CREDITO: Record<TipoCredito, string> = {
  simple: "Crédito simple",
  revolvente: "Revolvente / cuenta corriente",
  arrendamiento: "Arrendamiento",
  hipotecario: "Hipotecario",
  tarjeta: "Tarjeta empresarial",
  factoraje: "Factoraje",
  particular: "Préstamo de particular",
  otro: "Otro",
};

export const PERIODICIDADES: Record<Periodicidad, string> = {
  semanal: "Semanal",
  quincenal: "Quincenal",
  mensual: "Mensual",
  bimestral: "Bimestral",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  al_vencimiento: "Un solo pago al vencimiento",
};

export const AMORTIZACIONES: Record<Amortizacion, string> = {
  pagos_iguales: "Pagos iguales (capital + interés)",
  capital_igual: "Capital igual + interés sobre saldo",
  al_vencimiento: "Solo intereses; capital al vencimiento",
  personalizado: "Personalizado (sin tabla)",
};

export const ESTATUS_CREDITO: Record<EstatusCredito, string> = {
  vigente: "Vigente",
  liquidado: "Liquidado",
  reestructurado: "Reestructurado",
  cancelado: "Cancelado",
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface CreditoBase {
  monto: number | string;
  fecha_disposicion: string;
  fecha_vencimiento?: string | null;
  tasa_anual?: number | string | null;
  iva_intereses?: boolean | null;
  plazo_meses?: number | null;
  periodicidad: Periodicidad;
  amortizacion: Amortizacion;
  primer_pago?: string | null;
}

const PAGOS_POR_ANO: Record<Exclude<Periodicidad, "al_vencimiento">, number> = {
  semanal: 52,
  quincenal: 24,
  mensual: 12,
  bimestral: 6,
  trimestral: 4,
  semestral: 2,
  anual: 1,
};
const MESES_POR_PERIODO: Partial<Record<Periodicidad, number>> = { mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };
const DIAS_POR_PERIODO: Partial<Record<Periodicidad, number>> = { semanal: 7, quincenal: 15 };

function aFecha(iso: string): Date {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}
function aIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Suma periodos a una fecha; con meses respeta el día (31 → fin de mes). */
export function sumarPeriodos(iso: string, periodicidad: Periodicidad, n: number): string {
  const base = aFecha(iso);
  const meses = MESES_POR_PERIODO[periodicidad];
  if (meses) {
    const dia = base.getUTCDate();
    const objetivo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + meses * n, 1));
    const ultimo = new Date(Date.UTC(objetivo.getUTCFullYear(), objetivo.getUTCMonth() + 1, 0)).getUTCDate();
    objetivo.setUTCDate(Math.min(dia, ultimo));
    return aIso(objetivo);
  }
  const dias = DIAS_POR_PERIODO[periodicidad] ?? 0;
  base.setUTCDate(base.getUTCDate() + dias * n);
  return aIso(base);
}

/** Número de pagos del plazo (al vencimiento = 1). */
export function numeroPagos(c: Pick<CreditoBase, "plazo_meses" | "periodicidad">): number {
  if (c.periodicidad === "al_vencimiento") return 1;
  const meses = Number(c.plazo_meses) || 0;
  if (meses <= 0) return 0;
  return Math.max(1, Math.round((meses * PAGOS_POR_ANO[c.periodicidad]) / 12));
}

export interface RenglonAmortizacion {
  numero: number;
  fecha: string;
  saldoInicial: number;
  capital: number;
  interes: number;
  iva: number;
  pago: number;
  saldoFinal: number;
  /** Capital acumulado al terminar este pago. */
  capitalAcumulado: number;
}

/** Tabla de amortización proyectada con los términos del contrato. */
export function tablaAmortizacion(c: CreditoBase): RenglonAmortizacion[] {
  const monto = Number(c.monto) || 0;
  if (monto <= 0 || c.amortizacion === "personalizado") return [];
  const n = numeroPagos(c);
  const tasaAnual = (Number(c.tasa_anual) || 0) / 100;
  const ivaTasa = c.iva_intereses === false ? 0 : 0.16;
  const filas: RenglonAmortizacion[] = [];

  if (c.periodicidad === "al_vencimiento" || n === 0) {
    const vence = c.fecha_vencimiento ?? c.primer_pago;
    if (!vence) return [];
    const dias = Math.max(0, (aFecha(vence).getTime() - aFecha(c.fecha_disposicion).getTime()) / 86400000);
    const interes = r2((monto * tasaAnual * dias) / 360);
    const iva = r2(interes * ivaTasa);
    return [{ numero: 1, fecha: vence, saldoInicial: monto, capital: monto, interes, iva, pago: r2(monto + interes + iva), saldoFinal: 0, capitalAcumulado: monto }];
  }

  const r = tasaAnual / PAGOS_POR_ANO[c.periodicidad];
  const primero = c.primer_pago ?? sumarPeriodos(c.fecha_disposicion, c.periodicidad, 1);
  const cuota = r > 0 ? (monto * r) / (1 - Math.pow(1 + r, -n)) : monto / n;
  let saldo = monto;
  let acumulado = 0;
  for (let i = 1; i <= n; i++) {
    const interes = r2(saldo * r);
    let capital: number;
    if (c.amortizacion === "pagos_iguales") capital = r2(cuota - saldo * r);
    else if (c.amortizacion === "capital_igual") capital = r2(monto / n);
    else capital = 0; // solo intereses
    if (i === n) capital = r2(saldo); // el último cierra el saldo exacto
    const iva = r2(interes * ivaTasa);
    const saldoFinal = r2(saldo - capital);
    acumulado = r2(acumulado + capital);
    filas.push({ numero: i, fecha: sumarPeriodos(primero, c.periodicidad, i - 1), saldoInicial: r2(saldo), capital, interes, iva, pago: r2(capital + interes + iva), saldoFinal, capitalAcumulado: acumulado });
    saldo = saldoFinal;
  }
  return filas;
}

export interface EstadoPago {
  proximo: RenglonAmortizacion | null;
  vencidos: number;
  montoVencido: number;
}

/**
 * Próximo pago y vencidos contra el saldo real: lo amortizado hasta hoy es
 * monto − saldo (incluye lo pagado antes del corte del estado de cuenta). Un
 * pago está vencido si su fecha ya pasó y su capital acumulado aún no se cubre.
 * Con solo intereses, el próximo es la siguiente fecha (no hay capital que
 * medir hasta el final).
 */
export function estadoPagos(c: CreditoBase & { saldo: number | string; estatus?: EstatusCredito }, hoy: string): EstadoPago {
  if (c.estatus && c.estatus !== "vigente") return { proximo: null, vencidos: 0, montoVencido: 0 };
  const saldo = Number(c.saldo) || 0;
  if (saldo <= 0.5) return { proximo: null, vencidos: 0, montoVencido: 0 };
  const tabla = tablaAmortizacion(c);
  if (!tabla.length) return { proximo: null, vencidos: 0, montoVencido: 0 };
  if (c.amortizacion === "al_vencimiento") {
    const proximo = tabla.find((t) => t.fecha >= hoy) ?? null;
    const final = tabla[tabla.length - 1];
    const vencido = final.fecha < hoy;
    return { proximo: proximo ?? (vencido ? final : null), vencidos: vencido ? 1 : 0, montoVencido: vencido ? r2(saldo) : 0 };
  }
  const amortizado = (Number(c.monto) || 0) - saldo;
  const pendientes = tabla.filter((t) => t.capitalAcumulado > amortizado + 0.5);
  const vencidas = pendientes.filter((t) => t.fecha < hoy);
  return {
    proximo: pendientes[0] ?? null,
    vencidos: vencidas.length,
    montoVencido: r2(vencidas.reduce((s, t) => s + t.pago, 0)),
  };
}

export interface CreditoResumen {
  empresa_id: string;
  empresa_codigo?: string | null;
  moneda: string;
  saldo: number | string;
  tasa_anual?: number | string | null;
  estatus: EstatusCredito;
}

/** Totales por moneda y por empresa, y tasa promedio ponderada por saldo. */
export function resumenDeuda(creditos: CreditoResumen[]): {
  porMoneda: { moneda: string; saldo: number; creditos: number; tasaPonderada: number | null }[];
  porEmpresa: { empresa: string; moneda: string; saldo: number; creditos: number }[];
} {
  const vivos = creditos.filter((c) => c.estatus === "vigente" && Number(c.saldo) > 0);
  const monedas = new Map<string, { saldo: number; creditos: number; conTasa: number; tasaXSaldo: number }>();
  const empresas = new Map<string, { empresa: string; moneda: string; saldo: number; creditos: number }>();
  for (const c of vivos) {
    const s = Number(c.saldo);
    const m = monedas.get(c.moneda) ?? { saldo: 0, creditos: 0, conTasa: 0, tasaXSaldo: 0 };
    m.saldo += s;
    m.creditos++;
    if (c.tasa_anual != null && c.tasa_anual !== "") {
      m.conTasa += s;
      m.tasaXSaldo += s * Number(c.tasa_anual);
    }
    monedas.set(c.moneda, m);
    const k = `${c.empresa_id}|${c.moneda}`;
    const e = empresas.get(k) ?? { empresa: c.empresa_codigo ?? c.empresa_id, moneda: c.moneda, saldo: 0, creditos: 0 };
    e.saldo += s;
    e.creditos++;
    empresas.set(k, e);
  }
  return {
    porMoneda: [...monedas.entries()].map(([moneda, m]) => ({ moneda, saldo: r2(m.saldo), creditos: m.creditos, tasaPonderada: m.conTasa > 0 ? r2(m.tasaXSaldo / m.conTasa) : null })),
    porEmpresa: [...empresas.values()].map((e) => ({ ...e, saldo: r2(e.saldo) })).sort((a, b) => b.saldo - a.saldo),
  };
}

// ── Carga desde Excel / CSV ──────────────────────────────────────────────

function normalizar(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

type CampoCarga =
  | "empresa"
  | "acreedor"
  | "tipo"
  | "contrato"
  | "moneda"
  | "monto"
  | "fecha_disposicion"
  | "fecha_vencimiento"
  | "tasa_anual"
  | "tasa_tipo"
  | "tasa_referencia"
  | "plazo_meses"
  | "periodicidad"
  | "amortizacion"
  | "primer_pago"
  | "saldo_corte"
  | "saldo_corte_al"
  | "garantia"
  | "aval"
  | "notas";

const ENCABEZADOS: Record<CampoCarga, string[]> = {
  empresa: ["empresa", "codigoempresa", "codigo", "razonsocial"],
  acreedor: ["acreedor", "banco", "institucion", "prestamista", "acreditante"],
  tipo: ["tipo", "tipodecredito", "tipocredito", "producto"],
  contrato: ["contrato", "numerodecontrato", "nocontrato", "numerocontrato", "credito", "numerodecredito"],
  moneda: ["moneda", "divisa"],
  monto: ["monto", "montooriginal", "importe", "montodispuesto", "capital", "montodelcredito"],
  fecha_disposicion: ["fechadisposicion", "disposicion", "fechadedisposicion", "fechainicio", "inicio", "fecha"],
  fecha_vencimiento: ["fechavencimiento", "vencimiento", "fechadevencimiento", "fechafin", "fin"],
  tasa_anual: ["tasa", "tasaanual", "tasadeinteres", "tasainteres", "interes"],
  tasa_tipo: ["tipodetasa", "tipotasa", "fijavariable"],
  tasa_referencia: ["referencia", "tasareferencia", "tiie", "sobretasa"],
  plazo_meses: ["plazo", "plazomeses", "meses", "plazoenmeses"],
  periodicidad: ["periodicidad", "frecuencia", "periodo", "pagos"],
  amortizacion: ["amortizacion", "formadepago", "esquema"],
  primer_pago: ["primerpago", "fechaprimerpago", "fechadeprimerpago"],
  saldo_corte: ["saldo", "saldoactual", "saldoalcorte", "saldoinsoluto"],
  saldo_corte_al: ["saldoal", "fechasaldo", "fechadecorte", "corte", "fechadelsaldo"],
  garantia: ["garantia", "garantias"],
  aval: ["aval", "obligadosolidario", "avales"],
  notas: ["notas", "observaciones", "comentarios"],
};

/** Número de "$1,250,000.00", "14.5%" o "1 250 000". */
export function numeroDeTexto(t: string | null | undefined): number | null {
  if (t == null) return null;
  const limpio = String(t).replace(/[$%\s]/g, "").replace(/,/g, "");
  if (limpio === "") return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** Fecha ISO de "2026-01-15", "15/01/2026", "15-01-26" o un ISO con hora. */
export function fechaDeTexto(t: string | null | undefined): string | null {
  if (!t) return null;
  const s = String(t).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valida(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const ano = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return valida(ano, Number(m[2]), Number(m[1]));
  }
  return null;
}
function valida(a: number, m: number, d: number): string | null {
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return aIso(f);
}

function enumDe<T extends string>(t: string | null | undefined, opciones: Record<T, string>, alias: Record<string, T> = {}): T | null {
  if (!t) return null;
  const n = normalizar(t);
  if (alias[n]) return alias[n];
  for (const k of Object.keys(opciones) as T[]) if (normalizar(k) === n || normalizar(opciones[k]) === n) return k;
  for (const k of Object.keys(opciones) as T[]) if (n.startsWith(normalizar(k))) return k;
  return null;
}

export interface CreditoCarga {
  fila: number;
  empresa: string;
  empresa_id: string | null;
  acreedor: string;
  tipo: TipoCredito;
  contrato: string | null;
  moneda: "MXN" | "USD";
  monto: number | null;
  fecha_disposicion: string | null;
  fecha_vencimiento: string | null;
  tasa_anual: number | null;
  tasa_tipo: "fija" | "variable";
  tasa_referencia: string | null;
  plazo_meses: number | null;
  periodicidad: Periodicidad;
  amortizacion: Amortizacion;
  primer_pago: string | null;
  saldo_corte: number | null;
  saldo_corte_al: string | null;
  garantia: string | null;
  aval: string | null;
  notas: string | null;
  errores: string[];
}

/**
 * Lee la hoja: busca la fila de encabezados en las primeras 15 y reconoce las
 * columnas por nombre (sin acentos ni mayúsculas). La empresa se busca por
 * código o nombre en las del alcance de quien sube.
 */
export function creditosDesdeTabla(tabla: (string | null)[][], empresas: { id: string; codigo: string; nombre: string }[]): { creditos: CreditoCarga[]; faltan: string[] } {
  let filaEnc = -1;
  const col: Partial<Record<CampoCarga, number>> = {};
  for (let i = 0; i < Math.min(15, tabla.length) && filaEnc < 0; i++) {
    const enc = (tabla[i] ?? []).map((c) => normalizar(c ?? ""));
    const encontrados: Partial<Record<CampoCarga, number>> = {};
    for (const campo of Object.keys(ENCABEZADOS) as CampoCarga[]) {
      const j = enc.findIndex((h) => h !== "" && ENCABEZADOS[campo].includes(h));
      if (j >= 0 && !Object.values(encontrados).includes(j)) encontrados[campo] = j;
    }
    if (encontrados.acreedor != null && encontrados.monto != null) {
      filaEnc = i;
      Object.assign(col, encontrados);
    }
  }
  if (filaEnc < 0) return { creditos: [], faltan: ["No encontré los encabezados: al menos Acreedor (o Banco) y Monto."] };

  const valor = (fila: (string | null)[], campo: CampoCarga) => {
    const j = col[campo];
    const v = j == null ? null : fila[j];
    return v == null || String(v).trim() === "" ? null : String(v).trim();
  };
  const unicaEmpresa = empresas.length === 1 ? empresas[0] : null;
  const creditos: CreditoCarga[] = [];
  for (let i = filaEnc + 1; i < tabla.length; i++) {
    const fila = tabla[i] ?? [];
    if (fila.every((c) => c == null || String(c).trim() === "")) continue;
    const errores: string[] = [];
    const empresaTxt = valor(fila, "empresa") ?? "";
    const emp = empresaTxt
      ? empresas.find((e) => normalizar(e.codigo) === normalizar(empresaTxt) || normalizar(e.nombre) === normalizar(empresaTxt))
      : unicaEmpresa;
    if (!emp) errores.push(empresaTxt ? `Empresa "${empresaTxt}" no reconocida` : "Falta la empresa");
    const acreedor = valor(fila, "acreedor") ?? "";
    if (!acreedor) errores.push("Falta el acreedor");
    const monto = numeroDeTexto(valor(fila, "monto"));
    if (!(monto != null && monto > 0)) errores.push("Monto inválido");
    const fechaTxt = valor(fila, "fecha_disposicion");
    const fecha_disposicion = fechaDeTexto(fechaTxt);
    if (!fecha_disposicion) errores.push(fechaTxt ? `Fecha de disposición "${fechaTxt}" no se entiende` : "Falta la fecha de disposición");
    const fecha_vencimiento = fechaDeTexto(valor(fila, "fecha_vencimiento"));
    if (fecha_vencimiento && fecha_disposicion && fecha_vencimiento < fecha_disposicion) errores.push("El vencimiento es antes de la disposición");
    const saldo_corte = numeroDeTexto(valor(fila, "saldo_corte"));
    const saldo_corte_al = fechaDeTexto(valor(fila, "saldo_corte_al"));
    if (saldo_corte != null && saldo_corte < 0) errores.push("Saldo negativo");
    if (saldo_corte != null && !saldo_corte_al) errores.push("Con saldo, falta la fecha del saldo");
    const tasa = numeroDeTexto(valor(fila, "tasa_anual"));
    const tasaTipoTxt = normalizar(valor(fila, "tasa_tipo") ?? "");
    const monedaTxt = normalizar(valor(fila, "moneda") ?? "mxn");
    creditos.push({
      fila: i + 1,
      empresa: emp?.codigo ?? empresaTxt,
      empresa_id: emp?.id ?? null,
      acreedor,
      tipo: enumDe(valor(fila, "tipo"), TIPOS_CREDITO, { creditosimple: "simple", arrendamientofinanciero: "arrendamiento", leasing: "arrendamiento", tdc: "tarjeta", tarjetadecredito: "tarjeta", prestamo: "particular" }) ?? "simple",
      contrato: valor(fila, "contrato"),
      moneda: monedaTxt.startsWith("usd") || monedaTxt.startsWith("dol") ? "USD" : "MXN",
      monto,
      fecha_disposicion,
      fecha_vencimiento,
      // 0.145 en Excel con formato de porcentaje = 14.5 %.
      tasa_anual: tasa != null && tasa > 0 && tasa < 1 ? r2(tasa * 100) : tasa,
      tasa_tipo: tasaTipoTxt.startsWith("var") ? "variable" : "fija",
      tasa_referencia: valor(fila, "tasa_referencia"),
      plazo_meses: (() => {
        const p = numeroDeTexto(valor(fila, "plazo_meses"));
        return p != null && p > 0 ? Math.round(p) : null;
      })(),
      periodicidad: enumDe(valor(fila, "periodicidad"), PERIODICIDADES, { mes: "mensual", mensuales: "mensual", unsolopago: "al_vencimiento", bullet: "al_vencimiento", alvencimiento: "al_vencimiento" }) ?? "mensual",
      amortizacion: enumDe(valor(fila, "amortizacion"), AMORTIZACIONES, { frances: "pagos_iguales", pagosfijos: "pagos_iguales", alemana: "capital_igual", capitalfijo: "capital_igual", bullet: "al_vencimiento", sololintereses: "al_vencimiento", solointereses: "al_vencimiento" }) ?? "pagos_iguales",
      primer_pago: fechaDeTexto(valor(fila, "primer_pago")),
      saldo_corte,
      saldo_corte_al,
      garantia: valor(fila, "garantia"),
      aval: valor(fila, "aval"),
      notas: valor(fila, "notas"),
      errores,
    });
  }
  return { creditos, faltan: [] };
}

/** Encabezados de la plantilla para descargar. */
export const PLANTILLA_CARGA = [
  "Empresa",
  "Acreedor",
  "Tipo",
  "Contrato",
  "Moneda",
  "Monto",
  "Fecha disposicion",
  "Vencimiento",
  "Tasa anual",
  "Tipo de tasa",
  "Referencia",
  "Plazo meses",
  "Periodicidad",
  "Amortizacion",
  "Primer pago",
  "Saldo",
  "Saldo al",
  "Garantia",
  "Aval",
  "Notas",
];

export function csvPlantilla(): string {
  const ejemplo = ["AEP", "BBVA México", "Crédito simple", "0012345678", "MXN", "1500000", "15/01/2026", "15/01/2029", "14.5", "Variable", "TIIE 28 + 4.0", "36", "Mensual", "Pagos iguales", "15/02/2026", "1250000", "30/09/2026", "Hipoteca nave", "Mario Contreras", ""];
  const linea = (v: string[]) => v.map((x) => (/[",]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(",");
  return [linea(PLANTILLA_CARGA), linea(ejemplo)].join("\n");
}
