/**
 * Where a group of places sits, as a plan for a grid of map tiles.
 *
 * No image is decoded and nothing is composited: the tiles are laid out as a grid of `<img>` on the
 * page and the markers go on top as SVG. That keeps the markers crisp, clickable and themeable, and
 * it means this file needs nothing but arithmetic.
 *
 * **A map is not weather.** It changes when `places.json` changes, not every three hours — so a tile
 * is fetched once and then lives in the bucket, which the run already knows how to read: a key the
 * previous manifest named is a key that is published, and it is neither re-fetched nor re-uploaded.
 * Nothing derived is kept in git.
 */
import type { Place } from "./config"

/** The tile the whole web uses: 256 px, Web Mercator, `{z}/{y}/{x}` at Kartverket. */
export const TILE_SIZE = 256

/**
 * Kartverket's colour topographic layer, NLOD. Norway only — the same source `trails` draws its
 * maps from, so the licence question was settled here before this existed.
 */
export const TILE_URL = "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png"
export const TILE_ATTRIBUTION = "© Kartverket (NLOD)"

/** At most three by three: 768 px is as wide as the page shows a map, and nine tiles is enough. */
const MAX_TILES = 3
/** Past this the map is streets, which answers nothing a weather page asks. */
const MAX_ZOOM = 11
const MIN_ZOOM = 4
/** A quarter of the span on every side, so no marker ends up on the edge. */
const PADDING = 0.25
/**
 * The smallest area a map is drawn over, in degrees of latitude — about seventeen kilometres. Two
 * places a kilometre apart would otherwise zoom to a scale where the terrain story disappears.
 */
const MIN_SPAN_LAT = 0.15

/** Roughly what Kartverket's topo layer covers: the mainland and Svalbard. Outside it, sea. */
const NORWAY = { south: 57, north: 81.5, west: 3, east: 36 } as const

export type TilePlan = Readonly<{
  zoom: number
  /** Tile indices of the top-left tile. */
  x: number
  y: number
  columns: number
  rows: number
  width_px: number
  height_px: number
}>

/** Where a place lands inside the planned image, in pixels from its top-left corner. */
export type MarkerPoint = Readonly<{ id: string; x: number; y: number }>

function projectX(longitude: number, zoom: number) {
  return ((longitude + 180) / 360) * 2 ** zoom
}

function projectY(latitude: number, zoom: number) {
  const radians = (latitude * Math.PI) / 180
  return ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** zoom
}

export function withinCoverage(places: readonly Place[]) {
  return places.every((place) =>
    place.latitude >= NORWAY.south && place.latitude <= NORWAY.north &&
    place.longitude >= NORWAY.west && place.longitude <= NORWAY.east)
}

/**
 * The largest zoom at which the padded extent still fits in MAX_TILES squared, and the tile range
 * that covers it. Largest, because a map that fits is more use the closer it is.
 */
export function planTiles(places: readonly Place[]): TilePlan {
  if (places.length === 0) throw new Error("A map needs at least one place.")
  const latitudes = places.map((place) => place.latitude)
  const longitudes = places.map((place) => place.longitude)
  let south = Math.min(...latitudes)
  let north = Math.max(...latitudes)
  let west = Math.min(...longitudes)
  let east = Math.max(...longitudes)

  // A single place, or several almost on top of each other, would otherwise ask for street level.
  const latitude = (south + north) / 2
  const shortfall = MIN_SPAN_LAT - (north - south)
  if (shortfall > 0) { south -= shortfall / 2; north += shortfall / 2 }
  // A degree of longitude is shorter than a degree of latitude everywhere but the equator, and at
  // 65° it is less than half — so the same minimum in degrees would be half the distance.
  const minSpanLon = MIN_SPAN_LAT / Math.max(0.2, Math.cos((latitude * Math.PI) / 180))
  const shortfallLon = minSpanLon - (east - west)
  if (shortfallLon > 0) { west -= shortfallLon / 2; east += shortfallLon / 2 }

  const padLat = (north - south) * PADDING
  const padLon = (east - west) * PADDING
  south -= padLat; north += padLat; west -= padLon; east += padLon

  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom--) {
    const left = Math.floor(projectX(west, zoom))
    const right = Math.floor(projectX(east, zoom))
    // y grows southwards, so the northern edge gives the smaller index.
    const top = Math.floor(projectY(north, zoom))
    const bottom = Math.floor(projectY(south, zoom))
    const columns = right - left + 1
    const rows = bottom - top + 1
    if (columns <= MAX_TILES && rows <= MAX_TILES) {
      return {
        zoom, x: left, y: top, columns, rows,
        width_px: columns * TILE_SIZE,
        height_px: rows * TILE_SIZE,
      }
    }
  }
  throw new Error(`These places are too far apart for a ${MAX_TILES}×${MAX_TILES} map at zoom ${MIN_ZOOM}.`)
}

export function markerPoints(places: readonly Place[], plan: TilePlan): MarkerPoint[] {
  return places.map((place) => ({
    id: place.id,
    x: (projectX(place.longitude, plan.zoom) - plan.x) * TILE_SIZE,
    y: (projectY(place.latitude, plan.zoom) - plan.y) * TILE_SIZE,
  }))
}

/** Every tile the plan covers, in reading order — which is also the CSS grid's order. */
export function tileKeys(plan: TilePlan) {
  const keys: { x: number; y: number; name: string }[] = []
  for (let row = 0; row < plan.rows; row++) {
    for (let column = 0; column < plan.columns; column++) {
      const x = plan.x + column
      const y = plan.y + row
      keys.push({ x, y, name: `${plan.zoom}-${x}-${y}.png` })
    }
  }
  return keys
}

export function tileUrl(zoom: number, x: number, y: number) {
  return TILE_URL.replace("{z}", String(zoom)).replace("{y}", String(y)).replace("{x}", String(x))
}

/** Kartverket is a public service; say who is asking, as we do of MET. */
const USER_AGENT = "weather-cards/1.0 (+https://github.com/ueisele/weather-cards)"

export async function fetchTile(url: string) {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "image/png,image/*" },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${response.status} for ${url}`)
  const type = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim()
  // A tile service that answers a bad request with an HTML error page would otherwise be written
  // out as a .png and only show up as a broken image, once, on the published site.
  if (type !== "image/png") throw new Error(`${url} answered ${type || "no content type"}, not image/png`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error(`${url} is not a PNG`)
  return bytes
}
