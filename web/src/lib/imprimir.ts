import { modoImpresion } from "./modoImpresion";

/** Abre un HTML en una pestaña nueva lista para imprimir o guardar como PDF.
 *
 * En iPhone/iPad se abre como URL blob en vez de document.write(): en Safari
 * de iPhone el document.write de un documento grande (tabla + QR en SVG)
 * dejaba la pantalla congelada (Mario, 24-sep-2026). En computadora se
 * escribe el HTML directo en la pestaña: Safari de la Mac perdía la liga blob
 * ("Error de WebKitBlobResource 1", 22-oct-2026). Si ya se abrió una ventana
 * con abrirVentanaImpresion() durante el clic, se usa esa; si no, se abre una
 * nueva. Regresa false si el navegador bloqueó la ventana. Separado de
 * documentosRh.ts porque usa window (DOM) y aquel módulo también se compila
 * para las pruebas de node. */
export function abrirParaImprimir(html: string, ventana?: Window | null): boolean {
  const modo = modoImpresion(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0);
  if (modo === "escribir") {
    const destino = ventana && !ventana.closed ? ventana : window.open("", "_blank");
    if (!destino) return false;
    try {
      destino.document.open();
      destino.document.write(html);
      destino.document.close();
      return true;
    } catch {
      // Si no se puede escribir en la pestaña, se intenta con la liga blob.
    }
  }
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  if (ventana && !ventana.closed) {
    ventana.location.replace(url);
    return true;
  }
  const nueva = window.open(url, "_blank");
  return !!nueva;
}

/** Abre la pestaña vacía DURANTE el clic (antes de cualquier await): los
 * navegadores móviles solo permiten abrir ventanas dentro del gesto del
 * usuario, y cargar los datos primero hacía que se bloqueara. Regresa null si
 * no se pudo (fuera de un gesto, bloqueador de ventanas). */
export function abrirVentanaImpresion(): Window | null {
  try {
    const v = window.open("", "_blank");
    if (v) {
      v.document.title = "Generando documento…";
    }
    return v;
  } catch {
    return null;
  }
}

/** Cierra la pestaña previa si la carga del documento falló, para no dejar
 * una ventana en blanco abierta. */
export function cerrarVentanaImpresion(ventana: Window | null | undefined): void {
  try {
    if (ventana && !ventana.closed) ventana.close();
  } catch {
    // nada
  }
}
