<script>
/* Canonical topic registry. STAGES own teaching content; TOPICS owns the
   complete topic contract consumed by the app: stage identity, approach,
   visual, conceptual relationships, and interview coverage. */
var TOPIC_META = {
  "structs": {
    "approach": "For structs, start from the member declarations and intended invariant, then map the fields into memory and ask what layout assumptions surrounding code makes.",
    "visual": {
      "title": "Struct members have offsets",
      "html": "<div class=\"tv-struct\"><div><span>offset 0</span><b>uint8_t state</b></div><div><span>offset 1</span><b>uint8_t mode</b></div><div><span>offset 2–3</span><em>padding</em></div><div><span>offset 4–7</span><b>uint32_t count</b></div><div class=\"tv-caption\">The compiler chooses a layout that satisfies each member alignment requirement.</div></div>"
    },
    "related": [
      {
        "id": "opaque",
        "why": "An opaque type hides exactly the layout that a struct exposes."
      },
      {
        "id": "cmsis",
        "why": "A peripheral overlay is a struct pointed at a fixed address."
      }
    ]
  },
  "padding": {
    "approach": "For padding, alignment and packing, lay out the members in order with their alignment requirements; every unexpected byte should have a specific padding reason.",
    "visual": {
      "title": "Alignment creates padding",
      "html": "<div class=\"tv-padding\"><div><span>char</span><b>1B</b></div><div class=\"pad\"><span>padding</span><b>3B</b></div><div><span>uint32_t</span><b>4B</b></div><div class=\"tv-caption\">Padding is not “wasted by accident”; it can be required so a later member has a valid alignment.</div></div>"
    },
    "related": [
      {
        "id": "endian",
        "why": "Byte order and padding both leak into a wire format the moment a struct is written to a bus."
      },
      {
        "id": "align2",
        "why": "Padding exists because the bus needs alignment; unaligned access is what padding avoids."
      },
      {
        "id": "buses",
        "why": "Padding and endianness are the two things that leak into wire formats."
      },
      {
        "id": "standards",
        "why": "_Static_assert on sizeof catches layout drift at the moment of the edit."
      }
    ]
  },
  "unions": {
    "approach": "For unions and type punning, separate the shared storage from the active interpretation; ask which member was written, what is permitted to read, and what the representation means.",
    "related": [
      {
        "id": "endian",
        "why": "Punning through a union shows you the CPU's byte order, which is not the wire order."
      }
    ]
  },
  "bitfields": {
    "approach": "For bitfields, treat bitfields as a compiler-defined layout tool rather than a portable wire format; inspect width, allocation order, and read-modify-write implications.",
    "related": [
      {
        "id": "bitops",
        "why": "A bitfield is mask-and-shift code the compiler writes for you, with the same read-modify-write cost."
      },
      {
        "id": "regs",
        "why": "Bitfields on a register with write-1-to-clear bits clear flags you never touched."
      }
    ]
  },
  "enums": {
    "approach": "For enums, start with the set of named states the design needs, then distinguish the enum type from its underlying representation and range.",
    "related": [
      {
        "id": "statemachine",
        "why": "The COUNT idiom keeps the transition table and the state enum in step."
      }
    ]
  },
  "typedefs": {
    "approach": "For typedef and reading declarations, expand the typedef mentally before reading the declaration; typedef changes the spelling of a type, not the underlying type or storage."
  },
  "macros": {
    "approach": "For macros, and when a function is better, ask whether the substitution needs type checking, evaluation rules, or a real function boundary; those questions reveal when a macro is the wrong tool.",
    "related": [
      {
        "id": "preproc",
        "why": "Macros are the preprocessor's only real feature, and its main hazard."
      },
      {
        "id": "inline",
        "why": "static inline replaced most macros: same cost, plus types and scope."
      },
      {
        "id": "inline",
        "why": "Inline gives you macro speed with type checking."
      }
    ]
  },
  "headers": {
    "approach": "For headers, include guards and module surface, treat a header as a module interface: expose what other translation units need and keep definitions that create storage in source files.",
    "related": [
      {
        "id": "tu",
        "why": "A header is a bundle of declarations, and definitions in it multiply across units."
      },
      {
        "id": "opaque",
        "why": "A header's surface is the public contract; an opaque type shrinks it further."
      }
    ]
  },
  "initrules": {
    "approach": "For initialisation: what is guaranteed and when, classify the object by storage duration and initialization form before predicting its value; then ask what happens before main and when a block is entered.",
    "related": [
      {
        "id": "sections",
        "why": "The section a variable lands in is the source of the zero-initialisation guarantee."
      },
      {
        "id": "lmavma",
        "why": "This loop is the entire mechanism behind 'static objects are initialised before main'."
      }
    ]
  },
  "heap": {
    "approach": "For the heap: malloc, free and fragmentation, follow one allocation from request to returned block to free; then reason about fragmentation and lifetime rather than treating the heap as infinite.",
    "visual": {
      "title": "Heap history changes future availability",
      "html": "<div class=\"tv-heap-row\"><b>free</b><b>A</b><b>free</b><b>B</b><b>free</b></div><div class=\"tv-heap-row\"><b>free</b><b>A</b><b>free</b><b>free</b><b>free</b></div><div class=\"tv-caption\">Free bytes can be split into holes. A large request may fail even when the total free space is larger than the request.</div>"
    },
    "related": [
      {
        "id": "stackframe",
        "why": "Heap and stack grow toward each other in the same RAM."
      },
      {
        "id": "allocstrat",
        "why": "Static allocation is the answer to everything the heap makes unprovable."
      }
    ],
    "interview": [
      "iv-au1"
    ]
  },
  "allocstrat": {
    "approach": "For static allocation as a design strategy, start from lifetime and maximum count, then compare static, stack, and dynamic allocation against determinism and RAM budget.",
    "related": [
      {
        "id": "mapfile",
        "why": "With static allocation the map file is a complete RAM budget."
      },
      {
        "id": "heap",
        "why": "Static allocation is the answer to everything the heap makes unprovable."
      },
      {
        "id": "ringbuf",
        "why": "A ring buffer is a static, bounded allocation with a designed overflow policy."
      },
      {
        "id": "rtos",
        "why": "Task stacks and queues are static allocations too; the linker sums them."
      },
      {
        "id": "automotive",
        "why": "Everything argued for in stage 2 becomes a rule here, not a preference."
      }
    ]
  },
  "recursion": {
    "approach": "For recursion, reentrancy and pure functions, draw the call stack for two or three nested calls, then ask whether re-entry, shared state, and stack depth remain safe under interrupts or concurrency.",
    "visual": {
      "title": "Hidden state vs caller-owned state",
      "html": "<div class=\"tv-concurrency\"><div><strong>hidden static state</strong><span class=\"tv-line\">→</span><span>call A</span><span>call B</span></div><div><strong>caller-owned state</strong><span class=\"tv-line\">→</span><span>state A</span><span>state B</span></div><div class=\"tv-caption\">Reentrant code keeps mutable state in the caller or another explicitly synchronized owner instead of a shared hidden object.</div></div>"
    },
    "related": [
      {
        "id": "static",
        "why": "A local static is hidden shared state, which makes a function non-reentrant."
      },
      {
        "id": "stackframe",
        "why": "Recursion makes worst-case stack depth data-dependent, which is why it is banned."
      },
      {
        "id": "isr",
        "why": "Reentrancy is the property an ISR-callable function needs."
      },
      {
        "id": "automotive",
        "why": "No recursion is a rule because stack depth must be provable."
      }
    ],
    "interview": [
      "iv-au6"
    ]
  },
  "whatlang": {
    "approach": "For this toolchain topic, start with the contract between source code and machine behavior: a language defines meaning, while a compiler chooses an implementation of that meaning."
  },
  "pipeline": {
    "approach": "For this toolchain topic, track one source file through each representation and ask at every boundary what information is added, transformed, or deliberately left unresolved.",
    "visual": {
      "title": "One program, changing representation",
      "html": "<div class=\"tv-flow\"><span>C source</span><i>→</i><span>preprocessed C</span><i>→</i><span>assembly</span><i>→</i><span>.o</span><i>→</i><span>ELF</span><i>→</i><span>programming image</span></div>"
    },
    "related": [
      {
        "id": "debugging",
        "why": "Every stage leaves an artefact you can inspect: .i, .s, .o, .elf, .map, then DWARF."
      }
    ]
  },
  "preproc": {
    "approach": "For this toolchain topic, read the source after textual substitution mentally: macros and includes happen before C compilation, so ask what tokens the compiler actually receives.",
    "visual": {
      "title": "Preprocessor boundary",
      "html": "<div class=\"tv-preproc\"><div><code>#define SCALE 10</code><code>uint32_t x = SCALE + LIMIT;</code></div><div class=\"tv-arrow\">↓</div><div><code>uint32_t x = 10 + LIMIT;</code></div><div class=\"tv-caption\">The compiler receives the result of preprocessing, not a magical higher-level macro object.</div></div>"
    },
    "related": [
      {
        "id": "macros",
        "why": "Macros are the preprocessor's only real feature, and its main hazard."
      }
    ]
  },
  "compiler": {
    "approach": "For this toolchain topic, separate front-end language rules, optimization, and target code generation; do not treat the compiler as one opaque operation.",
    "related": [
      {
        "id": "optim",
        "why": "The middle end is where the as-if rule is exercised on your code."
      },
      {
        "id": "ub",
        "why": "The optimiser assumes undefined behaviour never happens; that is how it reasons about the IR."
      }
    ]
  },
  "objfile": {
    "approach": "For this toolchain topic, think of an object file as an unfinished machine-code package: sections and symbols exist, but some addresses still depend on other objects and the linker.",
    "visual": {
      "title": "What an object file still has unresolved",
      "html": "<div class=\"tv-obj\"><div><b>.text</b><span>machine code</span></div><div><b>.data/.bss</b><span>objects</span></div><div><b>symbols</b><span>names + bindings</span></div><div><b>relocations</b><span>patches still needed</span></div></div>"
    },
    "related": [
      {
        "id": "mapfile",
        "why": "The map file is the linker's account of what it did with every object file's sections."
      }
    ]
  },
  "linker": {
    "approach": "For this toolchain topic, start with symbols and sections, then trace how references become addresses; distinguish symbol resolution from placement policy.",
    "visual": {
      "title": "What the linker combines",
      "html": "<div class=\"tv-link\"><span>main.o</span><span>startup.o</span><span>libraries</span><i>+</i><span>linker.ld</span><i>→</i><strong>firmware.elf</strong></div>"
    },
    "related": [
      {
        "id": "tu",
        "why": "The one-definition rule is enforced here, not by the compiler."
      },
      {
        "id": "weak",
        "why": "A weak symbol is a link-time rule: the strong definition silently wins."
      },
      {
        "id": "arrptr",
        "why": "The linker matches names, not types, so extern char *x for an array links and then faults."
      }
    ]
  },
  "ldscript": {
    "approach": "For this toolchain topic, read the script as a memory-placement policy: first define regions, then define output sections and the addresses they must occupy.",
    "related": [
      {
        "id": "bootloader",
        "why": "Each firmware image needs its own linker script, origin and vector table base."
      }
    ]
  },
  "sections": {
    "approach": "For this toolchain topic, for each C object or function, ask which input section it enters and which output section receives it; then ask where that output section is placed.",
    "visual": {
      "title": "C object → section → memory",
      "html": "<div class=\"tv-sections\"><div><span>function</span><b>.text</b><em>FLASH</em></div><div><span>const table</span><b>.rodata</b><em>FLASH</em></div><div><span>global = 5</span><b>.data</b><em>RAM + Flash init</em></div><div><span>global = 0</span><b>.bss</b><em>RAM only</em></div></div>"
    },
    "related": [
      {
        "id": "harvard",
        "why": "Flash-versus-RAM is the whole reason there are four sections."
      },
      {
        "id": "constk",
        "why": "const decides .rodata versus .data, which decides whether a table costs RAM."
      },
      {
        "id": "initrules",
        "why": "The section a variable lands in is the source of the zero-initialisation guarantee."
      }
    ]
  },
  "lmavma": {
    "approach": "For this toolchain topic, draw two addresses for initialized data: where its initial bytes are stored and where the object exists at runtime; startup connects the two.",
    "visual": {
      "title": "Two addresses for initialized data",
      "html": "<div class=\"tv-lma\"><div class=\"tv-memory-col\"><strong>FLASH</strong><span>.data initial bytes</span></div><div class=\"tv-arrow\">startup copy →</div><div class=\"tv-memory-col\"><strong>RAM</strong><span>.data runtime object</span></div><div class=\"tv-caption\">LMA answers “where are the initial bytes stored?” VMA answers “where does the object run?”</div></div>"
    },
    "related": [
      {
        "id": "startup",
        "why": "The copy loop that honours load versus run address is part of the startup sequence."
      },
      {
        "id": "lowpower",
        "why": "A retained-RAM variable is exactly a section the copy and clear loops must skip."
      },
      {
        "id": "initrules",
        "why": "This loop is the entire mechanism behind 'static objects are initialised before main'."
      }
    ],
    "interview": [
      "iv-lp2"
    ]
  },
  "startup": {
    "approach": "For this toolchain topic, start at reset, not main: identify the initial stack pointer and reset handler, then trace each runtime initialization step before C code begins.",
    "visual": {
      "title": "Reset to main",
      "html": "<div class=\"tv-startup\"><span>reset</span><i>→</i><span>vector table</span><i>→</i><span>Reset_Handler</span><i>→</i><span>.data copy</span><i>→</i><span>.bss zero</span><i>→</i><strong>main()</strong></div>"
    },
    "related": [
      {
        "id": "lmavma",
        "why": "The copy loop that honours load versus run address is part of the startup sequence."
      },
      {
        "id": "clocks",
        "why": "The clock is configured in startup or right after, before anything timing-dependent."
      },
      {
        "id": "vectors",
        "why": "The first two vector entries are consumed by hardware before any C exists."
      },
      {
        "id": "bootloader",
        "why": "A bootloader repeats the reset sequence by hand for the application image."
      },
      {
        "id": "lowpower",
        "why": "Standby wakes through a full reset: startup runs again."
      }
    ],
    "interview": [
      "iv-bm4"
    ]
  },
  "mapfile": {
    "approach": "For this toolchain topic, read a map file from the memory regions inward: find section placement first, then drill into symbols and object contributions.",
    "related": [
      {
        "id": "objfile",
        "why": "The map file is the linker's account of what it did with every object file's sections."
      },
      {
        "id": "variadic",
        "why": "One printf can drag several kilobytes of formatting code in; the map file names the symbol that pulled it."
      },
      {
        "id": "allocstrat",
        "why": "With static allocation the map file is a complete RAM budget."
      }
    ]
  },
  "crossbuild": {
    "approach": "For this toolchain topic, keep host and target separate: identify which machine runs each tool and which machine will execute the resulting code.",
    "related": [
      {
        "id": "types",
        "why": "Host and target disagree about int width, char signedness and struct padding."
      },
      {
        "id": "testing",
        "why": "Host builds test logic; only the target build tests layout and timing."
      }
    ]
  },
  "debugging": {
    "approach": "For this toolchain topic, treat symbols and disassembly as two views of the same machine image; use source names to find code, then assembly to verify what actually ran.",
    "related": [
      {
        "id": "pipeline",
        "why": "Every stage leaves an artefact you can inspect: .i, .s, .o, .elf, .map, then DWARF."
      },
      {
        "id": "faults",
        "why": "addr2line against the exact ELF is how a stacked PC becomes a source line."
      }
    ]
  },
  "regs": {
    "approach": "For this embedded-system topic, start from the register specification: address, reset value, bit meaning, access type, and side effects. Only then write the C expression.",
    "visual": {
      "title": "A hardware register is a bit contract",
      "html": "<div class=\"tv-reg\"><div><span>31…16</span><b>reserved / other</b></div><div><span>15…8</span><b>MODE</b></div><div><span>7…4</span><b>STATUS</b></div><div><span>3…0</span><b>ENABLE</b></div><div class=\"tv-caption\">Start with reset value, access type, field meaning, and side effects before choosing a C access pattern.</div></div>"
    },
    "related": [
      {
        "id": "bitops",
        "why": "Set, clear, toggle, test: these four idioms are the whole vocabulary of register code."
      },
      {
        "id": "bitfields",
        "why": "Bitfields on a register with write-1-to-clear bits clear flags you never touched."
      },
      {
        "id": "clocks",
        "why": "The clock-enable write comes before every other write to a peripheral."
      },
      {
        "id": "cmsis",
        "why": "The struct overlay is how register access is spelled in real code."
      },
      {
        "id": "regatomic",
        "why": "Access type decides the idiom; atomicity decides whether it is safe."
      },
      {
        "id": "i2c",
        "why": "I2C driver correctness depends on both peripheral register semantics and the external bus electrical contract."
      }
    ],
    "interview": [
      "iv-au5"
    ]
  },
  "cmsis": {
    "approach": "For this embedded-system topic, map the peripheral register block onto documented offsets and widths, then verify the C struct layout rather than assuming it is correct.",
    "related": [
      {
        "id": "structs",
        "why": "A peripheral overlay is a struct pointed at a fixed address."
      },
      {
        "id": "standards",
        "why": "_Static_assert on offsetof keeps a register overlay honest."
      },
      {
        "id": "regs",
        "why": "The struct overlay is how register access is spelled in real code."
      }
    ]
  },
  "regatomic": {
    "approach": "For this embedded-system topic, identify whether hardware provides atomic set/clear/toggle operations; if not, treat read-modify-write as a race with interrupts or other agents.",
    "related": [
      {
        "id": "atomicity",
        "why": "A register with two writers is the same lost-update bug as a variable with two writers."
      },
      {
        "id": "regs",
        "why": "Access type decides the idiom; atomicity decides whether it is safe."
      }
    ]
  },
  "vectors": {
    "approach": "For this embedded-system topic, read the vector table as a table of addresses: initial stack pointer first, reset handler second, then exception/interrupt handlers at fixed entries.",
    "visual": {
      "title": "Vector table",
      "html": "<div class=\"tv-vectors\"><div><b>0</b><span>initial MSP</span></div><div><b>1</b><span>Reset_Handler</span></div><div><b>2</b><span>NMI_Handler</span></div><div><b>…</b><span>exception / IRQ entries</span></div></div>"
    },
    "related": [
      {
        "id": "cpu",
        "why": "On exception entry the hardware saves the same registers a function call would."
      },
      {
        "id": "startup",
        "why": "The first two vector entries are consumed by hardware before any C exists."
      },
      {
        "id": "funcptr",
        "why": "The vector table is an array of function pointers the hardware calls."
      },
      {
        "id": "weak",
        "why": "Every vendor default handler is weak so your definition can win."
      },
      {
        "id": "isr",
        "why": "The vector table is where a handler name becomes an address."
      },
      {
        "id": "faults",
        "why": "HardFault is just another vector, and its stacked frame is the evidence."
      }
    ]
  },
  "isr": {
    "approach": "For this embedded-system topic, keep the ISR path bounded: identify what must happen immediately, what can be deferred, and which shared state crosses the ISR/mainline boundary.",
    "visual": {
      "title": "Keep the interrupt path bounded",
      "html": "<div class=\"tv-isr\"><span>IRQ</span><i>→</i><strong>capture / acknowledge</strong><i>→</i><span>defer work</span><i>→</i><span>main/task</span></div>"
    },
    "related": [
      {
        "id": "float",
        "why": "A float touched in an ISR adds FPU register stacking to every interrupt entry."
      },
      {
        "id": "recursion",
        "why": "Reentrancy is the property an ISR-callable function needs."
      },
      {
        "id": "barriers",
        "why": "DSB before returning makes sure the flag clear has landed."
      },
      {
        "id": "vectors",
        "why": "The vector table is where a handler name becomes an address."
      },
      {
        "id": "isrshare",
        "why": "An ISR is a second thread of execution."
      },
      {
        "id": "critical",
        "why": "Keeping an ISR short is what keeps critical sections short."
      }
    ]
  },
  "isrshare": {
    "approach": "For this embedded-system topic, name the producer and consumer, then ask what can change between the read and the next instruction; width alone does not guarantee a safe shared protocol.",
    "related": [
      {
        "id": "volatilek",
        "why": "volatile is necessary for an ISR-shared flag and never sufficient."
      },
      {
        "id": "optim",
        "why": "The compiler cannot know an ISR exists, so it caches the shared flag."
      },
      {
        "id": "atomicity",
        "why": "This is the problem; the four patterns in topic 4.06 are the answers."
      },
      {
        "id": "isr",
        "why": "An ISR is a second thread of execution."
      }
    ],
    "interview": [
      "iv-rt4"
    ]
  },
  "critical": {
    "approach": "For this embedded-system topic, define exactly which invariant the critical section protects and which interrupts or contexts must be excluded; minimize the protected interval.",
    "related": [
      {
        "id": "atomicity",
        "why": "A critical section is the blunt fix when nothing single-word will do."
      },
      {
        "id": "isr",
        "why": "Keeping an ISR short is what keeps critical sections short."
      },
      {
        "id": "rtos",
        "why": "An RTOS masks with BASEPRI so urgent interrupts keep running."
      },
      {
        "id": "priority",
        "why": "Both are about protecting shared state; one masks interrupts, the other blocks a task."
      }
    ]
  },
  "iomodes": {
    "approach": "For this embedded-system topic, compare latency, CPU load, throughput, and ownership of the data path for polling, interrupts, and DMA rather than treating one mode as universally better.",
    "related": [
      {
        "id": "barriers",
        "why": "DMA is a second bus master, so buffer hand-off needs a barrier."
      },
      {
        "id": "ringbuf",
        "why": "DMA into a ring buffer is the standard answer to a fast UART."
      },
      {
        "id": "timers",
        "why": "Polling a timer flag versus taking its interrupt is the same trade."
      },
      {
        "id": "spi",
        "why": "SPI transactions map naturally to polling, interrupt or DMA depending on transfer size and timing."
      }
    ],
    "interview": [
      "iv-bm6"
    ]
  },
  "timers": {
    "approach": "For this embedded-system topic, start from the timer clock and desired period, then derive prescaler, counter, compare, and watchdog behavior from those numbers.",
    "visual": {
      "title": "Timer clock path",
      "html": "<div class=\"tv-timer\"><span>source clock</span><i>÷ prescaler</i><span>counter</span><i>compare</i><strong>event</strong></div>"
    },
    "related": [
      {
        "id": "iomodes",
        "why": "Polling a timer flag versus taking its interrupt is the same trade."
      },
      {
        "id": "faults",
        "why": "A watchdog reset does not pass through HardFault, so fault logs never see it."
      }
    ],
    "interview": [
      "iv-au3"
    ]
  },
  "clocks": {
    "approach": "For this embedded-system topic, draw the clock source and divider path from reset to each peripheral, then determine which configuration must happen before dependent hardware can work.",
    "visual": {
      "title": "Clock tree",
      "html": "<div class=\"tv-clock\"><span>source</span><i>→</i><span>PLL / divider</span><i>→</i><span>CPU clock</span><i>→</i><span>peripheral clock</span></div>"
    },
    "related": [
      {
        "id": "harvard",
        "why": "Flash is slower than the core above a certain clock, so wait states must be raised before the clock."
      },
      {
        "id": "startup",
        "why": "The clock is configured in startup or right after, before anything timing-dependent."
      },
      {
        "id": "regs",
        "why": "The clock-enable write comes before every other write to a peripheral."
      },
      {
        "id": "lowpower",
        "why": "Stop-mode exit reverts the clock, so clock setup must run again."
      }
    ],
    "interview": [
      "iv-lp3"
    ]
  },
  "lowpower": {
    "approach": "For this embedded-system topic, list which clocks, registers, RAM, and wake sources survive the chosen mode; low power is a state-transition problem, not just a sleep instruction.",
    "visual": {
      "title": "Low-power state transition",
      "html": "<div class=\"tv-power\"><div><b>run</b><span>clocks + peripherals active</span></div><i>sleep / stop</i><div><b>low power</b><span>only selected wake sources survive</span></div><i>wake</i><div><b>resume</b><span>restore what the mode removed</span></div></div>"
    },
    "related": [
      {
        "id": "lmavma",
        "why": "A retained-RAM variable is exactly a section the copy and clear loops must skip."
      },
      {
        "id": "clocks",
        "why": "Stop-mode exit reverts the clock, so clock setup must run again."
      },
      {
        "id": "startup",
        "why": "Standby wakes through a full reset: startup runs again."
      }
    ],
    "interview": [
      "iv-lp1",
      "iv-lp4"
    ]
  },
  "buses": {
    "approach": "For this embedded-system topic, for each bus, compare framing, addressing, arbitration, duplex behavior, and error detection; then map those properties to the firmware driver state machine.",
    "visual": {
      "title": "Choose the bus from its behaviour",
      "html": "<div class=\"tv-bus\"><div><b>UART</b><span>async stream · framing · buffering</span></div><div><b>SPI</b><span>clocked transaction · CS · CPOL/CPHA</span></div><div><b>I2C</b><span>open-drain · address · ACK · recovery</span></div><div><b>CAN</b><span>arbitration · message IDs · fault states</span></div></div>"
    },
    "related": [
      {
        "id": "endian",
        "why": "Byte order only matters when bytes leave the chip, and buses are where they leave."
      },
      {
        "id": "padding",
        "why": "Padding and endianness are the two things that leak into wire formats."
      },
      {
        "id": "ringbuf",
        "why": "UART receive is a ring buffer because bytes arrive unbidden."
      },
      {
        "id": "endian",
        "why": "Every bus is a serialisation boundary with a defined byte order."
      },
      {
        "id": "uart",
        "why": "UART is a stream with framing; the driver therefore cares about buffering and message boundaries."
      },
      {
        "id": "spi",
        "why": "SPI is a controller-driven transaction; chip-select and clock phase become part of the device contract."
      },
      {
        "id": "i2c",
        "why": "I2C adds addressing, ACK/NACK, open-drain signalling and bus recovery to the transfer model."
      },
      {
        "id": "can",
        "why": "CAN adds arbitration, message identifiers and controller fault states to the transport model."
      }
    ]
  },
  "superloop": {
    "approach": "For this embedded-system topic, list each task’s worst-case work and period, then see whether the loop can service all of them before their deadlines.",
    "related": [
      {
        "id": "statemachine",
        "why": "Every module in a super loop is a state machine that does one step and returns."
      },
      {
        "id": "rtos",
        "why": "The trade is RAM for a stack per task against blocking without stopping the system."
      }
    ]
  },
  "rtos": {
    "approach": "For this embedded-system topic, treat every task as a separate stack and scheduling context; start with timing requirements and stack budget before choosing priorities.",
    "visual": {
      "title": "RTOS memory model",
      "html": "<div class=\"tv-rtos\"><div><b>Task A</b><span>stack A</span></div><div><b>Task B</b><span>stack B</span></div><div><b>Task C</b><span>stack C</span></div><div><b>kernel</b><span>scheduler + synchronization</span></div><div class=\"tv-caption\">Each task needs its own bounded stack; scheduling policy and synchronization determine which task runs next.</div></div>"
    },
    "related": [
      {
        "id": "stackframe",
        "why": "Every RTOS task needs its own stack sized for its own worst-case frame chain."
      },
      {
        "id": "allocstrat",
        "why": "Task stacks and queues are static allocations too; the linker sums them."
      },
      {
        "id": "critical",
        "why": "An RTOS masks with BASEPRI so urgent interrupts keep running."
      },
      {
        "id": "superloop",
        "why": "The trade is RAM for a stack per task against blocking without stopping the system."
      },
      {
        "id": "priority",
        "why": "Preemption is what makes priority inversion possible."
      }
    ]
  },
  "priority": {
    "approach": "For this embedded-system topic, draw the blocked task and lock holder, then identify the higher-priority task that is delayed; this makes priority inversion concrete.",
    "visual": {
      "title": "Priority inversion",
      "html": "<div class=\"tv-priority\"><div><span>High task</span><i>blocked by</i><span>lock</span></div><div><span>Medium task</span><i>runs</i><span>and delays lock holder</span></div><div><span>Low task</span><i>holds</i><span>lock</span></div><div class=\"tv-caption\">The high-priority task cannot proceed until the low-priority owner runs; priority inheritance or a different design can bound the inversion.</div></div>"
    },
    "related": [
      {
        "id": "rtos",
        "why": "Preemption is what makes priority inversion possible."
      },
      {
        "id": "critical",
        "why": "Both are about protecting shared state; one masks interrupts, the other blocks a task."
      }
    ],
    "interview": [
      "iv-rt2",
      "iv-rt5",
      "iv-rt6"
    ]
  },
  "faults": {
    "approach": "For this embedded-system topic, start from the fault symptom and processor fault state, then use the stacked context and fault status registers to reconstruct what happened.",
    "visual": {
      "title": "Fault reconstruction",
      "html": "<div class=\"tv-fault\"><div><span>fault</span><i>→</i><span>stacked PC/LR</span><i>→</i><span>fault status</span><i>→</i><strong>root cause</strong></div></div>"
    },
    "related": [
      {
        "id": "debugging",
        "why": "addr2line against the exact ELF is how a stacked PC becomes a source line."
      },
      {
        "id": "stackframe",
        "why": "A guard region below the stack turns silent overflow into a MemManage fault."
      },
      {
        "id": "errors",
        "why": "The reaction to an error is designed; a fault handler is the last resort."
      },
      {
        "id": "vectors",
        "why": "HardFault is just another vector, and its stacked frame is the evidence."
      },
      {
        "id": "timers",
        "why": "A watchdog reset does not pass through HardFault, so fault logs never see it."
      },
      {
        "id": "can",
        "why": "CAN controller error states and bus-off recovery become part of system fault handling."
      },
      {
        "id": "bootloader",
        "why": "A bootloader must survive and recover from a bad application image."
      }
    ]
  },
  "bootloader": {
    "approach": "For this embedded-system topic, draw the Flash regions for bootloader, application, metadata, and update image; then trace which component owns each address and handoff.",
    "visual": {
      "title": "Typical Flash ownership",
      "html": "<div class=\"tv-boot\"><div><b>bootloader</b><span>fixed region</span></div><div><b>application</b><span>vector + code + data image</span></div><div><b>metadata</b><span>version / validity / update state</span></div><div><b>staging</b><span>optional update image</span></div></div>"
    },
    "related": [
      {
        "id": "ldscript",
        "why": "Each firmware image needs its own linker script, origin and vector table base."
      },
      {
        "id": "startup",
        "why": "A bootloader repeats the reset sequence by hand for the application image."
      },
      {
        "id": "funcptr",
        "why": "A bootloader jump is a function pointer call, and the Thumb bit must survive it."
      },
      {
        "id": "barriers",
        "why": "VTOR writes need DSB and ISB before the first interrupt can use them."
      },
      {
        "id": "faults",
        "why": "A bootloader must survive and recover from a bad application image."
      }
    ],
    "interview": [
      "iv-bm8"
    ]
  },
  "testing": {
    "approach": "For this embedded-system topic, separate what can be proven on the host from what requires target hardware; then choose unit, static, integration, or HIL evidence accordingly.",
    "visual": {
      "title": "Evidence at different boundaries",
      "html": "<div class=\"tv-test\"><div><b>host unit</b><span>logic + edge cases</span></div><div><b>target integration</b><span>ABI + registers + timing</span></div><div><b>HIL/system</b><span>real peripherals + interactions</span></div></div>"
    },
    "related": [
      {
        "id": "crossbuild",
        "why": "Host builds test logic; only the target build tests layout and timing."
      },
      {
        "id": "weak",
        "why": "A weak default is also the easiest test double."
      },
      {
        "id": "opaque",
        "why": "An opaque type is what makes a driver testable behind a pointer."
      },
      {
        "id": "errors",
        "why": "An unchecked return is a test that cannot be written."
      },
      {
        "id": "automotive",
        "why": "MCAL is dependency injection standardised for a whole industry."
      }
    ]
  },
  "automotive": {
    "approach": "For this embedded-system topic, map the software layer to the hardware boundary and safety responsibility; then ask which requirement, diagnostic, or freedom-from-interference constraint applies.",
    "visual": {
      "title": "Requirement to evidence",
      "html": "<div class=\"tv-safety\"><span>requirement</span><i>→</i><span>design</span><i>→</i><span>implementation</span><i>→</i><span>verification</span><i>→</i><strong>evidence</strong></div>"
    },
    "related": [
      {
        "id": "errors",
        "why": "MISRA and ISO 26262 formalise the discipline of checking every return."
      },
      {
        "id": "testing",
        "why": "MCAL is dependency injection standardised for a whole industry."
      },
      {
        "id": "allocstrat",
        "why": "Everything argued for in stage 2 becomes a rule here, not a preference."
      },
      {
        "id": "recursion",
        "why": "No recursion is a rule because stack depth must be provable."
      }
    ],
    "interview": [
      "iv-au4"
    ]
  },
  "tu": {
    "approach": "For translation units, declarations and definitions, ask which declarations belong to the same translation unit and which definitions create storage; this prevents confusing visibility with existence.",
    "related": [
      {
        "id": "linker",
        "why": "The one-definition rule is enforced here, not by the compiler."
      },
      {
        "id": "externg",
        "why": "An extern is a declaration; its definition is the linker's problem."
      },
      {
        "id": "headers",
        "why": "A header is a bundle of declarations, and definitions in it multiply across units."
      }
    ]
  },
  "types": {
    "approach": "For types, sizes and stdint.h, start with the required range and representation, then choose a type whose size and signedness match the requirement instead of the platform habit.",
    "related": [
      {
        "id": "crossbuild",
        "why": "Host and target disagree about int width, char signedness and struct padding."
      }
    ]
  },
  "scope": {
    "approach": "For scope, linkage and storage duration, separate scope, linkage, and storage duration; each answers a different question about a name or object.",
    "related": [
      {
        "id": "static",
        "why": "File-scope static and local static are two separate uses of one keyword."
      }
    ]
  },
  "static": {
    "approach": "For static, in both of its meanings, check which meaning of static is present: internal linkage for file-scope names versus persistent storage duration for block-scope objects.",
    "related": [
      {
        "id": "scope",
        "why": "File-scope static and local static are two separate uses of one keyword."
      },
      {
        "id": "recursion",
        "why": "A local static is hidden shared state, which makes a function non-reentrant."
      }
    ]
  },
  "externg": {
    "approach": "For extern and the design of shared state, treat extern as a declaration of an object defined elsewhere; then locate the real definition and ask how the linker will resolve it.",
    "visual": {
      "title": "extern connects translation units",
      "html": "<div class=\"tv-extern\"><div class=\"tv-extern-file\"><b>sensor.h</b><code>extern uint16_t sensor_raw;</code><small>declaration only</small></div><div class=\"tv-extern-arrow\">↘</div><div class=\"tv-extern-file\"><b>sensor.c</b><code>uint16_t sensor_raw;</code><small>one definition → storage</small></div><div class=\"tv-extern-arrow\">↗</div><div class=\"tv-extern-file\"><b>control.c</b><code>if (sensor_raw &gt; 100) …</code><small>uses the same object</small></div><div class=\"tv-extern-link\"><span>compiler checks each translation unit</span><i>→</i><strong>linker resolves the shared symbol</strong></div><div class=\"tv-caption\">extern does not create a second variable. It tells another translation unit that the definition exists elsewhere.</div></div>"
    },
    "related": [
      {
        "id": "tu",
        "why": "An extern is a declaration; its definition is the linker's problem."
      }
    ]
  },
  "constk": {
    "approach": "For const, and what it is really promising, ask what the program is promising not to modify through this access path, then separately consider whether the object needs RAM at runtime.",
    "visual": {
      "title": "const applies to an access path",
      "html": "<div class=\"tv-const\"><div><code>const uint32_t *p</code><span>cannot modify *p through p</span></div><div><code>uint32_t * const p</code><span>p cannot point elsewhere</span></div><div><code>const uint32_t * const p</code><span>neither can change through p</span></div></div>"
    },
    "related": [
      {
        "id": "harvard",
        "why": "const is how you say 'this belongs in flash' to the toolchain."
      },
      {
        "id": "sections",
        "why": "const decides .rodata versus .data, which decides whether a table costs RAM."
      },
      {
        "id": "funcptr",
        "why": "A const table of function pointers lives in flash and costs no RAM."
      },
      {
        "id": "strings",
        "why": "A string literal is a const object in .rodata whether or not you wrote const."
      }
    ],
    "interview": [
      "iv-bm7"
    ]
  },
  "volatilek": {
    "approach": "For volatile: first pass, identify the external actor that can change the value—hardware, ISR, or another execution context—then decide which accesses must remain observable.",
    "visual": {
      "title": "Volatile is about observable accesses",
      "html": "<div class=\"tv-concurrency\"><div><span>hardware / ISR</span><i>changes</i></div><div class=\"tv-line\">↕</div><div><strong>volatile object</strong><span>compiler must preserve accesses</span></div><div class=\"tv-caption\">Volatile does not make a compound operation atomic and does not replace synchronization.</div></div>"
    },
    "related": [
      {
        "id": "mmio",
        "why": "volatile exists because an address can have side effects the compiler cannot see."
      },
      {
        "id": "isrshare",
        "why": "volatile is necessary for an ISR-shared flag and never sufficient."
      }
    ],
    "interview": [
      "iv-bm2"
    ]
  },
  "promo": {
    "approach": "For integer promotion and the usual arithmetic conversions, write down the operand types before evaluating the expression; then follow integer promotions and usual arithmetic conversions one operand at a time.",
    "visual": {
      "title": "Integer conversion ladder",
      "html": "<div class=\"tv-convert\"><div><span>uint8_t</span><i>promote</i><strong>int</strong></div><div><span>int</span><i>convert with other operand</i><strong>common type</strong></div><div class=\"tv-caption\">Do not guess from the variable you started with. Write down each operand type and follow the conversion rules.</div></div>"
    },
    "related": [
      {
        "id": "signext",
        "why": "Integer promotion is sign extension the compiler inserts for you, silently."
      },
      {
        "id": "shifts",
        "why": "The operand of a shift is promoted first, so a uint8_t is shifted as an int."
      },
      {
        "id": "fixedpt",
        "why": "A Q15 multiply is only correct if the intermediate is wider than int16_t, which the promotion rules decide."
      },
      {
        "id": "ub",
        "why": "Signed overflow after promotion is undefined; the same expression on unsigned is not."
      }
    ]
  },
  "operators": {
    "approach": "For operators, precedence and sequence points, parenthesize the expression and identify side effects before worrying about precedence; separate grouping rules from sequencing rules.",
    "related": [
      {
        "id": "ub",
        "why": "Modifying an object twice without a sequence point is undefined outright."
      }
    ]
  },
  "control": {
    "approach": "For control flow and the branches it becomes, translate each control construct into the branches or tests the target must perform; this makes fall-through, conditions, and loops concrete.",
    "related": [
      {
        "id": "statemachine",
        "why": "Dense state values let a switch become a jump table, and a table is what a state machine wants."
      }
    ]
  },
  "funcs": {
    "approach": "For functions, the abi and the calling convention, follow one call from caller to callee: arguments, return value, registers, stack frame, and ABI rules. Then inspect what must survive the call.",
    "related": [
      {
        "id": "cpu",
        "why": "Calling convention is the contract for who saves which registers around a branch-with-link."
      },
      {
        "id": "variadic",
        "why": "Variadic arguments follow different promotion rules from fixed ones."
      }
    ]
  },
  "stackframe": {
    "approach": "For the stack frame, draw the frame for one concrete call and label locals, saved state, arguments, and return information; then ask how nesting changes the footprint.",
    "visual": {
      "title": "A call creates a runtime frame",
      "html": "<div class=\"tv-stack\"><div><b>higher address</b><span>caller state / saved context</span><span>arguments / saved registers</span><strong>local variables</strong><span>deeper calls grow here</span><b>lower address</b></div></div><div class=\"tv-caption\">Exact frame layout is ABI- and compiler-dependent. What matters is lifetime: automatic objects exist for the call, and deeper calls consume more stack.</div>"
    },
    "related": [
      {
        "id": "recursion",
        "why": "Recursion makes worst-case stack depth data-dependent, which is why it is banned."
      },
      {
        "id": "rtos",
        "why": "Every RTOS task needs its own stack sized for its own worst-case frame chain."
      },
      {
        "id": "faults",
        "why": "A guard region below the stack turns silent overflow into a MemManage fault."
      },
      {
        "id": "heap",
        "why": "Heap and stack grow toward each other in the same RAM."
      }
    ],
    "interview": [
      "iv-rt3"
    ]
  },
  "arrays": {
    "approach": "For arrays, start from the object itself: an array is contiguous storage with a fixed element type and count; only then consider decay in expressions.",
    "related": [
      {
        "id": "strings",
        "why": "A string is a char array plus a convention about the last byte."
      },
      {
        "id": "ub",
        "why": "No bounds check exists anywhere, so out-of-bounds access is undefined and silent."
      }
    ]
  },
  "strings": {
    "approach": "For strings and the terminating zero, track the terminating zero explicitly and distinguish the bytes in the array from a pointer that refers to them.",
    "related": [
      {
        "id": "arrays",
        "why": "A string is a char array plus a convention about the last byte."
      },
      {
        "id": "constk",
        "why": "A string literal is a const object in .rodata whether or not you wrote const."
      }
    ]
  },
  "pointers": {
    "approach": "For pointers, treat a pointer as a typed address first: identify what object it may designate, its lifetime, and the operations permitted through that type.",
    "visual": {
      "title": "A pointer: address, type, and object",
      "html": "<div class=\"tv-pointer\"><div><span>pointer variable</span><code>p = 0x20001000</code><span>address value</span></div><div><b>p</b><i>→</i><strong>object at 0x20001000</strong></div><div class=\"tv-caption\">The pointer stores an address. Its type tells C how to access the object and how pointer arithmetic scales; the object has its own lifetime and storage.</div></div>"
    },
    "related": [
      {
        "id": "memarray",
        "why": "A pointer is just an index into the flat byte array."
      },
      {
        "id": "aliasing",
        "why": "Two pointers of different types to one address is where strict aliasing bites."
      },
      {
        "id": "align2",
        "why": "A pointer cast promises the compiler an alignment you may not have."
      }
    ]
  },
  "ptrarith": {
    "approach": "For pointer arithmetic, pointer arithmetic is scaled by the pointed-to type; work one element at a time and check that the resulting pointer stays within the permitted object.",
    "visual": {
      "title": "Pointer arithmetic is element arithmetic",
      "html": "<div class=\"tv-ptrarith\"><div><span>uint32_t *</span><code>p</code><strong>0x20001000</strong></div><div><span>p + 1</span><code>+ sizeof(uint32_t)</code><strong>0x20001004</strong></div><div><span>p + 4</span><code>+ 16 bytes</code><strong>0x20001010</strong></div><div class=\"tv-caption\">p + 1 means one element, not one byte. Only one-past-the-end may be formed without dereferencing it.</div></div>"
    }
  },
  "arrptr": {
    "approach": "For arrays and pointers are not the same thing, compare the types of an array and a pointer before discussing their similar syntax; then identify the expression contexts where an array converts to a pointer.",
    "visual": {
      "title": "Array storage vs pointer variable",
      "html": "<div class=\"tv-array\"><span>array object</span><b>buf[0]</b><b>buf[1]</b><b>buf[2]</b><span>one contiguous object</span><b>buf[3]</b><b>buf[4]</b><span>size known to sizeof</span><strong style=\"grid-column:1 / -1;padding:6px;border:1px solid var(--rule);background:var(--surface-2)\">p → buf[0]</strong><div class=\"tv-caption\" style=\"grid-column:1 / -1\">An array owns storage. A pointer stores an address and can be redirected; array-to-pointer conversion loses the array size.</div></div>"
    },
    "related": [
      {
        "id": "linker",
        "why": "The linker matches names, not types, so extern char *x for an array links and then faults."
      }
    ],
    "interview": [
      "iv-bm5"
    ]
  },
  "funcptr": {
    "approach": "For function pointers, callbacks and jump tables, start with the exact function type, then follow how a function address is stored and invoked; callbacks and jump tables use the same mechanism.",
    "visual": {
      "title": "Function pointer dispatch",
      "html": "<div class=\"tv-flow\"><span>state</span><i>→</i><span>table[index]</span><i>→</i><strong>code address</strong><i>→</i><span>indirect call</span></div><div class=\"tv-caption\">A function pointer turns a data value into a code target. The table can decouple dispatch from a long if/else chain, but its targets and validity must be controlled.</div>"
    },
    "related": [
      {
        "id": "constk",
        "why": "A const table of function pointers lives in flash and costs no RAM."
      },
      {
        "id": "vectors",
        "why": "The vector table is an array of function pointers the hardware calls."
      },
      {
        "id": "statemachine",
        "why": "A const table of handlers is the state machine's dispatch."
      },
      {
        "id": "bootloader",
        "why": "A bootloader jump is a function pointer call, and the Thumb bit must survive it."
      }
    ]
  },
  "ub": {
    "approach": "For undefined behaviour, when behavior looks strange, first ask whether the C standard still defines the execution; identify the exact operation that crosses the boundary before blaming the optimizer.",
    "visual": {
      "title": "Four kinds of behavior",
      "html": "<div class=\"tv-ub\"><div><b>defined</b><span>one required result</span></div><div><b>implementation-defined</b><span>choice documented by implementation</span></div><div><b>unspecified</b><span>one of several permitted results</span></div><div><b>undefined</b><span>no requirements remain</span></div></div>"
    },
    "related": [
      {
        "id": "shifts",
        "why": "Three of the classic shift bugs are undefined behaviour, not just wrong answers."
      },
      {
        "id": "compiler",
        "why": "The optimiser assumes undefined behaviour never happens; that is how it reasons about the IR."
      },
      {
        "id": "promo",
        "why": "Signed overflow after promotion is undefined; the same expression on unsigned is not."
      },
      {
        "id": "operators",
        "why": "Modifying an object twice without a sequence point is undefined outright."
      },
      {
        "id": "arrays",
        "why": "No bounds check exists anywhere, so out-of-bounds access is undefined and silent."
      },
      {
        "id": "aliasing",
        "why": "Strict aliasing is one specific permission slip you gave the compiler."
      },
      {
        "id": "impdef",
        "why": "Undefined, unspecified and implementation-defined are three different levels of 'you can't rely on it'."
      }
    ]
  },
  "impdef": {
    "approach": "For implementation-defined and unspecified behaviour, separate three cases: implementation chooses and documents a behavior, the standard permits multiple outcomes, or behavior is undefined.",
    "related": [
      {
        "id": "ub",
        "why": "Undefined, unspecified and implementation-defined are three different levels of 'you can't rely on it'."
      }
    ]
  },
  "aliasing": {
    "approach": "For strict aliasing, identify the effective type and actual lvalue used to access the storage; do not infer legality merely because two pointer types have the same size.",
    "visual": {
      "title": "Bytes are not automatically a struct",
      "html": "<div class=\"tv-alias\"><div><code>uint8_t buf[]</code><i>→ memcpy</i><strong>uint32_t value</strong></div><div class=\"bad\"><code>uint8_t *</code><i>→ cast + dereference</i><strong>uint32_t *</strong></div><div class=\"tv-caption\">The first expresses a byte-copy operation. The second adds alignment and type-access assumptions.</div></div>"
    },
    "related": [
      {
        "id": "pointers",
        "why": "Two pointers of different types to one address is where strict aliasing bites."
      },
      {
        "id": "ub",
        "why": "Strict aliasing is one specific permission slip you gave the compiler."
      },
      {
        "id": "restrict",
        "why": "restrict is the same idea as strict aliasing, applied to pointers of the same type."
      }
    ]
  },
  "align2": {
    "approach": "For alignment faults and unaligned access, find the required alignment of the type and the actual address; then ask whether the target can service that access or traps on it.",
    "related": [
      {
        "id": "pointers",
        "why": "A pointer cast promises the compiler an alignment you may not have."
      },
      {
        "id": "padding",
        "why": "Padding exists because the bus needs alignment; unaligned access is what padding avoids."
      }
    ]
  },
  "optim": {
    "approach": "For what the optimiser is allowed to do to your code, compare the observable behavior required by the language with the code you expected to see; optimization can remove anything with no required observable effect.",
    "related": [
      {
        "id": "compiler",
        "why": "The middle end is where the as-if rule is exercised on your code."
      },
      {
        "id": "volatile2",
        "why": "volatile is the one thing the as-if rule is not allowed to remove."
      },
      {
        "id": "isrshare",
        "why": "The compiler cannot know an ISR exists, so it caches the shared flag."
      }
    ]
  },
  "volatile2": {
    "approach": "For volatile, second pass: what it does not give you, list what volatile guarantees about individual accesses, then explicitly list what it does not guarantee: atomicity, ordering, or synchronization.",
    "visual": {
      "title": "What volatile does and does not do",
      "html": "<div class=\"tv-voltable\"><div><b>volatile provides</b><span>required observable accesses</span></div><div><b>volatile does not</b><span>atomicity · locking · cache coherency · completion</span></div></div>"
    },
    "related": [
      {
        "id": "optim",
        "why": "volatile is the one thing the as-if rule is not allowed to remove."
      },
      {
        "id": "atomicity",
        "why": "volatile stops caching, not the three-instruction window of a read-modify-write."
      },
      {
        "id": "barriers",
        "why": "volatile orders compiler accesses; barriers order hardware accesses."
      }
    ]
  },
  "atomicity": {
    "approach": "For atomicity and read-modify-write, break the operation into machine-level reads and writes; if another context can intervene between them, the operation may not be atomic.",
    "visual": {
      "title": "Read-modify-write has an interruption window",
      "html": "<div class=\"tv-rmw\"><div><span>read</span><i>→</i><span>modify</span><i>→</i><span>write</span></div><div class=\"tv-interrupt\">another context can run here</div><div class=\"tv-caption\">If the shared state changes between the read and write, the final store can overwrite the other context update.</div></div>"
    },
    "related": [
      {
        "id": "volatile2",
        "why": "volatile stops caching, not the three-instruction window of a read-modify-write."
      },
      {
        "id": "regatomic",
        "why": "A register with two writers is the same lost-update bug as a variable with two writers."
      },
      {
        "id": "critical",
        "why": "A critical section is the blunt fix when nothing single-word will do."
      },
      {
        "id": "isrshare",
        "why": "This is the problem; the four patterns in topic 4.06 are the answers."
      },
      {
        "id": "ringbuf",
        "why": "A ring buffer works because each index has exactly one writer."
      }
    ],
    "interview": [
      "iv-rt1"
    ]
  },
  "barriers": {
    "approach": "For memory barriers and ordering, separate compiler reordering from CPU or bus ordering, then identify the producer, consumer, and synchronization point that must be ordered.",
    "visual": {
      "title": "Ordering is not the same as visibility",
      "html": "<div class=\"tv-barrier\"><div><span>CPU stores</span><i>→</i><span>buffer / bus</span><i>→</i><span>device or other observer</span></div><div class=\"tv-caption\">Compiler ordering, CPU ordering, and completion are different questions. Choose the barrier for the guarantee you actually need.</div></div>"
    },
    "related": [
      {
        "id": "mmio",
        "why": "A store to a peripheral can retire before it reaches the peripheral; a barrier closes the gap."
      },
      {
        "id": "volatile2",
        "why": "volatile orders compiler accesses; barriers order hardware accesses."
      },
      {
        "id": "iomodes",
        "why": "DMA is a second bus master, so buffer hand-off needs a barrier."
      },
      {
        "id": "isr",
        "why": "DSB before returning makes sure the flag clear has landed."
      },
      {
        "id": "bootloader",
        "why": "VTOR writes need DSB and ISB before the first interrupt can use them."
      }
    ],
    "interview": [
      "iv-bm3"
    ]
  },
  "inline": {
    "approach": "For inline, static inline and link-time optimisation, treat inline as a request or opportunity rather than a promise; first understand linkage and multiple definitions, then consider optimization.",
    "related": [
      {
        "id": "macros",
        "why": "static inline replaced most macros: same cost, plus types and scope."
      },
      {
        "id": "macros",
        "why": "Inline gives you macro speed with type checking."
      }
    ]
  },
  "weak": {
    "approach": "For weak symbols and link-time overriding, start with symbol names and definitions visible to the linker; weak/strong selection is a link-time rule, not runtime dispatch.",
    "related": [
      {
        "id": "linker",
        "why": "A weak symbol is a link-time rule: the strong definition silently wins."
      },
      {
        "id": "vectors",
        "why": "Every vendor default handler is weak so your definition can win."
      },
      {
        "id": "testing",
        "why": "A weak default is also the easiest test double."
      }
    ]
  },
  "restrict": {
    "approach": "For restrict, identify the pointers promised not to overlap during the relevant access period, then ask which optimization becomes legal because of that promise.",
    "related": [
      {
        "id": "aliasing",
        "why": "restrict is the same idea as strict aliasing, applied to pointers of the same type."
      }
    ]
  },
  "variadic": {
    "approach": "For variadic functions, track fixed arguments separately from unnamed arguments and ask how the callee knows each value’s type and width.",
    "related": [
      {
        "id": "mapfile",
        "why": "One printf can drag several kilobytes of formatting code in; the map file names the symbol that pulled it."
      },
      {
        "id": "funcs",
        "why": "Variadic arguments follow different promotion rules from fixed ones."
      }
    ]
  },
  "standards": {
    "approach": "For c standards, _static_assert and _generic, use the standard feature as a contract with the compiler: identify the compile-time guarantee you want, then choose the smallest feature that expresses it.",
    "related": [
      {
        "id": "padding",
        "why": "_Static_assert on sizeof catches layout drift at the moment of the edit."
      },
      {
        "id": "cmsis",
        "why": "_Static_assert on offsetof keeps a register overlay honest."
      },
      {
        "id": "statemachine",
        "why": "_Static_assert ties the transition table's dimensions to the enum."
      }
    ]
  },
  "opaque": {
    "approach": "For opaque types and module boundaries, hide the representation and expose operations through an interface; then ask which invariants become enforceable because callers cannot access the internals.",
    "related": [
      {
        "id": "structs",
        "why": "An opaque type hides exactly the layout that a struct exposes."
      },
      {
        "id": "headers",
        "why": "A header's surface is the public contract; an opaque type shrinks it further."
      },
      {
        "id": "testing",
        "why": "An opaque type is what makes a driver testable behind a pointer."
      }
    ]
  },
  "ringbuf": {
    "approach": "For ring buffers and single-producer queues, draw producer and consumer positions over a fixed array; the key is deciding what each index means and which side owns each update.",
    "visual": {
      "title": "Single-producer ring buffer",
      "html": "<div class=\"tv-ring\"><div class=\"tv-ring-track\"><b>0</b><b>1</b><b>2</b><b>3</b><b>4</b><b>5</b><b>6</b><b>7</b></div><div class=\"tv-ring-ptrs\"><span>read</span><span>write</span></div><div class=\"tv-caption\">Correctness comes from a precise meaning for each index and clear ownership of updates.</div></div>"
    },
    "related": [
      {
        "id": "allocstrat",
        "why": "A ring buffer is a static, bounded allocation with a designed overflow policy."
      },
      {
        "id": "atomicity",
        "why": "A ring buffer works because each index has exactly one writer."
      },
      {
        "id": "buses",
        "why": "UART receive is a ring buffer because bytes arrive unbidden."
      },
      {
        "id": "iomodes",
        "why": "DMA into a ring buffer is the standard answer to a fast UART."
      },
      {
        "id": "uart",
        "why": "UART receive is an asynchronous byte stream, so buffering is part of the driver design."
      }
    ]
  },
  "ownership": {
    "approach": "For ownership and hand-off protocols, draw the resource through each owner state and mark the exact event that transfers ownership; never let two contexts implicitly own the same mutable storage.",
    "visual": {
      "title": "Ownership is a state machine",
      "html": "<div class=\"tv-masters\"><div class=\"tv-master-row\"><b>CPU</b><span>prepare buffer</span></div><div class=\"tv-master-row\"><b>DMA</b><span>hardware owns buffer</span></div><div class=\"tv-master-row\"><b>CPU</b><span>consume after completion</span></div><div class=\"tv-master-buffer\"><strong>CPU → DMA → CPU</strong><span>one explicit hand-off at each boundary</span></div><div class=\"tv-caption\">A pointer identifies storage; ownership says who is allowed to use it now.</div></div>"
    }
  },
  "cachecoherency": {
    "approach": "For DMA, caches and memory visibility, separate three questions: where the latest bytes physically are, what the CPU cache contains, and what synchronization makes the consumer see the intended version.",
    "visual": {
      "title": "CPU cache vs DMA memory",
      "html": "<div class=\"tv-barrier\"><div><span>CPU cache</span><i>↕ clean / invalidate</i><span>RAM</span><i>↕</i><span>DMA</span></div><div class=\"tv-caption\">DMA can update RAM while the CPU still holds an older cache line. Coherency is a hardware/memory-system contract, not a volatile qualifier.</div></div>"
    }
  },
  "statemachine": {
    "approach": "For table-driven state machines, list states, events, and transitions before writing code; a table makes missing transitions and unintended fall-through visible.",
    "visual": {
      "title": "State × event → next state",
      "html": "<div class=\"tv-state\"><div><b>state</b><b>event</b><b>next</b></div><div><span>IDLE</span><span>RX</span><strong>READY</strong></div><div><span>READY</span><span>TIMEOUT</span><strong>IDLE</strong></div><div><span>READY</span><span>START</span><strong>RUN</strong></div></div>"
    },
    "related": [
      {
        "id": "control",
        "why": "Dense state values let a switch become a jump table, and a table is what a state machine wants."
      },
      {
        "id": "funcptr",
        "why": "A const table of handlers is the state machine's dispatch."
      },
      {
        "id": "enums",
        "why": "The COUNT idiom keeps the transition table and the state enum in step."
      },
      {
        "id": "standards",
        "why": "_Static_assert ties the transition table's dimensions to the enum."
      },
      {
        "id": "superloop",
        "why": "Every module in a super loop is a state machine that does one step and returns."
      }
    ],
    "interview": [
      "iv-au7"
    ]
  },
  "errors": {
    "approach": "For error handling and coding standards, start with the failure contract: what can go wrong, who detects it, and what state is safe afterward. Then choose an error representation that preserves that information.",
    "related": [
      {
        "id": "automotive",
        "why": "MISRA and ISO 26262 formalise the discipline of checking every return."
      },
      {
        "id": "testing",
        "why": "An unchecked return is a test that cannot be written."
      },
      {
        "id": "faults",
        "why": "The reaction to an error is designed; a fault handler is the last resort."
      }
    ]
  },
  "bits": {
    "approach": "For bits, bytes, words and the width of a machine, start by fixing the width: ask how many bits the value, register, or operation actually has before reasoning about its numeric meaning.",
    "visual": {
      "title": "8-bit view",
      "html": "<div class=\"tv-bits\"><div class=\"tv-powers\"><span>7</span><span>6</span><span>5</span><span>4</span><span>3</span><span>2</span><span>1</span><span>0</span></div><div class=\"tv-cells\"><b>1</b><b>0</b><b>1</b><b>1</b><b>0</b><b>1</b><b>1</b><b>1</b></div><div class=\"tv-labels\"><span>128</span><span>64</span><span>32</span><span>16</span><span>8</span><span>4</span><span>2</span><span>1</span></div><div class=\"tv-caption\">One byte = 8 bits. Each position has a power-of-two weight.</div></div>"
    }
  },
  "binhex": {
    "approach": "For binary, hex and why firmware speaks hex, translate one example between binary, hex, and decimal, then use the bit positions to explain why the notation is useful.",
    "visual": {
      "title": "Hex maps directly to bits",
      "html": "<div class=\"tv-hex\"><div><strong>0xB7</strong></div><div class=\"tv-arrow\">↓</div><div class=\"tv-nibbles\"><span>1011</span><span>0111</span></div><div class=\"tv-caption\">One hex digit = one nibble = four bits.</div></div>"
    }
  },
  "unsigned": {
    "approach": "For unsigned integers, range and modular wraparound, start with the finite range and work modulo 2^N; test the boundary case rather than reasoning from an abstract overflow idea.",
    "related": [
      {
        "id": "twos",
        "why": "One adder, two readings of the same bits: modular wrap and signed wrap are the same hardware event."
      }
    ]
  },
  "twos": {
    "approach": "For two's complement, build the representation from a fixed width: write the positive magnitude, invert the bits, add one, and check the sign bit.",
    "visual": {
      "title": "Two's-complement derivation",
      "html": "<div class=\"tv-twos\"><div><span>+5</span><code>0000 0101</code></div><div><span>invert</span><code>1111 1010</code></div><div><span>add 1</span><code>1111 1011</code></div><div class=\"tv-result\"><span>interpret</span><strong>0xFB = −5</strong></div><div class=\"tv-caption\">The same 8-bit adder can perform signed and unsigned addition.</div></div>"
    },
    "related": [
      {
        "id": "unsigned",
        "why": "One adder, two readings of the same bits: modular wrap and signed wrap are the same hardware event."
      },
      {
        "id": "signext",
        "why": "Sign extension is two's complement applied to a wider register."
      }
    ]
  },
  "signext": {
    "approach": "For sign extension and truncation, separate the original field width from the destination width, then ask whether the source is signed before deciding which bit is replicated.",
    "visual": {
      "title": "Sign extension preserves the value",
      "html": "<div class=\"tv-signext\"><div><span>4-bit</span><code>1011</code><small>−5</small></div><div class=\"tv-arrow\">→</div><div><span>8-bit</span><code>1111 1011</code><small>−5</small></div><div class=\"tv-caption\">A signed widening conversion replicates the source sign bit.</div></div>"
    },
    "related": [
      {
        "id": "twos",
        "why": "Sign extension is two's complement applied to a wider register."
      },
      {
        "id": "promo",
        "why": "Integer promotion is sign extension the compiler inserts for you, silently."
      }
    ],
    "interview": [
      "iv-au2"
    ]
  },
  "bitops": {
    "approach": "For bitwise operators and the four register idioms, for each operation, identify the intended bit mask first; then check whether the operation changes only those bits and preserves the rest.",
    "visual": {
      "title": "Register bit-field edit",
      "html": "<div class=\"tv-bitops\"><div><span>old</span><code>1010 0011</code></div><div><span>mask</span><code>0000 1110</code></div><div><span>clear</span><code>1111 0001</code></div><div><span>new bits</span><code>0000 0101</code></div><div class=\"tv-caption\">Clear the field first, then OR the new field value into it.</div></div>"
    },
    "related": [
      {
        "id": "regs",
        "why": "Set, clear, toggle, test: these four idioms are the whole vocabulary of register code."
      },
      {
        "id": "bitfields",
        "why": "A bitfield is mask-and-shift code the compiler writes for you, with the same read-modify-write cost."
      }
    ]
  },
  "shifts": {
    "approach": "For shifts, and the three ways they are undefined, write down the operand type, width, and shift count before deciding what the expression means; signedness matters as much as the shift itself.",
    "visual": {
      "title": "Shift is a bit movement",
      "html": "<div class=\"tv-shift\"><div class=\"tv-shift-row\"><code>0000 0011</code><span>≪ 2</span><code>0000 1100</code></div><div class=\"tv-caption\">The count must be valid for the operand width; the operand type determines the right-shift rules.</div></div>"
    },
    "related": [
      {
        "id": "promo",
        "why": "The operand of a shift is promoted first, so a uint8_t is shifted as an int."
      },
      {
        "id": "ub",
        "why": "Three of the classic shift bugs are undefined behaviour, not just wrong answers."
      }
    ]
  },
  "fixedpt": {
    "approach": "For fixed-point arithmetic, treat the stored integer as a scaled value: identify the scale factor, range, and where multiplication or division changes that scale.",
    "visual": {
      "title": "Q15 scale",
      "html": "<div class=\"tv-scale\"><div class=\"tv-scale-main\"><strong>16384</strong><span>÷ 32768</span><strong>0.5</strong></div><div class=\"tv-scale-bar\"><i style=\"width:50%\"></i></div><div class=\"tv-caption\">The stored integer carries an implied binary point. Multiplication changes the scale, so the result must be rescaled.</div></div>"
    },
    "related": [
      {
        "id": "promo",
        "why": "A Q15 multiply is only correct if the intermediate is wider than int16_t, which the promotion rules decide."
      },
      {
        "id": "float",
        "why": "Two answers to fractional maths: carry the scale yourself, or pay for an FPU and its stacking cost."
      }
    ]
  },
  "float": {
    "approach": "For floating point and ieee-754, separate the mathematical value from its IEEE-754 representation, then reason about sign, exponent, mantissa, precision, and exceptional values.",
    "visual": {
      "title": "IEEE-754 single precision",
      "html": "<div class=\"tv-float\"><div class=\"tv-float-fields\"><span class=\"s\">sign<br><b>1</b></span><span class=\"e\">exponent<br><b>8</b></span><span class=\"m\">fraction<br><b>23</b></span></div><div class=\"tv-caption\">A float is a representation with finite precision; the spacing between representable values changes with magnitude.</div></div>"
    },
    "related": [
      {
        "id": "fixedpt",
        "why": "Two answers to fractional maths: carry the scale yourself, or pay for an FPU and its stacking cost."
      },
      {
        "id": "isr",
        "why": "A float touched in an ISR adds FPU register stacking to every interrupt entry."
      }
    ],
    "interview": [
      "iv-bm1"
    ]
  },
  "endian": {
    "approach": "For endianness, choose a multi-byte value and write its bytes in address order; endianness is about byte order in memory, not bit order inside a byte.",
    "visual": {
      "title": "Bytes in address order",
      "html": "<div class=\"tv-endian\"><div><span>address</span><b>0x2000</b><b>0x2001</b><b>0x2002</b><b>0x2003</b></div><div><span>little</span><code>78</code><code>56</code><code>34</code><code>12</code></div><div><span>big</span><code>12</code><code>34</code><code>56</code><code>78</code></div><div class=\"tv-caption\">Endianness orders bytes of a multi-byte value. It does not reorder the bits inside a byte.</div></div>"
    },
    "related": [
      {
        "id": "buses",
        "why": "Byte order only matters when bytes leave the chip, and buses are where they leave."
      },
      {
        "id": "unions",
        "why": "Punning through a union shows you the CPU's byte order, which is not the wire order."
      },
      {
        "id": "padding",
        "why": "Byte order and padding both leak into a wire format the moment a struct is written to a bus."
      },
      {
        "id": "buses",
        "why": "Every bus is a serialisation boundary with a defined byte order."
      }
    ]
  },
  "memarray": {
    "approach": "For memory as one flat addressed array, start with an address and an access width, then trace which bytes are touched; this makes arrays, pointers, and alignment concrete.",
    "visual": {
      "title": "Memory is addressed bytes",
      "html": "<div class=\"tv-memarray\"><div><span>address</span><b>0x2000</b><b>0x2001</b><b>0x2002</b><b>0x2003</b></div><div><span>byte</span><code>2A</code><code>00</code><code>7F</code><code>10</code></div><div class=\"tv-caption\">An access width determines how many addressed bytes participate in an operation.</div></div>"
    },
    "related": [
      {
        "id": "pointers",
        "why": "A pointer is just an index into the flat byte array."
      },
      {
        "id": "mmio",
        "why": "Registers live in the same index space as variables, which is what memory-mapped means."
      }
    ]
  },
  "cpu": {
    "approach": "For what the cpu actually does: fetch, decode, execute, follow one instruction through fetch, decode, execute, and write-back; keep the architectural state separate from the C expression that produced it.",
    "related": [
      {
        "id": "funcs",
        "why": "Calling convention is the contract for who saves which registers around a branch-with-link."
      },
      {
        "id": "vectors",
        "why": "On exception entry the hardware saves the same registers a function call would."
      }
    ]
  },
  "mmio": {
    "approach": "For memory-mapped i/o: registers that are not memory, treat the register as a hardware interface rather than ordinary storage: ask who can change it, which bits are writable, and what an access does.",
    "related": [
      {
        "id": "memarray",
        "why": "Registers live in the same index space as variables, which is what memory-mapped means."
      },
      {
        "id": "volatilek",
        "why": "volatile exists because an address can have side effects the compiler cannot see."
      },
      {
        "id": "barriers",
        "why": "A store to a peripheral can retire before it reaches the peripheral; a barrier closes the gap."
      }
    ]
  },
  "harvard": {
    "approach": "For flash, ram, and where a program actually lives, separate where instructions are fetched from where data is read and written, then connect that split to Flash, RAM, and the bus architecture.",
    "related": [
      {
        "id": "sections",
        "why": "Flash-versus-RAM is the whole reason there are four sections."
      },
      {
        "id": "clocks",
        "why": "Flash is slower than the core above a certain clock, so wait states must be raised before the clock."
      },
      {
        "id": "constk",
        "why": "const is how you say 'this belongs in flash' to the toolchain."
      }
    ]
  },
  "gpiohw": {
    "approach": "For GPIO, separate the software register view from the electrical pin. First identify mode, mux, pull and drive settings; then ask what voltage the external circuit will actually see.",
    "visual": {
      "title": "GPIO: software request vs electrical result",
      "html": "<div class=\"tv-gpio\"><div class=\"tv-gpio-sw\"><b>C / registers</b><span>mode = output</span><span>mux = GPIO</span><span>pull = none</span><span>BSRR = set</span></div><div class=\"tv-gpio-arrow\">→</div><div class=\"tv-gpio-pin\"><b>pin</b><strong>HIGH?</strong><span>push-pull / open-drain</span><span>voltage domain</span><span>external load / contention</span></div><div class=\"tv-caption\">A correct register write is only the software half of the problem. The pin&apos;s electrical configuration determines the physical signal.</div></div>"
    }
  },
  "clockreset": {
    "approach": "For clocks and reset, draw the clock path from source to peripheral and mark every divider, gate and reset boundary before calculating a peripheral timing value.",
    "visual": {
      "title": "Clock tree and reset dependencies",
      "html": "<div class=\"tv-clocktree\"><div><span>oscillator / PLL</span><i>→</i><span>SYSCLK</span><i>→</i><span>bus divider</span><i>→</i><span>peripheral clock</span></div><div class=\"tv-clock-gates\"><b>clock gate</b><b>reset release</b><b>peripheral config</b></div><div class=\"tv-caption\">The peripheral&apos;s timing depends on the clock path that feeds it. Reset and clock gating are hardware state, not C-language properties.</div></div>"
    }
  },
  "busmasters": {
    "approach": "For DMA and other bus masters, draw ownership of the buffer before looking at code. Ask who can read or write it at each point and when ownership returns to the CPU.",
    "visual": {
      "title": "Multiple agents can own RAM",
      "html": "<div class=\"tv-masters\"><div class=\"tv-master-row\"><b>CPU</b><span>reads / writes</span></div><div class=\"tv-master-row\"><b>DMA</b><span>reads / writes</span></div><div class=\"tv-master-row\"><b>peripheral</b><span>produces / consumes data</span></div><div class=\"tv-master-buffer\"><strong>shared buffer</strong><span>CPU-owned → hardware-owned → CPU-owned</span></div><div class=\"tv-caption\">Starting a DMA transfer is not the end of the operation. Ownership and lifetime continue until hardware reports completion.</div></div>"
    }
  },
  "uart": {
    "visual": {
      "title": "UART frame and receive path",
      "html": "<div class=\"tv-proto\"><div class=\"tv-uart-frame\"><span>idle</span><b>START</b><b>D0</b><b>D1</b><b>D2</b><b>D3</b><b>D4</b><b>D5</b><b>D6</b><b>D7</b><em>PARITY?</em><b>STOP</b></div><div class=\"tv-proto-flow\"><span>RX pin</span><i>→</i><span>UART peripheral</span><i>→</i><span>ISR / DMA</span><i>→</i><strong>ring buffer</strong><i>→</i><span>parser</span></div><div class=\"tv-caption\">Framing belongs to UART; message boundaries, checksums and application meaning belong to the protocol above it.</div></div>"
    },
    "related": [
      {
        "id": "buses",
        "why": "UART is a stream with framing; the driver therefore cares about buffering and message boundaries."
      },
      {
        "id": "ringbuf",
        "why": "UART receive is an asynchronous byte stream, so buffering is part of the driver design."
      }
    ]
  },
  "spi": {
    "visual": {
      "title": "SPI transaction",
      "html": "<div class=\"tv-proto\"><div class=\"tv-spi-lines\"><span>CS</span><code>────────┐__________________┌────</code></div><div class=\"tv-spi-lines\"><span>SCLK</span><code>────────┐_┌_┌_┌_┌_┌_┌_┌_┌────────</code></div><div class=\"tv-spi-lines\"><span>MOSI</span><code>──────── CMD → ADDRESS → DATA ─────</code></div><div class=\"tv-spi-lines\"><span>MISO</span><code>──────── STATUS → DUMMY → RESPONSE ─</code></div><div class=\"tv-caption\">CS defines the transaction boundary; CPOL/CPHA define when data changes and when it is sampled.</div></div>"
    },
    "related": [
      {
        "id": "buses",
        "why": "SPI is a controller-driven transaction; chip-select and clock phase become part of the device contract."
      },
      {
        "id": "iomodes",
        "why": "SPI transactions map naturally to polling, interrupt or DMA depending on transfer size and timing."
      }
    ]
  },
  "i2c": {
    "visual": {
      "title": "I2C shared bus",
      "html": "<div class=\"tv-proto\"><div class=\"tv-i2c-bus\"><span>VDD</span><b>pull-up</b><strong>SDA</strong><em>shared</em><strong>SCL</strong><b>pull-up</b></div><div class=\"tv-proto-flow\"><span>START</span><i>→</i><span>address + R/W</span><i>→</i><span>ACK</span><i>→</i><span>register</span><i>→</i><span>data</span><i>→</i><span>STOP</span></div><div class=\"tv-caption\">HIGH means the line is released and pulled up; LOW means a participant actively pulls it down.</div></div>"
    },
    "related": [
      {
        "id": "buses",
        "why": "I2C adds addressing, ACK/NACK, open-drain signalling and bus recovery to the transfer model."
      },
      {
        "id": "regs",
        "why": "I2C driver correctness depends on both peripheral register semantics and the external bus electrical contract."
      }
    ]
  },
  "can": {
    "visual": {
      "title": "CAN arbitration",
      "html": "<div class=\"tv-proto\"><div class=\"tv-can-arb\"><div><span>Node A</span><code>1 0 0 1</code></div><div><span>Node B</span><code>1 0 1 0</code></div><div class=\"tv-can-conflict\"><span>bit 3</span><strong>A sends dominant 0</strong><strong>B sends recessive 1</strong><em>B observes 0 → loses</em></div></div><div class=\"tv-proto-flow\"><span>SOF</span><i>→</i><span>arbitration</span><i>→</i><span>control/data</span><i>→</i><span>CRC/ACK</span><i>→</i><span>EOF</span></div><div class=\"tv-caption\">The losing node stops without corrupting the winning frame. Arbitration is based on bus state, not on a separate collision-detection phase.</div></div>"
    },
    "related": [
      {
        "id": "buses",
        "why": "CAN adds arbitration, message identifiers and controller fault states to the transport model."
      },
      {
        "id": "faults",
        "why": "CAN controller error states and bus-off recovery become part of system fault handling."
      }
    ]
  },
  "faultcase-mpu-ownership": {
    "approach": "For this case, start with the fault address and stacked instruction context, map the address to the protected region, then reconstruct the ownership rule that the access violated.",
    "related": []
  },
  "lowpower-design": {
    "approach": "For low-power design, draw the active, sleep and wake states first; then mark which clocks, RAM, peripherals and wake sources survive each transition and measure the real residency.",
    "related": [
      {
        "id": "lmavma",
        "why": "A retained-RAM variable is exactly a section the copy and clear loops must skip."
      },
      {
        "id": "clocks",
        "why": "Stop-mode exit reverts the clock, so clock setup must run again."
      },
      {
        "id": "startup",
        "why": "Standby wakes through a full reset: startup runs again."
      }
    ]
  },
  "bootloader-architecture": {
    "approach": "For bootloader architecture, draw the memory slots and reset hand-off first; then trace validation, activation, rollback and interrupted-update paths as a state machine.",
    "related": [
      {
        "id": "ldscript",
        "why": "Each firmware image needs its own linker script, origin and vector table base."
      },
      {
        "id": "startup",
        "why": "A bootloader repeats the reset sequence by hand for the application image."
      },
      {
        "id": "funcptr",
        "why": "A bootloader jump is a function pointer call, and the Thumb bit must survive it."
      },
      {
        "id": "barriers",
        "why": "VTOR writes need DSB and ISB before the first interrupt can use them."
      },
      {
        "id": "faults",
        "why": "A bootloader must survive and recover from a bad application image."
      }
    ]
  }
};


