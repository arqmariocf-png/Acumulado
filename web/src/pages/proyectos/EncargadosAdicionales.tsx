import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { puedeAsignarEncargados } from "../../lib/encargadosObra";

// Encargados adicionales de una obra (18-nov-2026, Mario: "agregar a los
// supervisores varias obras para solicitar"): además del responsable y el
// comprador, cualquier número de personas que ven la obra, piden
// requisiciones y herramienta en ella y confirman lo recibido. Asignan
// admin, corporativo, dirección y empresa (policy proyecto_encargados_write).

export interface PersonaEncargo {
  id: string;
  nombre: string | null;
  rol: string;
  empresa_codigo: string | null;
}

export function usePersonasEncargo(habilitado: boolean) {
  return useQuery({
    queryKey: ["encargados-personas"],
    enabled: habilitado,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_encargados_personas");
      if (error) throw error;
      return (data ?? []) as PersonaEncargo[];
    },
  });
}

export function useEncargadosObra(proyectoId: string | undefined) {
  return useQuery({
    queryKey: ["proyecto-encargados", proyectoId],
    enabled: !!proyectoId,
    queryFn: async () => {
      const { data, error } = await supabase.from("proyecto_encargados").select("id, profile_id").eq("proyecto_id", proyectoId!);
      if (error) throw error;
      return (data ?? []) as { id: string; profile_id: string }[];
    },
  });
}

export function EncargadosAdicionales({ proyectoId }: { proyectoId: string }) {
  const { perfil } = useAuth();
  const qc = useQueryClient();
  const asigna = puedeAsignarEncargados(perfil?.rol);
  const { data: personas } = usePersonasEncargo(asigna);
  const { data: encargados } = useEncargadosObra(proyectoId);
  const [error, setError] = useState<string | null>(null);
  const [elegido, setElegido] = useState("");
  const nombreDe = (id: string) => personas?.find((p) => p.id === id);

  const agregar = useMutation({
    mutationFn: async (profileId: string) => {
      const { error: err } = await supabase.from("proyecto_encargados").insert({ proyecto_id: proyectoId, profile_id: profileId });
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      setElegido("");
      qc.invalidateQueries({ queryKey: ["proyecto-encargados", proyectoId] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const quitar = useMutation({
    mutationFn: async (id: string) => {
      const { error: err } = await supabase.from("proyecto_encargados").delete().eq("id", id);
      if (err) throw err;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proyecto-encargados", proyectoId] }),
    onError: (e: Error) => setError(e.message),
  });

  if (!asigna && !encargados?.length) return null;
  const yaEstan = new Set((encargados ?? []).map((e) => e.profile_id));

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
      <span className="font-medium text-slate-700">Encargados adicionales:</span>
      {(encargados ?? []).map((e) => {
        const p = nombreDe(e.profile_id);
        return (
          <span key={e.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-800">
            {p ? `${p.nombre ?? "(sin nombre)"} · ${p.rol}` : asigna ? "…" : "encargado"}
            {asigna && (
              <button type="button" onClick={() => quitar.mutate(e.id)} className="text-slate-400 hover:text-red-600" title="Quitar de la obra">
                ×
              </button>
            )}
          </span>
        );
      })}
      {!encargados?.length && <span className="text-slate-400">ninguno</span>}
      {asigna && (
        <select
          value={elegido}
          disabled={agregar.isPending}
          onChange={(e) => {
            setElegido(e.target.value);
            if (e.target.value) agregar.mutate(e.target.value);
          }}
          className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
        >
          <option value="">+ agregar persona…</option>
          {(personas ?? [])
            .filter((p) => !yaEstan.has(p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre ?? "(sin nombre)"} · {p.rol}
                {p.empresa_codigo ? ` · ${p.empresa_codigo}` : ""}
              </option>
            ))}
        </select>
      )}
      {error && <span className="text-red-600">{error}</span>}
    </div>
  );
}
