/**
 * The page, generated from the manifest.
 *
 * Generated rather than a static shell that fetches the manifest in the browser, because the job
 * that would have to run anyway can just as well write the anchors out. What that buys: the page
 * needs no JavaScript to work, `#lomsdal-visten` is a real anchor rather than a router, and a
 * reader with scripting off sees everything.
 *
 * **The theme is the system's, and can be overridden.** The charts are images with a theme baked
 * in, so the frame and the pictures have to move together or the page is half one thing and half
 * the other. Without scripting, `<picture>` picks by `prefers-color-scheme` and there is no switch.
 * With it, the switch changes the `<source>`'s media query itself — `all` always matches, `not all`
 * never does — so one attribute per image moves the pictures, the tokens and the full-size links at
 * once, and only the image actually shown is ever fetched.
 */
import type { Theme } from "./config"
import type { Card, GroupEntry, Manifest, MapCard, PlaceEntry, RegionEntry } from "./manifest"
import { iconUrl, offlineUrls, WEBMANIFEST_KEY, WORKER_KEY } from "./offline"

/** The chart canvas. Given on every image so the page reserves the space before one arrives. */
const CHART_WIDTH = 1920
const CHART_HEIGHT = 1958

/** Drawn, not typed. A Unicode moon or sun is a font question — measured once as an empty box —
 *  and these have to be legible at 19 px on a phone in daylight. */
const ICON = (paths: string) => `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"` +
  ` fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"` +
  ` stroke-linejoin="round">${paths}</svg>`
const ICONS = {
  auto: ICON(`<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none"/>`),
  light: ICON(`<circle cx="12" cy="12" r="4.2"/><path d="M12 3.2v1.9M12 18.9v1.9M4.6 12H2.7M21.3 12h-1.9M6.8 6.8L5.4 5.4M18.6 18.6l-1.4-1.4M6.8 17.2l-1.4 1.4M18.6 5.4l-1.4 1.4"/>`),
  dark: ICON(`<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z"/>`),
  top: ICON(`<path d="M12 19V6m0 0l-5 5M12 6l5 5"/>`),
  reload: ICON(`<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 4.6v4.2h-4.2"/>`),
  keep: ICON(`<circle cx="12" cy="12" r="9"/><path d="M12 7v8m0 0l-3.2-3.2M12 15l3.2-3.2"/>`),
  kept: ICON(`<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.6 2.6L16 9.6"/>`),
  menu: ICON(`<path d="M4 7h16M4 12h16M4 17h16"/>`),
} as const

/**
 * Where a model's own description lives.
 *
 * Editorial, so it sits here and not in the manifest: the renderer knows which models it drew and
 * what they are called, and has no business holding an opinion about where a reader should go to
 * find out what they are. Keyed by the manifest's slot, and a slot without an entry simply renders
 * unlinked rather than breaking — a fourth model can appear before anyone has chosen a page for it.
 */
const MODEL_PAGES: Readonly<Record<string, string>> = {
  met: "https://github.com/metno/NWPdocs/wiki/MEPS-model",
  icon: "https://www.dwd.de/EN/research/weatherforecasting/num_modelling/01_num_weather_prediction_modells/icon_description.html",
  ecmwf: "https://www.ecmwf.int/en/research/modelling-and-prediction",
}

function escape(value: unknown) {
  return String(value).replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!
  ))
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** UTC, like everything the tool produces — stated in the footer so the page never implies local. */
function stamp(iso: string) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const day = String(at.getUTCDate()).padStart(2, "0")
  const time = `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`
  return `${day} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${time} UTC`
}

function coordinates(latitude: number, longitude: number) {
  const north = `${Math.abs(latitude).toFixed(3)}°${latitude < 0 ? "S" : "N"}`
  const east = `${Math.abs(longitude).toFixed(3)}°${longitude < 0 ? "W" : "E"}`
  return `${north} ${east}`
}

/**
 * Which image is fetched immediately. Exactly one — the first on the page, which is what a visitor
 * is looking at while everything below it is still nothing but reserved space. Marking it lazy
 * would delay the only image that has to be there at once.
 */
type Priority = { first: boolean }

function figure(card: Card, version: string, alt: string, caption: string, priority: Priority) {
  const eager = priority.first
  priority.first = false
  // Relative rather than rooted: index.html sits at the bucket root beside `p/` and `g/`, so one
  // form works both on the site and in a local `out/` opened through `bun run preview`.
  const source = (theme: Theme) => `${card.keys[theme]}?v=${encodeURIComponent(version)}`
  // The link opens the chart at its own size, which is how something this dense is read on a phone.
  // Both addresses ride along, because which one is right depends on the theme on the screen: the
  // script sets `href` from these, and without scripting it stays on the light one the `<img>` has.
  return `<figure class="chart">
  <a class="chart-link" href="${escape(source("light"))}"
     data-light="${escape(source("light"))}" data-dark="${escape(source("dark"))}">
    <picture>
      <source srcset="${escape(source("dark"))}" media="(prefers-color-scheme: dark)">
      <img src="${escape(source("light"))}" width="${CHART_WIDTH}" height="${CHART_HEIGHT}"
           loading="${eager ? "eager" : "lazy"}"${eager ? ' fetchpriority="high"' : ""}
           decoding="async" alt="${escape(alt)}">
    </picture>
  </a>
  <figcaption>${escape(caption)}</figcaption>
</figure>`
}

/**
 * The locator map: one rendered image with the places drawn over it as SVG.
 *
 * Nothing is composited. The markers are vector, so they are crisp at any size and each is a link
 * to its own section; the map behind them is a link too, to a standalone SVG that carries the same
 * markers over the full-size image. Two `<a>` at the same level rather than nested ones — the pins
 * are drawn last and take their own clicks, the rest of the surface opens the big version.
 *
 * **The map keeps its own colours in both themes.** It is a picture of terrain, not part of the
 * page's furniture, and the usual invert-and-rotate trick makes a topographic map look cheap. The
 * markers are therefore fixed dark-on-white, which reads on every colour Kartverket draws.
 */
type Box = { x1: number; y1: number; x2: number; y2: number }
/** The label is painted with a 6-unit white outline that `getBBox` does not report, so two boxes
 *  can clear each other by four units and still touch on screen. Measured: a name is 31.3 units
 *  tall and at most 13.4 wide per character. The pad covers the outline and leaves a little air. */
const PAD = 9
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x2 + PAD, b.x2 + PAD) - Math.max(a.x1 - PAD, b.x1 - PAD)) *
  Math.max(0, Math.min(a.y2 + PAD, b.y2 + PAD) - Math.max(a.y1 - PAD, b.y1 - PAD))