/* Metadata for the incremental advanced topics. Kept here so the canonical
   registry remains the single place that attaches study approach, visuals and
   conceptual links. */
Object.assign(TOPIC_META, {
  "inlineasm": {
    "approach": "Read inline asm as a three-party contract: the instruction template, the operand constraints, and the compiler's freedom around the statement. Separate compiler ordering from CPU ordering.",
    "visual": {"title":"C compiler ↔ inline asm contract","html":"<div class=\"tv-flow\"><span>C expression</span><i>→</i><span>constraints</span><i>→</i><strong>register / memory operands</strong><i>→</i><span>instruction</span></div><p class=\"tv-caption\">The compiler must understand every input, output and side effect you expose; the CPU then executes the emitted instruction stream.</p>"},
    "related":[{"id":"compiler","why":"Inline asm is still embedded in the compiler's transformation pipeline."},{"id":"barriers","why":"Compiler constraints and CPU barriers solve different ordering problems."},{"id":"volatilek","why":"volatile memory accesses and asm constraints are separate contracts."}]
  },
  "ldrexstrex": {
    "approach": "Draw the reservation lifecycle before reading the instruction sequence: load-and-reserve → compute → conditional-store → retry on failure. Then ask which other agent can invalidate the reservation.",
    "visual": {"title":"Exclusive update","html":"<div class=\"tv-flow\"><span>LDREX</span><i>→</i><strong>reservation held</strong><i>→</i><span>compute</span><i>→</i><span>STREX</span><i>→</i><span>success / retry</span></div><p class=\"tv-caption\">The conditional store is the commit point. Failure is a normal outcome of contention, not automatically a fault.</p>"},
    "related":[{"id":"atomicity","why":"Exclusive instructions are one target-level implementation of atomic read-modify-write."},{"id":"isrshare","why":"Interrupts and other execution contexts can participate in the ownership/atomicity problem."},{"id":"barriers","why":"Atomicity and memory ordering are distinct properties that must both be satisfied."}]
  },
  "faultescalation": {
    "approach": "Start from the observed HardFault and walk backward: fault status → stacked context → fault address → enabled configurable fault → original instruction. Treat escalation as evidence about what happened, not as the root cause.",
    "visual": {"title":"Fault escalation path","html":"<div class=\"tv-flow\"><span>bad access / instruction</span><i>→</i><span>MemManage / BusFault / UsageFault</span><i>→</i><strong>HardFault</strong><i>→</i><span>handler / evidence</span></div><p class=\"tv-caption\">The final handler is not necessarily the first broken contract. Preserve the status registers and stacked context before recovery destroys them.</p>"},
    "related":[{"id":"faults","why":"The generic fault model supplies the exception and forensic context."},{"id":"vectors","why":"Exception entry depends on a valid vector table and handler addresses."},{"id":"stackframe","why":"The stacked exception frame is part of the evidence used to locate the failing instruction."}]
  },
  "mpuvariants": {
    "approach": "First draw the linker-produced address ranges. Then overlay MPU regions and permissions. Only after the address map is correct should you compare PMSAv7 and PMSAv8-M programming details.",
    "visual": {"title":"Linker map → MPU protection map","html":"<div class=\"tv-link\"><strong>Flash .text</strong><i>→</i><span>RX region</span><strong>RAM .data/.bss</strong><i>→</i><span>RW region</span><strong>stack guard</strong><i>→</i><span>no-access region</span></div><p class=\"tv-caption\">The MPU does not move objects. It applies hardware access rules to the final runtime addresses selected by the linker.</p>"},
    "related":[{"id":"ldscript","why":"The linker determines the final addresses that the MPU must protect."},{"id":"memarray","why":"The MPU policy is about access to concrete memory ranges."},{"id":"faultescalation","why":"A violated MPU permission becomes fault evidence that must be diagnosed."}]
  }
});

