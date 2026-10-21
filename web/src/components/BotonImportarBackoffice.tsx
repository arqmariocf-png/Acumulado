import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

// "Importar del backoffice" en los catálogos de clientes e items (Laura,
// 21-oct-2026). Llama la función que da de alta solo lo que falta; repetirla
// no duplica.
export function BotonImportarBackoffice({ funcion, que, invalidar }: { funcion: "fn_clientes_importar_backoffice" | "fn_items_importar_backoffice"; que: string; invalidar: string[] }) {
  const qc = useQueryClient();
  const [aviso, setAviso] = useState<string | null>(null);
  const importar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(funcion);
      if (error) throw error;
      return Number((data as { nuevos?: number } | null)?.nuevos ?? 0);
    },
    onSuccess: (n) => {
      setAviso(n ? `${n} ${que} nuevos del backoffice.` : `No hay ${que} nuevos en el backoffice.`);
      for (const k of invalidar) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e: Error) => setAviso(e.message),
  });
  return (
    <span className="flex items-center gap-2">
      {aviso && <span className="text-xs text-slate-600">{aviso}</span>}
      <button
        type="button"
        disabled={importar.isPending}
        onClick={() => {
          setAviso(null);
          importar.mutate();
        }}
        className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50"
        title="Da de alta lo que aparece en las órdenes del backoffice y todavía no está en este catálogo"
      >
        {importar.isPending ? "Importando…" : "Importar del backoffice"}
      </button>
    </span>
  );
}
