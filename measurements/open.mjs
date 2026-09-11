// How long does the app take to open, in the three states a phone is actually in?
//
// The third is the one that matters and the hardest to stage: a radio that is attached but has no
// route. navigator.onLine says true, so the worker asks the network and waits for a timeout. A
// refused connection (server stopped) fails instantly and is not that case, so packets to the
// preview are dropped with a firewall rule for the last measurement.
import { firefox } from "playwright"
import { execFileSync } from "node:child_process"
// Resolved from this file, so the measurement runs wherever the repository is.
const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

// nft, because this box has no iptables. Its own table, so tearing it down cannot touch anything
// else that happens to be installed.
const nft = (args) => execFileSync("sudo", ["nft", ...args], { stdio: "ignore" })
const blackhole = (on) => {
  if (on) {
    nft(["add", "table", "inet", "wcprobe"])
    nft(["add", "chain", "inet", "wcprobe", "out", "{ type filter hook output priority 0 ; }"])
    nft(["add", "rule", "inet", "wcprobe", "out", "tcp", "dport", "8787", "drop"])
  } else {
    try { nft(["delete", "table", "inet", "wcprobe"]) } catch {}
  }
}
const server = (verb) => {
  if (verb === "stop") { try { execFileSync("systemctl", ["--user", "stop", "wc-preview"], { stdio: "ignore" }) } catch {}; return }
  try { execFileSync("systemctl", ["--user", "reset-failed", "wc-preview"], { stdio: "ignore" }) } catch {}
  execFileSync("systemd-run", ["--user", "--unit=wc-preview",
    `--working-directory=${REPO}`,
    "/usr/bin/mise", "exec", "--", "bun", "run", "preview"], { stdio: "ignore" })
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
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === "kept"), null, { timeout: 180000 })

  const time = async (label) => {
    const t = Date.now()
    let how = "ok"
    try { await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }) } catch (e) { how = "reload threw" }
    const chart = await page.evaluate(() => !!document.querySelector("picture img"))
    console.log(`${label.padEnd(34)} ${String(Date.now() - t).padStart(6)} ms   page drawn: ${chart}   ${how}`)
  }

  await time("network fine")
  server("stop")
  await time("connection refused")
  server("start")
  for (let i = 0; i < 40; i++) { try { if ((await fetch("http://127.0.0.1:8787/")).ok) break } catch {}
    await new Promise((r) => setTimeout(r, 250)) }
  blackhole(true)
  await time("packets dropped, onLine still true")
} finally {
  blackhole(false)
  await browser.close()
}
