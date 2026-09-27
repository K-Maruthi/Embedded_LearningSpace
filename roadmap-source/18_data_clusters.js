
<script>
/* Cross-cutting "same failure pattern" links between topics. Independent of
   the prereq DAG -- these are topics that, in practice, turn out to be the
   same bug wearing a different costume. A topic can belong to more than one
   cluster. */
var CLUSTERS = [
  { id: "shared-state", label: "two contexts touch shared state, unprotected",
    color: "var(--warn)",
    blurb: "The same root cause -- something is read, changed and written back without anyone stopping the other side from doing it at the same time -- appears at every level from a bare counter to a whole RTOS.",
    topics: ["atomicity", "regatomic", "isrshare", "ringbuf", "critical", "priority", "rtos"] },

  { id: "optimizer-assumed", label: "the optimizer assumed you didn't do that",
    color: "var(--violet)",
    blurb: "Undefined behaviour, aliasing and volatile are one conversation: the compiler is allowed to assume your code never does the thing it just did, and it optimises on that assumption.",
    topics: ["ub", "aliasing", "optim", "volatile2", "restrict", "align2", "barriers"] },

  { id: "wrong-address", label: "right bits, wrong address",
    color: "var(--steel)",
    blurb: "Endianness, memory-mapped I/O, register overlays and bus protocols are all the same question: whose byte order, whose address space, and who agreed on it.",
    topics: ["endian", "mmio", "cmsis", "regs", "buses", "uart", "spi", "i2c", "can", "faults"] },

  { id: "boot-and-recover", label: "what runs before you, and what happens when it doesn't",
    color: "var(--ok)",
    blurb: "Startup code, the vector table, clock bring-up and a bootloader handover are all instances of 'something must be true before your code can assume it is' -- and faults are what you get when it wasn't.",
    topics: ["startup", "lmavma", "vectors", "clocks", "bootloader", "faults"] },

  { id: "memory-costs-money", label: "every byte someone chose",
    color: "var(--accent)",
    blurb: "const, section placement, the heap and static allocation all resolve to the same design question: who decided this costs flash, who decided this costs RAM, and could the linker have told you sooner.",
    topics: ["sections", "padding", "heap", "allocstrat", "mapfile", "harvard"] }
];
</script>
