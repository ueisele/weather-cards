#!/usr/bin/env bun
/**
 * Rebuild `out/index.html` from the manifest a previous render left behind.
 *
 *     bun run page
 *
 * For working on the page itself. The charts are the expensive part and they do not change when
 * the layout does, so this exists to keep design iterations off the providers' APIs.
 */
import { join, resolve } from "node:path"
import { isManifest, MANIFEST_KEY, PAGE_KEY } from "./lib/manifest"
import { REPOSITORY_ROOT } from "./lib/renderer"
import { renderPage } from "./lib/page"
import { renderWebmanifest, WEBMANIFEST_KEY, WORKER_KEY, WORKER_SOURCE } from "./lib/offline"

const out = resolve(REPOSITORY_ROOT, process.env.WEATHER_CARDS_OUT ?? "out")
const manifest: unknown = await Bun.file(join(out, MANIFEST_KEY)).json().catch(() => undefined)
if (!isManifest(manifest)) {
  console.error(`No usable ${MANIFEST_KEY} in ${out}. Run 'bun run render' first.`)
  process.exit(1)
}
await Bun.write(join(out, PAGE_KEY), renderPage(manifest))
await Bun.write(join(out, WORKER_KEY), WORKER_SOURCE)
await Bun.write(join(out, WEBMANIFEST_KEY), renderWebmanifest(manifest) + "\n")
console.log(`${join(out, PAGE_KEY)} rebuilt from ${manifest.generated_at}.`)
