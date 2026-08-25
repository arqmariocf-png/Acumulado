import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { PerfilFiscalMensual, PerfilFiscalParametros } from "../types/database";

// Perfil fiscal: replica el criterio de ISR/IVA del papel de trabajo contable
// real (ver supabase/migrations/20260825030000_perfil_fiscal.sql para las
// fórmulas exactas y las limitaciones documentadas -- ingresos cobrados se
// aproxima con facturado, IVA acreditable se estima del total de CFDI
// recibidos). Los parámetros (coeficiente de utilidad, tasa ISR, pérdidas
// fiscales) los captura el área contable a mano, no se infieren.

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function formatoMoneda(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function formatoPorcentaje(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function useEmpresas() {
  return useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (error) throw error;
      return data;
    },
  });
}

export function PerfilFiscal() {
  const { perfil, veTodasLasEmpresas } = useAuth();
  const queryClient = useQueryClient();
  const { data: empresas } = useEmpresas();
  const puedeEditarParametros = perfil?.rol === "corporativo" || perfil?.rol === "admin";

  const [empresaId, setEmpresaId] = useState<string>("");
  const [anio, setAnio] = useState<number>(new Date().getFullYear());

  const empresaSeleccionada = empresaId || (!veTodasLasEmpresas ? perfil?.empresa_id ?? "" : "");

  const { data: parametros, isLoading: cargandoParametros } = useQuery({
    queryKey: ["perfil-fiscal-parametros", empresaSeleccionada, anio],
    enabled: !!empresaSeleccionada,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("perfil_fiscal_parametros")
        .select("*")
        .eq("empresa_id", empresaSeleccionada)
        .eq("anio", anio)
        .maybeSingle();
      if (error) throw error;
      return data as PerfilFiscalParametros | null;
    },
  });

  const { data: mensual, isLoading: cargandoMensual } = useQuery({
    queryKey: ["perfil-fiscal-mensual", empresaSeleccionada, anio],
    enabled: !!empresaSeleccionada && !!parametros,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_perfil_fiscal_mensual")
        .select("*")
        .eq("empresa_id", empresaSeleccionada)
        .eq("anio", anio)
        .order("mes");
      if (error) throw error;
      return data as PerfilFiscalMensual[];
    },
  });

  const guardarParametros = useMutation({
    mutationFn: async (valores: {
      coeficiente_utilidad: number;
      tasa_isr: number;
      tasa_iva: number;
      perdidas_fiscales_inicio_anio: number;
    }) => {
      const { error } = await supabase
        .from("perfil_fiscal_parametros")
        .upsert(
          { empresa_id: empresaSeleccionada, anio, ...valores, updated_by: perfil?.id },
          { onConflict: "empresa_id,anio" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["perfil-fiscal-parametros", empresaSeleccionada, anio] });
      queryClient.invalidateQueries({ queryKey: ["perfil-fiscal-mensual", empresaSeleccionada, anio] });
    },
  });

  function onSubmitParametros(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    guardarParametros.mutate({
      coeficiente_utilidad: Number(form.get("coeficiente_utilidad")) / 100,
      tasa_isr: Number(form.get("tasa_isr")) / 100,
      tasa_iva: Number(form.get("tasa_iva")) / 100,
      perdidas_fiscales_inicio_anio: Number(form.get("perdidas_fiscales_inicio_anio")) || 0,
    });
  }

  const anios = useMemo(() => {
    const actual = new Date().getFullYear();
    return [actual - 1, actual, actual + 1];
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Perfil fiscal</h1>
      <p className="mb-4 max-w-3xl text-sm text-slate-500">
        Cálculo de ISR (devengado, coeficiente de utilidad acumulado) e IVA (flujo de efectivo) replicando el
        criterio del papel de trabajo contable de la empresa.
      </p>

      <div className="mb-4 max-w-3xl rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <strong>Aproximaciones de esta primera versión:</strong> "Ingresos cobrados" (para IVA) se toma igual a lo
        facturado del mes, porque todavía no capturamos fecha real de cobro por CFDI. "IVA acreditable" se estima
        extrayendo el 16% del total de CFDI recibidos del mes, sin distinguir gastos exentos. Verifíquenlo contra el
        papel de trabajo antes de usarlo para presentar declaraciones.
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-3">
        {veTodasLasEmpresas && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Empresa</label>
            <select
              value={empresaSeleccionada}
              onChange={(e) => setEmpresaId(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">— Selecciona —</option>
              {empresas?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Año</label>
          <select
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value))}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            {anios.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!empresaSeleccionada && <p className="text-sm text-slate-500">Selecciona una empresa para continuar.</p>}

      {empresaSeleccionada && cargandoParametros && <p className="text-sm text-slate-500">Cargando…</p>}

      {empresaSeleccionada && !cargandoParametros && !parametros && !puedeEditarParametros && (
        <p className="text-sm text-slate-500">
          Todavía no hay parámetros fiscales capturados para {anio}. Pide a un usuario corporativo/admin que los
          capture.
        </p>
      )}

      {empresaSeleccionada && !cargandoParametros && (!parametros || puedeEditarParametros) && (
        <form
          onSubmit={onSubmitParametros}
          className="mb-6 max-w-3xl rounded border border-slate-200 bg-white p-4"
        >
          <p className="mb-3 text-sm font-semibold text-slate-700">
            Parámetros fiscales {anio} {!parametros && <span className="font-normal text-amber-600">(sin capturar)</span>}
          </p>
          {!puedeEditarParametros && parametros && (
            <p className="mb-3 text-xs text-slate-500">Solo lectura -- corporativo/admin captura estos valores.</p>
          )}
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Coeficiente de utilidad (%)</label>
              <input
                name="coeficiente_utilidad"
                type="number"
                step="0.0001"
                defaultValue={parametros ? (parametros.coeficiente_utilidad * 100).toFixed(4) : ""}
                disabled={!puedeEditarParametros}
                required
                className="w-32 rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Tasa ISR (%)</label>
              <input
                name="tasa_isr"
                type="number"
                step="0.01"
                defaultValue={parametros ? (parametros.tasa_isr * 100).toFixed(2) : "30"}
                disabled={!puedeEditarParametros}
                required
                className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Tasa IVA (%)</label>
              <input
                name="tasa_iva"
                type="number"
                step="0.01"
                defaultValue={parametros ? (parametros.tasa_iva * 100).toFixed(2) : "16"}
                disabled={!puedeEditarParametros}
                required
                className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Pérdidas fiscales pendientes (inicio de año)</label>
              <input
                name="perdidas_fiscales_inicio_anio"
                type="number"
                step="0.01"
                defaultValue={parametros ? parametros.perdidas_fiscales_inicio_anio : "0"}
                disabled={!puedeEditarParametros}
                className="w-40 rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
              />
            </div>
            {puedeEditarParametros && (
              <button
                disabled={guardarParametros.isPending}
                className="self-end rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {parametros ? "Guardar" : "Capturar"}
              </button>
            )}
          </div>
        </form>
      )}

      {parametros && cargandoMensual && <p className="text-sm text-slate-500">Calculando…</p>}

      {parametros && mensual && (
        <>
          <div className="mb-6 overflow-x-auto rounded border border-slate-200 bg-white">
            <p className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
              ISR -- devengado, coeficiente de utilidad acumulado
            </p>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Mes</th>
                  <th className="px-3 py-2 text-right">Ingresos nominales (mes)</th>
                  <th className="px-3 py-2 text-right">Ingresos nominales acum.</th>
                  <th className="px-3 py-2 text-right">Utilidad fiscal estimada acum.</th>
                  <th className="px-3 py-2 text-right">Base gravable acum.</th>
                  <th className="px-3 py-2 text-right">ISR causado acum.</th>
                  <th className="px-3 py-2 text-right">ISR a cargo del mes</th>
                </tr>
              </thead>
              <tbody>
                {mensual.map((m) => (
                  <tr key={m.mes} className="border-t border-slate-100">
                    <td className="px-3 py-2">{MESES[m.mes - 1]}</td>
                    <td className="px-3 py-2 text-right">{formatoMoneda(m.ingresos_nominales_mes)}</td>
                    <td className="px-3 py-2 text-right">{formatoMoneda(m.ingresos_nominales_acumulado)}</td>
                    <td className="px-3 py-2 text-right">{formatoMoneda(m.utilidad_fiscal_estimada_acumulada)}</td>
                    <td className="px-3 py-2 text-right">{formatoMoneda(m.base_gravable_isr_acumulada)}</td>
                    <td className="px-3 py-2 text-right">{formatoMoneda(m.isr_causado_acumulado)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatoMoneda(m.isr_a_cargo_mes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-xs text-slate-400">
              Coeficiente de utilidad: {formatoPorcentaje(parametros.coeficiente_utilidad)} · Tasa ISR:{" "}
              {formatoPorcentaje(parametros.tasa_isr)} · Pérdidas fiscales: {formatoMoneda(parametros.perdidas_fiscales_inicio_anio)}
            </p>
          </div>

          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <p className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
              IVA -- flujo de efectivo (aproximado)
            </p>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Mes</th>
                  <th className="px-3 py-2 text-right">Ingresos cobrados (mes)</th>
                  <th className="px-3 py-2 text-right">IVA trasladado</th>
                  <th className="px-3 py-2 text-right">Gastos (mes)</th>
                  <th className="px-3 py-2 text-right">IVA acreditable</th>
                  <th className="px-3 py-2 text-right">Saldo del mes</th>
                  <th className="px-3 py-2 text-right">Saldo acumulado</th>
                </tr>
              </thead>
              <tbody>
                {mensual.map((m) => (
                  <tr key={m.mes} className="border-t border-slate-100">
                    <td className="px-3 py-2">{MESES[m.mes - 1]}</td>
                    <td className="px-3 py-2 text-right">{formatoMoneda(m.ingresos_cobrados_mes)}</td>
                    <td className="px-3 py-2 text-right">{formatoMoneda(m.iva_trasladado_mes)}</td>
                    <td className="px-3 py-2 text-right">{formatoMoneda(m.gastos_mes)}</td>
                    <td className="px-3 py-2 text-right">{formatoMoneda(m.iva_acreditable_mes)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${m.saldo_iva_mes < 0 ? "text-emerald-600" : ""}`}>
                      {formatoMoneda(m.saldo_iva_mes)}
                    </td>
                    <td className={`px-3 py-2 text-right font-medium ${m.saldo_iva_acumulado < 0 ? "text-emerald-600" : ""}`}>
                      {formatoMoneda(m.saldo_iva_acumulado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-xs text-slate-400">
              Saldo negativo = IVA a favor. Tasa IVA: {formatoPorcentaje(parametros.tasa_iva)}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
