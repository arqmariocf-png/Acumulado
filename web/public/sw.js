// Service worker mínimo. Existe por una sola razón: el navegador no ofrece
// instalar una aplicación que no tenga uno con manejador de `fetch`.
//
// A propósito NO cachea nada. Un caché mal invalidado en una aplicación que
// maneja dinero es peor que no tener caché: el usuario ve saldos viejos sin
// saberlo, o se queda con una versión anterior después de un despliegue. Si
// más adelante se quiere trabajo sin conexión, se hace con una estrategia
// explícita y versionada, no dejando que esto crezca solo.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (evento) => evento.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (evento) => {
  evento.respondWith(fetch(evento.request));
});
