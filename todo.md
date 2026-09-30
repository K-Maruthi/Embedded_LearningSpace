# Issues & improvements — project audit

Generated 2026-09-29 from a full pass over the frontend fragments, Rust backend,
build system, specs, and repo hygiene. **All 25 items are done** (the numbering skips 9);
this file is kept as the audit record. The follow-up defect pass is in `problems.md`, the
executed improvements in `improvements.md`, and what comes next in `features.md`.

## 🔴 High priority — security & correctness

- [x] **1. No CSP; `csp: null` in Tauri config.** One giant IIFE with 66+ `innerHTML`
  sinks; a single missed `esc()` turns stored XSS (e.g. via an imported backup file)
  into persistent code execution inside a WebView that exposes `pipeline_run` IPC.
  → Set `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  connect-src 'none'; font-src 'self'; img-src 'self' data:` in `tauri.conf.json`.
- [x] **2. "Offline" claim is false — Google Fonts CDN.** `01_head.html` loads
  IBM Plex / Source Serif from fonts.googleapis.com on every boot; README promises
  "No backend, no CDN". → Vendor .woff2 files locally with `@font-face`; keep the
  existing CSS custom properties and system fallbacks.
- [x] **3. Backup import round-trip has no render-safety spec.** Fixed, and the spec
  found a real hole while being written: `esc()` escapes `& < >` but not `"`, so a
  URL like `https://a"onerror="alert(1)` closed the href attribute and smuggled a
  live event handler onto the `<a>`. `inline()` now requires URLs to be scheme-clean
  AND quote-clean, and `specs/markdown_safety.spec.js` pins the whole contract
  (whitelist tags, escaped raw HTML, javascript:/data:/vbscript: rejection).
- [x] **4. Export via browser download; import via hidden `<input type=file>`.**
  Done via `tauri-plugin-dialog` registered in the Rust builder, with four
  purpose-built commands (`backup_save_dialog` / `backup_open_dialog` /
  `backup_write` / `backup_read`). The app hands the frontend only the path the
  dialog returned, so no broad fs-plugin scope is needed; `.json` suffix + 20 MB
  cap are sanity-checked on both read and write. Browser fallback (blob download
  + hidden input) is kept for the standalone HTML file.

## 🟠 Medium priority — bugs

- [x] **5. Linker & Startup sandbox overflow math.** Verified the usage bars clamp
  (no negative renders possible). Found and fixed a real teaching-model bug while
  there: `lksandCompute` charged the stack/heap reserves against **FLASH** usage
  too — reserves live in RAM only (`_estack` = top of RAM, heap grows from low
  RAM); a real linker never places them in flash. Fixed + diagnostic text updated.
- [x] **6. Theme is lost on export→import.** `snapshotAll()` writes
  `settings.theme` into the backup but `restoreBackup()` never restores it.
- [x] **7. `parse_version`** now accepts only two-or-three all-digit dot-joined
  parts (extracted `version_token`); a bare `20221205` date can no longer be
  taken as the version — unit-tested.
- [x] **8. Temp dir handling** uses `tempfile::Builder…tempdir()` — collision-safe
  unique names and RAII cleanup on every exit path (the old hand-rolled
  `remove_dir_all` only ran at the end of a successful walk).
- [x] **10. localStorage quota failures are silently swallowed** — `wr()` and
  `clabSaveDraft()` catch-and-ignore; a full store loses notes with no feedback.
  → One-time visible warning banner when a save fails.

## 🟡 Architecture & maintainability

- [x] **11. `20_app.js` split into per-lab fragments** — `20_app.js` (core: state,
  backup, markdown, notes, roadmap, dashboard, practice, boot; opens the IIFE),
  `21_lab_compile.js`, `22_lab_linker.js`, `23_lab_periph.js`, `24_lab_protocols.js`,
  `25_api.js` (public API; closes the IIFE + `</script>`). The split was done by
  line-cut of the single IIFE and proven **byte-identical** (concatenated md5
  `ade048a6…` matched the original) before any edits landed on top. `build.js`
  concatenates the span; `validate_build.js` now syntax-checks each standalone
  fragment AND the assembled IIFE. Specs reading lab sections were re-pointed at
  the assembled source.
- [x] **12. Generated `embedded-c-roadmap.html` untracked** — `git rm --cached` for
  it and `src/index.html`, both gitignored; `tauri.conf.json` gained
  `beforeDevCommand` / `beforeBuildCommand` running `npm run build:roadmap`, so a
  fresh clone always builds before serving. No more 13k-line diffs per edit.
- [x] **13. `esc()` deduplicated** — exposed on `window.EmbeddedCRoadmap` (with
  `hl`); `40_graph.js` consumes `R.esc` with a standalone fallback.
- [x] **14. `build.sh` doesn't refresh `src/index.html`** — it now delegates to
  `build.js`, so there is exactly one build path (this also became a font-sync trap
  once vendored fonts had to land in `src/fonts/`).
