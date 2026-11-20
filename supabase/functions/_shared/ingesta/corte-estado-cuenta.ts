// Hasta qué fecha llega un estado de cuenta (19-nov-2026, Mario: "Mallas y
// Clavos sigue sin actualizarse el saldo en finanzas"). Delia subió seis
// veces los estados "al 17 de noviembre" de MCC y ninguno traía movimientos
// después del 13 (fin de semana + festivo): la carga decía "0 nuevos" y la
// fecha del saldo se quedaba en el 13/11, así que Finanzas marcaba "falta
// subir lo más reciente" aunque ya estaba subido. Este helper lee del texto
// del PDF la fecha de corte / fin de periodo / fecha de generación para
// registrar en la cuenta hasta qué día está al día, haya o no movimientos.
// Puro, sin IO; cubre los textos reales de BBVA (oficial y app), Banorte
// (mensual y "Detalle de Movimientos"), Santander (mensual y "Consulta de
// Movimientos") y BanBajío (clásico y portal Conecta).

const MESES: Record<string, number> = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, OCT: 10, NOV: 11, DIC: 12, JAN: 1, APR: 4, AUG: 8, DEC: 12 };

function numeroMes(texto: string): number | null {
  const limpio = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (/^\d{1,2}$/.test(limpio)) {
    const n = Number(limpio);
    return n >= 1 && n <= 12 ? n : null;
  }
  return MESES[limpio.slice(0, 3)] ?? null;
}

function iso(dia: string, mes: string, anio: string): string | null {
  const d = Number(dia);
  const m = numeroMes(mes);
  const a = Number(anio);
  if (!m || d < 1 || d > 31 || a < 2000 || a > 2100) return null;
  const fecha = new Date(Date.UTC(a, m - 1, d));
  if (fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d) return null;
  return fecha.toISOString().slice(0, 10);
}

// Fin de periodo o fecha de corte declarados por el banco.
const RE_FIN_PERIODO: RegExp[] = [
  // BBVA "DEL 01/07/2026 AL 31/07/2026" y Santander consulta "Periodo: 03/08/2026 al 31/08/2026".
  /\d{1,2}\/\d{1,2}\/\d{4}\s+al\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/gi,
  // BBVA "Fecha de Corte 31/07/2026" y Banorte "Fecha de corte 31/Octubre/2026".
  /Fecha de Corte:?\s+(\d{1,2})\/(\d{1,2}|[A-Za-zÀ-ÿ]+)\/(\d{4})/gi,
  // Santander "PERIODO DEL 01-JUL-2026 AL 31-JUL-2026" y Conecta BanBajío "Fechas 01-Ago-2026 al 31-Ago-2026".
  /\d{1,2}-[A-Za-zÀ-ÿ]{3,}-\d{4}\s+al\s+(\d{1,2})-([A-Za-zÀ-ÿ]{3,})-(\d{4})/gi,
  // Santander "CORTE AL 31-JUL-2026".
  /CORTE AL\s+(\d{1,2})-([A-Za-zÀ-ÿ]{3,})-(\d{4})/gi,
  // BanBajío clásico "FECHA DE CORTE 31 JULIO 2026" y "PERIODO: 1 DE JULIO AL 31 DE JULIO DE 2026".
  /FECHA DE CORTE:?\s+(\d{1,2})\s+(?:DE\s+)?([A-Za-zÀ-ÿ]+)\s+(?:DE\s+)?(\d{4})/gi,
  /\bAL\s+(\d{1,2})\s+DE\s+([A-Za-zÀ-ÿ]+)\s+DE\s+(\d{4})/gi,
  // Banorte "Detalle de Movimientos": "Fecha Inicial: 01/08/2026 Final: 25/08/2026".
  /Final:\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/gi,
];

// Cuándo se generó el documento (los exports del portal traen el periodo
// completo del mes aunque se bajen a mitad: la cobertura real es el día en
// que se generó).
const RE_GENERADO: RegExp[] = [
  // Conecta BanBajío "Generado el … 25-Ago-2026, 17:25:53 horas".
  /(\d{1,2})-([A-Za-zÀ-ÿ]{3,})-(\d{4}),\s+\d{2}:\d{2}(?::\d{2})?\s+horas/gi,
  // Banorte Enlace "Fecha Último Acceso: 25/08/2026 11:15 a. m.".
  /Fecha Último Acceso:\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/gi,
  // Exports de portal: "Fecha de consulta: 20/11/2026", "Fecha y hora de impresión 20/11/2026 17:25".
  /Fecha (?:y hora )?de (?:consulta|impresi[oó]n|emisi[oó]n|generaci[oó]n|descarga):?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/gi,
];

