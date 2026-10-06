// Historial de pagos y comprobantes (Mario, 6-oct-2026: "revisar otras
// semanas y otros días de comprobantes y consultarlas en el pasado"). Los
// pagos ya viven en pagos_programados; esto solo arma rangos de fechas,
// agrupa por día y suma. Puro, sin DOM, con pruebas.

export interface PagoHistorial {
  id: string;
  empresa_id: string;
  empresa_nombre: string;
  beneficiario: string;
  concepto: string | null;
  monto: number;
  fecha_programada: string;
  pagado_en: string | null;
  metodo: string;
  referencia: string | null;
  id_orden: string | null;
  oc_proyecto: string | null;
  comprobante_nombre: string | null;
  comprobante_path: string | null;
  confirmado_en: string | null;
}

export type AtajoRango = "hoy" | "ayer" | "semana" | "semana_pasada" | "mes" | "mes_pasado";

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function deIso(s: string): Date {
  const [a, m, d] = s.split("-").map(Number);
  return new Date(a, m - 1, d);
}

function sumarDias(s: string, n: number): string {
  const d = deIso(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

/** Lunes de la semana de `fecha` (semana lunes-domingo). */
export function lunesDe(fecha: string): string {
  const d = deIso(fecha);
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  return sumarDias(fecha, -dow);
}

export function rangoAtajo(atajo: AtajoRango, hoy: string): { desde: string; hasta: string } {
  switch (atajo) {
    case "hoy":
      return { desde: hoy, hasta: hoy };
    case "ayer": {
      const a = sumarDias(hoy, -1);
      return { desde: a, hasta: a };
    }
    case "semana": {
      const l = lunesDe(hoy);
      return { desde: l, hasta: sumarDias(l, 6) };
    }
    case "semana_pasada": {
      const l = sumarDias(lunesDe(hoy), -7);
      return { desde: l, hasta: sumarDias(l, 6) };
    }
    case "mes":
      return { desde: `${hoy.slice(0, 7)}-01`, hasta: sumarDias(`${mesSiguiente(hoy.slice(0, 7))}-01`, -1) };
    case "mes_pasado": {
      const primero = `${hoy.slice(0, 7)}-01`;
      const ultimo = sumarDias(primero, -1);
      return { desde: `${ultimo.slice(0, 7)}-01`, hasta: ultimo };
    }
  }
}

function mesSiguiente(ym: string): string {
  const [a, m] = ym.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
}

/** Recorre el rango una semana hacia atrás (n = -1) o adelante (n = 1) conservando su largo. */
export function moverRango(r: { desde: string; hasta: string }, n: number): { desde: string; hasta: string } {
  const largo = Math.round((deIso(r.hasta).getTime() - deIso(r.desde).getTime()) / 86400000) + 1;
  return { desde: sumarDias(r.desde, n * largo), hasta: sumarDias(r.hasta, n * largo) };
}

export interface DiaHistorial {
  fecha: string;
  pagos: PagoHistorial[];
  total: number;
  sinComprobante: number;
}

/** Agrupa por día de pago (más reciente primero) y dentro del día por monto. */
export function agruparPorDia(pagos: PagoHistorial[]): DiaHistorial[] {
  const m = new Map<string, PagoHistorial[]>();
  for (const p of pagos) {
    const f = p.pagado_en ?? p.fecha_programada;
    m.set(f, [...(m.get(f) ?? []), p]);
  }
  return [...m.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([fecha, lista]) => ({
      fecha,
      pagos: [...lista].sort((a, b) => Number(b.monto) - Number(a.monto)),
      total: lista.reduce((s, p) => s + Number(p.monto), 0),
      sinComprobante: lista.filter((p) => !p.comprobante_path).length,
    }));
}

export function totalesHistorial(pagos: PagoHistorial[]) {
  let total = 0;
  let efectivo = 0;
  let sinComprobante = 0;
  for (const p of pagos) {
    total += Number(p.monto);
    if (p.metodo === "efectivo") efectivo += Number(p.monto);
    if (!p.comprobante_path) sinComprobante += 1;
  }
  return { n: pagos.length, total, efectivo, transferencia: total - efectivo, sinComprobante };
}

const celda = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function csvHistorial(pagos: PagoHistorial[]): string {
  const filas = [["Fecha de pago", "Empresa", "OC", "Proyecto", "Beneficiario", "Concepto", "Método", "Referencia", "Monto", "Comprobante", "Confirmado"]];
  for (const p of pagos)
    filas.push([
      p.pagado_en ?? p.fecha_programada,
      p.empresa_nombre,
      p.id_orden ?? "",
      p.oc_proyecto ?? "",
      p.beneficiario,
      p.concepto ?? "",
      p.metodo,
      p.referencia ?? "",
      Number(p.monto).toFixed(2),
      p.comprobante_path ? p.comprobante_nombre ?? "sí" : "",
      p.confirmado_en ? p.confirmado_en.slice(0, 10) : "",
    ]);
  return "﻿" + filas.map((f) => f.map(celda).join(",")).join("\n");
}
