import { Fragment, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ExcelJS from "exceljs";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { sincronizarNominaExterna, type ResultadoSincronizacion } from "../../lib/nominaExterna";
import { useNominaExternaAutoSync } from "../../lib/useNominaExternaAutoSync";
// Un solo origen para el parseo de importes: el mismo módulo que usa el
// edge function al sincronizar, ya cubierto por `npm test`. Si el
// frontend lo reimplementara, la suma de la pantalla y la que se guardó
// podrían separarse sin que nadie se diera cuenta.
import { parseAmountCents } from "../../../../supabase/functions/_shared/nomina-externa.ts";
import type {
  MetodoPagoNomina,
  NominaExternaMapeo,
  NominaExternaOrigen,
  NominaExternaOrigenKey,
  NominaExternaPago,
  NominaExternaRenglon,
} from "../../types/database";

const FALLBACK_REFETCH_MS = 60_000;

const METHOD_LABELS: Record<MetodoPagoNomina, string> = {
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  otro: "Otro",
};

const MAPPING_FIELDS = [
  { key: "campo_empleado", label: "Empleado", hint: "La columna con el nombre de quien cobra" },
  { key: "campo_importe", label: "Importe", hint: "La columna que se suma y se paga" },
  { key: "campo_periodo", label: "Periodo", hint: "Semana, quincena o fecha" },
  { key: "campo_centro_costos", label: "Centro de costos", hint: "Obra, proyecto o departamento" },
  { key: "campo_id", label: "Identificador", hint: "Cambiarlo re-liga los pagos ya programados" },
] as const;

type MappingKey = (typeof MAPPING_FIELDS)[number]["key"];

function money(cents: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatCell(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function relativeTime(iso: string | null): string {
  if (!iso) return "nunca";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

async function fetchOrigenes() {
  const { data, error } = await supabase.from("nomina_externa_origenes").select("*").order("origen");
  if (error) throw error;
  return (data ?? []) as NominaExternaOrigen[];
}

async function fetchMapeos() {
  const { data, error } = await supabase.from("nomina_externa_mapeos").select("*");
  if (error) throw error;
  return (data ?? []) as NominaExternaMapeo[];
}

async function fetchRenglones(origen: string) {
  const { data, error } = await supabase.from("nomina_externa_renglones").select("*").eq("origen", origen);
  if (error) throw error;
  return (data ?? []) as NominaExternaRenglon[];
}

async function fetchPagos(origen: string) {
  const { data, error } = await supabase.from("nomina_externa_pagos").select("*").eq("origen", origen);
  if (error) throw error;
  return (data ?? []) as NominaExternaPago[];
}

interface Row {
  renglon: NominaExternaRenglon;
  employee: string;
  period: string;
  costCenter: string;
  amountCents: number | null;
  payment: NominaExternaPago | null;
  status: "por_programar" | "programado" | "pagado";
  /** Lo que manda: el congelado si ya se pagó, si no el vigente de la API. */
  effectiveCents: number | null;
}

function StatusPill({ status }: { status: Row["status"] }) {
  const styles = {
    por_programar: "bg-amber-50 text-amber-700 border-amber-200",
    programado: "bg-sky-50 text-sky-700 border-sky-200",
    pagado: "bg-emerald-50 text-emerald-700 border-emerald-200",
  } as const;
  const labels = { por_programar: "Por programar", programado: "Programado", pagado: "Pagado" } as const;
  return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${styles[status]}`}>{labels[status]}</span>;
}

async function exportToExcel(sourceName: string, columns: string[], rows: Row[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Nómina externa");
  sheet.addRow([sourceName]);
  sheet.addRow([...columns, "Estatus", "Fecha de pago", "Método", "Referencia"]);
  for (const r of rows) {
    sheet.addRow([
      ...columns.map((c) => formatCell(r.renglon.datos[c])),
      r.status === "pagado" ? "Pagado" : r.status === "programado" ? "Programado" : "Por programar",
      r.payment?.estado === "pagado" ? new Date(r.payment.pagado_en ?? "").toLocaleDateString("es-MX") : (r.payment?.programado_para ?? ""),
      r.payment ? METHOD_LABELS[r.payment.metodo_pago] : "",
      r.payment?.referencia_pago ?? "",
    ]);
  }
  sheet.getRow(2).font = { bold: true };
  sheet.columns.forEach((c) => (c.width = 18));
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sourceName.replace(/\s+/g, "-").toLowerCase()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ManoDeObra() {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [syncResults, setSyncResults] = useState<ResultadoSincronizacion[] | null>(null);
  const [activeKey, setActiveKey] = useState<NominaExternaOrigenKey>("mano_obra");
  const [search, setSearch] = useState("");
  const [costCenterFilter, setCostCenterFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | Row["status"]>("todos");
  const [showMapping, setShowMapping] = useState(false);
  const [showAllColumns, setShowAllColumns] = useState(false);
  const [schedulingKey, setSchedulingKey] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState(todayKey());
  const [scheduleMethod, setScheduleMethod] = useState<MetodoPagoNomina>("transferencia");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [payingKey, setPayingKey] = useState<string | null>(null);
  const [payReference, setPayReference] = useState("");
  const [bulkDate, setBulkDate] = useState(todayKey());

  const { data: sources } = useQuery({ queryKey: ["nomina-externa-origenes"], queryFn: fetchOrigenes, refetchInterval: FALLBACK_REFETCH_MS });
  const { data: mappings } = useQuery({ queryKey: ["nomina-externa-mapeos"], queryFn: fetchMapeos });
  const { data: records, isLoading } = useQuery({
    queryKey: ["nomina-externa-renglones", activeKey],
    queryFn: () => fetchRenglones(activeKey),
    refetchInterval: FALLBACK_REFETCH_MS,
  });
  const { data: payments } = useQuery({
    queryKey: ["nomina-externa-pagos", activeKey],
    queryFn: () => fetchPagos(activeKey),
    refetchInterval: FALLBACK_REFETCH_MS,
  });

  // Si el cron no ha corrido (o se atrasó), la página se refresca sola al
  // abrirse en vez de mostrar números viejos.
  useNominaExternaAutoSync(sources, () => invalidateData());

  useEffect(() => {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["nomina-externa-origenes"] });
      queryClient.invalidateQueries({ queryKey: ["nomina-externa-renglones"] });
      queryClient.invalidateQueries({ queryKey: ["nomina-externa-pagos"] });
      queryClient.invalidateQueries({ queryKey: ["nomina-externa-mapeos"] });
    };
    const channel = supabase
      .channel("nomina-externa-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "nomina_externa_origenes" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "nomina_externa_renglones" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "nomina_externa_pagos" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "nomina_externa_mapeos" }, invalidate)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const source = sources?.find((s) => s.origen === activeKey);
  const mapping = mappings?.find((m) => m.origen === activeKey);
  // Memoizado porque `?? []` crearía un arreglo nuevo en cada render y
  // rompería la memoización de todo lo que depende de las columnas.
  const columns = useMemo(() => source?.columnas ?? [], [source]);

  // Las columnas mapeadas van primero -- son las que se leen a diario; el
  // resto queda detrás de "ver todas" para que la tabla siga siendo
  // legible aunque la API traiga treinta columnas.
  const mappedColumns = useMemo(
    () =>
      [mapping?.campo_empleado, mapping?.campo_periodo, mapping?.campo_centro_costos, mapping?.campo_importe].filter(
        (c): c is string => Boolean(c) && columns.includes(c as string),
      ),
    [mapping, columns],
  );
  const visibleColumns = showAllColumns || mappedColumns.length === 0 ? columns : mappedColumns;

  const paymentByKey = useMemo(() => new Map((payments ?? []).map((p) => [p.llave, p])), [payments]);

  const allRows = useMemo<Row[]>(() => {
    return (records ?? []).map((renglon) => {
      const payment = paymentByKey.get(renglon.llave) ?? null;
      const amountCents = mapping?.campo_importe ? parseAmountCents(renglon.datos[mapping.campo_importe]) : null;
      const status: Row["status"] = payment ? payment.estado : "por_programar";
      return {
        renglon,
        employee: mapping?.campo_empleado ? formatCell(renglon.datos[mapping.campo_empleado]) : renglon.llave,
        period: mapping?.campo_periodo ? formatCell(renglon.datos[mapping.campo_periodo]) : "",
        costCenter: mapping?.campo_centro_costos ? formatCell(renglon.datos[mapping.campo_centro_costos]) : "",
        amountCents,
        payment,
        status,
        effectiveCents: status === "pagado" ? (payment?.importe_centavos ?? null) : amountCents,
      };
    });
  }, [records, paymentByKey, mapping]);

  const costCenters = useMemo(() => [...new Set(allRows.map((r) => r.costCenter).filter((v) => v && v !== "—"))].sort(), [allRows]);
  const periods = useMemo(() => [...new Set(allRows.map((r) => r.period).filter((v) => v && v !== "—"))].sort(), [allRows]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (costCenterFilter && r.costCenter !== costCenterFilter) return false;
      if (periodFilter && r.period !== periodFilter) return false;
      if (statusFilter !== "todos" && r.status !== statusFilter) return false;
      if (!needle) return true;
      return Object.values(r.renglon.datos).some((v) => formatCell(v).toLowerCase().includes(needle));
    });
  }, [allRows, search, costCenterFilter, periodFilter, statusFilter]);

  const totals = useMemo(() => {
    const sum = (list: Row[]) => list.reduce((s, r) => s + (r.effectiveCents ?? 0), 0);
    const byStatus = (status: Row["status"]) => rows.filter((r) => r.status === status);
    return {
      shown: sum(rows),
      pending: sum(byStatus("por_programar")),
      scheduled: sum(byStatus("programado")),
      paid: sum(byStatus("pagado")),
      pendingCount: byStatus("por_programar").length,
      unreadable: rows.filter((r) => r.amountCents == null).length,
    };
  }, [rows]);

  const pendingRows = rows.filter((r) => r.status === "por_programar" && (r.amountCents ?? 0) !== 0);

  function invalidateData() {
    queryClient.invalidateQueries({ queryKey: ["nomina-externa-renglones"] });
    queryClient.invalidateQueries({ queryKey: ["nomina-externa-pagos"] });
    queryClient.invalidateQueries({ queryKey: ["nomina-externa-origenes"] });
    queryClient.invalidateQueries({ queryKey: ["nomina-externa-mapeos"] });
  }

  const sync = useMutation({
    mutationFn: async (origen?: string) => {
      setSyncResults(null);
      return await sincronizarNominaExterna(origen as NominaExternaOrigenKey | undefined);
    },
    onSuccess: (data) => {
      setSyncResults(data.resultados);
      invalidateData();
    },
    onError: (err: Error) => setError(err.message),
  });

  const saveMapping = useMutation({
    mutationFn: async ({ field, value }: { field: MappingKey; value: string }) => {
      const { error: err } = await supabase.from("nomina_externa_mapeos").upsert(
        {
          origen: activeKey,
          campo_id: mapping?.campo_id ?? null,
          campo_empleado: mapping?.campo_empleado ?? null,
          campo_importe: mapping?.campo_importe ?? null,
          campo_periodo: mapping?.campo_periodo ?? null,
          campo_centro_costos: mapping?.campo_centro_costos ?? null,
          [field]: value || null,
          actualizado_por: perfil?.id ?? null,
        },
        { onConflict: "origen" },
      );
      if (err) throw err;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["nomina-externa-mapeos"] }),
    onError: (err: Error) => setError(err.message),
  });

  const schedule = useMutation({
    mutationFn: async ({ recordKeys, date, method, notes }: { recordKeys: string[]; date: string; method: MetodoPagoNomina; notes: string }) => {
      const { error: err } = await supabase.from("nomina_externa_pagos").upsert(
        recordKeys.map((llave) => ({
          origen: activeKey,
          llave,
          estado: "programado" as const,
          programado_para: date,
          metodo_pago: method,
          notas: notes.trim() || null,
          creado_por: perfil?.id ?? null,
        })),
        { onConflict: "origen,llave" },
      );
      if (err) throw err;
    },
    onSuccess: () => {
      setSchedulingKey(null);
      setScheduleNotes("");
      invalidateData();
    },
    onError: (err: Error) => setError(err.message),
  });

  const markPaid = useMutation({
    mutationFn: async ({ row, reference }: { row: Row; reference: string }) => {
      // El importe se congela aquí, con el valor vigente de la API. Si
      // Grupo Loma corrige el renglón después, lo pagado no se mueve.
      if (row.amountCents == null) {
        throw new Error("No se puede pagar un renglón sin importe legible — revisa el mapeo de la columna de importe");
      }
      const { error: err } = await supabase.from("nomina_externa_pagos").upsert(
        {
          origen: activeKey,
          llave: row.renglon.llave,
          estado: "pagado" as const,
          programado_para: row.payment?.programado_para ?? todayKey(),
          metodo_pago: row.payment?.metodo_pago ?? "transferencia",
          importe_centavos: row.amountCents,
          pagado_en: new Date().toISOString(),
          referencia_pago: reference.trim() || null,
          notas: row.payment?.notas ?? null,
          creado_por: row.payment?.creado_por ?? perfil?.id ?? null,
        },
        { onConflict: "origen,llave" },
      );
      if (err) throw err;
    },
    onSuccess: () => {
      setPayingKey(null);
      setPayReference("");
      invalidateData();
    },
    onError: (err: Error) => setError(err.message),
  });

  const removeSchedule = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error: err } = await supabase.from("nomina_externa_pagos").delete().eq("id", paymentId);
      if (err) throw err;
    },
    onSuccess: invalidateData,
    onError: (err: Error) => setError(err.message),
  });

  const puedeVer = perfil?.rol === "admin" || perfil?.rol === "rh";
  if (!puedeVer) return <Navigate to="/" replace />;

  const syncing = sync.isPending;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Mano de obra y nómina fija</h1>
          <p className="mt-1 text-sm text-slate-500">
            Lo que reportan las APIs de Grupo Loma, para revisarlo y programar el pago desde aquí.
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          En vivo
        </span>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="mt-6 flex flex-wrap gap-2">
        {(sources ?? []).map((s) => (
          <button
            key={s.origen}
            onClick={() => {
              setActiveKey(s.origen);
              setSearch("");
              setCostCenterFilter("");
              setPeriodFilter("");
              setStatusFilter("todos");
            }}
            className={`rounded-full px-4 py-1.5 text-sm ${activeKey === s.origen ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-100"}`}
          >
            {s.nombre}
            {s.ultimo_total_renglones != null && <span className="ml-2 text-xs opacity-70">{s.ultimo_total_renglones}</span>}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-sm">
          <p className="text-slate-700">
            Última consulta: <strong>{relativeTime(source?.ultima_sincronizacion ?? null)}</strong>
            {source?.ultimo_estado === "ok" && source.ultimo_total_renglones != null && (
              <span className="text-slate-500"> · {source.ultimo_total_renglones} registros</span>
            )}
          </p>
          <p className="text-xs text-slate-400">{source?.url}</p>
        </div>
        <button
          onClick={() => sync.mutate(activeKey)}
          disabled={syncing}
          className="ml-auto rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {syncing ? "Consultando…" : "Sincronizar ahora"}
        </button>
        <button
          onClick={() => sync.mutate(undefined)}
          disabled={syncing}
          className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          Sincronizar los tres
        </button>
        <button onClick={() => setShowMapping((v) => !v)} className="text-xs font-semibold text-slate-700 hover:underline">
          {showMapping ? "Ocultar columnas" : "Configurar columnas →"}
        </button>
      </div>

      {source?.ultimo_estado === "error" && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold">La última consulta a esta API falló.</p>
          <p className="mt-1 break-words text-xs">{source.ultimo_error}</p>
          <p className="mt-1 text-xs text-red-600">Lo que se ve abajo es de la última sincronización buena, no de hoy.</p>
        </div>
      )}

      {syncResults && (
        <div className="mt-3 flex flex-col gap-1">
          {syncResults.map((r) => (
            <p key={r.origen} className={`rounded-lg px-3 py-2 text-sm ${r.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              <strong>{sources?.find((s) => s.origen === r.origen)?.nombre ?? r.origen}:</strong> {r.ok ? `${r.renglones} registros` : r.error}
            </p>
          ))}
        </div>
      )}

      {showMapping && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Qué columna es cuál</h2>
          <p className="mt-1 text-xs text-slate-500">
            Se propone sola al sincronizar, a partir del nombre de cada columna. Corrígela aquí si la propuesta no
            coincide con lo que manda la API — de esto dependen los totales y lo que se paga.
          </p>
          {columns.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">Todavía no se conocen las columnas de este origen. Sincroniza una vez para descubrirlas.</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MAPPING_FIELDS.map((f) => (
                <label key={f.key} className="flex flex-col gap-1 text-xs text-slate-500">
                  {f.label}
                  <select
                    value={(mapping?.[f.key] as string | null) ?? ""}
                    onChange={(e) => saveMapping.mutate({ field: f.key, value: e.target.value })}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="">— sin asignar —</option>
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <span className="text-slate-400">{f.hint}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-300 bg-slate-50 p-5">
          <p className="text-2xl font-bold text-slate-900">{money(totals.shown)}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">Total mostrado</p>
          <p className="mt-1 text-xs text-slate-500">{rows.length} registros</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-2xl font-bold text-amber-700">{money(totals.pending)}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">Por programar</p>
          <p className="mt-1 text-xs text-slate-500">{totals.pendingCount} registros</p>
        </div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
          <p className="text-2xl font-bold text-sky-700">{money(totals.scheduled)}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">Programado</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-2xl font-bold text-emerald-700">{money(totals.paid)}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">Pagado</p>
        </div>
      </div>

      {!mapping?.campo_importe && columns.length > 0 && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Falta decir cuál columna es el importe: mientras tanto los totales salen en cero y no se puede marcar nada
          como pagado. Ábrelo en <strong>Configurar columnas</strong>.
        </p>
      )}
      {totals.unreadable > 0 && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {totals.unreadable} de los registros mostrados no traen un importe legible en la columna mapeada — no se
          están sumando. Revísalos antes de programar el pago.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar en todas las columnas…"
          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        {costCenters.length > 0 && (
          <select value={costCenterFilter} onChange={(e) => setCostCenterFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Todos los centros de costos</option>
            {costCenters.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        {periods.length > 0 && (
          <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Todos los periodos</option>
            {periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="todos">Todos los estatus</option>
          <option value="por_programar">Por programar</option>
          <option value="programado">Programado</option>
          <option value="pagado">Pagado</option>
        </select>
        {columns.length > mappedColumns.length && mappedColumns.length > 0 && (
          <button onClick={() => setShowAllColumns((v) => !v)} className="text-xs font-semibold text-slate-700 hover:underline">
            {showAllColumns ? "Ver solo lo esencial" : `Ver las ${columns.length} columnas`}
          </button>
        )}
        <button
          onClick={() => exportToExcel(source?.nombre ?? "nomina", columns, rows)}
          disabled={rows.length === 0}
          className="ml-auto rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          Exportar Excel
        </button>
      </div>

      {pendingRows.length > 0 && mapping?.campo_importe && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">
            Programar los <strong>{pendingRows.length}</strong> registros pendientes que se ven ({money(totals.pending)}) para el
          </p>
          <input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <button
            onClick={() => schedule.mutate({ recordKeys: pendingRows.map((r) => r.renglon.llave), date: bulkDate, method: "transferencia", notes: "" })}
            disabled={schedule.isPending}
            className="rounded-full bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {schedule.isPending ? "Programando…" : "Programar todos"}
          </button>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {visibleColumns.map((c) => (
                <th key={c} className="whitespace-nowrap px-4 py-2">
                  {c}
                </th>
              ))}
              <th className="px-4 py-2">Estatus</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={visibleColumns.length + 2} className="px-4 py-6 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <Fragment key={row.renglon.id}>
                <tr>
                  {visibleColumns.map((c) => (
                    <td key={c} className={`whitespace-nowrap px-4 py-2 ${c === mapping?.campo_importe ? "font-semibold text-slate-900" : "text-slate-600"}`}>
                      {c === mapping?.campo_importe && row.amountCents != null ? money(row.amountCents) : formatCell(row.renglon.datos[c])}
                    </td>
                  ))}
                  <td className="px-4 py-2">
                    <StatusPill status={row.status} />
                    {row.status === "programado" && row.payment?.programado_para && <p className="mt-1 text-xs text-slate-500">{row.payment.programado_para}</p>}
                    {row.status === "pagado" && row.payment?.importe_centavos != null && <p className="mt-1 text-xs text-slate-500">{money(row.payment.importe_centavos)}</p>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-3 text-xs font-semibold">
                      {row.status !== "pagado" && (
                        <button
                          onClick={() => {
                            setSchedulingKey(row.renglon.llave);
                            setScheduleDate(row.payment?.programado_para ?? todayKey());
                            setScheduleMethod(row.payment?.metodo_pago ?? "transferencia");
                            setScheduleNotes(row.payment?.notas ?? "");
                            setError(null);
                          }}
                          className="text-slate-700 hover:underline"
                        >
                          {row.status === "programado" ? "Editar" : "Programar"}
                        </button>
                      )}
                      {row.status === "programado" && (
                        <>
                          <button
                            onClick={() => {
                              setPayingKey(row.renglon.llave);
                              setPayReference("");
                              setError(null);
                            }}
                            className="text-emerald-700 hover:underline"
                          >
                            Marcar pagado
                          </button>
                          <button onClick={() => row.payment && removeSchedule.mutate(row.payment.id)} className="text-slate-400 hover:underline">
                            Quitar
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>

                {schedulingKey === row.renglon.llave && (
                  <tr className="bg-slate-50">
                    <td colSpan={visibleColumns.length + 2} className="px-4 py-4">
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          setError(null);
                          schedule.mutate({ recordKeys: [row.renglon.llave], date: scheduleDate, method: scheduleMethod, notes: scheduleNotes });
                        }}
                        className="flex flex-wrap items-end gap-3"
                      >
                        <label className="flex flex-col gap-1 text-xs text-slate-500">
                          Fecha de pago
                          <input required type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-slate-500">
                          Método
                          <select value={scheduleMethod} onChange={(e) => setScheduleMethod(e.target.value as MetodoPagoNomina)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900">
                            {(Object.keys(METHOD_LABELS) as MetodoPagoNomina[]).map((m) => (
                              <option key={m} value={m}>
                                {METHOD_LABELS[m]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-1 flex-col gap-1 text-xs text-slate-500">
                          Nota
                          <input value={scheduleNotes} onChange={(e) => setScheduleNotes(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
                        </label>
                        <button type="submit" disabled={schedule.isPending} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                          {schedule.isPending ? "Guardando…" : "Guardar"}
                        </button>
                        <button type="button" onClick={() => setSchedulingKey(null)} className="text-xs font-semibold text-slate-500 hover:underline">
                          Cancelar
                        </button>
                      </form>
                    </td>
                  </tr>
                )}

                {payingKey === row.renglon.llave && (
                  <tr className="bg-emerald-50">
                    <td colSpan={visibleColumns.length + 2} className="px-4 py-4">
                      <div className="flex flex-wrap items-end gap-3">
                        <p className="text-sm text-slate-700">
                          Confirmar pago de <strong>{row.amountCents != null ? money(row.amountCents) : "importe ilegible"}</strong> a {row.employee}.
                        </p>
                        <label className="flex flex-col gap-1 text-xs text-slate-500">
                          Referencia / folio
                          <input value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder="opcional" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
                        </label>
                        <button
                          onClick={() => markPaid.mutate({ row, reference: payReference })}
                          disabled={markPaid.isPending || row.amountCents == null}
                          className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                        >
                          {markPaid.isPending ? "Registrando…" : "Confirmar pago"}
                        </button>
                        <button onClick={() => setPayingKey(null)} className="text-xs font-semibold text-slate-500 hover:underline">
                          Cancelar
                        </button>
                        <p className="w-full text-xs text-slate-500">
                          Al confirmar, el importe queda congelado. Si Grupo Loma corrige este renglón después, lo pagado no se mueve.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={Math.max(visibleColumns.length, 1) + 2} className="px-4 py-6 text-center text-slate-400">
                  {(records ?? []).length === 0 ? "Sin datos todavía — presiona “Sincronizar ahora” para consultar la API." : "Ningún registro coincide con los filtros."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
