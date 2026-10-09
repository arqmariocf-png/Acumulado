import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useEmpresasAlcance } from "./SelectorEmpresa";

// Alta manual de una OC con su folio real mientras el backoffice no responde
// (Laura, 9-oct-2026). Queda en "Por autorizar"; cuando el backoffice vuelva,
// la sincronización la reconoce por el folio y no la duplica.

function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const FORMAS = ["Transferencia electrónica de fondos", "Efectivo", "Tarjeta de débito", "Tarjeta de crédito"];

export function AltaOcManual() {
  const qc = useQueryClient();
  const { data: empresas } = useEmpresasAlcance();
  const [abierto, setAbierto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const alta = useMutation({
    mutationFn: async (fd: FormData) => {
      const total = Number(String(fd.get("total") ?? "").replace(/[^0-9.]/g, ""));
      const { error } = await supabase.rpc("fn_oc_alta_manual", {
        p_empresa: fd.get("empresa_id"),
        p_folio: String(fd.get("folio") ?? ""),
        p_proveedor: String(fd.get("proveedor") ?? ""),
        p_total: total,
        p_fecha: String(fd.get("fecha") ?? "") || hoyIso(),
        p_proyecto: String(fd.get("proyecto") ?? "") || null,
        p_forma_pago: String(fd.get("forma_pago") ?? "") || null,
      });
      if (error) throw error;
      return String(fd.get("folio"));
    },
    onSuccess: (folio) => {
      setAviso(`OC ${folio} dada de alta. Ya aparece en "Por autorizar" para autorizarla y programar su pago.`);
      qc.invalidateQueries({ queryKey: ["oc-por-autorizar"] });
      qc.invalidateQueries({ queryKey: ["oc-pagos"] });
      qc.invalidateQueries({ queryKey: ["pagos-programados"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    const form = e.currentTarget;
    alta.mutate(new FormData(form), { onSuccess: () => form.reset() });
  }

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
        + Dar de alta OC a mano
      </button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mb-4 grid w-full grid-cols-1 gap-2 rounded border border-sky-200 bg-sky-50 p-3 text-sm sm:grid-cols-4">
      <p className="text-xs text-slate-600 sm:col-span-4">
        Para las OC que todavía no llegan del backoffice. Usa el <b>folio real</b>: cuando el backoffice vuelva, la reconoce y no se duplica. Queda en "Por autorizar".
      </p>
      <label className="text-xs text-slate-600">
        Empresa
        <select name="empresa_id" required className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">Elige…</option>
          {empresas?.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-slate-600">
        Folio de la OC
        <input name="folio" required inputMode="numeric" placeholder="41178" className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs text-slate-600 sm:col-span-2">
        Proveedor
        <input name="proveedor" required className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs text-slate-600">
        Total (con IVA)
        <input name="total" required inputMode="decimal" placeholder="0.00" className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs text-slate-600">
        Fecha de la OC
        <input name="fecha" type="date" defaultValue={hoyIso()} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs text-slate-600">
        Forma de pago
        <select name="forma_pago" defaultValue={FORMAS[0]} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
          {FORMAS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-slate-600">
        Obra / proyecto (opcional)
        <input name="proyecto" className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </label>
      <div className="flex items-center gap-3 sm:col-span-4">
        <button disabled={alta.isPending} className="rounded bg-slate-900 px-4 py-1.5 font-medium text-white disabled:opacity-50">
          {alta.isPending ? "Guardando…" : "Dar de alta"}
        </button>
        <button type="button" onClick={() => setAbierto(false)} className="text-xs underline">
          cerrar
        </button>
        {aviso && <span className="text-xs text-emerald-700">{aviso}</span>}
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </form>
  );
}
