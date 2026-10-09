// Borradores de formularios (Mario, 9-oct-2026: "cuando cambian de ventana
// se pierden los cambios llenados en el formulario"). En el celular el
// navegador puede descartar la pestaña en segundo plano y al volver la
// recarga: lo capturado en un <form> se respalda en sessionStorage (vive con
// la pestaña, aun tras recargar) y se devuelve al regresar.
//
// Reglas puras aquí (con pruebas); el componente BorradorFormularios las
// aplica al DOM.

export interface CampoDescrito {
  tag: string;
  type?: string | null;
  name?: string | null;
  id?: string | null;
  placeholder?: string | null;
  ariaLabel?: string | null;
}

export interface Borrador {
  guardado: number;
  campos: Record<string, string>;
}

export const VIGENCIA_BORRADOR_MS = 12 * 60 * 60 * 1000;

const TIPOS_FUERA = new Set(["password", "file", "hidden", "submit", "button", "reset", "image", "search"]);
const NOMBRES_SENSIBLES = /tarjeta|card|cvv|cvc|contrase|password|token|secret/i;

/** ¿Se respalda este campo? Nunca contraseñas, archivos ni datos de tarjeta. */
export function campoRespaldable(c: CampoDescrito): boolean {
  const tipo = (c.type ?? "").toLowerCase();
  if (TIPOS_FUERA.has(tipo)) return false;
  const texto = [c.name, c.id, c.placeholder, c.ariaLabel].filter(Boolean).join(" ");
  if (NOMBRES_SENSIBLES.test(texto)) return false;
  return ["input", "select", "textarea"].includes(c.tag.toLowerCase());
}

/** Descriptor estable de un campo dentro de su formulario. */
export function descriptorCampo(c: CampoDescrito): string {
  return `${c.tag.toLowerCase()}|${c.name || c.id || c.placeholder || c.ariaLabel || "?"}`;
}

/** Firma de un formulario por sus campos (no por su posición en la
 * pantalla, que cambia cuando aparecen otros paneles). */
export function firmaFormulario(descriptores: string[]): string {
  let h = 5381;
  for (const ch of descriptores.join("\n")) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

export function claveBorrador(ruta: string, firma: string): string {
  return `borrador:${ruta}:${firma}`;
}

/** Borrador vigente (no vacío y de menos de 12 h) o null. */
export function borradorVigente(crudo: string | null, ahora: number): Borrador | null {
  if (!crudo) return null;
  try {
    const b = JSON.parse(crudo) as Borrador;
    if (!b || typeof b.guardado !== "number" || !b.campos) return null;
    if (ahora - b.guardado > VIGENCIA_BORRADOR_MS) return null;
    return Object.keys(b.campos).length > 0 ? b : null;
  } catch {
    return null;
  }
}
