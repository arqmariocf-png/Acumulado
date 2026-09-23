// Hacer que la aplicación se pueda "bajar" al teléfono, y que lo que quede
// ahí sea la aplicación DE LA ORGANIZACIÓN: su nombre y su logotipo, no los
// de la plataforma.
//
// El manifiesto estático (public/manifest.webmanifest) es neutro a propósito:
// antes de iniciar sesión no hay forma de saber de quién es la aplicación.
// Una vez que se sabe, se reemplaza en caliente por uno generado con los datos
// de la organización.
//
// Lo que esto NO resuelve: si alguien instala ANTES de iniciar sesión, se
// queda con el ícono de la plataforma hasta que vuelva a instalar. Para que
// cada cliente tenga su ícono desde la primera visita haría falta un
// subdominio por organización, que es otra conversación (DNS y dominios).

const ID_MANIFIESTO_PROPIO = "manifiesto-organizacion";

export function registrarServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  // Falla en silencio a propósito: sin service worker la aplicación funciona
  // igual, nada más no se puede instalar. No vale la pena molestar al usuario.
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

interface MarcaInstalable {
  nombre: string;
  logoUrl: string | null;
}

/** Reemplaza el manifiesto y el ícono de iOS por los de la organización.
 *
 * El manifiesto va como blob: generarlo en el cliente evita tener que servir
 * una ruta dinámica por organización desde el hosting estático. El navegador
 * lo lee al momento de instalar, así que basta con que esté puesto para
 * entonces. */
export function aplicarMarcaInstalable({ nombre, logoUrl }: MarcaInstalable): void {
  if (typeof document === "undefined") return;

  const manifiesto = {
    name: nombre,
    short_name: nombre.length > 12 ? nombre.slice(0, 12) : nombre,
    description: `${nombre} · Acumulado`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0f172a",
    lang: "es-MX",
    icons: logoUrl
      ? [
          { src: logoUrl, sizes: "512x512", type: "image/png" },
          { src: logoUrl, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ]
      : [
          { src: "/icono-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icono-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icono-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
  };

  const anterior = document.getElementById(ID_MANIFIESTO_PROPIO) as HTMLLinkElement | null;
  // Se libera el blob del manifiesto anterior; si no, cada cambio de
  // organización (o cada recarga del perfil) deja uno colgado en memoria.
  if (anterior?.href.startsWith("blob:")) URL.revokeObjectURL(anterior.href);
  anterior?.remove();

  const estatico = document.querySelector<HTMLLinkElement>('link[rel="manifest"]:not([id])');
  if (estatico) estatico.remove();

  const enlace = document.createElement("link");
  enlace.id = ID_MANIFIESTO_PROPIO;
  enlace.rel = "manifest";
  enlace.href = URL.createObjectURL(new Blob([JSON.stringify(manifiesto)], { type: "application/manifest+json" }));
  document.head.appendChild(enlace);

  document.title = `${nombre} · Acumulado`;

  // iOS no lee el manifiesto para "Agregar a pantalla de inicio": toma el
  // apple-touch-icon, así que ese se cambia aparte.
  if (logoUrl) {
    for (const icono of document.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"], link[rel="icon"]')) {
      icono.href = logoUrl;
    }
  }
}
