# Making a static site open offline, stay fresh, and install to a home screen

What was built for `almanac.cairn.zone`, written so it can be built again elsewhere. The working
code is in `weather-cards/scripts/lib/offline.ts` and `page.ts`; this is the shape and the traps.

---

## 1. Why a worker is needed at all

Not for offline *content* — for the page opening at all.

A document served with `Cache-Control: max-age=300` must be revalidated after five minutes. Offline
that revalidation fails, and the browser shows its error page. **Not a stale page: nothing.** Every
image may still be in the browser cache and it makes no difference.

So the first job of the worker is one line of behaviour: serve the document from cache when the
network cannot answer.

## 2. Version every asset URL, and only the document stays unversioned

```html
<img src="chart.png?v=20260902T075434Z">
```

This one decision removes most of the problem:

- A cached asset can **never** be stale, because a URL names one build's version of it. Cache-first
  for assets is then correct rather than a compromise.
- A new build is a new URL, so nothing has to be invalidated.
- The document is the only thing that must be fresh, and it is small.

**Give the token to the icons too.** Cloudflare edge-caches by extension — `.png`, `.js` are in its
default set, four hours. An icon at a stable path is therefore *not* updatable: measured
`cf-cache-status: HIT`, `age: 811` serving the previous icon after a deploy had replaced it. Someone
installing to a home screen in that window keeps the old icon permanently, because iOS never
revisits it.

**Do not version the service worker itself.** Its URL must be stable for the browser to notice
updates, and it must not name a build it could outlive at the edge. Keep it free of build data — see
§4.

## 3. The worker

One cache. The page tells it what belongs there.

```js
var CACHE = "sitename"
var STATE = "https://sitename.invalid/keep"   // the switch, as a cache entry
```

**The switch lives in the cache, not in a variable.** A worker is started for a fetch and stopped
again; a variable would be true on the first request of a visit and false on the second. It cannot
use `localStorage` either.

### Fetch

```js
// Document: network-first, cache as it passes, cache as fallback.
if (request.mode === "navigate") { try { fresh = await fetch(request); cache.put(...); return fresh }
                                   catch { return await caches.match(request, {ignoreSearch:true}) ?? offlineResponse } }

// Assets: cache-first, safely, because of the ?v= token. Kept whether or not the switch is on —
// the bytes already crossed the network.
if (/\.(png|svg)$/.test(url.pathname)) { return await caches.match(request) ?? await fetchAndStore(request) }
```

### Eviction is set difference

The page posts the exact list of URLs it references. **Anything else in the cache is from a build
that is gone.** No cache names per version, no bookkeeping — and it survives the awkward case where
different assets carry different tokens (a page that keeps some entries from an earlier build).

```js
async function evict(urls) {
  const wanted = new Set(urls.map(u => new URL(u, location.href).href).concat([STATE]))
  for (const request of await cache.keys()) {
    if (wanted.has(request.url)) continue
    if (!/\.(png|svg|json)(\?|$)/.test(request.url)) continue   // leave the document alone
    await cache.delete(request)
  }
}
```

### The page and the images it names change together, or not at all

Versioned asset URLs make a cached image safe, and then quietly create the worst bug in this file.
**The document is the only unversioned thing, so replacing it is what makes every other URL change
at once.** Network-first caches it the moment a reload succeeds — and if the connection then dies
part-way through fetching the build it names, the cache holds a page pointing at things that were
never stored. The previous build's images are still on disk, untouched and unreachable, because
nothing names them any more.

Park the fresh document instead, and promote it only when its build is held:

```js
// navigate: return the fresh page to the browser, but do not let it become *the* page yet
if (!held || !keeping) await cache.put(request, fresh.clone())   // nothing to protect, or nothing promised
else await stage(fresh.clone(), request.url)                     // a fixed key + the URL in a header

// at the end of a successful keepAll
await promote()          // staged -> the document's own key
await evict(all)
```

A refresh that breaks off then leaves the cache exactly as it was — previous page, previous images,
consistent — and tries again next load. Two conditions matter: the *first* document a worker ever
caches goes straight in, because there is nothing to protect; and with full caching switched off,
park nothing, because there is no build to be consistent with and a parked page would only go stale.

**Fetch the document `no-store`, and this is not tidiness.** With `max-age=300` the browser's own
HTTP cache answers `fetch()` for five minutes with no network at all — measured: offline,
`fetch("/")` returns 200 while `fetch("/", {cache: "no-store"})` fails. That 200 is the new page
whose images were never fetched. Nothing is lost by asking: a network-first document was always
going to the network.

