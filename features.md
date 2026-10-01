# features.md — what ships today, and where it can go next

**Written:** 2026-09-30 · **Version:** 1.0.0 · **Branch:** `main`

A feature inventory with two halves:

1. **[Part 1](#part-1--current-features)** — every feature that exists, described by *how it
   actually works* (the mechanism, the storage key, the contract), not just what it looks like.
2. **[Part 2](#part-2--candidate-features-and-sub-features)** — a ranked catalogue of new
   features and sub-features for **learning content** (*A*), **UX** (*B*), **UI** (*C*),
   **data/resilience** (*D*), **engineering quality** (*E*) and **accessibility** (*F*), each
   tied to the hook it would build on, plus a [suggested order](#suggested-order).

Part 1 covers the shell, the four Learn surfaces, the four labs, Practice, the data/Rust
layer and the build/test harness; each entry names the function, storage key or contract
that does the work.

For defects and their fixes see [problems.md](problems.md); for the audit's own work items see
[improvements.md](improvements.md) and [todo.md](todo.md); [ongoing.md](ongoing.md) is the
session handoff. This file looks forward.

---

## Part 1 — Current features

### The shell

| feature | how it works |
|---|---|
| **Fixed left rail** | Four `<details>` groups — Read (2), Labs (4), Practice (4), Progress (2). Each button carries `data-v` (view) and, for Practice, `data-sv` (track). `syncRail()` marks exactly one button `aria-pressed="true"` by matching both, opens that button's group, and fills the masthead crumb from the pressed button's own text — so labels live in exactly one place. |
| **View switching** | Every view is a `.view` element; `setView(v)` flips `hidden` on all of them (the body owns the list — adding a view is a new element plus a rail button). It lazily initialises the target lab, refreshes dashboard/mosaic, fires the `view:graph` hook, syncs the rail and scrolls to top. The top-boot wiring runs before any data work, so a later feature error cannot leave navigation inert. |
| **Search** | `filter(q)` matches a per-topic `_blob` of code, title, lenses and cue text; hits are unhidden and opened, misses get `.hit-hide`, and a stage hides entirely when it has no hits. |
| **Expand all** | `openAll(v)` toggles every topic's `.open` class and its `aria-expanded`. |
| **Topic-lens reading mode** | Clicking a lens chip sets `activeLens`; every `.lens` block whose `data-k` differs is hidden, the body gets `.lensmode`, and the lens note says how many topics the lens covers. Clicking the same lens again clears it. |
| **Progress meter** | `progress()` writes `%` to `#progbar`/`#progtxt` and renders the rail's `rev` line from `__APP_VERSION__` (substituted from `package.json` at build time) plus `d / n topics`. |
| **Theme** | `data-theme` on `<html>`; the Theme button flips dark/light using the current attribute or `prefers-color-scheme`, and persists the choice under `ecroadmap.theme`. |
| **Notices** | `notice(text, kind, sticky)` — one dismissible banner fixed to the foot of the window, `role="alert"`/`role="status"`, token-aware so a newer notice does not fight an older one. Replaces `window.alert` and carries the storage-full warning. |
| **Skip link / a11y floor** | First tab stop is *Skip to content* → `#content` (a focusable wrapper around every view); dashboard counters are `aria-live="polite"`; the notes "saved" flash has an `.sr-only` live mirror. |

### Learn

**Roadmap** — 7 stages, 163 topics, each topic rendered through the same **8 lenses**
(`idea`, `compile`, `link`, `mem`, `run`, `hw`, `design`, `trap`), with a cue line, an optional
visual, up to four related-topic links, and a bookmark toggle. The hero carries a clickable
memory map (`.mmap`): picking a region filters/scrolls to the topics tagged with it.

**Notes + the learned gate** — every topic carries the same `markdownEditor()` component:
rendered markdown by default, a `Write`/`Done` button that swaps in a `<textarea>`, a 400 ms
debounced save, and an explicit flush when the editor collapses. The visible "saved" dot is
opacity-only and mirrored by an `aria-live` region. *Mark as learned* only appears once the note is ≥ **12
words** (`GATE_MIN`); notes are stored as the `ecroadmap.notes.v1` map and an empty note deletes
its key rather than storing `""`.

**Markdown safety** — `md()` escapes the source *first*, then recognises a whitelist of
constructs (headings, lists, blockquote, tables, code fences, inline code, emphasis, links);
raw HTML can never pass through, and `inline()` requires URLs to be both scheme-clean
(no `javascript:`/`data:`/`vbscript:`) and quote-clean. Pinned by
[specs/markdown_safety.spec.js](specs/markdown_safety.spec.js).

**Dashboard** — every panel is derived from localStorage at render time; nothing is inferred:

- learned count + per-stage bars (`K_DONE`);
- the four **benches**: Compilation Path and Linker & Startup count *stages opened*
  (`ecroadmap.walk.v1`), Peripherals and Protocols count *goals verified* from each lab's own
  state (`storedGoals()` reads `goals` out of the lab object). Counts run off the lab's own
  stage list, never off stored object size, so a renamed stage cannot inflate progress;
- a **last-30-days heatmap** from per-topic completion timestamps;
- **ready to start** — prerequisite-aware "what to read next";
- **bookmarked** and **your writing** — one merged list of topic notes *and* lab stage
  journals, each row jumping back to the exact stage (`goStage()` presses the lab's own stage
  button; the Protocol Lab's cross-family case calls `prGoStage()`);
- clipboard export of all writing (`notesMarkdown()`) and of progress (the same JSON envelope
  `Export data` uses, so it imports straight back).

**Mosaic** — one puzzle piece per topic in roadmap order; a learned topic lifts its piece to
reveal a chip-die floorplan underneath. `Peek` temporarily reveals the whole picture; the
count updates as topics are completed.

**Concept graph** ([roadmap-source/40_graph.js](roadmap-source/40_graph.js)) — a custom
force-directed constellation of the same topics, reading everything through the public API
(`EmbeddedCRoadmap.edges()/clusters()/topics`), so it is one rendering of the shared data
model. Four edge kinds (**prerequisite**, **same failure pattern**, **conceptually related**,
**mentioned in text**) can be toggled; three layouts (**by stage**, **by pattern**, **free**);
cluster chips focus a failure family; a side panel follows the selection and deep-links back
to the roadmap (`goTopic`). Keyboard traversal is a roving tabindex over reading order —
Arrow Up/Down walk a stage's column, Left/Right jump stages, Home/End, Enter/Space select,
Escape clears.

### Labs

Every lab shares four mechanics:

- **Stage rail** — a `role="tablist"` of buttons; `aria-selected` tracks the current stage.
- **Stage journal** — the same markdown editor, mounted below the stage under a
  `jrhost` element and keyed `"lab:stage"` in `ecroadmap.journals.v1`.
- **Walk marks** — the two reading labs record which stages were opened
  (`walkMark()` → `ecroadmap.walk.v1`) so the dashboard has an honest metric where nothing is
  graded.
- **Persisted state** — each lab stores its whole model under one versioned key, type-checks
  it on load, and fills missing fields from its defaults. Every lab is in the backup file and
  an import that changes lab state reloads the page (`labsChanged` compare-then-reload).

**Compilation Path** ([21_lab_compile.js](roadmap-source/21_lab_compile.js)) — 8 stages:
Source → Preprocess → Compile → Assemble → Object → Link → Image → Check. With an ARM
toolchain installed the lab runs the **real** `arm-none-eabi-gcc` through the Tauri
`pipeline_run` command and shows genuine preprocessed tail, assembly, object dump, map
excerpt and binary; without one it falls back to the teaching model with the same stage
narrative. Stage `check` grades two questions whose answers live in `data-ok` (validated by
the build and by [specs/lab_quiz.spec.js](specs/lab_quiz.spec.js)).

Two modes sit on top of that one rail, and the split is deliberate:

- **Teaching** shows the fixed example's authored narrative plus, when a toolchain is present,
  that example's real per-stage output.
- **Lab bench** (only offered when `arm-none-eabi-gcc` is found) exposes the three fixed
  source slots — `main.c`, `startup.s`, `linker.ld` — for editing and a real build. Filenames,
  flags and stage order stay fixed in Rust; the only variable is your code. Your build is a
  **second report** (`clab.benchReport`), so it can never leak into the teaching stages, and
  `clabReport()` is the one place that decides which report a stage shows.
- **The bench reuses the same eight stage tabs rather than growing its own views** (a
  decision, not an accident): stages 2–7 in bench mode render the observations parsed from
  *your* build — `#define` counts, assembly labels and instruction counts, objdump section
  sizes, the size table, the vector-table words — plus your actual artifact under *real tool
  output*. Adding a parallel bench-only pipeline would duplicate the rail and split one build
  across two UIs.
- **Legibility:** a *Lab bench* badge marks the stage head, every artifact and facts panel
  names its source (`your bench sources` vs `the fixed example`), the stage rail carries
  per-stage ✓/✕ marks, and a failed build lands on the first failing stage the way a compiler
  takes you to the first error.

The report split, provenance labels, parsers, failure landing and the rail ↔ `CLAB_TITLES` ↔
Rust stage-id agreement are pinned by [specs/lab_compile.spec.js](specs/lab_compile.spec.js).

**Linker & Startup** ([22_lab_linker.js](roadmap-source/22_lab_linker.js)) — 9 stages:
MCU → Files → Script → Memory → Startup → Build → Check → **Sandbox** → **Reading a `.s`**.
The script stage explains the linker script rule by rule; memory shows placement; startup walks
the reset sequence; the sandbox is a local placement model where sections can be dragged between
FLASH/RAM and VMA/LMA, usage bars, the generated linker script and failure diagnostics update
live. The last stage teaches reading the assembly the build hands you: `startup.s`'s 58 lines
classified by kind (only some are instructions — the vector table's `.word` directives emit
bytes but are not code), four real instruction lines taken apart field by field, and
**Thumb-2** — the part line 6's `.thumb` had been asserting without explanation. Sizes *and*
the stack/heap reserves are clamped by one `lksClampSize()` (a negative reserve used to bend
the RAM total); the maths is pinned by
[specs/linker_sandbox.spec.js](specs/linker_sandbox.spec.js), the reader's guide by
[specs/read_asm.spec.js](specs/read_asm.spec.js), and the reset pseudocode ↔ `startup.s`
agreement by [specs/startup_pseudocode.spec.js](specs/startup_pseudocode.spec.js).

**Peripheral Playground** ([23_lab_periph.js](roadmap-source/23_lab_periph.js)) — a 10-stage
curriculum on a live Cortex-M4 model, ticked every 100 ms (`pfTick`, 1 kHz scaled to
`PF_CLK_PER_TICK`):

1. Mental model (MMIO + clock tree), 2. Bits & macros, 3. GPIO output, 4. Input & polling,
5. Timer as divider (PSC/ARR/CNT, draggable ARR line on the waveform), 6. Three switches
(DIER × ISER × PRIMASK), 7. Priority & nesting (swim-lane CPU timeline), 8. The RMW race
(lost-update counter, BSRR fix), 9. Bring-up challenge, 10. Playground (fixed preset programs).

The **register bank** models honest access semantics: `ISER0` is write-1-to-set with
`ICER0` as its write-1-to-clear, write-only partner (clicking a set ISER bit routes the
clear through ICER, exactly like the emitted C); `BSRR` is a write-only atomic set/reset
register (`0x4002_0018`, reads 0); `PUPDR` is clickable with whole-field cycles that can
never synthesise the reserved `11` pattern; `CCR` is a real timer row the duty slider
writes. Bits with no behaviour in the lab say "not wired in this model" on hover and render
striped — distinct from true read-only bits.

Grading (`PF_GOALS` 2–9) is predicates over the live register state with per-stage hints;
stage 9 additionally grades **behaviour over time** — a bounded event tape
(`periph.tape`, ring of 240 `{t,k,d}`) records handler `enter`/`exit`, ISR-driven `led` writes
and `lost` updates. `pfTapeStillRunning()` requires four separate claims: N entries on a steady
cadence, the newest entry fresh, the cadence matching **the rate that was configured**
(`pfTapeOnPeriod`), and the **deadline met** (`pfIsrDeadline`: the period the timer generates
against the time one handler holds the CPU). Regular-but-late fails, and `pfTapeVerdict()`
names which claim broke. The goal, the nine-row checklist and the visible *Behaviour tape*
card all read that one gate. Every click is also reverse-engineered into the canonical C
statement in a *Your code* panel (`RCC->AHB1ENR |= …`).

The **time base** carries its fractional remainder (`T.acc`), so `pfUpdateRateHz()` is exact at
every PSC/ARR, and one tick's surplus rollovers are counted (`T.merged`, bounded by
`PF_MAX_ROLLS`) rather than lost to UIF's single bit. The timer row shows the deadline live —
`period N ms vs 400 ms handler — x % CPU`, green or red (`.dl-ok` / `.dl-bad`). `PF_ISR_MS = 400`
is labelled a **model device** throughout: a real ISR is microseconds, and 400 ms is four sim
frames chosen so preemption is visible at the 10 Hz tick. The model tops out at 2.5 Hz, which is
why stage 9's band is 1.5–2.4 Hz. All of it is pinned by
[specs/periph_deadline.spec.js](specs/periph_deadline.spec.js).

**Protocol Lab** ([24_lab_protocols.js](roadmap-source/24_lab_protocols.js)) — 12 graded
stages in 5 families on one shared logic-analyser instrument:

- **Basics** · *Signals 101* (push-pull / open-drain / input × pull resolving to a level,
  including floating, and a wired-AND rig) and *Protocol map* (the seven questions every
  serial protocol answers, now with a **CAN column**, each cell linking to the stage where you
  can make it fail);
- **UART** · *The frame* (start/data/parity/stop on the wire), *Sampling & baud* (a drift
  slider walks the receiver's sample points across bit boundaries), *Terminal* (type → frame →
  decode with a live `BRR` readout);
- **I²C** · *Shared wire* (two masters arbitrate on the wired-AND, the loser drops out
  mid-byte), *Address + ACK* (`0x50 << 1 | R/W`, 9th-clock ACK/NACK, repeated-start register
  read), and *Clock stretching* (the slave holds SCL low after its ACK while the master's bit
  counter visibly freezes; the LA draws the flat held clocks and the table counts *data bits*,
  not edges);
- **SPI** · *Four modes* (CPOL/CPHA as one 2-bit number; mismatch shifts the byte by a
  window) and *The shift ring* (a read is always one transaction behind);
- **CAN** · *Dominant wins* (a differential pair with its 120 Ω terminators, wired-AND, and
  **non-destructive arbitration by ID**: two nodes transmit in lockstep, the first one that
  wrote 1 and read 0 drops out at that bit and becomes a receiver) and *The frame*
  (SOF/ID/RTR/IDE/r0/DLC/DATA/CRC-15/ACK/EOF/IFS, a real CRC-15 over SOF..DATA, **bit stuffing**
  with the inserted bits highlighted in a bit strip, and an ACK slot that only goes dominant if
  a receiver heard the frame — switch the receiver off and watch it stay recessive).

Three LA renderers share one playhead contract: the **per-bit box** trace (UART framing, CAN
arbitration), the **multi-lane clocked wave** (I²C SCL+SDA, SPI's two or three lanes), and a
new **field-band** renderer for CAN frames, where 60-plus bits are unreadable one labelled box
at a time, so each field is drawn as one labelled band with the bits gridded underneath.

The LA primitive can play a finished capture, scrub it bit by bit, and step back to "what had
the receiver decided by step k"; a keyboard table drives both the handler and an on-screen
cheatsheet; `prLog` keeps a 60-entry lab log with sim-clock stamps. Every new protocol gets its
own `prXxxTick()` on the one shared ticker, so pause / speed / reset / scrub work identically
everywhere.

### Practice

**Interview prep** — 25 questions × 4 tracks (bare-metal, RTOS, automotive, low power) × 2
levels × 4 formats (defect hunt, predict, explain, design). Filters are three selects; each
question's **rubric** is keyed by the same 8 lenses as the roadmap, so coverage is per lens,
not per answer. Answers persist in `ecroadmap.interview.v1`; *mock round* builds a pool,
shuffles it with the seeded `shuffle()`, and runs a timer.

**Memory-map lab** — type a declaration and the local teaching model applies storage
duration, `const`-ness and initialisation rules to place it in `.text`/`.rodata`/`.data`/`.bss`
or the runtime stack, with flash/RAM totals and explicit simplifications stated on-screen.

**Fault triage** — 10 register-dump scenarios with a four-option diagnosis; the seeded shuffle
changes the order, a session score tracks correct answers, and seen/solved state persists
(`ecroadmap.faults.v1`).

**C tools** — a sub-tabbed workbench: integer operation model (typed operands and result),
two's-complement bit setter (8/16/32-bit), shift model (width × signedness × direction),
endianness byte view, struct-layout builder with padding, a register bit decoder with a CFSR
preset and custom bits, plus **compiler diffs** — pre-authored comparisons verified against
real Cortex-M / AAPCS toolchain behaviour (deliberately nothing compiled live).

### Data, persistence and the Rust side

- **One storage namespace**: `ecroadmap.*` (progress, notes, bookmarks, theme, interviews,
  faults, walk marks, journals, and one key per lab). `rd()`/`wr()` swallow parse/access
  errors but a failed **write** raises the storage-full notice once per session.
- **Backup**: `snapshotAll()` produces a versioned envelope (`schema: 2`, `app`,
  `exportedAt`, the full state + labs + theme). Import validates the app tag, refuses a
  *newer* schema, only writes lab keys this build knows, compares each lab key before writing
  and reloads only when lab state actually changed, and restores the theme when present. An
  export→import round trip is pinned by
  [specs/backup_roundtrip.spec.js](specs/backup_roundtrip.spec.js).
- **Tauri commands** ([src-tauri/src/lib.rs](src-tauri/src/lib.rs)): `toolchain_status`,
  `pipeline_sources`, `pipeline_run`, and four backup commands
  (`backup_save_dialog`, `backup_open_dialog`, `backup_write`, `backup_read`). The frontend
  only ever receives a path the native dialog returned; `.json` suffix and a 20 MB cap are
  re-checked on both read and write. Browser fallback (blob download + hidden file input)
  keeps the standalone HTML working.
- **Toolchain detection** ([toolchain.rs](src-tauri/src/toolchain.rs)): env override
  `ECROADMAP_ARM_GCC`, then PATH probe, then known install roots; `--version` is parsed by
  `version_token` (two or three all-digit dot-joined parts), so a bare build date can never be
  taken as the version.
- **Pipeline** ([pipeline.rs](src-tauri/src/pipeline.rs)): only the three fixed source slots
  are accepted; the run happens in a `tempfile` dir with RAII cleanup; every command is
  reported with its args, stdout clipped at a fixed artifact limit, and windows are suppressed
  (`CREATE_NO_WINDOW`).
- **Offline by construction**: no CDN, vendored fonts under `src/fonts/`, a CSP in
  `tauri.conf.json` (`default-src 'self'`, `connect-src 'self' ipc: http://ipc.localhost` —
  the `ipc:` entries are required or every `invoke()` fails on Windows WebView2).

### Build, validation and tests

- **Fragments are the source**: `01_head.html` + `02_body.html` + data fragments + `20_app.js`
  and `21`–`25` lab fragments + `40_graph.js` are concatenated by `build.js` into
  `roadmap-source/embedded-c-roadmap.html`, then copied to `src/index.html` with `src/fonts/`.
  Generated HTML is gitignored and regenerated by `beforeDevCommand`/`beforeBuildCommand`.
- **`validate_build.js`** checks the contracts a unit test cannot see: fragment syntax and the
  assembled IIFE, exactly one `<style>`, rail ↔ view agreement, journal hosts, every lab
  stage's journal host, every graded question's `data-ok` key, `__APP_VERSION__`
  single-sourcing, tag balance, and an **HTML size budget** (`HTML_BUDGET_KB = 1500`,
  currently ~1215 KB).
- **Specs** — 19 zero-dependency spec files (`npm test`, orchestrated by `specs/run.js`,
  **1143 checks**) that slice their subject out of the fragments with marker strings, stub
  `rd`/`wr`/`pfRenderLive`, and `vm.runInContext` the slice, so there is no framework and
  nothing to install: shell behaviour (rail, journals, notes, markdown, backup, dashboard,
  boot IPC) plus the lab models themselves (quiz keys, helpers, the linker sandbox and its
  `startup.s` reader's guide + pseudocode agreement, the peripherals register semantics,
  behaviour tape and deadline model, the protocols, and the compilation-path report split and
  output parsers).
- **Lint** — `scripts/lint.js` fails on duplicate declarations in either IIFE scope, duplicate
  public-API keys, console statements, TODOs and tabs.
- **Version** — `scripts/sync-version.js` keeps `package.json` → `tauri.conf.json` →
  `Cargo.toml` in step; `--check` is wired into CI.
- **CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) — specs, lint, version check
  and roadmap build, then `cargo test` and `cargo clippy --all-targets -- -D warnings`.

---

## Part 2 — Candidate features and sub-features

Nothing here is committed work; it is the menu. Each item gives the **hook** it would build on
so the cost is visible, and a rough size: **S** (an afternoon), **M** (a focused session or
two), **L** (a project). Ordering inside each section is by how much it moves the product.

### A · Learning content and pedagogy

**A1 · Behaviour grading for the Protocol Lab** — *(L, highest value; the peripherals lab is
the template)*. The protocol lab already logs every meaningful event through `prLog` with a
sim-clock stamp, but grades only register/state snapshots. A tape + predicates would let
stages say what actually matters: "the byte decoded survives ±3 % baud drift", "the read is
fresh — it came from *this* transaction, not the previous one", "the loser released SDA
within one bit of losing arbitration". Concretely: reuse the existing bounded log
(`PR_LOG_MAX`) or add a tape like `periph.tape`, express `freshRead` / `driftOk` /
`arbAbort` as pure predicates, route goal + checklist + a visible tape card through one
gate, and add a `specs/protocol_tape.spec.js` following
[specs/periph_tape.spec.js](specs/periph_tape.spec.js).

**A2 · CAN bus family** — *(L)* — **delivered 2026-09-30.** Landed as stages 11–12: *Dominant
wins* (differential pair + terminators, wired-AND, non-destructive arbitration by ID with the
loser's bit marked in the trace and the bit-by-bit intent table) and *The frame* (field-band
trace, CRC-15, bit-stuffing strip, ACK slot, receiver-absent variant). The map table gained a
CAN column and goal 7 now spans all four families. Still open from this item: **error frames**
(a dominant bit inside EOF/IFS) and a bus-off/recovery state machine.

**A3 · I²C clock stretching, multi-slave, and a real device** — *(M)* — **half delivered
2026-09-30.** *Clock stretching* is stage 10: a 0–6 clock hold after the slave's ACK, drawn as
flat SCL-low slots with a table proving the master's bit counter does not advance. Still open:
a **second slave** on the bus so address decoding decides who ACKs, and a two-slave register
read.

**A4 · SPI real-device sequences** — *(M)*. A flash read (command → address → dummy →
data) turns the shift ring into a story; burst/DMA mode shows CS held across bytes. Builds
directly on the existing SPI model and scrubber.

**A5 · Volatile "break it" demo with the real compiler** — *(M; already listed in README)*.
Compile the same polling loop at `-O0` and `-O2` in the bench and diff the real disassembly,
with a `volatile` toggle. The bench pipeline already runs and returns artifacts per stage;
this is one more fixed source pair plus a diff view.

**A6 · Spaced-repetition review queue from existing cards** — *(M)*. `EmbeddedCRoadmap.cards()`
already returns every topic's question/answer/learned state and `done` already stores
completion timestamps. A "Review today" view can schedule items by forgetting-curve intervals,
ask the card's question first, and only then show the topic. This finally gives the
`q`/`ask`/`ans` data a UI (today the API exists but no view consumes it).

**A7 · Guided stage journals** — *(S)*. The journal box is free-form. Per-stage prompt
templates ("what I expected / what I observed / what surprised me", or a lens checklist) would
raise the quality of the writing the dashboard aggregates, and a **dossier export** could
concatenate all journals + notes into one Markdown file for revision.

**A8 · Recall gate before "mark as learned"** — *(S)*. The learned gate currently needs 12
words of notes. A one-question recall check drawn from the topic's `q` (or a "teach it back in
three bullets" template) would make the gate test understanding rather than typing.

**A9 · ADC / DMA / RTOS view** — *(L)*. The remaining frontier named in README: an ADC
sampling + DMA transfer model, and an RTOS view with tasks, a tick, priority inversion and a
mutex-vs-ISR case. The swim-lane timeline in the peripherals lab is a working prototype of
the visual language this needs. This is one third of the [peripherals-depth
gap](#peripherals-depth-what-a-full-course-would-add) below.

### Peripherals depth — what a full course would add

An audit of the lab against *"if this were a full, in-depth peripherals course, what would
be missing?"*. The register-semantics items were fixed in the same pass (problems.md
P15–P17); the rest is the honest frontier, ordered as a build order.

**Missing peripherals, entirely.** SysTick (the core's own tick — the natural first
interrupt, and currently every timer here is a TIM); EXTI + pin interrupts + debounce (the
switches can only be polled; the button-bounce lesson has no model); **ADC** (the analog
topics exist in the roadmap text with no lab); **DMA** (the roadmap teaches "memory has
multiple masters" — the lab has exactly one master); USART/SPI/I²C *register* blocks
(TXE/TC/RXNE/ORE/FE, BRR, request lines — the Protocol Lab teaches the wire, not the
peripheral around it); watchdogs, RTC and low-power modes (`PWR_CR`, WFI/WFE,
sleep/stop/standby, RAM retention); and the clock tree beyond two gates (HSE/HSI/PLL,
AHB/APB prescalers including the APB×2 timer rule, flash wait states). **Faults** are also
absent: HardFault/BusFault/UsageFault, CFSR/HFSR/MMFAR/BFAR, VTOR — the app teaches fault
triage in Practice with no hardware model to attach it to.

**Depth gaps in what exists.** GPIO has no `OSPEEDR`, `AFR` (AF is prose-only — "the
alternate function owns the driver" — with no owner to hand the pin to), `LCKR` or `BRR`.
The timers have no DIR/RCR, no CCMR/CCER (so no real compare-*output* channel — stage 5
draws what PWM would do), no input capture, no per-channel interrupts. The NVIC has no
`ISPR`/`IABR`/`ICPR` grids, no tail-chaining or late-arrival, no priority grouping. The
CPU card lacks BASEPRI, PRIMASK save/restore discipline, LDREX/STREX and DSB/DMB.
**Cost and the deadline are now modelled** — `PF_ISR_MS`, `pfIsrDeadline()` and the on-period
gate let the lab answer "how long can a handler be? does this rate fit the deadline?" (see the
lab description above). What it still cannot answer is **latency**: how long a masked interrupt
*waited*, or what a tail-chain or late arrival cost, because nothing accumulates a wait time
yet. Tooling gaps: no single-step + register-diff debugger
loop, no graded debug bench of *unlabelled* broken drivers (presets announce themselves —
"Bug: forgot GPIOA clock" gives the game away), no one instrument correlating pin edges,
ISR lanes and DMA bursts, and no register reference with reset values and honest reserved
bits (the new "not wired in this model" hover is a start, not the reference).

**Build order, highest leverage first:** (1) a real time base + handler-cost + deadline
model — **done (I15)**, so "cost" is gradeable; (2) **latency and jitter** — the accumulating
half the deadline model does not have yet — then SysTick and EXTI + debounce; (3) a real PWM
output channel (CCMR/CCER + AF pin ownership, feeding the existing waveform); (4) the
register-semantics accuracy pass — **done earlier (P15–P17)**; (5) DMA → ADC → low-power wake;
(6) faults + vector table, then the debugger loop and the unlabelled-bug bench. Items (1)–(3)
are the ones that change what the lab can *grade*; (5)–(6) are new teaching surface.

**A10 · C tools depth** — *(S–M)*. Add union/bit-field layout, integer-promotion traps,
`const`/`volatile` placement, and packing attributes to the existing typed models; each is a
new panel on the `pgv-bitlab` grid, not a new architecture.

### B · UX

**B1 · Resume where you left off** — *(S)*. One `ecroadmap.last.v1` entry (view + topic or lab
stage) written on navigation, surfaced as a **Continue** button in the rail or hero. The
`goStage()`/`goTopic()` jump machinery already exists and works across labs.

**B2 · Goal chips on the Dashboard benches** — *(S)*. `storedGoals()` already counts verified
goals; render one chip per stage with a jump, so the dashboard shows *which* stage is open,
not just `3/8`. Same data, better resolution.

**B3 · Undo for destructive lab actions** — *(S)*. Reset/Reshuffle buttons currently discard
state silently. Route them through `notice()` with an **Undo** action that restores the
snapshot taken before the click.

**B4 · Import preview and automatic disk backups** — *(M)*. Show what an import would change
(counts per section, labs that will reload) before applying. Separately, an opt-in Tauri
auto-backup that writes a timestamped JSON on a schedule and prunes old files would turn the
manual export into a safety net.

**B5 · Daily goal and streak** — *(S)*. The heatmap already stores per-topic dates; a small
"today: 1 topic" goal plus a streak counter on the dashboard gives the heatmap a purpose.
Pairs naturally with A6's review queue.

**B6 · Command palette and shortcuts** — *(S–M)*. A `g`-prefixed chord set (g r roadmap, g d
dashboard, g g graph, / search) and a small palette over views + topics. The public
`view`/`practice`/`focus` API already exposes every destination.

**B7 · Mock interview upgrades** — *(M)*. Pause, per-question timing, and a post-round report
that aggregates rubric coverage by lens over time — turning the existing one-shot timer and
`ivCoverage()` into a training log.

**B8 · Fault triage spaced repetition** — *(S–M)*. `faultState.seen` already persists solved
scenarios; schedule misses to come back, and explain why each wrong option is wrong (the
scenarios already carry the reasoning).

**B9 · Study sheet export** — *(S)*. Print/export a single lens across the roadmap (the
lens-mode already filters to exactly that set) as a clean Markdown/HTML sheet.

### C · UI

**C1 · Notes: preview, word count, and `[[topic]]` links** — *(M)*. The editor already
renders markdown beside a textarea; add a live word count vs the 12-word gate, and resolve
`[[code]]` links to topic jumps. Backlinks (which notes mention this topic) fit the same
index used by the graph's `mention` edges.

**C2 · Graph focus tools** — *(M)*. Stage/lens filters, a node search box, and a "dim
everything but this cluster" mode. The graph builds stage columns and cluster hubs already;
this is interaction polish over existing geometry, plus an SVG export.

**C3 · Mosaic keyboard parity and stage ribbons** — *(S–M)*. The graph got roving-tabindex
traversal; the mosaic is still hover-only. Focusable pieces with the same tooltip-on-focus
pattern, plus a stage ribbon showing completion, would bring it in line.

**C4 · Rail progress at a glance** — *(S)*. Mini bars (or counts) in the rail's Read/Labs/
Progress group headers, fed by the same data the dashboard reads.

**C5 · First-run walkthrough and better empty states** — *(S–M)*. Three or four coach marks
pointing at the rail, the lens chips and the notes gate; richer empty states everywhere
("this lab grades behaviour — open stage 9 to see how").

**C6 · Theme refinement** — *(S)*. Follow-the-system option, a true high-contrast variant,
reduced-motion support, and a UI font-scale control — all cheap against the existing
`data-theme` + CSS-custom-property system.

### D · Data and resilience

**D1 · Explicit schema migrations** — *(M)*. Loaders currently fill missing fields ad hoc
(`if (!Array.isArray(...))`). A per-key schema version with named migrations (v1 → v2 → …) and
a rejection path for unknown future fields would make the format safe to evolve, and gives
the backup importer a real diff story.

**D2 · Storage panel** — *(S–M)*. Show per-key byte sizes (`navigator.storage.estimate()`
where available, string lengths as fallback), warn before the 5 MB quota instead of after, and
offer to prune old lab logs/tape entries.

**D3 · Multi-profile support** — *(M)*. A profile selector that namespaces the `ecroadmap.*`
keys (or swaps whole JSON blobs) so two learners can share one machine — the backup envelope
already contains everything a profile is.

### E · Engineering and quality

**E1 · Automated negative controls** — *(M)*. The project's best habit is proving each guard
fails on a patched copy, but it is manual. A `npm run mutcheck` that makes a scratch copy,
applies a table of known mutations (delete a `data-ok`, swap an answer, re-add the duplicate
`esc()`, unclamp a reserve), runs the relevant spec, and fails if the mutation *passes* would
institutionalise it.

**E2 · Built-artifact fingerprint in CI** — *(S)*. The size budget exists; also record a hash
and a size line per build so unintended changes (a CDN link returning, a fragment dropped,
size creeping) are visible in review even when all contracts pass.

**E3 · Tests for the guards themselves** — *(M)*. `validate_build.js` contracts and the Rust
backup commands (`.json` suffix, 20 MB cap, unknown lab keys) are load-bearing and untested.
A tiny fixture-driven spec for both would pin the failure messages users actually see.

**E4 · Public API contract file** — *(S)*. A checked list (or a hand-written `.d.ts`) of the
`window.EmbeddedCRoadmap` surface, with a spec asserting every documented key exists and every
existing key is documented — the lint currently checks duplicates, not coverage.

**E5 · Rust format gate** — *(S)*. `cargo fmt --check` in CI alongside clippy.

**E6 · Boot smoke test** — *(M)*. Render the built HTML in a minimal DOM stub and assert the
roadmap builds N topics with no thrown error — catches a fragment that assembles but dies at
runtime, which syntax checks cannot.

### F · Accessibility

**F1 · Lab waveform alternatives** — *(M)*. The logic analyser and waveform cards are
visual-first; add a text/tabular mirror ("bit 4 at 1.2 ms: 1, ACK slot") so the scrubber's
story is available to screen readers, and give the drag handles (ARR line) keyboard controls.

**F2 · Automated a11y checks in specs** — *(M)*. A dependency-free pass that walks the built
HTML for the basics — every interactive element has an accessible name, `aria-live` regions
are not nested, `aria-pressed` matches state — the same way `validate_build.js` checks
contracts today.

---

## Suggested order

If the next session picks up one thread, this is the order with the best value per unit of
risk:

1. **A1 — the Protocol Lab behaviour tape.** The template is now proven
   ([periph_tape.spec.js](specs/periph_tape.spec.js)), the log call sites exist, and it makes
   the "drift" and "stale read" stages honest in exactly the way stage 9 was made honest.
2. **B2 + B1 — goal chips and resume.** Both are small and read data that already exists;
   together they make the dashboard and the rail feel like the app remembers you.
3. **A6 — the review queue.** It turns 163 dormant question/answer pairs into a daily habit,
   and pairs with B5's streak to give the heatmap a reason to exist.
4. ~~**A2 — CAN.**~~ **Done.** The next content bet in this direction is **A1** (grade the
   new CAN/I²C stages on behaviour over time, now that `prLog` has arbitration, stuffing, ACK
   and stretch events with sim-clock stamps to predicate over).
5. **E1 — automated negative controls.** Everything above is cheaper to trust once each new
   guard can be proven to fail on demand.

## Constraints any candidate must respect

- Vanilla ES5-in-IIFE JavaScript, one `<style>` block, **zero runtime dependencies**.
- No free-form editing where a wrong snippet could mislead — presets are fixed and correct.
- A graded question declares its answer as `data-ok`, and `validate_build.js` fails without it.
- New behaviour that decides what the app *teaches* is expected to arrive with a spec that
  pins it, and preferably a negative control proving the spec bites.
- The app stays offline: no network at runtime, no CDN, nothing fetched at boot.