/** The text alone. */
function textBox(marker: { x: number; y: number }, width: number, dx: number, dy: number, anchor: string): Box {
  const x = marker.x + dx
  const x1 = anchor === "end" ? x - width : anchor === "middle" ? x - width / 2 : x
  const y1 = marker.y + dy - 22.5
  return { x1, y1, x2: x1 + width, y2: y1 + 32 }
}

/** **The plate is the unit.** Dot and name live in one rounded rectangle, so which name belongs to
 *  which point is a matter of containment and never of inference. Collisions are tested against
 *  this, not against the text — which also means a position far from the dot makes a plate so
 *  large that it loses to a near one on its own, with no rule needed to say so. */
function boxOf(marker: { x: number; y: number }, width: number, dx: number, dy: number, anchor: string): Box {
  const text = textBox(marker, width, dx, dy, anchor)
  return {
    x1: Math.min(text.x1 - 10, marker.x - 22), y1: Math.min(text.y1 - 3, marker.y - 22),
    x2: Math.max(text.x2 + 10, marker.x + 22), y2: Math.max(text.y2 + 1, marker.y + 22),
  }
}

function overlapOf(marker: { x: number; y: number }, width: number,
                   candidate: readonly [number, number, string], placed: readonly Box[],
                   mapWidth: number) {
  const box = boxOf(marker, width, candidate[0], candidate[1], candidate[2])
  // A label off the edge is unreadable, so it counts as worse than any overlap with a neighbour.
  const off = box.x1 < 8 || box.x2 > mapWidth - 8 ? 1e9 : 0
  return off + placed.reduce((sum, other) => sum + overlap(box, other), 0)
}

function mapFigure(card: MapCard, caption: string) {
  // **Labels are placed, not just offset.** Two places a kilometre apart put their names on top of
  // each other, which is worse than a name being on the wrong side of its dot. Each label takes the
  // first candidate position that does not overlap one already placed; the boxes are estimates from
  // the character count, which is coarse and enough, because the only question is whether two
  // rectangles touch.
  const GAP = 24, LINE = 32, EM = 13.5
  // **Where the baseline goes.** Firefox reports the font's layout box for SVG text and not its
  // ink — ascent 24.6, descent 6.7, identical for "HTVS" and "Hgjpå" — so neither that box nor cap
  // height settles it and the answer is a judgement. Judged on a phone at the size it is actually
  // read: a unit above the geometric centre. A magnified render said three units below, and was
  // wrong; the enlargement flatters the descenders that the eye discounts at real size.
  const BASE = 9
  // **The dots are obstacles too.** A label cleared of every other label can still be run through
  // by a neighbour's dot, which is what happened to "Bønå hurtigbåtkai": Stigfjellet's marker sat
  // in the middle of the word. The dot is r=13 with a 4-unit stroke, so 17 with a little air.
  const DOT = 19
  // Every dot but its own: a name is *meant* to sit beside the point it names, and counting that
  // as a collision pushed every label into the rows above and below — and so gave every one of
  // them a leader line it did not need.
  const dots: Box[] = card.markers.map((marker) => ({
    x1: marker.x - DOT, y1: marker.y - DOT, x2: marker.x + DOT, y2: marker.y + DOT,
  }))
  const placed: Box[] = []
  const pins = card.markers.map((marker, self) => {
    const obstacles = placed.concat(dots.filter((_, index) => index !== self))
    const width = marker.name.length * EM
    // Right of the dot first, then left, then the rows above and below — in that order because a
    // name reads best beside its dot and only moves away when it has to.
    const candidates = [
      [GAP, BASE, "start"], [-GAP, BASE, "end"],
      [GAP, -LINE + 6, "start"], [-GAP, -LINE + 6, "end"],
      [GAP, LINE + 14, "start"], [-GAP, LINE + 14, "end"],
      [0, -LINE - 10, "middle"], [0, LINE + 30, "middle"],
    ] as const
    const fits = (dx: number, dy: number, anchor: string) => {
      const box = boxOf(marker, width, dx, dy, anchor)
      if (box.x1 < 8 || box.x2 > card.width_px - 8) return undefined
      return obstacles.some((other) => overlap(box, other) > 0) ? undefined : box
    }
    // Where nothing is free, take the least bad rather than a fixed side: two names that must
    // share a corner should share as little of it as they can.
    let choice = candidates.find(([dx, dy, anchor]) => fits(dx, dy, anchor))
    if (!choice) {
      let least = Infinity
      for (const candidate of candidates) {
        const cost = overlapOf(marker, width, candidate, obstacles, card.width_px)
        if (cost < least) { least = cost; choice = candidate }
      }
    }
    const [dx, dy, anchor] = choice!
    const box = boxOf(marker, width, dx, dy, anchor)
    placed.push(box)

    const plate = `<rect class="map-plate" x="${box.x1.toFixed(1)}" y="${box.y1.toFixed(1)}"` +
      ` width="${(box.x2 - box.x1).toFixed(1)}" height="${(box.y2 - box.y1).toFixed(1)}" rx="22"></rect>`
    return `<a href="#${escape(marker.id)}">
          ${plate}
          <circle class="map-hit" cx="${marker.x.toFixed(1)}" cy="${marker.y.toFixed(1)}" r="72"></circle>
          <circle class="map-pin" cx="${marker.x.toFixed(1)}" cy="${marker.y.toFixed(1)}" r="13"></circle>
          <text class="map-label" x="${(marker.x + dx).toFixed(1)}" y="${(marker.y + dy).toFixed(1)}"
                text-anchor="${anchor}">${escape(marker.name)}</text>
        </a>`
  }).join("\n        ")
  const names = card.markers.map((marker) => marker.name).join(", ")
  // **No link across the map.** It used to carry a transparent rectangle over the whole image
  // linking to the full-size version, which swallowed every tap meant for a place — the pins were
  // on top but are a few pixels wide on a phone. The full map is a deliberate link in the caption.
  return `<figure class="chart map">
    <div class="map-frame">
      <img src="${escape(card.image)}" width="${card.width_px}" height="${card.height_px}"
           loading="lazy" decoding="async" alt="Locator map: ${escape(names)}">
      <svg class="map-pins" viewBox="0 0 ${card.width_px} ${card.height_px}" role="group"
           aria-label="Places on the map">
        ${pins}
      </svg>
    </div>
    <figcaption>${escape(caption)} <a href="${escape(card.full)}">Full size</a>
      <span class="credit">${escape(card.attribution)}</span></figcaption>
  </figure>`
}


function age(entry: { issued_at: string; problem?: string }, generatedAt: string) {
  if (entry.issued_at === generatedAt) return `<p class="stamp">Drawn ${escape(stamp(entry.issued_at))}</p>`
  // A source that failed leaves the previous charts in place. Saying so is the whole point: an old
  // forecast presented as current is worse than no forecast.
  return `<p class="stamp stale">
  <span class="badge">kept</span> Drawn ${escape(stamp(entry.issued_at))}; this run could not redraw it${
    entry.problem ? ` — ${escape(entry.problem)}` : ""}
</p>`
}

