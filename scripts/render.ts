#!/usr/bin/env bun
/**
 * Draw every chart this site publishes into `out/`.
 *
 *     bun run render
 *
 * **One call per place, not one per group.** A group could be drawn in a single call — four places,
 * three models, seventeen charts, just inside the tool's limit of twenty — and that would share the
 * fetch. It is not done, for two reasons that both matter more than the saved requests: a place
 * whose source fails would take its whole group down with it, and both themes double the chart
 * count past the limit. Per place it is eight charts, and a failure costs one place.
 *
 * The extra cost is about a third more requests. Against Open-Meteo's ten thousand a day, three
 * places at a three-hourly cadence spend under half a per cent.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { loadSite, MODEL_LABELS, MODELS, THEMES, type Place, type Theme } from "./lib/config"
import { fetchTile, markerPoints, planTiles, tileKeys, tileUrl, TILE_ATTRIBUTION, withinCoverage } from "./lib/tiles"
import { loadRenderer, readPin, REPOSITORY_ROOT } from "./lib/renderer"
import {
  isManifest, MANIFEST_KEY, PAGE_KEY, SCHEMA_VERSION, versionToken,
  type Card, type GroupEntry, type Manifest, type MapCard, type PlaceEntry,
} from "./lib/manifest"
import { renderPage } from "./lib/page"

/**
 * ICON's horizon, the longest of the three. The other two end sooner, and the chart draws the grey
 * region past where each source reaches rather than pretending the line stops because the weather
 * does. Asking every model for the longest horizon is what makes each one show its own maximum.
 */
const FORECAST_DAYS = 16

/**
 * MET Norway's terms require a User-Agent that names the application and a way to reach whoever
 * runs it; a generic one is answered with 403. This names the repository, which is public and is
 * where an operator would be found.
 */
const USER_AGENT = "weather-cards/1.0 (+https://github.com/ueisele/weather-cards)"

type Requested = Readonly<{ label: string; key_base: string; theme: Theme; chart: Record<string, unknown> }>

function card(slot: string, title: string, keyBase: string): Card {
  return {
    slot,
    title,
    key_base: keyBase,
    keys: Object.fromEntries(THEMES.map((theme) => [theme, `${keyBase}-${theme}.png`])) as Card["keys"],
  }
}

function placeCards(place: Place) {
  return {
    spread: card("spread", "All models", `p/${place.id}/spread`),
    models: MODELS.map((model) => card(model, MODEL_LABELS[model], `p/${place.id}/${model}`)),
  }
}

function target(place: Place) {
  return {
    target_id: place.id,
    latitude: place.latitude,
    longitude: place.longitude,
    ...(place.elevation_m === undefined ? {} : { elevation_m: place.elevation_m }),
  }
}

/**
 * Where the map tiles fetched on this machine are kept. Gitignored, and not the real store: a tile
 * that has been published lives in the bucket. This only keeps a local render from asking
 * Kartverket for the same picture again.
 */
const TILE_CACHE = resolve(REPOSITORY_ROOT, ".tiles")
const refetchTiles = process.argv.includes("--refetch-tiles")

/**
 * The locator map for one group, or for a place in no group.
 *
 * **A map is not weather.** It changes when `places.json` changes, so a tile is fetched once and
 * then simply stays: a key the previous manifest named is a key the bucket holds, and it is left
 * alone — not fetched, not written out, not re-uploaded — while the new manifest goes on naming it,
 * which is what keeps the prune from removing it. Exactly the arrangement that carries a place's
 * charts over a failed run.
 *
 * The consequence worth knowing: a tile is never refreshed on its own, so a Kartverket update does
 * not reach a map that is already published. `--refetch-tiles` is the way to ask for one.
 */
