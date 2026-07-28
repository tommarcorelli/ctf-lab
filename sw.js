// sw.js — mise en cache minimale pour jouer hors-ligne (aucune dépendance)
const CACHE_NAME = "ctf-lab-cache-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./css/neon.css",
  "./js/i18n.js",
  "./js/machines.js",
  "./js/engine.js",
  "./js/app.js",
  "./js/lab-ui.js",
  "./assets/hero-bg.png",
  "./assets/hub-bg.png",
  "./assets/icon-web.png",
  "./assets/icon-crypto.png",
  "./assets/icon-pwn.png",
  "./manifest.json",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stratégie : RÉSEAU d'abord, cache en secours (hors-ligne).
// => tu vois toujours la dernière version quand tu es en ligne ; le cache ne sert
//    que de repli quand il n'y a pas de réseau. Fini le « rien ne change ».
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // on ne touche pas à l'externe
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
