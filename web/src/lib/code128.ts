// Código de barras Code 128 (juego B: letras, números y signos imprimibles)
// en SVG, sin dependencias: el ticket del punto de venta lleva su folio para
// que almacén lo escanee al despachar (Mario, 10-oct-2026: "con código de
// barras para cobrar y para entregar al cliente").

/** Anchos barra/espacio de cada símbolo (0-102 datos, 103-105 inicio, 106 fin). */
export const PATRONES_128 = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const INICIO_B = 104;
const FIN = 106;

/** Valores del juego B para un texto (ASCII 32-126); lanza error con otros caracteres. */
export function valoresCode128B(texto: string): number[] {
  const valores: number[] = [];
  for (const ch of texto) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`Carácter no válido para el código de barras: "${ch}"`);
    valores.push(c - 32);
  }
  return valores;
}

/** Dígito de control: (inicio + Σ valor × posición) mod 103. */
export function controlCode128(valores: number[]): number {
  return valores.reduce((s, v, i) => s + v * (i + 1), INICIO_B) % 103;
}

/** Secuencia completa de anchos (barra, espacio, barra…) con inicio, control y fin. */
export function anchosCode128(texto: string): number[] {
  const valores = valoresCode128B(texto);
  const simbolos = [INICIO_B, ...valores, controlCode128(valores), FIN];
  return simbolos.flatMap((s) => PATRONES_128[s].split("").map(Number));
}

/** SVG del código de barras con zona libre de 10 módulos a cada lado y el texto abajo. */
export function svgCode128(texto: string, opciones: { modulo?: number; alto?: number; conTexto?: boolean } = {}): string {
  const modulo = opciones.modulo ?? 2;
  const alto = opciones.alto ?? 50;
  const anchos = anchosCode128(texto);
  const zona = 10 * modulo;
  let x = zona;
  const barras: string[] = [];
  anchos.forEach((w, i) => {
    if (i % 2 === 0) barras.push(`<rect x="${x}" y="0" width="${w * modulo}" height="${alto}"/>`);
    x += w * modulo;
  });
  const ancho = x + zona;
  const textoAlto = opciones.conTexto === false ? 0 : 14;
  const etiqueta =
    textoAlto > 0
      ? `<text x="${ancho / 2}" y="${alto + 12}" font-family="monospace" font-size="12" text-anchor="middle">${texto.replace(/[<&>]/g, "")}</text>`
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto + textoAlto}" viewBox="0 0 ${ancho} ${alto + textoAlto}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${barras.join("")}</g>${etiqueta}</svg>`;
}
