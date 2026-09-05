// Shaping puro de la tarjeta de análisis de precio unitario: agrupa los
// renglones como se imprimen (materiales, mano de obra, herramienta y
// equipo, básicos), saca los subtotales y arma el pie de sobrecosto.
//
// Sin imports externos a propósito, para poder probarse con `node --test`
// igual que el resto de _shared. El dibujo real del PDF (que sí depende de
// npm:pdf-lib, Deno-only) vive en pdf-pu.ts y consume lo que devuelve
// construirTarjetaPu.
//
// Los importes ya vienen calculados y redondeados de v_pu_analisis_costeo /
// v_pu_analisis_detalle: aquí NO se recalcula ningún precio. Es a propósito
// -- el precio unitario tiene una sola definición y vive en la base
// (20260905100100_pu_costeo.sql). Un PDF que recalculara por su cuenta sería
// una segunda definición esperando a discrepar de la pantalla.

export type PuTipoInsumo = "material" | "mano_obra" | "herramienta" | "equipo" | "auxiliar";

export type PuBaseCalculo = "cantidad" | "pct_mano_obra";

export type PuEstado =
  | "borrador"
  | "en_revision_material"
  | "material_confirmado"
  | "autorizado"
  | "publicado"
  | "obsoleto";

export interface RenglonPu {
  orden: number;
  baseCalculo: PuBaseCalculo;
  codigo: string | null;
  descripcion: string | null;
  unidad: string | null;
  tipo: PuTipoInsumo;
  aportacion: number;
  costoUnitario: number;
  importe: number;
  sinPrecio: boolean;
  proveedor: string | null;
}

export interface CabeceraPu {
  empresaNombre: string;
  proyectoNombre: string | null;
  codigo: string;
  concepto: string;
  unidad: string;
  esAuxiliar: boolean;
  estado: PuEstado;
  creadoPorNombre: string | null;
  factorNombre: string | null;
  indirectosPct: number;
  financiamientoPct: number;
  utilidadPct: number;
  cargosAdicionalesPct: number;
  costoDirecto: number;
  importeIndirectos: number;
  importeFinanciamiento: number;
  importeUtilidad: number;
  importeCargosAdicionales: number;
  precioUnitario: number;
  insumosSinPrecio: number;
}

export interface GrupoRenglones {
  titulo: string;
  renglones: RenglonPu[];
  subtotal: number;
}

export interface LineaSobrecosto {
  etiqueta: string;
  importe: number;
}

export interface TarjetaPu {
  cabecera: CabeceraPu;
  grupos: GrupoRenglones[];
  costoDirecto: number;
  sobrecosto: LineaSobrecosto[];
  precioUnitario: number;
  /** Hasta que el precio se publica, el PDF sale marcado: circula como
   * borrador y no debe poder confundirse con un precio autorizado. */
  marcaDeAgua: string | null;
  /** Avisos que se imprimen bajo la tabla, para que quien reciba la tarjeta
   * sepa qué le falta en vez de tener que sumarla para descubrirlo. */
  advertencias: string[];
}

// 'herramienta' y 'equipo' se imprimen bajo un solo encabezado, igual que en
// la pantalla: para quien lee la tarjeta son el mismo capítulo.
const GRUPOS: { titulo: string; tipos: PuTipoInsumo[] }[] = [
  { titulo: "Materiales", tipos: ["material"] },
  { titulo: "Mano de obra", tipos: ["mano_obra"] },
  { titulo: "Herramienta y equipo", tipos: ["herramienta", "equipo"] },
  { titulo: "Básicos", tipos: ["auxiliar"] },
];

const ETIQUETA_ESTADO: Record<PuEstado, string> = {
  borrador: "Borrador",
  en_revision_material: "En revisión de material",
  material_confirmado: "Material confirmado",
  autorizado: "Autorizado, sin publicar",
  publicado: "Publicado",
  obsoleto: "Dado de baja",
};

export function etiquetaEstado(estado: PuEstado): string {
  return ETIQUETA_ESTADO[estado] ?? estado;
}

