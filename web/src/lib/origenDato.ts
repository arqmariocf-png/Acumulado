// De dónde sale cada cifra (5-nov-2026, Mario: "generar hipervínculos en todos
// los gastos, ventanas y menús para que podamos consultar de dónde viene esa
// información para corroborar qué es correcto; aplícala en todas las ventanas
// para todas las áreas"). Regla: toda cifra de un reporte lleva liga a los
// renglones que la forman (la OC, la semana de nómina, el movimiento del
// banco…) o a la pantalla donde se capturan. Aquí va la parte pura del avance
// financiero: los renglones de fn_avance_financiero_detalle se filtran con el
// MISMO periodo que la pantalla y cada uno sabe a qué pantalla lleva.
// Sin DOM: se prueba en node.

import { mesEnFiltro, type CategoriaObra, type FiltroAvance } from "./avanceFinanciero.ts";

export type OrigenGasto = "oc" | "mano_obra" | "control";

export interface RenglonOrigen {
  origen: OrigenGasto;
  proyecto_id: string;
  obra: string;
  empresa_id: string;
  empresa_codigo: string | null;
  /** "AAAA-MM-01" */
  mes: string;
  categoria: CategoriaObra;
  orden_compra_id: string | null;
  folio: string | null;
  tipo: string | null;
  proveedor: string | null;
  fecha: string | null;
  fuente: string | null;
  estatus: string | null;
  control_id: string | null;
  descripcion: string | null;
  semana: string | null;
  monto: number;
  pagado: number;
  /** Mano de obra de la API: quién, puesto (subpartida), semana y tipo. */
  trabajador?: string | null;
  subpartida?: string | null;
  num_sem?: number | null;
  tipo_trabajador?: string | null;
  /** A quién se le carga el gasto si no es el cliente de la obra (BBVA
   * Mantenimiento en oficinas u obras privadas; 5-nov-2026). */
  gasto_cliente?: string | null;
}

/** Qué cifra se quiere corroborar: lo ejercido, lo pagado o lo que falta por pagar. */
export type CampoOrigen = "real" | "pagado" | "pendiente";

export interface FiltroOrigen extends Partial<FiltroAvance> {
  /** "AAAA-MM": un solo mes (la fila de "Por periodo"). */
  mes?: string | null;
  campo?: CampoOrigen;
}

export const TITULO_ORIGEN: Record<OrigenGasto, string> = {
  oc: "Órdenes de compra y de servicio",
  mano_obra: "Mano de obra pagada (API del backoffice)",
  control: "Compras del control de obra sin OC",
};

export const TITULO_CAMPO: Record<CampoOrigen, string> = { real: "Real (ejercido)", pagado: "Pagado", pendiente: "Pendiente de pago" };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Lo que falta por pagar de un renglón. */
export function pendienteDe(r: RenglonOrigen): number {
  return r2(Math.max(0, (Number(r.monto) || 0) - (Number(r.pagado) || 0)));
}

/** Los renglones que forman la cifra: mismos filtros que `calcularAvance`
 * (empresa, obra, año/periodo, categoría), más un mes exacto y el campo
 * (pagado = solo con algo pagado; pendiente = solo con saldo). */
export function filtrarOrigen(renglones: RenglonOrigen[], f: FiltroOrigen): RenglonOrigen[] {
  const campo = f.campo ?? "real";
  return renglones.filter((r) => {
    if (f.empresaId && r.empresa_id !== f.empresaId) return false;
    if (f.obraId && r.proyecto_id !== f.obraId) return false;
    if (f.categoria && r.categoria !== f.categoria) return false;
    const mes = r.mes.slice(0, 7);
    if (f.mes && mes !== f.mes.slice(0, 7)) return false;
    if (!mesEnFiltro(mes, { anio: f.anio ?? null, periodo: f.periodo ?? "todo" })) return false;
    if (campo === "pagado" && !((Number(r.pagado) || 0) > 0)) return false;
    if (campo === "pendiente" && !(pendienteDe(r) > 0.005)) return false;
    return true;
  });
}

export interface ResumenOrigen {
  renglones: number;
  real: number;
  pagado: number;
  pendiente: number;
  porOrigen: { origen: OrigenGasto; titulo: string; renglones: number; real: number; pagado: number; pendiente: number }[];
}

/** Totales de los renglones (para que la suma cuadre con la cifra de la pantalla). */
export function resumenOrigen(renglones: RenglonOrigen[]): ResumenOrigen {
  const por = new Map<OrigenGasto, { n: number; r: number; p: number }>();
  let real = 0;
  let pagado = 0;
  for (const x of renglones) {
    const m = Number(x.monto) || 0;
    const p = Number(x.pagado) || 0;
    real += m;
    pagado += p;
    const e = por.get(x.origen) ?? { n: 0, r: 0, p: 0 };
    e.n += 1;
    e.r += m;
    e.p += p;
    por.set(x.origen, e);
  }
  const ordenOrigen: OrigenGasto[] = ["oc", "mano_obra", "control"];
  return {
    renglones: renglones.length,
    real: r2(real),
    pagado: r2(pagado),
    pendiente: r2(real - pagado),
    porOrigen: ordenOrigen
      .filter((o) => por.has(o))
      .map((o) => {
        const e = por.get(o)!;
        return { origen: o, titulo: TITULO_ORIGEN[o], renglones: e.n, real: r2(e.r), pagado: r2(e.p), pendiente: r2(e.r - e.p) };
      }),
  };
}

