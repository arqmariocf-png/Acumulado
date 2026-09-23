// Export "PEDIDOS RECIBIDOS" de Adquira (portal de proveedores de BBVA) y
// su conciliación contra el maestro de folios BBVA.
//
// Módulo puro (sin xlsx, sin Deno, sin Supabase) para poder probarlo con
// node --test y reutilizar conciliarAdquira() desde el frontend. Quien lo
// llama lee el libro con SheetJS y pasa las filas crudas (header: 1).
//
// El export trae TODO en una hoja ("Órdenes"): primero 5 renglones de
// encabezado (uno por tipo de registro) y luego, por cada pedido, su
// cabecera seguida de sus líneas, recepciones y datos adicionales. Cada
// renglón se clasifica por su forma:
//   cabecera    : col1 = comprador ("BBVA México..."), col5 = "MXN 40.516,75"
//   linea       : col1 = "00010" (Nº línea), col2 = artículo, col7 = unidad, col8 = base
//   recepcion   : col1 = Nº línea, col2 = cantidad expedida (número)
//   dato_pedido : col1 = nombre del dato (FORCED_PO, global), col2 = valor
//   dato_linea  : col1 = Nº línea, col2 = nombre del dato (Solicitante...), col3 = valor

export type TipoFilaAdquira = "encabezado" | "cabecera" | "linea" | "recepcion" | "dato_pedido" | "dato_linea" | "vacia";

export interface LineaAdquira {
  linea: string;
  articulo: string;
  estado: string | null;
  cantidad: number;
  precio_unitario: number;
  unidad: string | null;
  base: number;
  importe: number;
  referencia: string | null;
}

export interface PedidoAdquira {
  id_pedido: string;
  fecha: string | null;
  fecha_publicacion: string | null;
  importe_total: number;
  base_imponible: number;
  impuestos: number;
  estado: string | null;
  lineas: number;
  solicitante: string | null;
  contrato: string | null;
  lineas_detalle: LineaAdquira[];
}

const MESES: Record<string, string> = {
  ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06",
  jul: "07", ago: "08", sep: "09", sept: "09", oct: "10", nov: "11", dic: "12",
};

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** "MXN 40.516,75" (formato europeo que usa Adquira) -> 40516.75. Acepta
 * también números y cadenas "1234.56" sin separador de miles. */
export function parsearMontoMxn(v: unknown): number {
  if (typeof v === "number") return v;
  const s = texto(v);
  if (!s) return 0;
  let limpio = s.replace(/[A-Za-z$\s]/g, "");
  if (limpio.includes(",") && limpio.includes(".")) {
    // Ambos separadores: el último que aparece es el decimal.
    limpio = limpio.lastIndexOf(",") > limpio.lastIndexOf(".") ? limpio.replace(/\./g, "").replace(",", ".") : limpio.replace(/,/g, "");
  } else if (limpio.includes(",")) {
    limpio = limpio.replace(",", ".");
  }
  const n = Number(limpio);
  return Number.isFinite(n) ? n : 0;
}

