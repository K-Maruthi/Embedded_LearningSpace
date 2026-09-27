<script>
const LENSES = [
  {k:"idea",    label:"the idea",        c:"var(--ink-2)"},
  {k:"compile", label:"at compile time", c:"var(--link)"},
  {k:"link",    label:"at link time",    c:"var(--violet)"},
  {k:"mem",     label:"in memory",       c:"var(--accent)"},
  {k:"run",     label:"at run time",     c:"var(--ok)"},
  {k:"hw",      label:"cpu and hardware",c:"var(--steel)"},
  {k:"design",  label:"as design",       c:"var(--olive)"},
  {k:"trap",    label:"where it bites",  c:"var(--warn)"}
];

const MEMMAP = [
  {addr:"0x0800 0000", nm:".isr_vector", sub:"reset vector, stack top, handler table", c:"var(--violet)", h:26, tag:"vector"},
  {addr:"0x0800 01C0", nm:".text",       sub:"your code, in flash, execute in place",  c:"var(--steel)", h:64, tag:"text"},
  {addr:"0x0801 8A40", nm:".rodata",     sub:"const data, string literals, tables",    c:"var(--link)",  h:34, tag:"rodata"},
  {addr:"0x0801 F200", nm:"data LMA",    sub:"initial values, copied to RAM at boot",  c:"var(--accent)",h:20, tag:"data"},
  {addr:"0x2000 0000", nm:".data",       sub:"initialised globals, now in RAM",        c:"var(--accent)",h:26, tag:"data"},
  {addr:"0x2000 0480", nm:".bss",        sub:"zero-initialised globals and statics",   c:"var(--ok)",    h:38, tag:"bss"},
  {addr:"0x2000 1E00", nm:"heap",        sub:"malloc arena, grows up, often unused",   c:"var(--ink-3)", h:22, tag:"heap"},
  {addr:"0x2000 4000", nm:"stack",       sub:"frames, locals, return addresses; down", c:"var(--warn)",  h:44, tag:"stack"},
  {addr:"0x4000 0000", nm:"peripherals", sub:"memory-mapped registers, not memory",    c:"var(--warn)",  h:30, tag:"mmio"},
  {addr:"0xE000 E000", nm:"core private",sub:"NVIC, SysTick, SCB, MPU, debug",         c:"var(--violet)",h:22, tag:"nvic"}
];

const STAGES = [];