export interface LigaOrigen {
  /** Ruta dentro de la app. */
  a: string;
  texto: string;
}

/** A qué pantalla lleva cada renglón para corroborarlo. */
export function ligasRenglon(r: RenglonOrigen): LigaOrigen[] {
  if (r.origen === "oc") {
    const tipo = r.tipo === "OS" ? "OS" : "OC";
    return [
      { a: `/ordenes?tipo=${tipo}&buscar=${encodeURIComponent(r.folio ?? "")}&backoffice=1`, texto: "ver en Órdenes" },
      { a: `/proyectos/${r.proyecto_id}?tab=resumen#gastos`, texto: "gastos de la obra" },
    ];
  }
  if (r.origen === "mano_obra") {
    return [
      { a: `/rh/mano-de-obra?buscar=${encodeURIComponent(r.obra)}`, texto: "ver en Mano de obra" },
      { a: `/proyectos/${r.proyecto_id}?tab=resumen#mano-obra`, texto: "mano de obra de la obra" },
    ];
  }
  return [{ a: `/proyectos/${r.proyecto_id}?tab=control`, texto: "ver en Control de obra" }];
}

/** Ligas generales del panel según el filtro: la lista de órdenes de la obra,
 * la mano de obra y el presupuesto. */
export function ligasGenerales(f: FiltroOrigen, obraNombre: string | null): LigaOrigen[] {
  const ligas: LigaOrigen[] = [];
  if (f.obraId) {
    ligas.push({ a: `/ordenes?tipo=OC&buscar=${encodeURIComponent(obraNombre ?? "")}&backoffice=1`, texto: "todas las OC/OS de la obra" });
    ligas.push({ a: `/proyectos/${f.obraId}?tab=resumen`, texto: "resumen físico-financiero de la obra" });
    ligas.push({ a: `/proyectos/${f.obraId}?tab=control`, texto: "control de obra" });
    ligas.push({ a: `/finanzas/avance-financiero?vista=capturar&obra=${f.obraId}`, texto: "presupuesto por categoría" });
  } else {
    ligas.push({ a: "/ordenes?tipo=OC&backoffice=1", texto: "todas las órdenes" });
    ligas.push({ a: "/finanzas/obras", texto: "resumen de todas las obras" });
  }
  ligas.push({ a: "/rh/mano-de-obra", texto: "mano de obra (API)" });
  return ligas;
}

/** Título del panel: "Real · Parque Real 63 · Materiales · sep 2026". */
export function tituloOrigen(f: FiltroOrigen, obraNombre: string | null, empresaCodigo: string | null, tituloCategoria: (c: CategoriaObra) => string): string {
  const partes = [TITULO_CAMPO[f.campo ?? "real"]];
  if (obraNombre) partes.push(obraNombre);
  else if (empresaCodigo) partes.push(empresaCodigo);
  else partes.push("todas las obras");
  if (f.categoria) partes.push(tituloCategoria(f.categoria));
  if (f.mes) partes.push(nombreMesCorto(f.mes));
  else if (f.anio != null) partes.push(f.periodo && f.periodo !== "todo" ? `${f.periodo.startsWith("T") ? f.periodo.replace("T", "trimestre ") : nombreMesCorto(`${f.anio}-${f.periodo}`)} ${f.periodo.startsWith("T") ? f.anio : ""}`.trim() : String(f.anio));
  return partes.join(" · ");
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function nombreMesCorto(mes: string): string {
  const [a, m] = mes.slice(0, 7).split("-").map(Number);
  return `${MESES[m - 1] ?? mes} ${a}`;
}

// ── Mano de obra clasificada ────────────────────────────────────────────
// 5-nov-2026, Mario: "no se ve el desglose de mano de obra; sería bueno
// clasificarlo para una mejor lectura": partida → puesto (subpartida) →
// persona → semana, con subtotales.

export interface PersonaManoObra {
  trabajador: string;
  tipo: string | null;
  semanas: number;
  monto: number;
  renglones: RenglonOrigen[];
}
export interface SubpartidaManoObra {
  subpartida: string;
  monto: number;
  personas: PersonaManoObra[];
}
export interface PartidaManoObra {
  partida: string;
  monto: number;
  semanas: number;
  subpartidas: SubpartidaManoObra[];
}

const SIN = "Sin clasificar";

export function agruparManoObra(renglones: RenglonOrigen[]): PartidaManoObra[] {
  const partidas = new Map<string, Map<string, Map<string, PersonaManoObra>>>();
  for (const r of renglones) {
    if (r.origen !== "mano_obra") continue;
    const p = r.descripcion?.trim() || SIN;
    const sp = r.subpartida?.trim() || SIN;
    const t = r.trabajador?.trim() || SIN;
    const mp = partidas.get(p) ?? new Map();
    partidas.set(p, mp);
    const ms = mp.get(sp) ?? new Map();
    mp.set(sp, ms);
    const per = ms.get(t) ?? { trabajador: t, tipo: r.tipo_trabajador ?? null, semanas: 0, monto: 0, renglones: [] };
    per.renglones.push(r);
    per.monto = r2(per.monto + (Number(r.monto) || 0));
    ms.set(t, per);
  }
  const ordenar = <T,>(xs: T[], monto: (x: T) => number, nombre: (x: T) => string) => xs.sort((a, b) => monto(b) - monto(a) || nombre(a).localeCompare(nombre(b), "es"));
  return ordenar(
    [...partidas.entries()].map(([partida, mp]) => {
      const subpartidas = ordenar(
        [...mp.entries()].map(([subpartida, ms]) => {
          const personas = ordenar(
            [...ms.values()].map((per) => ({ ...per, semanas: new Set(per.renglones.map((x) => x.semana ?? x.fecha ?? "")).size, renglones: [...per.renglones].sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "")) })),
            (x) => x.monto,
            (x) => x.trabajador,
          );
          return { subpartida, monto: r2(personas.reduce((s, x) => s + x.monto, 0)), personas };
        }),
        (x) => x.monto,
        (x) => x.subpartida,
      );
      const todas = subpartidas.flatMap((sp) => sp.personas.flatMap((x) => x.renglones));
      return { partida, monto: r2(subpartidas.reduce((s, x) => s + x.monto, 0)), semanas: new Set(todas.map((x) => x.semana ?? x.fecha ?? "")).size, subpartidas };
    }),
    (x) => x.monto,
    (x) => x.partida,
  );
}

