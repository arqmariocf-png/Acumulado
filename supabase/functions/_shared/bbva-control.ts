// Formato nuevo del control BBVA ("Mantenimiento - KPIs de cobranza.xlsx",
// 21-sep-2026): hoja "BBVA Mantto" con UNA fila por trabajo y el estatus de
// cada paso (recepción → programación → ejecución → soportes → autorización
// → fichero → pedido → factura → pago), más la hoja "Obra Menor" con sus
// proyectos. Sustituye al maestro plano de folios (bbva-folios.ts) pero se
// sigue alimentando el mismo dashboard: de aquí salen los Registro que ya
// entiende agregarRegistros, y además el detalle por folio que se guarda en
// bbva_folios_control para ver el paso en el que va cada uno.
//
// Todo es puro sobre filas (unknown[][]) para poder probarlo en node sin
// leer un XLSX; el edge function lee el libro y llama parsearControlBbva.

/** Un folio del maestro/control ya normalizado -- el contrato que entiende
 * agregarRegistros (bbva-folios.ts). Vive aquí, y no en bbva-folios.ts,
 * para que el frontend pueda importar este módulo sin arrastrar npm:xlsx. */
export interface Registro {
  folio: unknown;
  fecha: Date | null;
  supervisor: string;
  sucursal: string | null;
  descripcion: string;
  monto: number;
  proceso: "Mantenimiento" | "Obra Menor";
  pedido: unknown;
  factura: unknown;
  fechaPago: Date | null;
  enRevision: boolean;
}

export interface FolioControl {
  id_interno: string;
  folio: string | null;
  cr: string | null;
  sucursal: string | null;
  solicitud: string | null;
  fecha_recepcion: string | null;
  fecha_primera_atencion: string | null;
  prioridad: string | null;
  fecha_compromiso_cliente: string | null;
  supervisor: string | null;
  equipo: string | null;
  fecha_programada: string | null;
  ventana_acceso: string | null;
  estatus_operativo: string | null;
  motivo_bloqueo: string | null;
  siguiente_accion: string | null;
  responsable_siguiente: string | null;
  fecha_compromiso_siguiente: string | null;
  fecha_ultima_actualizacion: string | null;
  alerta_siguiente_paso: string | null;
  fecha_finalizacion: string | null;
  fecha_aceptacion_cliente: string | null;
  generadores: string | null;
  reporte_fotografico: string | null;
  caratula: string | null;
  presupuesto: string | null;
  soportes_completos: string | null;
  fecha_envio_soportes: string | null;
  autorizacion: string | null;
  fecha_autorizacion: string | null;
  accion_fichero: string | null;
  fecha_fichero: string | null;
  etapa_seguimiento: string | null;
  enlace_evidencia: string | null;
  monto_a_cobrar: number | null;
  pedido: string | null;
  factura: string | null;
  observaciones: string | null;
  revision_registro: string | null;
  fecha_recepcion_pedido: string | null;
  fecha_recepcion_factura: string | null;
  estado_pago: string | null;
  monto_cobrado: number | null;
  monto_solicitado: number | null;
  pago_aplicado: number | null;
  saldo_por_cobrar: number | null;
  revision_cobranza: string | null;
}

export interface ObraMenorControl {
  numero: number;
  fecha: string | null;
  cr: string | null;
  supervisor: string | null;
  sucursal: string | null;
  codigo_uda: string | null;
  accion_ejecutada: string | null;
  estatus_folio: string | null;
  monto_cobrado: number | null;
  estado: string | null;
}

/** Los pasos del proceso, en orden, con la regla para saber si ya se
 * cumplió en un folio. Un paso "cumplido" no dice nada de los siguientes. */
export const PASOS_BBVA = [
  { clave: "recepcion", etiqueta: "Recepción", cumplido: (f: FolioControl) => !!f.fecha_recepcion },
  { clave: "programado", etiqueta: "Programado", cumplido: (f: FolioControl) => !!f.fecha_programada || !!f.equipo },
  { clave: "terminado", etiqueta: "Terminado", cumplido: (f: FolioControl) => (f.estatus_operativo ?? "").toLowerCase() === "terminado" },
  { clave: "soportes", etiqueta: "Soportes", cumplido: (f: FolioControl) => (f.soportes_completos ?? "").toLowerCase() === "completo" },
  { clave: "enviado", etiqueta: "Enviado", cumplido: (f: FolioControl) => !!f.fecha_envio_soportes || (f.autorizacion ?? "").toLowerCase() === "autorizado" || (f.accion_fichero ?? "").toLowerCase().startsWith("fichero") },
  { clave: "autorizado", etiqueta: "Autorizado", cumplido: (f: FolioControl) => (f.autorizacion ?? "").toLowerCase() === "autorizado" },
  { clave: "fichero", etiqueta: "Fichero", cumplido: (f: FolioControl) => (f.accion_fichero ?? "").toLowerCase().startsWith("fichero") },
  { clave: "pedido", etiqueta: "Pedido", cumplido: (f: FolioControl) => !!f.pedido },
  { clave: "factura", etiqueta: "Factura", cumplido: (f: FolioControl) => !!f.factura },
  { clave: "pago", etiqueta: "Pago", cumplido: (f: FolioControl) => (f.estado_pago ?? "").toLowerCase().startsWith("pago realizado") },
] as const;

