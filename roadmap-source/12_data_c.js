<script>
STAGES.push({
id:"s2", n:"2", title:"The C language, taken apart",
blurb:"Take familiar C apart until its hidden rules and costs are visible: lifetime, types, conversions, pointers, layout, control flow and storage. Read source as a set of contracts: what does the program promise, what does the compiler know, and what representation can result?",
meta:"30 topics · needs stages 0 and 1 · the core of the course",
topics:[

{id:"tu", code:"2.01", t:"Translation units, declarations and definitions",
kick:"The distinction that explains every undefined and every duplicate symbol error you will ever see.",
tags:["c-core","linker"],prereq:["preproc","linker"],
L:{
idea:"A declaration introduces a name and its type. A definition also reserves storage or provides a body. You may declare a name many times and define it exactly once across the whole program.",
compile:"The compiler sees one translation unit: one .c file plus everything it included. A declaration is enough to generate correct code for a call or an access, because the type tells it how to pass arguments and how wide the access is.",
link:"The linker is where the one-definition rule is enforced. Two definitions give a duplicate symbol; zero definitions give undefined reference. Both errors point at the same misunderstanding.",
mem:"A definition in a header included by five files creates five objects, each with the same name, in five translation units. Put declarations in headers and definitions in exactly one .c file.",
trap:"int counter; in a header. Before -fno-common became the default this quietly merged into one variable; now it is a link error, and the fix is extern in the header plus one definition in a .c file."
},
src:{cap:"The header and source split that works and the one that does not.",code:`/* sensor.h */
extern uint16_t sensor_raw;      /* declaration: no storage */
uint16_t sensor_read(void);      /* declaration: no body    */

/* sensor.c */
uint16_t sensor_raw;             /* definition: 2 bytes in .bss */
uint16_t sensor_read(void) { return sensor_raw; }  /* definition */`},
q:{ask:"Is extern int x = 5; in a header a declaration or a definition?",
ans:"A definition, because of the initialiser. extern does not save you here, and including that header twice is a duplicate symbol."}},

{id:"types", code:"2.02", t:"Types, sizes and stdint.h",
kick:"Choosing a type is choosing a width, a signedness and a set of conversion rules.",
tags:["c-core","numbers"],prereq:["bits","tu"],
L:{
idea:"A type tells the compiler three things: how many bytes to reserve, how to interpret the bits, and which conversions apply when it meets another type. The exact-width types in stdint.h let you state the first two without depending on the target.",
compile:"The compiler picks the load and store instruction width from the type. uint8_t generates LDRB, uint32_t generates LDR. Widening and narrowing conversions are inserted for you at every boundary.",
mem:"A uint8_t array is dense; a struct of uint8_t members is often not, because of alignment padding (topic 2.21). Choosing uint8_t to save RAM only works in arrays and packed contexts.",
hw:"On a 32-bit core, 8-bit and 16-bit locals are frequently slower than 32-bit ones, because each arithmetic operation needs an extra truncation to keep the declared width. Use uint32_t for loop counters and uint8_t for storage.",
trap:"Plain char signedness is implementation-defined; do not assume a universal ARM-versus-x86 rule. Use int8_t or uint8_t when numeric signedness matters, and char for character data."
},
src:{cap:"The types worth using, and what each one is for.",code:`uint8_t   flags;      /* a byte of bits or a byte of storage */
int16_t   temp_c10;   /* a signed value with a known range  */
uint32_t  ticks;      /* counters, timestamps, register values */
size_t    len;        /* anything that is a count of objects */
ptrdiff_t delta;      /* difference of two pointers */
bool      ready;      /* from stdbool.h; 1 byte, 0 or 1 */
uint_fast16_t i;      /* at least 16 bits, fastest such type */`},
q:{ask:"Why does a tight loop over a uint8_t index often produce more instructions than over a uint32_t index on Cortex-M?",
ans:"Every increment must be truncated back to 8 bits to preserve the declared type, adding a UXTB. The 32-bit counter needs no such correction."}},

{id:"scope", code:"2.03", t:"Scope, linkage and storage duration",
kick:"Three independent properties that people collapse into the single word global.",
tags:["c-core","memory"],prereq:["tu"],
L:{
idea:"Scope is where the name is visible in the source. Linkage is whether other translation units can refer to the same object. Storage duration is how long the object exists. A file-scope static has file scope, internal linkage and static duration — three separate facts.",
compile:"Scope is resolved entirely at compile time and vanishes from the object file. Linkage is what survives into the symbol table for the linker to match up.",
mem:"Storage duration decides the section. Static duration means .data or .bss and an address fixed at link time. Automatic duration means a stack slot, created on entry and gone on return. Allocated duration means the heap.",
run:"An automatic object's lifetime ends at the closing brace. Its bytes are still there, which is why returning a pointer to a local appears to work and then fails as soon as another call reuses the stack.",
trap:"A local array returned by address. The compiler may warn, the code may run for months, and the failure arrives when an interrupt lands on the same stack region."
},
src:{cap:"Same name, four different meanings.",code:`int      a;             /* file scope, external linkage, static duration */
static int b;           /* file scope, internal linkage, static duration */
void f(void) {
    int c;              /* block scope, no linkage, automatic duration   */
    static int d;       /* block scope, no linkage, static duration      */
}`},
q:{ask:"Two files each define static int state; Is that a duplicate symbol?",
ans:"No. static gives internal linkage, so they are two distinct objects and the linker never compares them."}},

{id:"static", code:"2.04", t:"static, in both of its meanings",
kick:"One keyword, two unrelated jobs, and both matter in firmware.",
tags:["c-core","memory"],prereq:["scope"],
L:{
idea:"At file scope, static restricts a name to this translation unit. Inside a function, static changes a local's storage duration to the whole program run while keeping its name local.",
compile:"File-scope static tells the compiler no other file can touch this, which unlocks real optimisation: inlining, constant propagation, and complete removal if unused. It is the cheapest optimisation hint you can give.",
mem:"A function-local static is not on the stack. It lives in .data or .bss with a fixed address, so it survives between calls and costs RAM for the whole program run, not just during the call.",
run:"A local static is initialised once, before main, not on first call. In C there is no run-time guard for this, unlike C++.",
trap:"A local static in a function called from two tasks or from both main and an ISR. It is shared state with none of the visual warning that a global gives you."
},
src:{cap:"Three statics, three quite different objects.",code:`static uint32_t errors;            /* private to this file, in .bss */

static void reset_counters(void) { errors = 0u; }  /* private function */

uint32_t next_id(void) {
    static uint32_t id;            /* one object, survives every call */
    return ++id;                   /* not reentrant, not ISR-safe     */
}`},
q:{ask:"Why does making every non-API function static often shrink the image?",
ans:"With no external linkage the compiler can inline them and delete the out-of-line copy, and --gc-sections can drop anything unreferenced."}},

{id:"externg", code:"2.05", t:"extern and the design of shared state",
kick:"Sharing a variable across files is easy. Doing it so the code stays testable is not.",
tags:["c-core","design"],prereq:["static"],
L:{
idea:"extern says the object is defined elsewhere. It is the mechanism for cross-file access, and it is also the most common way firmware turns into a codebase where nothing can be tested in isolation.",
link:"Every extern creates a link-time dependency. A module with ten externs cannot be unit-tested without providing ten definitions, which is a reliable signal that the design should use an accessor or a pass-by-pointer context instead.",
mem:"Extern globals live in .data or .bss and are visible to every file that declares them, including the ones that should not touch them.",
trap:"Declaring an extern by hand in a .c file instead of including the header. The two declarations can then disagree in type — uint16_t in one and uint32_t in the other — and the linker matches by name only, so you get a silent width mismatch.",
compile:"extern tells a translation unit that an object or function exists elsewhere; it does not allocate storage for an object definition. The compiler checks the declaration locally, while the linker checks whether a matching definition exists globally.",
run:"There is only one storage location for a shared object with external linkage. Every translation unit that uses it should see a compatible declaration, otherwise the program can link and still have type/ABI mismatches.",
design:"Prefer a narrow module interface over a header full of mutable globals. If shared state is necessary, expose ownership and update rules along with the declaration.",
},
src:{cap:"The shape that survives review.",code:`/* prefer this: state is private, access is explicit */
static struct { uint16_t raw; bool valid; } s_sensor;

bool sensor_get(uint16_t *out);    /* the whole public surface */

/* over this: anyone can write it, nobody can test it */
extern uint16_t sensor_raw;`},
q:{ask:"Why is a hand-written extern in a .c file more dangerous than one in a shared header?",
ans:"Because only the header guarantees both sides see the same type. The linker matches names, not types, so a mismatch compiles and links and then corrupts memory."}},

{id:"constk", code:"2.06", t:"const, and what it is really promising",
kick:"const is a promise you make to the compiler, not a lock the hardware enforces.",
tags:["c-core","memory"],prereq:["types","sections"],
L:{
idea:"const means this code will not modify the object through this name. For an object defined const it also means the object itself is immutable, which lets the compiler place it in read-only memory.",
compile:"const on a parameter or a local is an optimisation hint and a documentation device. const on a file-scope definition is a placement decision: it moves the object from .data to .rodata.",
mem:"On a microcontroller this is the difference between costing RAM and costing only flash. A const lookup table of 4 KB is free in RAM; the same table without const costs 4 KB of RAM plus 4 KB of flash for the initialiser.",
trap:"Casting const away and writing anyway. If the object really is in flash the write silently fails or faults. Also: const char *p is a pointer to const char, while char *const p is a const pointer. Read right to left.",
run:"const prevents modification through the qualified access path; it does not automatically make the underlying storage physically read-only. Whether an object lives in Flash depends on initialization, linkage, toolchain policy and target memory rules.",
design:"Use const to express an API and data-flow contract first. Treat Flash placement as a separate build concern, then verify it in the map file when RAM usage matters.",
},
src:{cap:"Four spellings, three different objects.",code:`const char  *p;        /* p can move, *p cannot be written through p */
char *const  q = buf;  /* q cannot move, *q can be written */
const char *const r = msg;   /* neither */

const uint16_t sine[256] = { /* ... */ };   /* .rodata, flash only */`},
q:{ask:"Does const on a pointer parameter make the function safe to call with a buffer in flash?",
ans:"It makes it safe from this function writing through that pointer, and it documents the contract. It does not prevent another alias from writing to the same object."}},

{id:"volatilek", code:"2.07", t:"volatile: first pass",
kick:"Three situations need it, and exactly three.",
tags:["c-core","hardware"],prereq:["mmio","compiler"],
L:{
idea:"volatile tells the compiler this object may change without the program changing it, and that every read and write in the source must appear in the generated code, in order, without merging or elimination.",
compile:"Without it, the compiler may keep a value in a register across a loop, delete a second read of the same address, or merge two writes. All are legal because the abstract machine sees no difference. All are wrong against hardware.",
run:"The three cases that need it: memory-mapped hardware registers, variables shared between an ISR and mainline code, and variables touched across a setjmp boundary. Nothing else.",
hw:"It constrains the compiler only. It does not constrain the CPU's write buffer, the bus, or another core. That is topic 3.06 and 3.08.",
trap:"Adding volatile to fix a threading bug. It stops the compiler caching the value, which sometimes makes the symptom go away, while the real problem — a non-atomic read-modify-write — is untouched."
},
src:{cap:"The flag that a missing volatile turns into an infinite loop.",code:`volatile bool rx_ready;      /* set inside the UART ISR */

void wait_rx(void) {
    while (!rx_ready) { }    /* without volatile: loaded once, loops forever */
    rx_ready = false;
}`},
q:{ask:"You add volatile to a shared 64-bit counter and the corruption continues on a 32-bit core. Why?",
ans:"volatile does not make the access atomic. The 64-bit read is two loads, and an interrupt between them yields a torn value."}},

{id:"promo", code:"2.08", t:"Integer promotion and the usual arithmetic conversions",
kick:"The most-used rule in C, and the least-read. It causes real firmware bugs every year.",
tags:["c-core","numbers"],prereq:["types","signext"],
L:{
idea:"Any operand narrower than int is promoted to int before arithmetic. When operands differ, the narrower is converted to the wider; at equal rank, signed converts to unsigned. So arithmetic on uint8_t happens in int, and a comparison between int and unsigned int happens in unsigned.",
compile:"These conversions are inserted silently. -Wconversion and -Wsign-compare are the only things that make them visible, and turning them on for the first time on an existing codebase is an education.",
run:"The classic: a signed negative value compared against an unsigned becomes a huge positive, so the comparison goes the wrong way and a bounds check passes when it should fail.",
trap:"~flags on a uint8_t. flags promotes to int, the complement is a negative int, and assigning back truncates. It usually works and then does not, once the value is compared or widened instead of stored.",
mem:"Promotions can widen a small object before arithmetic, so the expression's temporary type may be wider than the object's storage. This matters when the result is assigned back, shifted, or compared with a signed value.",
hw:"On a Cortex-M, promotion often changes whether the compiler uses byte/halfword loads followed by extension or a wider load. The important rule is the C type conversion; instruction choice is target-specific.",
},
src:{cap:"Two lines that behave the opposite of how they read.",code:`uint8_t a = 200, b = 100;
uint8_t c = a + b;              /* computed as int 300, truncated to 44 */
if (a + b > 255) { }            /* TRUE: the comparison sees 300 */

int      n  = -1;
unsigned m  = 1u;
if (n < m) { }                  /* FALSE: n becomes 4294967295 */

uint8_t f = 0x0Fu;
uint8_t g = (uint8_t)~f;        /* cast back, or you keep an int */`},
q:{ask:"Is (uint16_t)0xFFFF * (uint16_t)0xFFFF well-defined on a 32-bit int target?",
ans:"No. Both promote to signed int, the product 4294836225 overflows a 32-bit signed int, and signed overflow is undefined. Cast one operand to uint32_t first."}},

{id:"operators", code:"2.09", t:"Operators, precedence and evaluation order",
kick:"Evaluation order is mostly unspecified, and the compiler uses that freedom.",
tags:["c-core"],prereq:["promo"],
L:{
idea:"Precedence decides how an expression is parsed. Order of evaluation decides when each subexpression is computed, and for most operators C deliberately does not specify it. Only &&, ||, the comma operator and the conditional impose an order.",
compile:"Argument evaluation order is often unspecified, so f(i++, i) does not give you a portable order for the two arguments. More generally, modifying and accessing the same scalar without the required sequencing is undefined; write expressions so side effects are separated and obvious.",
hw:"&& and || short-circuit, which firmware relies on constantly: if (p != NULL && p->ready) is safe only because the right side is not evaluated when the left is false.",
trap:"& and | have lower precedence than == in C, so if (reg & MASK == 0) parses as reg & (MASK == 0) and is almost always wrong. Parenthesise bit tests, always.",
run:"Evaluation order determines which side effects happen before another operation is observed. Precedence only groups syntax; it does not by itself sequence side effects. Separate complex expressions when correctness depends on order.",
design:"Prefer one side effect per statement when interacting with shared state, volatile registers or function calls. The extra line makes the intended ordering visible and easier to review.",
},
src:{cap:"Four expressions that do not do what they look like.",code:`if (reg & MASK == 0) { }       /* parses as reg & (MASK == 0) */
if ((reg & MASK) == 0) { }     /* what was meant */

a = i++ + i;                   /* undefined: unsequenced modification and access */
f(i++, i);                     /* unspecified: argument order */
x = x++;                       /* undefined */`},
q:{ask:"Why is if (flags & FLAG_A == FLAG_A) a bug even though it compiles cleanly?",
ans:"== binds tighter than &, so it evaluates FLAG_A == FLAG_A, which is 1, and then tests flags & 1 — bit 0, not FLAG_A."}},

{id:"control", code:"2.10", t:"Control flow and the branches it becomes",
kick:"if, switch and loops are notation for compare-and-branch. Some choices cost more than others.",
tags:["c-core"],prereq:["cpu"],
L:{
idea:"Every conditional becomes a comparison that sets flags plus a conditional branch. Loops are a branch backwards. switch is either a chain of comparisons or a jump table, decided by the compiler based on how dense the case values are.",
compile:"A dense switch becomes a table of addresses in .rodata and one indexed branch — constant time regardless of the number of cases. A sparse switch becomes an if-else chain and its cost depends on which case you hit. This is why state machine state values are usually 0..n and not scattered constants.",
run:"Branches cost more than straight-line code on a pipelined core because a taken branch may flush the pipeline. Branchless idioms matter in tight control loops, less so elsewhere.",
trap:"Fallthrough in switch. It is legal, occasionally intended, and a frequent source of bugs. Mark intended fallthrough explicitly and turn on -Wimplicit-fallthrough.",
hw:"Branches become conditional branches, compare-and-branch sequences, or sometimes conditional/select instructions depending on the target and optimisation. A C if statement does not guarantee one particular instruction sequence.",
design:"In timing-sensitive firmware, reason about the worst-case path rather than assuming the source order implies constant execution time. Measure or inspect the generated code when the timing contract is real.",
},
src:{cap:"A switch that becomes a jump table, and one that cannot.",code:`switch (state) {            /* 0,1,2,3 -> jump table, constant time */
case ST_IDLE:  ...; break;
case ST_ARM:   ...; break;
case ST_APPLY: ...; break;
default:       ...; break;
}

switch (can_id) {           /* 0x120, 0x3F8, 0x7A1 -> compare chain */
case 0x120u: ...; break;
case 0x3F8u: ...; break;
}`},
q:{ask:"Why does a state machine with enum values 1, 16, 32, 64 run slower than one with 0, 1, 2, 3?",
ans:"The sparse values prevent a jump table, so the compiler emits a comparison chain and the cost depends on which state you are in — bad for worst-case timing analysis."}},

{id:"funcs", code:"2.11", t:"Functions, the ABI and the calling convention",
kick:"What actually happens across a call boundary, in registers.",
tags:["c-core","hardware"],prereq:["cpu","control"],
L:{
idea:"A function call follows the target ABI: arguments and return values use specified registers or stack locations, control transfers while preserving a return address, and the callee preserves the state the ABI requires. The ABI is the contract that lets separately compiled code interoperate.",
hw:"On the ARM AAPCS, r0 to r3 carry the first four word-sized arguments and r0 holds the return value. Further arguments go on the stack. LR holds the return address; a leaf function need not touch the stack at all.",
mem:"r0-r3 and r12 are caller-saved — the callee may destroy them. r4-r11 are callee-saved, so a function using them must push and pop them. That push and pop is the prologue and epilogue you see in every disassembly.",
compile:"Passing a large struct by value copies the whole thing, often via the stack, on every call. Passing a pointer costs one register. This matters in an interrupt path.",
trap:"Calling a function without a visible prototype. Modern C requires a declaration, and mismatched declarations can corrupt arguments or the return value at the ABI boundary. Enable diagnostics such as -Wmissing-prototypes and -Wmissing-declarations where appropriate."
},
src:{cap:"Two signatures, very different cost.",code:`typedef struct { uint8_t d[64]; } frame_t;

void send_slow(frame_t f);          /* copies 64 bytes per call */
void send_fast(const frame_t *f);   /* one register */

/* void in the parameter list means no parameters. empty means unspecified. */
void init(void);`},
q:{ask:"Why does void f() differ from void f(void) in C?",
ans:"The empty list means the parameters are unspecified, so the compiler cannot check the call. void makes it a real zero-argument prototype."}},

{id:"stackframe", code:"2.12", t:"The stack frame",
kick:"Where your locals actually are, and what overflows when the stack does.",
tags:["c-core","memory"],prereq:["funcs"],
L:{
idea:"Each call pushes a frame holding the saved registers, the return address if needed, and the local variables that did not fit in registers. SP moves down on entry and back up on exit.",
mem:"A common Cortex-M layout places the stack near the top of RAM and grows it toward lower addresses. If it grows into other RAM allocations, it can corrupt globals, heap state, or another task stack. Protection depends on the MCU and configuration; do not assume a guard page exists.",
run:"For ordinary functions, the compiler can determine a fixed frame size for a given build, while variable-length arrays and alloca make stack use depend on run-time state. Safety-oriented firmware often avoids those constructs so worst-case stack usage can be bounded.",
hw:"Cortex-M has MSP and PSP. A typical RTOS uses PSP for thread mode and MSP for handlers. Exception entry still stacks the interrupted context on the currently active stack before the handler runs, so interrupt nesting contributes to stack usage and must be included in worst-case analysis.",
trap:"A large automatic buffer in code reachable from an ISR can consume stack on top of the interrupted context. On a small stack, the failure may appear only at maximum nesting or worst-case interrupt timing."
},
src:{cap:"The declaration that quietly costs a kilobyte of stack.",code:`void parse(void) {
    uint8_t scratch[1024];     /* on the stack, every call */
    ...
}

void parse_ok(void) {
    static uint8_t scratch[1024];   /* .bss: costs RAM once, not per call */
    ...                             /* but now the function is not reentrant */
}`},
q:{ask:"How do you measure actual worst-case stack usage on a running target?",
ans:"Fill the stack region with a known pattern at startup and later scan for the high-water mark. Combine it with static analysis from the call graph, because a rare path may never have run."}},

{id:"arrays", code:"2.13", t:"Arrays",
kick:"A contiguous block with no length attached, which is the root of half of C's bugs.",
tags:["c-core","memory"],prereq:["types","memarray"],
L:{
idea:"An array is n objects of one type laid out back to back with no gaps. The name is not a pointer, but in almost every expression it decays into a pointer to the first element, and the length is lost at that moment.",
compile:"sizeof works on a real array and gives the total bytes. Inside a function that took the array as a parameter, the parameter is a pointer and sizeof gives the pointer size. This is why the length must be passed alongside.",
mem:"Elements are adjacent, so a[i] is computed as base + i * sizeof(element). There is no bounds check anywhere, at any optimisation level, ever.",
run:"Out-of-bounds access reads or writes whatever is next in memory: another variable, a saved return address, a peripheral register. The corruption shows up somewhere else entirely, which is why these bugs take days.",
trap:"sizeof(arr)/sizeof(arr[0]) inside a function that received the array as a parameter. It compiles and gives 1 on a 32-bit target for a 4-byte element type."
},
src:{cap:"The count idiom and where it stops working.",code:`#define COUNT(a) (sizeof(a) / sizeof((a)[0]))

void caller(void) {
    uint16_t buf[8];
    process(buf, COUNT(buf));     /* correct here */
}

void process(uint16_t *buf, size_t n) {
    size_t wrong = COUNT(buf);    /* 4/2 = 2. buf is a pointer here. */
}`},
q:{ask:"Why does C99 let you write void f(size_t n, uint16_t buf[static n])?",
ans:"It documents that the caller must pass at least n elements and lets the compiler diagnose some violations. It is documentation with a small amount of enforcement, not a bounds check."}},

{id:"strings", code:"2.14", t:"Strings and the terminating zero",
kick:"C has no string type. It has a convention, and the convention is easy to break.",
tags:["c-core","memory"],prereq:["arrays"],
L:{
idea:"A string is a char array whose end is marked by a zero byte. Every library function relies on that byte being present. The length is not stored anywhere; strlen finds it by scanning.",
mem:"A string literal is an anonymous array in .rodata. char *p = \"hi\" points into flash; char a[] = \"hi\" copies three bytes into a writable array.",
compile:"sizeof(\"hi\") is 3 and strlen(\"hi\") is 2. The difference is the terminator, and mixing them up is how buffers end up one byte short.",
run:"strncpy does not always terminate. If the source is as long as the limit, the destination can be unterminated. snprintf writes a terminator when its size argument is greater than zero, so its bound and return value still need to be handled deliberately.",
trap:"Writing through a pointer to a string literal. It is undefined behaviour, and on a microcontroller the target is in flash, so the write is simply lost."
},
src:{cap:"Two declarations that look alike and live in different memories.",code:`char *p = "fault";     /* pointer into .rodata. p[0] = 'F' is UB */
char  a[] = "fault";   /* 6 bytes copied into .data or the stack. writable */

char dst[8];
strncpy(dst, src, sizeof dst);      /* may leave dst unterminated */
snprintf(dst, sizeof dst, "%s", src); /* terminates when sizeof dst > 0 */`},
q:{ask:"Why is snprintf often avoided in constrained firmware despite being safer?",
ans:"It pulls in several kilobytes of formatting code, and its execution time depends on the format string, which is bad for worst-case timing. Many projects use a small fixed-purpose formatter instead."}},

{id:"pointers", code:"2.15", t:"Pointers",
kick:"A variable holding an address, with a type that says how to interpret what is there.",
tags:["c-core","memory"],prereq:["memarray","arrays"],
L:{
idea:"A pointer stores an address. Its type determines the width of the access when you dereference, and the step size when you do arithmetic. Two pointers to the same address with different types read the same bytes as different values.",
mem:"On the fixed 32-bit Cortex-M teaching target, ordinary object pointers are 32-bit addresses. The pointer variable itself lives wherever it was declared — stack, .bss or .data — while the object it points at may live elsewhere. Do not generalize that size to every C implementation or every pointer representation.",
compile:"Dereferencing is a load or store instruction with the width taken from the pointed-to type. The compiler tracks the type; the hardware only sees an address and a width.",
run:"A pointer can hold any address including addresses with nothing behind them. Dereferencing an uninitialised pointer is not caught; it just accesses whatever that number happens to name.",
trap:"NULL is a C null pointer value, not a promise about the hardware address. On many Cortex-M systems address 0 is mapped to the vector table, so an invalid read through a null pointer can appear to return plausible data instead of faulting. Do not use that behaviour as a validity check."
},
src:{cap:"Same address, three interpretations.",code:`uint32_t word = 0x12345678u;
uint8_t  *b = (uint8_t *)&word;   /* b[0] is 0x78 on little-endian */
uint16_t *h = (uint16_t *)&word;  /* h[0] is 0x5678 */

*b = 0xFFu;                       /* word becomes 0x123456FF */`},
q:{ask:"Why does a null pointer dereference not always fault on Cortex-M?",
ans:"Address 0 is usually mapped to flash holding the vector table, so a read succeeds and returns data. Writes fault, reads do not. An MPU region over address 0 makes both fault, which is worth configuring."}},

{id:"ptrarith", code:"2.16", t:"Pointer arithmetic",
kick:"Adding one to a pointer moves it by one object, not one byte.",
tags:["c-core","memory"],prereq:["pointers"],
L:{
idea:"p + n advances by n * sizeof(*p) bytes. Subtracting two pointers into the same array gives the number of elements between them, as a ptrdiff_t. This is why a[i] is exactly *(a + i), and why 3[a] is legal and identical.",
compile:"The compiler turns the scaled index into address-generation instructions appropriate for the target. Some Cortex-M instructions can combine shifts with addressing, while other cases need separate arithmetic; do not assume pointer arithmetic is always free.",
trap:"Arithmetic on a void * is not standard C, though GCC allows it as an extension treating the step as one byte. Cast to uint8_t * when you mean byte arithmetic. And arithmetic that leaves the bounds of an object is undefined even if you never dereference it — one past the end is the only legal exception.",
mem:"Pointer arithmetic is defined in elements of the pointed-to type, not bytes. p+1 advances one element, so the address change depends on sizeof(*p). One-past-the-end pointers may be formed for an array, but not dereferenced.",
run:"Dereferencing is valid only when the pointer designates an appropriate live object. Integer address arithmetic may produce a numerically plausible address while still violating the C object model.",
hw:"For MMIO or byte buffers, use an explicitly byte-sized pointer when byte addressing is intended. Do not rely on pointer arithmetic over a peripheral struct unless the register layout and alignment are defined by the device header.",
},
src:{cap:"Byte arithmetic on a register block, done so it is defined.",code:`volatile uint32_t *base = (volatile uint32_t *)0x40020000u;
volatile uint32_t *odr  = base + 5u;         /* +20 bytes, not +5 */

/* when the datasheet gives a byte offset */
#define REG_AT(b, off) (*(volatile uint32_t *)((uint8_t *)(b) + (off)))`},
q:{ask:"If p is uint32_t * holding 0x20000100, what is p + 4?",
ans:"0x20000110. The step is four bytes per element, so four elements is sixteen bytes."}},

{id:"arrptr", code:"2.17", t:"Arrays and pointers are not the same thing",
kick:"They behave alike in expressions and differently everywhere that matters.",
tags:["c-core","memory"],prereq:["ptrarith"],
L:{
idea:"An array is a block of storage; a pointer is a variable holding an address. An array name decays to a pointer in most expressions, but not with sizeof, not with &, and not in a declaration of the object itself.",
mem:"extern char buf[]; and extern char *buf; are not interchangeable even though both compile. The first names the storage; the second names a pointer variable that must itself exist. Mismatching them across files makes the code read the first four bytes of the array as an address and dereference it.",
link:"The linker matches by name, so that mismatch links cleanly and crashes at run time. It is one of the few remaining errors that a modern toolchain will not catch for you.",
trap:"Declaring extern char *table; in a .c file when the definition is char table[256];. This is the canonical why does this link and then hard-fault question.",
compile:"An array expression often converts to a pointer to its first element, but the array object itself is not a pointer and sizeof(array) is the whole array size. Function parameters are a special case where array syntax is adjusted to pointer syntax.",
run:"The distinction matters for bounds and lifetime. A pointer can be redirected; an array's storage and size are fixed for its lifetime. Passing an array to a function loses the size unless you pass it separately or use a known convention.",
},
src:{cap:"The mismatch that links and then faults.",code:`/* table.c */
char table[256];

/* user.c -- WRONG */
extern char *table;        /* reads table[0..3] as an address */
char c = table[0];         /* dereferences garbage */

/* user.c -- RIGHT */
extern char table[];`},
q:{ask:"Why does sizeof behave differently on an array and on a pointer to its first element?",
ans:"sizeof is one of the contexts where the array does not decay, so it reports the whole block. On the pointer it reports the pointer width."}},

{id:"funcptr", code:"2.18", t:"Function pointers, callbacks and jump tables",
kick:"Code addresses stored in data, which is how drivers get decoupled and how firmware gets dispatch tables.",
tags:["c-core","design"],prereq:["pointers","funcs"],
L:{
idea:"A function pointer holds the address of executable code. Calling through it is an indirect branch. This is the mechanism behind callbacks, driver interfaces, state machine tables and the vector table itself.",
mem:"A const table of function pointers lives in .rodata in flash and costs no RAM. Drop the const and you pay RAM and, worse, allow corruption to redirect execution.",
run:"An indirect call cannot be inlined and defeats some optimisations, and on a pipelined core it may cost a pipeline flush. In hot loops that is measurable; in dispatch code it is irrelevant.",
hw:"On Cortex-M the low bit of a function address must be 1 to indicate Thumb state. The compiler handles this, but hand-built tables or a bootloader jumping to an application must preserve it or the core takes a UsageFault.",
trap:"A null or stale callback pointer. Always check before calling, and prefer a no-op default over NULL so the check cannot be forgotten."
},
src:{cap:"A state machine as a table, which is constant time and easy to review.",code:`typedef void (*handler_t)(const msg_t *);

static void on_idle(const msg_t *m);
static void on_armed(const msg_t *m);

static handler_t const table[ST_COUNT] = {
    [ST_IDLE]  = on_idle,
    [ST_ARMED] = on_armed,
};

if (state < ST_COUNT && table[state] != NULL) { table[state](&msg); }`},
q:{ask:"Why must a bootloader set the Thumb bit when jumping to an application entry point?",
ans:"Cortex-M only executes Thumb code, and the low address bit selects the instruction set. A jump to an even address requests ARM state, which does not exist, so the core faults."}}

]});
</script>