// ── Gasto por cliente ───────────────────────────────────────────────────
// 5-nov-2026, Mario: "en BBVA Mantenimiento hay que poder seleccionar porque
// hay tareas que hace ese equipo en oficinas y obras privadas; debe separar el
// gasto por cliente". Cada OC/OS puede llevar `gasto_cliente`; lo que no lo
// trae (y la mano de obra, que viene por obra) va al cliente de la obra.

export const CLIENTE_DE_LA_OBRA = "(cliente de la obra)";
export const CLIENTES_SUGERIDOS = ["Oficinas Grupo Loma", "Obra privada"];

export interface GastoCliente {
  cliente: string;
  oc: number;
  manoObra: number;
  control: number;
  total: number;
  pagado: number;
  ordenes: number;
}

export function gastoPorCliente(renglones: RenglonOrigen[]): GastoCliente[] {
  const m = new Map<string, GastoCliente>();
  for (const r of renglones) {
    const c = r.origen === "oc" && r.gasto_cliente?.trim() ? r.gasto_cliente.trim() : CLIENTE_DE_LA_OBRA;
    const g = m.get(c) ?? { cliente: c, oc: 0, manoObra: 0, control: 0, total: 0, pagado: 0, ordenes: 0 };
    const monto = Number(r.monto) || 0;
    if (r.origen === "oc") {
      g.oc = r2(g.oc + monto);
      g.ordenes += 1;
    } else if (r.origen === "mano_obra") g.manoObra = r2(g.manoObra + monto);
    else g.control = r2(g.control + monto);
    g.total = r2(g.total + monto);
    g.pagado = r2(g.pagado + (Number(r.pagado) || 0));
    m.set(c, g);
  }
  return [...m.values()].sort((a, b) => (a.cliente === CLIENTE_DE_LA_OBRA ? -1 : b.cliente === CLIENTE_DE_LA_OBRA ? 1 : b.total - a.total));
}

/** Opciones del selector de cliente: lo ya usado en la obra + sugerencias. */
export function opcionesCliente(renglones: RenglonOrigen[], extra: string[] = []): string[] {
  const usados = new Set<string>();
  for (const r of renglones) if (r.gasto_cliente?.trim()) usados.add(r.gasto_cliente.trim());
  for (const e of extra) if (e.trim()) usados.add(e.trim());
  for (const s of CLIENTES_SUGERIDOS) usados.add(s);
  return [...usados].sort((a, b) => a.localeCompare(b, "es"));
}

/** CSV de los renglones para cotejar en Excel. */
export function csvOrigen(renglones: RenglonOrigen[]): string {
  const esc = (v: string | number | null | undefined) => {
    const t = String(v ?? "");
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const cab = ["Origen", "Obra", "Empresa", "Mes", "Categoría", "Tipo", "Folio", "Proveedor", "Fecha", "Semana", "Partida / descripción", "Puesto", "Persona", "Cliente del gasto", "Estatus", "Fuente", "Monto s/IVA", "Pagado", "Pendiente"];
  const filas = renglones.map((r) =>
    [TITULO_ORIGEN[r.origen], r.obra, r.empresa_codigo, r.mes.slice(0, 7), r.categoria, r.tipo, r.folio, r.proveedor, r.fecha, r.semana, r.descripcion, r.subpartida, r.trabajador, r.gasto_cliente, r.estatus, r.fuente, r.monto, r.pagado, pendienteDe(r)].map(esc).join(","),
  );
  return [cab.join(","), ...filas].join("\n");
}
