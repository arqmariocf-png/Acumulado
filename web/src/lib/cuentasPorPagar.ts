// Cuentas por pagar por proveedor (Laura, 28-sep-2026): reglas puras del
// semáforo de crédito y del filtro/orden de la tabla. Sin DOM, con pruebas.

export interface FilaCxp {
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
    if (soloConSaldo && !(Number(f.por_pagar) > 0 || Number(f.sin_facturar) > 0)) return false;
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
        return n(b.por_pagar) - n(a.por_pagar) || n(b.sin_facturar) - n(a.sin_facturar) || a.proveedor.localeCompare(b.proveedor, "es");
    }
  });
  return res;
}

export function totalesCxp(filas: FilaCxp[]): { comprometido: number; facturado: number; pagado: number; por_pagar: number; sin_facturar: number; con_linea: number; rojos: number } {
  return filas.reduce(
    (t, f) => {
      const s = semaforoCredito(f.por_pagar, f.linea_credito);
      return {
        comprometido: t.comprometido + Number(f.comprometido || 0),
        facturado: t.facturado + Number(f.facturado || 0),
        pagado: t.pagado + Number(f.pagado || 0),
        por_pagar: t.por_pagar + Number(f.por_pagar || 0),
        sin_facturar: t.sin_facturar + Number(f.sin_facturar || 0),
        con_linea: t.con_linea + (f.linea_credito != null && Number(f.linea_credito) > 0 ? 1 : 0),
        rojos: t.rojos + (s.color === "rojo" ? 1 : 0),
      };
    },
    { comprometido: 0, facturado: 0, pagado: 0, por_pagar: 0, sin_facturar: 0, con_linea: 0, rojos: 0 },
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
  const enc = ["Proveedor", "Empresas", "OC", "Comprometido", "Facturas", "Facturado", "Pagado detectado", "Por pagar", "Sin facturar", "Línea de crédito", "Días", "Vence", "Disponible", "Última OC", "Última factura", "Notas"];
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
