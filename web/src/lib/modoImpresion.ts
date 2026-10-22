// Cómo se abre un documento para imprimir según el dispositivo (22-oct-2026,
// Mario: Safari de la Mac mostraba "No se pudo completar la operación (Error de
// WebKitBlobResource 1)"). En iPhone/iPad se usa una URL blob porque
// document.write de un documento grande congelaba la pantalla (24-sep-2026);
// en computadora se escribe el HTML directo en la pestaña: no depende de que
// la liga blob siga viva (Safari la pierde si la pestaña de origen se recarga o
// se cierra). Puro, con pruebas.

export type ModoImpresion = "blob" | "escribir";

export function esIos(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  // iPad con iPadOS 13+ se presenta como Mac, pero con pantalla táctil.
  return platform === "MacIntel" && maxTouchPoints > 1;
}

export function modoImpresion(userAgent: string, platform: string, maxTouchPoints: number): ModoImpresion {
  return esIos(userAgent, platform, maxTouchPoints) ? "blob" : "escribir";
}
