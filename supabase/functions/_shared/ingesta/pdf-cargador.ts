// Extrae texto de un PDF usando unpdf (envoltura de pdf.js pensada para
// runtimes serverless/edge -- sin dependencia de canvas ni de un DOM real,
// a diferencia de pdfjs-dist "a pelo"). Import vía npm: -- el bundler de
// edge functions de Supabase solo acepta especificadores npm:/jsr:, mismo
// motivo documentado en xlsx-cargador.ts para xlsx.
import { extractText, getDocumentProxy } from "npm:unpdf@1.8.1";
import type { ItemPdfPosicionado } from "./pdf-tipos.ts";

/** Devuelve el texto de cada página por separado (no concatenado) --
 * pdf-estado-cuenta.ts necesita el texto completo unido con saltos de línea
 * para poder ubicar la sección "SALDO INICIAL...SALDO TOTAL", que puede
 * cruzar varias páginas. */
export async function pdfATexto(bytes: Uint8Array): Promise<string> {
  const documento = await getDocumentProxy(bytes);
  const { text } = await extractText(documento, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join("\n");
}

/** Extrae cada "item" de texto de pdf.js con su posición (x0, x1, y), página
 * por página. A diferencia de pdfATexto (que aplana todo a una sola cadena),
 * esto sirve para PDFs donde una columna (ej. Cargos vs Abonos de BBVA) solo
 * se puede identificar de forma confiable por su posición horizontal, no por
 * el orden del texto -- la extracción plana de pdf.js intercala el contenido
 * de una tabla en el orden en que aparece en el stream del PDF, que no
 * siempre es el orden visual por columna. */
export async function pdfAPosiciones(bytes: Uint8Array): Promise<ItemPdfPosicionado[][]> {
  const documento = await getDocumentProxy(bytes);
  const paginas: ItemPdfPosicionado[][] = [];
  for (let p = 1; p <= documento.numPages; p++) {
    const pagina = await documento.getPage(p);
    // deno-lint-ignore no-explicit-any
    const contenido = await (pagina as any).getTextContent();
    const items: ItemPdfPosicionado[] = [];
    // deno-lint-ignore no-explicit-any
    for (const it of contenido.items as any[]) {
      const texto = String(it.str ?? "").trim();
      if (!texto) continue;
      const x0 = it.transform[4];
      items.push({ texto, x0, x1: x0 + (it.width ?? 0), y: it.transform[5] });
    }
    paginas.push(items);
  }
  return paginas;
}