- [x] **15. No CI at all** — added `.github/workflows/ci.yml` (ubuntu, Rust toolchain
  cached): specs, lint, version check and the roadmap build, then `cargo test` and
  `cargo clippy --all-targets -- -D warnings` on push/PR.
- [x] **16. Rust test coverage thin** (4 unit tests, 1 ignored integration) — added
  unit tests for `interesting_root` and `parse_version` edge cases.

## 🟡 Testing

- [x] **17. No spec covers `md()`** — added `specs/markdown_safety.spec.js` covering
  the whitelist, escaped raw HTML, javascript:-link rejection, and list/heading/code
  round-trips.
- [x] **18. Lint** — `scripts/lint.js` (`npm run lint`), zero-dependency like the
  specs: duplicate `var`/`function` declarations across the app fragments (the
  real post-split hazard), console statements, TODO/FIXME, tab characters. Wired
  into CI. Currently clean.

## 🟢 Lower priority — UX, accessibility, polish

*(No item 9 — the numbering skipped it when this file was written.)*

- [x] **19. Accessibility:** the notes/journal "saved" flash has an
  `aria-live=polite` mirror (`.sr-only`) that announces the state change and the
  visual dot is `aria-hidden` (part 1); part 2 landed in the third pass — a
  skip-link past the rail, `aria-live` on the four dashboard counters, and
  roving-tabindex keyboard traversal of the concept-graph SVG (see
  `improvements.md` I4).
- [x] **20. `content-visibility: auto`** (with `contain-intrinsic-size`) on topic
  details, stage blocks and lab notes — the 163-topic list skips layout/paint for
  off-screen sections. Safe by construction: `.detail` was already `display:none`
  until opened.
- [x] **21. `setDataButtonState`** takes a token per call; the timeout only restores
  the label if no newer call happened — rapid actions can no longer flicker.
