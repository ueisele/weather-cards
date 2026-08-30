/**
 * `places.json`, read and checked.
 *
 * Everything here fails loudly and early. A run that starts with a typo in a coordinate would
 * otherwise publish a chart for the wrong valley, which looks exactly like a chart for the right
 * one — the failure mode this whole project is built to avoid.
 */

/** The models drawn for every place, in the order they appear on the page. */
export const MODELS = ["met", "icon", "ecmwf"] as const
export type Model = (typeof MODELS)[number]

/** How each model is named on the page: the institute, because that is what a spread compares. */
export const MODEL_LABELS: Readonly<Record<Model, string>> = {
  met: "MET Norway",
  icon: "ICON · DWD",
  ecmwf: "ECMWF IFS",
}

/** Both are drawn, and a visitor's browser fetches exactly one of them. */
export const THEMES = ["dark", "light"] as const
export type Theme = (typeof THEMES)[number]

/**
 * The chart's own limit, and the point where the probability lane gives each place under four
 * pixels of row. More places than this belong in a second group, not in one unreadable chart.
 */
export const MAX_GROUP_PLACES = 4

/** An id becomes a URL fragment and an object key, so it is narrower than the tool's own rule. */
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/

export type Place = Readonly<{
  id: string
  name: string
  latitude: number
  longitude: number
  elevation_m?: number
  note?: string
}>

export type Group = Readonly<{
  id: string
  name: string
  note?: string
  places: readonly Place[]
  /** One source draws the comparison; which one is a judgement about the region, so it is stated. */
  comparison_model: Model
}>

/** What the page calls itself. Here rather than in the code, because it is editorial too. */
export type SiteIdentity = Readonly<{ title: string; tagline?: string }>

export type Site = Readonly<{
  identity: SiteIdentity
  places: readonly Place[]
  groups: readonly Group[]
}>

class ConfigError extends Error {
  constructor(where: string, what: string) {
    super(`places.json: ${where} ${what}`)
    this.name = "ConfigError"
  }
}

function text(value: unknown, where: string, limit = 80) {
  if (typeof value !== "string" || value.trim() === "") throw new ConfigError(where, "must be a non-empty string.")
  if (value.length > limit) throw new ConfigError(where, `must be at most ${limit} characters.`)
  return value
}

function number(value: unknown, where: string, low: number, high: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ConfigError(where, "must be a number.")
  if (value < low || value > high) throw new ConfigError(where, `must lie between ${low} and ${high}.`)
  return value
}

/**
 * MET's terms ask for no more precision than four decimals — beyond that the requests stop sharing
 * a cache entry while naming the same weather. Four decimals is about eleven metres.
 */
function coordinate(value: unknown, where: string, limit: number) {
  return Math.round(number(value, where, -limit, limit) * 10_000) / 10_000
}

function place(value: unknown, index: number): Place {
  if (typeof value !== "object" || value === null) throw new ConfigError(`places[${index}]`, "must be an object.")
  const entry = value as Record<string, unknown>
  const id = text(entry.id, `places[${index}].id`, 48)
  if (!ID.test(id)) throw new ConfigError(`places[${index}].id`, "must be lowercase letters, digits and hyphens, starting with a letter or digit.")
  return {
    id,
    name: text(entry.name, `${id}.name`),
    latitude: coordinate(entry.latitude, `${id}.latitude`, 90),
    longitude: coordinate(entry.longitude, `${id}.longitude`, 180),
    // Given rather than resolved, it is passed to both APIs and changes the answer — in mountains
    // by more than the models differ from each other. Omitted, each source uses its own grid height.
    ...(entry.elevation_m === undefined ? {} : { elevation_m: Math.round(number(entry.elevation_m, `${id}.elevation_m`, -500, 9_000)) }),
    ...(entry.note === undefined ? {} : { note: text(entry.note, `${id}.note`, 160) }),
  }
}

function group(value: unknown, index: number, byId: Map<string, Place>): Group {
  if (typeof value !== "object" || value === null) throw new ConfigError(`groups[${index}]`, "must be an object.")
  const entry = value as Record<string, unknown>
  const id = text(entry.id, `groups[${index}].id`, 48)
  if (!ID.test(id)) throw new ConfigError(`groups[${index}].id`, "must be lowercase letters, digits and hyphens.")
  if (!Array.isArray(entry.places)) throw new ConfigError(`${id}.places`, "must be an array of place ids.")
  const seen = new Set<string>()
  const places = entry.places.map((member, position) => {
    const name = text(member, `${id}.places[${position}]`, 48)
    const found = byId.get(name)
    if (!found) throw new ConfigError(`${id}.places[${position}]`, `names "${name}", which is not a place.`)
    if (seen.has(name)) throw new ConfigError(`${id}.places[${position}]`, `names "${name}" twice.`)
    seen.add(name)
    return found
  })
  if (places.length < 2) throw new ConfigError(`${id}.places`, "needs at least two places; one place is already its own section.")
  if (places.length > MAX_GROUP_PLACES) {
    throw new ConfigError(`${id}.places`, `holds ${places.length} places, and a comparison draws at most ${MAX_GROUP_PLACES}.`)
  }
  const model = entry.comparison_model === undefined ? "met" : text(entry.comparison_model, `${id}.comparison_model`, 16)
  if (!(MODELS as readonly string[]).includes(model)) {
    throw new ConfigError(`${id}.comparison_model`, `must be one of ${MODELS.join(", ")}.`)
  }
  return {
    id,
    name: text(entry.name, `${id}.name`),
    places,
    comparison_model: model as Model,
    ...(entry.note === undefined ? {} : { note: text(entry.note, `${id}.note`, 240) }),
  }
}

export function parseSite(raw: unknown): Site {
  if (typeof raw !== "object" || raw === null) throw new ConfigError("the file", "must hold an object.")
  const document = raw as Record<string, unknown>
  if (!Array.isArray(document.places)) throw new ConfigError("places", "must be an array.")
  if (document.places.length === 0) throw new ConfigError("places", "is empty; there would be nothing to publish.")
  const places = document.places.map(place)
  const byId = new Map<string, Place>()
  for (const entry of places) {
    // Two places under one id would silently overwrite each other's objects in the bucket.
    if (byId.has(entry.id)) throw new ConfigError("places", `names "${entry.id}" twice.`)
    byId.set(entry.id, entry)
  }
  const groupList = document.groups === undefined ? [] : document.groups
  if (!Array.isArray(groupList)) throw new ConfigError("groups", "must be an array.")
  const groups = groupList.map((entry, index) => group(entry, index, byId))
  const groupIds = new Set<string>()
  for (const entry of groups) {
    if (groupIds.has(entry.id)) throw new ConfigError("groups", `names "${entry.id}" twice.`)
    groupIds.add(entry.id)
  }
  const identity = document.site === undefined ? { title: "Weather cards" } : (() => {
    if (typeof document.site !== "object" || document.site === null) throw new ConfigError("site", "must be an object.")
    const entry = document.site as Record<string, unknown>
    return {
      title: text(entry.title, "site.title", 48),
      ...(entry.tagline === undefined ? {} : { tagline: text(entry.tagline, "site.tagline", 160) }),
    }
  })()
  return { identity, places, groups }
}

export async function loadSite(path: string): Promise<Site> {
  const file = Bun.file(path)
  if (!(await file.exists())) throw new ConfigError("the file", `is missing at ${path}.`)
  let raw: unknown
  try {
    raw = await file.json()
  } catch (error) {
    throw new ConfigError("the file", `is not valid JSON: ${(error as Error).message}`)
  }
  return parseSite(raw)
}
