import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { generarHtmlDashboard } from "./plantillaDashboard";

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
      if (!respuesta.ok) throw new Error(json.error ?? `Error ${respuesta.status}`);
      formEl.reset();
      setOk(`Corte cargado: ${json.kpi.total_folios} folios, ${new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(json.kpi.monto_total)}.`);
      queryClient.invalidateQueries({ queryKey: ["bbva-mantenimiento-snapshot"] });
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

export function BbvaMantenimiento() {
  const { perfil } = useAuth();
  const puedeSubir = perfil?.rol === "admin" || perfil?.rol === "corporativo" || !!perfil?.bbva_mantenimiento;
  const { data: snapshot, isLoading, error } = useUltimoSnapshot();
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

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">No se pudo cargar el panel: {(error as Error).message}</p>}
      {!isLoading && !error && !snapshot && (
        <div>
          <h1 className="mb-2 text-xl font-semibold text-slate-900">Mantenimiento BBVA</h1>
          <p className="text-sm text-slate-500">Todavía no hay ningún corte del maestro de folios cargado.</p>
        </div>
      )}
      {snapshot && (
        <iframe
          ref={iframeRef}
          title="Panel de control BBVA — mantenimiento"
          srcDoc={generarHtmlDashboard(snapshot.datos)}
          style={{ width: "100%", height: alto, border: "none", display: "block" }}
        />
      )}
    </div>
  );
}
