// Service worker: makes the app installable and lets it open offline.
// Network first, so every push shows up right away; the cache is only a fallback when offline.
// "no-cache" makes the browser check with the server each time (a quick 304 when nothing changed) instead of
// reusing its own copy, which GitHub Pages lets it keep for 10 minutes: long enough to run old code after a push.
const CACHE = "study-spots-v3";
const SHELL = [
  "./", "index.html", "styles.css", "src/app.js", "src/logic.js", "src/hours.js",
  "data/spots.json", "data/buildings.json", "data/calendar.json", "data/photos.json",
  "manifest.webmanifest", "icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Only handle this site's own files. Library hours, map tiles and CDN scripts go straight to the network
  // (the app caches library hours itself).
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html"))),
  );
});
