import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { errorDeFuncion } from "../../lib/funciones";
import { ETIQUETA_MARCA, SIMBOLO_MARCA, type TipoMarca } from "../Checador";

interface MarcaChecador {
  id: string;
  profile_id: string;
  nombre: string;
  tipo: TipoMarca;
  created_at: string;
  lat: number | null;
  lng: number | null;
  precision_m: number | null;
  tiene_foto: boolean;
}

/** Marcas del checador con evidencia (foto + GPS) de los últimos días,
 * para que RH valide asistencia. La foto se abre con un signed URL de
 * checador-marcar; el mapa es Google Maps con la coordenada. */
export function MarcasChecador({ titulo = "Marcas del checador con foto y ubicación" }: { titulo?: string }) {
  const [dias, setDias] = useState(3);
  const { data: marcas, isLoading } = useQuery({
    queryKey: ["rh-marcas-checador", dias],
    queryFn: async () => {
      const desde = new Date();
      desde.setDate(desde.getDate() - dias);
      desde.setHours(0, 0, 0, 0);
      const { data, error } = await supabase.from("v_checador_marcas").select("*").gte("created_at", desde.toISOString()).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data as MarcaChecador[];
    },
  });

  async function verFoto(id: string) {
    const { data: sessionData } = await supabase.auth.getSession();
    const respuesta = await fetch(`${urlFuncion("checador-marcar")}?registroId=${id}`, {
      headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
    });
    const json = await respuesta.json();
    if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
    window.open(json.url, "_blank");
  }

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">{titulo}</h3>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className="rounded border border-slate-300 px-2 py-1 text-xs">
          <option value={1}>Hoy</option>
          <option value={3}>3 días</option>
          <option value={7}>7 días</option>
          <option value={14}>14 días</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Persona</th>
              <th className="px-3 py-2">Marca</th>
              <th className="px-3 py-2">Cuándo</th>
              <th className="px-3 py-2">Ubicación</th>
              <th className="px-3 py-2">Foto</th>
            </tr>
          </thead>
          <tbody>
            {marcas?.map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{m.nombre}</td>
                <td className="px-3 py-2">{SIMBOLO_MARCA[m.tipo]} {ETIQUETA_MARCA[m.tipo]}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                  {new Date(m.created_at).toLocaleString("es-MX", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="px-3 py-2">
                  {m.lat != null && m.lng != null ? (
                    <a href={`https://maps.google.com/?q=${m.lat},${m.lng}`} target="_blank" rel="noreferrer" className="text-slate-700 hover:underline">
                      ver mapa{m.precision_m != null ? ` (±${Math.round(m.precision_m)} m)` : ""}
                    </a>
                  ) : (
                    <span className="text-slate-300">sin ubicación</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {m.tiene_foto ? (
                    <button type="button" onClick={() => verFoto(m.id).catch((e) => alert((e as Error).message))} className="text-slate-700 hover:underline">
                      ver foto
                    </button>
                  ) : (
                    <span className="text-slate-300">sin foto</span>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && marcas?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                  Sin marcas en este periodo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-slate-400">Las marcas anteriores al 21-sep-2026 no traen foto ni ubicación; desde esa fecha son obligatorias para marcar.</p>
    </div>
  );
}

