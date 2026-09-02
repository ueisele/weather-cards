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
import { ICON_SIZES, iconKey } from "./icon"
import { MANIFEST_KEY, versionToken, type Manifest } from "./manifest"

/** The icons live at a stable path, and Cloudflare edge-caches `.png` by extension for four hours.
 *  Without a token a redesigned icon reaches nobody until that expires — measured: the edge served
 *  the previous one for 811 seconds after a deploy that had replaced it. */
export function iconUrl(manifest: Manifest, size: number) {
  return `${iconKey(size)}?v=${encodeURIComponent(versionToken(new Date(manifest.generated_at)))}`
}

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
  // The icons are part of what an installed copy needs.
  // The page is not in this list. A navigation asks for `/`, not for `index.html`, and the worker
  // caches the document under the URL the browser actually used — listing it here as well stored
  // the same 56 KB twice under two spellings.
  const urls = new Set<string>([MANIFEST_KEY, WEBMANIFEST_KEY,
    ...ICON_SIZES.map((size) => iconUrl(manifest, size))])
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
    icons: ICON_SIZES.map((size) => ({
      src: iconUrl(manifest, size), sizes: `${size}x${size}`, type: "image/png",
      // `any maskable` because the icon is a full square with nothing near an edge: a launcher may
      // crop it to whatever shape it likes without losing the curve.
      purpose: "any maskable",
    })),
    // The manifest holds one colour and the page has two; these are the light values, and the page
    // carries a `theme-color` per scheme, which is what a browser reads first.
    background_color: "#f4f6f8",
    theme_color: "#f4f6f8",
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
//   2. **The whole almanac is kept.** Only when asked, and only the theme on the screen: about
//      8.5 MB of the 17 the run holds in both. A new run every hour, so an automatic full fetch
//      would spend mobile data unnoticed. The page sends two lists — what to hold, and everything
//      the run references — because eviction is judged against the second and downloading against
//      the first.

var CACHE = "almanac";
var STATE = "https://almanac.invalid/keep";
// Where a new run's page waits until the run behind it is actually held. See promote().
var STAGED = "https://almanac.invalid/staged";

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
    if (!/\\.(png|webp|svg|json)(\\?|$)/.test(href)) continue;
    await cache.delete(stored[i]);
    removed++;
  }
  return removed;
}

/** Fetch the whole run into the cache, one at a time. Eighty-odd parallel requests is a burst a
 *  phone on a weak signal handles worse than a queue, and nothing is waiting on the result. */
async function keepAll(urls, all) {
  var cache = await caches.open(CACHE);
  var got = 0;
  var missed = 0;
  // **Before the first fetch, not after the fifth.** The page has no other way to know a refresh
  // has started: on a load it posts refresh and then waits, and until something comes back the
  // control still reads as off. Five URLs is a second or two on a phone, and a control that does
  // nothing for two seconds is one that looks broken.
  await report({ type: "progress", done: 0, total: urls.length });
  for (var i = 0; i < urls.length; i++) {
    try {
      var already = await cache.match(urls[i]);
      if (!already) await cache.add(new Request(urls[i], { cache: "reload" }));
      got++;
      missed = 0;
    } catch (error) {
      // **Three in a row and stop.** One object that will not come is a bad file — a map carried
      // over from an earlier run, say — and the other ninety-odd are still worth having. Three
      // consecutively is not a file, it is the connection, and grinding through the rest is a
      // hundred attempts to wake the radio for nothing.
      //
      // This is the guard that matters, because navigator.onLine only lies in one direction:
      // it says "online" for any live interface, which on a mountain means one bar and no route.
      // The check before this one catches the honest case cheaply; this one catches the rest.
      missed++;
      if (missed >= 3) {
        // The parked page belongs to a run that did not arrive. Dropping it is not required —
        // the next load parks a new one over it — but leaving 70 KB of a page nobody will ever
        // be shown is untidy in the one place where space is someone else's phone.
        await cache.delete(STAGED);
        await report({ type: "stalled", done: i + 1, total: urls.length, got: got });
        return;
      }
    }
    if ((i + 1) % 5 === 0 || i + 1 === urls.length) {
      await report({ type: "progress", done: i + 1, total: urls.length });
    }
  }
  // Only evict once the new run can stand on its own. An aborted refresh never reaches four fifths,
  // so the previous run survives without needing a rule of its own.
  var complete = got >= urls.length * 0.8;
  // **Evict against everything this run references, not against what was fetched.** The two lists
  // differ by a theme: only one is downloaded, but the other's images are legitimate — opportunistic
  // copies of charts that were actually looked at, and the sibling a switched theme falls back on.
  // Evicting by the fetch list would delete them on the next load.
  if (complete) {
    await promote();
    await evict(all || urls);
  }
  await report({ type: "kept", total: urls.length, got: got, complete: complete });
}


/** The same chart in the other theme. Only one theme is kept, so a system that flips to dark at
 *  sunset would otherwise find nothing — and a chart in the wrong colours beats a broken image by
 *  a distance. The keys differ in one suffix and nothing else, which is what makes this safe. */
function sibling(href) {
  // The extension is open: the charts are WebP, and an entry a run could not redraw keeps the PNG
  // it was published as.
  if (/-dark\\.(png|webp)/.test(href)) return href.replace(/-dark\\.(png|webp)/, "-light.$1");
  if (/-light\\.(png|webp)/.test(href)) return href.replace(/-light\\.(png|webp)/, "-dark.$1");
  return null;
}

