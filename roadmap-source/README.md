# Embedded C Roadmap — source notes

The frontend source for **Embedded Learning Space**: a browser-local, single-page learning
roadmap for Embedded C, from low-level C fundamentals through Cortex-M compilation, linking
and startup concepts out to how peripherals and serial protocols behave on a wire. It runs as
a standalone HTML file or inside the Tauri shell, and the teaching flow needs no network, no
CDN and no external toolchain.

## Teaching surfaces

- **Compilation Path** follows one small Cortex-M example through preprocessing, compilation,
  assembly, object generation, linking, ELF creation and final image generation. With a local
  Arm GNU toolchain installed it shows genuine per-stage output; otherwise a teaching model
  walks the same stages. Two modes share the eight stage tabs: **Teaching** (the fixed
  example) and **Lab bench** (your three editable sources, built for real; the same tabs then
  show your build's artifacts and observations). Each mode keeps its own report, so the bench
  cannot leak into the teaching stages.
- **Linker & Startup** uses one fixed Cortex-M4 memory model to teach `MEMORY`, `SECTIONS`,
  VMA/LMA, linker-generated symbols, the vector table, `.data` initialization, `.bss` zeroing,
  startup flow, and a sandbox where sections are dragged between FLASH and RAM. A ninth stage,
  *Reading a `.s`*, teaches the assembly the build hands you: `startup.s`'s 58 lines classified
  by kind, four real instruction lines decoded field by field, and Thumb-2, with the reset
  pseudocode guarded to describe the same program as the file.
- **Peripheral Playground** is a ten-stage live Cortex-M4 model: MMIO and the clock tree,
  GPIO (including a clickable PUPDR), a timer as a frequency divider (with a real CCR row and
  a live deadline readout), the interrupt chain (DIER × ISER/ICER × PRIMASK, with the
  set/clear pair taught truthfully), the write-only atomic BSRR, priority nesting, the
  read-modify-write race, a graded bring-up challenge, and a preset playground. The bring-up
  challenge is graded on observed behaviour over time as well as register state: a steady
  cadence, fresh entries, the rate that was configured, **and** whether the handler's cost fits
  the period (`PF_ISR_MS` is a model device, labelled as such — a real ISR is microseconds).
- **Protocol Lab** builds twelve stages across five families (Basics, UART, I²C, SPI, CAN) on
  one shared logic analyser, with a scrubber over each finished capture. Three renderers share
  one playhead contract: a per-bit box trace (UART framing, CAN arbitration), a multi-lane
  clocked wave (I²C, SPI) and a field-band trace for whole CAN frames. CAN carries real
  dominant/recessive arbitration by ID, a CRC-15 and bit stuffing; I²C includes the slave
  holding SCL low (clock stretching) with the master's bit counter visibly frozen.
- **Practice** holds interview prep, the memory-map lab, fault triage and the C tools.
- **Graph** shows prerequisite, failure-pattern, conceptually-related and mentioned-in-text
  relationships from the same canonical topic model.
- **Canonical topic schema** is normalized in `1b_data_topics.js`. Stage files own the
  teaching content; the registry attaches approach, visual, related-topic and interview
  metadata directly to each topic and validates IDs during startup.

The labs use curated teaching models and run locally in the browser. Nothing is fetched at
boot; the optional real-compiler panel only ever invokes a locally installed
`arm-none-eabi-gcc`.

## Build

From the repository root:

```sh
npm run build:roadmap
```

This concatenates the HTML/CSS/JS fragments into `embedded-c-roadmap.html`, validates the
result (syntax, rail ↔ view and journal-host contracts, quiz answer keys, version
single-sourcing, and a 1500 KB size budget), and copies it to `src/index.html` (plus the
vendored fonts to `src/fonts/`) for the Tauri shell. `bash build.sh` is a thin delegate to
the same script, so there is only one build path. Both generated outputs are gitignored;
`tauri dev` and `tauri build` run the build themselves via `beforeDevCommand` /
`beforeBuildCommand`.

## Styling

All CSS lives in the single `<style>` block in `01_head.html`. The rail is `position:fixed`
and the body carries `padding-left:var(--rail)` (212px), so a `@media (max-width:Npx)` rule
measures the *viewport*, not the content column. Content breakpoints are therefore written
as `intended content width + 212px` — a layout that wants to collapse at a 900px content
column reads `max-width:1112px`. `validate_build.js` rejects any width rule below 812px; the
rail's own 820px rule is the one exception, because it is about the window rather than the
content, and it is only reachable by opening the built HTML in a narrow browser window (the
app will not shrink past its 1050px minimum).

## Source layout

| File | Role |
|---|---|
| `01_head.html` | Document head, the single style block, and the shell: left rail, masthead |
| `02_body.html` | Body markup for all nine views: Roadmap, Dashboard, Mosaic, Graph, Compilation Path, Linker & Startup, Peripherals, Protocols and Practice |
| `10_data_a.js` – `15_data_f.js` | Roadmap topic data |
| `16_data_interview.js` | Interview/practice data |
| `17_data_faults.js` | Failure-mode teaching data |
| `18_data_clusters.js` | Same-failure-pattern clusters |
| `19_data_diffs.js` | Pre-authored compiler/behaviour comparisons (verified when written; nothing compiled live) |
| `1b_data_extensions.js` | Incremental advanced C topics appended to stage 3 |
| `1b_data_topics.js` | Canonical topic schema: stage identity, study approach, visual, conceptual links and interview coverage |
| `20_app.js` | App state, storage, backup, markdown, notes/journals, roadmap, dashboard, practice, boot. Opens the `<script>` tag and the app IIFE |
| `21_lab_compile.js` | Compilation Path lab (teaching model + real-toolchain panel and bench, two reports sharing one stage rail) |
| `22_lab_linker.js` | Linker & Startup lab: 9 stages, including the placement sandbox and the *Reading a `.s`* stage |
| `23_lab_periph.js` | Peripherals lab (staged Cortex-M4 curriculum; behaviour tape + deadline model) |
| `24_lab_protocols.js` | Protocols lab (signals, UART, I²C, SPI and CAN on the shared logic analyser) |
| `25_api.js` | Public API (`window.EmbeddedCRoadmap`); closes the IIFE and `</script>` |
| `40_graph.js` | Concept graph renderer (own `<script>`, reads the app through its public API) |
| `fonts/` | Vendored latin-subset woff2 files; copied to `src/fonts/` by the build |
| `build.js` | Reproducible concatenation build (`npm run build:roadmap`); also copies the result to `src/index.html` |
| `build.sh` | Thin delegate to `build.js` — one build path |
| `validate_build.js` | Fragment, syntax (per-fragment and assembled-IIFE), rail/view, journal-host, quiz-key, version, content-breakpoint, graph-hook and size-budget contract checks |
| `embedded-c-roadmap.html` | Generated standalone application (gitignored — rebuilt by `npm run build:roadmap`) |
| `vendor-fonts.js` | One-off that vendored the fonts; kept so the vendoring is reproducible |
| `../specs/` | Dependency-free behaviour specs (shell + lab models), run with `npm test` |
| `../scripts/` | `lint.js` (duplicate declarations, API keys, console/TODO/tabs) and `sync-version.js` |

## Runtime API

The application exposes `window.EmbeddedCRoadmap` once loaded. The public surface includes
roadmap data access, graph edges/clusters, completion hooks, interview/fault data and
import/export helpers; see `25_api.js` for the current API. `40_graph.js` reads everything
through that surface rather than reaching into the app's internals.

## Storage and backup

Progress, notes, bookmarks, interview answers, fault-practice state, lab stage journals and
the theme setting are stored locally in `localStorage`, namespaced under `ecroadmap.*`. The
labs keep their own keys (`ecroadmap.bench.v1`, `ecroadmap.lksandbox.v1`,
`ecroadmap.periph.v1`, `ecroadmap.protocols.v1` — whose saved shape has grown a `can` group
and an `i2c.stretch` since it was first written; `prLoad()` fills every missing field from
`prDefaults()` and validates `stage` against `PR_STAGE_META`, so an older backup upgrades in
place rather than needing a schema bump), and the roadmap keeps
`ecroadmap.walk.v1` (which reading-lab stages were opened) and
`ecroadmap.journals.v1` (stage writing, keyed `"lab:stage"`). There is no server.

The rail's **Export data** control writes one versioned JSON backup (schema 2) containing the
roadmap state *and* every lab key, so restoring cannot lose a verified stage goal. **Import
data** restores that global state on the current device/browser; a backup carrying lab state
reloads the app rather than refreshing in place, because an open lab's ticker would otherwise
write its stale in-memory copy straight over the import. Both directions accept a newer
schema's file only after the app-tag check, and the native commands re-check the `.json`
suffix and a 20 MB cap.

The graph is a view over the same canonical topic/edge model. Topic labels are shown on
hover/selection so the full 163-topic graph remains readable.

## Tests and guards

- `npm test` runs every zero-dependency spec in `../specs/` (19 files, 1143 checks); each one
  slices its subject out of a fragment with marker strings, stubs storage, and runs the slice
  in a `vm` context. `protocol_stages.spec.js` and `periph_regs.spec.js` go further and
  render every stage of their lab headlessly (`prBody()`/`pfStageBody()` are pure functions
  of their models), which is the only guard that catches a stage body throwing — a failure
  the app shows as a tab that simply stops responding. `periph_regs.spec.js` pins the
  register semantics the lab teaches: ISER write-1-to-set, ICER write-1-to-clear and
  write-only, BSRR's atomic halves, PUPDR whole-field cycles. `periph_deadline.spec.js`
  pins the time base (remainder-carrying, so the counter matches `pfUpdateRateHz` at every
  PSC/ARR), the handler cost and the four claims behind `pfTapeStillRunning()`;
  `read_asm.spec.js` re-derives the `startup.s` line classification and checks every decode;
  and `startup_pseudocode.spec.js` keeps the reset pseudocode and the file it hands the
  learner describing the same program.
- Negative controls are expected, not optional: a new guard should be shown to fail on a
  deliberately patched copy of its fragment (in a scratch directory inside the repo, never
  `/tmp`) before it is trusted.
- `npm run lint` catches duplicate declarations in both IIFE scopes, duplicate public-API
  keys, and console/TODO/tab characters.
- `node scripts/sync-version.js --check` fails if `package.json`, `tauri.conf.json` and
  `Cargo.toml` disagree.
- `.github/workflows/ci.yml` runs all of the above plus the roadmap build, `cargo test` and
  `cargo clippy --all-targets -- -D warnings`.
