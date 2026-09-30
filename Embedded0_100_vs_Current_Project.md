# Embedded0_100_vs_Current_Project.md — benchmark audit

**Written:** 2026-09-30 · **Benchmark:** `Embedded0_100.md` (0→100% embedded curriculum, 66 levels + cross-cutting requirements) · **Audited:** this repo at rev 1.0.0 — 163 roadmap topics in 7 stages, 4 labs (Compilation Path + real-compiler bench, Linker & Startup, Peripheral Playground 10 stages, Protocol Lab 12 stages), Practice (interview prep 4 tracks, memory-map lab, fault triage, C tools), graph/mosaic/notes/dashboard, 15 spec files / 774 checks.

**Method.** Every benchmark level was checked against what is *actually in the app* — topic
lists read from `roadmap-source/10…15_*.js` + `1b_data_extensions.js`, the lab curricula,
the interview/fault/c-tools tracks, and the per-topic lens model — not against topic *names*.
The benchmark's own rule is respected: a name appearing in the roadmap does not count as
covered; content, visual, animation, interaction and mastery are judged separately.

**Status legend (from benchmark §81):** ✅ covered · 🟡 partial (exists, lacks depth/visual/
lab/assessment) · 🔴 missing · 🧩 infrastructure exists to support it · 🎯 priority.

---

## 1. Verdict in one paragraph

This project is a **deep but narrow** implementation of the benchmark: it is strongest
exactly where the benchmark's 10-question philosophy lives (compile→link→memory→runtime→
hardware→failure per topic), where it has no real competitor among the levels (L5 C, L6
toolchain, L8 memory, L9 startup, L10 linker, L13 concurrency), and weakest in the
**hardware-peripheral half of the stack** (L3 electronics, L11 partial, L12/L18 partial,
L19 ADC, L20 DMA, L39 power), in **RTOS as a live system** (L24–L27 are one excellent
topic plus interview questions, not a course), and in the **production disciplines**
(L41 bootloader depth, L42 security, L57 calibration is present, L58/L59 present as case
studies but without labs). Cross-cutting requirements the project already *exceeds*: spec
pinned models, negative controls, offline operation, and the strongest "where it bites"
culture in every topic.

Rough coverage by benchmark progression (§74): 0–40% ≈ **85–90% built**; 40–55% ≈ **55%**
(protocols strong, ADC/DMA missing); 55–65% ≈ **45%** (debugging thinking strong, tooling
lab thin); 65–75% ≈ **20%** (RTOS taught, not lived); 75–100% ≈ **25–35%** (awareness-level
topics and case studies, few labs/capstones).

---

## 2. Level-by-level table

