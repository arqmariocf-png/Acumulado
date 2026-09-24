import { useEffect, useState } from "react";

const CADA_MS = 5 * 60 * 1000;

/** Avisa cuando en el servidor ya hay una compilación distinta a la que la
 * pestaña tiene cargada: la app instalada en el teléfono o una pestaña que
 * lleva días abierta no ve los cambios hasta recargar (Jorge y Mario,
 * 24-sep-2026). Revisa al volver a la pestaña y cada 5 minutos. */
export function AvisoVersion() {
  const [hayNueva, setHayNueva] = useState(false);

  useEffect(() => {
    let cancelado = false;
    async function revisar() {
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const { version } = (await r.json()) as { version?: string };
        if (!cancelado && version && version !== __APP_VERSION__) setHayNueva(true);
      } catch {
        // sin red: no pasa nada
      }
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void revisar();
    };
    const timer = window.setInterval(revisar, CADA_MS);
    document.addEventListener("visibilitychange", onVisible);
    void revisar();
    return () => {
      cancelado = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!hayNueva) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
      Hay una versión nueva de la app.{" "}
      <button type="button" onClick={() => window.location.reload()} className="font-medium underline">
        Actualizar ahora
      </button>
    </div>
  );
}
