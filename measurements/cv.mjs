// Does content-visibility: auto reduce the work of reading the page, and does it hurt the jumps?
import { firefox } from "playwright"

const CSS = `.place, .group > .card, .singles { content-visibility: auto; contain-intrinsic-size: auto 900px; }`

async function run(withCv) {
  const browser = await firefox.launch()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })
  const page = await context.newPage()
  if (withCv) await page.addInitScript((css) => {
    addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style"); style.textContent = css
      document.head.append(style)
    })
  }, CSS)
  await page.goto("http://127.0.0.1:8787/", { waitUntil: "load" })
  await page.waitForTimeout(1500)

  const scroll = await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(r))
    const start = performance.now()
    let frames = 0
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y)
      await frame(); await frame()
      frames += 2
    }
    return { ms: +(performance.now() - start).toFixed(0), frames,
             perFrame: +((performance.now() - start) / frames).toFixed(2) }
  })
  await page.waitForTimeout(1500)
  const state = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll("img")].filter((i) => i.naturalWidth > 0)
    return { decoded: imgs.length, height: document.body.scrollHeight }
  })

  // A jump has to land on the heading, not near it.
  await page.evaluate(() => { window.scrollTo(0, 0) })
  await page.waitForTimeout(400)
  const target = await page.evaluate(() => document.querySelector('.jump a[href^="#"]:not(.to-top)')?.getAttribute("href"))
  await page.click(`.jump a[href="${target}"]`)
  await page.waitForTimeout(1200)
  const landed = await page.evaluate((t) => {
    const el = document.querySelector(t)
    return +el.getBoundingClientRect().top.toFixed(0)
  }, target)
  await browser.close()
  return { ...scroll, ...state, jumpTo: target, landedAt: landed }
}

console.log("plain           :", JSON.stringify(await run(false)))
console.log("content-visibility:", JSON.stringify(await run(true)))
