/**
 * The offline half of the site: a service worker and a web app manifest.
 *
 * **Why a worker is needed at all.** The page is served with `max-age=300` — deliberately, because
 * it is the one object whose URL never changes and a stale one would name the previous run's
 * images. Offline, the revalidation that follows those five minutes fails, and the page does not
 * open at all. Not a stale forecast: nothing. Everything else is already solved by the `?v=` token
 * every image URL carries, which is what makes a cached image safe to keep and a new run's image
 * impossible to miss.
 *
 * **Nothing about a run is baked into the worker.** That is what `trails` does, and it is right
 * there because its version is a property of the build. Here it would be a trap twice over:
 * Cloudflare edge-caches by file extension and `.js` is in its default set, so a worker naming a
 * run could outlive it; and a run has no single name anyway, because the `?v=` token is per entry.
 * So the worker is stable and cacheable, and the page — never more than five minutes old — sends
 * it the exact list of URLs that belong in the cache.
 */
import { MANIFEST_KEY, type Manifest } from "./manifest"

export const WORKER_KEY = "sw.js"
export const WEBMANIFEST_KEY = "manifest.webmanifest"

/**
 * Every URL the page can show, exactly as the page writes it.
 *
 * **The token is per entry, not per run.** An entry the run could not redraw keeps the version it
 * was drawn with, so taking `generated_at` for all of them would invent URLs that were never
 * published and 404 the whole precache. The page builds its `?v=` from the entry; so does this.
 */
export function offlineUrls(manifest: Manifest): readonly string[] {
  // The page is not in this list. A navigation asks for `/`, not for `index.html`, and the worker
  // caches the document under the URL the browser actually used — listing it here as well stored
  // the same 56 KB twice under two spellings.
  const urls = new Set<string>([MANIFEST_KEY])
  const add = (key: string, version: string) => urls.add(`${key}?v=${encodeURIComponent(version)}`)
  // A map key already carries a content hash, and the page links it bare. Adding a token here
  // would invent a URL that was never published — and the precache would 404 on every map.
  const plain = (key: string) => urls.add(key)
  for (const place of manifest.places) {
    for (const card of [place.spread, ...place.models]) {
      for (const key of Object.values(card.keys)) add(key, place.version)
    }
    if (place.map) { plain(place.map.image); plain(place.map.full) }
  }
  for (const group of manifest.groups) {
    for (const key of Object.values(group.comparison.keys)) add(key, group.version)
    if (group.map) { plain(group.map.image); plain(group.map.full) }
  }
  return [...urls]
}

export function renderWebmanifest(manifest: Manifest): string {
  return JSON.stringify({
    name: manifest.site.title,
    short_name: manifest.site.title,
    description: manifest.site.tagline ?? undefined,
    start_url: ".",
    scope: ".",
    display: "standalone",
    // The charts decide their own theme from the system, so the shell must not assert one.
    background_color: "#ffffff",
    theme_color: "#ffffff",
  }, undefined, 2)
}

/**
 * The worker. Plain ES5-ish JavaScript in a template literal rather than a compiled module: it has
 * to be readable in the browser's devtools next to the page that registered it, and it is short
 * enough that a build step would only add a place for it to go wrong.
 */
