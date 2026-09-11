// With the keep switch on: is only the theme on screen downloaded, and does a chart still appear
// when the theme flips while offline?
import { firefox } from "playwright"
const browser = await firefox.launch()
const context = await browser.newContext()
const page = await context.newPage()
await page.addInitScript(() => {
  window.__msgs = []
  navigator.serviceWorker.addEventListener("message", (e) => window.__msgs.push(e.data))
})
await page.goto("http://127.0.0.1:8787/", { waitUntil: "load" })
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 })

await page.click("#keep")
await page.waitForFunction(() => window.__msgs.some((m) => m.type === "kept" || m.type === "stalled"),
  null, { timeout: 120000 })
console.log("worker said:", JSON.stringify(page.evaluate ? await page.evaluate(
  () => window.__msgs.filter((m) => m.type === "kept" || m.type === "stalled")) : null))

const held = await page.evaluate(async () => {
  const cache = await caches.open("almanac")
  const keys = await cache.keys()
  let bytes = 0, dark = 0, light = 0
  for (const request of keys) {
    if (/-dark\.(png|webp)/.test(request.url)) dark++
    if (/-light\.(png|webp)/.test(request.url)) light++
    const response = await cache.match(request)
    if (response) bytes += (await response.blob()).size
  }
  return { entries: keys.length, dark, light, mb: +(bytes / 1048576).toFixed(2) }
})
console.log("cache:", JSON.stringify(held))

// Now flip the theme with no connection and see whether a chart still draws.
await context.setOffline(true)
await page.evaluate(() => localStorage.setItem("theme", "dark"))
await page.reload({ waitUntil: "load" })
await page.waitForTimeout(2500)
const shot = await page.evaluate(() => {
  const img = document.querySelector("picture img")
  const source = img?.closest("picture")?.querySelector("source")
  return {
    theme: document.documentElement.dataset.theme,
    asked: img?.currentSrc?.split("/").pop(),
    sourceMedia: source?.media,
    drawn: (img?.naturalWidth ?? 0) > 0,
  }
})
console.log("offline, theme flipped:", JSON.stringify(shot))
await browser.close()