/** "10-sep-2026" -> "2026-09-10". Acepta también Date y "YYYY-MM-DD". */
export function parsearFechaEs(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = texto(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.toLowerCase().match(/^(\d{1,2})[-/ ]([a-záé]+)\.?[-/ ](\d{4})$/);
  if (!m) return null;
  const mes = MESES[m[2].replace("é", "e").replace("á", "a")];
  if (!mes) return null;
  return `${m[3]}-${mes}-${m[1].padStart(2, "0")}`;
}

/** "473242_2026-09-17_22_13_01_PEDIDOS_RECIBIDOS.xlsx" -> "2026-09-17". */
export function fechaExportacionDeNombre(nombre: string): string | null {
  const m = nombre.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function numeroLinea(v: unknown): string | null {
  if (typeof v === "number" && Number.isInteger(v)) return String(v).padStart(5, "0");
  const s = texto(v);
  return s && /^\d{5}$/.test(s) ? s : null;
}

export function clasificarFila(fila: unknown[]): TipoFilaAdquira {
  const c0 = texto(fila[0]), c1 = fila[1], c2 = fila[2];
  if (c0 === "ID. PEDIDO COMPRADOR") return "encabezado";
  if (!c0 || (c1 === null || c1 === undefined || c1 === "")) return "vacia";
  const linea = numeroLinea(c1);
  if (linea) {
    if (typeof c2 === "number") return "recepcion";
    const c2s = texto(c2);
    if (c2s && /^[\d.,]+$/.test(c2s)) return "recepcion";
    // Línea de pedido: trae unidad de medida y base imponible; dato de línea sólo nombre/valor.
    return texto(fila[7]) !== null && fila[8] !== null && fila[8] !== undefined && fila[8] !== "" ? "linea" : "dato_linea";
  }
  const c5 = fila[5];
  if (typeof c5 === "number" || (typeof c5 === "string" && /MXN|\d/.test(c5) && texto(fila[6]) !== null)) return "cabecera";
  return "dato_pedido";
}

export function procesarFilasAdquira(filas: unknown[][]): PedidoAdquira[] {
  const pedidos = new Map<string, PedidoAdquira>();
  for (const fila of filas) {
    if (!fila) continue;
    const tipo = clasificarFila(fila);
    if (tipo === "encabezado" || tipo === "vacia") continue;
    const id = texto(fila[0])!;
    if (tipo === "cabecera") {
      const total = parsearMontoMxn(fila[5]);
      const existente = pedidos.get(id);
      pedidos.set(id, {
        id_pedido: id,
        fecha: parsearFechaEs(fila[3]),
        fecha_publicacion: parsearFechaEs(fila[4]),
        importe_total: total,
        base_imponible: existente?.base_imponible ?? 0,
        impuestos: existente?.impuestos ?? 0,
        estado: texto(fila[6]),
        lineas: existente?.lineas ?? 0,
        solicitante: existente?.solicitante ?? null,
        contrato: existente?.contrato ?? null,
        lineas_detalle: existente?.lineas_detalle ?? [],
      });
      continue;
    }
    const p = pedidos.get(id) ?? {
      id_pedido: id, fecha: null, fecha_publicacion: null, importe_total: 0, base_imponible: 0, impuestos: 0,
      estado: null, lineas: 0, solicitante: null, contrato: null, lineas_detalle: [],
    };
    pedidos.set(id, p);
    if (tipo === "linea") {
      const base = parsearMontoMxn(fila[8]);
      const importe = parsearMontoMxn(fila[11]);
      p.lineas += 1;
      p.base_imponible += base;
      p.impuestos += importe - base;
      p.lineas_detalle.push({
        linea: numeroLinea(fila[1])!,
        articulo: texto(fila[2]) ?? "",
        estado: texto(fila[3]),
        cantidad: parsearMontoMxn(fila[4]),
        precio_unitario: parsearMontoMxn(fila[5]),
        unidad: texto(fila[7]),
        base,
        importe,
        referencia: texto(fila[12]),
      });
    } else if (tipo === "dato_linea") {
      const nombre = (texto(fila[2]) ?? "").toLowerCase();
      const valor = texto(fila[3]);
      if (nombre === "solicitante" && valor && !p.solicitante) p.solicitante = valor;
      if (nombre === "contrato" && valor && !p.contrato) p.contrato = valor;
    }
  }
  const lista = [...pedidos.values()].map((p) => ({
    ...p,
    importe_total: redondear2(p.importe_total),
    base_imponible: redondear2(p.base_imponible),
    impuestos: redondear2(p.impuestos),
  }));
  lista.sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || a.id_pedido.localeCompare(b.id_pedido));
  return lista;
}

// ── Conciliación maestro BBVA (por pedido) vs Adquira ───────────────────

/** Lo que el parser del maestro (bbva-folios.ts) guarda por pedido en el
 * snapshot: conciliacion.pedidos. */
export interface PedidoBbva {
  pedido: string;
  folios: number;
  monto: number;
  facturas: string[];
  pagados: number;
}

export interface PedidoAdquiraResumen {
  id_pedido: string;
  fecha: string | null;
  importe_total: number;
  base_imponible: number;
  estado: string | null;
}

export interface DiferenciaPedido {
  pedido: string;
  folios: number;
  facturas: string[];
  pagados: number;
  monto_bbva: number;
  base_adquira: number;
  total_adquira: number;
  diferencia: number;
  estado_adquira: string | null;
  fecha_adquira: string | null;
}

export interface ConciliacionAdquira {
  total_pedidos: number;
  pedidos_con_factura: number;
  pedidos_en_adquira: number;
  pedidos_sin_adquira: string[];
  pedidos_invalidos: string[];
  pedidos_con_diferencia_monto: number;
  pedidos_coinciden: number;
  suma_folios_puebla: number;
  suma_facturas_adquira: number;
  suma_adquira_con_iva: number;
  tolerancia: number;
  diferencias: DiferenciaPedido[];
  adquira_meta: {
    fecha_exportacion: string | null;
    total_pedidos_export: number;
    importe_export: number;
    pedidos_fuera_maestro: number;
    importe_fuera_maestro: number;
  };
}

function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Un número de pedido Adquira son 10 dígitos; lo demás ("0", "SUCURSAL
 * CERRADA", un número con un dígito de menos) es captura a corregir. */
export function esPedidoValido(pedido: string): boolean {
  return /^\d{10}$/.test(pedido.trim());
}

export function conciliarAdquira(
  pedidosBbva: PedidoBbva[],
  adquira: PedidoAdquiraResumen[],
  meta: { fecha_exportacion: string | null },
  tolerancia = 1,
): ConciliacionAdquira {
  const porId = new Map(adquira.map((a) => [a.id_pedido.trim(), a]));
  const validos = pedidosBbva.filter((p) => esPedidoValido(p.pedido));
  const invalidos = pedidosBbva.filter((p) => !esPedidoValido(p.pedido)).map((p) => p.pedido);

  const diferencias: DiferenciaPedido[] = [];
  const sinAdquira: string[] = [];
  let enAdquira = 0, coinciden = 0, sumaBase = 0, sumaIva = 0;
  for (const p of validos) {
    const a = porId.get(p.pedido.trim());
    if (!a) {
      sinAdquira.push(p.pedido);
      continue;
    }
    enAdquira++;
    sumaBase += a.base_imponible;
    sumaIva += a.importe_total;
    const diferencia = redondear2(p.monto - a.base_imponible);
    if (Math.abs(diferencia) <= tolerancia) {
      coinciden++;
      continue;
    }
    diferencias.push({
      pedido: p.pedido,
      folios: p.folios,
      facturas: p.facturas,
      pagados: p.pagados,
      monto_bbva: redondear2(p.monto),
      base_adquira: redondear2(a.base_imponible),
      total_adquira: redondear2(a.importe_total),
      diferencia,
      estado_adquira: a.estado,
      fecha_adquira: a.fecha,
    });
  }
  diferencias.sort((x, y) => Math.abs(y.diferencia) - Math.abs(x.diferencia));

  const idsMaestro = new Set(validos.map((p) => p.pedido.trim()));
  const fuera = adquira.filter((a) => !idsMaestro.has(a.id_pedido.trim()));

  return {
    total_pedidos: pedidosBbva.length,
    pedidos_con_factura: pedidosBbva.filter((p) => p.facturas.length > 0).length,
    pedidos_en_adquira: enAdquira,
    pedidos_sin_adquira: sinAdquira,
    pedidos_invalidos: invalidos,
    pedidos_con_diferencia_monto: diferencias.length,
    pedidos_coinciden: coinciden,
    suma_folios_puebla: redondear2(pedidosBbva.reduce((s, p) => s + p.monto, 0)),
    suma_facturas_adquira: redondear2(sumaBase),
    suma_adquira_con_iva: redondear2(sumaIva),
    tolerancia,
    diferencias,
    adquira_meta: {
      fecha_exportacion: meta.fecha_exportacion,
      total_pedidos_export: adquira.length,
      importe_export: redondear2(adquira.reduce((s, a) => s + a.importe_total, 0)),
      pedidos_fuera_maestro: fuera.length,
      importe_fuera_maestro: redondear2(fuera.reduce((s, a) => s + a.importe_total, 0)),
    },
  };
}
