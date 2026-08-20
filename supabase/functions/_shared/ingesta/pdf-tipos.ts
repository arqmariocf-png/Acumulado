// Tipos compartidos entre pdf-cargador.ts (que hace IO real, importa
// "npm:unpdf") y los parsers puros (pdf-estado-cuenta-bbva.ts, y sus tests).
// Viven en su propio archivo, sin imports, a propósito: si un parser
// importara el tipo directo de pdf-cargador.ts, arrastraría el import
// "npm:unpdf" al cargar el módulo -- Node (que corre los tests con
// `node --test`, no Deno) no sabe resolver ese esquema de import y truena
// aunque el test nunca llame a la función que en verdad lo usa.
export interface ItemPdfPosicionado {
  texto: string;
  /** Coordenada X del borde izquierdo del texto (origen abajo-izquierda, como pdf.js). */
  x0: number;
  /** Coordenada X del borde derecho -- clave para columnas de montos alineadas
   * a la derecha, donde x0 varía según la cantidad de dígitos pero x1 es
   * constante por columna (ver pdf-estado-cuenta-bbva.ts). */
  x1: number;
  y: number;
}
