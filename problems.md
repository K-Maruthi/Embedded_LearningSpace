# problems.md — defects found (fresh audit)

A pass over `roadmap-source/` (fragments, build + validation, lint), the Rust backend,
`specs/`, and repo hygiene, run **after** the audit recorded in `todo.md`. Everything
here is cross-checked against `todo.md` — see [Cross-check](#cross-check-with-todomd) —
so nothing already fixed there is repeated, and each of its completed items was verified
against the code rather than trusted.

Status: **all seventeen are fixed.** Two of them (P8, P9) were found *by the new specs and
lint rules written during this pass*, which is the point of the pass; P10 was found by
tracing the new I11 grading path end to end in the live app; P11 was found by the
compilation-path spec written for the bench legibility pass; P12 and P14 were found by
the stage-render spec written for the protocol pass (P13 by driving a scrub backwards in the
live app); and **P15–P17 were found by a register-semantics audit of the peripherals lab**, 
then caught (and one more, the pin-cell `undefined`, re-caught) by the spec written for the
fix — see [improvements.md](improvements.md) I13.

**In order:** P1 wrong quiz keys · P2 version drift · P3 highlighter · P4 shuffles ·
P5 `window.alert` · P6 duplicate API key · P7 doc/model drift · P8 negative reserve ·
P9 duplicate `esc()` · P10 swallowed goal confirmation · P11 `#define` pluralisation ·
P12 I²C address byte drawn off by one · P13 unreachable "back to live" ·
P14 a bare `undefined` in the protocol map · P15 NVIC set/clear semantics wrong ·
P16 PUPDR unreachable · P17 BSRR/CCR taught but not in the register bank.
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

**Carried forward from `todo.md` into `improvements.md`:** §19's second half (now done) and
§23 (now done).

**What comes next** — content frontiers and engineering ideas — is catalogued in
[features.md](features.md).

---

## Verification

```
npm test                all green, 16 spec files
                        (backup_roundtrip, dash_progress, helpers, journal_nav,
                         lab_compile, lab_quiz, linker_sandbox, markdown_safety,
                         note_editor, periph_model, periph_regs, periph_tape,
                         protocol_model, protocol_stages, rail_nav)
npm run lint            clean (both IIFE scopes, public-API keys, console/TODO/tabs)
npm run build:roadmap   Validation OK: fragments, JavaScript syntax, rail and view
                        targets, journal hosts, quiz answer keys, version
                        single-sourcing, content breakpoints, graph hooks, built HTML,
                        and the 1500 KB HTML size budget (measured 1158 KB)
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
the peripheral resolver fails 1; clicking a set ISER bit clearing in place fails 1.

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
