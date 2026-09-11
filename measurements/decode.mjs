// Lossless WebP is half the bytes of the PNG. Does it cost more to decode, and how much?
import { firefox } from "playwright"
const browser = await firefox.launch()
const page = await (await browser.newContext()).newPage()
await page.goto("http://127.0.0.1:8787/", { waitUntil: "domcontentloaded" })

const result = await page.evaluate(async () => {
  async function bytes(url, type) {
    const buffer = await (await fetch(url)).arrayBuffer()
    return { blob: new Blob([buffer], { type }), size: buffer.byteLength }
  }
  const png = await bytes("g/central-section/comparison-dark.png", "image/png")
  const webp = await bytes("g/central-section/comparison-dark.webp", "image/webp")

  async function time(entry, runs) {
    const marks = []
    for (let i = 0; i < runs; i++) {
      const t = performance.now()
      const bitmap = await createImageBitmap(entry.blob)
      marks.push(performance.now() - t)
      bitmap.close()
    }
    marks.sort((a, b) => a - b)
    return { median: +marks[Math.floor(marks.length / 2)].toFixed(1),
             best: +marks[0].toFixed(1), kb: Math.round(entry.size / 1024) }
  }
  await time(png, 3); await time(webp, 3)                    // warm up
  return { png: await time(png, 25), webp: await time(webp, 25) }
})
console.log("PNG :", JSON.stringify(result.png))
console.log("WebP:", JSON.stringify(result.webp))
console.log("decode cost:", (result.webp.median / result.png.median).toFixed(2) + "×",
            " bytes:", (result.webp.kb / result.png.kb * 100).toFixed(0) + "%")
await browser.close()
