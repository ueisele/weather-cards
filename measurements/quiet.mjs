// Does the page in the foreground touch the network at all, and how many timers does it arm?
import { firefox } from "playwright"

const browser = await firefox.launch()
const context = await browser.newContext()
const page = await context.newPage()

// Record every timer the page arms, before any page script runs.
await page.addInitScript(() => {
  window.__timers = []
  const si = window.setInterval, st = window.setTimeout
  window.setInterval = function (fn, ms) { window.__timers.push(["interval", ms]); return si.apply(this, arguments) }
  window.setTimeout = function (fn, ms) { if (ms >= 10000) window.__timers.push(["timeout", ms]); return st.apply(this, arguments) }
})

await page.goto("http://127.0.0.1:8787/", { waitUntil: "load" })
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })
await page.waitForTimeout(3000)

const timers = await page.evaluate(() => window.__timers)
console.log("timers armed:", JSON.stringify(timers))

// From here on, nothing the page does should reach the network.
const seen = []
page.on("request", (r) => seen.push(r.url()))

// Away and back, twice — the moment the removed rule used to fire on.
for (let i = 0; i < 2; i++) {
  for (const state of ["hidden", "visible"]) {
    await page.evaluate((s) => {
      Object.defineProperty(document, "visibilityState", { value: s, configurable: true })
      Object.defineProperty(document, "hidden", { value: s === "hidden", configurable: true })
      document.dispatchEvent(new Event("visibilitychange"))
    }, state)
    await page.waitForTimeout(1500)
  }
}
await page.waitForTimeout(4000)

console.log("requests after load:", seen.length, seen.slice(0, 8))
console.log("still the same document:", await page.evaluate(() => performance.getEntriesByType("navigation").length))
await browser.close()
