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

export type EstatusRenglon = "pagado" | "vencido" | "programado" | "pendiente";

export interface CreditoConSaldo extends CreditoBase {
  saldo: number | string;
  estatus?: EstatusCredito;
  /** Números de pago ya registrados en el crédito. */
  numeros_pagados?: number[] | null;
  /** Números de pago que están pendientes en Programación de pagos. */
  numeros_programados?: number[] | null;
  /** Fecha del saldo del estado de cuenta: lo de antes ya está pagado. */
  saldo_corte_al?: string | null;
}

/**
 * Estatus de cada pago de la tabla: pagado si se registró con su número, si su
 * fecha es de antes del corte del estado de cuenta, o si el capital ya se
 * cubrió (lo amortizado = monto − saldo real); vencido si su fecha pasó;
 * programado si ya está en Programación de pagos; si no, pendiente.
 */
export function estatusRenglones(c: CreditoConSaldo, hoy: string): { renglon: RenglonAmortizacion; estatus: EstatusRenglon }[] {
  const tabla = tablaAmortizacion(c);
  const pagados = new Set(c.numeros_pagados ?? []);
  const programados = new Set(c.numeros_programados ?? []);
  const cerrado = !!c.estatus && c.estatus !== "vigente";
  const saldo = Number(c.saldo) || 0;
  const amortizado = (Number(c.monto) || 0) - saldo;
  return tabla.map((t) => {
    const cubierto =
      pagados.has(t.numero) ||
      cerrado ||
      saldo <= 0.5 ||
      (!!c.saldo_corte_al && t.fecha <= c.saldo_corte_al) ||
      (t.capital > 0 && t.capitalAcumulado <= amortizado + 0.5);
    const estatus: EstatusRenglon = cubierto ? "pagado" : t.fecha < hoy ? "vencido" : programados.has(t.numero) ? "programado" : "pendiente";
    return { renglon: t, estatus };
  });
}

export interface EstadoPago {
  proximo: RenglonAmortizacion | null;
  vencidos: number;
  montoVencido: number;
  pagosHechos: number;
  totalPagos: number;
}

/** Próximo pago (el primero sin pagar, aunque esté vencido) y lo vencido. */
export function estadoPagos(c: CreditoConSaldo, hoy: string): EstadoPago {
  const filas = estatusRenglones(c, hoy);
  const sinPagar = filas.filter((f) => f.estatus !== "pagado");
  const vencidas = sinPagar.filter((f) => f.estatus === "vencido");
  return {
    proximo: sinPagar[0]?.renglon ?? null,
    vencidos: vencidas.length,
    montoVencido: r2(vencidas.reduce((s, f) => s + f.renglon.pago, 0)),
    pagosHechos: filas.length - sinPagar.length,
    totalPagos: filas.length,
  };
}

/** Pagos sin pagar con fecha hasta `dias` adelante (y los vencidos), para
 * mandarlos a Programación de pagos (fn_deuda_enviar_pagos). */