function fechasDe(texto: string, patrones: RegExp[]): string[] {
  const fechas: string[] = [];
  for (const re of patrones) {
    re.lastIndex = 0;
    for (const m of texto.matchAll(re)) {
      const f = iso(m[1], m[2], m[3]);
      if (f) fechas.push(f);
    }
  }
  return fechas;
}

/** Fecha (ISO) hasta la que llega el estado de cuenta según su propio texto,
 * o null si el documento no la declara. Si trae fecha de generación, manda
 * la menor entre esa y el fin del periodo. */
export function extraerCorteEstadoCuenta(textoCompleto: string): string | null {
  const texto = textoCompleto.replace(/\s+/g, " ");
  const fines = fechasDe(texto, RE_FIN_PERIODO);
  const generados = fechasDe(texto, RE_GENERADO);
  const candidatos: string[] = [];
  if (fines.length) candidatos.push(fines.reduce((a, b) => (a < b ? a : b)));
  if (generados.length) candidatos.push(generados.reduce((a, b) => (a < b ? a : b)));
  if (!candidatos.length) return null;
  return candidatos.reduce((a, b) => (a < b ? a : b));
}

// Nombre del archivo como respaldo (20-nov-2026, Mario: "con Delia marca como
// pendiente el estado de cuenta… porque muchas veces no hay movimientos
// posteriores"): los exports diarios de BBVA ("ESTADO DE CUENTA AL 20 DE
// NOVIEMBRE.pdf") no declaran corte en el texto y la cuenta quedaba "al"
// último movimiento (17/11) aunque el archivo era del 20. Delia nombra los
// archivos "AL <día> DE <mes>" (también "AL 19 DE NOV BALKEN"): se toma esa
// fecha, con el año de hoy (o el anterior si quedaría en el futuro).
const RE_NOMBRE_AL = /\bAL\s+(\d{1,2})\s+(?:DE\s+)?([A-Za-zÀ-ÿ]{3,})(?:\s+(?:DE\s+)?(\d{4}))?/i;
const RE_NOMBRE_ISO = /(\d{4})[-_.](\d{2})[-_.](\d{2})/;
const RE_NOMBRE_DMY = /\b(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})\b/;

/** Fecha (ISO) que dice el NOMBRE del archivo, o null. `hoy` da el año
 * cuando el nombre no lo trae. */
export function corteDesdeNombreArchivo(nombre: string, hoy: string): string | null {
  const limpio = (nombre ?? "").replace(/\.[A-Za-z0-9]+$/, "").replace(/[_]+/g, " ");
  const al = limpio.match(RE_NOMBRE_AL);
  if (al) {
    const anioHoy = hoy.slice(0, 4);
    const conAnio = iso(al[1], al[2], al[3] ?? anioHoy);
    if (conAnio) {
      if (al[3] || conAnio <= hoy) return conAnio;
      return iso(al[1], al[2], String(Number(anioHoy) - 1));
    }
  }
  const isoM = limpio.match(RE_NOMBRE_ISO);
  if (isoM) return iso(isoM[3], isoM[2], isoM[1]);
  const dmy = limpio.match(RE_NOMBRE_DMY);
  if (dmy) return iso(dmy[1], dmy[2], dmy[3]);
  return null;
}

/** Corte a registrar a partir del texto del PDF y del nombre del archivo:
 * la mayor de las dos (el nombre es lo que la persona declara; el texto, lo
 * que declara el banco), acotada como `acotarCorte`. */
export function corteDeArchivo(textoCompleto: string, nombreArchivo: string, ultimoMovimientoArchivo: string | null, hoy: string): string | null {
  const doc = extraerCorteEstadoCuenta(textoCompleto);
  const nom = corteDesdeNombreArchivo(nombreArchivo, hoy);
  const candidatos = [doc, nom].filter((x): x is string => !!x && x <= hoy);
  const mejor = candidatos.length ? candidatos.reduce((a, b) => (a > b ? a : b)) : null;
  return acotarCorte(mejor, ultimoMovimientoArchivo, hoy);
}

/** Fecha que se registra en la cuenta: la del documento (o, si no la trae,
 * la del último movimiento que venía en el archivo), nunca después de hoy ni
 * antes del último movimiento del archivo. */
export function acotarCorte(corteDocumento: string | null, ultimoMovimientoArchivo: string | null, hoy: string): string | null {
  let c = corteDocumento ?? ultimoMovimientoArchivo;
  if (!c) return null;
  if (c > hoy) c = hoy;
  if (ultimoMovimientoArchivo && ultimoMovimientoArchivo > c) c = ultimoMovimientoArchivo;
  return c;
}

/** Día de hoy en México (UTC-6 fijo, como el resto de los trabajos). */
export function hoyMexicoIso(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);
}
