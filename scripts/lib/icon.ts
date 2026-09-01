/**
 * The app icon, drawn rather than stored.
 *
 * **A cairn.** The zone is `cairn.zone` and a cairn is what marks a route in the Norwegian
 * mountains — a *varde*. It is nature without the postcard: no mountain, no cloud, no compass. And
 * it is a family mark: `atlas.cairn.zone` carries the same stack with a path below it where this
 * one has an arc above. Same stone, same stroke, opposite side — what the sky is doing here, where
 * the ground goes there.
 *
 * Drawn with the chart's own rasteriser, out of the pinned renderer, so there is no image tool, no
 * checked-in binary, and no way for the mark to drift from the thing it stands for. iOS applies its
 * own rounded mask to `apple-touch-icon`, so this fills the square and keeps its content clear of
 * the edges.
 */
export const ICON_SIZES = [180, 192, 512] as const
export const iconKey = (size: number) => `icon-${size}.png`

type Rgb = readonly [number, number, number]
const GROUND: Rgb = [17, 22, 28]
const STONE: Rgb = [226, 232, 238]
const STONE_DARK: Rgb = [150, 163, 176]
/** The temperature line's own colour, so the arc is the same mark the charts draw. */
const WARM: Rgb = [217, 89, 38]

type Canvas = {
  line(x1: number, y1: number, x2: number, y2: number, color: Rgb, width?: number, alpha?: number): void
  band(points: readonly (readonly [number, number, number])[], color: Rgb, alpha?: number): void
}

/**
 * One flattened stone.
 *
 * `band` takes a vertical span per column, which is what makes a smooth organic outline possible
 * with this rasteriser at all — the first attempt used rounded rectangles and produced a stack of
 * teacups with visible seams where the corners met.
 */
function stone(canvas: Canvas, cx: number, cy: number, width: number, height: number, tilt: number, tone: Rgb) {
  const points: [number, number, number][] = []
  const steps = Math.max(24, Math.round(width))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const reach = Math.sqrt(Math.max(0, 1 - Math.pow(2 * t - 1, 2)))
    const middle = cy + tilt * (t - 0.5)
    points.push([cx - width / 2 + width * t, middle - height / 2 * reach, middle + height / 2 * reach])
  }
  canvas.band(points, tone, 1)
}

/** Stones of unequal size, each set a little off the one below. Built rather than printed is the
 *  whole difference between a waymark and a wedding cake. */
const STONES = [
  { width: 0.64, height: 0.150, offset: 0.000, tilt: 0.020 },
  { width: 0.50, height: 0.135, offset: 0.045, tilt: -0.030 },
  { width: 0.40, height: 0.125, offset: -0.040, tilt: 0.025 },
  { width: 0.28, height: 0.110, offset: 0.030, tilt: -0.015 },
  { width: 0.17, height: 0.090, offset: -0.010, tilt: 0.010 },
] as const

export function renderIcon(
  size: number,
  CanvasClass: new (w: number, h: number, bg: Rgb) => Canvas,
  encodePng: (canvas: Canvas) => Uint8Array,
): Uint8Array {
  const canvas = new CanvasClass(size, size, GROUND)
  const stroke = Math.max(1.8, size * 0.045)

  // The arc first, so a stone that reaches it sits in front rather than behind.
  let previous: [number, number] | undefined
  for (let step = 0; step <= 100; step++) {
    const t = step / 100
    const point: [number, number] = [
      size * 0.11 + size * 0.78 * t,
      size * 0.285 - size * 0.105 * Math.sin(t * Math.PI),
    ]
    if (previous) canvas.line(previous[0], previous[1], point[0], point[1], WARM, stroke)
    previous = point
  }

  const scale = size * 0.88
  let y = size * 0.855
  STONES.forEach((current, index) => {
    const width = scale * current.width
    const height = scale * current.height
    y -= height / 2
    stone(canvas, size / 2 + scale * current.offset, y, width, height, scale * current.tilt,
      index % 2 ? STONE_DARK : STONE)
    y -= height / 2 - scale * 0.012
  })
  return encodePng(canvas)
}