export function pagosParaProgramar(c: CreditoConSaldo, hoy: string, dias = 60): { numero: number; de: number; fecha: string; capital: number; interes: number; iva: number; total: number }[] {
  if (c.estatus && c.estatus !== "vigente") return [];
  const limite = aIso(new Date(aFecha(hoy).getTime() + dias * 86400000));
  const filas = estatusRenglones(c, hoy);
  return filas
    .filter((f) => f.estatus !== "pagado" && f.renglon.fecha <= limite)
    .map((f) => ({ numero: f.renglon.numero, de: filas.length, fecha: f.renglon.fecha, capital: f.renglon.capital, interes: f.renglon.interes, iva: f.renglon.iva, total: f.renglon.pago }));
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

export interface CreditoGrupo extends CreditoConSaldo {
  id: string;
  folio: string;
  acreedor: string;
  tipo: TipoCredito;
  empresa_id: string;
  empresa_codigo?: string | null;
  empresa_nombre?: string | null;
  moneda: string;
  estatus: EstatusCredito;
  aval_empresa_id?: string | null;
}

function sumarDias(iso: string, dias: number): string {
  return aIso(new Date(aFecha(iso).getTime() + dias * 86400000));
}

/**
 * Lo de arriba de la pantalla (en MXN; otras monedas aparte): deuda total,
 * pagos de los próximos 30 días (con los vencidos), tasa ponderada por saldo,
 * capital que vence en 12 meses y su % (corto plazo), saldo por empresa y
 * cuántos créditos tienen aval de otra empresa del grupo.
 */
export function resumenGrupo(creditos: CreditoGrupo[], hoy: string) {
  const vivos = creditos.filter((c) => c.estatus === "vigente" && Number(c.saldo) > 0.5);
  const mxn = vivos.filter((c) => c.moneda === "MXN");
  const deuda = r2(mxn.reduce((s, c) => s + Number(c.saldo), 0));
  const en30 = sumarDias(hoy, 30);
  const en365 = sumarDias(hoy, 365);
  let pagos30 = 0;
  let n30 = 0;
  let vencidos = 0;
  let vence12 = 0;
  let conTasa = 0;
  let tasaXSaldo = 0;
  const empresas = new Map<string, { empresa: string; saldo: number }>();
  for (const c of mxn) {
    const filas = estatusRenglones(c, hoy).filter((f) => f.estatus !== "pagado");
    for (const f of filas) {
      if (f.renglon.fecha <= en30) {
        pagos30 += f.renglon.pago;
        n30++;
        if (f.estatus === "vencido") vencidos++;
      }
      if (f.renglon.fecha <= en365) vence12 += f.renglon.capital;
    }
    if (!filas.length && c.fecha_vencimiento && c.fecha_vencimiento <= en365) vence12 += Number(c.saldo);
    if (c.tasa_anual != null && c.tasa_anual !== "") {
      conTasa += Number(c.saldo);
      tasaXSaldo += Number(c.saldo) * Number(c.tasa_anual);
    }
    const e = empresas.get(c.empresa_id) ?? { empresa: c.empresa_nombre || c.empresa_codigo || c.empresa_id, saldo: 0 };
    e.saldo += Number(c.saldo);
    empresas.set(c.empresa_id, e);
  }
  vence12 = r2(Math.min(vence12, deuda));
  const otras = new Map<string, number>();
  for (const c of vivos.filter((x) => x.moneda !== "MXN")) otras.set(c.moneda, r2((otras.get(c.moneda) ?? 0) + Number(c.saldo)));
  return {
    deuda,
    creditos: mxn.length,
    pagos30: r2(pagos30),
    n30,
    vencidos,
    tasaPonderada: conTasa > 0 ? r2(tasaXSaldo / conTasa) : null,
    vence12,
    cortoPlazoPct: deuda > 0 ? Math.round((vence12 / deuda) * 1000) / 10 : 0,
    porEmpresa: [...empresas.values()].map((e) => ({ ...e, saldo: r2(e.saldo) })).sort((a, b) => b.saldo - a.saldo),
    avalesCruzados: vivos.filter((c) => c.aval_empresa_id && c.aval_empresa_id !== c.empresa_id).length,
    otrasMonedas: [...otras.entries()].map(([moneda, saldo]) => ({ moneda, saldo })),
  };
}

export interface MesCalendario {
  mes: string;
  renglones: { credito: CreditoGrupo; renglon: RenglonAmortizacion; estatus: EstatusRenglon }[];
  total: number;
}

/** Pagos sin pagar de todos los créditos vigentes (vencidos incluidos) hasta
 * `meses` adelante, por mes y por fecha. */
export function calendarioPagos(creditos: CreditoGrupo[], hoy: string, meses = 12): MesCalendario[] {
  const limite = sumarPeriodos(hoy, "mensual", meses);
  const todos: MesCalendario["renglones"] = [];
  for (const c of creditos.filter((x) => x.estatus === "vigente")) {
    for (const f of estatusRenglones(c, hoy)) {
      if (f.estatus !== "pagado" && f.renglon.fecha <= limite) todos.push({ credito: c, renglon: f.renglon, estatus: f.estatus });
    }
  }
  todos.sort((a, b) => a.renglon.fecha.localeCompare(b.renglon.fecha) || a.credito.acreedor.localeCompare(b.credito.acreedor, "es"));
  const porMes = new Map<string, MesCalendario>();
  for (const r of todos) {
    const mes = r.renglon.fecha.slice(0, 7);
    const m = porMes.get(mes) ?? { mes, renglones: [], total: 0 };
    m.renglones.push(r);
    m.total = r2(m.total + r.renglon.pago);
    porMes.set(mes, m);
  }
  return [...porMes.values()];
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

export interface MesPerfil {
  mes: string;
  total: number;
  vencido: number;
}

/** Perfil de pagos de los próximos `meses` meses (desde el mes de hoy), con
 * los meses en cero incluidos; lo vencido se suma al mes actual. Para ver con
 * anticipación los meses pesados. */
export function perfilPagos(creditos: CreditoGrupo[], hoy: string, meses = 12, moneda = "MXN"): MesPerfil[] {
  const inicio = `${hoy.slice(0, 7)}-01`;
  const lista: MesPerfil[] = Array.from({ length: meses }, (_, i) => ({ mes: sumarPeriodos(inicio, "mensual", i).slice(0, 7), total: 0, vencido: 0 }));
  const porMes = new Map(lista.map((m) => [m.mes, m]));
  for (const m of calendarioPagos(creditos.filter((c) => (c.moneda || "MXN") === moneda), hoy, meses)) {
    for (const r of m.renglones) {
      const destino = r.estatus === "vencido" ? lista[0] : porMes.get(r.renglon.fecha.slice(0, 7));
      if (!destino) continue;
      destino.total = r2(destino.total + r.renglon.pago);
      if (r.estatus === "vencido") destino.vencido = r2(destino.vencido + r.renglon.pago);
    }
  }
  return lista;
}

/** Pagos de los próximos `dias` días (y vencidos) que todavía no están en la
 * hoja de pagos, por crédito, listos para fn_deuda_enviar_pagos. */
export function porEnviar(creditos: CreditoGrupo[], hoy: string, dias = 30): { credito: CreditoGrupo; pagos: ReturnType<typeof pagosParaProgramar> }[] {
  return creditos
    .map((c) => {
      const ya = new Set(c.numeros_programados ?? []);
      return { credito: c, pagos: pagosParaProgramar(c, hoy, dias).filter((p) => !ya.has(p.numero)) };
    })
    .filter((x) => x.pagos.length > 0);
}
