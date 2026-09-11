// What a kept copy really weighs, against the published site rather than the preview — the
// preview has no maps, and they are the biggest files on the site.
import { firefox } from "playwright"
const browser = await firefox.launch()
const page = await (await browser.newContext()).newPage()
await page.addInitScript(() => {
  window.__msgs = []
  navigator.serviceWorker.addEventListener("message", (e) => window.__msgs.push(e.data))
})
await page.goto("https://almanac.cairn.zone/", { waitUntil: "load" })
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 })
console.log("URLs the page names:", await page.evaluate(() => {
  const all = [...document.querySelectorAll("script")].map((s) => s.textContent).join("")
  return JSON.parse(all.match(/var URLS = (\[.*?\]);/s)[1]).length
}))
await page.click("#keep")
await page.waitForFunction(() => window.__msgs.some((m) => m.type === "kept" || m.type === "stalled"),
  null, { timeout: 300000 })
console.log("worker:", JSON.stringify(await page.evaluate(
  () => window.__msgs.filter((m) => m.type === "kept" || m.type === "stalled"))))

const held = await page.evaluate(async () => {
  const cache = await caches.open("almanac")
  const kinds = {}
  for (const request of await cache.keys()) {
    const response = await cache.match(request)
    if (!response) continue
    const size = (await response.blob()).size
    const kind = /-(light|dark)\.webp/.test(request.url) ? "charts"
      : /\/m\//.test(request.url) ? "maps"
      : /icon-/.test(request.url) ? "icons" : "other"
    kinds[kind] = kinds[kind] || { n: 0, bytes: 0 }
    kinds[kind].n++; kinds[kind].bytes += size
  }
  let total = 0
  for (const k of Object.keys(kinds)) { total += kinds[k].bytes; kinds[k].mb = +(kinds[k].bytes / 1048576).toFixed(2); delete kinds[k].bytes }
  return { kinds, totalMb: +(total / 1048576).toFixed(2) }
})
console.log(JSON.stringify(held, null, 1))
await browser.close()