/** `level` because a region holding one group has no group heading, and a heading level skipped
 *  is a heading level a screen reader reports as a missing section. */
function place(entry: PlaceEntry, generatedAt: string, priority: Priority, level: 3 | 4) {
  const facts = [
    coordinates(entry.latitude, entry.longitude),
    entry.elevation_m === undefined ? undefined : `${entry.elevation_m} m`,
    entry.note,
  ].filter(Boolean) as string[]
  const models = entry.models.length === 0 ? "" : `<details class="singles">
  <summary>Single models<span class="hint"> — ${escape(entry.models.map((card) => card.title).join(", "))}</span></summary>
  ${entry.models.map((card) => figure(
    card, entry.version,
    `${entry.name}: ${card.title} forecast — temperature, precipitation and wind.`,
    card.title, priority,
  )).join("\n  ")}
</details>`
  return `<section class="place" id="${escape(entry.id)}">
  <h${level}><a href="#${escape(entry.id)}">${escape(entry.name)}</a></h${level}>
  <p class="facts">${facts.map((fact) => `<span>${escape(fact)}</span>`).join("<span class=\"dot\">·</span>")}</p>
  ${age(entry, generatedAt)}
  ${entry.map ? mapFigure(entry.map, "Where it is.") : ""}
  ${figure(
    entry.spread, entry.version,
    `${entry.name}: all models drawn together — where they agree and where they do not.`,
    "All models — where they agree, and where they do not", priority,
  )}
  ${models}
</section>`
}

/**
 * One group, and everything in it.
 *
 * **A region holding a single group drops the group's heading.** "Lofoten" under "Lofoten" says
 * nothing twice, and the chip that would jump to it would be the only chip in the row. The id stays
 * on the section either way, so a link written when the group had a heading still lands on it — and
 * so does the stamp, which is about this chart and not about the region.
 */
function group(entry: GroupEntry, members: readonly PlaceEntry[], generatedAt: string,
               priority: Priority, solo: boolean) {
  return `<section class="group" id="${escape(entry.id)}">
  <header class="group-head">
    ${solo ? "" : `<h3><a href="#${escape(entry.id)}">${escape(entry.name)}</a></h3>`}
    ${entry.note ? `<p class="lede">${escape(entry.note)}</p>` : ""}
    ${age(entry, generatedAt)}
  </header>
  ${entry.map ? mapFigure(entry.map, "Where these places are.") : ""}
  ${figure(
    entry.comparison, entry.version,
    `${entry.name}: ${members.map((member) => member.name).join(", ")} compared, one model.`,
    `${entry.place_ids.length} places, one model (${entry.comparison_model})`, priority,
  )}
  ${members.map((member) => place(member, generatedAt, priority, solo ? 3 : 4)).join("\n  ")}
</section>`
}

/**
 * A region: a heading, and the groups it holds.
 *
 * **The wrapper is the whole mechanism.** `data-region` on the section and one generated rule per
 * region is all the switching there is — the script sets a single attribute on `<html>` and CSS
 * does the rest, before the first paint and without touching a node. Which also means that with
 * scripting off no attribute is ever set, no rule ever matches, and the page is what it has always
 * been: every region in one column, to be scrolled.
 */
function region(entry: RegionEntry, inner: string, titled: boolean) {
  return `<section class="region" data-region="${escape(entry.id)}">
  ${titled ? `<header class="region-head">
    <h2>${escape(entry.name)}</h2>
    ${entry.note ? `<p class="lede">${escape(entry.note)}</p>` : ""}
  </header>` : ""}
  ${inner}
</section>`
}

/**
 * The dark palette, written once and applied in three places: to a dark system that has not been
 * overridden, and to an explicit dark choice. A colour defined only inside a media query would
 * never apply in the third state — an explicit choice against the system — which is the classic
 * way a page ends up with one theme's text on the other theme's ground.
 *
 * `--card` is exactly the chart's own surface in each theme, so a chart has no visible edge on it.
 */
const DARK_TOKENS = `
  color-scheme: dark;
  --ground: #0f1318;
  --card: #171c22;
  --ink: #eaeef2;
  --ink2: #aab4c0;
  --muted: #78828e;
  --line: #262d35;
  --accent: #3987e5;
  --flag: #d9a441;
  --flag-ground: #26200f;
  --pin-plate: #0f1318ee;
  --pin-edge: #eaeef244;
  --pin-ink: #eaeef2;
  --pin-dot: #eaeef2;
  --pin-dot-edge: #0f1318;`

