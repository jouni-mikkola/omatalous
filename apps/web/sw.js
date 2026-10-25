/**
 * The service worker. It keeps the files of the app (the page, its scripts, styles, fonts and icons) so that the app
 * opens when the server cannot be reached. It never touches /api/: what a signed-in member sees offline is kept by the
 * page itself, for one user at a time, and is deleted at logout (src/offline.ts). The vite plugin shellWorker fills in
 * SHELL at build time: a cache named by the content of the files, and the files.
 */
const SHELL = __SHELL__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL.name).then((cache) => cache.addAll(SHELL.files)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith("shell-") && n !== SHELL.name).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    // the network first, so a new version opens at once; the kept page when the server is down or a proxy in front of it answers with an error
    event.respondWith(
      fetch(request).then(
        (res) => (res.status >= 500 ? kept("/index.html", res) : res),
        () => kept("/index.html"),
      ),
    );
    return;
  }
  // the files are named by their content, so a kept one is never stale
  event.respondWith(caches.match(request, { cacheName: SHELL.name }).then((hit) => hit ?? fetch(request)));
});

async function kept(path, otherwise) {
  const hit = await caches.match(path, { cacheName: SHELL.name });
  return hit ?? otherwise ?? Response.error();
}
