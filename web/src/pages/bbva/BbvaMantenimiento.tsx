import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { generarHtmlDashboard } from "./plantillaDashboard";

function useUltimoSnapshot() {
  return useQuery({
    queryKey: ["bbva-mantenimiento-snapshot"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bbva_mantenimiento_snapshots")
        .select("fecha_corte, region, datos")
        .order("fecha_corte", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function BbvaMantenimiento() {
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

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (error) return <p className="text-sm text-red-600">No se pudo cargar el panel: {(error as Error).message}</p>;
  if (!snapshot) {
    return (
      <div>
        <h1 className="mb-2 text-xl font-semibold text-slate-900">Mantenimiento BBVA</h1>
        <p className="text-sm text-slate-500">Todavía no hay ningún corte del maestro de folios cargado.</p>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      title="Panel de control BBVA — mantenimiento"
      srcDoc={generarHtmlDashboard(snapshot.datos)}
      style={{ width: "100%", height: alto, border: "none", display: "block" }}
    />
  );
}
