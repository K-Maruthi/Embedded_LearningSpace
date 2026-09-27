<script>
var TRACKS = [
  {k:"baremetal",  label:"Bare-metal / BSP"},
  {k:"rtos",       label:"RTOS / concurrency"},
  {k:"automotive", label:"Automotive / safety"},
  {k:"lowpower",   label:"Low power / IoT"}
];
var LEVELS = [{k:"junior", label:"Junior"}, {k:"senior", label:"Senior"}];
var FORMATS = [
  {k:"defect",  label:"Defect hunt"},
  {k:"predict", label:"Predict it"},
  {k:"explain", label:"Explain it"},
  {k:"design",  label:"Design it"}
];

var INTERVIEW = [

/* ---------------- bare-metal / BSP ---------------- */
{id:"iv-bm1", track:"baremetal", level:"junior", format:"predict",
prompt:"What does this print, and why, on a Cortex-M with no FPU?",
code:"float x = 1.0f;\nfor (int i = 0; i < 100000; i++) x += 0.0001f;\nprintf(\"%d\\n\", (int)x);",
rubric:[
  {lens:"idea", pt:"Recognises this is floating-point accumulation, not integer arithmetic"},
  {lens:"compile", pt:"With no FPU, each += is a call into a software float library, not one instruction"},
  {lens:"run", pt:"Explains the result is not exactly 11: rounding error accumulates over 100000 additions"},
  {lens:"hw", pt:"Notes the cost: this loop is orders of magnitude slower than an integer equivalent on a part with no FPU"}
],
modelNote:"The value printed is close to 11 but not exactly, because each addition rounds to the nearest representable float and those errors accumulate. The bigger interview point is cost: with no FPU this is ~100000 software floating-point calls, which is a real red flag in a control loop with a hard deadline."},

{id:"iv-bm2", track:"baremetal", level:"junior", format:"defect",
prompt:"This waits for a UART flag set by an ISR. It hangs. Find the bug.",
code:"bool rx_ready;\n\nvoid USART_IRQHandler(void) { rx_ready = true; }\n\nvoid wait_byte(void) {\n    while (!rx_ready) { }\n    rx_ready = false;\n}",
rubric:[
  {lens:"idea", pt:"Identifies the missing volatile on rx_ready"},
  {lens:"compile", pt:"Explains the compiler is free to load rx_ready once and keep it in a register across the loop, since nothing in this translation unit writes it"},
  {lens:"run", pt:"Connects this to why it hangs specifically at -O1 and above, and may appear to work at -O0"},
  {lens:"trap", pt:"Does not stop at volatile alone — notes it still is not atomic, though a bool read/write here is fine on a 32-bit core"}
],
modelNote:"rx_ready needs volatile. Without it, the compiler sees no write to the variable inside wait_byte and is entitled to hoist the read out of the loop entirely, producing an infinite loop at any real optimisation level."},

{id:"iv-bm3", track:"baremetal", level:"senior", format:"defect",
prompt:"A GPIO toggle from an ISR occasionally fails to take effect. The register write is right there in the code. What's the actual failure?",
code:"void EXTI_IRQHandler(void) {\n    GPIOA->ODR ^= (1u << 5);\n    EXTI->PR = EXTI_PR_PR0;\n}",
rubric:[
  {lens:"hw", pt:"Suspects the write buffer: the store may not have reached the peripheral before the handler returns"},
  {lens:"run", pt:"Explains that if the pending flag write also races the buffer, the same interrupt can re-fire immediately"},
  {lens:"idea", pt:"Names DSB (or a read-back) as the fix, not more volatile"},
  {lens:"trap", pt:"Also flags ODR ^= as a read-modify-write: if anything else touches ODR concurrently this is a lost-update bug independent of the buffering issue"}
],
modelNote:"Two separate issues live in three lines. First, the toggle is a read-modify-write on a shared register — safer as a BSRR-style atomic set/clear if the hardware offers one. Second, neither write is guaranteed to have landed on the peripheral before the ISR returns; a DSB (or reading the register back) closes that gap."},

{id:"iv-bm4", track:"baremetal", level:"senior", format:"explain",
prompt:"Walk through, in order, everything that happens between reset and the first line of main on a Cortex-M part.",
rubric:[
  {lens:"hw", pt:"Core loads SP from vector[0] and PC from vector[1] directly from hardware, no software involved yet"},
  {lens:"run", pt:"Startup code: clock configuration (usually still on the internal oscillator at this point), then copy .data from flash to RAM, then zero .bss"},
  {lens:"compile", pt:"Mentions static constructors / __libc_init_array if the toolchain uses one"},
  {lens:"mem", pt:"Notes that any global touched before the .data copy and .bss clear complete is not yet guaranteed valid"},
  {lens:"trap", pt:"Flags what breaks this: a custom linker section left out of the copy or clear loop"}
],
modelNote:"Vector table gives SP and PC in hardware. Reset_Handler then does clock setup, copies .data, zeroes .bss, runs any static initialisers, and branches to main. Every one of those steps is ordinary C or assembly that a mistake in the linker script can silently skip."},

{id:"iv-bm5", track:"baremetal", level:"junior", format:"predict",
prompt:"Two files. What happens at link time, and why?",
code:"/* a.c */\nint state;\n\n/* b.c */\nextern float *state;\nvoid use(void) { *state = 1.0f; }",
rubric:[
  {lens:"link", pt:"Recognises the linker matches by name only, not by type — this links successfully"},
  {lens:"trap", pt:"Explains the run-time consequence: b.c reads the 4 bytes of the int as if they were a pointer and writes through it"},
  {lens:"mem", pt:"Notes this is exactly the array-vs-pointer extern mismatch, generalised to any type mismatch across a declaration boundary"}
],
modelNote:"It links cleanly — the linker only checks names. At run time, use() treats the bit pattern of the int as an address and writes a float there, which is memory corruption with no diagnostic anywhere in the toolchain."},

{id:"iv-bm6", track:"baremetal", level:"senior", format:"design",
prompt:"Specify a driver for a UART receiving at 1 Mbaud on a part with 4 KB of RAM. What do you actually build?",
rubric:[
  {lens:"design", pt:"Chooses interrupt-driven or DMA over polling, and can justify the choice against the byte interval (10 us at 1 Mbaud)"},
  {lens:"mem", pt:"Sizes a ring buffer as a power of two and explains why (mask instead of modulo)"},
  {lens:"run", pt:"Addresses overrun: what happens when the buffer is full and a byte still arrives"},
  {lens:"hw", pt:"For DMA: says which RAM the buffer must be in and that it's a second bus master"},
  {lens:"trap", pt:"Names the single-producer/single-consumer constraint and what breaks it"}
],
modelNote:"At 1 Mbaud a byte arrives every 10 microseconds, so pure interrupt-per-byte overhead is worth costing out; DMA into a power-of-two ring buffer with an idle-line or half/full-transfer interrupt is the usual answer on a part this small. State the overrun policy explicitly rather than leaving it implicit."},

{id:"iv-bm7", track:"baremetal", level:"junior", format:"explain",
prompt:"Why does const on a large lookup table matter on a microcontroller specifically?",
rubric:[
  {lens:"mem", pt:"States plainly: const moves the object from .data/.bss to .rodata"},
  {lens:"hw", pt:"Explains .rodata lives in flash and is never copied to RAM"},
  {lens:"trap", pt:"Gives the concrete failure: drop the const and a table that fit now costs RAM it may not have"}
],
modelNote:"const isn't just a promise not to write through this pointer — for a file-scope definition it moves the object into flash-only storage, so a large table costs zero RAM instead of costing RAM plus the flash to initialise it."},

{id:"iv-bm8", track:"baremetal", level:"senior", format:"defect",
prompt:"This bootloader jump compiles, flashes, and the application immediately hard-faults. Find at least two problems.",
code:"typedef void (*app_t)(void);\n\nvoid jump_to_app(uint32_t addr) {\n    app_t app = (app_t)addr;\n    app();\n}",
rubric:[
  {lens:"hw", pt:"Notes MSP is never set from the application's vector table before the jump"},
  {lens:"idea", pt:"Notes VTOR is never updated, so interrupts still dispatch through the bootloader's table"},
  {lens:"trap", pt:"Notes the entry point should come from the application's own vector[1], not from calling addr itself as code"},
  {lens:"design", pt:"Would add a sanity check on the stack pointer and entry address before jumping at all"}
],
modelNote:"This calls the base address as if it were the entry point, when it should read the initial SP and PC from the application's own vector table, set MSP, set VTOR, and only then branch — with interrupts disabled across the whole handover."}
];

