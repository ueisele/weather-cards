// A new run reaches a phone that keeps a copy: does the chip say anything while it downloads?
import { firefox } from "playwright"
const browser = await firefox.launch()
const page = await (await browser.newContext()).newPage()
await page.addInitScript(() => {
  window.__msgs = []
  window.__chip = []
  navigator.serviceWorker.addEventListener("message", (e) => window.__msgs.push(e.data))
  addEventListener("DOMContentLoaded", () => {
    const age = document.getElementById("keep-age")
    const button = document.getElementById("keep")
    setInterval(() => {
      const text = age.textContent
      const pressed = button.getAttribute("aria-pressed")
      const last = window.__chip[window.__chip.length - 1]
      const now = text + "/" + pressed
      if (now !== last) window.__chip.push(now)
    }, 50)
  })
})
await page.goto("http://127.0.0.1:8787/", { waitUntil: "load" })
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 })
await page.click("#keep")
await page.waitForFunction(() => window.__msgs.some((m) => m.type === "kept"), null, { timeout: 120000 })
console.log("kept. chip went:", JSON.stringify(await page.evaluate(() => window.__chip)))

// A new run means every URL is one the cache has never seen. Emptying it is the same situation.
const removed = await page.evaluate(async () => {
  const cache = await caches.open("almanac")
  const keys = await cache.keys()
  let n = 0
  for (const request of keys) {
    if (/\.(webp|png|svg)(\?|$)/.test(request.url)) { await cache.delete(request); n++ }
  }
  return n
})
console.log("emptied", removed, "entries — now a reload is a new run")

await page.reload({ waitUntil: "load" })
await page.waitForTimeout(12000)
console.log("chip after the reload:", JSON.stringify(await page.evaluate(() => window.__chip)))
console.log("messages:", JSON.stringify(await page.evaluate(
  () => window.__msgs.map((m) => m.type + (m.done ? ":" + m.done : "")))))
await browser.close()
