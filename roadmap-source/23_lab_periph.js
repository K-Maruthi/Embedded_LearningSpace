  /* ---------------- peripheral playground (N4) — staged curriculum ---------------- */
  var K_PERIPH = "ecroadmap.periph.v1";
  var PF_TICK_MS = 100;        /* real ms between sim ticks (10 Hz) */
  var PF_CLK_PER_TICK = 100;   /* timer-clock counts that elapse per tick — 1 kHz scaled */
  var PF_LOG_MAX = 80;
  var PF_ISR_MS = 400;         /* a handler stays on the CPU for this long — makes preemption observable */
  var PF_TIM2_IRQ_BIT = 28;    /* Cortex-M4 STM32F4 TIM2 global IRQ position in ISER0 */
  var PF_TIM3_IRQ_BIT = 29;    /* TIM3 sits right next to TIM2 in ISER0 */
  /* The only two NVIC lines this model owns. ISER/ICER writes are masked to them,
     and a write that touches any other line says so in the log instead of being
     silently absorbed. */
  var PF_NVIC_IRQ_MASK = ((1 << PF_TIM2_IRQ_BIT) | (1 << PF_TIM3_IRQ_BIT)) >>> 0;

  /* the two IRQ sources the model knows about */
  var PF_IRQS = {
    TIM2: { key: "tim2", bit: PF_TIM2_IRQ_BIT, irqn: "TIM2_IRQn", led: 5 },
    TIM3: { key: "tim3", bit: PF_TIM3_IRQ_BIT, irqn: "TIM3_IRQn", led: 6 }
  };

  var PF_STAGE_META = [
    { id: 1,  name: "Mental model",     tag: "MMIO + clock tree" },
    { id: 2,  name: "Bits & macros",    tag: "|= and &= ~" },
    { id: 3,  name: "GPIO output",      tag: "MODER + ODR" },
    { id: 4,  name: "Input & polling",  tag: "IDR, while(1)" },
    { id: 5,  name: "Timer as divider", tag: "PSC / ARR / CNT" },
    { id: 6,  name: "Three switches",   tag: "DIER × ISER × PRIMASK" },
    { id: 7,  name: "Priority & nesting", tag: "IPR, preemption" },
    { id: 8,  name: "The RMW race",     tag: "not atomic" },
    { id: 9,  name: "Bring-up challenge", tag: "graded, no hints" },
    { id: 10, name: "Playground",       tag: "everything at once" }
  ];
  function pfStageById(n) {
    for (var i = 0; i < PF_STAGE_META.length; i++) { if (PF_STAGE_META[i].id === n) { return PF_STAGE_META[i]; } }
    return null;
  }

  function pfDefaults() {
    return {
      running: true, simMs: 0, preset: null, stepIdx: 0, stage: 1,
      rcc:   { AHB1ENR: 0, APB1ENR: 0 },        /* APB1: bit0 TIM2, bit1 TIM3 */
      gpioa: { MODER: 0, OTYPER: 0, PUPDR: 0, IDR: 0, ODR: 0 },
      tim2:  { CR1: 0, DIER: 0, SR: 0, PSC: 0, ARR: 999, CNT: 0, CCR: 500 },
      tim3:  { CR1: 0, DIER: 0, SR: 0, PSC: 0, ARR: 999, CNT: 0, CCR: 500 },
      nvic:  { ISER0: 0, IP: { "28": 2, "29": 1 } },  /* lower number = higher priority */
      cpu:   { PRIMASK: 0, stack: [] },                /* stack: [{n, prio, ms}] — nesting depth */
      race:  { active: false, useBsrr: false, lat: null, lost: 0, toggles: 0 },
      poll:  { active: false },
      fired: { TIM2: 0, TIM3: 0 }, nestCount: 0,
      tlHist: [],                            /* per-tick CPU context: 'main' | 'TIM2' | 'TIM3' — feeds the stage 7 timeline */
      tape: [],                              /* timestamped CPU events — what stage 9 grades on (see pfTapeSteady) */
      goals: {},
      switches: [false, false, false, false],
      log: [],
      userCode: []
    };
  }
  var periph = pfDefaults();

  function pfLoadState() {
    var s = rd(K_PERIPH, null);
    var d = pfDefaults();
    if (!s || typeof s !== "object") { periph = d; return; }
    ["rcc", "gpioa", "tim2", "tim3", "nvic", "race", "fired"].forEach(function (g) {
      if (s[g] && typeof s[g] === "object") {
        for (var f in d[g]) { if (!(f in s[g])) { s[g][f] = d[g][f]; } }
      } else { s[g] = d[g]; }
    });
    if (!s.nvic.IP || typeof s.nvic.IP !== "object") { s.nvic.IP = d.nvic.IP; }
    if (!s.cpu || typeof s.cpu !== "object") { s.cpu = d.cpu; }
    if (!Array.isArray(s.cpu.stack)) { s.cpu.stack = []; }
    if (!Array.isArray(s.tlHist)) { s.tlHist = []; }
    if (!Array.isArray(s.tape)) { s.tape = []; }
    if (s.tape.length > PF_TAPE_MAX) { s.tape = s.tape.slice(-PF_TAPE_MAX); }
    ["tim2", "tim3"].forEach(function (t) { if (typeof s[t].CCR !== "number") { s[t].CCR = d[t].CCR; } });
    if (!s.poll || typeof s.poll !== "object") { s.poll = d.poll; }
    if (!s.goals || typeof s.goals !== "object") { s.goals = {}; }
    if (typeof s.nestCount !== "number") { s.nestCount = 0; }
    if (typeof s.stage !== "number" || s.stage < 1 || s.stage > 10) { s.stage = 1; }
    if (!Array.isArray(s.switches) || s.switches.length !== 4) { s.switches = [false, false, false, false]; }
    if (!Array.isArray(s.log)) { s.log = []; }
    if (!Array.isArray(s.userCode)) { s.userCode = []; }
    /* v1.1: userCode entries became {stage, text} objects — migrate old plain strings */
    s.userCode = s.userCode.map(function (e) { return typeof e === "string" ? { s: 10, t: e } : e; });
    for (var k in d) { if (!(k in s)) { s[k] = d[k]; } }
    if (typeof s.stepIdx !== "number" || s.stepIdx < 0) { s.stepIdx = 0; }
    periph = s;
  }
  function pfSave() { wr(K_PERIPH, periph); }
  function pfLog(kind, msg) {
    periph.log.push({ t: periph.simMs, k: kind, m: msg });
    if (periph.log.length > PF_LOG_MAX) { periph.log.shift(); }
  }
  function pfUserLine(text) {
    periph.userCode.push({ s: periph.stage, t: text });
    if (periph.userCode.length > 300) { periph.userCode.shift(); }
    pfRenderUserCode();
  }
  /* Per-register metadata used to reverse-engineer a UI interaction back
     into a canonical C statement. bitNames lets the emitted line use
     the vendor macro form (TIM_CR1_CEN) instead of "(1u << 0)" so what you
     copy out looks like what you would actually ship. Timer registers are
     shared between TIM2/TIM3 so their prefix is resolved per peripheral. */
  var PF_REG_CODES = {
    AHB1ENR: { pfx: "RCC->AHB1ENR",  w: 8,  names: { 0: "RCC_AHB1ENR_GPIOAEN" } },
    APB1ENR: { pfx: "RCC->APB1ENR",  w: 8,  names: { 0: "RCC_APB1ENR_TIM2EN", 1: "RCC_APB1ENR_TIM3EN" } },
    /* ARMv7-M set/clear pairs: ISER is write-1-to-SET (0 bits are ignored), ICER is
       write-1-to-CLEAR (and is write-only — reads return 0). A plain `ISER0 = value`
       containing 0s therefore clears nothing, which is the lesson the old toggle
       semantics got wrong. */
    ISER0:   { pfx: "NVIC->ISER[0]", w: 32, names: {}, special: "iser", irqNames: (function (m) { m[PF_TIM2_IRQ_BIT] = "TIM2_IRQn"; m[PF_TIM3_IRQ_BIT] = "TIM3_IRQn"; return m; })({}) },
    ICER0:   { pfx: "NVIC->ICER[0]", w: 32, names: {}, special: "iser", irqNames: (function (m) { m[PF_TIM2_IRQ_BIT] = "TIM2_IRQn"; m[PF_TIM3_IRQ_BIT] = "TIM3_IRQn"; return m; })({}) },
    BSRR:    { pfx: "GPIOA->BSRR",   w: 32, names: {}, special: "bsrr" },
    OTYPER:  { pfx: "GPIOA->OTYPER", w: 16, names: {} },
    ODR:     { pfx: "GPIOA->ODR",    w: 16, names: {} }
  };
  var PF_TIM_REG_CODES = {
    CR1:  { w: 8,  names: { 0: "TIM_CR1_CEN" } },
    DIER: { w: 8,  names: { 0: "TIM_DIER_UIE" } },
    SR:   { w: 8,  names: { 0: "TIM_SR_UIF" }, w1c: true },
    PSC:  { w: 16, names: {}, assign: true },
    ARR:  { w: 16, names: {}, assign: true }
  };
  function pfCodeSpec(pname, reg) {
    if ((pname === "TIM2" || pname === "TIM3") && PF_TIM_REG_CODES[reg]) {
      var sp = PF_TIM_REG_CODES[reg];
      return { pfx: pname + "->" + reg, w: sp.w, names: sp.names, w1c: sp.w1c, assign: sp.assign };
    }
    return PF_REG_CODES[reg] || null;
  }
  function pfBitMaskExpr(spec, bit) {
    if (spec.names && spec.names[bit]) { return spec.names[bit]; }
    return "(1u << " + bit + ")";
  }
  function pfCodeForBitToggle(pname, regName, bit, willSet) {
    var spec = pfCodeSpec(pname, regName);
    if (!spec) { return null; }
    var mask = pfBitMaskExpr(spec, bit);
    if (spec.special === "iser") {
      var irq = spec.irqNames[bit];
      var ex = irq ? "(1u << " + irq + ")" : mask;
      return willSet ? "NVIC->ISER[0] = " + ex + ";   /* unmask */" : "NVIC->ICER[0] = " + ex + ";   /* mask */";
    }
    if (spec.special === "bsrr") {
      /* BSRR is write-only with two halves in one word: bits 0–15 set the matching
         ODR bit, bits 16–31 reset it. Either half is a single atomic write. */
      return bit < 16
        ? spec.pfx + " = GPIO_BSRR_BS" + bit + ";   /* atomic set — no read-modify-write */"
        : spec.pfx + " = GPIO_BSRR_BR" + (bit - 16) + ";   /* atomic reset */";
    }
    if (spec.w1c) {
      /* UI clicks a W1C bit only to clear it (writing 1 clears). Writing 0 does nothing. */
      return spec.pfx + " = " + mask + ";   /* W1C — clears the flag */";
    }
    return willSet ? (spec.pfx + " |= " + mask + ";") : (spec.pfx + " &= ~" + mask + ";");
  }
  function pfCodeForModerCycle(pin, oldMode, newMode) {
    var c = [];
    c.push("GPIOA->MODER &= ~(3u << (" + pin + "*2));   /* PA" + pin + ": was " + PF_MODE_NAMES[oldMode] + " */");
    c.push("GPIOA->MODER |=  (" + newMode + "u << (" + pin + "*2));   /* → " + PF_MODE_NAMES[newMode] + " */");
    return c;
  }
  function pfCodeForPullCycle(pin, oldPull, newPull) {
    return [
      "GPIOA->PUPDR &= ~(3u << (" + pin + "*2));   /* PA" + pin + ": pull " + PF_PULL_NAMES[oldPull] + " */",
      "GPIOA->PUPDR |=  (" + newPull + "u << (" + pin + "*2));   /* → pull " + PF_PULL_NAMES[newPull] + " */"
    ];
  }
  /* A PUPDR click cycles the pin's whole 2-bit field — single-bit toggles could
     land on 11, which silicon defines as reserved. Returns the new pull, or null
     when the write was dropped (clock gated off). */
  function pfCyclePull(pin) {
    var cur = pfPull(pin);
    var nxt = cur === 0 ? 1 : (cur === 1 ? 2 : 0);      /* NONE → UP → DOWN → NONE */
    var v = ((periph.gpioa.PUPDR & ~(3 << (pin * 2))) | (nxt << (pin * 2))) >>> 0;
    if (!pfWriteReg("GPIOA", "PUPDR", v)) { return null; }
    pfCodeForPullCycle(pin, cur, nxt).forEach(pfUserLine);
    return nxt;
  }
  function pfUserCodeText() {
    var out = [], lastS = null;
    periph.userCode.forEach(function (e) {
      if (e.s !== lastS) {
        var stg = pfStageById(e.s);
        out.push("/* ── Stage " + e.s + " · " + (stg ? stg.name : "misc") + " ── */");
        lastS = e.s;
      }
      out.push(e.t);
    });
    return out.join("\n");
  }
  function pfRenderUserCode() {
    var pre = document.getElementById("pf-user-code");
    if (!pre) { return; }
    if (!periph.userCode.length) {
      pre.innerHTML = '<span class="ln" style="color:var(--ink-3);font-style:italic">/* nothing yet — flip a bit or click a pin-mode tile */</span>';
      return;
    }
    var lastS = null;
    pre.innerHTML = periph.userCode.map(function (e) {
      var head = "";
      if (e.s !== lastS) {
        var stg = pfStageById(e.s);
        head = '<span class="ln sec">/* ── Stage ' + e.s + ' · ' + esc(stg ? stg.name : "misc") + ' ── */</span>';
        lastS = e.s;
      }
      return head + '<span class="ln">' + esc(e.t) + '</span>';
    }).join("");
    /* keep scrolled to bottom */
    pre.scrollTop = pre.scrollHeight;
  }
  function pfHex(v, w) { return "0x" + ((v >>> 0).toString(16).toUpperCase() + "          ").slice(0, w || 8); }
  function pfClkOn(name) {
    if (name === "GPIOA") { return (periph.rcc.AHB1ENR & 0x01) !== 0; }
    if (name === "TIM2")  { return (periph.rcc.APB1ENR & 0x01) !== 0; }
    if (name === "TIM3")  { return (periph.rcc.APB1ENR & 0x02) !== 0; }
    return true;
  }
  function pfTim(name) { return name === "TIM3" ? periph.tim3 : periph.tim2; }
  function pfBit(v, i) { return (v >>> i) & 1; }
  function pfModer(pin) { return pfBit(periph.gpioa.MODER, pin * 2) | (pfBit(periph.gpioa.MODER, pin * 2 + 1) << 1); }
  var PF_MODE_NAMES = ["IN", "OUT", "AF", "AN"];  var PF_PULL_NAMES = ["NONE", "UP", "DOWN"];  function pfPull(pin) { var b = (periph.gpioa.PUPDR >>> (pin * 2)) & 3; return b === 1 ? 1 : b === 2 ? 2 : 0; }
  function pfIdrRefresh() {
    var v = 0;
    for (var i = 0; i < 4; i++) { if (periph.switches[i]) { v |= (1 << i); } }
    var pull = periph.gpioa.PUPDR;
    for (var p = 0; p < 16; p++) {
      var m = pfModer(p);
      if (m !== 0) { continue; }                     /* only inputs read the pad */
      var pb = (pull >>> (p * 2)) & 3;
      if (!(v & (1 << p))) {                          /* no explicit switch drives bit p */
        if (pb === 1) { v |= (1 << p); }              /* pull-up makes the pad read high */
        else if (pb === 2) { v &= ~(1 << p); }        /* pull-down keeps it low */
      }
    }
    periph.gpioa.IDR = v >>> 0;
  }
  function pfWriteReg(pname, reg, value) {
    value = value >>> 0;
    if (pname === "RCC") {
      if (reg === 'AHB1ENR') { periph.rcc.AHB1ENR = value & 0x1; }
      if (reg === 'APB1ENR') { periph.rcc.APB1ENR = value & 0x3; }
      pfLog("wr", "RCC." + reg + " ← " + pfHex(value, 8));
      return true;
    }
    if (pname === "NVIC") {
      /* ISER: write-1-to-set, 0 bits ignored. ICER: write-1-to-clear, reads as 0.
         There is deliberately no way to clear a line through ISER — that is why the
         pair exists, and why the generator emits ICER for a mask. */
      if (reg === "ISER0") { periph.nvic.ISER0 = (periph.nvic.ISER0 | value) & PF_NVIC_IRQ_MASK; }
      if (reg === "ICER0") { periph.nvic.ISER0 = (periph.nvic.ISER0 & ~value) & PF_NVIC_IRQ_MASK; }
      if ((value & ~PF_NVIC_IRQ_MASK) !== 0) {
        pfLog("note", "NVIC." + reg + " write touches IRQ lines this lab does not model — only " + PF_TIM2_IRQ_BIT + " and " + PF_TIM3_IRQ_BIT + " exist here.");
      }
      pfLog("wr", "NVIC." + reg + " ← " + pfHex(value, 8));
      return true;
    }
    if (!pfClkOn(pname)) {
      pfLog("err", pname + "." + reg + " write dropped — clock is gated off (RCC)");
      return false;
    }
    if (pname === "GPIOA") {
      if (reg === "IDR") { pfLog("err", "GPIOA.IDR is read-only"); return false; }
      if (reg === "MODER")  { periph.gpioa.MODER = value & 0xFFFFFFFF; }
      if (reg === "OTYPER") { periph.gpioa.OTYPER = value & 0xFFFF; }
      if (reg === "PUPDR")  { periph.gpioa.PUPDR = value & 0xFFFFFFFF; }
      if (reg === "ODR")    { periph.gpioa.ODR = value & 0xFFFF; }
      if (reg === "BSRR")   { var s = value & 0xFFFF, r = (value >>> 16) & 0xFFFF; periph.gpioa.ODR = ((periph.gpioa.ODR | s) & ~r) >>> 0 & 0xFFFF; }
    } else if (pname === "TIM2" || pname === "TIM3") {
      var T = pfTim(pname);
      if (reg === "CNT") { pfLog("err", pname + ".CNT is read-only in this model"); return false; }
      if (reg === "CR1")  { T.CR1 = value & 0xFFFF; }
      if (reg === "DIER") { T.DIER = value & 0xFFFF; }
      if (reg === "SR")   { T.SR = (T.SR & ~(value & 0xFFFF)) >>> 0; }  /* W1C */
      if (reg === "PSC")  { T.PSC = value & 0xFFFF; }
      if (reg === "ARR")  { T.ARR = value & 0xFFFF; if (T.CNT > T.ARR) { T.CNT = T.ARR; } }
      if (reg === "CCR")  { T.CCR = value & 0xFFFF; }
    }
    pfLog("wr", pname + "." + reg + " ← " + pfHex(value, 8));
    return true;
  }
  /* current value of any writable register — used by the bit-click handler */
  function pfReadReg(pname, reg) {
    if (pname === "RCC")   { return reg === "APB1ENR" ? periph.rcc.APB1ENR : periph.rcc.AHB1ENR; }
    if (pname === "NVIC")  { return reg === "ICER0" ? 0 : periph.nvic.ISER0; }   /* ICER is write-only */
    if (pname === "GPIOA") { return periph.gpioa[reg] >>> 0; }
    if (pname === "TIM2" || pname === "TIM3") { return pfTim(pname)[reg] >>> 0; }
    return null;
  }
  /* Which peripheral a register row belongs to — shared by the live refresh and the
     click handler so a new register cannot be clickable in one and dead in the other. */
  function pfPnameForReg(reg) {
    if (reg === "AHB1ENR" || reg === "APB1ENR") { return "RCC"; }
    if (reg === "ISER0" || reg === "ICER0") { return "NVIC"; }
    if (reg === "MODER" || reg === "OTYPER" || reg === "PUPDR" || reg === "IDR" || reg === "ODR" || reg === "BSRR") { return "GPIOA"; }
    if (reg === "CR1" || reg === "DIER" || reg === "SR" || reg === "PSC" || reg === "ARR" || reg === "CNT" || reg === "CCR") { return "TIM2"; }
    return null;
  }

  /* ---- NVIC dispatch: request → pending → active, with priority + nesting ---- */
  function pfIrqReqs() {
    /* a request is visible to the NVIC when the peripheral flag is set AND the
       peripheral's own interrupt enable is set AND the NVIC line is unmasked */
    var out = [];
    ["TIM2", "TIM3"].forEach(function (name) {
      var spec = PF_IRQS[name], T = periph[spec.key];
      if ((T.SR & 1) && (T.DIER & 1) && ((periph.nvic.ISER0 >>> spec.bit) & 1)) {
        out.push({ n: name, bit: spec.bit, prio: periph.nvic.IP[String(spec.bit)] | 0 });
      }
    });
    out.sort(function (a, b) { return a.prio - b.prio || a.bit - b.bit; });
    return out;
  }
  function pfInStack(name) {
    return periph.cpu.stack.some(function (e) { return e.n === name; });
  }
  function pfPendingReqs() {
    /* requested but not being serviced — either masked by PRIMASK, or a
       same/low-priority handler already owns the CPU */
    var st = periph.cpu.stack;
    return pfIrqReqs().filter(function (r) {
      if (pfInStack(r.n)) { return false; }
      if (periph.cpu.PRIMASK) { return true; }
      if (!st.length) { return false; }              /* dispatch would take it this tick */
      return r.prio >= st[st.length - 1].prio;
    });
  }
  function pfEnterIsr(r) {
    var st = periph.cpu.stack;
    if (st.length) {
      pfLog("irq", "⚡ " + r.n + " (prio " + r.prio + ") preempts " + st[st.length - 1].n + " (prio " + st[st.length - 1].prio + ")");
      periph.nestCount++;
    } else {
      pfLog("irq", "→ " + r.n + "_IRQHandler entered (prio " + r.prio + ")");
    }
    pfWriteReg(r.n, "SR", 1);                        /* the handler's first job: W1C the flag */
    pfTape("enter", r.n);                            /* behaviour evidence: the handler ran */
    var ledBit = (periph.race.active && r.n === "TIM2") ? 6 : PF_IRQS[r.n].led;
    var toggle = (periph.gpioa.ODR ^ (1 << ledBit)) & 0xFFFF;
    if (pfClkOn("GPIOA")) {
      periph.gpioa.ODR = toggle;
      pfTape("led", r.n);                            /* and it actually wrote the pin */
      pfLog("irq", "   ODR ^= (1u<<" + ledBit + ") → PA" + ledBit + " " + (((toggle >>> ledBit) & 1) ? "high" : "low"));
    } else {
      pfLog("err", "   handler: ODR update dropped — GPIOA clock off");
    }
    periph.fired[r.n] = (periph.fired[r.n] || 0) + 1;
    st.push({ n: r.n, prio: r.prio, ms: PF_ISR_MS });
  }
  function pfNvicTick() {
    var st = periph.cpu.stack;
    if (st.length) {
      var top = st[st.length - 1];
      top.ms -= PF_TICK_MS;
      if (top.ms <= 0) {
        st.pop();
        pfTape("exit", top.n);
        pfLog("irq", "← " + top.n + "_IRQHandler exit" + (st.length ? " → resume " + st[st.length - 1].n : " (return to main)"));
      }
    }
    if (periph.cpu.PRIMASK) { return; }               /* CPSID I — requests stay pending */
    var reqs = pfIrqReqs();
    for (var i = 0; i < reqs.length; i++) {
      var r = reqs[i];
      if (pfInStack(r.n)) { continue; }
      if (!st.length) { pfEnterIsr(r); break; }
      if (r.prio < st[st.length - 1].prio) { pfEnterIsr(r); }  /* strict > wins; ties never preempt */
      else { break; }
    }
  }
  /* advance one timer's counter; sets the update flag on rollover */
  function pfAdvanceTimer(name) {
    var spec = PF_IRQS[name], T = periph[spec.key];
    if (!pfClkOn(name) || (T.CR1 & 0x01) === 0) { return; }
    var div = T.PSC + 1;
    var inc = Math.max(1, Math.round(PF_CLK_PER_TICK / div));
    T.CNT += inc;
    var guard = 0;
    while (T.CNT > T.ARR && guard++ < 5) {
      T.CNT -= (T.ARR + 1);
      T.SR = (T.SR | 0x01) >>> 0;
    }
    if (T.CNT > T.ARR) { T.CNT = 0; }
  }
  /* stage 8: main() toggles PA5 through a deliberate two-phase RMW window —
     read ODR on one tick, write the stale value back on the next. Any ISR
     change to other bits inside that window is silently clobbered. */
  function pfRaceTick() {
    var rc = periph.race;
    if (!rc.active || !pfClkOn("GPIOA")) { return; }
    if (rc.useBsrr) {
      var set = (rc.toggles & 1) === 0;
      periph.gpioa.ODR = (set ? (periph.gpioa.ODR | (1 << 5)) : (periph.gpioa.ODR & ~(1 << 5))) & 0xFFFF;
      rc.toggles++;
      return;
    }
    if (rc.lat === null) { rc.lat = periph.gpioa.ODR >>> 0; return; }   /* main() READs ODR */
    var v = (rc.lat ^ (1 << 5)) >>> 0;                                  /* MODIFY + WRITE back */
    var notBit5 = (~(1 << 5)) >>> 0;
    if (((periph.gpioa.ODR & notBit5) >>> 0) !== ((rc.lat & notBit5) >>> 0)) {
      rc.lost++;
      pfTape("lost", "main");
      pfLog("err", "⚠ RMW race — main() wrote back a stale ODR; bit changes made since its read are lost (update #" + rc.lost + ")");
    }
    periph.gpioa.ODR = v & 0xFFFF;
    rc.lat = null;
    rc.toggles++;
  }
  function pfUpdateRateHz(T) {
    return 1000 / ((T.PSC + 1) * (T.ARR + 1));
  }

  /* ---- behaviour grading: predicates over a timestamped event tape ----
     A *state* goal asks whether the register bank looks right right now. A
     *behaviour* goal asks whether the model did the right thing over time, which is
     the failure that actually bites on silicon: a handler that fires once, a
     "blinking" loop that busy-waits, an ISR that stops being scheduled. The tape is
     a bounded ring of { t, k, d } — t = sim ms, k = one of enter / exit / led / lost,
     d = the detail (which timer, or "main"). pfTape() writes it from the same call
     sites that already log; every predicate below is pure over a tape, so
     specs/periph_tape.spec.js can grade a scripted one. Vocabulary used below:
       n       handler entries seen
       window  the newest entries the cadence is judged on
       gaps    ms between consecutive entries inside that window
       median  the cadence those entries share
       steady  all gaps within PF_TAPE_TOL of that median, and no shorter than a tick */
  var PF_TAPE_MAX = 240;           /* ring length — ~2 min of 2 Hz activity */
  /* The cadence is judged on the newest PF_TAPE_WINDOW entries, not the whole ring: an
     old anomaly (a masked stretch, a paused sim) ages out after a few fresh entries
     instead of poisoning the goal for the next two minutes. */
  var PF_TAPE_WINDOW = 8;
  var PF_GOAL9_MIN_ENTRIES = 4;    /* the tape has to show the handler actually running */
  var PF_TAPE_TOL = 0.35;          /* ±35 %: tick quantisation plus the 400 ms handler hold */
  var PF_TAPE_STALE_MS = 3000;     /* …and the newest entry must be no older than this, or the ISR stopped */

  function pfTape(kind, detail) {
    periph.tape.push({ t: periph.simMs, k: kind, d: detail });
    if (periph.tape.length > PF_TAPE_MAX) { periph.tape.shift(); }
  }
  function pfTapeEntries(tape, kind, detail) {
    var out = [];
    for (var i = 0; i < tape.length; i++) {
      var e = tape[i];
      if (e && e.k === kind && (detail === undefined || e.d === detail)) { out.push(e); }
    }
    return out;
  }
  function pfTapeGaps(entries) {
    var out = [];
    for (var i = 1; i < entries.length; i++) { out.push(entries[i].t - entries[i - 1].t); }
    return out;
  }
  /* The cadence statistics, computed once so the card and the predicate can never
     disagree about what they are showing. */
  function pfTapeCadence(tape, name) {
    var hits = pfTapeEntries(tape, "enter", name);
    var recent = hits.slice(-PF_TAPE_WINDOW);
    var gaps = pfTapeGaps(recent);
    if (!gaps.length) { return { n: hits.length, window: recent.length, gaps: 0, median: 0, min: 0, max: 0, steady: false }; }
    var sorted = gaps.slice().sort(function (a, b) { return a - b; });
    var median = sorted[sorted.length >> 1];
    var steady = median >= PF_TICK_MS;   /* a burst inside one frame is not a cadence */
    for (var i = 0; i < gaps.length; i++) {
      if (Math.abs(gaps[i] - median) > median * PF_TAPE_TOL) { steady = false; }
    }
    return { n: hits.length, window: recent.length, gaps: gaps.length, median: median, min: sorted[0], max: sorted[sorted.length - 1], steady: steady };
  }
  /* "it ran a cadence" and "it is still running" are different claims: an ISR that
     fired four times and then stopped passes the first and fails the second, which is
     the silent failure this goal exists to catch. Supply `now` to also assert freshness. */
  function pfTapeSteady(tape, name, min, now, maxAge) {
    var c = pfTapeCadence(tape, name);
    if (c.n < min || !c.steady) { return false; }
    if (now === undefined) { return true; }
    var age = pfTapeAge(tape, name, now);
    return age !== null && age <= maxAge;
  }
  function pfTapeAge(tape, name, now) {
    var hits = pfTapeEntries(tape, "enter", name);
    return hits.length ? now - hits[hits.length - 1].t : null;
  }
  function pfTapeVerdict(c, age) {
    if (!c.n) { return "no handler entries yet"; }
    if (c.n < PF_GOAL9_MIN_ENTRIES) { return "too few entries (" + c.n + "/" + PF_GOAL9_MIN_ENTRIES + ")"; }
    if (!c.gaps) { return "one entry — need a cadence"; }
    if (!c.steady) { return "irregular gaps (" + c.min + "–" + c.max + " ms)"; }
    if (age !== undefined && age !== null && age > PF_TAPE_STALE_MS) { return "stopped — last entry " + age + " ms ago"; }
    return "steady cadence — behaviour gate met";
  }
  /* The stage-9 behaviour gate. The goal card, the grading checklist and the tape card
     all ask through here, so none of them can disagree about what "working" means. */
  function pfTapeStillRunning() {
    return pfTapeSteady(periph.tape, "TIM2", PF_GOAL9_MIN_ENTRIES, periph.simMs, PF_TAPE_STALE_MS);
  }

  var PF_PRESETS = [
    { id: "blink", label: "Blink PA5 via TIM2 IRQ (2 Hz)",
      hint: "Full bring-up: enable clocks, PA5 → output, TIM2 configured for a 2 Hz update IRQ, NVIC unmasked, then the ISR does the toggle.",
      isrSrc:
"void TIM2_IRQHandler(void) {\n" +
"    if (TIM2->SR & TIM_SR_UIF) {\n" +
"        TIM2->SR &= ~TIM_SR_UIF;   /* clear W1C flag */\n" +
"        GPIOA->ODR ^= (1u << 5);   /* toggle PA5 */\n" +
"    }\n}",
      steps: [
        { c: "RCC->AHB1ENR  |= RCC_AHB1ENR_GPIOAEN;", n: "Enable GPIOA peripheral clock.", o: function () { pfWriteReg("RCC", "AHB1ENR", periph.rcc.AHB1ENR | 0x01); } },
        { c: "RCC->APB1ENR  |= RCC_APB1ENR_TIM2EN;",  n: "Enable TIM2 peripheral clock.",  o: function () { pfWriteReg("RCC", "APB1ENR", periph.rcc.APB1ENR | 0x01); } },
        { c: "GPIOA->MODER  &= ~(3u << (5*2));\nGPIOA->MODER  |=  (1u << (5*2));", n: "PA5 → general-purpose output.", o: function () { pfWriteReg("GPIOA", "MODER", ((periph.gpioa.MODER & ~(3 << 10)) | (1 << 10)) >>> 0); } },
        { c: "TIM2->PSC      = 9;   /* 1 kHz / (9+1) = 100 Hz */",   n: "Prescaler divides the timer clock.", o: function () { pfWriteReg("TIM2", "PSC", 9); } },
        /* The counter counts 0..ARR inclusive, so the divisor is ARR+1: 100 Hz /
           (50+1) ≈ 1.96 Hz, matching pfUpdateRateHz (this comment used to say
           "/ 50 = 2 Hz", which is the off-by-one the model itself avoids). */
        { c: "TIM2->ARR      = 50;  /* 100 Hz / (50+1) ≈ 1.96 Hz updates */", n: "Reload value → update rate.", o: function () { pfWriteReg("TIM2", "ARR", 50); periph.tim2.CNT = 0; } },
        { c: "TIM2->DIER    |= TIM_DIER_UIE;",  n: "Ask TIM2 to signal an interrupt on update.", o: function () { pfWriteReg("TIM2", "DIER", periph.tim2.DIER | 0x01); } },
        { c: "NVIC->ISER[0] = (1u << TIM2_IRQn);  /* IRQn 28 */", n: "Unmask TIM2 in the NVIC.", o: function () { pfWriteReg("NVIC", "ISER0", periph.nvic.ISER0 | (1 << PF_TIM2_IRQ_BIT)); } },
        { c: "TIM2->CR1     |= TIM_CR1_CEN;",   n: "Start the counter — the ISR will now fire on each update.", o: function () { pfWriteReg("TIM2", "CR1", periph.tim2.CR1 | 0x01); } }
      ] },
    { id: "noclk", label: "Bug: forgot GPIOA clock",
      hint: "Writes to a peripheral whose clock is off. Real hardware: silently lost, or the bus hangs. Here we drop and log — the LED stays dark until the clock is enabled.",
      steps: [
        { c: "// RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;   ← skipped!", n: "The bug: no clock-enable line.", o: function () { pfLog("note", "Note the missing RCC line above — GPIOA is still gated off."); } },
        { c: "GPIOA->MODER   = (1u << (5*2));   /* PA5 → output (ATTEMPT) */", n: "This write is dropped by the model.", o: function () { pfWriteReg("GPIOA", "MODER", (1 << 10) >>> 0); } },
        { c: "GPIOA->ODR    |= (1u << 5);        /* PA5 → high (ATTEMPT) */",   n: "Also dropped. PA5 stays dark.",       o: function () { pfWriteReg("GPIOA", "ODR", (periph.gpioa.ODR | (1 << 5)) >>> 0); } },
        { c: "RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;   /* FIX */", n: "Now the peripheral is clocked.", o: function () { pfWriteReg("RCC", "AHB1ENR", periph.rcc.AHB1ENR | 0x01); } },
        { c: "GPIOA->MODER   = (1u << (5*2));", n: "Retry the writes.", o: function () { pfWriteReg("GPIOA", "MODER", (1 << 10) >>> 0); } },
        { c: "GPIOA->ODR    |= (1u << 5);",      n: "PA5 finally lights up.", o: function () { pfWriteReg("GPIOA", "ODR", (periph.gpioa.ODR | (1 << 5)) >>> 0); } }
      ] },
    { id: "poll", label: "Poll SW0 → light PA5",
      hint: "Read IDR (the physical pad), write ODR (the driver). IDR is not a mirror of ODR — a pin configured as output reads whatever voltage is actually on the pad.",
      steps: [
        { c: "RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;", o: function () { pfWriteReg("RCC", "AHB1ENR", periph.rcc.AHB1ENR | 0x01); } },
        { c: "GPIOA->MODER &= ~(3u << (0*2));   /* PA0 input */", o: function () { pfWriteReg("GPIOA", "MODER", (periph.gpioa.MODER & ~(3 << 0)) >>> 0); } },
        { c: "GPIOA->MODER |=  (1u << (5*2));   /* PA5 output */", o: function () { pfWriteReg("GPIOA", "MODER", (periph.gpioa.MODER | (1 << 10)) >>> 0); } },
        { c: "uint32_t idr = GPIOA->IDR;", n: "Read the pads. Flip SW0 in the top-left panel, then Run step again.", o: function () { pfIdrRefresh(); pfLog("wr", "GPIOA.IDR read → " + pfHex(periph.gpioa.IDR, 8)); } },
        { c: "if (idr & (1u << 0)) GPIOA->ODR |=  (1u << 5);\nelse               GPIOA->ODR &= ~(1u << 5);", o: function () { var on = (periph.gpioa.IDR & 1) !== 0; var v = on ? (periph.gpioa.ODR | (1 << 5)) : (periph.gpioa.ODR & ~(1 << 5)); pfWriteReg("GPIOA", "ODR", v >>> 0); } }
      ] }
  ];
  function pfPresetById(id) {
    for (var i = 0; i < PF_PRESETS.length; i++) { if (PF_PRESETS[i].id === id) { return PF_PRESETS[i]; } }
    return null;
  }

  function pfTick() {
    if (!periph.running) { return; }
    periph.simMs += PF_TICK_MS;
    pfIdrRefresh();
    pfAdvanceTimer("TIM2");
    pfAdvanceTimer("TIM3");
    pfNvicTick();
    periph.tlHist.push(periph.cpu.stack.length ? periph.cpu.stack[periph.cpu.stack.length - 1].n : "main");
    if (periph.tlHist.length > 150) { periph.tlHist.shift(); }
    pfRaceTick();
    if (periph.poll.active && pfClkOn("GPIOA")) {
      var on = (periph.gpioa.IDR & 1) !== 0;
      periph.gpioa.ODR = (on ? (periph.gpioa.ODR | (1 << 5)) : (periph.gpioa.ODR & ~(1 << 5))) & 0xFFFF;
    }
    pfSave();
    pfRenderLive();
  }

  /* ---- rendering ---- */
  function pfLed(id, pin, label) {
    return '<div class="pf-led" id="' + id + '" title="PA' + pin + '"><div class="bulb"></div><div class="lab">' + esc(label) + '</div></div>';
  }
  function pfSwitch(id, idx, label) {
    return '<button type="button" id="' + id + '" data-sw="' + idx + '" aria-pressed="' + String(!!periph.switches[idx]) + '">' + esc(label) + '</button>';
  }
  /* opts (optional):
       bitTitle(i) → hover text for every bit; overrides the defaults below
       idleNote    → hover text for a bit that exists on silicon but has no
                     behaviour in this model. The old string here said "reserved
                     in this model", which was a fudge: the bit is not reserved on
                     the real chip, it is simply unwired in the lab. Say that.
     A bit that is not wired is styled .ro .dis (striped, not-allowed) so it reads
     as "exists, no behaviour here" — distinct from a true read-only bit (.ro). */
  function pfReg(name, addr, acc, val, width, id, active, pnm, opts) {
    opts = opts || {};
    var bits = '';
    var w = width || 16;
    var actMap = null;
    if (active) {
      actMap = {};
      for (var ai = 0; ai < active.length; ai++) { actMap[active[ai]] = true; }
    }
    for (var i = w - 1; i >= 0; i--) {
      var on = (val >>> i) & 1;
      var dead = !!(actMap && !actMap[i]);
      var isRO = acc === 'RO' || dead;
      var title = '';
      if (opts.bitTitle) { title = opts.bitTitle(i); }
      else if (dead) { title = opts.idleNote || 'not wired in this model — writing it has no effect here'; }
      else if (acc === 'RO') { title = 'read-only'; }
      bits += '<div class="pf-bit' + (on ? ' one' : '') + (isRO ? ' ro' : '') + (dead ? ' dis' : '') + '" data-rbit="' + (id || name) + '-' + i + '" data-reg="' + name + '"' + (pnm ? ' data-pname="' + pnm + '"' : '') + ' data-periph="' + acc + '" data-bit="' + i + '" data-w="' + w + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + on + '<span class="bl">' + i + '</span></div>';
    }
    return '<div class="pf-reg"><div class="pf-reg-head"><span class="nm">' + esc(name) + '</span><span class="addr">' + esc(addr) + '</span><span class="hex" id="pf-hex-' + (id || name) + '">' + pfHex(val, w === 32 ? 8 : (w === 16 ? 4 : (w === 8 ? 2 : 4))) + '</span><span class="acc ' + (acc === 'RO' ? 'ro' : acc === 'WO' ? 'wo' : acc === 'W1C' ? 'w1c' : '') + '">' + esc(acc) + '</span></div><div class="pf-bits" style="grid-template-columns:repeat(' + (w > 16 ? 16 : w) + ',1fr)">' + bits + '</div></div>';
  }

  /* ---- composable cards — each stage assembles only what it teaches ---- */
  function pfTeach(title, html) {
    return '<section class="pf-card"><h3>' + esc(title) + '<span class="pf-sub">the idea</span></h3><div class="pf-teach">' + html + '</div></section>';
  }
  function pfSnippet(title, code) {
    return '<section class="pf-card"><h3>' + esc(title) + '<span class="pf-sub">the idiom</span></h3><pre class="pf-code">' + esc(code) + '</pre></section>';
  }
  function pfRccCard() {
    return '<section class="pf-card"><h3>RCC — peripheral clock enables<span class="pf-sub">AHB1 / APB1</span></h3>' +
      pfReg('AHB1ENR', '0x4002_3830', 'RW', periph.rcc.AHB1ENR, 8, 'rcc-ahb1', [0], 'RCC',
        { idleNote: 'only GPIOA (bit 0) is modelled — no other AHB1 peripheral is wired in this lab' }) +
      pfReg('APB1ENR', '0x4002_3840', 'RW', periph.rcc.APB1ENR, 8, 'rcc-apb1', [0, 1], 'RCC',
        { idleNote: 'only TIM2 (bit 0) and TIM3 (bit 1) are wired in this model' }) +
      '<p class="pf-hint"><b>AHB1 bit 0 = GPIOA</b> · <b>APB1 bit 0 = TIM2</b>, <b>bit 1 = TIM3</b>. The striped bits are real on the chip (dozens of other peripherals live there) but have no behaviour in this lab. Writes to a peripheral whose clock is off are silently dropped by real silicon — the same rule is enforced here.</p></section>';
  }
  function pfGpioaCard(sub) {
    var modes = '';
    for (var p = 0; p < 16; p++) { modes += pfPinModeTile(p); }
    return '<section class="pf-card"><h3>GPIOA<span class="pf-sub">' + esc(sub || 'port A, 16 pins') + '</span></h3>' +
      '<div class="pf-mod">' + modes + '</div>' +
      pfReg('OTYPER', '0x4002_0004', 'RW', periph.gpioa.OTYPER, 16, 'gpioa-otyper', null, 'GPIOA') +
      pfReg('IDR',    '0x4002_0010', 'RO', periph.gpioa.IDR,    16, 'gpioa-idr', null, 'GPIOA') +
      pfReg('ODR',    '0x4002_0014', 'RW', periph.gpioa.ODR,    16, 'gpioa-odr', null, 'GPIOA') +
      '<p class="pf-hint">Click a pin tile to cycle <b>IN → OUT → AF → AN</b>. IDR is read-only — it is the physical pad, not a shadow of ODR.</p></section>';
  }
  function pfTimCard(tim) {
    var base = tim === "TIM3" ? 0x40000400 : 0x40000000;
    function a(off) { var v = (base + off).toString(16).toUpperCase(); while (v.length < 8) { v = "0" + v; } return "0x" + v.slice(0, 4) + "_" + v.slice(4); }
    var T = pfTim(tim), lk = tim.toLowerCase();
    return '<section class="pf-card"><h3>' + tim + '<span class="pf-sub">16-bit general timer</span></h3>' +
      pfReg('CR1',  a(0x00), 'RW',  T.CR1,  8, lk + '-cr1',  [0], tim, { idleNote: 'only CEN (bit 0) has behaviour here' }) +
      pfReg('DIER', a(0x0C), 'RW',  T.DIER, 8, lk + '-dier', [0], tim, { idleNote: 'only UIE (bit 0) has behaviour here' }) +
      pfReg('SR',   a(0x10), 'W1C', T.SR,   8, lk + '-sr',   [0], tim, { idleNote: 'only UIF (bit 0) has behaviour here' }) +
      pfReg('PSC',  a(0x28), 'RW',  T.PSC,  16, lk + '-psc', null, tim) +
      pfReg('ARR',  a(0x2C), 'RW',  T.ARR,  16, lk + '-arr', null, tim) +
      pfReg('CCR',  a(0x34), 'RW',  T.CCR,  16, lk + '-ccr', null, tim) +
      pfReg('CNT',  a(0x24), 'RO',  T.CNT,  16, lk + '-cnt', null, tim) +
      '<div class="pf-rate">update rate ≈ <b id="pf-' + lk + '-rate">0</b> Hz · <span id="pf-' + lk + '-run">stopped</span></div>' +
      '<p class="pf-hint"><b>CR1 bit 0 = CEN</b> start · <b>DIER bit 0 = UIE</b> ask for an IRQ on update · <b>SR bit 0 = UIF</b> write-1-to-clear · <b>CCR</b> is stage 5\'s compare value (the duty slider writes this same register). In this model the timer clock is 1 kHz, so rate = <code>1000 / (PSC+1) / (ARR+1)</code>.</p></section>';
  }
  /* PUPDR is a register you mostly meet through the pin card — two bits per pin.
     Clicking either bit of a pin cycles that pin's whole field (single-bit toggles
     could create 11, which is reserved on silicon). */
  function pfPupdrCard() {
    return '<section class="pf-card"><h3>PUPDR<span class="pf-sub">weak pull resistors — two bits per pin</span></h3>' +
      pfReg('PUPDR', '0x4002_000C', 'RW', periph.gpioa.PUPDR, 32, 'gpioa-pupdr', null, 'GPIOA', {
        bitTitle: function (i) {
          var pin = i >> 1;
          return 'PA' + pin + ' [' + (i & 1) + ']: currently pull ' + PF_PULL_NAMES[pfPull(pin)] +
                 ' — clicking either of the pin\'s two bits cycles NONE → UP → DOWN (11 is reserved on silicon)';
        }
      }) +
      '<p class="pf-hint">Each pin owns a 2-bit field: <b>00</b> NONE (high-Z), <b>01</b> UP, <b>10</b> DOWN, <b>11</b> reserved. A floating input reads noise — that is the bug these pull bits exist to fix. Configure PA0 as <b>IN</b>, leave SW0 off, then click PA0\'s bits: IDR snaps to a defined level.</p></section>';
  }
  /* BSRR took the stage-8 prose and turned it into a register you can click. It is
     write-only: reads return 0, so the boxes never light — only the write matters. */
  function pfBsrrCard() {
    return '<section class="pf-card"><h3>BSRR<span class="pf-sub">the atomic set / reset register</span></h3>' +
      pfReg('BSRR', '0x4002_0018', 'WO', 0, 32, 'gpioa-bsrr', null, 'GPIOA', {
        bitTitle: function (i) {
          return i < 16
            ? 'bit ' + i + ' — one atomic write sets PA' + i + ' (ODR bit ' + i + ' ← 1)'
            : 'bit ' + i + ' — one atomic write resets PA' + (i - 16) + ' (ODR bit ' + (i - 16) + ' ← 0)';
        }
      }) +
      '<p class="pf-hint">One 32-bit word, two halves: <b>bits 15:0 set</b> the matching ODR bit, <b>bits 31:16 reset</b> it. No read, no modify — one bus transaction that cannot lose another bit to a concurrent write. It is <b>write-only</b>: reads return 0, which is why the boxes stay dark. That is the whole fix for stage 8\'s race.</p></section>';
  }
  function pfNvicCard() {
    function ipBtn(bit) {
      return '<span class="pf-ipr"><button type="button" class="btn mini" data-ip="' + bit + '" data-d="-1" title="raise priority (lower number)">−</button><b id="pf-ipr-' + bit + '">—</b><button type="button" class="btn mini" data-ip="' + bit + '" data-d="1" title="lower priority (higher number)">+</button></span>';
    }
    return '<section class="pf-card"><h3>NVIC<span class="pf-sub">ISER0 / ICER0 · priority · live state</span></h3>' +
      pfReg('ISER0', '0xE000_E100', 'RW', periph.nvic.ISER0, 32, 'nvic-iser0', [PF_TIM2_IRQ_BIT, PF_TIM3_IRQ_BIT], 'NVIC', {
        bitTitle: function (i) {
          var irq = PF_REG_CODES.ISER0.irqNames[i];
          if (!irq) { return 'IRQ line ' + i + ' — no peripheral is modelled on this line'; }
          var en = ((periph.nvic.ISER0 >>> i) & 1) === 1;
          return 'IRQ ' + i + ' · ' + irq + ' — ' + (en ? 'unmasked; clicking writes ICER to mask it (ISER ignores 0s)' : 'masked; clicking writes ISER (write-1-to-set) to unmask');
        }
      }) +
      pfReg('ICER0', '0xE000_E180', 'WO', 0, 32, 'nvic-icer0', [PF_TIM2_IRQ_BIT, PF_TIM3_IRQ_BIT], 'NVIC', {
        bitTitle: function (i) {
          var irq = PF_REG_CODES.ICER0.irqNames[i];
          return irq ? 'IRQ ' + i + ' · ' + irq + ' — write 1 to mask it; reads return 0 (write-only)'
                     : 'IRQ line ' + i + ' — no peripheral is modelled on this line';
        }
      }) +
      '<div class="pf-iprbar"><span>TIM2 IRQ ' + ipBtn(PF_TIM2_IRQ_BIT) + '</span><span>TIM3 IRQ ' + ipBtn(PF_TIM3_IRQ_BIT) + '</span></div>' +
      '<table class="pf-irqtbl"><thead><tr><th>IRQ</th><th>clock</th><th>flag</th><th>UIE</th><th>ISER</th><th>NVIC state</th></tr></thead><tbody id="pf-irqtbl-body"></tbody></table>' +
      '<p class="pf-hint">An interrupt reaches the instruction stream only when <b>every gate agrees</b>: peripheral clock, its <b>DIER</b> bit, the NVIC line, and <b>PRIMASK = 0</b>. The pair <b>ISER0 / ICER0</b> is ARM\'s set/clear idiom: <b>ISER is write-1-to-set</b> — 0 bits are ignored, so a plain assignment cannot clear a line; masking goes through <b>ICER</b>, which is write-only (reads return 0). Priority numbers: <b>lower = more urgent</b>; a pending IRQ with a lower number preempts the running handler.</p></section>';
  }
  function pfCpuCard() {
    return '<section class="pf-card"><h3>CPU<span class="pf-sub">what the core is executing</span></h3>' +
      '<div class="pf-cpurow"><button type="button" class="btn" id="pf-primask" title="CPSID I / CPSIE I">PRIMASK = 0 · irqs enabled</button></div>' +
      '<div class="pf-cpustate">now running: <b id="pf-cpu-now">main() — thread mode</b></div>' +
      '<div class="pf-cpustate">nesting depth <b id="pf-cpu-depth">0</b> · handler fired: TIM2 <b id="pf-fired-tim2">0</b>×, TIM3 <b id="pf-fired-tim3">0</b>× · preemptions <b id="pf-nest-count">0</b></div>' +
      '<p class="pf-hint"><b>PRIMASK</b> is one flip-flop in the core: set it (<code>CPSID I</code>, or <code>__disable_irq()</code>) and <em>every</em> interrupt is held pending, no matter what the peripherals and NVIC ask for.</p></section>';
  }
  function pfLedsCard(sub) {
    var leds = '';
    for (var p = 0; p < 16; p++) {
      leds += pfLed('pf-led-' + p, p, p === 5 ? 'PA5★' : p === 6 ? 'PA6◆' : 'PA' + p);
    }
    return '<section class="pf-card"><h3>Onboard LEDs<span class="pf-sub">' + esc(sub || 'GPIOA.ODR ∩ MODER=OUT') + '</span></h3><div class="pf-leds" id="pf-leds">' + leds + '</div><p class="pf-hint"><b>PA5★</b> is the blue-pill LED — the TIM2 handler toggles it. <b>PA6◆</b> belongs to the TIM3 handler.</p></section>';
  }
  function pfSwCard() {
    var sws = pfSwitch('pf-sw-0', 0, 'SW0 → PA0') + pfSwitch('pf-sw-1', 1, 'SW1 → PA1') + pfSwitch('pf-sw-2', 2, 'SW2 → PA2') + pfSwitch('pf-sw-3', 3, 'SW3 → PA3');
    return '<section class="pf-card"><h3>Input switches<span class="pf-sub">drive GPIOA.IDR bits 0–3</span></h3><div class="pf-sw">' + sws + '</div><p class="pf-hint">A switch drives the <em>pad</em>. Configure the pin as <b>IN</b> and it shows up in IDR.</p></section>';
  }
  function pfWaveCard(tim) {
    var lk = tim.toLowerCase();
    return '<section class="pf-card"><h3>' + tim + ' counter<span class="pf-sub">CNT sawtooth · PWM vs CCR</span></h3>' +
      '<div class="pf-wave pf-wave-tall" id="pf-wave-' + lk + '"><svg viewBox="0 0 300 112" preserveAspectRatio="none">' +
        '<line id="pf-wave-' + lk + '-arr" class="arrline" x1="0" y1="10" x2="300" y2="10" data-arrdrag="' + tim + '" title="drag to change ARR"></line>' +
        '<line id="pf-wave-' + lk + '-ccr" class="ccrline" x1="0" y1="66" x2="300" y2="66"></line>' +
        '<polyline id="pf-wave-' + lk + '-trace" class="trace" points=""></polyline>' +
        '<polyline id="pf-wave-' + lk + '-pwm" class="pwmline" points=""></polyline>' +
        '<line class="baseline" x1="0" y1="52" x2="300" y2="52"></line>' +
        '<line class="baseline" x1="0" y1="88" x2="300" y2="88"></line>' +
      '</svg><div class="lab">CNT ↗ · PWM ⎯</div><div class="cnt" id="pf-' + lk + '-cnt">0 / 999</div></div>' +
      '<div class="pf-ccrrow"><label for="pf-' + lk + '-ccr-r">CCR — compare value <span class="dim">(the slider and the CCR bits write the same register; the output channel that would route it to a pin is a later pass)</span></label>' +
        '<input type="range" id="pf-' + lk + '-ccr-r" data-ccr="' + tim + '" min="0" max="65535" step="1" value="' + pfTim(tim).CCR + '" aria-label="' + tim + ' compare value">' +
        '<b id="pf-' + lk + '-duty">— %</b></div></section>';
  }
  function pfLogCard() {
    return '<section class="pf-card"><h3>Event log<span class="pf-sub">newest at bottom</span></h3><div class="pf-log" id="pf-log"></div></section>';
  }
  /* Behaviour grading is only fair if the learner sees the same evidence the grader
     does, so this card prints the tape's last entries with their sim-clock stamps and
     the very cadence statistics pfTapeSteady() grades on — one source, two readers. */
  var PF_TAPE_KINDS = { enter: "irq", exit: "note", led: "wr", lost: "err" };
  function pfTapeStatHtml() {
    var c = pfTapeCadence(periph.tape, "TIM2");
    var age = pfTapeAge(periph.tape, "TIM2", periph.simMs);
    return 'TIM2 handler entries <b>' + c.n + '</b> · median gap <b>' + (c.median ? c.median + ' ms' : '—') +
      '</b> over the newest <b>' + c.window + '</b> · last entry <b>' + (age === null ? '—' : age + ' ms ago') + '</b> · <b class="' +
      (pfTapeStillRunning() ? 'tr-ok' : 'tr-open') + '">' + esc(pfTapeVerdict(c, age)) + '</b>';
  }
  function pfTapeRowsHtml() {
    var out = periph.tape.slice(-12).map(function (e) {
      return '<div class="e ' + (PF_TAPE_KINDS[e.k] || 'note') + '"><span class="t">' + e.t + 'ms</span><span class="m">' + esc(e.k + " " + e.d) + '</span></div>';
    }).join('');
    return out || '<div class="e note"><span class="t">—</span><span class="m">(no CPU events yet)</span></div>';
  }
  function pfTapeCard() {
    return '<section class="pf-card"><h3>Behaviour tape<span class="pf-sub">what the grader watches over time</span></h3>' +
      '<div class="pf-tapestat" id="pf-tapestat">' + pfTapeStatHtml() + '</div>' +
      '<div class="pf-log pf-tape" id="pf-tape">' + pfTapeRowsHtml() + '</div>' +
      '<p class="pf-hint">A register snapshot says what is true <b>now</b>; this says what the CPU <b>did</b>. Every handler entry, exit, ISR-driven pin write and lost update lands here with its sim-clock stamp. Stage 9 is graded on ' + PF_GOAL9_MIN_ENTRIES + ' entries on a steady cadence <em>and</em> on the newest one being recent — the cadence is judged over the last ' + PF_TAPE_WINDOW + ' entries, so an old hiccup ages out and a handler that has stopped is visible immediately.</p></section>';
  }
  /* stage 7: swim-lane timeline over the per-tick CPU context history —
     shows at a glance who owns the CPU and when a handler was preempted. */
  function pfTimelineCard() {
    return '<section class="pf-card"><h3>Interrupt timeline<span class="pf-sub">who owns the CPU, last ~15 s</span></h3>' +
      '<div class="pf-tl" id="pf-tl"><svg viewBox="0 0 300 96" preserveAspectRatio="none"></svg></div>' +
      '<p class="pf-hint">One lane per context, time flows left → right. The <b>main</b> lane owns the CPU whenever no handler is running; a handler lane lights while it executes, and a <em>notch</em> in the main lane is stolen time. A preemption looks like a shorter bar starting on top of a longer one — the lower-priority handler resumes when the upper bar ends.</p></section>';
  }
  /* stage 3: the solder behind the symbol — pin cell for PA5, live from
     MODER / OTYPER / PUPDR / ODR (plus the pad via IDR when PA5 is an input). */
  function pfPinState(pin) {
    var clk = pfClkOn("GPIOA"), m = pfModer(pin), pull = pfPull(pin);
    var st = { clk: clk, m: m, pull: pull, otd: 0, lvl: 0, flt: false, od: ((periph.gpioa.OTYPER >>> pin) & 1) === 1 };
    if (!clk) { st.note = m === 0 ? "floating · no clock" : "driver dead · no clock"; st.flt = m === 0; return st; }
    if (m === 0) {
      if (pull === 1) { st.lvl = 1; st.note = "pulled high — reads 1"; }
      else if (pull === 2) { st.note = "pulled low — reads 0"; }
      else {
        var sw = periph.switches[pin];
        if (sw === undefined) { st.flt = true; st.note = "FLOATING — the pad drifts, IDR is noise"; }
        else { st.lvl = sw ? 1 : 0; st.note = "driven by SW" + pin + " — reads " + (sw ? "1" : "0"); }
      }
      return st;
    }
    if (m !== 1) { st.note = m === 2 ? "Alternate Function — USART/SPI owns the driver" : "analog — digital cell disconnected"; return st; }
    st.otd = (periph.gpioa.ODR >>> pin) & 1;
    if (st.od && !st.otd) { st.note = "open-drain releasing — line floats (external pull-up decides)"; st.flt = true; }
    else { st.lvl = st.otd; st.note = (st.od ? "open-drain" : "push-pull") + " driving " + (st.otd ? "HIGH" : "LOW"); }
    return st;
  }
  function pfPinCard(pin) {
    var zz = function (x0, y) { var pts = [], i; for (i = 0; i <= 16; i++) { pts.push((x0 + i * 2) + ',' + (y + (i % 2 ? -5 : 5))); } return pts.join(' '); };
    /* inner is optional: a group with no children must not interpolate the word
       "undefined" into the SVG (the pad <g> did exactly that until the register
       spec started scanning every stage render). */
    var g = function (id, cls, inner) { return '<g id="pf-pin5-' + id + '" class="' + cls + '">' + (inner || '') + '</g>'; };
    return '<section class="pf-card"><h3>Inside the pin<span class="pf-sub">the solder behind GPIOA · PA' + pin + '</span></h3>' +
      '<div class="pf-pinum"><svg viewBox="0 0 300 168" preserveAspectRatio="xMidYMid meet">' +
        '<text class="lab" x="4" y="14">VDD</text><text class="lab" x="4" y="164">VSS</text>' +
        '<line class="w" x1="20" y1="20" x2="52" y2="20"></line>' +
        g("pu", "pull", '<polyline points="' + zz(52, 20) + '"></polyline>') +
        '<line class="w" x1="88" y1="20" x2="248" y2="20"></line><line class="w" x1="248" y1="20" x2="248" y2="70"></line>' +
        '<text class="lab" x="94" y="14">pull-up</text>' +
        '<line class="w" x1="20" y1="140" x2="52" y2="140"></line>' +
        g("pd", "pull", '<polyline points="' + zz(52, 140) + '"></polyline>') +
        '<line class="w" x1="88" y1="140" x2="248" y2="140"></line><line class="w" x1="248" y1="140" x2="248" y2="86"></line>' +
        '<text class="lab" x="94" y="164">pull-down</text>' +
        '<rect class="box" x="122" y="12" width="54" height="26" rx="2"></rect><text class="lab cen" x="149" y="28">P-MOS</text>' +
        '<rect class="box" x="122" y="118" width="54" height="26" rx="2"></rect><text class="lab cen" x="149" y="134">N-MOS</text>' +
        g("pmos", "sw", '<circle cx="149" cy="51" r="5"></circle>') + g("nmos", "sw", '<circle cx="149" cy="105" r="5"></circle>') +
        '<line class="w" x1="149" y1="38" x2="149" y2="64"></line>' +
        '<line class="w" x1="149" y1="118" x2="149" y2="92"></line>' +
        '<line class="w" x1="20" y1="8" x2="149" y2="8"></line>' +
        '<line class="w" x1="20" y1="8" x2="20" y2="20"></line>' +
        '<line class="w" x1="20" y1="148" x2="20" y2="160"></line>' +
        '<line class="w" x1="20" y1="160" x2="149" y2="160"></line>' +
        '<line class="w" x1="149" y1="78" x2="236" y2="78"></line>' +
        '<circle class="j" cx="149" cy="78" r="2.5"></circle>' +
        '<text class="lab" x="108" y="72">ODR' + pin + '</text>' +
        '<rect class="box" x="62" y="64" width="46" height="28" rx="2"></rect><text class="lab cen" x="85" y="81">MODER</text>' +
        '<rect class="box" x="236" y="64" width="40" height="28" rx="2"></rect><text class="lab cen" x="256" y="81">Schmitt</text>' +
        '<line class="w" x1="236" y1="78" x2="276" y2="78"></line>' +
        '<line class="w" x1="256" y1="92" x2="256" y2="112"></line><text class="lab cen" x="256" y="124">IDR' + pin + '</text>' +
        g("pad", "pad") + '<text class="lab" x="240" y="64">PA' + pin + '</text>' +
        '<text class="lab cen" id="pf-pin5-note" x="150" y="154"></text>' +
      '</svg>' +
      '<div class="pf-pinlegend"><span><i class="k on"></i>conducting / driven</span><span><i class="k off"></i>off</span><span><i class="k flt"></i>floating</span></div></div>' +
      '<p class="pf-hint"><b>Push-pull</b>: one of the two MOSFETs is always on — the line is <em>actively</em> driven both ways. <b>Open-drain</b> (click OTYPER bit ' + pin + '): only the N-MOS exists; writing 1 lets go and the line floats — that is how I²C shares one wire, and why it needs external pull-ups. <b>PUPDR</b> weak resistors keep an unconnected input from floating. Change PA5 in the tiles above and watch the cell follow.</p></section>';
  }

  function pfPinModeTile(pin) {
    return '<div id="pf-mod-' + pin + '" data-moder="' + pin + '"><span class="pin">PA' + pin + '</span><span class="mode"></span></div>';
  }

  /* ---- goals: each stage ends with something the model can actually grade ---- */
  function pfPaLit(p) { return pfClkOn("GPIOA") && pfModer(p) === 1 && (((periph.gpioa.ODR >>> p) & 1) !== 0); }
  var PF_GOALS = {
    2: { text: 'Using <b>only bit clicks</b>, make AHB1ENR read <code>0x01</code>. That single bit is the whole difference between a GPIO that exists and a GPIO wired to nothing.',
         ok: function () { return periph.rcc.AHB1ENR === 0x01; },
         hint: function () { return 'Bit 0 (the box labelled 0, rightmost) is still 0 — click it. Everything else must stay 0.'; } },
    3: { text: 'Light the <b>PA5★</b> LED. Three separate truths must hold at once: GPIOA clocked, PA5 in <b>OUT</b> mode, ODR bit 5 high.',
         ok: function () { return pfPaLit(5); },
         hint: function () {
           if (!pfClkOn("GPIOA")) { return 'PA5 is set but the LED stays dark — does GPIOA even have a clock? (Stage 2 knowledge.)'; }
           if (pfModer(5) !== 1) { return 'Clock is on, ODR may be set — but PA5 is in ' + PF_MODE_NAMES[pfModer(5)] + ' mode. Only OUT drives the pad.'; }
           return 'Output mode is right — nothing is driving the pin. ODR bit 5?';
         } },
    4: { text: 'Let the <b>poll loop</b> do the work: PA0 as input, PA5 as output, start <code>while(1)</code>, flip <b>SW0 high</b> — PA5 must light <em>because of the loop</em>, not because you poked ODR.',
         ok: function () { return periph.poll.active && pfClkOn("GPIOA") && pfModer(0) === 0 && pfModer(5) === 1 && periph.switches[0] && (((periph.gpioa.ODR >>> 5) & 1) === 1); },
         hint: function () {
           if (!periph.poll.active) { return 'Start the poll loop first — nothing copies IDR to ODR without it.'; }
           if (pfModer(0) !== 0) { return 'PA0 is in ' + PF_MODE_NAMES[pfModer(0)] + ' mode — an output pin cannot read a switch.'; }
           if (!periph.switches[0]) { return 'Flip SW0 high and watch the pad (IDR bit 0), then the LED.'; }
           return 'Check PA5 is an output and GPIOA is clocked.';
         } },
    5: { text: 'Retune TIM2 so its update rate lands between <b>0.5 Hz and 2 Hz</b> and keep it running (clock on, CEN set). Use only PSC and ARR.',
         ok: function () { var T = periph.tim2; return pfClkOn("TIM2") && (T.CR1 & 1) !== 0 && pfUpdateRateHz(T) >= 0.5 && pfUpdateRateHz(T) <= 2; },
         hint: function () { var r = pfUpdateRateHz(periph.tim2); return 'Current rate: ' + r.toFixed(2) + ' Hz = 1000 / ((PSC+1)·(ARR+1)). Pick factors of ~500–2000 that land in 0.5–2 Hz — e.g. PSC 9, ARR 99.'; } },
    6: { text: 'Fire the TIM2 handler <b>once</b>. Every gate has to agree: clock, CEN, DIER, ISER0 bit 28, PRIMASK = 0. You do not need PSC/ARR tuned — 1 kHz defaulting fires fast enough.',
         ok: function () { return (periph.fired.TIM2 | 0) >= 1 && periph.cpu.PRIMASK === 0; },
         hint: function () {
           var T = periph.tim2;
           if (!pfClkOn("TIM2")) { return 'TIM2 has no clock — its counter is frozen, so no flag, no request.'; }
           if (!(T.CR1 & 1)) { return 'CEN is 0 — the counter never rolls over.'; }
           if (!(T.DIER & 1)) { return 'The counter rolls and UIF sets, but DIER.UIE is 0: the timer keeps its interrupt to itself.'; }
           if (((periph.nvic.ISER0 >>> PF_TIM2_IRQ_BIT) & 1) === 0) { return 'The request reaches the NVIC but ISER0 bit 28 is 0 — masked.'; }
           return 'Check the remaining gate in the NVIC table — which column still shows 0?';
         } },
    7: { text: 'Cause <b>one preemption</b>: two timers firing, both unmasked, and the pending IRQ must be <em>more urgent</em> — a lower IPR number — than the running handler. One click arms a working demo; changing the two IPR numbers is the real lesson.',
         ok: function () { return periph.nestCount >= 1; },
         hint: function () { return periph.cpu.PRIMASK ? 'PRIMASK is set — nothing dispatches. Clear it.' : 'Preemption needs a lower-priority handler already on the CPU when a more urgent request lands. If TIM3 is the one running, make TIM3 the <em>less</em> urgent (bigger IPR number).'; } },
    8: { text: 'Break something on purpose: run the racy main loop until the log shows a <b>lost update</b> (≥ 1), then flip main() to <b>BSRR</b> and watch the lost counter stop moving while the LED keeps blinking.',
         ok: function () { return periph.race.lost >= 1 && periph.race.useBsrr === true; },
         hint: function () { return periph.race.lost < 1 ? 'Nothing lost yet — arm the ISR, run the racy main loop, and give it a second or two.' : 'You have seen the damage — now switch main() to BSRR and confirm the counter freezes.'; } },
    9: { text: 'Cold start, no net: make PA5★ blink from the TIM2 interrupt at <b>1.5 – 2.6 Hz</b>. Clocks, pin mode, CEN, DIER, ISER0[28], PRIMASK = 0 — all of it, from a power-on reset. Then prove it <em>keeps</em> running: the behaviour tape must show ' + PF_GOAL9_MIN_ENTRIES + ' handler entries on a steady cadence, not one lucky snapshot.',
         ok: function () {
           var T = periph.tim2, r = pfUpdateRateHz(T);
           return pfClkOn("GPIOA") && pfModer(5) === 1 && pfClkOn("TIM2") && (T.CR1 & 1) !== 0 &&
                  r >= 1.5 && r <= 2.6 && (T.DIER & 1) !== 0 &&
                  ((periph.nvic.ISER0 >>> PF_TIM2_IRQ_BIT) & 1) !== 0 &&
                  periph.cpu.PRIMASK === 0 && pfTapeStillRunning();
         },
         hint: function () { return 'The checklist on the left shows exactly which gate is still shut; the behaviour tape shows whether the handler ran on a cadence once the gates opened.'; } }
  };
  function pfGoalCard(n) {
    var g = PF_GOALS[n];
    if (!g) { return ''; }
    var done = !!periph.goals[n];
    return '<section class="pf-card pf-goal' + (done ? ' hit' : '') + '"><h3>Your move<span class="pf-sub">stage ' + n + ' goal</span></h3><p class="pf-teach">' + g.text + '</p>' +
      '<div class="pf-goalarow"><button type="button" class="btn" data-goal="' + n + '">✓ Verify</button>' +
      (done ? '<b class="pf-donet">achieved ✓</b>' : '<b class="pf-openet">not yet</b>') + '</div>' +
      '<p class="pf-hint" id="pf-goal-hint-' + n + '"></p></section>';
  }
  var PF_CH9 = [
    { l: 'GPIOA clocked (AHB1ENR[0])',              f: function () { return pfClkOn("GPIOA"); } },
    { l: 'PA5 is an output (MODER[11:10] = 01)',    f: function () { return pfModer(5) === 1; } },
    { l: 'TIM2 clocked (APB1ENR[0])',               f: function () { return pfClkOn("TIM2"); } },
    { l: 'TIM2 running (CR1.CEN)',                  f: function () { return (periph.tim2.CR1 & 1) !== 0; } },
    { l: 'update rate in 1.5 – 2.6 Hz',             f: function () { var r = pfUpdateRateHz(periph.tim2); return r >= 1.5 && r <= 2.6; } },
    { l: 'TIM2 requests an IRQ (DIER.UIE)',         f: function () { return (periph.tim2.DIER & 1) !== 0; } },
    { l: 'NVIC line open (ISER0[28])',              f: function () { return ((periph.nvic.ISER0 >>> PF_TIM2_IRQ_BIT) & 1) !== 0; } },
    { l: 'PRIMASK = 0',                             f: function () { return periph.cpu.PRIMASK === 0; } },
    { l: PF_GOAL9_MIN_ENTRIES + ' handler entries on a steady cadence', f: function () { return pfTapeStillRunning(); } }
  ];
  function pfChecklistCard() {
    var rows = PF_CH9.map(function (c, i) {
      return '<li id="pf-ch9-' + i + '"><span class="bx">·</span>' + esc(c.l) + '</li>';
    }).join('');
    return '<section class="pf-card"><h3>Grading checklist<span class="pf-sub">live — verify when all nine are green</span></h3><ul class="pf-check" id="pf-ch9">' + rows + '</ul></section>';
  }

  /* ---- stage-specific control rigs ---- */
  function pfPollCtlCard() {
    return '<section class="pf-card"><h3>Poll loop<span class="pf-sub">burn a core doing nothing else</span></h3>' +
      '<div class="pf-goalarow"><button type="button" class="btn" id="pf-poll-toggle" aria-pressed="' + String(periph.poll.active) + '">' + (periph.poll.active ? '■ Stop poll loop' : '▶ Run while(1) { IDR → ODR }') + '</button><span class="pf-cpubusy" id="pf-poll-busy">CPU idle</span></div>' +
      '<pre class="pf-code">while (1) {\n    if (GPIOA->IDR &amp; (1u &lt;&lt; 0)) GPIOA->ODR |=  (1u &lt;&lt; 5);\n    else                          GPIOA->ODR &amp;= ~(1u &lt;&lt; 5);\n}</pre>' +
      '<p class="pf-hint">While this runs, the CPU does <b>nothing else</b>. When the timer-interrupt story starts in stage 6, keep asking: what did polling cost, and who pays it?</p></section>';
  }
  function pfNestCtlCard() {
    return '<section class="pf-card"><h3>Nesting demo<span class="pf-sub">one button, then read the log</span></h3>' +
      '<div class="pf-goalarow"><button type="button" class="btn" id="pf-nest-arm">⚡ Arm: TIM2 @ 2 Hz (prio 2) + TIM3 @ 5 Hz (prio 1)</button></div>' +
      '<p class="pf-hint">The arm button writes real values: both clocks, PA5+PA6 as outputs, TIM2 PSC 9 / ARR 49, TIM3 PSC 9 / ARR 19, both DIER, ISER0 bits 28+29, PRIMASK clear. The TIM2 handler holds the CPU ≈ 400 ms; TIM3 knocks every 200 ms <em>during</em> it, with a lower IPR number — so you should see enter → ⚡ preempt → exit → resume → exit.</p></section>';
  }
  function pfRaceCtlCard() {
    return '<section class="pf-card"><h3>Race rig<span class="pf-sub">main() vs the ISR, same ODR</span></h3>' +
      '<div class="pf-goalarow" style="flex-wrap:wrap">' +
        '<button type="button" class="btn" id="pf-race-arm">⚡ Arm TIM2 ISR → toggles PA6</button>' +
        '<button type="button" class="btn" id="pf-race-run">▶ main(): ODR read…modify…write</button>' +
        '<button type="button" class="btn" id="pf-race-bsrr">⇄ main(): BSRR (atomic)</button>' +
        '<button type="button" class="btn" id="pf-race-stop">■ Stop main loop</button>' +
      '</div>' +
      '<div class="pf-racestat">lost updates <b id="pf-race-lost">0</b> · main toggles <b id="pf-race-toggles">0</b> · main() is <b id="pf-race-mode">stopped</b></div>' +
      '<pre class="pf-code">/* main loop — two statements, one tick apart: */\nuint32_t tmp = GPIOA->ODR;         /* READ  — snapshot of ALL 16 bits  */\nGPIOA->ODR = tmp ^ (1u &lt;&lt; 5);     /* WRITE — snapshot ±bit5, STALE for bit6 */</pre>' +
      '<p class="pf-hint">main() owns PA5 (bit 5), the ISR owns PA6 (bit 6). Neither touches the other\'s bit — yet PA6 goes dark. <code>|=</code> is three bus transactions with a <em>window</em> in the middle. The fix: BSRR, which is write-only and atomic by hardware design. Same lesson generalises: <code>volatile</code> makes a shared variable <em>visible</em>, never <em>atomic</em>.</p></section>';
  }

  /* ---- stage 1 props ---- */
  function pfMemMapCard() {
    function row(addr, name, desc, peekId) {
      return '<div class="pf-mmrow"><span class="a">' + addr + '</span><span class="n">' + name + '</span><span class="d">' + desc + '</span>' + (peekId ? '<span class="pk" id="' + peekId + '">—</span>' : '') + '</div>';
    }
    return '<section class="pf-card"><h3>The address map<span class="pf-sub">live — these values move while you play</span></h3>' +
      '<div class="pf-mm">' +
      row('0xE000_E100', 'NVIC → ISER0', 'the core\'s interrupt controller', 'pf-peek-nvic') +
      row('0x4002_3830', 'RCC → AHB1ENR', 'the clock switches', 'pf-peek-rcc') +
      row('0x4002_0014', 'GPIOA → ODR', 'which pins the port drives', 'pf-peek-odr') +
      row('0x4000_0024', 'TIM2 → CNT', 'a counter ticking right now', 'pf-peek-cnt') +
      row('0x2000_0000', 'SRAM', 'variables — real memory, initialised by startup code') +
      row('0x0800_0000', 'FLASH', 'your program — .isr_vector, .text, .rodata') +
      '</div>' +
      '<p class="pf-hint">Peripheral registers are <b>not memory</b>: each address decodes into wires inside hardware. <code>*(volatile uint32_t *)0x40020014</code> lands on exactly the box labelled GPIOA → ODR. That is what <em>memory-mapped I/O</em> means — the Linker &amp; Startup lab chose these addresses; here you see what lives at them.</p></section>';
  }
  function pfClockTreeCard() {
    return '<section class="pf-card"><h3>Clock tree<span class="pf-sub">no clock, no peripheral</span></h3>' +
      '<div class="pf-clock-tree">HSI 16 MHz ─→ SYSCLK ─→ AHB prescaler ─┬─ AHB1ENR[0] ─→ <span id="pf-ct-gpioa">GPIOA · off</span><br>' +
      '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└─ APB1ENR[0] ─→ <span id="pf-ct-tim2">TIM2 · off</span>&nbsp;&nbsp;APB1ENR[1] ─→ <span id="pf-ct-tim3">TIM3 · off</span></div>' +
      '<p class="pf-hint">At reset every gate below is <b>off</b> — silicon saves power by not feeding logic it cannot see. The STM32F4 has ~40 of these enables; a peripheral with its clock off answers <em>nothing</em>: writes vanish, reads return garbage or hang the bus. This model drops those writes and says so in the log. In this sim the timer clocks are scaled to 1 kHz so you can watch a second pass by.</p></section>';
  }
  function pfQuizCard() {
    function opt(a, good, why) {
      return '<button type="button" class="btn" data-quiz="' + (good ? "1" : "0") + '" data-why="' + esc(why) + '">' + esc(a) + '</button>';
    }
    return '<section class="pf-card pf-goal"><h3>Check yourself<span class="pf-sub">stage 1 goal</span></h3>' +
      '<p class="pf-teach">The C is <code>GPIOA-&gt;ODR |= (1u &lt;&lt; 5);</code>. What does the address behind <code>GPIOA-&gt;ODR</code> physically decode to?</p>' +
      '<div class="pf-goalarow" style="flex-wrap:wrap">' +
        opt('An SRAM cell at 0x2000_0014', false, 'SRAM is variables. Writing it changes a number in memory — the pad never hears about it.') +
        opt('A word in FLASH at 0x0800_0014', false, 'Flash holds the program itself — not writable while it runs, and not hardware.') +
        opt('A register inside the GPIOA block at 0x4002_0014', true, 'Correct. The bus address decodes into the GPIOA peripheral, and bit 5 of its ODR drives the PA5 pad. That is memory-mapped I/O.') +
        opt('One of the CPU\'s own registers (R0–R15)', false, 'Core registers live inside the CPU, addressed by encoding, not by bus address. ODR is out on the bus.') +
      '</div><p class="pf-hint" id="pf-quiz-why"></p></section>';
  }

  /* ---- the "Your code" record, present in every stage ---- */
  function pfUsercodeCard() {
    return '<section class="pf-card"><h3>Your code<span class="pf-sub">what your clicks are equivalent to</span></h3>' +
      '<pre class="pf-code pf-usercode" id="pf-user-code"></pre>' +
      '<div style="display:flex;gap:6px;margin-top:8px">' +
        '<button type="button" class="btn" id="pf-user-copy">Copy</button>' +
        '<button type="button" class="btn" id="pf-user-clear">Clear</button>' +
      '</div>' +
      '<p class="pf-hint">Every bit you flip appends the equivalent C here, <b>grouped by stage</b>. Preset steps do not — this stays a record of what you did by hand. Copy it out and it is real driver code.</p></section>';
  }

  /* ---- the stage-10 program browser (presets live only here) ---- */
  function pfCodeColumn() {
    var p = pfPresetById(periph.preset);
    if (!p) {
      return '<section class="pf-card"><h3>Program<span class="pf-sub">pick a preset to load</span></h3><p class="pf-hint">Each preset is a small <b>fixed, correct</b> C program — no free-form editing, so nothing here can teach you the wrong idiom. Step through it line by line and watch each write take effect on the register bank.</p></section>';
    }
    var lines = '';
    for (var j = 0; j < p.steps.length; j++) {
      var st = p.steps[j];
      var scls = j < periph.stepIdx ? 'done' : (j === periph.stepIdx ? 'cur' : '');
      var parts = String(st.c).split('\n');
      for (var k = 0; k < parts.length; k++) {
        lines += '<span class="ln ' + scls + '" data-ln="' + j + '">' + esc(parts[k]) + '</span>';
      }
    }
    var isr = p.isrSrc ? '<section class="pf-card"><h3>ISR the NVIC dispatches to<span class="pf-sub">TIM2_IRQHandler</span></h3><div class="pf-isr"><pre class="src">' + esc(p.isrSrc) + '</pre></div></section>' : '';
    return '<section class="pf-card"><h3>Program<span class="pf-sub">' + esc(p.label) + '</span></h3><pre class="pf-code" id="pf-code">' + lines + '</pre>' +
      '<p class="pf-hint" id="pf-preset-hint">' + esc(p.hint || '') + '</p></section>' + isr;
  }

  /* ---- per-stage layouts: registers ∪ observables ∪ goal, nothing else ---- */
  function pfCols() {
    var cls = 'pf-grid';
    var args = Array.prototype.slice.call(arguments);
    if (args.length === 2) { cls += ' pf-grid2'; }
    var out = '<div class="' + cls + '">';
    args.forEach(function (c, i) {
      out += '<div class="pf-col pf-col-' + (args.length === 3 ? ['reg', 'obs', 'code'][i] : ['reg', 'obs'][i]) + '">' + c + '</div>';
    });
    return out + '</div>';
  }
  function pfStage10Body() {
    return '<div class="pf-grid">' +
        '<div class="pf-col pf-col-reg">' + pfRccCard() + pfGpioaCard() + pfPupdrCard() + pfBsrrCard() + pfTimCard('TIM2') + pfTimCard('TIM3') + pfNvicCard() + pfCpuCard() + '</div>' +
        '<div class="pf-col pf-col-obs">' + pfLedsCard() + pfSwCard() + pfWaveCard('TIM2') + pfWaveCard('TIM3') + pfTapeCard() + pfLogCard() + '</div>' +
        '<div class="pf-col pf-col-code">' + pfRunCtlCard() + pfCodeColumn() + pfUsercodeCard() + '</div>' +
      '</div>';
  }
  function pfRunCtlCard() {
    var presetBtns = PF_PRESETS.map(function (p) {
      return '<button type="button" data-preset="' + p.id + '" aria-pressed="' + String(periph.preset === p.id) + '">' + esc(p.label) + '</button>';
    }).join('');
    return '<div class="pf-presets"><b>Presets</b>' + presetBtns + '</div>' +
      '<div class="pf-runbar">' +
        '<button type="button" class="btn" id="pf-step"' + (pfPresetById(periph.preset) ? '' : ' disabled') + '>▶ Next step</button>' +
        '<button type="button" class="btn" id="pf-runall"' + (pfPresetById(periph.preset) ? '' : ' disabled') + '>⏵ Run all setup</button>' +
      '</div>';
  }
  function pfStageBody(n) {
    switch (n) {
      case 1: return pfCols(
          pfTeach('What a peripheral actually is',
            '<p>In this CPU, a "register" is not a variable. <code>GPIOA-&gt;ODR</code> is a pointer to <b>address 0x4002_0014</b>, and that address decodes into solder: flip-flops holding a voltage on a bond pad. Write it and physics follows — microseconds later a LED is lit. Read it and you sample the real world.</p>' +
            '<p>Three consequences run this entire module: <b>(1)</b> every peripheral sits at a fixed address chosen by the chip designer, in the <b>peripheral map</b>, not in RAM; <b>(2)</b> reading or writing one is a <em>bus transaction</em>, visible on a logic analyser; <b>(3)</b> most peripherals are switched off at reset and answer <em>nothing</em> until their clock is enabled. Everything after this stage is the detail of (3) → (1).</p>') +
          pfMemMapCard(),
          pfClockTreeCard() + pfQuizCard() + pfLogCard());
      case 2: return pfCols(
          pfTeach('Bits, not bytes',
            '<p>A 32-bit enable register is 32 independent switches. The craft is touching <b>one</b> without lying about the other 31 — which rules out plain <code>=</code>. The three idioms (<code>|=</code> set, <code>&amp;= ~</code> clear, <code>^=</code> toggle) each read-modify-write the whole register; the compiler emits a load, an ALU op, a store. CMSIS headers give every bit a name so <code>RCC_AHB1ENR_GPIOAEN</code> documents itself.</p>' +
            '<p>Click the bit boxes below — each click performs exactly one of these idioms for you, and the <em>Your code</em> panel on the right shows the line it was worth.</p>') +
          pfRccCard(),
          pfGoalCard(2) + pfUsercodeCard() +
          '<section class="pf-card"><h3>Effect<span class="pf-sub">what bit 0 actually unlocks</span></h3><div class="pf-ct2">GPIOA clock: <b id="pf-ct-gpioa2">off</b> — when off, every write to every GPIOA register is silently dropped.</div></section>') ;
      case 3: return pfCols(
          pfTeach('MODER decides, ODR drives',
            '<p>Each pin has <b>2 mode bits</b> (IN / OUT / AF / ANALOG) packed 16 to a register — that is why MODER is 32 bits for 16 pins and why the idiom is <code>~(3u &lt;&lt; pin*2)</code>. After reset every pin is an <b>input</b>: safe, high-impedance, deaf. ODR always exists and always remembers its value, but the pad only <em>follows</em> ODR when MODER says OUT.</p>' +
            '<p>The same packing idea runs through the rest of GPIOA: PUPDR is 2 bits per pin (pull none / up / down), and the pin cell below is wired to it. Click any bit in the PUPDR card to cycle a pin and watch the solder follow.</p>') +
          pfGpioaCard('MODER tiles + ODR — IDR waits for stage 4') + pfPupdrCard() + pfPinCard(5),
          pfLedsCard(),
          pfGoalCard(3) + pfUsercodeCard());
      case 4: return pfCols(
          pfTeach('The pad is not the memory',
            '<p><b>IDR is the wire. ODR is what you asked for.</b> Configure PA0 as input and the switch state appears in IDR bit 0 — nothing to do with any register you wrote. If software drives PA5 high but a stronger external circuit pulls it low, ODR still reads 1 while the pad is 0. Polling is the simplest use of that truth: loop, read the pad, act.</p>' +
            '<p>Set PA0 → IN, PA5 → OUT, then start the loop and flip SW0. Watch the CPU-busy light: during <code>while(1)</code> this core can do <em>nothing else</em> — which is the whole motivation for interrupts in stage 6.</p>') +
          pfGpioaCard('set PA0 to IN and PA5 to OUT') + pfPupdrCard() + pfPollCtlCard(),
          pfSwCard() + pfLedsCard('ODR bit 5 ← poll loop ← IDR bit 0 ← SW0'),
          pfGoalCard(4) + pfLogCard());
      case 5: return pfCols(
          pfTeach('Counting is dividing',
            '<p>TIM2 is an elevator counter: <b>CNT</b> ticks up from 0 to <b>ARR</b>, wraps, and — if you asked — flags an update. <b>PSC</b> prescales the 1 kHz model clock: one CNT step per PSC+1 ticks. So a full period takes <code>(PSC+1) × (ARR+1)</code> clock ticks — two 16-bit dividers cascade to turn 1 kHz into anything from a nanosecond-fraction to minutes.</p>' +
            '<p>Now the waveform below does double duty: the <b>dashed ARR line is draggable</b> (grab it vertically), and the <b>CCR slider</b> writes the timer\'s real compare register — the same CCR row the register bank above shows — while the trace draws what a PWM output would do: high while CNT &lt; CCR. Watch <b>PA5★ dim</b> as you widen the duty. What is not built yet is the output side: the compare channel (CCMR/CCER) gating that signal onto an AF pin.</p>') +
          pfTimCard('TIM2'),
          pfWaveCard('TIM2'),
          pfGoalCard(5) + pfUsercodeCard() + pfLogCard());
      case 6: return pfCols(
          pfTeach('An interrupt is a chain of Yesses',
            '<p>The flag is only a <em>request</em>. For the vector table to fire, four gates must agree: <b>clock</b> (else no counter, no flag), <b>DIER.UIE</b> (the peripheral must route its flag to the NVIC line), the <b>NVIC line</b> (unmasked with <b>ISER0[28]</b>, masked again through <b>ICER</b>), and <b>PRIMASK = 0</b> (the CPU must accept). The table below shows each gate live.</p>' +
            '<p>Get the chain complete and the log shows enter → W1C → toggle → exit. Set PRIMASK and watch the same chain stall at the last gate — the flag stays set, the request <em>pending</em>, the instant PRIMASK clears.</p>') +
          pfTimCard('TIM2'),
          pfNvicCard() + pfCpuCard(),
          pfGoalCard(6) + pfLedsCard() + pfLogCard());
      case 7: return pfCols(
          pfTeach('When urgent beats busy',
            '<p>Every IRQ has a priority number in <b>IPR</b> — <em>lower number = more urgent</em> (backward, but that is ARM\'s convention). A request only preempts the running handler if it is strictly more urgent; equal priorities wait in the queue, and the handler stack nests. A long handler with the wrong priority settings is how you get <em>missed</em> events — or priority inversion.</p>' +
            '<p>Arm the demo, then fight it: swap the two IPR numbers and see which order survives.</p>') +
          pfTimCard('TIM2') + pfTimCard('TIM3'),
          pfNvicCard() + pfCpuCard() + pfTimelineCard() + pfNestCtlCard(),
          pfGoalCard(7) + pfTapeCard() + pfLedsCard() + pfLogCard());
      case 8: return pfCols(
          pfTeach('Read-modify-write is not a promise',
            '<p><code>ODR |= bit</code> is three bus transactions. Between the read and the write, the world may change the other bits — classically, an interrupt handler. The write-back overwrites them with the stale snapshot: a <b>lost update</b>. No compile warning, no bus error; your LED just sometimes refuses. Fixes, in order of preference: use a peripheral that gives you an <b>atomic write-only</b> register (BSRR), or take a critical section (<code>__disable_irq()</code> around the RMW). <code>volatile</code> fixes the compiler re-reading; it fixes nothing about the window.</p>') +
          pfGpioaCard('bit 5 = main()\'s LED · bit 6 = the ISR\'s') + pfBsrrCard() + pfRaceCtlCard(),
          pfLedsCard('PA5 ← main() · PA6 ← ISR') + pfCpuCard(),
          pfGoalCard(8) + pfLogCard());
      case 9: return pfCols(
          pfTeach('Bring-up, blind',
            '<p>Power-on reset is pressed for you (stage bar → Playground aside: hit <b>⏻ Power-on reset</b> to be sure). You get the full bank and one sentence of spec:</p>' +
            '<p class="pf-spec">PA5 must blink under the TIM2 update interrupt at 1.5 – 2.6 Hz. Nothing else. No step buttons, no hints until you verify.</p>' +
            '<p>Every wrong or missing write is visible somewhere — dropped-write log lines, the gate table, the checklist on the right. That is exactly what a logic analyser and a debugger are on real silicon.</p>') +
          pfRccCard() + pfGpioaCard() + pfTimCard('TIM2'),
          pfNvicCard() + pfCpuCard() + pfWaveCard('TIM2'),
          pfGoalCard(9) + pfChecklistCard() + pfTapeCard() + pfLedsCard() + pfLogCard());
      case 10: return pfStage10Body();
      default: return pfStage10Body();
    }
  }
  function pfStageNav() {
    return '<nav class="pf-stagenav" role="tablist" aria-label="Peripherals stages">' +
      PF_STAGE_META.map(function (s) {
        return '<button type="button" role="tab" data-pfstage="' + s.id + '" aria-selected="' + String(periph.stage === s.id) + '" title="' + esc(s.tag) + '">' +
          (periph.goals[s.id] ? '<span class="gd">✓</span>' : '<span class="num">' + s.id + '</span>') + '<span class="stn">' + esc(s.name) + '</span></button>';
      }).join('') + '</nav>';
  }
  function pfBody() {
    return pfStageNav() +
      '<div class="pf-runbar">' +
        '<button type="button" class="btn" id="pf-pause" aria-pressed="' + String(!periph.running) + '">' + (periph.running ? '⏸ Pause sim' : '⏵ Resume sim') + '</button>' +
        '<button type="button" class="btn" id="pf-reset">⏻ Power-on reset</button>' +
        '<span class="pf-stage-tag" id="pf-stage-tag">' + esc((pfStageById(periph.stage) || PF_STAGE_META[0]).tag) + '</span>' +
        '<span class="pf-simclock">sim t = <b id="pf-simclock">' + periph.simMs + '</b> ms</span>' +
      '</div>' +
      pfStageBody(periph.stage);
  }

  function pfRenderStatic() {
    var host = document.getElementById("periplab-body");
    if (!host) { return; }
    host.innerHTML = pfBody();
    pfWire(host);
    pfRenderLive();
    pfRenderUserCode();
    journalMount("periph", periph.stage, (pfStageById(periph.stage) || PF_STAGE_META[0]).name);
  }

  function pfRenderLive() {
    if (!periphInited) { return; }
    var host = document.getElementById("periplab-body");
    if (!host) { return; }
    /* LEDs + pin tiles */
    for (var p = 0; p < 16; p++) {
      var led = document.getElementById('pf-led-' + p);
      if (led) {
        var lit = pfPaLit(p);
        led.classList.toggle('on', lit);
        /* stage-5 visual PWM: PA5 dims with the timer's duty while TIM2 runs */
        var bulb = led.querySelector('.bulb');
        if (bulb) {
          var dim = 1;
          if (p === 5 && periph.stage === 5 && pfClkOn('TIM2') && (periph.tim2.CR1 & 1)) {
            dim = Math.min(1, Math.max(0, periph.tim2.CCR / (periph.tim2.ARR + 1)));
          }
          bulb.style.opacity = (lit && dim > 0) ? String(0.2 + 0.8 * dim) : '';
        }
      }
      var tile = document.getElementById('pf-mod-' + p);
      if (tile) {
        var m = pfModer(p);
        tile.querySelector('.mode').textContent = PF_MODE_NAMES[m];
        tile.classList.toggle('on', m === 1);
      }
    }
    /* Switches */
    for (var s = 0; s < 4; s++) {
      var sw = document.getElementById('pf-sw-' + s);
      if (sw) { sw.setAttribute('aria-pressed', String(!!periph.switches[s])); }
    }
    /* Register hex read-outs, driven through pfReadReg so both timers work */
    var hexSpecs = [
      ['rcc-ahb1', 'RCC', 'AHB1ENR', 2], ['rcc-apb1', 'RCC', 'APB1ENR', 2],
      ['gpioa-otyper', 'GPIOA', 'OTYPER', 4], ['gpioa-idr', 'GPIOA', 'IDR', 4], ['gpioa-odr', 'GPIOA', 'ODR', 4],
      ['gpioa-pupdr', 'GPIOA', 'PUPDR', 8], ['gpioa-bsrr', 'GPIOA', 'BSRR', 8],
      ['tim2-cr1', 'TIM2', 'CR1', 2], ['tim2-dier', 'TIM2', 'DIER', 2], ['tim2-sr', 'TIM2', 'SR', 2],
      ['tim2-psc', 'TIM2', 'PSC', 4], ['tim2-arr', 'TIM2', 'ARR', 4], ['tim2-ccr', 'TIM2', 'CCR', 4], ['tim2-cnt', 'TIM2', 'CNT', 4],
      ['tim3-cr1', 'TIM3', 'CR1', 2], ['tim3-dier', 'TIM3', 'DIER', 2], ['tim3-sr', 'TIM3', 'SR', 2],
      ['tim3-psc', 'TIM3', 'PSC', 4], ['tim3-arr', 'TIM3', 'ARR', 4], ['tim3-ccr', 'TIM3', 'CCR', 4], ['tim3-cnt', 'TIM3', 'CNT', 4],
      ['nvic-iser0', 'NVIC', 'ISER0', 8], ['nvic-icer0', 'NVIC', 'ICER0', 8]
    ];
    hexSpecs.forEach(function (h) {
      var e = document.getElementById('pf-hex-' + h[0]);
      if (e) { e.textContent = pfHex(pfReadReg(h[1], h[2]), h[3]); }
    });
    /* Bit boxes — resolve their source through data-pname when present */
    Array.prototype.forEach.call(host.querySelectorAll('.pf-bit[data-reg]'), function (b) {
      var reg = b.dataset.reg, bit = Number(b.dataset.bit);
      var pname = b.dataset.pname || pfPnameForReg(reg);
      if (!pname) { return; }
      var src = pfReadReg(pname, reg);
      if (src === null) { return; }
      var v = (src >>> bit) & 1;
      b.classList.toggle('one', v === 1);
      /* .ro is baked into the initial HTML (read-only or reserved) — never strip it */
      b.textContent = String(v);
      var bl = document.createElement('span'); bl.className = 'bl'; bl.textContent = String(bit);
      b.appendChild(bl);
    });
    /* Waveforms, rates and run state for both timers */
    ['TIM2', 'TIM3'].forEach(function (name) {
      var lk = name.toLowerCase(), T = pfTim(name);
      var cntEl = document.getElementById('pf-' + lk + '-cnt');
      if (cntEl) { cntEl.textContent = T.CNT + ' / ' + T.ARR; }
      var trace = document.getElementById('pf-wave-' + lk + '-trace');
      if (trace) {
        /* sawtooth row (y 52 → 10) + PWM row (y 88 low, 60 high) */
        var arr = Math.max(1, T.ARR);
        var r = T.CNT / arr;
        var x = (4 + 292 * r).toFixed(1);
        var y = (52 - 42 * r).toFixed(1);
        trace.setAttribute('points', '4,52 ' + x + ',' + y + ' ' + x + ',10 296,52');
        var pwm = document.getElementById('pf-wave-' + lk + '-pwm');
        if (pwm) {
          var ccr = Math.min(T.ARR, T.CCR);
          var xc = (4 + 292 * (ccr / arr)).toFixed(1);
          pwm.setAttribute('points', '4,60 ' + xc + ',60 ' + xc + ',88 296,88');
        }
        var arrL = document.getElementById('pf-wave-' + lk + '-arr');
        if (arrL) { var ya = (52 - 42 * Math.min(1, T.ARR / 65535)).toFixed(1); arrL.setAttribute('y1', ya); arrL.setAttribute('y2', ya); }
        var ccrL = document.getElementById('pf-wave-' + lk + '-ccr');
        if (ccrL) { var yc = (88 - 28 * Math.min(1, T.CCR / arr)).toFixed(1); ccrL.setAttribute('y1', yc); ccrL.setAttribute('y2', yc); }
        var duty = document.getElementById('pf-' + lk + '-duty');
        if (duty) { duty.textContent = Math.round(100 * Math.min(1, T.CCR / arr)) + ' % duty'; }
      }
      var rate = document.getElementById('pf-' + lk + '-rate');
      if (rate) { rate.textContent = pfUpdateRateHz(T).toFixed(2); }
      var run = document.getElementById('pf-' + lk + '-run');
      if (run) { run.textContent = !pfClkOn(name) ? 'no clock' : ((T.CR1 & 1) ? 'running (CEN)' : 'stopped (CEN=0)'); }
    });
    /* NVIC live gate table */
    var tb = document.getElementById('pf-irqtbl-body');
    if (tb) {
      tb.innerHTML = ['TIM2', 'TIM3'].map(function (name) {
        var spec = PF_IRQS[name], T = periph[spec.key];
        var flag = (T.SR & 1) !== 0, uie = (T.DIER & 1) !== 0, iser = ((periph.nvic.ISER0 >>> spec.bit) & 1) !== 0;
        var state;
        if (pfInStack(name)) { state = '<span class="st act">active</span>'; }
        else if (periph.cpu.PRIMASK && flag && uie && iser) { state = '<span class="st pend">pending · PRIMASK</span>'; }
        else if (!flag || !uie || !iser) { state = '<span class="st idle">idle</span>'; }
        else { state = ((pfPendingReqs().some(function (q) { return q.n === name; }))) ? '<span class="st pend">pending · lower prio</span>' : '<span class="st req">requested</span>'; }
        function dot(o2) { return '<span class="dt' + (o2 ? ' on' : '') + '">' + (o2 ? '1' : '0') + '</span>'; }
        return '<tr><td class="nm">' + name + ' · IRQ' + spec.bit + '</td><td>' + dot(pfClkOn(name)) + '</td><td>' + dot(flag) + '</td><td>' + dot(uie) + '</td><td>' + dot(iser) + '</td><td>' + state + '</td></tr>';
      }).join('');
    }
    /* IPR numbers */
    var ip28 = document.getElementById('pf-ipr-' + PF_TIM2_IRQ_BIT);
    if (ip28) { ip28.textContent = periph.nvic.IP[String(PF_TIM2_IRQ_BIT)] | 0; }
    var ip29 = document.getElementById('pf-ipr-' + PF_TIM3_IRQ_BIT);
    if (ip29) { ip29.textContent = periph.nvic.IP[String(PF_TIM3_IRQ_BIT)] | 0; }
    /* CPU card */
    var pm = document.getElementById('pf-primask');
    if (pm) {
      pm.textContent = periph.cpu.PRIMASK ? 'PRIMASK = 1 · ALL irqs masked' : 'PRIMASK = 0 · irqs enabled';
      pm.classList.toggle('armed', !!periph.cpu.PRIMASK);
    }
    var now = document.getElementById('pf-cpu-now');
    if (now) {
      var stk = periph.cpu.stack;
      now.textContent = stk.length ? stk[stk.length - 1].n + '_IRQHandler' + (stk.length > 1 ? '  (nesting ' + stk.length + ') → ' + stk.map(function (e) { return e.n; }).join(' ◄ ') : '') : 'main() — thread mode';
    }
    var dep = document.getElementById('pf-cpu-depth');
    if (dep) { dep.textContent = periph.cpu.stack.length; }
    var f2 = document.getElementById('pf-fired-tim2');
    if (f2) { f2.textContent = periph.fired.TIM2 | 0; }
    var f3 = document.getElementById('pf-fired-tim3');
    if (f3) { f3.textContent = periph.fired.TIM3 | 0; }
    var nc = document.getElementById('pf-nest-count');
    if (nc) { nc.textContent = periph.nestCount | 0; }
    /* Stage 7: swim-lane interrupt timeline */
    var tlHost = document.getElementById('pf-tl');
    if (tlHost && periph.stage === 7) {
      var H = periph.tlHist, n = Math.max(1, H.length), sw = 300 / n;
      var lanes = { main: 5, TIM2: 37, TIM3: 69 };
      var tsvg = '<line x1="0" y1="2" x2="300" y2="2" class="tl-axis"></line>';
      Object.keys(lanes).forEach(function (ctx) {
        var yy = lanes[ctx];
        tsvg += '<text x="2" y="' + (yy + 8) + '" class="tl-lab">' + ctx + '</text>';
        if (ctx !== 'main') { tsvg += '<text x="298" y="' + (yy + 8) + '" text-anchor="end" class="tl-pr">' + ctx + ' prio ' + (periph.nvic.IP[String(PF_IRQS[ctx].bit)] | 0) + '</text>'; }
        var run = -1;
        for (var ti = 0; ti <= n; ti++) {
          var act = ti < n && H[ti] === ctx;
          if (act && run < 0) { run = ti; }
          if ((!act || ti === n) && run >= 0) {
            tsvg += '<rect class="tl-bar c-' + ctx + '" x="' + (run * sw).toFixed(2) + '" y="' + yy + '" width="' + ((ti - run) * sw).toFixed(2) + '" height="12"></rect>';
            run = -1;
          }
        }
        if (ctx !== 'main' && !H.length) { tsvg += '<line x1="0" y1="' + (yy + 6) + '" x2="300" y2="' + (yy + 6) + '" class="tl-idle"></line>'; }
      });
      /* pending markers: ▲ on the lane of an IRQ that is waiting */
      pfPendingReqs().forEach(function (q) {
        var py = lanes[q.n];
        if (py !== undefined) { tsvg += '<text x="288" y="' + (py + 11) + '" class="tl-pend">▲</text>'; }
      });
      tlHost.querySelector('svg').innerHTML = tsvg;
    }
    /* Stage 3: pin-internals cell for PA5 */
    var pinG = document.getElementById('pf-pin5-pad');
    if (pinG) {
      var ps = pfPinState(5);
      function pg(id, k) { var e = document.getElementById('pf-pin5-' + id); if (e) { e.setAttribute('class', k); } }
      pg('pad', 'pad' + (ps.flt ? ' float' : ps.lvl ? ' high' : ' low'));
      pg('pu', 'pull' + (ps.clk && ps.pull === 1 ? ' act' : ''));
      pg('pd', 'pull' + (ps.clk && ps.pull === 2 ? ' act' : ''));
      var pmosOn = ps.clk && ps.m === 1 && !ps.od && ps.otd === 0;
      var nmosOn = ps.clk && ps.m === 1 && ps.otd === 1;
      pg('pmos', 'sw' + (pmosOn ? ' on' : ' off'));
      pg('nmos', 'sw' + (nmosOn ? ' on' : ' off'));
      var pnote = document.getElementById('pf-pin5-note');
      if (pnote) { pnote.textContent = ps.note; pnote.setAttribute('class', 'lab cen' + (ps.flt ? ' flt' : '')); }
    }
    /* Stage 1 live peeks + clock tree */
    function txt(id, v) { var e2 = document.getElementById(id); if (e2) { e2.textContent = v; } }
    txt('pf-peek-nvic', pfHex(periph.nvic.ISER0, 8));
    txt('pf-peek-rcc', pfHex(periph.rcc.AHB1ENR, 8));
    txt('pf-peek-odr', pfHex(periph.gpioa.ODR, 4));
    txt('pf-peek-cnt', String(periph.tim2.CNT));
    function ct(id, label, on2) {
      var e3 = document.getElementById(id);
      if (e3) { e3.textContent = label + ' · ' + (on2 ? 'ON' : 'off'); e3.className = on2 ? 'en' : 'off'; }
    }
    ct('pf-ct-gpioa', 'GPIOA', pfClkOn('GPIOA'));
    ct('pf-ct-gpioa2', 'GPIOA', pfClkOn('GPIOA'));
    ct('pf-ct-tim2', 'TIM2', pfClkOn('TIM2'));
    ct('pf-ct-tim3', 'TIM3', pfClkOn('TIM3'));
    /* Stage 4 poll badge */
    var pb = document.getElementById('pf-poll-busy');
    if (pb) {
      pb.textContent = periph.poll.active ? 'CPU 100 % busy in while(1)' : 'CPU idle';
      pb.classList.toggle('busy', !!periph.poll.active);
    }
    /* Stage 8 race stats */
    txt('pf-race-lost', String(periph.race.lost | 0));
    txt('pf-race-toggles', String(periph.race.toggles | 0));
    txt('pf-race-mode', !periph.race.active ? 'stopped' : (periph.race.useBsrr ? 'BSRR (atomic)' : 'ODR RMW (racy!)'));
    var rb = document.getElementById('pf-race-bsrr');
    if (rb) { rb.classList.toggle('armed', !!periph.race.useBsrr); }
    /* Behaviour tape: same numbers the goal predicate reads, printed (pfTapeStatHtml
       and pfTapeSteady both go through pfTapeCadence, so they cannot drift apart). */
    var tstat = document.getElementById("pf-tapestat");
    if (tstat) { tstat.innerHTML = pfTapeStatHtml(); }
    var trip = document.getElementById("pf-tape");
    if (trip) { trip.innerHTML = pfTapeRowsHtml(); }
    /* Stage 9 checklist */
    if (periph.stage === 9) {
      PF_CH9.forEach(function (c, i) {
        var li = document.getElementById('pf-ch9-' + i);
        if (li) {
          var good = false;
          try { good = !!c.f(); } catch (e) { good = false; }
          li.classList.toggle('good', good);
          li.querySelector('.bx').textContent = good ? '✓' : '✗';
        }
      });
    }
    /* Log */
    var logEl = document.getElementById('pf-log');
    if (logEl) {
      var html = periph.log.slice(-PF_LOG_MAX).map(function (e) {
        var kind = ({wr:'wr', err:'err', irq:'irq', note:'note', ok:'ok'})[e.k] || 'note';
        return '<div class="e ' + kind + '"><span class="t">' + e.t + 'ms</span><span class="m">' + esc(e.m) + '</span></div>';
      }).join('');
      logEl.innerHTML = html || '<div class="e note"><span class="t">—</span><span class="m">(empty — nothing has happened yet)</span></div>';
    }
    /* Sim clock */
    var sc = document.getElementById('pf-simclock');
    if (sc) { sc.textContent = periph.simMs; }
    /* Code lines: highlight current */
    Array.prototype.forEach.call(host.querySelectorAll('.pf-code .ln[data-ln]'), function (l) {
      var i = Number(l.dataset.ln);
      l.classList.toggle('done', i < periph.stepIdx);
      l.classList.toggle('cur',  i === periph.stepIdx);
    });
    /* Step / runall enabled state (stage 10 only) */
    var step = document.getElementById('pf-step'), runall = document.getElementById('pf-runall');
    var preset = pfPresetById(periph.preset);
    if (step && runall && preset) {
      var done = periph.stepIdx >= preset.steps.length;
      step.disabled = done;
      runall.disabled = done;
    }
  }

  function pfSetModerOut(pin) {
    pfWriteReg('GPIOA', 'MODER', ((periph.gpioa.MODER & ~(3 << (pin * 2))) | (1 << (pin * 2))) >>> 0);
  }
  function pfArmNestDemo() {
    periph.cpu.PRIMASK = 0;
    periph.nvic.IP[String(PF_TIM2_IRQ_BIT)] = 2;
    periph.nvic.IP[String(PF_TIM3_IRQ_BIT)] = 1;
    pfWriteReg('RCC', 'AHB1ENR', periph.rcc.AHB1ENR | 0x1);
    pfWriteReg('RCC', 'APB1ENR', periph.rcc.APB1ENR | 0x3);
    pfSetModerOut(5); pfSetModerOut(6);
    pfWriteReg('TIM2', 'PSC', 9);  pfWriteReg('TIM2', 'ARR', 49);   /* 2 Hz updates */
    pfWriteReg('TIM2', 'DIER', periph.tim2.DIER | 1);
    pfWriteReg('TIM2', 'CR1', periph.tim2.CR1 | 1);
    pfWriteReg('TIM3', 'PSC', 9);  pfWriteReg('TIM3', 'ARR', 19);   /* 5 Hz updates */
    pfWriteReg('TIM3', 'DIER', periph.tim3.DIER | 1);
    pfWriteReg('TIM3', 'CR1', periph.tim3.CR1 | 1);
    pfWriteReg('NVIC', 'ISER0', periph.nvic.ISER0 | (1 << PF_TIM2_IRQ_BIT) | (1 << PF_TIM3_IRQ_BIT));
    pfLog('ok', 'Nesting demo armed — TIM2 (prio 2) holds the CPU ~400 ms; TIM3 (prio 1) knocks every 200 ms.');
    pfSave(); pfRenderLive();
  }
  function pfArmRaceIsr() {
    periph.cpu.PRIMASK = 0;
    pfWriteReg('RCC', 'AHB1ENR', periph.rcc.AHB1ENR | 0x1);
    pfWriteReg('RCC', 'APB1ENR', periph.rcc.APB1ENR | 0x1);
    pfSetModerOut(5); pfSetModerOut(6);
    pfWriteReg('TIM2', 'PSC', 9); pfWriteReg('TIM2', 'ARR', 49);    /* 2 Hz updates */
    pfWriteReg('TIM2', 'DIER', periph.tim2.DIER | 1);
    pfWriteReg('NVIC', 'ISER0', periph.nvic.ISER0 | (1 << PF_TIM2_IRQ_BIT));
    pfWriteReg('TIM2', 'CR1', periph.tim2.CR1 | 1);
    pfLog('ok', 'ISR armed — the TIM2 handler now toggles PA6. Start the racy main loop and watch what disappears.');
    pfSave(); pfRenderLive();
  }
  function pfGoStage(n) {
    if (n < 1 || n > PF_STAGE_META.length || n === periph.stage) { return; }
    periph.stage = n;
    pfSave();
    pfRenderStatic();
  }

  function pfWire(host) {
    /* stage nav */
    Array.prototype.forEach.call(host.querySelectorAll('[data-pfstage]'), function (b) {
      b.addEventListener('click', function () { pfGoStage(Number(b.dataset.pfstage)); });
    });
    /* stage 1 quiz */
    Array.prototype.forEach.call(host.querySelectorAll('[data-quiz]'), function (b) {
      b.addEventListener('click', function () {
        var why = document.getElementById('pf-quiz-why');
        var good = b.dataset.quiz === '1';
        if (why) { why.textContent = b.dataset.why; why.style.color = good ? 'var(--ok)' : 'var(--warn)'; }
        if (good && !periph.goals[1]) {
          periph.goals[1] = true;
          pfLog('ok', 'Stage 1 goal achieved — memory-mapped I/O understood.');
          pfSave();
          pfRenderStatic();
        }
      });
    });
    /* goal verify buttons */
    Array.prototype.forEach.call(host.querySelectorAll('[data-goal]'), function (b) {
      b.addEventListener('click', function () {
        var n = Number(b.dataset.goal);
        var g = PF_GOALS[n];
        if (!g) { return; }
        var hint = document.getElementById('pf-goal-hint-' + n);
        if (g.ok()) {
          if (!periph.goals[n]) {
            periph.goals[n] = true;
            pfLog('ok', 'Stage ' + n + ' goal achieved: ' + ((pfStageById(n) || {}).name || ''));
          }
          pfSave();
          pfRenderStatic();
          /* After the re-render, not before: writing into the old hint node and then
             replacing the whole body threw the confirmation away, so a passed goal
             looked exactly like a click that did nothing. */
          hint = document.getElementById('pf-goal-hint-' + n);
          if (hint) { hint.textContent = 'Verified against the live register state — onto the next stage.'; hint.style.color = 'var(--ok)'; }
        } else if (hint) {
          hint.textContent = 'Not yet — ' + g.hint();
          hint.style.color = 'var(--warn)';
        }
      });
    });
    /* presets (stage 10 only) */
    Array.prototype.forEach.call(host.querySelectorAll('[data-preset]'), function (b) {
      b.addEventListener('click', function () { pfLoadPreset(b.dataset.preset); });
    });
    var r = document.getElementById('pf-reset');
    if (r) { r.addEventListener('click', function () {
      var keepStage = periph.stage;
      periph = pfDefaults();
      periph.stage = keepStage;
      pfLog('note', 'Power-on reset. All registers back to their reset values.');
      pfSave(); pfRenderStatic();
    }); }
    var st = document.getElementById('pf-step');
    if (st) { st.addEventListener('click', function () { pfStepNext(); }); }
    var ra = document.getElementById('pf-runall');
    if (ra) { ra.addEventListener('click', function () {
      var pr = pfPresetById(periph.preset);
      if (!pr) { return; }
      var safety = 0;
      while (periph.stepIdx < pr.steps.length && safety++ < pr.steps.length + 1) {
        pfStepNext({ silent: true });
      }
      pfRenderLive();
    }); }
    var pz = document.getElementById('pf-pause');
    if (pz) { pz.addEventListener('click', function () { periph.running = !periph.running; pz.setAttribute('aria-pressed', String(!periph.running)); pz.textContent = periph.running ? '⏸ Pause sim' : '⏵ Resume sim'; pfSave(); }); }
    /* PRIMASK toggle */
    var pm = document.getElementById('pf-primask');
    if (pm) { pm.addEventListener('click', function () {
      periph.cpu.PRIMASK = periph.cpu.PRIMASK ? 0 : 1;
      pfUserLine(periph.cpu.PRIMASK ? '__disable_irq();   /* PRIMASK=1 — every IRQ held pending */' : '__enable_irq();    /* PRIMASK=0 */');
      pfLog('note', periph.cpu.PRIMASK ? 'PRIMASK set — every interrupt is now held pending, no matter what the peripherals ask' : 'PRIMASK cleared — pending requests dispatch immediately');
      pfSave(); pfRenderLive();
    }); }
    /* IPR steppers */
    Array.prototype.forEach.call(host.querySelectorAll('[data-ip]'), function (b) {
      b.addEventListener('click', function () {
        var bit = b.dataset.ip, d = Number(b.dataset.d);
        var cur = periph.nvic.IP[bit] | 0;
        var nxt = Math.max(0, Math.min(3, cur + d));
        if (nxt === cur) { return; }
        periph.nvic.IP[bit] = nxt;
        var irqn = bit === String(PF_TIM2_IRQ_BIT) ? 'TIM2_IRQn' : 'TIM3_IRQn';
        pfUserLine('NVIC_SetPriority(' + irqn + ', ' + nxt + ');   /* lower number = more urgent */');
        pfSave(); pfRenderLive();
      });
    });
    /* CCR slider + draggable ARR line (stage 5 waveform) — visual duty and
       one canonical-code write on release */
    Array.prototype.forEach.call(host.querySelectorAll('[data-ccr]'), function (sl) {
      var pname = sl.dataset.ccr;
      sl.value = String(pfTim(pname).CCR);
      sl.addEventListener('input', function () {
        pfTim(pname).CCR = Math.max(0, Math.min(65535, Number(sl.value) || 0));
        pfSave(); pfRenderLive();
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-arrdrag]'), function (ln) {
      ln.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        var pname = ln.dataset.arrdrag, T = pfTim(pname);
        var start = T.ARR, y0 = ev.clientY, moved = false;
        if (ln.setPointerCapture) { try { ln.setPointerCapture(ev.pointerId); } catch (e) { /* older webview */ } }
        var mv = function (e2) {
          var rect = ln.getBoundingClientRect();
          if (!rect.height) { return; }
          /* viewBox space: value ratio maps y 52 (0) → y 10 (max) */
          var dy = (y0 - e2.clientY) / rect.height * 112;
          var ratio = Math.min(1, Math.max(0, (52 - dy) / 42));
          var nv = Math.round(ratio * 65535);
          if (nv !== T.ARR) { moved = true; pfWriteReg(pname, 'ARR', nv); pfRenderLive(); }
        };
        var up = function () {
          ln.removeEventListener('pointermove', mv);
          ln.removeEventListener('pointerup', up);
          ln.removeEventListener('pointercancel', up);
          if (moved && T.ARR !== start) {
            pfUserLine(pname + '->ARR = ' + T.ARR + 'u;   /* drag — reload value, rate ' + pfUpdateRateHz(T).toFixed(2) + ' Hz */');
          }
          pfSave(); pfRenderLive();
        };
        ln.addEventListener('pointermove', mv);
        ln.addEventListener('pointerup', up);
        ln.addEventListener('pointercancel', up);
      });
    });
    /* poll loop (stage 4) */
    var po = document.getElementById('pf-poll-toggle');
    if (po) { po.addEventListener('click', function () {
      periph.poll.active = !periph.poll.active;
      pfUserLine('/* poll loop ' + (periph.poll.active ? 'running: while(1){ IDR bit0 → ODR bit5 }' : 'stopped') + ' */');
      pfLog('note', periph.poll.active ? 'while(1) running — this CPU can do nothing else' : 'poll loop stopped');
      pfSave(); pfRenderStatic();
    }); }
    /* nesting demo (stage 7) */
    var na = document.getElementById('pf-nest-arm');
    if (na) { na.addEventListener('click', pfArmNestDemo); }
    /* race rig (stage 8) */
    var rArm = document.getElementById('pf-race-arm');
    if (rArm) { rArm.addEventListener('click', pfArmRaceIsr); }
    var rRun = document.getElementById('pf-race-run');
    if (rRun) { rRun.addEventListener('click', function () {
      periph.race.active = true; periph.race.useBsrr = false; periph.race.lat = null;
      pfUserLine('/* main loop running — toggles PA5 via ODR read-modify-write */');
      pfLog('note', 'main() started — racy ODR RMW at ~5 Hz');
      pfSave(); pfRenderLive();
    }); }
    var rBs = document.getElementById('pf-race-bsrr');
    if (rBs) { rBs.addEventListener('click', function () {
      periph.race.active = true; periph.race.useBsrr = true; periph.race.lat = null;
      pfUserLine('/* main loop switched to BSRR — one atomic write, no read-back */');
      pfLog('ok', 'main() now writes BSRR — watch the lost counter freeze');
      pfSave(); pfRenderLive();
    }); }
    var rSt = document.getElementById('pf-race-stop');
    if (rSt) { rSt.addEventListener('click', function () {
      periph.race.active = false; periph.race.lat = null;
      pfLog('note', 'main() loop stopped');
      pfSave(); pfRenderLive();
    }); }
    /* switches */
    Array.prototype.forEach.call(host.querySelectorAll('[data-sw]'), function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.dataset.sw);
        periph.switches[i] = !periph.switches[i];
        pfUserLine('/* SW' + i + ' → PA' + i + ' pad reads ' + (periph.switches[i] ? 'HIGH' : 'LOW') + ' (electrical, not a write) */');
        pfIdrRefresh(); pfSave(); pfRenderLive();
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-moder]'), function (b) {
      b.addEventListener('click', function () {
        var pin = Number(b.dataset.moder);
        if (!pfClkOn('GPIOA')) { pfLog('err', 'GPIOA.MODER write dropped — clock off'); pfUserLine('/* click on PA' + pin + ' ignored — GPIOA clock off (RCC.AHB1ENR bit 0) */'); pfRenderLive(); return; }
        var cur = pfModer(pin);
        var nxt = (cur + 1) & 3;
        var v = (periph.gpioa.MODER & ~(3 << (pin * 2))) | (nxt << (pin * 2));
        pfWriteReg('GPIOA', 'MODER', v >>> 0);
        pfCodeForModerCycle(pin, cur, nxt).forEach(pfUserLine);
        pfSave(); pfRenderLive();
      });
    });
    /* bit clicks — the code generator's main input */
    Array.prototype.forEach.call(host.querySelectorAll('.pf-bit[data-reg]:not(.ro)'), function (b) {
      b.addEventListener('click', function () {
        var reg = b.dataset.reg, bit = Number(b.dataset.bit);
        var pname = b.dataset.pname || pfPnameForReg(reg);
        if (!pname) { return; }
        var mask = (1 << bit) >>> 0;
        /* PUPDR: a click anywhere in a pin's 2-bit field cycles the whole field,
           so the UI can never produce the reserved 11 pattern. */
        if (reg === 'PUPDR') {
          var newPull = pfCyclePull(bit >> 1);
          if (newPull === null) {
            pfUserLine('/* PA' + (bit >> 1) + ' pull click dropped — GPIOA clock off (RCC.AHB1ENR bit 0) */');
          }
          pfSave(); pfRenderLive();
          return;
        }
        /* ISER0 / ICER0: the click does exactly what the emitted C says. A line is
           set by writing ISER (write-1-to-set) and cleared by writing ICER
           (write-1-to-clear) — clicking a set ISER bit cannot "unset" it in place,
           because a 0 written to ISER is ignored by silicon. */
        if (reg === 'ISER0' || reg === 'ICER0') {
          var was = ((periph.nvic.ISER0 >>> bit) & 1) === 1;
          var target = reg === 'ISER0' && was ? 'ICER0' : reg;
          var note = null;
          if (reg === 'ISER0' && was) {
            note = 'ISER0 bit ' + bit + ' is set — a 0 written to ISER would be ignored, so the mask goes through ICER. The C line on the right is that ICER write.';
          } else if (reg === 'ICER0' && !was) {
            note = 'ICER0 is write-1-to-clear and line ' + bit + ' was already masked — the write changes nothing.';
          }
          pfWriteReg('NVIC', target, mask);
          var nvicLine = pfCodeForBitToggle('NVIC', target, bit, target === 'ISER0');
          if (nvicLine) { pfUserLine(nvicLine); }
          if (note) { pfLog('note', note); }
          pfSave(); pfRenderLive();
          return;
        }
        var cur = pfReadReg(pname, reg);
        if (cur === null) { return; }
        var next;
        if (reg === 'SR' || reg === 'BSRR') { next = mask; }   /* W1C clears; BSRR is write-only, the value IS the mask */
        else { next = (cur ^ mask) >>> 0; }
        var ok = pfWriteReg(pname, reg, next);
        if (ok) {
          var willSet = reg === 'SR' ? false : (reg === 'BSRR' ? (bit < 16) : ((next >>> bit) & 1) === 1);
          var line = pfCodeForBitToggle(pname, reg, bit, willSet);
          if (line) { pfUserLine(line); }
        } else if (pname !== 'RCC' && pname !== 'NVIC') {
          pfUserLine('/* ' + pname + '->' + reg + ' click on bit ' + bit + ' dropped — clock gated off */');
        }
        pfSave(); pfRenderLive();
      });
    });
    var uc1 = document.getElementById('pf-user-copy');
    if (uc1) { uc1.addEventListener('click', function () {
      var text = pfUserCodeText();
      var done = function () { uc1.textContent = '✓ Copied'; setTimeout(function () { uc1.textContent = 'Copy'; }, 1200); };
      if (!text) { return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { pfFallbackCopy(text, done); });
      } else { pfFallbackCopy(text, done); }
    }); }
    var uc2 = document.getElementById('pf-user-clear');
    if (uc2) { uc2.addEventListener('click', function () {
      periph.userCode = [];
      pfSave();
      pfRenderUserCode();
    }); }
  }

  function pfFallbackCopy(text, ok) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); ok(); } catch (e) { /* nothing else we can do */ }
    document.body.removeChild(ta);
  }

  function pfLoadPreset(id) {
    var p = pfPresetById(id);
    if (!p) { return; }
    /* Reset the whole model to power-on defaults, then re-enter the preset.
       Without this, running "forgot GPIOA clock" after "blink" silently succeeds
       because the previous preset already turned the clock on. */
    var keepLog = Array.isArray(periph.log) ? periph.log : [];
    var keepRunning = periph.running;
    var keepStage = periph.stage;
    periph = pfDefaults();
    periph.running = keepRunning;
    periph.log = keepLog;
    periph.stage = keepStage;
    periph.preset = id;
    periph.stepIdx = 0;
    pfLog('ok', 'Preset loaded: ' + p.label + '. Registers reset to power-on defaults.');
    pfSave();
    pfRenderStatic();
  }
  function pfStepNext(opts) {
    var p = pfPresetById(periph.preset);
    if (!p) { return false; }
    if (periph.stepIdx >= p.steps.length) { return false; }
    var i = periph.stepIdx;
    var s = p.steps[i];
    try { s.o(); } catch (e) { pfLog('err', 'Step failed: ' + (e && e.message ? e.message : e)); }
    if (s.n) { pfLog('note', s.n); }
    periph.stepIdx = i + 1;
    pfIdrRefresh();
    pfSave();
    if (!opts || !opts.silent) { pfRenderLive(); }
    return true;
  }

  var pfTicker = null;
  function pfStartTicker() {
    if (pfTicker) { return; }
    pfTicker = setInterval(pfTick, PF_TICK_MS);
  }

  function initPeriph() {
    if (periphInited) { pfRenderStatic(); return; }
    pfLoadState();
    if (!periph.log.length) { pfLog('note', 'Chip at power-on defaults. Stage 1 explains why — or jump straight to the Playground.'); }
    pfRenderStatic();
    pfStartTicker();
    periphInited = true;
  }

