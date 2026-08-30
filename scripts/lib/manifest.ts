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
  }
  for (const group of manifest.groups) for (const key of Object.values(group.comparison.keys)) keys.add(key)
  return keys
}

export function isManifest(value: unknown): value is Manifest {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return candidate.schema_version === SCHEMA_VERSION &&
    typeof candidate.generated_at === "string" &&
    Array.isArray(candidate.places) && Array.isArray(candidate.groups)
}
