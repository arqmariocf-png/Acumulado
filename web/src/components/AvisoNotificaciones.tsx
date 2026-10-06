import { useEffect, useState } from "react";
import { estaSuscrito, pushSoportado, suscribirsePush } from "../lib/push";

// Aviso al entrar para activar las notificaciones en el celular (Mario,
// 6-oct-2026: de 40 personas que usan la app solo 15 las tenían). Sale en
// cada sesión mientras el dispositivo no esté suscrito; si la persona ya
// las tenía en este dispositivo, vuelve a ligar la suscripción a su cuenta
// (se pierde cuando el navegador la renueva o cuando entra otra persona).

function esIphoneSinInstalar(): boolean {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalada = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return ios && !instalada;
}

export function AvisoNotificaciones({ profileId }: { profileId: string }) {
  const [estado, setEstado] = useState<"cargando" | "activo" | "falta" | "bloqueado" | "iphone" | "sin_soporte">("cargando");
  const [cerrado, setCerrado] = useState(() => {
    try {
      return sessionStorage.getItem("aviso-notificaciones-cerrado") === "1";
    } catch {
      return false;
    }
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!pushSoportado()) {
        if (vivo) setEstado(esIphoneSinInstalar() ? "iphone" : "sin_soporte");
        return;
      }
      if (Notification.permission === "denied") {
        if (vivo) setEstado("bloqueado");
        return;
      }
      const suscrito = await estaSuscrito().catch(() => false);
      if (suscrito && Notification.permission === "granted") {
        // Re-liga la suscripción de este dispositivo a la cuenta actual.
        await suscribirsePush(profileId).catch(() => undefined);
        if (vivo) setEstado("activo");
      } else if (vivo) setEstado("falta");
    })();
    return () => {
      vivo = false;
    };
  }, [profileId]);

  if (cerrado || estado === "cargando" || estado === "activo" || estado === "sin_soporte") return null;

  function cerrar() {
    try {
      sessionStorage.setItem("aviso-notificaciones-cerrado", "1");
    } catch {
      /* sin almacenamiento: solo se cierra en pantalla */
    }
    setCerrado(true);
  }

  async function activar() {
    setError(null);
    try {
      await suscribirsePush(profileId);
      setEstado("activo");
    } catch (e) {
      setError((e as Error).message);
      if (typeof Notification !== "undefined" && Notification.permission === "denied") setEstado("bloqueado");
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900">
      <span className="text-base">🔔</span>
      {estado === "falta" && (
        <>
          <span className="flex-1">Activa las notificaciones para que te lleguen al celular tus tareas, aprobaciones y pendientes.</span>
          <button type="button" onClick={activar} className="rounded bg-sky-700 px-3 py-1 text-xs font-medium text-white">
            Activar notificaciones
          </button>
        </>
      )}
      {estado === "bloqueado" && (
        <span className="flex-1">
          Las notificaciones están bloqueadas en este navegador. Ábrelas desde el candado junto a la dirección (Configuración del sitio → Notificaciones → Permitir) y vuelve a entrar.
        </span>
      )}
      {estado === "iphone" && (
        <span className="flex-1">
          En iPhone las notificaciones solo funcionan con la app instalada: en Safari toca Compartir → "Agregar a pantalla de inicio", ábrela desde el ícono y activa las notificaciones.
        </span>
      )}
      <button type="button" onClick={cerrar} className="text-xs underline">
        Ahora no
      </button>
      {error && <p className="w-full text-xs text-red-700">{error}</p>}
    </div>
  );
}
