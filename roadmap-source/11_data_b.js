<script>
STAGES.push({
id:"s1", n:"1", title:"From source to silicon",
blurb:"Follow one program through preprocessing, compilation, assembly, linking and startup. At every boundary, ask three things: what representation exists now, what decision was made here, and what remains unresolved for the next stage.",
meta:"13 topics · needs stage 0 · read your own map file while you go through this",
topics:[

{id:"whatlang", code:"1.01", t:"What a programming language is, and what C is for",
kick:"C is a portable notation for the operations a machine can actually perform.",
tags:["toolchain"],
L:{
idea:"A language is a notation plus a set of rules for translating it. Assembly is a one-to-one notation for one instruction set. C is one level up: it hides the register allocator and the instruction encoding, and hides almost nothing else. There is no garbage collector, no run-time type information, no hidden allocation, no bounds checking.",
compile:"The C standard defines an abstract machine, and a compiler must produce a program that behaves as if the abstract machine ran your code. It is free to do anything else, which is where optimisation, and undefined behaviour, both come from.",
hw:"C maps closely to load-store hardware because it was designed alongside it. This is why it remains the default for firmware: the cost of each line is predictable from reading it, which is not true of C++ templates, Rust traits or anything with a run-time.",
trap:"Treating C as portable assembly. It is portable, and it is close to assembly, but it is not a direct transcription: the compiler is allowed to reorder, delete and merge your code as long as the observable behaviour matches."
},
q:{ask:"Name one thing C gives you that assembly does not, and one thing it takes away.",
ans:"Gives: portable expression of control flow and data layout, plus an optimiser. Takes away: exact control of instruction selection and ordering, which is why hardware access needs volatile and barriers."}},

{id:"pipeline", code:"1.02", t:"The translation pipeline end to end",
kick:"Several distinct tools transform your .c file into something the target can execute. Know what each boundary produces.",
tags:["toolchain"],prereq:["whatlang"],
L:{
idea:"The preprocessor produces the token stream the compiler sees. The compiler turns a translation unit into target code, the assembler packages assembly into relocatable objects, and the linker combines objects and libraries into a final image with resolved addresses. Conversion/programming tools then create and place a device image, while the debugger uses the ELF and its debug information to relate addresses back to source.",
compile:"Each stage can be stopped and inspected, which is the single most useful debugging habit in firmware: -E for preprocessed source, -S for assembly, -c for the object file, then objdump and nm on the result.",
link:"The compiler never sees more than one translation unit at a time unless link-time optimisation is on. Everything cross-file — duplicate symbols, missing definitions, section placement — is the linker's problem and shows up only at link time.",
trap:"Debugging a macro bug in the .c file. Run -E and read what the compiler actually received; the macro expansion is usually not what you pictured.",
run:"At run time there is no C language left: there are instructions, memory accesses and hardware events. The useful engineering question is how a language rule constrained what the generated program is allowed to do.",
design:"C is valuable in firmware because it exposes storage, representation and control flow while remaining portable across targets. That power also means the programmer must understand lifetime, aliasing, integer conversions and hardware contracts.",
mem:"Each boundary changes what can be inspected. The preprocessed file exposes macro expansion, assembly exposes instruction selection, object files expose sections/symbols/relocations, and the final ELF exposes placement.",
},
src:{cap:"Stopping the pipeline at each stage. Worth doing once on your own project.",code:`arm-none-eabi-gcc -E  main.c -o main.i   # after preprocessing
arm-none-eabi-gcc -S  main.c -o main.s   # generated assembly
arm-none-eabi-gcc -c  main.c -o main.o   # relocatable object
arm-none-eabi-gcc      *.o -T link.ld -Wl,-Map=out.map -o out.elf
arm-none-eabi-objcopy -O binary out.elf out.bin

arm-none-eabi-nm      -S --size-sort out.elf   # what is big
arm-none-eabi-objdump -d out.elf               # disassembly`},
q:{ask:"You get undefined reference to foo. Which stage failed, and which stage was perfectly happy?",
ans:"The linker failed. The compiler was happy because it only needed a declaration to generate a call to a symbol it assumed someone else defines."}},

{id:"preproc", code:"1.03", t:"The preprocessor",
kick:"A text substitution pass that knows nothing about C types or scope.",
tags:["toolchain","c-core"],prereq:["pipeline"],
L:{
idea:"Before compilation, #include pastes files in, #define substitutes text, and #if removes text. The result is one long stream of tokens called a translation unit. The preprocessor has no concept of a variable, a type or a block.",
compile:"Because it is textual, macro arguments are re-evaluated every time they appear in the body, and precedence works on the pasted tokens rather than on the argument's value. Both are the source of the classic macro bugs.",
link:"Conditional compilation decides what even reaches the linker, which is how one codebase builds for four variants. It is also how a feature flag mismatch between a header and a .c file produces a struct that is a different size in two translation units, which is a link-time success and a run-time disaster.",
trap:"Different -D flags applied to different files, with a struct whose layout depends on an #ifdef. The build succeeds, and one module writes past the end of an object the other module allocated.",
mem:"Preprocessing can duplicate declarations, expand macros into large expressions, and include headers repeatedly if guards are missing. The resulting translation unit is what the compiler reasons about, so inspect it when macro behaviour is surprising.",
run:"The preprocessor has no runtime behaviour. It changes the source text before compilation; it does not create a function call or perform type checking by itself.",
},
src:{cap:"Three macro hazards and the guards against them.",code:`#define SQ(x)     x * x           /* SQ(1+2) -> 1 + 2*1 + 2 = 5 */
#define SQ2(x)   ((x) * (x))       /* SQ2(1+2) -> 9. still double-evaluates */
#define MAX(a,b) ((a) > (b) ? (a) : (b))
MAX(i++, j)                        /* i incremented twice */

/* multi-statement macro that survives an if without braces */
#define SET_AND_LOG(r, v) do { (r) = (v); log_reg(#r, (v)); } while (0)`},
q:{ask:"Why does every multi-statement macro end in while (0) with no semicolon?",
ans:"So the macro is one statement and the call site can end with a semicolon, keeping if (c) SET_AND_LOG(x,1); else ... valid."}},

{id:"compiler", code:"1.04", t:"Inside the compiler: front end, middle, back end",
kick:"Where your code stops being text and starts being a graph the optimiser rewrites.",
tags:["toolchain"],prereq:["pipeline"],
L:{
idea:"The front end parses and type-checks, producing an intermediate representation. The middle end optimises that IR without knowing the target. The back end selects instructions, allocates registers and emits assembly for one specific CPU.",
compile:"Optimisation happens on the IR, where your variable names are gone and only data flow remains. This is why the optimiser can delete a variable entirely, keep another one alive only in a register, or compute a loop's result at compile time — it is transforming a graph, not editing your text.",
run:"At -O0 nearly every C variable has a stack slot and is reloaded from memory constantly, which is why -O0 code is slow but single-steps predictably. At -O2 variables live in registers and lines execute out of order, which is why the debugger says optimised out.",
hw:"Register allocation is a back-end decision driven by the target's ABI. On Cortex-M, r0-r3 carry arguments and r4-r11 must be preserved by the callee, so a function using many locals emits push and pop of exactly those registers.",
trap:"Debugging a timing bug at -O0 and shipping at -O2. They are different programs. Reproduce at the shipping optimisation level, even if it means adding a variable marked volatile to keep it observable."
},
q:{ask:"You add a printf and the bug disappears. What are two mechanisms that could explain it?",
ans:"The call can change optimization and register allocation because observable I/O and an external call constrain what the compiler may assume. It also changes timing, which can hide a race or alter interrupt scheduling. A debug print changing the symptom is evidence to investigate, not a fix."}},

{id:"objfile", code:"1.05", t:"Assembler, object files and ELF",
kick:"An object file is sections plus symbols plus a list of holes to be filled in later.",
tags:["toolchain","linker"],prereq:["compiler"],
L:{
idea:"The assembler produces a relocatable object: machine code grouped into named sections, a symbol table listing what this file defines and what it needs, and relocation entries marking every place an address must be patched once the address is known.",
link:"Addresses inside an object file are placeholders. A call to a function in another file is emitted as a branch to zero plus a relocation saying patch this with the address of foo. The linker fills them in.",
mem:"Sections are the unit of placement. The compiler decides which section each object goes into — code to .text, const data to .rodata, initialised globals to .data, zero-initialised to .bss — and the linker decides where each section lands.",
trap:"Assuming a symbol that appears in nm is in the final image. The linker discards unreferenced sections when built with -ffunction-sections -fdata-sections -Wl,--gc-sections, which is how you cut flash usage without deleting code.",
compile:"An object file records the compiler/assembler's chosen sections, symbols and relocation sites. It is deliberately incomplete because external addresses are not known until linking.",
run:"An object file is not a complete firmware image. A call to another translation unit can still contain a relocation, and section addresses can still move when the linker combines all inputs.",
},
src:{cap:"Reading an object file, which is faster than reading the source when you are chasing size.",code:`arm-none-eabi-nm -S --size-sort driver.o      # symbols and their sizes
arm-none-eabi-objdump -h driver.o            # section headers and sizes
arm-none-eabi-objdump -r driver.o            # relocations still unresolved
arm-none-eabi-readelf -s driver.o            # full symbol table

# T = defined in text, B = in bss, U = undefined, needed from elsewhere`},
q:{ask:"nm shows U hal_delay in your object. Is that an error?",
ans:"No. It means this file uses hal_delay and expects another object or library to define it. It only becomes an error if nothing does, at link time."}},

{id:"linker", code:"1.06", t:"The linker: symbol resolution and relocation",
kick:"One pass that turns a pile of objects into one image with real addresses.",
tags:["toolchain","linker"],prereq:["objfile"],
L:{
idea:"The linker combines input sections into output sections according to its rules and script, resolves symbol references against available definitions, and applies relocations so references point at their final locations. It also performs garbage collection, archive extraction, and other policy-dependent work when enabled.",
link:"Library search order matters because archives are scanned once, left to right, and only members that resolve a currently-undefined symbol are pulled in. This is why moving -lm before your objects breaks the link and moving it after fixes it.",
mem:"Merging is by section name, so all .text sections from all files end up contiguous in the output .text. Custom section names are how you force one function into RAM or one table into a fixed flash page.",
trap:"Two definitions of the same global, one in a header without extern. With older linkers this produced a silent merge into one object (common symbols); with -fno-common, now the default, it is a duplicate symbol error, which is the better outcome.",
compile:"The compiler can prove types and generate relocatable references, but it cannot know the final address of every symbol in a multi-file firmware image. The linker is where those separate compilation units become one address space.",
run:"After linking, a function call and data reference have final addresses or architecture-specific relocation results. Startup and the application can then use the linker-defined symbols as concrete addresses and ranges.",
},
src:{cap:"Placing one function in RAM for deterministic timing.",code:`/* in C */
__attribute__((section(".ramfunc"), noinline))
void critical_loop(void) { /* ... */ }

/* in the linker script: text in flash, but this section copied to RAM */
.ramfunc : {
    . = ALIGN(4);
    *(.ramfunc)
    . = ALIGN(4);
} > RAM AT> FLASH`},
q:{ask:"Why does -lm placed before your .o files fail to resolve sqrt?",
ans:"When the linker scanned libm nothing was undefined yet, so it took nothing from it. Your objects, scanned afterwards, then need sqrt and there is no second pass."}},

{id:"ldscript", code:"1.07", t:"The linker script and memory regions",
kick:"The one file that says where everything in your firmware physically goes.",
tags:["toolchain","linker"],prereq:["linker"],
L:{
idea:"A linker script declares the memory regions of the device — their origin, length and permissions — and then maps output sections into those regions. It also defines symbols such as the start and end of .data and .bss, which the startup code reads.",
link:"The symbols the script defines are addresses, not values. That is why startup code writes extern uint32_t _sbss; and then takes &_sbss. Reading the variable itself reads whatever bytes happen to be at that address.",
mem:"AT> is the mechanism behind load address versus run address: > RAM says run here, AT> FLASH says store the initial bytes there. Every initialised global depends on this pair.",
trap:"Region overflow errors that name a region, not a file. Read the map file to find what grew. Nine times out of ten it is a printf pulled in by one debug line, dragging several kilobytes of formatting code.",
run:"A linker script is a placement policy, not executable startup code. It creates regions, orders output sections and can define symbols that startup later consumes.",
hw:"The MEMORY block must describe the actual target memory map. A wrong origin or length can produce an image that links cleanly but cannot execute correctly on the physical MCU.",
},
src:{cap:"A minimal but complete Cortex-M script skeleton.",code:`MEMORY {
  FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 512K
  RAM  (rwx) : ORIGIN = 0x20000000, LENGTH = 96K
}

SECTIONS {
  .isr_vector : { KEEP(*(.isr_vector)) } > FLASH
  .text   : { *(.text*) *(.rodata*) } > FLASH
  _sidata = LOADADDR(.data);
  .data   : { _sdata = .; *(.data*) _edata = .; } > RAM AT> FLASH
  .bss    : { _sbss  = .; *(.bss*) *(COMMON) _ebss = .; } > RAM
  _estack = ORIGIN(RAM) + LENGTH(RAM);
}`},
q:{ask:"Why is KEEP() needed on the vector table?",
ans:"Nothing in C references it, so --gc-sections would discard it as dead. KEEP marks it as a root. Delete it and the chip boots to a table of zeros."}},

{id:"sections", code:"1.08", t:"The sections: .text, .rodata, .data, .bss",
kick:"Where every variable you declare ends up, decided entirely by how you declared it.",
tags:["toolchain","memory"],prereq:["ldscript"],
L:{
idea:"Four buckets. .text is code. .rodata is read-only data: const objects and string literals. .data is writable data with a non-zero initial value. .bss is writable data that starts at zero, and it costs no flash because zeros do not need storing.",
compile:"The compiler emits objects into input sections based on the source, storage duration, initialization, qualifiers, compiler options, and section-placement conventions. The linker script then decides how those input sections become final output sections and where they live.",
mem:"At runtime, .data consumes RAM, while its non-zero initial values normally require a corresponding load image in Flash. .bss consumes RAM but normally has no Flash payload. A 4 KB zero-initialized static buffer can therefore consume 4 KB of RAM without consuming 4 KB of image space for initialization bytes.",
link:"The map file prints the size of each and it is the first thing to read when a build stops fitting. Region overflow in RAM is almost always .bss growth from a buffer someone enlarged.",
trap:"Writing = {0} on a large array to be explicit. That is fine and stays in .bss. But = {1} or any non-zero element pushes the whole array into .data and costs you the flash."
},
src:{cap:"Six declarations, six different costs.",code:`const char  msg[] = "brake fault";  /* .rodata: flash only        */
char        buf[512];                /* .bss:    512 B RAM         */
char        tag[4] = "abc";          /* .data:   4 B RAM + 4 B flash */
static int  counter;                 /* .bss:    zeroed at startup */
int         table[256] = {0};        /* .bss:    still zeros       */
int         table2[256] = {1};       /* .data:   1 KB RAM + 1 KB flash */`},
q:{ask:"You need a 2 KB const lookup table on a part with 8 KB RAM. Does it fit?",
ans:"Yes, because const puts it in .rodata in flash and it is never copied to RAM. Remove the const and you spend 2 KB of the 8 KB immediately."}},

{id:"lmavma", code:"1.09", t:"Load address versus run address, and the boot copy",
kick:"Why your initialised globals hold the right value before main runs.",
tags:["toolchain","startup"],prereq:["sections"],
L:{
idea:"An initialised global has to run in RAM, because it is writable, but its initial value has to survive power-off, so it must be stored in flash. The linker gives the section two addresses: the load address in flash and the run address in RAM.",
run:"Startup code copies the bytes from the load address to the run address before main, then zeroes .bss between _sbss and _ebss. That loop is the entire reason C guarantees globals have their declared values at program start.",
mem:"This is why a large initialised array costs twice: once in flash for the master copy, once in RAM for the working copy.",
trap:"Adding a section to the linker script without adding it to the startup copy loop. The variables exist, the linker is happy, and they contain whatever the RAM powered up with. Symptoms look like random corruption and are maddening to chase.",
compile:"The compiler emits a normal .data input section without knowing the final Flash/RAM arrangement. The linker script creates the distinction between the runtime address and the stored initialization image.",
link:"The linker can define symbols such as LOADADDR(.data), _sdata and _edata so startup code does not need hard-coded addresses. Those symbols are the contract between the linker and reset handler.",
},
src:{cap:"The copy and the clear, which every startup file in the world contains.",code:`extern uint32_t _sidata, _sdata, _edata, _sbss, _ebss;

static void init_data(void)
{
    uint32_t *src = &_sidata, *dst = &_sdata;
    while (dst < &_edata) { *dst++ = *src++; }   /* copy .data  */
    for (dst = &_sbss; dst < &_ebss; ) { *dst++ = 0u; }  /* clear .bss */
}`},
q:{ask:"You add a noinit section for a variable that must survive a watchdog reset. What must you not do to it?",
ans:"Do not include it in the .bss clear or the .data copy. Its whole purpose is that startup leaves it alone."}},

{id:"startup", code:"1.10", t:"Reset vector and startup code",
kick:"The hundred or so instructions that run before the first line of main.",
tags:["toolchain","startup"],prereq:["lmavma"],
L:{
idea:"On reset the Cortex-M core loads the stack pointer from the first word of the vector table and the program counter from the second. That second word points at Reset_Handler, and everything C needs is built by that function before it calls main.",
run:"The order is: set the stack, optionally configure clocks and flash wait states, copy .data, zero .bss, enable the FPU if present, run static constructors via __libc_init_array, then branch to main. If main ever returns, a while(1) catches it.",
mem:"The initial stack pointer is a link-time constant, usually the top of RAM, placed in the vector table by the linker script. Nothing at run time chooses it.",
hw:"The vector table must be at the address the core reads on reset, or VTOR must be programmed to point at it. This is the one thing a bootloader must fix up before jumping into an application image.",
trap:"Calling a driver that relies on a global before init_data has run. Constructors and any code called from startup must not assume initialised globals until the copy loop is done."
},
src:{cap:"The vector table's first two entries decide whether the chip boots at all.",code:`extern uint32_t _estack;
void Reset_Handler(void);

__attribute__((section(".isr_vector"), used))
void (* const vectors[])(void) = {
    (void (*)(void))&_estack,   /* [0] initial SP  */
    Reset_Handler,              /* [1] initial PC  */
    NMI_Handler, HardFault_Handler, /* ... */
};`},
q:{ask:"A bootloader jumps to an application at 0x08010000 and the app crashes on its first interrupt. What was forgotten?",
ans:"SCB->VTOR was not set to the application's vector table, so interrupts still dispatch through the bootloader's table."}},

{id:"mapfile", code:"1.11", t:"Reading the map file",
kick:"The flash and RAM budget, itemised, generated on every build, read by almost nobody.",
tags:["toolchain","linker"],prereq:["sections"],
L:{
idea:"The map file lists every section, its address and size, which object file contributed it, and why each archive member was pulled in. It is the ground truth for what is in your image.",
link:"The archive member table near the top answers the question why is this in my build, by naming the symbol that dragged it in. This is how you discover that one sprintf call pulled in 12 KB of formatting and floating-point support.",
mem:"Sorting the symbol list by size finds the buffers worth shrinking in about two minutes, which is faster than any guess.",
trap:"Optimising code size by rewriting logic when the actual growth is a library. Check the map first.",
compile:"The map file is not another compilation product; it is a report generated by the link step. It is useful because it connects object files and symbols to the final layout the compiler could not know alone.",
run:"Use it to explain runtime symptoms: an unexpectedly large .bss explains RAM pressure, a pulled-in library explains Flash growth, and a symbol address can turn a crash PC into a specific linked object.",
},
src:{cap:"Size accounting, from coarse to precise.",code:`arm-none-eabi-size out.elf
#   text    data     bss     dec     hex
#  48120     412   18344   66876   1053c
#  flash = text + data      RAM = data + bss

arm-none-eabi-nm -S --size-sort -td out.elf | tail -20   # biggest objects`},
q:{ask:"size reports data = 412. How much flash does that consume, and how much RAM?",
ans:"412 bytes of each: RAM for the live copy, flash for the initial values that get copied at startup."}},

{id:"crossbuild", code:"1.12", t:"Cross-compilation and build systems",
kick:"Your host compiler and your target compiler agree on almost nothing.",
tags:["toolchain"],prereq:["pipeline"],
L:{
idea:"A cross-compiler runs on one system and emits code for another. A triplet such as arm-none-eabi describes the target family and embedded ABI environment. Target options and the ABI determine instruction set, calling convention, data layout expectations, and library compatibility.",
compile:"The flags that matter for correctness, not just speed: -mcpu and -mthumb pick the instruction set, -mfloat-abi decides whether floats travel in FPU registers, and a mismatch between a library and your objects here produces a link error or, worse, silently wrong argument passing.",
link:"Specs files or --specs=nano.specs choose which C library variant is linked. newlib-nano is dramatically smaller and is what you want unless you need full printf.",
trap:"Testing host code and assuming the target has identical C implementation choices. Widths, char signedness, alignment, padding, endianness, ABI and available instructions can differ. Use host tests for portable logic, then exercise target-dependent behavior on the target.",
run:"A cross-build separates host execution from target execution. Host tests can validate pure logic, but target-only properties such as register access, alignment traps, interrupt timing and exact ABI layout still need target evidence.",
design:"Make the build reproducible: compiler version, target flags, linker script, libraries and generated files should be explicit inputs. A different host compiler or default ABI can silently change sizes and calling conventions.",
},
src:{cap:"A flag set that is correct rather than merely working.",code:`CFLAGS = -mcpu=cortex-m4 -mthumb -mfloat-abi=hard -mfpu=fpv4-sp-d16 \\
         -std=c11 -Og -g3 \\
         -Wall -Wextra -Wconversion -Wshadow -Wundef \\
         -ffunction-sections -fdata-sections
LDFLAGS = -T link.ld -Wl,--gc-sections -Wl,-Map=out.map --specs=nano.specs`},
q:{ask:"Why can a hard-float and a soft-float object file link and then misbehave?",
ans:"They disagree about where float arguments are passed — FPU registers versus core registers. Modern toolchains flag it, but with mixed prebuilt libraries you can still get silently wrong values."}},

{id:"debugging", code:"1.13", t:"Debug symbols, disassembly and on-chip debug",
kick:"How a debugger maps a halted CPU back to the line of C you wrote.",
tags:["toolchain","debug"],prereq:["objfile"],
L:{
idea:"DWARF debug information maps addresses to source lines, and variable names to register or stack locations. It lives in the ELF and is not downloaded to the chip, which is why the .bin is smaller than the .elf and why you flash one but debug against the other.",
run:"SWD or JTAG gives the debug probe direct access to the bus and to the core's halt, step and breakpoint logic. It can read and write RAM and peripheral registers while the core is stopped, which means you can inspect hardware state, not just variables.",
hw:"Hardware breakpoints are a limited resource, often six on Cortex-M. Beyond that the debugger uses software breakpoints, which it cannot do in flash without reprogramming, which is why you sometimes just run out.",
trap:"Debugging with the .bin flashed and the .elf out of date. The addresses no longer match the symbols and the debugger confidently shows you the wrong function. Always flash the artefact you are debugging.",
mem:"Debug symbols map machine addresses back to source objects and line information without changing the deployed instruction stream. The exact ELF used for the binary must be kept with the image for reliable post-mortem decoding.",
design:"Debugging is an evidence chain: capture the fault context, identify the exact image, translate addresses, inspect disassembly/registers, then reproduce the state. Avoid changing optimisation or source before recording the original evidence.",
},
src:{cap:"Turning a fault address into a source line, without a debugger attached.",code:`arm-none-eabi-addr2line -e out.elf -f -C 0x08004a12
arm-none-eabi-objdump -dS out.elf > out.lst   # disassembly interleaved with C`},
q:{ask:"A HardFault handler logs the stacked PC. How do you find which line faulted after the fact?",
ans:"Feed the PC to addr2line against the exact ELF that was flashed. This is why the ELF for every released build has to be archived."}}

]});
</script>
