#!/usr/bin/env bun
/**
 * Publish `out/` to the bucket it is served from.
 *
 *     bun run deploy
 *     bun run deploy --dry-run    # say what would happen, change nothing
 *
 * **This repository is public, so nothing about the account is written down in it.** Bucket and
 * endpoint arrive through the environment; `.env.example` names them and the OpenTofu module in
 * the private infrastructure repository prints them with `just deploy-env`. A default for either
 * would publish an account identifier to everyone who clones this.
 *
 * Three decisions worth keeping:
 *
 * - **The order is images, then index.json, then index.html, then the prune.** The page is written
 *   after everything it points at exists, and objects are removed only once the page that pointed
 *   at them is gone. There is no moment at which the published site refers to something missing.
 * - **No Cache-Control is set, and no cache is ever purged.** Every image URL carries the run's
 *   `?v=` token, so a new run is a new URL and a cached old one can never be served in its place.
 *   `.png` is edge-cached by extension; `.json` is not, so the manifest is always current.
 * - **The prune keeps what the manifest names, not what was uploaded.** A place whose sources
 *   failed keeps the entry — and therefore the images — from the run that last succeeded.
 */
import { readdir } from "node:fs/promises"
import { extname, join, relative, resolve } from "node:path"
import { isManifest, MANIFEST_KEY, PAGE_KEY, referencedKeys } from "./lib/manifest"
import { ICON_SIZES, iconKey } from "./lib/icon"
import { WEBMANIFEST_KEY, WORKER_KEY } from "./lib/offline"
import { REPOSITORY_ROOT } from "./lib/renderer"

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  // A service worker registers only when it arrives as JavaScript: served as octet-stream the
  // browser refuses with a bare SecurityError, and the page looks merely worker-less. Measured.
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
}

/** Everything the site is made of lives under one of these; the prune looks nowhere else. */
const MANAGED_PREFIXES = ["p/", "g/", "m/"]

/** Map tiles never change under their key, so an upload that already matches is skipped. */
const IMMUTABLE_PREFIX = "m/"

const dry = process.argv.includes("--dry-run")

function required(name: string) {
  const value = process.env[name]
  if (!value) {
    console.error(`${name} is not set. See .env.example, or run 'just deploy-env' in the`)
    console.error("infrastructure module and export what it prints.")
    process.exit(2)
  }
  return value
}

async function walk(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(root, path))
    else files.push(relative(root, path))
  }
  return files.sort()
}

const out = resolve(REPOSITORY_ROOT, process.env.WEATHER_CARDS_OUT ?? "out")
const manifest: unknown = await Bun.file(join(out, MANIFEST_KEY)).json().catch(() => undefined)
if (!isManifest(manifest)) {
  console.error(`No usable ${MANIFEST_KEY} in ${out}. Run 'bun run render' first.`)
  process.exit(1)
}

const bucket = required("WEATHER_CARDS_BUCKET")
const endpoint = required("WEATHER_CARDS_S3_ENDPOINT")
const client = new Bun.S3Client({
  bucket,
  endpoint,
  region: "auto",
  accessKeyId: required("AWS_ACCESS_KEY_ID"),
  secretAccessKey: required("AWS_SECRET_ACCESS_KEY"),
})

const referenced = referencedKeys(manifest)
const present = new Set(await walk(out))
// Only what this run drew and the manifest still names. A carried-over entry names images that are
// already in the bucket and not on disk; an experiment left in out/ is named by nothing and stays.
const images = [...referenced].filter((key) => present.has(key)).sort()
const carried = [...referenced].filter((key) => !present.has(key))
// The four the build always writes and this script always uploads. They are not in the manifest —
// it names images — so without naming them here they would be reported as left alone while being
// uploaded two lines further down.
const ALWAYS = new Set<string>([MANIFEST_KEY, PAGE_KEY, WORKER_KEY, WEBMANIFEST_KEY,
  ...ICON_SIZES.map(iconKey)])
const ignored = [...present].filter((key) => !referenced.has(key) && !ALWAYS.has(key))

console.log(`${manifest.generated_at} -> ${bucket}`)

// What the bucket already holds, read once and used twice: to skip re-uploading map tiles, and to
// find what the manifest no longer names. Bounded rather than a `while (truncated)` — a listing
// that silently stopped early would leave objects behind, and one that ran away would be deleting
// from a bucket it cannot enumerate.
const MAX_PAGES = 50
const existing = new Map<string, number>()
for (const prefix of MANAGED_PREFIXES) {
  let token: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const listed = await client.list({ prefix, maxKeys: 1000, ...(token ? { continuationToken: token } : {}) })
    for (const entry of listed.contents ?? []) existing.set(entry.key, entry.size ?? -1)
    if (!listed.isTruncated) break
    token = listed.nextContinuationToken
    if (!token) break
    if (page === MAX_PAGES - 1) throw new Error(`${prefix} holds more objects than this deploy will list.`)
  }
}

async function put(key: string, body: Uint8Array | string) {
  if (dry) return
  await client.write(key, body, { type: TYPES[extname(key)] ?? "application/octet-stream" })
}

let uploaded = 0
let skipped = 0
for (const key of images) {
  const body = await Bun.file(join(out, key)).bytes()
  // A map tile is the same picture under the same key forever, so re-uploading it every three
  // hours would be pure waste. Charts are always written: a redraw of the same hour is still new.
  if (key.startsWith(IMMUTABLE_PREFIX) && existing.get(key) === body.byteLength) { skipped++; continue }
  await put(key, body)
  uploaded++
}
// The manifest and the page last, and in that order: the page is what a visitor lands on, so it is
// the final thing to change, and the next run reads the manifest to know what it may keep.
for (const size of ICON_SIZES) {
  await put(iconKey(size), await Bun.file(join(out, iconKey(size))).bytes())
}
await put(WORKER_KEY, await Bun.file(join(out, WORKER_KEY)).text())
await put(WEBMANIFEST_KEY, await Bun.file(join(out, WEBMANIFEST_KEY)).text())
await put(MANIFEST_KEY, await Bun.file(join(out, MANIFEST_KEY)).text())
await put(PAGE_KEY, await Bun.file(join(out, PAGE_KEY)).text())
console.log(`  ${dry ? "would upload" : "uploaded"} ${uploaded + 4 + ICON_SIZES.length} objects${
  skipped > 0 ? `, ${skipped} map tile(s) already identical` : ""}${
  carried.length > 0 ? `, ${carried.length} kept from an earlier run` : ""}${
  ignored.length > 0 ? `\n  ${ignored.length} file(s) in out/ the manifest does not name, left alone (${ignored.slice(0, 3).join(", ")}${ignored.length > 3 ? ", …" : ""})` : ""}`)

const stale = [...existing.keys()].filter((key) => !referenced.has(key)).sort()
for (const key of stale) {
  console.log(`  ${dry ? "would remove" : "removing"} ${key}`)
  if (!dry) await client.delete(key)
}
console.log(`  ${stale.length} stale object(s)${dry ? " would be" : ""} removed`)

const host = process.env.WEATHER_CARDS_HOSTNAME
console.log(dry ? "\nDry run: nothing was changed." : `\nPublished${host ? ` at https://${host}/` : ""}.`)
