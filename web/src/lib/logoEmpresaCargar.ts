import { supabase } from "./supabase";
import { logoParaImprimir } from "./logoEmpresa";

// Busca el logo subido de una empresa (por código) para un documento impreso.
// Se pide al imprimir, no se cargan los logos en las listas de empresas.
const cache = new Map<string, Promise<string | null>>();

export function olvidarLogos() {
  cache.clear();
}

export async function logoDeEmpresa(codigo: string | null | undefined): Promise<string | null> {
  const c = (codigo ?? "").trim().toUpperCase();
  if (!c) return null;
  let logo = cache.get(c);
  if (!logo) {
    logo = Promise.resolve(
      supabase
        .from("empresas")
        .select("logo")
        .eq("codigo", c)
        .not("logo", "is", null)
        .limit(1)
        .maybeSingle()
        .then(({ data }) => (data?.logo as string | null) ?? null, () => null),
    );
    cache.set(c, logo);
  }
  return logoParaImprimir(await logo, c, window.location.origin);
}