/** Redondeo a centavos, para que un subtotal no arrastre ruido de punto
 * flotante al sumar renglones que ya vienen redondeados de la base. */
function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Cómo se lee la columna de cantidad: un renglón por porcentaje se imprime
 * como porcentaje (3%), no como la fracción cruda (0.03) con la que se
 * guarda y se calcula. */
export function textoCantidad(r: RenglonPu): string {
  if (r.baseCalculo === "pct_mano_obra") {
    return `${(r.aportacion * 100).toLocaleString("es-MX", { maximumFractionDigits: 2 })}%`;
  }
  return r.aportacion.toLocaleString("es-MX", { maximumFractionDigits: 4 });
}

/** La celda completa de la columna CANTIDAD. Un renglón por porcentaje no
 * lleva unidad: el "%" ya la dice, y la unidad que trae el insumo en el
 * catálogo es justamente "% MO" -- imprimir las dos da "3% % MO". */
export function celdaCantidad(r: RenglonPu): string {
  if (r.baseCalculo === "pct_mano_obra") return textoCantidad(r);
  return `${textoCantidad(r)} ${r.unidad ?? ""}`.trim();
}

export function construirTarjetaPu(cabecera: CabeceraPu, renglones: RenglonPu[]): TarjetaPu {
  const grupos: GrupoRenglones[] = [];

  for (const g of GRUPOS) {
    const filas = renglones
      .filter((r) => g.tipos.includes(r.tipo))
      .sort((a, b) => a.orden - b.orden);
    if (filas.length === 0) continue;
    grupos.push({
      titulo: g.titulo,
      renglones: filas,
      subtotal: centavos(filas.reduce((s, r) => s + r.importe, 0)),
    });
  }

  // Un básico se consume dentro de otro análisis a costo directo: no lleva
  // indirectos ni utilidad, así que su pie de tarjeta se queda en el costo
  // directo y ya.
  const sobrecosto: LineaSobrecosto[] = cabecera.esAuxiliar
    ? []
    : [
        { etiqueta: `Indirectos ${porcentaje(cabecera.indirectosPct)}`, importe: cabecera.importeIndirectos },
        { etiqueta: `Financiamiento ${porcentaje(cabecera.financiamientoPct)}`, importe: cabecera.importeFinanciamiento },
        { etiqueta: `Utilidad ${porcentaje(cabecera.utilidadPct)}`, importe: cabecera.importeUtilidad },
        {
          etiqueta: `Cargos adicionales ${porcentaje(cabecera.cargosAdicionalesPct)}`,
          importe: cabecera.importeCargosAdicionales,
        },
      ];

  const advertencias: string[] = [];
  if (cabecera.insumosSinPrecio > 0) {
    advertencias.push(
      `${cabecera.insumosSinPrecio} insumo(s) sin costo en catálogo: se están contando en cero, así que este precio está incompleto.`,
    );
  }
  if (!cabecera.esAuxiliar && !cabecera.factorNombre) {
    advertencias.push("Sin factor de sobrecosto asignado: la cifra de abajo es costo directo, no precio de venta.");
  }
  if (renglones.length === 0) {
    advertencias.push("El análisis no tiene renglones capturados todavía.");
  }

  return {
    cabecera,
    grupos,
    costoDirecto: cabecera.costoDirecto,
    sobrecosto,
    precioUnitario: cabecera.precioUnitario,
    marcaDeAgua: cabecera.estado === "publicado" ? null : "SIN AUTORIZAR",
    advertencias,
  };
}

export function porcentaje(fraccion: number): string {
  return `${(fraccion * 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function dinero(n: number): string {
  const signo = n < 0 ? "-" : "";
  return `${signo}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Encabezado de una línea: "MUR-TAB-01 · Muro de tabique ... · M2". */
export function tituloTarjeta(c: CabeceraPu): string {
  return `${c.codigo} · ${c.concepto} · ${c.unidad}`;
}
