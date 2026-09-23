import { useEffect, useState } from "react";

// El navegador avisa con `beforeinstallprompt` cuando la aplicación se puede
// instalar, y exige que la instalación se dispare desde un gesto del usuario
// -- de ahí que haya que guardar el evento y usarlo al hacer clic, en vez de
// poder llamarlo cuando se nos antoje.
//
// Solo Chromium lo implementa. En iOS no existe: ahí se instala desde
// Compartir → Agregar a pantalla de inicio, y por eso `esIos` se expone
// aparte, para poder decirlo con palabras en vez de esconder el botón y dejar
// al usuario pensando que no se puede.

interface EventoInstalacion extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function useInstalable() {
  const [evento, setEvento] = useState<EventoInstalacion | null>(null);
  const [instalada, setInstalada] = useState(false);

  useEffect(() => {
    const yaInstalada =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    setInstalada(!!yaInstalada);

    function alPoderInstalar(e: Event) {
      e.preventDefault(); // sin esto el navegador muestra su propio aviso y pierde el evento
      setEvento(e as EventoInstalacion);
    }
    function alInstalar() {
      setInstalada(true);
      setEvento(null);
    }

    window.addEventListener("beforeinstallprompt", alPoderInstalar);
    window.addEventListener("appinstalled", alInstalar);
    return () => {
      window.removeEventListener("beforeinstallprompt", alPoderInstalar);
      window.removeEventListener("appinstalled", alInstalar);
    };
  }, []);

  const esIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  async function instalar() {
    if (!evento) return;
    await evento.prompt();
    await evento.userChoice;
    setEvento(null);
  }

  return { sePuedeInstalar: !!evento && !instalada, instalada, esIos, instalar };
}