**And put a net under it.** An image that misses the cache and cannot be fetched can fall back to
any build's copy of itself — `caches.match(request, {ignoreSearch: true})` finds the same path under
an older token. A page an hour stale beats a hole in it.

### Testing this is harder than writing it

Two things that cost an hour here, both about the harness rather than the code:

- **Playwright's `route` and `setOffline` do not reach a service worker's own fetches.** A rewritten
  document never arrives, and "offline" is only offline for the page. A new build has to be written
  to disk for real, and the network taken away by stopping the server.
- **The first navigation is not cached**, because the worker does not control the page yet. A test
  that loads once and then publishes a new build is testing the case where there is nothing to
  protect — which correctly caches the new page at once, and looks exactly like the bug.

### Fetch before you evict — and only evict on success

This is the bug worth not writing. The first version evicted, then downloaded. A new build reaching
a phone on a dying signal therefore **deleted the copy it was standing on**.

```js
async function keepAll(urls) {
  let got = 0
  for (const url of urls) { try { if (!await cache.match(url)) await cache.add(new Request(url, {cache: "reload"})); got++ } catch {} }
  if (got >= urls.length * 0.8) await evict(urls)     // only once the new build can stand alone
}
```

A half-failed refresh then leaves two builds in the cache until the next good one. Bounded, and much
the cheaper mistake.

### The switch, and what is automatic

- **Always on, no switch:** the page opens offline, with the document and whatever assets were
  actually viewed. Costs nothing — those bytes had already been fetched.
- **Behind a switch:** keeping the *whole* site. Because a full build here is ~17 MB and there is a
  new one every hour; automatic, that is mobile data spent unnoticed.

Measure your own numbers before choosing. A normal visit is far less than a full build if the page
uses `loading="lazy"`, `<picture>` with one theme fetched, and collapsed `<details>` — here 3.3 MB
against 17 MB.

### Keep one variant, and make the other one a fallback

If assets exist per theme — a chart drawn light and dark — half of what a precache fetches is never
looked at. **Fetch the variant on screen; 8.5 MB here instead of 17.**

Two things make that safe rather than a bet on the reader not switching:

**Send two lists.** What to fetch, and everything the build references.

```js
post({type: "refresh", urls: ALL, keep: forTheme(themeNow())})   // and in the worker:
keepAll(keep, ALL)   // fetch the first, evict against the second
```

Eviction must stay set difference against the *whole* build. Narrowing it to the fetch list would
delete the other theme's images the moment they were legitimately cached — an opportunistic copy of
something actually viewed. Switch theme twice and both halves are held; nothing is thrown away.

**Fall back to the sibling.** The theme can change under a kept copy — the switch, or a system that
goes dark at sunset — and offline there is nothing to fetch. If the keys differ in one suffix and
nothing else, the worker can serve the other one:

```js
catch (error) {                                   // image missed the cache and the network failed
  const other = url.replace("-dark.png", "-light.png")   // or the reverse
  const swap = await caches.match(other)
  if (swap) return swap
  throw error
}
```

A chart in the wrong colours, rather than a broken image. Without this, "follow the system" would
have had to keep both variants, and the saving would apply only to readers who had picked a theme
by hand — which is nobody, by default.

Re-post when the theme changes and there is a connection, so the half now on screen arrives at once
rather than at the next load.

## 4. Two MIME traps that cost an afternoon

**`sw.js` must arrive as JavaScript.** Served as `application/octet-stream`, `register()` fails with
a bare `SecurityError` that is indistinguishable from "this browser has no worker". Add `.js` and
`.webmanifest` to whatever MIME table the preview server and the deploy each use — **both**, or it
works locally and breaks deployed, or the reverse.

**Check the deploy actually uploads them.** They are not in the content manifest, so a deploy that
walks the manifest will skip them and report them as untouched files. Ours printed "left alone"
about the very files it should have been uploading.

## 5. Staying fresh when installed to a home screen

There is no address bar and no reload control, and iOS often resumes a suspended page rather than
loading it. An app opened on the fourth day of a trip can show the first day's forecast.

**Put in a reload button, and stop there.**

```js
reload.addEventListener("click", () => location.reload())
```

An automatic reload on `visibilitychange` — guarded by staleness and a quiet window — was built
here and then removed, and the reason generalises. **A reload is not a cheap act when a worker is
listening.** It fetches a document whose asset URLs name a new build, the page hands that list to
the worker, and if full-site caching is on the worker fetches the difference: here 18 MB, over
whatever connection happens to be attached. A rule nobody invoked can therefore spend a data
allowance, which is the exact thing the caching switch existed to prevent.

Where battery and data outrank freshness — anything used away from power — the honest design is:

- **an age indicator**, so being out of date is visible rather than silent;
- **a manual reload**, so acting on that is one tap;
- **nothing on a timer, and nothing on resume.**

The page in the foreground then touches the network never, which is a property you can assert and
measure rather than a budget you hope you stayed inside.

### The age indicator, and the trap inside it

A displayed age needs a timer to stay true, and the naive `setInterval(…, 5 * 60_000)` is twelve
wake-ups an hour to redraw a string that changes once. **Let the formatter say when its own answer
expires**, and sleep exactly that long:

```js
function age() {
  const hours = (Date.now() - Date.parse(GENERATED)) / 3600000
  const text = hours < 1 ? "now" : hours < 48 ? Math.round(hours) + " h" : Math.round(hours / 24) + " d"
  const marks = [1, 6, 24, 48]                                     // format and colour thresholds
  if (hours >= 1 && hours < 48) marks.push(Math.floor(hours - 0.5) + 1.5)
  if (hours >= 48) marks.push((Math.floor(hours / 24 - 0.5) + 1.5) * 24)
  const next = Math.min(...marks.filter((m) => m > hours))
  return { text, until: Math.max(60_000, (next - hours) * 3600000) }
}
```

**The boundaries are not the round numbers they look like.** `Math.round` steps at 1.5 h, 2.5 h, …
— not on the hour — while a colour threshold at 6 h does step on the hour, and the two rounding
steps belong to different bands. Adding both unconditionally put a mark half an hour early in every
hour of the first two days: a wake-up for a redraw that changed nothing.

Sweep it rather than reasoning about it. One-minute steps across the whole range, asserting that
nothing changes before `until` and something changes just after — 7201 samples, and the first
version failed 4321 of them.

And clear the timer on `visibilitychange`, so nothing ticks behind a locked screen.

## 6. Energy: what a cached site still costs

A site that works offline is used offline, which means it is used where there is no charger. The
cache does not make it free — it moves the cost from the network to the CPU and the radio, and a
worker is very good at generating work nobody asked for. Five things were found here, and four of
them only exist *because* of the offline machinery.

### The radio is the expensive one, and offline is when it costs most

```js
// The refresh that runs on every load.
if (!navigator.onLine) return status(urls)          // ← the whole fix
return keeping ? keepAll(urls) : evict(urls)
```

Without that line, a load with the caching switch on ran `keepAll` regardless — and `keepAll`
issues `cache.add(new Request(url, {cache: "reload"}))` per URL, which is a *forced* network
request that ignores the cache by design. Offline that is ninety-odd attempts to wake a radio that
has nothing to talk to, and ninety-odd exceptions caught, in exactly the situation where the
battery matters most. There was nothing to evict either: the URL list came from a page that had
just been served out of the same cache.

**`navigator.onLine` only lies in one direction**, which is what makes it usable here. It reports
true for any live interface, so it says "online" on a mountain with one bar and no route — but when
it says false, there really is nothing. So it is a cheap filter for the honest case and not a
guarantee, and it needs a second guard behind it.

### Give up on the connection, not on the file

```js
catch (error) {
  missed++
  if (missed >= 3) { await report({type: "stalled", …}); return }   // three in a row and stop
}
```

One object that will not come is a bad file — a leftover from an earlier build, say — and the other
ninety are still worth having. **Three consecutively is not a file, it is the connection**, and
grinding through the rest is a hundred more attempts to wake the radio for nothing. `missed` resets
on every success, so a scatter of individually bad URLs never trips it.

This runs whether or not `navigator.onLine` agrees, which is the point: it is the guard that catches
the case the flag gets wrong. Verified by pointing the worker at 86 dead URLs — one `stalled`
message after three attempts, instead of 86 failures — while a normal run still completes, because
the genuinely missing files arrive in ones and twos.

### Do not report progress more finely than it is drawn

The worker posted a message per URL; the page renders progress in steps of five. Three quarters of
those client lookups and structured clones were for figures nobody saw — during the one phase
already spending 18 MB, so it hid inside a bigger number. **21 messages instead of 98.**

`postMessage` to a client is not free: it is a `clients.matchAll()` and a structured clone per
listener. Report at the resolution the UI has, not the resolution the loop has.

### One trip to storage, not one per item

```js
// Was: await cache.match(url) for each of 94 URLs, to count how many are held.
const stored = new Set((await cache.keys()).map((r) => r.url))       // one trip
```

Same answer, ninety-three fewer round trips into the Cache API. This is the smallest of the five and
the easiest to write by accident, because `match` per URL is the obvious shape.

### Spend CPU to save the radio, not the other way round

