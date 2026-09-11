// What does a phone actually decode to read this page, and how much of it is thrown away?
import { firefox } from "playwright"
const browser = await firefox.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })
const page = await context.newPage()
await page.goto("http://127.0.0.1:8787/", { waitUntil: "load" })
await page.waitForTimeout(2000)

const geom = await page.evaluate(() => {
  const img = document.querySelector("picture img")
  const r = img.getBoundingClientRect()
  return { cssWidth: +r.width.toFixed(1), natural: img.naturalWidth + "×" + img.naturalHeight,
           dpr: devicePixelRatio, needed: Math.round(r.width * devicePixelRatio),
           pageHeight: document.body.scrollHeight, viewport: innerHeight }
})
console.log("chart on a phone:", JSON.stringify(geom))

// Scroll the whole page the way a reader does, then count what got decoded.
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 600) {
    window.scrollTo(0, y)
    await new Promise((r) => setTimeout(r, 60))
  }
})
await page.waitForTimeout(2500)
const decoded = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll("img")].filter((i) => i.naturalWidth > 0)
  const px = imgs.reduce((n, i) => n + i.naturalWidth * i.naturalHeight, 0)
  const shownPx = imgs.reduce((n, i) => {
    const r = i.getBoundingClientRect()
    return n + Math.round(r.width * devicePixelRatio) * Math.round(r.height * devicePixelRatio)
  }, 0)
  return { images: imgs.length, decodedMpx: +(px / 1e6).toFixed(1), shownMpx: +(shownPx / 1e6).toFixed(1),
           ratio: +(px / shownPx).toFixed(2), bitmapMB: +(px * 4 / 1048576).toFixed(0) }
})
console.log("after reading the page:", JSON.stringify(decoded))
await browser.close()
