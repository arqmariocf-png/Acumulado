import { supabase } from "./supabase";

/** Convierte la respuesta fallida de un edge function en un Error legible.
 * Un 401 casi siempre es una sesión muerta: el token sigue en el navegador
 * pero Supabase ya no la reconoce (caso real Christian, 21-sep-2026: cambió
 * su contraseña desde el celular y eso invalidó la sesión que tenía abierta
 * en la computadora; la pantalla se veía conectada y "Subir" respondía "No
 * autenticado"). En ese caso se cierra la sesión local para que la app
 * mande a entrar de nuevo, en vez de dejar al usuario atorado. */
export async function errorDeFuncion(respuesta: Response, json?: { error?: string } | null): Promise<Error> {
  if (respuesta.status === 401) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Si el signOut falla igual se muestra el mensaje; el usuario recarga y entra.
    }
    return new Error("Tu sesión ya no es válida (por ejemplo, cambiaste tu contraseña en otro dispositivo). Vuelve a entrar.");
  }
  return new Error(json?.error ?? `Error ${respuesta.status}`);
}