const STYLE = `
:root {
  color-scheme: light;
  --ground: #f4f6f8;
  --card: #ffffff;
  --ink: #131820;
  --ink2: #4c5764;
  --muted: #7c8794;
  --line: #e4e9ee;
  --accent: #2a78d6;
  --flag: #8a5a10;
  --flag-ground: #fbf1e2;
  --pin-plate: #ffffffee;
  --pin-edge: #13182033;
  --pin-ink: #131820;
  --pin-dot: #131820;
  --pin-dot-edge: #ffffff;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {${DARK_TOKENS}
  }
}
:root[data-theme="dark"] {${DARK_TOKENS}
}
:root[data-theme="light"] { color-scheme: light; }

* { box-sizing: border-box; }
/* **The hidden attribute has to win.** The browser's own rule for it is a type selector and loses
   to any class rule that sets a display — .theme sets inline-flex, and so do three others here.
   Measured with scripting off: all four controls were hidden in the markup and on the screen
   anyway, including a theme switch that could not switch anything. */
[hidden] { display: none !important; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-text-size-adjust: 100%;
}
a { color: inherit; }
h1, h2, h3, h4 { text-wrap: balance; letter-spacing: -0.011em; }

.bar {
  position: sticky; top: 0; z-index: 10;
  background: var(--ground);
  border-bottom: 1px solid var(--line);
}
/* Two rows on purpose, not three by accident: identity and controls above, the sections below.
   The sections are the one thing wanted mid-scroll, so they get the full width and a tap target. */
.bar-inner {
  max-width: 1180px; margin: 0 auto; padding: 0.45rem 1.25rem;
  display: flex; align-items: center; gap: 0.5rem;
  /* What the region list hangs from. The list is not inside the scrolling chip row: there it would
     be cut off by the row's own mask within a character or two of opening. */
  position: relative;
}
/* **Not flex-wrap.** Wrapping happens before shrinking, so a long title would push the offline
   control onto a third line rather than shorten itself. A row that cannot wrap has to shrink. */
.bar-top { display: flex; align-items: center; gap: 0.5rem; flex-wrap: nowrap; min-width: 0; }
.brand {
  font-size: 1rem; font-weight: 640; margin: 0;
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.brand a { text-decoration: none; }
/* The scroll area is its own flex item, so a chip can never slide under the controls beside it —
   which is what happened when both lived in one scrolling row. */
.jump {
  display: flex; gap: 0; overflow-x: auto; scrollbar-width: none;
  flex: 1 1 auto; min-width: 0; order: -1;
  margin-left: -1.25rem; padding-left: 1.25rem;
  /* A chip cut off mid-word reads as a bug; the same cut under a fade reads as "there is more". */
  mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 1.6rem), transparent 100%);
}
.jump::-webkit-scrollbar { display: none; }
.jump a {
  font-size: 0.95rem; color: var(--ink2); text-decoration: none; white-space: nowrap;
  padding: 0.4rem 0.8rem; margin-right: 0.4rem;
  border: 1px solid var(--line); border-radius: 999px; background: var(--card);
}
/* The same chip, holding a mark instead of a word; the flex box keeps the svg off the baseline. */
.jump a.to-top { display: inline-flex; align-items: center; padding: 0.4rem 0.62rem; }
.jump a:hover, .jump a:focus-visible { color: var(--accent); }

/* **The region switch is a chip, and it scrolls away with them.** It is the first stop in the list
   of places this page can take you, not a control bolted to the edge of the bar — and putting it
   here rather than in a second row is what keeps the bar one row tall on a phone. It carries the
   name of the region being read, which is the only thing on screen that says which one that is. */
.jump .region-chip {
  font: inherit; font-size: 0.95rem; font-weight: 600;
  display: inline-flex; align-items: center; gap: 0.36rem;
  color: var(--ink); white-space: nowrap; cursor: pointer;
  padding: 0.4rem 0.72rem 0.4rem 0.6rem; margin-right: 0.4rem;
  border: 1px solid var(--line); border-radius: 999px; background: var(--card);
  /* **Never shrink.** Hiding the overflow is what caps a long name, and it also sets a flex item's
     automatic minimum size to zero — so in the scrolling row this collapsed to the icon and the
     name disappeared entirely. Measured at 390 px: 23 px wide, holding fourteen characters. */
  flex: 0 0 auto; max-width: 15rem; overflow: hidden;
}
.jump .region-chip .here { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.jump .region-chip[aria-expanded="true"] { background: var(--line); }
.region-list {
  position: absolute; top: calc(100% + 0.3rem); left: 1.25rem; z-index: 11;
  min-width: 13rem; max-width: calc(100% - 2.5rem);
  display: flex; flex-direction: column; gap: 0.1rem;
  padding: 0.3rem; background: var(--card);
  border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 12px 30px #00000024;
}
.region-list a {
  text-decoration: none; color: var(--ink2); font-size: 0.95rem;
  padding: 0.5rem 0.7rem; border-radius: 7px; white-space: nowrap;
}
.region-list a:hover, .region-list a:focus-visible { color: var(--ink); background: var(--ground); }
.region-list a[aria-current] { color: var(--ink); font-weight: 640; background: var(--ground); }

/* Three states, not two: "Auto" has to be reachable again once it has been left. */
.theme {
  display: inline-flex; border: 1px solid var(--line); border-radius: 6px;
  overflow: hidden; background: var(--card); flex: 0 0 auto;
}
.theme button {
  font: inherit; display: inline-flex; padding: 0.3rem 0.42rem; border: 0;
  background: transparent; color: var(--ink2); cursor: pointer;
}
.theme button + button { border-left: 1px solid var(--line); }
/* **The widest control is also the least used.** Below this the segments collapse to the active
   one, which cycles on tap: the sections need the width more than the theme needs to show its
   alternatives. Measured at 393 px: the strip goes from 176 px to 243 px. */
@media (max-width: 700px) {
  .theme button:not([aria-pressed="true"]) { display: none; }
  .theme button + button { border-left: 0; }
}
.theme button:hover { color: var(--ink); }
/* The offline control borrows the theme switch's shape so the bar keeps one vocabulary. It is an
   icon and, once it holds a copy, how old that copy is — no word, because the bar has no room for
   one and the mark changes shape between the two states rather than only shade. */
.offline, .reload {
  display: inline-flex; align-items: center; flex: 0 0 auto;
  border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: var(--card);
}
.reload button {
  font: inherit; display: inline-flex; padding: 0.3rem 0.42rem; border: 0;
  background: transparent; color: var(--ink2); cursor: pointer;
}
.reload button:hover { color: var(--ink); }
/* Held down while the page is on its way, so a tap that takes a moment does not look ignored. */
.reload button[aria-busy="true"] { color: var(--ink); background: var(--line); }
.offline button {
  font: inherit; font-size: 0.72rem; font-variant-numeric: tabular-nums;
  display: inline-flex; align-items: center; gap: 0.32rem;
  padding: 0.3rem 0.5rem; border: 0; background: transparent;
  color: var(--ink2); cursor: pointer;
}
/* Exactly the theme switch's active segment, and for the same reason: these are two controls of
   one kind sitting side by side, so "on" has to look like the same word in both. */
.offline button[aria-pressed="true"] { background: var(--line); color: var(--ink); font-weight: 600; }
/* An inline svg sits on the text baseline and drags descender space in with it, which made this
   button 5 px taller than the theme switch beside it and pushed the figure below the icon's
   middle. A flex box around it has no baseline to sit on. */
.bar svg { display: block; }
.offline .mark { display: inline-flex; }
.offline .age:empty { display: none; }
/* **The ring carries the age, not the number.** Tinting the figure costs legibility of the one
   thing being read. And the colour says how old this copy is rather than telling you to refresh:
   it turns while you are offline, which is exactly when you cannot. */
.offline button[data-age="aging"] .mark { color: #c98a00; }
.offline button[data-age="stale"] .mark { color: #d0663a; }
.offline-note { font-size: 0.68rem; color: var(--ink2); font-variant-numeric: tabular-nums; }
.theme button[aria-pressed="true"] { background: var(--line); color: var(--ink); font-weight: 600; }

main { max-width: 1180px; margin: 0 auto; padding: 2.25rem 1.25rem 5rem; }
.lede { color: var(--ink2); max-width: 62ch; margin: 0.35rem 0 0; }
.intro { margin: 0 0 2.5rem; }
.intro h1 { font-size: 1.6rem; margin: 0; }

.region-head { margin: 0 0 2rem; }
.region-head h2 { font-size: 1.35rem; margin: 0; }

.group { margin: 0 0 3.5rem; scroll-margin-top: 4.5rem; }
.group-head { margin: 0 0 1rem; padding-top: 0.5rem; }
.group-head h3 { font-size: 1.15rem; margin: 0; }
.group-head h3 a, .place h3 a, .place h4 a { text-decoration: none; }
.group-head h3 a:hover, .place h3 a:hover, .place h4 a:hover { text-decoration: underline; }

.place { margin: 2.5rem 0 0; scroll-margin-top: 4.5rem; }
.place h3, .place h4 { font-size: 1.02rem; margin: 0; }
.facts { margin: 0.2rem 0 0; color: var(--ink2); font-size: 0.85rem; }
.facts .dot { color: var(--muted); margin: 0 0.45rem; }
.facts span:first-child { font-variant-numeric: tabular-nums; }
.stamp { margin: 0.15rem 0 0.85rem; color: var(--muted); font-size: 0.78rem; }
.stamp.stale { color: var(--flag); }
.badge {
  display: inline-block; background: var(--flag-ground); color: var(--flag);
  border-radius: 4px; padding: 0.05rem 0.35rem; font-size: 0.72rem;
  text-transform: uppercase; letter-spacing: 0.04em; margin-right: 0.3rem;
}

.chart {
  margin: 0 0 1rem;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}
.chart-link { display: block; text-decoration: none; color: inherit; }
.chart img { display: block; width: 100%; height: auto; }
.chart figcaption {
  padding: 0.55rem 0.9rem;
  border-top: 1px solid var(--line);
  color: var(--ink2);
  font-size: 0.8rem;
}
/* The map keeps one set of colours in both themes; only its frame follows the page. */
.map-frame { position: relative; line-height: 0; }
.map-frame img { display: block; width: 100%; height: auto; }
.map-pins { position: absolute; inset: 0; width: 100%; height: 100%; }
.map-pins a { cursor: pointer; }
.map-pin { fill: var(--pin-dot); stroke: var(--pin-dot-edge); stroke-width: 4; pointer-events: none; }
/* Drawn before the dot and the name, so it never covers either. */
/* The map underneath is the same light topographic sheet in both themes, so these are their own
   tokens: the plate is what carries the theme, not the terrain. */
.map-plate { fill: var(--pin-plate); stroke: var(--pin-edge); stroke-width: 2; pointer-events: none; }
/* The dot is 13 units across a 1920 viewBox — about two pixels on a phone. This is the target. */
.map-hit { fill: transparent; }
.map-label {
  font: 600 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  /* The plate does the separating now, so the outline that used to hold the name off the terrain
     is gone: on a dark plate a white one would ring every letter. */
  fill: var(--pin-ink);
}
.map-pins a:hover .map-pin { fill: var(--accent); }
.map-pins a:hover .map-label { fill: var(--accent); }
.credit { color: var(--muted); }

.singles { margin: 0 0 1rem; }
.singles > summary {
  cursor: pointer; color: var(--ink2); font-size: 0.85rem;
  padding: 0.5rem 0.1rem; list-style-position: outside;
}
.singles > summary:hover { color: var(--ink); }
.singles .hint { color: var(--muted); }
.singles[open] > summary { margin-bottom: 0.6rem; }

footer {
  max-width: 1180px; margin: 0 auto; padding: 2rem 1.25rem 4rem;
  border-top: 1px solid var(--line);
  color: var(--muted); font-size: 0.78rem;
}
footer p { margin: 0 0 0.5rem; max-width: 72ch; }
footer a { color: var(--ink2); }

:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
`

