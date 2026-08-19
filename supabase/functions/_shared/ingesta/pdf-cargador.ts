// Extrae texto de un PDF usando unpdf (envoltura de pdf.js pensada para
// runtimes serverless/edge -- sin dependencia de canvas ni de un DOM real,
// a diferencia de pdfjs-dist "a pelo"). Import vía npm: -- el bundler de
// edge functions de Supabase solo acepta especificadores npm:/jsr:, mismo
// motivo documentado en xlsx-cargador.ts para xlsx.
import { extractText, getDocumentProxy } from "npm:unpdf@1.8.1";

/** Devuelve el texto de cada página por separado (no concatenado) --
 * pdf-estado-cuenta.ts necesita el texto completo unido con saltos de línea
 * para poder ubicar la sección "SALDO INICIAL...SALDO TOTAL", que puede
 * cruzar varias páginas. */
export async function pdfATexto(bytes: Uint8Array): Promise<string> {
  const documento = await getDocumentProxy(bytes);
  const { text } = await extractText(documento, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join("\n");
}
