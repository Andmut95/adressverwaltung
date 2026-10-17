// Service Worker: hält die App-Dateien für den Offline-Betrieb bereit.
// Zuerst Netz (neue Version), bei fehlender Verbindung aus dem Zwischenspeicher.
const CACHE = "adressen-v2";
const DATEIEN = ["./", "index.html", "style.css", "pruefung.js", "speicher.js", "app.js", "konfig.js",
  "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "datenschutz.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/")) return;
  e.respondWith(fetch(e.request).then((r) => {
    const kopie = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, kopie));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
