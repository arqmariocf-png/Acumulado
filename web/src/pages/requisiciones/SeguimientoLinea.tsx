import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import {
  ETIQUETA_EVENTO,
  cantidadSugerida,
  validarEvento,
  type EventoLinea,
  type Seguimiento,
  type TipoEvento,
} from "../../lib/seguimientoLinea";

const TIPOS: TipoEvento[] = [
  "pedido",
  "entregado",
  "cambio",
  "devolucion",
  "comentario",
];

const AYUDA: Record<TipoEvento, string> = {
  pedido:
    "Cuánto ya se pidió al proveedor (aunque se haya comprado por fuera).",
  entregado: "Cuánto llegó a obra o a bodega.",
  cambio:
    "Piezas que se regresan para que las repongan: quedan pendientes de entregar otra vez.",
  devolucion:
    "Piezas que se regresan y NO se reponen: bajan lo pedido y lo entregado.",
  comentario: "Una nota para todos los que siguen esta requisición.",
};

/** Panel de seguimiento de un renglón: marcar pedido / entregado,
 * devolución o cambio de piezas y comentarios, con la bitácora abajo
 * (Jonathan y Mario, 29-sep-2026). */
export function SeguimientoLinea({
  lineaId,
  requisicionId,
  solicitado,
  unidad,
  seguimiento,
  eventos,
  tipoInicial,
  onCerrar,
}: {
  lineaId: string;
  requisicionId: string;
  solicitado: number;
  unidad: string;
  seguimiento: Seguimiento;
  eventos: EventoLinea[];
  tipoInicial: TipoEvento;
  onCerrar: () => void;
}) {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<TipoEvento>(tipoInicial);
  const [cantidad, setCantidad] = useState(() =>
    tipoInicial === "comentario"
      ? ""
      : String(cantidadSugerida(tipoInicial, solicitado, seguimiento)),
  );
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);

  const elegir = (t: TipoEvento) => {
    setTipo(t);
    setError(null);
    setCantidad(
      t === "comentario"
        ? ""
        : String(cantidadSugerida(t, solicitado, seguimiento)),
    );
  };

  const refrescar = () => {
    queryClient.invalidateQueries({
      queryKey: ["requisicion-detalle", requisicionId],
    });
    queryClient.invalidateQueries({ queryKey: ["requisiciones"] });
  };

  const guardar = useMutation({
    mutationFn: async () => {
      const c = tipo === "comentario" ? null : Number(cantidad);
      const problema = validarEvento(tipo, c, nota, seguimiento);
      if (problema) throw new Error(problema);
      const { error: err } = await supabase
        .from("requisicion_linea_eventos")
        .insert({
          requisicion_linea_id: lineaId,
          tipo,
          cantidad: c,
          nota: nota.trim() || null,
          created_by: perfil?.id,
        });
      if (err) throw err;
    },
    onSuccess: () => {
      setNota("");
      setError(null);
      refrescar();
      onCerrar();
    },
    onError: (e: Error) => setError(e.message),
  });

  const borrar = useMutation({
    mutationFn: async (id: string) => {
      if (!window.confirm("¿Borrar esta marca?")) return;
      const { error: err } = await supabase
        .from("requisicion_linea_eventos")
        .delete()
        .eq("id", id);
      if (err) throw err;
    },
    onSuccess: refrescar,
    onError: (e: Error) => setError(e.message),
  });

  const puedeBorrar = (e: EventoLinea) =>
    e.created_by === perfil?.id ||
    perfil?.rol === "admin" ||
    perfil?.rol === "corporativo";

  return (
    <div className="rounded border border-sky-200 bg-white px-3 py-2">
      <div className="flex flex-wrap gap-1">
        {TIPOS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => elegir(t)}
            className={`rounded-full px-2.5 py-1 text-xs ${tipo === t ? "bg-sky-700 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-100"}`}
          >
            {ETIQUETA_EVENTO[t]}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{AYUDA[tipo]}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          guardar.mutate();
        }}
        className="mt-2 flex flex-wrap items-center gap-2"
      >
        {tipo !== "comentario" && (
          <span className="inline-flex items-center gap-1 text-xs">
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-xs"
              aria-label="Cantidad"
            />
            {unidad}
          </span>
        )}
        <input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder={
            tipo === "comentario"
              ? "Comentario…"
              : tipo === "cambio" || tipo === "devolucion"
                ? "Motivo (obligatorio)…"
                : "Nota (opcional): proveedor, remisión…"
          }
          className="min-w-[12rem] flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
        />
        <button
          type="submit"
          disabled={guardar.isPending}
          className="rounded bg-sky-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {guardar.isPending
            ? "Guardando…"
            : `Guardar ${ETIQUETA_EVENTO[tipo].toLowerCase()}`}
        </button>
        <button
          type="button"
          onClick={onCerrar}
          className="text-xs text-slate-500 underline"
        >
          Cerrar
        </button>
      </form>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      {eventos.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-[11px] text-slate-600">
          {[...eventos].reverse().map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-1.5">
              <span className="text-slate-400">
                {new Date(e.created_at).toLocaleString("es-MX", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className="font-medium text-slate-800">
                {ETIQUETA_EVENTO[e.tipo]}
              </span>
              {e.cantidad != null && (
                <span className="tabular-nums">
                  {e.cantidad} {unidad}
                </span>
              )}
              {e.nota && <span className="text-slate-700">· {e.nota}</span>}
              <span className="text-slate-400">
                · {e.created_by_nombre ?? "—"}
              </span>
              {puedeBorrar(e) && (
                <button
                  type="button"
                  onClick={() => borrar.mutate(e.id)}
                  className="text-red-600 underline"
                >
                  borrar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
