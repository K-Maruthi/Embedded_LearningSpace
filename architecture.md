# architecture.md — how the pieces fit

**Written:** 2026-09-30 · **Version audited:** 1.0.0 · **Branch:** `main`

This is the *how-it-is-wired* document. `README.md` says what the app is;
`roadmap-source/README.md` lists the fragments; this one explains **what depends
on what**, so a change in one place tells you every other place that has to move
with it.

Read it in this order:

1. [The one-sentence shape](#1-the-one-sentence-shape)
2. [The build: fragments → one HTML file](#2-the-build-fragments--one-html-file)
3. [The runtime: two IIFEs and one public API](#3-the-runtime-two-iifes-and-one-public-api)
4. [The Rust side: what it owns and why](#4-the-rust-side-what-it-owns-and-why)
5. [Data flow: storage, backup, journals](#5-data-flow-storage-backup-journals)
6. [The graph is a *client*, not part of the app](#6-the-graph-is-a-client-not-part-of-the-app)
7. [The nine views and who renders them](#7-the-nine-views-and-who-renders-them)
8. [The four labs share one contract](#8-the-four-labs-share-one-contract)
9. [The guards: what protects what](#9-the-guards-what-protects-what)
10. [Change recipes: "I want to add X"](#10-change-recipes-i-want-to-add-x)
11. [The seams that would break first](#11-the-seams-that-would-break-first)

---

## 1. The one-sentence shape

A **Tauri 2 shell** serves a **single generated HTML document** whose JavaScript is
**one app IIFE assembled from six fragments plus a second, independent IIFE for the
graph**, and whose entire persistence is **`localStorage` under `ecroadmap.*`**, with the
Rust side existing only to open native file dialogs, detect an ARM toolchain, and
optionally run a real `arm-none-eabi-gcc` build.

```
                     ┌──────────────────────────────────────────┐
                     │  roadmap-source/  (the real source)      │
                     │                                          │
   data fragments ───┤ 10…15_data_*.js  1b_data_*.js            │
   practice data ────┤ 16_interview  17_faults  18_clusters    │
                     │ 19_diffs                               │
                     │                                          │
   app IIFE ────────┤ 20_app.js ─ 21_compile ─ 22_linker ─    │
   (one scope)      │            ─ 23_periph  ─ 24_protocols  │
                     │            ─ 25_api.js                   │
                     │                                          │
   graph IIFE ──────┤ 40_graph.js   (own <script>, own scope)  │
                     │                                          │
   shell markup ────┤ 01_head.html (rail + all CSS)             │
                     │ 02_body.html (all nine views)            │
                     └──────────────────┬───────────────────────┘
                                        │ build.js
                                        │  · concat in fixed order
                                        │  · substitute __APP_VERSION__
                                        ▼
                     roadmap-source/embedded-c-roadmap.html  (gitignored)
                                        │ copy
                                        ▼
                     src/index.html + src/fonts/*.woff2        (gitignored)
                                        │ served by
                                        ▼
        ┌───────────────────────────────┴───────────────────────────────┐
        │  Tauri window (WebView2)                                      │
        │  CSP: default-src 'self'; connect-src 'self' ipc: http://…    │
        └───┬───────────────────────────────┬───────────────────────────┘
            │ invoke()                      │ localStorage
            ▼                               ▼
  ┌──────────────────────┐          ecroadmap.*  (12 keys)
  │ src-tauri/ (Rust)    │
  │  lib.rs      7 cmds  │
  │  toolchain.rs detect │
  │  pipeline.rs compile │
  │  examples/ 3 files   │
  └──────────────────────┘
```

### The numbers, so a glance is enough to size a change

| | |
|-|-|
| 7 roadmap stages · **163 topics** · 5 failure clusters | the data model, all in `10…15_data_*.js` + `1b_data_*.js` |
| 9 views · 4 practice tracks · 12 rail buttons | `02_body.html` + `01_head.html` |
| 4 labs, **8 + 9 + 10 + 12 = 39 stages**, 21 of them graded | `21`–`24` |
| 12 `localStorage` keys, 1 versioned JSON envelope (`DATA_SCHEMA = 2`) | `20_app.js` |
| 19 spec files, **1143 checks**, 0 dependencies | `specs/` |
| 7 Tauri commands, 7 pipeline stages, 3 example sources | `src-tauri/` |
| built HTML ≈ 1.21 MB against a 1500 KB budget | `validate_build.js` |

---

## 2. The build: fragments → one HTML file

There is **exactly one build path**: `node roadmap-source/build.js`
(`npm run build:roadmap`; `build.sh` is a one-line delegate, and
`tauri.conf.json` runs it as both `beforeDevCommand` and `beforeBuildCommand`).

### Order matters, and it is load-bearing

`build.js` concatenates in this exact order:

| # | Fragment | Kind | Why it sits here |
|---|----------|------|------------------|
| 1 | `01_head.html` | markup + **the only `<style>` block** | must be first: everything is styled by it |
| 2 | `02_body.html` | markup for all nine views | the DOM the app binds to |
| 3–8 | `10_data_a.js` … `15_data_f.js` | data, self-contained `<script>` | `STAGES` array is built by `push()` across all six |
| 9 | `16_data_interview.js` | data | `INTERVIEW`, `TRACKS`, `LEVELS`, `FORMATS` |
| 10 | `17_data_faults.js` | data | `FAULTS` |
| 11 | `18_data_clusters.js` | data | `CLUSTERS` (shared failure patterns) |
| 12 | `19_data_diffs.js` | data | compiler/behaviour comparisons |
| 13 | `1b_data_extensions.js` | data | extra stage-3 topics, appended |
| 14 | `1b_data_topics.js` | data | canonical topic schema + per-topic metadata; **validates IDs at startup** |
| 15 | `20_app.js` | **opens `<script>` and the app IIFE** | owns state, storage, markdown, notes, roadmap, dashboard, practice, boot |
| 16 | `21_lab_compile.js` | app IIFE (no wrapper) | four labs live in the *same* scope as the core |
| 17 | `22_lab_linker.js` | app IIFE | |
| 18 | `23_lab_periph.js` | app IIFE | |
| 19 | `24_lab_protocols.js` | app IIFE | |
| 20 | `25_api.js` | **closes the IIFE and `</script>`** | publishes `window.EmbeddedCRoadmap` last |
| 21 | `40_graph.js` | its own `<script>` + IIFE | reads the app *through the API only* |

**The two facts that break if you reorder anything:**

- **The app IIFE spans 20→25.** `20_app.js` starts `(function () {`, `25_api.js`
  ends `}());`. No single fragment in that span parses alone. This is why
  `validate_build.js` syntax-checks data fragments and the graph *individually*
  but checks the app *assembled*.
- **`40_graph.js` must come last.** It reads `window.EmbeddedCRoadmap` at load
  time, so the API has to exist before the graph's IIFE runs.

### The version substitution

`build.js` reads `package.json` → `version`, then
`html.replace(/__APP_VERSION__/g, pkg.version)`. The token appears once, in
`20_app.js` `progress()`:

```js
document.getElementById("revline").textContent = "rev __APP_VERSION__ · " + d + " / " + n + " topics";
```

`validate_build.js` fails the build if the token is **missing** from the fragments,
if a literal `rev <n>.<n>` reappears, or if the built HTML still contains the token.
`scripts/sync-version.js` separately keeps `package.json` → `tauri.conf.json` →
`Cargo.toml` in step, with `--check` wired into CI.

### What else the build does

1. `build.js` writes `roadmap-source/embedded-c-roadmap.html`.
2. `build.js` immediately runs `validate_build.js` (same process tree) and **stops
   the chain on a non-zero exit** — a failed contract means `src/index.html` is
   *not* refreshed, so you cannot accidentally preview a broken build.
3. `build.js` copies the HTML to `src/index.html` and the vendored `fonts/*.woff2`
   to `src/fonts/`. Both generated paths are in `.gitignore`.

The font copy is not optional: the built HTML references `fonts/…` relatively and
`frontendDist` is `../src`, so a missing `src/fonts/` silently drops the app back
to system fonts.

---

## 3. The runtime: two IIFEs and one public API

```
window
├── (app IIFE: 20+21+22+23+24+25)        ← one scope, private by default
│     ├── storage · markdown · notes · views · dashboard · mosaic · practice · boot
│     ├── clab (compile)  lk (linker)  periph  proto (protocols)   ← labs
│     └── window.EmbeddedCRoadmap = { … }   ← the ONLY global it creates
│
└── (graph IIFE: 40_graph.js)             ← a separate scope
      └── reads EmbeddedCRoadmap.{topics, edges, clusters, view, esc, onHook}
```

### Why the labs are *inside* the app IIFE

`21`–`24` are not modules; they are a continuation of the same scope. That is a
deliberate trade and it is the project's main structural fragility:

- **Gained:** a lab can call `rd()`, `wr()`, `esc()`, `md()`, `notice()`,
  `markdownEditor()`, `goStage()` with no import, no namespace, no bundler.
- **Paid:** nothing stops a lab from shadowing a core name, and nothing stops a
  core function from being renamed under a lab's feet. `scripts/lint.js` exists
  precisely because this is not safe on its own.

`scripts/lint.js` enforces the two rules this design needs:

1. **No duplicate `var`/`function` declaration across `20`–`25`** — checked as one
   scope, so a re-declaration in a different fragment still fails.
2. **No duplicate declaration inside `40_graph.js`** — checked as its own scope,
   so a name shared with the app is fine but a name twice in the graph is not.
   (This rule found a dead second `esc()`.)

It also scans the `window.EmbeddedCRoadmap` literal for duplicate top-level keys
(four-space indent = a top-level key, deeper indent = a nested object) — that
found a duplicate `view` key.

### The API is the only supported seam

`25_api.js` is the entire cross-boundary surface:

| Group | Keys |
|-------|------|
| data | `data` (lenses, memory map, stages), `topics` |
| graph | `edges()`, `clusters()` |
| state | `isDone()`, `exportProgress()`, `importProgress()`, `bookmarks()`, `stats()` |
| notes | `getNote()`, `setNote()`, `notesMarkdown()` |
| backup | `exportAll()`, `importAll()` |
| review | `cards()` |
| practice | `interview.{tracks,levels,formats,questions,coverage,answers}`, `faults.{scenarios,solved}` |
| render helpers | `esc`, `hl` |
| navigation | `view()`, `practice()`, `focus()`, `goTopic()` |
| events | `onHook()`, `onDoneChange()` |

Two rules keep this honest:

- **The graph does not reach inside the app.** `40_graph.js` reads `topics`,
  `edges()`, `clusters()`, `esc`, `view`, `onHook` and nothing else. It borrows
  `esc` through `R.esc` with a local fallback, so it renders identically whether
  or not the app is present.
- **Navigation has exactly one implementation.** `goTopic()` and `goStage()` in
  the core are the only ways to move; the graph's deep links, the dashboard's
  "your writing" rows and the cross-family protocol jump all call them. The
  Protocol Lab's cross-family case calls `prGoStage()` because the stage ids are
  not a 1..n range (see below).

### The two hooks

`fireHook` has exactly two call sites, both for the graph:

| hook | fired by | consumed by |
|------|----------|-------------|
| `view:graph` | `setView("graph")` | graph re-lays-out when the view becomes visible |
| `graph:cluster` | a graph cluster chip | (self-directed; the graph is both sides) |

`onDoneChange(fn)` is the other extension point — a listener per topic, with each
listener wrapped in its own `try/catch` so one bad plugin cannot break the app.
**Nothing in the app currently registers a listener**, which is why
`features.md` E4 calls for an API contract file rather than treating the surface
as load-bearing.

---

## 4. The Rust side: what it owns and why

The Rust side is deliberately small. It exists for four things the WebView cannot
do, and nothing else.

### The four command groups

| Command | Module | Why it must be Rust |
|---------|--------|---------------------|
| `toolchain_status` | `toolchain.rs` | spawns a process, walks `C:\Program Files*` |
| `pipeline_sources` | `pipeline.rs` | returns the three example files, embedded with `include_str!` |
| `pipeline_run` | `pipeline.rs` | runs 7 tool invocations in a temp dir |
| `backup_save_dialog` / `backup_open_dialog` / `backup_write` / `backup_read` | `lib.rs` | native file dialog + read/write |

**The design decision worth knowing:** there is **no fs plugin**. The app asks
`tauri-plugin-dialog` for a *path*, then reads/writes it itself in a purpose-built
command. The capability surface is therefore "write a file the user just picked",
not "touch the filesystem". `src-tauri/capabilities/default.json` is the whole
allowlist.

### `toolchain.rs` — detection order

```
ECROADMAP_ARM_GCC env override   →  PATH probe  →  known install roots  →  missing
```

The install-root scan reads only `C:\Program Files (x86)`, `C:\Program Files` and
`C:\`, filters directory names through `interesting_root()`, and looks for
`bin/arm-none-eabi-gcc.exe` at one and two levels down. `parse_version()` strips
parenthesised banner text first, then accepts the first token shaped
`x.y` or `x.y.z` with all-digit parts — so a bare `20221205` build date can never
be mistaken for the version.

**The frontend never sees a failure it cannot explain.** `pipeline_run` returns
`Err("toolchain-not-found")`, and `clabMissingHtml()` renders a *teaching* panel
(winget / xPack / env var) rather than an error string. No toolchain is a
supported state, not a broken one.

### `pipeline.rs` — the compile

Fixed flags, fixed filenames, three editable slots:

```rust
const COMMON_FLAGS: [&str; 6] = ["-mcpu=cortex-m4","-mthumb","-O1","-ffreestanding","-Wall","-Wextra"];
const SOURCE_LIMIT:  usize = 200_000;   // per slot
const ARTIFACT_LIMIT: usize = 20_000;    // per captured output
```

| Stage id | What runs |
|----------|-----------|
| `source` | no tool — echoes the three files as the tools will see them |
| `preprocess` | `gcc -E main.c -o main.i` |
| `compile` | `gcc -S main.i -o main.s` |
| `assemble` | `gcc -c` **twice** (`main.s`, `startup.s`) |
| `object` | `objdump -h/-t` on both objects |
| `link` | `gcc … -T linker.ld -nostartfiles -nostdlib -Wl,-Map=firmware.map -o firmware.elf`, then `size` and `objdump -h` |
| `image` | `objcopy -O binary` → hexdump of the first 64 bytes |

Each stage returns `{id, commands[], ok, stdout, stderr, artifacts[]}`. Stages
**stop at the first failure** (`failed` flag), so a broken build produces a short
report the frontend can land on. Sibling tools are resolved next to the gcc
binary (`r.tool()`), not from PATH, so a mixed toolchain install cannot pair the
wrong `objdump` with the right `gcc`.

The workspace is a `tempfile::TempDir`, so cleanup is RAII — it happens on every
exit path including an early return, which the previous hand-rolled
`remove_dir_all` did not.

### The three example files are *compile-time* constants

`src-tauri/src/examples/{main.c,startup.s,linker.ld}` are pulled in with
`include_str!`. They are not served over IPC separately and not editable on disk
— `pipeline_sources()` hands the frontend a copy for the bench editors, and that
copy is the only thing the user can change. `startup.s` is 58 lines of real
assembly: `.syntax unified`, `.section .isr_vector`, `ldr r0, =_sdata` /
`copy_data` / `zero_bss` / `bl main`.

### The CSP is a load-bearing config value

```json
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
       connect-src 'self' ipc: http://ipc.localhost; font-src 'self';
       img-src 'self' data: blob:; object-src 'none'; base-uri 'none';
       form-action 'none'; frame-src 'none'"
```

`connect-src` **must** keep the two `ipc` entries. Drop them and every
`invoke()` fails on Windows WebView2 — a silent, total loss of the compile lab
and the native dialogs, with no error a user could read. `style-src` needs
`'unsafe-inline'` because the labs set element styles from JS.

`withGlobalTauri: true` is what makes `window.__TAURI__` exist, which is how
`tauriInvoke()` detects the shell and falls back to a blob download in a plain
browser.

---

## 5. Data flow: storage, backup, journals

### The twelve keys

| Key | Written by | Holds |
|-----|-----------|-------|
| `ecroadmap.v1` | core | `{topicId: timestamp}` learned map |
| `ecroadmap.notes.v1` | core | `{topicId: markdown}` — an empty note **deletes** its key |
| `ecroadmap.marks.v1` | core | bookmarks |
| `ecroadmap.interview.v1` | practice | `{answers:{}}` |
| `ecroadmap.faults.v1` | practice | `{seen:{}}` |
| `ecroadmap.walk.v1` | labs 1–2 | which stages of the *reading* labs were opened |
| `ecroadmap.journals.v1` | all four labs | `{"lab:stage": markdown}` |
| `ecroadmap.theme` | core | `"dark" \| "light"` (raw string, not JSON) |
| `ecroadmap.bench.v1` | compile lab | whole model |
| `ecroadmap.lksandbox.v1` | linker lab | whole model |
| `ecroadmap.periph.v1` | periph lab | whole model **+ event tape** |
| `ecroadmap.protocols.v1` | protocol lab | whole model |

`labKeys()` returns **six** of these, not four:

```js
function labKeys() { return [K_BENCH, K_LKSAND, K_PERIPH, K_PROTOS, K_WALK, K_JOURNAL]; }
```

`K_WALK` and `K_JOURNAL` are in the list deliberately even though the roadmap's
own editor writes them: they *belong* to a lab stage, and that is what makes an
import carrying them count as a lab change and trigger the reload.

The split at `walk` vs `goals` is a *pedagogical* decision that leaks into the
dashboard: the two reading labs have nothing to grade, so they report honest
"stages opened" (`walkMark()`), while the two model labs report verified goals
(`storedGoals()` reading the `goals` object out of the lab's own state). Both are
counted against the lab's **declared stage list**, never the stored object's size,
so renaming a stage cannot inflate progress.

### `rd()` / `wr()` — the whole error policy

```js
function rd(k, fb) { try { … JSON.parse … } catch (e) { return fb; } }
function wr(k, v)   { try { … setItem …      } catch (e) { storageFailed(); } }
```

A **read** failure falls back silently (a corrupt key must not brick boot). A
**write** failure raises a sticky `notice()` **once per session** — a full or
blocked store losing your notes with no trace was `todo.md` §10.

### The backup envelope

```jsonc
{
  "schema": 2,
  "app": "embedded-c-roadmap",     // tag check: a foreign JSON file is refused
  "exportedAt": "…",
  "state": {
    "done": {}, "notes": {}, "marks": {},
    "interview": {}, "faults": {},
    "labs": { "ecroadmap.periph.v1": {…}, … },   // only keys that exist
    "settings": { "theme": "dark" }
  }
}
```

`restoreBackup()` is the most defensive function in the app, and each guard has a
reason a learner would understand:

| Guard | Why |
|-------|-----|
| `JSON.parse` in a try | "Invalid JSON" on the button, not a dead page |
| `app` tag check | importing an unrelated JSON file cannot half-apply |
| `schema > 2` refused; **older accepted** | refusing old backups would destroy user data every time a section was added; ignoring an absent section beats wiping earned progress |
| every section type-checked with a default | a missing `faults` must not delete `faultState` |
| `done[k] === true → 0` migration | the value changed from boolean to completion timestamp |
| **only the six `labKeys()` are written** | a backup file must not be able to write arbitrary `localStorage` keys |
| compare-then-write per lab key | a lab carrying identical state needs no restart |
| theme only when `settings` present | a backup without `settings` must not clear the user's theme |
| **reload if and only if a lab key changed** | a running lab ticker (`pfTick`) saves on every tick and would write its stale in-memory copy straight over the import within one interval |

That last row is the single most load-bearing design note in the data layer: the
reload exists to defeat a specific race, not as a blunt "refresh everything".

### Journals — one component, four hosts

`markdownEditor()` is a single component used by every topic note *and* every lab
stage journal. Journals differ in exactly three ways:

- mounted by `journalMount(lab, stage, name)` into a `jrhost` element the lab
  renderer does **not** own,
- keyed `"lab:stage"` in `ecroadmap.journals.v1`,
- named in `JR_TABS` so the dashboard can jump back.

That four-way name agreement (mount call ↔ `#jr-<lab>` host ↔ `JR_TABS` entry ↔
`data-*` attribute the labs generate) is invisible at runtime — get it wrong and
you get no box, or a box whose dashboard row goes nowhere. Hence four checks in
`validate_build.js`.

---

## 6. The graph is a *client*, not part of the app

`40_graph.js` is the one place the boundary is enforced by design rather than by
convention, and it is the best architectural idea in the repo.

```
40_graph.js
  ├── R = window.EmbeddedCRoadmap            (one capture at load)
  ├── R.topics      → nodes
  ├── R.edges()     → prereq | pattern | related | mention
  ├── R.clusters()  → failure families
  ├── R.esc         → shared escaping (with a local fallback)
  ├── R.view('roadmap') + R.goTopic(id)   → deep links out
  └── R.onHook('view:graph')                  → re-layout on entry
```

It never touches `STAGES`, `allTopics`, `byId` or any internal. The consequence
is that **the graph is automatically correct** whenever the topic model changes:
`edges()` derives prereq edges from `t.prereq`, pattern edges from `CLUSTERS`
expanded pairwise, related edges from `t.related` (minus anything already a
prereq pair), and mention edges from a regex over the lens prose
(`/\btopic\s+(\d+\.\d+)\b/gi` matched against a `code → id` map).

If the graph were reading internals, adding a stage would require remembering to
update it. Because it reads the API, `1b_data_topics.js` changing is enough.

Its own scope has its own layout: `model → forces → drawing → interaction →
keyboard traversal → selection → side panel → toolbar`, and a roving tabindex
over reading order so exactly one of 163 nodes is tabbable.

---

## 7. The nine views and who renders them

The body owns the view set. `setView(v)` flips `hidden` on every `.view` whose id
is not `view-<v>`. **Adding a view is a new element in `02_body.html` plus a rail
button in `01_head.html`** — there is no list of names in the app to update, and
`validate_build.js` fails if the two sides disagree in either direction.

| `data-v` | `id="view-…"` | Rendered by | Lazy init |
|----------|--------------|-------------|-----------|
| `roadmap` | `view-roadmap` | `buildStages()` + `markdownEditor()` per topic | at boot |
| `dash` | `view-dash` | `refreshDash()` — **derived from storage at render time** | on entry |
| `mosaic` | `view-mosaic` | `artwork()` draws a 1200×800 SVG die (CORE / FPU / NVIC / RAM blocks, package leads); `refreshMosaic()` lights one `cv-<i>` cell per topic | on entry |
| `graph` | `view-graph` | `40_graph.js` via the `view:graph` hook | on entry |
| `compile` | `view-compile` | `21_lab_compile.js` | `initCompileLab()` |
| `playground` | `view-playground` | `22_lab_linker.js` | `initLinkLab()` |
| `periph` | `view-periph` | `23_lab_periph.js` | `initPeriph()` |
| `protocols` | `view-protocols` | `24_lab_protocols.js` | `initProtocols()` |
| `practice` | `view-practice` | 4 sub-sections behind `#pv-subnav` | per track |

**Why the linker lab is `playground`.** The id is a historical artifact from when
the peripheral lab was called the playground. The rail label is the source of
truth for what a user sees, so the mismatch is invisible — but it is the one place
where a grep for "playground" will mislead you.

**Practice is a second level of the same contract.** `#sv-interview`,
`#sv-lab`, `#sv-faults`, `#sv-tools` are checked against `#pv-subnav button[data-sv]`
in both directions. A Practice button with no section is a dead nav item — which is
exactly the bug that shipped once, kept alive by a hardcoded jump, and is now
structurally impossible. `setSubview()` also refuses an unknown name rather than
hiding all four sections to show no fifth.

**The boot order is a safety property.** Navigation is wired *before* any data
work:

```js
// 1. rail buttons (so a later throw cannot leave navigation inert)
Array.prototype.forEach.call(document.querySelectorAll(".viewsw button[data-v]"), …)
// 2. then the data/render work
loadAll(); initDataTools(); buildMap(); buildLegend(); buildStages();
progress(); spyNav(); initTheme();
// 3. then the rest of the handlers, and finally
setView("roadmap");
```

### The rail is a map, not a list

Four `<details class="rgroup">` — Read (2), Labs (4), Practice (4), Progress (2).
`syncRail()` matches on `data-v` **and** `data-sv` (matching `data-v` alone would
light all four Practice tracks), opens exactly one group, and fills the masthead
crumb from the pressed button's own `.rname` and text. The count on a closed
header is hand-written in the summary (`<span class="rcount">4</span>`) — it is
**not** derived, and nothing checks it.

---

## 8. The four labs share one contract

This is the pattern that makes the labs feel like one product, and it is worth
copying verbatim into any fifth lab.

```
   ┌── stage rail: role="tablist", aria-selected tracks the current stage
   ├── stage body: a pure function of the model  ← this is what the specs render
   ├── goal card: PF_GOALS[n].ok() / .hint()    ← a predicate, not a snapshot
   ├── journal:   journalMount(lab, stage, name)
   ├── lab state: one versioned key, type-checked on load, defaults filled
   └── log:       a bounded ring the grader can predicate over
```

| | Compile | Linker | Peripherals | Protocols |
|---|--------|--------|-------------|-----------|
| view id | `compile` | `playground` | `periph` | `protocols` |
| stage ids | 7 tools + `check` | `mcu…sandbox` + `readasm` (9, string ids) | 1–10 | 1–12 (non-sequential) |
| stage table | `CLAB_STAGES` | `LINK_STAGES` | `PF_STAGE_META` | `PR_STAGE_META` |
| storage key | `bench.v1` | `lksandbox.v1` | `periph.v1` | `protocols.v1` |
| graded on | `data-ok` keys | `data-ok` keys | state **+ behaviour tape + deadline** | `data-ok`-style goals 1–12 |
| tick | none (build-driven) | none (local model) | `pfTick`, 100 ms | one shared ticker, `prXxxTick()` per family |

### Two details that took real work

**Behaviour grading (peripherals stage 9).** A goal that only snapshots register
state cannot fail the way silicon fails — an ISR that fires three times then stops
leaves every register reading correctly. So `periph.tape` is a bounded ring
(`PF_TAPE_MAX = 240`) of `{t, k, d}` written from the call sites that already log
(`enter`/`led` in `pfEnterIsr`, `exit` in `pfNvicTick`, `lost` in `pfRaceTick`).
Pure predicates (`pfTapeGaps`, `pfTapeCadence`, `pfTapeAge`, `pfTapeSteady`,
`pfTapeVerdict`) grade **cadence** (newest 8 entries steady within ±35 % of the
median) and **freshness** (newest entry ≤ 3 s old) separately, and `pfTapeVerdict()`
names which claim broke. A third and fourth claim close the hole cadence alone leaves
open: `pfTapeOnPeriod()` asks whether the measured cadence matches the rate that was
requested, and `pfIsrDeadline()` compares the period against the time one handler
holds the CPU — because a handler that overruns its own period still produces
beautifully even gaps, evenly spaced at the *cost* rather than the requested rate. All
four are read through the one gate `pfTapeStillRunning()`, which the goal card, the
nine-row checklist and the visible *Behaviour tape* card share, so those three cannot
disagree about what "working" means.

**Non-sequential stage ids (protocols).** `PR_STAGE_META` is ordered
`1, 7, 2, 3, 4, 5, 6, 10, 8, 9, 11, 12` — the *tab* order follows the teaching
order, the *ids* stay stable as stages were inserted. Consequences: `prLoad()`
clamps with `!prStageById(n)` rather than a range, and cross-family jumps call
`prGoStage()` instead of the core's `goStage()`, which assumes a 1..n range.

### Why stage bodies are pure functions

`prBody()` and `pfStageBody()` take the model and return HTML strings. Nothing
inside them touches the DOM. That is what makes headless rendering possible, and
headless rendering is the only guard that catches a **stage body throwing** — which
in the app is a tab that silently stops responding, with no console a user can
see. The specs that render all 22 stages also scan for `undefined` and `NaN`,
which caught three shipped holes of exactly this class.

The one exception is documented: the *Your code* panel is the single model path
that redraws after a click, and it bails out when its host is missing, which is
why the spec's stub `getElementById` returning `null` is enough.

---

## 9. The guards: what protects what

Each guard exists because of a specific way this codebase rots. The
right-hand column is what you lose without it.

| Guard | Command | Protects | Found |
|-------|---------|----------|-------|
| Behaviour specs | `npm test` | 19 files / 1143 checks over models **and** shell | 9 real bugs on first run |
| Lint | `npm run lint` | duplicate declarations in both scopes, duplicate API keys, console, TODO, tabs | 2 dead declarations |
| Build validation | `npm run build:roadmap` | JS syntax per fragment + assembled, rail ↔ view both ways, practice sub-nav ↔ sections, journal hosts ↔ mounts ↔ `JR_TABS`, graded question `data-ok`, version token, content breakpoints ≥ 812 px, tag balance, one `<style>`, one `</html>`, 1500 KB budget | 1 `#define directory` plural, 1 wrong quiz key |
| Version sync | `node scripts/sync-version.js --check` | `package.json` → `tauri.conf.json` → `Cargo.toml` | version drift |
| Rust tests | `cargo test` | `hexdump`, `tail_from`, `resolve_sources`, `version_token`, `parse_version`, `interesting_root` (+ 1 ignored integration needing a real toolchain) | bare date taken as version |
| clippy | `cargo clippy --all-targets -- -D warnings` | warnings as errors | — |
| CI | `.github/workflows/ci.yml` | all of the above on push/PR, two jobs (specs+build, rust) | — |

### The negative-control habit

The most distinctive practice here: **a new guard is not trusted until it has been
shown to fail on a deliberately patched copy.** The docs record ~80 such runs
(8 checks fail when ISER reverts to plain assignment, 4 when the CAN bus becomes
an OR, 3 when the I²C address helper reverts, 37 of 37 when the peripherals time
base and deadline are mutated, and so on).

The recipe, from `ongoing.md` §5: copy the spec *and* the fragment into a scratch
directory **inside the repo** (`/tmp` resolves awkwardly on this Windows setup),
patch the fragment, run the spec against it, and require a failure. The
documentation of a guard that has never bitten is a claim, not a fact.

### The slice-and-`vm` pattern

Because there is no framework and no DOM, every spec works the same way:

```js
const src  = fs.readFileSync('…/24_lab_protocols.js', 'utf8');
const from = src.indexOf('/* ---- models ---- */');        // marker string
const to   = src.indexOf('/* ---- logic-analyser primitive');
const ctx  = vm.createContext({});                        // stubs only what is borrowed
vm.runInContext(src.slice(from, to) + '\nthis.prResolve=prResolve; …', ctx);
```

The marker strings are **load-bearing**, and the project guards them properly:
**16 of the 19 specs** `throw` when a marker is missing or the range inverts,
so renaming a section comment fails the suite loudly instead of turning a spec
into a silent no-op. The three exceptions are deliberate — `lab_quiz.spec.js`
reads the whole fragment and greps it, `protocol_stages.spec.js` evaluates the
model it is handed, and `read_asm.spec.js` brace-matches its data structures and
reports a missing one as a failed check rather than a throw.

The real exposure is not the markers but the **stubs**. Six specs hand-write
their own `esc` into the `vm` context:

```js
esc: (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
```

That is a *copy* of `20_app.js`'s `esc`, and no spec asserts the two agree. If
`esc()` is ever changed — to also escape quotes, say — all six keep passing
against the stale copy. One shared exported stub would close it.

### Drift guards

Several specs deliberately recompute facts the prose states, so a teaching claim
cannot drift from the model that implements it:

- `periph_model.spec.js` reads the graded Hz bands, the `blink` preset's PSC/ARR,
  the "e.g. PSC 9, ARR 99" hint and the demo writes **out of the fragment**, and
  checks each against `pfUpdateRateHz()`. This is how the P7 off-by-one
  (`100/50 = 2 Hz` vs the real `1000/((PSC+1)·(ARR+1)) = 1.96 Hz`) became
  impossible to reintroduce.
- `periph_deadline.spec.js` recomputes the time base and the deadline maths, and
  fails if the prose, the timer card or the checklist stop agreeing with
  `pfUpdateRateHz()` / `pfIsrDeadline()`.
- `linker_sandbox.spec.js` recomputes `_estack`, the `1M` flash length and the
  `128K` RAM length from the constants and requires the *generated* script to
  contain them.
- `read_asm.spec.js` re-derives the `startup.s` classification from the definition
  of each line kind, checks every decode against the line it names, and pins the
  Thumb-2 pointers — so editing the file underneath the prose fails.
- `startup_pseudocode.spec.js` requires the reset pseudocode and the real
  `startup.s` to name the same symbols and call the same targets (this is how the
  `SystemInit` bug, `problems.md` P18, is kept out).
- `lab_compile.spec.js` pins the agreement across four places: the rail,
  `CLAB_TITLES`, `COMPILE_DATA` and the stage ids in `pipeline.rs`.

---

## 10. Change recipes: "I want to add X"

The most useful thing this document can do is tell you every file a change
touches. These are the real dependency sets.

### Add a roadmap topic

```
1b_data_topics.js        attach the approach / visual / related / interview metadata
10…15_data_*.js          the topic object itself, in the right STAGES.push()
                         · id, code, t, kick, tags, prereq[], L{8 lenses}, src{cap,code}, q{ask,ans}
1b_data_topics.js        validate the id (this file validates at startup)
(usually nothing else)   · prereq → graph edges, dashboard "next", stage order, all automatic
```

`validate_build.js` needs no change. The graph, dashboard, mosaic, search, heatmap
and interview coverage all read the canonical model, so a topic is *one* object
plus its metadata.

### Add a stage to an existing lab

```
<lab>.js    · add to PF_STAGE_META / PR_STAGE_META / LINK_STAGES
            · add a branch to the stage body renderer
            · add a goal to PF_GOALS / PR_GOALS
            · add a default field to the lab's defaults loader (field-by-field, no schema bump)
            · add a jrhost to 02_body.html and a name to JR_TABS in 20_app.js
            · (protocols only) add a prXxxTick() on the shared ticker + a prXxxSig() for prCap()
specs/…    · add the stage to the render-everything list, the reachability checks
            · add a negative control
```

`validate_build.js` checks the `jrhost` ↔ `journalMount` ↔ `JR_TABS` agreement
automatically. For the protocols lab, remember stage ids need not be sequential —
inserting id 10 before 8 is fine, but `prLoad()`'s clamp and `prGoStage()` are
what make it safe.

### Add a whole new lab

```
02_body.html        a <section class="view" id="view-…"> + a jrhost + (practice-style) sub-nav
01_head.html        a rail button with data-v, in the right .rgroup, with the group count bumped
2x_lab_new.js       inserted into the appFiles array in build.js AND validate_build.js
                    (two lists, in the same order — they must agree or the build is wrong)
20_app.js           an init function + a line in setView()
specs/lab_new.spec.js   slice + vm, render every stage, no undefined/NaN, goals callable
```

The two `appFiles` arrays (`build.js` and `validate_build.js`) are duplicated by
necessity — one concatenates, one checks — and nothing cross-checks them. A new
fragment added to only one of them fails confusingly.

### Change a storage key or the envelope

```
20_app.js       the K_* constant, rd/wr, snapshotAll, restoreBackup
<each lab>.js   its own key constant + its load/save
lib.rs          backup_read / backup_write if the shape or the cap changes
20_app.js       labKeys() — the allowlist that stops an import writing arbitrary keys
specs/backup_roundtrip.spec.js   the round-trip contract
docs            roadmap-source/README.md storage section, features.md, README.md
```

Bumping `DATA_SCHEMA` (currently 2) is what makes older builds *refuse* a newer
file. An older schema is always accepted, so **adding** a section needs no bump;
only a breaking reshape does.

### Change the pipeline (a new tool, a new stage)

```
src-tauri/src/pipeline.rs    the stage, its args, and what it returns
src-tauri/src/lib.rs          nothing, unless a new *command* is added
roadmap-source/21_lab_compile.js   CLAB_STAGES, the report shape, the parser, the stage body
specs/lab_compile.spec.js     the rail ↔ CLAB_TITLES ↔ COMPILE_DATA ↔ pipeline.rs agreement
```

Remember `r.tool()` resolves siblings next to the gcc binary, so a new tool
(`arm-none-eabi-readelf`, say) needs no PATH work — but it also does not exist if
the user's install is partial, and a spawn failure surfaces as
`stderr: "failed to spawn: …"` rather than as a crash.

### Change a rail label, or add a rail item

```
01_head.html        the <button> text, and the .rcount on the group summary
                    (the count is hand-written — nothing derives it)
validate_build.js   rail ↔ view both ways fires if you forget 02_body.html
```

Labels live in exactly one place — the button's own text — because `syncRail()`
reads the masthead crumb off the pressed button instead of a second table of
names. Do not introduce a second table.

---

## 11. The seams that would break first

Ranked by how much damage each would do and how quietly it would happen.

| # | Seam | Why it is fragile | What catches it |
|---|------|-------------------|-----------------|
| 1 | **Six hand-rolled `esc` stubs in the specs** | `backup_roundtrip`, `dash_progress`, `linker_sandbox`, `note_editor`, `periph_regs` and `protocol_stages` each define their own `esc` in the `vm` context. If the real `esc()` ever changes behaviour, all six keep passing against the old one | nothing. One shared exported stub would fix it |
| 2 | **The two `appFiles` arrays** | `build.js` and `validate_build.js` list fragments independently | nothing. A fragment in one but not the other fails confusingly |
| 3 | **Labs sharing the app IIFE scope** | a rename in the core silently breaks a lab; a lab can shadow a core name | `scripts/lint.js` catches *duplicate* declarations, not *missing* ones |
| 4 | **The CSP `ipc:` entries** | removing them fails every `invoke()` on WebView2 with no readable error | a manual live check; nothing automated |
| 5 | **`include_str!` example files** | editing `src-tauri/src/examples/main.c` changes the *lab's default source* with no frontend change and no spec noticing | `specs/lab_compile.spec.js` checks the *shape*, not the content |
| 6 | **Hand-written `.rcount` in the rail** | add a stage or a view, forget the number | nothing. It is cosmetic, which is why it is last |
| 7 | **Stage ids assumed 1..n** | `goStage()` is numeric; the protocols lab already needed `prGoStage()` because its ids are 1,7,2,3,4,5,6,10,8,9,11,12 | the protocol spec's stage-list check |
| 8 | **lab state loaded with ad-hoc defaults** (`if (!Array.isArray(…))`) | no named migration, so a reshape cannot be reasoned about — `features.md` D1 is the fix | each lab type-checks its own fields; nothing version-checks them |
| 9 | **`40_graph.js` load-time capture of `R`** | if the API is renamed, the graph silently renders nothing rather than erroring | `lint.js` does not check API key existence — `features.md` E4 is the fix |

**The one-line summary of the architecture:** the app is a single scope with one
published API, generated by concatenation, guarded by specs that slice the same
source the app runs, and persisted in twelve `localStorage` keys behind one
versioned JSON envelope. Its strength is that the teaching models are pinned by
tests that re-derive the numbers the prose claims. Its weakness is that almost
every boundary between files is a **convention** — a marker string, a duplicated
array, a name in a table — rather than something the build enforces.

---

*Companion documents: [README.md](README.md) (what it is) ·
[roadmap-source/README.md](roadmap-source/README.md) (the fragments) ·
[features.md](features.md) (what ships, what is next) ·
[problems.md](problems.md) (defects found and fixed) ·
[Embedded0_100_vs_Current_Project.md](Embedded0_100_vs_Current_Project.md)
(coverage against a 0→100 benchmark).*