/**
 * Applied before the first paint. Everything else the page needs runs at the end; these two cannot
 * wait, and for the same reason: the alternative to settling them here is the page arriving as one
 * thing and becoming another — a flash of the wrong theme, or every region drawn and then all but
 * one taken away again.
 *
 * **The region is resolved here because the browser scrolls to the fragment before any of the body
 * script runs.** A link to `#markan` would otherwise arrive with Markan still hidden, the scroll
 * would find nothing, and the page would open at the top of a region the link never named.
 *
 * `order` is the menu order and its first entry is the default. `holds` maps every group and place
 * id to the region containing it, which is what turns an ordinary anchor into a region as well.
 */
function headScript(order: readonly string[], holds: Readonly<Record<string, string>>) {
  return `
(function () {
  var root = document.documentElement;
  try {
    var choice = localStorage.getItem("theme");
    if (choice === "light" || choice === "dark") root.dataset.theme = choice;
  } catch (error) {
    /* A browser that refuses storage still gets the system's theme, which is the default anyway. */
  }
  var ORDER = ${JSON.stringify(order)};
  var HOLDS = ${JSON.stringify(holds)};
  if (ORDER.length === 0) return;
  var hash = decodeURIComponent(location.hash.slice(1));
  // "r/<id>" names a region and nothing else: it matches no element, so a browser without scripting
  // simply ignores it — and with scripting it never competes with an anchor for the one fragment.
  var pick = hash.slice(0, 2) === "r/" ? hash.slice(2) : HOLDS[hash];
  if (!pick) { try { pick = localStorage.getItem("region"); } catch (error) { /* the default, then */ } }
  root.dataset.region = ORDER.indexOf(pick) < 0 ? ORDER[0] : pick;
})();
`
}

/** The switch itself: the menu, and every other way a region can change. */
function regionScript(order: readonly string[], holds: Readonly<Record<string, string>>) {
  return `
(function () {
  var root = document.documentElement;
  var button = document.getElementById("region-button");
  var list = document.getElementById("region-list");
  var here = document.getElementById("region-here");
  if (!button || !list || !here) return;
  var ORDER = ${JSON.stringify(order)};
  var HOLDS = ${JSON.stringify(holds)};

  function open(on) {
    list.hidden = !on;
    button.setAttribute("aria-expanded", String(on));
  }

  function show(id) {
    root.dataset.region = id;
    try { localStorage.setItem("region", id); } catch (error) { /* it still holds for this page */ }
    list.querySelectorAll("a[data-region]").forEach(function (link) {
      var current = link.dataset.region === id;
      if (current) { link.setAttribute("aria-current", "true"); here.textContent = link.textContent; }
      else link.removeAttribute("aria-current");
    });
  }

  // Hidden until here, because without this script neither control can do anything and a menu that
  // does nothing is worse than no menu — the same rule the theme switch follows.
  button.hidden = false;
  show(root.dataset.region || ORDER[0]);

  button.addEventListener("click", function () { open(list.hidden); });
  list.addEventListener("click", function (event) {
    var link = event.target.closest("a[data-region]");
    if (!link) return;
    event.preventDefault();
    show(link.dataset.region);
    // replaceState rather than a navigation: the region is where you are, not somewhere you went,
    // and a back button that walked through every region looked at would be a nuisance.
    history.replaceState(null, "", "#r/" + link.dataset.region);
    open(false);
    window.scrollTo(0, 0);
  });
  document.addEventListener("click", function (event) {
    if (!list.hidden && !button.contains(event.target) && !list.contains(event.target)) open(false);
  });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape") open(false); });

  // A link into another region — a map pin, a chip, a bookmark — has to bring its region with it.
  window.addEventListener("hashchange", function () {
    var hash = decodeURIComponent(location.hash.slice(1));
    var region = hash.slice(0, 2) === "r/" ? hash.slice(2) : HOLDS[hash];
    if (!region || ORDER.indexOf(region) < 0 || region === root.dataset.region) return;
    show(region);
    // The browser has already tried to scroll, while the target was still hidden and had no place
    // on the page to scroll to. Now it has one.
    var target = hash.slice(0, 2) === "r/" ? null : document.getElementById(hash);
    if (target) target.scrollIntoView();
  });
})();
`
}

