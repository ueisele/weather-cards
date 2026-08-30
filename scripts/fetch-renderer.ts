/**
 * Fetch the pinned chart renderer into `.renderer/`.
 *
 *     bun run renderer              # fetch the pinned commit
 *     bun run renderer -- --update  # move the pin to the tip of the default branch
 *
 * A partial, sparse clone: no blobs until they are needed and only the plugin's own directory, so
 * a repository of this size arrives in about two seconds and twelve megabytes instead of all of it.
 */
import { rm } from "node:fs/promises"
import { checkoutDirectory, readPin, REPOSITORY_ROOT } from "./lib/renderer"
import { join } from "node:path"

async function git(cwd: string, ...args: string[]) {
  const run = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [out, error, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ])
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${error.trim() || out.trim()}`)
  return out.trim()
}

const update = process.argv.includes("--update")
const pin = await readPin()
const directory = checkoutDirectory()

// Always from scratch. An incremental update would have to reason about a dirty or half-fetched
// checkout, and the whole fetch costs about as much as working that out would.
await rm(directory, { recursive: true, force: true })
console.log(`Fetching ${pin.repository} at ${update ? "the default branch" : pin.commit} …`)
await git(REPOSITORY_ROOT, "clone", "--quiet", "--filter=blob:none", "--sparse", pin.repository, directory)
await git(directory, "sparse-checkout", "set", ...pin.paths)
if (!update) await git(directory, "checkout", "--quiet", pin.commit)

const head = await git(directory, "rev-parse", "HEAD")
const subject = await git(directory, "log", "-1", "--format=%s")
console.log(`  ${head.slice(0, 7)}  ${subject}`)

if (update) {
  if (head.startsWith(pin.commit)) {
    console.log("The pin is already the tip; renderer.json unchanged.")
  } else {
    const path = join(REPOSITORY_ROOT, "renderer.json")
    const raw = await Bun.file(path).text()
    // A textual replacement rather than a re-serialization, so the comment in the file survives.
    await Bun.write(path, raw.replace(`"commit": "${pin.commit}"`, `"commit": "${head.slice(0, 7)}"`))
    console.log(`renderer.json: ${pin.commit} -> ${head.slice(0, 7)}. Render, look at the charts, then commit it.`)
  }
}
