# almanac.cairn.zone — where the work stands

Written 2026-09-02, at the end of a long session. **Everything that was built is in commits with
the reasoning in their messages** — `git log` in `weather-cards`, `dotfiles` and `home` is the real
record, and this file does not repeat it. What is here is the part that no commit holds: what is
open, what was decided and why, and how to check any of it.

## Shipped

| Where | What |
| --- | --- |
| `dotfiles` `176ba96` | MET's `probability_of_thunder` read and drawn; panels equalised; canvas 1920 × 1510 |
| `weather-cards` `da6fe45` → `f09950c` | offline copy, bar rework, map labels, cairn icon, reload, model links |
| `weather-cards` `091e555` → `3a40aa0` | energy: no work off the critical path, and nothing automatic away from power |
| `weather-cards` `c01ae91`, `4e69f28`, `8f5bfb5` | one theme kept; charts as lossless WebP; the refresh chip lights up at once |
| `weather-cards` `70bce47` | a new run replaces the old one whole or not at all — the page is parked until its images are held |
| `home` `b10234c`, `f8bf7e4` | CLAUDE.md: taking a published prototype down, and the missing DNS token |

Beside this file: `OFFLINE-PATTERN.md` — the offline copy, the versioned URLs, the reload
behaviour, the energy work and the home-screen tags written up as a recipe for building the same
on another site. §6 is the energy section: five costs a cached site still has, four of them
created by the offline machinery itself.

## Open

- **The trails/atlas icon.** Task and assets in `icons/` beside this file — hand
  `icons/TASK-trails-atlas-icon.md` to an agent working in `~/repositories/trails`. The real bug it
  fixes is the missing `apple-touch-icon`, not the icon itself.
- **`remote-dev` has no DNS token.** Removing a published prototype's CNAME currently borrows the
  `mail` module's credential. TODO with the reasoning is in `home/remote-dev/files/CLAUDE.md`.
  Laptop work — this box cannot edit that sops file.
- **`gpg.ssh.allowedSignersFile`** is set now, but only for ssh signatures. The laptop's older
  PGP-signed commits still report `E` locally; their public key is not in the box's gnupg keyring.
- **The WebP decode figure is Firefox's.** 1.91× PNG, which decides nothing on its own but is the
  one number in the trade that hardware changes. A benchmark page for a phone is written and
  unpublished in `~/mockups/webp-decode` — publishing it is the recipe in CLAUDE.md, and it needs
  Uwe's say-so because it makes a DNS record.
- **Never verified on WebKit.** Every browser check in this session was Playwright Firefox on Linux.
  The offline copy, the home-screen install, the reload-on-return and Safari's seven-day storage
  eviction are all assumed to behave as documented on iOS, not measured there.

## Decisions worth not relitigating

- **One theme is cached offline**, the one on screen: the charts are 4.35 MB against 8.7 for both.
  A whole kept copy is **9.18 MB measured against the live site**, because the three maps are
  4.79 MB of it — they have no theme and no version token, so they are fetched once and never
  again, and every run after the first costs 4.35 MB. The preview 404s them, so a figure taken
  locally leaves them out; two claims in this session did.
  Safe because the worker falls back to the sibling image when the theme changes under a kept
  copy, and because eviction is still judged against the whole run, so switching theme twice
  leaves both halves held rather than thrashing.
- **The offline stock refreshes on every reload while the switch is on.** Not a timer, and not
  automatic without the switch — a run is published hourly and that is 17.7 MB each time.
- **Nothing reloads by itself.** The reload-on-return was removed (`3a40aa0`): with the keep
  switch on it could pull 18 MB unasked, which the switch exists to prevent. Away from power an
  older forecast beats a flat phone. The age chip plus the manual button is the whole mechanism,
  and the page in the foreground now makes zero network requests — measured.
- **The age timer sleeps to its own boundary**, not on an interval: `age()` returns how long its
  answer stays true. One wake-up an hour rather than twelve, and exact. Swept over five days at
  one-minute resolution — `harness/agebounds.mjs`.
