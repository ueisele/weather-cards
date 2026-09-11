// A new run arrives and the signal dies part-way through it. Is the reader left with the previous
// version whole, or with a page pointing at images that were never fetched?
//
// **The new run has to be real.** Playwright's routing cannot stage it: once a service worker
// controls the page, the navigation is answered by the worker, and the worker's own fetch does not
// pass through page interception. So this rewrites out/ on disk between the two loads, and puts it
// back afterwards.
import { firefox } from "playwright"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs"
// Resolved from this file, so the measurement runs wherever the repository is.
const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

// **Playwright's setOffline does not reach the worker.** Neither does its routing: a service
// worker's own fetch goes straight out, so the only way to take the network away from it is to
// take the server away. A transient unit that is stopped no longer exists, so starting it again is
// systemd-run, not systemctl start.
function server(verb) {
  if (verb === "stop") {
    try { execFileSync("systemctl", ["--user", "stop", "wc-preview"], { stdio: "ignore" }) } catch {}
    return
  }
  try { execFileSync("systemctl", ["--user", "reset-failed", "wc-preview"], { stdio: "ignore" }) } catch {}
  execFileSync("systemd-run", ["--user", "--unit=wc-preview",
    `--working-directory=${REPO}`,
    "/usr/bin/mise", "exec", "--", "bun", "run", "preview"], { stdio: "ignore" })
}
async function serverUp() {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch("http://127.0.0.1:8787/")).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error("the preview did not come up")
}

const OUT = `${REPO}/out`
const MANIFEST = OUT + "/index.json"
const NEW = "20269999T999999Z"
const UNREACHABLE = 5              // places whose charts are moved aside, so their URLs 404

const original = readFileSync(MANIFEST, "utf8")
const manifest = JSON.parse(original)
const OLD = manifest.places[0].version
const moved = manifest.places.slice(-UNREACHABLE).map((p) => `${OUT}/p/${p.id}`)

function publishNewRun() {
  const next = JSON.parse(original)
  for (const entry of [...next.places, ...next.groups]) entry.version = NEW
  writeFileSync(MANIFEST, JSON.stringify(next, null, 2) + "\n")
  execFileSync("/usr/bin/mise", ["exec", "--", "bun", "run", "page"], { cwd: OUT + "/..", stdio: "ignore" })
  for (const dir of moved) renameSync(dir, dir + ".hidden")
}
function putItBack() {
  for (const dir of moved) if (existsSync(dir + ".hidden")) renameSync(dir + ".hidden", dir)
  writeFileSync(MANIFEST, original)
  execFileSync("/usr/bin/mise", ["exec", "--", "bun", "run", "page"], { cwd: OUT + "/..", stdio: "ignore" })
}

const browser = await firefox.launch()
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.addInitScript(() => {
    window.__msgs = []
    navigator.serviceWorker.addEventListener("message", (e) => window.__msgs.push(e.data))
  })

  await page.goto("http://127.0.0.1:8787/", { waitUntil: "load" })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 })
  await page.click("#keep")
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === "kept"), null, { timeout: 120000 })
  console.log("held:", JSON.stringify(await page.evaluate(() => window.__msgs.at(-1))))

  // **One more load of the same run.** The very first navigation happens before the worker controls
  // the page, so it is never cached — and a worker with nothing cached has nothing to protect and
  // caches the next document at once, correctly. A reader on their second visit is the situation
  // worth testing, so put the page in that state first.
  await page.reload({ waitUntil: "load" })
  await page.waitForTimeout(1500)
  console.log("document held before the new run:", await page.evaluate(async (old) => {
    const keys = (await (await caches.open("almanac")).keys()).map((k) => k.url)
    const doc = keys.find((u) => !/\.(webp|png|svg|json)(\?|$)/.test(u) && !u.includes("invalid"))
    if (!doc) return "none"
    return (await (await (await caches.open("almanac")).match(doc)).text()).includes(old)
      ? "yes, the current run" : "yes, but not this run"
  }, OLD))

  publishNewRun()
  await page.evaluate(() => { window.__msgs.length = 0 })
  await page.reload({ waitUntil: "load" })
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === "stalled" || m.type === "kept"),
    null, { timeout: 60000 })
  console.log("the refresh:", JSON.stringify(await page.evaluate(
    () => window.__msgs.filter((m) => m.type === "stalled" || m.type === "kept").at(-1))))

  const cachedDoc = async (label) => {
    const which = await page.evaluate(async (marks) => {
      const cache = await caches.open("almanac")
      const keys = await cache.keys()
      const doc = keys.find((k) => !/\.(webp|png|svg|json)(\?|$)/.test(k.url) && !k.url.includes("invalid"))
      if (!doc) return "no document cached"
      const text = await (await cache.match(doc)).text()
      const staged = keys.some((k) => k.url.includes("staged"))
      return (text.includes(marks.NEW) ? "new" : text.includes(marks.OLD) ? "previous" : "?") +
        (staged ? " (a staged one is parked)" : "")
    }, { OLD, NEW })
    console.log(`cached document ${label}: ${which}`)
  }
  await cachedDoc("after the broken refresh")

  server("stop")
  await context.setOffline(true)
  await page.reload({ waitUntil: "load" })
  await page.waitForTimeout(1500)
  // Every chart, not just the one above the fold: scroll the page the way a reader does so the
  // lazy images are actually asked for, with no server to ask.
  await page.evaluate(async () => {
    for (const details of document.querySelectorAll("details")) details.open = true
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 80))
    }
  })
  await page.waitForTimeout(3000)
  const state = await page.evaluate(async (marks) => {
    const html = document.documentElement.outerHTML
    const imgs = [...document.querySelectorAll("picture img")]
    await Promise.all(imgs.map((i) => i.decode().catch(() => {})))
    const asked = imgs.filter((i) => i.currentSrc)
    const keys = (await (await caches.open("almanac")).keys()).map((k) => k.url)
    return {
      documentIs: html.includes(marks.NEW) ? "the new run — half of it missing"
        : html.includes(marks.OLD) ? "the previous run, whole" : "?",
      firstChartAsks: imgs[0]?.getAttribute("src")?.split("?").pop(),
      chartsAsked: asked.length,
      chartsDrawn: asked.filter((i) => i.naturalWidth > 0).length,
      broken: asked.filter((i) => i.naturalWidth === 0).length,
      fromOldRun: keys.filter((u) => u.includes(marks.OLD)).length,
      fromNewRun: keys.filter((u) => u.includes(marks.NEW)).length,
      stagedLeftBehind: keys.filter((u) => u.includes("staged")).length,
    }
  }, { OLD, NEW })
  await cachedDoc("after the offline reload")
  console.log("offline after the broken refresh:", JSON.stringify(state, null, 1))
} finally {
  await browser.close()
  server("stop")
  putItBack()
  server("start")
  await serverUp()
}
