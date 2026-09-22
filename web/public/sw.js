// Service worker: "instalar app" (PWA), notificaciones push y, desde el
// 22-sep-2026, el cascarón de la app disponible sin señal para que el
// checador pueda guardar marcas offline (ver Checador.tsx / colaOffline.ts).
//
// Qué se cachea y cómo:
//   - Navegaciones (HTML): red primero; si no hay red, la última copia de
//     index.html. Así la app nunca se queda con HTML viejo teniendo señal.
//   - /assets/* (JS/CSS con hash en el nombre): caché primero -- son
//     inmutables, un nombre nuevo es un archivo nuevo.
//   - Todo lo demás (Supabase, funciones): siempre red, nunca caché.
const CACHE = "acumulado-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copia)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match("/index.html").then((r) => r ?? new Response("Sin conexión", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }))),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || /\.(png|svg|webmanifest|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (enCache) =>
          enCache ??
          fetch(req).then((resp) => {
            if (resp.ok) {
              const copia = resp.clone();
              caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
            }
            return resp;
          }),
      ),
    );
  }
});

self.addEventListener("push", (event) => {
  let datos = { titulo: "Acumulado", cuerpo: "Tienes pendientes por revisar.", url: "/tareas" };
  try {
    if (event.data) datos = { ...datos, ...event.data.json() };
  } catch {
    // payload no era JSON -- se usa el mensaje genérico de arriba
  }

  event.waitUntil(
    self.registration.showNotification(datos.titulo, {
      body: datos.cuerpo,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: datos.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
      for (const cliente of lista) {
        if ("focus" in cliente) {
          cliente.navigate(url);
          return cliente.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
