// Service worker mínimo: sólo existe para que el navegador ofrezca "instalar
// app" (PWA) y para recibir/mostrar las notificaciones push de recordatorios
// de tareas -- no cachea nada de la app (los datos son siempre en vivo desde
// Supabase, cachear el HTML/JS viejo causaría más problemas que beneficios
// en un sistema que cambia seguido).

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