function bodyScript() {
  return `
(function () {
  var root = document.documentElement;
  var control = document.getElementById("theme");
  var system = window.matchMedia("(prefers-color-scheme: dark)");

  function stored() {
    try {
      var choice = localStorage.getItem("theme");
      return choice === "light" || choice === "dark" ? choice : "auto";
    } catch (error) { return "auto"; }
  }

  function apply(choice) {
    if (choice === "auto") delete root.dataset.theme; else root.dataset.theme = choice;
    var shown = choice === "auto" ? (system.matches ? "dark" : "light") : choice;

    // <picture> resolves by media query, so the switch is made by changing the query itself rather
    // than by touching src: "all" always matches and the dark source wins, "not all" never matches
    // and the img's own light src wins. Only the image on the screen is ever fetched.
    var media = choice === "auto" ? "(prefers-color-scheme: dark)" : (choice === "dark" ? "all" : "not all");
    document.querySelectorAll("picture > source").forEach(function (source) { source.media = media; });

    // The full-size link has to open the chart that is on the screen, not the other one.
    document.querySelectorAll("a.chart-link").forEach(function (link) { link.href = link.dataset[shown]; });

    if (control) {
      control.querySelectorAll("button").forEach(function (button) {
        button.setAttribute("aria-pressed", String(button.dataset.choice === choice));
      });
    }
  }

  if (control) {
    control.hidden = false;
    control.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-choice]");
      if (!button) return;
      // **Narrow, only the active segment is on screen**, so a tap on it has to mean "the next
      // one" or it would mean nothing. Wide, all three are there and a tap picks the one tapped.
      // One rule covers both: tapping the current choice advances, tapping another selects it.
      var order = ["auto", "light", "dark"];
      var choice = button.dataset.choice === stored()
        ? order[(order.indexOf(stored()) + 1) % order.length]
        : button.dataset.choice;
      try {
        if (choice === "auto") localStorage.removeItem("theme"); else localStorage.setItem("theme", choice);
      } catch (error) { /* the choice still holds for this page */ }
      apply(choice);
    });
  }

  // The system theme can change while the page is open, and in "auto" that has to be followed.
  system.addEventListener("change", function () { if (stored() === "auto") apply("auto"); });
  apply(stored());
})();
`
}

/**
 * Registration, the keep switch, and the age line.
 *
 * The worker is registered unconditionally: opening offline at all is the part that is broken
 * without it, and it costs nothing — the document and whatever images were actually looked at.
 * Keeping the whole almanac is the switch, because a run is 17 MB across both themes and there is
 * a new one every hour. What the switch then fetches is one theme, about 8.5 MB.
 */
