import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { errorDeFuncion } from "../../lib/funciones";
import { useAuth } from "../../lib/auth";
import { generarHtmlDashboard } from "./plantillaDashboard";
import { PasosPorFolio } from "./PasosPorFolio";
import { conciliarAdquira, type PedidoAdquiraResumen, type PedidoBbva } from "../../../../supabase/functions/_shared/bbva-adquira";

/** Pedidos de Adquira ya cargados (bbva_adquira_pedidos) -- la otra mitad
 * de la conciliación; el maestro trae por pedido lo que BBVA reconoce. */
function usePedidosAdquira() {
  return useQuery({
    queryKey: ["bbva-adquira-pedidos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bbva_adquira_pedidos")
        .select("id_pedido, fecha, importe_total, base_imponible, estado, fecha_exportacion")
        .limit(5000);
      if (error) throw error;
      return data as (PedidoAdquiraResumen & { fecha_exportacion: string | null })[];
    },
  });
}

/** Si el corte trae detalle por pedido y hay pedidos de Adquira cargados, la
 * conciliación se calcula aquí, al vuelo, con lo más reciente de ambos
 * lados -- no depende de que se vuelva a subir el maestro. */
function fusionarConciliacion(datos: Record<string, unknown>, adquira: (PedidoAdquiraResumen & { fecha_exportacion: string | null })[] | undefined) {
  const conciliacion = datos.conciliacion as { pedidos?: PedidoBbva[] } | undefined;
  if (!conciliacion?.pedidos || !adquira || adquira.length === 0) return datos;
  const fechaExportacion = adquira.reduce<string | null>((max, a) => (a.fecha_exportacion && (!max || a.fecha_exportacion > max) ? a.fecha_exportacion : max), null);
  const resultado = conciliarAdquira(conciliacion.pedidos, adquira, { fecha_exportacion: fechaExportacion });
  return { ...datos, conciliacion: { ...conciliacion, ...resultado } };
}

function useUltimoSnapshot() {
  return useQuery({
    queryKey: ["bbva-mantenimiento-snapshot"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bbva_mantenimiento_snapshots")
        .select("fecha_corte, region, datos, creado_en")
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function SubirMaestro() {
  const queryClient = useQueryClient();
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubir(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const input = formEl.elements.namedItem("file") as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;
    setError(null);
    setOk(null);
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append("file", archivo);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const respuesta = await fetch(urlFuncion("bbva-importar-folios"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
      formEl.reset();
      setOk(`Corte cargado: ${json.kpi.total_folios} folios, ${new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(json.kpi.monto_total)}.`);
      queryClient.invalidateQueries({ queryKey: ["bbva-mantenimiento-snapshot"] });
      queryClient.invalidateQueries({ queryKey: ["bbva-folios-control"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <form onSubmit={onSubir} className="mb-4 flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white p-3 text-sm">
      <label className="font-medium text-slate-700">Actualizar con nuevo maestro:</label>
      <input type="file" name="file" accept=".xlsx,.xls" required className="text-sm" />
      <button type="submit" disabled={subiendo} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">
        {subiendo ? "Procesando…" : "Subir y actualizar"}
      </button>
      {error && <span className="text-red-600">{error}</span>}
      {ok && <span className="text-emerald-700">{ok}</span>}
    </form>
  );
}

function SubirAdquira() {
  const queryClient = useQueryClient();
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubir(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const input = formEl.elements.namedItem("file") as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;
    setError(null);
    setOk(null);
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append("file", archivo);
      const { data: sessionData } = await supabase.auth.getSession();
      const respuesta = await fetch(urlFuncion("bbva-importar-adquira"), {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
        body: fd,
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
      formEl.reset();
      setOk(`Adquira actualizado: ${json.pedidos} pedidos, ${new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(json.importe_total)}${json.fecha_exportacion ? ` (export del ${json.fecha_exportacion})` : ""}.`);
      queryClient.invalidateQueries({ queryKey: ["bbva-adquira-pedidos"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <form onSubmit={onSubir} className="mb-4 flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white p-3 text-sm">
      <label className="font-medium text-slate-700">Pedidos de Adquira (export "Pedidos recibidos"):</label>
      <input type="file" name="file" accept=".xlsx,.xls" required className="text-sm" />
      <button type="submit" disabled={subiendo} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">
        {subiendo ? "Procesando…" : "Subir y conciliar"}
      </button>
      {error && <span className="text-red-600">{error}</span>}
      {ok && <span className="text-emerald-700">{ok}</span>}
    </form>
  );
}

export function BbvaMantenimiento() {
  const { perfil } = useAuth();
  const puedeSubir = perfil?.rol === "admin" || perfil?.rol === "corporativo" || !!perfil?.bbva_mantenimiento;
  // Adquira lo carga contabilidad (corporativo) o admin -- Christian
  // (permiso acotado) ve la conciliación pero no sube ese archivo.
  const puedeSubirAdquira = perfil?.rol === "admin" || perfil?.rol === "corporativo";
  const { data: snapshot, isLoading, error } = useUltimoSnapshot();
  const { data: adquira } = usePedidosAdquira();
  const datos = useMemo(() => (snapshot ? fusionarConciliacion(snapshot.datos as Record<string, unknown>, adquira) : null), [snapshot, adquira]);
  const [alto, setAlto] = useState(800);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function onMensaje(e: MessageEvent) {
      if (e.data?.tipo === "bbva-dashboard-altura" && typeof e.data.alto === "number") {
        setAlto(e.data.alto);
      }
    }
    window.addEventListener("message", onMensaje);
    return () => window.removeEventListener("message", onMensaje);
  }, []);

  return (
    <div>
      {puedeSubir && <SubirMaestro />}
      {puedeSubirAdquira && <SubirAdquira />}

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">No se pudo cargar el panel: {(error as Error).message}</p>}
      {!isLoading && !error && !snapshot && (
        <div>
          <h1 className="mb-2 text-xl font-semibold text-slate-900">Mantenimiento BBVA</h1>
          <p className="text-sm text-slate-500">Todavía no hay ningún corte del maestro de folios cargado.</p>
        </div>
      )}
      {snapshot && (
        <div className="mb-6">
          <PasosPorFolio />
        </div>
      )}
      {snapshot && (
        <iframe
          ref={iframeRef}
          title="Panel de control BBVA — mantenimiento"
          srcDoc={generarHtmlDashboard(datos ?? snapshot.datos)}
          style={{ width: "100%", height: alto, border: "none", display: "block" }}
        />
      )}
    </div>
  );
}
