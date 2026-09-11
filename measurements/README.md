# The measurements the figures came out of

Ten probes, one per question. They are not a test suite and nothing runs them on a schedule: each
one opens the built page, answers **one** question with a number, and prints it. They are here
because `OFFLINE-PATTERN.md` and `HANDOVER.md` beside them quote those numbers, and a figure
without the thing that produced it is a belief.

Written on 2026-09-01/02 in `~/mockups/almanac/harness/`, brought in on 2026-09-11 when that
directory was cleared. Fifteen more scratch iterations were left behind: they carried no comment
saying what they asked, and importing them would have traded a directory whose purpose is being
thrown away for one nobody dares to.

| | asks | figure it produced |
| --- | --- | --- |
| `agebounds.mjs` | does the shipped `age()` schedule its own next wake-up exactly on the minute its answer stops being true, over five days at one-minute resolution? | *one wake-up an hour rather than twelve, and exact* — 7,201 minutes checked, 0 problems |
| `live.mjs` | what does a kept copy weigh against the **published** site rather than the preview? | 9.18 MB, of which the three maps are 4.79 MB. The preview 404s the maps, so a figure taken locally leaves them out — two claims in that session did |
| `quiet.mjs` | does the page in the foreground touch the network at all, and how many timers does it leave armed? | zero requests, no interval |
| `decode.mjs` | does lossless WebP cost more to decode than the PNG it replaces? | 1.91× PNG, in Firefox — the one number in that trade that hardware changes |
| `atomic.mjs` | a new run arrives and the signal dies part-way through it: is the reader left with half of it? | the page is parked until its images are held, or not replaced at all |
| `open.mjs` | how long does the app take to open, in the three states a phone is actually in? | |
| `theme.mjs` | with the keep switch on, is only the theme on screen downloaded, and does a chart survive switching? | 4.35 MB against 8.7 for both |
| `pixels.mjs` | what does a phone decode to read this page, and how much of it is thrown away? | |
| `cv.mjs` | does `content-visibility: auto` reduce the work of reading, and what does it cost? | |
| `newrun.mjs` | does the chip say anything while a new run downloads behind it? | |

## Running one

`agebounds.mjs` needs nothing but node and a built page — it reads `../out/index.html`, pulls the
shipped `age()` out of it with `indexOf` and runs it against simulated time:

```bash
bun run page        # if out/index.html is not current
node measurements/agebounds.mjs
```

**The other nine drive a browser and this repository does not depend on one.** Playwright is not in
`package.json` and deliberately stays out of it: nothing here needs a browser to render or publish.
Install it beside them when you want to re-take a figure:

```bash
cd measurements && npm i playwright && npx playwright install firefox
node measurements/live.mjs
```

Paths are resolved from each file rather than written out, so they run wherever the repository is.
