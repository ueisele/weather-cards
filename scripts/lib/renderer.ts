/**
 * Where the chart renderer comes from.
 *
 * The renderer is not vendored here. It is the point weather tool of the `web-research` plugin in
 * the dotfiles repository, which is public, has no npm dependency on the weather path, and carries
 * the tests that say the charts are right. Copying it would fork it; publishing it as a package
 * would be a refactoring with no reader. So this repository names a commit of it and imports it.
 *
 * The commit is pinned in `renderer.json` rather than tracking a branch. A change to how the charts
 * look should be a commit in *this* repository's history — something you did — and not something
 * that happened to the site overnight because a plugin was improved.
 */
import { existsSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

export type RendererPin = Readonly<{
  repository: string
  commit: string
  /** Where the plugin sits inside the repository — what gets imported. */
  entry: string
  /** What the checkout must hold. Wider than `entry`: the plugin imports out of its own directory. */
  paths: readonly string[]
}>

export async function readPin(): Promise<RendererPin> {
  const pin = await Bun.file(join(REPOSITORY_ROOT, "renderer.json")).json() as Record<string, unknown>
  for (const key of ["repository", "commit", "entry"]) {
    if (typeof pin[key] !== "string" || (pin[key] as string) === "") {
      throw new Error(`renderer.json: ${key} must be a non-empty string.`)
    }
  }
  if (!Array.isArray(pin.paths) || pin.paths.length === 0 || pin.paths.some((entry) => typeof entry !== "string")) {
    throw new Error("renderer.json: paths must be a non-empty array of strings.")
  }
  return pin as unknown as RendererPin
}

/** Where `bun run renderer` puts the checkout, and where the renderer is looked for by default. */
export function checkoutDirectory() {
  return join(REPOSITORY_ROOT, ".renderer")
}

/**
 * The one thing in this repository that knows about the world outside it, and a default rather
 * than a requirement — the same shape as `trails_dir` in home/trails-map's justfile.
 *
 * Order: an explicit path wins, then a checkout fetched here, then a sibling working copy. The
 * sibling is what makes a laptop run need no fetch at all; CI has no siblings and fetches.
 */
export async function rendererDirectory(): Promise<string> {
  const named = process.env.WEATHER_CARDS_RENDERER
  if (named) {
    const path = isAbsolute(named) ? named : resolve(REPOSITORY_ROOT, named)
    if (!existsSync(join(path, "lib/web-research/tools/weather-core.ts"))) {
      throw new Error(`WEATHER_CARDS_RENDERER points at ${path}, which holds no renderer.`)
    }
    return path
  }
  const pin = await readPin()
  const candidates = [
    join(checkoutDirectory(), pin.entry),
    resolve(REPOSITORY_ROOT, "..", "dotfiles", pin.entry),
  ]
  for (const path of candidates) {
    if (existsSync(join(path, "lib/web-research/tools/weather-core.ts"))) return path
  }
  throw new Error([
    "No chart renderer found. Either fetch the pinned one:",
    "    bun run renderer",
    "or point at a working copy of the dotfiles repository:",
    "    WEATHER_CARDS_RENDERER=/path/to/dotfiles/15_opencode/plugins/web-research",
    `Looked in: ${candidates.join(", ")}`,
  ].join("\n"))
}

/** Only what this repository actually calls; the plugin's own types stay in the plugin. */
export type Renderer = {
  executeWeather(input: unknown, dependencies: unknown): Promise<any>
  ArtifactStore: new (options: any) => any
  sessionTreeKey(name: string): string
  SafeDirectClient: new (options: any) => any
  nodeDirectRequestExecutor: unknown
  nodeDnsResolver: unknown
  secureIds: unknown
  systemClock: { now(): Date }
  /** The chart's own rasteriser, so the app icon is drawn with what draws the charts. */
  Canvas: new (width: number, height: number, background: readonly [number, number, number]) => any
  encodePng: (canvas: any) => Uint8Array
}

export async function loadRenderer(): Promise<Renderer> {
  const root = await rendererDirectory()
  const at = (path: string) => import(join(root, path))
  const [core, store, tree, direct, dependencies, canvas] = await Promise.all([
    at("lib/web-research/tools/weather-core.ts"),
    at("lib/web-research/artifacts/store.ts"),
    at("lib/web-research/artifacts/session-tree.ts"),
    at("lib/web-research/runtime/direct-download.ts"),
    at("lib/web-research/runtime/dependencies.ts"),
    at("lib/web-research/tools/weather-canvas.ts"),
  ])
  return {
    executeWeather: core.executeWeather,
    ArtifactStore: store.ArtifactStore,
    sessionTreeKey: tree.sessionTreeKey,
    SafeDirectClient: direct.SafeDirectClient,
    nodeDirectRequestExecutor: direct.nodeDirectRequestExecutor,
    nodeDnsResolver: dependencies.nodeDnsResolver,
    secureIds: dependencies.secureIds,
    systemClock: dependencies.systemClock,
    Canvas: canvas.Canvas,
    encodePng: canvas.encodePng,
  }
}