export type ClavePaso = (typeof PASOS_BBVA)[number]["clave"];

export function esCancelado(f: Pick<FolioControl, "estatus_operativo" | "etapa_seguimiento">): boolean {
  return (f.estatus_operativo ?? "").toUpperCase() === "CANCELADO" || (f.etapa_seguimiento ?? "").toLowerCase() === "cancelado";
}

/** El paso más avanzado que ya se cumplió: es "en qué paso va". Se toma
 * el más avanzado (no el último consecutivo) porque el control histórico
 * trae huecos, ej. trabajos Terminados sin fecha programada capturada. */
export function pasoActual(f: FolioControl): { indice: number; clave: ClavePaso | null; etiqueta: string; cancelado: boolean } {
  if (esCancelado(f)) return { indice: -1, clave: null, etiqueta: "Cancelado", cancelado: true };
  let ultimo = -1;
  for (let i = 0; i < PASOS_BBVA.length; i++) {
    if (PASOS_BBVA[i].cumplido(f)) ultimo = i;
  }
  return { indice: ultimo, clave: ultimo >= 0 ? PASOS_BBVA[ultimo].clave : null, etiqueta: ultimo >= 0 ? PASOS_BBVA[ultimo].etiqueta : "Sin iniciar", cancelado: false };
}

function texto(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return fechaIso(v);
  const t = String(v).trim();
  return t === "" ? null : t;
}

function numero(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100) / 100;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return v.trim() !== "" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  return null;
}

export function fechaIso(v: unknown): string | null {
  if (v instanceof Date) {
    if (isNaN(v.getTime()) || v.getFullYear() < 2000) return null;
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, "0"), d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/) ?? v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    if (m[0].includes("/")) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

const COLUMNAS_MANTTO: [keyof FolioControl, string, "texto" | "fecha" | "numero"][] = [
  ["id_interno", "ID INTERNO", "texto"],
  ["folio", "FOLIO CLIENTE", "texto"],
  ["cr", "CR", "texto"],
  ["sucursal", "SUCURSAL", "texto"],
  ["solicitud", "SOLICITUD / ALCANCE", "texto"],
  ["fecha_recepcion", "FECHA RECEPCIÓN DEL FOLIO", "fecha"],
  ["fecha_primera_atencion", "FECHA PRIMERA ATENCIÓN", "fecha"],
  ["prioridad", "PRIORIDAD", "texto"],
  ["fecha_compromiso_cliente", "FECHA COMPROMISO CON EL CLIENTE", "fecha"],
  ["supervisor", "SUPERVISOR BBVA", "texto"],
  ["equipo", "EQUIPO EJECUTOR", "texto"],
  ["fecha_programada", "FECHA PROGRAMADA DE ATENCIÓN", "fecha"],
  ["ventana_acceso", "VENTANA DE ACCESO", "texto"],
  ["estatus_operativo", "ESTATUS OPERATIVO", "texto"],
  ["motivo_bloqueo", "MOTIVO DE BLOQUEO", "texto"],
  ["siguiente_accion", "SIGUIENTE ACCIÓN", "texto"],
  ["responsable_siguiente", "RESPONSABLE SIGUIENTE PASO", "texto"],
  ["fecha_compromiso_siguiente", "FECHA COMPROMISO SIGUIENTE PASO", "fecha"],
  ["fecha_ultima_actualizacion", "FECHA ÚLTIMA ACTUALIZACIÓN", "fecha"],
  ["alerta_siguiente_paso", "ALERTA DEL SIGUIENTE PASO", "texto"],
  ["fecha_finalizacion", "FECHA FINALIZACIÓN", "fecha"],
  ["fecha_aceptacion_cliente", "FECHA ACEPTACIÓN DEL CLIENTE", "fecha"],
  ["generadores", "GENERADORES", "texto"],
  ["reporte_fotografico", "REPORTE FOTOGRÁFICO", "texto"],
  ["caratula", "CARÁTULA", "texto"],
  ["presupuesto", "PRESUPUESTO", "texto"],
  ["soportes_completos", "SOPORTES COMPLETOS", "texto"],
  ["fecha_envio_soportes", "FECHA ENVÍO DE SOPORTES", "fecha"],
  ["autorizacion", "AUTORIZACIÓN", "texto"],
  ["fecha_autorizacion", "FECHA AUTORIZACIÓN", "fecha"],
  ["accion_fichero", "ACCIÓN / FICHERO", "texto"],
  ["fecha_fichero", "FECHA REALIZACIÓN DEL FICHERO", "fecha"],
  ["etapa_seguimiento", "ETAPA DE SEGUIMIENTO", "texto"],
  ["enlace_evidencia", "ENLACE A CARPETA DE EVIDENCIA", "texto"],
  ["monto_a_cobrar", "MONTO A COBRAR", "numero"],
  ["pedido", "N.º PEDIDO", "texto"],
  ["factura", "N.º FACTURA", "texto"],
  ["observaciones", "OBSERVACIONES / RESOLUCIÓN", "texto"],
  ["revision_registro", "REVISIÓN AUTOMÁTICA DEL REGISTRO", "texto"],
  ["fecha_recepcion_pedido", "FECHA RECEPCIÓN DEL PEDIDO", "fecha"],
  ["fecha_recepcion_factura", "FECHA RECEPCIÓN FACTURA / PAGO", "fecha"],
  ["estado_pago", "ESTADO DEL PAGO", "texto"],
  ["monto_cobrado", "MONTO COBRADO CONFIRMADO", "numero"],
  ["monto_solicitado", "MONTO SOLICITADO A BBVA", "numero"],
  ["pago_aplicado", "PAGO APLICADO AL SERVICIO", "numero"],
  ["saldo_por_cobrar", "SALDO POR COBRAR", "numero"],
  ["revision_cobranza", "REVISIÓN DE COBRANZA", "texto"],
];

