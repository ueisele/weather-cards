# weather-cards — point forecasts, drawn and published

The charts behind a small weather site: for every place in [`places.json`](places.json), one chart
per model and one with all models together, plus one chart per group comparing its places. A job
redraws them every three hours and uploads them to a Cloudflare R2 bucket that serves them.

**This repository holds the site, not the renderer.** The charts are drawn by the point weather tool
of the `web-research` plugin in [ueisele/dotfiles](https://gitlab.com/ueisele/dotfiles), pinned to a
commit in [`renderer.json`](renderer.json). What lives here is which places to draw, how the page is
laid out, and how the result gets published.

**And it holds no addresses.** Bucket, endpoint and hostname identify a Cloudflare account, and this
repository is public, so all three arrive through the environment. The OpenTofu module that creates
them is in a separate, private repository and prints them with `just deploy-env`.

---

## What it draws

For each **place**, eight images — four charts in two themes:

| Chart | What it answers |
| --- | --- |
| `spread` | all three models on one axis: where they agree, and where the forecast is less certain than any one model looks |
| `met`, `icon`, `ecmwf` | one model each, at its own full horizon, with its own uncertainty |

For each **group**, one more chart: its places compared under a single model, which in mountains is
mostly a reading of the terrain rather than of the weather.

Every chart is 1920 × 1300 and carries its own legend, its resolved elevation and the model it came
from. **All times are UTC** — the tool has no timezone and the page does not imply one.

## Running it

```bash
bun run renderer     # fetch the pinned chart renderer into .renderer/ (once)
bun run render       # draw everything into out/
bun run preview      # serve out/ at http://localhost:8787
bun run deploy       # upload out/ and remove what is no longer named
bun run deploy --dry-run
```

Two shortcuts worth knowing:

- **`bun run page`** rebuilds `out/index.html` from the manifest a previous render left behind. The
  charts are the expensive part and they do not change when the layout does, so this keeps design
  iterations off the providers' APIs.
- **`WEATHER_CARDS_RENDERER=/path/to/dotfiles/15_opencode/plugins/web-research`** points at a working
  copy instead of the pinned checkout. A sibling `../dotfiles` is found without being told.

There is nothing to install. The weather path of the plugin imports only `node:*` — no npm
dependency, no font, no image tool — so `bun` and a checkout are the whole toolchain.

### Adding a place

Edit `places.json`, commit, push. The workflow republishes on a push that touches it, and the next
run adds what appeared and prunes what left — including fetching the map tiles the new places need.

```json
{
  "id": "oberstdorf",
  "name": "Oberstdorf",
  "latitude": 47.4098,
  "longitude": 10.2794,
  "elevation_m": 815,
  "note": "Valley floor"
}
```

`elevation_m` is optional and worth giving where it is known: it is passed to both APIs, and in
mountains the height changes the answer by more than the models differ from each other. Left out,
each source answers for its own grid cell's height, which the chart then states.

A **group** names two to four places and draws them on one chart. Four is the limit because the
comparison's probability lane gives each place its own row inside twenty-two pixels; a fifth would
be a hairline. `comparison_model` picks which model draws it — `met` by default, which is
ECMWF-based outside Scandinavia and MET Nordic inside it.

## How it is put together

### One call per place, not one per group

A whole group could be drawn in a single call — four places, three models, seventeen charts, just
inside the tool's limit of twenty. It is not, for two reasons that outweigh the saved requests:

- a place whose source fails would take its entire group down with it, and
- both themes double the chart count past that limit.

Per place it is eight charts, and a failure costs one place. The extra cost is about a third more
requests — against Open-Meteo's ten thousand a day, three places on a three-hourly cadence spend
under half a per cent of the allowance.

### A failure ages the site; it never empties it

Each run reads the manifest the previous run published. A place whose sources could not be reached
keeps the entry — and therefore the images — from the run that last succeeded, and the page says so
in as many words: *kept · drawn 30 Aug 2026, 12:00 UTC; this run could not redraw it*.

An old forecast presented as current is worse than no forecast, and a missing chart is worse than an
old one that admits its age. This is the arrangement in which neither happens.

The prune follows from the same rule: it removes what the **manifest** no longer names, not what the
run did not upload. A place removed from `places.json` disappears; a place whose provider was down
does not.

### Versioned URLs instead of a cache purge

Every image URL carries the run's timestamp as `?v=…`. Cloudflare's cache key includes the query
string, so a new run is a new URL and a stale cached image can never be served in its place. That
removes a whole moving part: **no `Cache-Control` to set, no purge to make, and no purge token to
hold.** `.png` is edge-cached by extension; `.json` is not, so the manifest is always current.

### The page is generated, and needs no JavaScript

`index.html` is written by the run, with every anchor and every `<img>` in it. `#lomsdal-visten` is
a real anchor rather than a router, and a reader with scripting off sees everything. One long
scrollable page: the group's comparison, then each place with its spread, with the three single
models behind a `<details>` that fetches nothing until it is opened.

### The theme moves the frame and the pictures together

The charts are images with a theme baked in, so the page and the pictures have to agree or half the
screen is one thing and half the other. Without scripting, `<picture>` picks by
`prefers-color-scheme` and there is no switch to get it wrong.

The **Auto / Light / Dark** control in the bar overrides that, and the way it does is worth knowing,
because it is what keeps the two halves together at no cost:

- the page's tokens follow `data-theme` on the root, defined for all three states — the system's
  choice, an explicit dark, and an explicit *light on a dark system*, which is the one a palette
  written only inside a media query gets wrong;
- the charts follow the same choice by having their `<source>`'s **media query itself** rewritten —
  `all` always matches, so the dark image wins; `not all` never matches, so the `<img>`'s own light
  source wins. One attribute per image, and only the image actually on the screen is ever fetched;
- the **full-size link follows too**. Both addresses ride on the link as `data-light` and
  `data-dark`, and the script sets `href` from the theme in force. Without it a click on a dark
  chart opened the light one — which was the first thing anyone noticed.

The choice is remembered in `localStorage` and applied before the first paint, so an overridden
theme does not arrive as a flash of the other one. A system change while the page is open is
followed as long as the choice is Auto.

The rest of the script is a filter box, emitted only once there are at least eight places.

### The map is not weather

Each group carries a locator map, and a place in no group carries one of its own — because a place
without one would be the only thing on the page that does not say where it is. It is worth having
for the same reason the group exists: the comparison chart shows Lomsdal-Visten seven degrees below
Mosjøen and Brønnøysund, and the map says why — plateau, valley floor, coast, inside forty-six
kilometres.

**A map changes when `places.json` changes, not every three hours** — so a tile is fetched once and
then simply stays. The published bucket is the store: a key the previous manifest named is a key the
bucket holds, so the run leaves it alone — not fetched, not written out, not re-uploaded — while the
new manifest goes on naming it, which is what stops the prune from removing it. Exactly the
arrangement that carries a place's charts over a failed run.

Nothing derived goes into git. Tiles are artefacts like the charts, and git would keep every version
of every one of them for ever. `.tiles/` is a gitignored local cache so that a render on a laptop
does not ask Kartverket for a picture it already has; in CI it is empty and the manifest does the
same job.

The consequence worth knowing: **a tile is never refreshed on its own.** A Kartverket update does not
reach a map that is already published. `bun run render --refetch-tiles` is how to ask for one.

Nothing is composited and no image is decoded. The tiles stay separate `<img>` in a CSS grid and the
places go on top as **SVG**, so the markers are crisp at any size, link to their own section, and
cost no image processing anywhere. The projection is the ordinary Web Mercator arithmetic; the zoom
is the largest at which the padded extent still fits in three tiles by three.

Two things that are decided rather than defaulted:

- **The source is [Kartverket](https://kartverket.no/)'s colour topographic layer** (NLOD, which
  permits redistribution with attribution — printed under every map). It is the same source the
  `trails` repo draws its maps from, so the licence question was settled here before this existed.
  It covers **Norway only**: a group outside roughly 57–81°N / 3–36°E is detected and simply gets no
  map, with a line in the run's output. An empty blue rectangle would be worse than none.
- **The map keeps its own colours in both themes.** It is a picture of terrain rather than part of
  the page's furniture, and the usual invert-and-hue-rotate trick makes a topographic map look
  cheap. The markers are fixed dark-on-white, which reads on every colour Kartverket draws.

The deploy has a matching rule for the case where a tile does end up in `out/` again: the same
picture under the same key forever, so an object that already matches byte for byte is skipped.

### The renderer is pinned

`renderer.json` names a commit, not a branch. A change to how the charts look should be a commit in
*this* repository's history — something that was done deliberately — rather than something that
happened to the site overnight because a plugin was improved.

```bash
bun run renderer -- --update   # move the pin to the tip
bun run render && bun run preview
git commit renderer.json       # once the charts still look right
```

The checkout is a partial, sparse clone: no blobs until they are needed, and only the two
directories the plugin needs — it imports a few modules from `15_opencode/shared`, so it cannot stop
at its own directory. About two seconds and twelve megabytes.

## Publishing

`.github/workflows/publish.yml` runs every three hours, on a push that touches the places or the
code, and on demand. It needs five values in the repository's settings:

| Name | Kind | Why |
| --- | --- | --- |
| `WEATHER_CARDS_HOSTNAME` | variable | the site is public and its footer links back here, so the pairing is not something that could be kept secret |
| `WEATHER_CARDS_BUCKET` | secret | names a bucket in the account |
| `WEATHER_CARDS_S3_ENDPOINT` | secret | contains the Cloudflare account id |
| `WEATHER_CARDS_ACCESS_KEY_ID` | secret | R2 API token, Object Read & Write, this bucket only |
| `WEATHER_CARDS_SECRET_ACCESS_KEY` | secret | the other half of it |

The token is scoped to the one bucket and can do nothing else. It is the only reason this is a
separate repository rather than a directory in the dotfiles: a write credential belongs next to the
smallest possible change surface, and dotfiles' is every module it carries.

> **The one trap.** GitHub disables a scheduled workflow in a public repository after 60 days
> without repository activity, and workflow runs do not count. If the site stops updating and
> nothing else is wrong, look there first. The job is a plain `bun` command with everything in the
> environment, so moving the schedule to something with a real cron is a re-host, not a rewrite.

## Sources and terms

Weather data from [MET Norway](https://api.met.no/) (NLOD / CC BY 4.0) and
[Open-Meteo](https://open-meteo.com/) (CC BY 4.0), which serves DWD's ICON and ECMWF's IFS. Every
chart names the model it was drawn from, and the page carries the attribution.

Two obligations this design meets on purpose:

- **MET requires a User-Agent that names the application and a way to reach whoever runs it**, and
  answers a generic one with 403. The render sends
  `weather-cards/1.0 (+https://github.com/ueisele/weather-cards)`.
- **MET asks for no more than four decimals of latitude and longitude.** `places.json` is rounded to
  four on load, so a copied coordinate with eleven of them cannot quietly become its own cache entry.

Open-Meteo's free tier is for non-commercial use at up to ten thousand calls a day. This site, at
three places and a three-hourly cadence, makes about a hundred.
