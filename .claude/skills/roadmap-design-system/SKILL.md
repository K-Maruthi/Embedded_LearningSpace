---
name: roadmap-design-system
description: "Design system and hard UI constraints for THIS repo (embedded-learning-space, single-file HTML + Tauri). Use when adding or changing any UI, CSS, colour, typography, layout, breakpoint, view, rail entry, lab card, animation or theme in roadmap-source/. Encodes the real token set, the +212px breakpoint arithmetic, the checked build constraints, naming prefixes and the verification loop. Read this BEFORE editing 01_head.html / 02_body.html / 20_app.js or any 2x_ lab fragment."
license: MIT
metadata:
  scope: project-local
  source_of_truth: roadmap-source/01_head.html + validate_build.js + scripts/lint.js
---

# Roadmap design system (this app only)

Upstream skills answer "what does good UI look like". This one answers "what does *this* app
allow". When the two disagree, **this file wins** — it is the app as built, not a style guide.

The product is a **single HTML document, no framework, no runtime network, wrapped by Tauri**.
Fragments in `roadmap-source/` are concatenated by `build.js` into
`roadmap-source/embedded-c-roadmap.html` and copied to `src/index.html` (plus `src/fonts/`).
The built HTML is what ships, so its size *is* first paint.

## Tokens — the entire palette

All of it lives in one `:root` block at the top of `roadmap-source/01_head.html`. There is no
second token file, no theme object in JS, no build-time token step.

| Token | Dark (default) | Light | Role |
|---|---|---|---|
| `--bg` / `--bg-2` | `#101A24` / `#0C141C` | `#E9EDF1` / `#DFE5EB` | page, recessed page |
| `--surface` / `--surface-2` | `#17242F` / `#1D2D3A` | `#F7F9FB` / `#EEF2F6` | cards, raised |
| `--ink` / `--ink-2` / `--ink-3` | `#DCE6EE` / `#93A6B6` / `#6C7F8F` | `#17232F` / `#4C5C6C` / `#7B8B99` | primary / secondary / tertiary text |
| `--rule` / `--rule-soft` | `#2A3B4A` / `#213141` | `#C3CDD6` / `#D9E0E7` | borders |
| `--accent` | `#E8A93C` | `#9C5F06` | the one attention colour (amber) |
| `--link` | `#63C2D9` | `#125E75` | links |
| `--warn` / `--ok` | `#E0806E` / `#6FC49A` | `#9B3624` / `#265C43` | semantic state |
| `--violet` / `--steel` / `--olive` | `#A899E6` / `#7FB2D4` / `#AFC178` | `#5B48A8` / `#2C5A7A` / `#4F6127` | lab/series colours |

Plus `--shadow: 0 1px 0 var(--rule)` and `--rail: 212px`.

**Rules that follow from this, not from taste:**
- **Dark is the default.** Light is opt-in via `[data-theme="light"]` on `<html>`; the `:root:not([data-theme="light"])` block exists so removing the attribute also means dark. Any new colour needs a value in **all three** blocks (`:root`, the `:root:not(...)` dark override, `:root[data-theme="dark"]`) or it will not follow the theme.
- **Never hardcode a hex in a rule.** Use the token. A literal hex in new CSS is a review failure.
- **`--accent` is scarce on purpose.** It marks the one thing the learner should look at next (current stage, active tab, the bit being explained). If two things on a screen are amber, neither is.
- If a genuinely new semantic colour is needed, add a token to all three blocks *and* say in the PR/commit why an existing one could not carry it. There are 28 vars total; the set is intentionally small.

## Typography

Three self-hosted families (`roadmap-source/fonts/`, loaded via `fonts/fonts.css`):

- `--sans` **IBM Plex Sans** (variable 400–700) — body, UI, everything default.
- `--mono` **IBM Plex Mono** (400/500/600) — **every** register value, hex, address, bit field, waveform label, code. A number shown in the sans font is a bug.
- `--serif` **Source Serif 4** (variable 400–600) — long-form prose: topic bodies, journal/note text, ledes.

Weights are 400/500/600 only; the fonts are bundled at those three static weights plus two
variable files, so do not reach for 700/800. Do not add a font without accepting the KB cost
against the budget below and the copy step in `build.js`.

## Layout — the arithmetic people get wrong

- The left rail is **fixed 212px** (`--rail`) and is the app's only navigation.
- Below **820px** the rail degrades to a stacked header (`@media (max-width:820px)`).
- **The breakpoint rule the build enforces:** any other `max-width` must be
  `≥ 600 + 212 = 812px`. A rule written as `max-width:600px` fires at a 388px content column,
  because the rail has already taken 212px. Write the *intended content width plus 212*.
  `820` is the single allowed exception, because that rule is about the window, not the content.