INTERVIEW.push(

/* ---------------- RTOS / concurrency ---------------- */
{id:"iv-rt1", track:"rtos", level:"junior", format:"explain",
prompt:"Why can't a plain global counter be safely incremented from both a task and an ISR?",
rubric:[
  {lens:"idea", pt:"Names the operation as read-modify-write, not a single instruction"},
  {lens:"run", pt:"Describes the interleaving: the ISR can land between the task's load and store, and vice versa"},
  {lens:"trap", pt:"Notes volatile does not fix this — it only stops caching, not atomicity"}
],
modelNote:"counter++ is load, add, store. If the ISR runs between the load and the store of the task's copy, one increment is lost. volatile stops the compiler caching the value but does nothing about the three-instruction window."},

{id:"iv-rt2", track:"rtos", level:"senior", format:"defect",
prompt:"A low-priority logging task occasionally blocks a high-priority control task for tens of milliseconds, far longer than the logging task's own work. What's happening and what's the fix?",
rubric:[
  {lens:"idea", pt:"Names priority inversion specifically, not just 'blocking'"},
  {lens:"run", pt:"Explains the mechanism: a medium-priority task preempts the low-priority mutex holder, extending the high-priority task's wait indefinitely"},
  {lens:"design", pt:"Names priority inheritance and asks whether the kernel's mutex (not a semaphore) is actually in use"},
  {lens:"trap", pt:"Flags semaphore-as-mutex as a common root cause, since a semaphore has no owner to boost"}
],
modelNote:"This is priority inversion: the high-priority task waits on a mutex held by a low-priority task, and a medium-priority task freely preempts the holder in between. The fix is a real mutex with priority inheritance, not a binary semaphore standing in for one."},

{id:"iv-rt3", track:"rtos", level:"junior", format:"predict",
prompt:"A task declares a 2 KB local array and calls a function that itself uses 1 KB of locals, from inside a 512-byte-stack task. What happens, and when?",
rubric:[
  {lens:"mem", pt:"States the total exceeds the task's stack well before either object is 'used'"},
  {lens:"run", pt:"Describes the failure as silent corruption of whatever is adjacent, not a clean error, unless a guard region exists"},
  {lens:"trap", pt:"Notes the timing: it may not fail on the exact line, but on whichever access lands after the overflow"}
],
modelNote:"3 KB of stack demand against a 512-byte stack overflows immediately on entry to the nested call, overwriting whatever memory sits next — commonly the neighbouring task's stack or control block. Without an MPU guard region the symptom shows up elsewhere, later."},

{id:"iv-rt4", track:"rtos", level:"senior", format:"design",
prompt:"Design the handoff of a sensor sample from an ADC ISR running at 1 kHz to a control task, with no dynamic allocation.",
rubric:[
  {lens:"design", pt:"Proposes double buffering or a lock-free single-slot handoff over a mutex, given the producer is an ISR"},
  {lens:"mem", pt:"Publishes the new data via a single aligned word (an index or a pointer swap), not the struct itself"},
  {lens:"hw", pt:"Notes the atomicity of that single word on a 32-bit core is what makes it safe without disabling interrupts"},
  {lens:"trap", pt:"Explicitly rules out a mutex taken inside the ISR"}
],
modelNote:"Double-buffer the sample, have the ISR fill the inactive buffer and then publish by writing a single index or pointer — an operation that is atomic on its own on a 32-bit core, needing no critical section on the consumer side."},

{id:"iv-rt5", track:"rtos", level:"junior", format:"explain",
prompt:"What's the difference between a mutex and a binary semaphore, and when does the difference actually matter?",
rubric:[
  {lens:"idea", pt:"States ownership: a mutex has an owning task, a semaphore does not"},
  {lens:"run", pt:"Connects ownership to priority inheritance being possible for one and not the other"},
  {lens:"design", pt:"Gives the right use for each: mutex for exclusive access to a resource, semaphore for signalling, especially from an ISR"}
],
modelNote:"A mutex is owned by whoever holds it, which lets the kernel temporarily boost that owner's priority if a higher-priority task is waiting. A semaphore has no owner, so it can't do that — which is exactly why ISR-to-task signalling uses a semaphore and mutual exclusion between tasks uses a mutex."},

{id:"iv-rt6", track:"rtos", level:"senior", format:"defect",
prompt:"Two tasks each take two mutexes to update a shared record. Reviews pass, tests pass, and the system deadlocks once a week in the field. Why does testing miss this?",
code:"/* task A */ lock(&m1); lock(&m2); ... unlock(&m2); unlock(&m1);\n/* task B */ lock(&m2); lock(&m1); ... unlock(&m1); unlock(&m2);",
rubric:[
  {lens:"idea", pt:"Identifies inconsistent lock ordering between the two tasks as the root cause, not a timing fluke"},
  {lens:"run", pt:"Explains why it's rare: both tasks must reach their second lock call in the exact same narrow window"},
  {lens:"design", pt:"Fixes it with a global, documented lock ordering rather than a retry-and-hope approach"},
  {lens:"trap", pt:"Notes priority inheritance does not help here — this is deadlock, not inversion"}
],
modelNote:"Task A takes m1 then m2; task B takes m2 then m1. If both reach their second lock at nearly the same instant, each holds what the other wants and neither can proceed. It's rare because the window is narrow, which is exactly why it survives testing and shows up in the field. The fix is a single, project-wide lock ordering rule."}
);

