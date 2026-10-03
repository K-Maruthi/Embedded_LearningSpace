# Embedded Learning Space — product & technical overview

*A complete picture of what this platform is, what it teaches, how it teaches it, how it is
built, how it is verified, and where it is honestly still short.*

Version **1.0.0** · desktop app (Tauri) · one 1,215 KB HTML document · fully offline ·
**163 curriculum topics** · **4 interactive labs** · **19 spec files / 1,143 automated checks**.

---

## 1. What this is

Embedded Learning Space is a **self-contained interactive curriculum for embedded systems
engineering** — the kind a working firmware engineer wishes existed when they were promoted into
the role and realised they knew C but not *embedded* C.

Almost every embedded course teaches one of three things: the C language, the datasheet, or the
toolchain. This one teaches **the connection between them**, and it insists that every claim be
demonstrated rather than asserted. When the curriculum says a write-1-to-clear register, you do not
read that sentence — you click the bit, and the model, the emitted C, and the log all agree. When
it says a handler that overruns its period starves the hardware beneath it, you configure the
timer, watch the tape, and the behaviour gate **fails you**.

That is the product thesis in one line: **an embedded course where the learner can be wrong, and
the software is the one telling them so.**

### The three properties that make it different

| | Most courses | This one |
|---|---|---|
| **Claim → evidence** | Prose asserts a fact | A spec proves the model obeys it; a negative control proves the spec would notice if it stopped |
| **Registers are interactive** | A screenshot of a register bank | You click bits. Writes are gated by clock enables. Read-only fields read 0. Write-1-to-clear routes through the right register. |
| **Timing is simulated, not asserted** | "Interrupts add latency" | A 1 kHz model clock, a measured event tape, a real deadline calculation, a verdict that names which claim broke |

---

## 2. The problem it solves

The gap is not information — it is **verification**. A learner can read a perfect explanation of
read-modify-write races and still ship the bug, because nothing ever told them their code was
wrong. The industry's answer is a debugger, a board, and an afternoon.

Embedded Learning Space moves the feedback loop into the artefact itself:

- **No board required.** Every peripheral is modelled at the register level, so the consequences of
  a register write are visible on screen immediately.
- **No wrong examples shipped.** The labs deliberately refuse free-form code editing in the
  teaching programs — a fixed, correct CMSIS-idiom program is stepped line by line, because a
  snippet that is subtly wrong teaches the wrong thing. (The linker sandbox *does* accept free
  input, because it is a sandbox with a validated model behind it.)
- **No "it works on my machine".** 1,143 automated assertions run against the actual model code,
  including negative controls that deliberately break the model to prove the test bites.

---

## 3. Who it is for

| Audience | What they get |
|---|---|
| **Embedded juniors** (0–2 yrs) | The missing mental model: why `volatile` exists, what `.data` costs at boot, why an ISR that overruns its period starves the timer below it |
| **C developers new to bare metal** | A guided path from "I know the language" to "I can bring up a board" |
| **Interviewing candidates** | 25 pre-authored interview questions wired to the topics that answer them, so preparation is *retrieval practice*, not re-reading |
| **Teachers / training leads** | A self-contained offline artefact — no lab booking, no per-seat licence, no network dependency in a classroom |
| **Reviewers and auditors** | A traceable engineering record: `features.md`, `problems.md` (30 catalogued defects, 22 fixed), `improvements.md`, `todo.md`, `ongoing.md` |

---

## 4. The product surface — nine views

Everything is reachable from one fixed left rail. No hidden navigation, no routing surprises.

