import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { columnaHecha, esColumnaHecha, puedeCerrarTarjeta, resolverCierre, solicitarCierre } from "../../lib/cierreTarjeta";
import type { Tarjeta, TableroColumna } from "../../types/database";

// Candado para terminar la tarea (Mario, 5-nov-2026): en el panel de la
// tarjeta se ve si hay una solicitud pendiente de "dar por terminada" (con
// Autorizar / Rechazar para el jefe), el botón "Pedir terminar" para quien no
// puede cerrarla directo, y quién la terminó y quién lo autorizó.

interface Solicitud {
  id: string;
  nota: string | null;
  estado: "pendiente" | "aprobado" | "rechazado";
  comentario: string | null;
  solicitado_por: string;
  solicitante_nombre: string | null;
  resuelto_por: string | null;
  resuelto_por_nombre: string | null;
  resuelto_en: string | null;
  created_at: string;
}

const fechaHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

export function CierreTarjeta({ tarjeta, columnas, nombrePorId, onCambio }: { tarjeta: Tarjeta; columnas: TableroColumna[]; nombrePorId: Map<string, string>; onCambio: () => void }) {
  const { perfil, soloConsulta } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const idHecha = columnaHecha(columnas);
  const ultima = columnas.find((c) => c.id === idHecha);
  const enHecho = esColumnaHecha(columnas, tarjeta.columna_id);

  const solicitudes = useQuery({
    queryKey: ["tarjeta-cierres", tarjeta.id],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("tarjeta_cierres").select("*").eq("tarjeta_id", tarjeta.id).order("created_at", { ascending: false });
      if (err) throw err;
      return data as Solicitud[];
    },
  });
  const jefe = useQuery({ queryKey: ["tarjeta-puede-cerrar", tarjeta.id, perfil?.id], queryFn: () => puedeCerrarTarjeta(tarjeta.id), enabled: !!perfil });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["tarjeta-cierres", tarjeta.id] });
    queryClient.invalidateQueries({ queryKey: ["cierres-pendientes"] });
    onCambio();
  };

  const pedir = useMutation({
    mutationFn: () => solicitarCierre(tarjeta.id, nota.trim() || null),
    onSuccess: () => {
      setError(null);
      setNota("");
      invalidar();
    },
    onError: (err) => setError((err as Error).message),
  });
  const resolver = useMutation({
    mutationFn: async ({ id, aprobar }: { id: string; aprobar: boolean }) => {
      const comentario = window.prompt(aprobar ? "Comentario (opcional):" : "Motivo del rechazo (opcional):");
      if (comentario === null) return;
      await resolverCierre(id, aprobar, comentario);
    },
    onSuccess: () => {
      setError(null);
      invalidar();
    },
    onError: (err) => setError((err as Error).message),
  });

  const pendiente = (solicitudes.data ?? []).find((s) => s.estado === "pendiente");
  const historial = (solicitudes.data ?? []).filter((s) => s.estado !== "pendiente");
  const puedeCerrar = jefe.data === true;

  return (
    <div className="col-span-2">
      <label className="mb-1 block text-xs font-medium text-slate-700">Terminar la tarea</label>
      {enHecho ? (
        <p className="text-xs text-slate-600">
          Terminada{tarjeta.terminada_por ? ` por ${nombrePorId.get(tarjeta.terminada_por) ?? "—"}` : ""}
          {tarjeta.terminada_autorizada_por && tarjeta.terminada_autorizada_por !== tarjeta.terminada_por ? ` · autorizó ${nombrePorId.get(tarjeta.terminada_autorizada_por) ?? "—"}` : ""}
          {tarjeta.terminada_en ? ` · ${fechaHora(tarjeta.terminada_en)}` : ""}
        </p>
      ) : pendiente ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs">
          <div className="font-medium text-amber-800">
            {pendiente.solicitante_nombre ?? nombrePorId.get(pendiente.solicitado_por) ?? "—"} pidió darla por terminada · {fechaHora(pendiente.created_at)}
          </div>
          {pendiente.nota && <div className="text-amber-700">{pendiente.nota}</div>}
          {puedeCerrar && pendiente.solicitado_por !== perfil?.id && !soloConsulta ? (
            <div className="mt-1.5 flex gap-2">
              <button onClick={() => resolver.mutate({ id: pendiente.id, aprobar: true })} disabled={resolver.isPending} className="rounded bg-emerald-600 px-2 py-1 text-white hover:bg-emerald-700 disabled:opacity-50">
                Autorizar y pasar a {ultima?.nombre ?? "Hecho"}
              </button>
              <button onClick={() => resolver.mutate({ id: pendiente.id, aprobar: false })} disabled={resolver.isPending} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                Rechazar
              </button>
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-amber-700">Esperando autorización del jefe inmediato.</div>
          )}
        </div>
      ) : puedeCerrar ? (
        <p className="text-[11px] text-slate-400">Como jefe puedes pasarla a {ultima?.nombre ?? "Hecho"} directo desde la columna.</p>
      ) : (
        !soloConsulta && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota de lo que hiciste (opcional)" className="min-w-[180px] flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm" />
            <button onClick={() => pedir.mutate()} disabled={pedir.isPending} className="rounded bg-slate-900 px-2.5 py-1.5 font-medium text-white disabled:opacity-50">
              Pedir terminar
            </button>
            <span className="w-full text-[11px] text-slate-400">Tu jefe recibe el aviso y la pasa a {ultima?.nombre ?? "Hecho"}.</span>
          </div>
        )
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {historial.length > 0 && (
        <details className="mt-1 text-[11px] text-slate-500">
          <summary className="cursor-pointer text-slate-400 underline">historial de cierres ({historial.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {historial.map((s) => (
              <li key={s.id}>
                <span className={s.estado === "aprobado" ? "text-emerald-700" : "text-red-700"}>{s.estado === "aprobado" ? "autorizado" : "rechazado"}</span> · pidió {s.solicitante_nombre ?? nombrePorId.get(s.solicitado_por) ?? "—"}
                {s.nota && <> · {s.nota}</>}
                {s.resuelto_por && <> · resolvió {s.resuelto_por_nombre ?? nombrePorId.get(s.resuelto_por) ?? "—"} {fechaHora(s.resuelto_en)}</>}
                {s.comentario && <> · "{s.comentario}"</>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
