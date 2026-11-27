// Camiones de volteo (23-nov-2026, Mario: "vamos a hacer el módulo para los
// camiones de volteo"). Viajes y gastos por unidad dentro de Logística:
// cada viaje trae cliente u obra, origen → destino, material, cantidad,
// precio e importe, cobro y kilometraje; cada gasto trae tipo, litros y
// monto. De las dos tablas sale el resumen por unidad (ingresos, gastos,
// utilidad, km, litros, km/l) y los documentos imprimibles: la bitácora de
// viajes y el manifiesto de residuos de manejo especial que AEP llevaba en
// Excel. Puro, sin DOM, con pruebas.

import { esc } from "./membreteRemision.ts";

export type TipoViaje = "flete" | "material" | "residuos" | "renta" | "traslado" | "otro";
export type UnidadMedida = "m3" | "ton" | "viaje" | "hr" | "pza" | "lote" | "km";
export type EstadoViaje = "programado" | "en_curso" | "terminado" | "cancelado";
export type TipoGasto = "diesel" | "gasolina" | "mantenimiento" | "llantas" | "refacciones" | "casetas" | "multas" | "seguro" | "verificacion" | "tenencia" | "chofer" | "lavado" | "material" | "tiro" | "otro";

export const TIPOS_VIAJE: { clave: TipoViaje; etiqueta: string }[] = [
  { clave: "flete", etiqueta: "Flete (acarreo)" },
  { clave: "material", etiqueta: "Venta de material" },
  { clave: "residuos", etiqueta: "Residuos / escombro" },
  { clave: "renta", etiqueta: "Renta por hora o día" },
  { clave: "traslado", etiqueta: "Traslado interno" },
  { clave: "otro", etiqueta: "Otro" },
];
export const UNIDADES_MEDIDA: { clave: UnidadMedida; etiqueta: string }[] = [
  { clave: "m3", etiqueta: "m³" },
  { clave: "ton", etiqueta: "ton" },
  { clave: "viaje", etiqueta: "viaje" },
  { clave: "hr", etiqueta: "hora" },
  { clave: "pza", etiqueta: "pza" },
  { clave: "lote", etiqueta: "lote" },
  { clave: "km", etiqueta: "km" },
];
export const TIPOS_GASTO: { clave: TipoGasto; etiqueta: string; combustible?: boolean }[] = [
  { clave: "diesel", etiqueta: "Diésel", combustible: true },
  { clave: "gasolina", etiqueta: "Gasolina", combustible: true },
  { clave: "mantenimiento", etiqueta: "Mantenimiento / taller" },
  { clave: "llantas", etiqueta: "Llantas" },
  { clave: "refacciones", etiqueta: "Refacciones" },
  { clave: "casetas", etiqueta: "Casetas" },
  { clave: "multas", etiqueta: "Multas" },
  { clave: "seguro", etiqueta: "Seguro" },
  { clave: "verificacion", etiqueta: "Verificación" },
  { clave: "tenencia", etiqueta: "Tenencia / placas" },
  { clave: "chofer", etiqueta: "Chofer (viáticos, pago por viaje)" },
  { clave: "lavado", etiqueta: "Lavado" },
  { clave: "material", etiqueta: "Material para venta (arena, grava…)" },
  { clave: "tiro", etiqueta: "Tiro de escombro" },
  { clave: "otro", etiqueta: "Otro" },
];
export const ETIQUETA_ESTADO_VIAJE: Record<EstadoViaje, string> = { programado: "programado", en_curso: "en curso", terminado: "terminado", cancelado: "cancelado" };
export const CLASE_ESTADO_VIAJE: Record<EstadoViaje, string> = {
  programado: "bg-sky-100 text-sky-800",
  en_curso: "bg-emerald-100 text-emerald-800",
  terminado: "bg-slate-100 text-slate-700",
  cancelado: "bg-slate-50 text-slate-400 line-through",
};
export const MATERIALES_SUGERIDOS = ["Arena", "Grava", "Tepetate", "Tezontle", "Piedra", "Escombro", "Tierra", "Relleno", "Residuos de manejo especial", "Chatarra", "Madera", "Concreto"];