function offlineScript(manifest: Manifest): string {
  return `
(function () {
  if (!("serviceWorker" in navigator)) return;
  var URLS = ${JSON.stringify(offlineUrls(manifest))};
  var GENERATED = ${JSON.stringify(manifest.generated_at)};
  var MARK_KEEP = ${JSON.stringify(ICONS.keep)};
  var MARK_KEPT = ${JSON.stringify(ICONS.kept)};
  var box = document.getElementById("offline");
  var button = document.getElementById("keep");
  var mark = document.getElementById("keep-mark");
  var ageEl = document.getElementById("keep-age");
  if (!box || !button || !mark || !ageEl) return;

  // **Only one theme is worth downloading.** A chart exists twice, light and dark, and half the
  // eighteen megabytes is the half that is not on the screen. The URLs differ in one suffix, so the
  // subset is a filter rather than a second list in the page — and the full list still goes with it,
  // because eviction is judged against everything the run references, not against what was fetched.
  //
  // The theme can still change under a kept copy — the switch, or a system that goes dark at
  // sunset — and offline nothing can be fetched then. That is the worker's problem and it falls
  // back to the sibling image: the same forecast in the other colours, which is a great deal better
  // than a broken chart. So this can narrow to one theme without a caveat.
  function themeNow() {
    var choice = "auto";
    try {
      var stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark") choice = stored;
    } catch (error) { /* no storage, so the system's */ }
    return choice !== "auto" ? choice
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }
  function wanted() {
    // The extension is open because a carried-over entry keeps whatever it was published as: the
    // charts are WebP now and a place the run could not redraw may still be named -light.png.
    // Doubled backslashes: this is inside a template literal, and a single one is eaten before the
    // regexp is ever parsed — which turns (\\?|$) into an invalid group and takes the whole script
    // down, service worker and all.
    var drop = themeNow() === "dark" ? /-light\\.(png|webp)(\\?|$)/ : /-dark\\.(png|webp)(\\?|$)/;
    // The maps carry a content hash and no theme suffix, so they survive this untouched — which is
    // right, they are one sheet of terrain in both themes.
    return URLS.filter(function (url) { return !drop.test(url); });
  }

  function post(message) {
    navigator.serviceWorker.ready.then(function (registration) {
      var worker = navigator.serviceWorker.controller || registration.active;
      if (worker) worker.postMessage(message);
    });
  }

  // How old the kept copy is. The site publishes hourly, so hours are the normal unit and a
  // couple of them are unremarkable; a day is worth a colour, and past one the forecast is behind
  // enough that it should not be planned on without saying so.
  //
  // **It also says when it will next be wrong**, because the timer that redraws it is aimed at that
  // moment rather than at a fixed interval. The boundaries are not the round hours they look like:
  // the figure is rounded, not truncated, so the text steps at 1.5 h, 2.5 h, … while the colour
  // steps at 6 h and 24 h. Working that out here keeps the two answers in one place — a timer that
  // guessed hourly would show the wrong number for up to half an hour.
  function age() {
    var ms = Date.now() - Date.parse(GENERATED);
    var hours = ms / 3600000;
    var text = hours < 1 ? "now" : hours < 48 ? Math.round(hours) + " h" : Math.round(hours / 24) + " d";
    var marks = [1, 6, 24, 48];                                 // "now" ends, the two colours, days begin
    // The rounding step, and only the one this band is in: adding both put a mark half an hour
    // early in every hour of the first two days, which woke the timer for a redraw that changed
    // nothing. Measured over five days at one-minute resolution, this is the boundary every time.
    if (hours >= 1 && hours < 48) marks.push(Math.floor(hours - 0.5) + 1.5);
    if (hours >= 48) marks.push((Math.floor(hours / 24 - 0.5) + 1.5) * 24);
    var next = Infinity;
    for (var i = 0; i < marks.length; i++) if (marks[i] > hours && marks[i] < next) next = marks[i];
    // A minute at least, so a clock skew or an unparseable stamp cannot turn this into a spin.
    var until = next === Infinity ? 86400000 : Math.max(60000, (next - hours) * 3600000);
    return { text: text, tone: hours < 6 ? "fresh" : hours < 24 ? "aging" : "stale", until: until };
  }

  function show(keeping) {
    button.setAttribute("aria-pressed", String(keeping));
    mark.innerHTML = keeping ? MARK_KEPT : MARK_KEEP;
    if (!keeping) {
      ageEl.textContent = "";
      button.removeAttribute("data-age");
      button.setAttribute("aria-label", "Keep this site offline");
      return;
    }
    var current = age();
    ageEl.textContent = current.text;
    button.setAttribute("data-age", current.tone);
    button.setAttribute("aria-label", "Kept offline, drawn " + current.text + " ago");
  }

  navigator.serviceWorker.register(${JSON.stringify(WORKER_KEY)}).then(function () {
    return navigator.serviceWorker.ready;
  }).then(function () {
    box.hidden = false;
    // Every load: the worker drops what this run no longer references, and refetches the run in
    // the background if the switch is on. The page does not wait for either.
    post({ type: "refresh", urls: URLS, keep: wanted() });
  }).catch(function () {
    /* No worker, no offline. The page itself is unaffected, so say nothing. */
  });

  button.addEventListener("click", function () {
    var on = button.getAttribute("aria-pressed") === "true";
    show(!on);
    if (!on) ageEl.textContent = "\u2026";
    post({ type: on ? "forget" : "keep", urls: URLS, keep: wanted() });
  });

  navigator.serviceWorker.addEventListener("message", function (event) {
    var data = event.data || {};
    if (data.type === "status") show(data.keeping);
    else if (data.type === "progress") {
      // A refresh only runs when a copy is being kept, so progress is also the answer to "is the
      // switch on" — and it arrives before any status would. Without this the button sits unlit
      // through the whole download and the figure beside it reads as decoration.
      button.setAttribute("aria-pressed", "true");
      mark.innerHTML = MARK_KEPT;
      ageEl.textContent = Math.round(data.done / data.total * 100) + "%";
    }
    else if (data.type === "kept") show(true);
    // A refresh that gave up leaves whatever was already held; the chip goes back to describing
    // that rather than sitting on a percentage that stopped moving.
    else if (data.type === "stalled") show(true);
  });

  // Redraw the age, and nothing else. **Aimed at the moment the text or the colour actually
  // changes** — age() works that out — rather than at a fixed interval: at most one wake-up an
  // hour against twelve for the five-minute interval this replaces, and it is correct at the
  // boundary instead of up to five minutes behind it. Only while the page is being looked at; a
  // tick behind a locked screen recalculates a figure nobody is reading.
  var ticker = null;
  function tick(on) {
    if (!on) { if (ticker) { clearTimeout(ticker); ticker = null; } return; }
    if (ticker) return;
    ticker = setTimeout(function () {
      ticker = null;
      if (button.getAttribute("aria-pressed") === "true") show(true);
      tick(true);
    }, age().until + 1000);
  }
  tick(true);

  // ------------------------------------------------------------- reloading ---
  // **Installed to a home screen there is no address bar and no reload button**, and iOS often
  // resumes a suspended page rather than loading it again — so an app opened on the fourth day of
  // a walk can show the first day's forecast. This button is the answer, and now the only one.
  //
  // **A second answer stood here and has been removed**: a reload on returning to the foreground,
  // guarded by staleness and a quiet window. It contradicted the design around it. A reload
  // fetches a document whose version tokens name a new run; the page then posts its refresh, and
  // with the keep switch on that pulls the entire run — so a rule nobody asked about could spend
  // 18 MB of mobile data, which is the exact thing the keep switch exists to prevent. Walking,
  // battery and data outrank freshness: an older forecast is usually fine, and the age on the chip
  // is what makes deciding that possible. The page in the foreground now touches the network never.
  var reload = document.getElementById("reload");
  if (reload) reload.addEventListener("click", function () {
    reload.setAttribute("aria-busy", "true");
    location.reload();
  });

  // Changing the theme changes which half should be held. Only worth acting on while a copy is
  // being kept and there is a connection to fetch the other half over — offline the sibling
  // fallback already covers it, and there is nothing to download anyway. The listener is on the
  // document so it runs after the theme switch's own handler has written the choice down.
  function themeChanged() {
    if (button.getAttribute("aria-pressed") !== "true") return;
    if (!navigator.onLine) return;
    ageEl.textContent = "\u2026";
    post({ type: "keep", urls: URLS, keep: wanted() });
  }
  document.addEventListener("click", function (event) {
    var target = event.target;
    if (target && target.closest && target.closest("#theme button")) themeChanged();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", themeChanged);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") { tick(false); return; }
    // Back in front: the figure is stale by however long we were away, so correct it once here
    // rather than having ticked through the absence to keep it right.
    if (button.getAttribute("aria-pressed") === "true") show(true);
    tick(true);
  });
})();
`
}

