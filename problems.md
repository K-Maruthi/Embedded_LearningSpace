# problems.md — defects found (fresh audit)

A pass over `roadmap-source/` (fragments, build + validation, lint), the Rust backend,
`specs/`, and repo hygiene, run **after** the audit recorded in `todo.md`. Everything
here is cross-checked against `todo.md` — see [Cross-check](#cross-check-with-todomd) —
so nothing already fixed there is repeated, and each of its completed items was verified
against the code rather than trusted.Status: **P1–P22 are fixed; P23–P30 are open.** Two of them (P8, P9) were found *by the new specs and
lint rules written during this pass*, which is the point of the pass; P10 was found by
tracing the new I11 grading path end to end in the live app; P11 was found by the
compilation-path spec written for the bench legibility pass; P12 and P14 were found by the
stage-render spec written for the protocol pass (P13 by driving a scrub backwards in the
live app); **P15–P17 were found by a register-semantics audit of the peripherals lab**,
then caught (and one more, the pin-cell `undefined`, re-caught) by the spec written for the
fix — see [improvements.md](improvements.md) I13; **P18 was found by the startup-pseudocode
drift guard** written for the linker-reader pass (I14); **P19–P22 were found by a
time-base audit of the peripherals lab** — the clamped counter step, the handler cost quoted
as fact, the saturated-ISR gate and the unreachable stage-7 demo — fixed in I15; and
**P23–P30 were found by a UI/UX + accessibility audit** of all nine views against the
119-rule `ui-ux-pro-max` catalog — see [That audit](#the-uiux--accessibility-audit) for the
method, the coverage, and the two candidate findings that were **discarded as false
positives**. They are open, not fixed: none of them has a spec yet.

**In order:** P1 wrong quiz keys · P2 version drift · P3 highlighter · P4 shuffles ·
P5 `window.alert` · P6 duplicate API key · P7 doc/model drift · P8 negative reserve ·
P9 duplicate `esc()` · P10 swallowed goal confirmation · P11 `#define` pluralisation ·
P12 I²C address byte drawn off by one · P13 unreachable "back to live" ·
P14 a bare `undefined` in the protocol map · P15 NVIC set/clear semantics wrong ·
P16 PUPDR unreachable · P17 BSRR/CCR taught but not in the register bank ·
P18 undefined `SystemInit` in the reset pseudocode · P19 timer rate the card did not print ·
P20 handler cost stated as hardware fact · P21 a saturated ISR passing the gate ·
P22 stage 7's demo unable to reach stage 7's goal.

**Open — from the UI/UX + accessibility audit:**
P23 `--ink-3` fails AA on every surface in both themes · P24 labels not associated, 8 controls
unlabelled · P25 reduced motion does not stop JS-driven animation · P26 focus ring removed with
no replacement · P27 7.5px bit labels · P28 sticky elements with no `scroll-padding` ·
P29 wrong answers signalled by colour alone · P30 326 tab stops in the roadmap.

The forward-looking companion is [features.md](features.md).

Baseline before this pass (all green — so every item below was something the guards did
**not** catch):

```
npm test         all green (6 spec files)
npm run lint     clean
npm run build:roadmap   Validation OK
node scripts/sync-version.js --check   in sync at 1.0.0
cargo test       10 passed, 1 ignored
```

---

## P1 · 🔴 Two graded questions marked the wrong answer correct — **FIXED**

**Where:** `21_lab_compile.js` (Compilation Path `check` stage), `22_lab_linker.js`
(Linker & Startup `check` · *Predict*)

Both labs graded multiple-choice questions with the same code shortcut:

```js
var ok = b.dataset.a === "a";          // "the first option is always right"
```

True for most of the eight graded questions and **false for exactly two**:

| lab | question | option `a` (marked correct) | actually correct |
|---|---|---|---|
| Compilation Path · `check` | "which stage applies `.data > RAM AT > FLASH`?" | Compiler | **Linker** (option `b`) |
| Linker & Startup · `check` · *Predict* | `uint8_t buffer[256];` placement | Flash `.text` | **RAM `.bss`** (option `b`) |

**Why it mattered more than it looks:** the explanation text beside each question was
correct, so a green tick on the wrong answer read as plausible and actively taught the
wrong model — in an app whose thesis is *"where a correct answer matters, you get fixed,
correct presets so the tool never teaches a wrong idiom"*.

**Fix.** The answer key moved from the handler into the markup as data, and the handlers
compare against it:

```html
<div class="complab-choices" data-cq="q2" data-ok="b"> … </div>
```
```js
var ok = b.dataset.a === box.dataset.ok;
```

Guarded at two levels, deliberately:
- **`specs/lab_quiz.spec.js`** — every graded group declares `data-ok` naming one of its
  own options; the eight answers still point at the *true* option; no handler compares
  `dataset.a` to a literal.
- **`validate_build.js`** — a graded container with no `data-ok`, a key outside its
  options, fewer than two options, or a re-introduced literal comparison fails
  `npm run build:roadmap`.

The split is intentional: the build gate can prove a key is *well-formed*; only the spec
can assert it is *true*. Verified with negative controls (dropping the key, swapping it, and
restoring the old handler each fail), and in the live DOM (see Verification).

---

## P2 · 🟠 The displayed revision disagreed with the app version — **FIXED**

**Where:** `20_app.js` (`progress()`), `01_head.html` (initial markup)

The rail showed a hand-typed `rev 1.2 · …` on every screen while the app was **1.0.0**
in `package.json`, `tauri.conf.json` and `Cargo.toml` — the one version string a learner
actually reads, and the only one `sync-version.js` did not cover.

**Fix.** `build.js` substitutes a `__APP_VERSION__` token from `package.json` (the single
build path already there), and `validate_build.js` fails if the token is missing from the
fragments or a hardcoded `rev <n>.<n>` slips back in, or if the built HTML still contains
the unreplaced token.

---

## P3 · 🟡 `hl()` highlighted the wrong tokens, and its output was mostly unstyled — **FIXED**

**Where:** `20_app.js` (`hl()`), used by `initDiffs` (`pre.src`), `ivShow` (`.ivcode`) and
`clabBlock`/`clabFold` (the real tool artifacts)

Two defects in one small function:

1. **Wrong tokens.** It treated `#` to end-of-line as a comment in *every* language, so
   `#include` / `#define` and — for the `main.s` the bench shows from a real
   `arm-none-eabi-gcc -S` — every ARM `#immediate` was dimmed as a comment. Strings were
   not recognised at all, even though the stylesheet already had a `.s` rule for them.
2. **Inert highlighting.** The `.c` / `.k` / `.n` colours were scoped to `pre.src` only,
   so the highlighted output in the interview code blocks (`.ivcode`) and the bench
   artifacts (a bare `<pre>`) rendered as plain text — dead markup pretending to be
   syntax colouring.

**Fix.** `hl()` is now one left-to-right pass with three modes — `c`, `asm`, `ld` — chosen
by artifact name via `hlModeFor()`. Strings, comments and directives are consumed first
and the keyword/number rules only see the code that remains, so nothing inside a literal
or comment can be re-highlighted. Classes: `.c` comment, `.s` string, `.p` directive,
`.k` keyword/register, `.n` number; the colour rules now apply to `pre.hl` and `.ivcode`
as well as `pre.src`. Pinned by `specs/helpers.spec.js` (a `#define` line, a string
containing a keyword, `movs r0, #10`, an `@` comment, a linker-script address).

---

## P4 · 🟡 Non-uniform shuffles for mock rounds and fault triage — **FIXED**

**Where:** `20_app.js` — interview mock pool and fault order

```js
pool.slice().sort(function () { return Math.random() - 0.5; });
```

A comparator that ignores its arguments is not a shuffle: the distribution is biased
(ends barely move) and its inconsistency makes the result engine-dependent. For **Fault
triage** the order *is* the exercise, so "random" should mean uniformly random.

**Fix.** A seeded Fisher–Yates `shuffle(list, seed)` — uniform, reproducible in a spec,
and covered by `specs/helpers.spec.js` (permutation, no input mutation, seed
reproducibility, and a first-position distribution check).

---

## P5 · 🟡 `window.alert` for bench build failures — **FIXED**

**Where:** `21_lab_compile.js` (`clabBuild`)

A blocking native modal, the only one in the app, unstyleable and unable to sit next to
the stage it belonged to.

**Fix.** A shared `notice(text, kind, sticky)` banner replacing it — the same component the
storage-full warning now uses, dismissible, `role="alert"`, auto-dismissing when not
sticky.

---

## P6 · 🟢 The public API declared the same key twice — **FIXED**

**Where:** `25_api.js` — `view` was both a one-line wrapper and, later, `setView`.

Harmless at runtime (last wins, and the two agreed), but it is exactly what a guard should
own.

**Fix.** The duplicate is gone, and `scripts/lint.js` now fails on a duplicated top-level
key in the `window.EmbeddedCRoadmap` literal.

---

## P7 · 🟢 Documentation and model/prose drift — **FIXED**

- **`todo.md` §22's checkbox was stale** — it read `- [ ]` while the closing paragraph said
  the work was done, and `restoreBackup()` really does implement compare-then-reload
  (`labsChanged` is only set when a lab key's stored JSON actually differs).
- **`todo.md` numbering skipped §9** — now noted in the file.
- **`README.md`'s future-work list was partly shipped** — it advertised "time-travel
  scrubbing of the logic-analyser capture" as to-do while the stage scrubber
  (`prScrub` / `prView`) already existed. Now marked done, with CAN / an ADC-DMA-RTOS view /
  I²C clock stretching — which genuinely do not exist (no `stretch`, `bit-stuff` or `CAN`
  symbols in `roadmap-source/`) — left as the real frontier.
- **A model/prose off-by-one** — the peripheral `blink` preset's comment claimed
  `100 Hz / 50 = 2 Hz`; the model is `1000/((PSC+1)·(ARR+1))` = **1.96 Hz**, which is the
  correct reading (the counter counts `0…ARR`). Comment corrected to `/(50+1) ≈ 1.96 Hz`,
  and `specs/periph_model.spec.js` now ties the preset, the graded Hz bands and the
  comment together so they cannot drift apart again.

---

## P8 · 🟠 The linker sandbox accepted a negative stack/heap reserve — **FIXED**

**Found by:** `specs/linker_sandbox.spec.js`, on the first run.

`lksandLoad()` clamped section sizes to `[0, LKS_MAX]` but read the reserves as
`Number(s.stack) || 0` — so a stored or imported file containing `stack: -5` produced
`ramUsed = stack + heap` **negative**. Every usage bar and the "RAM region overflowed"
arithmetic are derived from that total, so a crafted/corrupt backup could render nonsense
(negative widths) instead of being clamped.

**Fix.** One `lksClampSize()` used by section sizes, both reserves, and the two input
handlers (which had their own copy of the same clamp). The spec asserts a negative size
and a negative reserve both clamp to zero, an absurd size clamps to `LKS_MAX`, and a
non-numeric size leaves the default rather than zeroing the section.

---

## P9 · 🟢 The concept graph declared `esc()` twice — **FIXED**

**Found by:** extending `scripts/lint.js` to scan `40_graph.js` as its own scope.

`40_graph.js` had both `var esc = R.esc || …` and a later `function esc(s) { … }`. Function
declarations hoist and the `var` assignment then overwrote it, so the declaration was dead
code — but it read as a second definition, precisely the drift the file's own comment
promises to avoid. The dead declaration is removed, and the lint now checks both IIFE
scopes (the app's, assembled from six fragments, and the graph's).

---

## P10 · 🟠 A passed stage goal looked like a dead button — **FIXED**

**Where:** [23_lab_periph.js](roadmap-source/23_lab_periph.js) (the Verify handler),
[24_lab_protocols.js](roadmap-source/24_lab_protocols.js) (the same shape)

**Found while:** verifying I11 live. Every stage goal has a **✓ Verify** button; on success
the handler wrote its confirmation ("Verified against the live register state — onto the next
stage.") into `#pf-goal-hint-N` and *then* called `pfRenderStatic()`. That re-render replaces
the whole stage body, so the node the message had just been written into was discarded: the
button appeared to do nothing even though the goal had been graded and stored. A learner
could reasonably conclude the button was broken and stop verifying goals at all.

**Fix.** Write the confirmation *after* the re-render, re-reading the node from the fresh
DOM. The same ordering bug existed in the Protocol Lab's verify handler and is fixed the same
way. (No spec covers this: it is a live-DOM ordering issue, not a model predicate. The
negative-control habit still applied — with the old order restored on a scratch copy, the
message is absent from the rendered stage.)

**Verified live:** clicking **✓ Verify** now shows the confirmation and the goal chip flips to
`achieved ✓`, in both labs.

---

## P11 · 🟢 The `#define` count read "directories" — **FIXED**

**Where:** [21_lab_compile.js](roadmap-source/21_lab_compile.js) (`clabFacts`, the
preprocess observation)

**Found by:** [specs/lab_compile.spec.js](specs/lab_compile.spec.js), on its first run.

The bench's preprocess observation pluralised the wrong word:

```js
defs + " #define director" + (defs === 1 ? "y was" : "ies were")
```

which renders **"2 #define directories were in your main.c"** (and "1 #define directory")
for a sentence that means *directives*. The number was right; the noun was not, in the one
panel that is supposed to explain the preprocessor.

**Fix.** `" #define directive" + (defs === 1 ? " was" : "s were")`, with the spec now
checking both the singular and the plural sentence.

---

## P12 · 🟠 The I²C address byte was drawn one bit off, and R/W always read 0 — **FIXED**

**Where:** [24_lab_protocols.js](roadmap-source/24_lab_protocols.js) (`prI2cTxSlots` and
`prI2cSrSlots`, both reading the 8-bit wire address with the 7-bit helper)

**Found by:** [specs/protocol_stages.spec.js](specs/protocol_stages.spec.js), on its first
run, while adding the clock-stretching stage.

`prI2cBit(v, i)` extracts bits **6…0** — correct for a *7-bit address number* (which is exactly
what the arbitration stage hands it) but wrong for `prAddrByte(addr, rw)`, which is an 8-bit
byte on the wire: seven address bits **then** R/W. Reusing it there shifted the whole field and
dropped A6, and the R/W slot asked for `v >>> -1` (JS coerces that to a 31-bit shift) which is
0 for every address. So the trace drew

- `0x50` + write as `0100 0000` (0x40) with A6 missing,
- the R/W slot as **0 regardless of `rw`** — every drawn transfer was a write,
- the data byte `0xA5` as `0100 1010` (0x4A), and the S-R read byte `0x2C` as `0x58`,

while the banner, the stage-6 subtitle and the code card all named 0xA0 / 0xA1 / 0xA5 / 0x2C.
The waveform was the only thing in the stage that disagreed, and a waveform is read as a shape:
this shipped through stages 5 and 6 unnoticed.

**Fix.** Two purpose-named helpers — `prI2cAddrBit(ab, i)` (bits 7…1, then R/W) and
`prI2cByteBit(v, i)` (bits 7…0) — used for the address and data loops; the 7-bit helper stays
where the value genuinely is a 7-bit address. The stage spec now pins the drawn address byte
for write (`1010 0000`) and read (`1010 0001`, differing only in R/W) and the drawn payload
byte (`1010 0101`); reverting either helper fails 3 and 2 checks.

---

## P13 · 🟡 The scrubber's "back to live" button could never appear — **FIXED**

**Where:** [24_lab_protocols.js](roadmap-source/24_lab_protocols.js) (`prScrubBar`,
`prSyncScrub`)

The run bar renders the `▸ live` button only when `prView()` is truthy — but the bar is only
rebuilt by `prRenderStatic`, and the one render that follows a transfer happens while `_prPos`
is still `null`, so `prScrub()` is `null` and the button is left out. Dragging the slider then
re-renders only the trace, never the bar, so a learner who stepped back into a capture had no
control to step forward into live again (short of changing stage). Fixed by always emitting the
button and toggling `hidden` from `prSyncScrub`; verified live on a UART byte frame and on a
66-bit CAN frame (step back → button appears → click → trace returns to the end).

---

## P14 · 🟢 A bare `undefined` was printed in the protocol map — **FIXED**

**Where:** [24_lab_protocols.js](roadmap-source/24_lab_protocols.js) (`PR_MAP_ROWS`, the SPI
"idle level of the data line" cell)

**Found by:** the template-hole guard in [specs/protocol_stages.spec.js](specs/protocol_stages.spec.js),
which scans every rendered stage for `undefined`/`NaN`.

The cell read `'undefined — the slave only speaks when CS is low'`. As English that is
accurate (SPI has no defined idle level), but what the learner sees is a table cell with the
word **undefined** in it, which is indistinguishable from a broken template. Reworded to "no
idle level at all — the slave only speaks when CS is low" so the guard can stay strict for the
next seven stages.

---

## P15 · 🔴 NVIC set/clear semantics were wrong in the model — **FIXED**

**Where:** [23_lab_periph.js](roadmap-source/23_lab_periph.js) (`pfWriteReg`, the bit-click
handler, `pfNvicCard`)

**Found by:** a register-semantics audit of the peripherals lab (the gap analysis that became
I13), not by a spec — the old spec asserted the wrong behaviour too.

`pfWriteReg("NVIC", "ISER0", v)` assigned the value outright, and the bit grid treated ISER0
as a plain toggle: click a set bit and the handler XORed the mask and wrote the whole
register — 0s in every other position. Two consequences:

1. **The model disagreed with the silicon it teaches.** Real ARMv7-M `ISER` is
   write-1-to-**set**: a 0 written to a bit is *ignored*, and there is deliberately no way
   to clear a line through ISER. Masking goes through **`ICER`** — write-1-to-clear,
   write-only, reads return 0. On the chip, the old "toggle" write could only ever enable
   lines, never disable one.
2. **The panel's own C already knew better.** `pfCodeForBitToggle` emitted
   `NVIC->ICER[0] = …` for a clear while the model happily cleared the bit in place — a
   learner copying the emitted line and pasting it into a project would see different
   behaviour from the lab that emitted it.

**Fix.** `pfWriteReg` implements the pair: `ISER0` writes are `existing | value` and
`ICER0` writes are `existing & ~value`, both masked to the two lines this lab models
(TIM2 = bit 28, TIM3 = bit 29), with a log note when a write touches lines the lab does not
wire. The click handler routes a clear through ICER — clicking a set ISER bit emits the
`ICER` write the C panel always promised, with a log note explaining why the ISER bit did
not "unset". `ICER0` joins the register card as write-only (`pfReadReg` returns 0, the boxes
stay dark), and the card prose teaches the set/clear idiom instead of implying a toggle.

---

## P16 · 🟠 PUPDR existed but was unreachable — **FIXED**

**Where:** [23_lab_periph.js](roadmap-source/23_lab_periph.js) (`pfWriteReg`, `pfPinCard`,
`pfIdrRefresh`)

**Found by:** the same register-semantics audit.

`PUPDR` was in the model (`pfWriteReg` accepted writes; `pfIdrRefresh` and `pfPinState`
honoured pulls) and in one sentence of stage-3 prose — but no UI anywhere rendered it, so
the floating-pad lesson the pin card teaches ("PUPDR weak resistors keep an unconnected
input from floating") could be *described* but never *performed*. The one register that
makes an input predictable was the one you could not touch.

**Fix.** A `PUPDR` card (address `0x4002_000C`) now ships with stages 3 and 4 (and the
playground). A click anywhere in a pin's 2-bit field cycles the whole field
NONE → UP → DOWN — never a single-bit toggle, which could synthesise the `11` pattern that
is reserved on silicon — records the two RMW statements as canonical C, and is dropped like
every other write when GPIOA's clock is gated. The stage-3 pin cell visibly follows:
pull-UP makes a floating pad read 1, pull-DOWN snaps it to 0, live in IDR and in the SVG.

---

## P17 · 🟡 Registers the lab taught in prose but not in the bank — **FIXED**

**Where:** [23_lab_periph.js](roadmap-source/23_lab_periph.js) (`pfGpioaCard`, `pfTimCard`,
`pfWaveCard`)

**Found by:** the same audit; the render-half by the new spec on its first run.

Three registers with a teaching role were missing from the register bank the learner can
see and click:

- **BSRR** carried the stage-8 lesson ("the fix is BSRR, which is write-only and atomic by
  hardware design") and the race rig offered a "switch main() to BSRR" button — but the
  register itself was not in the bank, so its set/reset halves could not be inspected or
  exercised. It is now a 32-bit **write-only** card (`0x4002_0018`, reads 0, boxes never
  light — which *is* the lesson); clicking the low half emits `GPIOA->BSRR = GPIO_BSRR_BS<n>`
  and the high half `…BR<n>`, one atomic write each, straight into ODR.
- **CCR** was a slider floating beside the waveform, with the card admitting "visual duty
  only, the model has no PWM output channel yet" — while the register bank above showed no
  CCR row at all. The slider now writes a real `CCR` row in the timer card (offset `0x34`),
  and the prose says what is genuinely not built (the compare *output channel*, CCMR/CCER)
  instead of implying the register itself was fake.
- **ICER0** belonged to the P15 fix and is covered there.

Adjacent fudge fixed in the same pass: unwired bits used to claim "reserved in this model"
on hover — but they are not reserved on the chip, they are simply unwired in the lab (RCC
AHB1/APB1 each model 1–2 enables out of dozens; the timers wire one CR1/DIER/SR bit each).
Those bits now say "not wired in this model — writing it has no effect here" and render
striped-and-not-allowed (`.ro.dis`), distinct from true read-only bits.

**Bonus find.** The stage-render sweep written for this pass caught a shipped hole the older
specs had walked past: the stage-3 pin-cell SVG interpolated a bare `undefined` into the
`<g id="pf-pin5-pad">` element (`<g …>undefined</g>`) — same class as P14, invisible in the
accessibility tree, caught by the no-`undefined` guard on every rendered stage.

---

## P18 · 🟠 The Linker lab's reset pseudocode taught an undefined `SystemInit` — **FIXED**

**Where:** [22_lab_linker.js](roadmap-source/22_lab_linker.js) (the reset-walk pseudocode card
and the "what the linker supplied" panel)

**Found by:** [specs/startup_pseudocode.spec.js](specs/startup_pseudocode.spec.js), written as
a drift guard and naming this as the regression it exists to prevent.

The lab teaches the reset sequence as pseudocode and hands the learner the real
`src-tauri/src/examples/startup.s` in the Compilation Path's bench editor. Those two are
supposed to be the same program. They were not: the pseudocode ended `bl SystemInit` followed
by `bl main`, while `startup.s` contained only `bl main`. `SystemInit` is defined **nowhere** in
the project — not in `startup.s`, not in `main.c`, not in `linker.ld`. A learner who typed the
app's own lesson into the editor got `undefined reference to SystemInit` from the real linker:
the lesson could not be typed.

**Fix.** The pseudocode now ends in `bl main` and names only symbols the file actually uses.
The spec is one-directional on purpose — `startup.s` may legitimately contain more than the
reset walk covers (`_estack`, the vector table, the local `copy_data`/`zero_bss`/`hang`
labels) — but the walk may not name a symbol or call target the file does not have. A
`no SystemInit call survives` check names the regression directly.

---

## P19 · 🟠 The peripheral timer ran at a rate the card did not print — **FIXED**

**Where:** [23_lab_periph.js](roadmap-source/23_lab_periph.js) (`pfAdvanceTimer`)

**Found by:** the peripherals time-base audit that became I15, not by a spec — the older
`periph_model.spec.js` slices only `pfUpdateRateHz()`, so it never drove a tick through the
counter at all.

The counter gained `Math.max(1, Math.round(PF_CLK_PER_TICK / (PSC + 1)))` counts per tick — a
clamped whole count. For any divisor over 100 that clamps to 1, so a 250-count divisor ran the
counter at 1/250th of the rate `pfUpdateRateHz()` reported: 0.10 Hz delivered against 0.04 Hz
claimed. The card next to PSC, the stage-9 goal and the stage-5 hint **all** read
`pfUpdateRateHz()`, and stage 5's hint actively recommended "factors of ~500–2000" — steering
learners straight into the range where the model disagreed with itself.

**Fix.** The fractional remainder rides in `T.acc`, so `pfUpdateRateHz()` is true for every
PSC/ARR pair instead of only the divisors that divide a tick evenly. `PF_MAX_ROLLS` bounds one
tick's rollovers and `T.merged` counts the surplus past UIF's single bit — because "the
peripheral generated more events than the CPU could take" is the whole point of the deadline
check below.

---

## P20 · 🟠 The handler cost was stated as a hardware fact — **FIXED**

**Where:** [23_lab_periph.js](roadmap-source/23_lab_periph.js) (`PF_ISR_MS` and every card that
quotes it)

**Found by:** the same audit.

Prose said "the TIM2 handler holds the CPU ~400 ms" with no qualifier. A real ISR that clears a
flag and toggles an ODR bit costs a couple of microseconds; 400 ms is four whole sim frames,
chosen so preemption is *visible* at this lab's 10 Hz tick. Nothing said so, so a learner
reasonably concludes handlers cost 400 ms.

**Fix.** `PF_ISR_MS` is documented in the source as a visibility device, not a cost you would
measure, and every card that quotes it says "in this model". The stage-9 hint now says
outright that 400 ms is the model standing in for a microsecond-scale handler.

---

## P21 · 🔴 A saturated ISR passed the behaviour gate — **FIXED**

**Where:** [23_lab_periph.js](roadmap-source/23_lab_periph.js) (`pfTapeStillRunning`,
`pfTapeVerdict`, the stage-9 goal, checklist and rate band)

**Found by:** the same audit; this is the one that mattered.

The behaviour tape graded **cadence** (gaps regular) and **freshness** (newest entry recent).
A handler that overruns its own period produces beautifully even gaps — evenly spaced at the
*cost*, not the requested rate. Configure 4 Hz against the 400 ms handler: it misses its 250 ms
deadline, re-enters the instant it exits, and the tape read median 400 ms / steady / "behaviour
gate met" while the card still said 4.00 Hz. The learner was told they built a 4 Hz blink; the
CPU was 160 % committed to the ISR and `main()` never ran. The stage-9 band compounded it by
accepting up to 2.6 Hz (385 ms), a rate this model can never deliver.

**Fix.** `pfIsrDeadline(T)` returns `{periodMs, costMs, load, met}` and `pfTapeOnPeriod()`
asks whether the measured cadence matches the rate that was requested. `pfTapeStillRunning()`
now requires steady **and** fresh **and** on-period **and** deadline met, and `pfTapeVerdict()`
names which claim broke, so regular-but-late fails. The band is 1.5–2.4 Hz, and the timer row
shows the deadline live (`.dl-ok` / `.dl-bad`).

---

## P22 · 🟡 Stage 7's one-click demo could not reach stage 7's goal — **FIXED**

**Where:** [23_lab_periph.js](roadmap-source/23_lab_periph.js) (`pfArmNestDemo`)

**Found by:** the same audit, while proving the deadline on the stage that teaches nesting.

The nesting demo armed TIM3 at 5 Hz (200 ms) over the 400 ms handler. TIM3 therefore overran
its own period, held the CPU continuously, and TIM2 was never dispatched — zero TIM2 entries,
so the stage's own `nestCount >= 1` goal was unreachable from its own button. The
prose promising "enter → ⚡ preempt → exit → resume → exit" described something the button
could not produce.

**Fix.** TIM3 is PSC 9 / ARR 79 (1.25 Hz, 800 ms); TIM2 stays 2 Hz (500 ms). Both periods
outlast the handler, so TIM2 runs and is preempted exactly once. The 5 Hz case stays in the
card as the counter-example: a handler that overruns its period starves everything below it.

---

## P23 · 🔴 `--ink-3` fails WCAG AA on every surface, in both themes — **OPEN**

**Where:** [01_head.html:17](roadmap-source/01_head.html#L17), [:52](roadmap-source/01_head.html#L52),
[:61](roadmap-source/01_head.html#L61) (the token itself); ~4,500 call sites

**Rule:** `[Accessibility] Color Contrast` (High) — "Minimum 4.5:1 ratio for normal text".
Measured from the computed styles, not estimated:

| token pair | dark | light | needs |
|---|---|---|---|
| `--ink-3` on `--surface-2` | **3.41:1** | **3.11:1** | 4.5 |
| `--ink-3` on `--surface` | **3.81:1** | **3.32:1** | 4.5 |
| `--ink-3` on `--bg` | **4.24:1** | **2.98:1** | 4.5 |
| `--ink-3` on `--bg-2` | **4.48:1** | **2.76:1** | 4.5 |
| `--accent` on `--bg` | 6.9:1 ok | **4.40:1** | 4.5 |
| `--accent` on `--bg-2` | 6.2:1 ok | **4.08:1** | 4.5 |

**Found by:** the UI/UX + accessibility audit. Every contrast failure in the entire app is this
one token — walking all nine views and every lab stage found **4,504** failing text nodes and
**not one** of a different colour: protocols 2,778 · periph 1,297 · roadmap 356 · practice 32 ·
dash 31 · playground 6 · compile 2 · graph 2 · mosaic 0. Affected classes include `.k`,
`code`, `.kick`, `.addr`, `.sub`, `.bl`, `.lbl`, `.stn`, `.pf-sub`, `.nn`, `.tag`, `.lb`,
`.rev`, `.rname`, `.crumb-lab`, `.notes-empty`, `.topic-visual-head`, `.tv-caption`,
`.pf-openet`, `.pf-stage-tag`, `.glabel`, `.labcap`, `.blank`.

This is the app's *tertiary* ink — the colour for captions, addresses, bit-field annotations and
muted labels — so it is exactly the text a learner squints at. Dark fails every surface; light is
worse, because the same lightness step that reads as "recessed" on `#101A24` reads as "faded" on
`#E9EDF1`. There is **no** hardcoded hex anywhere in the failure set — this is one token value,
which is why it is cheap to fix and impossible to fix piecemeal.

**Fix.** Re-pick `--ink-3` for each theme against the *lightest* surface it lands on
(`--surface-2`), and re-check `--accent` in light. Roughly `#8C9BAA`-ish in dark and a darker
grey in light; then add the pair matrix to a spec so a future palette edit cannot regress it.

---

## P24 · 🔴 Visible labels are not programmatically associated, and 8 controls have no label — **OPEN**

**Rule:** `[Forms] Form Control Labels` (Critical) — "Pair Text label with input";
`Don't: Inputs with placeholder only`.

**Where:** [24_lab_protocols.js](roadmap-source/24_lab_protocols.js) (131 instances across the
12 protocol stages) and [02_body.html](roadmap-source/02_body.html) (11 in the practice view).

Two distinct defects:

1. **Label rendered but not associated** — the protocol lab writes
   `<span class="lbl">ID (hex)</span><input id="pr-can-id" …>` with no `for`, no wrapping
   `<label>`, and no `aria-label`. The visible text is right in front of the control, so it looks
   labelled in a screenshot, but the accessibility tree exposes an unnamed text field.
   Verified live: `document.querySelector('label[for="pr-can-id"]')` → `null`.
   Affected: `pr-char`, `pr-drift`, `pr-type`, `pr-i2c-saddr`, `pr-spi-xbyte`, `pr-can-id`,
   `pr-can-d0`, `pr-can-d1` — [24_lab_protocols.js:411](roadmap-source/24_lab_protocols.js#L411),
   [:451](roadmap-source/24_lab_protocols.js#L451), [:479](roadmap-source/24_lab_protocols.js#L479),
   [:491](roadmap-source/24_lab_protocols.js#L491), [:725](roadmap-source/24_lab_protocols.js#L725),
   [:1367](roadmap-source/24_lab_protocols.js#L1367), [:1548](roadmap-source/24_lab_protocols.js#L1548),
   [:1550](roadmap-source/24_lab_protocols.js#L1550).
2. **No label at all** — the practice view's bit/shift/endian/registers tools put bare inputs
   next to each other with nothing to name them: `tc-val`, `sh-val`, `sh-amt`, `en-val`, `rg-val`
   ([02_body.html:290](roadmap-source/02_body.html#L290), [:297](roadmap-source/02_body.html#L297),
   [:303](roadmap-source/02_body.html#L303), [:316](roadmap-source/02_body.html#L316)), the
   self-check `<textarea class="ivans">`
   ([20_app.js:1702](roadmap-source/20_app.js#L1702)), and `lab-src`
   ([02_body.html:240](roadmap-source/02_body.html#L240)) which is **placeholder-only** — the
   exact anti-pattern the rule names.

By contrast the periph lab is clean: 10/10 stages, **0** unnamed controls. So this is not a
house style — it is two views that were never audited.

**Fix.** Give each `.lbl` a generated `id` and each control a matching `aria-label` (or wrap the
pair in a `<label>`), and add visible labels to the five practice inputs.

---

## P25 · 🔴 `prefers-reduced-motion` only silences CSS; every lab animation is JS-driven — **OPEN**

**Rule:** `[Animation] Respect Reduced Motion` (**Critical**) — "Check reduceMotionEnabled and
simplify animations".

**Where:** [01_head.html:315](roadmap-source/01_head.html#L315),
[:1067](roadmap-source/01_head.html#L1067) (the CSS half);
[23_lab_periph.js:1805](roadmap-source/23_lab_periph.js#L1805),
[24_lab_protocols.js:1966](roadmap-source/24_lab_protocols.js#L1966),
[40_graph.js:197](roadmap-source/40_graph.js#L197),
[20_app.js:1794](roadmap-source/20_app.js#L1794) (the JS half).

There are two reduced-motion blocks and they are both CSS-only: one sets
`animation-duration`/`transition-duration` to `.001ms!important`, the other disables
`.pf-bit.pulse`. That kills five CSS keyframe animations (`grow`, `pulseGate`, `pfb-pulse`,
`pfp-flk`, `prflk`) — and **nothing else**.

All the motion a learner actually perceives is driven by JavaScript timers:

| driver | cadence |
|---|---|
| `setInterval(prTick, PR_TICK_MS)` | advances the protocol playhead 0.34–0.6 s per bit |
| `setInterval(pfTick, PF_TICK_MS)` | advances the peripherals tape and LED states |
| `requestAnimationFrame(loop)` in the graph | rotates the concept graph continuously |
| `setInterval(ivTickTimer, 1000)` | the practice countdown |

A `matchMedia('(prefers-reduced-motion: reduce)')` check appears **nowhere** in the bundle — the
only `matchMedia` call in the entire app is for `prefers-color-scheme: dark`. So a learner who has
asked their OS for reduced motion still gets a bit-by-bit self-advancing playhead, pulsing LEDs and
a spinning graph; the CSS block creates the *appearance* of compliance without the substance.

**Fix.** One shared `prefersReduced()` helper; when true, `prStartTicker`/`pfTicker` render the
final state and do not start, and the graph loop does not begin. The scrubber already exists for
the protocol lab, so the reduced path is "land on the last frame".

---

## P26 · 🟠 The focus ring is removed outright on two controls, with nothing replacing it — **OPEN**

**Rule:** `[Interaction] Focus States` (High) — `Don't: Remove focus outline without replacement`.

The app gets this right almost everywhere — a global
`:focus-visible{outline:2px solid var(--accent)}` at [01_head.html:75](roadmap-source/01_head.html#L75),
plus 20-odd element-specific rings. Walking all 1,548 style rules finds exactly **five** places
that suppress an outline, and three of them are wrong:

| rule | verdict |
|---|---|
| [01_head.html:667](roadmap-source/01_head.html#L667) `.ldscript-edit{outline:0}` | **no replacement** — no `:focus` rule exists for this class anywhere |
| [01_head.html:1238](roadmap-source/01_head.html#L1238) `.pr-termin input:focus{outline:none}` | **no replacement** — `border-color` only, which disappears against a 1px border |
| [01_head.html:693](roadmap-source/01_head.html#L693) `.note-starters button:focus-visible{…outline:none}` | weak replacement (accent text + border colour, no ring) |
| `01_head.html:48` `#content:focus{outline:none}` | fine — `tabindex="-1"` skip target, never user-tabbable |
| `01_head.html:625` `.gnode:focus-visible{outline:none}` | fine — replaced by `.core{stroke:var(--accent);stroke-width:2.6}` |

`.ldscript-edit` is the Linker lab's script editor — the one control in that lab a learner types
into for minutes at a time, and the one where losing the caret position matters most. Because
`.ldscript-edit` (specificity 0,1,0) is authored *after* `:focus-visible` (also 0,1,0), the
suppression wins on source order; the global ring never applies.

**Fix.** Delete `outline:0` from `.ldscript-edit` and let the global ring apply; give
`.pr-termin input:focus` and `.note-starters button:focus-visible` the same 2px accent ring.

---

## P27 · 🟠 Teaching text is rendered at 7.5px in the register and protocol grids — **OPEN**

**Rule:** `[Typography] Base Font Size` (High) — `Don't: Render critical text below 12pt`.

Measured font sizes of every rendered text node, all nine views, all 22 lab stages:

- **7.5px** — `.bl`, the bit labels in the periph register grid: **544** nodes in the periph lab,
  **736** in the protocol lab. Also 8px nodes and 9px `.lbl` wire-bit labels.
- **8.8–10.5px** in the roadmap's inline schematics — `.topic-visual-head` ("8-bit view"),
  `.tv-caption`, `.addr` (memory addresses), `.stage-goals-label` ("by the end of this stage"),
  and the float-format labels (`sign` / `exponent` / `fraction`) at 9px.

To be fair to the design: **body prose is not the problem.** The roadmap's prose, ledes and topic
titles are 14px+, and the histogram shows 1,961 nodes at 14px+ against 3,559 at 11–11.9px — the
sub-12px mass is *annotation inside the diagrams*. But that annotation is not decoration: the bit
numbers under a register, the `sign`/`exponent`/`fraction` labels on an IEEE-754 field diagram and
the `0x0800 0000` memory addresses **are** the content of those visuals. A learner who cannot read
the bit labels cannot read the diagram at all.

**Fix.** Raise the diagram-annotation floor to ~11px (labels may stay smaller than body copy, but
not 7.5px), or make the register grid's bit labels zoom with the browser as body text does.
`font-size` in `px` here is also why browser zoom cannot rescue it — see P27's note in
`features.md`'s constraint list.

---

## P28 · 🟠 Three sticky elements and no `scroll-padding` — focused items can scroll under the header — **OPEN**

**Rule:** `[Accessibility] Focus Not Obscured (Minimum)` (High, WCAG 2.2 SC 2.4.11) — "Offset
sticky UI with scroll-padding"; `[Accessibility] Focus Not Obscured (Enhanced)` is also in the
catalog's required set.

**Where:** [01_head.html:82](roadmap-source/01_head.html#L82) (`header.masthead`, sticky `top:0`,
`z-index:40`), [:145](roadmap-source/01_head.html#L145) (`.stagenav`, sticky `top:52px`,
`z-index:30`), [:628](roadmap-source/01_head.html#L628) (`.gpanel`, sticky `top:72px`).

The stylesheet contains **zero** `scroll-padding` and **zero** `scroll-margin` declarations.
Keyboard focus scrolls the focused element into view; with a 52px masthead plus a sticky stage nav
above it, the element being focused can land underneath both — announced by the screen reader,
invisible on screen, with no way for the user to tell why the page "didn't move".

The app is *partly* protected by luck: `.rail` is a fixed left column and the content is inset by
`--rail: 212px`, so nothing overlaps horizontally. The exposure is vertical, and it is worst in the
labs, where the sticky `.stagenav` sits directly above the focused stage control.

**Fix.** `html{scroll-padding-top:64px}` (masthead + stage nav), and `scroll-margin-top:64px` on
focusable lab controls.

---

## P29 · 🟠 A wrong graded answer is signalled by red alone — **OPEN**

**Rule:** `[Accessibility] Color Only` (High) — "Use icons/text in addition to color";
`Don't: Red/green only for error/success`.

**Where:** [21_lab_compile.js:99](roadmap-source/21_lab_compile.js#L99),
[:103](roadmap-source/21_lab_compile.js#L103);
[22_lab_linker.js:831](roadmap-source/22_lab_linker.js#L831),
[:833](roadmap-source/22_lab_linker.js#L833),
[:857](roadmap-source/22_lab_linker.js#L857)

Across the stylesheet `.correct` and `.wrong` are `border-color` + `color` + `background` +
`outline` — four properties, all of them hue. No glyph, no text, no shape change. For roughly 8 %
of men with a red-green colour vision deficiency, "right answer" and "wrong answer" differ only in
a hue they cannot separate.

The behaviour makes it worse in one place: on a **wrong** multiple-choice answer the explanation
panel is *hidden* (`ans.hidden = !ok`), so a wrong answer produces no text at all — only red.
Correct answers do reveal a sentence beginning "Correct. …", which is why this reads as fine in a
normal review and is invisible in the failure case. The ordering exercises
(`#complab-order`, `linklab-order`, the script-choice row) say nothing at all until the whole
sequence is finished, so every intermediate correct/wrong state is colour-only.

The periph lab already solves this properly and is the in-repo precedent:
[23_lab_periph.js:1426](roadmap-source/23_lab_periph.js#L1426) writes `✓` / `✗` into the row.

**Fix.** Render `✓`/`✗` (or the words) in the graded-choice handlers, and stop hiding the
explanation on a wrong answer — show why the chosen answer was wrong.

---

## P30 · 🟡 The roadmap view is 326 tab stops deep — **OPEN**

**Rule:** `[Interaction] Keyboard Navigation` (High) — "Keep tab order aligned with visual order
and test every action without a pointer".

Each of the 163 topic rows carries two focusable controls:
`<span class="bm" role="checkbox" tabindex="0" title="Bookmark">★</span>` and
`<span class="done-mark" role="checkbox" aria-checked="false" tabindex="0" title="Mark as
learned">✓</span>` — **326** `tabindex="0"` stops in one view, all before the skip link's target
is meaningfully reached. Roles and `aria-checked` are correct; the volume is the problem, and it is
the single biggest keyboard cost in the app. A roving tabindex (one stop per row, arrows to move
within the row) would collapse it to 163.

**Deliberately *not* filed as a defect:** those same 326 targets are 22×22 and 20×20, below the
WCAG 2.5.8 minimum of 24×24 — but the rule's **spacing exception** applies and the app passes it.
Measured centre-to-centre distance is **31px** between `.bm` and `.done-mark` in a row and
**81.2px** between adjacent bookmarks, against the 24px the exception requires. It is worth a spec
rather than a fix: any future tightening of that row's gap would break conformance silently,
because nothing measures it.

**Fix.** Roving tabindex per topic row, plus a spec asserting the ≥24px centre distance.

---

## Cross-check with `todo.md`

**Verified as genuinely done in the code** (not just ticked):

| todo item | verified where |
|---|---|
| §1 CSP | `tauri.conf.json` sets `default-src 'self' … connect-src 'self' ipc: http://ipc.localhost` |
| §2 vendored fonts | `01_head.html` `@font-face` → `fonts/*.woff2`; no googleapis; `build.js` syncs `src/fonts/` |
| §3 URL-quote hole | `inline()` requires scheme- and quote-clean URLs; `specs/markdown_safety.spec.js` |
| §4 native dialogs | `tauri-plugin-dialog` + the four backup commands in `lib.rs`; browser fallback kept |
| §5 linker sandbox math | reserves charged to RAM only |
| §10 storage banner | one-shot `role="alert"` (now via `notice()`) |
| §11 fragment split | `20…25_*.js`, assembled and syntax-checked by the build |
| §12 generated HTML untracked | `.gitignore` lists both generated files |
| §15 CI | `.github/workflows/ci.yml`: specs, lint, version check, build, `cargo test`, `cargo clippy --all-targets -- -D warnings` |
| §16 Rust tests | `toolchain.rs` unit tests for `parse_version` and `interesting_root`; `cargo test` 10 passed, 1 ignored |
| §17 `md()` spec | `specs/markdown_safety.spec.js` covers the whitelist, escaping and scheme/quote-clean URLs |
| §18 lint | `scripts/lint.js`, clean, wired into CI |
| §19 a11y part 1 | the saved-state `.sr-only` live mirror is in `markdownEditor()` |
| §20 `content-visibility` | present with the doc-comment |
| §22 compare-then-reload | implemented in `restoreBackup()` (see P7) |

**Found by this pass:** P1, P2, P3, P4, P5, P6, P7, P8, P9.
**Found while verifying I11:** P10.
**Found by the compilation-path spec:** P11.
**Found by the register-semantics audit and its spec:** P15, P16, P17 (the spec's first run
also re-caught the pin-cell `undefined`, filed inside P17).
**Found by the startup-pseudocode drift guard:** P18.
**Found by the peripherals time-base audit:** P19, P20, P21, P22.
**Found by the UI/UX + accessibility audit against the `ui-ux-pro-max` ruleset** (P23–P30, all
still open): P23, P24, P25, P26, P27, P28, P29, P30.

**Carried forward from `todo.md` into `improvements.md`:** §19's second half (now done) and
§23 (now done).

**What comes next** — content frontiers and engineering ideas — is catalogued in
[features.md](features.md).

---

## The UI/UX + accessibility audit

**Ruleset.** The 119 rules in `ux-guidelines.csv` (4 Critical, 44 High, 62 Medium, 9 Low across
20 categories) plus the 32 in `app-interface.csv`, installed under
[.claude/skills/ui-ux-pro-max/SKILL.md](.claude/skills/ui-ux-pro-max/SKILL.md). Findings carry the
catalog's own severity, not an invented one. Rules that cannot apply to a desktop web app with no
auth, no forms flow, no modals and no images (Accessible Authentication, Back Behavior, Modal
Escape, Safe Area Insets, AI Disclaimer, Spatial UI) are marked not-applicable rather than passed.

**Method.** Not a read-through. The built app was loaded in a browser and every rule that *can* be
decided mechanically was decided against computed values — accessible names walked from
`aria-label`/`aria-labelledby`/`<label for>`/`<label>` wrapper/`title`/text; WCAG contrast computed
from the effective background (walking ancestors for the first non-transparent layer) with the
large-text exemption applied at 24px / 18.66px-bold; focus-ring suppression found by walking all
**1,548** style rules in the CSSOM; font sizes and target boxes read from `getBoundingClientRect`.

**Coverage.** All nine views, and inside the labs every stage — the labs render one stage on
demand, so a single-pass audit would have missed most of the app.

| view | stages walked | unnamed controls | contrast failures | text < 10px |
|---|---|---|---|---|
| roadmap (163 topics) | — | 0 | 356 | 16 (min 8.8px) |
| dash | — | 0 | 31 | 0 |
| mosaic | — | 0 | 0 | 0 |
| graph | — | 0 | 2 | 5 (9.5px) |
| compile | — | 0 | 2 | 5 (9px) |
| playground | — | 0 | 6 | 0 |
| periph | 10/10 | 0 | 1,297 | 882 (min 7.5px) |
| protocols | 12/12 across 5 families | 131 | 2,778 | 1,713 (min 7.5px) |
| practice | — | 11 | 32 | 0 |

**Two candidates were discarded as false positives**, which is the reason to measure rather than
eyeball:

- A pair of `#DCE6EE`-on-`#F0F0F0` "invisible text" hits in the roadmap. The elements measure
  **0×0** and the string `#f0f0f0` appears **nowhere** in the stylesheet — a computed-style
  artifact of collapsed content forced open during the sweep, not a theming bug. Reported as
  nothing.
- 326 targets below 24×24 (the `.bm` / `.done-mark` pair) looked like a hard WCAG 2.5.8 failure.
  Measuring the centre distances showed **31px** within a row and **81.2px** between bookmarks
  against the 24px the spacing exception requires, so the app **passes**. Recorded inside P30 as a
  fragility worth a spec, explicitly *not* as a violation.

**What passed, and is worth keeping:** a correct `viewport` meta and a skip link; a global
2px `:focus-visible` ring with ~20 element-level rings on top; `aria-live="polite"` on seven
regions plus the purpose-built "saved" mirror in `20_app.js`; `role="checkbox"` + `aria-checked` +
`title` on the bookmark/learned marks; the global reduced-motion block; `lang="en"`; no colour
information carried by hue alone in the periph lab's checklist (`✓`/`✗`); and no hardcoded hex in
the whole contrast failure set — which is why P23 is one token rather than 4,500 edits.

**Not yet guarded.** Nothing in `specs/` asserts any of this, so all eight findings can regress
silently. The natural first step is a spec that walks the built HTML and fails on contrast below
4.5:1, on a control with no accessible name, and on a focusable control with no computed outline.

---

## Verification

```
npm test                all green, 19 spec files
                        (backup_roundtrip, boot_ipc, dash_progress, helpers, journal_nav,
                         lab_compile, lab_quiz, linker_sandbox, markdown_safety,
                         note_editor, periph_deadline, periph_model, periph_regs,
                         periph_tape, protocol_model, protocol_stages, rail_nav, read_asm,
                         startup_pseudocode) — 1143 checks
npm run lint            clean (both IIFE scopes, public-API keys, console/TODO/tabs)
npm run build:roadmap   Validation OK: fragments, JavaScript syntax, rail and view
                        targets, journal hosts, quiz answer keys, version
                        single-sourcing, content breakpoints, graph hooks, built HTML,
                        and the 1500 KB HTML size budget (measured 1215 KB)
node scripts/sync-version.js --check    in sync at 1.0.0
cargo test              10 passed, 1 ignored (needs a real ARM toolchain by design)
cargo clippy --all-targets -- -D warnings    clean
```

Negative controls that were actually run, not assumed: dropping a `data-ok`, setting it to
the wrong option, and restoring `dataset.a === "a"` each fail the build or the spec;
re-adding a duplicate `esc()` to `40_graph.js` fails the lint; the node `--check` pass in
`validate_build.js` still catches a syntax error in any fragment. For the protocol pass
(eight more controls): making the CAN bus OR instead of AND fails 3 checks; disabling bit
stuffing fails 2; storing a wrong CRC fails 1; holding SCL high during a stretch fails 1;
sending the ID LSB-first fails 3; reverting the I²C address helper fails 3; reverting the data
helper fails 2; dropping an extra stage and leaking a template hole each fail the stage spec.
For the register-semantics pass (ten more controls, in a scratch directory): restoring the
plain `ISER0 = value` assignment fails 8 checks; making ICER a no-op fails 4; swapping the
BSRR halves fails 4; letting the pull cycle reach the reserved 11 fails 2; emitting the BS
macro for a reset click fails 1; the "reserved in this model" title returns fails 2; the
pin-cell `undefined` interpolation returns fails 1; dropping the CCR row fails 1; unsharing
the peripheral resolver fails 1; clicking a set ISER bit clearing in place fails 1. For the
linker-reader pass, `startup_pseudocode.spec.js` fails if the pseudocode names a call target
or symbol `startup.s` does not have (the `SystemInit` regression is named by its own check),
and `read_asm.spec.js` fails if `asmClassify` is reordered, a decode's line number is moved,
or a Thumb-2 pointer stops naming a real line. For the peripherals time-base pass, **37
negative controls** were run against a scratch copy of `23_lab_periph.js` (pointed at with
`PERIPH_SRC`) and all 37 were caught: the clamped counter step, a dropped remainder, a missing
`T.merged`, the cost un-qualified, the gate grading cadence alone, the band left at 2.6 Hz and
the stage-7 demo left at 5 Hz each fail one or more checks.

Live checks in the running app: the Compile Path `q2` now marks **Compiler wrong** and
**Linker correct**; the Linker lab `m2` marks **Flash .text wrong** and **RAM .bss
correct**; the skip-link is the first tab stop and targets `#content`; all four dashboard
counters carry `aria-live="polite"`; and in the graph, exactly one of the 163 nodes is
tabbable, Arrow keys move focus across and along the stage columns, Enter selects (the side
panel follows) and Escape clears.

For the bench legibility pass (2026-09-30), the Compilation Path was driven in the preview
with a stubbed `__TAURI__` returning a scripted failed build: the stage rail showed
`source:ok preprocess:ok compile:bad` with ✓/✕ marks, the bench head carried the *Lab bench*
badge, the facts panel said "from the fixed example" until a build and "from your bench
build" afterwards, the live note read "gcc -S produced this assembly · failed · your bench
sources", the build landed on **compile** (the first failure), and switching back to Teaching
restored "the fixed example" as the artifact source — proving the bench report no longer
leaks into the teaching stages.
