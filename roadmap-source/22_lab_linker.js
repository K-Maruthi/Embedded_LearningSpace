  /* ---------------- Linker & Startup Lab ---------------- */
  var linkLabInited = false;
  var LINK_STAGES = ["mcu","files","script","memory","startup","build","check","sandbox","readasm"];
  var LINK_DATA = {
    mcu: {
      title: "Start with the MCU, not the linker script",
      intro: "A linker script only makes sense after we know the physical address ranges the firmware must fit into.",
      body: `<div class="linklab-grid"><div class="linklab-card"><h4>Teaching MCU: Cortex-M4, 1 MB Flash, 128 KB SRAM</h4><table class="linklab-table"><tr><th>Region</th><th>Start</th><th>Length</th><th>Purpose</th></tr><tr><td>FLASH</td><td>0x08000000</td><td>0x00100000</td><td>code, constants, vector table, initial data image</td></tr><tr><td>RAM</td><td>0x20000000</td><td>0x00020000</td><td>runtime data, BSS, stack, heap</td></tr></table><div class="linklab-note"><strong>First lesson:</strong> the linker cannot invent memory. It is told where memory exists and then decides how the program fits inside those regions.</div></div><div class="linklab-card"><h4>What the CPU expects after reset</h4><ul><li>A vector table at the beginning of the firmware image.</li><li>A reset handler address in that table.</li><li>RAM must contain usable runtime state before <code>main()</code>.</li><li>Initialized writable data starts in Flash but runs from RAM.</li><li>Zero-initialized data needs RAM space but no Flash payload.</li></ul></div></div>`
    },
    files: {
      title: "Files and build artifacts in this example",
      intro: "Keep the roles separate: source files describe the firmware, the linker script describes memory placement, and the build produces the object files and final firmware artifacts.",
      body: `<div class="linklab-grid"><div class="linklab-card"><h4>Source inputs</h4><div class="linklab-filelist"><div><code>main.c</code><span>Application code: functions, globals and other C objects used by the firmware.</span></div><div><code>startup.s</code><span>Startup assembly: the vector table and reset handler that run before <code>main()</code>.</span></div><div><code>linker.ld</code><span>Linker script: the MCU memory regions and the rules that place sections into them.</span></div></div></div><div class="linklab-card"><h4>Build outputs</h4><div class="linklab-filelist"><div><code>main.o</code><span>Relocatable object produced by compiling <code>main.c</code>; addresses are not final yet.</span></div><div><code>startup.o</code><span>Relocatable object produced by assembling <code>startup.s</code>; it contains the startup code and vector-table data.</span></div><div><code>firmware.elf</code><span>Linked firmware image containing final addresses, sections and symbols.</span></div><div><code>firmware.map</code><span>Human-readable linker report showing how sections and symbols were laid out.</span></div><div><code>firmware.bin</code><span>Raw loadable bytes extracted from the linked image for programming Flash.</span></div></div></div></div><div class="linklab-card"><h4>How the pieces fit</h4><div class="linklab-flow"><div class="linklab-node"><b>main.c</b><span>compile → main.o</span></div><div class="linklab-node"><b>startup.s</b><span>assemble → startup.o</span></div><div class="linklab-node"><b>linker.ld</b><span>placement rules</span></div><div class="linklab-node"><b>link</b><span>→ firmware.elf + firmware.map</span></div><div class="linklab-node"><b>objcopy</b><span>→ firmware.bin</span></div></div></div><div class="linklab-note"><strong>Important:</strong> the linker script is an input to the link step. <code>firmware.elf</code>, <code>firmware.map</code> and <code>firmware.bin</code> are build products, not files you write by hand. The compiler, assembler, linker and image-conversion tools perform the transformations.</div>`
    },
    script: {
      title: "Write the linker script one decision at a time",
      intro: "Do not memorize linker syntax first. Select a rule, derive the requirement it answers, then trace the effect into memory and startup.",
      body: `<div class="linklab-scriptgrid"><div class="linklab-card"><h4>linker.ld — fixed teaching script</h4><pre class="linklab-code linklab-scriptcode"><button type="button" class="linklab-code-row" data-rule="memory">MEMORY</button>
{
  <button type="button" class="linklab-code-row" data-rule="flash">  FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 1M</button>
  <button type="button" class="linklab-code-row" data-rule="ram">  RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = 128K</button>
}

<button type="button" class="linklab-code-row" data-rule="estack">_estack = ORIGIN(RAM) + LENGTH(RAM);</button>

<button type="button" class="linklab-code-row" data-rule="sidata">_sidata = LOADADDR(.data);</button>

<button type="button" class="linklab-code-row" data-rule="sections">SECTIONS</button>
{
  <button type="button" class="linklab-code-row" data-rule="vector">  .isr_vector :</button>
  {
    <button type="button" class="linklab-code-row" data-rule="keep">    KEEP(*(.isr_vector))</button>
  <button type="button" class="linklab-code-row" data-rule="place-flash-vector">  } &gt; FLASH</button>

  <button type="button" class="linklab-code-row" data-rule="text">  .text :</button>
  {
    <button type="button" class="linklab-code-row" data-rule="input-text">    *(.text*)</button>
    <button type="button" class="linklab-code-row" data-rule="input-rodata">    *(.rodata*)</button>
  <button type="button" class="linklab-code-row" data-rule="place-flash-text">  } &gt; FLASH</button>

  <button type="button" class="linklab-code-row" data-rule="data">  .data :</button>
  {
    <button type="button" class="linklab-code-row" data-rule="symbols-data">    _sdata = .;</button>
    <button type="button" class="linklab-code-row" data-rule="input-data">    *(.data*)</button>
    <button type="button" class="linklab-code-row" data-rule="symbols-data">    _edata = .;</button>
  <button type="button" class="linklab-code-row" data-rule="place-data">  } &gt; RAM AT &gt; FLASH</button>

  <button type="button" class="linklab-code-row" data-rule="bss">  .bss (NOLOAD) :</button>
  {
    <button type="button" class="linklab-code-row" data-rule="symbols-bss">    _sbss = .;</button>
    <button type="button" class="linklab-code-row" data-rule="input-bss">    *(.bss*)</button>
    <button type="button" class="linklab-code-row" data-rule="input-common">    *(COMMON)</button>
    <button type="button" class="linklab-code-row" data-rule="symbols-bss">    _ebss = .;</button>
  <button type="button" class="linklab-code-row" data-rule="place-ram-bss">  } &gt; RAM</button>
}</pre></div><div class="linklab-card"><h4 id="linklab-rule-title">Select a rule</h4><p id="linklab-rule-meaning">Click a highlighted script row. The right side will answer four questions: what it means, where it places bytes, what runtime action it enables, and what breaks if the rule is wrong.</p><div id="linklab-rule-detail" class="linklab-rule-detail"><div><b>Syntax</b><span id="linklab-rule-syntax">—</span></div><div><b>Meaning</b><span id="linklab-rule-plain">—</span></div><div><b>Memory effect</b><span id="linklab-rule-memory">—</span></div><div><b>Runtime effect</b><span id="linklab-rule-runtime">—</span></div><div><b>If wrong</b><span id="linklab-rule-break">—</span></div></div></div></div><div class="linklab-card linklab-write"><h4>Write the core placement yourself</h4><p>Build the minimal policy for this MCU in the right order. Choose the next piece; the lab advances only when the choice is correct.</p><div class="linklab-write-sequence" id="linklab-script-sequence"><div class="linklab-write-slot"><b>1</b><span>Start with the memory map</span><strong id="linklab-script-slot-1">MEMORY { ... }</strong></div><div class="linklab-write-slot"><b>2</b><span>Define the initial stack boundary</span><strong id="linklab-script-slot-2">—</strong></div><div class="linklab-write-slot"><b>3</b><span>Place the vector table</span><strong id="linklab-script-slot-3">—</strong></div><div class="linklab-write-slot"><b>4</b><span>Place code and constants</span><strong id="linklab-script-slot-4">—</strong></div><div class="linklab-write-slot"><b>5</b><span>Place initialized writable data</span><strong id="linklab-script-slot-5">—</strong></div><div class="linklab-write-slot"><b>6</b><span>Place zero-initialized data</span><strong id="linklab-script-slot-6">—</strong></div></div><div class="linklab-write-options" id="linklab-script-options"><button type="button" data-script-choice="estack">_estack = ORIGIN(RAM) + LENGTH(RAM)</button><button type="button" data-script-choice="vector">.isr_vector → FLASH</button><button type="button" data-script-choice="text">.text + .rodata → FLASH</button><button type="button" data-script-choice="data">.data → RAM AT → FLASH</button><button type="button" data-script-choice="bss">.bss (NOLOAD) → RAM</button></div><div class="linklab-answer" id="linklab-script-write-result" hidden></div></div><div class="linklab-card linklab-whatif"><h4>What if this rule changes?</h4><div class="linklab-whatif-grid"><button type="button" data-whatif="dataflash"><code>.data &gt; FLASH</code><span>Runtime VMA moves away from RAM.</span></button><button type="button" data-whatif="bssload"><code>.bss</code> without <code>NOLOAD</code><span>Load-image accounting changes.</span></button><button type="button" data-whatif="vectorkeep">Remove <code>KEEP</code><span>The vector table can be vulnerable to section GC.</span></button><button type="button" data-whatif="ramorigin">Wrong <code>RAM ORIGIN</code><span>Linker addresses no longer match the MCU.</span></button></div><div id="linklab-whatif-result" class="linklab-whatif-result">Select one change to see the causal consequence.</div></div><div class="linklab-card"><h4>Teaching memory budget</h4><p>These are deliberately small example sizes for reasoning, not measured output from a real build.</p><div class="linklab-budget"><div><b>FLASH image</b><span>Vector 256 B + text 20 KiB + rodata 4 KiB + .data image 1 KiB = <strong>25.25 KiB</strong> used of 1 MiB.</span></div><div><b>RAM runtime</b><span>.data 1 KiB + .bss 8 KiB + stack reserve 8 KiB + heap reserve 4 KiB = <strong>21 KiB</strong> used of 128 KiB.</span></div><div><b>Overflow rule</b><span>If the required layout exceeds a declared MEMORY region, the linker reports the fit problem before firmware runs.</span></div></div></div><div class="linklab-note"><strong>Trace every rule through the system:</strong> hardware requirement → linker placement → symbol/address → startup action. The script does not copy, clear, or execute anything by itself.</div>`
    },
    memory: {
      title: "From C object to final memory address",
      intro: "Take five ordinary C objects and trace each one through its section, linker rule, final location and startup behavior.",
      body: `<div class="linklab-grid"><div class="linklab-card"><h4>Example objects in main.c</h4><div class="linklab-object-list"><button type="button" data-object="counter"><code>uint32_t counter = 42;</code><span>initialized writable global</span></button><button type="button" data-object="buffer"><code>uint8_t buffer[256];</code><span>zero-initialized writable global</span></button><button type="button" data-object="limit"><code>const uint32_t limit = 100;</code><span>read-only constant</span></button><button type="button" data-object="control"><code>void control(void) { ... }</code><span>function</span></button><button type="button" data-object="local"><code>uint32_t sample = 7;</code><span>automatic local inside a function</span></button></div></div><div class="linklab-card"><h4 id="linklab-object-title">Select an object</h4><div class="linklab-object-detail"><div><b>C object</b><span id="linklab-object-c">—</span></div><div><b>Input section</b><span id="linklab-object-section">—</span></div><div><b>Output section</b><span id="linklab-object-output">—</span></div><div><b>Runtime location</b><span id="linklab-object-location">—</span></div><div><b>Startup action</b><span id="linklab-object-startup">—</span></div></div></div></div><div class="linklab-memory"><div class="linklab-region"><h4>FLASH · 0x08000000 · non-volatile image</h4><div class="linklab-seg"><strong>.isr_vector</strong><span>reset + interrupt entry information</span></div><div class="linklab-seg"><strong>.text / .rodata</strong><span>instructions + read-only constants</span></div><div class="linklab-seg"><strong>.data load image</strong><span>initial bytes for writable globals</span></div></div><div class="linklab-region"><h4>RAM · 0x20000000 · runtime state</h4><div class="linklab-seg"><strong>.data</strong><span>writable initialized objects after startup copy</span></div><div class="linklab-seg"><strong>.bss</strong><span>writable zero-initialized objects</span></div><div class="linklab-seg"><strong>stack</strong><span>automatic locals and call frames</span></div></div></div><div class="linklab-flow"><div class="linklab-node"><b>counter = 42</b><span>Flash initial bytes<br>LMA</span></div><div class="linklab-arrow">→ copy →</div><div class="linklab-node"><b>counter</b><span>RAM live object<br>.data VMA</span></div><div class="linklab-arrow">+</div><div class="linklab-node"><b>buffer[256]</b><span>RAM zero state<br>.bss VMA</span></div></div><div class="linklab-budget"><div><b>Flash budget</b><span>Vector table + .text/.rodata + the initialized .data load image.</span></div><div><b>RAM budget</b><span>.data + .bss + stack + any reserved heap must fit inside the 128 KB RAM region.</span></div><div><b>Build-time check</b><span>If the linked layout exceeds a MEMORY region, the linker reports an overflow before firmware runs.</span></div></div><div class="linklab-budget"><div><b>VMA</b><span>Where the object is addressed while the firmware runs.</span></div><div><b>LMA</b><span>Where the initialized bytes are stored in the load image.</span></div><div><b>Startup bridge</b><span>For .data, startup copies LMA → VMA before main().</span></div></div><div class="linklab-card linklab-symbolcard"><h4>Linker symbols used by startup</h4><div class="linklab-symbolgrid"><div><code>_estack</code><span>top of RAM → initial stack pointer</span></div><div><code>_sidata</code><span>Flash LMA of .data → copy source</span></div><div><code>_sdata</code><span>RAM VMA start of .data → copy destination</span></div><div><code>_edata</code><span>RAM VMA end of .data → copy limit</span></div><div><code>_sbss</code><span>RAM start of .bss → zeroing start</span></div><div><code>_ebss</code><span>RAM end of .bss → zeroing limit</span></div></div></div>`
    },
    startup: {
      title: "Walk reset from the vector table to main()",
      intro: "The linker created addresses and boundaries. Startup code turns those values into actions before the first C statement runs.",
      body: `<div class="linklab-startupstepper">
        <div class="linklab-resetrail">
          <button type="button" class="linklab-resetstep selected" data-reset-step="0"><b>1</b><span>Reset</span></button>
          <i>→</i><button type="button" class="linklab-resetstep" data-reset-step="1"><b>2</b><span>Vector</span></button>
          <i>→</i><button type="button" class="linklab-resetstep" data-reset-step="2"><b>3</b><span>.data</span></button>
          <i>→</i><button type="button" class="linklab-resetstep" data-reset-step="3"><b>4</b><span>.bss</span></button>
          <i>→</i><button type="button" class="linklab-resetstep" data-reset-step="4"><b>5</b><span>main()</span></button>
        </div>
        <div class="linklab-grid">
          <div class="linklab-card">
            <h4 id="linklab-reset-title">Reset: the CPU needs two values immediately</h4>
            <p id="linklab-reset-text">On reset, the Cortex-M startup sequence obtains the initial stack pointer and the reset-handler address from the vector table. The linker placed that table in Flash and the startup object supplied its contents.</p>
            <div class="linklab-startup-facts" id="linklab-reset-facts"><div><b>Initial SP</b><code>_estack</code><span>0x20020000 in this model</span></div><div><b>Entry point</b><code>Reset_Handler</code><span>startup.s</span></div></div>
          </div>
          <div class="linklab-card">
            <h4>What the linker supplied</h4>
            <div class="linklab-symbol"><code>_estack</code><span>initial stack boundary</span></div>
            <div class="linklab-symbol"><code>_sidata</code><span>Flash source of initialized .data</span></div>
            <div class="linklab-symbol"><code>_sdata → _edata</code><span>RAM destination range</span></div>
            <div class="linklab-symbol"><code>_sbss → _ebss</code><span>RAM range to clear</span></div>
          </div>
        </div>
        <div class="linklab-memorytrace" id="linklab-memorytrace">
          <div><b>FLASH</b><span id="linklab-flashtrace">vector table + .data initial image</span></div>
          <div class="linklab-tracearrow">→</div>
          <div><b>RAM</b><span id="linklab-ramtrace">runtime state is being prepared</span></div>
        </div>
      </div>
      <div class="linklab-card linklab-pseudocode-card">
        <h4>Startup pseudocode &mdash; this is exactly what <code>startup.s</code> does</h4>
        <pre class="linklab-code"><span class="linklab-code-line" data-reset-code="1">Reset_Handler:</span>
<span class="linklab-code-line" data-reset-code="2">    load _sidata        ; Flash source of .data</span>
<span class="linklab-code-line" data-reset-code="2">    load _sdata         ; RAM destination</span>
<span class="linklab-code-line" data-reset-code="2">    load _edata         ; RAM end</span>
<span class="linklab-code-line" data-reset-code="2">    copy words</span>
<span class="linklab-code-line" data-reset-code="3">    load _sbss</span>
<span class="linklab-code-line" data-reset-code="3">    load _ebss</span>
<span class="linklab-code-line" data-reset-code="3">    write zero until end</span>
<span class="linklab-code-line" data-reset-code="4">    bl main</span>
<span class="linklab-code-line" data-reset-code="4">hang:</span>
<span class="linklab-code-line" data-reset-code="4">    b hang              ; main must never return</span></pre>
        <div class="linklab-note"><strong>This file is deliberately minimal.</strong> A vendor startup
        (<code>system_stm32f4xx.c</code>) also configures clocks and flash wait states, enables the FPU and runs
        static constructors via <code>__libc_init_array</code> before <code>main</code> &mdash; see topic
        <code>1.10 Reset vector and startup code</code>. Those steps are not in our <code>startup.s</code> on purpose:
        every line above is a line you can read in the Compilation Path lab's
        <code>startup.s</code> editor, so the two cannot disagree. The last step is the one that is easy to forget
        and impossible to debug: if <code>main</code> returns, the PC lands on whatever follows it, so real startup
        ends in an infinite loop.</div>
      </div>
      <div class="linklab-card linklab-asmmap">
        <h4>Now the same thing in assembly &mdash; <code>startup.s</code>, all 58 lines</h4>
        <p class="linklab-asmsub">This is <code>src-tauri/src/examples/startup.s</code>, line for line: the same file
        the Compilation Path lab hands you an editor for, so every line here is a line you can point at on disk.
        Each reset step above lights up the lines that implement it, and the register panel below shows what the CPU
        is holding at that moment. Click any line to read what it does.</p>
        <div class="linklab-asmwrap">
          <div class="linklab-asm" id="linklab-asm"></div>
          <div class="linklab-asmdetail" id="linklab-asmnote"><span class="linklab-asmhint">Pick a line &mdash; highlighted lines belong to the current step.</span></div>
        </div>
        <div class="linklab-regshead">Registers at this point</div>
        <div class="linklab-regs" id="linklab-regs"></div>
      </div>
      <div class="linklab-card linklab-startup-contract"><h4>The startup contract</h4><div class="linklab-startup-contract-grid"><div><b>Linker provides</b><span>addresses and boundary symbols</span></div><div><b>Startup performs</b><span>copy .data and clear .bss</span></div><div><b>C runtime expects</b><span>globals initialized before main()</span></div></div></div>
      <div class="linklab-note"><strong>Key separation:</strong> the linker decides addresses and emits symbols; startup code reads those symbols and performs the runtime work. The linker never copies <code>.data</code> or clears <code>.bss</code>.</div>`
    },
    build: {
      title: "Build the image and read what each output means",
      intro: "Follow one firmware from source files to the linked ELF, then separate the information used for debugging from the bytes used for programming.",
      body: `<div class="linklab-buildflow"><button type="button" class="linklab-buildstep selected" data-build-step="source"><b>1</b><span>Source</span></button><i>→</i><button type="button" class="linklab-buildstep" data-build-step="objects"><b>2</b><span>Objects</span></button><i>→</i><button type="button" class="linklab-buildstep" data-build-step="link"><b>3</b><span>Link</span></button><i>→</i><button type="button" class="linklab-buildstep" data-build-step="elf"><b>4</b><span>ELF</span></button><i>→</i><button type="button" class="linklab-buildstep" data-build-step="image"><b>5</b><span>Flash image</span></button></div><div class="linklab-grid"><div class="linklab-card"><h4 id="linklab-build-title">Source files</h4><p id="linklab-build-text">The C and assembly sources describe program behavior. The linker script is consumed later when the objects are combined.</p><div id="linklab-build-artifact" class="linklab-build-artifact"><code>main.c</code><span>application logic, globals, functions</span><code>startup.s</code><span>vector table, Reset_Handler, early runtime setup</span><code>linker.ld</code><span>memory regions, section placement, linker symbols</span></div></div><div class="linklab-card"><h4>What exists at this point?</h4><div id="linklab-build-evidence" class="linklab-build-evidence"><div><b>Input</b><span>human-written source</span></div><div><b>Addresses</b><span>not final yet</span></div><div><b>Runtime image</b><span>not created yet</span></div></div><div class="linklab-note" id="linklab-build-key"><strong>Key idea:</strong> source describes intent; the linker eventually turns that intent into a concrete address layout.</div></div></div><div class="linklab-card linklab-build-command"><h4>Conceptual commands</h4><pre class="linklab-code">arm-none-eabi-gcc -c main.c -o main.o
arm-none-eabi-as startup.s -o startup.o

arm-none-eabi-gcc main.o startup.o \
  -T linker.ld \
  -Wl,-Map=firmware.map \
  -o firmware.elf

arm-none-eabi-objcopy -O binary \
  firmware.elf firmware.bin</pre></div><div class="linklab-outputgrid"><div class="linklab-card"><h4>firmware.elf</h4><p>Rich linked representation: final addresses, sections, symbols and entry information.</p></div><div class="linklab-card"><h4>firmware.map</h4><p>Human-readable report of linker decisions, section placement, symbols and memory usage.</p></div><div class="linklab-card"><h4>firmware.bin</h4><p>Flat bytes selected for programming, with far less metadata than the ELF.</p></div></div>`
    },
    check: {
      title: "Check: predict, explain, diagnose",
      intro: "Work from the causal model. First predict what happens, then explain why, then diagnose a broken rule.",
      body: `<div class="linklab-checkgrid">
        <div class="linklab-card linklab-checkblock"><div class="linklab-checklabel">1 · Predict</div><h4>Where does each object end up?</h4><p>Choose the runtime location for each example from the fixed MCU model.</p><div class="linklab-checkmatch">
          <div><code>uint32_t counter = 42;</code><div class="linklab-quiz" data-q="m1" data-ok="a"><button data-a="a">RAM .data + Flash initial image</button><button data-a="b">RAM .bss only</button><button data-a="c">stack only</button></div><div class="linklab-answer" data-answer="m1" hidden>Correct. It is writable and initialized, so it has a RAM runtime object plus an initialization image in Flash.</div></div>
          <div><code>uint8_t buffer[256];</code><div class="linklab-quiz" data-q="m2" data-ok="b"><button data-a="a">Flash .text</button><button data-a="b">RAM .bss</button><button data-a="c">stack</button></div><div class="linklab-answer" data-answer="m2" hidden>Correct. It is a zero-initialized writable global, so it occupies RAM .bss and has no initialized Flash payload.</div></div>
          <div><code>uint32_t sample = 7;</code> inside <code>control()</code><div class="linklab-quiz" data-q="m3" data-ok="a"><button data-a="a">RAM stack</button><button data-a="b">Flash .data image</button><button data-a="c">RAM .bss</button></div><div class="linklab-answer" data-answer="m3" hidden>Correct. An automatic local belongs to the function's runtime stack frame.</div></div>
        </div></div>
        <div class="linklab-card linklab-checkblock"><div class="linklab-checklabel">2 · Explain</div><h4>Put the reset story in order</h4><p>Click the next statement in the sequence. The point is to connect the vector table, linker symbols and startup actions.</p><div class="linklab-order" id="linklab-order">
          <button type="button" data-order="2">Copy initialized <code>.data</code> from its Flash load image into RAM.</button>
          <button type="button" data-order="4">Call <code>main()</code>.</button>
          <button type="button" data-order="3">Zero the RAM range described by <code>_sbss → _ebss</code>.</button>
          <button type="button" data-order="1">Obtain the initial stack pointer and <code>Reset_Handler</code> from the vector table.</button>
        </div><div class="linklab-answer" id="linklab-order-result" hidden></div></div>
        <div class="linklab-card linklab-checkblock"><div class="linklab-checklabel">3 · Diagnose</div><h4>A rule was changed. What consequence follows?</h4><div class="linklab-diagnose">
          <button type="button" data-dx="dataflash"><code>.data &gt; FLASH</code><span>The writable initialized object is assigned a Flash runtime location.</span></button>
          <button type="button" data-dx="bssload"><code>.bss &gt; RAM</code> without <code>NOLOAD</code><span>The teaching model now treats the section as having a load-image consequence.</span></button>
          <button type="button" data-dx="vectorkeep">Remove <code>KEEP(*(.isr_vector))</code><span>With section garbage collection enabled, the vector section can be at risk of being discarded if nothing else keeps it live.</span></button>
          <button type="button" data-dx="ramorigin">Give <code>RAM</code> the wrong origin.</button>
        </div><div class="linklab-answer" id="linklab-diagnose-result" hidden></div></div>
        <div class="linklab-card linklab-checkblock"><div class="linklab-checklabel">4 · Explain it yourself</div><h4>Complete the chain</h4><p>Choose the statement that best completes the system:</p><div class="linklab-quiz" data-q="chain" data-ok="a"><button data-a="a">The linker chooses placement; startup uses the resulting symbols to establish runtime state; then C code runs.</button><button data-a="b">Startup chooses addresses; the linker only converts C to machine code.</button><button data-a="c">The C compiler performs the RAM initialization after reset.</button></div><div class="linklab-answer" data-answer="chain" hidden>Correct. The compiler creates object sections, the linker gives them final placement and symbols, startup performs the required early runtime work, and then application C code runs.</div></div>
      </div>
      <div class="linklab-card linklab-checkblock"><div class="linklab-checklabel">5 · Teach it back</div><h4>Explain the whole system</h4><p>Put the five statements into the causal order you would use to teach another engineer what happens from source to <code>main()</code>.</p><div class="linklab-order" id="linklab-teach-order"><button type="button" data-order="2">The compiler/assembler create relocatable object sections.</button><button type="button" data-order="3">The linker applies <code>linker.ld</code> and assigns final addresses and symbols.</button><button type="button" data-order="4">The reset sequence uses the vector table and linker symbols to initialize runtime RAM.</button><button type="button" data-order="5">The initialized C runtime state is ready, so <code>main()</code> can execute.</button><button type="button" data-order="1">C and assembly source describe the firmware.</button></div><div class="linklab-answer" id="linklab-teach-result" hidden></div></div><div class="linklab-card linklab-checkblock linklab-finalcheck"><div class="linklab-checklabel">6 · Diagnose end-to-end</div><h4>A firmware reaches <code>main()</code>, but <code>counter</code> is not 42</h4><p>The linker script still gives <code>.data</code> a RAM VMA and Flash LMA. Which missing runtime action best explains the symptom?</p><div class="linklab-quiz" data-q="endtoend" data-ok="a"><button data-a="a">Startup did not copy the <code>.data</code> load image from <code>_sidata</code> to <code>_sdata … _edata</code>.</button><button data-a="b">The linker forgot to create <code>.text</code>.</button><button data-a="c">The vector table should have been placed in RAM.</button></div><div class="linklab-answer" data-answer="endtoend" hidden>Correct. The placement can be correct while the runtime state is still wrong: startup must perform the Flash-to-RAM copy before <code>main()</code>.</div></div><section class="linklab-qa" aria-label="Linker lab recall cards"><div class="linklab-qa-head"><strong>Recall cards</strong><span>answer first, reveal second</span></div><div class="linklab-cards"><div class="linklab-cardq"><strong>Where does .text normally live in this MCU model?</strong><button type="button" data-card="0">reveal</button><div class="linklab-answer" hidden>FLASH</div></div><div class="linklab-cardq"><strong>Why can .data have both VMA and LMA?</strong><button type="button" data-card="1">reveal</button><div class="linklab-answer" hidden>RAM is its runtime address; Flash holds its initial image.</div></div><div class="linklab-cardq"><strong>Who copies .data into RAM?</strong><button type="button" data-card="2">reveal</button><div class="linklab-answer" hidden>Startup code, not the linker.</div></div><div class="linklab-cardq"><strong>Who decides final addresses?</strong><button type="button" data-card="3">reveal</button><div class="linklab-answer" hidden>The linker.</div></div><div class="linklab-cardq"><strong>Why is .bss NOLOAD?</strong><button type="button" data-card="4">reveal</button><div class="linklab-answer" hidden>It needs RAM space but no initialized bytes in the load image.</div></div><div class="linklab-cardq"><strong>What does _estack represent?</strong><button type="button" data-card="5">reveal</button><div class="linklab-answer" hidden>The top/end of the RAM stack region in this model.</div></div></div></section>`
    }
  };

  /* ================= the real startup.s, line by line =================
     This is a byte-for-byte copy of src-tauri/src/examples/startup.s - the
     same file the Compilation Path lab hands you an editor for. It is embedded
     rather than read at run time because this lab has to work with no toolchain
     and no filesystem, and because a reading lab must not need the desktop
     shell. The cost of a copy is drift, so the copy is not hand-typed: it is
     generated from the file, and specs/startup_pseudocode.spec.js fails if it
     stops matching the real one. Treat any edit here as a proposal to make
     there too. */
  var STARTUP_S_LINES = [
    '/* Startup for the Compilation Path lab teaching MCU (Cortex-M4).',
    '   Deliberately minimal and linear so the reset story matches the lab:',
    '   vector table -> .data copy -> .bss zeroing -> main -> halt. */',
    '  .syntax unified',
    '  .cpu cortex-m4',
    '  .thumb',
    '',
    '  .section .isr_vector,"a",%progbits',
    '  .align 2',
    '  .global __isr_vector',
    '__isr_vector:',
    '  .word _estack            /* initial stack pointer */',
    '  .word Reset_Handler      /* reset vector */',
    '  .word NMI_Handler',
    '  .word HardFault_Handler',
    '',
    '  .text',
    '  .align 2',
    '  .global Reset_Handler',
    '  .type Reset_Handler, %function',
    'Reset_Handler:',
    '  /* Copy the .data initialization image from Flash to its RAM address range. */',
    '  ldr r0, =_sdata',
    '  ldr r1, =_edata',
    '  ldr r2, =_sidata',
    'copy_data:',
    '  cmp r0, r1',
    '  bge zero_bss',
    '  ldr r3, [r2], #4',
    '  str r3, [r0], #4',
    '  b   copy_data',
    '  /* Zero the .bss range. */',
    'zero_bss:',
    '  ldr r0, =_sbss',
    '  ldr r1, =_ebss',
    '  movs r2, #0',
    'zero_loop:',
    '  cmp r0, r1',
    '  bge call_main',
    '  str r2, [r0], #4',
    '  b   zero_loop',
    'call_main:',
    '  bl main',
    'hang:',
    '  b hang',
    '  .size Reset_Handler, .-Reset_Handler',
    '',
    '  .weak NMI_Handler',
    '  .type NMI_Handler, %function',
    'NMI_Handler:',
    '  b .',
    '  .size NMI_Handler, .-NMI_Handler',
    '',
    '  .weak HardFault_Handler',
    '  .type HardFault_Handler, %function',
    'HardFault_Handler:',
    '  b .',
    '  .size HardFault_Handler, .-HardFault_Handler'
  ];
  /* Which reset step each line implements, index 0 = line 1. 0 means the line is
     structure - a directive, a blank, or a comment - and belongs to no step. The
     table is one entry per line and is checked against the file's line count,
     so adding a line to startup.s without deciding what it teaches fails the
     spec rather than silently losing its highlight. */
  var STARTUP_S_STEP = [
    0, 0, 0,          /* 1-3   header comment */
    0, 0, 0,          /* 4-6   .syntax / .cpu / .thumb */
    0,                /* 7     blank */
    2, 2, 2, 2,       /* 8-11  .isr_vector section + label */
    1, 1,             /* 12-13 the two words reset actually fetches */
    2, 2,             /* 14-15 the rest of the table */
    0,                /* 16    blank */
    2, 2, 2, 2, 2,    /* 17-21 .text and the Reset_Handler label */
    0,                /* 22    comment */
    3, 3, 3, 3, 3, 3, 3, 3, 3,   /* 23-31 the .data copy loop */
    0,                /* 32    comment */
    4, 4, 4, 4, 4, 4, 4, 4, 4,   /* 33-41 the .bss zero loop */
    5, 5, 5, 5,       /* 42-45 call_main, bl main, hang */
    5,                /* 46    .size */
    0,                /* 47    blank */
    2, 2, 2, 2, 2,    /* 48-52 the default NMI handler */
    0,                /* 53    blank */
    2, 2, 2, 2, 2     /* 54-58 the default HardFault handler */
  ];
  /* A note on the lines worth stopping at, keyed by 1-based line number. The
     point is not to annotate every line but to explain the ones a reader would
     otherwise have to take on trust: the two pseudo-instructions, the two
     post-indexed accesses, the branch-with-link, and the self-branch. */
  var STARTUP_S_NOTE = {
    4: "<b>.syntax unified</b> picks one spelling for the whole ARM assembler family. Older ARM documents show the split forms (<code>movs</code>/<code>moves</code>); without this line GNU as expects those, not the unified ones you will see in every manual.",
    5: "<b>.cpu cortex-m4</b> tells the assembler which instruction set and which registers are legal. A wrong value here assembles without complaint and misbehaves in hardware — which is why the build flags and this line must agree.",
    6: "<b>.thumb</b> selects the 16-bit Thumb encoding. On Cortex-M the core can only execute Thumb, so this is strictly redundant here — it is in the file so the file reads correctly on its own. Thumb-2, the universal extension almost all Cortex-M code uses, needs no directive of its own.",
    8: "<b>.section .isr_vector,\"a\",%progbits</b> says only which bucket these bytes go in: allocatable (<code>a</code>, so they occupy image space) and program data. It does <i>not</i> choose the address — the linker script's <code>.isr_vector … &gt; FLASH</code> does that. Assembly and linker script are answering two different questions.",
    9: "<b>.align 2</b> means align to 2<sup>2</sup> = 4 bytes. Vector entries are words and the core fetches words, so a table that started unaligned would fault.",
    12: "<b>The first word is the whole reason the CPU is usable.</b> The core loads it into the stack pointer on reset, before executing a single instruction. <code>_estack</code> is a linker symbol, not a number: the linker resolves it to the top of RAM and this line emits the result as data.",
    13: "<b>The second word is the reset vector.</b> The core loads it into the program counter, so execution continues at <code>Reset_Handler</code>. Note that the vector table contains no code — it contains two addresses, and the CPU has to be told where to find them before it can run any code at all.",
    14: "The table is <b>positional</b>. <code>.word</code> at offset 4 is always NMI and offset 8 is always HardFault, whatever the names say, so entries cannot be reordered or removed. Deleting a handler shifts every later one down a slot and the core will call the wrong function.",
    19: "<b>.global Reset_Handler</b> exports the label. Both the <code>.word</code> above and the linker need to refer to this address by name, and a label that is not global is invisible outside this file.",
    21: "<b>Reset_Handler:</b> is a label, not an instruction. It costs no bytes; it gives an address a name. This is the difference between a name the assembler resolves and a value the linker supplies.",
    23: "<code>ldr r0, =_sdata</code> is a <b>pseudo-instruction</b>, not a real ARM instruction. The <code>=</code> form tells the assembler to place that 32-bit value in a literal pool nearby and load it. In plain words: <i>r0 now holds the RAM address where .data has to end up</i>. The value itself came from the linker script.",
    25: "The same <code>ldr … =</code> pseudo-instruction again, pointing the other way: <i>r2 holds where those bytes live in Flash</i>. One object, two addresses — the load address (LMA) and the run address (VMA) — and copying between them is the whole job of this loop.",
    27: "<b>cmp</b> computes <code>r0 − r1</code> and throws the result away, keeping only the condition flags. There is no separate 'compare' instruction; the flags set by a data-processing instruction are the comparison.",
    28: "<b>bge zero_bss</b> — branch if greater-or-equal, i.e. if the write pointer has caught up with the end, the copy is finished. Note <code>bge</code> is a <i>short</i> branch: it can only reach a nearby label, which is why this loop has to be a tight block.",
    29: "<code>ldr r3, [r2], #4</code> — load the word at the address in r2, <b>then</b> add 4 to r2. The <code>], #4</code> is a post-indexed write-back: read first, advance afterwards. r3 is scratch, holding the value for exactly one instruction before line 30 spends it.",
    30: "<code>str r3, [r0], #4</code> — store r3 at the address in r0, then advance r0. This is why the loop needs no separate increment instruction: the two accesses <i>are</i> the pointer arithmetic, and a copy loop is two post-indexed operations and a compare.",
    36: "<code>movs r2, #0</code> is <code>mov</code> with the condition flags updated. Inside a loop the flag update is usually noise, but it is the form that appears in every vendor startup and every datasheet example — worth recognising so you are not surprised by it.",
    43: "<b>bl</b> is branch-with-link: it stores a return address in the link register and jumps. That is what makes this a function call. A plain <code>b main</code> would overwrite the only record of how to get back here, and the CPU would continue into whatever followed.",
    45: "<b>Branches to itself, forever.</b> Nothing jumps to <code>hang</code> — it is simply the next label after the last call, so it is exactly where execution lands if <code>main</code> ever returns. This is the line that makes a returning <code>main</code> survivable rather than fatal.",
    48: "<b>.weak</b> means 'use this definition only if nothing stronger defines it'. That is precisely what lets you write your own <code>NMI_Handler</code> in C and have the linker prefer it, with no edit to this file at all.",
    51: "<code>b .</code> — the <code>.</code> is the current address, so this branches to itself. It is the conventional 'do nothing, wait here' for a handler nobody has written yet. A real interrupt would hang the CPU, which is the safe outcome: a runaway loop is debuggable, a silently ignored interrupt is not."
  };
  /* What the general registers hold at each step. Startup is the one place in C
     where you get to choose the register allocation, and seeing r0-r3 carry
     pointers through both loops is how the "who owns what" question stops being
     abstract. */
  var STARTUP_S_REGS = {
    1: [["", "No registers yet. The core is reading two words out of Flash — the stack pointer and the entry address. Nothing has executed, so there is no register state to describe."]],
    2: [["", "Still no registers. The vector table is data, and <code>Reset_Handler</code> is only an address at this point. The first instruction has still not run."]],
    3: [["r0", "<code>_sdata</code> — the RAM write pointer, advancing"],
        ["r1", "<code>_edata</code> — one past the end of .data, fixed"],
        ["r2", "<code>_sidata</code> — the Flash read pointer, advancing"],
        ["r3", "scratch: one word in flight between the load and the store"]],
    4: [["r0", "<code>_sbss</code> — the RAM write pointer, advancing"],
        ["r1", "<code>_ebss</code> — one past the end of .bss, fixed"],
        ["r2", "the constant 0 — the same register held a Flash pointer one loop ago"],
        ["", "r3 is not needed here. A zeroing loop has nothing to load, so the register that carried data in the previous loop is free."]],
    5: [["", "r0-r3 are finished with. <code>bl main</code> takes no arguments, so from this point the registers belong to the C compiler and to the ABI — startup's allocation is over."]]
  };
  /* Which lines sit inside an assembly block comment. A three-line comment
     header is three lines, and only its first and last carry a delimiter, so a
     per-line test for the opening delimiter alone would misclassify the middle
     one as code. Tracking the state once is both correct and the thing a reader
     has to do to read the file at all. Module scope, not local to the Startup
     stage: the "Reading a .s" stage counts the file by the same rule, and two
     classifiers would eventually disagree about the same line. */
  function asmCommentLines() {
    var flags = [], open = false, i, t, at;
    for (i = 0; i < STARTUP_S_LINES.length; i++) {
      t = STARTUP_S_LINES[i];
      at = t.indexOf("/*");
      if (at >= 0) { open = true; }
      /* A line counts as comment only when the comment starts the line's first
         non-space character. Lines 12 and 13 of startup.s open an inline block
         comment after a .word directive; those are directives, and treating the
         whole line as a comment is how the vector table's first two entries
         stopped being counted and the histogram showed 7 comments instead of 5.
         A comment the previous line left open still counts whatever this line
         looks like. */
      flags.push(open && (at < 0 || /^\s*\/\*/.test(t)));
      if (t.indexOf("*/") >= 0) { open = false; }
    }
    return flags;
  }
  var STARTUP_S_CMT = asmCommentLines();
  /* The one definition of what kind of line this is. Order matters: a comment is
     recognised before a directive, because a commented-out directive is a
     comment, and the reader's question is what the assembler will do, not what
     the text resembles. */
  function asmClassify(t, isComment) {
    if (t === "") { return "blank"; }
    if (isComment) { return "comment"; }
    var trimmed = t.replace(/^\s+/, "");
    if (trimmed.charAt(0) === ".") { return "directive"; }
    if (trimmed.slice(-1) === ":") { return "label"; }
    return "insn";
  }
  /* What each kind is worth, and what the assembler does with it. "emits" is the
     part that matters: only instructions emit code, .word emits data, and the
     rest emit nothing at all. */
  var ASM_KINDS = {
    insn:      { label: "instruction", emits: "code",  what: "Encoded as machine bytes. This is the only kind that executes." },
    directive: { label: "directive",   emits: "varies", what: "An instruction to the <em>assembler</em>, not to the CPU. Selects the section, alignment, symbol visibility, CPU and syntax. Never reaches the image." },
    label:     { label: "label",       emits: "none",  what: "A name for an address. Costs no bytes; branch targets and <code>.global</code> refer to it. The assembler turns a branch to it into a PC-relative offset." },
    comment:   { label: "comment",     emits: "none",  what: "Skipped entirely. Free documentation — the only part of a <code>.s</code> file that is not the program." },
    blank:     { label: "blank",       emits: "none",  what: "A separator for the reader. Assembly has no syntax where whitespace matters, so this costs nothing." }
  };
  var ASM_ORDER = ["insn", "directive", "label", "comment", "blank"];
  /* The histogram, computed from the embedded copy rather than asserted in
     prose. If a line is added to startup.s the count on screen follows it. */
  var ASM_HIST = (function () {
    var h = { insn: 0, directive: 0, label: 0, comment: 0, blank: 0 };
    for (var i = 0; i < STARTUP_S_LINES.length; i++) {
      h[asmClassify(STARTUP_S_LINES[i], STARTUP_S_CMT[i])]++;
    }
    return h;
  })();
  /* ================= reading a .s, one line at a time =================
     The decode table. Every entry names a line of the embedded startup.s by
     number and breaks it into the fields a reader has to find.

     The line text itself is NOT stored here. The reader reads it out of
     STARTUP_S_LINES at render time, so a decode of a line that has since
     changed cannot silently keep explaining the old text - the copy is the
     single one already pinned against the real file. What the table owns is the
     explanation; the file owns the text. specs/read_asm.spec.js checks that
     every field token actually appears in the line it claims to explain, which
     is the invariant a duplicated string would have broken instead. */
  var READASM_LINES = {
    insn: {
      n: 29,
      fields: [
        ["ldr", "mnemonic", "load, into a register. 32-bit Thumb-2 encoding, so this line becomes <b>four</b> bytes."],
        ["r3", "destination", "where the loaded word goes. In ARM syntax the destination is written <i>first</i>, which is the opposite of Intel/Motorola 68k order and the single most common source of confusion when reading other people's code."],
        ["[r2]", "addressing mode", "the address to read from: the contents of r2. The square brackets are the tell — they mean 'the memory at', not 'the value in'. Without them, <code>r2</code> would be the address itself."],
        [", #4", "write-back", "post-indexed. The word is read <i>first</i>, and only then is 4 added to r2. This is why the copy loop needs no separate increment instruction: the addressing mode is the pointer arithmetic."]
      ],
      why: "One line, four fields, and two of them (<code>r3</code> and the write-back) are doing work that a C programmer would hide inside a pointer increment. This is the level at which startup code is actually written."
    },
    cond: {
      n: 28,
      fields: [
        ["b", "operation", "branch. Takes the top bits of the encoding to decide where the PC goes next."],
        ["ge", "condition", "greater-or-equal — execute this only if the last <code>cmp</code> left N and V equal. The flags were set one line earlier by <code>cmp r0, r1</code>, which discards its own result and keeps only this."],
        ["zero_bss", "target", "a <i>label</i>, not an address and not a number. The assembler does not know yet where the next block will land, so it records an unresolved reference and the <b>linker</b> fills it in. That handoff is why startup.s can be written before anything is placed."]
      ],
      why: "A conditional branch is two things glued together: an unconditional branch, and a condition on it. <code>b</code> and <code>beq</code> and <code>bge</code> are the same instruction with different condition fields. Learn to split a mnemonic into operation + condition and half of assembly stops looking arbitrary."
    },
    pseudo: {
      n: 23,
      fields: [
        ["ldr", "apparent mnemonic", "looks like an ordinary load — but this form is <b>not an ARM instruction</b>. No encoding exists for 'load the 32-bit constant that follows an equals sign'."],
        ["=", "the giveaway", "this single character marks a <b>pseudo-instruction</b>. It is shorthand the assembler expands before anything is encoded."],
        ["_sdata", "a linker symbol", "not a number. The linker script defines it; at assembly time its value does not exist yet."]
      ],
      expands: "Two instructions and four bytes of data, where you wrote one line:",
      pieces: [
        "a 4-byte literal pool entry holding the address of <code>_sdata</code>, placed nearby",
        "a 16-bit <code>ldr r0, [pc, #offset]</code> that loads it — 2 bytes"
      ],
      why: "Why the expansion exists at all is the subject of the Thumb-2 section below: a 16-bit instruction has nowhere near enough bits to carry a full 32-bit immediate, so the value has to be fetched from memory instead. Six bytes on the wire, one line in the source — and if you are comparing two disassemblies, this is where their byte counts will surprise you."
    },
    call: {
      n: 43,
      fields: [
        ["b", "branch", "go to another address and keep going there. On its own this would be a plain jump, which is why the next field exists at all."],
        ["l", "link", "and save where to come back to, by writing the return address into the <b>link register</b>, r14. This one character is the difference between a call and a jump, and it is what lets <code>main</code> eventually return into the <code>hang</code> loop below."],
        ["main", "target", "a symbol from <code>main.c</code>, not from this file. The assembler emits an unresolved reference here too; only <code>main.o</code> can say what <code>main</code> means."]
      ],
      why: "<code>bl</code> is the boundary of this file. Everything before it is setup that C assumes has happened; everything after is C's problem. Note it is <code>bl</code> and not <code>b main</code>: a plain <code>b</code> would overwrite the only record of how to return, and execution would fall into the middle of whatever the linker placed next."
    }
  };
  /* Thumb-2. Kept as an explicit list of consequences rather than prose, because
     "there are two instruction sizes" is trivia until you know what it forces
     you to do. Every item names the concrete cost, and every item points at a
     line in the file above it. */
  var READASM_T2 = [
    { t: "Two encodings for one instruction set", d: "Thumb-2 adds 32-bit encodings back alongside the 16-bit ones, so the full ARM instruction set is available in 16 bits <i>or</i> 32. You cannot read a Thumb-2 listing by assuming a fixed instruction length — a disassembler has to infer the width from context, and if it guesses wrong every instruction after that point decodes as nonsense.", at: "line 29 is 4 bytes; line 28 is 2" },
    { t: "Wide branches and calls", d: "<code>bl</code> in Thumb-2 is a single 32-bit instruction whose offset is split across the two halves of the encoding. There was not enough room for a full 24-bit branch target in 16 bits, which is why short branches and <code>bl</code> have different shapes.", at: "line 43" },
    { t: "Literal pools, and the pseudo-instruction that needs one", d: "A 16-bit encoding has almost no room for an immediate value. To load a full 32-bit address, the assembler has to put the value somewhere in memory and load it from there. That 'somewhere' is a literal pool, and <code>ldr rX, =symbol</code> is the instruction that makes the assembler build one for you.", at: "line 23" },
    { t: "Conditional execution needs a block", d: "There is no instruction that both sets the condition flags and is itself conditional — a 16-bit encoding cannot afford both. So conditional code is written as a block: an <code>IT</code> instruction that sets up up to four conditions, and the assembler then appends the condition to the following mnemonics (<code>moveq</code>, <code>addeq</code>). <code>bge</code> works as a single instruction because a branch never sets flags.", at: "line 28, and the absence of any <code>it</code> here" },
    { t: "Cortex-M cannot execute A32 at all", d: "On an M-profile core like this Cortex-M4 there is no ARM state to switch to: <code>.thumb</code> in <code>startup.s</code> selects the only state that exists, which makes the line strictly redundant here. It is in the file so the file reads correctly on its own. The practical consequence is that <code>.thumb</code> does <i>not</i> mean '16-bit instructions only' — Thumb-2's 32-bit encodings are selected by the same directive.", at: "line 6" },
    { t: "Not every Cortex-M has Thumb-2", d: "Thumb-2 arrived in ARMv6T2. The Cortex-M4 used in this lab is ARMv7-M, so every instruction here is available. The Cortex-M0 and M0+ are ARMv6-M: <b>Thumb-1 only, no Thumb-2</b>. Code that relies on 32-bit encodings will not run on an M0, which is a portability fact that has caught out real projects.", at: "line 29 needs Thumb-2; line 5 is where the architecture is chosen" }
  ];
  var LINK_RULES = {
    memory:{title:"MEMORY",syntax:"MEMORY { ... }",plain:"Declares the address ranges the linker is allowed to use.",memory:"Defines FLASH at 0x08000000 and RAM at 0x20000000 for this teaching MCU.",runtime:"Provides the regions used by later SECTIONS rules and enables overflow checking.",bad:"The linker has no correct hardware map to place the image."},
    flash:{title:"FLASH",syntax:"FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 1M",plain:"Names the non-volatile region and gives its start and capacity.",memory:"Sections assigned to FLASH consume image space from 0x08000000 onward.",runtime:"Holds code, constants, vectors and the initial .data bytes.",bad:"The image may be placed outside the actual device or the usable capacity may be wrong."},
    ram:{title:"RAM",syntax:"RAM (rwx) : ORIGIN = 0x20000000, LENGTH = 128K",plain:"Names the runtime writable memory region.",memory:".data, .bss and runtime stack/heap must fit within this address range.",runtime:"Provides the live storage used after reset.",bad:"Variables or the stack can be placed where the MCU has no usable RAM."},
    estack:{title:"_estack",syntax:"_estack = ORIGIN(RAM) + LENGTH(RAM);",plain:"Defines a linker symbol at the top/end of the RAM region.",memory:"For this model it evaluates to 0x20020000.",runtime:"The vector table can use this value as the initial stack pointer.",bad:"Reset may start with an invalid initial stack location."},
    sections:{title:"SECTIONS",syntax:"SECTIONS { ... }",plain:"Maps input sections from object files into output sections at final addresses.",memory:"This is where the abstract object-file pieces become a concrete firmware layout.",runtime:"Its symbols become addresses consumed by startup and application code.",bad:"Objects may be unplaced, misplaced, or left without the required runtime arrangement."},
    vector:{title:".isr_vector",syntax:".isr_vector : { ... } > FLASH",plain:"Creates an output section for the vector table and places it in Flash.",memory:"The vector table occupies the beginning of the firmware image in this model.",runtime:"Reset uses the initial SP and Reset_Handler entry stored in the vector table.",bad:"The CPU can fetch the wrong reset/interrupt information."},
    keep:{title:"KEEP",syntax:"KEEP(*(.isr_vector))",plain:"Marks matching input sections as retained during linker garbage collection.",memory:"The vector table remains part of the linked image even if ordinary reachability analysis does not keep it.",runtime:"Preserves data required by reset/interrupt entry.",bad:"With section garbage collection enabled, a required vector section can be discarded."},
    text:{title:".text + .rodata",syntax:".text : { *(.text*) *(.rodata*) } > FLASH",plain:"Collects executable code and read-only constants into Flash.",memory:"Consumes Flash image space; no RAM copy is needed for these read-only sections.",runtime:"CPU executes code from its linked address and reads constants from the image.",bad:"Code/constants may be assigned to an unsuitable region or omitted from the expected image."},
    data:{title:".data",syntax:".data : { ... } > RAM AT > FLASH",plain:"Gives writable initialized data a RAM runtime address and a Flash load address.",memory:"VMA is RAM; LMA is Flash. The same initialized object is represented on both sides of reset.",runtime:"Startup copies the LMA bytes to the VMA range before main().",bad:"Initialized globals can contain garbage/old RAM contents at runtime if the copy is not performed."},
    bss:{title:".bss (NOLOAD)",syntax:".bss (NOLOAD) : { ... } > RAM",plain:"Reserves RAM for zero-initialized/uninitialized writable storage without adding a payload to the load image.",memory:"Consumes RAM addresses but does not require corresponding Flash bytes in the image.",runtime:"Startup clears _sbss … _ebss to zero before main().",bad:"The image model may waste space or the runtime state may not be initialized as required."},
    "place-flash-vector":{title:"> FLASH for .isr_vector",syntax:"} > FLASH",plain:"Places the output section in the FLASH memory region declared above.",memory:"The vector table consumes Flash image space starting at the current Flash location.",runtime:"The CPU can fetch the vector table from non-volatile memory at reset.",bad:"The vector table could end up in the wrong memory region for this MCU."},
    "input-text":{title:"*(.text*)",syntax:"*(.text*)",plain:"Collects matching input sections named .text and related variants from object files.",memory:"Those input sections become part of the output .text section and consume Flash.",runtime:"Contains executable instructions that the CPU can execute from Flash in this model.",bad:"Code can be omitted from the intended output section or left unplaced."},
    "input-rodata":{title:"*(.rodata*)",syntax:"*(.rodata*)",plain:"Collects read-only constant data emitted into .rodata input sections.",memory:"These bytes are included in the Flash-resident output .text section in this teaching script.",runtime:"Constants remain available without a startup copy into RAM.",bad:"Read-only data may be missing from the intended image or placed in the wrong region."},
    "place-flash-text":{title:"> FLASH for .text",syntax:"} > FLASH",plain:"Places the output .text section in the FLASH memory region.",memory:"Instructions and read-only constants consume Flash capacity.",runtime:"The CPU executes the linked instructions from their Flash addresses.",bad:"Code could be assigned to an unsuitable runtime region."},
    "place-data":{title:"> RAM AT > FLASH",syntax:"} > RAM AT > FLASH",plain:"Gives .data two addresses: a RAM runtime address and a Flash load address.",memory:"The VMA is in RAM; the LMA is in Flash. Both regions therefore account for the initialized data.",runtime:"Startup copies the initialized bytes from Flash to RAM before main().",bad:"The object can have the wrong runtime address, or its initialization image can be unavailable to startup."},
    "input-data":{title:"*(.data*)",syntax:"*(.data*)",plain:"Collects initialized writable input sections emitted by the compiler/toolchain.",memory:"Those objects become part of the output .data section in RAM, with an initialization image in Flash.",runtime:"Their initial values are copied into RAM before main().",bad:"Initialized writable objects can be left outside the intended .data range."},
    "place-ram-bss":{title:"> RAM for .bss",syntax:"} > RAM",plain:"Places the .bss output section in the RAM memory region.",memory:"The zero-initialized objects consume RAM capacity but no stored payload is required for them.",runtime:"Startup clears this RAM range to zero.",bad:"Zero-initialized objects or their boundaries can be placed outside usable RAM."},
    "input-bss":{title:"*(.bss*)",syntax:"*(.bss*)",plain:"Collects zero-initialized writable input sections emitted into .bss variants.",memory:"Those objects consume RAM in the output .bss section.",runtime:"Startup clears their RAM range before main().",bad:"Some zero-initialized storage may not be included in the range startup clears."},
    "input-common":{title:"*(COMMON)",syntax:"*(COMMON)",plain:"Collects common symbols into the .bss output section in this teaching script.",memory:"Those tentative/common objects consume RAM as part of .bss.",runtime:"They are included in the zeroing range before main().",bad:"Common symbols may not land in the intended zero-initialized region."},
    "symbols-data":{title:"_sdata / _edata",syntax:"_sdata = .; ... _edata = .;",plain:"Bookend the live RAM range occupied by .data.",memory:"They identify the beginning and end of the VMA range in RAM.",runtime:"Startup uses them as the destination range for the Flash-to-RAM copy.",bad:"Startup would not know exactly which RAM bytes to initialize."},
    "symbols-bss":{title:"_sbss / _ebss",syntax:"_sbss = .; ... _ebss = .;",plain:"Bookend the RAM range occupied by .bss.",memory:"They identify the exact bytes that belong to the zero-initialized region.",runtime:"Startup walks that range and writes zero before main().",bad:"Startup may leave stale RAM contents in objects that C expects to begin at zero."}
  };

  /* ---- Stage 8 · linker-script sandbox: a local placement model (no toolchain
     needed). The user assigns each output section a runtime region and edits
     sizes; the model derives flash/RAM usage, VMA/LMA, diagnostics and the
     linker.ld text that would express exactly this layout. ---- */
  LINK_DATA.sandbox = {
    title: "Sandbox: move sections, break the firmware on purpose",
    intro: "Assign a runtime region to each output section, resize it, and watch the placement consequences. The model, the generated script and the diagnostics all update live.",
    body: ""
  };

  /* ---- Stage 9 · reading a .s file ---------------------------------------
     The gap this closes: stage 5 shows startup.s as 58 annotated lines, and
     nothing anywhere explained what a reader is actually looking at. This stage
     teaches the four kinds of line, the anatomy of one instruction, and
     Thumb-2 - which line 6 of the file (.thumb) has been asserting since the
     start with no explanation anywhere in the curriculum. Everything it decodes
     is a line of the same embedded startup.s, so the two stages read as one
     continuous text. ---- */
  LINK_DATA.readasm = {
    title: "Reading a .s: what is actually an instruction",
    intro: "A 58-line assembly file is not 58 instructions. Learn to tell the four kinds of line apart, then take four real lines of startup.s apart field by field.",
    body: ""
  };
  function readasmBody() {
    var total = STARTUP_S_LINES.length, i, k, h = "";
    /* The histogram is the whole point of part 1, so it is counted from the
       embedded file rather than written into the copy: the numbers move if the
       file moves. */
    h += '<div class="linklab-card"><h4>What the ' + total + ' lines of <code>startup.s</code> actually are</h4>';
    h += '<div class="readasm-hist">';
    for (i = 0; i < ASM_ORDER.length; i++) {
      k = ASM_ORDER[i];
      h += '<button type="button" class="readasm-histrow" data-rh="' + k + '"><span class="readasm-histlabel">' +
        esc(ASM_KINDS[k].label) + '</span><span class="readasm-histbar"><i style="width:' +
        Math.round((ASM_HIST[k] / total) * 100) + '%"></i></span><b>' + ASM_HIST[k] + '</b></button>';
    }
    h += '</div><p class="readasm-count"><strong>' + ASM_HIST.insn + ' of ' + total + '</strong> lines are instructions. ' +
      'The other ' + (total - ASM_HIST.insn) + ' are directives, labels, comments and blank lines — real lines of the file, and not one of them is a machine instruction. ' +
      'The vector table is the interesting exception: its <code>.word</code> directives <em>do</em> emit bytes, but as data for the core to read, not as code to execute.</p></div>';

    h += '<div class="linklab-grid" style="margin-top:14px"><div class="linklab-card"><h4>The four kinds of line</h4><table class="linklab-table"><tr><th>Kind</th><th>Count</th><th>Emits</th><th>Example from startup.s</th></tr>';
    var ex = { insn: "ldr r3, [r2], #4", directive: ".align 2", label: "copy_data:", comment: "/* vector table -&gt; ... */", blank: "(empty)" };
    for (i = 0; i < ASM_ORDER.length; i++) {
      k = ASM_ORDER[i];
      h += '<tr><td>' + esc(ASM_KINDS[k].label) + '</td><td><b>' + ASM_HIST[k] + '</b></td><td>' + esc(ASM_KINDS[k].emits) + '</td><td><code>' + ex[k] + '</code></td></tr>';
    }
    h += '</table></div><div class="linklab-card"><h4>What each kind means for the assembler</h4><div class="readasm-kinds" id="readasm-kinds">';
    for (i = 0; i < ASM_ORDER.length; i++) {
      k = ASM_ORDER[i];
      h += '<div class="readasm-kind" data-rk="' + k + '"><b>' + ASM_HIST[k] + ' × ' + esc(ASM_KINDS[k].label) +
        ' <span>emits ' + esc(ASM_KINDS[k].emits) + '</span></b><p>' + ASM_KINDS[k].what + '</p></div>';
    }
    h += '</div></div></div>';

    /* Part 2: anatomy. Four real lines, one button each. */
    h += '<div class="linklab-card" style="margin-top:14px"><h4>Anatomy of an instruction line</h4>';
    h += '<p class="linklab-asmsub">Every instruction line has the same skeleton, read left to right. Pick one of these real lines from <code>startup.s</code> and it comes apart field by field.</p>';
    h += '<div class="readasm-rail" role="group" aria-label="Decode a line of startup.s">';
    for (k in READASM_LINES) {
      if (READASM_LINES.hasOwnProperty(k)) {
        h += '<button type="button" data-ra="' + k + '"><span class="readasm-ran">' + READASM_LINES[k].n + '</span>' +
          esc(STARTUP_S_LINES[READASM_LINES[k].n - 1].replace(/^\s+/, "")) + '</button>';
      }
    }
    h += '</div><div class="readasm-detail" id="readasm-detail"><span class="linklab-asmhint">Pick a line above — four of them, all from the file you just walked through in stage 5.</span></div></div>';

    /* Part 3: Thumb-2. This is the part nothing in the curriculum covered. */
    h += '<div class="linklab-card" style="margin-top:14px"><h4>Thumb-2: why line 6 says <code>.thumb</code></h4>';
    h += '<p class="linklab-asmsub">The original ARM instruction set is 32 bits wide, always — simple to decode, wasteful in Flash. ' +
      '<b>Thumb</b> re-encodes the common instructions in 16 bits, which halves code size. The catch is arithmetic: 16 bits is only ' +
      '65,536 possible patterns, and the real instruction set needs more than that, so Thumb had to drop instructions to fit. ' +
      '<b>Thumb-2</b> adds 32-bit encodings back alongside the 16-bit ones, so the full instruction set is available in 16 <i>or</i> 32 bits. ' +
      'This Cortex-M4 (ARMv7-M) has Thumb-2; <code>.thumb</code> selects it. Here is what that costs you as a reader:</p>';
    h += '<div class="readasm-t2">';
    for (i = 0; i < READASM_T2.length; i++) {
      h += '<div class="readasm-t2item"><b>' + esc(READASM_T2[i].t) + '</b><p>' + READASM_T2[i].d + '</p><span>see ' + READASM_T2[i].at + '</span></div>';
    }
    h += '</div></div>';

    /* Part 4: graded. data-ok on each, so the app's own quiz contract is
       unchanged and specs/lab_quiz.spec.js keeps covering it. */
    h += '<div class="linklab-card linklab-checkblock" style="margin-top:14px"><div class="linklab-checklabel">Check · read the line</div>';
    h += '<h4>Which of these lines is a pseudo-instruction?</h4><p>One of the four you just decoded is not an ARM instruction at all. It is the assembler expanding shorthand before anything is encoded.</p>';
    h += '<div class="linklab-quiz" data-q="ra1" data-ok="c"><button data-a="a">ldr r3, [r2], #4</button><button data-a="b">bge zero_bss</button><button data-a="c">ldr r0, =_sdata</button><button data-a="d">bl main</button></div>';
    h += '<div class="linklab-answer" data-answer="ra1" hidden>Correct. The <code>=</code> is the giveaway: no encoding exists for "load the 32-bit value after an equals sign", so the assembler places the value in a literal pool and emits a plain 16-bit <code>ldr r0, [pc, #offset]</code> to fetch it. The other three are all real encodings.</div>';
    h += '<h4 style="margin-top:18px">Which line needs a literal pool, and why?</h4>';
    h += '<div class="linklab-quiz" data-q="ra2" data-ok="b"><button data-a="a"><code>bl main</code> — the call offset is too wide for 16 bits</button><button data-a="b"><code>ldr r0, =_sdata</code> — a 16-bit encoding has too few bits for a 32-bit value</button><button data-a="c"><code>bge zero_bss</code> — conditional branches need a constant table</button><button data-a="d"><code>ldr r3, [r2], #4</code> — a memory operand always needs a pool</button></div>';
    h += '<div class="linklab-answer" data-answer="ra2" hidden>Correct. A literal pool exists purely because a 16-bit encoding cannot carry a full 32-bit immediate. <code>bl</code> solves the same width problem differently — as a 32-bit Thumb-2 instruction — which is why it needs no pool.</div>';
    h += '<h4 style="margin-top:18px">On a Cortex-M0, which of these would fail to assemble?</h4><p>The M0 is ARMv6-M: Thumb-1 only, no Thumb-2 at all.</p>';
    h += '<div class="linklab-quiz" data-q="ra3" data-ok="d"><button data-a="a">None — the <code>.thumb</code> directive covers every core</button><button data-a="b"><code>bge zero_bss</code></button><button data-a="c"><code>ldr r0, =_sdata</code></button><button data-a="d"><code>ldr r3, [r2], #4</code> — a 32-bit wide load needs Thumb-2</button></div>';
    h += '<div class="linklab-answer" data-answer="ra3" hidden>Correct. The 16-bit Thumb-1 encoding has only single-register load/store forms, so the post-indexed wide load at line 29 is unavailable on an M0. The conditional branch and the literal-pool load both have 16-bit forms and assemble fine. This is a real portability constraint, not a hypothetical.</div>';
    h += '</div>';

    /* What the stage is for, stated once at the end. */
    h += '<div class="linklab-note" style="margin-top:14px"><strong>Why this stage exists:</strong> stage 5 gave you 58 annotated lines of <code>startup.s</code> and this is the skill for reading them yourself. ' +
      'The four kinds of line tell you what the assembler is being asked to do; the anatomy tells you what one instruction does; Thumb-2 tells you why the disassembly of <code>startup.o</code> is longer than the 19 instructions you can count in the source.</div>';
    return h;
  }
  var FLASH_SIZE = 1048576, RAM_SIZE = 131072, RAM_ORIGIN = 0x20000000, LKS_MAX = 8388608;
  var K_LKSAND = "ecroadmap.lksandbox.v1";
  function lksandDefault() {
    return {
      stack: 8192, heap: 4096,
      sections: [
        { id: ".isr_vector", kind: "vec", size: 256, vma: "FLASH" },
        { id: ".text", kind: "exec", size: 245760, vma: "FLASH" },
        { id: ".rodata", kind: "ro", size: 4096, vma: "FLASH" },
        { id: ".data", kind: "init", size: 1024, vma: "RAM" },
        { id: ".bss", kind: "zero", size: 8192, vma: "RAM" }
      ]
    };
  }
  /* One clamp for every byte count the model accepts: an integer in [0, LKS_MAX].
     Section sizes already took it; the stack/heap reserves did not, so a stored or
     imported file could hand the model a *negative* reserve and bend the RAM total —
     and every bar drawn from it — the wrong way (`ramUsed = stack + heap` goes
     negative). specs/linker_sandbox.spec.js found it by loading a crafted record. */
  function lksClampSize(v) {
    var n = Math.round(Number(v));
    if (!isFinite(n) || n < 0) { return 0; }
    return Math.min(LKS_MAX, n);
  }
  function lksandLoad() {
    var d = lksandDefault(), s = rd(K_LKSAND, null);
    if (!s || !Array.isArray(s.sections) || s.sections.length !== d.sections.length) { return d; }
    d.stack = lksClampSize(s.stack); d.heap = lksClampSize(s.heap);
    d.sections.forEach(function (sec, i) {
      var u = s.sections[i];
      if (!u) { return; }
      /* A non-numeric size leaves the default alone rather than zeroing it. */
      if (typeof u.size === "number") { sec.size = lksClampSize(u.size); }
      if (u.vma === "FLASH" || u.vma === "RAM") { sec.vma = u.vma; }
    });
    return d;
  }
  var lksand = lksandLoad();
  function lksfmt(b) {
    if (b >= 1048576) { return String(Math.round(b * 100 / 1048576) / 100) + " MiB"; }
    if (b >= 1024) { return String(Math.round(b * 100 / 1024) / 100) + " KiB"; }
    return b + " B";
  }
  function lkshex(n) { return "0x" + (n >>> 0).toString(16).toUpperCase(); }
  function lksandCompute(st) {
    /* Reserves live in RAM only: _estack sits at the top of RAM and the heap grows
       up from low RAM. A real linker never places them in FLASH, so the flash
       total counts loaded section images and nothing else. */
    var flashUsed = 0, ramUsed = st.stack + st.heap, diag = [], byId = {};
    /* reserves: startup uses _estack at the top of RAM, then code pushes
       frames (stack grows down) and malloc (if any) grows up from the heap */
    st.sections.forEach(function (s) {
      byId[s.id] = s;
      if (s.kind !== "zero") { flashUsed += s.size; } /* every loaded section carries a flash image — even one whose VMA is RAM */
      if (s.vma === "RAM") { ramUsed += s.size; }
    });
    function d(sec, sev, msg) { diag.push({ sec: sec, sev: sev, msg: msg }); }
    var vec = byId[".isr_vector"], text = byId[".text"], ro = byId[".rodata"], data = byId[".data"], bss = byId[".bss"];
    if (vec.vma !== "FLASH") {
      d(".isr_vector", "error", "At reset the Cortex-M fetches the initial SP and Reset_Handler from the flash origin — RAM holds garbage until something writes it. Vectors placed in RAM are unreachable: word 0 is read before any code can copy it there.");
    } else if (vec.size < 32) {
      d(".isr_vector", "warn", "The table is smaller than the first required vectors (SP, PC, NMI, HardFault — 16 B minimum, 32 B comfortable); the CPU would fetch handler addresses from outside it.");
    } else {
      d(".isr_vector", "ok", "At 0x08000000, run-in-place. Word 0 = initial SP (<code>_estack</code>), word 1 = Reset_Handler. KEEP protects it from <code>--gc-sections</code>.");
    }
    if (text.vma === "RAM") {
      d(".text", "error", "The reset sequence only copies <code>.data</code> and clears <code>.bss</code> — nothing ever populates this RAM copy, so the CPU fetches undefined instructions the first time it calls a function. Run code in place from FLASH, or add a load image plus a copy loop in startup.");
    } else { d(".text", "ok", "Execute-from-flash, run-in-place: VMA = LMA, no startup work required."); }
    if (ro.vma === "RAM") {
      d(".rodata", "error", "The constants would live at RAM addresses that nothing initializes — <code>_sidata → _sdata</code> covers <code>.data</code> only. Put <code>.rodata</code> back in FLASH or extend the copy range.");
    } else { d(".rodata", "ok", "Read-only bytes stay in the flash image with <code>.text</code>; the CPU reads constants in place, no RAM cost."); }
    if (data.vma === "RAM") {
      d(".data", "ok", "VMA " + lkshex(RAM_ORIGIN) + " + n · LMA in FLASH (the initialization image startup copies with <code>_sidata → _sdata … _edata</code>). This is why <code>.data</code> costs both regions.");
    } else {
      d(".data", "error", "Writable data at a flash VMA: stores to initialized globals silently do nothing (flash needs special controller commands to write). Initialized writable objects need a RAM VMA with <code>AT &gt; FLASH</code>.");
    }
    if (bss.vma === "RAM") {
      d(".bss", "ok", "NOLOAD: it reserves RAM but adds zero bytes to the image — startup creates the zeros at runtime with <code>_sbss → _ebss</code>, which is why a <code>static uint8_t buf[4096]</code> costs no flash.");
    } else {
      d(".bss", "error", "The clear loop writes zeros from <code>_sbss</code> to <code>_ebss</code> — a flash VMA cannot be written at runtime, so the zero-initialization contract breaks. <code>.bss</code> belongs in RAM.");
    }
    if (flashUsed > FLASH_SIZE) { d("layout", "error", "FLASH region overflowed: <code>section .bss will not fit in region FLASH</code> — the linker refuses to produce the image. The flash total counts every loaded section's init image (.data is counted twice: its VMA lives in RAM, its LMA image in flash)."); }
    if (ramUsed > RAM_SIZE) { d("layout", "error", "RAM region overflowed by " + lksfmt(ramUsed - RAM_SIZE) + " — the link fails before firmware exists. Shrink a section, move code back to FLASH, or trim the stack/heap reserves."); }
    var errors = diag.filter(function (x) { return x.sev === "error"; }).length;
    var warns = diag.filter(function (x) { return x.sev === "warn"; }).length;
    return { flashUsed: flashUsed, ramUsed: ramUsed, diag: diag, errors: errors, warns: warns };
  }
  function lksandScript(st, res) {
    function errFlag(ids) {
      var has = false;
      res.diag.forEach(function (d) { if (ids.indexOf(d.sec) >= 0 && d.sev === "error") { has = true; } });
      return has ? " err" : "";
    }
    function line(text, secIds) {
      if (!secIds) { return '<div class="lks-line">' + esc(text || " ") + "</div>"; }
      return '<div class="lks-line' + errFlag(secIds) + '" data-lks-link="' + esc(secIds.join(",")) + '">' + esc(text) + "</div>";
    }
    var textReg = (st.sections[1].vma === "RAM" || st.sections[2].vma === "RAM") ? "RAM" : "FLASH";
    var L = [];
    L.push(line("MEMORY"));
    L.push(line("{"));
    L.push(line("  FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 1M"));
    L.push(line("  RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = 128K"));
    L.push(line("}"));
    L.push(line(""));
    L.push(line("_estack = ORIGIN(RAM) + LENGTH(RAM);   /* = 0x20020000 */"));
    L.push(line(""));
    L.push(line("SECTIONS"));
    L.push(line("{"));
    L.push(line("  .isr_vector : { KEEP(*(.isr_vector)) } > " + st.sections[0].vma, [".isr_vector"]));
    L.push(line(""));
    L.push(line("  .text : { *(.text*) *(.rodata*) } > " + textReg, [".text", ".rodata"]));
    L.push(line(""));
    L.push(line("  .data : { _sdata = .; *(.data*) _edata = .; } > " + st.sections[3].vma + (st.sections[3].vma === "RAM" ? " AT > FLASH" : ""), [".data"]));
    L.push(line(""));
    L.push(line("  .bss (NOLOAD) : { _sbss = .; *(.bss*) *(COMMON) _ebss = .; } > " + st.sections[4].vma, [".bss"]));
    L.push(line("}"));
    return L.join("");
  }
  function lksAddrText(s) {
    if (s.kind === "init" && s.vma === "RAM") { return "VMA " + lkshex(RAM_ORIGIN) + "+n · LMA FLASH"; }
    if (s.kind === "zero") { return "VMA " + (s.vma === "RAM" ? lkshex(RAM_ORIGIN) : "0x08000000") + "+n · NOLOAD"; }
    return "VMA = LMA " + (s.vma === "RAM" ? lkshex(RAM_ORIGIN) : "0x08000000") + "+n";
  }
  function lksSecCtl(s, res) {
    var kinds = { vec: "reset vectors", exec: "code", ro: "read-only", init: "init'd writable", zero: "zero-init" };
    var per = s.id === ".bss" ? { flash: 0, ram: s.vma === "RAM" ? s.size : 0 } :
      { flash: s.size, ram: s.vma === "RAM" ? s.size : 0 };
    return '<div class="lks-row" data-lks-row="' + esc(s.id) + '"><span class="lks-sec">' + esc(s.id) + ' <span class="lks-kind">' + esc(kinds[s.kind] || "") + "</span></span>" +
      '<span class="lks-reg"><button type="button" data-lks-sec="' + esc(s.id) + '" data-lks-region="FLASH" class="' + (s.vma === "FLASH" ? "on" : "") + '" aria-pressed="' + String(s.vma === "FLASH") + '">FLASH</button>' +
      '<button type="button" data-lks-sec="' + esc(s.id) + '" data-lks-region="RAM" class="' + (s.vma === "RAM" ? "on" : "") + '" aria-pressed="' + String(s.vma === "RAM") + '">RAM</button></span>' +
      '<span class="lks-foot">' + esc(lksAddrText(s)) + "<br>image +" + per.flash + " B · ram +" + per.ram + " B</span>" +
      '<label class="lks-foot">size <input type="number" class="lks-num" data-lks-size="' + esc(s.id) + '" value="' + s.size + '" min="0" max="' + LKS_MAX + '" step="256"> B</label></div>';
  }
  function lksBar(label, used, total, reserve) {
    var pct = Math.min(100, used / total * 100), over = used > total;
    var rpct = Math.min(pct, reserve / total * 100);
    return '<div class="lks-bar"><b>' + esc(label) + " · used " + lksfmt(used) + " of " + lksfmt(total) + (over ? ' <span class="lks-chip bad">OVERFLOW</span>' : "") + "</b>" +
      '<div class="lks-track"><span class="lks-fill' + (over ? " over" : "") + '" style="width:' + pct.toFixed(1) + '%"></span>' +
      '<span class="lks-fill lks-reserve" style="width:' + rpct.toFixed(1) + '%;display:block;margin-top:-24px;pointer-events:none"></span></div>' +
      "<small>" + (over ? "the linker refuses to place this image — nothing gets linked" : pct.toFixed(1) + "% full · striped part = stack + heap reserve") + "</small></div>";
  }
  var LKS_PRESETS = {
    healthy:   function(){},
    dataflash: function(s){ s.sections[3].vma = "FLASH"; },
    textram:   function(s){ s.sections[1].vma = "RAM"; },
    bssflash:  function(s){ s.sections[4].vma = "FLASH"; },
    vecram:    function(s){ s.sections[0].vma = "RAM"; },
    ramfull:   function(s){ s.sections[4].size = 300000; }
  };
  var LKS_PRESET_LIST = [
    { k: "healthy",   label: "healthy example" },
    { k: "dataflash", label: ".data → FLASH" },
    { k: "textram",   label: ".text → RAM" },
    { k: "bssflash",  label: ".bss → FLASH" },
    { k: "vecram",    label: ".isr_vector → RAM" },
    { k: "ramfull",   label: "RAM overflow" }
  ];
  function lksandBody() {
    var res = lksandCompute(lksand);
    var h = '<div class="lks-presets" role="group" aria-label="Try a scenario"><b>Try a scenario</b>' +
      LKS_PRESET_LIST.map(function(p){ return '<button type="button" data-lks-preset="'+p.k+'">'+esc(p.label)+'</button>'; }).join("") +
      "</div>";
    h += '<div class="lks-head"><span>output section</span><span>runtime (VMA)</span><span>placement model</span><span>bytes</span></div>';
    lksand.sections.forEach(function (s) { h += lksSecCtl(s, res); });
    h += '<div class="lks-bars">' + lksBar("FLASH 0x08000000 · 1 MiB", res.flashUsed, FLASH_SIZE, 0) + lksBar("RAM 0x20000000 · 128 KiB", res.ramUsed, RAM_SIZE, lksand.stack + lksand.heap) + "</div>";
    h += '<div class="lks-reserve-row"><label>stack reserve <input type="number" class="lks-num" data-lks-reserve="stack" value="' + lksand.stack + '" min="0" max="' + LKS_MAX + '" step="256"> B</label>' +
      '<label>heap reserve <input type="number" class="lks-num" data-lks-reserve="heap" value="' + lksand.heap + '" min="0" max="' + LKS_MAX + '" step="256"> B</label>' +
      '<button type="button" class="btn" id="lks-reset">reset the example</button></div>';
    h += '<div class="linklab-card lks-script" style="margin-top:14px"><h4>the linker script this layout implies <span class="lks-hint">hover a section row to highlight its script line · click a line to flash its row</span></h4><div class="linklab-code lks-script-lines">' + lksandScript(lksand, res) + "</div></div>";
    h += '<div class="linklab-card" style="margin-top:14px"><h4>consequences right now<span class="lks-chip ' + (res.errors ? "bad" : "ok") + '">' + (res.errors ? res.errors + " error" + (res.errors === 1 ? "" : "s") : res.warns ? res.warns + " watch-out" + (res.warns === 1 ? "" : "s") : "layout healthy") + "</span></h4><div class=\"lks-diag\">";
    res.diag.forEach(function (x) {
      h += '<div class="lks-diag-row"><span class="lks-tag ' + x.sev + '">' + (x.sev === "ok" ? "fine" : x.sev) + "</span><span>" + (x.sec === "layout" ? "<b>region fit:</b> " : "<code>" + esc(x.sec) + "</code> ") + x.msg + "</span></div>";
    });
    h += "</div></div>";
    h += '<div class="linklab-note"><strong>Model honesty:</strong> this is a placement model with fixed teaching sizes, not a linker. Sizes are yours; flash cost counts every loaded section\u2019s init image (only <code>.bss</code> is NOLOAD); RAM cost counts VMA-in-RAM plus the reserves. <strong>Where to type raw <code>linker.ld</code> text and get real <code>ld</code> errors</strong>: the Compilation Path lab → Lab bench mode — that is the only place the toolchain runs; this sandbox is the visualisation layer on top of the same MEMORY map.</div>';
    return h;
  }
  function lksandWire(host) {
    host.__lks = function (id) {
      for (var i = 0; i < lksand.sections.length; i++) { if (lksand.sections[i].id === id) { return lksand.sections[i]; } }
      return null;
    };
    /* preset scenarios */
    Array.prototype.forEach.call(host.querySelectorAll("[data-lks-preset]"), function (b) {
      b.addEventListener("click", function () {
        var p = LKS_PRESETS[b.dataset.lksPreset]; if (!p) { return; }
        lksand = lksandDefault(); p(lksand);
        lksandSave(); renderLinkLab("sandbox");
      });
    });
    /* script ↔ row cross-highlight */
    function setLinked(ids, on) {
      ids.forEach(function (id) {
        var r = host.querySelector('.lks-row[data-lks-row="' + id + '"]');
        if (r) { r.classList.toggle("linked", on); }
        Array.prototype.forEach.call(host.querySelectorAll('.lks-line[data-lks-link="' + id + '"], .lks-line[data-lks-link*="' + id + ',"], .lks-line[data-lks-link*=","' + id + '"]'), function (l) {
          l.classList.toggle("linked", on);
        });
      });
    }
    Array.prototype.forEach.call(host.querySelectorAll(".lks-line[data-lks-link]"), function (l) {
      var ids = l.dataset.lksLink.split(",");
      l.addEventListener("mouseenter", function () { setLinked(ids, true); });
      l.addEventListener("mouseleave", function () { l.classList.remove("linked"); setLinked(ids, false); });
      l.addEventListener("click", function () {
        var r = host.querySelector('.lks-row[data-lks-row="' + ids[0] + '"]');
        if (!r) { return; }
        r.classList.add("flash");
        setTimeout(function () { r.classList.remove("flash"); }, 900);
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll(".lks-row[data-lks-row]"), function (r) {
      var id = r.dataset.lksRow;
      r.addEventListener("mouseenter", function () { setLinked([id], true); });
      r.addEventListener("mouseleave", function () { setLinked([id], false); });
    });
    Array.prototype.forEach.call(host.querySelectorAll("[data-lks-sec]"), function (b) {
      b.addEventListener("click", function () {
        var s = host.__lks(b.dataset.lksSec); if (!s || s.vma === b.dataset.lksRegion) { return; }
        s.vma = b.dataset.lksRegion; lksandSave(); renderLinkLab("sandbox");
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll("[data-lks-size]"), function (inp) {
      inp.addEventListener("change", function () {
        var s = host.__lks(inp.dataset.lksSize); if (!s) { return; }
        var v = lksClampSize(inp.value);
        s.size = v; inp.value = v; lksandSave(); renderLinkLab("sandbox");
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll("[data-lks-reserve]"), function (inp) {
      inp.addEventListener("change", function () {
        var v = lksClampSize(inp.value);
        lksand[inp.dataset.lksReserve] = v; inp.value = v; lksandSave(); renderLinkLab("sandbox");
      });
    });
    var rb = host.querySelector("#lks-reset");
    if (rb) { rb.addEventListener("click", function () { lksand = lksandDefault(); lksandSave(); renderLinkLab("sandbox"); }); }
  }
  function lksandSave() { wr(K_LKSAND, lksand); }

  var linkLabStage = "mcu";
  function initLinkLab() {
    if (linkLabInited) { return; }
    linkLabInited = true;
    var nav = document.getElementById("linklab-progress");
    if (!nav) { return; }
    Array.prototype.forEach.call(nav.querySelectorAll("button[data-link-stage]"), function (b) {
      b.addEventListener("click", function () { renderLinkLab(b.dataset.linkStage); });
    });
    renderLinkLab("mcu");

  }
  function renderLinkLab(stage) {
    if (!LINK_DATA[stage]) { stage = "mcu"; }
    linkLabStage = stage;
    var host=document.getElementById("linklab-stage"), nav=document.getElementById("linklab-progress");
    if (!host || !nav) { return; }
    var d=LINK_DATA[stage];
    walkMark("link", stage);
    journalMount("link", stage, d.title);
    if(stage==="sandbox"){ d={title:d.title, intro:d.intro, body:lksandBody()}; }
    if(stage==="readasm"){ d={title:d.title, intro:d.intro, body:readasmBody()}; }
    Array.prototype.forEach.call(nav.querySelectorAll("button[data-link-stage]"),function(b){b.setAttribute("aria-selected",String(b.dataset.linkStage===stage));});
    host.innerHTML='<div class="linklab-stage-head"><h3>'+esc(d.title)+'</h3><p>'+esc(d.intro)+'</p></div><div class="linklab-body">'+d.body+'</div>';
    Array.prototype.forEach.call(host.querySelectorAll(".linklab-quiz button"),function(b){
      b.addEventListener("click",function(){
        var q=b.parentNode.getAttribute("data-q"), ok=(b.dataset.a===b.parentNode.getAttribute("data-ok"));
        Array.prototype.forEach.call(b.parentNode.querySelectorAll("button"),function(x){x.classList.remove("correct","wrong");});
        b.classList.add(ok?"correct":"wrong");
        var ans=host.querySelector('[data-answer="'+q+'"]'); if(ans) ans.hidden=false;
      });
    });
    var order=host.querySelector("#linklab-order"), orderResult=host.querySelector("#linklab-order-result"), orderNext=1;
    if(order){Array.prototype.forEach.call(order.querySelectorAll("button"),function(b){b.addEventListener("click",function(){var n=Number(b.dataset.order);if(n===orderNext){b.classList.add("correct");b.disabled=true;orderNext++;if(orderNext===5){orderResult.textContent="Correct. Reset → vector table → .data copy → .bss clear → main().";orderResult.hidden=false;}}else{b.classList.add("wrong");setTimeout(function(){b.classList.remove("wrong");},650);}});});}
    var teachOrder=host.querySelector("#linklab-teach-order"), teachResult=host.querySelector("#linklab-teach-result"), teachNext=1;
    if(teachOrder){Array.prototype.forEach.call(teachOrder.querySelectorAll("button"),function(b){b.addEventListener("click",function(){var n=Number(b.dataset.order);if(n===teachNext){b.classList.add("correct");b.disabled=true;teachNext++;if(teachNext===6){teachResult.textContent="Correct. Source → objects → linker placement and symbols → startup initialization → main().";teachResult.hidden=false;}}else{b.classList.add("wrong");setTimeout(function(){b.classList.remove("wrong");},650);}});});}
    var dx=host.querySelectorAll("[data-dx]"), dxResult=host.querySelector("#linklab-diagnose-result");
    var dxText={dataflash:"The object is supposed to be writable at runtime, but this placement gives it a Flash runtime location. The key problem is the runtime VMA, not merely where its initial bytes live.",bssload:"In this teaching model, removing NOLOAD makes the section part of the load-image accounting. The important distinction is that zero-initialized RAM needs space at runtime but does not need a stored block of zero bytes.",vectorkeep:"The vector table is required by reset even though it may not have an ordinary code reference. KEEP protects it from section garbage collection.",ramorigin:"The linker can produce addresses that no longer match the MCU's real RAM. Startup may then use invalid addresses for .data, .bss or the initial stack."};
    Array.prototype.forEach.call(dx,function(b){b.addEventListener("click",function(){Array.prototype.forEach.call(dx,function(x){x.classList.remove("selected");});b.classList.add("selected");dxResult.textContent=dxText[b.dataset.dx];dxResult.hidden=false;});});
    Array.prototype.forEach.call(host.querySelectorAll("button[data-card]"), function (b) {
      b.addEventListener("click", function () {
        var a = b.nextElementSibling;
        if (a) a.hidden = false;
        b.hidden = true;
      });
    });
    if (stage === "sandbox") { lksandWire(host); }
    if (stage === "script") {
      var detail = {title:host.querySelector("#linklab-rule-title"), syntax:host.querySelector("#linklab-rule-syntax"), plain:host.querySelector("#linklab-rule-plain"), memory:host.querySelector("#linklab-rule-memory"), runtime:host.querySelector("#linklab-rule-runtime"), bad:host.querySelector("#linklab-rule-break")};
      Array.prototype.forEach.call(host.querySelectorAll(".linklab-code-row[data-rule]"), function(b){
        b.addEventListener("click", function(){
          var d=LINK_RULES[b.dataset.rule]; if(!d) return;
          Array.prototype.forEach.call(host.querySelectorAll(".linklab-code-row"),function(x){x.classList.remove("selected");});
          b.classList.add("selected");
          detail.title.textContent=d.title; detail.syntax.textContent=d.syntax; detail.plain.textContent=d.plain; detail.memory.textContent=d.memory; detail.runtime.textContent=d.runtime; detail.bad.textContent=d.bad;
        });
      });
      var scriptChoices={estack:"_estack = ORIGIN(RAM) + LENGTH(RAM);",vector:".isr_vector → FLASH",text:".text + .rodata → FLASH",data:".data → RAM AT → FLASH",bss:".bss (NOLOAD) → RAM"};
      var scriptNext=2, scriptResult=host.querySelector("#linklab-script-write-result");
      Array.prototype.forEach.call(host.querySelectorAll("button[data-script-choice]"),function(b){b.addEventListener("click",function(){var k=b.dataset.scriptChoice, expected=[null,"estack","vector","text","data","bss"];if(k===expected[scriptNext]){b.classList.add("correct");b.disabled=true;var slot=host.querySelector("#linklab-script-slot-"+scriptNext);if(slot) slot.textContent=scriptChoices[k];scriptNext++;if(scriptNext===6){scriptResult.textContent="Complete. You reconstructed the core placement policy: memory map → stack boundary → vectors → code/constants → initialized data → zero-initialized data.";scriptResult.hidden=false;}}else{b.classList.add("wrong");setTimeout(function(){b.classList.remove("wrong");},650);}});});
      var first=host.querySelector('.linklab-code-row[data-rule="memory"]'); if(first) first.click();
      var whatIfText={dataflash:"The output .data section would have a Flash runtime address in this simplified model. Writable globals are expected to live in RAM while running; the usual pattern is RAM VMA plus Flash LMA.",bssload:"The important lesson is that .bss needs RAM capacity but does not need stored zero bytes. NOLOAD expresses that load-image distinction in this teaching script.",vectorkeep:"If section garbage collection is enabled, the vector table can be discarded when it has no ordinary code reference. KEEP preserves this reset-critical input section.",ramorigin:"The linker would compute addresses from the wrong RAM range. The image could link against addresses the real MCU does not provide, affecting data, bss and the initial stack."};
      Array.prototype.forEach.call(host.querySelectorAll("button[data-whatif]"),function(b){b.addEventListener("click",function(){Array.prototype.forEach.call(host.querySelectorAll("button[data-whatif]"),function(x){x.classList.remove("selected");});b.classList.add("selected");host.querySelector("#linklab-whatif-result").textContent=whatIfText[b.dataset.whatif];});});
    }
    if (stage === "memory") {
      var objectInfo = {
        counter:{c:"uint32_t counter = 42;",section:".data input section",output:".data → RAM AT > FLASH",location:"RAM at its VMA after startup",startup:"Copy initial bytes from Flash LMA to _sdata … _edata."},
        buffer:{c:"uint8_t buffer[256];",section:".bss input section",output:".bss (NOLOAD) → RAM",location:"RAM, zero-initialized before main()",startup:"Write zero from _sbss through _ebss."},
        limit:{c:"const uint32_t limit = 100;",section:".rodata input section",output:".text output section in this teaching script",location:"FLASH; read-only runtime access",startup:"No initialization copy is required."},
        control:{c:"void control(void) { ... }",section:".text.control input section",output:".text → FLASH",location:"FLASH; executed from its linked address",startup:"No special data initialization; startup only needs to reach main()."},
        local:{c:"uint32_t sample = 7;",section:"automatic local",output:"no static .data/.bss placement",location:"runtime stack frame in RAM",startup:"No image copy; its lifetime begins when the function runs."}
      };
      Array.prototype.forEach.call(host.querySelectorAll("button[data-object]"), function(b){
        b.addEventListener("click", function(){
          var d=objectInfo[b.dataset.object]; if(!d) return;
          Array.prototype.forEach.call(host.querySelectorAll("button[data-object]"),function(x){x.classList.remove("selected");});
          b.classList.add("selected");
          host.querySelector("#linklab-object-c").textContent=d.c;
          host.querySelector("#linklab-object-section").textContent=d.section;
          host.querySelector("#linklab-object-output").textContent=d.output;
          host.querySelector("#linklab-object-location").textContent=d.location;
          host.querySelector("#linklab-object-startup").textContent=d.startup;
        });
      });
      var firstObj=host.querySelector('button[data-object="counter"]'); if(firstObj) firstObj.click();
    }
    if (stage === "build") {
      var buildSteps = {
        source:{title:"Source files",text:"The C and assembly sources describe program behavior. The linker script is consumed later when the objects are combined.",artifact:'<code>main.c</code><span>application logic, globals, functions</span><code>startup.s</code><span>vector table, Reset_Handler, early runtime setup</span><code>linker.ld</code><span>memory regions, section placement, linker symbols</span>',evidence:["human-written source","not final yet","not created yet"],key:"Source describes the program; it does not yet contain final MCU addresses."},
        objects:{title:"Object files",text:"Compilation and assembly create relocatable object files. Sections and symbols exist, but final Flash and RAM placement is still unresolved.",artifact:'<code>main.o</code><span>relocatable C code/data sections</span><code>startup.o</code><span>vector table + startup code sections</span><code>linker.ld</code><span>placement policy waiting for the link step</span>',evidence:["main.o + startup.o","relocatable addresses","no final Flash/RAM layout"],key:"Object files carry sections and relocation information; the linker resolves and places them."},
        link:{title:"Link step",text:"The linker combines the objects, reads linker.ld, resolves symbols and relocations, and checks that the result fits the declared memory regions.",artifact:'<code>main.o + startup.o</code><span>input sections and symbols</span><code>linker.ld</code><span>placement rules + MEMORY regions</span><code>firmware.map</code><span>human-readable record of the decisions</span>',evidence:["all inputs combined","final addresses computed","overflow checked against MEMORY"],key:"This is where abstract sections become a concrete firmware layout."},
        elf:{title:"Linked ELF",text:"The ELF is the rich linked result. It preserves information that debuggers and analysis tools need while describing the loadable program image.",artifact:'<code>firmware.elf</code><span>linked sections, symbols, addresses, entry information</span><code>firmware.map</code><span>readable placement and size report</span>',evidence:["linked image + metadata","final symbols available","tool-friendly representation"],key:"ELF is the useful rich representation for debugging and inspection."},
        image:{title:"Flash programming image",text:"objcopy can extract a flat binary from the linked result. The binary is convenient for programming, but does not carry the rich symbol and section metadata of the ELF.",artifact:'<code>firmware.bin</code><span>flat bytes selected from the linked image</span><code>firmware.elf</code><span>retained for debugging and inspection</span>',evidence:["programming bytes","little metadata","addresses supplied by the programming method"],key:"A .bin is a byte representation, not a replacement for the ELF during debugging."}
      };
      Array.prototype.forEach.call(host.querySelectorAll(".linklab-buildstep"),function(btn){
        btn.addEventListener("click",function(){
          var d=buildSteps[btn.dataset.buildStep];
          Array.prototype.forEach.call(host.querySelectorAll(".linklab-buildstep"),function(x){x.classList.remove("selected");});
          btn.classList.add("selected");
          host.querySelector("#linklab-build-title").textContent=d.title;
          host.querySelector("#linklab-build-text").textContent=d.text;
          host.querySelector("#linklab-build-artifact").innerHTML=d.artifact;
          var ev=host.querySelectorAll("#linklab-build-evidence span");
          for(var i=0;i<ev.length;i++) ev[i].textContent=d.evidence[i];
          host.querySelector("#linklab-build-key").innerHTML='<strong>Key idea:</strong> '+d.key;
        });
      });
    }
    if (stage === "startup") {
      var resetSteps = [
        {title:"Reset: the CPU needs two values immediately", text:"On reset, the Cortex-M startup sequence obtains the initial stack pointer and the reset-handler address from the vector table. The linker placed that table in Flash and the startup object supplied its contents.", flash:"vector table + .data initial image", ram:"stack begins at _estack; application RAM is not yet initialized", code:1},
        {title:"Vector table: enter Reset_Handler", text:"The vector table connects the hardware reset event to startup code. Its first word supplies the initial stack pointer; the reset entry supplies the address of Reset_Handler.", flash:".isr_vector supplies initial SP + Reset_Handler", ram:"SP is now valid; startup code can execute", code:1},
        {title:"Initialize .data: copy the Flash image into RAM", text:"An initialized writable object needs its initial value after reset. The linker gives .data a RAM VMA and a Flash LMA; startup copies the bytes from _sidata to _sdata through _edata.", flash:".data initial bytes are consumed from the load image", ram:".data becomes valid writable runtime state", code:2},
        {title:"Initialize .bss: create the required zeros", text:"The .bss objects need RAM space and must begin as zero. There is no initialized payload to copy, so startup simply writes zero from _sbss through _ebss.", flash:"no .bss payload is needed", ram:".bss becomes zero-initialized runtime state", code:3},
        {title:"C runtime is ready: enter main()", text:"After the memory state required by the C program has been prepared, startup calls main(). Our startup.s does nothing else before the call, so this is the whole remaining sequence; a vendor startup inserts clock setup, FPU enable and static constructors here.", flash:"firmware image remains unchanged", ram:".data and .bss are now valid; stack is active", code:4}
      ];
      /* ---- the assembly listing ----------------------------------------
         Built from STARTUP_S_LINES rather than written out as markup, because
         the text has to be the real file's text. The strings are inserted as
         innerHTML without escaping, which is only sound because the file
         contains no "<" and no "&" - assembly has no use for either, and
         specs/startup_pseudocode.spec.js fails if a future line introduces one
         rather than letting the listing silently render as broken markup. */
      var asmHost = host.querySelector("#linklab-asm");
      var asmNote = host.querySelector("#linklab-asmnote");
      var asmRegs = host.querySelector("#linklab-regs");
      function asmLinesHtml() {
        var out = "", i;
        for (i = 0; i < STARTUP_S_LINES.length; i++) {
          out += '<span class="linklab-asmline" data-asm-line="' + (i + 1) + '" data-asm-step="' +
            STARTUP_S_STEP[i] + '"><i>' + (i + 1) + '</i>' + (STARTUP_S_LINES[i] || " ") + '</span>';
        }
        return out;
      }
      /* Every line gets an explanation. Most are hand-written in
         STARTUP_S_NOTE; the structural ones are classified by asmClassify,
         because the four kinds are the first thing a reader has to tell apart
         and a blank line is still worth naming. */
      function asmLineNote(n) {
        if (STARTUP_S_NOTE[n]) { return STARTUP_S_NOTE[n]; }
        var t = STARTUP_S_LINES[n - 1] || "";
        var kind = asmClassify(t, STARTUP_S_CMT[n - 1]);
        if (kind === "blank") { return "<b>Blank.</b> Assembly has no syntax where whitespace matters, so a blank line is a separator for the reader only. It emits nothing and costs nothing."; }
        if (kind === "comment") {
          return "<b>Comment.</b> The assembler skips this entirely: it costs no bytes and never reaches the image. It is the only part of <code>startup.s</code> that is documentation rather than instruction, and reading it is free."; 
        }
        if (kind === "directive") {
          return "<b>Assembler directive.</b> This line is not an instruction and produces no code of its own — it tells GNU <code>as</code> how to assemble what follows. Directives never appear in the disassembly, which is why a <code>.s</code> file and an <code>objdump</code> listing look nothing alike."; 
        }
        if (kind === "label") {
          return "<b>Label.</b> A name for an address, not an instruction — it costs no bytes. Branch targets are these names, and the assembler turns each one into a PC-relative offset when it sees the branch."; 
        }
        return "<b>Line " + n + ".</b> Part of this step in <code>startup.s</code>. Read it against the pseudocode above: that is the whole method for getting from a five-line summary to a working assembly file.";
      }
      function asmShowNote(n) {
        var line = host.querySelector('.linklab-asmline[data-asm-line="' + n + '"]');
        if (!line) { return; }
        Array.prototype.forEach.call(host.querySelectorAll(".linklab-asmline"), function (x) { x.classList.remove("picked"); });
        line.classList.add("picked");
        asmNote.innerHTML = '<span class="linklab-asmpick">startup.s:' + n + '</span>' + asmLineNote(n);
      }
      function asmApplyStep(n) {
        /* "picked" goes too: a line chosen under the previous step is not an
           answer to this one, and leaving its marker on screen would point at a
           step that is no longer showing. */
        Array.prototype.forEach.call(host.querySelectorAll(".linklab-asmline"), function (x) {
          x.classList.remove("active", "dim", "picked");
          if (Number(x.dataset.asmStep) === n + 1) { x.classList.add("active"); }
          else if (Number(x.dataset.asmStep) !== 0) { x.classList.add("dim"); }
        });
        var rows = STARTUP_S_REGS[n + 1] || [];
        var out = "", i;
        for (i = 0; i < rows.length; i++) {
          out += '<div><b>' + (rows[i][0] || "—") + '</b><span>' + rows[i][1] + '</span></div>';
        }
        asmRegs.innerHTML = out;
        asmNote.innerHTML = '<span class="linklab-asmhint">Pick a line — ' +
          (n + 1) + ' of 5 highlighted.</span>';
      }
      asmHost.innerHTML = asmLinesHtml();
      Array.prototype.forEach.call(host.querySelectorAll(".linklab-asmline"), function (x) {
        x.addEventListener("click", function () { asmShowNote(Number(x.dataset.asmLine)); });
      });
      Array.prototype.forEach.call(host.querySelectorAll(".linklab-resetstep"), function(b){
        b.addEventListener("click", function(){
          var n=Number(b.dataset.resetStep), d=resetSteps[n];
          Array.prototype.forEach.call(host.querySelectorAll(".linklab-resetstep"),function(x){x.classList.remove("selected");});
          b.classList.add("selected");
          host.querySelector("#linklab-reset-title").textContent=d.title;
          host.querySelector("#linklab-reset-text").textContent=d.text;
          host.querySelector("#linklab-flashtrace").textContent=d.flash;
          host.querySelector("#linklab-ramtrace").textContent=d.ram;
          Array.prototype.forEach.call(host.querySelectorAll(".linklab-code-line"),function(x){x.classList.remove("active"); if(Number(x.dataset.resetCode)===d.code)x.classList.add("active");});
          asmApplyStep(n);
          var facts=host.querySelector("#linklab-reset-facts");
          if(n===0) facts.innerHTML='<div><b>Initial SP</b><code>_estack</code><span>0x20020000 in this model</span></div><div><b>Entry point</b><code>Reset_Handler</code><span>startup.s</span></div>';
          if(n===1) facts.innerHTML='<div><b>Vector table</b><code>.isr_vector</code><span>Flash, retained with KEEP</span></div><div><b>Entry point</b><code>Reset_Handler</code><span>startup.s</span></div>';
          if(n===2) facts.innerHTML='<div><b>Source</b><code>_sidata</code><span>Flash LMA</span></div><div><b>Destination</b><code>_sdata → _edata</code><span>RAM VMA</span></div>';
          if(n===3) facts.innerHTML='<div><b>Start</b><code>_sbss</code><span>RAM</span></div><div><b>End</b><code>_ebss</code><span>RAM</span></div>';
          if(n===4) facts.innerHTML='<div><b>Ready</b><code>.data + .bss</code><span>initialized runtime state</span></div><div><b>Next</b><code>main()</code><span>application code</span></div>';
        });
      });
      asmApplyStep(0);
    }
    if (stage === "readasm") {
      /* One kind at a time in the kinds panel, driven off the same ASM_HIST
         counts as the histogram. The button is a filter, not a quiz: no wrong
         state, so the styling is a selection colour only. */
      var kindsHost = host.querySelector("#readasm-kinds");
      if (kindsHost) {
        Array.prototype.forEach.call(kindsHost.querySelectorAll(".readasm-kind"), function (x) {
          x.addEventListener("click", function () {
            var on = !x.classList.contains("on");
            Array.prototype.forEach.call(kindsHost.querySelectorAll(".readasm-kind"), function (y) { y.classList.remove("on"); });
            x.classList.toggle("on", on);
            Array.prototype.forEach.call(host.querySelectorAll(".readasm-histrow"), function (y) {
              y.classList.toggle("on", on && y.dataset.rh === x.dataset.rk);
            });
          });
        });
        Array.prototype.forEach.call(host.querySelectorAll(".readasm-histrow"), function (b) {
          b.addEventListener("click", function () {
            var k = kindsHost.querySelector('.readasm-kind[data-rk="' + b.dataset.rh + '"]');
            if (k) { k.click(); }
          });
        });
      }
      var detail = host.querySelector("#readasm-detail");
      function readasmShow(k) {
        var d = READASM_LINES[k];
        if (!d || !detail) { return; }
        var text = STARTUP_S_LINES[d.n - 1] || "";
        var out = '<span class="readasm-ranote">startup.s:' + d.n + '</span>';
        out += '<code class="readasm-src">' + esc(text.replace(/^\s+/, "")) + '</code>';
        out += '<table class="readasm-fields"><tr><th>Field</th><th>Role</th><th>What it means</th></tr>';
        for (var i = 0; i < d.fields.length; i++) {
          out += '<tr><td><code>' + esc(d.fields[i][0]) + '</code></td><td>' + esc(d.fields[i][1]) + '</td><td>' + d.fields[i][2] + '</td></tr>';
        }
        out += "</table>";
        /* Only the pseudo-instruction has an expansion, so the block is
           conditional on the data rather than always present and empty. */
        if (d.expands) {
          out += '<p class="readasm-expands"><b>' + esc(d.expands) + '</b></p><ul class="readasm-pieces">';
          for (var j = 0; j < d.pieces.length; j++) { out += "<li>" + d.pieces[j] + "</li>"; }
          out += "</ul>";
        }
        out += '<p class="readasm-why">' + d.why + "</p>";
        detail.innerHTML = out;
      }
      Array.prototype.forEach.call(host.querySelectorAll("button[data-ra]"), function (b) {
        b.addEventListener("click", function () {
          Array.prototype.forEach.call(host.querySelectorAll("button[data-ra]"), function (x) { x.classList.remove("selected"); });
          b.classList.add("selected");
          readasmShow(b.dataset.ra);
        });
      });
      var firstRa = host.querySelector('button[data-ra="insn"]');
      if (firstRa) { firstRa.click(); }
    }
  }

