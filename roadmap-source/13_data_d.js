<script>
STAGES[2].topics.push(

{id:"structs", code:"2.19", t:"Structs",
kick:"A named layout. The names are compile-time only; the layout is what survives.",
tags:["c-core","memory"],prereq:["types","pointers"],
L:{
idea:"A struct groups objects at fixed offsets from a common base. Member names are compile-time labels for those offsets and do not exist in the object file. Assignment copies the whole thing, including any padding.",
compile:"s.member becomes a load or store at base plus a constant offset, which costs nothing extra over a plain variable. p->member is the same with the base in a register.",
mem:"Members are laid out in declaration order, but the compiler may insert padding between them and at the end. Total size is therefore not the sum of the member sizes (topic 2.20).",
run:"Passing a struct by value copies every byte, including padding, on every call. Passing a pointer copies four bytes. For anything larger than two words, pass a pointer.",
trap:"Comparing structs with memcmp. Padding bytes are indeterminate, so two structs with identical member values can compare unequal. Compare member by member, or zero the struct on creation and never rely on it anyway."
},
src:{cap:"The struct-of-pointers pattern that keeps drivers testable.",code:`typedef struct {
    volatile uint32_t *port;
    uint8_t            pin;
    bool               active_low;
} led_cfg_t;

void led_set(const led_cfg_t *c, bool on);   /* pointer, not value */`},
q:{ask:"Why can two structs with the same member values fail a memcmp?",
ans:"Padding bytes are not part of the value and are never guaranteed to be initialised. Their contents are whatever the stack or RAM held."}},

{id:"padding", code:"2.20", t:"Padding, alignment and packing",
kick:"Why a struct of five bytes occupies twelve, and why fixing that can hard-fault the chip.",
tags:["c-core","memory"],prereq:["structs"],
L:{
idea:"Each type can have an alignment requirement. The compiler inserts padding so members meet those requirements, and may pad the end so every element of an array has a correctly aligned start. The exact layout is part of the implementation ABI, not a universal C byte pattern.",
mem:"Order the members from widest to narrowest and the padding usually disappears. This is free RAM: in a system with hundreds of message structs it can be kilobytes.",
hw:"Some Cortex-M cores can handle certain unaligned scalar accesses, while other instructions or configurations may fault; Cortex-M0/M0+ are more restrictive. Never make a packed layout safe merely because one development target tolerated an unaligned access. Treat alignment as part of the ABI and instruction contract.",
compile:"__attribute__((packed)) removes the padding and also tells the compiler every member may be unaligned, so it generates byte-by-byte access. That is slower, and taking a pointer to a packed member yields a pointer the compiler no longer knows is misaligned.",
trap:"Packing a struct to overlay a CAN frame or a protocol header, then passing the address of a member to a function expecting an aligned pointer. That is how a packed struct turns into a UsageFault on a different optimisation level."
},
src:{cap:"Same members, two layouts, four bytes of difference.",code:`struct bad  { uint8_t a; uint32_t b; uint8_t c; };  /* 12 bytes */
struct good { uint32_t b; uint8_t a; uint8_t c; };  /* 8 bytes  */

_Static_assert(sizeof(struct good) == 8, "layout changed");

/* overlay a wire format: pack, but then copy out, never alias */
typedef struct __attribute__((packed)) {
    uint16_t id; uint8_t dlc; uint8_t data[8];
} frame_wire_t;`},
q:{ask:"Why is memcpy into a normal struct safer than casting a byte buffer to a struct pointer?",
ans:"memcpy has no alignment requirement and no aliasing problem. The cast assumes the buffer is aligned and that the compiler will not reorder accesses based on the types, and both assumptions can fail."}},

{id:"unions", code:"2.21", t:"Unions and type punning",
kick:"One block of storage, several interpretations, and one portability question.",
tags:["c-core","memory"],prereq:["padding"],
L:{
idea:"A union's members all start at offset zero and the size is that of the largest member plus padding. Writing one member and reading another reinterprets the same bytes.",
compile:"Reading a member other than the one last written is explicitly permitted in C, unlike C++, which makes a union the standard-blessed way to type-pun. Casting a pointer instead may violate strict aliasing (topic 3.03).",
mem:"Unions are the standard tool for register overlays, protocol frames and tagged variants. A union of a uint32_t and a bitfield struct lets you write the whole register in one store or examine one field, using the same storage.",
run:"A union carries no tag. If you need to know which member is valid, you store that yourself, which is why the tagged-union idiom is a struct containing an enum and a union.",
trap:"Punning across widths still hits endianness. A union of uint32_t and uint8_t[4] gives you the bytes in the CPU's order, which is not the wire order."
},
src:{cap:"The register overlay, which is how vendor headers express a control register.",code:`typedef union {
    uint32_t w;
    struct {
        uint32_t enable  : 1;
        uint32_t mode    : 2;
        uint32_t         : 5;   /* reserved */
        uint32_t divider : 8;
    } b;
} ctrl_t;

ctrl_t c = { .w = 0u };
c.b.mode = 2u; c.b.enable = 1u;
PERIPH->CTRL = c.w;             /* single 32-bit store to hardware */`},
q:{ask:"Why build the value in a local union and store once, rather than editing the hardware register field by field?",
ans:"Each field edit is a separate read-modify-write on the peripheral, so the hardware sees intermediate states. One store makes the update atomic from the peripheral's point of view."}},

{id:"bitfields", code:"2.22", t:"Bitfields",
kick:"Convenient, readable, and implementation-defined in exactly the places you care about.",
tags:["c-core","memory"],prereq:["unions"],
L:{
idea:"A bitfield declares a member of a given number of bits. The compiler packs them into storage units and generates the mask-and-shift code for you.",
compile:"Allocation order within a unit, whether fields straddle unit boundaries, and the alignment of the unit are all implementation-defined. Two compilers may lay out the same declaration differently, which is why bitfields are not portable for wire formats.",
hw:"Access to a single bitfield is a read-modify-write of the whole storage unit. Against a hardware register that means a wider access than you intended, and on a register with write-1-to-clear bits it means clearing flags you never touched.",
run:"MISRA restricts bitfields to unsigned types and forbids them over signed int, because the sign of a plain int bitfield is implementation-defined.",
trap:"Using bitfields directly on a volatile hardware register with W1C status bits. Setting one field reads the whole register, including set status flags, and writes them back, clearing them. Use explicit masks on hardware and keep bitfields for internal state."
},
src:{cap:"Safe uses and the unsafe one.",code:`/* fine: internal state, compact and readable */
typedef struct { uint8_t armed:1, fault:1, mode:3, spare:3; } state_t;

/* not fine: W1C flags get cleared as a side effect */
typedef struct { volatile uint32_t txe:1, rxne:1, err:1; } sr_t;

/* do this on hardware instead */
if (UART->SR & SR_RXNE) { ... }
UART->ICR = SR_ERR;      /* clear exactly one flag */`},
q:{ask:"Why is a bitfield the wrong tool for parsing a CAN payload?",
ans:"Bit allocation order and straddling rules are implementation-defined, and endianness applies on top. Explicit shift and mask code is portable and reviewable."}},

{id:"enums", code:"2.23", t:"Enums",
kick:"Named integer constants with a type the compiler mostly does not enforce.",
tags:["c-core"],prereq:["types"],
L:{
idea:"An enum introduces named constants and a type. Values start at zero and increment unless assigned. In C, an enum variable is compatible with an integer type, so assigning an unrelated integer to it is legal.",
compile:"The underlying type is implementation-defined before C23 — usually int, but a compiler may pick a smaller type if all values fit and the option is enabled. That makes sizeof(enum) non-portable, which matters for structs in shared headers.",
run:"Enums cost nothing at run time; they are compile-time constants. Their value is in review and in switch coverage warnings: with -Wswitch, a switch over an enum that misses a case is a warning, which is genuinely useful for state machines.",
trap:"Relying on an enum to constrain a value. C will happily let you assign 47 to it. Validate at the boundary, especially for anything arriving from a bus or a message.",
mem:"An enum object has an implementation-defined integer representation capable of representing its values. Do not assume a particular width when the object crosses an ABI or wire boundary; use a fixed-width integer when the representation is part of the contract.",
design:"Use enums for closed sets that benefit from names and compiler diagnostics. Pair them with explicit validation when values can come from corrupted data, a bus, Flash or an external interface.",
},
src:{cap:"The count idiom that keeps tables and states in step.",code:`typedef enum {
    ST_IDLE = 0,
    ST_ARMED,
    ST_APPLY,
    ST_COUNT              /* not a state: the number of states */
} state_t;

static handler_t const table[ST_COUNT] = { ... };
_Static_assert(ST_COUNT == 3, "add the new state to the table too");`},
q:{ask:"Why does -Wswitch help state machines specifically?",
ans:"Adding a state to the enum makes every switch over it that lacks a case emit a warning, so the compiler enumerates the places you forgot to update."}},

{id:"typedefs", code:"2.24", t:"typedef and reading declarations",
kick:"The right-left rule, once, and then you can read any declaration in any codebase.",
tags:["c-core"],prereq:["funcptr"],
L:{
idea:"A typedef creates an alias for a type, not a new type. It does not add type safety; it adds readability, and occasionally it removes readability by hiding a pointer.",
compile:"Declarations are read starting from the identifier, then right, then left, obeying parentheses. char *(*fp[4])(int) is: fp is an array of 4 pointers to functions taking int and returning pointer to char.",
trap:"Typedefing a pointer, like typedef struct node *node_t;. Now const node_t is a const pointer, not a pointer to const, and readers cannot tell that the type is a pointer at all. Keep the star visible.",
mem:"typedef creates an alias for a type; it does not create a new distinct type or change storage. The underlying type still determines size, alignment and representation.",
design:"Use typedefs to give domain meaning to complex types or fixed interfaces, but avoid hiding pointer ownership or qualifiers that readers need to reason about lifetime.",
},
src:{cap:"The same type, spelled twice.",code:`void (*isr_table[16])(void);              /* array of 16 function pointers */

typedef void (*isr_t)(void);
isr_t isr_table[16];                      /* same thing, readable */

/* right-left: fp -> [4] -> * -> (int) -> * char */
char *(*fp[4])(int);`},
q:{ask:"What is int (*p)[10] versus int *p[10]?",
ans:"The first is a pointer to an array of 10 ints. The second is an array of 10 pointers to int. Parentheses change which operator binds first."}},

{id:"macros", code:"2.25", t:"Macros, and when a function is better",
kick:"Token pasting, stringification, and the reasons static inline replaced most macros.",
tags:["c-core","toolchain"],prereq:["preproc"],
L:{
idea:"Macros operate on tokens before types exist. That gives them powers a function cannot have — building names with ##, turning an argument into a string with #, capturing __LINE__ and __FILE__ — and costs them all type checking.",
compile:"static inline gives the compiler a normal typed function that it may inline, while keeping ordinary scope and type rules. It is often preferable to a function-like macro, but inline expansion is still an optimization decision, not a guaranteed zero-cost promise.",
trap:"Macro arguments with side effects get evaluated as many times as they appear. Also: a macro has no scope, so a macro named MAX collides with anything else named MAX in any file that includes your header, which is why library macros carry prefixes.",
run:"Macro expansion happens before type checking, so a macro can evaluate an argument more than once or capture surrounding syntax in surprising ways. An inline function is type-checked and gives the compiler a safer optimisation boundary.",
design:"Reserve macros for conditional compilation, constants that must be preprocessor-visible, and carefully designed token-level operations. Prefer functions or static inline for behaviour.",
},
src:{cap:"The three macro powers a function cannot replace.",code:`#define ASSERT(c) do { if (!(c)) fault_log(__FILE__, __LINE__, #c); } while (0)

#define REG(periph, r)  ((periph)->r)          /* token pasting */
#define CONCAT(a, b)    a##b
#define STRINGIFY(x)    #x

/* prefer this over a MIN macro */
static inline uint32_t u32_min(uint32_t a, uint32_t b)
{ return a < b ? a : b; }`},
q:{ask:"Why does a function-like macro need parentheses around both the body and every parameter?",
ans:"Substitution is textual, so the surrounding expression's precedence applies to the pasted tokens. Without parentheses, 1/SQ(2+2) parses in a way you did not write."}},

{id:"headers", code:"2.26", t:"Headers, include guards and module surface",
kick:"A header is an interface contract. Most firmware headers are a dumping ground instead.",
tags:["c-core","design"],prereq:["tu","macros"],
L:{
idea:"A header should contain what a caller needs to use the module and nothing else: the public types, the function declarations, and the constants those mention. Implementation details belong in the .c file.",
compile:"Include guards or #pragma once stop double inclusion, which otherwise gives redefinition errors for types. They do not stop the compiler re-reading the file, which is why large header trees slow builds.",
link:"Anything defined rather than declared in a header multiplies across translation units. Put static inline on small functions in headers so each unit gets its own copy legally, or declare them and define once.",
trap:"A header that includes ten other headers so that its users do not have to. It compiles, and it makes every module depend on every other, which is how a codebase becomes impossible to unit-test.",
mem:"A header does not create runtime storage by itself when it contains declarations, but a non-static definition in a header can create multiple definitions across translation units. Include guards prevent repeated inclusion in one translation unit; they do not solve multiple definitions across files.",
design:"Treat the header as the module's public contract: expose only what callers need, keep private types and helpers in the .c file, and make ownership/lifetime explicit in the API.",
},
src:{cap:"A header with a surface you could hand to another team.",code:`#ifndef BRAKE_MONITOR_H
#define BRAKE_MONITOR_H

#include <stdint.h>
#include <stdbool.h>

typedef struct brake_monitor brake_monitor_t;   /* opaque: see 3.14 */

void brake_monitor_init(brake_monitor_t *m, uint16_t threshold);
bool brake_monitor_update(brake_monitor_t *m, uint16_t pressure);

#endif /* BRAKE_MONITOR_H */`},
q:{ask:"Why should a header include everything it needs and nothing it does not?",
ans:"So it compiles standalone, which makes it self-documenting, and so it does not force its dependencies on every consumer. Test it by compiling a .c file containing only that include."}},

{id:"initrules", code:"2.27", t:"Initialisation: what is guaranteed and when",
kick:"Static objects are zeroed for you. Automatic objects are not, and the difference is a whole class of bug.",
tags:["c-core","memory"],prereq:["scope","lmavma"],
L:{
idea:"Objects with static storage duration are initialised before main: to their initialiser, or to zero if there is none. Objects with automatic duration are uninitialised unless you initialise them, and their contents are whatever the stack held.",
run:"Startup code provides the guarantee (topic 1.09). It is not magic and it is not the hardware — remove the .bss clear loop and your zero-initialised globals hold RAM garbage.",
mem:"Partial initialisation of an aggregate zeroes the rest. So struct s x = {0}; zeroes everything, and uint8_t b[64] = {0}; costs no flash because the whole thing stays in .bss.",
compile:"Designated initialisers let you initialise by name, which survives reordering of the struct members and reads far better in review.",
trap:"A local struct left partly initialised, then memcmp-ed or transmitted. The uninitialised members and the padding both carry stack residue, which at best leaks old data onto a bus."
},
src:{cap:"Designated initialisers, which are the default choice in modern C.",code:`static const pid_cfg_t cfg = {
    .kp = 2048,        /* Q12 */
    .ki = 96,
    .limit = 32767,
    /* .kd omitted -> zero */
};

uint8_t frame[8] = {0};     /* all zero, still .bss if static */`},
q:{ask:"A global counter reads as garbage on one board and zero on another. What should you check first?",
ans:"Whether the .bss clear loop covers the section it landed in. A custom section added to the linker script without a matching startup loop produces exactly this."}},

{id:"heap", code:"2.28", t:"The heap: malloc, free and fragmentation",
kick:"How dynamic allocation works, and why most firmware standards forbid it.",
tags:["c-core","memory"],prereq:["stackframe","sections"],
L:{
idea:"A typical embedded allocator manages a heap region supplied by the linker/startup configuration, often between static data and the stack. The allocator tracks free storage and may split or merge blocks. The exact layout is implementation-specific.",
mem:"Allocators add metadata and alignment padding, but the exact overhead is implementation-specific. A small object can therefore consume substantially more RAM than its requested payload. The heap and stack may share the same RAM budget, depending on the linker/startup design.",
run:"Allocation time is not bounded: it depends on the free list state. Fragmentation means a 1 KB request can fail with 4 KB free, and there is no compaction. Over a long run, a system that allocates and frees different sizes will eventually fail, and proving otherwise is hard.",
hw:"A C library allocator may obtain heap space through a target-specific mechanism such as sbrk. The linker/startup configuration must define the available region and collision policy; never assume the library will protect the stack for you.",
trap:"malloc returning NULL and the code not checking. In a brake ECU, a NULL check that leads to a fault reaction is the only acceptable answer, which is a good argument for not allocating at all."
},
src:{cap:"If you must, allocate once at init and never free.",code:`/* acceptable: bounded, deterministic, checked */
static uint8_t pool[4096];
static size_t  used;

void *pool_alloc(size_t n) {
    n = (n + 3u) & ~3u;                 /* keep 4-byte alignment */
    if (n > sizeof pool - used) return NULL;
    void *p = &pool[used]; used += n; return p;
}`},
q:{ask:"Why is fragmentation worse than running out of memory?",
ans:"Running out is deterministic and testable. Fragmentation depends on the history of allocations, so it appears after weeks in the field and cannot be reproduced on the bench."}},

{id:"allocstrat", code:"2.29", t:"Static allocation as a design strategy",
kick:"Deciding every object's existence at link time, and what that buys you.",
tags:["design","memory"],prereq:["heap"],
L:{
idea:"If every buffer, task stack, queue and object is declared statically, the linker computes total RAM use at build time. The build either fits or fails; it never fails at 3 a.m. in a vehicle.",
link:"The map file becomes a complete RAM budget. Nothing can appear at run time that the linker did not already account for, which is the property safety analysis needs.",
run:"Fixed pools replace malloc: a static array of N objects plus a free bitmap or index list. Allocation becomes constant time and failure becomes a compile-time-visible capacity limit rather than a run-time surprise.",
design:"The cost is that peak usage must be provisioned for all the time, so static allocation typically uses more RAM than a dynamic scheme would at its average. That trade is deliberate: determinism bought with memory.",
trap:"A pool sized from average load rather than worst case. Size from the worst case that can occur, then add the margin your process requires, and assert on the high-water mark in development builds."
},
src:{cap:"A fixed pool: constant time, bounded, and visible in the map file.",code:`#define MSG_POOL_N 16
static msg_t   pool[MSG_POOL_N];
static uint16_t in_use;      /* one bit per slot */

msg_t *msg_acquire(void) {
    for (unsigned i = 0; i < MSG_POOL_N; i++)
        if (!(in_use & (1u << i))) { in_use |= (1u << i); return &pool[i]; }
    return NULL;             /* capacity is a known constant */
}`},
q:{ask:"What replaces out-of-memory handling in a statically allocated system?",
ans:"Pool exhaustion, which is a known, bounded condition you can test by filling the pool. The failure path is designed, not discovered."}},

{id:"recursion", code:"2.30", t:"Recursion, reentrancy and pure functions",
kick:"Three related properties, and only one of them is usually wanted in firmware.",
tags:["c-core","design"],prereq:["stackframe","static"],
L:{
idea:"A recursive function calls itself, so stack use depends on data rather than on the call graph. A reentrant function can be safely entered again before the first call returns — from an ISR or another task — which requires it to touch no shared mutable state. A pure function depends only on its arguments.",
mem:"Recursion makes worst-case stack depth depend on run-time call depth, which is why safety-oriented coding standards commonly prohibit or tightly restrict it. Function pointers also complicate static call-graph analysis when their targets are not bounded and explicit.",
run:"A function using a local static, a global, or a shared buffer is not reentrant. Calling it from both mainline and an ISR corrupts its state in a way that depends on interrupt timing, so it fails rarely and never reproducibly.",
design:"Make functions take their state as a pointer parameter. That single habit makes them reentrant, testable, and usable by two instances of the same driver.",
trap:"strtok, and any library function with hidden state. Check the reentrancy notes for every library call you make from an ISR."
},
src:{cap:"The same logic, non-reentrant and reentrant.",code:`/* not reentrant: hidden shared state */
uint16_t crc_step(uint8_t b) {
    static uint16_t crc = 0xFFFFu;
    return crc = crc_table[(crc ^ b) & 0xFFu] ^ (crc >> 8);
}

/* reentrant: caller owns the state */
uint16_t crc_step_r(uint16_t crc, uint8_t b) {
    return crc_table[(crc ^ b) & 0xFFu] ^ (crc >> 8);
}`},
q:{ask:"Why does making a function reentrant usually also make it unit-testable?",
ans:"Both require that all inputs and outputs are explicit. Once state arrives by pointer, a test can construct any state directly instead of replaying a sequence."}}

);
</script>