- **The thunder floor is 10 %**, from 3583 hours at 64 Nordic points: median 0.7 %, three quarters
  under 1.6 %. Those figures are one forecast run over a quiet September and describe the resting
  state only — they say nothing about a convective July.
- **CAPE cannot substitute for it.** At Dovre where MET said 27 % then 54 %, MET's own model showed
  0 and 40 J/kg, ICON 40 and 80, ECMWF 10 and 10.
- **The map label plate contains the dot**, so association is containment. The placement is greedy
  with a least-overlap fallback and offers no guarantee; `MAX_GROUP_PLACES = 4` is what keeps it
  working in practice.

## Two traps that cost time in this session

**`bun run page`, not `bun run render`, for anything that is not a redraw.** A re-render mints 86
new `?v=` tokens and every reader with the offline copy fetches 17.7 MB again. The deploy gives no
sign — it uploads the same 93 objects either way. Now in the weather-cards README.

**`mise exec --` before any `just` recipe** in `home/mail`, `home/trails-map`, `home/weather-cards`.
A session inherits claude-rc's environment, resolved in `~/repositories` where there is no
`mise.toml`, so `sops` and `tofu` are installed and invisible. `just deploy` swallows sops's stderr
and reports *"no outputs in state — run 'just apply' first"*, which sends you to look at OpenTofu.
Now in `home/remote-dev/files/CLAUDE.md`.

## How to check anything

Playwright with the Firefox already in `~/.cache/ms-playwright`. Install once per scratch dir:

```bash
cd ~/mockups/almanac/harness && bun add -d playwright
systemd-run --user --unit=wc-preview \
  --working-directory=/home/eiseleu/repositories/weather-cards \
  /usr/bin/mise exec -- bun run preview      # serves out/ on 8787
node t2.mjs          # offline: keep, go offline, reload, is a chart drawn
node t3.mjs          # eviction: plant stale entries, reload, are they gone
node map.mjs         # map: label overlap, dots through labels, tap targets
node final.mjs       # bar height, the offline chip through its states
node nav.mjs         # section strip width against control layouts
```

The maps are carried over from the bucket and are not in a local `out/`, so they 404 in the
preview and the precache reports six failures. Fetch them if a screenshot needs them:

```bash
curl -s -A weather-cards-preview/1.0 https://almanac.cairn.zone/<key> -o out/<key>
```

**Screenshots are what the context is spent on.** Prefer a measurement — `getBoundingClientRect`,
a collision count, a byte comparison — and take a picture only when the question is genuinely
about how something looks. Two judgements in this session were made from magnified renders and one
of them was wrong: at real size the eye discounts descenders that enlargement flatters.

---

## Since this was written

Added 2026-09-11, when this file moved out of `~/mockups/almanac/` and into the repository it is
about. The body above is left as it was written on 2026-09-02; this is what has since changed about
its *open* items, and nothing else.

- **The trails/atlas icon — done.** The `apple-touch-icon` is in the built page, and Uwe confirmed
  on the device that the iOS home screen shows the cairn rather than the screenshot.
- **Never verified on WebKit — two of the three settled.** The home-screen icon and the screen wake
  lock were both confirmed on the device on 2026-09-11; the lock is granted and held for the length
  of a download. Whether `visibilitychange` fires for a standalone home-screen app is still
  unmeasured — and in `trails` it was deliberately made not to matter rather than measured, because
  an answer would have held only for one device and one iOS version.
- **`remote-dev` has no DNS token** and **the WebP figure is Firefox's** are unchanged.

Two things this file points at are *not* beside it, because moving it moved it away from them.
Both are still on `forge` in `~/mockups/almanac/`, which is version controlled by nothing:

- `harness/` — the 25 measurement scripts the figures above came out of, `agebounds.mjs` among
  them. A few kilobytes of `.mjs` under 19 MB of `node_modules`.
- `icons/` — `draw.ts`, which the cairn pair was drawn from, and the rendered PNGs for both sites.
  `TASK-trails-atlas-icon.md` beside them is done and can go.

Worth bringing in the day anybody needs to re-take a figure or redraw the pair; named here so that
the loss is a decision rather than a surprise.