STAGES.push({
id:"s0", n:"0", title:"Machine foundations",
blurb:"Start at the machine: bits become values, values become addresses, and addresses reach memory and peripherals. Do not memorise isolated facts. Build enough of the Cortex-M model that you can predict representation, width, alignment, access and observable hardware effects.",
meta:"17 topics · no prerequisites · build the machine model before the C rules",
topics:[

{id:"bits", code:"0.01", t:"Bits, bytes, words and the width of a machine",
kick:"Why an 8-bit MCU and a 32-bit MCU disagree about what a single instruction can touch.",
tags:["foundation","numbers"],
L:{
idea:"A bit is one two-state storage element. Eight of them make a byte, the smallest thing most memories will let you address individually. A word is whatever width the CPU handles most naturally, which is usually the width of its registers and its ALU: 8 bits on an AVR, 32 on a Cortex-M, 64 on an application processor.",
mem:"Most microcontroller memories are byte-addressable, but the CPU, bus matrix, cache, and memory interface may move data in wider beats. A byte access therefore does not imply one byte-wide physical bus transaction, and the exact transfer depends on the target. Keep the language-level address model separate from the implementation-level bus transaction.",
hw:"Word width sets what one instruction can do. A 32-bit add is one cycle on Cortex-M; a 32-bit add on an 8-bit AVR is four add-with-carry instructions the compiler writes for you. When someone says a chip is slow at long arithmetic, this is what they mean.",
trap:"Assuming int is 32 bits. C only promises int is at least 16. On a small PIC or MSP430 it really is 16, so a loop counter that reaches 40000 silently wraps. This is why firmware code writes uint32_t and not int.",
compile:"The compiler chooses instruction widths and object representations from the target ABI; sizeof(char) is always 1 in C, but a byte is the unit of the C object model and need not equal the CPU's preferred word size.",
run:"At run time, width determines range, promotion behaviour and how many memory bytes an access touches. The safest reasoning starts with the declared type, then asks what the target instruction and bus actually do.",
design:"Choose fixed-width types when the width is part of the protocol, register, storage or timing contract. Use plain int when the algorithm genuinely benefits from the target's natural integer type and its exact width is irrelevant.",
},
src:{cap:"Widths you can rely on, and the one you cannot.",code:`#include <stdint.h>

uint8_t  flags;      /* exactly 8 bits, everywhere */
uint32_t ticks;      /* exactly 32 bits, everywhere */
int      count;      /* at least 16 bits. that is the whole promise */

/* the compiler will tell you what this target actually chose */
_Static_assert(sizeof(int) == 4, "this code assumed a 32-bit int");`},
q:{ask:"Your driver counts milliseconds in an int and rolls over after ~32 seconds on one target but not another. What happened?",
ans:"The first target has a 16-bit int. Once the signed counter exceeds 32767, the next increment is signed overflow and the C standard no longer defines the result. It may appear to wrap on a two's-complement target, but that is not a portable guarantee. Use uint32_t for a millisecond counter intended to wrap modulo 2^32."}},

{id:"binhex", code:"0.02", t:"Binary, hex and why firmware speaks hex",
kick:"Hex is not a different number system, it is a readable way of writing four bits at a time.",
tags:["foundation","numbers"],prereq:["bits"],
L:{
idea:"Base 2 is what the hardware stores. Base 16 is base 2 grouped in fours, so one hex digit is exactly one nibble and two hex digits are exactly one byte. Decimal has no clean relationship to bit positions, which is why no datasheet uses it for register values.",
compile:"0x2A, 052 and 42 produce identical machine code. The base is a notation for humans; the compiler converts all of them to the same bit pattern. Choosing hex in source is a way of telling the next reader that the bits matter more than the magnitude.",
hw:"Read a datasheet register table and the mapping is immediate: CR1 = 0x8420 is bits 15, 10 and 5 set. Trying to do that from 33824 is the reason people get register configuration wrong.",
trap:"A leading zero in C means octal. 010 is 8, not 10. It has been shipped in real timing tables more than once.",
mem:"Hex is especially useful for addresses, masks and dumps because each digit maps to four adjacent bits. A byte such as 0xA6 can be read as 1010 0110 without converting through decimal.",
run:"When debugging, compare values in hex when bit positions matter and decimal when magnitude matters. Switching notation should never change the underlying value.",
},
src:{cap:"Four ways to write the same byte, and the one that reads correctly at 2 a.m.",code:`#define LED_PIN   0x20      /* bit 5 set. obvious */
#define LED_PIN2  32        /* same value. not obvious */
#define LED_PIN3  (1u << 5) /* best: says which bit, not which number */

/* C23 standard syntax; many pre-C23 embedded compilers also accept it as an extension */
#define LED_PIN4  0b00100000`},
q:{ask:"Write 0xB7 in binary without converting to decimal first.",
ans:"B is 1011, 7 is 0111, so 1011 0111. Each hex digit maps straight to a nibble, which is the whole point of hex."}},

{id:"unsigned", code:"0.03", t:"Unsigned integers, range and modular wraparound",
kick:"Unsigned arithmetic is modulo 2^N. The bit pattern wraps at the type width, by definition.",
tags:["foundation","numbers"],prereq:["binhex"],
L:{
idea:"An N-bit unsigned value holds 0 to 2^N - 1. Arithmetic is defined modulo 2^N, so 255 + 1 on a uint8_t is 0, by specification and not by accident.",
compile:"Because wraparound is defined, the compiler must not assume an unsigned value keeps increasing. It cannot optimise away an overflow check the way it can for signed types. This makes unsigned the correct type for counters that are allowed to roll.",
run:"Timer rollover handling depends on this. If now and then are both uint32_t, the subtraction now - then is correct across a rollover without any special case, as long as the real elapsed time is under 2^32 ticks.",
hw:"Hardware counters are unsigned and free-running. A 32-bit microsecond timer wraps every 71 minutes and nothing marks the event, so software has to be written so that the wrap is a non-event.",
trap:"Comparing instead of subtracting. if (now > deadline) breaks at the wrap; if ((int32_t)(now - deadline) >= 0) does not."
},
src:{cap:"The rollover-safe timeout, which is the same three lines in every codebase worth reading.",code:`uint32_t start = hal_millis();

/* wrong: fails once every 49.7 days, and only in the field */
while (hal_millis() < start + 100u) { }

/* right: the subtraction wraps exactly as the counter does */
while ((uint32_t)(hal_millis() - start) < 100u) { }`},
q:{ask:"start = 0xFFFFFFF0, timeout is 100 ms. Show that the subtraction form still works after the counter wraps to 0x00000040.",
ans:"0x40 - 0xFFFFFFF0 = 0x50 = 80 in 32-bit modular arithmetic, which is less than 100, so it keeps waiting. The wrap cancels out."}},

{id:"twos", code:"0.04", t:"Two's complement",
kick:"The reason a CPU needs no subtract-specific hardware and no separate signed adder.",
tags:["foundation","numbers"],prereq:["unsigned"],
L:{
idea:"Negative x is represented as 2^N - x. Equivalently: invert every bit and add one. The top bit ends up acting as a sign indicator, but it is not a sign flag — it carries the weight -2^(N-1), which is what makes the arithmetic work out.",
hw:"This representation exists so that one adder circuit serves both signed and unsigned addition. The bit pattern 0xFF plus 0x01 gives 0x00 with a carry out, and that is simultaneously 255+1 wrapping and -1+1 being zero. The ALU does not know or care which interpretation you intended; only the flags it sets and the branches you use differ.",
mem:"There is one zero, not two, which is why the range is asymmetric: int8_t runs -128 to +127. The bit pattern 0x80 is -128 and has no positive counterpart.",
trap:"Negating INT_MIN is undefined behaviour, because +2147483648 is not representable. abs(INT_MIN) is a real CVE-grade bug, not a curiosity.",
compile:"The C implementation maps signed arithmetic onto the target's integer representation and instructions. Modern embedded targets overwhelmingly use two's complement, but portable C reasoning should still follow the language's signed-overflow rules rather than assuming wraparound.",
run:"Comparisons and arithmetic interpret the same bits according to the signed type. The CPU's add instruction can be reused because the representation makes the low N bits of signed addition line up with modular addition.",
},
src:{cap:"Deriving -5 in 8 bits by hand, the way you will do it while reading a hex dump.",code:`  5 = 0000 0101
~5 = 1111 1010     /* invert */
+1 = 1111 1011     /* = 0xFB = -5 */

/* check: -5 + 5 should be zero */
  0xFB + 0x05 = 0x100 -> truncated to 8 bits -> 0x00, carry out. correct.

/* the asymmetry */
int8_t lo = -128;   /* 0x80 */
int8_t bad = -lo;   /* undefined behaviour. not 128. */`},
q:{ask:"You see 0xFFFFFFFE in a register dump. Is it -2 or 4294967294?",
ans:"Both, and the bits cannot tell you. Only the type the program uses to read it decides the interpretation. This is why signedness is a decision you make in the header, not something you recover from memory."}},

{id:"signext", code:"0.05", t:"Sign extension and truncation",
kick:"What happens at the boundary when a narrow value meets a wide register.",
tags:["foundation","numbers"],prereq:["twos"],
L:{
idea:"Widening a signed value copies the sign bit into all the new high bits, so the value is preserved. Widening an unsigned value fills with zeros. Narrowing simply discards the high bits, which can change the value and, for signed types, the sign.",
compile:"The compiler inserts these conversions silently wherever types meet: assignments, function arguments, comparisons, array indices. Most are correct; the ones that are not produce no warning unless you ask for -Wconversion.",
hw:"On Cortex-M this is the difference between LDRB and LDRSB when loading a byte, and between UXTB and SXTB when narrowing. Sensor drivers that read a signed 12-bit ADC value out of a 16-bit register need an explicit sign extension because the hardware only knows the register is 16 bits wide.",
trap:"A signed 12-bit sensor reading placed in a uint16_t. Every negative temperature becomes a value above 4000 and your control loop learns that the engine bay is on fire.",
run:"A narrowing conversion is different: the destination width wins and high bits are discarded. If the resulting signed value is later widened, the new sign extension starts from the truncated result, not the original value.",
mem:"A peripheral register often packs a narrow signed field inside a wider word. Mask the field, shift it into place, then sign-extend from the field width; simply casting the whole register can preserve unrelated bits.",
},
src:{cap:"Extending a signed 12-bit field out of a 16-bit register, correctly.",code:`uint16_t raw = ADC->DR & 0x0FFFu;   /* 12 significant bits */

/* wrong: negative readings become large positives */
int16_t bad = (int16_t)raw;

/* right: move the sign bit to position 15, then arithmetic-shift back */
int16_t good = (int16_t)(raw << 4) >> 4;

/* clearer, and no implementation-defined shift of a signed value */
int16_t clear = (raw & 0x800u) ? (int16_t)(raw | 0xF000u) : (int16_t)raw;`},
q:{ask:"(uint8_t)(-1) is what, and why?",
ans:"255. The conversion is modular: -1 mod 256 = 255. The bits 0xFF are unchanged; only the interpretation changed."}},

{id:"bitops", code:"0.06", t:"Bitwise operators and the four register idioms",
kick:"Set, clear, toggle, test. Ninety percent of driver code is these four lines.",
tags:["foundation","bits"],prereq:["binhex"],
L:{
idea:"AND clears the bits that are zero in the mask and keeps the rest. OR sets the bits that are one in the mask. XOR flips them. NOT inverts everything. Combined with a shift to build the mask, this covers every single-bit and multi-bit field edit you will write.",
compile:"On a Cortex-M these compile to one or two instructions and no branch. On targets with bit-banding or bit-set registers the compiler or the header may turn them into a single store. Writing the idiom plainly gives the optimiser the best chance to pick that instruction.",
hw:"Read-modify-write is three bus transactions, not one: load the register, alter the bits, store it back. If an interrupt edits the same register between the load and the store, its change is overwritten. This is the single most common concurrency bug in bare-metal code.",
trap:"Using the wrong width mask. 1 << 31 is undefined for a signed int because the result does not fit; 1u << 31 is fine. Always write 1u, or better, UINT32_C(1).",
run:"For a normal read-write register, set/clear/toggle/test are read-modify-write or read-only operations with explicit masks. For special registers such as write-1-to-clear or write-only registers, the access pattern comes from the register contract instead.",
mem:"Bit masks are a compact representation of a register field. Keep masks and shifts tied to the documented bit positions rather than to C bitfield layout, which is implementation-defined and can hide read-modify-write behaviour.",
},
src:{cap:"The four idioms, and the multi-bit field edit that people get wrong.",code:`REG |=  (1u << 3);            /* set bit 3   */
REG &= ~(1u << 3);            /* clear bit 3 */
REG ^=  (1u << 3);            /* toggle      */
if (REG & (1u << 3)) { }      /* test        */

/* a 3-bit field at offset 4 set to 5: clear the field first, always */
REG = (REG & ~(0x7u << 4)) | (0x5u << 4);

/* forgetting the clear ORs the new value into the old one */`},
q:{ask:"Why is REG |= (5u << 4) not enough to write 5 into a 3-bit field?",
ans:"OR can only set bits. If the field already held 3 (011), ORing 5 (101) gives 7 (111). You must clear the field with AND-NOT first."}},

{id:"shifts", code:"0.07", t:"Shifts, and the three ways they are undefined",
kick:"A shift looks like the simplest operator in C and has the most edge cases.",
tags:["foundation","bits"],prereq:["bitops","twos"],
L:{
idea:"Left shift moves bits toward the sign bit, filling with zeros, and is multiplication by a power of two when nothing overflows. Right shift on an unsigned value fills with zeros. Right shift on a signed negative value fills with the sign bit on every compiler you will meet, but the standard only says implementation-defined.",
compile:"A constant shift is often folded into an instruction or addressing mode; whether it costs an extra instruction is target- and context-dependent. A variable shift may need a dedicated shift instruction or a sequence on smaller cores. Unsigned division by a power of two can often become a shift; signed division needs care because C division rounds toward zero.",
hw:"Many Cortex-M instructions can combine a shift with another operation, so an address such as base + index * 4 can often be formed without a separate shift instruction. The exact instruction and cost depend on the Cortex-M profile and addressing mode.",
trap:"Shifting by more than the width, or by a negative amount, is undefined. So is shifting a 1 into or past the sign bit of a signed type. And x >> 1 is not x / 2 for negative x in the way you expect: -3 >> 1 is -2, while -3 / 2 is -1.",
run:"A shift is a value transformation, not a general multiplication/division primitive. Unsigned left shifts are useful for masks and packing; right-shift behaviour differs for signed operands, so make the intended signedness explicit.",
},
src:{cap:"Three undefined shifts, all of which compile without a warning by default.",code:`uint32_t v = 1u << 32;      /* UB: shift count == width */
int32_t  s = 1  << 31;      /* UB: overflows the signed range */
int      n = -1;
uint32_t w = 1u << n;       /* UB: negative shift count */

/* safe multi-word shift: mask the count yourself */
uint32_t sh(uint32_t x, unsigned k) { return k >= 32u ? 0u : (x >> k); }`},
q:{ask:"Why does the compiler turn u / 8 into a shift but not i / 8 for a signed int?",
ans:"Signed division rounds toward zero, but an arithmetic right shift rounds toward negative infinity. -1 / 8 is 0 but -1 >> 3 is -1, so the compiler must add a correction before shifting."}},

{id:"fixedpt", code:"0.08", t:"Fixed-point arithmetic",
kick:"How you do fractional maths on a part with no FPU and a hard deadline.",
tags:["foundation","numbers"],prereq:["shifts"],
L:{
idea:"Store a scaled integer and remember the scale. Q15 means the value is the integer divided by 32768, so 0.5 is 16384. Addition and subtraction work unchanged. Multiplication doubles the scale, so it needs a shift back; division needs a shift up first.",
compile:"Everything stays integer, so it compiles to the same one-cycle instructions as any other arithmetic. There is no library call, no lazy rounding mode, no denormal path.",
run:"Timing is deterministic, which is why control loops in motor and brake software are still written this way. The cost is that you carry the scale in your head and in the naming, because the type system will not carry it for you.",
hw:"Cortex-M4 DSP instructions can make fixed-point multiply and multiply-accumulate operations very efficient. Some Q15 kernels map to specialized instructions, but the exact sequence depends on operands, saturation requirements, and compiler options.",
trap:"Intermediate overflow. Multiplying two Q15 int16_t values needs a 32-bit intermediate; doing it in int16_t throws away everything above the fifteenth bit before you shift."
},
src:{cap:"Q15 multiply, with the intermediate width that keeps it correct.",code:`typedef int16_t q15_t;       /* value = raw / 32768 */

static inline q15_t q15_mul(q15_t a, q15_t b)
{
    int32_t p = (int32_t)a * (int32_t)b;   /* Q30 in 32 bits */
    return (q15_t)(p >> 15);               /* back to Q15 */
}

/* 0.5 * 0.5 = 0.25  ->  16384 * 16384 >> 15 = 8192 */`},
q:{ask:"You multiply two Q8 values and get a result that is 256 times too big. Why?",
ans:"Q8 times Q8 is Q16. You must shift right by 8 to return to Q8. The scale adds on multiplication."}},

{id:"float", code:"0.09", t:"Floating point and IEEE-754",
kick:"Why 0.1 + 0.2 is not 0.3, and why a float in an ISR can cost you a deadline.",
tags:["foundation","numbers"],prereq:["bits"],
L:{
idea:"A float is a sign bit, an 8-bit biased exponent and a 23-bit fraction, giving about seven decimal digits of precision anywhere in a huge range. The spacing between representable values grows with magnitude, so precision is relative, not absolute.",
compile:"Without a hardware FPU, floating-point operations may be lowered to software helper routines, adding code size and latency. With an FPU, suitable operations can use hardware instructions, provided the compiler target options, ABI, and startup configuration match the actual core.",
run:"In an ISR on a Cortex-M4F, touching a float causes the FPU registers to be stacked too, which lengthens interrupt entry. Many automotive projects forbid floating point in interrupt context for exactly this reason.",
hw:"On Cortex-M4F-class parts, FPU access can be disabled until startup enables the relevant coprocessor access in CPACR. If software executes an FPU instruction without the required access, the core can fault. This is target-specific; not every Cortex-M has an FPU.",
trap:"Comparing floats with ==. And accumulating a float in a loop: adding 0.01 ten thousand times does not give 100.0. Use integers or fixed point for anything that must be exact, including money and tick counts."
},
src:{cap:"Enabling the FPU, and the comparison that never works.",code:`/* startup, before main: full access to CP10 and CP11 */
SCB->CPACR |= (0xFu << 20);
__DSB(); __ISB();

if (x == 0.1f)            { }   /* almost never true */
if (fabsf(x - 0.1f) < 1e-6f) { }  /* what you meant */`},
q:{ask:"Why does a float variable declared in an ISR sometimes change interrupt latency measurably?",
ans:"Lazy FPU stacking. The core reserves space for the FPU registers on exception entry and pushes them on first FPU use, adding cycles inside the handler."}},

{id:"endian", code:"0.10", t:"Endianness",
kick:"The byte order argument that only matters when bytes leave the chip.",
tags:["foundation","memory"],prereq:["bits"],
L:{
idea:"Little-endian stores the least significant byte at the lowest address; big-endian stores the most significant byte first. Within the chip it makes no difference. It matters the moment bytes are written to a bus, a file or a flash page and read by something else.",
mem:"The 32-bit value 0x12345678 at address 0x20000000 appears in a memory dump as 78 56 34 12 on Cortex-M, and 12 34 56 78 on a big-endian PowerPC. Reading a dump without knowing the endianness of the target is guessing.",
hw:"Do not reduce protocol byte order to a single 'CAN is big-endian' rule. CAN frames are byte-oriented, while individual signals in a DBC can use different bit numbering/byte-order conventions. Treat the protocol specification or generated packing rules as authoritative.",
trap:"Casting a byte buffer to a struct pointer to parse a protocol frame. It appears to work on the development board and breaks on the first peer with a different byte order, a different alignment rule or different padding.",
compile:"The compiler knows the target's byte order when it emits multi-byte loads/stores, but C expressions do not contain a portable 'wire endian' property. Serialization code must choose the external byte order explicitly.",
run:"When a 32-bit value is stored, little-endian places the least-significant byte at the lowest address; big-endian places the most-significant byte there. The CPU may read either order correctly because the load/store unit follows the architecture's convention.",
},
src:{cap:"Serialise explicitly. It costs nothing and it is portable.",code:`/* fragile: endianness, alignment and padding all silently assumed */
uint32_t id = *(uint32_t *)&buf[0];

/* portable: says exactly which byte is which */
uint32_t id = ((uint32_t)buf[0] << 24) | ((uint32_t)buf[1] << 16)
            | ((uint32_t)buf[2] <<  8) | ((uint32_t)buf[3]);

/* detect at run time if you ever need to */
const uint16_t probe = 0x0001u;
bool little = *(const uint8_t *)&probe == 1u;`},
q:{ask:"A CAN frame carries a 16-bit speed value. Your dashboard reads 0x3412 where the sender wrote 0x1234. What is the fix?",
ans:"Byte-swap on one side, and put the swap in the serialisation layer rather than in the application. Never assume both ends share the CPU's native order."}},

{id:"memarray", code:"0.11", t:"Memory as one flat addressed array",
kick:"The mental model that makes pointers obvious later.",
tags:["foundation","memory"],prereq:["bits"],
L:{
idea:"The address space is a single array of bytes indexed from 0 to 2^32-1. Not all indices are backed by anything: some hit flash, some hit RAM, some hit peripheral registers, and most hit nothing at all. An address is just an index into this array.",
mem:"Variables, code, the stack and hardware registers all live in the same index space. There is no separate namespace for code and data on a von Neumann core. This is why a wild pointer can overwrite your own instructions or a peripheral configuration.",
run:"Accessing an index with nothing behind it raises a BusFault on Cortex-M. That is a feature: the alternative is a silent read of floating bus lines.",
hw:"The bus matrix decodes the top address bits to decide which slave answers. Flash, SRAM, AHB peripherals and the core private region are distinguished by address alone, which is what memory-mapped I/O means.",
trap:"Thinking a pointer is bounded by the object it came from. Nothing in the hardware enforces this. Only an MPU does, and only if it is configured."
},
q:{ask:"If everything is in one address space, what stops a bug in the logging module from corrupting the brake control state?",
ans:"Nothing in C. Only an MPU region configuration, or careful design plus review plus static analysis. This is exactly why safety standards demand memory partitioning."}},

{id:"cpu", code:"0.12", t:"What the CPU actually does: fetch, decode, execute",
kick:"Registers, the program counter, flags, and why a pipeline changes your timing.",
tags:["foundation","hardware"],prereq:["memarray"],
L:{
idea:"The CPU repeats one loop: read the instruction at the program counter, work out what it means, do it, advance the PC. Everything a program does is that loop over a few billion iterations.",
hw:"Registers are the only storage the ALU operates on directly. A Cortex-M has r0-r12 plus SP, LR and PC. Data has to be loaded from memory into a register, operated on, and stored back, which is why a load-store architecture makes memory traffic so visible in the disassembly.",
run:"Flags (N, Z, C, V) are set as a side effect of arithmetic, and branches read them. A C if statement becomes a compare that sets flags followed by a conditional branch.",
mem:"The PC holds an address in flash, the SP holds an address in RAM, and LR holds the return address. Corrupting the stack corrupts LR on the way out of a function, which is why a stack overflow so often shows up as a jump to a nonsense address.",
trap:"Assuming instruction count equals time. Pipelines, flash wait states, branch prediction and bus contention all mean the cycle count of a loop is a measurement, not a calculation."
},
q:{ask:"Your fault handler reports a PC of 0x00000000. What class of bug is that?",
ans:"A call through a null or uninitialised function pointer, or a corrupted return address from stack damage. Both jump to an address that holds no valid code."}},

{id:"mmio", code:"0.13", t:"Memory-mapped I/O: registers that are not memory",
kick:"The address looks like a variable and behaves nothing like one.",
tags:["foundation","hardware"],prereq:["memarray","cpu"],
L:{
idea:"Peripherals expose control and status registers at fixed addresses. A normal load or store instruction talks to them, so no special instruction is needed. But those addresses have side effects: reading can clear a flag, writing can start a conversion or transmit a byte.",
compile:"This is precisely why volatile exists. Without it the compiler is entitled to skip a second read of the same address, cache the value in a register, or reorder two writes. All three are fatal against hardware.",
mem:"Peripheral regions typically live above 0x40000000 and are marked as Device or Strongly-Ordered memory by the MPU or the default memory map, which means the core will not reorder or merge accesses to them.",
hw:"A write to a peripheral register may complete on the bus long after the instruction retires. This write buffering is why a disable-peripheral-then-sleep sequence needs a barrier or a dummy read-back.",
trap:"Writing to a peripheral before its clock is enabled. The write goes nowhere, or the bus hangs, depending on the part. Clock gating is off by default on almost every modern MCU."
},
src:{cap:"The minimum correct spelling of a hardware register in C.",code:`#define GPIOA_BASE   0x48000000u
#define GPIOA_ODR    (*(volatile uint32_t *)(GPIOA_BASE + 0x14u))

GPIOA_ODR |= (1u << 5);     /* read-modify-write on the real register */

/* read-back forces the write to reach the peripheral before we continue */
(void)GPIOA_ODR;`},
q:{ask:"You clear an interrupt flag at the end of an ISR and the same interrupt fires again immediately. Why?",
ans:"The write was still in the write buffer when the handler returned, so the peripheral had not yet deasserted the request. A read-back or a DSB before returning fixes it."}},

{id:"gpiohw", code:"0.15", t:"Digital signals, GPIO and electrical reality",
kick:"A GPIO pin is an electrical node with configuration, not just a boolean variable.",
tags:["foundation","hardware"],prereq:["mmio","bits"],
L:{
idea:"A GPIO pin has an electrical mode, direction, logic level and often a pull-up, pull-down, alternate-function or drive-strength configuration. The C variable you write is only the software view of that hardware state.",
compile:"GPIO access becomes reads and writes to memory-mapped registers. The compiler can preserve the required volatile access, but it cannot decide whether the pin is electrically safe or whether two peripherals are fighting for the same pin.",
link:"The address of the GPIO register block comes from the device memory map and headers or CMSIS definitions. The linker does not make a pin an output; it only places the code and data that configure it.",
mem:"GPIO registers occupy an address range in the peripheral region, not ordinary RAM. A read may return the input state while an output data register may represent the value being driven.",
run:"Firmware normally enables the peripheral clock, selects the pin mode and alternate function, configures pulls and drive characteristics, then changes the output or samples the input. Glitch-free sequencing matters during bring-up.",
hw:"Push-pull outputs actively drive both logic levels. Open-drain/open-collector outputs actively pull low and rely on an external or internal pull-up for high. Voltage domains, input thresholds, maximum current and pin multiplexing are electrical constraints, not C rules.",
design:"Treat the pin as a resource with an owner and an electrical contract. Document active-high/active-low meaning, reset state, pull configuration, alternate-function ownership and whether the external circuit can drive the line.",
trap:"Assuming a high-level GPIO write always means a high voltage at the pin. A disabled clock, wrong alternate function, open-drain configuration, missing pull-up, contention or incompatible voltage domain can make the physical result different."
},
src:{cap:"Software view and electrical view are different layers.",code:`/* software */
GPIOA->MODER = ...;          /* choose input/output/alternate */
GPIOA->PUPDR = ...;          /* choose pull-up/pull-down */
GPIOA->BSRR  = (1u << 5);    /* request pin 5 high */

/* hardware questions still matter:
 * Is the pin push-pull or open-drain?
 * What voltage domain and load are attached?
 * Who else can drive the net? */`},
q:{ask:"A GPIO output is configured correctly in C, but the measured pin never reaches a valid HIGH level. What layers do you inspect before changing the code?",ans:"Check the clock and pin mux, output mode, pull/drive configuration, voltage domain and external loading or contention. The C write can be correct while the electrical configuration is not."}},

{id:"clockreset", code:"0.16", t:"Clocks, reset and why peripherals can be asleep",
kick:"Before a peripheral can do useful work, its clock and reset state have to make sense.",
tags:["foundation","hardware"],prereq:["cpu","mmio"],
L:{
idea:"A clock is the timing reference that lets digital state change. Reset establishes a known starting state. Modern MCUs gate clocks and sometimes power domains to save energy, so a peripheral may exist at a documented address while its logic is intentionally inactive.",
compile:"Clock configuration is represented by register accesses and constants; the compiler cannot know whether a chosen divider produces the timing your peripheral requires. Timing assumptions belong in the design and datasheet calculations.",
link:"Clock and reset registers are peripheral addresses like any other MMIO block. The linker only places the instructions that configure them; it does not reserve a frequency or guarantee that a peripheral clock is enabled before use.",
mem:"Clock, reset and power-control registers occupy peripheral address space. Their reset values define the initial hardware state, which is why startup code often configures clocks before higher-level drivers touch peripherals.",
run:"A typical bring-up sequence is reset release → clock source selection → divider/PLL configuration → flash wait-state configuration → peripheral clock enable → peripheral reset release → peripheral configuration. Exact order is device-specific.",
hw:"The CPU clock, bus clocks and peripheral clocks can be different. A timer running from a peripheral clock may therefore tick at a different rate from the core. Changing the system clock can also change UART baud, timer periods and watchdog timing.",
design:"Make clock ownership explicit and calculate derived frequencies instead of scattering magic divisors through drivers. Treat reset and clock sequencing as part of hardware initialization, not incidental register writes.",
trap:"Copying a peripheral initialization sequence without checking its clock source, bus divider or reset state. The register values can look correct while the peripheral runs at the wrong rate or not at all."
},
src:{cap:"A clock tree is a dependency graph, not one magic CPU frequency.",code:`SYSCLK -> AHB divider -> APB clock -> TIMER clock
        \-> peripheral clock gates

/* Changing SYSCLK can change every derived timing value. */`},
q:{ask:"You change SYSCLK and a UART starts transmitting at the wrong baud rate even though its UART registers were not changed. Why?",ans:"The UART baud generator normally derives its timing from a peripheral clock. Changing the clock tree changed the input frequency, so the old divisor no longer produces the intended baud rate."}},

{id:"busmasters", code:"0.17", t:"CPU, DMA and peripherals: memory has multiple masters",
kick:"The CPU is not always the only agent reading or writing RAM.",
tags:["foundation","hardware"],prereq:["memarray","mmio"],
L:{
idea:"A microcontroller can have several bus masters: the CPU, DMA engines, display or crypto engines, and other hardware blocks. They can access shared memory without executing C instructions, which changes how ownership and ordering must be reasoned about.",
compile:"The compiler generates CPU instructions; it does not generate the hardware transfer performed by a DMA engine. A pointer passed to DMA becomes a hardware address/descriptor, so the lifetime and placement of that buffer must be valid for the transfer.",
link:"The linker determines where DMA buffers and descriptors live. Some devices cannot DMA to every memory region, and some systems require special linker sections for non-cacheable or tightly coupled memory.",
mem:"RAM can be shared between CPU and hardware. On cached cores, the CPU may see a cache line while DMA sees RAM, creating coherency problems. Alignment, addressability and buffer lifetime are part of the memory contract.",
run:"Software typically configures the hardware, publishes a buffer, lets the peripheral or DMA own it, then handles completion and returns ownership to the CPU. A buffer must not be reused while hardware still owns it.",
hw:"Bus arbitration determines which master gets access when several request the fabric. Transfer width, burst behaviour, wait states and memory type affect throughput and latency. The exact interconnect is MCU-specific.",
design:"Document ownership transitions explicitly: CPU-owned → DMA-owned → completion → CPU-owned. Use descriptors, indices or flags that make the handoff unambiguous.",
trap:"Changing or freeing a buffer immediately after starting DMA. The CPU may believe the operation is finished because the instruction returned, while the hardware is still reading or writing the same memory."
},
src:{cap:"The hardware transfer continues after the CPU instruction returns.",code:`start_dma(rx_buf, 128);

/* NOT safe: */
reuse(rx_buf);

/* Safe design: wait for completion, then reclaim ownership. */`},
q:{ask:"Why can a DMA bug corrupt a buffer even though no C instruction writes that buffer at the time of the corruption?",ans:"DMA is another bus master. It can write RAM independently of CPU instructions, so the buffer can change while the CPU is executing elsewhere."}},

{id:"harvard", code:"0.14", t:"Flash, RAM, and where a program actually lives",
kick:"Two memories with different speeds, different sizes and different rules.",
tags:["foundation","memory"],prereq:["memarray"],
L:{
idea:"Flash is large, non-volatile, slow to write and effectively read-only at run time. RAM is small, volatile, and fast. Code and constants live in flash; anything that changes lives in RAM. Almost every firmware memory decision follows from that asymmetry.",
mem:"On a Cortex-M the core executes directly out of flash — execute in place — so there is no load step and no copy of .text into RAM. Only initialised writable data is copied at boot, which is topic 1.09.",
hw:"Flash is slower than the core above a certain clock, so wait states and a prefetch buffer or cache sit in between. Setting the wrong wait states for your clock is a classic bring-up failure: the chip runs at low clock and hard-faults when you raise it.",
run:"A branch that misses the prefetch buffer costs extra cycles, which is why tight loops sometimes get copied into RAM for deterministic timing, and why some safety code is placed in RAM explicitly through the linker script.",
trap:"Writing through a pointer to a string literal. The literal is in .rodata in flash, the write silently does nothing or faults, and the symptom appears far from the cause."
},
q:{ask:"Your part has 512 KB flash and 96 KB RAM. A colleague adds a 40000-element uint16_t lookup table as a const array and the build still fits. Where did it go?",
ans:"Into .rodata in flash, because it is const. Drop the const and the same table lands in .data, needs 80 KB of RAM plus 80 KB of flash for the initialisers, and the link fails."}}

]});
</script>
