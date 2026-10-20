import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";

// Solicitudes de EPP que mandan supervisores y responsables de obra
// (21-oct-2026). Atender = se vuelve una entrega EPP-… con sus piezas por
// surtir (luego bodega o "Pedir a compras" como cualquier entrega); rechazar
// lleva motivo para quien pidió.

interface SolicitudRh {
  id: string;
  folio: string;
  personal_id: string;
  proyecto_id: string | null;
  solicitante_nombre: string | null;
  notas: string | null;
  created_at: string;
  epp_solicitud_lineas: { id: string; descripcion: string; talla: string | null; cantidad: number }[];
}

interface Props {
  obras: { id: string; nombre: string; empresas: { codigo: string } | null }[];
  nombrePersona: (id: string) => string;
  onAtendida: (mensaje: string) => void;
}

const campo = "rounded border border-slate-300 px-2 py-1 text-sm";

export function SolicitudesEppPorAtender({ obras, nombrePersona, onAtendida }: Props) {
  const qc = useQueryClient();
  const [obraDe, setObraDe] = useState<Record<string, string>>({});
  const [rechazando, setRechazando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["epp-solicitudes-pendientes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("epp_solicitudes")
        .select("id, folio, personal_id, proyecto_id, solicitante_nombre, notas, created_at, epp_solicitud_lineas(id, descripcion, talla, cantidad)")
        .eq("estado", "pendiente")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as SolicitudRh[];
    },
  });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["epp-solicitudes-pendientes"] });
    qc.invalidateQueries({ queryKey: ["epp-asignaciones"] });
  };
  const atender = useMutation({
    mutationFn: async (s: SolicitudRh) => {
      const obra = obraDe[s.id] || s.proyecto_id;
      if (!obra) throw new Error(`Elige la obra a la que se carga la ${s.folio}.`);
      const { error } = await supabase.rpc("fn_epp_atender_solicitud", { p_solicitud: s.id, p_proyecto: obra });
      if (error) throw error;
      return s.folio;
    },
    onSuccess: (folio) => {
      onAtendida(`Solicitud ${folio} atendida: quedó como entrega por surtir abajo. Entrégala de bodega o usa "Pedir a compras".`);
      refrescar();
    },
    onError: (e: Error) => setError(e.message),
  });
  const rechazar = useMutation({
    mutationFn: async (s: SolicitudRh) => {
      const { error } = await supabase.rpc("fn_epp_rechazar_solicitud", { p_solicitud: s.id, p_motivo: motivo });
      if (error) throw error;
      return s.folio;
    },
    onSuccess: (folio) => {
      onAtendida(`Solicitud ${folio} rechazada; quien la pidió ve el motivo.`);
      setRechazando(null);
      setMotivo("");
      refrescar();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!data || data.length === 0) return null;

  return (
    <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
      <h3 className="text-sm font-semibold text-amber-900">Solicitudes por atender ({data.length})</h3>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {data.map((s) => (
        <div key={s.id} className="rounded bg-white p-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono font-semibold">{s.folio}</span>
            <span className="min-w-0 flex-1">
              <b>{nombrePersona(s.personal_id)}</b>
              <span className="text-xs text-slate-500">
                {" "}
                · pidió {s.solicitante_nombre ?? "—"} el {new Date(s.created_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
              </span>
              <span className="block text-xs text-slate-600">
                {s.epp_solicitud_lineas.map((l) => `${l.cantidad} ${l.descripcion}${l.talla ? ` (${l.talla})` : ""}`).join(" · ")}
              </span>
              {s.notas && <span className="block text-xs text-slate-500">Nota: {s.notas}</span>}
            </span>
            <select
              value={obraDe[s.id] ?? s.proyecto_id ?? ""}
              onChange={(e) => setObraDe((o) => ({ ...o, [s.id]: e.target.value }))}
              className={`max-w-[14rem] ${campo}`}
            >
              <option value="">Obra a la que se carga…</option>
              {obras.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                  {o.empresas?.codigo ? ` (${o.empresas.codigo})` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={atender.isPending}
              onClick={() => {
                setError(null);
                atender.mutate(s);
              }}
              className="rounded bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-50"
            >
              Atender
            </button>
            <button type="button" onClick={() => setRechazando(rechazando === s.id ? null : s.id)} className="text-xs text-red-700 underline">
              Rechazar
            </button>
          </div>
          {rechazando === s.id && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (lo ve quien pidió)" className={`min-w-0 flex-1 ${campo}`} />
              <button
                type="button"
                disabled={rechazar.isPending}
                onClick={() => {
                  setError(null);
                  rechazar.mutate(s);
                }}
                className="rounded border border-red-300 bg-white px-3 py-1 text-xs text-red-700 disabled:opacity-50"
              >
                Confirmar rechazo
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