async function mapCard(
  id: string,
  places: readonly Place[],
  out: string,
  published: ReadonlySet<string>,
): Promise<MapCard | undefined> {
  if (!withinCoverage(places)) return undefined
  const plan = planTiles(places)
  const tiles: string[] = []
  let fetched = 0
  let cached = 0
  let kept = 0

  for (const tile of tileKeys(plan)) {
    const key = `m/${id}/${tile.name}`
    tiles.push(key)
    if (!refetchTiles && published.has(key)) { kept++; continue }

    const local = join(TILE_CACHE, tile.name)
    let bytes: Uint8Array
    if (!refetchTiles && await Bun.file(local).exists()) {
      bytes = await Bun.file(local).bytes()
      cached++
    } else {
      bytes = await fetchTile(tileUrl(plan.zoom, tile.x, tile.y))
      await mkdir(TILE_CACHE, { recursive: true })
      await writeFile(local, bytes)
      fetched++
    }
    const path = join(out, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  }

  console.log(`  ${id}: map at zoom ${plan.zoom}, ${plan.columns}\u00d7${plan.rows} tiles — ${
    [kept > 0 ? `${kept} already published` : "", cached > 0 ? `${cached} from the local cache` : "",
     fetched > 0 ? `${fetched} fetched from Kartverket` : ""].filter(Boolean).join(", ")}`)
  return {
    zoom: plan.zoom, columns: plan.columns, rows: plan.rows,
    width_px: plan.width_px, height_px: plan.height_px,
    tiles,
    markers: markerPoints(places, plan).map((point) => ({
      ...point,
      name: places.find((place) => place.id === point.id)!.name,
    })),
    attribution: TILE_ATTRIBUTION,
  }
}

function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

const site = await loadSite(join(REPOSITORY_ROOT, "places.json"))
const pin = await readPin()
const renderer = await loadRenderer()
const out = resolve(REPOSITORY_ROOT, process.env.WEATHER_CARDS_OUT ?? "out")

const generated = renderer.systemClock.now()
const generatedAt = generated.toISOString()
const version = versionToken(generated)
const day = (offset: number) => new Date(generated.getTime() + offset * 86_400_000).toISOString().slice(0, 10)

/**
 * The published manifest of the previous run. It is what a failed place falls back to, so a source
 * outage ages the site instead of emptying it. Missing is normal on the first run.
 */
const host = process.env.WEATHER_CARDS_HOSTNAME
let previous: Manifest | undefined
if (host) {
  try {
    const response = await fetch(`https://${host}/${MANIFEST_KEY}`, { signal: AbortSignal.timeout(20_000) })
    if (response.ok) {
      const body: unknown = await response.json()
      if (isManifest(body)) previous = body
    }
  } catch {
    // The site may not exist yet, and a run must not depend on the site it is about to replace.
  }
  if (!previous) console.log(`No previous manifest at https://${host}/${MANIFEST_KEY}; nothing to carry over.`)
} else {
  console.log("WEATHER_CARDS_HOSTNAME is unset: a place that fails will be left out rather than kept.")
}

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

const storeRoot = await mkdtemp(join(tmpdir(), "weather-cards-"))
const places: PlaceEntry[] = []
const groups: GroupEntry[] = []
let drawn = 0
let carried = 0
let lost = 0

try {
  const store = new renderer.ArtifactStore({
    root: join(storeRoot, "artifacts"),
    clock: renderer.systemClock,
    ids: renderer.secureIds,
  })
  await store.initialize()
  const tree = renderer.sessionTreeKey("weather-cards")
  const dependencies = {
    store,
    tree_key: tree,
    direct: new renderer.SafeDirectClient({
      dns: renderer.nodeDnsResolver,
      executor: renderer.nodeDirectRequestExecutor,
      user_agent: USER_AGENT,
    }),
    clock: renderer.systemClock,
    ids: renderer.secureIds,
  }

  async function draw(input: Record<string, unknown>, requested: readonly Requested[]) {
    const response = await renderer.executeWeather(input, dependencies)
    if (!response.ok) throw new Error(`the tool refused the request (${response.problem.code})`)
    const charts = response.data.charts as any[]
    if (charts.length !== requested.length) {
      throw new Error(`asked for ${requested.length} charts and got ${charts.length}`)
    }
    for (const [index, want] of requested.entries()) {
      const chart = charts[index]!
      // The tool answers in request order, and the answer does not echo the theme — so the mapping
      // is positional. Checked rather than trusted: a silent mismatch would publish one place's
      // weather under another place's name, which is the one failure this must not have.
      if (chart.type !== want.chart.type || String(chart.target_ids) !== String(want.chart.target_ids)) {
        throw new Error(`chart ${index} came back as ${chart.type} ${chart.target_ids}, expected ${want.label}`)
      }
      if (chart.status !== "ready") throw new Error(`${want.label}: ${chart.problem?.code ?? chart.status}`)
      const path = join(out, `${want.key_base}-${want.theme}.png`)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, (await store.readBytes(tree, chart.artifact.artifact_id)).bytes)
      drawn++
    }
  }

  console.log(`Drawing ${site.places.length} places and ${site.groups.length} groups at ${generatedAt}.`)

  for (const place of site.places) {
    const cards = placeCards(place)
    const requested: Requested[] = []
    for (const theme of THEMES) {
      requested.push({
        label: `${place.id} spread`, key_base: cards.spread.key_base, theme,
        chart: { type: "model_spread", target_ids: [place.id], theme },
      })
    }
    for (const [index, model] of MODELS.entries()) {
      for (const theme of THEMES) {
        requested.push({
          label: `${place.id} ${model}`, key_base: cards.models[index]!.key_base, theme,
          chart: { type: "meteogram", target_ids: [place.id], provider: model, theme },
        })
      }
    }
    try {
      await draw({
        targets: [target(place)],
        providers: [...MODELS],
        // The document only has to carry the days; every chart draws the source's own periods.
        resolutions: ["daily"],
        start_date: day(0),
        end_date: day(FORECAST_DAYS - 1),
        charts: requested.map((entry) => entry.chart),
      }, requested)
      places.push({ ...place, issued_at: generatedAt, version, ...cards })
      console.log(`  ${place.id}: drawn`)
    } catch (error) {
      const kept = previous?.places.find((entry) => entry.id === place.id)
      if (kept) {
        // The name and the note are display, so they follow the current file; the images and their
        // version are what actually exists in the bucket and must not be rewritten.
        places.push({ ...kept, ...place, issued_at: kept.issued_at, version: kept.version, problem: reason(error) })
        carried++
        console.log(`  ${place.id}: FAILED — ${reason(error)}; keeping the charts from ${kept.issued_at}`)
      } else {
        lost++
        console.log(`  ${place.id}: FAILED — ${reason(error)}; no earlier charts, so it is left out`)
      }
    }
  }

  for (const group of site.groups) {
    const comparison = card("comparison", `${group.name} compared`, `g/${group.id}/comparison`)
    const ids = group.places.map((place) => place.id)
    const requested: Requested[] = THEMES.map((theme) => ({
      label: `${group.id} comparison`, key_base: comparison.key_base, theme,
      chart: { type: "places_comparison", target_ids: ids, provider: group.comparison_model, theme },
    }))
    try {
      await draw({
        targets: group.places.map(target),
        // One source draws this chart, so only that one is fetched.
        providers: [group.comparison_model],
        resolutions: ["daily"],
        start_date: day(0),
        end_date: day(FORECAST_DAYS - 1),
        charts: requested.map((entry) => entry.chart),
      }, requested)
      groups.push({
        id: group.id, name: group.name, ...(group.note === undefined ? {} : { note: group.note }),
        place_ids: ids, comparison_model: group.comparison_model,
        issued_at: generatedAt, version, comparison,
      })
      console.log(`  ${group.id}: drawn`)
    } catch (error) {
      const kept = previous?.groups.find((entry) => entry.id === group.id)
      if (kept) {
        groups.push({ ...kept, name: group.name, place_ids: ids, problem: reason(error) })
        carried++
        console.log(`  ${group.id}: FAILED — ${reason(error)}; keeping the chart from ${kept.issued_at}`)
      } else {
        lost++
        console.log(`  ${group.id}: FAILED — ${reason(error)}; no earlier chart, so it is left out`)
      }
    }
  }
} finally {
  await rm(storeRoot, { recursive: true, force: true })
}

