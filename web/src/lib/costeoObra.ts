// Costeo y pronóstico de obra (Mario, 30-sep-2026; modelo Abarrotes Neto).
// Solo del director general. Reglas puras: la pantalla y el reporte
// imprimible usan lo mismo.

export interface CosteoContrato {
  folio_contrato: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  subtotal: number | null;
  iva: number | null;
  m2: number | null;
  ubicacion: string | null;
  latitud: number | null;
  longitud: number | null;
  km: number | null;
  plano_id: string | null;
  indirectos_pct: number | null;
  notas: string | null;
}

export interface PartidaPresupuesto {
  id?: string;
  orden: number;
  clave: string | null;
  concepto: string;
  unidad: string | null;
  cantidad: number;
  precio_unitario: number;
}

export type TipoDirecto = "contratista" | "personal" | "material" | "otro";

export interface CostoDirecto {
  id?: string;
  tipo: TipoDirecto;
  nombre: string;
  especialidad: string | null;
  cantidad: number;
  unidad: string | null;
  costo_unitario: number;
  notas: string | null;
}

export interface RenglonTabulador {
  km_hasta: number;
  porcentaje: number;
}

export interface RealObra {
  n_oc: number;
  subtotal: number;
  total: number;
  pagado: number;
}

export const ETIQUETA_TIPO_DIRECTO: Record<TipoDirecto, string> = {
  contratista: "Contratistas",
  personal: "Personal asignado",
  material: "Materiales",
  otro: "Otros directos",
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** % del tabulador: el primer renglón cuyo "hasta km" alcanza la distancia;
 * más allá del último, el último. Sin tabulador o sin km: null. */
export function porcentajeTabulador(km: number | null, tabulador: RenglonTabulador[]): number | null {
  if (km == null || tabulador.length === 0) return null;
  const orden = [...tabulador].sort((a, b) => a.km_hasta - b.km_hasta);
  return (orden.find((r) => km <= r.km_hasta) ?? orden[orden.length - 1]).porcentaje;
}

export function diasObra(inicio: string | null, fin: string | null): number | null {
  if (!inicio || !fin) return null;
  return Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86400000) + 1;
}

export const importePartida = (p: Pick<PartidaPresupuesto, "cantidad" | "precio_unitario">) => r2(Number(p.cantidad) * Number(p.precio_unitario));
export const importeDirecto = (d: Pick<CostoDirecto, "cantidad" | "costo_unitario">) => r2(Number(d.cantidad) * Number(d.costo_unitario));

export interface ResumenCosteo {
  subtotal: number;
  iva: number;
  total: number;
  dias: number | null;
  presupuestoCliente: number;
  diferenciaPresupuesto: number | null;
  directosPorTipo: Record<TipoDirecto, number>;
  directos: number;
  imss: number;
  pctIndirectos: number;
  origenIndirectos: "propio" | "tabulador" | "sin_definir";
  indirectos: number;
  costoTotal: number;
  utilidad: number;
  margenPct: number | null;
  ventaM2: number | null;
  costoM2: number | null;
  realVsDirectos: number | null;
  alertas: string[];
}

