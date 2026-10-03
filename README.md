# Embedded Learning Space

A desktop app for learning **Embedded C the way the machine actually runs it** — from
what a bit is, through compilation, linking and startup on a Cortex-M, out to how
peripherals and serial protocols behave on real silicon.

It is a self-contained, **offline** single-page app wrapped in [Tauri 2](https://tauri.app/)
(Rust). No server, no CDN, no framework, no build step at runtime: the whole frontend is one
HTML file assembled from source fragments and loaded locally, and the Rust side exists only
for native save/open dialogs, toolchain detection and the optional real-compiler bench.

---

## The goal

Most C tutorials stop at syntax. This project keeps asking the questions that matter on
hardware, and answers each one with a **live model you can poke**, not just prose:

- what the idea *is*,
- what the **compiler** and **linker** do with it,
- where it **sits in memory**,
- what happens at **run time** on the CPU,
- what the **hardware** actually sees, and
- how it **bites you** on real silicon.

Every topic is taught through the same eight lenses, so you can read one topic end to end
or read a single lens (say "in memory") across the whole roadmap. Interactive labs are
deliberately built on a small, honest model that states its own simplifications — and,
where a correct answer matters, you get **fixed, correct presets instead of a free-form
editor** so the tool never teaches a wrong idiom.

---

## What you get today

Navigation lives in a fixed left rail, grouped into four sections — Read, Labs,
Practice, Progress. Each section expands on click and shows how much it holds while
collapsed; the thin bar above the content names the section and view you are in.

### Learn
- **Roadmap** — 7 stages, 163 topics, 8 cross-cutting lenses, live search, per-topic
  markdown notes, and a "mark as learned" gate that needs real notes before it unlocks
  (active-recall pedagogy).
- **Dashboard** — learned counts, per-stage progress, a last-30-days activity heatmap,
  prerequisite-aware "what to read next", a graded row for each of the four labs, one
  list of everything you wrote in your own words (topic notes *and* lab stage journals)
  with a jump back to the exact stage, and clipboard export of notes/journals/progress.
- **Mosaic** — one puzzle piece per topic that lifts to reveal a chip-die floorplan.
- **Graph** — a custom force-directed concept graph (prerequisites, failure patterns,
  related topics, and text mentions) with layouts, edge toggles and deep links back to the
  roadmap.

### Labs
Every lab stage carries a **stage journal** — the same markdown box a topic's notes use,
placed under the stage so you can write down what that stage actually showed you. Journals
count toward the Dashboard's "words written", list alongside your topic notes, and ride in
the same backup file as the rest of your lab progress.
- **Compilation Path** — an 8-stage walkthrough (source → preprocess → compile → assemble
  → object → link → image → check). With an ARM toolchain installed it runs the **real**
  `arm-none-eabi-gcc` and shows genuine per-stage output; otherwise it falls back to a
  teaching model. A bench mode lets you edit `main.c` / `startup.s` / `linker.ld` in fixed
  slots and build them for real — the **same eight stage tabs** then show your build's
  artifacts and observations (provenance labelled, per-stage ✓/✕ marks on the rail), and a
  failed build lands on the first stage that stopped.
- **Linker & Startup** — an interactive Cortex-M4 memory map: rule-by-rule linker-script
  inspector, section placement, startup flow, a **sandbox** where you drag sections between
  FLASH/RAM and watch VMA/LMA, usage bars and failure diagnostics update live, and a final
  **reading a `.s`** stage that classifies `startup.s`'s 58 lines by kind (only some are
  instructions), takes four real instruction lines apart field by field, and explains Thumb-2 —
  the `.thumb` on line 6 the curriculum had asserted without ever explaining.
- **Peripherals** — a 10-stage curriculum on a live Cortex-M4 model: clock-gated register
  writes, GPIO MODER/ODR/IDR, a timer as a frequency divider, the interrupt chain
  (DIER × ISER × PRIMASK), priority nesting with a swim-lane timeline, the read-modify-write
  race, and a graded bring-up challenge. The bring-up stage is graded on **behaviour over
  time**, not only register state: a bounded event tape records every handler entry/exit,
  ISR-driven pin write and lost update, and a visible *Behaviour tape* card shows the same
  cadence and freshness statistics the grader uses — a handler that fired once and stopped
  cannot pass by leaving the right bits set. It also grades **the deadline**: the period the
  timer generates against the time one handler holds the CPU (400 ms in this model, labelled
  as a model device rather than a hardware figure). Regular but late fails, so configure a
  rate the handler cannot meet and the card says so; the timer row shows the live deadline
  (`period N ms vs 400 ms handler — x % CPU`, green or red). A "Your code" panel
  reverse-engineers every click into the canonical C statement
  (e.g. `RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;`).
