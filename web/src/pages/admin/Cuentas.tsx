import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import type { CuentaBancaria, Empresa } from "../../types/database";

type CuentaFila = Pick<CuentaBancaria, "id" | "empresa_id" | "banco" | "ultimos_4" | "alias" | "ajuste_saldo" | "ajuste_nota"> & {
  empresas: Pick<Empresa, "nombre"> | null;
};

function aNumeroOCero(texto: string): number {
  const n = Number(texto.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

// Admin de ajuste de saldo por cuenta (caso real, 3-sep-2026: Aceros cuenta
// BBVA 5859 y Constructora cuentas BanBajío 8954 / BBVA 4940 / BBVA 9954,
// todas con una diferencia fija contra el saldo real del banco). El ajuste
// es una corrección MANUAL que se guarda tal cual en cuentas_bancarias
// (ajuste_saldo/ajuste_nota) -- nunca se recalcula solo, así que el reporte
// de saldos (pestaña "Saldos") siempre muestra el mismo número hasta que
// alguien lo cambie aquí a propósito. La nota es lo que evita tener que
// reinvestigar cada vez de qué meses viene la diferencia.
export function Cuentas() {
  const queryClient = useQueryClient();
  const [busqueda, setBusqueda] = useState("");

  const { data: cuentas, isLoading } = useQuery({
    queryKey: ["admin-cuentas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cuentas_bancarias")
        .select("id, empresa_id, banco, ultimos_4, alias, ajuste_saldo, ajuste_nota, empresas(nombre)")
        .eq("activo", true)
        .order("empresa_id");
      if (error) throw error;
      return data as unknown as CuentaFila[];
    },
  });

  const cuentasOrdenadas = useMemo(() => {
    return [...(cuentas ?? [])].sort((a, b) => {
      const empresaCmp = (a.empresas?.nombre ?? "").localeCompare(b.empresas?.nombre ?? "", "es");
      if (empresaCmp !== 0) return empresaCmp;
      return `${a.banco} ${a.ultimos_4}`.localeCompare(`${b.banco} ${b.ultimos_4}`, "es");
    });
  }, [cuentas]);

  const cuentasFiltradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return cuentasOrdenadas;
    return cuentasOrdenadas.filter(
      (c) =>
        (c.empresas?.nombre ?? "").toLowerCase().includes(q) ||
        c.banco.toLowerCase().includes(q) ||
        c.ultimos_4.includes(q) ||
        (c.alias ?? "").toLowerCase().includes(q),
    );
  }, [cuentasOrdenadas, busqueda]);

  const actualizar = useMutation({
    mutationFn: async ({ id, ajuste_saldo, ajuste_nota }: { id: string; ajuste_saldo?: number; ajuste_nota?: string | null }) => {
      const { error } = await supabase.from("cuentas_bancarias").update({ ajuste_saldo, ajuste_nota }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-cuentas"] }),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        El ajuste es una corrección manual fija que se suma al saldo que calcula el sistema para llegar al saldo real del
        banco -- no se recalcula solo, queda igual hasta que lo cambies aquí. Aparece junto al saldo de cada cuenta en el
        reporte de la pestaña "Saldos" (sección 1), con la nota impresa debajo para no tener que reinvestigar de qué
        meses viene.
      </p>

      <input
        type="text"
        placeholder="Buscar por empresa, banco o últimos 4…"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        className="mb-3 w-full max-w-xs rounded border border-slate-300 px-3 py-2 text-sm"
      />

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Empresa</th>
              <th className="px-2 py-2">Cuenta</th>
              <th className="px-2 py-2">Ajuste</th>
              <th className="px-2 py-2">Nota (de dónde viene)</th>
            </tr>
          </thead>
          <tbody>
            {cuentasFiltradas.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="max-w-[160px] truncate px-2 py-2" title={c.empresas?.nombre ?? ""}>
                  {c.empresas?.nombre}
                </td>
                <td className="whitespace-nowrap px-2 py-2">
                  {c.banco} ····{c.ultimos_4}
                  {c.alias && <span className="text-xs text-slate-400"> ({c.alias})</span>}
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    key={c.ajuste_saldo}
                    defaultValue={c.ajuste_saldo}
                    onBlur={(e) => {
                      const valor = aNumeroOCero(e.target.value);
                      if (valor !== c.ajuste_saldo) actualizar.mutate({ id: c.id, ajuste_saldo: valor });
                    }}
                    className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    key={c.ajuste_nota ?? ""}
                    defaultValue={c.ajuste_nota ?? ""}
                    placeholder="ej. comisión no capturada, jul-ago 2026"
                    onBlur={(e) => {
                      const valor = e.target.value.trim() || null;
                      if (valor !== (c.ajuste_nota ?? null)) actualizar.mutate({ id: c.id, ajuste_nota: valor });
                    }}
                    className="w-full min-w-[240px] rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