export function renderPage(manifest: Manifest): string {
  const priority: Priority = { first: true }
  const byId = new Map(manifest.places.map((entry) => [entry.id, entry]))
  const placed = new Set<string>()
  const sections: string[] = []
  // A chip like the others and inside the same scroll area: it leaves the screen with them, which
  // is what makes it read as the first stop in a list rather than a control bolted to the edge.
  const jumps: string[] = [
    `<a href="#top" class="to-top" aria-label="Back to the top">${ICONS.top}</a>`,
  ]

  const groupById = new Map(manifest.groups.map((entry) => [entry.id, entry]))
  /** The menu order, and its first entry is what a visitor without a fragment is shown. */
  const order: string[] = []
  /** Group and place id to the region holding it, so an ordinary anchor also names a region. */
  const holds: Record<string, string> = {}
  const menu: string[] = []

  // A manifest written before regions existed, or a site that defines none: one page, as before.
  const titled = manifest.regions.length > 0
  const regions: readonly RegionEntry[] = titled ? manifest.regions
    : [{ id: "everywhere", name: "Everywhere", group_ids: manifest.groups.map((entry) => entry.id) }]

  const add = (entry: RegionEntry, inner: string) => {
    // A region whose every group failed and had nothing to carry over is left out entirely, rather
    // than published as a menu entry leading to an empty page.
    if (inner === "") return
    order.push(entry.id)
    sections.push(region(entry, inner, titled))
    menu.push(`<a href="#r/${escape(entry.id)}" data-region="${escape(entry.id)}">${escape(entry.name)}</a>`)
  }

  for (const entry of regions) {
    const held = entry.group_ids
      .map((id) => groupById.get(id))
      .filter((found): found is GroupEntry => found !== undefined)
    const solo = held.length === 1
    add(entry, held.map((found) => {
      const members = found.place_ids
        .map((id) => byId.get(id))
        .filter((member): member is PlaceEntry => member !== undefined && !placed.has(member.id))
      for (const member of members) { placed.add(member.id); holds[member.id] = entry.id }
      holds[found.id] = entry.id
      // A region with one group would give it a chip saying what the region chip beside it says.
      if (!solo) jumps.push(`<a href="#${escape(found.id)}" data-region="${escape(entry.id)}">${escape(found.name)}</a>`)
      return group(found, members, manifest.generated_at, priority, solo)
    }).join("\n  "))
  }

  // A place in no group at all gets a region rather than a section at the foot of someone else's:
  // something that has not been filed should be easy to find, not tucked under whatever ran last.
  const loose = manifest.places.filter((entry) => !placed.has(entry.id))
  if (loose.length > 0) {
    for (const entry of loose) holds[entry.id] = "elsewhere"
    add({ id: "elsewhere", name: "Elsewhere", group_ids: [] },
      loose.map((entry) => place(entry, manifest.generated_at, priority, 3)).join("\n  "))
  }

  // **One rule per region, and the script only ever sets an attribute.** Nothing is moved, nothing
  // is rebuilt, and the state is applied before the first paint — which is also why the rules are
  // generated here rather than written by hand: they are the one part of the stylesheet that
  // depends on what is being published.
  const regionCss = order.length < 2 ? "" : "\n" + order.map((id) =>
    `:root[data-region="${id}"] .region:not([data-region="${id}"]),\n` +
    `:root[data-region="${id}"] .jump a[data-region]:not([data-region="${id}"]) { display: none; }`,
  ).join("\n")

  // The chip sits inside the scrolling row, first; the list hangs off the bar and not off the row.
  const regionChip = order.length < 2 ? "" :
    `<button type="button" class="region-chip" id="region-button" aria-expanded="false"` +
    ` aria-controls="region-list" hidden>${ICONS.menu}<span class="here" id="region-here"></span></button>`
  const regionList = order.length < 2 ? "" :
    `<nav class="region-list" id="region-list" aria-label="Regions" hidden>${menu.join("")}</nav>`

  // Named from what was drawn rather than from a sentence someone has to remember to edit. A place
  // that could not be redrawn keeps older cards, so this reads the run's own first full set.
  const cards = manifest.places.find((place) => place.models.length > 0)?.models ?? []
  const models = cards.map((card) => {
    const page = MODEL_PAGES[card.slot]
    return page
      ? `<a href="${escape(page)}" rel="noreferrer">${escape(card.title)}</a>`
      : escape(card.title)
  }).join(", ").replace(/, ([^,]*)$/, " and $1")

  // Hidden until the script takes it over: without scripting neither control can do anything, and
  // a switch that does nothing is worse than no switch.
  const theme = `<div class="theme" id="theme" role="group" aria-label="Colour theme" hidden>${
    [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]]
      .map(([choice, label]) =>
        `<button type="button" data-choice="${choice}" aria-pressed="false" aria-label="${label}" title="${label}">${
          ICONS[choice as keyof typeof ICONS]}</button>`)
      .join("")
  }</div>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escape(manifest.site.title)}</title>
<meta name="description" content="${escape(manifest.site.tagline ?? `Point forecasts for ${manifest.places.length} places.`)}">
<link rel="manifest" href="${WEBMANIFEST_KEY}">
<link rel="apple-touch-icon" href="${iconUrl(manifest, 180)}">
<link rel="icon" href="${iconUrl(manifest, 192)}" type="image/png" sizes="192x192">
<!-- The full title is cut off under a home-screen icon; this is what fits there. -->
<meta name="apple-mobile-web-app-title" content="Almanac">
<meta name="theme-color" content="#f4f6f8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1318" media="(prefers-color-scheme: dark)">
<style>${STYLE}${regionCss}</style>
<script>${headScript(order, holds)}</script>
</head>
<body>
<div class="bar">
  <div class="bar-inner">
    <div class="bar-top">
    ${theme}
    <div class="offline" id="offline" hidden>
      <button type="button" id="keep" aria-pressed="false" aria-label="Keep this site offline">
        <span class="mark" id="keep-mark">${ICONS.keep}</span><span class="age" id="keep-age"></span>
      </button>
    </div>
    <div class="reload">
      <button type="button" id="reload" aria-label="Reload for the newest forecast">${ICONS.reload}</button>
    </div>
    <nav class="jump" aria-label="Sections">${regionChip}${jumps.join("")}</nav>
    </div>
    ${regionList}
  </div>
</div>
<main id="top">
  <div class="intro">
    <h1>${escape(manifest.site.title)}</h1>
    ${manifest.site.tagline ? `<p class="lede">${escape(manifest.site.tagline)}</p>` : ""}
    <p class="lede">Each place is drawn once with all models together — ${models} — and once per
      model. Updated ${escape(stamp(manifest.generated_at))}.</p>
  </div>
  ${sections.join("\n  ")}
</main>
<footer>
  <p>Weather data: <a href="https://api.met.no/">MET Norway</a> (NLOD / CC BY 4.0) ·
     <a href="https://open-meteo.com/">Open-Meteo</a> (CC BY 4.0), serving
     <a href="https://www.dwd.de/">DWD</a> ICON and <a href="https://www.ecmwf.int/">ECMWF</a> IFS.
     Each chart names the model it was drawn from.</p>
  <p><strong>All times are UTC</strong>, including the day columns — the charts have no local
     timezone and none is implied.</p>
  <p>Drawn by the point weather tool of
     <a href="https://gitlab.com/ueisele/dotfiles">web-research</a> at
     ${escape(manifest.renderer_commit)}. Published from
     <a href="https://github.com/ueisele/weather-cards">weather-cards</a>.</p>
</footer>
<script>${bodyScript()}</script>
<script>${regionScript(order, holds)}</script>
<script>${offlineScript(manifest)}</script>
</body>
</html>
`
}
