// Cuentas por pagar por proveedor (Laura, 28-sep-2026): reglas puras del
// semáforo de crédito y del filtro/orden de la tabla. Sin DOM, con pruebas.

export interface FilaCxp {
  /** Una fila por empresa y proveedor (6-oct-2026: cada empresa tiene su línea). */
  empresa_id: string;
  clave: string;
  proveedor: string;
  n_oc: number;
  comprometido: number;
  n_facturas: number;
  facturado: number;
  pagado: number;
  por_pagar: number;
  sin_facturar: number;
  linea_credito: number | null;
  dias_credito: number | null;
  notas: string | null;
  vencimiento: string | null;
  disponible: number | null;
  ultima_oc: string | null;
  ultima_factura: string | null;
  ultimo_pago: string | null;
  empresas: string[] | null;
  /** Lo que se debe para la línea (21-oct-2026): el saldo del estado de
   * cuenta del proveedor si se capturó (± lo pagado y las OC después del
   * corte); si manda complementos o sus pagos se ven en el banco, facturado −
   * pagado; si no, el saldo de las OC. */
  deuda: number;
  /** Pagado por OC: pagos registrados aquí o la OC completa si el backoffice ya la da por pagada. */
  pagado_oc: number;
  saldo_oc: number;
  n_oc_por_pagar: number;
  pagado_detectado?: number;
  /** Saldo según el estado de cuenta del proveedor y su fecha de corte. */
  saldo_proveedor?: number | null;
  saldo_proveedor_al?: string | null;
  pagado_desde_corte?: number;
  oc_desde_corte?: number;
}

/** Llave única de la fila (la misma clave de proveedor se repite en cada empresa). */
export function llaveCxp(f: Pick<FilaCxp, "empresa_id" | "clave">): string {
  return `${f.empresa_id}|${f.clave}`;
}

/** Deuda de la fila; las filas viejas sin `deuda` usan por pagar. */
export function deudaCxp(f: Pick<FilaCxp, "por_pagar"> & Partial<Pick<FilaCxp, "deuda">>): number {
  return Number(f.deuda ?? f.por_pagar ?? 0);
}

export type ColorCredito = "gris" | "verde" | "ambar" | "rojo";

export interface SemaforoCredito {
  color: ColorCredito;
  etiqueta: string;
  /** Porcentaje de la línea que ya está ocupado por lo que se debe (0-100+). Null sin línea. */
  pctUsado: number | null;
}

/** Sin línea capturada no hay semáforo (gris). Rojo cuando lo que se debe
 * rebasa la línea o deja menos del 10 % libre; ámbar con menos del 30 %
 * libre; verde el resto. */
export function semaforoCredito(porPagar: number, lineaCredito: number | null): SemaforoCredito {
  const deuda = Math.max(Number(porPagar) || 0, 0);
  if (lineaCredito == null || !(Number(lineaCredito) > 0)) {
    return { color: "gris", etiqueta: "sin línea", pctUsado: null };
  }
  const linea = Number(lineaCredito);
  const pctUsado = Math.round((deuda / linea) * 100);
  const libre = 1 - deuda / linea;
  if (deuda > linea) return { color: "rojo", etiqueta: "excede la línea", pctUsado };
  if (libre < 0.1) return { color: "rojo", etiqueta: "línea casi agotada", pctUsado };
  if (libre < 0.3) return { color: "ambar", etiqueta: "línea al límite", pctUsado };
  return { color: "verde", etiqueta: "con crédito", pctUsado };
}

export type OrdenCxp = "por_pagar" | "disponible" | "comprometido" | "proveedor";

