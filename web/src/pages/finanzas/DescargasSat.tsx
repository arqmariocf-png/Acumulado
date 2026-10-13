import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";

// Bitácora de la descarga masiva del SAT (13-oct-2026): cada solicitud por
// empresa y tipo, su estado en el SAT y cuántos CFDI se guardaron. Corre sola
// cada hora; "Descargar ahora" adelanta la corrida.

interface Descarga {
  id: string;
  tipo: "emitido" | "recibido";
  fecha_inicial: string;
  fecha_final: string;
  estado: string;
  numero_cfdis: number | null;
  cfdi_guardados: number;
  mensaje: string | null;
  created_at: string;
  updated_at: string;
  empresas: { codigo: string } | null;
}

const ESTADO: Record<string, { texto: string; color: string }> = {
  pendiente: { texto: "por pedir", color: "bg-slate-100 text-slate-600" },
  solicitada: { texto: "pedida al SAT", color: "bg-sky-100 text-sky-800" },
  en_proceso: { texto: "el SAT la prepara", color: "bg-sky-100 text-sky-800" },
  descargada: { texto: "descargada", color: "bg-emerald-100 text-emerald-800" },
  vacia: { texto: "sin CFDI en el periodo", color: "bg-emerald-50 text-emerald-700" },
  error: { texto: "error", color: "bg-red-100 text-red-800" },
  rechazada: { texto: "rechazada por el SAT", color: "bg-red-100 text-red-800" },
  vencida: { texto: "vencida", color: "bg-amber-100 text-amber-800" },
};

const dia = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const hora = (iso: string) => new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function DescargasSat() {
  const qc = useQueryClient();
  const [aviso, setAviso] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["sat-descargas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sat_descargas")
        .select("id, tipo, fecha_inicial, fecha_final, estado, numero_cfdis, cfdi_guardados, mensaje, created_at, updated_at, empresas(codigo)")
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as unknown as Descarga[];
    },
    refetchInterval: 60_000,
  });

  const ahora = useMutation({
    mutationFn: async () => {
      const { data: sesion } = await supabase.auth.getSession();
      const resp = await fetch(urlFuncion("sat-descarga-masiva"), {
        method: "POST",
        headers: { Authorization: `Bearer ${sesion.session?.access_token}`, "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error ?? `Error ${resp.status}`);
      return json as { segundos: number };
    },
    onSuccess: (r) => {
      setAviso(`Listo en ${r.segundos} s. Lo que el SAT aún prepara se baja solo en la siguiente corrida (cada hora).`);
      qc.invalidateQueries({ queryKey: ["sat-descargas"] });
      qc.invalidateQueries({ queryKey: ["sat-efirmas"] });
    },
    onError: (e: Error) => setAviso(e.message),
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Descarga de CFDI del SAT</h2>
          <p className="text-xs text-slate-500">
            Cada hora el sistema pregunta al SAT, baja lo que ya está listo y lo guarda en CFDI (como la carga manual). Una vez al día pide lo nuevo de cada
            empresa. El SAT tarda de minutos a horas en preparar cada solicitud.
          </p>
        </div>
        <button onClick={() => ahora.mutate()} disabled={ahora.isPending} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">
          {ahora.isPending ? "Consultando al SAT…" : "Descargar ahora"}
        </button>
      </div>
      {aviso && <p className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">{aviso}</p>}
      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}
      {data && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">CFDI</th>
                <th className="px-3 py-2">Periodo</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">En el SAT</th>
                <th className="px-3 py-2 text-right">Guardados</th>
                <th className="px-3 py-2">Pedida</th>
                <th className="px-3 py-2">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-slate-500">Todavía no hay solicitudes.</td>
                </tr>
              )}
              {data.map((d) => {
                const e = ESTADO[d.estado] ?? { texto: d.estado, color: "bg-slate-100 text-slate-600" };
                return (
                  <tr key={d.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{d.empresas?.codigo ?? "—"}</td>
                    <td className="px-3 py-2">{d.tipo === "emitido" ? "emitidos" : "recibidos"}</td>
                    <td className="px-3 py-2 text-xs">{dia(d.fecha_inicial)} – {dia(d.fecha_final)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${e.color}`}>{e.texto}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.numero_cfdis ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.cfdi_guardados || "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{hora(d.created_at)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{d.mensaje ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
