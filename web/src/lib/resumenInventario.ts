/** Resumen de inventario: qué hay (existencias) y qué días se cargó la
 * información (movimientos agrupados por el día en que se registraron, hora
 * de México). Puro, con pruebas. */
import { fechaLocal } from "./reporteChecador.ts";

export interface MovimientoResumen {
  empresa_id: string;
  tipo: "entrada" | "salida";
  cantidad: number;
  costo_unitario: number | null;
  fecha: string;
  es_ajuste: boolean;
  registrado_por: string | null;
  created_at: string;
  orden_compra_id?: string | null;
  orden_venta_id?: string | null;
  remision_id?: string | null;
}

export interface DiaCarga {
  /** Día en que se capturó (created_at en hora de México). */
  dia: string;
  empresas: string[];
  movimientos: number;
  entradas: number;
  salidas: number;
  ajustes: number;
  /** Valor de las entradas con costo (cantidad × costo). */
  valorEntradas: number;
  /** Rango de la fecha del movimiento (puede ser distinta del día de captura). */
  fechaMin: string;
  fechaMax: string;
  /** Movimientos cuya fecha no es el día en que se capturaron. */
  conOtraFecha: number;
  quienes: string[];
  conOc: number;
  conOv: number;
}

export function cargasPorDia(movs: MovimientoResumen[]): DiaCarga[] {
  const porDia = new Map<string, DiaCarga & { _emp: Set<string>; _q: Set<string> }>();
  for (const m of movs) {
    const dia = fechaLocal(m.created_at);
    let d = porDia.get(dia);
    if (!d) {
      d = { dia, empresas: [], movimientos: 0, entradas: 0, salidas: 0, ajustes: 0, valorEntradas: 0, fechaMin: m.fecha, fechaMax: m.fecha, conOtraFecha: 0, quienes: [], conOc: 0, conOv: 0, _emp: new Set(), _q: new Set() };
      porDia.set(dia, d);
    }
    d.movimientos++;
    if (m.tipo === "entrada") {
      d.entradas++;
      if (m.costo_unitario != null) d.valorEntradas += Number(m.cantidad) * Number(m.costo_unitario);
    } else d.salidas++;
    if (m.es_ajuste) d.ajustes++;
    if (m.fecha < d.fechaMin) d.fechaMin = m.fecha;
    if (m.fecha > d.fechaMax) d.fechaMax = m.fecha;
    if (m.fecha !== dia) d.conOtraFecha++;
    if (m.orden_compra_id) d.conOc++;
    if (m.orden_venta_id) d.conOv++;
    d._emp.add(m.empresa_id);
    if (m.registrado_por) d._q.add(m.registrado_por);
  }
  return [...porDia.values()]
    .map(({ _emp, _q, ...d }) => ({ ...d, valorEntradas: Math.round(d.valorEntradas * 100) / 100, empresas: [..._emp], quienes: [..._q] }))
    .sort((a, b) => b.dia.localeCompare(a.dia));
}

export interface ExistenciaResumen {
  empresa_id: string;
  producto_id: string;
  existencia: number;
  valor: number | null;
}

export interface ResumenEmpresa {
  empresa_id: string;
  productos: number;
  conExistencia: number;
  negativos: number;
  valor: number;
  movimientos: number;
  primeraCarga: string | null;
  ultimaCarga: string | null;
  diasConCarga: number;
}

export function resumenPorEmpresa(existencias: ExistenciaResumen[], movs: MovimientoResumen[]): ResumenEmpresa[] {
  const r = new Map<string, ResumenEmpresa & { _prod: Set<string>; _dias: Set<string> }>();
  const de = (e: string) => {
    let x = r.get(e);
    if (!x) {
      x = { empresa_id: e, productos: 0, conExistencia: 0, negativos: 0, valor: 0, movimientos: 0, primeraCarga: null, ultimaCarga: null, diasConCarga: 0, _prod: new Set(), _dias: new Set() };
      r.set(e, x);
    }
    return x;
  };
  // Existencias vienen por producto y almacén: se suman por producto.
  const porProducto = new Map<string, { e: string; q: number; v: number }>();
  for (const x of existencias) {
    const k = `${x.empresa_id}|${x.producto_id}`;
    const p = porProducto.get(k) ?? { e: x.empresa_id, q: 0, v: 0 };
    p.q += Number(x.existencia ?? 0);
    p.v += Number(x.valor ?? 0);
    porProducto.set(k, p);
  }
  for (const p of porProducto.values()) {
    const x = de(p.e);
    x.productos++;
    if (p.q > 0) x.conExistencia++;
    if (p.q < 0) x.negativos++;
    x.valor += p.v;
  }
  for (const m of movs) {
    const x = de(m.empresa_id);
    const dia = fechaLocal(m.created_at);
    x.movimientos++;
    x._dias.add(dia);
    if (!x.primeraCarga || dia < x.primeraCarga) x.primeraCarga = dia;
    if (!x.ultimaCarga || dia > x.ultimaCarga) x.ultimaCarga = dia;
  }
  return [...r.values()]
    .map(({ _prod, _dias, ...x }) => ({ ...x, valor: Math.round(x.valor * 100) / 100, diasConCarga: _dias.size }))
    .sort((a, b) => (b.ultimaCarga ?? "").localeCompare(a.ultimaCarga ?? "") || b.valor - a.valor);
}

/** Días hábiles (lun-sáb) sin captura desde la última carga hasta hoy. */
export function diasSinCarga(ultima: string | null, hoy: string): number | null {
  if (!ultima) return null;
  let n = 0;
  const d = new Date(`${ultima}T12:00:00Z`);
  const fin = new Date(`${hoy}T12:00:00Z`);
  for (d.setUTCDate(d.getUTCDate() + 1); d <= fin; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0) n++;
  }
  return n;
}