var TOPICS = [];
var TOPIC_BY_ID = {};
(function buildTopicRegistry() {
  STAGES.forEach(function (stage) {
    stage.topics.forEach(function (t) {
      var m = TOPIC_META[t.id] || {};
      t.stageId = stage.id;
      t.stageNo = stage.n;
      t.stageTitle = stage.title;
      t.approach = m.approach || "";
      t.visual = m.visual || null;
      t.related = (m.related || []).map(function (r) { return { id: r.id, why: r.why || "" }; });
      t.interview = (m.interview || []).slice();
      if (TOPIC_BY_ID[t.id]) { throw new Error("Duplicate topic id: " + t.id); }
      TOPICS.push(t);
      TOPIC_BY_ID[t.id] = t;
    });
  });
  Object.keys(TOPIC_META).forEach(function (id) {
    if (!TOPIC_BY_ID[id]) { throw new Error("Topic metadata has no matching topic: " + id); }
  });
  TOPICS.forEach(function (t) {
    (t.prereq || []).forEach(function (id) {
      if (!TOPIC_BY_ID[id]) { throw new Error("Missing prerequisite " + id + " referenced by " + t.id); }
    });
    (t.related || []).forEach(function (r) {
      if (!TOPIC_BY_ID[r.id]) { throw new Error("Missing related topic " + r.id + " referenced by " + t.id); }
    });
  });
  window.__EmbeddedCTopicSchema = { version: 1, topics: TOPICS, byId: TOPIC_BY_ID };
})();
</script>