export function normalizarTexto(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Filtra por texto (proveedor o clave) y por empresa (uuid dentro de
 * `empresas`), y ordena. "disponible" pone primero lo más apretado (los sin
 * línea al final). */
export type FiltroLinea = "con_linea" | "sin_linea" | "todos";

export function tieneLinea(f: Pick<FilaCxp, "linea_credito">): boolean {
  return f.linea_credito != null && Number(f.linea_credito) > 0;
}

export function filtrarYOrdenar(filas: FilaCxp[], texto: string, empresaId: string, orden: OrdenCxp, soloConSaldo: boolean, linea: FiltroLinea = "todos"): FilaCxp[] {
  const q = normalizarTexto(texto);
  const res = filas.filter((f) => {
    if (q && !normalizarTexto(`${f.proveedor} ${f.clave}`).includes(q)) return false;
    if (empresaId && !(f.empresas ?? []).includes(empresaId)) return false;
    if (soloConSaldo && !(deudaCxp(f) > 0 || Number(f.sin_facturar) > 0)) return false;
    if (linea === "con_linea" && !tieneLinea(f)) return false;
    if (linea === "sin_linea" && tieneLinea(f)) return false;
    return true;
  });
  const n = (v: number | null | undefined) => Number(v ?? 0);
  res.sort((a, b) => {
    switch (orden) {
      case "proveedor":
        return a.proveedor.localeCompare(b.proveedor, "es");
      case "comprometido":
        return n(b.comprometido) - n(a.comprometido) || a.proveedor.localeCompare(b.proveedor, "es");
      case "disponible": {
        const da = a.disponible == null ? Number.POSITIVE_INFINITY : Number(a.disponible);
        const db = b.disponible == null ? Number.POSITIVE_INFINITY : Number(b.disponible);
        return da - db || a.proveedor.localeCompare(b.proveedor, "es");
      }
      default:
        return deudaCxp(b) - deudaCxp(a) || n(b.sin_facturar) - n(a.sin_facturar) || a.proveedor.localeCompare(b.proveedor, "es");
    }
  });
  return res;
}

export function totalesCxp(filas: FilaCxp[]): { comprometido: number; facturado: number; pagado: number; por_pagar: number; sin_facturar: number; con_linea: number; rojos: number; deuda: number; saldo_oc: number } {
  return filas.reduce(
    (t, f) => {
      const s = semaforoCredito(deudaCxp(f), f.linea_credito);
      return {
        comprometido: t.comprometido + Number(f.comprometido || 0),
        facturado: t.facturado + Number(f.facturado || 0),
        pagado: t.pagado + Number(f.pagado || 0),
        por_pagar: t.por_pagar + Number(f.por_pagar || 0),
        sin_facturar: t.sin_facturar + Number(f.sin_facturar || 0),
        con_linea: t.con_linea + (f.linea_credito != null && Number(f.linea_credito) > 0 ? 1 : 0),
        rojos: t.rojos + (s.color === "rojo" ? 1 : 0),
        deuda: t.deuda + deudaCxp(f),
        saldo_oc: t.saldo_oc + Number(f.saldo_oc || 0),
      };
    },
    { comprometido: 0, facturado: 0, pagado: 0, por_pagar: 0, sin_facturar: 0, con_linea: 0, rojos: 0, deuda: 0, saldo_oc: 0 },
  );
}

export type EstadoVencimiento = "sin_fecha" | "vigente" | "por_vencer" | "vencida";

/** Vencimiento de la línea: vencida si ya pasó, por vencer con 30 días o
 * menos, vigente el resto. `hoy` en ISO (yyyy-mm-dd) para poder probar. */
export function estadoVencimiento(vencimiento: string | null, hoy: string): { estado: EstadoVencimiento; dias: number | null } {
  if (!vencimiento) return { estado: "sin_fecha", dias: null };
  const a = Date.UTC(Number(vencimiento.slice(0, 4)), Number(vencimiento.slice(5, 7)) - 1, Number(vencimiento.slice(8, 10)));
  const b = Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 1, Number(hoy.slice(8, 10)));
  const dias = Math.round((a - b) / 86_400_000);
  if (dias < 0) return { estado: "vencida", dias };
  if (dias <= 30) return { estado: "por_vencer", dias };
  return { estado: "vigente", dias };
}

/** CSV (separado por comas, con BOM para Excel) de la lista filtrada, para
 * pasarla a otra área: p. ej. los proveedores sin línea de crédito. */