The cache does not change what the bytes cost to fetch — it changes how often. Where a format choice
trades size against decoding, **size wins for anything used away from power**, because a radio costs
joules per megabyte and a decode costs milliwatt-milliseconds.

Lossless WebP instead of PNG, measured over a whole build: **16.60 MB → 8.51 MB, and every image
decodes back to a bitmap identical to the original.** Not "you will not notice" — identical, verified
image by image. The charts in a kept copy went from 8.7 MB to 4.35 MB.

**Measure against the deployed site, not the preview.** The figure above was first taken locally,
where three map images are carried over from the bucket and simply 404 — so the number left out
4.79 MB of the very thing it was measuring. A whole kept copy is 9.18 MB and the maps are more than
half of it. What saved the conclusion is that the maps are content-hashed and carry no version
token, so an unchanged map is a URL already held: the *first* activation costs 9.18 MB and every
run after it costs 4.35 MB. Worth knowing which of those two numbers a claim is about.

The other side, also measured: WebP decodes in 21 ms where PNG takes 11 ms, so reading a page of
thirteen charts spends 130 ms more CPU. One saved refresh pays for dozens of reads. Measure both
halves before deciding; do not take either on faith, and say which engine you measured on.

Two ways to get the encoder wrong:

- **Do not reach for a native npm package** if the project has no dependencies. A system encoder —
  `cwebp` from `libwebp-tools` — sits in `/usr/bin`, which is already on a systemd unit's PATH, and
  costs the build nothing to find.
- **Do not use a toolchain-managed interpreter** for a step a scheduled job runs. A `uv`- or
  `pyenv`-managed Python is on *your* PATH and not on the unit's, and the failure surfaces hours
  later as a job that stopped working.

And pick the effort level by measuring it: `-z 6` was 2.0 s across eight cores for 8.55 MB, `-z 9`
was 47 s for 8.24 MB. Forty-five seconds of eight cores every hour, for 310 KB, is a worse energy
trade than the one being won — the build's own power is part of the sum.

### And nothing on a timer or on resume

See §5. A background tick recalculates a figure nobody is reading; a reload on resume can pull the
whole site over mobile data. Both were removed rather than tuned.

### What was deliberately left alone

- **Decoding the images.** They are 1920 × 1510 and decoding them is the content; `loading="lazy"`
  and collapsed `<details>` already limit it to what is actually looked at. That is the right lever,
  not the decode itself.
- **Fetching one at a time in `keepAll`.** Ninety parallel requests would finish sooner but a phone
  on a weak signal handles a queue better, and nothing is waiting on the result.
- **The worker's own lifetime.** It is started for an event and stopped again; there is no daemon to
  economise on.

### How to check it rather than believe it

The claim worth being able to make is absolute, not relative: **after load, the page in the
foreground makes zero network requests.** That is measurable in a few lines.

```js
page.on("request", (r) => seen.push(r.url()))       // after load has settled
// then: go hidden, come back, twice; wait; assert seen.length === 0
```

Count the timers too, by wrapping `setInterval`/`setTimeout` in an init script before any page
script runs. One armed timer with a sensible delay is a result; three, or one at 300000, is a
finding.

## 7. Installing to a home screen (iOS)

```html
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png?v=…">
<meta name="apple-mobile-web-app-title" content="Short">
<meta name="theme-color" content="#f4f6f8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1318" media="(prefers-color-scheme: dark)">
```

- **iOS reads `apple-touch-icon` and ignores the manifest's `icons`.** Without it you get a
  screenshot of the page as the icon. This is the single most common miss.
- **`apple-mobile-web-app-title`**, because the full `<title>` is truncated under an icon.
- **`theme-color` twice**, per scheme — the manifest holds one colour and the browser reads the meta
  first.
- The manifest still matters: `display: standalone`, and **a home-screen web app is exempt from
  Safari clearing its storage after about seven days of non-use**. For a multi-week trip that
  exemption is the entire reason to install rather than bookmark.

The install is Share → Add to Home Screen, in Safari only. There is no install prompt.

## 8. Deploying without making everyone re-download

If assets carry a build token and the build stamps a time into them, **rebuilding assets for a
text-only change mints a whole new set of URLs** and every reader with the offline copy fetches
everything again. Separate the two commands — one that rebuilds only the page from the existing
manifest, one that redraws — and use the cheap one for anything that is not a redraw.

The deploy will give no sign: it uploads the same object count either way, and the cost lands on
someone else's data plan.

## 9. What was never verified

Every browser check here was Playwright **Firefox on Linux**. The home-screen install, Safari's
seven-day eviction, and how `visibilitychange` behaves for a standalone iOS web app are taken from
documentation, not measured. Test those on the device before relying on them.