export interface Viaje {
  id: string;
  empresa_id: string;
  unidad_id: string;
  folio: string | null;
  fecha: string;
  hora_salida: string | null;
  hora_regreso: string | null;
  chofer_id: string | null;
  chofer_nombre: string | null;
  tipo: TipoViaje;
  cliente: string | null;
  cliente_empresa_id: string | null;
  proyecto_id: string | null;
  origen: string | null;
  destino: string | null;
  material: string | null;
  cantidad: number | null;
  unidad_medida: UnidadMedida;
  viajes: number;
  precio: number;
  importe: number;
  cobrado: boolean;
  cobrado_en: string | null;
  forma_cobro: string | null;
  referencia_cobro: string | null;
  orden_venta_id: string | null;
  km_inicial: number | null;
  km_final: number | null;
  manifiesto_folio: string | null;
  manifiesto_registro: string | null;
  residuo_tipo: string | null;
  ticket: string | null;
  estado: EstadoViaje;
  notas: string | null;
  created_by_nombre: string | null;
}

export interface Gasto {
  id: string;
  empresa_id: string;
  unidad_id: string;
  viaje_id: string | null;
  folio: string | null;
  fecha: string;
  tipo: TipoGasto;
  descripcion: string | null;
  litros: number | null;
  monto: number;
  proveedor: string | null;
  referencia: string | null;
  km: number | null;
  created_by_nombre: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | string | null | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Importe del viaje: cantidad × precio; si se cobra por viaje (o no hay
 * cantidad), viajes × precio. Lo capturado a mano manda. */
export function importeViaje(v: { cantidad?: number | string | null; unidad_medida: string; viajes?: number | string | null; precio?: number | string | null; importe?: number | string | null }): number {
  const capturado = num(v.importe);
  if (capturado > 0) return r2(capturado);
  const precio = num(v.precio);
  if (precio <= 0) return 0;
  const cantidad = num(v.cantidad);
  const viajes = Math.max(1, Math.round(num(v.viajes) || 1));
  return r2(v.unidad_medida === "viaje" || cantidad <= 0 ? viajes * precio : cantidad * precio);
}

export function kmViaje(v: { km_inicial?: number | string | null; km_final?: number | string | null }): number | null {
  const a = v.km_inicial == null || v.km_inicial === "" ? null : num(v.km_inicial);
  const b = v.km_final == null || v.km_final === "" ? null : num(v.km_final);
  if (a == null || b == null || b < a) return null;
  return r2(b - a);
}

export function revisarViaje(v: { unidad_id: string; fecha: string; tipo: string; cantidad: string; unidad_medida: string; viajes: string; precio: string; importe: string; km_inicial: string; km_final: string; manifiesto_folio?: string }): string | null {
  if (!v.unidad_id) return "Elige la unidad.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.fecha)) return "Escribe la fecha del viaje.";
  if (!TIPOS_VIAJE.some((t) => t.clave === v.tipo)) return "Elige el tipo de viaje.";
  if (v.cantidad.trim() !== "" && !(num(v.cantidad) >= 0)) return "La cantidad no es válida.";
  if (v.viajes.trim() !== "" && !(Number.isInteger(Number(v.viajes)) && Number(v.viajes) > 0)) return "Los viajes deben ser un entero mayor a cero.";
  if (v.precio.trim() !== "" && !(num(v.precio) >= 0)) return "El precio no es válido.";
  if (v.importe.trim() !== "" && !(num(v.importe) >= 0)) return "El importe no es válido.";
  const km = kmViaje(v);
  if (v.km_inicial.trim() !== "" && v.km_final.trim() !== "" && km == null) return "El kilometraje final debe ser mayor o igual al inicial.";
  if (v.tipo === "residuos" && !(v.manifiesto_folio ?? "").trim()) return "Para residuos de manejo especial anota el folio del manifiesto.";
  return null;
}

export function revisarGasto(g: { unidad_id: string; fecha: string; tipo: string; monto: string; litros: string }): string | null {
  if (!g.unidad_id) return "Elige la unidad.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.fecha)) return "Escribe la fecha del gasto.";
  if (!TIPOS_GASTO.some((t) => t.clave === g.tipo)) return "Elige el tipo de gasto.";
  if (!(num(g.monto) > 0)) return "Escribe el monto.";
  if (g.litros.trim() !== "" && !(num(g.litros) > 0)) return "Los litros no son válidos.";
  return null;
}

export const esCombustible = (tipo: string) => TIPOS_GASTO.some((t) => t.clave === tipo && t.combustible);

/** Periodo: mes "2026-11", o rango desde/hasta (inclusive). */
export interface Periodo {
  desde: string;
  hasta: string;
}
export function periodoMes(mes: string): Periodo {
  const [a, m] = mes.split("-").map(Number);
  const fin = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(fin).padStart(2, "0")}` };
}
export function enPeriodo(fecha: string, p: Periodo): boolean {
  return fecha >= p.desde && fecha <= p.hasta;
}

export interface ResumenUnidad {
  unidad_id: string;
  viajes: number;
  cargas: number;
  cantidad_m3: number;
  cantidad_ton: number;
  ingresos: number;
  cobrado: number;
  por_cobrar: number;
  gastos: number;
  gastos_por_tipo: Partial<Record<TipoGasto, number>>;
  combustible: number;
  litros: number;
  km: number;
  km_por_litro: number | null;
  costo_por_km: number | null;
  utilidad: number;
  margen_pct: number | null;
}

/** Ingresos vs gastos por unidad (solo viajes no cancelados). */
export function resumenPorUnidad(viajes: Pick<Viaje, "unidad_id" | "estado" | "importe" | "cobrado" | "cantidad" | "unidad_medida" | "viajes" | "km_inicial" | "km_final">[], gastos: Pick<Gasto, "unidad_id" | "tipo" | "monto" | "litros">[], unidades: string[] = []): ResumenUnidad[] {
  const ids = new Set<string>(unidades);
  for (const v of viajes) ids.add(v.unidad_id);
  for (const g of gastos) ids.add(g.unidad_id);
  const out: ResumenUnidad[] = [];
  for (const id of ids) {
    const vs = viajes.filter((v) => v.unidad_id === id && v.estado !== "cancelado");
    const gs = gastos.filter((g) => g.unidad_id === id);
    const r: ResumenUnidad = {
      unidad_id: id,
      viajes: vs.reduce((s, v) => s + Math.max(1, num(v.viajes) || 1), 0),
      cargas: vs.length,
      cantidad_m3: r2(vs.filter((v) => v.unidad_medida === "m3").reduce((s, v) => s + num(v.cantidad), 0)),
      cantidad_ton: r2(vs.filter((v) => v.unidad_medida === "ton").reduce((s, v) => s + num(v.cantidad), 0)),
      ingresos: r2(vs.reduce((s, v) => s + num(v.importe), 0)),
      cobrado: r2(vs.filter((v) => v.cobrado).reduce((s, v) => s + num(v.importe), 0)),
      por_cobrar: 0,
      gastos: r2(gs.reduce((s, g) => s + num(g.monto), 0)),
      gastos_por_tipo: {},
      combustible: r2(gs.filter((g) => esCombustible(g.tipo)).reduce((s, g) => s + num(g.monto), 0)),
      litros: r2(gs.filter((g) => esCombustible(g.tipo)).reduce((s, g) => s + num(g.litros), 0)),
      km: r2(vs.reduce((s, v) => s + (kmViaje(v) ?? 0), 0)),
      km_por_litro: null,
      costo_por_km: null,
      utilidad: 0,
      margen_pct: null,
    };
    for (const g of gs) r.gastos_por_tipo[g.tipo] = r2((r.gastos_por_tipo[g.tipo] ?? 0) + num(g.monto));
    r.por_cobrar = r2(r.ingresos - r.cobrado);
    r.km_por_litro = r.litros > 0 && r.km > 0 ? Math.round((r.km / r.litros) * 100) / 100 : null;
    r.costo_por_km = r.km > 0 && r.gastos > 0 ? r2(r.gastos / r.km) : null;
    r.utilidad = r2(r.ingresos - r.gastos);
    r.margen_pct = r.ingresos > 0 ? Math.round((r.utilidad / r.ingresos) * 1000) / 10 : null;
    out.push(r);
  }
  return out.sort((a, b) => b.ingresos - a.ingresos || a.unidad_id.localeCompare(b.unidad_id));
}

export function totalesResumen(rs: ResumenUnidad[]): Pick<ResumenUnidad, "viajes" | "ingresos" | "cobrado" | "por_cobrar" | "gastos" | "utilidad" | "km" | "litros" | "margen_pct"> {
  const t = { viajes: 0, ingresos: 0, cobrado: 0, por_cobrar: 0, gastos: 0, utilidad: 0, km: 0, litros: 0, margen_pct: null as number | null };
  for (const r of rs) {
    t.viajes += r.viajes;
    t.ingresos = r2(t.ingresos + r.ingresos);
    t.cobrado = r2(t.cobrado + r.cobrado);
    t.por_cobrar = r2(t.por_cobrar + r.por_cobrar);
    t.gastos = r2(t.gastos + r.gastos);
    t.utilidad = r2(t.utilidad + r.utilidad);
    t.km = r2(t.km + r.km);
    t.litros = r2(t.litros + r.litros);
  }
  t.margen_pct = t.ingresos > 0 ? Math.round((t.utilidad / t.ingresos) * 1000) / 10 : null;
  return t;
}

/** Ingresos y gastos por mes (AAAA-MM) para la gráfica/tabla del resumen. */
export function porMes(viajes: Pick<Viaje, "fecha" | "estado" | "importe">[], gastos: Pick<Gasto, "fecha" | "monto">[]): { mes: string; ingresos: number; gastos: number; utilidad: number }[] {
  const m = new Map<string, { ingresos: number; gastos: number }>();
  const toma = (mes: string) => m.get(mes) ?? m.set(mes, { ingresos: 0, gastos: 0 }).get(mes)!;
  for (const v of viajes) if (v.estado !== "cancelado") toma(v.fecha.slice(0, 7)).ingresos += num(v.importe);
  for (const g of gastos) toma(g.fecha.slice(0, 7)).gastos += num(g.monto);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, x]) => ({ mes, ingresos: r2(x.ingresos), gastos: r2(x.gastos), utilidad: r2(x.ingresos - x.gastos) }));
}

export function filtrarViajes<T extends Pick<Viaje, "folio" | "cliente" | "origen" | "destino" | "material" | "chofer_nombre" | "manifiesto_folio" | "ticket">>(viajes: T[], texto: string): T[] {
  const q = texto.trim().toLowerCase();
  if (!q) return viajes;
  return viajes.filter((v) => [v.folio, v.cliente, v.origen, v.destino, v.material, v.chofer_nombre, v.manifiesto_folio, v.ticket].some((x) => (x ?? "").toLowerCase().includes(q)));
}

const csvCelda = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const COLUMNAS_CSV_VIAJES = ["Folio", "Fecha", "Unidad", "Chofer", "Tipo", "Cliente", "Origen", "Destino", "Material", "Cantidad", "Unidad de medida", "Viajes", "Precio", "Importe", "Cobrado", "Km inicial", "Km final", "Km", "Manifiesto", "Ticket", "Estado", "Notas"];

export function csvViajes(viajes: Viaje[], nombreUnidad: (id: string) => string): string {
  const filas = viajes.map((v) =>
    [v.folio, v.fecha, nombreUnidad(v.unidad_id), v.chofer_nombre, TIPOS_VIAJE.find((t) => t.clave === v.tipo)?.etiqueta ?? v.tipo, v.cliente, v.origen, v.destino, v.material, v.cantidad, v.unidad_medida, v.viajes, v.precio, v.importe, v.cobrado ? "sí" : "no", v.km_inicial, v.km_final, kmViaje(v), v.manifiesto_folio, v.ticket, ETIQUETA_ESTADO_VIAJE[v.estado], v.notas]
      .map(csvCelda)
      .join(","),
  );
  return [COLUMNAS_CSV_VIAJES.join(","), ...filas].join("\n");
}

export const COLUMNAS_CSV_GASTOS = ["Folio", "Fecha", "Unidad", "Tipo", "Descripción", "Litros", "Monto", "Proveedor", "Referencia", "Km", "Capturó"];
export function csvGastos(gastos: Gasto[], nombreUnidad: (id: string) => string): string {
  const filas = gastos.map((g) => [g.folio, g.fecha, nombreUnidad(g.unidad_id), TIPOS_GASTO.find((t) => t.clave === g.tipo)?.etiqueta ?? g.tipo, g.descripcion, g.litros, g.monto, g.proveedor, g.referencia, g.km, g.created_by_nombre].map(csvCelda).join(","));
  return [COLUMNAS_CSV_GASTOS.join(","), ...filas].join("\n");
}

// ── Documentos imprimibles ───────────────────────────────────────────────

const dinero = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fechaLarga = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });

export interface DatosGenerador {
  razon_social: string;
  rfc?: string | null;
  domicilio?: string | null;
  registro?: string | null;
  representante?: string | null;
  municipio?: string | null;
  actividad?: string | null;
}
export interface DatosTransportista {
  nombre: string;
  placas?: string | null;
  unidad?: string | null;
}

const estilosDoc = `
  @page { size: letter; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; }
  h1 { font-size: 15px; margin: 0 0 2px; text-transform: uppercase; }
  h2 { font-size: 11px; margin: 10px 0 4px; background: #e2e8f0; padding: 3px 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #94a3b8; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-size: 10px; text-transform: uppercase; }
  .num { text-align: right; white-space: nowrap; }
  .meta { font-size: 10px; color: #475569; }
  .firmas { display: flex; gap: 24px; margin-top: 36px; }
  .firma { flex: 1; border-top: 1px solid #111; padding-top: 4px; text-align: center; font-size: 10px; }
  .vacia td { height: 22px; }
`;

/** Manifiesto de entrega, transporte y recepción de residuos de manejo
 * especial (el formato del Excel "Manifiestos Volteo": generador,
 * transportista y un renglón por viaje con placas, volumen, fecha y hora). */
export function htmlManifiestoResiduos(generador: DatosGenerador, transportista: DatosTransportista, viajes: Pick<Viaje, "folio" | "fecha" | "hora_salida" | "cantidad" | "unidad_medida" | "material" | "residuo_tipo" | "destino" | "manifiesto_folio" | "chofer_nombre">[], titulo = "Manifiesto de residuos de manejo especial"): string {
  const folios = [...new Set(viajes.map((v) => v.manifiesto_folio).filter(Boolean))].join(", ");
  const renglones = viajes
    .map(
      (v, i) => `<tr>
      <td class="num">${i + 1}</td><td>${esc(v.folio)}</td><td>${esc(fechaLarga(v.fecha))}</td><td>${esc(v.hora_salida ?? "")}</td>
      <td>${esc(v.residuo_tipo ?? v.material ?? "")}</td><td class="num">${v.cantidad != null ? `${v.cantidad} ${esc(v.unidad_medida)}` : ""}</td>
      <td>${esc(v.destino ?? "")}</td><td>${esc(v.chofer_nombre ?? "")}</td><td></td></tr>`,
    )
    .join("");
  const vacias = Array.from({ length: Math.max(0, 8 - viajes.length) }, () => `<tr class="vacia"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join("");
  const total = viajes.reduce((s, v) => s + num(v.cantidad), 0);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${estilosDoc}</style></head><body>
  <h1>${esc(titulo)}</h1>
  <div class="meta">Generación, transporte, aprovechamiento y/o disposición final de residuos de manejo especial${folios ? ` · Manifiesto(s) ${esc(folios)}` : ""}</div>
  <h2>I. Generador</h2>
  <table><tr><th style="width:28%">Nombre o razón social</th><td>${esc(generador.razon_social)}</td><th style="width:22%">Registro como generador</th><td>${esc(generador.registro ?? "")}</td></tr>
  <tr><th>RFC</th><td>${esc(generador.rfc ?? "")}</td><th>Representante legal</th><td>${esc(generador.representante ?? "")}</td></tr>
  <tr><th>Ubicación</th><td>${esc(generador.domicilio ?? "")}</td><th>Municipio</th><td>${esc(generador.municipio ?? "")}</td></tr>
  <tr><th>Actividad principal</th><td colspan="3">${esc(generador.actividad ?? "")}</td></tr></table>
  <h2>II. Transportista</h2>
  <table><tr><th style="width:28%">Nombre</th><td>${esc(transportista.nombre)}</td><th style="width:22%">Unidad / placas</th><td>${esc([transportista.unidad, transportista.placas].filter(Boolean).join(" · "))}</td></tr></table>
  <h2>III. Viajes</h2>
  <table><thead><tr><th>#</th><th>Folio</th><th>Fecha</th><th>Hora</th><th>Residuo</th><th class="num">Volumen</th><th>Destino / disposición</th><th>Operador</th><th>Firma</th></tr></thead>
  <tbody>${renglones}${vacias}</tbody>
  ${total > 0 ? `<tfoot><tr><th colspan="5" class="num">Total</th><th class="num">${total.toLocaleString("es-MX")}</th><th colspan="3"></th></tr></tfoot>` : ""}</table>
  <h2>IV. Certificación del generador</h2>
  <p class="meta">Declaro que el contenido de este manifiesto está total y correctamente descrito mediante el nombre del residuo, características, embalaje, marcado y rotulado, y que se han previsto las condiciones de seguridad para su transporte por vía terrestre de acuerdo con la legislación aplicable.</p>
  <div class="firmas"><div class="firma">Generador<br>Nombre y firma</div><div class="firma">Transportista<br>Nombre y firma</div><div class="firma">Destino / disposición final<br>Nombre, sello y firma</div></div>
  </body></html>`;
}

/** Bitácora de viajes de una unidad en un periodo, con ingresos, cobro y km. */
export function htmlBitacoraViajes(empresa: string, unidad: DatosTransportista, periodo: Periodo, viajes: Viaje[], gastos: Gasto[]): string {
  const vs = viajes.filter((v) => v.estado !== "cancelado");
  const r = resumenPorUnidad(vs, gastos)[0];
  const renglones = vs
    .map(
      (v) => `<tr><td>${esc(v.folio)}</td><td>${esc(v.fecha)}</td><td>${esc(v.cliente ?? "")}</td><td>${esc([v.origen, v.destino].filter(Boolean).join(" → "))}</td>
      <td>${esc(v.material ?? "")}</td><td class="num">${v.cantidad != null ? `${v.cantidad} ${esc(v.unidad_medida)}` : `${v.viajes} viaje(s)`}</td>
      <td class="num">${dinero(num(v.importe))}</td><td>${v.cobrado ? "sí" : "no"}</td><td class="num">${kmViaje(v) ?? ""}</td><td>${esc(v.chofer_nombre ?? "")}</td></tr>`,
    )
    .join("");
  const gs = gastos.map((g) => `<tr><td>${esc(g.folio)}</td><td>${esc(g.fecha)}</td><td>${esc(TIPOS_GASTO.find((t) => t.clave === g.tipo)?.etiqueta ?? g.tipo)}</td><td>${esc(g.descripcion ?? "")}</td><td class="num">${g.litros ?? ""}</td><td class="num">${dinero(num(g.monto))}</td></tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Bitácora ${esc(unidad.nombre)}</title><style>${estilosDoc}</style></head><body>
  <h1>Bitácora de viajes · ${esc(unidad.nombre)}</h1>
  <div class="meta">${esc(empresa)} · ${esc([unidad.placas, unidad.unidad].filter(Boolean).join(" · "))} · del ${esc(fechaLarga(periodo.desde))} al ${esc(fechaLarga(periodo.hasta))}</div>
  <h2>Viajes (${vs.length})</h2>
  <table><thead><tr><th>Folio</th><th>Fecha</th><th>Cliente / obra</th><th>Trayecto</th><th>Material</th><th class="num">Cantidad</th><th class="num">Importe</th><th>Cobrado</th><th class="num">Km</th><th>Chofer</th></tr></thead>
  <tbody>${renglones || `<tr><td colspan="10" class="meta">Sin viajes en el periodo.</td></tr>`}</tbody></table>
  <h2>Gastos (${gastos.length})</h2>
  <table><thead><tr><th>Folio</th><th>Fecha</th><th>Tipo</th><th>Descripción</th><th class="num">Litros</th><th class="num">Monto</th></tr></thead>
  <tbody>${gs || `<tr><td colspan="6" class="meta">Sin gastos en el periodo.</td></tr>`}</tbody></table>
  <h2>Resumen</h2>
  <table><tr><th>Viajes</th><td class="num">${r?.viajes ?? 0}</td><th>Ingresos</th><td class="num">${dinero(r?.ingresos ?? 0)}</td><th>Cobrado</th><td class="num">${dinero(r?.cobrado ?? 0)}</td><th>Por cobrar</th><td class="num">${dinero(r?.por_cobrar ?? 0)}</td></tr>
  <tr><th>Gastos</th><td class="num">${dinero(r?.gastos ?? 0)}</td><th>Utilidad</th><td class="num">${dinero(r?.utilidad ?? 0)}${r?.margen_pct != null ? ` (${r.margen_pct} %)` : ""}</td><th>Km</th><td class="num">${r?.km ?? 0}</td><th>Km / litro</th><td class="num">${r?.km_por_litro ?? "—"}</td></tr></table>
  <div class="firmas"><div class="firma">Operador</div><div class="firma">Logística</div><div class="firma">Dirección</div></div>
  </body></html>`;
}
