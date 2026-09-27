
<script>
/* Every "state" here is pre-authored and verified against real Cortex-M /
   AAPCS toolchain behaviour -- nothing on this page is compiled live. That is
   the point: it is allowed to be 100% right because nothing runs. */
var DIFFS = [

{ id: "const-diff", title: "const on a lookup table", topic: "constk",
  toggleLabel: ["without const", "with const"],
  code: [
"uint16_t sine[256] = {\n    0, 25, 50, 75, /* ... */\n};",
"const uint16_t sine[256] = {\n    0, 25, 50, 75, /* ... */\n};" ],
  result: [
"Section: .data\nFlash cost: 512 bytes (the initialiser)\nRAM cost:   512 bytes (the live, writable copy)\nStartup:    copied from flash to RAM by init_data() before main()",
"Section: .rodata\nFlash cost: 512 bytes\nRAM cost:   0 bytes -- never copied, read directly out of flash\nStartup:    nothing to do for this object" ],
  why: [
"Without const the compiler cannot prove the table is never written, so it must give it a writable home in RAM and arrange for the initial values to survive a power cycle -- which means storing them again in flash and copying them at boot.",
"const tells the compiler this object is never written through this declaration, so the whole object can live in flash and be read in place. Nothing is copied, nothing costs RAM."]
},

{ id: "volatile-diff", title: "volatile on a polled status flag", topic: "volatilek",
  toggleLabel: ["without volatile", "with volatile"],
  code: [
"bool rx_ready;\n\nvoid wait_rx(void) {\n    while (!rx_ready) { }\n    rx_ready = false;\n}",
"volatile bool rx_ready;\n\nvoid wait_rx(void) {\n    while (!rx_ready) { }\n    rx_ready = false;\n}" ],
  result: [
"LDR  r0, [rx_ready]\nCBNZ r0, done\nloop: B loop        ; rx_ready read ONCE, then an unconditional spin\ndone:",
"loop: LDR  r0, [rx_ready]\n      CBZ  r0, loop    ; re-read on every iteration, exactly as written" ],
  why: [
"Nothing in this translation unit writes rx_ready, so the compiler is entitled to load it once, decide the loop condition can never change, and turn the wait into an infinite loop if it started false -- a real hang, not a slow one.",
"volatile forces a fresh load on every iteration because the object may change for reasons the compiler can't see -- an ISR, in this case. This is the one line that makes the wait actually wait."]
},

{ id: "optlevel-diff", title: "a hand-rolled delay loop at -O0 vs -O2", topic: "optim",
  toggleLabel: ["-O0", "-O2"],
  code: [
"for (uint32_t i = 0; i < 100000u; i++) { }",
"for (uint32_t i = 0; i < 100000u; i++) { }" ],
  result: [
"loop: SUBS r0, r0, #1\n      BNE  loop        ; the empty loop body is compiled as written",
"; (nothing -- the loop has no observable effect, so it is deleted entirely)\n; execution falls straight through to whatever comes next" ],
  why: [
"At -O0 the compiler makes almost no attempt to reason about what the code does; it just translates each statement, so the loop survives even though it is pointless.",
"At -O2 the optimiser proves the loop has no effect on anything observable (i is never read afterwards, nothing volatile is touched) and removes it completely. A delay 'loop' like this is not a delay at any real optimisation level -- use a hardware timer instead."]
},

{ id: "padding-diff", title: "struct member order", topic: "padding",
  toggleLabel: ["bad order", "good order"],
  code: [
"struct msg {\n    uint8_t  type;\n    uint32_t id;\n    uint8_t  flags;\n};",
"struct msg {\n    uint32_t id;\n    uint8_t  type;\n    uint8_t  flags;\n};" ],
  result: [
"offset 0: type   (1 byte)\noffset 1: [3 bytes padding]\noffset 4: id     (4 bytes)\noffset 8: flags  (1 byte)\noffset 9: [3 bytes padding]\nsizeof(struct msg) = 12",
"offset 0: id     (4 bytes)\noffset 4: type   (1 byte)\noffset 5: flags  (1 byte)\noffset 6: [2 bytes padding]\nsizeof(struct msg) = 8" ],
  why: [
"uint32_t needs 4-byte alignment, so the compiler inserts 3 bytes of padding before it, then pads the whole struct out to a multiple of its own alignment at the end.",
"Widest member first means nothing after it needs padding to reach its own alignment -- only the trailing pad to round the struct size up remains. Same members, same meaning, 4 fewer bytes per instance -- multiply that by every message in a queue." ]
},

{ id: "aliasing-diff", title: "reinterpreting a float's bits", topic: "aliasing",
  toggleLabel: ["pointer cast", "memcpy"],
  code: [
"float f = compute();\nuint32_t bits = *(uint32_t *)&f;\nlog(bits);\nf = 0.0f;\nlog(bits);   // still the OLD bits? or 0?",
"float f = compute();\nuint32_t bits;\nmemcpy(&bits, &f, sizeof bits);\nlog(bits);\nf = 0.0f;\nlog(bits);   // definitely the OLD bits" ],
  result: [
"Undefined at -O2: the compiler may assume *(uint32_t*)&f and f never alias, so the second log(bits) can print a stale cached value, the freshly recomputed one, or anything else -- and it can differ from -O0 to -O2 with no warning.",
"Always the old bits, on every compiler and every optimisation level. memcpy is a well-defined way to reinterpret bytes and the compiler recognises the pattern and compiles it down to the same single instruction as the cast -- for free." ],
  why: [
"The strict-aliasing rule lets the compiler assume a uint32_t* and a float* never point at the same storage, so it's free to keep bits in a register across the write to f -- which happens exactly when this code looks like it should be safe.",
"memcpy has no aliasing assumption to violate, so there is nothing for the optimiser to exploit, and no version-dependent surprise." ]
},

{ id: "w1c-diff", title: "clearing a write-1-to-clear status flag", topic: "regs",
  toggleLabel: ["|= (wrong)", "explicit mask (right)"],
  code: [
"// SR is write-1-to-clear: writing 1 to a bit clears it, 0 leaves it alone\nSR |= UIF;",
"SR = UIF;   // or the ICR-style dedicated clear register, if one exists" ],
  result: [
"Reads SR (bringing in every OTHER currently-set flag), ORs in UIF, writes the whole register back -- which writes 1 to every flag that happened to be set, clearing all of them, not just UIF.",
"Writes exactly one bit as 1 and every other bit as 0. Bits written 0 on a W1C register are simply left alone -- only UIF clears." ],
  why: [
"|= is the right idiom for a normal read-write field and the wrong idiom for W1C, because the read half of read-modify-write captures flags you have no intention of touching.",
"A write-1-to-clear register does not need to be read first -- the whole point of the semantics is that you can clear exactly what you name in one store." ]
},

{ id: "atomic-diff", title: "publishing a value across an ISR boundary", topic: "atomicity",
  toggleLabel: ["counter++ (racy)", "single-word publish"],
  code: [
"volatile uint32_t events;\n// ISR: events++;\n// main: uint32_t n = events;",
"volatile uint32_t latest;\n// ISR: latest = new_sample;   // single aligned 32-bit store\n// main: uint32_t n = latest;  // single aligned 32-bit load" ],
  result: [
"events++ is LDR, ADD, STR. If the ISR fires between the LDR and the STR of another increment happening elsewhere, one increment is silently lost -- no warning, no crash, just a wrong count that drifts over hours of runtime.",
"A single aligned 32-bit load or store is atomic on this core by construction. There is no read-modify-write step for an interrupt to land inside, so there is nothing to lose." ],
  why: [
"volatile stops the compiler from caching events in a register, which is necessary but not sufficient -- it says nothing about the three separate bus transactions still happening underneath.",
"The fix is not more volatile, it's a different shape of communication: hand over a whole value in one atomic write instead of mutating one in place." ]
}

];
</script>