INTERVIEW.push(

/* ---------------- automotive / safety ---------------- */
{id:"iv-au1", track:"automotive", level:"junior", format:"explain",
prompt:"Why does most automotive firmware forbid malloc after initialisation?",
rubric:[
  {lens:"run", pt:"Names non-deterministic timing and fragmentation as the two concrete problems, not just 'it's risky'"},
  {lens:"design", pt:"Connects this to needing a provable memory bound for a safety case"},
  {lens:"trap", pt:"Notes a static pool with a fixed capacity is the usual replacement, with exhaustion as a designed, testable failure"}
],
modelNote:"malloc's timing depends on the free list's history, and fragmentation means a request can fail with memory nominally available — neither is provable ahead of time, which a safety argument needs. A fixed-size static pool turns capacity into a link-time constant instead."},

{id:"iv-au2", track:"automotive", level:"senior", format:"design",
prompt:"A brake pressure sensor reading arrives over CAN as a signed 12-bit value packed into a 16-bit field. Specify how you decode it correctly and safely.",
rubric:[
  {lens:"idea", pt:"Extracts the 12 bits with an explicit mask before doing anything else"},
  {lens:"mem", pt:"Sign-extends explicitly rather than casting the raw bits directly to a signed type"},
  {lens:"hw", pt:"Confirms byte order against the DBC/database rather than assuming it matches the CPU's endianness"},
  {lens:"trap", pt:"Adds a range check after decoding — a value outside the physically possible range on a safety-relevant signal should not be trusted silently"}
],
modelNote:"Mask to 12 bits, sign-extend by shifting the sign bit up to the type's top bit and back, respecting the signal's documented byte order rather than assuming it — and treat an out-of-range decoded value as a fault condition, not a number to compute with."},

{id:"iv-au3", track:"automotive", level:"junior", format:"predict",
prompt:"A watchdog is refreshed from a periodic timer interrupt. The main loop hangs in an infinite loop. What does the watchdog do?",
rubric:[
  {lens:"idea", pt:"States plainly: nothing — it keeps getting refreshed"},
  {lens:"trap", pt:"Explains why: the ISR runs independently of whether the main loop is progressing"},
  {lens:"design", pt:"States the fix: refresh only from the main loop, and only after confirming every expected task actually ran that cycle"}
],
modelNote:"Nothing happens — the watchdog is refreshed on schedule by the timer ISR regardless of what the main loop is doing, which defeats its entire purpose. It must be serviced from code path that only executes when the system is actually making progress."},

{id:"iv-au4", track:"automotive", level:"senior", format:"explain",
prompt:"What does 'freedom from interference' mean in ISO 26262, and what actually enforces it in software?",
rubric:[
  {lens:"idea", pt:"States it as: a fault in a lower-ASIL component must not be able to corrupt a higher-ASIL one"},
  {lens:"hw", pt:"Names the MPU, configuring memory regions with access permissions, as the real enforcement mechanism"},
  {lens:"trap", pt:"Explicitly distinguishes this from careful coding, which is an argument, not a mechanism, and doesn't hold under an unrelated defect"}
],
modelNote:"It means a defect in a component with a lower safety requirement cannot corrupt a component with a higher one. Careful coding argues this is unlikely; an MPU partition enforces it even when the low-ASIL code has a real bug, which is what a safety case actually needs."},

{id:"iv-au5", track:"automotive", level:"junior", format:"defect",
prompt:"This clears a single status flag on a peripheral with write-1-to-clear semantics. It also clears flags nobody asked to clear. Why?",
code:"PERIPH->SR |= STATUS_TIMEOUT;",
rubric:[
  {lens:"idea", pt:"Identifies |= as wrong for a write-1-to-clear register"},
  {lens:"hw", pt:"Explains the read step brings in every other currently-set flag, and the write-back clears all of them"},
  {lens:"trap", pt:"Gives the fix: write only the bit you intend, with no read step, or use the peripheral's dedicated clear register if one exists"}
],
modelNote:"|= reads the register first, so every flag that happens to be set gets written back as a 1 — clearing it. The fix is PERIPH->SR = STATUS_TIMEOUT; (writing only that bit, no read), or the peripheral's separate interrupt-clear register where one exists."},

{id:"iv-au6", track:"automotive", level:"senior", format:"design",
prompt:"You're asked to justify why recursion is banned in your team's coding standard, to an engineer coming from a general-purpose background who thinks the rule is overly conservative.",
rubric:[
  {lens:"idea", pt:"Leads with the real reason: worst-case stack depth becomes data-dependent and undecidable from the call graph alone"},
  {lens:"design", pt:"Connects this to the requirement for a provable stack bound in a safety case, not personal taste"},
  {lens:"trap", pt:"Acknowledges bounded, provably-terminating recursion exists in theory, but explains why a blanket rule is still the practical choice across a large codebase under review"}
],
modelNote:"The objection to recursion isn't that it's slow or unusual — it's that static stack analysis, which the safety process relies on, cannot bound a call graph with a cycle in it. A blanket rule is easier to enforce and review across a large team than case-by-case exceptions for 'obviously bounded' recursion."},

{id:"iv-au7", track:"automotive", level:"junior", format:"explain",
prompt:"Why is a table-driven state machine often preferred over nested if/else for control logic in safety-relevant code?",
rubric:[
  {lens:"run", pt:"Notes constant-time execution regardless of the number of states, useful for worst-case timing"},
  {lens:"design", pt:"Notes every state/event pair is explicitly present, so completeness is visible and reviewable against a spec"},
  {lens:"trap", pt:"Flags the risk of the table and the enum drifting apart, and that a static assert on their sizes closes that gap"}
],
modelNote:"A transition table makes every state/event combination explicit and reviewable line by line against a specification, and its execution time doesn't depend on which state you're in — both matter for a timing and a safety argument that nested conditionals don't give you as cleanly."}
);

