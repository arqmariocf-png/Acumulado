/** Abre un HTML en una pestaña nueva lista para imprimir o guardar como PDF.
 * Si el navegador bloquea la ventana, regresa false para que la pantalla
 * avise. Separado de documentosRh.ts porque usa window (DOM) y aquel módulo
 * también se compila para las pruebas de node. */
export function abrirParaImprimir(html: string): boolean {
  const ventana = window.open("", "_blank");
  if (!ventana) return false;
  ventana.document.open();
  ventana.document.write(html);
  ventana.document.close();
  return true;
}