/** Indirectos = % × (directos + IMSS); utilidad = subtotal − costo total. */
export function resumenCosteo(
  c: CosteoContrato | null,
  presupuesto: PartidaPresupuesto[],
  directos: CostoDirecto[],
  imss: number | null,
  tabulador: RenglonTabulador[],
  real: RealObra | null,
): ResumenCosteo {
  const subtotal = Number(c?.subtotal ?? 0);
  const iva = Number(c?.iva ?? 0);
  const presupuestoCliente = r2(presupuesto.reduce((s, p) => s + importePartida(p), 0));
  const directosPorTipo: Record<TipoDirecto, number> = { contratista: 0, personal: 0, material: 0, otro: 0 };
  for (const d of directos) directosPorTipo[d.tipo] = r2(directosPorTipo[d.tipo] + importeDirecto(d));
  const totalDirectos = r2(Object.values(directosPorTipo).reduce((a, b) => a + b, 0));
  const imssN = Number(imss ?? 0);
  const deTabulador = porcentajeTabulador(c?.km ?? null, tabulador);
  const pct = c?.indirectos_pct != null ? Number(c.indirectos_pct) : deTabulador ?? 0;
  const origen = c?.indirectos_pct != null ? "propio" : deTabulador != null ? "tabulador" : "sin_definir";
  const indirectos = r2(((totalDirectos + imssN) * pct) / 100);
  const costoTotal = r2(totalDirectos + imssN + indirectos);
  const utilidad = r2(subtotal - costoTotal);
  const m2 = c?.m2 ? Number(c.m2) : null;

  const alertas: string[] = [];
  if (!subtotal) alertas.push("Falta capturar el monto del contrato u OC del cliente.");
  if (presupuesto.length === 0) alertas.push("Falta cargar el presupuesto original del cliente.");
  if (subtotal && presupuesto.length > 0 && Math.abs(presupuestoCliente - subtotal) > 1)
    alertas.push(`El presupuesto del cliente suma ${presupuestoCliente.toFixed(2)} y el contrato ${subtotal.toFixed(2)} (sin IVA).`);
  if (directos.length === 0) alertas.push("Falta el costeo de contratistas y personal.");
  if ((directosPorTipo.personal > 0 || directosPorTipo.contratista > 0) && imss == null) alertas.push("Contabilidad no ha capturado el seguro social.");
  if (origen === "sin_definir") alertas.push("Sin % de indirectos: captura los km a la obra y el tabulador, o un % propio.");
  if (subtotal && utilidad < 0) alertas.push("La utilidad pronóstico es negativa.");
  if (real && totalDirectos > 0 && real.subtotal > totalDirectos) alertas.push("Lo comprado en OC ya rebasa los costos directos pronosticados.");
  if (!m2) alertas.push("Faltan los m² de la sucursal para el costo por m².");

  return {
    subtotal,
    iva,
    total: r2(subtotal + iva),
    dias: diasObra(c?.fecha_inicio ?? null, c?.fecha_fin ?? null),
    presupuestoCliente,
    diferenciaPresupuesto: subtotal && presupuesto.length ? r2(subtotal - presupuestoCliente) : null,
    directosPorTipo,
    directos: totalDirectos,
    imss: imssN,
    pctIndirectos: pct,
    origenIndirectos: origen,
    indirectos,
    costoTotal,
    utilidad,
    margenPct: subtotal ? r2((utilidad / subtotal) * 100) : null,
    ventaM2: m2 && subtotal ? r2(subtotal / m2) : null,
    costoM2: m2 && costoTotal ? r2(costoTotal / m2) : null,
    realVsDirectos: real && totalDirectos ? r2((real.subtotal / totalDirectos) * 100) : null,
    alertas,
  };
}

function numero(texto: string): number | null {
  const limpio = texto.replace(/[$\s]/g, "").replace(/,/g, "");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** Presupuesto pegado desde Excel (columnas separadas por tabulador).
 * Acepta 5 columnas (clave, concepto, unidad, cantidad, P.U.) o 4 (concepto,
 * unidad, cantidad, P.U.); si trae una columna más (importe) la ignora.
 * Omite encabezados y renglones sin cantidad ni precio numéricos. */
export function leerPresupuestoPegado(texto: string): PartidaPresupuesto[] {
  const out: PartidaPresupuesto[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    const c = linea.split("\t").map((x) => x.trim());
    if (c.every((x) => !x)) continue;
    let clave: string | null = null;
    let concepto: string, unidad: string, cant: number | null, pu: number | null;
    if (c.length >= 5 && numero(c[3]) != null && numero(c[4]) != null) {
      [clave, concepto, unidad] = [c[0] || null, c[1], c[2]];
      cant = numero(c[3]);
      pu = numero(c[4]);
    } else if (c.length >= 4 && numero(c[2]) != null && numero(c[3]) != null) {
      [concepto, unidad] = [c[0], c[1]];
      cant = numero(c[2]);
      pu = numero(c[3]);
    } else continue;
    if (!concepto || cant == null || pu == null) continue;
    out.push({ orden: out.length + 1, clave, concepto, unidad: unidad || null, cantidad: cant, precio_unitario: pu });
  }
  return out;
}
