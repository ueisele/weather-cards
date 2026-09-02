/**
 * The charts, losslessly re-encoded from PNG to WebP.
 *
 * **Half the bytes and the same pixels.** Measured across a whole run: 16.60 MB of PNG became
 * 8.55 MB of WebP, and every one of the 86 images decoded back to a bitmap identical to the
 * original — lossless here is the literal kind, not the "you will not notice" kind. What it buys is
 * the radio, which is where a phone's energy goes: a kept offline copy drops by about four
 * megabytes per refresh.
 *
 * **It costs decoding.** In Firefox a chart decodes in 21 ms as WebP against 11 ms as PNG, so a
 * full read of the page spends roughly 130 ms more CPU. Against one saved download that is not a
 * close call — cellular costs joules per megabyte and a decode costs milliwatt-milliseconds — but
 * it is the reason this is a considered trade rather than a free win.
 *
 * **`cwebp` from `libwebp-tools`, not a library.** The repository has no dependencies and the
 * renderer hand-rolls its PNG encoder rather than take one, so adding a native npm package for this
 * would be out of character. A Python encoder through `uv` was the other candidate and is the worse
 * one here: `uv` is a mise tool, the hourly publish resolves its PATH from `home/weather-cards`
 * where mise.toml does not name it, and the failure would be the trap this box's CLAUDE.md already
 * warns about. `/usr/bin/cwebp` is in the unit's PATH with nothing to arrange.
 *
 * **`-z 6` rather than `-z 9`.** Measured over the run: z 6 takes 2.0 s across eight cores for
 * 8.55 MB; z 9 takes 47 s for 8.24 MB. Forty-five seconds of eight cores, every hour, for 310 KB
 * is a worse energy trade than the one it is trying to win.
 */
import { rm } from "node:fs/promises"

const ENCODER = "/usr/bin/cwebp"

/** Eight, because the box has eight cores and the encoder is single-threaded per file. Encoding is
 *  the whole of the work, so there is nothing to overlap it with and nothing gained by going wider. */
const LANES = 8

export function webpKey(keyBase: string, theme: string) {
  return `${keyBase}-${theme}.webp`
}

/** The file the encoder reads: the same name with the other extension, so nothing has to carry a
 *  second path around. */
export function sourcePng(webpPath: string) {
  return webpPath.replace(/\.webp$/, ".png")
}

/**
 * Encode each PNG to a WebP beside it and remove the PNG. Throws if any file fails: a run that
 * published a manifest naming a `.webp` that is not there would 404 every chart, and failing here
 * is how that stays impossible.
 */
export async function toLosslessWebp(pngPaths: readonly string[]) {
  if (pngPaths.length === 0) return
  if (!(await Bun.file(ENCODER).exists())) {
    throw new Error(`${ENCODER} is missing — install it with: sudo dnf install libwebp-tools`)
  }
  const queue = [...pngPaths]
  const failures: string[] = []
  async function lane() {
    for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
      const target = path.replace(/\.png$/, ".webp")
      const run = Bun.spawn([ENCODER, "-quiet", "-lossless", "-z", "6", path, "-o", target],
        { stdout: "pipe", stderr: "pipe" })
      const [code, error] = await Promise.all([run.exited, new Response(run.stderr).text()])
      if (code !== 0) { failures.push(`${path}: ${error.trim() || `cwebp exited ${code}`}`); continue }
      await rm(path, { force: true })
    }
  }
  await Promise.all(Array.from({ length: Math.min(LANES, pngPaths.length) }, lane))
  if (failures.length > 0) {
    throw new Error(`${failures.length} chart(s) could not be encoded:\n  ${failures.join("\n  ")}`)
  }
}
