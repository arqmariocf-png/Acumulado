import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { puedeAsignarEncargados } from "../../lib/encargadosObra";
import { usePersonasEncargo } from "./EncargadosAdicionales";

// "Asignar obras a una persona" (18-nov-2026, Mario: "agregar a los
// supervisores varias obras para solicitar"): se elige a la persona y se
// palomean las obras activas donde queda como encargada adicional. Es la
// misma tabla que los chips de cada obra (proyecto_encargados).

interface ObraFila {
  id: string;
  nombre: string;
  empresa_id: string;
  responsable_id: string | null;
  comprador_id: string | null;
  empresas: { codigo: string } | null;
}

export function AsignarObras() {
  const { perfil } = useAuth();
  const qc = useQueryClient();
  const asigna = puedeAsignarEncargados(perfil?.rol);
  const [abierto, setAbierto] = useState(false);
  const [persona, setPersona] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data: personas } = usePersonasEncargo(asigna && abierto);
  const { data: obras } = useQuery({
    queryKey: ["obras-para-asignar"],
    enabled: asigna && abierto,
    queryFn: async () => {
      const { data, error: err } = await supabase.from("proyectos").select("id, nombre, empresa_id, responsable_id, comprador_id, empresas(codigo)").eq("activo", true).order("nombre").limit(1000);
      if (err) throw err;
      return (data ?? []) as unknown as ObraFila[];
    },
  });
  const { data: encargos } = useQuery({
    queryKey: ["encargos-de", persona],
    enabled: !!persona,
    queryFn: async () => {
      const { data, error: err } = await supabase.from("proyecto_encargados").select("id, proyecto_id").eq("profile_id", persona);
      if (err) throw err;
      return (data ?? []) as { id: string; proyecto_id: string }[];
    },
  });
  const porObra = useMemo(() => new Map((encargos ?? []).map((e) => [e.proyecto_id, e.id])), [encargos]);
  const cambiar = useMutation({
    mutationFn: async ({ obraId, poner }: { obraId: string; poner: boolean }) => {
      if (poner) {
        const { error: err } = await supabase.from("proyecto_encargados").insert({ proyecto_id: obraId, profile_id: persona });
        if (err) throw err;
      } else {
        const id = porObra.get(obraId);
        if (!id) return;
        const { error: err } = await supabase.from("proyecto_encargados").delete().eq("id", id);
        if (err) throw err;
      }
    },
    onSuccess: (_d, v) => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["encargos-de", persona] });
      qc.invalidateQueries({ queryKey: ["proyecto-encargados", v.obraId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!asigna) return null;
  const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const filtradas = (obras ?? []).filter((o) => !busqueda || sinAcentos(`${o.nombre} ${o.empresas?.codigo ?? ""}`).includes(sinAcentos(busqueda)));
  const quien = personas?.find((p) => p.id === persona);

  return (
    <section className="mb-4 rounded border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-slate-800">Asignar obras a una persona</h2>
        <button type="button" onClick={() => setAbierto((v) => !v)} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
          {abierto ? "Cerrar" : "Abrir"}
        </button>
        <span className="text-xs text-slate-500">Quien queda encargado ve la obra, pide requisiciones y herramienta en ella y confirma lo recibido.</span>
      </div>
      {abierto && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={persona} onChange={(e) => setPersona(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="">Elige a la persona…</option>
              {(personas ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre ?? "(sin nombre)"} · {p.rol}
                  {p.empresa_codigo ? ` · ${p.empresa_codigo}` : ""}
                </option>
              ))}
            </select>
            {persona && <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar obra…" className="rounded border border-slate-300 px-2 py-1 text-sm" />}
            {persona && <span className="text-xs text-slate-500">{porObra.size} obra(s) asignadas a {quien?.nombre ?? "esta persona"}</span>}
          </div>
          {error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
          {persona && (
            <ul className="grid max-h-80 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {filtradas.map((o) => {
                const fija = o.responsable_id === persona || o.comprador_id === persona;
                const marcada = fija || porObra.has(o.id);
                return (
                  <li key={o.id}>
                    <label className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${marcada ? "bg-emerald-50" : "hover:bg-slate-50"}`}>
                      <input type="checkbox" checked={marcada} disabled={fija || cambiar.isPending} onChange={(e) => cambiar.mutate({ obraId: o.id, poner: e.target.checked })} />
                      <span className="text-slate-400">{o.empresas?.codigo}</span>
                      <span className="text-slate-800">{o.nombre}</span>
                      {fija && <span className="text-slate-400">(responsable o comprador)</span>}
                    </label>
                  </li>
                );
              })}
              {filtradas.length === 0 && <li className="px-2 py-1 text-xs text-slate-400">Sin obras con ese nombre.</li>}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