INTERVIEW.push(

/* ---------------- low power / IoT ---------------- */
{id:"iv-lp1", track:"lowpower", level:"junior", format:"explain",
prompt:"A device measures higher current in stop mode than the datasheet promises, but only when a debugger is attached. Why, and is it a real bug?",
rubric:[
  {lens:"hw", pt:"Explains the debug interface itself keeps clocks running to service the connection"},
  {lens:"trap", pt:"States plainly this is not representative of production current draw and should be measured with the probe detached"}
],
modelNote:"The debug interface needs live clocks to keep talking to the probe, which prevents the part reaching its deepest power state. It's not a real bug — measure current with the debugger disconnected and the target running standalone."},

{id:"iv-lp2", track:"lowpower", level:"senior", format:"defect",
prompt:"A device wakes from standby and a variable meant to persist a fault counter across the wake reads zero every time. Where's the bug?",
rubric:[
  {lens:"mem", pt:"Identifies that standby wakes through a full reset, which reruns startup"},
  {lens:"run", pt:"Explains the .bss clear loop zeroes the variable unless it lives in a dedicated no-init section"},
  {lens:"trap", pt:"Notes the linker script and the startup copy/clear loop both need to explicitly exclude that region"}
],
modelNote:"A standby wake is a reset, and normal startup zeroes .bss and reloads .data from flash. A variable meant to survive that needs its own linker section that both the clear loop and the data copy loop are told to skip."},

{id:"iv-lp3", track:"lowpower", level:"junior", format:"predict",
prompt:"After waking from a stop mode, the first UART transmission at the previously-configured baud rate is garbled. Why?",
rubric:[
  {lens:"hw", pt:"Notes the system clock typically reverts to the internal oscillator on exit from stop mode"},
  {lens:"idea", pt:"Connects that clock change to the UART's baud rate divider now being wrong relative to the new clock"},
  {lens:"trap", pt:"States the fix: clock setup must re-run before anything timing-dependent, not just once at boot"}
],
modelNote:"Stop mode exit usually leaves the core running on the internal oscillator until software switches it back, so any peripheral's clock-derived timing — the UART baud rate divider included — is briefly wrong unless clock reconfiguration runs again immediately on wake."},

{id:"iv-lp4", track:"lowpower", level:"senior", format:"design",
prompt:"Specify the wake sources and RAM strategy for a battery-powered sensor node that sleeps 99% of the time and must report a threshold-crossing event within 100 ms.",
rubric:[
  {lens:"design", pt:"Picks the shallowest mode that meets the 100 ms wake latency, rather than defaulting to the deepest available"},
  {lens:"hw", pt:"Specifies a wake source that survives that mode (an RTC alarm, or a GPIO/analog watchdog interrupt), matched to what the mode actually keeps alive"},
  {lens:"mem", pt:"Identifies what state must be retained across sleep (thresholds, calibration) and where it needs to live for that mode"},
  {lens:"trap", pt:"Flags the wake-latency versus power trade-off explicitly rather than treating it as free"}
],
modelNote:"The 100 ms budget rules out the deepest modes if their wake latency alone eats into it — pick the shallowest mode that meets the deadline and let the wake source (an edge on the sensor line, most likely) be one that mode actually supports. Whatever must survive sleep goes in the RAM region that mode retains, not the general .bss/.data area if the mode powers that down."}
);
</script>