| View | What it does |
|---|---|
| **Read** | The roadmap: 7 stages, 163 topics, a prerequisite DAG, per-topic approach notes, inline visualisations, and rich notes |
| **Graph** | An interactive concept map — rotate, filter by kind/mode, click a node to see its neighbourhood and why it connects |
| **Compile** | The compilation path: preprocessor → compiler → assembler → linker → ELF, stepped instruction by instruction |
| **Labs → Linker** | A drag-and-place linker sandbox: place sections into Flash/RAM, read the map, watch `.data` copy and `.bss` zero at boot |
| **Labs → Peripherals** | 10 stages on GPIO, timers, NVIC and interrupts, with a clickable register bank and a graded bring-up challenge |
| **Labs → Protocols** | 12 stages across 5 families (Basics, UART, I²C, SPI, CAN) with scrubbable waveform captures |
| **Practice** | Interview questions, fault triage, a bit/shift/endian workbench, a fault-register decoder, and mock rounds |
| **Progress** | The dashboard: topics mastered, clusters covered, writing streak, per-stage heatmap |
| **Mosaic** | The whole roadmap as a dense coverage matrix |

Plus, everywhere: **notes** (Markdown editor with sanitisation), **goals**, **bookmarks**,
**progress tracking**, and **JSON export/import** of the entire workspace through native OS
dialogs.

---

## 5. The curriculum — 7 stages, 163 topics

The roadmap is a directed acyclic graph of prerequisites, not a list. A topic unlocks when its
dependencies are met, so the learner cannot skip the mental model and land in a stage that assumes
it.

| Stage | Title | Topics | What it establishes |
|---|---|---|---|
| **0** | Machine foundations | 17 | Bits become values, values become addresses, addresses reach memory and peripherals. Build the Cortex-M model first |
| **1** | From source to silicon | 13 | The toolchain end to end: preprocessing, compilation, assembly, linking, ELF, startup code |
| **2** | The C language, taken apart | 30 | Types, storage duration, pointers, arrays, strings, structs, the stack frame — with layout and alignment reasoning |
| **3** | Where C stops being obvious | 23 | Undefined and implementation-defined behaviour, integer promotion, aliasing, optimisation, the atomics that C does *not* give you |
| **4** | Embedded peripherals, interrupts & real-time execution | 22 | GPIO, timers, PWM, NVIC, DMA, interrupts, concurrency, critical sections, volatile, barriers |
| **5** | RTOS, drivers, diagnostics & reliability | 26 | Scheduling, synchronisation, driver architecture, state machines, diagnostics, watchdog, functional safety |
| **6** | Production, platforms & system case studies | 32 | Build systems, testing strategy, low power, security, bootloader/update, performance, and case studies |

### Coverage domains (by topic tag)

`c-core` (30) · `memory` (22) · `advanced` (20) · `toolchain` (18) · `foundation` (17) ·
`hardware` (10) · `design` (10) · `numbers` (9) · `concurrency` (7) · `linker` (6) ·
`safety` (5) · `arm` (4) · `bits` · `startup` · `debug` · `compiler` · `atomic` ·
`faults` · `mpu`

### What each topic actually contains

Every topic carries more than prose:

