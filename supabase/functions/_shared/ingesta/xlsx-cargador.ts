// Carga SheetJS (xlsx) para parsear archivos Excel.
//
// INTENTO 1 (revertido): importar la distribución parchada 0.20.3 desde el
// CDN oficial de SheetJS (cdn.sheetjs.com), documentado como el patrón
// correcto para Deno. Falló al desplegar: el bundler de edge functions de
// Supabase rechaza imports desde hosts HTTPS arbitrarios --
// "Cannot import from cdn.sheetjs.com:443" -- solo acepta especificadores
// npm:/jsr:. Confirmado con un intento de deploy real, no es una suposición.
//
// Por eso este archivo usa `npm:xlsx@0.18.5`, que SÍ es un especificador
// permitido, pero es la última versión publicada en el registro de npm y
// tiene CVEs conocidos sin parchear ahí (prototype pollution, CVE-2023-
// 30533, entre otros) -- SheetJS solo distribuye las versiones parchadas
// vía su propio CDN, no vía npm. Mitigación mientras tanto: límite de
// tamaño de archivo en cada función de ingesta (10 MB). Antes de aceptar
// archivos de usuarios no confiables en producción, evaluar: (a) vendorizar
// una copia local de la versión parchada dentro de _shared/ e importarla
// por ruta relativa (el bundler sí acepta imports relativos), o (b) migrar
// a otra librería de parseo de xlsx sin este historial de CVEs.
import * as XLSX from "npm:xlsx@0.18.5";

export { XLSX };

/** Primera hoja únicamente -- usar cuando el archivo solo trae una hoja
 * relevante (estados de cuenta, catálogo OC/OV). */
export function hojaAFilas(bytes: Uint8Array): string[][] {
  const libro = XLSX.read(bytes, { type: "array" });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  return XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: "" }) as string[][];
}

/** Todas las hojas del libro. Necesario para CFDI: un export real de Compac
 * trae la hoja de CFDI normales y una hoja aparte de complementos de pago
 * (RecibosDePago), con columnas distintas -- si solo se lee la primera se
 * pierden todos los complementos de pago. */
export function todasLasHojas(bytes: Uint8Array): { nombre: string; filas: string[][] }[] {
  const libro = XLSX.read(bytes, { type: "array" });
  return libro.SheetNames.map((nombre) => ({
    nombre,
    filas: XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, raw: false, defval: "" }) as string[][],
  }));
}
