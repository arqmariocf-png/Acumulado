import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { TarjetaAnalisis } from "./TarjetaAnalisis";
import type { PuCosteo } from "../../types/database";

/**
 * El consultable: lo único que un supervisor puede bajar en PDF como precio
 * bueno. La vista filtra por etapa, no por permisos -- RLS ya limitó las filas
 * a las obras de cada quien.
 */
function usePublicados() {
  return useQuery({
    queryKey: ["pu-publicados"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_pu_publicados").select("*").order("codigo").limit(300);
      if (error) throw error;
      return data as PuCosteo[];
    },
  });
}

export function Publicados() {
  const { data, isLoading, error } = usePublicados();
  const [busqueda, setBusqueda] = useState("");

  const q = busqueda.trim().toLowerCase();
  const filtrados = data?.filter(
    (p) => !q || `${p.codigo} ${p.concepto} ${p.proyecto_nombre ?? ""}`.toLowerCase().includes(q),
  );

  return (
    <div>
      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar concepto o clave…"
        className="mb-4 w-full max-w-md rounded border border-slate-300 px-2 py-1.5 text-sm"
      />

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error: {(error as Error).message}</p>}

      <div className="grid gap-3">
        {filtrados?.map((pu) => <TarjetaAnalisis key={pu.analisis_id} pu={pu} />)}
      </div>

      {filtrados?.length === 0 && (
        <p className="py-12 text-center text-sm text-slate-400">
          {q ? `Nada coincide con “${busqueda}”.` : "Aún no hay precios unitarios publicados."}
        </p>
      )}
    </div>
  );
}
