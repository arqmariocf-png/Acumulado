// Semáforo de tesorería por empresa (Delia, 29-sep-2026). Sin DOM: se
// prueba en node. Lo que Delia paga hoy por transferencia debe verse en el
// estado de cuenta que ella misma sube: al cierre, saldo del banco menos lo
// que falta por pagar es lo que debe quedar.

export interface EmpresaTesoreria {
  empresa_id: string;
  empresa_nombre: string;
  /** Saldo de cierre de hoy según el banco (lo que subió Delia). */
  saldo_final: number;
  /** Salidas del día según el banco. */
  salidas: number;
  /** Pagos por transferencia pendientes con fecha hoy o vencidos. */
  pendientes_hoy: number;
  /** Pagos por transferencia marcados como pagados hoy. */
  pagados_hoy: number;
  /** Pagos en efectivo de hoy (no tocan el banco). */
  efectivo_hoy: number;
  n_pendientes: number;
}

export type ColorTesoreria = "verde" | "ambar" | "rojo" | "gris";

export interface SemaforoTesoreria {
  color: ColorTesoreria;
  texto: string;
  /** Saldo del banco menos lo que falta por pagar hoy. */
  disponible: number;
  /** Pagados hoy que el banco todavía no refleja (pagados − salidas). */
  sin_reflejar: number;
}

/** Reglas: rojo si lo pendiente rebasa el saldo; ámbar si falta pagar o si
 * hay pagos marcados que el banco aún no muestra; verde si no falta nada
 * y lo pagado ya está en el estado de cuenta; gris sin pagos ni saldo. */
export function semaforoTesoreria(e: Pick<EmpresaTesoreria, "saldo_final" | "salidas" | "pendientes_hoy" | "pagados_hoy">): SemaforoTesoreria {
  const disponible = Math.round((e.saldo_final - e.pendientes_hoy) * 100) / 100;
  const sin_reflejar = Math.max(0, Math.round((e.pagados_hoy - e.salidas) * 100) / 100);
  if (e.pendientes_hoy <= 0 && e.pagados_hoy <= 0 && e.saldo_final === 0) return { color: "gris", texto: "Sin pagos ni saldo hoy", disponible, sin_reflejar };
  if (disponible < 0) return { color: "rojo", texto: `Faltan ${fmt(-disponible)} para cubrir los pagos de hoy`, disponible, sin_reflejar };
  if (e.pendientes_hoy > 0) return { color: "ambar", texto: `Por pagar hoy ${fmt(e.pendientes_hoy)}`, disponible, sin_reflejar };
  if (sin_reflejar > 1) return { color: "ambar", texto: `Pagado ${fmt(e.pagados_hoy)}; el banco aún no refleja ${fmt(sin_reflejar)} (sube el estado de cuenta)`, disponible, sin_reflejar };
  return { color: "verde", texto: e.pagados_hoy > 0 ? `Pagado ${fmt(e.pagados_hoy)} y cuadra con el banco` : "Sin pendientes", disponible, sin_reflejar };
}

function fmt(n: number): string {
  return Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
}

export interface PagoTesoreria {
  empresa_id: string;
  empresa_nombre: string;
  monto: number;
  fecha_programada: string;
  estatus: "pendiente" | "pagado" | "cancelado";
  pagado_en: string | null;
  metodo: "transferencia" | "efectivo" | "cheque";
}

export interface SaldoEmpresa {
  empresa_id: string;
  empresa_nombre: string;
  saldo_final: number;
  salidas: number;
}

/** Cruza saldos del banco con los pagos: una fila por empresa. */
export function armarTesoreria(saldos: SaldoEmpresa[], pagos: PagoTesoreria[], hoy: string): EmpresaTesoreria[] {
  const mapa = new Map<string, EmpresaTesoreria>();
  const base = (id: string, nombre: string): EmpresaTesoreria => mapa.get(id) ?? { empresa_id: id, empresa_nombre: nombre, saldo_final: 0, salidas: 0, pendientes_hoy: 0, pagados_hoy: 0, efectivo_hoy: 0, n_pendientes: 0 };
  for (const s of saldos) {
    const e = base(s.empresa_id, s.empresa_nombre);
    e.saldo_final += Number(s.saldo_final);
    e.salidas += Number(s.salidas);
    mapa.set(e.empresa_id, e);
  }
  for (const p of pagos) {
    const e = base(p.empresa_id, p.empresa_nombre);
    const monto = Number(p.monto);
    if (p.estatus === "pendiente" && p.fecha_programada <= hoy) {
      if (p.metodo === "efectivo") e.efectivo_hoy += monto;
      else e.pendientes_hoy += monto;
      e.n_pendientes += 1;
    } else if (p.estatus === "pagado" && p.pagado_en === hoy) {
      if (p.metodo === "efectivo") e.efectivo_hoy += monto;
      else e.pagados_hoy += monto;
    }
    mapa.set(e.empresa_id, e);
  }
  return [...mapa.values()].sort((a, b) => a.empresa_nombre.localeCompare(b.empresa_nombre));
}
