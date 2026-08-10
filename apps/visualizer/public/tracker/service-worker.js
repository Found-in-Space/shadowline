const APP_ROOT = new URL(self.registration.scope);
const TRACKER_SLUG = APP_ROOT.pathname.split("/").filter(Boolean).at(-1) || "tracker";
const CACHE_PREFIX = `shadowline-tracker-${TRACKER_SLUG}-`;
const CACHE_NAME = `${CACHE_PREFIX}v12`;

async function appShellUrls() {
  const response = await fetch(APP_ROOT, { cache: "reload" });
  if (!response.ok) throw new Error(`App shell returned ${response.status}.`);
  const html = await response.text();
  const urls = [APP_ROOT.href, new URL("./manifest.webmanifest", APP_ROOT).href];
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/g)) {
    const url = new URL(match[1], APP_ROOT);
    if (url.origin === self.location.origin) urls.push(url.href);
  }
  for (const scriptUrl of urls.filter((url) => url.endsWith(".js"))) {
    const script = await fetch(scriptUrl, { cache: "reload" });
    if (!script.ok) continue;
    const source = await script.text();
    for (const match of source.matchAll(/tracker-worker-[A-Za-z0-9_-]+\.js/g)) {
      urls.push(new URL(match[0], scriptUrl).href);
    }
  }
  return [...new Set(urls)];
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    appShellUrls()
      .then(async (urls) => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(urls);
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (
    url.hostname === "data.foundin.space" &&
    (url.pathname === "/api/v1/time" || url.pathname === "/api/v1/location")
  ) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(APP_ROOT, response.clone());
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match(APP_ROOT))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then(async (response) => {
        if (response.ok || response.type === "opaque") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      });
    }),
  );
});
