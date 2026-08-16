// Parser CSV mínimo (RFC 4180: comillas, comas y saltos de línea dentro de
// campos entrecomillados) sin dependencias externas, para poder correr tanto
// en Deno (edge functions) como en Node (tests).
//
// Decisión de diseño clave: a diferencia de un extractor de texto genérico
// (que puede "saltarse" celdas vacías y correr el resto de los valores una
// posición — el riesgo exacto que SPEC.md sección 2 prohíbe), este parser
// separa por comas de forma posicional: una celda vacía entre dos comas
// produce un string vacío en esa posición, nunca desaparece.

export function parseCsv(contenido: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let dentroDeComillas = false;
  let i = 0;

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
    if (c === ",") {
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