function normalizarEncabezado(h: unknown): string {
  return String(h ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

/** true si la hoja trae el encabezado del control nuevo ("ID interno" +
 * "Folio cliente"). */
export function esFormatoControl(filas: unknown[][]): boolean {
  return filas.slice(0, 15).some((f) => {
    const hs = f.map(normalizarEncabezado);
    return hs.includes("ID INTERNO") && hs.some((h) => h.startsWith("FOLIO CLIENTE"));
  });
}

export function parsearMantto(filas: unknown[][]): FolioControl[] {
  const idx = filas.findIndex((f) => f.map(normalizarEncabezado).includes("ID INTERNO"));
  if (idx < 0) throw new Error('No se encontró el encabezado "ID interno" en la hoja BBVA Mantto.');
  const encabezados = filas[idx].map(normalizarEncabezado);
  const col = (prefijo: string) => encabezados.findIndex((h) => h.startsWith(prefijo));
  const mapa = COLUMNAS_MANTTO.map(([campo, prefijo, tipo]) => [campo, col(prefijo), tipo] as const);
  const faltan = mapa.filter(([campo, i]) => i < 0 && ["id_interno", "folio", "sucursal", "supervisor", "estatus_operativo", "monto_a_cobrar"].includes(campo));
  if (faltan.length) throw new Error(`Faltan columnas en BBVA Mantto: ${faltan.map(([c]) => c).join(", ")}`);

  const salida: FolioControl[] = [];
  for (const fila of filas.slice(idx + 1)) {
    if (!fila || texto(fila[mapa[0][1]]) == null) continue;
    const f = {} as Record<string, unknown>;
    for (const [campo, i, tipo] of mapa) {
      const v = i >= 0 ? fila[i] : null;
      f[campo] = tipo === "fecha" ? fechaIso(v) : tipo === "numero" ? numero(v) : texto(v);
    }
    salida.push(f as unknown as FolioControl);
  }
  return salida;
}

export function parsearObraMenor(filas: unknown[][]): ObraMenorControl[] {
  const idx = filas.findIndex((f) => f.map(normalizarEncabezado).includes("N°") && f.map(normalizarEncabezado).includes("MONTO COBRADO"));
  if (idx < 0) return [];
  const hs = filas[idx].map(normalizarEncabezado);
  const col = (n: string) => hs.findIndex((h) => h === n || h.startsWith(n));
  const iN = col("N°"), iFecha = col("FECHA"), iCr = col("CR"), iSup = col("SUPERVISOR"), iSuc = col("SUCURSAL"), iUda = col("CODIGO UDA"),
    iAcc = col("ACCIÓN EJECUTADA"), iEst = col("ESTATUS FOLIO"), iMonto = col("MONTO COBRADO"), iEstado = col("ESTADO");
  const salida: ObraMenorControl[] = [];
  for (const fila of filas.slice(idx + 1)) {
    if (!fila || typeof fila[iN] !== "number") continue;
    salida.push({
      numero: fila[iN] as number,
      fecha: fechaIso(fila[iFecha]),
      cr: texto(fila[iCr]),
      supervisor: texto(fila[iSup]),
      sucursal: texto(fila[iSuc]),
      codigo_uda: texto(fila[iUda]),
      accion_ejecutada: texto(fila[iAcc]),
      estatus_folio: texto(fila[iEst]),
      monto_cobrado: numero(fila[iMonto]),
      estado: texto(fila[iEstado]),
    });
  }
  return salida;
}

function aDate(iso: string | null): Date | null {
  return iso ? new Date(iso + "T00:00:00") : null;
}

function nombre(s: string | null): string {
  const t = (s ?? "").trim();
  if (!t) return "Sin Asignar";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** Registro para el dashboard (mismo contrato que el maestro viejo). Los
 * cancelados y el folio duplicado se excluyen igual que antes; "pagado" =
 * estado de pago "Pago realizado" con su fecha de factura/pago. */
export function registrosDesdeControl(folios: FolioControl[], obraMenor: ObraMenorControl[]): Registro[] {
  const r: Registro[] = [];
  for (const f of folios) {
    if (esCancelado(f)) continue;
    if ((f.accion_fichero ?? "").toLowerCase().includes("duplicado")) continue;
    const pagado = (f.estado_pago ?? "").toLowerCase().startsWith("pago realizado");
    r.push({
      folio: f.folio ?? f.id_interno,
      fecha: aDate(f.fecha_recepcion),
      supervisor: nombre(f.supervisor),
      sucursal: f.sucursal,
      descripcion: f.solicitud ?? "",
      monto: f.monto_a_cobrar ?? 0,
      proceso: "Mantenimiento",
      pedido: f.pedido,
      factura: f.factura,
      fechaPago: pagado ? aDate(f.fecha_recepcion_factura) : null,
      enRevision: ["confirmar envío", "esperar autorización"].includes((f.etapa_seguimiento ?? "").toLowerCase()),
    });
  }
  for (const o of obraMenor) {
    if ((o.estado ?? "").toLowerCase().startsWith("cancelado")) continue;
    r.push({
      folio: o.codigo_uda ?? String(o.numero),
      fecha: aDate(o.fecha),
      supervisor: nombre(o.supervisor),
      sucursal: o.sucursal,
      descripcion: o.accion_ejecutada ?? "",
      monto: o.monto_cobrado ?? 0,
      proceso: "Obra Menor",
      pedido: null,
      factura: null,
      fechaPago: null,
      enRevision: false,
    });
  }
  return r;
}

export interface ResumenControl {
  total: number;
  por_etapa: Record<string, number>;
  por_paso: Record<string, number>;
  por_supervisor: Record<string, { total: number; cancelados: number; por_paso: Record<string, number> }>;
  cancelados: number;
  sin_pago: number;
  obra_menor: { total: number; por_estatus: Record<string, number>; monto: number };
}

export function resumirControl(folios: FolioControl[], obraMenor: ObraMenorControl[]): ResumenControl {
  const res: ResumenControl = { total: folios.length, por_etapa: {}, por_paso: {}, por_supervisor: {}, cancelados: 0, sin_pago: 0, obra_menor: { total: obraMenor.length, por_estatus: {}, monto: 0 } };
  for (const f of folios) {
    const etapa = f.etapa_seguimiento ?? "Sin etapa";
    res.por_etapa[etapa] = (res.por_etapa[etapa] ?? 0) + 1;
    const p = pasoActual(f);
    res.por_paso[p.etiqueta] = (res.por_paso[p.etiqueta] ?? 0) + 1;
    const sup = nombre(f.supervisor);
    res.por_supervisor[sup] ??= { total: 0, cancelados: 0, por_paso: {} };
    res.por_supervisor[sup].total++;
    if (p.cancelado) { res.cancelados++; res.por_supervisor[sup].cancelados++; } else {
      res.por_supervisor[sup].por_paso[p.etiqueta] = (res.por_supervisor[sup].por_paso[p.etiqueta] ?? 0) + 1;
      if (!(f.estado_pago ?? "").toLowerCase().startsWith("pago realizado")) res.sin_pago++;
    }
  }
  for (const o of obraMenor) {
    const e = o.estado ?? o.estatus_folio ?? "Sin estatus";
    res.obra_menor.por_estatus[e] = (res.obra_menor.por_estatus[e] ?? 0) + 1;
    res.obra_menor.monto += o.monto_cobrado ?? 0;
  }
  res.obra_menor.monto = Math.round(res.obra_menor.monto * 100) / 100;
  return res;
}
