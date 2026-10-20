// Respaldo del sistema en Dropbox (21-oct-2026): lo que la pantalla de
// conexión necesita sin red. Puro, con pruebas.

export const RUTA_RESPALDO_DEFAULT = "/Respaldo Acumulado";

/** Página de Dropbox donde Mario autoriza la app; al aceptar, Dropbox muestra un código. */
export function urlAutorizacion(appKey: string): string {
  const p = new URLSearchParams({ client_id: appKey.trim(), response_type: "code", token_access_type: "offline" });
  return `https://www.dropbox.com/oauth2/authorize?${p.toString()}`;
}

export function revisarConexion(appKey: string, appSecret: string, codigo: string, ruta: string): string | null {
  if (!/^[a-z0-9]{10,20}$/i.test(appKey.trim())) return "La App key es una clave de 10 a 20 letras y números (Dropbox → tu app → Settings).";
  if (!/^[a-z0-9]{10,20}$/i.test(appSecret.trim())) return "El App secret está junto a la App key; da \"Show\" para copiarlo.";
  if (codigo.trim().length < 20) return "Pega el código completo que te mostró Dropbox al dar \"Permitir\".";
  if (!ruta.trim().startsWith("/")) return "La carpeta empieza con / (por ejemplo /Respaldo Acumulado).";
  return null;
}

export function tamano(bytes: number | null | undefined): string {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

