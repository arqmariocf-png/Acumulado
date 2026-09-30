import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { moneda } from "../../lib/saldosEmpresas";

interface ObraImss {
  proyecto_id: string;
  nombre: string;
  empresa: string;
  monto: number | null;
  nota: string | null;
  capturado_por_nombre: string | null;
  capturado_en: string | null;
}

interface Asignado {
  proyecto_id: string;
  tipo: string;
  nombre: string;
  especialidad: string | null;
  cantidad: number;
  unidad: string | null;
  costo_unitario: number;
}

/** Contabilidad (Belén): partida de seguro social de cada obra en costeo.
 * Solo ve el personal y contratistas asignados, no el contrato ni la
 * utilidad (eso es del director general). */
export function SeguroSocialObras() {
  const queryClient = useQueryClient();
  const [aviso, setAviso] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["seguro-social-obras"],
    queryFn: async () => {
      const [obras, personal] = await Promise.all([
        supabase.from("v_costeo_imss_pendiente").select("*").order("nombre"),
        supabase.from("proyecto_costeo_directos").select("proyecto_id, tipo, nombre, especialidad, cantidad, unidad, costo_unitario").order("nombre"),
      ]);
      if (obras.error) throw obras.error;
      if (personal.error) throw personal.error;
      return { obras: (obras.data ?? []) as ObraImss[], personal: (personal.data ?? []) as Asignado[] };
    },
  });

  const guardar = useMutation({
    mutationFn: async ({ proyectoId, monto, nota }: { proyectoId: string; monto: number; nota: string }) => {
      if (!(monto >= 0)) throw new Error("Captura un monto válido.");
      const { error } = await supabase.from("proyecto_costeo_imss").upsert({ proyecto_id: proyectoId, monto, nota: nota.trim() || null }, { onConflict: "proyecto_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      setAviso("Seguro social guardado.");
      queryClient.invalidateQueries({ queryKey: ["seguro-social-obras"] });
    },
    onError: (e) => setAviso((e as Error).message),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Seguro social de obras</h1>
        <p className="text-sm text-slate-500">Calcula la partida de seguro social con el personal asignado a cada obra y captúrala aquí. Dirección la usa para el costeo.</p>
      </div>
      {aviso && <p className="text-sm text-slate-700">{aviso}</p>}
      {(data?.obras ?? []).map((o) => (
        <FilaObra key={o.proyecto_id} obra={o} personal={(data?.personal ?? []).filter((p) => p.proyecto_id === o.proyecto_id)} onGuardar={(monto, nota) => guardar.mutate({ proyectoId: o.proyecto_id, monto, nota })} />
      ))}
      {(data?.obras ?? []).length === 0 && <p className="text-sm text-slate-400">Ninguna obra tiene personal asignado en su costeo todavía.</p>}
    </div>
  );
}

function FilaObra({ obra, personal, onGuardar }: { obra: ObraImss; personal: Asignado[]; onGuardar: (monto: number, nota: string) => void }) {
  const [monto, setMonto] = useState(obra.monto != null ? String(obra.monto) : "");
  const [nota, setNota] = useState(obra.nota ?? "");
  return (
    <section className="rounded border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium text-slate-900">{obra.nombre}</h2>
        <span className="text-xs text-slate-500">
          {obra.empresa}
          {obra.capturado_en ? ` · capturó ${obra.capturado_por_nombre ?? ""} el ${obra.capturado_en.slice(0, 10)}` : " · pendiente"}
        </span>
      </div>
      <ul className="my-2 divide-y divide-slate-100 text-xs">
        {personal.map((p, i) => (
          <li key={i} className="flex flex-wrap gap-2 py-1">
            <span className="font-medium">{p.nombre}</span>
            <span className="text-slate-500">{p.especialidad}</span>
            <span className="text-slate-500">{p.tipo === "contratista" ? "contratista" : "personal"}</span>
            <span className="ml-auto tabular-nums">
              {p.cantidad} {p.unidad ?? ""} × {moneda(Number(p.costo_unitario))}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          Seguro social $
          <input type="number" min="0" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} className="w-32 rounded border border-slate-300 px-2 py-1" />
        </label>
        <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Cómo se calculó (opcional)" className="min-w-[12rem] flex-1 rounded border border-slate-300 px-2 py-1" />
        <button type="button" onClick={() => onGuardar(Number(monto), nota)} className="rounded bg-slate-900 px-3 py-1 font-medium text-white">
          Guardar
        </button>
      </div>
    </section>
  );
}
