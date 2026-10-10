import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { botonPrimario, dinero, fechaHora, type Turno } from "./datos";

interface SaldoCliente {
  empresa_id: string;
  cliente_id: string;
  razon_social: string;
  rfc: string | null;
  cargos: number;
  abonos: number;
  saldo: number;
  linea_credito: number | null;
  dias_credito: number | null;
  credito_autorizado: boolean;
  disponible: number | null;
  primer_cargo: string | null;
}

export function Credito({ empresaId, turno }: { empresaId: string; turno: Turno | null }) {
  const queryClient = useQueryClient();
  const [cliente, setCliente] = useState<SaldoCliente | null>(null);
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState<"efectivo" | "tarjeta" | "transferencia">("transferencia");
  const [referencia, setReferencia] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data: saldos = [] } = useQuery({
    queryKey: ["pv-saldos", empresaId],
    queryFn: async () => {
      let q = supabase.from("v_pv_saldos_clientes").select("*").order("saldo", { ascending: false });
      if (empresaId) q = q.eq("empresa_id", empresaId);
      const { data, error: e } = await q;
      if (e) throw e;
      return (data ?? []) as SaldoCliente[];
    },
  });
  const abonar = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc("fn_pv_abono", {
        p_empresa: cliente!.empresa_id,
        p_cliente: cliente!.cliente_id,
        p_turno: turno?.id ?? null,
        p_monto: Number(monto),
        p_metodo: metodo,
        p_referencia: referencia || null,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setMonto("");
      setReferencia("");
      setCliente(null);
      queryClient.invalidateQueries({ queryKey: ["pv-saldos"] });
      queryClient.invalidateQueries({ queryKey: ["pv-turno"] });
    },
    onError: (e) => setError((e as Error).message),
  });
  const vencido = (s: SaldoCliente) => s.saldo > 0 && s.primer_cargo && s.dias_credito != null && Date.now() - Date.parse(s.primer_cargo) > s.dias_credito * 864e5;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <p className="mb-2 text-xs text-slate-500">
          Solo se vende a crédito a clientes con crédito autorizado por dirección (Legal → Crédito y contratos) y sin rebasar su línea.
        </p>
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2 text-right">Saldo</th>
                <th className="px-3 py-2 text-right">Línea</th>
                <th className="px-3 py-2 text-right">Disponible</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {saldos.map((s) => (
                <tr key={`${s.empresa_id}-${s.cliente_id}`} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">
                    {s.razon_social}
                    {vencido(s) && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-700">vencido</span>}
                    {s.primer_cargo && <span className="block text-[11px] text-slate-400">desde {fechaHora(s.primer_cargo)} · {s.dias_credito ?? "—"} días</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium">{dinero(s.saldo)}</td>
                  <td className="px-3 py-1.5 text-right">{dinero(s.linea_credito)}</td>
                  <td className={`px-3 py-1.5 text-right ${s.disponible != null && s.disponible < 0 ? "text-red-700" : ""}`}>{dinero(s.disponible)}</td>
                  <td className="px-3 py-1.5 text-right">
                    {s.saldo > 0 && (
                      <button type="button" onClick={() => setCliente(s)} className="text-xs text-sky-700 hover:underline">
                        abonar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {saldos.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    Sin ventas a crédito todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {cliente && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <h3 className="text-sm font-semibold">Abono de {cliente.razon_social}</h3>
          <p className="text-xs text-slate-500">Saldo {dinero(cliente.saldo)}</p>
          <div className="mt-2 space-y-2 text-sm">
            <select value={metodo} onChange={(e) => setMetodo(e.target.value as typeof metodo)} className="w-full rounded border border-slate-300 px-2 py-1.5">
              <option value="transferencia">Transferencia</option>
              <option value="efectivo">Efectivo (entra a la caja abierta)</option>
              <option value="tarjeta">Tarjeta</option>
            </select>
            <input type="number" min="0" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Monto" className="w-full rounded border border-slate-300 px-2 py-1.5" />
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Referencia" className="w-full rounded border border-slate-300 px-2 py-1.5" />
            {error && <p className="text-red-700">{error}</p>}
            <button type="button" disabled={!monto || abonar.isPending} onClick={() => abonar.mutate()} className={`${botonPrimario} w-full`}>
              Registrar abono
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
