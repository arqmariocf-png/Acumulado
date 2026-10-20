// Parte pura del respaldo en Dropbox (21-oct-2026): CSV de cada tabla, qué
// archivos de Storage van y el índice LEEME.md que leen otras sesiones de
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

/** Archivos de Storage que NO van: selfies del checador, expedientes de RH y la e.firma del SAT. */
export function archivoRespaldable(nombre: string): boolean {
  const n = nombre.toLowerCase();
  if (/\.(cer|key|pfx|p12)$/.test(n)) return false;
  if (n.startsWith("checador/") || n.startsWith("rh/")) return false;
  if (n.startsWith("sat/")) return /^sat\/[^/]+\/descargas\//.test(n);
  return !n.endsWith("/.emptyfolderplaceholder");
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
    "# Respaldo de Acumulado (Grupo Loma)",
    "",
    `Actualizado: ${fecha} (hora de México). Se actualiza solo cada noche; cada tabla se reescribe solo si cambió y Dropbox guarda sus versiones anteriores.`,
    "",
    "## Cómo leerlo",
    "- `Tablas/`: una tabla del sistema por archivo CSV (UTF-8, primera fila = columnas). Las muy grandes van en partes.",
    "- `Archivos/`: los archivos subidos al sistema con la misma ruta que en Acumulado (estados de cuenta, CFDI y descargas del SAT, comprobantes de pago, planos, notas de entrega, archivos de tareas).",
    "- Montos de OC del backoffice ya incluyen IVA (`total`); las partidas propias (IA-…) van sin IVA. Fechas en ISO (aaaa-mm-dd). Las llaves `*_id` apuntan al `id` de otra tabla (ej. `empresa_id` → `empresas.id`).",
    "- No incluye: contraseñas ni llaves, la e.firma del SAT, expedientes y datos personales de RH (personal, contratos, sueldos, checador), cuentas de nómina, datos bancarios de proveedores ni perfiles de usuario.",
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