- **A `kick`** — the question the topic answers ("Why do an 8-bit and a 32-bit MCU disagree about
  what one instruction can touch?")
- **An approach note** — how to actually study it, not just what it is
- **An inline visual** — bit diagrams, memory maps, GPIO electrical models, float field layouts,
  clock trees, DMA data-flow
- **Relationship edges** — prerequisites *and* the "same bug in a different costume" clusters
- **Interview coverage** — which of the 25 interview questions this topic answers
- **Learned state** — progress, bookmark, and a personal note

---

## 6. The four labs

### 6.1 Compilation Path Lab

Teaches *how a program becomes an image*. Stages walk the pipeline — preprocessor, compiler,
assembler, linker — and the learner **steps through actual instructions**: the copy-loop assembly
for `x = a + b` is shown with the register panel updating per instruction, and the previously
selected line is styled distinctly from the active one (a defect found and fixed in the spec suite,
`lab_compile`).

It includes graded "teach it back" checks: put *C source → preprocessed → assembly → object →
linked image → ELF* in causal order, and the app tells you which link you broke.

### 6.2 Linker & Startup Sandbox

The most tactile lab. The learner **places sections** into Flash and RAM regions and watches the
consequences:

- Drag `.data` into RAM → the map updates → the boot timeline grows a **ROM→RAM copy**
- Drag it into Flash → the startup code loses a step, and the app says why
- `.bss` in RAM → a zeroing loop appears at boot
- Over-reserve the stack or heap → the sandbox **rejects it** (a negative reserve was a real
  catalogued defect, `P8`, caught by the spec suite)

Then **Reset Sequence**: a single-stepped trace through vector table → `.data` copy → `.bss` clear →
`main()`, with the pseudocode guarded by a drift spec so the prose and the assembly can never
disagree again (`P18`).

**Disassembly Reader** — select a symbol, read its real ARM assembly, with the linked region
highlighted.

### 6.3 Peripherals Lab — 10 stages

The register bank is **clickable**. Each bit knows its own register, its own peripheral, its own
writable-ness, and what a write *means*.

| Stage | Teaches |
|---|---|
| 1–2 | The mental model; bits, macros, and why `1u << pin` |
| 3 | GPIO output — including a **PUPDR** card, so a floating pad is a thing you can *fix*, not just read about |
| 4 | Input & polling |
| 5 | The timer as a divider — a real time base, a real compare channel |
| 6 | Three switches — NVIC enable, priority, **and a real `ICER0` path** |
| 7 | Priority & nesting |
| 8 | The read-modify-write race — with a **write-only `BSRR` card** as the fix |
| 9 | The bring-up challenge — graded |
| 10 | Playground — free configuration |

Four semantics fixes came out of auditing this lab and are worth calling out, because they are the
difference between a *model* and a *toy*:

- **`ISER0` is write-1-to-set.** Zero-writes are ignored, masked to the modelled lines. Clearing
  goes through `ICER0`, which reads 0 because it is write-only. (`P15`)
- **`PUPDR` is reachable** — click a bit, watch the pin cell follow. (`P16`)
- **`BSRR` is in the bank**, write-only, its halves emitting atomic set/clear writes. (`P17`)
- **The handler cost is a measured quantity**, and a saturated ISR **fails** the behaviour gate
  even when its cadence looks perfect. (`P20`, `P21`)

The bring-up challenge is graded by an **event tape**, not a register snapshot: cadence regularity,
freshness, *and* whether the measured period matches the rate you asked for. Regular-but-late fails,
and the verdict names which claim broke.

### 6.4 Protocol Lab — 12 stages, 5 families

Every stage is a **finished capture you can scrub**, not a live toy.

| Family | Stages |
|---|---|
| **Basics** | Signals 101 · The protocol map |
| **UART** | The frame · Sampling & baud · Terminal |
| **I²C** | The shared wire · Address + ACK · **Clock stretching** |
| **SPI** | Four modes · The shift ring |
| **CAN** | **Dominant wins** (arbitration) · **The frame** |

The physics is modelled, not drawn:

- **Arbitration is real.** Two nodes transmit; the bus is a wired-AND; whoever wants a 1 and reads
  0 loses, and the log names the node, the ID, and **the bit position** where it lost.
- **Bit stuffing is real.** After five identical bits an opposite bit is inserted — and the
  waveform shows the stuffed bits distinguished from the payload.
- **The CRC is real.** CRC-15, poly `0x4599`, computed over SOF..DATA stopping at the delimiter,
  and the rendered frame carries the value the model computed.
- **Clock stretching is real.** A slave holds SCL low, the master's slot is inserted at the right
  index, and the readout says *"master waits · still bit 8."*
- **ACK is real.** A non-responding node leaves the ACK slot recessive, and the frame says so.

Three of these stages were added because a **render spec** caught genuine bugs in the earlier ones
— an I²C address byte drawn off by one with the R/W bit always reading 0 (`P12`), a scrubber
"back to live" button that could never appear (`P13`), and a bare `undefined` printed into the
protocol map (`P14`). That is the test suite working.

---

## 7. Cross-cutting tracks

These are what turn a curriculum into preparation.

- **Interview practice** — 25 questions, each wired to the topics that answer it, with a
  self-check free-text box and mock rounds with timed feedback.
- **Fault triage** — 10 realistic faults presented as *symptoms only*. The learner must name the
  evidence they need and isolate the fault. (Stack overflow, heap corruption, wrong clock, wrong
  linker placement, UART garbage, I²C NACK, SPI wrong mode, CAN bus-off, timing jitter, missed
  interrupt.)
- **Failure clusters** — 5 "same bug, different costume" groupings that cut across the stage
  boundaries, because in practice that is how bugs arrive.
- **Comparative diffs** — 7 side-by-side state comparisons.
- **Concept graph** — an interactive map with kind/mode filters, reheat, and a details panel. Node
  focus is styled so a *selected* node is visually distinct from the *active* one.
- **Notes & journal** — a Markdown editor per topic with HTML sanitisation and URL scheme
  validation, a saved-state live region, and full export/import.
- **Goals, bookmarks, progress** — per-stage completion, a dashboard heatmap, and a writing streak
  that makes consistency visible.

---

## 8. Architecture & engineering

### The build pipeline

```
roadmap-source/            the real source — 25 fragments
  01_head.html               one <style> + the rail/shell markup
  02_body.html               all view markup
  10…15, 1b_*.js             data (topics, metadata, interview, faults, clusters, diffs)
  20_app.js … 25_api.js      the app IIFE (split for maintainability; assembled before checking)
  40_graph.js                the concept-graph IIFE
        │  build.js
        ▼
embedded-c-roadmap.html   →  src/index.html   (+ src/fonts/)
        │  validate_build.js
        ▼
   one document, 1,215 KB / 1,500 KB budget
```

The built file **is** the product. No bundler, no framework, no runtime dependency, no network.

### The Tauri / Rust layer — 819 lines

Seven IPC commands, all narrow and all justified:

| Command | Why it needs to be native |
|---|---|
| `toolchain_status` | Probe for a real ARM toolchain on disk |
| `pipeline_sources` | Package the learner's sources for a compile |
| `pipeline_run` | Actually invoke the cross-compiler and return a real report |
| `backup_save_dialog` / `backup_open_dialog` | Native OS file dialogs — the browser fallback is kept, but native is the default |
| `backup_write` / `backup_read` | Read and write the workspace JSON outside the web sandbox |

Dependencies are deliberately minimal: `serde`, `serde_json`, `tempfile`, `tauri` 2,
`tauri-plugin-dialog`. **The app works fully without them** — every command has a browser fallback,
so the HTML file is a complete product on its own.

### Offline and privacy

The content security policy restricts `connect-src` to `'self'` and the IPC scheme. There is **no
telemetry, no account, no network call**. All state is local (`localStorage`) and exportable as
JSON. Fonts are vendored `.woff2` — nothing is fetched from a CDN at runtime.

---

## 9. The quality discipline

This is the part that most separates the project from a content dump.

**19 spec files, 1,143 assertions, zero dependencies** — bare Node, no test framework. Each spec
slices its subject out of a fragment, stubs what it needs, and runs it in a `vm` context. Examples:

| Spec | Guards |
|---|---|
| `lab_compile` (44 checks) | The copy-loop steps, register panel completeness, active-vs-selected styling |
| `protocol_stages` (143 checks) | Every stage renders >900 chars, no `undefined`/`NaN` leaks, all goals callable, all map links resolve |
| `periph_regs` (99 checks) | Register semantics, emitted C, every stage renders headlessly |
| `startup_pseudocode` | The reset pseudocode and `startup.s` cannot drift apart |
| `linker_sandbox` (29) | The negative-reserve rejection |

**Negative controls are mandatory.** A test that cannot fail is not a test, so each behaviour guard
is proven to bite by mutating the source and confirming the suite fails:

| Mutation | Expected failure |
|---|---|
| CAN bus wired as OR instead of AND | 3 checks fail |
| Bit stuffing disabled | 2 fail |
| Wrong CRC polynomial | 1 fails |
| IDs compared LSB-first | 3 fail |
| ISER restored to a plain RW toggle | 8 fail |
| BSRR halves swapped | 4 fail |
| Startup pseudocode drift | guard fires |

**The build refuses to ship a lie.** `validate_build.js` fails on: unbalanced tags in either markup
fragment (an unclosed `<details>` in the rail would otherwise swallow the masthead while every other
check passed), a view referenced by JS with no markup behind it, a graded question with no answer
key, a hardcoded version string, a media query narrower than the content column allows, missing
shell element ids, missing graph hooks, or **exceeding the 1,500 KB budget**.

`scripts/lint.js` adds the guards a hand-written ES5 IIFE actually needs: a duplicate `var` across
the split fragments (which would silently shadow), any `console.*` (the app ships none on purpose),
`TODO`/`FIXME` left in the source, and raw tabs.

CI runs specs, lint, the version check, the build, `cargo test`, and
`cargo clippy --all-targets -- -D warnings`.

---

## 10. Accessibility & UX — the honest status

**Good, and verified by measurement:** a correct viewport meta and a skip link; a global 2px
`:focus-visible` ring with ~20 element-level rings on top; `aria-live="polite"` on seven regions
plus a dedicated saved-state mirror; correct `role="checkbox"` + `aria-checked` on 326 bookmark and
learned toggles; `lang="en"`; a global `prefers-reduced-motion` block; and **zero hardcoded hex
colours** in the entire contrast failure set.

**Open, catalogued honestly.** A full audit of all nine views against a 119-rule UI/UX and
accessibility catalog found **eight real defects**, all filed in
[`problems.md`](problems.md) as P23–P30 with severity, measured evidence and file:line
references:

| | Finding | Severity |
|---|---|---|
| P23 | `--ink-3` fails WCAG AA on every surface, in **both** themes (2.76:1–4.48:1) | Critical |
| P24 | 131 labels rendered but not programmatically associated; 8 controls unlabelled | Critical |
| P25 | `prefers-reduced-motion` only silences CSS — all lab animation is JS-driven | Critical |
| P26 | Focus ring removed outright on two controls with nothing replacing it | High |
| P27 | Register bit labels render at **7.5px** | High |
| P28 | Three sticky elements, zero `scroll-padding` — focus can scroll under the header | High |
| P29 | A wrong graded answer is signalled by red alone | High |
| P30 | 326 tab stops in the roadmap view | Medium |

Two candidate findings were **discarded as false positives** after measuring — a phantom
invisible-text pair (0×0 elements, and the hex appears nowhere in the stylesheet) and 326
sub-24px targets that looked like a hard WCAG 2.5.8 failure but **pass** via the spacing exception
(measured 31px within a row, 81px between bookmarks, against 24px required). That is why the audit
measured instead of eyeballing.

These are open, not fixed — and none has a spec yet, which is the next thing to build.

---

## 11. Measured facts

| | |
|---|---|
| Curriculum | 163 topics · 7 stages · 19 coverage tags |
| Labs | 4 · 10 + 12 + 9 + graded-challenge stages |
| Protocol coverage | UART · I²C (incl. clock stretching) · SPI (4 modes) · CAN (arbitration, stuffing, CRC, ACK) |
| Specs | 19 files · **1,143 assertions** · zero dependencies |
| Build output | **1,215 KB** of a 1,500 KB budget |
| Rust backend | 819 lines · 7 IPC commands |
| Runtime deps | **none** in the browser · 5 crates in the shell |
| Network | **none at runtime** |
| Defects catalogued | 30 (22 fixed, 8 open) |
| Agent skills | 7, project-local, decision support only |

---

## 12. What it deliberately does *not* do

Stating this is part of the pitch, because a course that pretends to be complete is lying:

- **No free-form code editing in the teaching programs.** A fixed, correct CMSIS-idiom program is
  stepped, because a snippet that is subtly wrong teaches the wrong thing.
- **No invented "hardware."** The model is a Cortex-M-shaped abstraction with a stated 1 kHz time
  base. It does not pretend to model a real crystal, real parasitics, or real silicon.
- **No account, no sync, no telemetry.** Workspace state is local and exportable.
- **No live compilation required.** The compile pipeline runs against a real toolchain when one is
  present, and degrades to a faithful model when it is not.

---

## 13. Benchmark position

Measured against an independent 0→100% embedded curriculum benchmark
([`Embedded0_100_vs_Current_Project.md`](Embedded0_100_vs_Current_Project.md)), across 66 levels and
five dimensions per topic (content, visual, animation, interaction, mastery):

**✅ 17 fully covered · 🟡 24 partial · 🔴 9 missing · 🧩 2 infrastructure-ready**

Strongest: **embedded C depth** (~49 topics, lens-complete, quizzed), the **linker script**
sandbox, **concurrency and the RMW race**, the **hardware/software boundary**, and the
**engineering harness** — specs, negative controls, offline operation and backup all exceed the
benchmark's own engineering checklist.

Genuinely missing: **ADC/DAC**, **DMA**, **RTOS** (three levels), **power management**,
**security**, **unknown-board bring-up**, **datasheet drills**, **capstone projects**, and
**advanced comms**.

Notably, the benchmark's independent priority list and this project's own build order in
[`features.md`](features.md) agree almost one-for-one on the first five items — two independent
analyses converging on the same roadmap.

---

## 14. Roadmap

Sequenced by leverage, not by novelty:

1. **Real time base and handler cost** — make deadline behaviour measurable end to end
2. **SysTick, then EXTI with debounce** — the core's own tick, then pin interrupts
3. **A real PWM/compare channel** — `CCMR`/`CCER`/`CC1IF` plus AF pin ownership and a pin trace
4. **Register-semantics accuracy** — *(largely delivered: P15–P17)*
5. **DMA → ADC → low power / watchdog / RTC wake**
6. **Faults + vector table, a debugger loop, and a shared timing instrument**

Plus the cross-cutting **Trace Mode** — a unified stepper correlating C statement → register →
signal → frame — whose two halves (the periph lab's code panel and the protocol scrubber) already
exist and want to be joined.

And the near-term engineering item: **an accessibility spec** so P23–P30 cannot regress.

---

## 15. Running it

```bash
npm install
npm run build:roadmap   # build + validate (1,215 / 1,500 KB)
npm test                # 19 spec files, 1,143 assertions
npm run lint            # duplicate declarations, console, TODO, tabs
npm run dev             # the Tauri desktop app
```

Or open `roadmap-source/embedded-c-roadmap.html` directly in a browser — the entire product,
offline, with the Rust layer's browser fallbacks.

---

## Further reading

| Document | What it holds |
|---|---|
| [`README.md`](README.md) | The short version: what it is, how to use it |
| [`architecture.md`](architecture.md) | File dependencies, the two IIFE scopes, storage namespace, IPC surface, change recipes |
| [`features.md`](features.md) | Full feature inventory and the build order |
| [`problems.md`](problems.md) | 30 catalogued defects — 22 fixed with negative controls, 8 open |
| [`improvements.md`](improvements.md) | Every improvement executed, in order, with its verification |
| [`todo.md`](todo.md) | The original checklist and what remains |
| [`ongoing.md`](ongoing.md) | The latest session handoff |
| [`Embedded0_100_vs_Current_Project.md`](Embedded0_100_vs_Current_Project.md) | The independent benchmark audit |
