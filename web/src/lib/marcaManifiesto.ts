// El manifiesto de la PWA, armado con la marca de cada organización. Módulo
// puro (sin Supabase ni DOM) para poder probarlo con node --test, igual que
// el resto de lib/.
//
// Por qué existe: un cliente instala la aplicación desde el navegador, y lo
// que queda debajo del icono en su teléfono es el `name` del manifiesto. Con
// un manifiesto estático ese nombre es el de otra empresa -- que fue lo que
// pasó con ARSSA el 25-sep-2026: a Aldo le aparecía "Grupo Loma".

const MANIFIESTO_BASE = {
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#f8fafc",
  theme_color: "#0f172a",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

export function manifiestoDeMarca(nombre: string, logoUrl: string | null): Record<string, unknown> {
  const limpio = nombre.trim() || "Acumulado";
  return {
    ...MANIFIESTO_BASE,
    name: limpio,
    short_name: limpio.length > 12 ? limpio.slice(0, 12).trim() : limpio,
    description: `Backoffice de ${limpio}`,
    // El logotipo de la organización se agrega ADEMÁS de los iconos de la
    // plataforma, no en lugar de ellos: si es un SVG o no tiene el tamaño que
    // pide el sistema, el teléfono se queda con los que sí sirven.
    icons: logoUrl
      ? [...MANIFIESTO_BASE.icons, { src: logoUrl, sizes: "512x512", type: "image/png", purpose: "any" }]
      : MANIFIESTO_BASE.icons,
  };
}