So: "cards should stack below ~700px of content" is written `@media (max-width:912px)`.

## What the build will reject (check these before claiming a UI change works)

`npm run build:roadmap` runs `validate_build.js`, which fails on:

| Check | Fails when |
|---|---|
| Single-file budget | built HTML > **1500 KB** (`HTML_BUDGET_KB`) |
| Content breakpoints | a `@media max-width` below 812px (820 excepted) |
| View targets | `20_app.js` names a `view-*` that `02_body.html` lacks, or a rail `data-v` button has no view |
| Tag balance | unbalanced `div/section/nav/main/header/footer/details/summary/p/span/table/svg/aside/button` in the markup fragments |
| Version single-sourcing | a literal `rev X.Y` in a fragment (use `__APP_VERSION__`), or `__APP_VERSION__` surviving into the built file |
| Shell ids | any of `q, expandall, revline, progbar, progtxt, exportdata, importdata, importfile, themebtn, crumb-grp, crumb-view` missing |
| Graph hooks | any of `g-reheat, gclusters, gframe, gkinds, gmodes, gpanel, gtip` missing |
| Quiz keys | a graded question without a resolvable `data-ok` |
| JS syntax | any data/graph fragment failing `node --check`; the 20–25 span is checked **assembled**, since it is one IIFE |
| Shape | more than one `</html>` or more than one `<style>` in the built file |

`npm run lint` (`scripts/lint.js`, zero-dep) additionally fails on: a duplicate `var`/function
declaration inside either IIFE scope, **any `console.*`** (the app ships none deliberately),
`TODO`/`FIXME` left in the fragments (they belong in `todo.md`), and raw tab characters.

## Naming and where things go

- Views: `id="view-<name>"` in `02_body.html` + a rail button `data-v="<name>"`; the app
  reaches them through the rail only.
- Lab CSS prefixes — **reuse the owning lab's prefix, never invent a parallel one**:
  `pf-` peripherals (`23_lab_periph.js`), `pr-` protocols (`24_lab_protocols.js`),
  compile/linker lab uses `lks-`, `readasm`, `pgast`, `linklab`, `pgdissect`.
  Shared app-level: `rail`, `lab`, `topic`, `lens`, `notes`, `md`, `study`, `rgroup`, `stage`.
- Fragment map: `01_head.html` (the single `<style>` + the rail/shell markup), `02_body.html`
  (all view markup), `10`–`15`/`1b` (data), `16` interview, `17` faults, `18` clusters,
  `19` diffs, `20_app.js` (opens the app IIFE — shell, rail, roadmap, dashboard), `21`–`24`
  labs, `25_api.js` (closes the IIFE), `40_graph.js` (separate concept-graph IIFE).
- New CSS goes in `01_head.html` inside the existing `<style>`. There is no second stylesheet
  and no `<style>` per view.

## Code style for UI-adjacent JS

ES5-era on purpose: `var`, function declarations, string concatenation for markup, one big IIFE
assembled from fragments 20–25. Match it. No framework, no bundler, no `import`, no `fetch`.

## Verification loop for any UI change

```bash
npm test               # 19 spec files / 1143 checks - labs and models render headlessly
npm run lint           # duplicate var, console, TODO, tabs
npm run build:roadmap  # runs validate_build.js; currently reports 1215/1500 KB
```
Then look at it: open `roadmap-source/embedded-c-roadmap.html` in the Preview tab and check the
dark **and** light theme, at least one narrow width, keyboard focus, and reduced motion. The app
already honours `prefers-reduced-motion` in two places in `01_head.html` — the global block near
the top of the stylesheet and a lab-specific override for `.pf-bit.pulse`. **Extend one of those
blocks; do not add a third disconnected one.** A UI change is not done until it has been seen.

## Traps that have actually bitten this app

- A `<details>` left unclosed in the rail swallows the masthead — every other check still passes.
- A breakpoint written in content-width terms fails *silently* (the layout just "does nothing").
- A fragment that parses alone but not assembled (or vice versa) — 20–25 is one scope.
- New labs re-printing `undefined` into markup because a helper was called with a missing arg;
  the specs now assert no `undefined`/`NaN` reaches rendered output — keep that guarantee.
- Adding a font or a large data table without watching the 1500 KB budget; the built file is
  ~1215 KB, so headroom is finite. Re-run the build before assuming you fit.
