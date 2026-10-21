// Logo de cada empresa en los documentos impresos (21-oct-2026, Laura: "en
// empresas falta poder adjuntar una imagen como logo para que las
// cotizaciones y notas salgan personalizadas por empresa"). El logo se sube
// en Catálogos › Empresas y se guarda en empresas.logo como data URL; si una
// empresa no tiene, se usa el de siempre (/logos/<codigo>.png). Puro, con
// pruebas.

/** Tamaño máximo del data URL (la base acepta hasta 400 mil caracteres). */
export const LOGO_MAXIMO = 380_000;
/** Caja en la que se acomoda el logo al subirlo (px). */
export const LOGO_CAJA = { ancho: 600, alto: 240 };

export const TIPOS_LOGO = ["image/png", "image/jpeg", "image/webp"] as const;

/** El data URL que se guarda: png, jpeg o webp y no más grande que el máximo. */
export function logoValido(dataUrl: string | null | undefined): boolean {
  if (!dataUrl) return false;
  return /^data:image\/(png|jpeg|webp);base64,/.test(dataUrl) && dataUrl.length <= LOGO_MAXIMO;
}

/** Medidas para que la imagen quepa en la caja sin deformarse ni agrandarse. */
export function medidasLogo(ancho: number, alto: number, caja = LOGO_CAJA): { ancho: number; alto: number } {
  if (!(ancho > 0) || !(alto > 0)) return { ancho: 0, alto: 0 };
  const escala = Math.min(1, caja.ancho / ancho, caja.alto / alto);
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

/** Lo que va en el <img> del documento: el logo subido o el archivo de siempre. */
export function logoParaImprimir(logo: string | null | undefined, codigo: string | null | undefined, origen: string): string | null {
  if (logoValido(logo)) return logo as string;
  const c = (codigo ?? "").trim().toLowerCase();
  return c ? `${origen}/logos/${c}.png` : null;
}
