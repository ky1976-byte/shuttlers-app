/* Shuttlers BC service worker: offline shell + push display */
const CACHE = "shuttlers-v1";
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
self.addEventListener("push", (e) => {
  const data = e.data ? e.data.json() : { title: "Shuttlers BC", body: "" };
  e.waitUntil(self.registration.showNotification(data.title || "Shuttlers BC", {
    body: data.body || "", icon: "/icon-192.png", badge: "/icon-192.png",
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow("/"));
});
