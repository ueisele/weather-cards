/**
 * The app icon, drawn rather than stored.
 *
 * The site has no wordmark and does not want one; what it has is a shape — a temperature line over
 * a dark panel, which is what every card on it looks like. So the icon is that, at icon size, drawn
 * with the chart's own rasteriser so it cannot drift away from what it stands for.
 *
 * iOS applies its own rounded mask to `apple-touch-icon`, so this draws a full square and leaves
 * the corners to the system. Nothing important goes near an edge.
 */
export const ICON_SIZES = [180, 192, 512] as const
export const iconKey = (size: number) => `icon-${size}.png`

type Rgb = readonly [number, number, number]
const GROUND: Rgb = [23, 28, 34]
const CURVE: Rgb = [217, 89, 38]
const RAIN: Rgb = [57, 135, 229]

/** A curve with two days in it: the shape a reader recognises before reading anything. */
function temperature(t: number) {
  return 0.52 + 0.42 * Math.sin(t * Math.PI * 3.0 - 1.7) + 0.07 * Math.sin(t * Math.PI * 6.5 + 0.5)
}

export function renderIcon(
  size: number,
  Canvas: new (w: number, h: number, bg: Rgb) => any,
  encodePng: (canvas: any) => Uint8Array,
): Uint8Array {
  const canvas = new Canvas(size, size, GROUND)
  const inset = size * 0.15
  const span = size - inset * 2
  const stroke = Math.max(2, size * 0.062)
  // The columns stand on this and the curve rides above it, which is the arrangement on a card.
  const floor = size * 0.74
  const top = size * 0.26

  const bars = 9
  for (let i = 0; i < bars; i++) {
    const t = (i + 0.5) / bars
    const height = (floor - top) * 0.62 * Math.max(0, Math.sin(t * Math.PI * 2.1 + 0.5))
    if (height < size * 0.03) continue
    const width = span / bars * 0.46
    canvas.fill(inset + span * t - width / 2, floor - height, width, height, RAIN, 0.6)
  }

  let previous: [number, number] | undefined
  for (let step = 0; step <= 120; step++) {
    const t = step / 120
    const point: [number, number] = [inset + span * t, floor - (floor - top) * temperature(t)]
    if (previous) canvas.line(previous[0], previous[1], point[0], point[1], CURVE, stroke)
    previous = point
  }
  return encodePng(canvas)
}
