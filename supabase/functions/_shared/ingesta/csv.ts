// Parser CSV mínimo (RFC 4180: comillas, comas y saltos de línea dentro de
// campos entrecomillados) sin dependencias externas, para poder correr tanto
// en Deno (edge functions) como en Node (tests).
//
// Decisión de diseño clave: a diferencia de un extractor de texto genérico
// (que puede "saltarse" celdas vacías y correr el resto de los valores una
// posición — el riesgo exacto que SPEC.md sección 2 prohíbe), este parser
// separa por comas de forma posicional: una celda vacía entre dos comas
// produce un string vacío en esa posición, nunca desaparece.

/** Excel en configuración regional es-MX/es-ES exporta CSV con ";" como
 * separador de columnas (porque usa "," como separador decimal) en vez del
 * "," estándar de RFC 4180 -- si el archivo real usa ";", separar solo por
 * "," deja cada fila como una sola columna gigante y ninguna cabecera hace
 * match (visto en producción: "Faltan columnas requeridas: cuenta,
 * fechaPago, saldo" con las tres presentes en el archivo, solo que unidas
 * por ";"). Se detecta con la primera línea, fuera de comillas: el que
 * aparezca más veces gana; ante empate o ambos en cero, "," por default.
 */
function detectarDelimitador(contenido: string): "," | ";" {
  const primeraLinea = contenido.split(/\r\n|\r|\n/, 1)[0] ?? "";
  let comas = 0;
  let puntoYComas = 0;
  let dentroDeComillas = false;
  for (const c of primeraLinea) {
    if (c === '"') {
      dentroDeComillas = !dentroDeComillas;
      continue;
    }
    if (dentroDeComillas) continue;
    if (c === ",") comas++;
    else if (c === ";") puntoYComas++;
  }
  return puntoYComas > comas ? ";" : ",";
}

export function parseCsv(contenido: string, delimitador?: "," | ";"): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let dentroDeComillas = false;
  let i = 0;
  const sep = delimitador ?? detectarDelimitador(contenido);

  // Normaliza saltos de línea de Windows/Mac a \n para no duplicar filas.
  const texto = contenido.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  while (i < texto.length) {
    const c = texto[i];

    if (dentroDeComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        dentroDeComillas = false;
        i++;
        continue;
      }
      campo += c;
      i++;
      continue;
    }

    if (c === '"') {
      dentroDeComillas = true;
      i++;
      continue;
    }
    if (c === sep) {
      fila.push(campo);
      campo = "";
      i++;
      continue;
    }
    if (c === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
      i++;
      continue;
    }
    campo += c;
    i++;
  }

  // Última fila si el archivo no termina con salto de línea.
  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  // Descarta filas totalmente vacías (líneas en blanco al final del archivo).
  return filas.filter((f) => f.some((v) => v.trim() !== ""));
}

/** Convierte filas crudas de CSV a objetos, usando la primera fila como
 * encabezado. Los nombres de encabezado se normalizan (trim + minúsculas)
 * para no depender de mayúsculas/acentos exactos. */
export function filasAObjetos(filas: string[][], normalizarEncabezado: (h: string) => string): Record<string, string>[] {
  if (filas.length === 0) return [];
  const [encabezado, ...resto] = filas;
  const claves = encabezado.map(normalizarEncabezado);
  return resto.map((fila) => {
    const obj: Record<string, string> = {};
    claves.forEach((clave, idx) => {
      // fila[idx] puede ser undefined si la fila trae menos columnas que el
      // encabezado (fila truncada) — se guarda como cadena vacía, nunca se
      // reinterpreta como la siguiente columna.
      obj[clave] = fila[idx] ?? "";
    });
    return obj;
  });
}
