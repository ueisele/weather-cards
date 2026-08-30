/**
 * The record of a run: what was drawn, from what, and when.
 *
 * It is written to the bucket beside the images and read back at the start of the next run. That
 * read is what lets a run that could not reach a source **keep** the previous charts for that place
 * and say how old they are, rather than publishing a hole. A provider outage should make the site
 * older, never emptier.
 */
import type { Model, SiteIdentity, Theme } from "./config"

export const MANIFEST_KEY = "index.json"
export const PAGE_KEY = "index.html"
export const SCHEMA_VERSION = 1

/** One drawing, in both themes. `key_base` doubles as the object key prefix. */
export type Card = Readonly<{
  /** `spread`, or the model's name — what the tab is called and what the object is named. */
  slot: string
  title: string
  key_base: string
  keys: Readonly<Record<Theme, string>>
}>

/** One place on a map, in pixels from the composed image's top-left corner. */
export type MapMarker = Readonly<{ id: string; name: string; x: number; y: number }>

/**
 * A locator map: one rendered image with the places drawn over it as SVG. Not a chart and not
 * weather — it changes when `places.json` changes, so the image is fetched once and then lives in
 * the bucket. The keys carry a fingerprint of the extent, so a moved group is a new object rather
 * than the same one holding a different picture.
 */
export type MapCard = Readonly<{
  width_px: number
  height_px: number
  /** The rendered map. */
  image: string
  /** The same map with the places drawn into it, standalone — what a click opens. */
  full: string
  markers: readonly MapMarker[]
  attribution: string
}>

export type PlaceEntry = Readonly<{
  id: string
  name: string
  latitude: number
  longitude: number
  elevation_m?: number
  note?: string
  /** When these particular images were drawn. Older than the run means the run could not redraw. */
  issued_at: string
  /** Cache-busts the image URLs, and is per entry so a carried-over entry keeps its own. */
  version: string
  spread: Card
  models: readonly Card[]
  /** Only for a place in no group; a place inside one is on the group's map instead. */
  map?: MapCard
  /** Present only on an entry the current run could not redraw. */
  problem?: string
}>

export type GroupEntry = Readonly<{
  id: string
  name: string
  note?: string
  place_ids: readonly string[]
  comparison_model: Model
  issued_at: string
  version: string
  comparison: Card
  map?: MapCard
  problem?: string
}>

export type Manifest = Readonly<{
  schema_version: number
  generated_at: string
  renderer_commit: string
  site: SiteIdentity
  places: readonly PlaceEntry[]
  groups: readonly GroupEntry[]
}>

/** A compact stamp, used as the `?v=` token. Same instant as `generated_at`, fewer characters. */
export function versionToken(at: Date) {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
}

/** Every object key the manifest refers to — what the prune keeps and everything else goes. */
export function referencedKeys(manifest: Manifest): Set<string> {
  const keys = new Set<string>()
  for (const place of manifest.places) {
    for (const card of [place.spread, ...place.models]) for (const key of Object.values(card.keys)) keys.add(key)
    if (place.map) { keys.add(place.map.image); keys.add(place.map.full) }
  }
  for (const group of manifest.groups) {
    for (const key of Object.values(group.comparison.keys)) keys.add(key)
    if (group.map) { keys.add(group.map.image); keys.add(group.map.full) }
  }
  return keys
}

export function isManifest(value: unknown): value is Manifest {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return candidate.schema_version === SCHEMA_VERSION &&
    typeof candidate.generated_at === "string" &&
    Array.isArray(candidate.places) && Array.isArray(candidate.groups)
}
