// Carga SheetJS (xlsx) desde el CDN oficial, no desde npm.
//
// El paquete `xlsx` publicado en el registro de npm quedó congelado en la
// versión 0.18.5, que tiene CVEs conocidos sin parchear ahí (prototype
// pollution al leer un archivo .xlsx malicioso -- CVE-2023-30533, entre
// otros). SheetJS dejó de publicar versiones nuevas en npm; la distribución
// parchada (0.20.3 al momento de escribir esto) solo vive en su propio CDN.
// Este es el patrón de importación oficial para Deno según la documentación
// de SheetJS (docs.sheetjs.com/docs/getting-started/installation/deno).
//
// No se pudo verificar la conectividad a cdn.sheetjs.com desde este entorno
// de desarrollo (la política de red del sandbox la bloquea, igual que
// bloqueó Dropbox) -- confirmar que resuelve correctamente en el primer
// deploy real a Supabase.
//
// @deno-types="https://cdn.sheetjs.com/xlsx-0.20.3/package/types/index.d.ts"
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

export { XLSX };

export function hojaAFilas(bytes: Uint8Array): string[][] {
  const libro = XLSX.read(bytes, { type: "array" });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  return XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: "" }) as string[][];
}
