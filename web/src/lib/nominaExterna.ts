import { supabase, urlFuncion } from "./supabase";
import type { NominaExternaOrigenKey } from "../types/database";

export interface ResultadoSincronizacion {
  origen: NominaExternaOrigenKey;
  ok: boolean;
  renglones?: number;
  totalCentavos?: number;
  error?: string;
}

/** Llama al edge function de sincronización con la sesión del usuario. */
export async function sincronizarNominaExterna(origen?: NominaExternaOrigenKey): Promise<{ resultados: ResultadoSincronizacion[] }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const respuesta = await fetch(urlFuncion("nomina-externa-sincronizar"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(origen ? { origen } : {}),
  });
  const json = await respuesta.json();
  if (!respuesta.ok && respuesta.status !== 207) throw new Error(json.error ?? `Error ${respuesta.status}`);
  return json;
}
