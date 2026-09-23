// Ingesta de las APIs de Grupo Loma (mano de obra y nómina fija).
//
// Puerto directo (misma lógica, mismos nombres de función) del módulo ya
// validado en el repo hermano aasanwellness (supabase/functions/_shared/
// lib/external-payroll.ts, rama claude/erendira-nominas-pagos-kdrrcr) --
// se dejó tal cual, con su propio `npm --test`, para no reintroducir bugs
// ya resueltos ahí (ver external-payroll.test.ts, portado junto a este
// archivo). Solo cambia dónde vive: aquí es una integración de Grupo Loma
// con Grupo Loma, no algo específico de Aasan Wellness.
//
// El renglón se guarda tal cual llega (jsonb); qué columna es el nombre, el
// importe, el periodo y el centro de costos se captura en nomina_externa_
// mapeos y se puede corregir a mano desde la página -- esa corrección es
// la que manda sobre la heurística de abajo.
//
// TypeScript puro (sin Deno ni DOM) para poder probarlo con `node --test`.

export type ExternalRecord = Record<string, unknown>;

/** Llaves que suelen envolver el arreglo de datos en APIs de reportes. */
const WRAPPER_KEYS = ["data", "rows", "result", "results", "records", "registros", "items", "datos", "d"];

/**
 * Saca el arreglo de renglones de una respuesta, sin saber de antemano
 * cómo viene envuelto: arreglo directo, `{ data: [...] }`, un objeto
 * suelto, o un arreglo anidado en cualquier otra llave (ej. `{ qry_MO:
 * [...] }`, la forma real de mano de obra).
 */
export function extractRecords(payload: unknown): ExternalRecord[] {
  if (payload == null) return [];
  if (Array.isArray(payload)) return payload.filter(isPlainObject);
  if (!isPlainObject(payload)) return [];

  for (const key of WRAPPER_KEYS) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isPlainObject);
  }

  // Cualquier otra llave que traiga un arreglo de objetos (la primera que
  // aparezca): cubre envolturas con nombre propio como qry_MO,
  // nomFijaSemanal o nomFijaQuincenal.
  for (const value of Object.values(payload)) {
    if (Array.isArray(value) && value.some(isPlainObject)) return value.filter(isPlainObject);
  }

  // Un solo registro suelto (no envuelto en arreglo).
  return [payload];
}

function isPlainObject(value: unknown): value is ExternalRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Unión de columnas de todos los renglones, en el orden en que aparecen. */
export function collectColumns(records: ExternalRecord[]): string[] {
  const seen = new Set<string>();
  for (const record of records) for (const key of Object.keys(record)) seen.add(key);
  return [...seen];
}

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Primera columna cuyo nombre normalizado coincide con alguna pista. */
function findColumn(columns: string[], hints: string[]): string | null {
  const normalized = columns.map((c) => ({ original: c, normalized: normalizeName(c) }));
  for (const hint of hints) {
    const exact = normalized.find((c) => c.normalized === hint);
    if (exact) return exact.original;
  }
  for (const hint of hints) {
    const partial = normalized.find((c) => c.normalized.includes(hint));
    if (partial) return partial.original;
  }
  return null;
}

// "id" va primero a propósito: una columna que se llama exactamente "id"
// es el identificador del renglón, mientras que "id_empleado" identifica a
// la persona y se repite (un mismo empleado cobra varias semanas o dos
// conceptos en el mismo periodo). Con el orden anterior, la nómina fija de
// Grupo Loma habría usado id_empleado y los renglones se habrían pisado
// entre sí. El paso de coincidencia exacta corre completo antes del
// parcial, así que un "folio" exacto sigue ganándole a un "id_algo" parcial.
const ID_HINTS = ["id", "idnomina", "idregistro", "noempleado", "numempleado", "numeroempleado", "claveempleado", "idempleado", "folio", "clave", "codigo"];
const EMPLOYEE_HINTS = ["nombreempleado", "nombrecompleto", "empleado", "trabajador", "nombre", "colaborador", "personal"];
const AMOUNT_HINTS = ["netoapagar", "totalapagar", "importetotal", "sueldoneto", "neto", "importe", "total", "monto", "sueldo", "pago", "percepciones"];
const PERIOD_HINTS = ["periodo", "semana", "quincena", "fechapago", "fechafin", "fecha"];
const COST_CENTER_HINTS = ["centrocostos", "centrodecostos", "centrocosto", "obra", "proyecto", "departamento", "area", "sucursal", "empresa"];

