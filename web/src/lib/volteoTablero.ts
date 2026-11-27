// Tablero de volteo (27-nov-2026, Laura: "pendiente dashboard Volteo"). El
// mismo que llevaba en "Dash volteo.xlsx": inversión, ingresos, costo del
// material, mano de obra (chofer), gastos de operación, utilidad y % por
// semana y por mes, recuperación de la inversión. Junta lo capturado en
// Logística (viajes y gastos de las unidades de volteo, con el histórico
// 2024-2025 del Excel) y lo que está en el backoffice sin capturar aquí
// (`fn_volteo_backoffice`: OV de material = ingreso; OC/OS de la obra
// "Volteo International" = gasto). Puro, sin DOM, con pruebas.

import type { TipoGasto } from "./volteo.ts";

export type Rubro = "material" | "mano_obra" | "operacion";

export interface Ingreso {
  id: string;
  origen: "viaje" | "ov";
  fecha: string;
  folio: string | null;
  cliente: string | null;
  obra: string | null;
  material: string | null;
  cantidad: number;
  unidad: string | null;
  importe: number;
}

export interface Egreso {
  id: string;
  origen: "gasto" | "oc";
  fecha: string;
  folio: string | null;
  tipo: string;
  rubro: Rubro;
  proveedor: string | null;
  concepto: string | null;
  monto: number;
}

