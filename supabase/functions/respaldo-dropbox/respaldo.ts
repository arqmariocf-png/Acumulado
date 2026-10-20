// Parte pura del respaldo en Dropbox (21-oct-2026): CSV de cada tabla, qué
// archivos de Storage van (por ahora solo planos: Mario, "únicamente por ahora
// de los proyectos a cotizar") y el índice LEEME.md que leen otras sesiones de
// Claude. Pruebas en _shared/respaldo/.

/** Tope por archivo: el conector de Dropbox de Claude lee hasta 5 MiB. */
export const MAX_BYTES_CSV = 4_500_000;

export type Fila = Record<string, unknown>;

function celda(v: unknown): string {
  if (v === null || v === undefined) return "";
  const texto = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** CSV en UTF-8 con BOM (Excel lo abre con acentos), una parte por cada ~4.5 MB. */
export function aCsv(columnas: string[], filas: Fila[], maxBytes = MAX_BYTES_CSV): string[] {
  const encabezado = columnas.map(celda).join(",");
  const partes: string[] = [];
  let actual: string[] = [];
  let tam = encabezado.length;
  const enc = new TextEncoder();
  for (const f of filas) {
    const linea = columnas.map((c) => celda(f[c])).join(",");
    const bytes = enc.encode(linea).length + 2;
    if (actual.length > 0 && tam + bytes > maxBytes) {
      partes.push(`\ufeff${encabezado}\r\n${actual.join("\r\n")}\r\n`);
      actual = [];
      tam = encabezado.length;
    }
    actual.push(linea);
    tam += bytes;
  }
  partes.push(`\ufeff${encabezado}\r\n${actual.join("\r\n")}${actual.length ? "\r\n" : ""}`);
  return partes;
}

/** Nombre de cada parte: tabla.csv, tabla (parte 2).csv… */
export function nombresCsv(tabla: string, partes: number): string[] {
  return Array.from({ length: partes }, (_, i) => (i === 0 ? `${tabla}.csv` : `${tabla} (parte ${i + 1}).csv`));
}

/** Dropbox-API-Arg va en un header: todo lo que no es ASCII se escapa \uXXXX. */
export function argDropbox(arg: unknown): string {
  return JSON.stringify(arg).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Une la carpeta base con el resto, sin dobles diagonales; siempre empieza con "/". */
export function rutaDropbox(base: string, ...partes: string[]): string {
  const todo = [base, ...partes].join("/").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
  return todo.startsWith("/") ? todo : `/${todo}`;
}

/** Archivos de Storage que van: solo los planos de los proyectos (nunca llaves). */
export function archivoRespaldable(nombre: string): boolean {
  const n = nombre.toLowerCase();
  if (/\.(cer|key|pfx|p12)$/.test(n)) return false;
  return n.startsWith("planos/") && !n.endsWith("/.emptyfolderplaceholder");
}

export function hoyMexico(ahora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(ahora);
}

export interface TablaIndice {
  tabla: string;
  renglones: number;
  columnas: string[];
  descripcion: string | null;
  archivos: string[];
}

/** Índice del respaldo: qué hay, de cuándo y cómo leerlo. */
export function leemeMarkdown(tablas: TablaIndice[], archivos: { total: number; copiados: number }, generado: Date): string {
  const fecha = generado.toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long", timeStyle: "short" });
  const lineas = [
    "# Acumulado (Grupo Loma): proyectos para cotizar",
    "",
    `Actualizado: ${fecha} (hora de México). Se actualiza solo cada noche; cada tabla se reescribe solo si cambió y Dropbox guarda sus versiones anteriores.`,
    "",
    "## Cómo leerlo",
    "- `Tablas/`: una tabla por archivo CSV (UTF-8, primera fila = columnas): proyectos (obras), sus planos, presupuesto del cliente, precios unitarios (`pu_analisis` = cada análisis/concepto, `pu_analisis_items` = sus insumos con cantidad, `pu_insumos` y `pu_insumo_precios` = catálogo y precios de insumos, `pu_factores` = indirectos/utilidad, `pu_precios_cliente`, `pu_aprobaciones`), cotizaciones y los catálogos de empresas y clientes.",
    "- `Archivos/planos/<proyecto_id>/…`: los planos que se subieron a cada obra (`proyecto_planos.storage_path` dice cuál es de qué obra).",
    "- Precios unitarios y costos van sin IVA salvo que la columna diga lo contrario. Fechas en ISO (aaaa-mm-dd). Las llaves `*_id` apuntan al `id` de otra tabla (ej. `empresa_id` → `empresas.id`, `proyecto_id` → `proyectos.id`).",
    "- Solo trae lo necesario para cotizar: nada de bancos, facturas, órdenes de compra, inventario ni RH.",
    "",
    `## Archivos: ${archivos.copiados} de ${archivos.total} copiados`,
    "",
    "## Tablas",
    "",
    "| Tabla | Renglones | Archivo | Qué es |",
    "|---|---:|---|---|",
    ...tablas.map((t) => `| ${t.tabla} | ${t.renglones.toLocaleString("es-MX")} | ${t.archivos.join(", ")} | ${(t.descripcion ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 200)} |`),
    "",
    "## Columnas por tabla",
    "",
    ...tablas.map((t) => `- **${t.tabla}**: ${t.columnas.join(", ")}`),
    "",
  ];
  return lineas.join("\n");
}

