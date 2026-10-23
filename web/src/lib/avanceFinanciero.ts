// Avance financiero de obras (22-oct-2026, Laura: "se puede crear un módulo
// de avance financiero con estos puntos y visual"). Presupuesto (lo único que
// se captura, por obra y categoría, repartido por mes) contra lo real que sale
// de OC, OS y mano de obra (fn_avance_financiero), lo pagado y lo pendiente.
// Todo sin IVA. Puro, con pruebas.

export type CategoriaObra = "materiales" | "mano_obra" | "subcontratos" | "renta_equipo" | "fletes" | "indirectos";

export const CATEGORIAS_OBRA: { clave: CategoriaObra; titulo: string }[] = [
  { clave: "materiales", titulo: "Materiales" },
  { clave: "mano_obra", titulo: "Mano de obra" },
  { clave: "subcontratos", titulo: "Subcontratos" },
  { clave: "renta_equipo", titulo: "Renta de equipo" },
  { clave: "fletes", titulo: "Fletes" },
  { clave: "indirectos", titulo: "Indirectos de obra" },
];

export const TITULO_CATEGORIA: Record<CategoriaObra, string> = Object.fromEntries(CATEGORIAS_OBRA.map((c) => [c.clave, c.titulo])) as Record<CategoriaObra, string>;

export type Reparto = "parejo" | "curva_s";

export interface ObraAvance {
  id: string;
  nombre: string;
  empresa_id: string;
  empresa_codigo: string | null;
  empresa_nombre?: string | null;
  tareas: number;
  hechas: number;
  /** Presupuesto de los controles de obra (23-oct-2026): se usa cuando la obra
   * no tiene presupuesto capturado por categoría, igual que el resumen
   * físico-financiero de Operación. */
  presupuesto_control?: number;
}

export interface RealMes {
  proyecto_id: string;
  /** "AAAA-MM" */
  mes: string;
  categoria: CategoriaObra;
  real: number;
  pagado: number;
}

