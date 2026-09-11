// Sweep the shipped age() across five days: does its own `until` land exactly on the moment the
// text or colour changes, and never skip one?
import { readFileSync } from "node:fs"
const html = readFileSync(new URL("../out/index.html", import.meta.url), "utf8")
const start = html.indexOf("function age() {")
const end = html.indexOf("\n  }", start)
const source = html.slice(start, end + 4)
if (start < 0) throw new Error("age() not found in the built page")

const GENERATED = "2026-09-02T00:00:00.000Z"
let NOW = 0
const age = new Function("GENERATED", "Date", source + "\nreturn age")(
  GENERATED, { parse: Date.parse, now: () => NOW })

const base = Date.parse(GENERATED)
const key = (a) => a.text + "/" + a.tone
let checked = 0, bad = []
for (let m = 0; m <= 5 * 24 * 60; m++) {
  NOW = base + m * 60000
  const here = age()
  if (here.until < 60000) bad.push(["until below the floor", m, here.until])
  // Nothing may change before `until`, and something must change just after it.
  const beforeAt = NOW + here.until - 2000
  const afterAt = NOW + here.until + 2000
  NOW = beforeAt; const before = age()
  NOW = afterAt; const after = age()
  if (key(before) !== key(here)) bad.push(["changed early", m, key(here), key(before)])
  if (key(after) === key(here) && here.until < 86400000) bad.push(["missed its own boundary", m, key(here)])
  checked++
}
console.log("minutes checked:", checked, "problems:", bad.length)
bad.slice(0, 10).forEach((b) => console.log("  ", b.join("  ")))

// And what the day actually looks like: every distinct state and when it starts.
NOW = base
let last = null
const timeline = []
for (let m = 0; m <= 5 * 24 * 60; m++) {
  NOW = base + m * 60000
  const a = age()
  if (key(a) !== last) { timeline.push(`+${String(Math.floor(m / 60)).padStart(3)}h${String(m % 60).padStart(2, "0")}  ${a.text} (${a.tone})`); last = key(a) }
}
console.log(timeline.join("\n"))