| # | Benchmark level | Status | What exists in this project | What's missing / next move |
|---|---|---|---|---|
| 1 | L0 Orientation: what is embedded | 🟡 | No dedicated topics; but `10_data_a` builds the machine model (bits→width→MMIO→clocks), `02_body.html` hero + memory map, and every topic carries real-hardware framing | A 2–3 topic orientation block (MCU vs MPU vs SoC, bare-metal vs RTOS vs Linux, constraint list) is cheap and improves onboarding; an "inside an MCU" interactive diagram |
| 2 | L1 Digital fundamentals | ✅/🟡 | 0.01–0.10: bits/bytes/width, hex, wraparound, two's complement, sign extension, bitwise idioms, shifts (incl. the 3 UB cases), fixed point, IEEE-754, endianness; C tools `pgv-bitlab` (two's complement, shifts, endianness, bit decoder) | Logic gates / truth tables / De Morgan are absent (minor — firmware framing). No binary↔hex *animation*; the bitlab is interactive but static per operation |
| 3 | L2 Electronics essentials | 🟡 | 0.15 Digital signals/GPIO electrical reality; the pin-cell schematic (`pfPinCard`: P-MOS/N-MOS, pull resistors, Schmitt, open-drain); Protocol Lab basics family (push-pull vs open-drain vs input×pull, wired-AND, floating); PUPDR clickable (new) | Voltage/current/Ohm/Kirchhoff absent by design choice; drive strength (`OSPEEDR`), slew rate, input impedance missing; analog is one topic (`analog`); no reset/brownout/power-domain topic; a "diagnose the floating input" *graded* lab exists only inside the periph lab, not as an electronics bench |
| 4 | L3 Computer architecture / Cortex-M | 🟡 | 0.12 fetch/decode/execute, 0.11 flat memory, MMIO, 1b extensions: LDREX/STREX, fault escalation/lockup, MPU PMSAv7/v8; faults triage decodes CFSR/HFSR/MMFAR/BFAR; periph lab teaches NVIC/PRIMASK/IPR live; `5.04` interrupt latency/nesting/priority design | No SysTick/SCB/VTOR/exception-entry-stackframe teaching model (named in memmap only); no single-step CPU/registers lab; no pipeline/branch-cost topic; Thread/Handler mode + MSP/PSP explained only inside latency prose |
| 5 | L4 Embedded C (the "major course") | ✅ **strongest area** | Stages 2–4: ~49 topics — all of 5.1–5.8's fundamentals in stage 2; stage 3 adds UB, implementation-defined/unspecified, strict aliasing, alignment faults, the optimiser contract, volatile second pass, atomicity/RMW, barriers, inline/LTO, weak symbols, restrict, variadics, `_Static_assert`/`_Generic`, opaque types, ring buffers, table-driven state machines, ownership hand-off, cache coherency, error handling; stage 4 adds register access (4.01–4.03: regs/CMSIS overlays/atomic register access) | Deep, lens-complete, quiz'd. Remaining gaps vs the level: flexible array members, anonymous structs/unions (awareness), `_Generic` beyond mention, restrict is one topic with no lab |
| 6 | L5 Toolchain | ✅ | Stage 1 (1.01–1.13): pipeline, preprocessor, compiler internals, assembler/ELF, linker resolution/relocation, linker script, sections, LMA/VMA + boot copy, reset/startup, map file, cross-compilation, debug symbols; **Compilation Path lab** with a real `arm-none-eabi-gcc` bench (per-stage artifacts, objdump/size parsers, map/vector inspection) | Static-library linking and `-l/-L`/include-path mechanics are thin; no ELF *explorer* view (hex/section dump browsing) — the bench shows parsed summaries only |
| 7 | L6 Assembly | 🟡 | `hl()` highlights ARM assembly; the compile lab shows real `gcc -S`/objdump output; `inlineasm` extension topic; several topics' `compile` lenses quote generated ARM | No instruction-by-instruction execution model, no C↔assembly *synchronised* stepper (benchmark's flagship lab for this level); no MRS/MSR/CPSID teaching (CPSID appears as PRIMASK button only); Thumb/Thumb-2 as a concept is not a topic |
| 8 | L7 Memory architecture | ✅/🟡 | Memory map hero (interactive, filters topics), `10_data_a` 0.11/0.14, stack/heap topics, alignment, DMA/cache visibility, MPU topics + faults; linker lab places sections in FLASH/RAM with overflow bars | Stack-overflow *detection* (watermarks/guard) only in prose + case study; no interactive stack-growth/heap-fragmentation animation; EEPROM/retention in one case study only |
| 9 | L8 Startup/reset/boot | ✅/🟡 | 1.10 reset vector & startup, `bootsequence` 5.08, `bootloader` topic, cold-vs-warm reset case study (5.23), NVM/flash-wear 5.09 + power-loss case study (5.18) | No *build-a-minimal-startup* lab; bootloader depth (slots/A-B/validation) is one topic + case study, not L41's update engineering; vector table is inspected in the compile lab but not editable |
| 10 | L9 Linker scripts deep dive | ✅ **strongest lab** | Linker & Startup lab: MEMORY/SECTIONS, drag sections FLASH↔RAM, VMA/LMA, NOLOAD `.bss`, stack/heap reserves, overflow detection, generated script shown, misplacement diagnostics, map-file reading topic — all spec-pinned (`linker_sandbox.spec.js` 29 checks) | Overlays, `KEEP` semantics, custom-section *creation* (vs placement), bootloader partitioning as an exercise — not present |
| 11 | L10 GPIO & digital peripherals | ✅/🟡 | Peripheral Playground stages 2–4 (bits/macros, MODER/OTYDR/PUPDR/IDR/ODR, BSRR atomic, polling), pin-cell schematic, RMW race stage 8, goals graded on live state + behaviour tape | **Debouncing absent** (named in features.md gap analysis), edge detection/EXTI absent, no button-bounce waveform; pin mux (AFR) is prose-only — known, filed in features.md *Peripherals depth* |
| 12 | L11 Timers/PWM/capture | 🟡 | Periph lab stage 5 (PSC/ARR/CNT, update IRQ, draggable ARR line, PWM-as-drawing with real CCR row), goal graded on Hz band; timers topics with the off-by-one (ARR+1) drilled | **No real compare-output channel** (CCMR/CCER), no input capture, no one-shot mode, timer chaining absent — the waveform draws what PWM *would* do (honest, but the lab can't teach capture at all) |
| 13 | L12 Interrupts & exceptions | ✅/🟡 | Periph lab stages 6–7: DIER×ISER×PRIMASK gate table, priority/nesting/preemption, swim-lane timeline, IPR steppers, behaviour-tape grading; `5.04` latency/nesting/priority design; faults triage | **Latency/jitter not measured** anywhere (fixed 400 ms handler, 100 ms ticks — features.md structural gap); no tail-chaining/late-arrival model; SysTick as the canonical first IRQ missing; no "move heavy work out of ISR" exercise beyond prose |
| 14 | L13 Concurrency & races | ✅ **strongest teaching** | `atomicity` 4.x topic, RMW race lab stage 8 (lost-update counter, BSRR fix, replayable), volatile 2nd pass, memory barriers topic, LDREX/STREX extension, ownership hand-off, SPSC ring buffers; interview track drills it | Reentrancy beyond the one topic; lock-free patterns and memory-ordering *models* (acquire/release) are awareness-level; no step-each-instruction race replay (the lab replays at RMW granularity) |
| 15 | L14 UART | ✅/🟡 | Protocol Lab: frame anatomy, sampling/baud-drift slider, terminal with live BRR; `uart` topic with lens model; **no UART register block** (TXE/TC/RXNE/ORE/FE) — wire only, named in features.md gap | FIFO/ring-buffer *driver* lab missing (topic exists, no lab), DMA-UART absent, flow control/RS-485 absent |
| 16 | L15 I²C | ✅/🟡 | Wired-AND, full framed transfer, clock stretching (stage 10) with frozen-bit-counter table; open-drain rationale via pin cell | **Second slave** (address decode deciding ACK) not built — features.md A3; multi-master arbitration and stuck-SDA recovery absent; 10-bit addressing awareness absent |
| 17 | L16 SPI | 🟡 | Protocol Lab: shift ring, CPOL/CPHA modes, real-device flash-read sequence (A4 specced, delivered in map/stages), no-idle-level honesty in the map | Throughput/DMA absent; daisy-chain absent; no "configure flash/display" capstone lab; mode waveforms are drawn but not *inject-and-diagnose* interactive |
| 18 | L17 CAN / CAN FD | ✅/🟡 | Protocol Lab CAN family: differential pair with 120 Ω terminators, dominant/recessive wired-AND, bit-by-bit arbitration with intent table, CRC-15, bit stuffing strip, ACK slot, full 66-bit field-band frame; `can` topic; bus-off recovery case study 5.19 | **Error frames, error counters, bus-off state machine, bit timing/sample point** not in the lab (features.md A2 explicitly open); CAN FD bit-rate switching absent; remote frame awareness absent |
| 19 | L18 ADC/DAC/sensors | 🔴→🧩 | Analog/sampling/aliasing appear only inside other topics (`gpiohw` electrical reality, `float`/`fixedpt` representation, `calibration` 5.10 + case study 5.22) — there is **no dedicated ADC topic** | **No ADC/DAC model, lab, or even topic** — features.md A9, the biggest named hole; no quantization staircase visual, no sensor pipeline |
| 20 | L19 DMA | 🔴 | `busmasters` (0.17, multiple masters), `cachecoherency` (4.x), `iomodes` (4.08 polling/interrupt/DMA tradeoffs), `faultcase-dma` (completion ≠ visibility, cache/ownership) | **No DMA controller model/lab** — features.md A9; no transfer animation, no circular/double-buffer lab; the topic *text* is strong but there is nothing to drive |
| 21 | L20 Watchdog/reliability | ✅/🟡 | `watchdogrecovery` 5.03 (supervisor pattern, windowed awareness, reset cause) + watchdog-kicked-but-dead case study 5.26; reset-cause capture in boot topics | No watchdog *model* in the periph lab (no countdown/missed-kick sim); windowed watchdog is prose; safe-state design is prose |
| 22 | L21 Debugging & observability | 🟡 | **Strong as a discipline, weak as a tool.** Fault triage (17 scenarios with CFSR decode), 12 case studies (5.12–5.26) in ticket format, `diagnostics` 5.06 (fault record, noinit retention), debugging topics in stage 4 | No JTAG/SWD/GDB/OpenOCD workflow lab; no interactive debugger sim (breakpoints/watchpoints); "symptoms-only, request evidence" challenge exists only as static case studies, not interactive; logic-analyzer exists in Protocol Lab only |
| 23 | L22 Build systems & tooling | 🟡 | Cross-compilation topic, real bench pipeline in the compile lab (gcc/objdump/size/objcopy-adjacent), CI for the repo itself (GitHub Actions: specs, lint, clippy) | Make/CMake as *teaching* content absent; GDB absent; addr2line/nm/readelf not exposed; no "debug from symbol/address" lab |
| 24 | L23 Testing embedded | 🟡 | `testing` topic (HIL/fault injection/traceability), `productionreview`, repo practices are exemplary (specs + negative controls + validation contracts) — but that's *the app's* testing, not *taught* testing | No unit-test-your-driver lab, no mock-register exercise, no test-pyramid visual; fault-injection matrix absent as interactive content |
| 25 | L24 RTOS fundamentals | 🔴→🟡 | `rtos` topic + swim-lane CPU timeline in periph lab (preemption visual) + timing-budget topic + OSEK/AUTOSAR-OS prose in 5.02 | **No RTOS lab** — no tasks/tick/scheduler model; features.md A9 names it; the benchmark wants create/block/wake labs |
| 26 | L25 RTOS synchronization/IPC | 🔴 | Priority-inversion named in periph lab stage-7 prose; ownership/queue topics are transferable | No mutex/semaphore/queue models, no inversion or deadlock *animation*, no ISR-to-task notification lab |
| 27 | L26 RTOS timing/design | 🟡 | `timingbudget` 5.01 is genuinely good (WCET, jitter, budget static_assert, deadline chains in case studies) | Rate-monotonic/utilisation math absent; no Gantt/deadline-miss interactive; stack sizing per task is prose |
| 28 | L27 RTOS debugging/production | 🟡 | Case studies cover starvation-adjacent ground (5.25 diagnostics blocking control, 5.26 watchdog) | Trace tools, runtime statistics, queue-overflow labs absent |
| 29 | L28 Embedded architecture | ✅/🟡 | `driverarchitecture` 5.05, `opaque` module boundaries, `ownership`, `errors`/coding standards, layered MCAL/AUTOSAR 5.02, state machines topic | No refactor-a-monolith lab; dependency-inversion as a named principle absent; BSP/middleware boundaries implicit |
| 30 | L29 Driver development | ✅/🟡 | Driver architecture topic + periph lab *is* a driver gym (clock/pin/IRQ sequences, BSRR atomicity, timeout prose) | No progressive driver-building lab (GPIO→UART→…→CAN); DMA/CAN drivers obviously blocked on missing models |
| 31 | L30 State machines | ✅/🟡 | `statemachine` topic (table-driven), bus-off recovery SM (5.19), boot-as-state-machine (5.08), comm recovery | No interactive state-machine editor/validator; hierarchical state machines absent |
| 32 | L31 Protocol engineering (generic) | 🟡 | Protocol Lab teaches framing/CRC/ACK/timeout on 4 real buses; ownership/ordering topics | No design-your-own-protocol lab; sequence numbers/retries/versioning as *generic* layer absent (NVM case study covers versioning) |
| 33 | L32 Diagnostics/UDS | 🟡 | `udsdiag` topic exists (5.x, referenced by 5.25 prereq), `diagnostics` 5.06, DTC-adjacent case studies | No UDS state machine lab, no session/security-access interaction, freeze frames are prose |
| 34 | L33 Automotive foundations | 🟡 | `automotive` 5.02 (MCAL/AUTOSAR/26262), CAN strength, gateway named in memmap graph | LIN absent, automotive Ethernet absent, vehicle-topology visual absent; ignition/power-mode states absent |
| 35 | L34 AUTOSAR | 🟡 | 5.02 covers Classic layers, RTE, BSW, MCAL, OS, ISO 26262 constraints with a strong trap lens | ARXML/runnable/ports/sender-receiver-interface mechanics absent; no trace-a-signal-through-the-stack lab; Adaptive absent |
| 36 | L35 Memory safety & defensive C | ✅/🟡 | UB topic, alignment faults, heap/fragmentation, faults triage incl. null/MPU-guard scenario, stack-overflow case study 5.17 | Use-after-free/double-free/format-string topics absent (heap is taught but the *bug gallery* isn't); no memory-corruption animation |
| 37 | L36 UB & C pitfalls | ✅ | Dedicated UB topic + implementation-defined/unspecified + strict aliasing + shifts-UB + evaluation order + the bitlab that *demonstrates* several | Compiler-freedom flow visual (§36's diagram) not materialised per bug; an "is this defined?" drill bank would fit the existing quiz contract |
| 38 | L37 Compiler optimization | ✅/🟡 | `optimiser` topic (what it may do), `volatilek` second pass, `-O0/-O2` diff panel in C tools (`pgv-diffs`), real bench builds in compile lab | Inlining/CSE/register-allocation as *named* transformations absent; no volatile-misconception graded exercise beyond the topic quiz |
| 39 | L38 Performance engineering | 🟡 | timingbudget, DMA/cache visibility, flash wait states in prose, compile-lab size readouts | No utilisation/jitter dashboard, no flame/timeline visual, no optimize-under-constraints lab |
| 40 | L39 Power management | 🔴→🟡 | `lowpower` interview track exists; clock-gating taught live in periph lab (the whole RCC stage) | Sleep/deep-sleep/wake sources/retention/`PWR_CR` all absent — features.md gap; current-consumption visual absent |
| 41 | L40 Firmware security | 🔴 | Nothing. MPU guard-at-zero appears in faults triage; debug-port security not mentioned | Threat model/secure boot/signatures/rollback all absent; benchmark flags this as a check-first gap and it is |
| 42 | L41 Bootloader/update | 🟡 | `bootloader` topic + `bootsequence` + NVM record-update case studies (power-loss, schema versioning) — the *reliable-record* half is strong | Slots/A-B/image validation/signature/rollback as a system absent; no update state machine lab; blocked partially by no flash-write model |
| 43 | L42 Logging/telemetry | 🟡 | `diagnostics` 5.06 (bounded fault record, ring buffers topic), event log + behaviour tape in periph lab are live examples | Logging levels, binary log decode, rate limiting, bandwidth tradeoffs absent as content |
| 44 | L43 Time & clocks | 🟡 | Clocks/reset topic 0.16, clock-tree card in periph lab (HSI→SYSCLK→gates), 1 kHz scaled clock model, wraparound-safe time arithmetic in tick topics | HSE/PLL/prescaler tree depth absent (features.md gap); RTC absent; drift/monotonic-time topic thin |
| 45 | L44 Data structures for embedded | ✅/🟡 | `ringbuf` topic (ring buffers + SPSC queues), pools via `safetymechanisms` prose, bitmaps via register idioms everywhere | No labs for each structure under fixed memory; linked-list tradeoffs, state tables partially covered |
| 46 | L45 Algorithms for embedded | 🟡 | Fixed-point, filtering mentions, CRC-15 *implemented* in CAN, checksum/parity in UART | Moving average/median/threshold labs absent; no benchmarking-under-constraints lab |
| 47 | L46 Signal processing | 🔴→🟡 | Aliasing awareness, debounce prose, calibration scaling | Nyquist/filtering/hysteresis/fusion absent as topics; blocked on ADC |
| 48 | L47 Real-time systems engineering | ✅/🟡 | timingbudget + interruptlatency + endtoend + deadline-miss case study — the *reading* is complete | No measurable-guarantees capstone; no latency histogram/jitter distribution visual; blocked on cost model (features.md #1) |
| 49 | L48 Safety engineering | 🟡 | 5.02 (26262, ASIL, freedom from interference), safetymechanisms topic, watchdog/case studies, MPU containment case study | Fault tree / failure-propagation visuals absent; diagnostic-coverage math absent; safety-goal exercise absent |
| 50 | L49 Quality & engineering practice | ✅/🟡 | `errors`/coding standards topic, MISRA named, traceability chain in productionreview 5.14 | Static analysis as a *tool* (cppcheck/clang-tidy) not shown; requirements-traceability visual absent; repo itself models CI but doesn't teach it |
| 51 | L50 Hardware bring-up | 🔴 | Periph-lab stage 9 ("cold start, no net" bring-up) is the closest thing and it's excellent — but it's one MCU, fully known | Unknown-board bring-up from schematic/datasheet absent; oscilloscope/multimeter use absent; the debugger-loop idea in features.md is the seed |
| 52 | L51 Datasheet/manual reading | 🔴→🧩 | Every lab *uses* register semantics honestly (access types, W1C, write-1-to-set, reserved) — the new "not wired in this model" hover is the right instinct | No "find the answer in the manual" challenge format, no real-register-description exercises, errata awareness absent |
| 53 | L52 HW/SW boundary | ✅ **newly strong** | Post P15–P17: ISER write-1-to-set / ICER write-1-to-clear+WO, BSRR WO atomic halves, W1C SR, read-only IDR/CNT, dropped-writes-when-unclocked, honest reserved/unwired bits, RMW hazards | Sticky flags and read-side-effects (e.g. read-to-clear DR) not modelled; synchronization-delay (write→visible) absent |
| 54 | L53 Protocol debugging | ✅/🟡 | Protocol Lab's scrubber/log/arbitration traces + "first divergence" teaching in race/case studies | The 9-step configure→capture→decode→diverge loop is not a formal interactive per protocol; no expected-vs-actual overlay |
| 55 | L54 Advanced comms (LIN/ETH/SOME-IP) | 🔴 | Awareness mentions only (gateway topic) | All absent; fine to defer — but benchmark lists it; LIN is the cheapest (single-wire, master/slave) |
| 56 | L55 Distributed systems | 🟡 | CAN multi-node arbitration (2 nodes), bus-off/timeout case studies, gateway prose | >2-node sim, lost/delayed message injection, heartbeat/watchdog-over-network labs absent |
| 57 | L56 Configuration/codegen | 🟡 | AUTOSAR config-as-code prose; the app's own build.js is a live example | Generator→code→build pipeline as content absent; feature-flag/calibration-as-config split thin |
| 58 | L57 Calibration | ✅/🟡 | `calibration` 5.10 + case study 5.22 (scaling, plausibility, units, versioning) — genuinely complete for a topic | Parameter-store-with-rollback lab absent (NVM record case study is the closest) |
| 59 | L58 Production firmware | 🟡 | `productionreview` 5.14, case studies, reproducible-build-adjacent CI in repo | Manufacturing/end-of-line/self-test content absent; release-artifact story thin |
| 60 | L59 Production failure analysis | ✅/🟡 | The 12 case studies **are** this level done as tickets (5.12–5.26) | Not interactive: no evidence-requesting mechanic; version-correlation/capa mechanics absent |
| 61–62 | L60–61 Interview fundamentals + explanation training | ✅ **strong** | Interview prep: 4 tracks × junior/senior × defect/predict/explain/design, rubric scoring per lens, timer; every topic has `q.ask/q.ans`; notes gate forces writing | No 30s/60s/3min/10min graduated self-explain recorder; no whiteboard-canvas export; coverage report exists (ivCoverage) but no longitudinal training log (features.md B7) |
| 63 | L62 System design problems | 🟡 | endtoend 5.07 + design lens on every topic + interview design questions | No full design problems (sensor ECU, gateway, logger) as exercises with constraints/tradeoff grading |
| 64 | L63 Full debugging challenges | ✅/🟡 | Fault triage (evidence→options→explain) + 12 ticket case studies | Not interactive-hypothesis-driven: you can't *ask* for more evidence; timeline/registers/waveform aren't linked views; UART-30s-corruption style scenarios exist as prose only |
| 65 | L64 Capstones | 🔴 | Stage 9 bring-up + periph/protocol goals are micro-capstones | No 6 capstone projects; several are blocked on ADC/DMA/RTOS models; bare-metal capstone (startup/GPIO/timer/IRQ/UART/SM/watchdog) is *reachable now* with existing models except UART driver + watchdog sim |
| 66 | Visual/animation requirements (§66) | ✅/🟡 | 16 of the benchmark's 17 visual primitives exist somewhere: waveforms (3 renderers), field bands, swim lanes, memory map, register/bitfield views, state machines (SVG), timelines, packet anatomy, bus topology, cause→effect chains, graphs | Missing: data-flow animation (DMA — blocked), before/after *split-view* (diffs panel is textual), error-replay as a formal control (scrubber is 80% there), synchronized code↔signal↔register multi-view (the app does code+registers, and signal separately) |
| 67 | Universal Trace Mode (§67) | 🟡 | Your-code panel reverse-engineers clicks→C (periph lab); compile lab traces source→assembly→ELF; protocol lab traces wire→frame→decision | Not unified: no single "trace `UART->DR = b`" cross-layer stepper; each lab traces its own slice. This is the benchmark's north-star (§84) and the app's biggest *experience* gap |
| 68 | Universal Failure Mode (§68) | ✅/🟡 | Expected/actual/first-divergence/root-cause/evidence/fix/regression is literally the structure of the case studies and of problems.md culture; labs grade "make it fail" (lost update ≥1, goal 8) | Not formalised as a reusable UI frame; regression-verification step lives in repo practice, not learner practice |
| 69 | Universal Compare Mode (§69) | 🟡 | `pgv-diffs` compiler diffs; race: racy vs BSRR button; protocols: receiver-absent vs ACK variants; polling vs interrupt prose | No first-class compare UI (side-by-side timelines); most pairs are prose, not toggleable |
| 70 | Explain-it-yourself gate (§70) | 🟡 | Notes 12-word gate before "learned" + interview explain format + A8 (recall gate) specced in features.md | Not rubric-graded (word count ≠ understanding); A8 is the existing fix, unbuilt |
| 71 | Assessment system (§71) | ✅/🟡 | Graded quizzes with data-ok keys, goal predicates over live state (state AND behaviour), fault triage MCQs, interview rubrics, 12-word note gate | Missing types: drag/drop, waveform-decode challenges (the scrubber could grade), timing calculations, code-writing/correction, diagram completion |
| 72 | Spaced repetition (§72) | 🧩→🔴 | `cards()` API returns all q/a + learned state + timestamps; heatmap stores dates; A6 specced in features.md | **Not built** — dormant API, acknowledged |
| 73 | Knowledge graph (§73) | ✅ | Graph view with prereq/failure-pattern/related/mention edges, 163 nodes, keyboard traversal, clusters; per-topic prereq chains + related links | Interview-question and project edges absent; no volatile-style hub visual (but related links approximate it) |
| 74 | Learning progression (§74) | ✅/🟡 | Stage 0→6 ordering matches 0–40% of the benchmark almost exactly; labs map to 40–55% | Progression beyond 55% has no guided path — topics exist scattered in stage 5; no "track" concept bundling RTOS/security/bootloader into the 65–100% bands |
| 75 | Mastery gates (§75) | 🟡 | Gates 1 (explain: lenses), 2 (predict: quizzes), 3 (implement: labs' goals), 4 (observe: scrubber/tape/log), 5 (debug: fault triage/case studies) exist per-lab | Gates 6 (design) and 7 (teach) only via interview; gate 8 (integrate) missing wholesale; no cross-lab mastery record (dashboard counts goals, doesn't gate) |
| 76–77 | Lesson template & quality (§76–77) | ✅ | Every topic: kick (hook) → 8 lenses (mental model→…→failure) → src code → q/recall — an 80% match to the 20-step template | Missing per-topic: animation (topic-attached visuals exist but not all animated), mini-lab, failure *injection*, interview-question attachment (lives in the separate track) |
| 78 | Visual coverage checklist (§78) | ✅/🟡 | Labs exceed it (inspect/change/inject/trace all present); roadmap topics have visuals but not per-topic inject/trace | Roadmap topics are read-mode: can't inject a failure into 0.07's shift topic from the page (bitlab partially covers) |
| 79 | Engineering coverage checklist (§79) | 🟡 | Init/config/operation/concurrency/errors/diagnostics taught per subsystem in stage 5 + labs | Timing/concurrency *per driver* not interactive; testing/production considerations are prose |
| 80 | Final 100% competency (§80) | 🟡 | Items 1–14, 17–19, 22 (partially), 31 strongly supported; 15–16, 20–21, 23–30 partially (prose/case-study only) | Can't yet hand someone "an unfamiliar board + failing build" — no hardware-facing surface; simulation-only by design (offline constraint) |

---

## 3. The benchmark's 30 "likely high-value gaps" (§82), checked

| Gap (§82) | Status here | Note |
|---|---|---|
| 1 Full C progression | ✅ | Project's core strength |
| 2 CPU architecture depth | 🟡 | Missing SysTick/SCB/stackframe/exception-entry models |
| 3 Assembly ↔ C synchronized execution | 🔴 | Compile lab shows artifacts, not a synced stepper |
| 4 Datasheet/manual training | 🔴 | Registers taught honestly, but no manual-reading drills |
| 5 Hardware bring-up | 🟡 | Stage 9 bring-up + debugger-loop idea; no unknown-board exercise |
| 6 ADC/DAC/sensors | 🔴 | Topic prose only; features.md A9 |
| 7 DMA | 🔴 | Topic prose + case study; features.md A9 |
| 8 CAN/CAN FD | ✅ (CAN) / 🔴 (FD) | Lab is strong; FD + error handling open (A2) |
| 9 RTOS fundamentals | 🔴 | Topic + prose; A9 |
| 10 RTOS synchronization | 🔴 | Same |
| 11 Real-time scheduling | 🟡 | timingbudget good; no scheduler lab |
| 12 Debugging methodology | ✅/🟡 | Case studies + triage; not interactive-hypothesis |
| 13 JTAG/SWD/GDB workflow | 🔴 | Absent by design (offline sim); a *simulated* debugger is the features.md ask |
| 14 Testing/HIL/fault injection | 🟡 | Taught, not practised |
| 15 Driver architecture | ✅ | Topic + labs |
| 16 State-machine engineering | ✅/🟡 | Topic + SMs in case studies |
| 17 Bootloader/update | 🟡 | NVM half strong, slots/signature absent |
| 18 Security | 🔴 | Absent |
| 19 Power management | 🔴 | Absent beyond clock gating |
| 20 Diagnostics/UDS | 🟡 | udsdiag topic; no interactive session |
| 21 AUTOSAR | 🟡 | 5.02; no mechanics |
| 22 Safety/ISO 26262 | 🟡 | Awareness present; no fault-tree/coverage work |
| 23 Compiler optimization | ✅/🟡 | Topic + diffs panel + real bench |
| 24 Undefined behavior | ✅ | Dedicated topics + bitlab demos |
| 25 Production firmware engineering | 🟡 | Case studies + review topic |
| 26 System design | 🟡 | Design lens + interview; no full problems |
| 27 Full capstone projects | 🔴 | None (micro-capstones only) |
| 28 Interview explanation training | ✅ | Track + rubrics; graduated explain missing |
| 29 Spaced repetition | 🧩 | API dormant; A6 |
| 30 Cross-layer Trace Mode | 🟡 | Per-lab tracing; not unified (§67) |

---

## 4. Product-level feature benchmark (§83), project vs checklist

| Area | Present | Missing |
|---|---|---|
| Learning | curriculum, prereq graph, bookmarks, notes, recall cards (q/ans), search, lens mode | adaptive progression, spaced repetition (API dormant), mastery gates, guided tracks beyond stage order |
| Visual learning | waveforms ×3 renderers, field bands, memory map, register/bitfield views, swim lanes, state machines, graph/mosaic, clock tree, pin schematic | DMA/pipeline flows, synchronized code↔signal↔register multi-view, before/after split views, animation attached to *topics* (vs labs) |
| Hands-on | real compiler bench (edit→build→inspect), linker drag-place, full register sim with fault-grade behaviour tape, 4-protocol logic analyser with scrubbing/injection, bitlab, fault triage | debugger sim (step/breakpoint/watch), ADC/DMA/RTOS sims, driver-building progression, waveform-decode challenges, code-writing exercises |
| Assessment | data-ok quizzes, live-state + behaviour goals with hints, fault triage, interview rubric/coverage, notes gate | drag/drop, timing calculations, waveform decode grading, code correction, capstones, rubric-graded self-explanation (A8) |
| Engineering | 15 specs/774 checks, negative controls, build validation contracts (rail↔view, quiz keys, size budget), CI, clippy, offline, import/export + compare-then-reload, a11y passes, version single-sourcing | automated mutcheck (E1), artifact fingerprint (E2), public-API contract file (E4), boot smoke test (E6) — all already catalogued in features.md |

The **engineering row is the project's differentiator**: it already meets the benchmark's
"reproducible/specs/regression/negative-controls/offline/backup" checklist more completely
than any content level.

---

## 5. What to build next (merged priority, benchmark value × project fit)

The benchmark confirms the existing features.md order and adds five items above it:

1. 🎯 **Cost/time base in the peripherals lab** (features.md #1; unlocks L12 latency, L26
   scheduling, L38 performance, L47 capstone — four levels at once).
2. 🎯 **SysTick then EXTI+debounce** (L3, L11, L12; cheapest new peripherals with the
   widest teaching blast radius; EXTI also fixes the missing button-bounce waveform).
3. 🎯 **DMA model, then ADC** (L19, L18; unlocks faultcase-dma from prose to lab and the
   sensor→DMA→ISR→control chain in 5.07 end-to-end).
4. 🎯 **RTOS minimal lab** (tasks/tick/queue/mutex with priority-inversion replay) —
   L24–L27 are the largest single status jump available (🔴→✅ in four levels).
5. 🎯 **Spaced repetition from `cards()`** (A6, dormant API, §72, cheapest product win).
6. 🎯 **Watchdog + UART register-block models** (L20, L14; watchdog completes the bare-metal
   capstone list; TXE/RXNE/ORE turns the protocol wire knowledge into driver knowledge).
7. Security block (L40) — a *concept* level (secure boot chain, threat model) is teachable
   without new sims; decide whether it's in scope for this product.
8. Unified **Trace Mode** (§67/§84) — a cross-lab "C→register→signal→frame" stepper is the
   north-star experience; the periph lab's Your-code panel + protocol scrubber are its two
   halves; prototype by linking them on one stage (timer PWM stage is the best candidate).
9. **Interactive debugging challenges** (L63): turn 3 of the 12 static case studies into
   evidence-requesting scenarios (they already have the data: regs, decode, timeline).
10. **Capstone 1 (bare-metal)** is buildable once watchdog exists — compose existing lab
    models into a graded project view rather than new tech.

**Not worth chasing** (benchmark lists them; this product's constraints argue against):
real GDB/JTAG/SWD integration (breaks offline + CSP + zero-dependency constraints),
hardware-in-loop, Linux/MPU-side content, AUTOSAR tooling mechanics, automotive Ethernet —
all better served by awareness topics than labs.

---

## 6. Counts

| Status | Levels | Notes |
|---|---|---|
| ✅ Covered (or ✅/🟡) | 17 | L1, L4, L5, L6, L8, L9, L10, L11, L13, L14, L15, L17(CAN), L20, L28, L35, L36, L37, L43, L44, L45, L57, L60–61, L73 — counting the split verdicts |
| 🟡 Partial | 24 | incl. L0, L2, L3, L7, L12, L16, L21–L23, L26–L27, L29–L34, L38–L39, L41–L42, L46, L48–L54, L55–L56, L58–L59, L62–L64, L74–L79 |
| 🔴 Missing | 9 | ADC/DAC (L18 lab), DMA (L19), RTOS ×3 (L24–L25, L27 lab), power (L39), security (L40), bring-up (L50), datasheet drills (L51), capstones (L64), advanced comms (L54) |
| 🧩 Infrastructure-ready | 2 | spaced repetition (cards API), recall gate (notes/quiz rails) |

**Bottom line.** Against this benchmark the project is a **top-decile 0–55% course with a
research-grade engineering harness**, whose fastest route to "0→100" credibility is not
more breadth of prose but five **live models** (time base, SysTick/EXTI, DMA, ADC, RTOS
kernel) that each unlock an entire benchmark level — which is the same conclusion the
project's own peripherals-depth analysis reached independently. That convergence is the
audit's most actionable finding: the benchmark's §82 priority list and features.md's build
order agree on items 1–5 almost one-for-one.
