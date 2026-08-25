import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Falla rápido y con un mensaje claro en vez de un error críptico de
  // supabase-js más adelante -- esto casi siempre significa que falta
  // copiar .env.example a .env.local con las credenciales del proyecto.
  throw new Error(
    "Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copia web/.env.example a web/.env.local y complétalo.",
  );
}

export const supabase = createClient(url, anonKey);

export function urlFuncion(nombre: string): string {
  return `${url!.replace(/\/$/, "")}/functions/v1/${nombre}`;
}