- [x] **22. Any lab-carrying import reloads the app even when nothing changed** —
  compare-then-reload. *This was already implemented in `restoreBackup()`
  (`labsChanged` is only set when a lab key's stored JSON actually differs); the
  box was stale, found while cross-checking (see `problems.md` P7).*
- [x] **23. Unexercised public API surface** (`hooks`/`onHook`, `interview.formats`)
  — kept as documented extensibility, and now *checked* rather than merely
  documented: the duplicate `view` key is gone and `scripts/lint.js` fails on a
  duplicated key in the `EmbeddedCRoadmap` literal (third pass; `improvements.md`
  I9).
- [x] **24. Repo metadata:** added the Apache-2.0 LICENSE (user's choice) and fixed
  `package.json` (`main`, `author`, `license`, `keywords`; removed the dead
  `bugs`/`homepage` fields).
- [x] **25. Repo hygiene:** `.freebuff/` added to `.gitignore`. (`shot_*.png` and
  `dev-run.log` were already ignored; `src-tauri/gen/` left tracked since Tauri's
  scaffolding convention keeps it, noted for review.)
- [x] **26. Version drift** — `scripts/sync-version.js`: package.json is the source
  of truth; wired as the npm `version` hook so `npm version x.y.z` syncs
  tauri.conf.json + Cargo.toml and stages them for the release commit;
  `--check` mode (used by CI) fails when they drift.

## Suggested order of attack (all done)

1. ~~CSP + vendored fonts (#1, #2)~~ — done. Note: `connect-src` must keep
   `ipc: http://ipc.localhost` or every `invoke()` fails on Windows WebView2
   (per https://v2.tauri.app/security/csp/).
2. ~~CI + lint baseline (#15, #18)~~ — done.
3. ~~Native save/open dialogs (#4)~~ — done; the Rust backend now owns the whole backup
   path, with the browser fallback kept for the standalone HTML.
4. ~~Split `20_app.js` (#11)~~ — done; the per-lab fragments are the structure everything
   since has been built on.

What is left is content, not audit work — see [features.md](features.md) for the ranked
catalogue and its suggested order.

## Fourth pass — peripherals register-semantics (2026-09-30)

Executed with the audit recorded in `problems.md` P15–P17 and `improvements.md` I13:

- **NVIC set/clear semantics made truthful** — `ISER0` is write-1-to-set (0s ignored,
  masked to the two modelled lines), `ICER0` is write-1-to-clear and write-only (reads 0);
  clicking a set ISER bit routes the clear through ICER, matching the C the panel always
  emitted. The old in-place toggle is guarded against by
  `specs/periph_regs.spec.js`.
- **PUPDR became a register card** (stages 3/4 + playground) with whole-field cycles that
  cannot synthesise the reserved `11`; the stage-3 pin cell follows pulls live.
- **BSRR joined the register bank** as a write-only card (reads 0) whose halves emit the
  atomic `GPIO_BSRR_BS/BR<n>` writes; **CCR** became a real timer row the duty slider
  writes; the "reserved in this model" hover fudge became "not wired in this model" with
  striped, not-allowed rendering.
- **New spec** `specs/periph_regs.spec.js` (99 checks): model behaviour, emitted C, all
  ten stages rendered headlessly with the no-`undefined` guard, goals callable, wiring
  guards. Its first run caught a shipped hole — the stage-3 pin cell printed a bare
  `undefined` (P17's bonus find). Ten negative controls, all biting.
- Full gap analysis (missing peripherals, depth gaps, the cost/time-base hole, build
  order) catalogued in `features.md` under *Peripherals depth*.

## Verification (latest run, 2026-09-30 · post-I13)

- `npm run build:roadmap` — validation OK (per-fragment + assembled-IIFE syntax),
  `src/index.html` + `src/fonts/` refreshed; 1158/1500 KB single-file budget; no CDN
  reference in the built HTML.
- `npm test` — all green, 15 spec files (backup_roundtrip, dash_progress, helpers,
  journal_nav, lab_compile, lab_quiz, linker_sandbox, markdown_safety, note_editor,
  periph_model, periph_regs, periph_tape, protocol_model, protocol_stages, rail_nav);
  774 checks.
- `npm run lint` — clean (duplicate declarations in both IIFE scopes, duplicate
  public-API keys, console/TODO/tabs).
- `node scripts/sync-version.js --check` — in sync at 1.0.0.
- `cargo test` — 10 passed, 1 ignored (needs a real ARM toolchain by design);
  `cargo clippy --all-targets -- -D warnings` — clean with `tauri-plugin-dialog`,
  `tempfile`, and the four backup commands.
- Generated HTML is now untracked (`git rm --cached`); regenerate with
  `npm run build:roadmap` — `tauri dev` / `tauri build` do it automatically.

## Third pass — audit, fixes and hardening

The audit in `problems.md` / `improvements.md` was then executed. Everything from
`problems.md` (P1–P10) is fixed and everything from `improvements.md` (I1–I11) is done,
including the last one — behaviour grading — which landed after this page was first written:

- **Graded questions carry their answer key in data** (`data-ok`), so a wrong green
  tick is impossible; guarded by `specs/lab_quiz.spec.js` and by `validate_build.js`.
- **The displayed revision is single-sourced** from `package.json` via `build.js`
  (`__APP_VERSION__`), with a build-time guard against hardcoding it again.
- **`hl()` rewritten**: one pass, three modes (C / ARM assembly / linker-map), so
  `#include` and `#imm` are no longer dimmed as comments and strings are `.s` like
  the stylesheet always expected; its output is now actually styled where it is
  used (`pre.hl`, `.ivcode`).
- **`window.alert` replaced** by a dismissible `notice()` banner, shared with the
  storage warning.
- **A uniform, seeded `shuffle()`** replaces two random-comparator sorts.
- **The linker sandbox clamps the stack/heap reserves** like section sizes — a
  negative reserve from a stored/imported file used to bend the RAM total.
- **Accessibility part 2** (skip-link, dashboard counter `aria-live`, graph
  keyboard traversal).
- **The graph's duplicate `esc()` declaration removed**, and `scripts/lint.js` now
  scans `40_graph.js` as its own scope plus the public API's keys.
- **Eight new spec files** (lab quiz keys, helper behaviour, linker sandbox, protocol
  model, protocol stage renders, peripheral model, behaviour tape, compilation-path
  report/parsers) — 14 total — including drift guards that tie the teaching prose and preset
  numbers to the models that compute them. The compilation-path spec found and fixed a
  pluralisation bug ("2 #define directories" for "directives"); see `problems.md` P11. The
  stage-render spec found two more shipped defects on its first run: the I²C address byte was
  drawn one bit off with R/W frozen at 0 (`problems.md` P12), and the protocol map printed a
  bare `undefined` (P14).
- **I11 · behaviour grading** — the Peripheral Playground's stage 9 now grades an event
  tape over time (`enter`/`exit`/`led`/`lost` entries on a steady cadence whose newest
  entry is fresh), not only a register snapshot. The goal card, the nine-row checklist
  and a new *Behaviour tape* card all read one gate (`pfTapeStillRunning`), and
  `specs/periph_tape.spec.js` grades the grader. Its side find: a verified goal's
  confirmation was written into a node the re-render then discarded, so success looked
  like a dead button — `problems.md` P10, fixed in both graded labs.
- **CI hardening** — `cargo clippy --all-targets -- -D warnings` replaces the softer
  `cargo check`; `validate_build.js` added an HTML size budget (1500 KB, measured ~1094 KB).

Still genuinely absent, as content rather than audit work: an **ADC/DMA/RTOS view**, a
**second I²C slave**, and **CAN error frames / bus-off recovery** — now catalogued with the
rest of the roadmap of ideas in [features.md](features.md). (CAN itself and I²C clock
stretching landed in the 2026-09-30 protocol pass; see `improvements.md` I12.)