export interface FieldGuess {
  idField: string | null;
  employeeField: string | null;
  amountField: string | null;
  periodField: string | null;
  costCenterField: string | null;
}

/**
 * Propone qué columna es cuál. Es solo un punto de partida para no
 * capturar el mapeo desde cero -- se corrige desde la página y ahí queda
 * guardado (o ya viene sembrado, ver la migración de nomina_externa_
 * mapeos para las tres fuentes de Grupo Loma).
 */
export function guessFieldRoles(columns: string[]): FieldGuess {
  return {
    idField: findColumn(columns, ID_HINTS),
    employeeField: findColumn(columns, EMPLOYEE_HINTS),
    amountField: findColumn(columns, AMOUNT_HINTS),
    periodField: findColumn(columns, PERIOD_HINTS),
    costCenterField: findColumn(columns, COST_CENTER_HINTS),
  };
}

/**
 * Importe a centavos. Acepta número o texto con símbolo de moneda y
 * separadores de miles. Cuando aparecen coma y punto, manda el último que
 * aparezca como separador decimal (así "1,234.56" y "1.234,56" dan lo
 * mismo). Con solo comas, se toma como decimal únicamente si le siguen
 * exactamente dos dígitos al final ("12,50"); si no, es separador de
 * miles ("1,234"). Regresa null si no hay un número reconocible.
 */
export function parseAmountCents(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) : null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed === "") return null;

  const negative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith("-");
  let cleaned = trimmed.replace(/[()\s]/g, "").replace(/[^0-9.,-]/g, "");
  cleaned = cleaned.replace(/-/g, "");
  if (cleaned === "") return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    normalized = cleaned.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    const decimals = cleaned.length - lastComma - 1;
    normalized = decimals === 2 && cleaned.indexOf(",") === lastComma ? cleaned.replace(",", ".") : cleaned.split(",").join("");
  } else {
    normalized = cleaned;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) * (negative ? -1 : 1);
}

export function sumAmountCents(records: ExternalRecord[], amountField: string | null): number {
  if (!amountField) return 0;
  let total = 0;
  for (const record of records) total += parseAmountCents(record[amountField]) ?? 0;
  return total;
}

/** Hash estable (FNV-1a) de un objeto, con las llaves ordenadas. */
export function stableHash(record: ExternalRecord): string {
  const canonical = JSON.stringify(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  );
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Identificador estable del renglón dentro de su origen. Se prefiere una
 * columna que se vea de identificador; si no hay, se usa el hash del
 * renglón completo -- así una resincronización no duplica lo que ya
 * estaba, aunque la API no traiga un id propio (caso real: mano de obra de
 * Grupo Loma, donde Id_mo_cat es la referencia al catálogo y se repite
 * entre renglones distintos).
 */
export function recordKey(record: ExternalRecord, idField: string | null): string {
  if (idField) {
    const raw = record[idField];
    if (raw != null && String(raw).trim() !== "") return String(raw).trim();
  }
  return `h:${stableHash(record)}`;
}

export interface NormalizedBatch {
  columns: string[];
  guess: FieldGuess;
  records: { record_key: string; data: ExternalRecord }[];
  totalCents: number;
}

/**
 * Deja la respuesta lista para guardar: renglones con su llave estable,
 * columnas descubiertas y la propuesta de mapeo. `idField` explícito gana
 * sobre la heurística (es el mapeo ya corregido a mano, o sembrado).
 */
export function normalizeBatch(payload: unknown, overrides?: Partial<FieldGuess>): NormalizedBatch {
  const records = extractRecords(payload);
  const columns = collectColumns(records);
  const guess = { ...guessFieldRoles(columns), ...stripUndefined(overrides) };

  const seen = new Set<string>();
  const normalized = records.map((record) => {
    let key = recordKey(record, guess.idField);
    // Dos renglones con el mismo id (un empleado con dos conceptos en el
    // mismo periodo, por ejemplo) no se pisan: se desempata con el hash
    // del renglón.
    if (seen.has(key)) key = `${key}#${stableHash(record)}`;
    seen.add(key);
    return { record_key: key, data: record };
  });

  return { columns, guess, records: normalized, totalCents: sumAmountCents(records, guess.amountField) };
}

function stripUndefined<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
