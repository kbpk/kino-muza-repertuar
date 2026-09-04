const CACHE = "muza-viewer";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./lib.js"];

self.addEventListener("install", (event) => {
  const files = SHELL.map((path) => new Request(path, { cache: "reload" }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(files)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const pathname = new URL(event.request.url).pathname;
  const isPoster = pathname.includes("/media/posters/");
  if (isPoster) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then(async (response) => {
      if (response.ok) await (await caches.open(CACHE)).put(event.request, response.clone());
      return response;
    })));
    return;
  }
  event.respondWith(
    fetch(event.request, { cache: "no-cache" }).then(async (response) => {
      if (response.ok) await (await caches.open(CACHE)).put(event.request, response.clone());
      return response;
    }).catch(() => caches.match(event.request)),
  );
});
