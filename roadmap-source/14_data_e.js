<script>
STAGES.push({
id:"s3", n:"3", title:"Where C stops being obvious",
blurb:"The rules that only matter once the optimiser is on, the interrupts are enabled and the code has to survive a compiler upgrade. Most firmware bugs that survive code review live in this stage.",
meta:"19 topics · needs stage 2 · build everything here at -O2 with warnings as errors",
topics:[

{id:"ub", code:"3.01", t:"Undefined behaviour",
kick:"Not a crash. A permission slip you gave the compiler without meaning to.",
tags:["advanced","safety"],prereq:["promo","pointers"],
L:{
idea:"When a program has undefined behaviour, the standard places no requirement on what happens. The compiler is entitled to assume UB never occurs and to optimise on that assumption, which is why the visible effect is often the deletion of nearby correct code rather than a fault.",
compile:"Signed overflow is undefined, so if (x + 1 < x) is folded to false and your overflow check disappears. Dereferencing a pointer implies it is non-null, so a later null check can be removed as dead. Neither produces a warning by default.",
run:"Symptoms are non-local, optimisation-level dependent and compiler-version dependent. Code that worked for five years can break on a toolchain upgrade with no source change, and the toolchain is not at fault.",
trap:"The main sources in firmware: signed overflow, shifting into or past the sign bit, out-of-bounds access, using an uninitialised value, violating strict aliasing, and modifying an object twice without a sequence point.",
mem:"Undefined behaviour means the standard imposes no requirements on the execution after the invalid operation. The resulting machine code can therefore be surprising, disappear under optimisation, or interact with memory in ways that are not portable evidence of a particular hardware behaviour.",
design:"Treat UB as a design defect, not as an exotic runtime mode. Compiler warnings, sanitizers on host builds, static analysis and defensive checks are ways to make the defect observable earlier.",
},
src:{cap:"A check that the optimiser is allowed to delete.",code:`/* deleted at -O2: signed overflow cannot happen, so the test is false */
if (x + 1 < x) { handle_overflow(); }

/* correct: unsigned wraparound is defined, or test before the add */
if (x > INT_MAX - 1) { handle_overflow(); }

/* find these before they find you */
-fsanitize=undefined        (on host builds)
-Wall -Wextra -Werror -fno-strict-aliasing (if you must)`},
q:{ask:"Why can undefined behaviour cause a fault in a function that has nothing to do with the offending line?",
ans:"The compiler propagates the assumption. A null dereference in one branch lets it delete null checks anywhere it proved the pointer non-null, including in code you never touched."}},

{id:"impdef", code:"3.02", t:"Implementation-defined and unspecified behaviour",
kick:"Two weaker categories that are portable-with-documentation rather than forbidden.",
tags:["advanced","safety"],prereq:["ub"],
L:{
idea:"Implementation-defined means the compiler must choose and document a behaviour: the signedness of char, the size of int, the result of right-shifting a negative value, the layout of bitfields. Unspecified means it must choose but need not document or be consistent: the order of argument evaluation, for example.",
compile:"Implementation-defined behaviour is usable if you state the dependency and pin the compiler. Safety standards require you to document every one your code relies on, which is a large part of what a MISRA compliance matrix is.",
trap:"Assuming that because it works on this compiler it is defined. Unspecified behaviour may differ between two calls in the same build."
},
q:{ask:"Is right-shifting a negative int undefined?",
ans:"No, it is implementation-defined. Every compiler you will meet does an arithmetic shift, but MISRA still asks you to avoid depending on it."}},

{id:"aliasing", code:"3.03", t:"Strict aliasing",
kick:"The optimisation assumption that breaks the byte-buffer cast everyone writes.",
tags:["advanced","memory"],prereq:["pointers","ub"],
L:{
idea:"The language rules allow the compiler to make aliasing assumptions for accesses through incompatible types. Those assumptions can enable register reuse and reordering. Violating the rule is undefined behaviour, so the resulting machine code is not something you can reason about portably.",
compile:"char and unsigned char pointers may alias anything, which is why memcpy is always safe. A union member access is also permitted. A cast from uint8_t * to uint32_t * and a dereference is not.",
run:"A common symptom is a stale-looking value because the optimizer reused a value instead of reloading storage. The symptom may appear only with optimization enabled, but the underlying problem is already undefined behaviour.",
trap:"Parsing a protocol by casting the receive buffer to a struct pointer. It breaks both aliasing and alignment at once, and the symptom is a value that is right in the debugger and wrong in the release build.",
design:"If a rule matters to portability, replace an implementation choice with an explicit type, conversion, compile-time assertion or documented target assumption.",
mem:"Aliasing rules describe which lvalues may access the stored object. A byte-copy through unsigned character types is different from pretending a float object is a uint32_t object and dereferencing through the wrong type.",
hw:"The hardware may happily read the same address through either pointer. The C compiler is allowed to reason using the language's aliasing rules, so hardware permissiveness does not make an access defined C.",
},
src:{cap:"Three ways to reinterpret bytes: one wrong, two right.",code:`/* undefined: incompatible types aliasing the same storage */
float f = 1.5f;
uint32_t bits = *(uint32_t *)&f;

/* fine: memcpy, and the compiler removes it entirely at -O2 */
uint32_t bits; memcpy(&bits, &f, sizeof bits);

/* fine in C: union punning is explicitly allowed */
union { float f; uint32_t u; } cv = { .f = 1.5f };
uint32_t bits2 = cv.u;`},
q:{ask:"Does memcpy cost anything at -O2 for a 4-byte copy?",
ans:"No. The compiler recognises the pattern and emits a single load and store. You get defined behaviour for free."}},

{id:"align2", code:"3.04", t:"Alignment faults and unaligned access",
kick:"Where the pointer cast that violates aliasing also violates the bus.",
tags:["advanced","hardware"],prereq:["padding","aliasing"],
L:{
idea:"An object of alignment N must sit at an address that is a multiple of N. The compiler guarantees this for objects it allocates, and stops guaranteeing it the moment you compute an address yourself.",
hw:"Cortex-M0 and M0+ fault on any unaligned word or halfword access. M3, M4 and M7 allow unaligned single loads and stores but still fault on LDM, STM, LDRD and STRD, and fault on everything if the UNALIGN_TRP bit is set. DMA controllers commonly require alignment too.",
compile:"Casting uint8_t *buf + 1 to uint32_t * and dereferencing tells the compiler the address is 4-byte aligned, which it is not. It may then emit an instruction that requires alignment.",
trap:"A packed struct member's address passed to a function taking a normal pointer. The packed attribute is lost at the call boundary, and the callee assumes alignment.",
mem:"Alignment is a property of addresses as well as types. An object can have the correct type and still be reached through a pointer that is not suitably aligned, especially after packed serialization or pointer arithmetic.",
run:"Some Cortex-M accesses are serviced transparently while others can fault depending on instruction, memory type and configuration. Write portable code that does not require an unaligned access unless the target contract explicitly supports it.",
},
src:{cap:"Reading a 32-bit field from an arbitrary byte offset, safely.",code:`static inline uint32_t rd_u32(const uint8_t *p) {
    uint32_t v; memcpy(&v, p, sizeof v); return v;   /* no alignment needed */
}

/* enforce alignment where you do control it */
_Alignas(4) static uint8_t dma_buf[256];
_Static_assert(_Alignof(frame_t) <= 4, "check DMA alignment");`},
q:{ask:"Why can the same cast work on Cortex-M4 and fault on Cortex-M0+?",
ans:"M4 permits unaligned single-word access in hardware; M0+ does not and raises a HardFault. The C code was undefined on both, but only one of them told you."}},

{id:"optim", code:"3.05", t:"What the optimiser is allowed to do to your code",
kick:"Reorder, delete, duplicate, cache in registers, and prove things you did not intend to assert.",
tags:["advanced","toolchain"],prereq:["compiler","ub"],
L:{
idea:"The as-if rule: any transformation is legal as long as the observable behaviour of the abstract machine is preserved. Observable means volatile accesses, I/O and program termination. Everything else is fair game.",
compile:"Common transformations that surprise people: hoisting a load out of a loop, removing a variable entirely, reordering two independent stores, merging identical functions, turning a loop into a memset call, and evaluating a whole function at compile time.",
run:"Timing loops written as empty for loops are deleted. Delays implemented that way work at -O0 and vanish at -O2. Use a hardware timer or a volatile counter with a documented cycle count.",
hw:"The compiler does not know an address is a peripheral. Only volatile tells it. It also does not know an interrupt exists, which is why a shared flag must be volatile even though nothing in the C source writes it twice.",
trap:"Concluding the compiler has a bug. In twenty years of firmware, the answer is almost always undefined behaviour in the source. Check with -fsanitize=undefined on a host build before filing anything."
},
src:{cap:"A delay loop that disappears, and one that does not.",code:`for (volatile uint32_t i = 0; i < 1000u; i++) { }   /* survives, but timing is a guess */

for (uint32_t i = 0; i < 1000u; i++) { }            /* deleted at -O1 */

/* what you actually want */
uint32_t t0 = DWT->CYCCNT;
while ((DWT->CYCCNT - t0) < cycles) { }`},
q:{ask:"Why does adding volatile to a loop counter make a delay loop survive but not make it accurate?",
ans:"volatile forces the accesses to happen, but the number of cycles per iteration still depends on the compiler, the flash wait states and any interrupts that land mid-loop."}},

{id:"volatile2", code:"3.06", t:"volatile, second pass: what it does not give you",
kick:"It is a compiler directive. It is not atomicity, not a barrier, not thread safety.",
tags:["advanced","concurrency"],prereq:["volatilek","optim"],
L:{
idea:"volatile tells the implementation that accesses to the volatile object are observable and must not be treated like ordinary removable or freely cacheable accesses. It is about preserving the required accesses; it is not a synchronization primitive.",
compile:"It does not order a volatile access against a non-volatile one. The compiler may move an ordinary store across a volatile one, so a flag set after filling a buffer can be observed before the buffer is filled.",
hw:"It does not stop the CPU's write buffer, does not flush a cache and does not order accesses to different peripherals on a multi-master bus. A DSB or DMB instruction does that.",
run:"It does not make a read-modify-write atomic. volatile uint32_t counter; counter++ is still load, add, store, and an interrupt in the middle still loses an increment.",
trap:"Marking a shared struct volatile and believing the code is now ISR-safe. Every member access becomes a separate volatile access, so the struct can still be read half-updated."
},
src:{cap:"What volatile does and does not fix.",code:`volatile bool ready;
uint8_t buf[16];

void producer(void) {
    fill(buf);
    __DMB();          /* order buffer writes before publication */
    ready = true;
}
/* A CPU barrier is not a substitute for the language's atomic/synchronization model on every platform. */`},
q:{ask:"Give one thing volatile guarantees and two it does not.",
ans:"It requires volatile accesses to remain observable; a compiler cannot simply cache the object and omit the required access. It does not make a read-modify-write atomic, does not establish inter-thread synchronization, and does not by itself guarantee completion at a peripheral or memory system."}},

{id:"atomicity", code:"3.07", t:"Atomicity and read-modify-write",
kick:"The single most common concurrency bug in bare-metal firmware, in three instructions.",
tags:["advanced","concurrency"],prereq:["volatile2","bitops"],
L:{
idea:"An operation is atomic if no other context can observe it half-done. On a 32-bit core, an aligned 32-bit load or store is atomic. Anything that reads, modifies and writes back is not, and neither is any access wider than the bus.",
hw:"counter++ is LDR, ADD, STR. An interrupt between the LDR and the STR that also increments the counter loses one count. The same applies to REG |= BIT on a register that an ISR also modifies.",
run:"Three fixes, in order of preference: make the shared object a single word written by exactly one context; use the hardware's atomic facility (LDREX/STREX on Cortex-M3 and above, or a bit-set register where the peripheral provides one); or disable interrupts around the sequence.",
compile:"C11 _Atomic and <stdatomic.h> express atomic operations in the language. On a given Cortex-M target, the compiler may use exclusive instructions, interrupt masking, or another appropriate sequence depending on the object size, alignment, memory model, and target support. Prefer the language primitive when the project supports it.",
trap:"A 64-bit timestamp shared with an ISR on a 32-bit core. Two loads, and the tick can roll between them, producing a value that never existed."
},
src:{cap:"The lost update, and three ways to not have it.",code:`#include <stdatomic.h>

static _Atomic uint32_t events;

/* 1. single writer, single word: no protection needed */
/* 2. C11 atomic operation; implementation chooses the target sequence */
atomic_fetch_add(&events, 1u);

/* 3. critical section, when the shared object is intentionally non-atomic */
uint32_t s = enter_critical(); events++; exit_critical(s);`},
q:{ask:"Why is a 64-bit microsecond timestamp dangerous to share between an ISR and main on Cortex-M?",
ans:"It takes two 32-bit loads. If the low word wraps between them you read a value combining the old high word and the new low word, jumping backwards or forwards by 4295 seconds."}},

{id:"barriers", code:"3.08", t:"Memory barriers and ordering",
kick:"DMB, DSB, ISB — what each one is for, in one sentence apiece.",
tags:["advanced","concurrency","hardware"],prereq:["atomicity","mmio"],
L:{
idea:"On Arm, DMB orders memory accesses, DSB waits for relevant memory transactions to complete, and ISB synchronizes the instruction stream after changes that affect execution context. Compiler barriers are a separate concern; a CPU barrier alone does not automatically constrain compiler reordering.",
hw:"The write buffer means a store instruction can retire before the value reaches the peripheral. DSB after the store guarantees it landed. ISB is needed after changing something that affects instruction fetch or execution context: enabling the FPU, writing VTOR, changing MPU configuration, switching stack pointers.",
run:"On a single-core Cortex-M with no cache, DMB is rarely needed between ordinary variables, because interrupts are precise. It becomes necessary on M7 with caches, on multi-core parts, and when DMA is a second bus master.",
compile:"A compiler barrier is different again. asm volatile(\"\" ::: \"memory\") stops the compiler moving accesses across the point without emitting any instruction. The CMSIS __DMB() intrinsics include both.",
trap:"Disabling an interrupt in the NVIC and returning from the handler immediately. The disable may not have taken effect, and the interrupt fires once more. DSB before return."
},
src:{cap:"The three places a barrier is not optional.",code:`SCB->VTOR = APP_BASE;  __DSB(); __ISB();      /* new vector table */
MPU->CTRL = enable;    __DSB(); __ISB();      /* new memory map    */
NVIC_DisableIRQ(n);    __DSB();               /* before relying on it */

/* DMA handoff: make sure the buffer writes are visible first */
fill(buf); __DMB(); DMA->CR |= DMA_START;`},
q:{ask:"Why is ISB needed after enabling the FPU but not after writing a GPIO output?",
ans:"Enabling the FPU changes how already-fetched instructions will execute, so the pipeline must be flushed. A GPIO write does not affect instruction execution."}},

{id:"inline", code:"3.09", t:"inline, static inline and link-time optimisation",
kick:"A hint, a definition rule, and a whole-program optimisation pass.",
tags:["advanced","toolchain"],prereq:["funcs","headers"],
L:{
idea:"inline suggests substituting the body at the call site. The compiler decides, based on size and call count, and ignores the keyword freely. static inline in a header is the reliable idiom: every translation unit gets its own copy, and unused copies are discarded.",
link:"Plain inline in C99 has subtle rules about where the out-of-line definition lives, and getting them wrong gives undefined reference at -O0 and a clean build at -O2. static inline avoids the question entirely.",
compile:"LTO defers code generation to link time so the compiler can inline across translation units and delete unreachable code globally. It commonly saves 5 to 15 percent of flash and can expose latent undefined behaviour that per-file compilation hid.",
trap:"LTO plus hand-written assembly, weak symbols or code that relies on a symbol existing can misbehave, because the linker now knows more and removes more. Introduce it with a full regression run, not on a release branch.",
run:"Inlining can remove call/return overhead and expose more optimisation opportunities, but the compiler may inline or refuse to inline regardless of the keyword. static controls linkage; inline is not a request to duplicate a public symbol blindly.",
design:"Use static inline for small internal helpers whose semantics benefit from a function interface. Measure before using inline as a performance claim, and inspect the final code when timing or size is a hard requirement.",
},
src:{cap:"The header idiom that always works.",code:`/* in the header */
static inline uint32_t clamp_u32(uint32_t v, uint32_t hi)
{ return v > hi ? hi : v; }

/* build flags */
CFLAGS  += -flto
LDFLAGS += -flto`},
q:{ask:"Why does static inline in a header not cause duplicate symbols?",
ans:"static gives internal linkage, so each translation unit has its own private copy and the linker never compares them."}},

{id:"weak", code:"3.10", t:"Weak symbols and link-time overriding",
kick:"How a vendor supplies default interrupt handlers you can replace by just defining one.",
tags:["advanced","linker"],prereq:["linker","startup"],
L:{
idea:"A weak symbol is a definition the linker will silently discard if a strong definition of the same name exists. It is the mechanism behind default handlers, optional hooks and test doubles.",
link:"Every interrupt handler in a vendor startup file is weak and aliased to an infinite loop. Define TIM2_IRQHandler in your code and the linker takes yours; misspell it and your handler is never called and the weak default spins forever.",
trap:"A misspelled handler name. There is no error, no warning, and the symptom is that the interrupt appears not to fire. Always check the map file for your handler name the first time you add one.",
compile:"A weak declaration/definition is still a normal symbol as far as compilation is concerned. The special selection happens when the linker sees competing weak and strong definitions.",
run:"After linking there is no runtime 'weakness'. Calls resolve to the selected address in the final image, so replacing a weak handler changes the linked vector or call target rather than adding a dispatch cost.",
design:"Weak defaults are useful for startup handlers and optional hooks, but they can hide missing implementations. Use build checks or explicit registration when silently falling back would be dangerous.",
},
src:{cap:"Weak defaults and the override.",code:`/* startup file */
void Default_Handler(void) { for (;;) { } }
void TIM2_IRQHandler(void) __attribute__((weak, alias("Default_Handler")));

/* your driver: this definition simply wins at link time */
void TIM2_IRQHandler(void) { TIM2->SR &= ~TIM_SR_UIF; tick++; }`},
q:{ask:"Your timer interrupt never fires, the NVIC is enabled and the flag is set in the status register. What do you check?",
ans:"The handler name against the vector table in the startup file. A typo leaves the weak default in place, and the core is spinning in Default_Handler."}},

{id:"restrict", code:"3.11", t:"restrict",
kick:"A promise that two pointers do not overlap, and what the compiler does with it.",
tags:["advanced","toolchain"],prereq:["aliasing"],
L:{
idea:"restrict on a pointer parameter promises that, within the function, the object it points to is accessed only through that pointer. The compiler can then keep values in registers across stores through the other pointers.",
compile:"In a DSP-style loop this can double throughput, because without it the compiler must reload the source after every store to the destination, in case they overlap.",
trap:"Passing overlapping buffers to a restrict-qualified function is undefined and silent. This is exactly the difference between memcpy, which forbids overlap, and memmove, which handles it.",
run:"restrict is a promise about how an object is accessed through a pointer during a relevant execution period. If the caller violates the promise by overlapping accesses, the optimiser may legally make transformations that expose the violation.",
design:"Use restrict only when the non-overlap contract is real and easy to maintain, such as a low-level buffer routine. Document the ownership assumption at the API boundary.",
},
src:{cap:"The promise, and the loop it unlocks.",code:`void scale(size_t n, int16_t *restrict dst, const int16_t *restrict src, int16_t k)
{
    for (size_t i = 0; i < n; i++) dst[i] = (int16_t)((src[i] * k) >> 15);
}
/* without restrict the compiler must assume dst[i] may overwrite src[i+1] */`},
q:{ask:"Why does memcpy have a restrict-qualified signature and memmove not?",
ans:"memcpy is specified to require non-overlapping buffers, which restrict expresses. memmove must work with overlap, so it cannot make that promise."}},

{id:"variadic", code:"3.12", t:"Variadic functions",
kick:"How printf receives its arguments, and why it is expensive on a microcontroller.",
tags:["advanced"],prereq:["funcs"],
L:{
idea:"stdarg.h walks the argument list using va_start, va_arg and va_end. There is no type information at run time, so the callee is told the types by a format string or a count, and nothing checks that the caller was honest.",
hw:"Variadic arguments follow different ABI rules from fixed ones: default promotions apply, so a float is passed as a double and a uint8_t as an int. That is why %f on a hard-float build still costs a conversion.",
mem:"A full printf pulls in the formatting engine, and floating-point support doubles it again. On a part with 64 KB of flash a single %f can cost a fifth of the budget.",
trap:"A format specifier that does not match the argument. %d with a uint32_t, or %ld with an int, reads the wrong number of bytes from the list and desynchronises everything after it. Use the PRIu32 macros from inttypes.h and enable -Wformat.",
compile:"For a variadic call, the fixed parameters have declared types while unnamed arguments undergo default argument promotions. The callee has no automatic runtime type tag, which is why printf-style APIs need a format contract.",
run:"The callee reads each argument according to the type it expects. A mismatch can make it fetch the wrong width or interpret the bits incorrectly, so variadic APIs are only as safe as their metadata convention.",
design:"Prefer typed APIs for firmware interfaces. When a variadic interface is justified, use compiler-checked format attributes where available and keep the accepted type set narrow.",
},
src:{cap:"Portable format specifiers for fixed-width types.",code:`#include <inttypes.h>
printf("ticks=%" PRIu32 " err=%" PRId16 "\\n", ticks, err);

/* your own logger: pass a count, check with the format attribute */
__attribute__((format(printf, 2, 3)))
void log_msg(level_t l, const char *fmt, ...);`},
q:{ask:"Why does printf(\"%d\", x) with a uint64_t argument corrupt the rest of the line?",
ans:"%d consumes four bytes from the argument list but eight were pushed, so every subsequent specifier reads from the wrong offset."}},

{id:"standards", code:"3.13", t:"C standards, _Static_assert and _Generic",
kick:"What C99, C11 and C23 added that is worth using in firmware.",
tags:["advanced","toolchain"],prereq:["types"],
L:{
idea:"C99 brought stdint.h, stdbool.h, designated initialisers, declarations anywhere and inline. C11 brought _Static_assert, _Alignas, _Generic and the atomics. C23 tidies up with typeof, constexpr and binary literals.",
compile:"_Static_assert is the single highest-value addition for firmware: it checks struct sizes, enum-to-table correspondence and configuration consistency at compile time, at zero run-time cost. Every assumption your code makes about layout should have one.",
trap:"VLAs and alloca from C99 are the two features to refuse. Both make stack usage data-dependent, which breaks static stack analysis and is banned by every functional safety standard.",
run:"A standard feature becomes valuable when it turns an assumption into a compiler-checked contract. _Static_assert checks a property during translation; _Generic selects based on type at compile time rather than performing runtime dispatch.",
design:"Use compile-time checks for widths, offsets, enum ranges and configuration invariants that must never silently drift between targets.",
},
src:{cap:"Compile-time checks that cost nothing and catch layout drift.",code:`_Static_assert(sizeof(can_frame_t) == 16, "wire layout changed");
_Static_assert(ST_COUNT == ARRAY_LEN(handlers), "handler table out of sync");
_Static_assert(CONFIG_POOL_N >= CONFIG_MAX_TASKS, "pool too small");`},
q:{ask:"Why is a static assert on a struct size more valuable than a comment describing the layout?",
ans:"The comment does not fail the build when someone adds a member. The assert does, at the moment of the change rather than in integration."}},

{id:"opaque", code:"3.14", t:"Opaque types and module boundaries",
kick:"Hiding a struct's contents in C, and the two ways to do it.",
tags:["advanced","design"],prereq:["headers","structs"],
L:{
idea:"An opaque type is declared in the header and defined only in the .c file, so callers can hold a pointer but cannot see or touch the members. It is the C equivalent of a private section.",
compile:"Callers cannot allocate the object, because its size is unknown. Either the module allocates from a static pool, or the header exposes a size and alignment so the caller can provide storage — the pattern FreeRTOS uses with StaticTask_t.",
design:"The payoff is that changing the struct cannot break callers and does not force a rebuild of the world. The cost is that member access becomes a function call unless the compiler can inline across units, which LTO restores.",
trap:"Exposing the struct in the header for convenience and then relying on that. Six months later a member changes and every caller needs revisiting, which for a shared platform component means every project.",
mem:"An opaque type can be incomplete outside its implementation file, so callers cannot allocate it by value or inspect its representation. That prevents accidental coupling to layout and lets the implementation change without changing the public ABI surface in the same way.",
run:"Operations on an opaque object still execute on real storage; the abstraction hides ownership and representation, not runtime cost. Handle allocation and lifetime explicitly so callers know who releases the object.",
},
src:{cap:"Caller-provided storage with a hidden layout.",code:`/* pid.h */
typedef struct pid pid_t;
#define PID_STORAGE_SIZE 24u
#define PID_STORAGE_ALIGN 4u

pid_t *pid_init(void *storage, size_t n, const pid_cfg_t *cfg);
int16_t pid_step(pid_t *p, int16_t err);

/* caller */
_Alignas(PID_STORAGE_ALIGN) static uint8_t pid_mem[PID_STORAGE_SIZE];`},
q:{ask:"Why does an opaque type usually pair with a static pool rather than malloc in firmware?",
ans:"The module needs to allocate but the system forbids the heap, so it owns a fixed array of objects and hands out pointers into it, keeping capacity a link-time constant."}},

{id:"ringbuf", code:"3.15", t:"Ring buffers and single-producer queues",
kick:"The one lock-free structure worth knowing by heart, because every UART driver needs it.",
tags:["advanced","concurrency","design"],prereq:["atomicity","allocstrat"],
L:{
idea:"A fixed array with a head index written only by the producer and a tail index written only by the consumer. If each index is a single word and has exactly one writer, no lock is needed on a single-core MCU.",
run:"Empty is head == tail; full is the next head equal to tail, which is why one slot is sacrificed unless you keep a separate count — and a count has two writers, which reintroduces the atomicity problem.",
hw:"Sizing the buffer to a power of two turns the modulo into a mask, which is one instruction instead of a division. On a UART ISR running at 1 Mbaud that matters.",
compile:"Both indices must be volatile, and the data write must be ordered before the index update. On Cortex-M with a single core, a compiler barrier is sufficient; with DMA or a second master, use __DMB().",
trap:"Two producers. The moment a second context writes head, the design is broken and the failure is a rare overwrite under load, which is the hardest kind of bug to reproduce."
},
src:{cap:"Power-of-two ring buffer, one producer, one consumer, no lock.",code:`#define RB_N 64u                       /* power of two */
static uint8_t  rb[RB_N];
static volatile uint32_t head, tail;   /* head: ISR only. tail: main only */

bool rb_put(uint8_t c) {               /* called from the ISR */
    uint32_t h = head, n = (h + 1u) & (RB_N - 1u);
    if (n == tail) return false;       /* full: drop, never block */
    rb[h] = c;
    __DMB();                           /* data before index */
    head = n;
    return true;
}`},
q:{ask:"Why must the data byte be written before the head index, and never the other way round?",
ans:"The consumer uses head to decide the byte is valid. If head advances first, the consumer can read a slot that has not been written yet."}},

{id:"statemachine", code:"3.16", t:"Table-driven state machines",
kick:"Turning control logic into data, which is reviewable, testable and constant time.",
tags:["advanced","design"],prereq:["funcptr","enums"],
L:{
idea:"Represent states and events as small dense enums and the transition logic as a table indexed by both. The code that runs the machine is then a dozen lines and never changes; the behaviour lives in the table.",
mem:"A const table of function pointers or next-state values lives in .rodata in flash, costing no RAM and no dispatch branch chain.",
run:"Lookup is constant time regardless of the number of states, which makes worst-case execution time trivial to argue in a timing analysis — a real requirement in automotive work.",
design:"The table is reviewable against a specification line by line, which a nest of if statements is not. It is also directly comparable against a state chart from a design tool.",
trap:"Letting the table and the enum drift apart. Pair them with a _Static_assert on the dimensions and use designated initialisers so a missing entry is a visible zero rather than a silent shift."
},
src:{cap:"A transition table you can diff against a spec.",code:`static const state_t next[ST_COUNT][EV_COUNT] = {
  /*            EV_PRESS    EV_RELEASE  EV_FAULT   */
  [ST_IDLE]  = {ST_ARMED,   ST_IDLE,    ST_FAULT},
  [ST_ARMED] = {ST_APPLY,   ST_IDLE,    ST_FAULT},
  [ST_APPLY] = {ST_APPLY,   ST_IDLE,    ST_FAULT},
  [ST_FAULT] = {ST_FAULT,   ST_FAULT,   ST_FAULT},
};

state = next[state][ev];    /* one indexed load. constant time. */`},
q:{ask:"What does a table-driven machine give you that nested ifs do not, for a safety case?",
ans:"Every state-event pair is explicitly present, so completeness is inspectable, and execution time is identical on every path."}},


{id:"ownership", code:"3.18", t:"Ownership and hand-off protocols",
kick:"Concurrency gets easier when every byte has a clear owner at every moment.",
tags:["advanced","concurrency","design"],prereq:["ringbuf","barriers","busmasters"],
L:{
idea:"Ownership is the rule that says which context is allowed to read or modify a resource right now. For a buffer, the useful states might be CPU-owned, peripheral-owned, and ready-to-consume. The hand-off itself must have a precise synchronization point.",
compile:"C has no built-in notion of buffer ownership. A pointer type cannot tell the compiler that DMA currently owns the memory. The protocol must be represented by indices, flags, descriptors or API boundaries that make illegal access visible in review.",
mem:"Ownership is about the same storage changing hands, not about copying a pointer. The lifetime of the storage must cover the entire ownership interval. A stack buffer cannot become DMA-owned after its function returns.",
run:"A safe hand-off has three parts: finish writes, publish ownership, then let the next context consume. Completion reverses the sequence. This is why double buffers and descriptor rings are easier to reason about than one mutable global buffer.",
hw:"DMA, peripherals and another CPU can act without executing your C code. Cacheable memory adds another layer: ownership transfer may require cache clean/invalidate operations on targets where CPU and DMA do not share coherent storage.",
design:"Write ownership as a state machine. For every buffer, answer: who may write, who may read, what event transfers ownership, and what proves the transfer happened. If two contexts can both claim write ownership, the design is incomplete.",
trap:"Starting DMA and immediately reusing the buffer because the CPU instruction returned. The CPU has finished configuring the transfer; the hardware has not finished using the buffer."
},
src:{cap:"An explicit ownership protocol for a DMA buffer.",code:`typedef enum { BUF_CPU, BUF_DMA, BUF_READY } owner_t;\nstatic uint8_t rx_buf[256];\nstatic volatile owner_t owner = BUF_CPU;\n\n/* CPU-owned → DMA-owned */\nprepare(rx_buf);\n__DMB();\nowner = BUF_DMA;\nstart_dma(rx_buf, sizeof rx_buf);\n\n/* completion ISR: DMA-owned → ready */\nvoid DMA_IRQHandler(void) {\n    acknowledge_dma();\n    __DMB();\n    owner = BUF_READY;\n}`},
q:{ask:"Why is a pointer value not enough to prove that a buffer is safe to reuse?",ans:"The pointer only identifies storage. It carries no information about whether another context or hardware block is still using that storage. Ownership must be tracked by the synchronization protocol."}},

{id:"cachecoherency", code:"3.19", t:"DMA, caches and memory visibility",
kick:"When the CPU and DMA disagree about what is in RAM, the bug is usually a cache-line problem, not a volatile problem.",
tags:["advanced","concurrency","hardware"],prereq:["ownership","busmasters","barriers"],
L:{
idea:"On a cached MCU, the CPU may read or write a cache line without immediately updating main memory. DMA usually accesses memory through a bus path that does not automatically see the CPU's dirty cache lines. Correctness therefore requires an explicit coherency strategy.",
compile:"The compiler cannot infer DMA coherency from a pointer. volatile only affects compiler treatment of accesses; it does not clean a cache line or invalidate stale data. Cache maintenance is a target-specific hardware operation.",
mem:"Cache maintenance works in cache-line units, not arbitrary byte ranges. Buffer alignment and size therefore matter. A small DMA buffer sharing a cache line with unrelated data can cause surprising corruption when software cleans or invalidates that line.",
run:"For TX, software may need to clean cache lines so DMA sees the CPU's latest bytes. For RX, software may need to invalidate cache lines before consuming data written by DMA. The exact sequence depends on the target's cache architecture and DMA coherency.",
hw:"Cortex-M7-class systems are a common place where this matters. Some MCUs provide coherent paths or non-cacheable SRAM regions; others require explicit cache maintenance. The reference manual and memory map decide which contract applies.",
design:"Choose one coherency policy per DMA buffer class: non-cacheable memory, explicit clean/invalidate, or a documented coherent path. Put the rule in the driver API so callers cannot accidentally skip it.",
trap:"Marking a DMA buffer volatile and assuming the DMA will now see fresh data. volatile changes compiler accesses; it does not change cache state or bus visibility."
},
src:{cap:"The conceptual TX/RX cache hand-off.",code:`/* TX: CPU produced bytes in cache */\nfill(tx_buf);\ncache_clean(tx_buf, TX_N);   /* target-specific */\nstart_dma_tx(tx_buf, TX_N);\n\n/* RX: DMA produced bytes in RAM */\nwait_for_dma_rx();\ncache_invalidate(rx_buf, RX_N); /* target-specific */\nconsume(rx_buf);`},
q:{ask:"Why can a DMA receive buffer contain new bytes in RAM while the CPU still reads the old bytes?",ans:"The CPU can keep an older copy in its cache. DMA updated main memory, but the CPU's load may hit the stale cache line until the coherency protocol or explicit invalidation makes the new data visible."}},

{id:"errors", code:"3.17", t:"Error handling and coding standards",
kick:"No exceptions, so every failure is a value someone has to check.",
tags:["advanced","design","safety"],prereq:["statemachine","opaque"],
L:{
idea:"C returns errors as values. The discipline is to give every fallible function a status return, make the output a pointer parameter, and check every return. Nothing enforces this, so the standard and the tooling have to.",
compile:"__attribute__((warn_unused_result)) turns an unchecked return into a warning, and with -Werror into a build failure. It is the closest C gets to an enforced error contract.",
design:"In a safety system an error is not just logged, it triggers a defined reaction: degrade, substitute a default, notify a monitor, or enter a safe state. MISRA C and ISO 26262 mostly formalise practices that this stage has already argued for on engineering grounds: no recursion, no dynamic memory, no implicit conversions, single exit where it helps, everything initialised.",
trap:"Returning an error code that no caller can do anything about. Design the reaction first and the code second, otherwise you get a codebase full of checks that log and continue into the failure.",
run:"An error value is useful only if the caller can distinguish failure, preserve the relevant context and move the system into a safe state. In embedded code, 'return false' is often too little information to diagnose a bus, timeout or hardware fault.",
hw:"Hardware APIs frequently have multiple failure classes: timeout, NACK, arbitration loss, overrun, bus-off, invalid state. Preserve the distinction until the layer that can make the correct recovery decision.",
},
src:{cap:"A status contract the compiler helps enforce.",code:`typedef enum { E_OK = 0, E_RANGE, E_BUSY, E_TIMEOUT } status_t;

__attribute__((warn_unused_result))
status_t sensor_read(sensor_t *s, uint16_t *out);

uint16_t v;
if (sensor_read(&s, &v) != E_OK) { enter_safe_state(); }`},
q:{ask:"Why do MISRA rules ban recursion and dynamic allocation rather than just discouraging them?",
ans:"Both make worst-case resource use impossible to determine statically, and a safety argument needs a bound that can be proven before the software ships."}}

]});
</script>