/**
 * **The page and the images it names change together, or not at all.**
 *
 * Without this the swap is not atomic and the reader loses by it. The document is network-first, so
 * a reload writes the new page into the cache immediately — and the new page names URLs with a new
 * \`?v=\` on every one of them. If the signal then dies at image twenty of forty-three, the cache
 * holds a page pointing at twenty-three things that are not there. The previous run's images are
 * still on disk, untouched, and unreachable: nothing names them any more.
 *
 * So a fresh page is parked here instead, and only becomes *the* page once its run has been
 * fetched. A refresh that breaks off leaves the cache exactly as it was — the previous page, the
 * previous images, complete and consistent — and tries again on the next load.
 *
 * Only while a copy is being kept. With the switch off there is no run to be consistent with, the
 * reader holds whatever they happened to look at, and parking the page would just make it stale.
 */
async function stage(response, url) {
  var headers = new Headers(response.headers);
  // The cache key cannot be the document's own URL — that is the entry being protected — so the
  // address it is destined for rides along inside it.
  headers.set("x-document-url", url);
  var body = await response.blob();
  var cache = await caches.open(CACHE);
  await cache.put(new Request(STAGED), new Response(body, {
    status: response.status, statusText: response.statusText, headers: headers,
  }));
}

async function promote() {
  var cache = await caches.open(CACHE);
  var staged = await cache.match(STAGED);
  if (!staged) return false;
  var url = staged.headers.get("x-document-url");
  await cache.delete(STAGED);
  if (!url) return false;
  await cache.put(new Request(url), staged);
  return true;
}

/** One \`cache.keys()\` and a set, rather than a \`match\` per URL: the answer is the same and it is
 *  one trip to storage instead of ninety-four. */
async function status(urls) {
  var cache = await caches.open(CACHE);
  var on = await keeping();
  var stored = {};
  (await cache.keys()).forEach(function (request) { stored[request.url] = true; });
  var have = 0;
  urls.forEach(function (url) { if (stored[new URL(url, self.location.href).href]) have++; });
  await report({ type: "status", keeping: on, have: have, total: urls.length });
}

self.addEventListener("message", function (event) {
  var data = event.data || {};
  var urls = data.urls || [];
  // Everything the run references, and the part of it worth downloading — one theme's images, the
  // maps, the icons. The page decides which; here they are just two lists with different jobs.
  var keep = data.keep || urls;
  if (data.type === "keep") {
    event.waitUntil(caches.open(CACHE).then(function (cache) {
      return cache.put(STATE, new Response("on"));
    }).then(function () { return keepAll(keep, urls); }));
  } else if (data.type === "forget") {
    event.waitUntil(caches.delete(CACHE).then(function () {
      return report({ type: "status", keeping: false, have: 0, total: urls.length });
    }));
  } else if (data.type === "refresh") {
    // Every load, and the order matters. With the switch on, \`keepAll\` fetches the new run first
    // and evicts afterwards, so a download that dies halfway leaves the previous run intact rather
    // than nothing at all — you keep an older forecast instead of losing the page. Evicting up
    // front is only for the switch-off case, where there is no refetch to protect and the
    // opportunistic cache still has to stay bounded.
    // **Offline, do neither.** \`keepAll\` forces a network request per URL — ninety-four attempts
    // to wake the radio, ninety-four exceptions caught, in the situation where the battery matters
    // most. And there is nothing to evict: the list came from a page served out of this same cache.
    event.waitUntil(keeping().then(function (on) {
      if (!navigator.onLine) return status(keep);
      return on ? keepAll(keep, urls) : evict(urls).then(function () { return status(keep); });
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
      // **Offline, do not even ask.** The document is served with max-age=300, so for five minutes
      // after a reload the browser's own HTTP cache can answer \`fetch\` without a network — and
      // that answer would be the new page whose images were never fetched. Going straight to the
      // cache here is what keeps the swap atomic in the minutes when it matters most.
      if (!navigator.onLine) {
        var offline = await caches.match(request, { ignoreSearch: true });
        if (offline) return offline;
      }
      try {
        // **no-store, and it is not tidiness.** The document carries max-age=300, so for five
        // minutes after a load the browser's own HTTP cache answers a plain fetch with no network
        // at all — measured: offline, fetch("/") returns 200 while fetch("/", {cache:"no-store"})
        // fails. That 200 is the new page, whose images were never fetched, and serving it is the
        // half-swapped state this whole mechanism exists to prevent. Nothing is lost by asking:
        // the document is network-first anyway, and the check above means we only get here with a
        // connection worth trying.
        var fresh = await fetch(request.url, {
          cache: "no-store", credentials: "same-origin", redirect: "follow",
        });
        var cache = await caches.open(CACHE);
        var held = await caches.match(request, { ignoreSearch: true });
        // Nothing to protect yet, or nothing promised: cache it and be done. Otherwise it waits.
        if (!held || !(await keeping())) await cache.put(request, fresh.clone());
        else await stage(fresh.clone(), request.url);
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
  if (/\.(png|webp|svg)$/.test(url.pathname)) {
    event.respondWith((async function () {
      var cached = await caches.match(request);
      if (cached) return cached;
      try {
        var fresh = await fetch(request);
        if (fresh.ok) {
          var cache = await caches.open(CACHE);
          await cache.put(request, fresh.clone());
        }
        return fresh;
      } catch (error) {
        // Offline and not held: the other theme's copy of this chart is the same forecast, and it
        // is what makes keeping one theme safe when the system can switch the other on by itself.
        var other = sibling(request.url);
        var swap = other ? await caches.match(other) : null;
        if (swap) return swap;
        // And failing that, any run's copy of the same image: the URL differs only in its \`?v=\`,
        // so ignoring the query finds the one held before this run. A forecast an hour older beats
        // a hole in the page, and this is the net under the 80 % that lets a refresh count as done.
        var older = await caches.match(request, { ignoreSearch: true });
        if (older) return older;
        throw error;
      }
    })());
  }
});
`.trimStart()
