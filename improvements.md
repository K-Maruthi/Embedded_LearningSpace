# improvements.md — ranked opportunities (executed)

Companion to `problems.md`. That file lists *defects*; this one listed the *changes worth
making*, ordered by value per unit of risk. This pass worked through them top-down:
**I1–I11 are all done,** and four later passes added **I12** (the Protocol Lab expansion),
**I13** (the peripherals register-semantics pass), **I14** (the linker lab's reader's guide
to `startup.s`) and **I15** (the peripherals time base, handler cost and deadline grading).
Nothing already completed in `todo.md` is repeated — see
[Cross-check](#cross-check-with-todomd).

The theme that survived contact: the project's shell was well guarded, and **the lab
models — the code that decides what the app teaches — were not guarded at all**. So the
ranked #1 item was also the one that immediately paid for itself: writing the specs found a
real bug (a negative stack/heap reserve bending the sandbox's RAM total) and the quiz spec
found the wrong-answer bug in `problems.md` P1.

**In order:** I1 lab-model specs · I2 graded-question contract · I3 version single-sourcing ·
I4 accessibility part 2 · I5 notice banner · I6 highlighter · I7 seeded shuffle · I8 drift
guards · I9 public-API lint · I10 repo/doc hygiene · I11 behaviour grading · I12 protocol
expansion · I13 register-semantics pass · I14 reading a `.s` · I15 deadline grading.

---

## I1 · 🔴 Regression specs over the lab models — **DONE**

**Was:** the specs covered the shell (markdown safety, backup, notes, dashboard, rail,
journals) and **nothing** covered the models the labs teach with.

**Now:** a dozen new zero-dependency specs, all slicing their subject out of the fragment and
running it over stubs, exactly like the existing ones (the first five below landed with I1;
`periph_tape.spec.js` arrived with I11, `lab_compile.spec.js` with the bench legibility
pass, `protocol_stages.spec.js` with I12 and `periph_regs.spec.js` with I13; then
`periph_deadline.spec.js` with I15, and `read_asm.spec.js` + `startup_pseudocode.spec.js`
with I14):

| spec | what it pins |
|---|---|
| `lab_quiz.spec.js` | every graded question's declared answer key, and the truth of the eight answers |
| `helpers.spec.js` | `hl()` in all three modes, its escaping, and `shuffle()` uniformity/reproducibility |
| `linker_sandbox.spec.js` | the sandbox's flash/RAM accounting, `.bss` NOLOAD, every misplacement diagnostic, region overflow, loader clamping, and the generated script |
| `protocol_model.spec.js` | the pin-level resolver, wired-AND, UART framing (LSB-first, parity polarity), the drifting sample points, CAN dominant/recessive arbitration + CRC-15 + stuffing, and I²C clock stretching |
| `periph_model.spec.js` | `pfUpdateRateHz` including the off-by-one, the 1 kHz tick model, and the preset/band/hint/arm-number consistency |
| `periph_tape.spec.js` | the behaviour tape: cadence/freshness predicates over scripted tapes, the real model driven through `pfTick()`, the ring bound, and the writer/goal/checklist wiring (added with I11) |
| `lab_compile.spec.js` | the Compilation Path bench/teaching report split, provenance labels, the real-output parsers (`#define` count, assembly labels, objdump sizes, size table, vector words), failure landing, and the rail ↔ `CLAB_TITLES` ↔ Rust stage-id agreement |
| `protocol_stages.spec.js` | every Protocol Lab stage rendered headlessly: full length, its own goal card, no `undefined`/`NaN` in the output, per-family nav, every map link resolving, every goal callable on a fresh lab, and the drawn I²C address/data bytes (added with I12) |
| `periph_regs.spec.js` | the peripherals register semantics — ISER write-1-to-set / ICER write-1-to-clear (write-only, reads 0), BSRR's atomic halves, the PUPDR whole-field cycle, CCR as a register, every stage rendered headlessly with the same no-`undefined` guard, every goal callable, and wiring guards against the old toggle semantics (added with I13) |
| `read_asm.spec.js` | the `startup.s` line classifier and histogram, the four decoded instruction lines, the Thumb-2 copy, that every one of the 58 lines answers a click, and the stage's graded keys against the file (added with I14) |
| `startup_pseudocode.spec.js` | that the reset pseudocode and the real `startup.s` walk the same steps, line for line (added with I14) |
| `periph_deadline.spec.js` | the remainder-carrying time base (the counter matches `pfUpdateRateHz` at every PSC/ARR), the handler-cost/deadline maths, the four claims behind `pfTapeStillRunning()`, the stage-7 demo's servable periods and the narrowed stage-9 band (added with I15) |

Suite total: 19 files (1143 checks). Nothing to install; `npm test` runs them all.

> Payoff: `linker_sandbox.spec.js` failed on its first run against a real defect
> (`problems.md` P8) — the loader clamped section sizes but not the stack/heap reserves.

---

## I2 · 🔴 Make the graded-question contract structural — **DONE**

A new question cannot ship without declaring its answer, and the "first option is correct"
shortcut cannot be written again: `validate_build.js` fails on a graded container with no
`data-ok`, a key outside its options, fewer than two options, or a handler comparing
`dataset.a` to a literal; `specs/lab_quiz.spec.js` pins the *truth* of the answers. Detail
in `problems.md` P1.

**Kept as a pattern, not a one-off.** `validate_build.js` now checks four cross-fragment
contracts of this shape: rail ↔ views, lab ↔ journal host, graded question ↔ `data-ok`, and
fragment ↔ `__APP_VERSION__` token. That "check the agreement, not the code" habit is the
project's best one.

---

## I3 · 🟠 One source of truth for the version the user sees — **DONE**

`build.js` substitutes `__APP_VERSION__` from `package.json` (the file `sync-version.js`
already guards), and `validate_build.js` fails if the token disappears from the fragments,
if a hardcoded `rev x.y` returns, or if the built HTML still contains the token. Removes
`problems.md` P2 permanently.

---

## I4 · 🟠 Accessibility part 2 — **DONE**

The three items `todo.md` §19 left open:

- **Skip link.** The first tab stop on the page is now `Skip to content` → `#content`, a
  focusable wrapper around every view, so keyboard users no longer re-traverse the fixed
  rail on every page.
- **Dashboard counters announce themselves.** `#d-count`, `#d-writing`, `#d-practice` and
  `#d-heatkey` carry `aria-live="polite"`; they only change while the dashboard is open, so
  this is not noisy.
- **Concept-graph keyboard traversal.** A graph with 163 nodes was mouse-only. Nodes are now
  `role="button"` with an `aria-label` and a roving tabindex (exactly one tabbable); Arrow
  Up/Down walk a stage's column, Arrow Left/Right move to the neighbouring stage at the
  nearest height, Home/End jump, Enter/Space select (the side panel follows) and Escape
  clears. The focused node shows the same tooltip a hover does, and a focus-visible ring on
  its core stands in for the SVG outline the browser will not draw.

---

## I5 · 🟠 No more `window.alert` — **DONE**

`notice(text, kind, sticky)` is one dismissible banner pinned to the foot of the window,
`role="alert"`/`status`, shared by the lab build errors and the storage-full warning. It
replaces the app's only blocking modal. (Token-aware: a newer notice does not fight an older
one for the same corner, matching the `setDataButtonState` discipline from `todo.md` §21.)

---

## I6 · 🟠 An honest highlighter — **DONE**

`hl()` rewritten as a single pass with three modes (`c`, `asm`, `ld`), chosen per artifact by
`hlModeFor()`. `#include`/`#define` are directives (`.p`), not comments; an ARM `#10`
immediate is a number (`.n`), not a comment; strings are `.s` as the stylesheet always
expected. The colour rules now apply wherever the output is used — `pre.src` (diffs),
`pre.hl` (the bench's real tool output, newly given its own styling) and `.ivcode`
(interview code blocks), which previously rendered highlighted markup with no colours at
all. Pinned by `specs/helpers.spec.js`. Detail in `problems.md` P3.

---

## I7 · 🟡 Deterministic, uniform shuffles — **DONE**

`shuffle(list, seed)` — Fisher–Yates, uniform, and seeded so a spec can pin it. Replaces
both `sort(() => Math.random() - 0.5)` calls (mock rounds, fault triage). Detail in
`problems.md` P4.

---

## I8 · 🟡 A model ↔ prose drift guard — **DONE**

Rather than a separate "does the prose match?" spec, the guard is folded into the model
specs where the numbers actually live, so they cannot be edited apart:

- `periph_model.spec.js` reads the graded Hz bands, the `blink` preset's PSC/ARR, the
  "e.g. PSC 9, ARR 99" hint, the nesting demo's PSC/ARR and the `pfArmNestDemo` /
  `pfArmRaceIsr` writes **out of the fragment** and checks each against `pfUpdateRateHz` —
  which is how P7's off-by-one became impossible to reintroduce. It also ties the literal
  `1000` in the rate formula to the `PF_TICK_MS` / `PF_CLK_PER_TICK` model clock.
- `linker_sandbox.spec.js` recomputes `_estack`, the `1M` flash length and the `128K` RAM
  length from `FLASH_SIZE` / `RAM_SIZE` / `RAM_ORIGIN` and requires the *generated* script
  to contain them.

---

## I9 · 🟡 Tidy the public API, and lint its shape — **DONE**

The duplicate `view` key is gone (`problems.md` P6), and `scripts/lint.js` now has three
independent checks: duplicate declarations in the app IIFE scope, duplicate declarations in
`40_graph.js`'s own scope (which found `problems.md` P9 — a dead second `esc()`), and
duplicate top-level keys in the `window.EmbeddedCRoadmap` literal. This retires the
"unexercised API surface" note from `todo.md` §23: the surface is checked, not just
documented.

---

## I10 · 🟢 Repo/doc hygiene — **DONE**

`todo.md` §22's stale checkbox corrected (the code was already right), the missing §9 noted,
a "third pass" section added describing this work, and `README.md`'s future-work list fixed
so it stops advertising the shipped scrubber while CAN / ADC-DMA-RTOS / clock stretching
remain genuinely open. `README.md` also now describes the build-time contracts and the
lab-model specs, and lists the new constraints (answer keys as data, one generated version).
`features.md` was added afterwards as the forward-looking companion: a full feature
inventory plus a ranked catalogue of what to build next.

---

## I11 · 🔵 Bold: grade the labs on observed behaviour — **DONE**

**What it bought.** A lab goal used to verify only a *state* ("PA5 is an output, ODR bit 5
high"). The interesting failure on real silicon is a *behaviour*: the ISR fires a few times
and then stops — a masked line, a cleared CEN, an uncleared flag — while every register still
reads correctly. Stage 9 now grades both.

**How it landed.**

1. **Event tape** — `periph.tape` is a bounded ring (`PF_TAPE_MAX = 240`) of `{ t, k, d }`,
   written from the call sites that already log: `enter`/`led` in `pfEnterIsr`, `exit` in
   `pfNvicTick`, `lost` in `pfRaceTick`. It persists with the rest of the lab state and is
   type-checked and trimmed on load, so an imported or older state cannot inject a bogus tape.
2. **Pure predicates** — `pfTapeEntries`, `pfTapeGaps`, `pfTapeCadence`, `pfTapeAge`,
   `pfTapeSteady`, `pfTapeVerdict`. *Cadence* (N entries on a steady period) and *freshness*
   (the newest entry is recent) are graded separately and deliberately; the cadence is judged
   over the newest `PF_TAPE_WINDOW = 8` entries so an old hiccup ages out instead of poisoning
   the goal for minutes.
3. **One gate, three readers** — `pfTapeStillRunning()` is the single stage-9 behaviour gate;
   the goal card, the nine-row checklist and the new *Behaviour tape* card all ask through it,
   so they cannot disagree about what "working" means. Goal 9 also keeps every state check it had.
4. **The evidence is visible** — the tape card (stages 7, 9, 10) prints the last twelve CPU
   events with sim-clock stamps plus the very statistics the grader uses, because grading over
   time is only fair if the learner sees the same evidence.
5. **The grading is graded** — [specs/periph_tape.spec.js](specs/periph_tape.spec.js),
   51 checks: predicates over scripted tapes; the real model driven through `pfTick()` (bring
   TIM2 up and the measured median gap must equal `1000 / pfUpdateRateHz()`; mask PRIMASK and
   the gate fails while the cadence stats stay green; unmask and watch it reopen; a 400-tick
   run proves the ring bounds); and drift guards over the writer call sites, goal, checklist
   and clamp. Negative controls were run: removing the `enter` event fails 12 checks, removing
   the freshness assertion fails 2.

**Side findings while verifying it.** A passed goal wrote its confirmation into a hint node
and *then* re-rendered the stage, discarding the message — so a verified goal looked like a
dead button. Fixed in [23_lab_periph.js](roadmap-source/23_lab_periph.js) and the same
asymmetry in [24_lab_protocols.js](roadmap-source/24_lab_protocols.js); recorded as
`problems.md` P10. The peripherals intro copy and the dashboard caption now state that stage 9
is graded on behaviour over time, not only on register state.

**What is left in this direction.** The Protocol Lab is the next tape host — its `prLog` call
sites already exist, and I12 has since added CAN arbitration, bit stuffing, ACK and clock
stretch events with sim-clock stamps to predicate over. That work, and the genuinely-absent
frontiers (an ADC/DMA/RTOS view, a second I²C slave, CAN error frames), are catalogued in
[features.md](features.md).

---

## I12 · 🟠 The Protocol Lab's fourth family: CAN, and I²C clock stretching — **DONE**

**Was:** the lab taught three protocols over nine stages. CAN appeared only as a line of prose
("when a new protocol shows up, ask these seven questions"), and the I²C family never mentioned
the one wire a slave is allowed to drive.

**Now:** **12 stages in 5 families**, with three new animated stages riding the existing
ticker, scrubber, keyboard map and goal machinery:

1. **CAN · Dominant wins** — the differential pair in a wiring card (CANH/CANL, two 120 Ω
   terminators, a node releasing), a wired-AND you can toggle by hand, then two nodes
   transmitting in lockstep: a per-bit LA with the divergence bit marked, a bit-by-bit *intent*
   table (A wants / B wants / bus reads), and a winner that is always the numerically smaller
   ID — because 0 is dominant. Identical IDs get the I²C treatment (both believe they won; the
   log says why that is a design bug, not a feature).
2. **CAN · The frame** — one standard 11-bit data frame built field by field with a real
   **CRC-15** (poly 0x4599) over SOF..DATA, drawn as **field bands** instead of one labelled box
   per bit (63–66 bits is unreadable the other way), plus a **bit-stuffing** strip that
   highlights every inserted bit and prints the longest original run, an **ACK slot** that goes
   dominant only if a receiver heard the frame, and a receiver-absent variant where it stays
   recessive.
3. **I²C · Clock stretching** — the slave holds SCL low for 0–6 clocks after its ACK; the LA
   draws the flat held slots and the table proves the master's **bit counter does not advance**
   while the line is held.

**How it landed.** The shared playback engine (`_prAnim` / `_prCap` / `_prPos`) took a fourth
`kind` without changing its contract: each protocol gets one `prXxxTick()` on the one ticker and
one `prXxxSig()` that `prCap()` uses to retire a capture whose inputs moved out from under it.
The map table gained a CAN column (10 rows × 4 protocols), goal 7 now spans all four families,
and both new goals are ordinary members of `PR_GOALS` — 12 goals, 12 stage buttons, 5 family
tabs. `prLoad()`'s stage clamp became `!prStageById(n)` rather than `1..9`, so adding a stage can
no longer send a returning learner to stage 1, and the new state groups fill in field by field
from the defaults, so an older saved state or an imported backup upgrades in place — no schema
bump needed.

**The grading is graded** — [specs/protocol_stages.spec.js](specs/protocol_stages.spec.js),
**143 checks**. It renders *every* stage headlessly (`prBody()` is a pure function of the model)
and asserts: each declared stage renders at full length, offers its own goal card and a nav
button, and leaks no `undefined`/`NaN`; the nav highlights exactly one family and one stage;
every stage-7 map link resolves to a stage that exists; every goal's `ok()`/`hint()` is callable
and starts false; the three new stages expose the controls their model needs; and the stretched
transfer is START + address + ACK + data + ACK + STOP plus the hold, with the *drawn* address and
payload bytes equal to the ones the prose names.

**What it caught immediately.** The first run failed three ways, two of them real shipped bugs:
the I²C waveform drew its address byte with the 7-bit helper (`problems.md` P12 — A6 dropped,
R/W always 0), and stage 7 printed a bare `undefined` (P14). The third was a stage body that
threw (`bits is not defined` in one caption), which would have left the CAN frame tab silently
unresponsive — the model spec cannot see that class of bug at all, which is why the render spec
exists.

**Negative controls run:** bus becomes OR (3 checks fail) · stuffing disabled (2) · wrong CRC on
the wire (1) · stretch holds SCL high (1) · IDs sent LSB-first (3) · address helper reverted (3) ·
data helper reverted (2) · stretch builder loses its payload (4) · a stage render throws (1) · a
template hole injected (1) · a goal that throws on a fresh lab (2) · a map link to a stage that
does not exist (1) · a family dropped from the metadata (3).

---

## I13 · 🟠 Register-semantics accuracy pass on the peripherals lab — **DONE** *(2026-09-30, peripherals pass)*

A register-semantics audit asked *"if this were a full peripherals course, what is wrong or
missing?"* (the gap analysis is catalogued in
[features.md](features.md)). Three answers were defects, not features, and they are
[problems.md](problems.md) P15–P17; this is the fix pass.

- **ISER/ICER, taught truthfully (P15).** `ISER0` used to toggle like a plain RW register:
  clicking a set bit wrote a whole-register value full of 0s and cleared the line in the
  model, while the emitted C already said `NVIC->ICER[0] = …`. The model now implements
  ARMv7-M: ISER is write-1-to-set (0s ignored), ICER is write-1-to-clear and write-only
  (reads 0), writes are masked to the two modelled lines with a log note for the rest, and
  a click that clears a line routes through ICER with the explanation in the log. `ICER0`
  sits next to `ISER0` in the NVIC card, dark.
- **PUPDR, reachable (P16).** The pull register existed in the model but in no UI, so the
  floating-pad lesson could be described but never performed. It is now a card in stages
  3/4 and the playground; a click cycles a pin's whole 2-bit field (NONE → UP → DOWN),
  never a single bit (which could synthesise the reserved `11`), records the two RMW
  statements as canonical C, and is dropped when GPIOA is unclocked. The stage-3 pin cell
  follows live: pull-UP reads 1 on a floating pad, pull-DOWN snaps it to 0.
- **BSRR and CCR, in the bank (P17).** BSRR taught stage 8's atomic-write lesson in prose
  but was absent from the register bank; it is now a 32-bit write-only card (reads 0 —
  the boxes never light, which is the lesson) whose low half emits `GPIOA->BSRR =
  GPIO_BSRR_BS<n>` and high half `…BR<n>`, each one atomic write straight into ODR. CCR
  was a slider floating beside the waveform with the card admitting "visual duty only"; it
  is now a real `CCR` row (offset `0x34`) that the slider writes, and the prose states
  what is genuinely not built (the compare *output channel*, CCMR/CCER) instead of
  implying the register was fake.
- **Honest unwired bits.** Bits that exist on the chip but have no behaviour in the lab
  (most of RCC's enables, all but bit 0 of the timer CR1/DIER/SR rows) used to claim
  "reserved in this model" — a fudge, since they are not reserved on silicon. They now say
  "not wired in this model — writing it has no effect here" and render striped
  (`.ro.dis`), distinct from true read-only bits.

**The grading is graded** — [specs/periph_regs.spec.js](specs/periph_regs.spec.js),
**99 checks**. The model slice runs in a `vm` with `rd`/`wr` stubbed; it drives ISER/ICER
through `pfWriteReg` (0s cannot clear; unmodelled lines cannot be enabled; ICER reads 0),
BSRR's halves through ODR, the pull cycle (never 11; canonical C emitted; dropped when
unclocked) and IDR's response, CCR width, and the emitted C for every new click type. Then
it renders **every one of the ten stages headlessly** — full length, no `undefined`/`NaN`,
reachability checks (PUPDR in 3 and 4, BSRR next to the race rig, both NVIC rows in 6, the
full bank in the playground) — and calls every goal's `ok()`/`hint()` on a fresh lab. Source
wiring guards pin the semantics against regression (the ICER redirect, the write masks, the
shared `pfPnameForReg` resolver between click handler and live refresh).

**What it caught immediately.** The spec's first run failed one check — a real shipped
hole: the stage-3 pin-cell SVG interpolated a bare `undefined` into `<g id="pf-pin5-pad">`
(`problems.md` P17's bonus find, same class as P14). Not its job — it was written for the
register semantics — which is the point of rendering every stage.

**Negative controls run (all in a scratch copy):** plain `ISER0 = value` restored (8 checks
fail) · ICER turned into a no-op (4) · BSRR halves swapped (4) · pull cycle allowed to
reach 11 (2) · reset click emitting the BS macro (1) · "reserved in this model" returning
(2) · the pin-cell `undefined` returning (1) · CCR row dropped (1) · resolver unshared (1)
· clicking a set ISER bit clearing in place (1).

---

## I14 · 🔵 The linker lab showed `startup.s` but never taught reading it — **DONE** *(2026-09-30, linker-reader pass)*

**Was:** stage 5 of the Linker & Startup lab shows `startup.s` as 58 annotated lines, but
nothing anywhere explained what a reader is looking at. Line 6 (`.thumb`) had been asserting
Thumb-2 since the first commit with no lesson behind it, and the reset walk's pseudocode
taught a `bl SystemInit` that **no file in the project defines** — a learner who typed the
lesson into the real bench got `undefined reference to SystemInit` from the linker
(`problems.md` P18).

**Now:** a **9th stage** in the lab, *Reading a `.s`: what is actually an instruction*:

- **The histogram is the lesson.** "19 of 58 lines are instructions" is computed at load from
  the embedded `startup.s` by `asmClassify()`, so directives, labels, comments and blank
  lines are counted as what they are — and the vector table's `.word` directives are called
  out as data that *does* emit bytes, not code to execute.
- **Anatomy, not vocabulary.** Four real lines of the same file are taken apart field by
  field (label · mnemonic · operands · the encoded form).
- **Thumb-2**, the part the curriculum never covered: why 16-bit Thumb had to drop
  instructions, what Thumb-2 adds back, and what that costs a reader (line 29 is 4 bytes,
  line 28 is 2).
- The reset pseudocode in stage 5 was corrected, so the lesson and the file the lab hands
  the learner are the same program.

**The guards.** [specs/read_asm.spec.js](specs/read_asm.spec.js) (**144 checks**) re-derives
the classification independently, checks every decode against the line it names and every
field token against that line's text, and pins the Thumb-2 pointers to real lines — so
reordering `asmClassify`, moving a decode's line number, or editing `startup.s` underneath
the prose fails the suite.
[specs/startup_pseudocode.spec.js](specs/startup_pseudocode.spec.js) (**70 checks**) is the
drift guard that catches the `SystemInit` class of bug: the pseudocode, the "what the linker
supplied" panel and `startup.s` must name the same symbols and call exactly the same targets.

---

## I15 · 🟠 Grade the deadline, not just the cadence — **DONE** *(2026-10-01, peripherals time-base pass)*

**Was:** the stage-9 behaviour gate asked only "are the gaps regular?" — and a saturated ISR
produces beautifully regular gaps, spaced at the *cost* rather than at the requested rate.
Configure 4 Hz against the 400 ms handler and the tape read a steady 400 ms median while
`main()` never ran. Three separate lies shared one cause (`problems.md` P19–P22): the time
base rounded away the remainder above PSC 99 so the counter disagreed with the Hz on the
card; the handler cost was quoted as a hardware fact; and regularity was graded where
punctuality was meant. Stage 7's own one-click demo armed TIM3 at a rate that starved TIM2,
so the stage's goal was unreachable from its own button.

**Now:**

- **A true time base.** `pfAdvanceTimer` carries the fractional remainder in `T.acc`, so
  `pfUpdateRateHz()` is exact at every PSC/ARR instead of only the divisors that divide a
  tick evenly. `PF_MAX_ROLLS` bounds one tick's rollovers and `T.merged` counts the surplus
  past UIF's single bit.
- **A deadline.** `pfIsrDeadline(T)` returns `{periodMs, costMs, load, met}` — the period the
  timer generates against the time one handler holds the CPU. The timer row shows it live,
  green or red (`.dl-ok` / `.dl-bad`).
- **Four claims, one gate.** `pfTapeStillRunning()` now requires steady **and** fresh **and**
  on-period **and** deadline met, and `pfTapeVerdict()` names which claim broke. Regular but
  late fails.
- **Honest prose.** `PF_ISR_MS` is labelled a model device (a real ISR is microseconds;
  400 ms is four sim frames, chosen so preemption is visible at the 10 Hz tick), and every
  card that quotes it says "in this model".
- **Stage 7 retuned.** The nesting demo runs TIM2 at 2 Hz and TIM3 at 1.25 Hz (800 ms), both
  longer than the handler, so TIM2 is actually dispatched and the stage's `nestCount >= 1`
  goal is reachable; the 5 Hz case stays as the counter-example the card offers.
- **Stage 9 band narrowed** from 1.5–2.6 Hz to **1.5–2.4 Hz**: 2.6 Hz is 385 ms, shorter than
  the 400 ms handler, so the old band accepted a rate this model can never deliver.

**The guard.** [specs/periph_deadline.spec.js](specs/periph_deadline.spec.js) (**129 checks**)
drives the real model through `pfTick()`, pins pure predicates over scripted tapes, and adds
drift guards so the prose, the card and the checklist cannot be edited back into a different
story than the grader. **37 negative controls** were run against a scratch copy of the source
and all 37 were caught; the harness points the spec at the temp copy through `PERIPH_SRC`
rather than mutating learner-facing source in place (the one in-place run left a mutation in
a comment).

---

## Cross-check with `todo.md`

- **Already done there, not repeated:** §1–§8, §10–§18, §20–§22, §24–§26.
- **Carried forward from there and now finished:** §19's second half (→ I4) and §23's API
  note (→ I9).
- **New in this pass:** I1–I15 executed (I12 landed in the protocol pass on 2026-09-30, I13
  in the register-semantics pass the same day, I14 in the linker-reader pass, I15 in the
  peripherals time-base pass).
- **Ordering that was used:** I2 + the quiz half of I1 first (highest risk, cheapest), then
  the model specs (I1) which immediately found P8, then the isolated fixes (I3, I8, P7) and
  the UX/correctness pair (I5, I6, I7), then the accessibility work (I4), then API/lint
  (I9) and docs (I10), and finally I11 once the models it depends on were pinned.

## Verification

All green after every change, and each guard was checked with a negative control rather
than assumed: `npm test` (**19** spec files, **1143** checks after I15), `npm run lint`,
`npm run build:roadmap` (validation OK, **1215 / 1500 KB** budget),
`node scripts/sync-version.js --check` (in sync at 1.0.0), `cargo test` (10 passed,
1 ignored) and `cargo clippy --all-targets -- -D warnings` (clean). The exact commands and
the live-DOM checks are listed at the end of `problems.md`.