export interface PresupuestoObra {
  proyecto_id: string;
  categoria: CategoriaObra;
  monto: number;
  /** "AAAA-MM-01" o "AAAA-MM" */
  mes_inicio: string;
  mes_fin: string;
  reparto: Reparto;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Meses "AAAA-MM" de inicio a fin, inclusive. */
export function mesesEntre(inicio: string, fin: string): string[] {
  const [ai, mi] = inicio.slice(0, 7).split("-").map(Number);
  const [af, mf] = fin.slice(0, 7).split("-").map(Number);
  const meses: string[] = [];
  let a = ai;
  let m = mi;
  while (a < af || (a === af && m <= mf)) {
    meses.push(`${a}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
    if (meses.length > 240) break;
  }
  return meses;
}

/**
 * Reparte un monto entre los meses: parejo o en curva S (poco al principio y
 * al final, más a la mitad; acumulado = 3x² − 2x³). Los centavos sobrantes van
 * al último mes, así que la suma es exacta.
 */
export function repartoMensual(monto: number, inicio: string, fin: string, reparto: Reparto): Map<string, number> {
  const meses = mesesEntre(inicio, fin);
  const salida = new Map<string, number>();
  if (!meses.length || !(monto > 0)) return salida;
  const n = meses.length;
  const s = (x: number) => x * x * (3 - 2 * x);
  let acumulado = 0;
  meses.forEach((mes, i) => {
    const peso = reparto === "curva_s" ? s((i + 1) / n) - s(i / n) : 1 / n;
    const valor = i === n - 1 ? r2(monto - acumulado) : r2(monto * peso);
    acumulado = r2(acumulado + valor);
    salida.set(mes, valor);
  });
  return salida;
}

export interface FiltroAvance {
  empresaId: string | null;
  obraId: string | null;
  /** null = toda la obra */
  anio: number | null;
  /** "todo" | "T1".."T4" | "01".."12" (solo con año) */
  periodo: string;
  categoria: CategoriaObra | null;
}

export const FILTRO_INICIAL: FiltroAvance = { empresaId: null, obraId: null, anio: null, periodo: "todo", categoria: null };

/** ¿El mes cae en el año/periodo del filtro? */
export function mesEnFiltro(mes: string, f: Pick<FiltroAvance, "anio" | "periodo">): boolean {
  if (f.anio == null) return true;
  const [a, m] = mes.split("-").map(Number);
  if (a !== f.anio) return false;
  if (!f.periodo || f.periodo === "todo") return true;
  if (/^T[1-4]$/.test(f.periodo)) return Math.ceil(m / 3) === Number(f.periodo.slice(1));
  return m === Number(f.periodo);
}

export type Semaforo = "en_linea" | "desfase" | "rebasado" | "sin_presupuesto";

export const SEMAFOROS: Record<Semaforo, { texto: string; clase: string }> = {
  en_linea: { texto: "En línea", clase: "bg-emerald-50 text-emerald-700" },
  desfase: { texto: "Desfase", clase: "bg-amber-100 text-amber-800" },
  rebasado: { texto: "Rebasado", clase: "bg-red-50 text-red-700" },
  sin_presupuesto: { texto: "Sin presupuesto", clase: "bg-slate-100 text-slate-600" },
};

/** Puntos que el avance financiero puede ir por delante del físico antes de marcar desfase. */
export const TOLERANCIA_DESFASE = 10;

/**
 * Semáforo de la obra con lo acumulado de TODA la obra (no del periodo):
 * sin presupuesto; rebasado si lo real pasa del presupuesto; desfase si el %
 * ejercido va más de 10 puntos por delante del avance físico (tareas hechas);
 * si no, en línea. Sin tareas no se puede comparar: en línea mientras no rebase.
 */
export function semaforoObra(presupuesto: number, real: number, fisicoPct: number | null): Semaforo {
  if (!(presupuesto > 0)) return "sin_presupuesto";
  if (real > presupuesto + 0.5) return "rebasado";
  const ejercido = (real / presupuesto) * 100;
  if (fisicoPct != null && ejercido - fisicoPct > TOLERANCIA_DESFASE) return "desfase";
  return "en_linea";
}

export interface Totales {
  presupuesto: number;
  real: number;
  pagado: number;
  pendiente: number;
  disponible: number;
  /** real / presupuesto en %, null sin presupuesto */
  ejercidoPct: number | null;
}

function totales(presupuesto: number, real: number, pagado: number): Totales {
  return {
    presupuesto: r2(presupuesto),
    real: r2(real),
    pagado: r2(pagado),
    pendiente: r2(Math.max(real - pagado, 0)),
    disponible: r2(presupuesto - real),
    ejercidoPct: presupuesto > 0 ? Math.round((real / presupuesto) * 1000) / 10 : null,
  };
}

export interface FilaObra extends Totales {
  obra: ObraAvance;
  fisicoPct: number | null;
  semaforo: Semaforo;
  /** Lo acumulado de toda la obra (para el semáforo). */
  obraTotal: Totales;
}

export interface MesAvance {
  mes: string;
  presupuesto: number;
  real: number;
  pagado: number;
  presupuestoAcum: number;
  realAcum: number;
  diferenciaAcum: number;
}

export interface ResultadoAvance {
  total: Totales;
  obrasConAlerta: number;
  porObra: FilaObra[];
  porEmpresa: (Totales & { empresa_id: string; codigo: string | null; nombre: string | null; obras: number; alertas: number })[];
  porCategoria: (Totales & { categoria: CategoriaObra; titulo: string })[];
  porMes: MesAvance[];
  /** Años con presupuesto o real, para el filtro. */
  anios: number[];
}

/** Presupuesto por obra, categoría y mes ya repartido. */
export function presupuestoPorMes(presupuestos: PresupuestoObra[]): { proyecto_id: string; categoria: CategoriaObra; mes: string; monto: number }[] {
  const filas: { proyecto_id: string; categoria: CategoriaObra; mes: string; monto: number }[] = [];
  for (const p of presupuestos) {
    for (const [mes, monto] of repartoMensual(Number(p.monto) || 0, p.mes_inicio, p.mes_fin, p.reparto)) {
      filas.push({ proyecto_id: p.proyecto_id, categoria: p.categoria, mes, monto });
    }
  }
  return filas;
}

/**
 * Todo lo de la pantalla con los filtros: indicadores, por obra (con semáforo
 * de toda la obra), por empresa, por categoría y por mes con acumulados. Solo
 * entran las obras con presupuesto o con algo real.
 */
export function calcularAvance(obras: ObraAvance[], real: RealMes[], presupuestos: PresupuestoObra[], f: FiltroAvance): ResultadoAvance {
  const pres = presupuestoPorMes(presupuestos);
  const obraOk = (o: ObraAvance) => (!f.empresaId || o.empresa_id === f.empresaId) && (!f.obraId || o.id === f.obraId);
  const catOk = (c: CategoriaObra) => !f.categoria || c === f.categoria;
  const anios = [...new Set([...pres.map((p) => Number(p.mes.slice(0, 4))), ...real.map((r) => Number(r.mes.slice(0, 4)))])].sort((a, b) => b - a);

  const vacio = () => ({ p: 0, r: 0, g: 0 });
  const enPeriodo = new Map<string, { p: number; r: number; g: number }>();
  const todaObra = new Map<string, { p: number; r: number; g: number }>();
  const porCat = new Map<CategoriaObra, { p: number; r: number; g: number }>();
  const porMes = new Map<string, { p: number; r: number; g: number }>();
  const ids = new Set(obras.filter(obraOk).map((o) => o.id));

  const sumar = (mapa: Map<string, { p: number; r: number; g: number }>, k: string, p: number, r: number, g: number) => {
    const x = mapa.get(k) ?? vacio();
    x.p += p;
    x.r += r;
    x.g += g;
    mapa.set(k, x);
  };
  for (const x of pres) {
    if (!ids.has(x.proyecto_id) || !catOk(x.categoria)) continue;
    sumar(todaObra, x.proyecto_id, x.monto, 0, 0);
    if (!mesEnFiltro(x.mes, f)) continue;
    sumar(enPeriodo, x.proyecto_id, x.monto, 0, 0);
    sumar(porCat as Map<string, { p: number; r: number; g: number }>, x.categoria, x.monto, 0, 0);
    sumar(porMes, x.mes, x.monto, 0, 0);
  }
  for (const x of real) {
    if (!ids.has(x.proyecto_id) || !catOk(x.categoria)) continue;
    const r = Number(x.real) || 0;
    const g = Number(x.pagado) || 0;
    sumar(todaObra, x.proyecto_id, 0, r, g);
    if (!mesEnFiltro(x.mes, f)) continue;
    sumar(enPeriodo, x.proyecto_id, 0, r, g);
    sumar(porCat as Map<string, { p: number; r: number; g: number }>, x.categoria, 0, r, g);
    sumar(porMes, x.mes, 0, r, g);
  }

  // Sin presupuesto por categoría, vale el de los controles de obra (sin mes:
  // cuenta en toda la obra y, si no hay filtro de año, también en el periodo).
  const conPresupuesto = new Set(pres.map((x) => x.proyecto_id));
  if (!f.categoria) {
    for (const o of obras) {
      const pc = Number(o.presupuesto_control) || 0;
      if (!ids.has(o.id) || conPresupuesto.has(o.id) || pc <= 0) continue;
      sumar(todaObra, o.id, pc, 0, 0);
      if (f.anio == null) sumar(enPeriodo, o.id, pc, 0, 0);
    }
  }

  const porObra: FilaObra[] = [];
  for (const o of obras) {
    if (!ids.has(o.id)) continue;
    const t = todaObra.get(o.id);
    if (!t || (t.p <= 0 && Math.abs(t.r) < 0.01)) continue;
    const e = enPeriodo.get(o.id) ?? vacio();
    const fisicoPct = o.tareas > 0 ? Math.round((o.hechas / o.tareas) * 1000) / 10 : null;
    porObra.push({ ...totales(e.p, e.r, e.g), obra: o, fisicoPct, semaforo: semaforoObra(t.p, t.r, fisicoPct), obraTotal: totales(t.p, t.r, t.g) });
  }
  const orden: Record<Semaforo, number> = { rebasado: 0, desfase: 1, en_linea: 2, sin_presupuesto: 3 };
  porObra.sort((a, b) => orden[a.semaforo] - orden[b.semaforo] || b.real - a.real || a.obra.nombre.localeCompare(b.obra.nombre, "es"));

  const empresas = new Map<string, { p: number; r: number; g: number; codigo: string | null; nombre: string | null; obras: number; alertas: number }>();
  for (const x of porObra) {
    const e = empresas.get(x.obra.empresa_id) ?? { ...vacio(), codigo: x.obra.empresa_codigo, nombre: x.obra.empresa_nombre ?? null, obras: 0, alertas: 0 };
    e.p += x.presupuesto;
    e.r += x.real;
    e.g += x.pagado;
    e.obras += 1;
    if (x.semaforo === "desfase" || x.semaforo === "rebasado") e.alertas += 1;
    empresas.set(x.obra.empresa_id, e);
  }

  const meses = [...porMes.keys()].sort();
  let pa = 0;
  let ra = 0;
  const filasMes: MesAvance[] = meses.map((mes) => {
    const m = porMes.get(mes)!;
    pa += m.p;
    ra += m.r;
    return { mes, presupuesto: r2(m.p), real: r2(m.r), pagado: r2(m.g), presupuestoAcum: r2(pa), realAcum: r2(ra), diferenciaAcum: r2(pa - ra) };
  });

  const tp = porObra.reduce((s, x) => s + x.presupuesto, 0);
  const tr = porObra.reduce((s, x) => s + x.real, 0);
  const tg = porObra.reduce((s, x) => s + x.pagado, 0);
  return {
    total: totales(tp, tr, tg),
    obrasConAlerta: porObra.filter((x) => x.semaforo === "desfase" || x.semaforo === "rebasado").length,
    porObra,
    porEmpresa: [...empresas.entries()]
      .map(([empresa_id, e]) => ({ empresa_id, codigo: e.codigo, nombre: e.nombre, obras: e.obras, alertas: e.alertas, ...totales(e.p, e.r, e.g) }))
      .sort((a, b) => b.real - a.real),
    porCategoria: CATEGORIAS_OBRA.filter((c) => catOk(c.clave)).map((c) => {
      const x = porCat.get(c.clave) ?? vacio();
      return { categoria: c.clave, titulo: c.titulo, ...totales(x.p, x.r, x.g) };
    }),
    porMes: filasMes,
    anios,
  };
}

/** Revisa la captura de presupuesto de una obra antes de guardarla. */
export function revisarPresupuesto(montos: Partial<Record<CategoriaObra, number | null>>, inicio: string, fin: string): string | null {
  if (!/^\d{4}-\d{2}/.test(inicio) || !/^\d{4}-\d{2}/.test(fin)) return "Elige el mes de inicio y el de término.";
  if (fin.slice(0, 7) < inicio.slice(0, 7)) return "El mes de término no puede ser antes del de inicio.";
  for (const [k, v] of Object.entries(montos)) {
    if (v != null && (!Number.isFinite(v) || v < 0)) return `El monto de ${TITULO_CATEGORIA[k as CategoriaObra] ?? k} no es válido.`;
  }
  return null;
}
