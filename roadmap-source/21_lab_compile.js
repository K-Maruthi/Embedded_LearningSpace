  /* ---------------- Compilation Path Lab ---------------- */
  var COMPILE_DATA = {
    source: {
      title: "Start with one small C program",
      intro: "Use one fixed example so every transformation can be traced to the same source lines.",
      body: `<div class="complab-grid"><div class="complab-card"><h4>main.c</h4><pre class="complab-code">#define LIMIT 10
static uint32_t counter = 3;

uint32_t add_limit(uint32_t x)
{
    return x + LIMIT;
}

int main(void)
{
    uint32_t y = add_limit(counter);
    return (int)y;
}</pre></div><div class="complab-card"><h4>What the compiler must eventually preserve</h4><ul><li><code>counter</code> has static storage duration and an initial value.</li><li><code>LIMIT</code> is a preprocessor macro, not a runtime variable.</li><li><code>add_limit()</code> is executable code.</li><li><code>y</code> is an automatic local used while <code>main()</code> runs.</li><li>The final machine code must preserve the observable behavior, not the original C syntax.</li></ul><div class="complab-note"><strong>Key idea:</strong> compilation is a sequence of representations. C source is not gradually “placed in memory”; it is transformed into lower-level representations until the linker can combine machine-code objects into a final image.</div></div></div><div class="complab-flow"><div class="complab-node"><b>C source</b><span>main.c</span></div><div class="complab-arrow">→</div><div class="complab-node"><b>preprocessed C</b><span>macros/includes resolved</span></div><div class="complab-arrow">→</div><div class="complab-node"><b>assembly</b><span>target instructions</span></div><div class="complab-arrow">→</div><div class="complab-node"><b>object</b><span>machine code + metadata</span></div><div class="complab-arrow">→</div><div class="complab-node"><b>ELF</b><span>linked image</span></div></div>`
    },
    preprocess: {
      title: "Preprocessing changes the source before the compiler sees it",
      intro: "The preprocessor handles directives such as #define and #include. It does not allocate RAM, choose final addresses, or generate the final machine code.",
      body: `<div class="complab-grid"><div class="complab-card"><h4>Relevant transformation</h4><pre class="complab-code">#define LIMIT 10

uint32_t add_limit(uint32_t x)
{
    return x + LIMIT;
}</pre><div class="complab-note">The compiler effectively receives the macro-expanded form:</div><pre class="complab-code">uint32_t add_limit(uint32_t x)
{
    return x + 10;
}</pre></div><div class="complab-card"><h4>What preprocessing does not do</h4><ul><li>It does not decide whether <code>counter</code> is in <code>.data</code>.</li><li>It does not assign a Flash or RAM address.</li><li>It does not resolve linker symbols.</li><li>It does not produce the final executable image.</li></ul><div class="complab-tokens"><span class="complab-token"><b>#define</b> textual substitution</span><span class="complab-token"><b>#include</b> source expansion</span><span class="complab-token"><b>#if</b> conditional source selection</span></div></div></div><div class="complab-note"><strong>Boundary:</strong> preprocessing answers “what source text should the compiler see?” The compiler answers “what target instructions implement that source?”</div>`
    },
    compile: {
      title: "Compilation turns C meaning into target assembly",
      intro: "The C compiler analyzes types, control flow and expressions, then selects instructions for the target CPU and emits assembly or an equivalent lower-level representation.",
      body: `<div class="complab-grid"><div class="complab-card"><h4>Before</h4><pre class="complab-code">return x + 10;</pre></div><div class="complab-card"><h4>After — conceptual Cortex-M assembly</h4><pre class="complab-code">adds    r0, r0, #10
bx      lr</pre><p>The exact instructions depend on compiler version, options, ABI and optimization level. The teaching point is the change of representation.</p></div></div><div class="complab-check"><div class="complab-check-head">What changed?</div><div class="complab-check-body"><div class="complab-choices" data-cq="compile" data-ok="a"><button type="button" data-a="a">C syntax → target instructions</button><button type="button" data-a="b">RAM addresses → C variables</button><button type="button" data-a="c">ELF → preprocessor text</button></div><div class="complab-answer" data-ca="compile" hidden>Correct. The compiler lowers the C program into instructions and target-specific low-level constructs; final placement still belongs to the linker.</div></div></div><div class="complab-note"><strong>Important distinction:</strong> optimization can change the instruction sequence dramatically while preserving the required program behavior. Therefore “one C statement = one instruction” is not a valid model.</div>`
    },
    assemble: {
      title: "Assembly becomes a relocatable object",
      intro: "The assembler turns assembly instructions and data directives into machine-code bytes plus metadata needed by later build stages.",
      body: `<div class="complab-grid"><div class="complab-card"><h4>Input</h4><pre class="complab-code">adds    r0, r0, #10
bx      lr</pre></div><div class="complab-card"><h4>Output</h4><div class="complab-artifact"><button type="button" data-art="code"><code>.text</code><span>machine-code bytes for executable instructions</span></button><button type="button" data-art="symbols"><code>symbols</code><span>names such as <code>add_limit</code> that later stages may reference</span></button><button type="button" data-art="reloc"><code>relocations</code><span>records describing addresses or references the linker still needs to fix</span></button></div><div class="complab-detail" id="complab-art-detail"><div><b>Selected</b><span>Select an object component.</span></div></div></div></div><div class="complab-note"><strong>Relocatable means:</strong> the object contains machine code, but its final memory address is not yet known. The linker can still place its sections into the MCU memory map.</div>`
    },
    object: {
      title: "The .o file is the hand-off between compilation and linking",
      intro: "An object file is not yet firmware. It contains sections, symbols and relocation information that allow multiple separately-built pieces to be combined.",
      body: `<div class="complab-grid"><div class="complab-card"><h4>Teaching view of main.o</h4><table class="linklab-table"><tr><th>Object part</th><th>Purpose</th></tr><tr><td><code>.text</code></td><td>compiled instructions</td></tr><tr><td><code>.rodata</code></td><td>read-only constants when emitted separately</td></tr><tr><td><code>.data</code></td><td>initialized writable static data such as <code>counter</code></td></tr><tr><td>symbols</td><td>names and references used across object files</td></tr><tr><td>relocations</td><td>places where final addresses are still unresolved</td></tr></table></div><div class="complab-card"><h4>What is still missing?</h4><ul><li>The final address of <code>add_limit</code>.</li><li>The final address of <code>counter</code>.</li><li>The placement of each output section in Flash or RAM.</li><li>References to startup code and other objects.</li></ul><div class="complab-note">That missing information is why the object file is <strong>relocatable</strong>.</div></div></div><div class="complab-flow"><div class="complab-node"><b>main.o</b><span>sections + symbols + relocations</span></div><div class="complab-arrow">+</div><div class="complab-node"><b>startup.o</b><span>vector table + reset handler</span></div><div class="complab-arrow">+</div><div class="complab-node"><b>linker.ld</b><span>placement policy</span></div><div class="complab-arrow">→</div><div class="complab-node"><b>firmware.elf</b><span>final linked addresses</span></div></div>`
    },
    link: {
      title: "The linker resolves the whole program",
      intro: "The linker combines object files, resolves cross-object references, applies the linker script, assigns final addresses, and produces the linked ELF.",
      body: `<div class="complab-grid"><div class="complab-card"><h4>Inputs to the link</h4><div class="complab-artifact"><button type="button"><code>main.o</code><span>application sections, symbols and relocations</span></button><button type="button"><code>startup.o</code><span>vector table and reset handler</span></button><button type="button"><code>linker.ld</code><span>Flash/RAM regions and output-section rules</span></button></div></div><div class="complab-card"><h4>What the linker decides</h4><ul><li>Where output sections live.</li><li>Which references point to which final addresses.</li><li>Which linker-defined symbols have which values.</li><li>Whether the image fits the declared memory regions.</li></ul></div></div><div class="complab-note"><strong>Connection to the previous section:</strong> this is where <code>&gt; FLASH</code>, <code>&gt; RAM AT &gt; FLASH</code>, <code>_estack</code>, <code>_sdata</code> and the other linker-script decisions become concrete addresses in the ELF.</div><div class="complab-flow"><div class="complab-node"><b>relocatable</b><span>addresses still adjustable</span></div><div class="complab-arrow">→</div><div class="complab-node"><b>linker</b><span>resolve + place + check</span></div><div class="complab-arrow">→</div><div class="complab-node"><b>ELF</b><span>linked address space</span></div></div>`
    },
    image: {
      title: "Post-link tools turn the linked image into programming formats",
      intro: "The ELF is the rich linked representation. A binary or other programming format is derived from it for the flashing toolchain.",
      body: `<div class="complab-grid"><div class="complab-card"><h4>firmware.elf</h4><ul><li>final addresses</li><li>sections</li><li>symbols and debug information when retained</li><li>metadata useful for debugging and inspection</li></ul></div><div class="complab-card"><h4>firmware.bin</h4><ul><li>raw loadable bytes</li><li>no ELF symbol/debug structure</li><li>commonly used as a programming payload when the flashing workflow expects a binary image</li></ul></div></div><div class="complab-flow"><div class="complab-node"><b>firmware.elf</b><span>rich linked representation</span></div><div class="complab-arrow">→</div><div class="complab-node"><b>objcopy</b><span>select/convert loadable content</span></div><div class="complab-arrow">→</div><div class="complab-node"><b>firmware.bin</b><span>programming payload</span></div></div><div class="complab-note"><strong>Do not confuse the two:</strong> the binary image is not a “more complete” ELF. It is a simpler representation derived from the linked image.</div>`
    },
    check: {
      title: "Check: can you follow one value through the path?",
      intro: "Reason from the source representation to the final artifact. The goal is to know what each tool changes and what it deliberately leaves for the next stage.",
      body: `<div class="complab-grid"><div class="complab-card"><h4>Question 1</h4><p><code>#define LIMIT 10</code> is expanded before compilation. Which stage owns that transformation?</p><div class="complab-choices" data-cq="q1" data-ok="a"><button type="button" data-a="a">Preprocessor</button><button type="button" data-a="b">Linker</button><button type="button" data-a="c">objcopy</button></div><div class="complab-answer" data-ca="q1" hidden>Correct. The preprocessor expands the macro before the C compiler analyzes the resulting source.</div></div><div class="complab-card"><h4>Question 2</h4><p><code>counter = 3</code> needs a runtime RAM address. Which stage applies the linker script's <code>.data &gt; RAM AT &gt; FLASH</code> policy?</p><div class="complab-choices" data-cq="q2" data-ok="b"><button type="button" data-a="a">Compiler</button><button type="button" data-a="b">Linker</button><button type="button" data-a="c">Assembler</button></div><div class="complab-answer" data-ca="q2" hidden>Correct. The linker combines the object files and applies the output-section placement rules.</div></div></div><div class="complab-check"><div class="complab-check-head">Teach it back</div><div class="complab-check-body"><p>Put these in causal order:</p><div class="complab-choices" id="complab-order"><button type="button" data-order="1">C source</button><button type="button" data-order="4">object file</button><button type="button" data-order="2">preprocessed source</button><button type="button" data-order="6">ELF</button><button type="button" data-order="3">assembly</button><button type="button" data-order="5">linked image</button></div><div class="complab-answer" id="complab-order-result" hidden>Correct: C source → preprocessed source → assembly → object file → linked image → ELF.</div></div></div><div class="complab-note"><strong>Final mental model:</strong> each stage consumes one representation and produces another. The important question is always: <em>what information is decided here, and what information is intentionally left for the next stage?</em></div>`
    }
  };
  var compileLabStage = "source", compileLabInited = false;
  function initCompileLab() {
    if (!compileLabInited) {
      var nav=document.getElementById("complab-progress");
      if(nav){Array.prototype.forEach.call(nav.querySelectorAll("button[data-compile-stage]"),function(b){b.addEventListener("click",function(){renderCompileLab(b.dataset.compileStage);});});}
      compileLabInited=true;
    }
    renderCompileLab(compileLabStage);
    clabBoot();
  }
  function renderCompileLab(stage) {
    if(!COMPILE_DATA[stage]) stage="source";
    compileLabStage=stage;
    var host=document.getElementById("complab-stage"), nav=document.getElementById("complab-progress");
    if(!host||!nav)return;
    var d=COMPILE_DATA[stage];
    walkMark("compile", stage);
    journalMount("compile", stage, d.title);
    Array.prototype.forEach.call(nav.querySelectorAll("button[data-compile-stage]"),function(b){
      b.setAttribute("aria-selected",String(b.dataset.compileStage===stage));
      /* Ok/failed marks come from the report this mode is showing, so the rail
         says where a build stopped without opening the Check stage. */
      var st = clabStageOut(b.dataset.compileStage);
      if (st) { b.setAttribute("data-st", st.ok ? "ok" : "bad"); } else { b.removeAttribute("data-st"); }
    });
    var body = (clab.mode === "bench") ? clabBenchHtml(stage) : d.body;
    var live = clabLiveHtml(stage);
    var benchTag = (clab.mode === "bench") ? '<span class="clab-modebadge">lab bench</span>' : '';
    host.innerHTML='<div class="complab-stage-head"><h3>'+esc(d.title)+benchTag+'</h3><p>'+esc(d.intro)+'</p></div><div class="complab-body">'+body+'</div>'+
      (live ? '<section class="complab-live" aria-label="Real tool output">'+live+'</section>' : "");
    var retry=host.querySelector("#clab-retry");
    if(retry){retry.addEventListener("click",clabRetry);}
    clabWireBench(host);
    Array.prototype.forEach.call(host.querySelectorAll(".complab-choices[data-cq] button"),function(b){b.addEventListener("click",function(){var box=b.parentNode,key=box.dataset.cq;Array.prototype.forEach.call(box.querySelectorAll("button"),function(x){x.classList.remove("correct","wrong");});var ok=b.dataset.a===box.dataset.ok;b.classList.add(ok?"correct":"wrong");var ans=host.querySelector('[data-ca="'+key+'"]');if(ans)ans.hidden=!ok;});});
    Array.prototype.forEach.call(host.querySelectorAll("[data-art]"),function(b){b.addEventListener("click",function(){Array.prototype.forEach.call(host.querySelectorAll("[data-art]"),function(x){x.classList.remove("selected");});b.classList.add("selected");var text={code:"The assembler has emitted target instruction bytes into an executable input section. The bytes are real machine code, but their final address can still change during linking.",symbols:"Symbols preserve names and relationships that later stages can resolve or expose for debugging. A symbol is not itself a machine instruction.",reloc:"A relocation records a location that depends on a final address or symbol value. The linker uses these records when combining objects."};var d=host.querySelector("#complab-art-detail");if(d)d.innerHTML='<div><b>Selected</b><span>'+text[b.dataset.art]+'</span></div>';});});
    if(stage==="check"){
      var order=host.querySelector("#complab-order"), result=host.querySelector("#complab-order-result"), next=1;
      if(order)Array.prototype.forEach.call(order.querySelectorAll("button"),function(b){b.addEventListener("click",function(){var n=Number(b.dataset.order);if(n===next){b.classList.add("correct");b.disabled=true;next++;if(next===7)result.hidden=false;}else{b.classList.add("wrong");setTimeout(function(){b.classList.remove("wrong");},650);}});});
    }
  }

  /* ---- Compilation Path Lab: real toolchain (Tauri commands toolchain_status /
     pipeline_run). The static teaching content above is never replaced; this is
     an additive panel with what the actual gcc/objdump/size/objcopy produced. */
  var clab = { booted: false, status: "idle", info: null, report: null, benchReport: null, err: "",
    mode: "teach", srcs: { mainC: "", startupS: "", linkerLd: "" }, defaults: null, hasDraft: false };
  var K_BENCH = "ecroadmap.bench.v1";
  (function clabLoadDraft() {
    var d = rd(K_BENCH, null);
    if (d && d.srcs && typeof d.srcs === "object") { clab.srcs.mainC = d.srcs.mainC || ""; clab.srcs.startupS = d.srcs.startupS || ""; clab.srcs.linkerLd = d.srcs.linkerLd || ""; clab.hasDraft = !!(d.srcs.mainC || d.srcs.startupS || d.srcs.linkerLd); }
    if (d && d.mode === "bench") { clab.mode = "bench"; }
  })();
  function clabSaveDraft() { wr(K_BENCH, { srcs: clab.srcs, mode: clab.mode }); }
  function clabInvoke(cmd, args) {
    var T = window.__TAURI__;
    return (T && T.core && T.core.invoke) ? T.core.invoke(cmd, args || {}) : null;
  }
  /* Which report a stage shows. Teaching always shows the fixed example's real
     output; the bench shows your last build once there is one, and falls back to
     the fixed example (labelled as such) until then. Two reports, deliberately:
     a bench build must not leak into the teaching stages. */
  function clabReport() {
    return (clab.mode === "bench" && clab.benchReport) ? clab.benchReport : clab.report;
  }
  function clabSourceTag(rep) { return (rep && rep.custom) ? "your bench sources" : "the fixed example"; }
  /* The first stage the real tools stopped at, so a failed bench build can land
     on it the way a compiler takes you to the first error. */
  function clabFirstFailure(rep) {
    var st = (rep && rep.stages) || [];
    for (var i = 0; i < st.length; i++) { if (!st[i].ok) { return st[i].id; } }
    return null;
  }
  function clabStageOut(id) {
    var rep = clabReport();
    var st = (rep && rep.stages) || [];
    for (var i = 0; i < st.length; i++) { if (st[i].id === id) { return st[i]; } }
    return null;
  }
  function clabBadge(ok) { return '<span class="clab-badge ' + (ok ? "ok" : "bad") + '">' + (ok ? "ok" : "failed") + "</span>"; }
  function clabCmds(list) {
    if (!list || !list.length) { return ""; }
    return '<div class="clab-cmds">' + list.map(function (c) { return "<code>" + esc(c) + "</code>"; }).join("") + "</div>";
  }
  /* `hl` styles pre.hl (see 01_head.html), so the real tool output — assembly,
     preprocessed C, the map file — is colour-highlighted in its own language
     rather than as C (hlModeFor picks the mode from the artifact's filename). */
  function clabFold(label, html, open) {
    return "<details" + (open === false ? "" : " open") + "><summary>" + esc(label) + "</summary><pre class=\"hl\">" + html + "</pre></details>";
  }
  function clabBlock(s) {
    var h = '<div class="clab-block' + (s.ok ? "" : " clab-bad") + '">';
    h += clabCmds(s.commands);
    if (s.stdout && s.stdout.trim()) { h += clabFold("output", esc(s.stdout)); }
    if (s.stderr && s.stderr.trim()) { h += clabFold(s.ok ? "messages (warnings etc.)" : "error output", esc(s.stderr)); }
    Array.prototype.forEach.call(s.artifacts || [], function (a) {
      var isCode = /\.(c|s|ld|i)(\b|$|\s|\u2014)/i.test(a.name) || /^main\.(s|i)/.test(a.name);
      h += clabFold(a.name, isCode ? hl(a.text, hlModeFor(a.name)) : esc(a.text));
    });
    return h + "</div>";
  }
  var CLAB_TITLES = {
    source: "The exact sources the real tools received",
    preprocess: "gcc -E produced this", compile: "gcc -S produced this assembly",
    assemble: "The assembler ran twice", object: "Inside the relocatable objects (objdump)",
    link: "The link produced a real ELF", image: "objcopy extracted a flat image"
  };
  function clabMissingHtml() {
    return '<p class="clab-note">Install an Arm GNU toolchain and press retry \u2014 nothing else in this app changes:</p>' +
      '<ul class="clab-list">' +
      '<li>winget: <code>winget install --id Arm.ArmGnuToolchain</code></li>' +
      '<li>or an xPack zip: extract it and add its <code>bin</code> folder to PATH</li>' +
      '<li>or set <code>ECROADMAP_ARM_GCC</code> to the full path of <code>arm-none-eabi-gcc.exe</code></li>' +
      "</ul><button type=\"button\" class=\"btn\" id=\"clab-retry\">Retry detection</button>";
  }
  function clabLiveHtml(stage) {
    if (clab.status === "web" || clab.status === "idle") { return ""; }
    if (clab.mode === "bench" && stage === "source") { return ""; }
    var h = '<h4 class="complab-live-head">real tool output</h4>';
    if (clab.status === "checking" || clab.status === "building") {
      return h + '<p class="clab-note">' + (clab.status === "building" ? "building your bench sources" : "running the fixed example through the real toolchain") + " in a temp folder\u2026</p>";
    }
    if (clab.status === "missing" || clab.status === "error") {
      return h + '<p class="clab-note">arm-none-eabi-gcc was not found, so this stage shows the teaching model only.</p>' + clabMissingHtml();
    }
    var rep = clabReport();
    if (!rep || !rep.stages || !rep.stages.length) { return h + '<p class="clab-note">no pipeline result yet.</p>'; }
    if (stage === "check") {
      var rows = rep.stages.map(function (s) {
        return '<div class="clab-row">' + clabBadge(s.ok) + "<b>" + esc(s.id) + "</b>" + clabCmds(s.commands) + "</div>";
      }).join("");
      return h + '<p class="clab-note">Every representation above was produced by these real commands from ' +
        esc(clabSourceTag(rep)) + (rep.ok ? "." : " \u2014 the run stopped early; inspect the failing stage's error output.") + "</p>" +
        '<div class="clab-block">' + rows + "<p class=\"clab-note\">toolchain: <code>" + esc(rep.toolchain) + "</code></p></div>";
    }
    var s = clabStageOut(stage);
    if (!s) { return h + '<p class="clab-note">this stage has no live output.</p>'; }
    return h + "<p class=\"clab-note\">" + esc(CLAB_TITLES[stage] || "") + " \u00b7 " + clabBadge(s.ok) +
      " \u00b7 " + esc(clabSourceTag(rep)) + "</p>" + clabBlock(s);
  }
  function clabChip() {
    var host = document.getElementById("complab-toolchain");
    if (!host) { return; }
    var t = "", cls = "clab-chip";
    if (clab.status === "checking") { t = "checking for arm-none-eabi-gcc\u2026"; }
    else if (clab.status === "building") { t = "building bench sources\u2026"; }
    else if (clab.status === "ready") { t = "live toolchain \u00b7 gcc " + ((clab.info && clab.info.version) || "?"); cls += " ok"; }
    else if (clab.status === "failed") { t = "toolchain ran \u00b7 pipeline stopped early"; cls += " warn"; }
    else if (clab.status === "missing") { t = "no toolchain \u00b7 teaching model only"; cls += " warn"; }
    else if (clab.status === "error") { t = "toolchain error"; cls += " warn"; }
    else if (clab.status === "web") { t = "real tool output: desktop app only"; }
    else { host.innerHTML = ""; return; }
    var allowBench = !!(clab.info && clab.info.found);
    if (!allowBench) { clab.mode = "teach"; }
    host.innerHTML = '<span class="' + cls + '">' + esc(t) + "</span>" +
      (allowBench ? '<span class="clab-modes"><button type="button" data-m="teach" aria-pressed="' + String(clab.mode !== "bench") + '" class="' + (clab.mode !== "bench" ? "on" : "") + '">Teaching</button><button type="button" data-m="bench" aria-pressed="' + String(clab.mode === "bench") + '" class="' + (clab.mode === "bench" ? "on" : "") + '">Lab bench</button></span>' : "");
    Array.prototype.forEach.call(host.querySelectorAll(".clab-modes button"), function (b) {
      b.addEventListener("click", function () {
        if (clab.mode === b.dataset.m) { return; }
        clab.mode = b.dataset.m; clabSaveDraft();
        Array.prototype.forEach.call(host.querySelectorAll(".clab-modes button"), function (x) {
          var on = x.dataset.m === clab.mode;
          x.classList.toggle("on", on);
          x.setAttribute("aria-pressed", String(on));
        });
        renderCompileLab(compileLabStage);
      });
    });
  }
  function clabAfter() {
    clabChip();
    if (currentView === "compile") { renderCompileLab(compileLabStage); }
  }
  function clabBoot() {
    if (clab.booted) { return; }
    clab.booted = true;
    var p = clabInvoke("toolchain_status");
    if (!p) { clab.status = "web"; clabChip(); return; }
    clab.status = "checking";
    clabAfter();
    p.then(function (info) {
      clab.info = info;
      if (!info || !info.found) { clab.status = "missing"; clabAfter(); return; }
      var def = clabInvoke("pipeline_sources");
      if (def && def.then) { def.then(function (bs) {
        clab.defaults = bs;
        if (!clab.hasDraft) { clab.srcs = { mainC: bs.mainC, startupS: bs.startupS, linkerLd: bs.linkerLd }; clabSaveDraft(); }
      }, function () { /* bench stays empty */ }); }
      clabInvoke("pipeline_run").then(function (rep) {
        clab.report = rep;
        clab.status = (rep && rep.ok) ? "ready" : "failed";
        clabAfter();
      }, function (e) {
        clab.err = String(e);
        clab.status = /toolchain-not-found/.test(clab.err) ? "missing" : "error";
        clabAfter();
      });
    }, function (e) { clab.err = String(e); clab.status = "error"; clabAfter(); });
  }
  function clabRetry() { clab.booted = false; clab.status = "idle"; clab.report = null; clab.benchReport = null; clabBoot(); }

  /* ---- Lab bench: editable sources + explanations parsed from the real build ---- */
  function clabBenchBar() {
    var busy = clab.status === "building" || clab.status === "checking";
    var can = !busy && !!(clab.info && clab.info.found);
    return '<div class="clab-benchbar">' +
      '<button type="button" class="btn" id="clab-build"' + (can ? "" : " disabled") + '>' + (busy ? "building\u2026" : "Build with these sources") + "</button>" +
      '<button type="button" class="btn" id="clab-restore"' + (can ? "" : " disabled") + ">Restore the example</button>" +
      '<span class="clab-note">' + (clab.benchReport ? (clab.benchReport.custom ? "last build: your bench sources" : "last build: the fixed example") : "nothing built from the bench yet") + "</span></div>";
  }
  function clabEd(label, key) {
    return '<label class="clab-edwrap"><span class="clab-edlabel"><span>' + esc(label) + "</span><button type=\"button\" class=\"clab-mini\" data-restore=\"" + key + '\">restore</button></span>' +
      '<textarea class="clab-ed" data-src="' + key + '" spellcheck="false" aria-label="' + esc(label) + '">' + esc(clab.srcs[key] || "") + "</textarea></label>";
  }
  function clabBenchHtml(stage) {
    var h = clabBenchBar();
    if (stage === "source") {
      h += '<div class="clab-editors">' + clabEd("main.c", "mainC") + clabEd("startup.s", "startupS") + clabEd("linker.ld", "linkerLd") + "</div>" +
        '<p class="clab-note">The tools see exactly these bytes. Filenames, flags and the stage order stay fixed \u2014 the only variable is your code. Build runs the real arm-none-eabi pipeline in a temp folder.</p>';
    } else if (stage === "check") {
      h += '<p class="clab-note">Every teaching question still works here; the real command list below reflects your last build.</p>';
    } else {
      h += clabFacts(stage);
    }
    return h;
  }
  function clabArtOf(stageId, artStart) {
    var s = clabStageOut(stageId);
    if (!s) { return ""; }
    for (var i = 0; i < s.artifacts.length; i++) { if (s.artifacts[i].name.indexOf(artStart) === 0) { return s.artifacts[i].text; } }
    return "";
  }
  function clabFacts(stage) {
    var rep = clabReport();
    if (!rep || !rep.stages || !rep.stages.length) {
      return '<p class="clab-note">Nothing built from the bench yet \u2014 edit the sources in stage 1, then press Build.</p>';
    }
    var L = [], i, m, txt, stopped = null;
    for (i = 0; i < rep.stages.length; i++) { if (!rep.stages[i].ok) { stopped = rep.stages[i].id; } }
    if (stopped) { L.push("the real tools stopped at <b>" + esc(stopped) + "</b> \u2014 fix that stage first; later stages show the previous successful build."); }
    if (clab.mode === "bench" && !clab.benchReport) {
      L.push("you have not built the bench sources yet \u2014 press <b>Build with these sources</b> to replace these fixed-example observations.");
    }
    if (stage === "preprocess") {
      txt = clabArtOf("preprocess", "main.i");
      var defs = (clab.srcs.mainC.match(/^[ \t]*#[ \t]*define/gm) || []).length;
      L.push(txt && /#[ \t]*define/.test(txt)
        ? "careful: a <code>#define</code> is still visible in the excerpt \u2014 check the macro spelling."
        : (defs ? defs + " #define directive" + (defs === 1 ? " was" : "s were") + " in your main.c; none survive into main.i \u2014 only the expanded text does." : "your main.c has no #define; includes were still expanded in place."));
      L.push("lines like <code># 1 \u0026quot;main.c\u0026quot;</code> are preprocessor line markers \u2014 bookkeeping for the compiler, not C statements.");
    }
    if (stage === "compile") {
      txt = clabArtOf("compile", "main.s");
      var funcs = [], rx = /^([A-Za-z_][A-Za-z0-9_.]*):$/gm;
      while ((m = rx.exec(txt))) { if (m[1].indexOf(".L") !== 0) { funcs.push(m[1]); } }
      if (funcs.length) { L.push("your functions became assembly labels: " + funcs.map(esc).join(", ") + "."); }
      var ins = (txt.match(/^\s+(?:[a-z][a-z0-9.]*)\s+\S/gm) || []).length;
      L.push("about " + ins + " instruction/assembler lines came out at <code>-O1</code> \u2014 change the optimization level in your code shape, not the syntax, and this number moves.");
    }
    if (stage === "assemble") {
      L.push("<code>gcc -c</code> ran twice: main.s \u2192 main.o and startup.s \u2192 startup.o. Machine-code bytes plus section/symbol metadata \u2014 final addresses are still missing on purpose.");
    }
    if (stage === "object") {
      var os = clabStageOut("object"); txt = os ? os.stdout : "";
      var seen = {}, rx2 = /^\s*\d+\s+(\.\S+)\s+([0-9a-f]{2,})\s/gm;
      while ((m = rx2.exec(txt))) {
        var nm = m[1], sz = parseInt(m[2], 16);
        if (isNaN(sz) || nm.indexOf(".gnu.") === 0 || nm.indexOf(".comment") === 0 || nm.indexOf(".ARM") === 0) { continue; }
        seen[nm] = (seen[nm] || 0) + sz;
      }
      var parts = Object.keys(seen).map(function (k) { return "<code>" + esc(k) + "</code> " + seen[k] + " B"; });
      if (parts.length) { L.push("section sizes straight from objdump: " + parts.join(" \u00b7 ") + "."); }
      if (txt.indexOf("*UND*") >= 0) { L.push("symbols marked <code>*UND*</code> are unresolved on purpose \u2014 that is the linker's job in stage 6."); }
    }
    if (stage === "link") {
      var ls = clabStageOut("link"); txt = ls ? ls.stdout : "";
      m = txt.match(/\n\s*(\d+)\s+(\d+)\s+(\d+)\s+\d+\s+[0-9a-f]+\s+\S+/);
      if (m) { L.push("the linker packed the program as <code>text " + m[1] + " B</code> (Flash) \u00b7 <code>data " + m[2] + " B</code> (RAM + a Flash init image) \u00b7 <code>bss " + m[3] + " B</code> (RAM only, no Flash bytes)."); }
      if (txt.indexOf("overflowed") >= 0) { L.push("the image does not fit the MEMORY regions \u2014 the linker refused to place it. Shrink the program or fix the regions."); }
    }
    if (stage === "image") {
      var im = clabStageOut("image"); txt = im ? im.stdout : "";
      m = txt.match(/^\s*00000000\s+((?:[0-9A-F]{2} ){8,})/m);
      if (m) {
        var by = m[1].trim().split(" ").map(function (h) { return parseInt(h, 16); });
        var w0 = (by[0] | (by[1] << 8) | (by[2] << 16) | (by[3] << 24)) >>> 0;
        var w1 = (by[4] | (by[5] << 8) | (by[6] << 16) | (by[7] << 24)) >>> 0;
        L.push("word 0 of the image is <code>0x" + w0.toString(16).toUpperCase() + "</code> \u2014 the initial stack pointer <code>_estack</code>; word 1 is <code>0x" + w1.toString(16).toUpperCase() + "</code> \u2014 the Reset_Handler address. The vector table is first because the linker script placed <code>.isr_vector</code> at Flash origin.");
      }
    }
    return L.length ? '<div class="clab-facts"><b>' + (rep.custom ? "from your bench build" : "from the fixed example") + '</b><ul>' + L.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul></div>"
      : '<p class="clab-note">no automatic observations for this stage \u2014 the raw output below is the evidence.</p>';
  }
  function clabBuild() {
    if (!clab.info || !clab.info.found || clab.status === "building") { return; }
    var p = clabInvoke("pipeline_run", { sources: { mainC: clab.srcs.mainC, startupS: clab.srcs.startupS, linkerLd: clab.srcs.linkerLd } });
    if (!p) { return; }
    clab.status = "building";
    clabAfter();
    p.then(function (rep) {
      clab.benchReport = rep;
      clab.status = (rep && rep.ok) ? "ready" : "failed";
      /* Land on the stage that stopped, the way a compiler takes you to the first
         error: the per-stage views below are where the fix is. */
      var f = clabFirstFailure(rep);
      if (f && COMPILE_DATA[f]) { compileLabStage = f; }
      clabAfter();
    }, function (e) {
      clab.err = String(e);
      /* A build error is shown as a dismissible notice (notice() in 20_app.js),
         not window.alert — the app's only blocking modal, and one that could not
         sit next to the stage it belonged to. */
      if (/too large/.test(clab.err)) {
        notice(clab.err, "error");
        clab.status = (clab.benchReport && clab.benchReport.ok) ? "ready" : "failed";
      } else if (/toolchain-not-found/.test(clab.err)) {
        clab.status = "missing";
      } else {
        clab.status = "error";
        notice("Build failed to start: " + clab.err, "error");
      }
      clabAfter();
    });
  }
  function clabRestore(key) {
    if (!clab.defaults) { return; }
    var keys = key ? [key] : ["mainC", "startupS", "linkerLd"];
    keys.forEach(function (k) { clab.srcs[k] = clab.defaults[k] || ""; });
    clabSaveDraft();
    if (currentView === "compile") { renderCompileLab(compileLabStage); }
  }
  function clabWireBench(host) {
    var b = host.querySelector("#clab-build");
    if (b) { b.addEventListener("click", clabBuild); }
    var r = host.querySelector("#clab-restore");
    if (r) { r.addEventListener("click", function () { clabRestore(null); }); }
    Array.prototype.forEach.call(host.querySelectorAll(".clab-ed"), function (t) {
      t.addEventListener("input", function () { clab.srcs[t.dataset.src] = t.value; clabSaveDraft(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll("[data-restore]"), function (bt) {
      bt.addEventListener("click", function (e) { e.preventDefault(); clabRestore(bt.dataset.restore); });
    });
  }

