<script>
(function () {
  "use strict";

  var K_DONE = "ecroadmap.v1", K_NOTE = "ecroadmap.notes.v1",
      K_MARK = "ecroadmap.marks.v1", K_THEME = "ecroadmap.theme",
      K_IV = "ecroadmap.interview.v1", K_FAULT = "ecroadmap.faults.v1",
      K_WALK = "ecroadmap.walk.v1",   /* which stages of the two reading labs you opened */
      K_JOURNAL = "ecroadmap.journals.v1";  /* what a stage wrote down, keyed "lab:stage" */
  var REGION_Q = {
    vector: "vector table", text: ".text", rodata: "rodata", data: ".data",
    bss: ".bss", heap: "heap", stack: "stack", mmio: "register", nvic: "interrupt"
  };
  var DAY = 86400000;
  var STAGE_HUES = ["var(--link)", "var(--steel)", "var(--violet)", "var(--warn)", "var(--ok)"];

  var done = {}, notes = {}, marks = {}, ivState = { answers: {} }, faultState = { seen: {} };
  var activeLens = null, allTopics = [], byId = {};
  var ivInited = false, labInited = false, faultsInited = false;
  var pgInited = { bitlab: false, diffs: false };
  var periphInited = false;
  var doneListeners = [], hooks = {};
  function onHook(name, fn) {
    if (typeof fn !== "function") { return; }
    (hooks[name] = hooks[name] || []).push(fn);
  }
  function fireHook(name, arg) {
    (hooks[name] || []).forEach(function (fn) {
      try { fn(arg); } catch (e) { /* isolate optional view plugins */ }
    });
  }
  function fireDoneChange(id, isNowDone) {
    doneListeners.forEach(function (fn) {
      try { fn(id, isNowDone); } catch (e) { /* a listener's own bug shouldn't break the app */ }
    });
  }

  /* ---------------- storage ---------------- */
  function rd(k, fb) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  function wr(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { storageFailed(); } }
  /* A full or blocked store must not fail silently: notes and lab progress would
     be lost on close with no trace. One fixed banner, shown once per session,
     on the first write that actually failed. */
  var storageWarned = false;
  function storageFailed() {
    if (storageWarned) { return; }
    storageWarned = true;
    notice("Storage is full or blocked \u2014 recent changes may not survive closing the app. " +
      "Export your data, then free up space or clear old site data for this app.", "warn", true);
  }
  function loadAll() {
    done = rd(K_DONE, {}) || {};
    Object.keys(done).forEach(function (k) { if (done[k] === true) { done[k] = 0; } });
    notes = rd(K_NOTE, {}) || {};
    marks = rd(K_MARK, {}) || {};
    ivState = rd(K_IV, { answers: {} }) || { answers: {} };
    if (!ivState.answers) { ivState.answers = {}; }
    faultState = rd(K_FAULT, { seen: {} }) || { seen: {} };
    if (!faultState.seen) { faultState.seen = {}; }
  }
  function isDone(id) { return Object.prototype.hasOwnProperty.call(done, id); }

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (html !== undefined) { n.innerHTML = html; }
    return n;
  }
  /* ---------------- code highlighting ----------------
     One left-to-right pass, three modes, because hl() is asked to show three
     different languages and the old version highlighted all of them as if they
     were C:
       c    C source and preprocessed output
       asm  GNU ARM assembly from `gcc -S` (an immediate is `#10`, not a comment)
       ld   linker script and map-file text
     The old rules ran three independent regexes over the whole string, so `#` to
     end-of-line was unconditionally a "comment": every `#include`/`#define` and
     every `#immediate` in real disassembly was dimmed, and strings were not
     recognised at all (there was no `.s` rule even though the stylesheet already
     had one). Now strings, comments and directives are tokenised first and the
     keyword/number rules only ever see the code that is left, so nothing inside a
     literal or a comment can be re-highlighted.
     Classes: .c comment, .s string, .p directive, .k keyword/register, .n number. */
  var HL_C_KEYWORDS = /(^|[^\w$])(const|static|volatile|inline|register|struct|union|enum|typedef|void|return|if|else|for|while|switch|case|break|continue|default|extern|sizeof|restrict|unsigned|signed|char|int|long|short|float|double|bool|size_t|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t)(?=[^\w$])/g;
  var HL_ASM_REG = /(^|[^\w.])((?:r(?:1[0-5]|[0-9])|lr|pc|sp|ipsr|apsr|xpsr|primask|basepri|control))(?=[^\w])/g;
  var HL_SCAN = {
    c: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*|^[ \t]*#[^\n]*/gm,
    asm: /"(?:\\.|[^"\\\n])*"|\/\/[^\n]*|@[^\n]*|^[ \t]*\.[A-Za-z_][\w.]*/gm,
    ld: /"[^"\n]*"|\/\*[\s\S]*?\*\//g
  };
  /* Pick the mode from a tool's artifact name, e.g. "main.s" -> asm. */
  function hlModeFor(name) {
    var n = String(name || "");
    if (/\.s\b|\.S\b|assembly|disassembly/i.test(n)) { return "asm"; }
    if (/\.ld\b|\.map\b|linker/i.test(n)) { return "ld"; }
    return "c";
  }
  /* Highlight one stretch of code that is known to contain no strings/comments. */
  function hlCode(seg, mode) {
    if (!seg) { return seg; }
    seg = seg.replace(mode === "asm" ? HL_ASM_REG : HL_C_KEYWORDS, '$1<span class="k">$2</span>');
    return seg.replace(/(0x[0-9A-Fa-f]+|\b\d+[uUlL]*\b)/g, '<span class="n">$1</span>');
  }
  function hl(code, mode) {
    mode = (mode === "asm" || mode === "ld") ? mode : "c";
    var src = esc(code), re = HL_SCAN[mode], out = "", last = 0, m;
    while ((m = re.exec(src)) !== null) {
      if (!m[0]) { re.lastIndex++; continue; }   /* never loop on an empty match */
      if (m.index > last) { out += hlCode(src.slice(last, m.index), mode); }
      var tok = m[0], cls = "c";
      if (/^["']/.test(tok)) { cls = "s"; }
      else if (/^[ \t]*[.#]/.test(tok)) { cls = "p"; }
      out += '<span class="' + cls + '">' + tok + '</span>';
      last = m.index + tok.length;
    }
    return out + hlCode(src.slice(last), mode);
  }
  function copy(text, btn) {
    var label = btn.textContent;
    function ok() { btn.textContent = "Copied"; setTimeout(function () { btn.textContent = label; }, 1400); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); ok(); } catch (e) { btn.textContent = "Copy failed"; }
      document.body.removeChild(ta);
    }
  }
  /* A uniform shuffle. `sort(() => Math.random() - 0.5)` is not one: it is biased
     (ends barely move) and its comparator is inconsistent, so the result depends on
     the engine's sort. Fisher-Yates is uniform, and taking an optional seed makes
     the same order reproducible in a spec instead of untestable. */
  function shuffle(list, seed) {
    var a = list.slice(), i, j, t;
    var rand = (typeof seed === "number")
      ? function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; }
      : Math.random;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(rand() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------------- notices ----------------
     One small dismissible banner pinned to the foot of the window, shared by the
     storage warning and the lab's build errors. It replaced window.alert(), which
     was the only blocking modal in the app and could not be styled or made to sit
     next to the thing that failed. `sticky` keeps it until the user dismisses it. */
  var noticeEls = [];
  function notice(text, kind, sticky) {
    try {
      var b = el("div", "notice " + (kind || "warn"),
        "<span>" + esc(text) + '</span><button type="button" class="notice-x" aria-label="Dismiss">\u00d7</button>');
      b.setAttribute("role", kind === "error" ? "alert" : "status");
      function remove() {
        for (var i = noticeEls.length - 1; i >= 0; i--) { if (noticeEls[i] === b) { noticeEls.splice(i, 1); } }
        if (b.parentNode) { b.parentNode.removeChild(b); }
      }
      b.querySelector(".notice-x").addEventListener("click", remove);
      document.body.appendChild(b);
      noticeEls.push(b);
      if (!sticky) { setTimeout(remove, 9000); }
      return b;
    } catch (e) { return null; }
  }

  /* ---------------- global data backup ----------------
     The roadmap state is held in memory (done / notes / marks / ...) so it is copied
     out of the variables. The labs hold theirs only in localStorage and read it when
     they are first opened, so they are copied out of the keys. Schema 2 adds them;
     schema 1 files simply have no "labs" section and restore the roadmap only. */
  var DATA_SCHEMA = 2;
  /* Each key is declared with var inside its own lab module further down this file,
     so the list is built when called, not when this line runs. The journals are in it
     even though they are written from the roadmap's own editor: they belong to a lab
     stage, and a lab key arriving in a backup is what makes the import reload rather
     than let an open lab write stale state over it. */
  function labKeys() { return [K_BENCH, K_LKSAND, K_PERIPH, K_PROTOS, K_WALK, K_JOURNAL]; }
  function labState() {
    var labs = {};
    labKeys().forEach(function (k) { var v = rd(k, null); if (v !== null) { labs[k] = v; } });
    return labs;
  }
  function snapshotAll() {
    return {
      schema: DATA_SCHEMA,
      app: "embedded-c-roadmap",
      exportedAt: new Date().toISOString(),
      state: {
        done: JSON.parse(JSON.stringify(done)),
        notes: JSON.parse(JSON.stringify(notes)),
        marks: JSON.parse(JSON.stringify(marks)),
        interview: JSON.parse(JSON.stringify(ivState)),
        faults: JSON.parse(JSON.stringify(faultState)),
        labs: labState(),
        settings: { theme: localStorage.getItem(K_THEME) || "" }
      }
    };
  }
  /* Each call takes a token; the timeout only restores the label if no newer
     call happened meanwhile — two rapid actions can no longer flicker (#21). */
  var dataBtnToken = 0;
  function setDataButtonState(id, text) {
    var b = document.getElementById(id);
    if (!b) { return; }
    var old = b.textContent;
    var token = ++dataBtnToken;
    b.textContent = text;
    setTimeout(function () {
      if (token === dataBtnToken && b) { b.textContent = old; }
    }, 1600);
  }
  /* In the desktop app, IPC to the Rust commands; null in a plain browser,
     where the fallbacks below still apply. */
  function tauriInvoke(cmd, args) {
    var T = (typeof window !== "undefined") && window.__TAURI__;
    return (T && T.core && T.core.invoke) ? T.core.invoke(cmd, args || {}) : null;
  }
  /* Whether the desktop shell is present.  This is a predicate and nothing else,
     so it is safe to call once at boot.  It exists because the two backup
     actions below are NOT predicates: exportBackupNative() opens a save dialog
     and importBackupNative() opens an open dialog before either one returns.
     They used to be called inside an `if` to choose between the native and the
     browser path, which meant every single launch popped a file picker nobody
     had asked for, and threw the result away.  Never test a capability by
     performing the action - specs/backup_roundtrip.spec.js guards this. */
  function hasNativeShell() {
    var T = (typeof window !== "undefined") && window.__TAURI__;
    return !!(T && T.core && T.core.invoke);
  }
  function backupStamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }
  function exportBackupNative() {
    var invoke = tauriInvoke("backup_save_dialog", { defaultName: "embedded-c-roadmap-backup-" + backupStamp() + ".json" });
    if (!invoke) { return false; }
    invoke.then(function (path) {
      if (!path) { setDataButtonState("exportdata", "Cancelled"); return; }
      tauriInvoke("backup_write", { path: path, contents: JSON.stringify(snapshotAll(), null, 2) })
        .then(function () { setDataButtonState("exportdata", "Exported"); },
              function () { setDataButtonState("exportdata", "Write failed"); });
    }, function () { setDataButtonState("exportdata", "Write failed"); });
    return true;
  }
  function downloadBackup() {
    /* hasNativeShell(), not exportBackupNative(): the capability test must not
       perform the action, or a click that falls through would open two. */
    if (hasNativeShell()) { exportBackupNative(); return; }
    var blob = new Blob([JSON.stringify(snapshotAll(), null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "embedded-c-roadmap-backup-" + backupStamp() + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setDataButtonState("exportdata", "Exported");
  }
  function importBackupNative() {
    var invoke = tauriInvoke("backup_open_dialog");
    if (!invoke) { return false; }
    invoke.then(function (path) {
      if (!path) { setDataButtonState("importdata", "Cancelled"); return; }
      tauriInvoke("backup_read", { path: path }).then(
        function (text) { restoreBackup(String(text || "")); },
        function () { setDataButtonState("importdata", "Read failed"); });
    });
    return true;
  }
  function restoreBackup(raw) {
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { setDataButtonState("importdata", "Invalid JSON"); return false; }
    var payload = parsed && parsed.state ? parsed.state : parsed;
    if (!payload || typeof payload !== "object" || (parsed && parsed.app && parsed.app !== "embedded-c-roadmap")) {
      setDataButtonState("importdata", "Invalid backup"); return false;
    }
    /* Only a newer schema is a problem. Rejecting an older one would throw away a
       user's backups every time we add a section; ignoring an absent section beats
       wiping lab progress someone earned after they exported. */
    if (parsed && parsed.schema && Number(parsed.schema) > DATA_SCHEMA) {
      setDataButtonState("importdata", "Backup is from a newer version"); return false;
    }
    var nextDone = payload.done && typeof payload.done === "object" ? payload.done : {};
    var nextNotes = payload.notes && typeof payload.notes === "object" ? payload.notes : {};
    var nextMarks = payload.marks && typeof payload.marks === "object" ? payload.marks : {};
    var nextIv = payload.interview && typeof payload.interview === "object" ? payload.interview : { answers: {} };
    var nextFault = payload.faults && typeof payload.faults === "object" ? payload.faults : { seen: {} };
    done = JSON.parse(JSON.stringify(nextDone));
    notes = JSON.parse(JSON.stringify(nextNotes));
    marks = JSON.parse(JSON.stringify(nextMarks));
    ivState = JSON.parse(JSON.stringify(nextIv));
    faultState = JSON.parse(JSON.stringify(nextFault));
    if (!ivState.answers) { ivState.answers = {}; }
    if (!faultState.seen) { faultState.seen = {}; }
    Object.keys(done).forEach(function (k) { if (done[k] === true) { done[k] = 0; } });
    wr(K_DONE, done); wr(K_NOTE, notes); wr(K_MARK, marks); wr(K_IV, ivState); wr(K_FAULT, faultState);
    /* Labs are restored into storage only. Anything already open still holds its own
       in-memory copy, and a running lab ticker saves on every tick - pfTick() would
       write stale state straight over this import within one tick interval. So an
       import that actually changes lab state reloads instead of refreshing in place.
       An import carrying lab data identical to what is already stored needs no
       restart: the stale in-memory copy equals what it would overwrite. */
    var labsChanged = false;
    if (payload.labs && typeof payload.labs === "object") {
      /* Only keys this build knows about: a file must not be able to write arbitrary
         localStorage entries through the import path. */
      labKeys().forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(payload.labs, k)) {
          var incoming = payload.labs[k];
          if (JSON.stringify(rd(k, null)) !== JSON.stringify(incoming)) {
            wr(k, incoming);
            labsChanged = true;
          }
        }
      });
    }
    /* The theme has ridden in settings since schema 2; restore it so a backup moves
       the whole look, not just the learning state. Only when the section is present:
       a backup without settings (or a future schema without it) must not clear the
       theme the user already has. An empty theme means the backup was taken with the
       follow-the-system default, so that is what gets restored. */
    if (payload.settings && typeof payload.settings === "object") {
      var th = payload.settings.theme;
      if (th === "dark" || th === "light") {
        try { localStorage.setItem(K_THEME, th); } catch (e) { storageFailed(); }
        document.documentElement.setAttribute("data-theme", th);
      } else {
        try { localStorage.removeItem(K_THEME); } catch (e) { /* ignore */ }
        document.documentElement.removeAttribute("data-theme");
      }
    }
    Array.prototype.forEach.call(document.querySelectorAll(".topic"), function (n) {
      var id = n._t.id;
      n.dataset.done = isDone(id) ? "1" : "0";
      n.dataset.bm = marks[id] ? "1" : "0";
      n.dataset.note = (notes[id] || "").trim() ? "1" : "0";
    });
    progress(); refreshDash(); refreshMosaic();
    if (ivInited) { ivRenderList(); ivRenderCoverage(); }
    if (faultsInited && faultOrder.length) { faultShow(); }
    allTopics.forEach(function (t) { fireDoneChange(t.id, isDone(t.id)); });
    if (labsChanged) {
      setDataButtonState("importdata", "Imported \u00b7 restarting");
      setTimeout(function () { location.reload(); }, 900);
    } else {
      setDataButtonState("importdata", "Imported");
    }
    return true;
  }
  function initDataTools() {
    var ex = document.getElementById("exportdata"), im = document.getElementById("importdata"), fi = document.getElementById("importfile");
    if (!ex || !im || !fi) { return; }
    ex.addEventListener("click", downloadBackup);
    /* Desktop app: a native open dialog; the hidden input stays for browsers.
       This test used to be `if (importBackupNative())`, which opened a file
       picker on every launch to find out whether the shell was there. */
    if (hasNativeShell()) {
      im.addEventListener("click", importBackupNative);
      return;
    }
    im.addEventListener("click", function () { fi.value = ""; fi.click(); });
    fi.addEventListener("change", function () {
      var f = fi.files && fi.files[0];
      if (!f) { return; }
      var r = new FileReader();
      r.onload = function () { restoreBackup(String(r.result || "")); };
      r.onerror = function () { setDataButtonState("importdata", "Read failed"); };
      r.readAsText(f);
    });
  }

  /* ---------------- tiny markdown ---------------- */
  function md(src) {
    var blocks = [], i = 0;
    var s = esc(src).replace(/\r\n/g, "\n");
    s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, function (m, lang, code) {
      blocks.push("<pre><code>" + code.replace(/\n$/, "") + "</code></pre>");
      return "\u0000" + (blocks.length - 1) + "\u0000";
    });
    var out = [], lines = s.split("\n"), list = null;
    function closeList() { if (list) { out.push("</" + list + ">"); list = null; } }
    for (i = 0; i < lines.length; i++) {
      var L = lines[i];
      var ph = L.match(/^\u0000(\d+)\u0000$/);
      if (ph) { closeList(); out.push(blocks[+ph[1]]); continue; }
      if (/^\s*$/.test(L)) { closeList(); continue; }
      if (/^---+$/.test(L.trim())) { closeList(); out.push("<hr>"); continue; }
      var h = L.match(/^(#{1,4})\s+(.*)$/);
      if (h) { closeList(); out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"); continue; }
      if (/^&gt;\s?/.test(L)) { closeList(); out.push("<blockquote>" + inline(L.replace(/^&gt;\s?/, "")) + "</blockquote>"); continue; }
      var ul = L.match(/^\s*[-*+]\s+(.*)$/), ol = L.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        var want = ul ? "ul" : "ol";
        if (list !== want) { closeList(); out.push("<" + want + ">"); list = want; }
        out.push("<li>" + inline((ul || ol)[1]) + "</li>");
        continue;
      }
      closeList();
      out.push("<p>" + inline(L) + "</p>");
    }
    closeList();
    return out.join("");
  }
  function inline(t) {
    return t
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, function (m, label, url) {
        /* The href lands in a double-quoted attribute, so the URL must be
           scheme-clean AND quote-clean: esc() escapes & < > but not ", so a
           literal quote could close href and smuggle in event handlers or a
           style attribute (specs/markdown_safety.spec.js pins this). */
        if (!/^https?:\/\/[^\s"'`<>]+$/.test(url)) { return m; }
        return '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>';
      });
  }

  /* ---------------- memory map + lens legend ---------------- */
  function buildMap() {
    var host = document.getElementById("mmap-body");
    MEMMAP.forEach(function (r, i) {
      var b = el("button", "region");
      b.type = "button";
      b.innerHTML =
        '<span class="addr">' + esc(r.addr) + "</span>" +
        '<span class="nm"><span class="swatch" style="background:' + r.c +
        ";height:" + r.h + "px;animation-delay:" + (i * 45) + 'ms"></span>' +
        "<span>" + esc(r.nm) + '<span class="sub">' + esc(r.sub) + "</span></span></span>";
      b.addEventListener("click", function () {
        var q = document.getElementById("q");
        q.value = REGION_Q[r.tag] || r.nm;
        filter(q.value);
        document.getElementById("stages").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      host.appendChild(b);
    });
  }

  function buildLegend() {
    var host = document.getElementById("lenslegend");
    LENSES.forEach(function (L) {
      var b = el("button", "lens-chip");
      b.type = "button";
      b.dataset.k = L.k;
      b.setAttribute("aria-pressed", "false");
      b.style.color = L.c;
      b.innerHTML = '<span class="dot" style="background:' + L.c + '"></span>' +
                    '<span style="color:var(--ink)">' + esc(L.label) + "</span>";
      b.addEventListener("click", function () { setLens(activeLens === L.k ? null : L.k); });
      host.appendChild(b);
    });
  }
  function setLens(k) {
    activeLens = k;
    document.body.classList.toggle("lensmode", !!k);
    Array.prototype.forEach.call(document.querySelectorAll(".lens-chip"), function (c) {
      c.setAttribute("aria-pressed", String(c.dataset.k === k));
    });
    Array.prototype.forEach.call(document.querySelectorAll(".lens"), function (n) {
      n.dataset.hidden = (k && n.dataset.k !== k) ? "1" : "0";
    });
    var note = document.getElementById("lensnote");
    if (k) {
      var L = LENSES.filter(function (x) { return x.k === k; })[0];
      var n = document.querySelectorAll('.lens[data-k="' + k + '"]').length;
      note.textContent = "Reading " + L.label + " across " + n +
        " topics. Everything else is hidden. Select the same lens again to go back.";
      openAll(true);
    } else {
      note.textContent = "All lenses shown. Select one to read a single lens across the whole roadmap; select it again to go back.";
      openAll(false);
    }
  }

  var STAGE_GOALS = {
    s0: ["read binary values and addresses", "reason about width, alignment and representation", "connect bits to CPU and memory behavior"],
    s1: ["name each toolchain stage", "predict what each stage produces", "trace a symbol from source toward the final image"],
    s2: ["reason about C objects and expressions", "predict storage, lifetime and type behavior", "spot where the language rules matter"],
    s3: ["recognize undefined or implementation-sensitive behavior", "connect symptoms to likely failure mechanisms", "choose safer embedded-C patterns"],
    s4: ["connect registers to hardware effects", "reason about interrupt and timing behaviour", "choose polling, interrupt and DMA designs"],
    s5: ["design explicit driver and ownership boundaries", "trace concurrency and failure evidence", "reason about recovery and system reliability"],
    s6: ["analyse failures across multiple layers", "compare platform and system boundaries", "connect architecture choices to verification, recovery and production evidence"]
  };

  ;
  

  function topicCue(t) {
    return t.approach || "Start with the concrete object, value, or machine state in front of you. Identify the rule that governs it, then trace the consequence through the relevant lens.";
  }

  function topicVisual(t) {
    var v = t.visual;
    return v ? '<div class="topic-visual"><div class="topic-visual-head">' + esc(v.title) + '</div>' + v.html + '</div>' : '';
  }

  function relatedFor(id) {
    var t = byId[id];
    return t && t.related ? t.related.slice(0, 4) : [];
  }


  /* ---------------- topics ---------------- */
  function lensBlocks(t) {
    var out = "";
    LENSES.forEach(function (L) {
      var txt = t.L && t.L[L.k];
      if (!txt) { return; }
      out += '<div class="lens" data-k="' + L.k + '" data-hidden="0" style="--l:' + L.c + '">' +
             "<h4>" + esc(L.label) + "</h4><p>" + txt + "</p></div>";
    });
    return out;
  }

  var GATE_MIN = 12; /* words required in a topic's note before it can be marked learned */
  function noteLen(id) {
    var w = (notes[id] || "").trim();
    return w ? w.split(/\s+/).length : 0;
  }

  /* ---------------- the markdown editor every piece of writing shares ----------------
     A topic's notes and a lab stage's journal are the same object: text you can read,
     a textarea you can write in, a debounced save that admits itself. They differ in
     where the text lives and whether a gate hangs off it, so exactly those two parts
     stay with the caller. The point of one copy is not tidiness - the debounce, the
     "saved" dot and the rule that collapsing saves what is on screen are the details
     that only ever get fixed once, and a second save path is where a bug would live
     quietly. Everything it needs from the caller:
       get()      current text
       set(txt)   hold the keystroke somewhere render() and the gate can see at once
       flush()    write it out for real
       onRender   a keystroke changed something that is displayed elsewhere
       onEdit / onInput   the caller's own reveal/hide logic (the gate's button)
     It returns the box plus open/close/persist, because the topic layer needs to
     append its mark-as-learned button into the same row and drive the box from the
     checkbox when the gate refuses. */
  function markdownEditor(o) {
    var box = el("div", o.cls);
    /* The visible "saved" dot is opacity-only, so assistive tech gets a mirror
       region that actually announces the state change (#19). aria-live=polite
       fires on the text flip to "saved" and back. */
    var savedLive = el("span");
    savedLive.className = "sr-only";
    savedLive.setAttribute("aria-live", "polite");
    savedLive.textContent = " ";
    var head = el("h4", null, "<span>" + o.title + "</span><span class=\"saved\" aria-hidden=\"true\">saved</span>");
    head.appendChild(savedLive);
    var view = el("div");
    var btns = el("div", "nbtns");
    var edit = el("button", null, "Write");
    edit.type = "button";
    btns.appendChild(edit);
    var editing = false, timer = null;

    function render() {
      var txt = o.get();
      if (o.onRender) { o.onRender(txt); }
      if (editing) { return; }   /* never swap the textarea out from under the caret */
      view.innerHTML = txt.trim()
        ? '<div class="md">' + md(txt) + "</div>"
        : '<p class="notes-empty">' + o.empty + "</p>";
    }
    /* Runs on the debounce while typing, and again when the editor collapses: text
       that has only been sitting in a textarea for 300ms is not yet text that would
       survive closing the app. */
    function persist() {
      clearTimeout(timer);
      timer = null;
      o.flush();
      var s = head.querySelector(".saved");
      s.classList.add("on");
      savedLive.textContent = "saved";
      setTimeout(function () {
        s.classList.remove("on");
        savedLive.textContent = " ";
      }, 900);
      if (o.onSave) { o.onSave(); }
    }
    function open() {
      if (editing) { return; }
      editing = true;
      edit.textContent = "Done";
      var ta = el("textarea");
      ta.value = o.get();
      ta.placeholder = o.placeholder;
      view.innerHTML = "";
      view.appendChild(ta);
      ta.focus();
      if (o.onEdit) { o.onEdit(true); }
      ta.addEventListener("input", function () {
        o.set(ta.value);
        if (o.onRender) { o.onRender(ta.value); }
        if (o.onInput) { o.onInput(ta.value); }
        clearTimeout(timer);
        timer = setTimeout(persist, 400);
      });
    }
    function close() {
      if (!editing) { return; }
      editing = false;
      persist();
      edit.textContent = o.get() ? "Edit" : "Write";
      render();
      if (o.onEdit) { o.onEdit(false); }
    }
    edit.addEventListener("click", function () { if (editing) { close(); } else { open(); } });

    box.appendChild(head);
    if (o.hint) { box.appendChild(o.hint); }
    box.appendChild(view);
    box.appendChild(btns);
    edit.textContent = o.get() ? "Edit" : "Write";
    render();
    return {
      box: box, head: head, view: view, btns: btns, edit: edit,
      open: open, close: close, persist: persist,
      isEditing: function () { return editing; },
    };
  }

  /* A topic's notes, wearing the editor above: the same box, plus the one hard rule of
     this app - you may not mark something learned in your own words-free. */
  function buildNotes(t, wrap, onMarkLearned) {
    var gateMsg = el("p", "gate-msg",
      "Write a couple of sentences in your own words \u2014 that's what marks this learned.");
    var markBtn = el("button", "mark-learned", "Mark as learned");
    markBtn.type = "button";

    function syncMarkBtn() {
      markBtn.classList.toggle("show", ed.isEditing() && noteLen(t.id) >= GATE_MIN && !isDone(t.id));
    }

    var ed = markdownEditor({
      cls: "notes",
      title: "your notes &#183; markdown",
      empty: "Nothing yet. Write what you had to look up, the thing that finally made it click, or the bug this explains.",
      placeholder: "# what clicked\n\n- `volatile` only stops the compiler, not the bus\n- check the map file before blaming the code",
      hint: gateMsg,
      get: function () { return notes[t.id] || ""; },
      set: function (txt) { notes[t.id] = txt; if (!txt.trim()) { delete notes[t.id]; } },
      flush: function () { wr(K_NOTE, notes); },
      onRender: function (txt) { wrap.dataset.note = txt.trim() ? "1" : "0"; },
      onSave: refreshDash,
      onInput: syncMarkBtn,
      onEdit: function (isOpen) {
        if (!isOpen) { ed.box.classList.remove("gate", "pulse"); gateMsg.classList.remove("on"); }
        syncMarkBtn();
      },
    });
    ed.btns.appendChild(markBtn);

    markBtn.addEventListener("click", function () {
      /* close() is what writes; a mark from outside the editor still has to save the
         text the gate just accepted. */
      if (ed.isEditing()) { ed.close(); } else { ed.persist(); }
      onMarkLearned();
    });

    ed.box._openForGate = function () {
      ed.box.classList.add("gate", "pulse");
      gateMsg.classList.add("on");
      setTimeout(function () { ed.box.classList.remove("pulse"); }, 2400);
      ed.open();
      ed.box.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    return ed.box;
  }

  /* ---------------- lab stage journals, the writing end ----------------
     Each stage of the four labs carries the same box a topic carries, below the stage
     rather than beside it: write what this stage actually showed you. The storage side
     of that lives with the other lab state, down in the dashboard section next to the
     walk marks, because it is read the same way - out of localStorage at the moment it
     is shown, never from a mirror that a restored backup could disagree with. */

  function journalBox(lab, stage, name) {
    /* What is in the textarea before the debounce has written it. Held here rather
       than in a global mirror so the box reads its own text back after a collapse,
       while the storage stays the single answer for everyone else. */
    var draft = null;
    /* The box, not the editor's control object: this is a box factory in the same
       shape as buildNotes, and the mount appends whatever comes back. */
    return markdownEditor({
      cls: "notes jrbox",
      title: esc(name) + " &#183; stage journal",
      empty: "What did this stage actually show you? Write the line you would want to find again in six months.",
      placeholder: "# what this stage showed\n\n- the observation, not the conclusion\n- the error text that pointed at it",
      get: function () { return draft === null ? jrGet(lab, stage) : draft; },
      set: function (txt) { draft = txt; },
      /* Re-reads the map on the way in, so a journal written by another stage's box
         while this one was being typed into cannot be lost underneath it. */
      flush: function () { jrSet(lab, stage, draft === null ? jrGet(lab, stage) : draft); draft = null; },
      onSave: refreshDash,
    }).box;
  }

  /* Labs rewrite their own stage markup wholesale, so the journal has to sit in a host
     the renderer does not own, and be rebuilt only when the stage actually changes.
     Without the guard, a renderer that redraws the current stage would silently throw
     away a textarea mid-sentence. */
  function journalMount(lab, stage, name) {
    var host = document.getElementById("jr-" + lab);
    if (!host) { return; }
    var key = jrKey(lab, stage);
    if (host._jr === key) { return; }
    host.innerHTML = "";
    host.appendChild(journalBox(lab, stage, name));
    host._jr = key;
  }

  function buildTopic(t, stage) {
    var wrap = el("article", "topic");
    wrap.id = "t-" + t.id;
    wrap.dataset.done = isDone(t.id) ? "1" : "0";
    wrap.dataset.bm = marks[t.id] ? "1" : "0";
    wrap.dataset.note = (notes[t.id] || "").trim() ? "1" : "0";

    var pips = "";
    LENSES.forEach(function (L) {
      if (t.L && t.L[L.k]) {
        pips += '<span class="pip" style="background:' + L.c + '" title="' + L.label + '"></span>';
      }
    });

    var row = el("button", "row");
    row.type = "button";
    row.setAttribute("aria-expanded", "false");
    row.innerHTML =
      '<span class="code">' + esc(t.code) + "</span>" +
      '<span><span class="ttl">' + esc(t.t) + '</span><span class="kick">' + esc(t.kick) + "</span></span>" +
      '<span class="right"><span class="pips">' + pips + "</span>" +
      '<span class="bm" role="checkbox" tabindex="0" title="Bookmark">&#9733;</span>' +
      '<span class="done-mark" role="checkbox" aria-checked="' + (isDone(t.id) ? "true" : "false") +
      '" tabindex="0" title="Mark as learned">&#10003;</span></span>';

    var det = el("div", "detail");
    var pre = (t.prereq || []).map(function (p) {
      var f = byId[p];
      return f ? '<a href="#t-' + p + '">' + esc(f.code) + "</a>" : esc(p);
    }).join(", ");
    var after = (reverseDeps[t.id] || []).map(function (id) {
      var f = byId[id];
      return f ? '<a href="#t-' + id + '">' + esc(f.code) + "</a>" : esc(id);
    }).join(", ");
    var clusters = topicClusters[t.id] || [];
    var clusterHtml = clusters.length
      ? '<span class="k">also linked to</span><span class="v">' + clusters.map(function (c) {
          return '<a class="clulink" href="#" data-cluster="' + esc(c.id) + '" style="color:' + c.color + '">' +
                 esc(c.label) + "</a>";
        }).join("; ") + "</span>"
      : "";
    var ivHits = (typeof INTERVIEW !== "undefined" ? INTERVIEW : []).filter(function (q) { return interviewTopic(q) === t.id; });

    det.innerHTML =
      '<div class="detail-grid"><div class="gutter">' +
        '<span class="k">stage</span><span class="v">' + esc(stage.n) + "</span>" +
        (pre ? '<span class="k">prerequisites</span><span class="v">' + pre + "</span>" : "") +
        (after ? '<span class="k">used by</span><span class="v">' + after + "</span>" : "") +
        (t.tags ? '<span class="k">tags</span><span class="v">' + esc(t.tags.join(", ")) + "</span>" : "") +
        clusterHtml +
      '</div><div class="dbody">' +
        '<div class="topic-cue"><div class="topic-cue-head"><span>how to approach this topic</span><span>study approach</span></div><p>' + esc(topicCue(t)) + '</p></div>' +
        topicVisual(t) +
        lensBlocks(t) +
        (function () {
          var rr = relatedFor(t.id);
          if (!rr.length) { return ""; }
          return '<div class="topic-links"><h4>connects with</h4>' + rr.map(function (r) {
            var f = byId[r.id];
            return f ? '<a href="#t-' + esc(r.id) + '"><span>' + esc(f.code + " · " + f.t) + '</span><small>' + esc(r.why) + '</small></a>' : '';
          }).join("") + '</div>';
        })() +
        (t.q ? '<div class="predict"><div class="predict-head"><span>think first</span><span>answer before reveal</span></div>' +
               '<p>' + esc(t.q.ask) + '</p>' +
               '<div class="predict-answer">' + esc(t.q.ans) + '</div>' +
               '<button type="button">Reveal reasoning</button></div>' : "") +
        (t.L && t.L.trap ? '<div class="watch"><h4>common trap</h4><p>' + esc(t.L.trap) + '</p></div>' : "") +
        (ivHits.length ? '<div class="ivlinks"><h4>asked about this in interview prep</h4>' +
          ivHits.map(function (q) {
            return '<button type="button" class="ivlinkbtn" data-qid="' + q.id + '">' +
                   esc(q.prompt.slice(0, 70)) + (q.prompt.length > 70 ? "\u2026" : "") +
                   '<span class="tag">' + esc(q.track) + " \u00b7 " + esc(q.level) + "</span></button>";
          }).join("") + "</div>" : "") +
      "</div></div>";

    var mark = row.querySelector(".done-mark");

    function markLearnedNow() {
      done[t.id] = Date.now();
      wrap.dataset.done = "1";
      mark.setAttribute("aria-checked", "true");
      wr(K_DONE, done);
      progress(); refreshDash(); refreshMosaic(t.id);
      fireDoneChange(t.id, true);
    }

    var notesBox = buildNotes(t, wrap, markLearnedNow);
    det.querySelector(".dbody").appendChild(notesBox);

    Array.prototype.forEach.call(det.querySelectorAll(".ivlinkbtn"), function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); ivFocusQuestion(b.dataset.qid); });
    });
    Array.prototype.forEach.call(det.querySelectorAll(".clulink"), function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        setView("graph"); fireHook("graph:cluster", a.dataset.cluster);
      });
    });

    row.addEventListener("click", function (e) {
      if (e.target.classList.contains("done-mark") || e.target.classList.contains("bm")) { return; }
      var open = wrap.classList.toggle("open");
      row.setAttribute("aria-expanded", String(open));
    });

    function toggleDone(e) {
      e.stopPropagation();
      if (isDone(t.id)) {
        delete done[t.id];
        wrap.dataset.done = "0";
        mark.setAttribute("aria-checked", "false");
        wr(K_DONE, done);
        progress(); refreshDash(); refreshMosaic(t.id);
        fireDoneChange(t.id, false);
        return;
      }
      if (noteLen(t.id) < GATE_MIN) {
        wrap.classList.add("open");
        row.setAttribute("aria-expanded", "true");
        notesBox._openForGate();
        return;
      }
      markLearnedNow();
    }
    mark.addEventListener("click", toggleDone);
    mark.addEventListener("keydown", function (e) {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleDone(e); }
    });

    var bm = row.querySelector(".bm");
    function toggleBm(e) {
      e.stopPropagation();
      if (marks[t.id]) { delete marks[t.id]; } else { marks[t.id] = Date.now(); }
      wrap.dataset.bm = marks[t.id] ? "1" : "0";
      wr(K_MARK, marks);
      refreshDash();
    }
    bm.addEventListener("click", toggleBm);
    bm.addEventListener("keydown", function (e) {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleBm(e); }
    });

    var cb = det.querySelector(".predict button");
    if (cb) {
      cb.addEventListener("click", function () {
        var s = cb.parentNode.classList.toggle("shown");
        cb.textContent = s ? "Hide reasoning" : "Reveal reasoning";
      });
    }

    wrap._t = t;
    wrap._blob = (t.code + " " + t.t + " " + t.kick + " " + (t.tags || []).join(" ") + " " +
      Object.keys(t.L || {}).map(function (k) { return t.L[k]; }).join(" ") + " " +
      (t.src ? t.src.code : "")).toLowerCase();
    wrap.appendChild(row);
    wrap.appendChild(det);
    return wrap;
  }

  var reverseDeps = {}; /* topic id -> [ids of topics that list it as a prereq] */
  var topicClusters = {}; /* topic id -> [cluster objects it belongs to] */
  function buildStages() {
    var host = document.getElementById("stages"), nav = document.getElementById("stagenav");
    allTopics = (typeof TOPICS !== "undefined" ? TOPICS.slice() : []);
    allTopics.forEach(function (t) { byId[t.id] = t; });
    allTopics.forEach(function (t) {
      (t.prereq || []).forEach(function (p) {
        (reverseDeps[p] = reverseDeps[p] || []).push(t.id);
      });
    });
    (typeof CLUSTERS !== "undefined" ? CLUSTERS : []).forEach(function (c) {
      c.topics.forEach(function (id) { (topicClusters[id] = topicClusters[id] || []).push(c); });
    });
    STAGES.forEach(function (s) {
      var nb = el("button", null, esc(s.n) + " &nbsp;" + esc(s.title));
      nb.type = "button";
      nb.addEventListener("click", function () {
        document.getElementById(s.id).scrollIntoView({ behavior: "smooth", block: "start" });
      });
      nav.appendChild(nb);

      var sec = el("section", "stage");
      sec.id = s.id;
      var goals = STAGE_GOALS[s.id] || [];
      var goalHtml = goals.length ? '<div class="stage-goals"><span class="stage-goals-label">by the end of this stage</span>' +
        goals.map(function (g) { return '<span class="stage-goal">' + esc(g) + '</span>'; }).join("") + '</div>' : "";
      var stageMeta = String(s.meta || "").replace(/^\d+ topics/, s.topics.length + " topics");
      sec.innerHTML = '<div class="stage-head"><div class="stage-num">' + esc(s.n) + "</div>" +
        "<div><h3>" + esc(s.title) + "</h3><p>" + esc(s.blurb) + "</p>" +
        '<p class="stage-meta">' + esc(stageMeta) + "</p>" + goalHtml + "</div></div>";
      var rows = el("div", "rows");
      s.topics.forEach(function (t) { rows.appendChild(buildTopic(t, s)); });
      sec.appendChild(rows);
      host.appendChild(sec);
    });
    document.getElementById("tcount").textContent = String(allTopics.length);
  }

  /* ---------------- progress / search / nav ---------------- */
  function doneCount() { return allTopics.filter(function (t) { return isDone(t.id); }).length; }
  function progress() {
    var n = allTopics.length, d = doneCount(), pct = n ? Math.round((d / n) * 100) : 0;
    document.getElementById("progbar").style.width = pct + "%";
    document.getElementById("progtxt").textContent = pct + "%";
    /* __APP_VERSION__ is substituted at build time from package.json (build.js), so
       the one version string a learner actually reads is the release number and is
       checked by validate_build.js. It used to be a hand-typed label that had drifted
       a minor version ahead of the app it shipped in. */
    document.getElementById("revline").textContent = "rev __APP_VERSION__ \u00b7 " + d + " / " + n + " topics";
  }
  function filter(q) {
    q = (q || "").trim().toLowerCase();
    Array.prototype.forEach.call(document.querySelectorAll(".topic"), function (n) {
      var hit = !q || n._blob.indexOf(q) !== -1;
      n.classList.toggle("hit-hide", !hit);
      if (q && hit) { n.classList.add("open"); }
      if (!q) { n.classList.remove("open"); }
    });
    Array.prototype.forEach.call(document.querySelectorAll(".stage"), function (s) {
      s.style.display = s.querySelectorAll(".topic:not(.hit-hide)").length ? "" : "none";
    });
  }
  function openAll(v) {
    Array.prototype.forEach.call(document.querySelectorAll(".topic"), function (n) {
      n.classList.toggle("open", v);
      n.querySelector(".row").setAttribute("aria-expanded", String(v));
    });
    document.getElementById("expandall").textContent = v ? "Collapse all" : "Expand all";
  }
  function spyNav() {
    var secs = STAGES.map(function (s) { return document.getElementById(s.id); });
    var btns = document.getElementById("stagenav").children;
    function upd() {
      var best = 0;
      secs.forEach(function (s, i) { if (s && s.getBoundingClientRect().top < 160) { best = i; } });
      for (var i = 0; i < btns.length; i++) { btns[i].setAttribute("aria-current", String(i === best)); }
    }
    window.addEventListener("scroll", upd, { passive: true });
    upd();
  }

  /* ---------------- views ---------------- */
  var currentView = "roadmap", currentSubview = "interview", currentPgSubview = "bitlab";
  function setView(v) {
    currentView = v;
    /* The body owns the set of views: adding one is a new .view element in the
       body plus a rail button, not an edit to a list of names kept in the app. */
    Array.prototype.forEach.call(document.querySelectorAll(".view"), function (n) {
      n.hidden = n.id !== "view-" + v;
    });
    document.getElementById("q").style.display = (v === "roadmap") ? "" : "none";
    document.getElementById("expandall").style.display = (v === "roadmap") ? "" : "none";
    if (v === "dash") { refreshDash(true); }
    if (v === "mosaic") { refreshMosaic(); }
    if (v === "practice") { setSubview(currentSubview); }
    if (v === "graph") { fireHook("view:graph"); }
    if (v === "compile") { initCompileLab(); }
    if (v === "playground") { initLinkLab(); }
    if (v === "periph") { initPeriph(); }
    if (v === "protocols") { initProtocols(); }
    syncRail();
    window.scrollTo(0, 0);
  }
  /* Exactly one rail button is pressed. A rail button is either a view on its own
     or a track inside Practice (data-v + data-sv), and matching on data-v alone
     would light all four Practice tracks at once. The masthead crumb is read off
     the pressed button rather than a second table of names, so the rail stays the
     only place these labels are written. */
  function syncRail() {
    var pressed = null;
    Array.prototype.forEach.call(document.querySelectorAll(".viewsw button"), function (b) {
      var on = b.dataset.v === currentView && (!b.dataset.sv || b.dataset.sv === currentSubview);
      b.setAttribute("aria-pressed", String(on));
      if (on) { pressed = b; }
    });
    if (!pressed) { return; }
    var grp = pressed.closest(".rgroup");
    /* One section expanded at a time. The rail is a map of where you are, not a
       list of everything there is - the count on a closed header says how much it
       holds, and a jump into a collapsed section opens it rather than hiding where
       you landed. */
    Array.prototype.forEach.call(document.querySelectorAll(".rgroup"), function (d) {
      d.open = (d === grp);
    });
    var name = grp ? grp.querySelector(".rname") : null;
    var cg = document.getElementById("crumb-grp");
    var cv = document.getElementById("crumb-view");
    /* .rname, not the summary: the summary also holds the item count, and "Labs4"
       is not the name of anywhere. */
    if (cg) { cg.textContent = name ? name.textContent.trim() : ""; }
    if (cv) { cv.textContent = pressed.textContent; }
  }
  function setSubview(sv) {
    /* A track has to have a section behind it. Practice used to carry a "Linker &
       startup" button with no section of its own, kept alive by a hardcoded jump
       into the Labs view - and a nav item that only exists as a special case in the
       code is how a dead button survives a build check. Applying an unknown name
       would hide all four sections to show no fifth, so it is ignored instead. */
    if (!document.getElementById("sv-" + sv)) { return; }
    currentSubview = sv;
    ["interview", "lab", "faults", "tools"].forEach(function (name) {
      var node = document.getElementById("sv-" + name);
      if (node) { node.hidden = (name !== sv); }
    });
    Array.prototype.forEach.call(document.querySelectorAll("#pv-subnav button"), function (b) {
      b.setAttribute("aria-current", String(b.dataset.sv === sv));
    });
    syncRail();
    if (sv === "interview" && !ivInited) { initInterview(); }
    if (sv === "lab" && !labInited) { initLab(); }
    if (sv === "faults" && !faultsInited) { initFaults(); }
    if (sv === "tools") { setPgSubview(currentPgSubview); }
  }
  function setPgSubview(sv) {
    currentPgSubview = sv;
    ["bitlab", "diffs"].forEach(function (name) {
      var n = document.getElementById("pgv-" + name);
      if (n) { n.hidden = (name !== sv); }
    });
    Array.prototype.forEach.call(document.querySelectorAll("#pg-subnav button"), function (b) {
      b.setAttribute("aria-current", String(b.dataset.sv === sv));
    });
    if (sv === "bitlab" && !pgInited.bitlab) { initBitLab(); pgInited.bitlab = true; }
    if (sv === "diffs" && !pgInited.diffs) { initDiffs(); pgInited.diffs = true; }
  }

  function goTopic(id) {
    setView("roadmap");
    var n = document.getElementById("t-" + id);
    if (!n) { return; }
    n.classList.remove("hit-hide");
    n.classList.add("open");
    n.querySelector(".row").setAttribute("aria-expanded", "true");
    setTimeout(function () { n.scrollIntoView({ behavior: "smooth", block: "center" }); }, 40);
  }

  /* ---------------- dashboard ---------------- */
  function stageOf(t) {
    for (var i = 0; i < STAGES.length; i++) {
      if (STAGES[i].topics.indexOf(t) !== -1) { return STAGES[i]; }
    }
    return null;
  }
  function linkItem(t, extra) {
    return '<li><a href="#" data-go="' + t.id + '"><span class="c">' + esc(t.code) + "</span>" +
           esc(t.t) + "</a>" + (extra || "") + "</li>";
  }
  function wireGo(host) {
    Array.prototype.forEach.call(host.querySelectorAll("[data-go]"), function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); goTopic(a.dataset.go); });
    });
  }

  /* Jumping back to a stage you wrote about is a two-step thing no lab offers on its
     own: the view has to be initialised before its stage nav exists, and each lab
     changes stage by its own button. So the jump presses that button rather than
     calling an internal - a lab that later moves stages a different way keeps working
     here, and a stage that no longer has a button lands you on the lab instead of on a
     wrong stage. The names are the walk-mark ones, except the linker lab's view.
     The Protocol Lab is the one exception: it shows only the current family's stage
     tabs, so a journal for a stage in another family has no button to press yet even
     though that stage is real. There the jump makes the same call the tab would have -
     prGoStage switches to the stage and its family at once - while a stage that truly
     does not exist still falls through to simply opening the lab. */
  var JR_TABS = {
    compile: "data-compile-stage", link: "data-link-stage",
    periph: "data-pfstage", protocols: "data-prstage",
  };
  /* The narrow column in a dashboard list row holds a topic code like "C07", so a
     journal row puts the shortest true name of the lab there instead of padding it
     with a long title that would push the preview off the panel. */
  var JR_SHORT = { compile: "c-path", link: "linker", periph: "periph", protocols: "proto" };
  function goStage(lab, stage) {
    if (!JR_TABS[lab]) { return; }
    setView(lab === "link" ? "playground" : lab);
    var btn = document.querySelector("[" + JR_TABS[lab] + '="' + stage + '"]');
    if (btn) { btn.click(); return; }
    if (lab === "protocols" && prStageById(Number(stage))) { prGoStage(Number(stage)); }
  }
  function wireGoStage(host) {
    Array.prototype.forEach.call(host.querySelectorAll("[data-gostage]"), function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var k = String(a.dataset.gostage).split(":");
        goStage(k[0], k[1]);
      });
    });
  }

  /* ---- lab progress, for the dashboard ----
     The two reading labs (Compilation Path, Linker & Startup) have no graded goals,
     so the honest metric there is which stages you opened. The two bench labs do
     grade, so their number is goals verified. Everything is read straight out of
     localStorage: a lab you never opened has its own key, and opening the
     dashboard must not initialise one. */
  function walkMark(lab, stage) {
    var w = rd(K_WALK, null);
    if (!w || typeof w !== "object") { w = {}; }
    if (!w[lab] || typeof w[lab] !== "object") { w[lab] = {}; }
    if (w[lab][stage]) { return; }
    w[lab][stage] = true;
    wr(K_WALK, w);
  }
  /* Counts always run off the lab's own stage list, never off the size of the
     stored object: a stage that was renamed or dropped on the way out must not
     keep inflating someone's progress, and n/total must never read 8/7. */
  function walkSeen(lab, stage) {
    var w = rd(K_WALK, null);
    var s = w && typeof w === "object" ? w[lab] : null;
    return !!(s && typeof s === "object" && s[stage]);
  }
  function walkCount(lab, stages) {
    var w = rd(K_WALK, null);
    var s = w && typeof w === "object" ? w[lab] : null;
    if (!s || typeof s !== "object") { return 0; }
    var n = 0;
    stages.forEach(function (id) { if (s[id]) { n++; } });
    return n;
  }
  function storedGoals(key, ids) {
    var s = rd(key, null);
    var g = s && s.goals && typeof s.goals === "object" ? s.goals : {};
    var n = 0;
    ids.forEach(function (id) { if (g[id]) { n++; } });
    return { n: n, stage: s && typeof s.stage === "number" ? s.stage : 0 };
  }
  function stageIds(meta) {
    return meta.map(function (s) { return s.id; });
  }

  /* ---- lab stage journals, the storage end ----
     Keyed "lab:stage" in one object under K_JOURNAL, held only in localStorage and
     read when something asks for it - so an import that reloads the page cannot be
     overwritten by a lab still holding an in-memory copy, and a lab you never opened
     has no entry here to inflate a count. An empty journal deletes its key rather than
     storing "", the same rule the topic notes follow. */
  function jrKey(lab, stage) { return lab + ":" + stage; }
  function jrAll() {
    var j = rd(K_JOURNAL, null);
    return j && typeof j === "object" ? j : {};
  }
  function jrGet(lab, stage) { return jrAll()[jrKey(lab, stage)] || ""; }
  function jrSet(lab, stage, txt) {
    /* Re-read on the way in, and only this stage's key touched: two journal boxes can
       be alive at once when a stage is switched while the old one's save is still on
       the debounce, and neither may write the other's copy of the map back. */
    var j = jrAll(), k = jrKey(lab, stage);
    if (txt && txt.trim()) { j[k] = txt; } else { delete j[k]; }
    wr(K_JOURNAL, j);
  }

  /* Which stages each lab has right now, and what they are called. Same authority the
     progress rows run on: a journal is only countable, listable or exportable while
     its stage exists. A renamed or dropped stage does not delete what you wrote about
     it - the entry stays in storage - it simply stops being presented as somewhere
     you can still go. */
  function jrLabStages() {
    return [
      { lab: "compile", title: "Compilation Path", stages: Object.keys(COMPILE_DATA),
        name: function (s) { return (COMPILE_DATA[s] || {}).title || s; } },
      { lab: "link", title: "Linker & Startup", stages: LINK_STAGES,
        name: function (s) { return (LINK_DATA[s] || {}).title || s; } },
      { lab: "periph", title: "Peripheral Playground", stages: stageIds(PF_STAGE_META),
        name: function (s) { return (pfStageById(s) || {}).name || s; } },
      { lab: "protocols", title: "Protocol Lab", stages: stageIds(PR_STAGE_META),
        name: function (s) { return (prStageById(s) || {}).name || s; } }
    ];
  }
  /* Ordered by lab then by the lab's own stage order, so the writing panel reads like
     the labs rather than like the order keys happen to come out of storage. */
  function jrEntries() {
    var all = jrAll(), out = [];
    jrLabStages().forEach(function (g) {
      g.stages.forEach(function (s) {
        var txt = String(all[jrKey(g.lab, s)] || "");
        if (!txt.trim()) { return; }
        out.push({ lab: g.lab, stage: s, name: g.name(s), text: txt });
      });
    });
    return out;
  }
  function labRow(name, view, done, total, cap) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    return '<div class="stagebar labrow">' +
      '<button type="button" class="lablink" data-golab="' + view + '">' + esc(name) + '</button>' +
      '<span class="tr"><i style="width:' + pct + '%"></i></span>' +
      '<span class="nn">' + done + "/" + total + '</span>' +
      '<p class="labcap">' + cap + '</p></div>';
  }
  function dashLabs() {
    var h = "";
    var cStages = Object.keys(COMPILE_DATA);
    h += labRow("Compilation Path", "compile", walkCount("compile", cStages), cStages.length, "stages opened");
    h += labRow("Linker & Startup", "playground", walkCount("link", LINK_STAGES), LINK_STAGES.length,
      'stages opened \u00b7 your script: <b>' + lksandVerdict() + '</b>');
    var pf = storedGoals(K_PERIPH, stageIds(PF_STAGE_META));
    h += labRow("Peripherals", "periph", pf.n, PF_STAGE_META.length,
      "goals verified \u00b7 stage 9 is graded on behaviour over time" + (pf.stage ? ' \u00b7 at <b>' + esc((pfStageById(pf.stage) || {}).name || "") + '</b>' : ''));
    var pr = storedGoals(K_PROTOS, stageIds(PR_STAGE_META));
    h += labRow("Protocol Lab", "protocols", pr.n, PR_STAGE_META.length,
      "goals verified" + (pr.stage ? ' \u00b7 at <b>' + esc((prStageById(pr.stage) || {}).name || "") + '</b>' : ''));
    return h;
  }
  /* The sandbox has a verdict, but the default placement is not something the
     user achieved - only report a footprint once they have actually opened it. */
  function lksandVerdict() {
    if (!walkSeen("link", "sandbox")) { return "not opened"; }
    var res = lksandCompute(lksandLoad());
    return res.errors ? res.errors + " placement error" + (res.errors === 1 ? "" : "s")
      : "fits \u00b7 " + Math.round(res.flashUsed / 1024) + " KB flash, " + Math.round(res.ramUsed / 1024) + " KB ram";
  }

  function refreshDash(force) {
    if (!force && currentView !== "dash") { return; }
    var n = allTopics.length, d = doneCount();
    /* Read once per refresh: four labs' stage lists and a storage read would otherwise
       happen three times over in here, and every use below has to agree on one answer. */
    var jrs = jrEntries();
    document.getElementById("d-count").innerHTML = d + '<small id="d-of">of ' + n + "</small>";

    var remaining = n - d;
    var ts = Object.keys(done).map(function (k) { return done[k]; }).filter(Boolean).sort();
    var perWeek = 0;
    if (ts.length > 1) {
      var span = Math.max(1, (ts[ts.length - 1] - ts[0]) / DAY);
      perWeek = (ts.length / span) * 7;
    }
    document.getElementById("d-sub").innerHTML =
      remaining + " to go." +
      (perWeek >= 0.5
        ? " At " + perWeek.toFixed(1) + " topics a week that is about " +
          Math.ceil(remaining / perWeek) + " more weeks."
        : " Mark a few topics to get a pace estimate.");

    var sh = document.getElementById("d-stages");
    sh.innerHTML = STAGES.map(function (s) {
      var sd = s.topics.filter(function (t) { return isDone(t.id); }).length;
      var pct = Math.round((sd / s.topics.length) * 100);
      return '<div class="stagebar"><span>' + esc(s.title) + '</span>' +
             '<span class="tr"><i style="width:' + pct + '%"></i></span>' +
             '<span class="nn">' + sd + "/" + s.topics.length + "</span></div>";
    }).join("");

    var lh = document.getElementById("d-labs");
    if (lh) {
      lh.innerHTML = dashLabs();
      Array.prototype.forEach.call(lh.querySelectorAll("[data-golab]"), function (b) {
        b.addEventListener("click", function () { setView(b.dataset.golab); });
      });
      /* Opening every stage of a lab is not the same as having got anything out of it,
         and the rows above would happily read 8/8 either way. This is the nudge, said
         where the progress it is talking about is. */
      lh.innerHTML += '<p class="labcap jrtally">' + (jrs.length
        ? jrs.length + " stage journal" + (jrs.length === 1 ? "" : "s") + " written."
        : "Nothing written in a lab yet. A stage you opened and described is a stage you can come back to; a stage you only looked at is not.") + "</p>";
    }

    var today = new Date(); today.setHours(0, 0, 0, 0);
    var counts = {}, total30 = 0;
    Object.keys(done).forEach(function (k) {
      if (!done[k]) { return; }
      var dd = new Date(done[k]); dd.setHours(0, 0, 0, 0);
      var idx = Math.round((today - dd) / DAY);
      if (idx >= 0 && idx < 30) { counts[idx] = (counts[idx] || 0) + 1; total30++; }
    });
    var heat = "";
    for (var i = 29; i >= 0; i--) {
      var c = counts[i] || 0;
      var op = c === 0 ? 0 : Math.min(1, 0.3 + c * 0.18);
      heat += '<span title="' + c + ' on ' + new Date(today - i * DAY).toDateString() + '"' +
              (c ? ' style="background:var(--ok);opacity:' + op + '"' : "") + "></span>";
    }
    document.getElementById("d-heat").innerHTML = heat;
    document.getElementById("d-heatkey").textContent =
      total30 + (total30 === 1 ? " topic" : " topics") + " marked in the last 30 days.";

    var nNotes = Object.keys(notes).filter(function (k) { return (notes[k] || "").trim(); }).length;
    var nMarks = Object.keys(marks).length;
    var words = Object.keys(notes).reduce(function (a, k) {
      return a + (notes[k] || "").split(/\s+/).filter(Boolean).length;
    }, 0);
    /* Journals count toward "words written" because they are the same act, and the
       number is the one a learner is actually being asked about. */
    var jrWords = jrs.reduce(function (a, e) {
      return a + e.text.split(/\s+/).filter(Boolean).length;
    }, 0);
    document.getElementById("d-writing").innerHTML =
      nNotes + " topics with notes, " + jrs.length + " stage journals, " +
      (words + jrWords) + " words written.<br>" + nMarks + " bookmarked.";

    var next = allTopics.filter(function (t) {
      return !isDone(t.id) && (t.prereq || []).every(function (p) { return isDone(p); });
    }).slice(0, 8);
    var nh = document.getElementById("d-next");
    nh.innerHTML = next.length
      ? next.map(function (t) { return linkItem(t); }).join("")
      : '<li><p class="blank">Everything with satisfied prerequisites is done. Open the mosaic.</p></li>';
    wireGo(nh);

    var mh = document.getElementById("d-marks");
    var mlist = allTopics.filter(function (t) { return marks[t.id]; });
    mh.innerHTML = mlist.length
      ? mlist.map(function (t) { return linkItem(t); }).join("")
      : '<li><p class="blank">Nothing bookmarked. Use the star on any topic row to park it for later.</p></li>';
    wireGo(mh);

    var oh = document.getElementById("d-notes");
    var nlist = allTopics.filter(function (t) { return (notes[t.id] || "").trim(); });
    function preview(txt) {
      return esc(String(txt).replace(/[#*`>\-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120));
    }
    /* One panel for everything written down, because "what have I actually put in my
       own words" is one question. A topic row goes to the topic; a journal row goes to
       the stage of the lab it was written on. */
    oh.innerHTML = (
      nlist.map(function (t) {
        return linkItem(t, '<span class="pv">' + preview(notes[t.id]) + "</span>");
      }).join("") +
      jrs.map(function (e) {
        return '<li><a href="#" data-gostage="' + e.lab + ":" + e.stage + '"><span class="c">' +
               esc(JR_SHORT[e.lab] || e.lab) + "</span>" + esc(e.name) + "</a>" +
               '<span class="pv">' + preview(e.text) + "</span></li>";
      }).join("")
    ) || '<li><p class="blank">Nothing written yet. Open a topic and press Write, or work a lab stage and fill in the journal under it.</p></li>';
    wireGo(oh);
    wireGoStage(oh);

    var answered = Object.keys(ivState.answers).length;
    var solved = Object.keys(faultState.seen).filter(function (k) { return faultState.seen[k]; }).length;
    document.getElementById("d-practice").innerHTML =
      answered + " interview question" + (answered === 1 ? "" : "s") + " self-graded.<br>" +
      solved + " / " + FAULTS.length + " fault scenarios solved.";
  }

  /* Journals get their own section in the export, grouped by lab and in the lab's own
     stage order, with the lab named above the stage: "4. Memory" means nothing six
     months later unless you know whose stage 4 it was. */
  function journalsMarkdown() {
    var out = [], all = jrAll();
    jrLabStages().forEach(function (g) {
      var body = [];
      g.stages.forEach(function (s) {
        var txt = String(all[jrKey(g.lab, s)] || "");
        if (!txt.trim()) { return; }
        body.push("#### " + g.name(s) + "", "", txt.trim(), "");
      });
      if (!body.length) { return; }
      out.push("### " + g.title + "", "");
      out = out.concat(body);
    });
    return out;
  }

  function notesMarkdown() {
    var out = ["# Embedded C roadmap — notes", ""];
    STAGES.forEach(function (s) {
      var any = s.topics.filter(function (t) { return (notes[t.id] || "").trim(); });
      if (!any.length) { return; }
      out.push("## " + s.n + " " + s.title, "");
      any.forEach(function (t) {
        out.push("### " + t.code + " " + t.t, "", notes[t.id].trim(), "");
      });
    });
    var jr = journalsMarkdown();
    if (jr.length) { out.push("## Lab stage journals", ""); out = out.concat(jr); }
    return out.join("\n");
  }

  /* ---------------- mosaic ---------------- */
  var mosBuilt = false, COLS = 12, ROWS = 0, CELL = 100, ART_W = 1200, ART_H = 800;

  function artwork() {
    var g = ['<rect width="1200" height="800" fill="#0B141C"/>'];
    g.push('<defs><radialGradient id="glow" cx="50%" cy="50%" r="50%">' +
           '<stop offset="0%" stop-color="#63C2D9" stop-opacity=".30"/>' +
           '<stop offset="100%" stop-color="#63C2D9" stop-opacity="0"/></radialGradient>' +
           '<linearGradient id="sub" x1="0" y1="0" x2="1" y2="1">' +
           '<stop offset="0%" stop-color="#132330"/><stop offset="100%" stop-color="#0D1A24"/>' +
           "</linearGradient></defs>");
    g.push('<rect x="58" y="38" width="1084" height="724" rx="14" fill="url(#sub)" stroke="#254156" stroke-width="2"/>');

    /* package leads */
    var i;
    for (i = 0; i < 18; i++) {
      var px = 100 + i * 56;
      g.push('<rect x="' + px + '" y="40" width="30" height="16" rx="3" fill="#7C8B97"/>');
      g.push('<rect x="' + px + '" y="744" width="30" height="16" rx="3" fill="#7C8B97"/>');
      g.push('<line x1="' + (px + 15) + '" y1="56" x2="' + (px + 15) + '" y2="150" stroke="#3D5A6E" stroke-width="1"/>');
      g.push('<line x1="' + (px + 15) + '" y1="744" x2="' + (px + 15) + '" y2="650" stroke="#3D5A6E" stroke-width="1"/>');
    }
    for (i = 0; i < 11; i++) {
      var py = 110 + i * 56;
      g.push('<rect x="60" y="' + py + '" width="16" height="30" rx="3" fill="#7C8B97"/>');
      g.push('<rect x="1124" y="' + py + '" width="16" height="30" rx="3" fill="#7C8B97"/>');
      g.push('<line x1="76" y1="' + (py + 15) + '" x2="230" y2="' + (py + 15) + '" stroke="#3D5A6E" stroke-width="1"/>');
      g.push('<line x1="1124" y1="' + (py + 15) + '" x2="970" y2="' + (py + 15) + '" stroke="#3D5A6E" stroke-width="1"/>');
    }

    /* die */
    g.push('<ellipse cx="420" cy="330" rx="260" ry="200" fill="url(#glow)"/>');
    g.push('<rect x="230" y="150" width="740" height="500" rx="6" fill="#0E1B26" stroke="#2E5A7A" stroke-width="1.5"/>');

    var blocks = [
      [270, 190, 240, 160, "CORE", "#7FB2D4", "fetch \u00b7 decode \u00b7 execute"],
      [270, 366, 110, 74, "FPU", "#A899E6", ""],
      [392, 366, 118, 74, "NVIC", "#A899E6", ""],
      [540, 190, 200, 116, "FLASH", "#63C2D9", ".text \u00b7 .rodata"],
      [540, 322, 200, 118, "SRAM", "#6FC49A", ".data \u00b7 .bss \u00b7 stack"],
      [770, 190, 170, 74, "DMA", "#E8A93C", ""],
      [770, 280, 170, 74, "TIMERS", "#E8A93C", ""],
      [770, 370, 80, 70, "ADC", "#E8A93C", ""],
      [862, 370, 78, 70, "PWM", "#E8A93C", ""],
      [270, 462, 670, 56, "BUS MATRIX", "#E0806E", ""],
      [270, 540, 105, 82, "UART", "#63C2D9", ""],
      [383, 540, 105, 82, "SPI", "#63C2D9", ""],
      [496, 540, 105, 82, "I2C", "#63C2D9", ""],
      [609, 540, 105, 82, "CAN", "#E0806E", ""],
      [722, 540, 105, 82, "PLL", "#A899E6", ""],
      [835, 540, 105, 82, "WDT", "#E0806E", ""]
    ];
    blocks.forEach(function (b) {
      g.push('<rect x="' + b[0] + '" y="' + b[1] + '" width="' + b[2] + '" height="' + b[3] +
             '" rx="3" fill="' + b[5] + '" fill-opacity=".13" stroke="' + b[5] + '" stroke-opacity=".62"/>');
      g.push('<text x="' + (b[0] + 10) + '" y="' + (b[1] + 21) +
             '" font-family="IBM Plex Mono, monospace" font-size="13" fill="' + b[5] +
             '" fill-opacity=".95">' + b[4] + "</text>");
      if (b[6]) {
        g.push('<text x="' + (b[0] + 10) + '" y="' + (b[1] + 39) +
               '" font-family="IBM Plex Mono, monospace" font-size="10" fill="#8FA3B2">' + b[6] + "</text>");
      }
      /* trace down to the bus */
      var cx = b[0] + b[2] / 2;
      if (b[1] < 462 && b[4] !== "BUS MATRIX") {
        g.push('<line x1="' + cx + '" y1="' + (b[1] + b[3]) + '" x2="' + cx +
               '" y2="462" stroke="#2E5A7A" stroke-width="1.2" stroke-opacity=".7"/>');
        g.push('<circle cx="' + cx + '" cy="462" r="2.6" fill="#E8A93C" fill-opacity=".8"/>');
      } else if (b[1] > 462) {
        g.push('<line x1="' + cx + '" y1="518" x2="' + cx +
               '" y2="' + b[1] + '" stroke="#2E5A7A" stroke-width="1.2" stroke-opacity=".7"/>');
        g.push('<circle cx="' + cx + '" cy="518" r="2.6" fill="#E8A93C" fill-opacity=".8"/>');
      }
    });

    /* die pads */
    for (i = 0; i < 12; i++) {
      g.push('<rect x="236" y="' + (170 + i * 40) + '" width="8" height="8" fill="#B9C6D1" fill-opacity=".75"/>');
      g.push('<rect x="956" y="' + (170 + i * 40) + '" width="8" height="8" fill="#B9C6D1" fill-opacity=".75"/>');
    }
    g.push('<text x="242" y="640" font-family="IBM Plex Mono, monospace" font-size="11" ' +
           'fill="#5C7385">EMBEDDED C \u2014 ' + allTopics.length + ' TOPICS \u2014 ONE DIE</text>');
    return g.join("");
  }

  /* jigsaw edge: cubic segments, absolute coords, left-to-right / top-to-bottom */
  var FR = [
    [[0.2, 0], [0.4, 0], [0.4, 0]],
    [[0.42, -0.16], [0.28, -0.21], [0.5, -0.21]],
    [[0.72, -0.21], [0.58, -0.16], [0.6, 0]],
    [[0.8, 0], [1, 0], [1, 0]]
  ];
  function edgeSegs(x, y, len, v, vertical) {
    return FR.map(function (s) {
      return s.map(function (p) {
        var along = p[0] * len, across = p[1] * len * v;
        return vertical ? [x + across, y + along] : [x + along, y + across];
      });
    });
  }
  function fmt(p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }
  function fwd(segs) {
    return segs.map(function (s) { return "C" + s.map(fmt).join(" "); }).join("");
  }
  function rev(ox, oy, segs) {
    var out = "", i, target;
    for (i = segs.length - 1; i >= 0; i--) {
      target = (i === 0) ? [ox, oy] : segs[i - 1][2];
      out += "C" + [segs[i][1], segs[i][0], target].map(fmt).join(" ");
    }
    return out;
  }

  function pieceD(c, r, hTabs, vTabs) {
    var x = c * CELL, y = r * CELL, d = "M" + x + "," + y;
    /* top: left -> right */
    if (r === 0) { d += "L" + (x + CELL) + "," + y; }
    else { d += fwd(edgeSegs(x, y, CELL, hTabs[r][c], false)); }
    /* right: top -> bottom */
    if (c === COLS - 1) { d += "L" + (x + CELL) + "," + (y + CELL); }
    else { d += fwd(edgeSegs(x + CELL, y, CELL, vTabs[r][c + 1], true)); }
    /* bottom: right -> left, reversing the edge shared with the piece below */
    if (r === ROWS - 1) { d += "L" + x + "," + (y + CELL); }
    else { d += rev(x, y + CELL, edgeSegs(x, y + CELL, CELL, hTabs[r + 1][c], false)); }
    /* left: bottom -> top, reversing the edge shared with the piece to the left */
    if (c === 0) { d += "L" + x + "," + y; }
    else { d += rev(x, y, edgeSegs(x, y, CELL, vTabs[r][c], true)); }
    return d + "Z";
  }

  function rnd(i) { var x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); }

  function buildMosaic() {
    if (mosBuilt) { return; }
    ROWS = Math.ceil(allTopics.length / COLS);
    CELL = ART_W / COLS;
    ART_H = CELL * ROWS;

    var hTabs = [], vTabs = [], r, c, k = 0;
    for (r = 0; r <= ROWS; r++) {
      hTabs[r] = []; vTabs[r] = [];
      for (c = 0; c <= COLS; c++) {
        hTabs[r][c] = rnd(++k) > 0.5 ? 1 : -1;
        vTabs[r][c] = rnd(++k) > 0.5 ? 1 : -1;
      }
    }

    var svg = ['<svg class="mosaic" viewBox="0 0 ' + ART_W + " " + ART_H + '" xmlns="http://www.w3.org/2000/svg">'];
    svg.push('<g>' + artwork() + "</g>");
    var covers = [], seams = [], hits = [];
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        var idx = r * COLS + c;
        var t = allTopics[idx];
        var d = pieceD(c, r, hTabs, vTabs);
        covers.push('<path class="cover" id="cv-' + idx + '" d="' + d + '"/>');
        seams.push('<path class="seam" d="' + d + '"/>');
        hits.push('<path class="hitp" d="' + d + '" data-i="' + idx + '"' +
                  (t ? ' data-id="' + t.id + '"' : "") + "/>");
      }
    }
    svg.push("<g>" + covers.join("") + "</g>");
    svg.push("<g>" + seams.join("") + "</g>");
    svg.push("<g>" + hits.join("") + "</g>");
    svg.push("</svg>");

    var frame = document.getElementById("mosframe");
    frame.insertAdjacentHTML("afterbegin", svg.join(""));

    var tip = document.getElementById("mostip");
    frame.addEventListener("mousemove", function (e) {
      var tgt = e.target;
      if (!tgt.classList || !tgt.classList.contains("hitp")) { tip.classList.remove("on"); return; }
      var i = +tgt.dataset.i, t = allTopics[i];
      tip.innerHTML = t
        ? '<span class="c">' + esc(t.code) + (isDone(t.id) ? " \u00b7 learned" : "") + "</span>" + esc(t.t)
        : '<span class="c">final piece</span>Revealed when the roadmap is complete.';
      var b = frame.getBoundingClientRect();
      tip.style.left = Math.min(b.width - 260, e.clientX - b.left + 14) + "px";
      tip.style.top = (e.clientY - b.top + 14) + "px";
      tip.classList.add("on");
    });
    frame.addEventListener("mouseleave", function () { tip.classList.remove("on"); });
    frame.addEventListener("click", function (e) {
      if (e.target.classList && e.target.dataset.id) { goTopic(e.target.dataset.id); }
    });

    document.getElementById("m-peek").addEventListener("click", function () {
      var on = frame.classList.toggle("peek");
      Array.prototype.forEach.call(frame.querySelectorAll(".cover"), function (p) {
        p.style.opacity = on ? "0.14" : "";
      });
      this.textContent = on ? "Hide the preview" : "Peek at the full picture";
    });

    mosBuilt = true;
  }

  function refreshMosaic(changedId) {
    if (!mosBuilt) {
      if (currentView !== "mosaic") { return; }
      buildMosaic();
    }
    var d = 0;
    allTopics.forEach(function (t, i) {
      var cv = document.getElementById("cv-" + i);
      if (!cv) { return; }
      var on = isDone(t.id);
      if (on) { d++; }
      cv.classList.toggle("on", on);
    });
    var complete = d === allTopics.length;
    for (var i = allTopics.length; i < ROWS * COLS; i++) {
      var cv2 = document.getElementById("cv-" + i);
      if (cv2) { cv2.classList.toggle("on", complete); }
    }
    document.getElementById("m-count").textContent =
      d + " of " + allTopics.length + " pieces placed";
    document.getElementById("m-done").textContent = complete
      ? "Every piece is placed. You can read a datasheet, a map file and a disassembly, and say where each line of C ended up."
      : "";
  }

  /* ================= interview prep ================= */
  var ivQueue = null, ivIdx = 0, ivTimerId = null, ivEndsAt = 0;

  function interviewTopic(q) {
    if (!q) { return null; }
    if (q.topic && byId[q.topic]) { return q.topic; }
    for (var i = 0; i < allTopics.length; i++) {
      var ids = allTopics[i].interview || [];
      if (ids.indexOf(q.id) >= 0) { return allTopics[i].id; }
    }
    return null;
  }

  function ivQuestionsFor(track, level, format) {
    return INTERVIEW.filter(function (q) {
      return (!track || q.track === track) && (!level || q.level === level) && (!format || q.format === format);
    });
  }
  function ivSaveAnswer(qid, patch) {
    var cur = ivState.answers[qid] || { typed: "", checked: [] };
    ivState.answers[qid] = Object.assign({}, cur, patch);
    wr(K_IV, ivState);
  }
  function ivAccumulate(hit, total, qid) {
    var q = INTERVIEW.filter(function (x) { return x.id === qid; })[0];
    var a = ivState.answers[qid];
    if (!q || !a) { return; }
    q.rubric.forEach(function (r, i) {
      total[r.lens] = (total[r.lens] || 0) + 1;
      var key = r.lens + ":" + i;
      if (a.checked && a.checked.indexOf(key) !== -1) { hit[r.lens] = (hit[r.lens] || 0) + 1; }
    });
  }
  function ivCoverage() {
    var hit = {}, total = {};
    LENSES.forEach(function (L) { hit[L.k] = 0; total[L.k] = 0; });
    Object.keys(ivState.answers).forEach(function (qid) { ivAccumulate(hit, total, qid); });
    return { hit: hit, total: total };
  }
  function ivRenderCoverage(scopeQids) {
    var cov;
    if (scopeQids) {
      var hit = {}, total = {};
      LENSES.forEach(function (L) { hit[L.k] = 0; total[L.k] = 0; });
      scopeQids.forEach(function (qid) { ivAccumulate(hit, total, qid); });
      cov = { hit: hit, total: total };
    } else {
      cov = ivCoverage();
    }
    var host = document.getElementById(scopeQids ? "iv-report-cov" : "iv-cov");
    if (!host) { return cov; }
    host.innerHTML = LENSES.map(function (L) {
      var t = cov.total[L.k] || 0, h = cov.hit[L.k] || 0;
      var pct = t ? Math.round((h / t) * 100) : null;
      return '<div class="cell"><span class="lb">' + esc(L.label) + "</span>" +
        '<div class="tr"><i style="width:' + (pct || 0) + "%;background:" + L.c + '"></i></div>' +
        '<span class="pct">' + (pct === null ? "no data yet" : pct + "% (" + h + "/" + t + ")") + "</span></div>";
    }).join("");
    return cov;
  }

  function ivRenderList() {
    var track = document.getElementById("iv-track").value;
    var level = document.getElementById("iv-level").value;
    var format = document.getElementById("iv-format").value;
    var qs = ivQuestionsFor(track, level, format);
    var host = document.getElementById("iv-list");
    host.innerHTML = qs.map(function (q) {
      var done2 = ivState.answers[q.id] ? " \u00b7 answered" : "";
      return '<button type="button" data-qid="' + q.id + '">' + esc(q.prompt.slice(0, 64)) +
        (q.prompt.length > 64 ? "\u2026" : "") +
        '<span class="tag">' + q.track + " \u00b7 " + q.level + " \u00b7 " + q.format + done2 + "</span></button>";
    }).join("") || '<p class="blank" style="padding:12px">No questions match this filter.</p>';
    Array.prototype.forEach.call(host.querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () { ivShow(b.dataset.qid); });
    });
    return qs.map(function (q) { return q.id; });
  }

  function ivShow(qid, mockCtx) {
    var q = INTERVIEW.filter(function (x) { return x.id === qid; })[0];
    if (!q) { return; }
    Array.prototype.forEach.call(document.querySelectorAll("#iv-list button"), function (b) {
      b.setAttribute("aria-current", String(b.dataset.qid === qid));
    });
    var saved = ivState.answers[qid] || { typed: "", checked: [] };
    var card = document.getElementById("iv-card");
    var trackLabel = TRACKS.filter(function (tt) { return tt.k === q.track; })[0];
    var qTopic = interviewTopic(q);
    var topicRef = qTopic && byId[qTopic];
    card.innerHTML =
      '<div class="ivmeta"><span>' + esc(trackLabel ? trackLabel.label : q.track) + "</span><span>" +
      esc(q.level) + "</span><span>" + esc(q.format) + "</span>" +
      (topicRef ? '<button type="button" class="ivtopicref" id="iv-topicref">from ' +
                  esc(topicRef.code) + " " + esc(topicRef.t) + "</button>" : "") +
      "</div>" +
      '<p class="ivprompt">' + esc(q.prompt) + "</p>" +
      (q.code ? '<pre class="ivcode">' + hl(q.code) + "</pre>" : "") +
      '<textarea class="ivans" placeholder="Type your answer, or think out loud and just self-check below.">' +
        esc(saved.typed) + "</textarea>" +
      '<button class="btn" type="button" id="iv-reveal">Reveal rubric</button>' +
      '<div class="ivrubric" id="iv-rubric" hidden>' +
        "<ul>" + q.rubric.map(function (r, i) {
          var L = LENSES.filter(function (x) { return x.k === r.lens; })[0];
          var checked = saved.checked && saved.checked.indexOf(r.lens + ":" + i) !== -1;
          return '<li><input type="checkbox" data-lk="' + r.lens + ":" + i + '"' + (checked ? " checked" : "") + ">" +
            '<span class="lenschip" style="color:' + (L ? L.c : "var(--ink-3)") + '">' + (L ? esc(L.label) : esc(r.lens)) + "</span>" +
            "<span>" + esc(r.pt) + "</span></li>";
        }).join("") + "</ul>" +
        '<p class="ivmodel">' + esc(q.modelNote) + "</p>" +
      "</div>" +
      '<div class="ivnav">' +
        (mockCtx ? '<button class="btn" type="button" id="iv-prev">Prev</button>' +
          '<span id="iv-pos">' + (mockCtx.idx + 1) + " / " + mockCtx.list.length + "</span>" +
          '<button class="btn" type="button" id="iv-next">' + (mockCtx.idx === mockCtx.list.length - 1 ? "Finish mock" : "Next") + "</button>"
          : "") +
      "</div>";

    var topicBtn = card.querySelector("#iv-topicref");
    if (topicBtn) { topicBtn.addEventListener("click", function () { goTopic(interviewTopic(q)); }); }

    var ta = card.querySelector(".ivans");
    var saveTimer = null;
    ta.addEventListener("input", function () {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { ivSaveAnswer(qid, { typed: ta.value }); }, 400);
    });

    var rev = card.querySelector("#iv-reveal");
    var rub = card.querySelector("#iv-rubric");
    rev.addEventListener("click", function () {
      var open = rub.hidden;
      rub.hidden = !open;
      rev.textContent = open ? "Hide rubric" : "Reveal rubric";
      if (open) { ivSaveAnswer(qid, { typed: ta.value, checked: (ivState.answers[qid] && ivState.answers[qid].checked) || [] }); }
    });
    Array.prototype.forEach.call(card.querySelectorAll('.ivrubric input[type="checkbox"]'), function (cb) {
      cb.addEventListener("change", function () {
        var cur = (ivState.answers[qid] && ivState.answers[qid].checked) || [];
        var lk = cb.dataset.lk;
        if (cb.checked) { if (cur.indexOf(lk) === -1) { cur.push(lk); } }
        else { cur = cur.filter(function (x) { return x !== lk; }); }
        ivSaveAnswer(qid, { typed: ta.value, checked: cur });
        ivRenderCoverage();
        if (mockCtx) { ivRenderCoverage(mockCtx.list, true); }
      });
    });

    if (mockCtx) {
      card.querySelector("#iv-prev").disabled = mockCtx.idx === 0;
      card.querySelector("#iv-prev").addEventListener("click", function () {
        ivShow(mockCtx.list[mockCtx.idx - 1], { list: mockCtx.list, idx: mockCtx.idx - 1 });
      });
      card.querySelector("#iv-next").addEventListener("click", function () {
        if (mockCtx.idx === mockCtx.list.length - 1) { ivFinishMock(mockCtx.list); return; }
        ivShow(mockCtx.list[mockCtx.idx + 1], { list: mockCtx.list, idx: mockCtx.idx + 1 });
      });
    }
    document.getElementById("iv-report").hidden = true;
  }

  function ivFocusQuestion(qid) {
    setView("practice");
    setSubview("interview");
    ["iv-track", "iv-level", "iv-format"].forEach(function (id) {
      var el2 = document.getElementById(id);
      if (el2) { el2.value = ""; }
    });
    ivRenderList();
    ivShow(qid);
    setTimeout(function () {
      var card = document.getElementById("iv-card");
      if (card) { card.scrollIntoView({ behavior: "smooth", block: "start" }); }
    }, 60);
  }

  function ivStartMock() {
    var track = document.getElementById("iv-track").value;
    var level = document.getElementById("iv-level").value;
    var pool = ivQuestionsFor(track, level, "");
    if (pool.length < 4) { pool = ivQuestionsFor(track, "", ""); }
    var shuffled = shuffle(pool);
    var n = Math.min(8, shuffled.length);
    ivQueue = shuffled.slice(0, n).map(function (q) { return q.id; });
    ivIdx = 0;
    document.getElementById("iv-list").parentNode.querySelector(".ivlist").style.display = "none";
    ivEndsAt = Date.now() + 25 * 60000;
    var timerEl = document.getElementById("iv-timer");
    timerEl.hidden = false;
    clearInterval(ivTimerId);
    ivTimerId = setInterval(ivTickTimer, 1000);
    ivTickTimer();
    ivShow(ivQueue[0], { list: ivQueue, idx: 0 });
  }
  function ivTickTimer() {
    var el = document.getElementById("iv-timer");
    var left = Math.max(0, ivEndsAt - Date.now());
    var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    el.textContent = "budget " + m + ":" + (s < 10 ? "0" : "") + s;
    el.classList.toggle("low", left < 120000);
    if (left <= 0) { clearInterval(ivTimerId); el.textContent = "time's up \u2014 finish when ready"; }
  }
  function ivFinishMock(list) {
    clearInterval(ivTimerId);
    document.getElementById("iv-timer").hidden = true;
    document.getElementById("iv-list").parentNode.querySelector(".ivlist").style.display = "";
    var cov = ivRenderCoverage(list);
    var report = document.getElementById("iv-report");
    var weak = LENSES.filter(function (L) {
      var t = cov.total[L.k] || 0, h = cov.hit[L.k] || 0;
      return t >= 2 && (h / t) < 0.6;
    });
    report.innerHTML = "<h3>Mock round finished \u2014 " + list.length + " questions</h3>" +
      '<div class="ivcov" id="iv-report-cov"></div>' +
      (weak.length
        ? '<p class="weak">Lightest coverage: ' + weak.map(function (L) { return L.label; }).join(", ") +
          ". That's usually where a follow-up question in the real interview goes next."
        : '<p class="weak" style="color:var(--ok)">No lens fell below 60% coverage on this round.</p>');
    report.hidden = false;
    ivRenderCoverage(list);
    ivRenderCoverage();
  }

  function initInterview() {
    ivInited = true;
    var tsel = document.getElementById("iv-track"), lsel = document.getElementById("iv-level"), fsel = document.getElementById("iv-format");
    TRACKS.forEach(function (tt) { tsel.appendChild(el("option", null, esc(tt.label))).value = tt.k; });
    LEVELS.forEach(function (ll) { lsel.appendChild(el("option", null, esc(ll.label))).value = ll.k; });
    FORMATS.forEach(function (ff) { fsel.appendChild(el("option", null, esc(ff.label))).value = ff.k; });
    [tsel, lsel, fsel].forEach(function (s) { s.addEventListener("change", ivRenderList); });
    document.getElementById("iv-mock").addEventListener("click", ivStartMock);
    var ids = ivRenderList();
    ivRenderCoverage();
    if (ids.length) { ivShow(ids[0]); }
  }

  /* ================= memory-map lab ================= */
  var LAB_EXAMPLES = [
    'const char msg[] = "brake fault";',
    "char buf[512];",
    'char tag[4] = "abc";',
    "static int counter;",
    "int table[256] = {0};",
    "int table2[256] = {1};",
    'char *p = "hi";',
    "static const uint16_t sine[256] = {0};",
    "void blink(void) { }"
  ];
  var TYPE_SIZE = {
    "char": 1, "signed char": 1, "unsigned char": 1, "int8_t": 1, "uint8_t": 1, "bool": 1,
    "short": 2, "short int": 2, "int16_t": 2, "uint16_t": 2,
    "int": 4, "unsigned": 4, "unsigned int": 4, "int32_t": 4, "uint32_t": 4, "float": 4,
    "long": 4, "long int": 4, "size_t": 4, "ptrdiff_t": 4,
    "double": 8, "int64_t": 8, "uint64_t": 8, "long long": 8
  };
  var labItems = []; /* {name, region, bytes, why} */

  function labParse(src) {
    var line = src.trim().replace(/;\s*$/, "");
    if (!line) { return { error: "type a declaration first" }; }

    /* function definition/declaration: name(...) with no array-bracket before the paren */
    if (/^[\w \*]+\s+\w+\s*\([^)]*\)\s*(\{[\s\S]*\})?$/.test(line) && !/\[.*\(/.test(line)) {
      var fname = line.match(/(\w+)\s*\(/);
      return { item: { name: (fname ? fname[1] : "function") + "()", region: "text", bytes: 0,
        why: "a function goes in .text. This model doesn't estimate code size \u2014 that depends on the compiler and flags." } };
    }

    var isStatic = /^static\s+/.test(line);
    if (isStatic) { line = line.replace(/^static\s+/, ""); }
    var isConst = /^const\s+/.test(line);
    if (isConst) { line = line.replace(/^const\s+/, ""); }

    var eq = line.indexOf("=");
    var left = (eq === -1 ? line : line.slice(0, eq)).trim();
    var right = eq === -1 ? null : line.slice(eq + 1).trim();

    var m = left.match(/^([A-Za-z_][A-Za-z0-9_ ]*?)\s*(\*)?\s*(\w+)\s*(\[\s*(\d*)\s*\])?$/);
    if (!m) { return { error: "couldn't parse that \u2014 try one of the examples above" }; }
    var typeStr = m[1].trim(), isPtr = !!m[2], name = m[3], hasArr = !!m[4], arrLenStr = m[5];
    var typeSize = TYPE_SIZE[typeStr];
    var typeNote = "";
    if (typeSize === undefined) { typeSize = 4; typeNote = " (assumed 4 bytes \u2014 unknown type)"; }

    var extraRodata = null; /* an anonymous string literal, if any */
    var region, bytes, why;

    if (isPtr) {
      bytes = 4;
      var strLit = right && right.match(/^"(.*)"$/);
      if (strLit) {
        extraRodata = { name: '"' + strLit[1] + '" (string literal)', bytes: strLit[1].length + 1,
          why: "string literals always live in .rodata in flash, no matter what kind of pointer or array points at them." };
        region = "data"; why = "the pointer itself is 4 bytes of initialised data \u2014 it holds the address of the literal below, which lives separately in .rodata.";
      } else if (right) {
        region = "data"; why = "an initialised pointer is 4 bytes in .data.";
      } else {
        region = "bss"; why = "an uninitialised pointer is 4 bytes in .bss, holding garbage until something assigns it.";
      }
    } else if (!right) {
      if (isConst) { return { error: "const objects need an initialiser in real C \u2014 add one" }; }
      var n0 = 1;
      if (hasArr) {
        n0 = parseInt(arrLenStr, 10);
        if (!n0) { return { error: "an array with no initialiser needs an explicit size, e.g. [64]" }; }
      }
      bytes = n0 * typeSize; region = "bss";
      why = (hasArr ? "an uninitialised array" : "an uninitialised variable") +
        " \u2192 .bss. Zeroed at startup, costs RAM only, no flash.";
    } else {
      var strM = right.match(/^"(.*)"$/);
      if (strM) {
        var slen = strM[1].length + 1;
        bytes = hasArr && arrLenStr ? parseInt(arrLenStr, 10) : slen;
        if (isConst) { region = "rodata"; why = "const char array initialised from a string literal \u2192 .rodata: flash only, never copied to RAM."; }
        else { region = "data"; why = "a writable char array initialised from a string literal \u2192 .data: costs RAM for the copy plus flash for the initialiser."; }
      } else {
        var braceM = right.match(/^\{([\s\S]*)\}$/);
        var values, allZero;
        if (braceM) {
          values = braceM[1].split(",").map(function (v) { return v.trim(); }).filter(function (v) { return v.length; });
          allZero = values.every(function (v) { return /^0(\.0*)?$/.test(v) || v === ""; }) || values.length === 0;
        } else {
          values = [right];
          allZero = /^0(\.0*)?$/.test(right);
        }
        var count = hasArr ? (arrLenStr ? parseInt(arrLenStr, 10) : values.length) : 1;
        bytes = count * typeSize;
        if (isConst) { region = "rodata"; why = "const \u2192 .rodata regardless of the values: flash only, never copied to RAM."; }
        else if (allZero) { region = "bss"; why = "initialised to all zero \u2192 the compiler puts it in .bss with everything else, since zero costs nothing to store as flash data."; }
        else { region = "data"; why = "a non-zero initialiser on a writable object \u2192 .data: this many bytes in RAM, plus the same again in flash to seed it."; }
      }
    }

    var item = { name: name + typeNote, region: region, bytes: bytes,
      why: (isStatic ? "static (internal linkage only, doesn't change placement) \u2014 " : "") + why };
    return { item: item, extra: extraRodata };
  }

  function labRender() {
    var regions = { text: [], rodata: [], data: [], bss: [] };
    labItems.forEach(function (it) { regions[it.region].push(it); });
    ["text", "rodata", "data", "bss"].forEach(function (r) {
      var host = document.getElementById("lr-" + r);
      host.innerHTML = regions[r].length
        ? regions[r].map(function (it) {
            return '<span class="chip" title="' + esc(it.why) + '">' + esc(it.name) +
              (r === "text" ? "" : " \u00b7 " + it.bytes + "B") + "</span>";
          }).join("")
        : '<span class="empty2">nothing here yet</span>';
      var sz = regions[r].reduce(function (a, it) { return a + it.bytes; }, 0);
      var szEl = document.getElementById("lr-" + r + "-sz");
      if (szEl) { szEl.textContent = sz + " B"; }
    });
    var flash = regions.rodata.reduce(function (a, i) { return a + i.bytes; }, 0) +
                regions.data.reduce(function (a, i) { return a + i.bytes; }, 0);
    var ram = regions.data.reduce(function (a, i) { return a + i.bytes; }, 0) +
              regions.bss.reduce(function (a, i) { return a + i.bytes; }, 0);
    document.getElementById("lab-flash").textContent = flash;
    document.getElementById("lab-ram").textContent = ram;

    var list = document.getElementById("lab-list");
    list.innerHTML = labItems.map(function (it, i) {
      return "<li><span>" + esc(it.name) + " \u2192 ." + (it.region === "text" ? "text" : it.region) +
        (it.region === "text" ? "" : " (" + it.bytes + "B)") +
        '</span><button class="rm" data-i="' + i + '" title="remove">\u2715</button></li>';
    }).join("");
    Array.prototype.forEach.call(list.querySelectorAll(".rm"), function (b) {
      b.addEventListener("click", function () { labItems.splice(+b.dataset.i, 1); labRender(); });
    });
  }

  function initLab() {
    labInited = true;
    var ex = document.getElementById("lab-examples");
    ex.innerHTML = LAB_EXAMPLES.map(function (s) { return "<button type=\"button\">" + esc(s) + "</button>"; }).join("");
    Array.prototype.forEach.call(ex.querySelectorAll("button"), function (b, i) {
      b.addEventListener("click", function () { document.getElementById("lab-src").value = LAB_EXAMPLES[i]; });
    });
    var src = document.getElementById("lab-src"), err = document.getElementById("lab-err");
    function add() {
      var res = labParse(src.value);
      if (res.error) { err.textContent = res.error; return; }
      err.textContent = "";
      labItems.push(res.item);
      if (res.extra) { labItems.push(res.extra); }
      src.value = "";
      labRender();
    }
    document.getElementById("lab-add").addEventListener("click", add);
    src.addEventListener("keydown", function (e) { if (e.key === "Enter") { add(); } });
    document.getElementById("lab-reset").addEventListener("click", function () { labItems = []; labRender(); });
    labRender();
  }

  /* ================= fault triage ================= */
  var faultOrder = [], faultPos = 0, faultScore = 0, faultAttempted = 0;

  function shuffleFaults() {
    faultOrder = shuffle(FAULTS.map(function (f) { return f.id; }));
    faultPos = 0; faultScore = 0; faultAttempted = 0;
    document.getElementById("ft-score").textContent = "0";
    document.getElementById("ft-attempted").textContent = "0";
  }

  function faultShow() {
    var f = FAULTS.filter(function (x) { return x.id === faultOrder[faultPos]; })[0];
    document.getElementById("ft-pos").textContent = (faultPos + 1) + " / " + faultOrder.length;
    var card = document.getElementById("ft-card");
    var order = f.options.map(function (o, i) { return i; });
    card.innerHTML =
      "<h3>" + esc(f.title) + "</h3>" +
      '<p class="ctx">' + esc(f.context) + "</p>" +
      '<div class="regdump">' + Object.keys(f.regs).map(function (k) {
        return '<div class="r"><span class="k">' + esc(k) + '</span><span class="v">' + esc(f.regs[k]) + "</span></div>";
      }).join("") + "</div>" +
      '<ul class="decode">' + f.decode.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul>" +
      '<div class="faultopts">' + order.map(function (i) {
        return '<button type="button" data-i="' + i + '">' + esc(f.options[i]) + "</button>";
      }).join("") + "</div>" +
      '<div class="faultexplain" id="ft-explain">' + esc(f.explain) + "</div>";

    Array.prototype.forEach.call(card.querySelectorAll(".faultopts button"), function (b) {
      b.addEventListener("click", function () {
        var i = +b.dataset.i;
        Array.prototype.forEach.call(card.querySelectorAll(".faultopts button"), function (o) { o.disabled = true; });
        faultAttempted++;
        var wasCorrect = i === f.answerIdx;
        if (wasCorrect) { b.classList.add("correct"); faultScore++; }
        else {
          b.classList.add("wrong");
          card.querySelector('.faultopts button[data-i="' + f.answerIdx + '"]').classList.add("correct");
        }
        faultState.seen[f.id] = faultState.seen[f.id] || wasCorrect;
        wr(K_FAULT, faultState);
        document.getElementById("ft-score").textContent = String(faultScore);
        document.getElementById("ft-attempted").textContent = String(faultAttempted);
        document.getElementById("ft-explain").classList.add("on");
      });
    });
  }

  function initFaults() {
    faultsInited = true;
    shuffleFaults();
    faultShow();
    document.getElementById("ft-next").addEventListener("click", function () {
      faultPos = (faultPos + 1) % faultOrder.length;
      faultShow();
    });
    document.getElementById("ft-restart").addEventListener("click", function () {
      shuffleFaults();
      faultShow();
    });
  }

  /* Concept graph rendering lives in 40_graph.js. */

  /* ================= playground: bit lab ================= */
  var BL_TYPES = [
    { k: "int8_t", bits: 8, signed: true }, { k: "uint8_t", bits: 8, signed: false },
    { k: "int16_t", bits: 16, signed: true }, { k: "uint16_t", bits: 16, signed: false },
    { k: "int32_t", bits: 32, signed: true }, { k: "uint32_t", bits: 32, signed: false }
  ];
  function blArrFor(type) {
    var m = { int8_t: Int8Array, uint8_t: Uint8Array, int16_t: Int16Array, uint16_t: Uint16Array,
      int32_t: Int32Array, uint32_t: Uint32Array };
    return new (m[type])(1);
  }
  function blStore(type, value) { var a = blArrFor(type); a[0] = value; return a[0]; }
  function toBin(v, bits) {
    var u = v < 0 ? v >>> 0 : v;
    var s = (u >>> 0).toString(2);
    while (s.length < bits) { s = "0" + s; }
    return s.length > bits ? s.slice(s.length - bits) : s;
  }
  function toHexW(v, bits) {
    var u = v < 0 ? v >>> 0 : v;
    var digits = Math.ceil(bits / 4);
    var s = (u >>> 0).toString(16).toUpperCase();
    while (s.length < digits) { s = "0" + s; }
    return "0x" + s.slice(-digits);
  }

  function initBitLab() {
    var atSel = document.getElementById("bl-a-type"), btSel = document.getElementById("bl-b-type"), ot = document.getElementById("bl-out-type");
    [atSel, btSel, ot].forEach(function (sel) {
      BL_TYPES.forEach(function (T) { sel.appendChild(el("option", null, T.k)).value = T.k; });
    });
    atSel.value = "uint8_t"; btSel.value = "uint8_t"; ot.value = "uint8_t";
    document.getElementById("bl-run").addEventListener("click", blRun);
    blRun();

    document.getElementById("tc-set").addEventListener("click", tcSet);
    tcSet();

    document.getElementById("sh-run").addEventListener("click", shRun);
    shRun();

    document.getElementById("en-run").addEventListener("click", enRun);
    enRun();

    stMembers = [{ name: "type", type: "uint8_t", n: 1 }, { name: "id", type: "uint32_t", n: 1 }, { name: "flags", type: "uint8_t", n: 1 }];
    stRenderMembers();
    document.getElementById("st-add").addEventListener("click", function () {
      stMembers.push({ name: "field" + (stMembers.length + 1), type: "int", n: 1 });
      stRenderMembers();
    });

    document.getElementById("rg-preset").addEventListener("change", function () {
      document.getElementById("rg-custom").hidden = this.value !== "custom";
      if (this.value === "custom" && !rgCustomBits.length) { rgAddCustomBit(); }
    });
    document.getElementById("rg-custom-add").addEventListener("click", rgAddCustomBit);
    document.getElementById("rg-run").addEventListener("click", rgRun);
    rgRun();
  }

  function blRun() {
    var aT = document.getElementById("bl-a-type").value, bT = document.getElementById("bl-b-type").value;
    var oT = document.getElementById("bl-out-type").value, op = document.getElementById("bl-op").value;
    var aRaw = parseInt(document.getElementById("bl-a-val").value, 0) || 0;
    var bRaw = parseInt(document.getElementById("bl-b-val").value, 0) || 0;
    var a = blStore(aT, aRaw), b = blStore(bT, bRaw);
    var raw; /* real C: narrower-than-int operands promote to a plain JS number (int32) first */
    switch (op) {
      case "+": raw = a + b; break; case "-": raw = a - b; break; case "*": raw = a * b; break;
      case "<<": raw = a << b; break; case ">>": raw = a >> b; break;
      case "&": raw = a & b; break; case "|": raw = a | b; break; case "^": raw = a ^ b; break;
      default: raw = 0;
    }
    var stored = blStore(oT, raw);
    var oBits = BL_TYPES.filter(function (T) { return T.k === oT; })[0].bits;
    var host = document.getElementById("bl-result");
    host.innerHTML =
      "operand A (" + aT + ") stored as: " + a + "\n" +
      "operand B (" + bT + ") stored as: " + b + "\n" +
      "promoted to int, " + aT + " " + op + " " + bT + " = <span class=\"hi\">" + raw + "</span>  (computed the way C's usual arithmetic conversions actually work: narrower-than-int operands promote to int first)\n" +
      "stored back into " + oT + " (" + oBits + "-bit) = <span class=\"hi\">" + stored + "</span>\n" +
      "  binary " + toBin(stored, oBits) + "   hex " + toHexW(stored, oBits) +
      (stored !== raw ? "\n\n truncation happened: the promoted result " + raw + " did not fit in " + oT + ", so only the low " + oBits + " bits survived." : "");
  }

  var tcWidth = 16, tcBits = [];
  function tcSet() {
    tcWidth = +document.getElementById("tc-width").value;
    var v = parseInt(document.getElementById("tc-val").value, 0) || 0;
    var type = { 8: "int8_t", 16: "int16_t", 32: "int32_t" }[tcWidth];
    var stored = blStore(type, v);
    var bin = toBin(stored, tcWidth);
    tcBits = bin.split("").map(function (c) { return c === "1" ? 1 : 0; });
    tcRenderBits();
  }
  function tcRenderBits() {
    var host = document.getElementById("tc-bits");
    host.innerHTML = tcBits.map(function (b, i) {
      var bitPos = tcBits.length - 1 - i;
      return '<div class="bitbox' + (b ? " one" : "") + '" data-i="' + i + '">' + b + '<span class="bl">' + bitPos + "</span></div>";
    }).join("");
    Array.prototype.forEach.call(host.querySelectorAll(".bitbox"), function (box) {
      box.addEventListener("click", function () {
        var i = +box.dataset.i; tcBits[i] = tcBits[i] ? 0 : 1; tcRenderBits(); tcUpdateOut();
      });
    });
    tcUpdateOut();
  }
  function tcUpdateOut() {
    var bin = tcBits.join("");
    var uType = { 8: "uint8_t", 16: "uint16_t", 32: "uint32_t" }[tcWidth];
    var sType = { 8: "int8_t", 16: "int16_t", 32: "int32_t" }[tcWidth];
    var uVal = parseInt(bin, 2);
    var sVal = blStore(sType, uVal);
    document.getElementById("tc-out").innerHTML =
      "as " + uType + " (unsigned): <span class=\"hi\">" + uVal + "</span>\n" +
      "as " + sType + " (signed):   <span class=\"hi\">" + sVal + "</span>\n" +
      "hex: " + toHexW(uVal, tcWidth) +
      (sVal < 0 ? "\n\nthe top bit is set, so as a signed type this reads as negative -- same bits, different meaning." : "");
  }

  function shRun() {
    var width = +document.getElementById("sh-width").value;
    var signed = document.getElementById("sh-signed").value === "1";
    var dir = document.getElementById("sh-dir").value;
    var amt = parseInt(document.getElementById("sh-amt").value, 0) || 0;
    var type = { 8: signed ? "int8_t" : "uint8_t", 16: signed ? "int16_t" : "uint16_t", 32: signed ? "int32_t" : "uint32_t" }[width];
    var v = blStore(type, parseInt(document.getElementById("sh-val").value, 0) || 0);
    var before = toBin(v, width);
    var result, note;
    if (dir === "l") {
      result = blStore(type, v << amt);
      note = "left shift fills with zero from the right, and any bit pushed past the top is simply gone.";
    } else if (signed) {
      result = v >> amt; /* JS >> on a negative number is already arithmetic (sign-extending) */
      result = blStore(type, result);
      note = "this is an arithmetic shift: the sign bit is copied in from the left, which is what every real compiler does for a signed right shift, even though the standard only calls it implementation-defined.";
    } else {
      var uType = { 8: "uint8_t", 16: "uint16_t", 32: "uint32_t" }[width];
      var uv = blStore(uType, v);
      result = blStore(type, uv >>> amt);
      note = "this is a logical shift: zeros fill in from the left, because the value is unsigned -- there is no sign bit to preserve.";
    }
    document.getElementById("sh-out").innerHTML =
      "before: " + before + "  (" + v + ")\n" +
      "after:  " + toBin(result, width) + "  (<span class=\"hi\">" + result + "</span>)\n\n" + note;
  }

  function enRun() {
    var raw = document.getElementById("en-val").value.trim();
    var v = parseInt(raw, 16) >>> 0;
    var buf = new ArrayBuffer(4), dv = new DataView(buf);
    dv.setUint32(0, v, true); /* write little-endian */
    var leBytes = [dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)];
    dv.setUint32(0, v, false); /* write big-endian */
    var beBytes = [dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)];
    function row(label, bytes) {
      return '<div style="margin-bottom:10px"><div class="pgrow" style="margin-bottom:4px">' +
        bytes.map(function (b, i) {
          return '<span class="bytebox"><span class="val">' + toHexW(b, 8).slice(2) + '</span>' +
                 '<span class="addr">+' + i + "</span></span>";
        }).join("") + "</div><span style=\"font-family:var(--mono);font-size:12px;color:var(--ink-3)\">" + esc(label) + "</span></div>";
    }
    document.getElementById("en-out").innerHTML =
      row("little-endian (Cortex-M default) -- least significant byte at the lowest address", leBytes) +
      row("big-endian (common on the wire for network and many automotive buses)", beBytes);
  }

  var stMembers = [];
  function stRenderMembers() {
    var host = document.getElementById("st-members");
    var types = Object.keys(TYPE_SIZE);
    host.innerHTML = stMembers.map(function (m, i) {
      return '<div class="memberrow" data-i="' + i + '">' +
        '<input type="text" class="m-name" value="' + esc(m.name) + '">' +
        '<select class="m-type">' + types.map(function (ty) {
          return '<option value="' + ty + '"' + (ty === m.type ? " selected" : "") + ">" + ty + "</option>";
        }).join("") + "</select>" +
        '<input type="number" class="m-n" min="1" value="' + m.n + '" title="array count">' +
        '<button class="pgsmallbtn" type="button" data-rm="' + i + '">remove</button></div>';
    }).join("");
    Array.prototype.forEach.call(host.querySelectorAll(".memberrow"), function (row) {
      var i = +row.dataset.i;
      row.querySelector(".m-name").addEventListener("input", function () { stMembers[i].name = this.value; stRenderLayout(); });
      row.querySelector(".m-type").addEventListener("change", function () { stMembers[i].type = this.value; stRenderLayout(); });
      row.querySelector(".m-n").addEventListener("input", function () { stMembers[i].n = Math.max(1, +this.value || 1); stRenderLayout(); });
      row.querySelector("[data-rm]").addEventListener("click", function () { stMembers.splice(i, 1); stRenderMembers(); });
    });
    stRenderLayout();
  }
  function stComputeLayout() {
    var offset = 0, maxAlign = 1, rows = [];
    stMembers.forEach(function (m) {
      var size = (TYPE_SIZE[m.type] || 4) * m.n;
      var align = Math.min(TYPE_SIZE[m.type] || 4, 8);
      maxAlign = Math.max(maxAlign, align);
      var pad = (align - (offset % align)) % align;
      if (pad) { rows.push({ pad: true, size: pad, at: offset }); offset += pad; }
      rows.push({ pad: false, name: m.name, type: m.type, n: m.n, size: size, at: offset });
      offset += size;
    });
    var endPad = (maxAlign - (offset % maxAlign)) % maxAlign;
    if (endPad) { rows.push({ pad: true, size: endPad, at: offset, tail: true }); offset += endPad; }
    return { rows: rows, total: offset, align: maxAlign };
  }
  function stRenderLayout() {
    var L = stComputeLayout();
    var maxW = 420;
    var strip = L.rows.map(function (r) {
      var w = Math.max(18, (r.size / L.total) * maxW);
      var bg = r.pad ? "" : STAGE_HUES[(r.at * 7) % STAGE_HUES.length];
      return '<div class="seg' + (r.pad ? " pad" : "") + '" style="width:' + w.toFixed(0) + "px" +
        (r.pad ? "" : ";background:" + bg) + '" title="' + (r.pad ? "padding" : r.name) + '">' +
        (r.pad ? "pad" : esc(r.name)) + "</div>";
    }).join("");
    var rowsText = L.rows.map(function (r) {
      return r.pad ? "  +" + r.at + "  [" + r.size + " byte" + (r.size === 1 ? "" : "s") + " padding]"
        : "  +" + r.at + "  " + r.name + "  (" + r.type + (r.n > 1 ? "[" + r.n + "]" : "") + ", " + r.size + " byte" + (r.size === 1 ? "" : "s") + ")";
    }).join("\n");
    document.getElementById("st-out").innerHTML =
      '<div class="structbar">' + strip + "</div>" +
      '<div class="pgout" style="margin-top:10px">' + esc(rowsText) +
      "\n\n  total size: " + L.total + " bytes, struct alignment: " + L.align + " bytes</div>";
  }

  var CFSR_BITS = [
    { bit: 0, label: "IACCVIOL", note: "MemManage: instruction access violation" },
    { bit: 1, label: "DACCVIOL", note: "MemManage: data access violation" },
    { bit: 3, label: "MUNSTKERR", note: "MemManage: fault unstacking an exception return" },
    { bit: 4, label: "MSTKERR", note: "MemManage: fault stacking for an exception entry -- classic stack overflow signature" },
    { bit: 5, label: "MLSPERR", note: "MemManage: fault during lazy FPU state preservation" },
    { bit: 7, label: "MMARVALID", note: "the MMFAR address register holds a valid faulting address" },
    { bit: 8, label: "IBUSERR", note: "BusFault: instruction bus error" },
    { bit: 9, label: "PRECISERR", note: "BusFault: precise data bus error -- BFAR holds the exact address" },
    { bit: 10, label: "IMPRECISERR", note: "BusFault: imprecise data bus error -- the faulting instruction can't be identified exactly" },
    { bit: 11, label: "UNSTKERR", note: "BusFault: fault unstacking an exception return" },
    { bit: 12, label: "STKERR", note: "BusFault: fault stacking for exception entry" },
    { bit: 13, label: "LSPERR", note: "BusFault: fault during lazy FPU state preservation" },
    { bit: 15, label: "BFARVALID", note: "the BFAR address register holds a valid faulting address" },
    { bit: 16, label: "UNDEFINSTR", note: "UsageFault: undefined instruction" },
    { bit: 17, label: "INVSTATE", note: "UsageFault: invalid EPSR state -- often a stale/incorrect Thumb-bit jump" },
    { bit: 18, label: "INVPC", note: "UsageFault: invalid PC load, e.g. from a bad exception return" },
    { bit: 19, label: "NOCPACCESS", note: "UsageFault: coprocessor (often the FPU) access disabled or absent" },
    { bit: 24, label: "UNALIGNED", note: "UsageFault: unaligned access trap (only if enabled)" },
    { bit: 25, label: "DIVBYZERO", note: "UsageFault: integer divide by zero (only if enabled)" }
  ];
  var rgCustomBits = [];
  function rgAddCustomBit() {
    rgCustomBits.push({ bit: rgCustomBits.length, label: "" });
    rgRenderCustom();
  }
  function rgRenderCustom() {
    var host = document.getElementById("rg-custom-list");
    host.innerHTML = rgCustomBits.map(function (b, i) {
      return '<div class="memberrow" data-i="' + i + '">' +
        '<input type="number" class="c-bit" min="0" max="31" value="' + b.bit + '" style="width:56px">' +
        '<input type="text" class="c-label" placeholder="bit name" value="' + esc(b.label) + '"></div>';
    }).join("");
    Array.prototype.forEach.call(host.querySelectorAll(".memberrow"), function (row) {
      var i = +row.dataset.i;
      row.querySelector(".c-bit").addEventListener("input", function () { rgCustomBits[i].bit = +this.value || 0; });
      row.querySelector(".c-label").addEventListener("input", function () { rgCustomBits[i].label = this.value; });
    });
  }
  function rgRun() {
    var preset = document.getElementById("rg-preset").value;
    var v = parseInt(document.getElementById("rg-val").value, 16) >>> 0;
    var table = preset === "cfsr" ? CFSR_BITS : rgCustomBits.map(function (b) { return { bit: b.bit, label: b.label || "(unnamed)", note: "" }; });
    var lines = table.filter(function (b) { return v & (1 << b.bit); })
      .map(function (b) { return "bit " + b.bit + "  " + b.label + (b.note ? "  -- " + b.note : ""); });
    document.getElementById("rg-out").innerHTML =
      toHexW(v, 32) + " = " + toBin(v, 32) + "\n\n" +
      (lines.length ? lines.join("\n") : "no bits from this table are set in that value.");
  }

  /* ================= playground: compiler diffs ================= */
  function initDiffs() {
    var host = document.getElementById("diffs-list");
    var state = {};
    host.innerHTML = DIFFS.map(function (d) {
      state[d.id] = 0;
      var topicRef = byId[d.topic];
      return '<div class="diffcard" data-id="' + d.id + '">' +
        '<div class="difftitle"><h4>' + esc(d.title) + "</h4>" +
        (topicRef ? '<button type="button" class="ivtopicref" data-topic="' + esc(d.topic) + '">from ' + esc(topicRef.code) + " " + esc(topicRef.t) + "</button>" : "") +
        "</div>" +
        '<div class="difftoggle">' +
          '<button type="button" data-s="0" aria-pressed="true">' + esc(d.toggleLabel[0]) + "</button>" +
          '<button type="button" data-s="1" aria-pressed="false">' + esc(d.toggleLabel[1]) + "</button>" +
        "</div>" +
        '<div class="diffgrid" style="margin-top:12px">' +
          '<div><div class="lbl">source</div><pre class="src diff-code">' + hl(d.code[0]) + "</pre></div>" +
          '<div><div class="lbl">what actually happens</div><div class="pgout diff-result">' + esc(d.result[0]) + "</div></div>" +
        "</div>" +
        '<p class="diffwhy">' + esc(d.why[0]) + "</p>" +
      "</div>";
    }).join("");

    Array.prototype.forEach.call(host.querySelectorAll(".diffcard"), function (card) {
      var d = DIFFS.filter(function (x) { return x.id === card.dataset.id; })[0];
      Array.prototype.forEach.call(card.querySelectorAll(".difftoggle button"), function (btn) {
        btn.addEventListener("click", function () {
          var s = +btn.dataset.s;
          Array.prototype.forEach.call(card.querySelectorAll(".difftoggle button"), function (b2) {
            b2.setAttribute("aria-pressed", String(b2 === btn));
          });
          card.querySelector(".diff-code").innerHTML = hl(d.code[s]);
          card.querySelector(".diff-result").textContent = d.result[s];
          card.querySelector(".diffwhy").textContent = d.why[s];
        });
      });
      var tref = card.querySelector(".ivtopicref");
      if (tref) { tref.addEventListener("click", function () { goTopic(tref.dataset.topic); }); }
    });
  }

  /* ---------------- theme ---------------- */
  function initTheme() {
    var t = null;
    try { t = localStorage.getItem(K_THEME); } catch (e) { /* ignore */ }
    if (t) { document.documentElement.setAttribute("data-theme", t); }
    document.getElementById("themebtn").addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("data-theme");
      var isDark = cur ? cur === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      var next = isDark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem(K_THEME, next); } catch (e) { storageFailed(); }
    });
  }

  /* ---------------- boot ---------------- */
  /* Wire primary navigation before any data/render work.  That way a later
     feature error cannot leave the top-level view buttons inert. */
  Array.prototype.forEach.call(document.querySelectorAll(".viewsw button[data-v]"), function (b) {
    b.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      setView(b.dataset.v);
      /* setView("practice") enters whatever track was current last; a rail button
         names the track it is for, so that one wins. */
      if (b.dataset.sv) { setSubview(b.dataset.sv); }
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-hero-view]"), function (b) {
    b.addEventListener("click", function () {
      if (b.dataset.heroView === "protocols") { setView("protocols"); }
    });
  });
  var signalModel = document.getElementById("signal-model");
  var signalToggle = document.getElementById("signal-toggle");
  if (signalModel && signalToggle) {
    signalToggle.addEventListener("click", function () {
      var high = signalModel.dataset.level !== "high";
      signalModel.dataset.level = high ? "high" : "low";
      signalToggle.setAttribute("aria-pressed", String(high));
      signalToggle.textContent = high ? "Release button" : "Press button";
      document.getElementById("signal-status").textContent = high
        ? "HIGH · IDR[0] = 1 · LED on" : "LOW · IDR[0] = 0 · LED off";
      document.getElementById("signal-voltage").textContent = high ? "3.3 V" : "0 V";
      document.getElementById("signal-idr").textContent = "bit 0  =  " + (high ? "1" : "0");
      document.getElementById("signal-output").textContent = high ? "HIGH" : "LOW";
      document.getElementById("signal-explanation").textContent = high
        ? "Pressed switch connects PA0 to 3.3 V. IDR bit 0 reads 1, so the C decision sets ODR bit 5 and lights the LED."
        : "Open switch: the pull-down holds PA0 at 0 V. The C decision reads IDR bit 0 and leaves ODR bit 5 clear.";
      signalModel.classList.remove("is-changing");
      requestAnimationFrame(function () { signalModel.classList.add("is-changing"); });
      window.setTimeout(function () { signalModel.classList.remove("is-changing"); }, 720);
    });
  }

  loadAll();
  initDataTools();
  buildMap();
  buildLegend();
  buildStages();
  progress();
  spyNav();
  initTheme();

  document.getElementById("q").addEventListener("input", function (e) { filter(e.target.value); });
  document.getElementById("expandall").addEventListener("click", function () {
    openAll(document.querySelector(".topic.open") === null);
  });
  Array.prototype.forEach.call(document.querySelectorAll("#pv-subnav button"), function (b) {
    b.addEventListener("click", function () { setSubview(b.dataset.sv); });
  });
  Array.prototype.forEach.call(document.querySelectorAll("#pg-subnav button"), function (b) {
    b.addEventListener("click", function () { setPgSubview(b.dataset.sv); });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-goto]"), function (b) {
    b.addEventListener("click", function () { setView("practice"); setSubview(b.dataset.goto); });
  });
  document.getElementById("d-copynotes").addEventListener("click", function () {
    copy(notesMarkdown(), this);
  });
  document.getElementById("d-copyprog").addEventListener("click", function () {
    /* Same envelope as Export data, so a paste into a .json file imports straight back. */
    copy(JSON.stringify(snapshotAll(), null, 2), this);
  });
  setView("roadmap");

  if (location.hash) {
    var n = document.querySelector(location.hash);
    if (n && n.classList.contains("topic")) { n.classList.add("open"); }
  }