- **Protocols** *(newest)* — 12 stages grouped into five families
  (**Basics / UART / I²C / SPI / CAN**) with a stage tab under each, all built on one shared
  logic-analyser instrument:
  - **Basics · Signals 101** — push-pull vs open-drain vs input × pull-up/pull-down resolving
    to a real level, including the dreaded **floating** line, plus a **wired-AND** bus rig —
    the physics every protocol is built on.
  - **Basics · Protocol map** — the seven questions every serial protocol answers (idle
    level, framing, sample instant, bit order, addressing, acknowledgement, clock domain),
    with each comparison cell linking to the stage where you can make it fail.
  - **UART** — a byte becoming `[Start][D0..D7 LSB-first][Parity?][Stop]` on the TX wire; a
    baud-error slider that drifts the receiver's sample points until they cross a bit
    boundary; a terminal that frames what you type, with a live `BRR` readout.
  - **I²C** — two masters fighting a wired-AND (the loser drops out mid-byte and you watch
    it happen), then addressing: `0x50 << 1 | R/W`, ACK on the 9th clock, NACK from an empty
    slot, and a repeated-start register read; then **clock stretching**, where the slave holds
    SCL low and the master's bit counter visibly freezes.
  - **SPI** — CPOL/CPHA as one 2-bit number: mismatch the modes and the byte arrives shifted
    by one window; then the shift ring, where a read is always one transaction behind and
    every driver has to write a byte it does not care about.
  - **CAN** — a differential pair with its terminators, **arbitration by ID** (0 is dominant, so
    the lower ID wins and the loser drops out non-destructively at that exact bit), then a whole
    frame drawn field by field: a real CRC-15, **bit stuffing** with every inserted bit
    highlighted, and an **ACK slot** that only goes dominant if somebody actually heard it.

### Practice
- **Interview prep** (25 questions across tracks/levels/formats, rubrics, timed mock
  rounds), **Memory-map lab** (type a declaration → see where it lands), **Fault triage**
  (register-dump scenarios), and **C tools** (integer/bit/endianness/struct-layout models
  and a register bit decoder, plus toolchain-verified compiler diffs).

---

## How to use it

### Run the desktop app (development)

```bat
npm install
npm run dev         :: launches Tauri with hot reload
```

> Requires the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) on Windows
> (Microsoft Visual Studio C++ Build Tools, WebView2, and Rust).

### Build an installer

```bat
npm run build
```

Installers (NSIS `.exe` and MSI) land under `src-tauri/target/release/bundle/`.

### Rebuild the frontend after editing sources

The app serves `src/index.html`, which is **generated** from the fragments in
`roadmap-source/`. After changing any fragment (or adding a view), run:

```bat
npm run build:roadmap
```

This validates the fragments (JavaScript syntax, exactly one `<style>` block, every view
reachable from the rail and every rail button pointing at a real view, graph hooks, every
lab journal host, every graded question's declared answer key, version single-sourcing, and
a 1500 KB budget for the single-file build), substitutes the app version from `package.json`
for the `__APP_VERSION__` token, concatenates them into
`roadmap-source/embedded-c-roadmap.html`, and copies the result to `src/index.html`. Keep the
fragments — not the generated HTML — as the place you edit.

Before committing, the checks CI runs are `npm test`, `npm run lint`,
`node scripts/sync-version.js --check` and `npm run build:roadmap`, plus `cargo test` and
`cargo clippy --all-targets -- -D warnings` inside `src-tauri/`.

