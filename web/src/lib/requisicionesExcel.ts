// Excel (CSV) de requisiciones (18-nov-2026, Mario: "para Laura genera un
// exportable en excel de requisiciones"). Dos formatos, los dos con lo que la
// lista tiene filtrado en pantalla: una fila por requisición (resumen con el
// avance por partidas) y una fila por renglón (lo solicitado, en compra, en
// bodega, en camino, recibido en obra y lo que falta).
import { ETIQUETA_ETAPA, type EtapaRequisicion } from "./requisicionEtapa.ts";

const celda = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const fila = (r: unknown[]) => r.map(celda).join(",");
const num = (v: unknown) => (v == null || v === "" ? "" : Number(v).toString());

export interface RequisicionExcel {
  id: string;
  folio: number | string;
  fecha: string | null;
  estado: string;
  etapa: string;
  comentario?: string | null;
  solicitante_nombre?: string | null;
  empresas?: { codigo: string } | null;
  proyectos?: { nombre: string } | null;
  avance?: { partidas?: number; avance_pct?: number; sin_pedir?: number; en_bodega?: number; en_transito?: number; en_obra?: number } | null;
  sin_resolver?: number;
}

export interface RenglonExcel {
  id: string;
  requisicion_id: string;
  descripcion?: string | null;
  cantidad_solicitada: number;
  unidad_medida?: string | null;
  comentario?: string | null;
  productos?: { nombre: string } | null;
}

export interface EntregaRenglonExcel {
  requisicion_linea_id: string;
  pedido?: number | null;
  comprado?: number | null;
  en_bodega?: number | null;
  en_transito?: number | null;
  recibido_obra?: number | null;
  etapa_partida?: string | null;
}

const ESTADO: Record<string, string> = { enviada: "Enviada", en_revision: "En revisión", resuelta: "Resuelta", cancelada: "Cancelada" };

export function textoEstado(estado: string): string {
  return ESTADO[estado] ?? estado;
}

export function textoEtapa(etapa: string): string {
  return ETIQUETA_ETAPA[etapa as EtapaRequisicion] ?? etapa;
}

export const COLUMNAS_EXCEL_REQUISICIONES = [
  "Folio", "Fecha", "Empresa", "Obra", "Solicitó", "Estado", "Etapa", "Partidas", "Avance %",
  "Sin pedir", "En bodega", "En camino", "En obra", "Renglones sin resolver", "Comentario",
];

/** Una fila por requisición, en el mismo orden de la pantalla. */
export function csvRequisiciones(lista: RequisicionExcel[]): string {
  const renglones = [fila(COLUMNAS_EXCEL_REQUISICIONES)];
  for (const r of lista) {
    const a = r.avance ?? {};
    renglones.push(fila([
      r.folio, r.fecha ?? "", r.empresas?.codigo ?? "", r.proyectos?.nombre ?? "", r.solicitante_nombre ?? "",
      textoEstado(r.estado), textoEtapa(r.etapa), num(a.partidas ?? 0), num(a.avance_pct ?? 0),
      num(a.sin_pedir ?? 0), num(a.en_bodega ?? 0), num(a.en_transito ?? 0), num(a.en_obra ?? 0),
      num(r.sin_resolver ?? 0), r.comentario ?? "",
    ]));
  }
  return renglones.join("\n");
}

export const COLUMNAS_EXCEL_RENGLONES = [
  "Folio", "Fecha", "Empresa", "Obra", "Solicitó", "Estado", "Etapa", "Descripción", "Unidad",
  "Solicitado", "Pedido", "En compra (OC)", "En bodega", "En camino", "Recibido en obra", "Falta en obra", "Etapa del renglón", "Comentario del renglón",
];

/** Una fila por renglón: la requisición repetida en las primeras columnas y
 * lo de cada partida. Los renglones salen agrupados por requisición en el
 * orden de la lista; dentro de cada una, en el orden en que vienen. */
export function csvRequisicionesRenglones(lista: RequisicionExcel[], renglones: RenglonExcel[], entrega: EntregaRenglonExcel[]): string {
  const porReq = new Map<string, RenglonExcel[]>();
  for (const l of renglones) {
    const arr = porReq.get(l.requisicion_id) ?? [];
    arr.push(l);
    porReq.set(l.requisicion_id, arr);
  }
  const ent = new Map(entrega.map((e) => [e.requisicion_linea_id, e]));
  const salida = [fila(COLUMNAS_EXCEL_RENGLONES)];
  for (const r of lista) {
    const cabeza = [r.folio, r.fecha ?? "", r.empresas?.codigo ?? "", r.proyectos?.nombre ?? "", r.solicitante_nombre ?? "", textoEstado(r.estado), textoEtapa(r.etapa)];
    const lineas = porReq.get(r.id) ?? [];
    if (!lineas.length) {
      salida.push(fila([...cabeza, "(sin renglones)", "", "", "", "", "", "", "", "", "", ""]));
      continue;
    }
    for (const l of lineas) {
      const e: Partial<EntregaRenglonExcel> = ent.get(l.id) ?? {};
      const solicitado = Number(l.cantidad_solicitada ?? 0);
      const enObra = Number(e.recibido_obra ?? 0);
      salida.push(fila([
        ...cabeza,
        l.descripcion ?? l.productos?.nombre ?? "", l.unidad_medida ?? "",
        num(solicitado), num(e.pedido ?? 0), num(e.comprado ?? 0), num(e.en_bodega ?? 0), num(e.en_transito ?? 0), num(enObra),
        num(Math.max(0, solicitado - enObra)), e.etapa_partida ?? "", l.comentario ?? "",
      ]));
    }
  }
  return salida.join("\n");
}

/** Nombre del archivo: requisiciones-2026-11-18.csv (o con el sufijo). */
export function nombreExcelRequisiciones(fecha: Date, sufijo?: string): string {
  const d = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
  return `requisiciones${sufijo ? `-${sufijo}` : ""}-${d}.csv`;
}