export const WORKER_SOURCE = `
// The almanac's service worker. Written by the build; the run it should hold comes from the page,
// not from here, so this file is stable and may be edge-cached without stranding anybody.
//
// **One cache, and the page says what belongs in it.** An earlier draft named a cache per run and
// evicted by name, which does not survive contact with the manifest: the \`?v=\` token is per entry,
// so an entry the run could not redraw keeps an older one and a run has no single name. Instead the
// page sends the exact list of URLs it references, and anything else in the cache is by definition
// from a run that is gone. Eviction becomes set difference, which is exact and needs no names.
//
// Two behaviours, deliberately separate:
//
//   1. **The page opens offline.** Always, with no switch. The document is cached on the way past
//      and so is every image actually looked at — those are already downloaded, so keeping them
//      costs nothing but disk.
//   2. **The whole almanac is kept.** Only when asked. About 18 MB across both themes, and a new
//      run every hour, so an automatic full fetch would spend mobile data unnoticed.

var CACHE = "almanac";
var STATE = "https://almanac.invalid/keep";

async function keeping() {
  var cache = await caches.open(CACHE);
  var answer = await cache.match(STATE);
  return answer ? (await answer.text()) === "on" : false;
}

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (event) { event.waitUntil(self.clients.claim()); });

async function report(message) {
  var clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(function (client) { client.postMessage(message); });
}

/** Everything the page no longer references is from a run that is gone. The switch entry and the
 *  page itself are not in that list and are kept explicitly. */
async function evict(urls) {
  var cache = await caches.open(CACHE);
  var wanted = {};
  urls.forEach(function (u) { wanted[new URL(u, self.location.href).href] = true; });
  wanted[STATE] = true;
  var stored = await cache.keys();
  var removed = 0;
  for (var i = 0; i < stored.length; i++) {
    var href = stored[i].url;
    if (wanted[href]) continue;
    // The document is not in the list — a navigation is cached under whatever URL the browser
    // asked for, and that is the copy worth keeping. Recognise it by shape rather than by name.
    if (!/\\.(png|svg|json)(\\?|$)/.test(href)) continue;
    await cache.delete(stored[i]);
    removed++;
  }
  return removed;
}

/** Fetch the whole run into the cache, one at a time. Eighty-odd parallel requests is a burst a
 *  phone on a weak signal handles worse than a queue, and nothing is waiting on the result. */
async function keepAll(urls) {
  var cache = await caches.open(CACHE);
  for (var i = 0; i < urls.length; i++) {
    try {
      var already = await cache.match(urls[i]);
      if (!already) await cache.add(new Request(urls[i], { cache: "reload" }));
    } catch (error) {
      // One image that will not come is not a reason to abandon the other ninety-three.
    }
    await report({ type: "progress", done: i + 1, total: urls.length });
  }
  await evict(urls);
  await report({ type: "kept", total: urls.length });
}

async function status(urls) {
  var cache = await caches.open(CACHE);
  var on = await keeping();
  var have = 0;
  for (var i = 0; i < urls.length; i++) if (await cache.match(urls[i])) have++;
  await report({ type: "status", keeping: on, have: have, total: urls.length });
}

self.addEventListener("message", function (event) {
  var data = event.data || {};
  var urls = data.urls || [];
  if (data.type === "keep") {
    event.waitUntil(caches.open(CACHE).then(function (cache) {
      return cache.put(STATE, new Response("on"));
    }).then(function () { return keepAll(urls); }));
  } else if (data.type === "forget") {
    event.waitUntil(caches.delete(CACHE).then(function () {
      return report({ type: "status", keeping: false, have: 0, total: urls.length });
    }));
  } else if (data.type === "refresh") {
    // Every load. Evicting the previous run happens whether or not the switch is on, so an
    // opportunistic cache cannot grow without bound; the full fetch happens only if it is on.
    event.waitUntil(evict(urls).then(function () {
      return keeping().then(function (on) { return on ? keepAll(urls) : status(urls); });
    }));
  }
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // **The document is network-first**: a forecast one reload old is the whole point of reloading.
  // The cache is the fallback and is written on the way past, so the next visit without signal has
  // something to open.
  if (request.mode === "navigate") {
    event.respondWith((async function () {
      try {
        var fresh = await fetch(request);
        var cache = await caches.open(CACHE);
        await cache.put(request, fresh.clone());
        return fresh;
      } catch (error) {
        var cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        return new Response("Offline, and this page has not been opened here before.\\n",
          { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  // **Images are cache-first**, and safely so: the \`?v=\` token means a URL names one run's image
  // and can never come to mean another's, and a map name carries its own content hash. A hit is
  // the right answer rather than a stale one. Kept whether or not the switch is on — the bytes
  // have already crossed the network by then, and the next load evicts what the run dropped.
  if (/\.(png|svg)$/.test(url.pathname)) {
    event.respondWith((async function () {
      var cached = await caches.match(request);
      if (cached) return cached;
      var fresh = await fetch(request);
      if (fresh.ok) {
        var cache = await caches.open(CACHE);
        await cache.put(request, fresh.clone());
      }
      return fresh;
    })());
  }
});
`.trimStart()