export function csvCxp(filas: FilaCxp[], nombreEmpresa: (id: string) => string): string {
  const esc = (v: string | number | null | undefined) => {
    const t = v == null ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const enc = ["Proveedor", "Empresa", "OC", "Comprometido", "Facturas", "Facturado", "Pagado", "Por pagar", "Sin facturar", "Saldo de OC", "Deuda", "Línea de crédito", "Días", "Vence", "Disponible", "Última OC", "Última factura", "Notas"];
  const lineas = filas.map((f) =>
    [
      f.proveedor,
      (f.empresas ?? []).map(nombreEmpresa).join(" / "),
      f.n_oc,
      Number(f.comprometido).toFixed(2),
      f.n_facturas,
      Number(f.facturado).toFixed(2),
      Number(f.pagado).toFixed(2),
      Number(f.por_pagar).toFixed(2),
      Number(f.sin_facturar).toFixed(2),
      Number(f.saldo_oc ?? 0).toFixed(2),
      deudaCxp(f).toFixed(2),
      f.linea_credito != null ? Number(f.linea_credito).toFixed(2) : "",
      f.dias_credito ?? "",
      f.vencimiento ?? "",
      f.disponible != null ? Number(f.disponible).toFixed(2) : "",
      f.ultima_oc ? f.ultima_oc.slice(0, 10) : "",
      f.ultima_factura ? f.ultima_factura.slice(0, 10) : "",
      f.notas ?? "",
    ]
      .map(esc)
      .join(","),
  );
  return "\ufeff" + [enc.join(","), ...lineas].join("\r\n");
}

/** Una OC con saldo que vence hoy o ya venció (Laura, 20-oct-2026: "en mi
 * inicio, en cuentas por pagar, el desglose empresa · proveedor que se vence
 * ese día o estén vencidas"). Vence = fecha OC + días de crédito, o el pago
 * programado pendiente más próximo; gana la más antigua. */
export interface OcVencimiento {
  id: string;
  id_orden: string;
  empresa_id: string;
  proveedor: string | null;
  proveedor_clave: string | null;
  saldo: number | string | null;
  vence: string | null;
  proximo_pago: string | null;
}

export interface VencimientoProveedor {
  empresa_id: string;
  proveedor: string;
  ocs: string[];
  saldo: number;
  /** La fecha más vieja de sus OC. */
  desde: string;
  dias: number;
  estado: "hoy" | "vencida";
}

/** Fecha en que vence la OC para pagarla: la más antigua entre el crédito y el pago programado. */
export function fechaVencimientoOc(o: Pick<OcVencimiento, "vence" | "proximo_pago">): string | null {
  const f = [o.vence, o.proximo_pago].filter((x): x is string => !!x).map((x) => x.slice(0, 10)).sort();
  return f[0] ?? null;
}

/** Agrupa por empresa y proveedor lo que vence hoy o está vencido; vencidas primero, luego por monto. */
export function vencimientosPorProveedor(ocs: OcVencimiento[], hoy: string): VencimientoProveedor[] {
  const m = new Map<string, VencimientoProveedor>();
  for (const o of ocs) {
    const saldo = Number(o.saldo || 0);
    const f = fechaVencimientoOc(o);
    if (!f || f > hoy || saldo <= 0.01) continue;
    const nombre = (o.proveedor ?? "").trim() || "Sin proveedor";
    const llave = `${o.empresa_id}|${o.proveedor_clave || normalizarTexto(nombre)}`;
    const r = m.get(llave) ?? { empresa_id: o.empresa_id, proveedor: nombre, ocs: [], saldo: 0, desde: f, dias: 0, estado: "hoy" as const };
    r.ocs.push(o.id_orden);
    r.saldo = Math.round((r.saldo + saldo) * 100) / 100;
    if (f < r.desde) r.desde = f;
    m.set(llave, r);
  }
  const dia = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return [...m.values()]
    .map((r) => {
      const dias = Math.round((dia(hoy) - dia(r.desde)) / 86400000);
      return { ...r, ocs: [...r.ocs].sort((a, b) => b.localeCompare(a, "es", { numeric: true })), dias, estado: dias > 0 ? ("vencida" as const) : ("hoy" as const) };
    })
    .sort((a, b) => (a.estado === b.estado ? b.saldo - a.saldo : a.estado === "vencida" ? -1 : 1));
}
