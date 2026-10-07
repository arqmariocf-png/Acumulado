import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { etiquetaSinFactura, palabraClaveSugerida } from "../lib/sinFactura";

// Panel para marcar un movimiento "sin factura" con su motivo (Mario,
// 7-oct-2026, correcciones de Laura). Opcional: dejarlo como regla para que
// los siguientes estados de cuenta con ese concepto salgan solos.

interface Props {
  movimientoId: string;
  concepto: string | null;
  facturaActual: string | null;
  onListo: (mensaje: string) => void;
  onCancelar: () => void;
}

const OTRO = "__otro__";

export function MarcarSinFactura({ movimientoId, concepto, facturaActual, onListo, onCancelar }: Props) {
  const qc = useQueryClient();
  const { data: etiquetas } = useQuery({
    queryKey: ["etiquetas-sin-factura"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("reglas_clasificacion").select("etiqueta").eq("activo", true);
      if (error) throw error;
      return [...new Set((data ?? []).map((r) => r.etiqueta as string))].sort((a, b) => a.localeCompare(b, "es"));
    },
  });
  const inicial = facturaActual && /^N\s*\/\s*A/i.test(facturaActual) ? facturaActual : "";
  const [eleccion, setEleccion] = useState(inicial);
  const [otro, setOtro] = useState("");
  const [comoRegla, setComoRegla] = useState(true);
  const [clave, setClave] = useState(palabraClaveSugerida(concepto));
  const [error, setError] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: async () => {
      const etiqueta = etiquetaSinFactura(eleccion === OTRO ? otro : eleccion);
      if (!etiqueta) throw new Error("Elige o escribe el motivo.");
      const palabra = comoRegla ? clave.trim() : "";
      if (comoRegla && palabra.length < 4) throw new Error("La palabra del concepto debe tener al menos 4 letras.");
      const { data, error } = await supabase.rpc("fn_movimientos_sin_factura", {
        p_ids: [movimientoId],
        p_etiqueta: etiqueta,
        p_palabra_clave: palabra || null,
      });
      if (error) throw error;
      return data as { etiqueta: string; marcados: number; regla_nueva: boolean; por_regla: number };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["movimientos"] });
      qc.invalidateQueries({ queryKey: ["etiquetas-sin-factura"] });
      const extra = r.por_regla > 0 ? ` y ${r.por_regla} movimiento${r.por_regla > 1 ? "s" : ""} más con el mismo concepto` : "";
      const regla = r.regla_nueva ? " Los siguientes estados de cuenta con ese concepto saldrán solos." : "";
      onListo(`Marcado como ${r.etiqueta}${extra}.${regla}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    guardar.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2 rounded bg-sky-50 p-3 text-sm">
      <label className="text-xs text-slate-600">
        Motivo (no lleva factura)
        <select value={eleccion} onChange={(e) => setEleccion(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">Elige…</option>
          {(etiquetas ?? []).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value={OTRO}>Otro motivo…</option>
        </select>
      </label>
      {eleccion === OTRO && (
        <label className="text-xs text-slate-600">
          Escribe el motivo
          <input value={otro} onChange={(e) => setOtro(e.target.value)} placeholder="PAGO A CREDITO" className="mt-1 block w-48 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
      )}
      <label className="flex items-center gap-1.5 text-xs text-slate-700">
        <input type="checkbox" checked={comoRegla} onChange={(e) => setComoRegla(e.target.checked)} />
        Siempre que el concepto diga
      </label>
      {comoRegla && <input value={clave} onChange={(e) => setClave(e.target.value.toUpperCase())} className="w-56 rounded border border-slate-300 px-2 py-1.5 text-sm" />}
      <button disabled={guardar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
        {guardar.isPending ? "Guardando…" : "Guardar"}
      </button>
      <button type="button" onClick={onCancelar} className="text-xs text-slate-600 underline">
        Cancelar
      </button>
      {error && <p className="w-full text-xs text-red-700">{error}</p>}
    </form>
  );
}
