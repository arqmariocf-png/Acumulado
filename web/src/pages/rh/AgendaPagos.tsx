import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ExcelJS from "exceljs";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { useNominaExternaAutoSync } from "../../lib/useNominaExternaAutoSync";
import { ORIGIN_LABELS, agendaTotals, groupByDate, isOverdue, type AgendaEntry } from "../../lib/agendaPagosExterna";
import { parseAmountCents } from "../../../../supabase/functions/_shared/nomina-externa.ts";
import type { NominaExternaMapeo, NominaExternaOrigen, NominaExternaOrigenKey, NominaExternaPago, NominaExternaRenglon } from "../../types/database";

const FALLBACK_REFETCH_MS = 60_000;

function money(cents: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromDateKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayLabel(dateKey: string | null) {
  if (!dateKey) return "Sin fecha de pago";
  return fromDateKey(dateKey).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

async function fetchExternalSide() {
  const [sources, payments, records, mappings] = await Promise.all([
    supabase.from("nomina_externa_origenes").select("*").order("origen"),
    supabase.from("nomina_externa_pagos").select("*"),
    supabase.from("nomina_externa_renglones").select("*"),
    supabase.from("nomina_externa_mapeos").select("*"),
  ]);
  if (sources.error) throw sources.error;
  if (payments.error) throw payments.error;
  if (records.error) throw records.error;
  if (mappings.error) throw mappings.error;
  return {
    sources: (sources.data ?? []) as NominaExternaOrigen[],
    payments: (payments.data ?? []) as NominaExternaPago[],
    records: (records.data ?? []) as NominaExternaRenglon[],
    mappings: (mappings.data ?? []) as NominaExternaMapeo[],
  };
}

async function exportAgenda(entries: AgendaEntry[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Agenda de pagos");
  sheet.addRow(["Agenda de pagos — nómina externa (Grupo Loma)"]);
  sheet.addRow(["Fecha de pago", "Origen", "A quién", "Detalle", "Método", "Importe", "Estatus", "Pagado el", "Referencia"]);
  for (const e of entries) {
    sheet.addRow([
      e.scheduledFor ?? "",
      ORIGIN_LABELS[e.origin],
      e.concept,
      e.detail,
      e.method,
      e.amountCents != null ? e.amountCents / 100 : "",
      e.status === "pagado" ? "Pagado" : "Programado",
      e.paidAt ? new Date(e.paidAt).toLocaleDateString("es-MX") : "",
      e.reference ?? "",
    ]);
  }
  sheet.getRow(2).font = { bold: true };
  sheet.columns.forEach((c) => (c.width = 20));
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "agenda-de-pagos.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

const ORIGIN_STYLES: Record<NominaExternaOrigenKey, string> = {
  mano_obra: "bg-indigo-50 text-indigo-700 border-indigo-200",
  nomina_semanal: "bg-cyan-50 text-cyan-700 border-cyan-200",
  nomina_quincenal: "bg-teal-50 text-teal-700 border-teal-200",
};

export function AgendaPagos() {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [originFilter, setOriginFilter] = useState<"todos" | NominaExternaOrigenKey>("todos");
  const [showPaid, setShowPaid] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payReference, setPayReference] = useState("");

  const { data: externalSide, isLoading } = useQuery({
    queryKey: ["agenda-pagos-nomina-externa"],
    queryFn: fetchExternalSide,
    refetchInterval: FALLBACK_REFETCH_MS,
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["agenda-pagos-nomina-externa"] });
  }

  // Se refresca sola si el cron no ha corrido: nadie tiene que sincronizar
  // a mano para que la agenda esté al día.
  useNominaExternaAutoSync(externalSide?.sources, invalidateAll);

  useEffect(() => {
    const invalidate = () => invalidateAll();
    const channel = supabase
      .channel("agenda-pagos-nomina-externa-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "nomina_externa_pagos" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "nomina_externa_renglones" }, invalidate)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  const entries = useMemo<AgendaEntry[]>(() => {
    if (!externalSide) return [];
    const mappingByKey = new Map(externalSide.mappings.map((m) => [m.origen, m]));
    const recordByKey = new Map(externalSide.records.map((r) => [`${r.origen}::${r.llave}`, r]));

    return externalSide.payments.map((payment) => {
      const mapping = mappingByKey.get(payment.origen);
      const record = recordByKey.get(`${payment.origen}::${payment.llave}`);
      const liveCents = record && mapping?.campo_importe ? parseAmountCents(record.datos[mapping.campo_importe]) : null;
      const employee = record && mapping?.campo_empleado ? String(record.datos[mapping.campo_empleado] ?? payment.llave) : payment.llave;
      const period = record && mapping?.campo_periodo ? String(record.datos[mapping.campo_periodo] ?? "") : "";
      const costCenter = record && mapping?.campo_centro_costos ? String(record.datos[mapping.campo_centro_costos] ?? "") : "";

      return {
        id: payment.id,
        origin: payment.origen,
        concept: employee,
        detail: [period, costCenter].filter(Boolean).join(" · ") || (record ? "" : "El renglón ya no viene en la API"),
        scheduledFor: payment.programado_para,
        method: payment.metodo_pago,
        status: payment.estado,
        amountCents: payment.estado === "pagado" ? payment.importe_centavos : liveCents,
        paidAt: payment.pagado_en,
        reference: payment.referencia_pago,
      };
    });
  }, [externalSide]);

  const today = todayKey();

  const filteredEntries = useMemo(
    () =>
      entries.filter((e) => {
        if (originFilter !== "todos" && e.origin !== originFilter) return false;
        if (!showPaid && e.status === "pagado") return false;
        return true;
      }),
    [entries, originFilter, showPaid],
  );

  const totals = useMemo(() => agendaTotals(filteredEntries, today), [filteredEntries, today]);
  const groups = useMemo(() => groupByDate(filteredEntries, today), [filteredEntries, today]);

  const markPaid = useMutation({
    mutationFn: async ({ entry, reference }: { entry: AgendaEntry; reference: string }) => {
      if (entry.amountCents == null) {
        throw new Error("Este pago no tiene un importe legible todavía — revísalo en Mano de obra antes de marcarlo pagado");
      }
      const { error: err } = await supabase
        .from("nomina_externa_pagos")
        .update({ estado: "pagado", importe_centavos: entry.amountCents, pagado_en: new Date().toISOString(), referencia_pago: reference.trim() || null })
        .eq("id", entry.id);
      if (err) throw err;
    },
    onSuccess: () => {
      setPayingId(null);
      setPayReference("");
      invalidateAll();
    },
    onError: (err: Error) => setError(err.message),
  });

  const payWholeDay = useMutation({
    mutationFn: async (group: { entries: AgendaEntry[] }) => {
      const pendientes = group.entries.filter((e) => e.status === "programado" && e.amountCents != null);
      if (pendientes.length === 0) throw new Error("No hay nada pagable en ese día");
      const paidAt = new Date().toISOString();
      for (const entry of pendientes) {
        const { error: err } = await supabase.from("nomina_externa_pagos").update({ estado: "pagado", importe_centavos: entry.amountCents, pagado_en: paidAt }).eq("id", entry.id);
        if (err) throw err;
      }
    },
    onSuccess: invalidateAll,
    onError: (err: Error) => setError(err.message),
  });

  const puedeVer = perfil?.rol === "admin" || perfil?.rol === "rh";
  if (!puedeVer) return <Navigate to="/" replace />;

  const failedSources = (externalSide?.sources ?? []).filter((s) => s.activo && s.ultimo_estado === "error");

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Agenda de pagos</h1>
          <p className="mt-1 text-sm text-slate-500">
            Todo lo que hay que pagar de la nómina externa (Grupo Loma), en una sola lista. Los importes se recalculan
            solos hasta el momento del pago.
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          En vivo · se actualiza sola
        </span>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {failedSources.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          La última consulta a {failedSources.map((s) => s.nombre).join(", ")} falló, así que esos importes son de la sincronización anterior.{" "}
          <Link to="/rh/mano-de-obra" className="font-semibold underline">
            Ver detalle
          </Link>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-300 bg-slate-50 p-5">
          <p className="text-2xl font-bold text-slate-900">{money(totals.scheduledCents)}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">Por pagar</p>
          <p className="mt-1 text-xs text-slate-500">{totals.scheduledCount} pagos programados</p>
        </div>
        <div className={`rounded-2xl border p-5 ${totals.overdueCount > 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
          <p className={`text-2xl font-bold ${totals.overdueCount > 0 ? "text-red-700" : "text-slate-400"}`}>{money(totals.overdueCents)}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">Vencido</p>
          <p className="mt-1 text-xs text-slate-500">{totals.overdueCount} pagos</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-2xl font-bold text-emerald-700">{money(totals.paidCents)}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">Pagado</p>
          <p className="mt-1 text-xs text-slate-500">{totals.paidCount} pagos</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">Por origen</p>
          <div className="mt-2 flex flex-col gap-1 text-xs">
            {totals.byOrigin.map((o) => (
              <div key={o.origin} className="flex justify-between gap-2">
                <span className="truncate text-slate-600">{ORIGIN_LABELS[o.origin]}</span>
                <span className="font-semibold text-slate-900">{money(o.scheduledCents)}</span>
              </div>
            ))}
            {totals.byOrigin.length === 0 && <span className="text-slate-400">Sin pagos todavía</span>}
          </div>
        </div>
      </div>

      {totals.unreadableCount > 0 && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {totals.unreadableCount} pagos programados no traen importe legible y no se están sumando. Casi siempre es un
          renglón de Grupo Loma cuya columna de importe no está mapeada.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value as typeof originFilter)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="todos">Todos los orígenes</option>
          {(Object.keys(ORIGIN_LABELS) as NominaExternaOrigenKey[]).map((o) => (
            <option key={o} value={o}>
              {ORIGIN_LABELS[o]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} />
          Incluir lo ya pagado
        </label>
        <button
          onClick={() => exportAgenda(filteredEntries)}
          disabled={filteredEntries.length === 0}
          className="ml-auto rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          Exportar Excel
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {isLoading && <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">Cargando…</p>}

        {!isLoading && groups.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
            No hay pagos programados. Prográmalos desde{" "}
            <Link to="/rh/mano-de-obra" className="font-semibold text-slate-700 underline">
              Mano de obra
            </Link>
            .
          </div>
        )}

        {groups.map((group) => {
          const pagables = group.entries.filter((e) => e.status === "programado" && e.amountCents != null);
          return (
            <div key={group.date ?? "sin-fecha"} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className={`flex flex-wrap items-center gap-3 border-b px-4 py-3 ${group.overdue ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
                <h2 className="text-sm font-semibold capitalize text-slate-900">{dayLabel(group.date)}</h2>
                {group.overdue && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Vencido</span>}
                <span className="text-sm text-slate-500">{group.entries.length} pagos</span>
                <span className="ml-auto text-lg font-bold text-slate-900">{money(group.totalCents)}</span>
                {pagables.length > 0 && (
                  <button
                    onClick={() => payWholeDay.mutate(group)}
                    disabled={payWholeDay.isPending}
                    className="rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                  >
                    Marcar el día como pagado ({pagables.length})
                  </button>
                )}
              </div>
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-slate-100">
                  {group.entries.map((entry) => (
                    <Fragment key={entry.id}>
                      <tr className={isOverdue(entry, today) ? "bg-red-50/40" : undefined}>
                        <td className="px-4 py-2">
                          <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${ORIGIN_STYLES[entry.origin]}`}>{ORIGIN_LABELS[entry.origin]}</span>
                        </td>
                        <td className="px-4 py-2 font-medium text-slate-900">{entry.concept}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">{entry.detail}</td>
                        <td className="px-4 py-2 font-semibold text-slate-900">
                          {entry.amountCents != null ? money(entry.amountCents) : <span className="text-amber-600">sin importe</span>}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-500">
                          {entry.status === "pagado" ? `Pagado ${entry.paidAt ? new Date(entry.paidAt).toLocaleDateString("es-MX") : ""}` : entry.method}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {entry.status === "programado" && (
                            <button
                              onClick={() => {
                                setPayingId(entry.id);
                                setPayReference("");
                                setError(null);
                              }}
                              className="text-xs font-semibold text-emerald-700 hover:underline"
                            >
                              Marcar pagado
                            </button>
                          )}
                        </td>
                      </tr>
                      {payingId === entry.id && (
                        <tr className="bg-emerald-50">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="flex flex-wrap items-end gap-3">
                              <p className="text-sm text-slate-700">
                                Confirmar <strong>{entry.amountCents != null ? money(entry.amountCents) : "importe ilegible"}</strong> a {entry.concept}.
                              </p>
                              <label className="flex flex-col gap-1 text-xs text-slate-500">
                                Referencia / folio
                                <input value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder="opcional" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
                              </label>
                              <button
                                onClick={() => markPaid.mutate({ entry, reference: payReference })}
                                disabled={markPaid.isPending || entry.amountCents == null}
                                className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                              >
                                {markPaid.isPending ? "Registrando…" : "Confirmar pago"}
                              </button>
                              <button onClick={() => setPayingId(null)} className="text-xs font-semibold text-slate-500 hover:underline">
                                Cancelar
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Al confirmar un pago, el importe queda congelado. Si Grupo Loma corrige el renglón después, lo pagado no se
        mueve — la diferencia se avisa en Mano de obra para ajustarla en el siguiente periodo.
      </p>
    </div>
  );
}
