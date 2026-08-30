/**
 * Where a group of places sits, as one map image.
 *
 * **One request, not a grid of tiles.** Kartverket's WMS renders an arbitrary extent at an arbitrary
 * size, and it renders *for* that size — the label density and detail are chosen for the pixels
 * asked for, so the result is a map at 1920 px rather than a 768 px map stretched to fit. That is
 * what lets this sit in the page at the same width as the charts, and what gives a click something
 * to open: a tile grid has no single image behind it.
 *
 * Nothing is decoded or composited here either. The places are drawn as SVG over the image on the
 * page, and into a small companion SVG document for the full-size view.
 *
 * **A map is not weather.** It changes when `places.json` changes, so the image is fetched once and
 * then lives in the bucket; the key carries a fingerprint of the extent, so a moved group is a new
 * object rather than the same one with different content.
 */
import type { Place } from "./config"

/** The charts' own canvas. The map matches it so the page keeps one rhythm down the column. */
export const MAP_WIDTH = 1920
export const MAP_HEIGHT = 1300

/**
 * Kartverket's topographic WMS, NLOD — the same data `trails` draws its maps from, so the licence
 * question was settled here before this existed. `png8` is a real PNG with a 256-colour palette:
 * a map is flat colour and line work, so it loses nothing and weighs less than half.
 */
const WMS = "https://wms.geonorge.no/skwms1/wms.topo"
const FORMAT = "image/png8"
export const ATTRIBUTION = "© Kartverket (NLOD)"

/** A quarter of the extent on every side, so no marker ends up against an edge. */
const PADDING = 0.25
/**
 * The smallest area a map is drawn over. Two places a kilometre apart would otherwise be rendered
 * at a scale where the terrain that explains their weather is off the edge.
 */
const MIN_GROUND_WIDTH_M = 25_000

/** Roughly what Kartverket's topo layer covers: the mainland and Svalbard. Outside it, sea. */
const NORWAY = { south: 57, north: 81.5, west: 3, east: 36 } as const

const EARTH_RADIUS_M = 6378137

/** EPSG:3857 metres — what the WMS takes and what the markers interpolate in. */
export type Extent = Readonly<{ minx: number; miny: number; maxx: number; maxy: number }>

/** Where a place lands inside the rendered image, in pixels from its top-left corner. */
export type MarkerPoint = Readonly<{ id: string; x: number; y: number }>

function mercator(longitude: number, latitude: number) {
  return {
    x: EARTH_RADIUS_M * longitude * (Math.PI / 180),
    y: EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360)),
  }
}

export function withinCoverage(places: readonly Place[]) {
  return places.every((place) =>
    place.latitude >= NORWAY.south && place.latitude <= NORWAY.north &&
    place.longitude >= NORWAY.west && place.longitude <= NORWAY.east)
}

export function planExtent(places: readonly Place[]): Extent {
  if (places.length === 0) throw new Error("A map needs at least one place.")
  const points = places.map((place) => mercator(place.longitude, place.latitude))
  let minx = Math.min(...points.map((point) => point.x))
  let maxx = Math.max(...points.map((point) => point.x))
  let miny = Math.min(...points.map((point) => point.y))
  let maxy = Math.max(...points.map((point) => point.y))

  // Mercator metres are not ground metres anywhere but the equator — at 65° they are more than
  // twice as long — so a minimum stated in ground distance has to be converted before it is used.
  const latitude = places.reduce((sum, place) => sum + place.latitude, 0) / places.length
  const minimum = MIN_GROUND_WIDTH_M / Math.max(0.15, Math.cos((latitude * Math.PI) / 180))
  const short = minimum - (maxx - minx)
  if (short > 0) { minx -= short / 2; maxx += short / 2 }

  const padX = (maxx - minx) * PADDING
  minx -= padX; maxx += padX
  const padY = Math.max((maxy - miny) * PADDING, padX * 0.1)
  miny -= padY; maxy += padY

  // The image has a fixed shape, so the extent is grown — never cropped — to match it. Cropping
  // would push a place off a map drawn to show exactly that place.
  const target = MAP_WIDTH / MAP_HEIGHT
  const width = maxx - minx
  const height = maxy - miny
  if (width / height < target) {
    const grow = (height * target - width) / 2
    minx -= grow; maxx += grow
  } else {
    const grow = (width / target - height) / 2
    miny -= grow; maxy += grow
  }
  return { minx, miny, maxx, maxy }
}

export function mapUrl(extent: Extent) {
  const url = new URL(WMS)
  url.searchParams.set("SERVICE", "WMS")
  url.searchParams.set("VERSION", "1.3.0")
  url.searchParams.set("REQUEST", "GetMap")
  url.searchParams.set("LAYERS", "topo")
  url.searchParams.set("STYLES", "")
  url.searchParams.set("CRS", "EPSG:3857")
  url.searchParams.set("BBOX", [extent.minx, extent.miny, extent.maxx, extent.maxy]
    .map((value) => value.toFixed(1)).join(","))
  url.searchParams.set("WIDTH", String(MAP_WIDTH))
  url.searchParams.set("HEIGHT", String(MAP_HEIGHT))
  url.searchParams.set("FORMAT", FORMAT)
  return url.href
}

export function markerPoints(places: readonly Place[], extent: Extent): MarkerPoint[] {
  return places.map((place) => {
    const point = mercator(place.longitude, place.latitude)
    return {
      id: place.id,
      x: ((point.x - extent.minx) / (extent.maxx - extent.minx)) * MAP_WIDTH,
      // y grows northwards in Mercator and downwards in an image.
      y: ((extent.maxy - point.y) / (extent.maxy - extent.miny)) * MAP_HEIGHT,
    }
  })
}

/** Kartverket is a public service; say who is asking, as we do of MET. */
const USER_AGENT = "weather-cards/1.0 (+https://github.com/ueisele/weather-cards)"

export async function fetchMap(url: string) {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "image/png,image/*" },
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`${response.status} from the map service`)
  const type = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim()
  // A WMS answers a bad request with an XML exception and status 200. Without this check that
  // would be written out as a .png and show up as one broken image, once, on the published site.
  // `image/png8` is what the service calls a paletted PNG; the bytes are an ordinary one.
  if (type !== "image/png" && type !== "image/png8") {
    throw new Error(`the map service answered ${type || "no content type"}, not an image`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error("the map service did not return a PNG")
  return bytes
}