// Maps are attached last and to every entry, carried-over ones included: a source outage says
// nothing about where a place is. Every tile the previous run published is already in the bucket.
const published = new Set([
  ...(previous?.places ?? []).flatMap((entry) => entry.map?.tiles ?? []),
  ...(previous?.groups ?? []).flatMap((entry) => entry.map?.tiles ?? []),
])
const grouped = new Set(site.groups.flatMap((group) => group.places.map((place) => place.id)))
for (const [index, entry] of places.entries()) {
  if (grouped.has(entry.id)) continue
  const card = await mapCard(entry.id, [entry], out, published)
  if (card) places[index] = { ...entry, map: card }
}
for (const group of site.groups) {
  const index = groups.findIndex((entry) => entry.id === group.id)
  if (index < 0) continue
  const card = await mapCard(group.id, group.places, out, published)
  if (card) groups[index] = { ...groups[index]!, map: card }
}

if (places.length === 0) {
  console.error("Nothing could be drawn and nothing could be carried over — refusing to publish an empty site.")
  process.exit(1)
}

const manifest: Manifest = {
  schema_version: SCHEMA_VERSION,
  generated_at: generatedAt,
  renderer_commit: pin.commit,
  site: site.identity,
  places,
  groups,
}
await Bun.write(join(out, MANIFEST_KEY), JSON.stringify(manifest, null, 2) + "\n")
await Bun.write(join(out, PAGE_KEY), renderPage(manifest))

console.log(`\n${drawn} images drawn, ${carried} entries carried over, ${lost} left out.`)
console.log(`Written to ${out}. Publish it with: bun run deploy`)
