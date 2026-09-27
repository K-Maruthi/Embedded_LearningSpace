# Embedded Learning Space

A desktop app for learning **Embedded C the way the machine actually runs it** — from
what a bit is, through compilation, linking and startup on a Cortex-M, out to how
peripherals and serial protocols behave on real silicon.

It is a self-contained, **offline** single-page app wrapped in [Tauri 2](https://tauri.app/)
(Rust). No backend, no CDN, no framework, no build step at runtime: the whole frontend is
one HTML file assembled from source fragments and loaded locally.

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

Navigation is grouped into three clusters in the top bar.

### Learn
- **Roadmap** — 7 stages, 163 topics, 8 cross-cutting lenses, live search, per-topic
  markdown notes, and a "mark as learned" gate that needs real notes before it unlocks
  (active-recall pedagogy).
- **Dashboard** — learned counts, per-stage progress, a last-30-days activity heatmap,
  prerequisite-aware "what to read next", and clipboard export of notes/progress.
- **Mosaic** — one puzzle piece per topic that lifts to reveal a chip-die floorplan.
- **Graph** — a custom force-directed concept graph (prerequisites, failure patterns,
  related topics) with layouts, edge toggles and deep links back to the roadmap.

### Labs
- **Compilation Path** — an 8-stage walkthrough (source → preprocess → compile → assemble
  → object → link → image → check). With an ARM toolchain installed it runs the **real**
  `arm-none-eabi-gcc` and shows genuine per-stage output; otherwise it falls back to a
  teaching model. A bench mode lets you edit `main.c` / `startup.s` / `linker.ld` in fixed
  slots and build them for real.
- **Linker & Startup** — an interactive Cortex-M4 memory map: rule-by-rule linker-script
  inspector, section placement, startup flow, and a **sandbox** where you drag sections
  between FLASH/RAM and watch VMA/LMA, usage bars and failure diagnostics update live.
- **Peripherals** — a 10-stage curriculum on a live Cortex-M4 model: clock-gated register
  writes, GPIO MODER/ODR/IDR, a timer as a frequency divider, the interrupt chain
  (DIER × ISER × PRIMASK), priority nesting with a swim-lane timeline, the read-modify-write
  race, and a graded bring-up challenge. A "Your code" panel reverse-engineers every click
  into the canonical C statement (e.g. `RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;`).
- **Protocols** *(newest)* — grouped into families (**Basics / UART / I²C / SPI**) with a
  stage tab under each, all built on one shared logic-analyser instrument:
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
    slot, and a repeated-start register read.
  - **SPI** — CPOL/CPHA as one 2-bit number: mismatch the modes and the byte arrives shifted
    by one window; then the shift ring, where a read is always one transaction behind and
    every driver has to write a byte it does not care about.

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

This validates the fragments (JavaScript syntax, exactly one `<style>` block, view targets,
graph hooks), concatenates them into `roadmap-source/embedded-c-roadmap.html`, and copies
the result to `src/index.html`. Keep the fragments — not the generated HTML — as the place
you edit.

### Optional: real ARM compilation

To make the Compilation Path lab invoke a genuine toolchain, install an **Arm GNU
Toolchain** (`arm-none-eabi-gcc`) and make it discoverable via `PATH` or a known install
root. Without it the lab still works, just as a teaching model.

---

## Data & privacy

Everything stays **local to the desktop app**. Progress, notes, bookmarks, quiz/practice
state, lab configurations and theme live in the WebView's `localStorage` under the
`ecroadmap.*` namespace. The **Export / Import** controls produce a single versioned JSON
file covering the complete learning state, so you can back up or move your data by hand.
There is no network traffic and no account.

---

## Project layout

```
src/index.html      generated single-file app served by Tauri (do not hand-edit)
src-tauri/          Rust backend + Tauri config (window, capabilities, bundling,
                    toolchain-detection and compile pipeline IPC commands)
roadmap-source/     the real source: HTML/JS fragments, build.js, validate_build.js
```

## Constraints worth knowing

- Vanilla ES5-in-IIFE JavaScript, one `<style>` block, zero runtime dependencies.
- No free-form editing where a wrong snippet could mislead; presets are fixed and correct.
- Generated code follows the CMSIS/vendor-macro idiom (`GPIOA->OTYPER |= (1u << pin);`,
  `USART1->BRR = ...`) so what you copy out matches what you'd actually ship.

---

## Future work in progress

The Protocol Lab is the current frontier — four families (Basics / UART / I²C / SPI) and
nine stages are live. Next up:

- **Protocols** — I²C clock stretching and multi-slave transfers, SPI burst/DMA modes and
  real device command sequences (a flash read: command, address, dummy, data), then
  **CAN** (bit stuffing, dominant/recessive on the same wired-AND idea) and one display
  interface as a case study; an ADC / DMA / RTOS view; time-travel scrubbing of the
  logic-analyser capture.
- **Volatile "break-it" demo** — compile the same polling loop `-O0` vs `-O2` in the bench
  and show the cached-in-register disassembly from the real compiler.
- **Event-stream grading** — challenge the labs on observed behaviour ("PA5 toggled at
  ~2 Hz with no busy-wait") rather than only register snapshots; surface stage-goal
  completion on the Dashboard.
- **Shell & tooling hardening** — CSP for rendered markdown, an automated native save
  dialog for export, and regression tests over the lab models.

---

*Version 1.x — see `roadmap-source/README.md` for the fragment build notes.*