const num = (x: unknown) => (x == null || x === "" ? 0 : Number(x) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Material para vender y tiro de escombro = costo de lo vendido; chofer =
 * mano de obra; lo demás (combustible, seguro, taller…) = operación. */
export function rubroDeGasto(tipo: string): Rubro {
  if (tipo === "material" || tipo === "tiro") return "material";
  if (tipo === "chofer") return "mano_obra";
  return "operacion";
}

/** Tipo de gasto de una OC/OS del backoffice por su texto (proveedor y partidas). */
export function tipoDeOc(texto: string): TipoGasto {
  const t = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (/DIESEL/.test(t)) return "diesel";
  if (/GASOLIN|GAS\b|FORZA GAS|COMBUSTIBLE/.test(t)) return "gasolina";
  if (/SEGURO|QUALITAS/.test(t)) return "seguro";
  if (/VERIFICACI/.test(t)) return "verificacion";
  if (/PLACA|TENENCIA|CONTROL VEHICULAR/.test(t)) return "tenencia";
  if (/LLANTA/.test(t)) return "llantas";
  if (/CASETA|AUTOPISTA/.test(t)) return "casetas";
  if (/ESCOMBRO|TIRO/.test(t)) return "tiro";
  if (/ARENA|GRAVA|PIEDRA|TEPET|TEZONTLE|BASE HIDRA|CACAHUAT/.test(t)) return "material";
  if (/MANTENIMIENTO|REPARACI|SERVICIO MEC|ACEITE|AFINACI/.test(t)) return "mantenimiento";
  if (/REFACCI|FUSIBLE|BATERIA|TERMINAL/.test(t)) return "refacciones";
  if (/CHOFER|VIATICO|NOMINA/.test(t)) return "chofer";
  return "otro";
}

export interface DatosVolteo {
  viajes: { id: string; unidad_id: string; fecha: string; folio: string | null; cliente: string | null; destino: string | null; material: string | null; cantidad: number | string | null; unidad_medida: string; viajes: number | string | null; importe: number | string; estado: string }[];
  gastos: { id: string; unidad_id: string; fecha: string; folio: string | null; tipo: string; proveedor: string | null; descripcion: string | null; monto: number | string }[];
  backoffice?: {
    ingresos?: { id: string; fecha: string | null; folio: string | null; cliente: string | null; proyecto: string | null; material: string | null; unidad: string | null; cantidad: number | string | null; importe: number | string }[];
    gastos?: { id: string; fecha: string | null; folio: string | null; tipo: string | null; proveedor: string | null; concepto: string | null; monto: number | string; unidad_id: string | null }[];
  } | null;
}

/** Une lo capturado y lo del backoffice, solo de las unidades indicadas. */
export function movimientosVolteo(d: DatosVolteo, unidades: Set<string>): { ingresos: Ingreso[]; egresos: Egreso[] } {
  const ingresos: Ingreso[] = [];
  for (const v of d.viajes) {
    if (!unidades.has(v.unidad_id) || v.estado === "cancelado") continue;
    ingresos.push({ id: v.id, origen: "viaje", fecha: v.fecha, folio: v.folio, cliente: v.cliente, obra: v.destino, material: v.material, cantidad: num(v.cantidad) || num(v.viajes) || 1, unidad: v.unidad_medida, importe: num(v.importe) });
  }
  for (const o of d.backoffice?.ingresos ?? []) {
    if (!o.fecha) continue;
    ingresos.push({ id: `ov-${o.id}-${o.material ?? ""}-${o.importe}`, origen: "ov", fecha: o.fecha, folio: o.folio, cliente: o.cliente, obra: o.proyecto, material: o.material, cantidad: num(o.cantidad), unidad: o.unidad, importe: num(o.importe) });
  }
  const egresos: Egreso[] = [];
  for (const g of d.gastos) {
    if (!unidades.has(g.unidad_id)) continue;
    egresos.push({ id: g.id, origen: "gasto", fecha: g.fecha, folio: g.folio, tipo: g.tipo, rubro: rubroDeGasto(g.tipo), proveedor: g.proveedor, concepto: g.descripcion, monto: num(g.monto) });
  }
  for (const o of d.backoffice?.gastos ?? []) {
    if (!o.fecha || (o.unidad_id && !unidades.has(o.unidad_id))) continue;
    const tipo = tipoDeOc(`${o.proveedor ?? ""} ${o.concepto ?? ""}`);
    egresos.push({ id: `oc-${o.id}`, origen: "oc", fecha: o.fecha, folio: o.folio, tipo, rubro: rubroDeGasto(tipo), proveedor: o.proveedor, concepto: o.concepto, monto: num(o.monto) });
  }
  return { ingresos, egresos };
}

export interface Totales {
  ingresos: number;
  material: number;
  mano_obra: number;
  operacion: number;
  egresos: number;
  utilidad: number;
  margen_pct: number | null;
  viajes: number;
}

export function totales(ingresos: Ingreso[], egresos: Egreso[]): Totales {
  const t: Totales = { ingresos: 0, material: 0, mano_obra: 0, operacion: 0, egresos: 0, utilidad: 0, margen_pct: null, viajes: ingresos.length };
  for (const i of ingresos) t.ingresos += i.importe;
  for (const e of egresos) t[e.rubro] += e.monto;
  t.ingresos = r2(t.ingresos);
  t.material = r2(t.material);
  t.mano_obra = r2(t.mano_obra);
  t.operacion = r2(t.operacion);
  t.egresos = r2(t.material + t.mano_obra + t.operacion);
  t.utilidad = r2(t.ingresos - t.egresos);
  t.margen_pct = t.ingresos > 0 ? Math.round((t.utilidad / t.ingresos) * 1000) / 10 : null;
  return t;
}

/** Lunes (ISO) de la semana de una fecha AAAA-MM-DD. */
export function lunes(fecha: string): string {
  const d = new Date(`${fecha.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export type Agrupacion = "mes" | "semana";

/** Serie por mes (AAAA-MM) o por semana (lunes), de la más vieja a la más nueva. */
export function serie(ingresos: Ingreso[], egresos: Egreso[], por: Agrupacion): (Totales & { clave: string })[] {
  const clave = (f: string) => (por === "mes" ? f.slice(0, 7) : lunes(f));
  const ing = new Map<string, Ingreso[]>();
  const egr = new Map<string, Egreso[]>();
  for (const i of ingresos) ing.set(clave(i.fecha), [...(ing.get(clave(i.fecha)) ?? []), i]);
  for (const e of egresos) egr.set(clave(e.fecha), [...(egr.get(clave(e.fecha)) ?? []), e]);
  const claves = [...new Set([...ing.keys(), ...egr.keys()])].sort();
  return claves.map((k) => ({ clave: k, ...totales(ing.get(k) ?? [], egr.get(k) ?? []) }));
}

/** Recuperación de la inversión: utilidad acumulada desde que opera contra lo
 * invertido; meses que faltan al ritmo promedio de los últimos 6 meses con
 * movimiento (null si ese ritmo no es positivo). */
export function recuperacion(inversion: number, utilidadAcumulada: number, mensual: { utilidad: number }[]): { pct: number | null; falta: number; meses_faltan: number | null; ritmo: number } {
  const ult = mensual.slice(-6);
  const ritmo = ult.length ? r2(ult.reduce((s, m) => s + m.utilidad, 0) / ult.length) : 0;
  const falta = r2(Math.max(0, inversion - utilidadAcumulada));
  return {
    pct: inversion > 0 ? Math.round((utilidadAcumulada / inversion) * 1000) / 10 : null,
    falta,
    meses_faltan: falta === 0 ? 0 : ritmo > 0 ? Math.ceil(falta / ritmo) : null,
    ritmo,
  };
}

/** Suma por una llave (cliente, material, tipo…), de mayor a menor. */
export function sumaPor<T>(filas: T[], llave: (f: T) => string, valor: (f: T) => number): { clave: string; total: number; n: number }[] {
  const m = new Map<string, { total: number; n: number }>();
  for (const f of filas) {
    const k = (llave(f) || "Sin dato").trim() || "Sin dato";
    const x = m.get(k) ?? { total: 0, n: 0 };
    x.total += valor(f);
    x.n += 1;
    m.set(k, x);
  }
  return [...m.entries()].map(([clave, x]) => ({ clave, total: r2(x.total), n: x.n })).sort((a, b) => b.total - a.total || a.clave.localeCompare(b.clave));
}

/** Nombre del material sin variantes de captura ("GRAVA DE1/2" = "Grava de 1/2"). */
export function nombreMaterial(m: string | null): string {
  const t = (m ?? "").trim().replace(/\s+/g, " ");
  if (!t) return "Sin dato";
  const s = t.toLowerCase().replace(/de(\d)/, "de $1");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type Periodo = "todo" | "12m" | string; // string = año "2025"

export function enPeriodoVolteo(fecha: string, p: Periodo, hoy: string): boolean {
  if (p === "todo") return true;
  if (p === "12m") {
    const d = new Date(`${hoy}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return fecha >= d.toISOString().slice(0, 10) && fecha <= hoy;
  }
  return fecha.startsWith(p);
}
