import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { cambiarFechaOSolicitar, esJefeDeTarjeta, resolverSolicitudFecha } from "../../lib/fechaCompromiso";
import type { Tarjeta } from "../../types/database";

// Campo "Fecha compromiso" del panel de tarjeta (Mario, 28-sep-2026): la
// primera fecha se pone libre; después, el jefe la cambia directo y los
// demás la solicitan con motivo. Aquí se ve cuántas veces se ha movido, la
// solicitud pendiente (con Autorizar / Rechazar para el jefe) y el historial.

interface Solicitud {
  id: string;
  fecha_anterior: string | null;
  fecha_nueva: string | null;
  motivo: string | null;
  estado: "pendiente" | "aprobado" | "rechazado";
  comentario: string | null;
  solicitado_por: string;
  resuelto_por: string | null;
  resuelto_en: string | null;
  created_at: string;
}

const campoTexto = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

function fechaCorta(iso: string | null): string {
  return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
}

export function FechaCompromiso({ tarjeta, nombrePorId, onCambio }: { tarjeta: Tarjeta; nombrePorId: Map<string, string>; onCambio: () => void }) {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [propuesta, setPropuesta] = useState("");
  const [motivo, setMotivo] = useState("");
  const [verHistorial, setVerHistorial] = useState(false);

  const solicitudes = useQuery({
    queryKey: ["tarjeta-fecha-solicitudes", tarjeta.id],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("tarjeta_cambios_fecha").select("*").eq("tarjeta_id", tarjeta.id).order("created_at", { ascending: false });
      if (err) throw err;
      return data as Solicitud[];
    },
  });
  const jefe = useQuery({ queryKey: ["tarjeta-es-jefe", tarjeta.id, perfil?.id], queryFn: () => esJefeDeTarjeta(tarjeta.id), enabled: !!perfil });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["tarjeta-fecha-solicitudes", tarjeta.id] });
    onCambio();
  };

  const cambiar = useMutation({
    mutationFn: async (nueva: string | null) => cambiarFechaOSolicitar(tarjeta.id, nueva, () => (motivo.trim() ? motivo.trim() : window.prompt("Escribe el motivo del cambio de fecha para pedir autorización a tu jefe:"))),
    onSuccess: (r) => {
      setError(null);
      if (r === "solicitada") {
        setPropuesta("");
        setMotivo("");
      }
      invalidar();
    },
    onError: (err) => setError((err as Error).message),
  });

  const resolver = useMutation({
    mutationFn: async ({ id, aprobar }: { id: string; aprobar: boolean }) => {
      const comentario = window.prompt(aprobar ? "Comentario (opcional):" : "Motivo del rechazo (opcional):");
      if (comentario === null) return;
      await resolverSolicitudFecha(id, aprobar, comentario);
    },
    onSuccess: () => {
      setError(null);
      invalidar();
    },
    onError: (err) => setError((err as Error).message),
  });

  const pendiente = (solicitudes.data ?? []).find((s) => s.estado === "pendiente");
  const historial = (solicitudes.data ?? []).filter((s) => s.estado !== "pendiente");
  const esJefe = jefe.data === true;
  const sinFecha = !tarjeta.fecha_limite;
  const cambiosN = tarjeta.fecha_cambios ?? 0;

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-700">
        Fecha compromiso
        {cambiosN > 0 && (
          <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${cambiosN >= 3 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`} title="Veces que se ha movido la fecha con autorización">
            movida {cambiosN} {cambiosN === 1 ? "vez" : "veces"}
          </span>
        )}
      </label>

      {sinFecha || esJefe ? (
        // Primera fecha (libre) o jefe inmediato (cambio directo, queda registrado y contado).
        <input type="date" key={tarjeta.fecha_limite ?? "sin-fecha"} defaultValue={tarjeta.fecha_limite ?? ""} onBlur={(e) => e.target.value !== (tarjeta.fecha_limite ?? "") && cambiar.mutate(e.target.value || null)} className={campoTexto} />
      ) : (
        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-800">{fechaCorta(tarjeta.fecha_limite)}</div>
      )}
      {!sinFecha && esJefe && <p className="mt-0.5 text-[11px] text-slate-400">Como jefe puedes cambiarla directo; el cambio queda registrado y contado.</p>}

      {pendiente ? (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs">
          <div className="font-medium text-amber-800">
            Solicitud de cambio: {fechaCorta(pendiente.fecha_anterior)} → {fechaCorta(pendiente.fecha_nueva)}
          </div>
          <div className="text-amber-700">
            {nombrePorId.get(pendiente.solicitado_por) ?? "—"}: {pendiente.motivo}
          </div>
          {esJefe && pendiente.solicitado_por !== perfil?.id ? (
            <div className="mt-1.5 flex gap-2">
              <button onClick={() => resolver.mutate({ id: pendiente.id, aprobar: true })} disabled={resolver.isPending} className="rounded bg-emerald-600 px-2 py-1 text-white hover:bg-emerald-700 disabled:opacity-50">
                Autorizar
              </button>
              <button onClick={() => resolver.mutate({ id: pendiente.id, aprobar: false })} disabled={resolver.isPending} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                Rechazar
              </button>
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-amber-700">Esperando autorización del jefe inmediato.</div>
          )}
        </div>
      ) : (
        !sinFecha &&
        !esJefe && (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-slate-600 underline">Pedir cambio de fecha</summary>
            <div className="mt-1 space-y-1">
              <input type="date" value={propuesta} onChange={(e) => setPropuesta(e.target.value)} className={campoTexto} />
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (obligatorio)" className={campoTexto} />
              <button onClick={() => cambiar.mutate(propuesta || null)} disabled={cambiar.isPending || !propuesta || !motivo.trim()} className="rounded bg-slate-900 px-2 py-1 text-white disabled:opacity-50">
                Enviar solicitud al jefe
              </button>
            </div>
          </details>
        )
      )}

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      {historial.length > 0 && (
        <div className="mt-1">
          <button onClick={() => setVerHistorial((v) => !v)} className="text-[11px] text-slate-400 underline">
            {verHistorial ? "ocultar historial" : `historial de fechas (${historial.length})`}
          </button>
          {verHistorial && (
            <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
              {historial.map((s) => (
                <li key={s.id}>
                  <span className={s.estado === "aprobado" ? "text-emerald-700" : "text-red-700"}>{s.estado}</span> {fechaCorta(s.fecha_anterior)} → {fechaCorta(s.fecha_nueva)} · {nombrePorId.get(s.solicitado_por) ?? "—"}
                  {s.motivo && <> · {s.motivo}</>}
                  {s.resuelto_por && s.resuelto_por !== s.solicitado_por && <> · resolvió {nombrePorId.get(s.resuelto_por) ?? "—"}</>}
                  {s.comentario && <> · "{s.comentario}"</>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