Behaviour that is easy to break quietly is covered by dependency-free specs under `specs/`,
run with `npm test`. They slice the code out of the fragments and exercise it over stubs,
so there is no browser, no test framework and nothing to install. Besides the shell
(markdown safety, backup round-trip, notes, rail, dashboard, journals) they cover the
**lab models themselves** — the linker-sandbox placement maths and its generated script,
the protocol level/wired-AND/UART-sampling model plus CAN arbitration/CRC/stuffing and I²C
stretching, every protocol stage rendered headlessly, the peripheral timer rate model and its
behaviour tape, the compilation-path report split and real-output parsers, the graded answer
keys, and the shared `hl()` highlighter and `shuffle()`.
Several of those are *drift guards*: they recompute the numbers the labs state in prose (the graded Hz
bands, a preset's PSC/ARR, `_estack`) from the models that compute them, so editing one
without the other fails the suite instead of shipping a contradiction.

### Optional: real ARM compilation

To make the Compilation Path lab invoke a genuine toolchain, install an **Arm GNU
Toolchain** (`arm-none-eabi-gcc`) and make it discoverable via `PATH` or a known install
root. Without it the lab still works, just as a teaching model.

---

## Data & privacy

Everything stays **local to the desktop app**. Progress, notes, bookmarks, journals and walk
marks, quiz/practice state, every lab's model state and the theme live in the WebView's
`localStorage` under the `ecroadmap.*` namespace. The **Export / Import** controls produce a
single versioned JSON file (schema 2) covering the complete learning state — roadmap,
practice and every lab key — so you can back up or move your data by hand; in the desktop
app the path is chosen through a native dialog, with a download/hidden-input fallback for
the standalone HTML. There is no network traffic and no account.

---

## Project layout

```
src/index.html      generated single-file app served by Tauri (do not hand-edit)
src-tauri/          Rust backend + Tauri config (window, capabilities, bundling,
                    toolchain-detection and compile pipeline IPC commands)
roadmap-source/     the real source: HTML/JS fragments, build.js, validate_build.js
scripts/            lint.js and sync-version.js, zero-dependency like the specs
specs/              dependency-free behaviour specs, run with npm test
.claude/skills/     project-local agent skills (UI/UX + design-system decision support)
```

Start with [architecture.md](architecture.md) if you want to know **how the files
depend on each other** — the fragment→build→Tauri pipeline, the two IIFE scopes,
the storage namespace, the Rust IPC surface, and a change-recipe table listing
every file a given edit touches.

Project history and planning live in [features.md](features.md) (what ships and what comes
next), [problems.md](problems.md) (the defect audit), [improvements.md](improvements.md)
(the executed improvements), [todo.md](todo.md) (the original checklist) and
[ongoing.md](ongoing.md) (the latest session handoff).

## Agent skills

[`.claude/skills/`](.claude/skills/README.md) holds seven **project-local** agent skills
(~1.1 MB, committed, nothing global) that help with UI/UX and design decisions instead of
guessing them per session. They are decision support only — nothing there runs at build time or
is part of `npm test`.

Start with **`roadmap-design-system`**, which encodes this app's actual token set, the
212px-rail breakpoint arithmetic, the constraints `validate_build.js` and `lint.js` enforce, the
naming prefixes, and the verification loop. `ui-ux-pro-max` adds a searchable catalog (styles,
palettes, type pairings, 119 UX/accessibility rules, motion, charts) via a pure-stdlib Python
search tool; it is installed trimmed, with the removals recorded in its own `TRIMMED.md`.

## Constraints worth knowing

- Vanilla ES5-in-IIFE JavaScript, one `<style>` block, zero runtime dependencies.
- No free-form editing where a wrong snippet could mislead; presets are fixed and correct.
- A graded question declares its answer in the markup (`data-ok`); no handler assumes the
  first option is right, and `validate_build.js` fails if a question has no key.
- One version string, generated: the rail's `rev …` comes from `package.json` at build
  time, so it cannot drift from the release.
- Behaviour that decides what the app *teaches* ships with a zero-dependency spec under
  `specs/`, and preferably a negative control proving the spec bites.
- Generated code follows the CMSIS/vendor-macro idiom (`GPIOA->OTYPER |= (1u << pin);`,
  `USART1->BRR = ...`) so what you copy out matches what you'd actually ship.

---

## Future work in progress

The Protocol Lab is the current frontier — five families (Basics / UART / I²C / SPI / CAN)
and twelve stages are live, each with a scrubber over a finished capture. **Behaviour grading**
shipped for the peripherals bring-up challenge (an event tape graded on cadence and
freshness, not just a register snapshot); the protocol lab is the next host for it, now that
its arbitration, stuffing, ACK and stretch events all carry sim-clock stamps. Next up:

- **Protocols** — a second I²C slave so address decoding decides who ACKs, SPI burst/DMA modes
  and real device command sequences (a flash read: command, address, dummy, data), CAN error
  frames and bus-off recovery, and one display interface as a case study; an ADC / DMA / RTOS
  view. (Time-travel scrubbing of the logic-analyser capture is done — the stage scrubber walks
  a finished transfer a bit at a time.)
- **Volatile "break-it" demo** — compile the same polling loop `-O0` vs `-O2` in the bench
  and show the cached-in-register disassembly from the real compiler.
- **Protocol Lab behaviour tape** — the same treatment the Peripherals tab now uses:
  grade "the byte decoded survived ±3 % baud drift" and "this read is fresh, not the
  previous transaction" over observed events, with the peripherals tape
  (`specs/periph_tape.spec.js`) as the template.
- **Learning loop** — a spaced-repetition review queue built on the existing `cards()`
  API, resume-where-you-left-off, and per-stage goal chips on the Dashboard.
- **Tooling hardening** — done since this list was first written: native save/open dialogs,
  an in-repo `cargo clippy --all-targets -- -D warnings` gate, and a built-HTML size budget
  in `validate_build.js` (1500 KB; currently ~1215 KB). The next engineering items
  (automated negative controls, an artifact fingerprint, tests for the build contracts
  themselves) are catalogued in [features.md](features.md).

Recent hardening (see `problems.md` / `improvements.md`): the CSP and vendored fonts, a
single generated version string, a correct multi-language `hl()` highlighter, a seeded
uniform `shuffle()`, a non-blocking `notice()` in place of `window.alert`, accessibility
part 2 (skip-link, dashboard counter announcements, concept-graph keyboard traversal),
**behaviour grading** for the peripherals bring-up challenge, deadline grading on top of it,
the linker lab's `startup.s` reader's guide, and new spec files over the lab models (19
total). A verified stage goal also no longer loses its confirmation to the re-render that
follows it (`problems.md` P10); the peripherals register bank now teaches truthful access
semantics — ISER write-1-to-set with a write-only ICER partner, the write-only atomic BSRR,
a clickable PUPDR and a real CCR row (`problems.md` P15–P17); and the peripherals time base,
handler cost and deadline are honest (`problems.md` P19–P22).

---

*Version 1.x — see `roadmap-source/README.md` for the fragment build notes.*
