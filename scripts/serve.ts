#!/usr/bin/env bun
/**
 * Serve `out/` over HTTP so the page can be looked at before it is published.
 *
 *     bun run preview
 *
 * Opening `out/index.html` straight from the filesystem does not work: the image URLs carry a
 * `?v=` token, and a `file://` URL has no query string — the browser looks for a file whose name
 * ends in `?v=…` and finds nothing. Thirty lines of server is the smaller fix.
 */
import { extname, join, normalize, resolve } from "node:path"
import { REPOSITORY_ROOT } from "./lib/renderer"

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
}

const root = resolve(REPOSITORY_ROOT, process.env.WEATHER_CARDS_OUT ?? "out")
const port = Number(process.env.PORT ?? 8787)

// A raw EADDRINUSE stack is the wrong answer to the commonest thing that happens here: an earlier
// preview is still running. Say which, and how to get past it — and do not quietly move to another
// port, because then the browser would still be looking at whatever holds this one.
function refuse(error: unknown) {
  if ((error as NodeJS.ErrnoException)?.code !== "EADDRINUSE") throw error
  console.error(`Port ${port} is already in use — most likely an earlier 'bun run preview'.`)
  console.error(`  what holds it:  ss -lptn 'sport = :${port}'`)
  console.error(`  use another:    PORT=${port + 1} bun run preview`)
  process.exit(1)
}

let server: ReturnType<typeof Bun.serve>
try {
  server = Bun.serve({
  port,
  async fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname)
    // The bucket has no index document either; `/` is the one path the Worker answers there.
    const key = path === "/" ? "index.html" : normalize(path).replace(/^\/+/, "")
    if (key.startsWith("..")) return new Response("No.\n", { status: 403 })
    const file = Bun.file(join(root, key))
    if (!(await file.exists())) return new Response(`Not in ${root}: ${key}\n`, { status: 404 })
    return new Response(file, {
      headers: { "content-type": TYPES[extname(key)] ?? "application/octet-stream" },
    })
  },
  })
} catch (error) {
  refuse(error)
}

console.log(`Serving ${root} at http://localhost:${server!.port}/  (ctrl-c to stop)`)

