<script>
(function () {
  "use strict";

  var K_DONE = "ecroadmap.v1", K_NOTE = "ecroadmap.notes.v1",
      K_MARK = "ecroadmap.marks.v1", K_THEME = "ecroadmap.theme",
      K_IV = "ecroadmap.interview.v1", K_FAULT = "ecroadmap.faults.v1",
      K_WALK = "ecroadmap.walk.v1";   /* which stages of the two reading labs you opened */
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
  function wr(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } }
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
  function hl(code) {
    var s = esc(code);
    s = s.replace(/(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*)/g, '<span class="c">$1</span>');
    s = s.replace(/(^|[^\w$])(const|static|volatile|inline|struct|union|enum|typedef|void|return|if|else|for|while|switch|case|break|default|extern|sizeof|restrict|unsigned|signed|char|int|float|double|bool|size_t)(?=[^\w$])/g,
      '$1<span class="k">$2</span>');
    s = s.replace(/(0x[0-9A-Fa-f]+u?|\b\d+u?\b)/g, '<span class="n">$1</span>');
    return s;
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

  /* ---------------- global data backup ----------------
     The roadmap state is held in memory (done / notes / marks / ...) so it is copied
     out of the variables. The labs hold theirs only in localStorage and read it when
     they are first opened, so they are copied out of the keys. Schema 2 adds them;
     schema 1 files simply have no "labs" section and restore the roadmap only. */
  var DATA_SCHEMA = 2;
  /* Each key is declared with var inside its own lab module further down this file,
     so the list is built when called, not when this line runs. */
  function labKeys() { return [K_BENCH, K_LKSAND, K_PERIPH, K_PROTOS, K_WALK]; }
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
  function setDataButtonState(id, text) {
    var b = document.getElementById(id);
    if (!b) { return; }
    var old = b.textContent; b.textContent = text;
    setTimeout(function () { if (b) { b.textContent = old; } }, 1600);
  }
  function downloadBackup() {
    var blob = new Blob([JSON.stringify(snapshotAll(), null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    var stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url; a.download = "embedded-c-roadmap-backup-" + stamp + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setDataButtonState("exportdata", "Exported");
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
       write stale state straight over this import within one tick interval. So a
       backup that carries lab state reloads instead of refreshing in place. */
    var labsTouched = false;
    if (payload.labs && typeof payload.labs === "object") {
      /* Only keys this build knows about: a file must not be able to write arbitrary
         localStorage entries through the import path. */
      labKeys().forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(payload.labs, k)) { wr(k, payload.labs[k]); labsTouched = true; }
      });
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
    if (labsTouched) {
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
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
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

  function buildNotes(t, wrap, onMarkLearned) {
    var box = el("div", "notes");
    var view = el("div");
    var editing = false, timer = null;

    function render() {
      var txt = notes[t.id] || "";
      wrap.dataset.note = txt.trim() ? "1" : "0";
      if (editing) { return; }
      view.innerHTML = txt.trim()
        ? '<div class="md">' + md(txt) + "</div>"
        : '<p class="notes-empty">Nothing yet. Write what you had to look up, the thing that finally made it click, or the bug this explains.</p>';
    }

    var head = el("h4", null, "<span>your notes &#183; markdown</span><span class=\"saved\">saved</span>");
    var gateMsg = el("p", "gate-msg",
      "Write a couple of sentences in your own words \u2014 that's what marks this learned.");
    var btns = el("div", "nbtns");
    var edit = el("button", null, "Write");
    edit.type = "button";
    var markBtn = el("button", "mark-learned", "Mark as learned");
    markBtn.type = "button";
    btns.appendChild(edit);
    btns.appendChild(markBtn);

    function syncMarkBtn() {
      var ok = noteLen(t.id) >= GATE_MIN;
      markBtn.classList.toggle("show", editing && ok && !isDone(t.id));
    }

    edit.addEventListener("click", function () {
      if (editing) {
        editing = false;
        edit.textContent = notes[t.id] ? "Edit" : "Write";
        box.classList.remove("gate", "pulse");
        gateMsg.classList.remove("on");
        render(); syncMarkBtn();
        return;
      }
      editing = true;
      edit.textContent = "Done";
      var ta = el("textarea");
      ta.value = notes[t.id] || "";
      ta.placeholder = "# what clicked\n\n- `volatile` only stops the compiler, not the bus\n- check the map file before blaming the code";
      view.innerHTML = "";
      view.appendChild(ta);
      ta.focus();
      syncMarkBtn();
      ta.addEventListener("input", function () {
        notes[t.id] = ta.value;
        if (!ta.value.trim()) { delete notes[t.id]; }
        wrap.dataset.note = ta.value.trim() ? "1" : "0";
        syncMarkBtn();
        clearTimeout(timer);
        timer = setTimeout(function () {
          wr(K_NOTE, notes);
          var s = head.querySelector(".saved");
          s.classList.add("on");
          setTimeout(function () { s.classList.remove("on"); }, 900);
          refreshDash();
        }, 400);
      });
    });

    markBtn.addEventListener("click", function () {
      wr(K_NOTE, notes);
      editing = false;
      edit.textContent = "Edit";
      box.classList.remove("gate", "pulse");
      gateMsg.classList.remove("on");
      render();
      onMarkLearned();
    });

    box.appendChild(head);
    box.appendChild(gateMsg);
    box.appendChild(view);
    box.appendChild(btns);
    edit.textContent = notes[t.id] ? "Edit" : "Write";
    render();

    box._openForGate = function () {
      box.classList.add("gate", "pulse");
      gateMsg.classList.add("on");
      setTimeout(function () { box.classList.remove("pulse"); }, 2400);
      if (!editing) { edit.click(); }
      box.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    return box;
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
    document.getElementById("revline").textContent = "rev 1.2 \u00b7 " + d + " / " + n + " topics";
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
      "goals verified" + (pf.stage ? ' \u00b7 at <b>' + esc((pfStageById(pf.stage) || {}).name || "") + '</b>' : ''));
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
    document.getElementById("d-writing").innerHTML =
      nNotes + " topics with notes, " + words + " words written.<br>" + nMarks + " bookmarked.";

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
    oh.innerHTML = nlist.length
      ? nlist.map(function (t) {
          var pv = notes[t.id].replace(/[#*`>\-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
          return linkItem(t, '<span class="pv">' + esc(pv) + "</span>");
        }).join("")
      : '<li><p class="blank">No notes yet. Open any topic and press Write.</p></li>';
    wireGo(oh);

    var answered = Object.keys(ivState.answers).length;
    var solved = Object.keys(faultState.seen).filter(function (k) { return faultState.seen[k]; }).length;
    document.getElementById("d-practice").innerHTML =
      answered + " interview question" + (answered === 1 ? "" : "s") + " self-graded.<br>" +
      solved + " / " + FAULTS.length + " fault scenarios solved.";
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
    var shuffled = pool.slice().sort(function () { return Math.random() - 0.5; });
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
    faultOrder = FAULTS.map(function (f) { return f.id; }).sort(function () { return Math.random() - 0.5; });
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
      try { localStorage.setItem(K_THEME, next); } catch (e) { /* ignore */ }
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
bx      lr</pre><p>The exact instructions depend on compiler version, options, ABI and optimization level. The teaching point is the change of representation.</p></div></div><div class="complab-check"><div class="complab-check-head">What changed?</div><div class="complab-check-body"><div class="complab-choices" data-cq="compile"><button type="button" data-a="a">C syntax → target instructions</button><button type="button" data-a="b">RAM addresses → C variables</button><button type="button" data-a="c">ELF → preprocessor text</button></div><div class="complab-answer" data-ca="compile" hidden>Correct. The compiler lowers the C program into instructions and target-specific low-level constructs; final placement still belongs to the linker.</div></div></div><div class="complab-note"><strong>Important distinction:</strong> optimization can change the instruction sequence dramatically while preserving the required program behavior. Therefore “one C statement = one instruction” is not a valid model.</div>`
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
      body: `<div class="complab-grid"><div class="complab-card"><h4>Question 1</h4><p><code>#define LIMIT 10</code> is expanded before compilation. Which stage owns that transformation?</p><div class="complab-choices" data-cq="q1"><button type="button" data-a="a">Preprocessor</button><button type="button" data-a="b">Linker</button><button type="button" data-a="c">objcopy</button></div><div class="complab-answer" data-ca="q1" hidden>Correct. The preprocessor expands the macro before the C compiler analyzes the resulting source.</div></div><div class="complab-card"><h4>Question 2</h4><p><code>counter = 3</code> needs a runtime RAM address. Which stage applies the linker script's <code>.data &gt; RAM AT &gt; FLASH</code> policy?</p><div class="complab-choices" data-cq="q2"><button type="button" data-a="a">Compiler</button><button type="button" data-a="b">Linker</button><button type="button" data-a="c">Assembler</button></div><div class="complab-answer" data-ca="q2" hidden>Correct. The linker combines the object files and applies the output-section placement rules.</div></div></div><div class="complab-check"><div class="complab-check-head">Teach it back</div><div class="complab-check-body"><p>Put these in causal order:</p><div class="complab-choices" id="complab-order"><button type="button" data-order="1">C source</button><button type="button" data-order="4">object file</button><button type="button" data-order="2">preprocessed source</button><button type="button" data-order="6">ELF</button><button type="button" data-order="3">assembly</button><button type="button" data-order="5">linked image</button></div><div class="complab-answer" id="complab-order-result" hidden>Correct: C source → preprocessed source → assembly → object file → linked image → ELF.</div></div></div><div class="complab-note"><strong>Final mental model:</strong> each stage consumes one representation and produces another. The important question is always: <em>what information is decided here, and what information is intentionally left for the next stage?</em></div>`
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
    Array.prototype.forEach.call(nav.querySelectorAll("button[data-compile-stage]"),function(b){b.setAttribute("aria-selected",String(b.dataset.compileStage===stage));});
    var body = (clab.mode === "bench") ? clabBenchHtml(stage) : d.body;
    var live = clabLiveHtml(stage);
    host.innerHTML='<div class="complab-stage-head"><h3>'+esc(d.title)+'</h3><p>'+esc(d.intro)+'</p></div><div class="complab-body">'+body+'</div>'+
      (live ? '<section class="complab-live" aria-label="Real tool output">'+live+'</section>' : "");
    var retry=host.querySelector("#clab-retry");
    if(retry){retry.addEventListener("click",clabRetry);}
    clabWireBench(host);
    Array.prototype.forEach.call(host.querySelectorAll(".complab-choices[data-cq] button"),function(b){b.addEventListener("click",function(){var box=b.parentNode,key=box.dataset.cq;Array.prototype.forEach.call(box.querySelectorAll("button"),function(x){x.classList.remove("correct","wrong");});var ok=b.dataset.a==="a";b.classList.add(ok?"correct":"wrong");var ans=host.querySelector('[data-ca="'+key+'"]');if(ans)ans.hidden=!ok;});});
    Array.prototype.forEach.call(host.querySelectorAll("[data-art]"),function(b){b.addEventListener("click",function(){Array.prototype.forEach.call(host.querySelectorAll("[data-art]"),function(x){x.classList.remove("selected");});b.classList.add("selected");var text={code:"The assembler has emitted target instruction bytes into an executable input section. The bytes are real machine code, but their final address can still change during linking.",symbols:"Symbols preserve names and relationships that later stages can resolve or expose for debugging. A symbol is not itself a machine instruction.",reloc:"A relocation records a location that depends on a final address or symbol value. The linker uses these records when combining objects."};var d=host.querySelector("#complab-art-detail");if(d)d.innerHTML='<div><b>Selected</b><span>'+text[b.dataset.art]+'</span></div>';});});
    if(stage==="check"){
      var order=host.querySelector("#complab-order"), result=host.querySelector("#complab-order-result"), next=1;
      if(order)Array.prototype.forEach.call(order.querySelectorAll("button"),function(b){b.addEventListener("click",function(){var n=Number(b.dataset.order);if(n===next){b.classList.add("correct");b.disabled=true;next++;if(next===7)result.hidden=false;}else{b.classList.add("wrong");setTimeout(function(){b.classList.remove("wrong");},650);}});});
    }
  }

  /* ---- Compilation Path Lab: real toolchain (Tauri commands toolchain_status /
     pipeline_run). The static teaching content above is never replaced; this is
     an additive panel with what the actual gcc/objdump/size/objcopy produced. */
  var clab = { booted: false, status: "idle", info: null, report: null, err: "",
    mode: "teach", srcs: { mainC: "", startupS: "", linkerLd: "" }, defaults: null, hasDraft: false };
  var K_BENCH = "ecroadmap.bench.v1";
  (function clabLoadDraft() {
    var d = rd(K_BENCH, null);
    if (d && d.srcs && typeof d.srcs === "object") { clab.srcs.mainC = d.srcs.mainC || ""; clab.srcs.startupS = d.srcs.startupS || ""; clab.srcs.linkerLd = d.srcs.linkerLd || ""; clab.hasDraft = !!(d.srcs.mainC || d.srcs.startupS || d.srcs.linkerLd); }
    if (d && d.mode === "bench") { clab.mode = "bench"; }
  })();
  function clabSaveDraft() { try { wr(K_BENCH, { srcs: clab.srcs, mode: clab.mode }); } catch (e) { /* full or blocked */ } }
  function clabInvoke(cmd, args) {
    var T = window.__TAURI__;
    return (T && T.core && T.core.invoke) ? T.core.invoke(cmd, args || {}) : null;
  }
  function clabStageOut(id) {
    var st = (clab.report && clab.report.stages) || [];
    for (var i = 0; i < st.length; i++) { if (st[i].id === id) { return st[i]; } }
    return null;
  }
  function clabBadge(ok) { return '<span class="clab-badge ' + (ok ? "ok" : "bad") + '">' + (ok ? "ok" : "failed") + "</span>"; }
  function clabCmds(list) {
    if (!list || !list.length) { return ""; }
    return '<div class="clab-cmds">' + list.map(function (c) { return "<code>" + esc(c) + "</code>"; }).join("") + "</div>";
  }
  function clabFold(label, html, open) {
    return "<details" + (open === false ? "" : " open") + "><summary>" + esc(label) + "</summary><pre>" + html + "</pre></details>";
  }
  function clabBlock(s) {
    var h = '<div class="clab-block' + (s.ok ? "" : " clab-bad") + '">';
    h += clabCmds(s.commands);
    if (s.stdout && s.stdout.trim()) { h += clabFold("output", esc(s.stdout)); }
    if (s.stderr && s.stderr.trim()) { h += clabFold(s.ok ? "messages (warnings etc.)" : "error output", esc(s.stderr)); }
    Array.prototype.forEach.call(s.artifacts || [], function (a) {
      var isCode = /\.(c|s|ld|i)(\b|$|\s|\u2014)/i.test(a.name) || /^main\.(s|i)/.test(a.name);
      h += clabFold(a.name, isCode ? hl(a.text) : esc(a.text));
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
    var rep = clab.report;
    if (!rep || !rep.stages || !rep.stages.length) { return h + '<p class="clab-note">no pipeline result yet.</p>'; }
    if (stage === "check") {
      var rows = rep.stages.map(function (s) {
        return '<div class="clab-row">' + clabBadge(s.ok) + "<b>" + esc(s.id) + "</b>" + clabCmds(s.commands) + "</div>";
      }).join("");
      return h + '<p class="clab-note">Every representation above was produced by these real commands' +
        (rep.ok ? "." : " \u2014 the run stopped early; inspect the failing stage's error output.") + "</p>" +
        '<div class="clab-block">' + rows + "<p class=\"clab-note\">toolchain: <code>" + esc(rep.toolchain) + "</code></p></div>";
    }
    var s = clabStageOut(stage);
    if (!s) { return h + '<p class="clab-note">this stage has no live output.</p>'; }
    return h + "<p class=\"clab-note\">" + esc(CLAB_TITLES[stage] || "") + " \u00b7 " + clabBadge(s.ok) + "</p>" + clabBlock(s);
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
  function clabRetry() { clab.booted = false; clab.status = "idle"; clab.report = null; clabBoot(); }

  /* ---- Lab bench: editable sources + explanations parsed from the real build ---- */
  function clabBenchBar() {
    var busy = clab.status === "building" || clab.status === "checking";
    var can = !busy && !!(clab.info && clab.info.found);
    return '<div class="clab-benchbar">' +
      '<button type="button" class="btn" id="clab-build"' + (can ? "" : " disabled") + '>' + (busy ? "building\u2026" : "Build with these sources") + "</button>" +
      '<button type="button" class="btn" id="clab-restore"' + (can ? "" : " disabled") + ">Restore the example</button>" +
      '<span class="clab-note">' + (clab.report ? (clab.report.custom ? "last build: your bench sources" : "last build: the fixed example") : "nothing built yet") + "</span></div>";
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
    var rep = clab.report;
    if (!rep || !rep.stages || !rep.stages.length) {
      return '<p class="clab-note">Nothing built from the bench yet \u2014 edit the sources in stage 1, then press Build.</p>';
    }
    var L = [], i, m, txt, stopped = null;
    for (i = 0; i < rep.stages.length; i++) { if (!rep.stages[i].ok) { stopped = rep.stages[i].id; } }
    if (stopped) { L.push("the real tools stopped at <b>" + esc(stopped) + "</b> \u2014 fix that stage first; later stages show the previous successful build."); }
    if (stage === "preprocess") {
      txt = clabArtOf("preprocess", "main.i");
      var defs = (clab.srcs.mainC.match(/^[ \t]*#[ \t]*define/gm) || []).length;
      L.push(txt && /#[ \t]*define/.test(txt)
        ? "careful: a <code>#define</code> is still visible in the excerpt \u2014 check the macro spelling."
        : (defs ? defs + " #define director" + (defs === 1 ? "y was" : "ies were") + " in your main.c; none survive into main.i \u2014 only the expanded text does." : "your main.c has no #define; includes were still expanded in place."));
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
    return L.length ? '<div class="clab-facts"><b>from the real build</b><ul>' + L.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul></div>"
      : '<p class="clab-note">no automatic observations for this stage \u2014 the raw output below is the evidence.</p>';
  }
  function clabBuild() {
    if (!clab.info || !clab.info.found || clab.status === "building") { return; }
    var p = clabInvoke("pipeline_run", { sources: { mainC: clab.srcs.mainC, startupS: clab.srcs.startupS, linkerLd: clab.srcs.linkerLd } });
    if (!p) { return; }
    clab.status = "building";
    clabAfter();
    p.then(function (rep) {
      clab.report = rep;
      clab.status = (rep && rep.ok) ? "ready" : "failed";
      clabAfter();
    }, function (e) {
      clab.err = String(e);
      if (/too large/.test(clab.err)) {
        window.alert(clab.err);
        clab.status = (clab.report && clab.report.ok) ? "ready" : "failed";
      } else if (/toolchain-not-found/.test(clab.err)) {
        clab.status = "missing";
      } else {
        clab.status = "error";
        window.alert("Build failed to start: " + clab.err);
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

  /* ---------------- Linker & Startup Lab ---------------- */
  var linkLabInited = false;
  var LINK_STAGES = ["mcu","files","script","memory","startup","build","check","sandbox"];
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
        <h4>Startup pseudocode</h4>
        <pre class="linklab-code"><span class="linklab-code-line" data-reset-code="1">Reset_Handler:</span>
<span class="linklab-code-line" data-reset-code="2">    load _sidata        ; Flash source of .data</span>
<span class="linklab-code-line" data-reset-code="2">    load _sdata         ; RAM destination</span>
<span class="linklab-code-line" data-reset-code="2">    load _edata         ; RAM end</span>
<span class="linklab-code-line" data-reset-code="2">    copy words</span>
<span class="linklab-code-line" data-reset-code="3">    load _sbss</span>
<span class="linklab-code-line" data-reset-code="3">    load _ebss</span>
<span class="linklab-code-line" data-reset-code="3">    write zero until end</span>
<span class="linklab-code-line" data-reset-code="4">    bl SystemInit</span>
<span class="linklab-code-line" data-reset-code="4">    bl main</span></pre>
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
          <div><code>uint32_t counter = 42;</code><div class="linklab-quiz" data-q="m1"><button data-a="a">RAM .data + Flash initial image</button><button data-a="b">RAM .bss only</button><button data-a="c">stack only</button></div><div class="linklab-answer" data-answer="m1" hidden>Correct. It is writable and initialized, so it has a RAM runtime object plus an initialization image in Flash.</div></div>
          <div><code>uint8_t buffer[256];</code><div class="linklab-quiz" data-q="m2"><button data-a="a">Flash .text</button><button data-a="b">RAM .bss</button><button data-a="c">stack</button></div><div class="linklab-answer" data-answer="m2" hidden>Correct. It is a zero-initialized writable global, so it occupies RAM .bss and has no initialized Flash payload.</div></div>
          <div><code>uint32_t sample = 7;</code> inside <code>control()</code><div class="linklab-quiz" data-q="m3"><button data-a="a">RAM stack</button><button data-a="b">Flash .data image</button><button data-a="c">RAM .bss</button></div><div class="linklab-answer" data-answer="m3" hidden>Correct. An automatic local belongs to the function's runtime stack frame.</div></div>
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
        <div class="linklab-card linklab-checkblock"><div class="linklab-checklabel">4 · Explain it yourself</div><h4>Complete the chain</h4><p>Choose the statement that best completes the system:</p><div class="linklab-quiz" data-q="chain"><button data-a="a">The linker chooses placement; startup uses the resulting symbols to establish runtime state; then C code runs.</button><button data-a="b">Startup chooses addresses; the linker only converts C to machine code.</button><button data-a="c">The C compiler performs the RAM initialization after reset.</button></div><div class="linklab-answer" data-answer="chain" hidden>Correct. The compiler creates object sections, the linker gives them final placement and symbols, startup performs the required early runtime work, and then application C code runs.</div></div>
      </div>
      <div class="linklab-card linklab-checkblock"><div class="linklab-checklabel">5 · Teach it back</div><h4>Explain the whole system</h4><p>Put the five statements into the causal order you would use to teach another engineer what happens from source to <code>main()</code>.</p><div class="linklab-order" id="linklab-teach-order"><button type="button" data-order="2">The compiler/assembler create relocatable object sections.</button><button type="button" data-order="3">The linker applies <code>linker.ld</code> and assigns final addresses and symbols.</button><button type="button" data-order="4">The reset sequence uses the vector table and linker symbols to initialize runtime RAM.</button><button type="button" data-order="5">The initialized C runtime state is ready, so <code>main()</code> can execute.</button><button type="button" data-order="1">C and assembly source describe the firmware.</button></div><div class="linklab-answer" id="linklab-teach-result" hidden></div></div><div class="linklab-card linklab-checkblock linklab-finalcheck"><div class="linklab-checklabel">6 · Diagnose end-to-end</div><h4>A firmware reaches <code>main()</code>, but <code>counter</code> is not 42</h4><p>The linker script still gives <code>.data</code> a RAM VMA and Flash LMA. Which missing runtime action best explains the symptom?</p><div class="linklab-quiz" data-q="endtoend"><button data-a="a">Startup did not copy the <code>.data</code> load image from <code>_sidata</code> to <code>_sdata … _edata</code>.</button><button data-a="b">The linker forgot to create <code>.text</code>.</button><button data-a="c">The vector table should have been placed in RAM.</button></div><div class="linklab-answer" data-answer="endtoend" hidden>Correct. The placement can be correct while the runtime state is still wrong: startup must perform the Flash-to-RAM copy before <code>main()</code>.</div></div><section class="linklab-qa" aria-label="Linker lab recall cards"><div class="linklab-qa-head"><strong>Recall cards</strong><span>answer first, reveal second</span></div><div class="linklab-cards"><div class="linklab-cardq"><strong>Where does .text normally live in this MCU model?</strong><button type="button" data-card="0">reveal</button><div class="linklab-answer" hidden>FLASH</div></div><div class="linklab-cardq"><strong>Why can .data have both VMA and LMA?</strong><button type="button" data-card="1">reveal</button><div class="linklab-answer" hidden>RAM is its runtime address; Flash holds its initial image.</div></div><div class="linklab-cardq"><strong>Who copies .data into RAM?</strong><button type="button" data-card="2">reveal</button><div class="linklab-answer" hidden>Startup code, not the linker.</div></div><div class="linklab-cardq"><strong>Who decides final addresses?</strong><button type="button" data-card="3">reveal</button><div class="linklab-answer" hidden>The linker.</div></div><div class="linklab-cardq"><strong>Why is .bss NOLOAD?</strong><button type="button" data-card="4">reveal</button><div class="linklab-answer" hidden>It needs RAM space but no initialized bytes in the load image.</div></div><div class="linklab-cardq"><strong>What does _estack represent?</strong><button type="button" data-card="5">reveal</button><div class="linklab-answer" hidden>The top/end of the RAM stack region in this model.</div></div></div></section>`
    }
  };
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
  function lksandLoad() {
    var d = lksandDefault(), s = rd(K_LKSAND, null);
    if (!s || !Array.isArray(s.sections) || s.sections.length !== d.sections.length) { return d; }
    d.stack = Number(s.stack) || 0; d.heap = Number(s.heap) || 0;
    d.sections.forEach(function (sec, i) {
      var u = s.sections[i];
      if (!u) { return; }
      if (typeof u.size === "number" && isFinite(u.size)) { sec.size = Math.max(0, Math.min(LKS_MAX, Math.round(u.size))); }
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
    var flashUsed = st.stack + st.heap, ramUsed = st.stack + st.heap, diag = [], byId = {};
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
    if (flashUsed > FLASH_SIZE) { d("layout", "error", "FLASH region overflowed: <code>section .bss will not fit in region FLASH</code> — the linker refuses to produce the image. The flash total counts every loaded section's init image plus the stack/heap reserves."); }
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
        var v = Math.round(Number(inp.value)); if (!isFinite(v) || v < 0) { v = 0; } if (v > LKS_MAX) { v = LKS_MAX; }
        s.size = v; inp.value = v; lksandSave(); renderLinkLab("sandbox");
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll("[data-lks-reserve]"), function (inp) {
      inp.addEventListener("change", function () {
        var v = Math.round(Number(inp.value)); if (!isFinite(v) || v < 0) { v = 0; } if (v > LKS_MAX) { v = LKS_MAX; }
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
    if(stage==="sandbox"){ d={title:d.title, intro:d.intro, body:lksandBody()}; }
    Array.prototype.forEach.call(nav.querySelectorAll("button[data-link-stage]"),function(b){b.setAttribute("aria-selected",String(b.dataset.linkStage===stage));});
    host.innerHTML='<div class="linklab-stage-head"><h3>'+esc(d.title)+'</h3><p>'+esc(d.intro)+'</p></div><div class="linklab-body">'+d.body+'</div>';
    Array.prototype.forEach.call(host.querySelectorAll(".linklab-quiz button"),function(b){
      b.addEventListener("click",function(){
        var q=b.parentNode.getAttribute("data-q"), ok=(b.dataset.a==="a");
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
        {title:"C runtime is ready: enter main()", text:"After the memory state required by the C program has been prepared, startup can perform remaining platform initialization and call main().", flash:"firmware image remains unchanged", ram:".data and .bss are now valid; stack is active", code:4}
      ];
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
          var facts=host.querySelector("#linklab-reset-facts");
          if(n===0) facts.innerHTML='<div><b>Initial SP</b><code>_estack</code><span>0x20020000 in this model</span></div><div><b>Entry point</b><code>Reset_Handler</code><span>startup.s</span></div>';
          if(n===1) facts.innerHTML='<div><b>Vector table</b><code>.isr_vector</code><span>Flash, retained with KEEP</span></div><div><b>Entry point</b><code>Reset_Handler</code><span>startup.s</span></div>';
          if(n===2) facts.innerHTML='<div><b>Source</b><code>_sidata</code><span>Flash LMA</span></div><div><b>Destination</b><code>_sdata → _edata</code><span>RAM VMA</span></div>';
          if(n===3) facts.innerHTML='<div><b>Start</b><code>_sbss</code><span>RAM</span></div><div><b>End</b><code>_ebss</code><span>RAM</span></div>';
          if(n===4) facts.innerHTML='<div><b>Ready</b><code>.data + .bss</code><span>initialized runtime state</span></div><div><b>Next</b><code>main()</code><span>application code</span></div>';
        });
      });
    }
  }

  /* ---------------- peripheral playground (N4) — staged curriculum ---------------- */
  var K_PERIPH = "ecroadmap.periph.v1";
  var PF_TICK_MS = 100;        /* real ms between sim ticks (10 Hz) */
  var PF_CLK_PER_TICK = 100;   /* timer-clock counts that elapse per tick — 1 kHz scaled */
  var PF_LOG_MAX = 80;
  var PF_ISR_MS = 400;         /* a handler stays on the CPU for this long — makes preemption observable */
  var PF_TIM2_IRQ_BIT = 28;    /* Cortex-M4 STM32F4 TIM2 global IRQ position in ISER0 */
  var PF_TIM3_IRQ_BIT = 29;    /* TIM3 sits right next to TIM2 in ISER0 */

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
    ISER0:   { pfx: "NVIC->ISER[0]", w: 32, names: {}, special: "iser", irqNames: (function (m) { m[PF_TIM2_IRQ_BIT] = "TIM2_IRQn"; m[PF_TIM3_IRQ_BIT] = "TIM3_IRQn"; return m; })({}) },
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
      if (reg === "ISER0") { periph.nvic.ISER0 = value; }
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
    }
    pfLog("wr", pname + "." + reg + " ← " + pfHex(value, 8));
    return true;
  }
  /* current value of any writable register — used by the bit-click handler */
  function pfReadReg(pname, reg) {
    if (pname === "RCC")   { return reg === "APB1ENR" ? periph.rcc.APB1ENR : periph.rcc.AHB1ENR; }
    if (pname === "NVIC")  { return periph.nvic.ISER0; }
    if (pname === "GPIOA") { return periph.gpioa[reg] >>> 0; }
    if (pname === "TIM2" || pname === "TIM3") { return pfTim(pname)[reg] >>> 0; }
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
    var ledBit = (periph.race.active && r.n === "TIM2") ? 6 : PF_IRQS[r.n].led;
    var toggle = (periph.gpioa.ODR ^ (1 << ledBit)) & 0xFFFF;
    if (pfClkOn("GPIOA")) {
      periph.gpioa.ODR = toggle;
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
      pfLog("err", "⚠ RMW race — main() wrote back a stale ODR; bit changes made since its read are lost (update #" + rc.lost + ")");
    }
    periph.gpioa.ODR = v & 0xFFFF;
    rc.lat = null;
    rc.toggles++;
  }
  function pfUpdateRateHz(T) {
    return 1000 / ((T.PSC + 1) * (T.ARR + 1));
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
        { c: "TIM2->ARR      = 50;  /* 100 Hz / 50 = 2 Hz updates */", n: "Reload value → update rate.", o: function () { pfWriteReg("TIM2", "ARR", 50); periph.tim2.CNT = 0; } },
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
  function pfReg(name, addr, acc, val, width, id, active, pnm) {
    var bits = '';
    var w = width || 16;
    var actMap = null;
    if (active) {
      actMap = {};
      for (var ai = 0; ai < active.length; ai++) { actMap[active[ai]] = true; }
    }
    for (var i = w - 1; i >= 0; i--) {
      var on = (val >>> i) & 1;
      var isRO = acc === 'RO' || (actMap && !actMap[i]);
      var title = actMap && !actMap[i] ? (acc === 'RO' ? 'read-only' : 'reserved in this model') : (acc === 'RO' ? 'read-only' : '');
      bits += '<div class="pf-bit' + (on ? ' one' : '') + (isRO ? ' ro' : '') + '" data-rbit="' + (id || name) + '-' + i + '" data-reg="' + name + '"' + (pnm ? ' data-pname="' + pnm + '"' : '') + ' data-periph="' + acc + '" data-bit="' + i + '" data-w="' + w + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + on + '<span class="bl">' + i + '</span></div>';
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
      pfReg('AHB1ENR', '0x4002_3830', 'RW', periph.rcc.AHB1ENR, 8, 'rcc-ahb1', [0], 'RCC') +
      pfReg('APB1ENR', '0x4002_3840', 'RW', periph.rcc.APB1ENR, 8, 'rcc-apb1', [0, 1], 'RCC') +
      '<p class="pf-hint"><b>AHB1 bit 0 = GPIOA</b> · <b>APB1 bit 0 = TIM2</b>, <b>bit 1 = TIM3</b>. Writes to a peripheral whose clock is off are silently dropped by real silicon — the same rule is enforced here.</p></section>';
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
      pfReg('CR1',  a(0x00), 'RW',  T.CR1,  8, lk + '-cr1',  [0], tim) +
      pfReg('DIER', a(0x0C), 'RW',  T.DIER, 8, lk + '-dier', [0], tim) +
      pfReg('SR',   a(0x10), 'W1C', T.SR,   8, lk + '-sr',   [0], tim) +
      pfReg('PSC',  a(0x28), 'RW',  T.PSC,  16, lk + '-psc', null, tim) +
      pfReg('ARR',  a(0x2C), 'RW',  T.ARR,  16, lk + '-arr', null, tim) +
      pfReg('CNT',  a(0x24), 'RO',  T.CNT,  16, lk + '-cnt', null, tim) +
      '<div class="pf-rate">update rate ≈ <b id="pf-' + lk + '-rate">0</b> Hz · <span id="pf-' + lk + '-run">stopped</span></div>' +
      '<p class="pf-hint"><b>CR1 bit 0 = CEN</b> start · <b>DIER bit 0 = UIE</b> ask for an IRQ on update · <b>SR bit 0 = UIF</b> write-1-to-clear. In this model the timer clock is 1 kHz, so rate = <code>1000 / (PSC+1) / (ARR+1)</code>.</p></section>';
  }
  function pfNvicCard() {
    function ipBtn(bit) {
      return '<span class="pf-ipr"><button type="button" class="btn mini" data-ip="' + bit + '" data-d="-1" title="raise priority (lower number)">−</button><b id="pf-ipr-' + bit + '">—</b><button type="button" class="btn mini" data-ip="' + bit + '" data-d="1" title="lower priority (higher number)">+</button></span>';
    }
    return '<section class="pf-card"><h3>NVIC<span class="pf-sub">ISER0 · priority · live state</span></h3>' +
      pfReg('ISER0', '0xE000_E100', 'RW', periph.nvic.ISER0, 32, 'nvic-iser0', [PF_TIM2_IRQ_BIT, PF_TIM3_IRQ_BIT], 'NVIC') +
      '<div class="pf-iprbar"><span>TIM2 IRQ ' + ipBtn(PF_TIM2_IRQ_BIT) + '</span><span>TIM3 IRQ ' + ipBtn(PF_TIM3_IRQ_BIT) + '</span></div>' +
      '<table class="pf-irqtbl"><thead><tr><th>IRQ</th><th>clock</th><th>flag</th><th>UIE</th><th>ISER</th><th>NVIC state</th></tr></thead><tbody id="pf-irqtbl-body"></tbody></table>' +
      '<p class="pf-hint">An interrupt reaches the instruction stream only when <b>every gate agrees</b>: peripheral clock, its <b>DIER</b> bit, the NVIC line in <b>ISER0</b>, and <b>PRIMASK = 0</b>. Priority numbers: <b>lower = more urgent</b>; a pending IRQ with a lower number preempts the running handler.</p></section>';
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
      '<div class="pf-ccrrow"><label for="pf-' + lk + '-ccr-r">CCR — compare value <span class="dim">(drag the dashed ARR line and this slider — visual duty only, the model has no PWM output channel yet)</span></label>' +
        '<input type="range" id="pf-' + lk + '-ccr-r" data-ccr="' + tim + '" min="0" max="65535" step="1" value="' + pfTim(tim).CCR + '" aria-label="' + tim + ' compare value">' +
        '<b id="pf-' + lk + '-duty">— %</b></div></section>';
  }
  function pfLogCard() {
    return '<section class="pf-card"><h3>Event log<span class="pf-sub">newest at bottom</span></h3><div class="pf-log" id="pf-log"></div></section>';
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
    var g = function (id, cls, inner) { return '<g id="pf-pin5-' + id + '" class="' + cls + '">' + inner + '</g>'; };
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
    9: { text: 'Cold start, no net: make PA5★ blink from the TIM2 interrupt at <b>1.5 – 2.6 Hz</b>. Clocks, pin mode, CEN, DIER, ISER0[28], PRIMASK = 0 — all of it, from a power-on reset. Verify only after ≥ 4 handler entries are in the log.',
         ok: function () {
           var T = periph.tim2, r = pfUpdateRateHz(T);
           return pfClkOn("GPIOA") && pfModer(5) === 1 && pfClkOn("TIM2") && (T.CR1 & 1) !== 0 &&
                  r >= 1.5 && r <= 2.6 && (T.DIER & 1) !== 0 &&
                  ((periph.nvic.ISER0 >>> PF_TIM2_IRQ_BIT) & 1) !== 0 &&
                  periph.cpu.PRIMASK === 0 && (periph.fired.TIM2 | 0) >= 4;
         },
         hint: function () { return 'The checklist on the left shows exactly which gate is still shut.'; } }
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
    { l: '≥ 4 handler entries in the log',          f: function () { return (periph.fired.TIM2 | 0) >= 4; } }
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
        '<div class="pf-col pf-col-reg">' + pfRccCard() + pfGpioaCard() + pfTimCard('TIM2') + pfTimCard('TIM3') + pfNvicCard() + pfCpuCard() + '</div>' +
        '<div class="pf-col pf-col-obs">' + pfLedsCard() + pfSwCard() + pfWaveCard('TIM2') + pfWaveCard('TIM3') + pfLogCard() + '</div>' +
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
            '<p>Each pin has <b>2 mode bits</b> (IN / OUT / AF / ANALOG) packed 16 to a register — that is why MODER is 32 bits for 16 pins and why the idiom is <code>~(3u &lt;&lt; pin*2)</code>. After reset every pin is an <b>input</b>: safe, high-impedance, deaf. ODR always exists and always remembers its value, but the pad only <em>follows</em> ODR when MODER says OUT.</p>') +
          pfGpioaCard('MODER tiles + ODR — IDR waits for stage 4') + pfPinCard(5),
          pfLedsCard(),
          pfGoalCard(3) + pfUsercodeCard());
      case 4: return pfCols(
          pfTeach('The pad is not the memory',
            '<p><b>IDR is the wire. ODR is what you asked for.</b> Configure PA0 as input and the switch state appears in IDR bit 0 — nothing to do with any register you wrote. If software drives PA5 high but a stronger external circuit pulls it low, ODR still reads 1 while the pad is 0. Polling is the simplest use of that truth: loop, read the pad, act.</p>' +
            '<p>Set PA0 → IN, PA5 → OUT, then start the loop and flip SW0. Watch the CPU-busy light: during <code>while(1)</code> this core can do <em>nothing else</em> — which is the whole motivation for interrupts in stage 6.</p>') +
          pfGpioaCard('set PA0 to IN and PA5 to OUT') + pfPollCtlCard(),
          pfSwCard() + pfLedsCard('ODR bit 5 ← poll loop ← IDR bit 0 ← SW0'),
          pfGoalCard(4) + pfLogCard());
      case 5: return pfCols(
          pfTeach('Counting is dividing',
            '<p>TIM2 is an elevator counter: <b>CNT</b> ticks up from 0 to <b>ARR</b>, wraps, and — if you asked — flags an update. <b>PSC</b> prescales the 1 kHz model clock: one CNT step per PSC+1 ticks. So a full period takes <code>(PSC+1) × (ARR+1)</code> clock ticks — two 16-bit dividers cascade to turn 1 kHz into anything from a nanosecond-fraction to minutes.</p>' +
            '<p>Now the waveform below does double duty: the <b>dashed ARR line is draggable</b> (grab it vertically), and the <b>CCR slider</b> draws what a real timer PWM channel would output — high while CNT &lt; CCR. Watch <b>PA5★ dim</b> as you widen the duty. CCR here is visual only; the bring-up of an actual compare channel is an AF-pin story (stage 3 told you who owns the driver then).</p>') +
          pfTimCard('TIM2'),
          pfWaveCard('TIM2'),
          pfGoalCard(5) + pfUsercodeCard() + pfLogCard());
      case 6: return pfCols(
          pfTeach('An interrupt is a chain of Yesses',
            '<p>The flag is only a <em>request</em>. For the vector table to fire, four gates must agree: <b>clock</b> (else no counter, no flag), <b>DIER.UIE</b> (the peripheral must route its flag to the NVIC line), <b>ISER0[28]</b> (the NVIC must listen), and <b>PRIMASK = 0</b> (the CPU must accept). The table below shows each gate live.</p>' +
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
          pfGoalCard(7) + pfLedsCard() + pfLogCard());
      case 8: return pfCols(
          pfTeach('Read-modify-write is not a promise',
            '<p><code>ODR |= bit</code> is three bus transactions. Between the read and the write, the world may change the other bits — classically, an interrupt handler. The write-back overwrites them with the stale snapshot: a <b>lost update</b>. No compile warning, no bus error; your LED just sometimes refuses. Fixes, in order of preference: use a peripheral that gives you an <b>atomic write-only</b> register (BSRR), or take a critical section (<code>__disable_irq()</code> around the RMW). <code>volatile</code> fixes the compiler re-reading; it fixes nothing about the window.</p>') +
          pfGpioaCard('bit 5 = main()\'s LED · bit 6 = the ISR\'s') + pfRaceCtlCard(),
          pfLedsCard('PA5 ← main() · PA6 ← ISR') + pfCpuCard(),
          pfGoalCard(8) + pfLogCard());
      case 9: return pfCols(
          pfTeach('Bring-up, blind',
            '<p>Power-on reset is pressed for you (stage bar → Playground aside: hit <b>⏻ Power-on reset</b> to be sure). You get the full bank and one sentence of spec:</p>' +
            '<p class="pf-spec">PA5 must blink under the TIM2 update interrupt at 1.5 – 2.6 Hz. Nothing else. No step buttons, no hints until you verify.</p>' +
            '<p>Every wrong or missing write is visible somewhere — dropped-write log lines, the gate table, the checklist on the right. That is exactly what a logic analyser and a debugger are on real silicon.</p>') +
          pfRccCard() + pfGpioaCard() + pfTimCard('TIM2'),
          pfNvicCard() + pfCpuCard() + pfWaveCard('TIM2'),
          pfGoalCard(9) + pfChecklistCard() + pfLedsCard() + pfLogCard());
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
      ['tim2-cr1', 'TIM2', 'CR1', 2], ['tim2-dier', 'TIM2', 'DIER', 2], ['tim2-sr', 'TIM2', 'SR', 2],
      ['tim2-psc', 'TIM2', 'PSC', 4], ['tim2-arr', 'TIM2', 'ARR', 4], ['tim2-cnt', 'TIM2', 'CNT', 4],
      ['tim3-cr1', 'TIM3', 'CR1', 2], ['tim3-dier', 'TIM3', 'DIER', 2], ['tim3-sr', 'TIM3', 'SR', 2],
      ['tim3-psc', 'TIM3', 'PSC', 4], ['tim3-arr', 'TIM3', 'ARR', 4], ['tim3-cnt', 'TIM3', 'CNT', 4],
      ['nvic-iser0', 'NVIC', 'ISER0', 8]
    ];
    hexSpecs.forEach(function (h) {
      var e = document.getElementById('pf-hex-' + h[0]);
      if (e) { e.textContent = pfHex(pfReadReg(h[1], h[2]), h[3]); }
    });
    /* Bit boxes — resolve their source through data-pname when present */
    Array.prototype.forEach.call(host.querySelectorAll('.pf-bit[data-reg]'), function (b) {
      var reg = b.dataset.reg, bit = Number(b.dataset.bit);
      var pname = b.dataset.pname || (reg === 'AHB1ENR' || reg === 'APB1ENR' ? 'RCC' : reg === 'ISER0' ? 'NVIC' : reg === 'OTYPER' || reg === 'IDR' || reg === 'ODR' ? 'GPIOA' : reg === 'CR1' || reg === 'DIER' || reg === 'SR' || reg === 'PSC' || reg === 'ARR' || reg === 'CNT' ? 'TIM2' : null);
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
          if (hint) { hint.textContent = 'Verified against the live register state — onto the next stage.'; hint.style.color = 'var(--ok)'; }
          pfSave();
          pfRenderStatic();
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
        var pname = b.dataset.pname || (reg === 'AHB1ENR' || reg === 'APB1ENR' ? 'RCC' : reg === 'ISER0' ? 'NVIC' : reg === 'OTYPER' || reg === 'ODR' ? 'GPIOA' : 'TIM2');
        var cur = pfReadReg(pname, reg);
        if (cur === null) { return; }
        var mask = (1 << bit) >>> 0;
        var next;
        if (reg === 'SR') { next = mask; }        /* W1C: writing 1 clears */
        else { next = (cur ^ mask) >>> 0; }
        var ok = pfWriteReg(pname, reg, next);
        if (ok) {
          var willSet = reg === 'SR' ? false : ((next >>> bit) & 1) === 1;
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

  /* ---------------- protocol lab (N17) — logic analyser + line physics + UART ---------------- */
  var K_PROTOS = "ecroadmap.protocols.v1";
  var PR_TICK_MS = 120;
  var PR_LOG_MAX = 60;
  var PR_PIN = 5;                 /* the wire the line-physics rig drives, PA5 */
  var protocolsInited = false;

  var PR_STAGE_META = [
    { id: 1, fam: "basics", name: "Signals 101",    tag: "drive + pull = level" },
    { id: 7, fam: "basics", name: "Protocol map",    tag: "what every protocol shares" },
    { id: 2, fam: "uart",   name: "The frame",       tag: "one byte on a wire" },
    { id: 3, fam: "uart",   name: "Sampling & baud", tag: "the receiver's clock" },
    { id: 4, fam: "uart",   name: "Terminal",        tag: "type -> frame -> decode" },
    { id: 5, fam: "i2c",    name: "I2C: shared wire", tag: "wired-AND arbitration" },
    { id: 6, fam: "i2c",    name: "I2C: address + ACK", tag: "who is this for?" },
    { id: 8, fam: "spi",    name: "SPI: four modes", tag: "CPOL/CPHA pick the edge" },
    { id: 9, fam: "spi",    name: "SPI: the shift ring", tag: "you read last transaction" }
  ];
  var PR_FAMILIES = [
    { id: "basics", name: "Basics", blurb: "levels, timing, the shared vocabulary" },
    { id: "uart",   name: "UART",   blurb: "agreed clock, one wire each way" },
    { id: "i2c",    name: "I\u00b2C",    blurb: "shared clock, shared data, addressing" },
    { id: "spi",    name: "SPI",    blurb: "clocked by the sender, full duplex by physics" }
  ];
  function prStageById(n) {
    for (var i = 0; i < PR_STAGE_META.length; i++) { if (PR_STAGE_META[i].id === n) { return PR_STAGE_META[i]; } }
    return null;
  }
  function prFamOfStage(n) { var m = prStageById(n); return m ? m.fam : "basics"; }
  function prStagesInFam(f) {
    return PR_STAGE_META.filter(function (s) { return s.fam === f; });
  }
  function prFamById(f) {
    for (var i = 0; i < PR_FAMILIES.length; i++) { if (PR_FAMILIES[i].id === f) { return PR_FAMILIES[i]; } }
    return PR_FAMILIES[0];
  }
  function prFamDoneCount(f) {
    var n = 0; prStagesInFam(f).forEach(function (s) { if (protos.goals[s.id]) { n++; } }); return n;
  }

  function prDefaults() {
    return {
      running: true, simMs: 0, stage: 1, speed: 1,
      sig:   { drive: "push", out: 1, pull: "none" },
      wire:  { aOut: 1, bOut: 0 },
      uart:  { data: 8, parity: "none", stop: 1, baud: 9600, clk: 8000000, char: 0x48, drift: 0, tx: null, queue: [], sent: 0, errSeen: false, last: null },
      i2c:   { addr: 0x50, rw: 0, tx: null, sends: 0, collisions: 0, acked: 0, competitor: false, abort: false, m1val: 0xa0, m2val: 0x80, result: null, aOut: 1, bOut: 0 },
      spi:   { byte: 0x3f, mMode: 0, sMode: 0, tx: null, sends: 0, mismatches: 0, okReads: 0, lastGot: null, result: null, slaveShift: 0xca, slavePar: 0x2c, masterIn: null, exchanges: 0, staleSeen: false, freshRead: false },
      seen:  {},
      rxLog: [],
      goals: {},
      log: []
    };
  }
  var protos = prDefaults();

  function prLoad() {
    var s = rd(K_PROTOS, null), d = prDefaults();
    if (!s || typeof s !== "object") { protos = d; prSeedLog(); return; }
    ["sig", "wire", "uart", "i2c", "spi"].forEach(function (g) {
      if (s[g] && typeof s[g] === "object") { for (var f in d[g]) { if (!(f in s[g])) { s[g][f] = d[g][f]; } } }
      else { s[g] = JSON.parse(JSON.stringify(d[g])); }
    });
    /* a half-frame is never worth restoring */
    s.uart.tx = null; s.uart.queue = []; s.i2c.tx = null; s.spi.tx = null;
    if (typeof s.uart.char !== "number") { s.uart.char = d.uart.char; }
    if (typeof s.uart.drift !== "number") { s.uart.drift = 0; }
    if (typeof s.uart.baud !== "number") { s.uart.baud = d.uart.baud; }
    if (typeof s.uart.data !== "number") { s.uart.data = 8; }
    if (!Array.isArray(s.rxLog)) { s.rxLog = []; }
    if (!Array.isArray(s.log)) { s.log = []; }
    if (!s.goals || typeof s.goals !== "object") { s.goals = {}; }
    if (typeof s.stage !== "number" || s.stage < 1 || s.stage > 9 || !prStageById(s.stage)) { s.stage = 1; }
    if (s.speed !== 0.5 && s.speed !== 0.25) { s.speed = 1; }
    if (!s.seen || typeof s.seen !== "object") { s.seen = {}; }
    for (var k in d) { if (!(k in s)) { s[k] = d[k]; } }
    protos = s;
  }
  function prSeedLog() {
    if (!protos.log.length) { prLog('note', 'Protocol lab ready. Start at Signals 101 — the level on a wire is physics, not magic.'); }
  }
  function prSave() { wr(K_PROTOS, protos); }
  function prLog(kind, msg) {
    protos.log.push({ t: protos.simMs, k: kind, m: msg });
    if (protos.log.length > PR_LOG_MAX) { protos.log.shift(); }
  }

  /* ---- models ---- */
  function prResolve(drive, out, pull) {
    if (drive === "push") { return out ? "high" : "low"; }           /* actively drives both ways */
    if (drive === "od" && !out) { return "low"; }                    /* NMOS on: sinks */
    /* od released, or an input: high-Z, only the pull decides */
    if (pull === "up") { return "high"; }
    if (pull === "down") { return "low"; }
    return "float";
  }
  function prWireResolve(aOut, bOut) {
    if (!aOut || !bOut) { return "low"; }        /* any driver sinking pulls the whole bus low */
    return "high";                                /* both released -> pull-up wins */
  }
  function prUartBits(u, ch) {
    var bits = [{ v: 0, k: "start", l: "Start" }];
    for (var i = 0; i < u.data; i++) { bits.push({ v: (ch >>> i) & 1, k: "data", l: "D" + i }); }
    if (u.parity !== "none") {
      var ones = 0;
      for (var j = 0; j < u.data; j++) { ones += (ch >>> j) & 1; }
      var p = (u.parity === "even") ? (ones & 1) : (1 - (ones & 1));
      bits.push({ v: p, k: "parity", l: u.parity === "even" ? "Even" : "Odd" });
    }
    for (var s = 0; s < u.stop; s++) { bits.push({ v: 1, k: "stop", l: "Stop" }); }
    return bits;
  }
  function prRxSamples(bits, drift) {
    var out = [];
    for (var i = 0; i < bits.length; i++) {
      var pos = i + 0.5 + i * (drift / 100);      /* sample point drifts further each bit */
      var idx = Math.floor(pos);
      var lvl = (idx >= 0 && idx < bits.length) ? bits[idx].v : 1;
      out.push({ i: i, pos: pos, idx: idx, v: lvl, bad: idx !== i });
    }
    return out;
  }
  function prDecode(bits, u, drift) {
    var smp = prRxSamples(bits, drift), mis = 0, i;
    for (i = 0; i < smp.length; i++) { if (smp[i].bad) { mis++; } }
    var ch = 0, startOk = smp[0] && smp[0].v === 0;
    for (i = 0; i < u.data; i++) { if (smp[1 + i] && smp[1 + i].v) { ch |= (1 << i); } }
    var parityOk = true, pIdx = 1 + u.data;
    if (u.parity !== "none" && smp[pIdx]) {
      var ones = 0; for (i = 0; i < u.data; i++) { ones += (ch >>> i) & 1; }
      var expect = u.parity === "even" ? (ones & 1) : (1 - (ones & 1));
      parityOk = (smp[pIdx].v === expect);
    }
    return { ch: ch, mis: mis, startOk: startOk, parityOk: parityOk, ok: mis === 0 && startOk && parityOk };
  }
  function prCharLabel(c) {
    if (c >= 0x20 && c < 0x7f) { return String.fromCharCode(c); }
    var names = { 0x0d: "\\r", 0x0a: "\\n", 0x09: "\\t", 0x00: "NUL" };
    return names[c] != null ? names[c] : "0x" + c.toString(16).toUpperCase();
  }
  function prHex(v) { return "0x" + (v >>> 0).toString(16).toUpperCase(); }

  /* ---- logic-analyser primitive: one shared waveform+decoder for every protocol ---- */
  var _prLA = null;   /* { n, left, cw } so prRenderLive can park / move the playhead */
  function prLA(cfg) {
    var bits = cfg.bits, n = bits.length;
    var W = 300, H = 150, left = 40, right = 8, yH = 34, yL = 62, bTop = 84, bH = 24;
    var cw = (W - left - right) / n;
    _prLA = { n: n, left: left, cw: cw };
    var pts = "", prevY = yH, i;
    for (i = 0; i < n; i++) {
      var y = bits[i].v ? yH : yL, x0 = left + i * cw, x1 = x0 + cw;
      pts += x0.toFixed(1) + "," + prevY + " " + x0.toFixed(1) + "," + y + " " + x1.toFixed(1) + "," + y + " ";
      prevY = y;
    }
    var boxes = "";
    for (i = 0; i < n; i++) {
      var bx = left + i * cw;
      boxes += '<rect class="segbox ' + bits[i].k + '" x="' + (bx + 0.5).toFixed(1) + '" y="' + bTop + '" width="' + (cw - 1).toFixed(1) + '" height="' + bH + '"/>' +
        '<text class="seglab" x="' + (bx + cw / 2).toFixed(1) + '" y="' + (bTop + bH / 2 + 2.6).toFixed(1) + '">' + esc(bits[i].l) + '</text>';
    }
    var marks = "";
    if (cfg.showSamples) {
      for (i = 0; i < n; i++) {
        var pos = i + 0.5 + i * ((cfg.drift || 0) / 100);
        if (pos < 0 || pos > n) { continue; }
        var sx = left + pos * cw, bad = Math.floor(pos) !== i;
        marks += '<line class="grid" x1="' + sx.toFixed(1) + '" y1="' + (yH - 6) + '" x2="' + sx.toFixed(1) + '" y2="' + (yL + 6) + '"/>' +
          '<circle class="smp' + (bad ? ' bad' : '') + '" cx="' + sx.toFixed(1) + '" cy="' + ((yH + yL) / 2) + '" r="2.8"/>';
      }
    }
    var playX = left + Math.max(0, Math.min(cfg.playIdx == null ? 0 : cfg.playIdx, n)) * cw;
    var play = '<line id="pr-play" class="play" opacity="' + (cfg.playIdx == null ? '0' : '1') + '" x1="' + playX.toFixed(1) + '" y1="' + (yH - 8) + '" x2="' + playX.toFixed(1) + '" y2="' + (bTop + bH) + '"/>';
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '">' +
      '<text class="clab" x="6" y="' + ((yH + yL) / 2 + 3) + '">TX</text>' +
      '<line class="grid" x1="' + left + '" y1="' + yH + '" x2="' + (W - right) + '" y2="' + yH + '"/>' +
      '<line class="grid" x1="' + left + '" y1="' + yL + '" x2="' + (W - right) + '" y2="' + yL + '"/>' +
      '<polyline class="trace" points="' + pts.trim() + '"/>' +
      marks + boxes + play +
      '<text class="idl" x="' + left + '" y="' + (bTop + bH + 16) + '">' + (cfg.showSamples ? 'dots = receiver sample points · drift walks them across a bit boundary' : 'idle high · one box per symbol, left to right in time · LSB first') + '</text>' +
      '</svg>';
    return '<div class="pr-la">' + svg + '</div>';
  }
  function prLaCfg() {
    var u = protos.uart, st = protos.stage, a = prUartLive();
    if (st === 1) { return { bits: [{ v: 1, k: 'stop', l: 'idle' }], playIdx: null, showSamples: false }; }
    if (st === 3 && !(a && a.review)) { return { bits: prUartBits(u, u.char), playIdx: null, showSamples: true, drift: u.drift }; }
    var bits = a ? a.tx.bits : (u.tx ? u.tx.bits : prUartBits(u, u.char));
    return { bits: bits, playIdx: a ? Math.min(Math.floor(a.pos), bits.length) : 0, showSamples: st === 3, drift: u.drift };
  }
  function prUpdateLA() { var h = document.getElementById('pr-la-host'); if (h) { h.innerHTML = prLA(prLaCfg()); } }

  /* ---- shared card builders ---- */
  function prTeach(title, html) {
    return '<section class="pf-card"><h3>' + esc(title) + '<span class="pf-sub">the idea</span></h3><div class="pf-teach">' + html + '</div></section>';
  }
  function prCodeCard(title, code, sub) {
    return '<section class="pf-card"><h3>' + esc(title) + '<span class="pf-sub">' + esc(sub || 'this equals') + '</span></h3><pre class="pf-code">' + esc(code) + '</pre></section>';
  }
  function prSeg(name, opts, cur) {
    return '<div class="pr-seg" role="group">' + opts.map(function (o) {
      return '<button type="button" data-' + name + '="' + o.v + '" aria-pressed="' + String(cur === o.v) + '">' + esc(o.t) + '</button>';
    }).join('') + '</div>';
  }
  function prCols() {
    var args = Array.prototype.slice.call(arguments);
    var cls = 'pf-grid' + (args.length === 2 ? ' pf-grid2' : '');
    var out = '<div class="' + cls + '">';
    for (var i = 0; i < args.length; i++) { out += '<div class="pf-col pf-col-' + i + '">' + args[i] + '</div>'; }
    return out + '</div>';
  }
  function prLogCard() {
    var rows = protos.log.map(function (e) {
      return '<div class="e ' + e.k + '"><span class="t">' + e.t + 'ms</span><span class="m">' + esc(e.m) + '</span></div>';
    }).join('');
    return '<section class="pf-card"><h3>Event log<span class="pf-sub">what the model saw</span></h3><div class="pf-log">' + (rows || '<div class="e note"><span class="t">—</span><span class="m">nothing yet.</span></div>') + '</div></section>';
  }

  /* ---- stage 1: line physics ---- */
  function prSigCode() {
    var s = protos.sig, p = PR_PIN, L = [];
    L.push('/* PA5 as ' + (s.drive === 'push' ? 'push-pull' : s.drive === 'od' ? 'open-drain' : 'input') + ', pull-' + s.pull + ' */');
    if (s.drive === 'input') { L.push('GPIOA->MODER  = (GPIOA->MODER & ~(3u << ' + (p * 2) + ')) | (0u << ' + (p * 2) + ');  /* input: pad is Hi-Z */'); }
    else { L.push('GPIOA->MODER  = (GPIOA->MODER & ~(3u << ' + (p * 2) + ')) | (1u << ' + (p * 2) + ');  /* general purpose output */'); }
    L.push(s.drive === 'od' ? 'GPIOA->OTYPER |=  (1u << ' + p + ');   /* open-drain: can only sink */' : 'GPIOA->OTYPER &= ~(1u << ' + p + ');   /* push-pull: drives both */');
    var pv = s.pull === 'up' ? '1u' : s.pull === 'down' ? '2u' : '0u';
    L.push('GPIOA->PUPDR  = (GPIOA->PUPDR & ~(3u << ' + (p * 2) + ')) | (' + pv + 'u << ' + (p * 2) + ');   /* pull-' + s.pull + ' */');
    if (s.drive !== 'input') { L.push(s.out ? 'GPIOA->ODR    |=  (1u << ' + p + ');   /* ' + (s.drive === 'od' ? 'release the line' : 'drive high') + ' */' : 'GPIOA->ODR   &= ~(1u << ' + p + ');   /* ' + (s.drive === 'od' ? 'sink the line low' : 'drive low') + ' */'); }
    return L.join('\n');
  }
  function prSigCtlCard() {
    var s = protos.sig;
    return '<section class="pf-card"><h3>Drive the pin<span class="pf-sub">change one knob, watch the level</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">Driver</span>' + prSeg('sigdrive', [{ v: 'push', t: 'Push-pull' }, { v: 'od', t: 'Open-drain' }, { v: 'input', t: 'Input Hi-Z' }], s.drive) + '</div>' +
      '<div class="pr-ctlrow"><span class="lbl">ODR bit</span><button type="button" class="btn" data-sigout="' + (s.out ? 0 : 1) + '" aria-pressed="' + String(!!s.out) + '">' + (s.out ? '1 · drive/release' : '0 · low/sink') + '</button>' +
      '<span class="lbl">Pull</span>' + prSeg('sigpull', [{ v: 'none', t: 'None' }, { v: 'up', t: 'Pull-up' }, { v: 'down', t: 'Pull-down' }], s.pull) + '</div>' +
      '<p class="pf-hint">Push-pull drives <b>both</b> directions, so the pull resistor is then irrelevant. <b>Open-drain</b> can only sink: a 1 lets go and the line needs a <b>pull-up</b> to have a defined high. Cut the pull on a released line and you get <b>floating</b> — the third level that reads anything.</p>' +
    '</section>';
  }
  function prWireCard() {
    var s = protos.sig, lvl = prResolve(s.drive, s.out, s.pull);
    var p = PR_PIN;
    var svg = '<svg viewBox="0 0 300 190">' +
      '<line class="rail" x1="200" y1="16" x2="250" y2="16"/><text class="lab" x="252" y="19">VDD</text>' +
      '<line class="rail" x1="50" y1="170" x2="120" y2="170"/><line class="rail" x1="190" y1="170" x2="250" y2="170"/><text class="lab" x="28" y="173">GND</text>' +
      '<line class="rail" x1="80" y1="95" x2="220" y2="95"/>';
    /* node */
    svg += '<circle class="node ' + lvl + '" cx="150" cy="95" r="10"/><text class="lab" x="150" y="118" text-anchor="middle">PA' + p + ' = ' + lvl.toUpperCase() + '</text>';
    /* driver on the left, node -> driver -> GND */
    svg += '<line class="rail" x1="80" y1="95" x2="80" y2="120"/>';
    if (s.drive === 'input') {
      svg += '<text class="lab" x="80" y="140" text-anchor="middle">Hi-Z</text><line class="rail" x1="80" y1="120" x2="80" y2="132" stroke-dasharray="2 2"/>';
    } else {
      var dact = (s.drive === 'od' && !s.out) || (s.drive === 'push');
      svg += '<rect class="res' + (dact ? ' act' : '') + '" x="68" y="120" width="24" height="30"/><line class="rail" x1="80" y1="150" x2="80" y2="170"/><text class="lab" x="80" y="139" text-anchor="middle">' + (s.drive === 'push' ? 'PP' : 'OD') + '</text>';
    }
    /* pull resistor on the right */
    if (s.pull === 'none') {
      svg += '<text class="lab" x="220" y="70" text-anchor="middle" opacity=".5">no pull</text><line class="rail" x1="220" y1="95" x2="220" y2="78" stroke-dasharray="2 2"/>';
    } else if (s.pull === 'up') {
      var uact = s.drive !== 'push';
      svg += '<line class="rail' + (uact ? ' res act' : '') + '" x1="220" y1="95" x2="220" y2="70"/><rect class="res' + (uact ? ' act' : '') + '" x="214" y="46" width="12" height="24"/><line class="rail" x1="220" y1="46" x2="220" y2="16"/><text class="lab" x="232" y="60">pull-up</text>';
    } else {
      var dact2 = s.drive !== 'push';
      svg += '<line class="rail' + (dact2 ? ' res act' : '') + '" x1="220" y1="95" x2="220" y2="120"/><rect class="res' + (dact2 ? ' act' : '') + '" x="214" y="120" width="12" height="24"/><line class="rail" x1="220" y1="144" x2="220" y2="170"/><text class="lab" x="232" y="134">pull-dn</text>';
    }
    svg += '</svg>';
    return '<section class="pf-card"><h3>The line<span class="pf-sub">PA' + p + ' resolved from physics, not intent</span></h3><div class="pr-wire">' + svg + '</div>' +
      '<div class="pr-read">line reads <b class="pr-level ' + lvl + '">' + lvl.toUpperCase() + '</b>' + esc(prLevelReason(s, lvl)) + '</div></section>';
  }
  function prLevelReason(s, lvl) {
    if (lvl === 'float') { return ' — nothing drives it and no pull: undefined, picks up noise'; }
    if (s.drive === 'push') { return ' — push-pull actively ' + (s.out ? 'sources (high)' : 'sinks to ground (low)'); }
    if (s.drive === 'od' && !s.out) { return ' — open-drain NMOS on, sinking low'; }
    if (s.drive === 'od' && s.out) { return ' — open-drain released, the ' + (s.pull === 'up' ? 'pull-up' : 'pull-down') + ' sets it'; }
    if (s.drive === 'input') { return ' — pin is an input (Hi-Z), only the pull-' + s.pull + ' decides'; }
    return '';
  }
  function prAndCard() {
    var w = protos.wire, lvl = prWireResolve(w.aOut, w.bOut);
    var svg = '<svg viewBox="0 0 300 190">' +
      '<line class="rail" x1="130" y1="16" x2="170" y2="16"/><text class="lab" x="172" y="19">VDD</text>' +
      '<line class="rail" x1="40" y1="170" x2="260" y2="170"/>' +
      '<line class="rail" x1="50" y1="95" x2="250" y2="95"/>' +
      '<circle class="node ' + lvl + '" cx="150" cy="95" r="10"/><text class="lab" x="150" y="118" text-anchor="middle">bus = ' + lvl.toUpperCase() + '</text>' +
      '<line class="rail' + (lvl === 'high' ? ' res act' : '') + '" x1="150" y1="95" x2="150" y2="70"/><rect class="res' + (lvl === 'high' ? ' act' : '') + '" x="144" y="46" width="12" height="24"/><line class="rail" x1="150" y1="46" x2="150" y2="16"/><text class="lab" x="150" y="42" text-anchor="middle">pull-up</text>' +
      '<line class="rail" x1="70" y1="95" x2="70" y2="120"/><rect class="res' + (w.aOut ? '' : ' act') + '" x="58" y="120" width="24" height="26"/><line class="rail" x1="70" y1="146" x2="70" y2="170"/><text class="lab" x="70" y="137" text-anchor="middle">A</text>' +
      '<line class="rail" x1="230" y1="95" x2="230" y2="120"/><rect class="res' + (w.bOut ? '' : ' act') + '" x="218" y="120" width="24" height="26"/><line class="rail" x1="230" y1="146" x2="230" y2="170"/><text class="lab" x="230" y="137" text-anchor="middle">B</text>' +
      '</svg>';
    return '<section class="pf-card"><h3>Wired-AND<span class="pf-sub">two open-drain drivers, one shared line</span></h3><div class="pr-wire">' + svg + '</div>' +
      '<div class="pr-ctlrow">' +
        '<button type="button" class="btn" data-wa="a" aria-pressed="' + String(!!w.aOut) + '">A: ' + (w.aOut ? 'released (1)' : 'driving 0') + '</button>' +
        '<button type="button" class="btn" data-wa="b" aria-pressed="' + String(!!w.bOut) + '">B: ' + (w.bOut ? 'released (1)' : 'driving 0') + '</button>' +
        '<span class="pr-level ' + lvl + '">bus = ' + lvl.toUpperCase() + '</span></div>' +
      '<p class="pf-hint">Neither driver ever sources — the pull-up does. The bus reads <b>high only when both A and B let go</b>; if either sinks, the whole line is pulled low. That is a hardware <em>AND</em>, and it is exactly how I²C arbitration and shared interrupt lines work.</p></section>';
  }

  /* ---- stage 2: the frame ---- */
  function prFrameCtlCard() {
    var u = protos.uart;
    return '<section class="pf-card"><h3>Pick a byte<span class="pf-sub">watch it become a frame</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">Char</span><input id="pr-char" size="2" maxlength="1" value="' + esc(prCharLabel(u.char)) + '"/></div>' +
      '<div class="pr-ctlrow"><span class="lbl">Parity</span>' + prSeg('parity', [{ v: 'none', t: 'None' }, { v: 'even', t: 'Even' }, { v: 'odd', t: 'Odd' }], u.parity) + '</div>' +
      '<div class="pr-ctlrow"><span class="lbl">Stop</span>' + prSeg('stop', [{ v: '1', t: '1 stop' }, { v: '2', t: '2 stop' }], String(u.stop)) +
        '<button type="button" class="btn" id="pr-send"' + (u.tx ? ' disabled' : '') + '>▶ Send byte</button></div>' +
      '<p class="pf-hint">An idle UART line sits <b>high</b>. A byte is framed by a <b>start</b> bit (a pulled-low edge that starts the receiver\'s timer), the data bits <b>LSB-first</b>, an optional <b>parity</b> bit, then a <b>stop</b> (high) back to idle. Same byte, different parity/stop — a different number of levels on the wire.</p>' +
    '</section>';
  }
  function prFrameShowCard() {
    var u = protos.uart;
    return '<section class="pf-card"><h3>Logic analyser<span class="pf-sub">the TX wire, sending ' + esc(prHex(u.char)) + '</span></h3>' +
      '<div id="pr-la-host">' + prLA(prLaCfg()) + '</div>' +
      '<div class="pr-read" id="pr-frame-read">' + prFrameReadHtml() + '</div></section>';
  }
  function prFrameReadHtml() {
    var u = protos.uart, a = prUartLive();
    if (a) {
      var b = a.tx.bits[Math.min(Math.floor(a.pos), a.tx.bits.length - 1)];
      return prReviewTag(a) + (a.review ? 'reviewing\u2026 ' : 'sending\u2026 ') + 'bit <b>' + (Math.min(Math.floor(a.pos) + 1, a.tx.bits.length)) + '/' + a.tx.bits.length + '</b> \u00b7 line now <b>' + (b && b.v ? 'high' : 'low') + '</b>' +
        (a.review ? prScrubUartHtml(a.tx, Math.floor(a.pos)) : '');
    }
    if (u.last != null) { return 'sent <b>' + esc(prHex(u.char)) + '</b> (' + esc(prCharLabel(u.char)) + ') \u00b7 received <b class="good">' + esc(prHex(u.last)) + '</b> (' + esc(prCharLabel(u.last)) + ') \u2713'; }
    return 'idle \u00b7 high. Press <b>Send byte</b> to walk the frame.';
  }
  function prUartCode() {
    var u = protos.uart, brr = Math.round(u.clk / u.baud), L = [];
    L.push('/* USART1: ' + (u.clk / 1e6) + ' MHz kernel clock, ' + u.baud + ' baud */');
    L.push('USART1->BRR = ' + brr + 'u;   /* USARTDIV = fCK / baud */');
    var cr1 = 'USART1->CR1 = USART_CR1_UE | USART_CR1_TE | USART_CR1_RE';
    if (u.parity !== 'none') { cr1 += '\n                 | USART_CR1_PCE' + (u.parity === 'odd' ? ' | USART_CR1_PS' : ''); }
    L.push(cr1 + ';   /* enable, TX+RX' + (u.parity !== 'none' ? ', ' + u.parity + ' parity' : '') + ' */');
    L.push(u.stop === 1 ? 'USART1->CR2 &= ~USART_CR2_STOP;   /* 1 stop bit (reset) */' : 'USART1->CR2 |=  USART_CR2_STOP_1;   /* 2 stop bits */');
    L.push('while ((USART1->SR & USART_SR_TXE) == 0) { }   /* wait for a free data register */');
    L.push('USART1->DR = ' + esc(prHex(u.char)) + 'u;   /* start + ' + u.data + ' data + ' + (u.parity !== 'none' ? 'parity + ' : '') + u.stop + ' stop */');
    return L.join('\n');
  }

  /* ---- stage 3: sampling + baud mismatch ---- */
  function prSampleCtlCard() {
    var u = protos.uart;
    return '<section class="pf-card"><h3>The receiver\'s clock<span class="pf-sub">same ' + u.baud + ' Bd intent, a slightly-off oscillator</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">Baud error</span><input type="range" id="pr-drift" min="-40" max="40" step="2" value="' + u.drift + '"/><b class="pr-read" style="margin:0">' + u.drift + '%</b></div>' +
      '<div class="pr-ctlrow"><button type="button" class="btn" id="pr-newbyte">⟳ New byte</button>' +
        '<button type="button" class="btn" id="pr-send3"' + (u.tx ? ' disabled' : '') + '>▶ Send byte</button>' +
        '<span class="lbl" id="pr-bytelab">' + esc(prHex(u.char)) + ' · \'' + esc(prCharLabel(u.char)) + '\'</span></div>' +
      '<p class="pf-hint">The receiver has no clock wire — it <b>counts</b>. After the start edge it waits half a bit, then samples at each bit centre. A wrong baud makes every sample land a little off, and the error <b>accumulates</b>: the far bits cross a boundary first and get the wrong voltage. Slide until a dot goes red.</p></section>';
  }
  function prSampleTrace() {
    var u = protos.uart, a = prUartLive();
    if (a) { return { ch: a.tx.ch, bits: a.tx.bits, drift: a.tx.drift, playIdx: Math.min(Math.floor(a.pos), a.tx.bits.length), a: a }; }
    var ch = u.tx ? u.tx.ch : u.char;
    return { ch: ch, bits: u.tx ? u.tx.bits : prUartBits(u, ch), drift: u.drift, playIdx: u.tx ? u.tx.idx : null, a: null };
  }
  function prSampleReadHtml() {
    var u = protos.uart, t = prSampleTrace(), dec = prDecode(t.bits, u, t.drift), a = t.a;
    return prReviewTag(a) + 'sent <b>' + esc(prHex(t.ch)) + "</b> \u2192 received <b class=\"" + (dec.ok ? 'good' : 'bad') + '">' + esc(prHex(dec.ch)) + '</b> (' + esc(prCharLabel(dec.ch)) + ') \u00b7 mis-sampled bits <b class="' + (dec.mis ? 'bad' : 'good') + '">' + dec.mis + '</b>' + (dec.ok ? ' \u00b7 <span class="good">\u2713 clean</span>' : ' \u00b7 <span class="bad">\u2717 corrupted</span>') + (a && a.review ? prScrubUartHtml(a.tx, Math.floor(a.pos)) : '');
  }
  function prSampleShowCard() {
    var t = prSampleTrace();
    return '<section class="pf-card"><h3>Sampling points<span class="pf-sub">dots = where the receiver reads each bit</span></h3>' +
      '<div id="pr-la-host">' + prLA({ bits: t.bits, playIdx: t.playIdx, showSamples: true, drift: t.drift }) + '</div>' +
      '<div class="pr-read" id="pr-smp-read">' + prSampleReadHtml() + '</div></section>';
  }

  /* ---- stage 4: terminal ---- */
  function prTermCtlCard() {
    var u = protos.uart;
    return '<section class="pf-card"><h3>Line settings<span class="pf-sub">shared across the whole lab</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">Baud</span>' + prSeg('baud', [{ v: '1200', t: '1200' }, { v: '9600', t: '9600' }, { v: '38400', t: '38400' }, { v: '115200', t: '115200' }], String(u.baud)) + '</div>' +
      '<div class="pr-ctlrow"><span class="lbl">Baud error</span><input type="range" id="pr-drift" min="-40" max="40" step="2" value="' + u.drift + '"/><b class="pr-read" style="margin:0">' + u.drift + '%</b>' + (u.drift !== 0 ? ' <span class="pr-level float">expect garbage</span>' : ' <span class="pr-level low">perfect clock</span>') + '</div>' +
      '<p class="pf-hint">Parity is still whatever you left in stage 2 (<b>' + u.parity + '</b>), stop <b>' + u.stop + '</b>. Divisor BRR = ' + Math.round(u.clk / u.baud) + '. Push the baud error here and good keys turn to corruption — the same garble a scope shows when someone mis-set the clock tree.</p></section>';
  }
  function prTermRowHtml(e) {
    return '<div class="row' + (e.ok ? '' : ' bad') + '"><span class="k">' + esc(e.sent) + '</span><span class="got">' + esc(e.got) + '</span><span class="k">' + (e.ok ? '✓' : '✗') + '</span></div>';
  }
  function prTermCard() {
    var u = protos.uart;
    var rows = protos.rxLog.map(prTermRowHtml).join('');
    return '<section class="pf-card"><h3>Serial terminal<span class="pf-sub">type · press Enter · each char is a frame</span></h3>' +
      '<div id="pr-la-host">' + prLA(prLaCfg()) + '</div>' +
      '<div class="pr-term" id="pr-term">' + (rows || '<div class="row"><span class="k">— no traffic yet —</span><span></span><span></span></div>') + '</div>' +
      '<div class="pr-termin"><input id="pr-type" type="text" autocomplete="off" spellcheck="false" maxlength="64" placeholder="type characters and press Enter to send…"/><button type="button" class="btn" id="pr-clear">Clear</button></div></section>';
  }
  function prAppendTermRow() {
    var t = document.getElementById('pr-term'); if (!t) { return; }
    var e = protos.rxLog[0]; if (!e) { return; }
    if (t.textContent.indexOf('no traffic') >= 0) { t.innerHTML = ''; }
    var div = document.createElement('div');
    div.innerHTML = prTermRowHtml(e);
    t.insertBefore(div.firstChild, t.firstChild);
  }

  /* ---- I2C (stages 5 + 6): the wire is a shared AND; every transfer opens with an address ---- */
  function prI2cBit(v, i) { return (v >>> (6 - i)) & 1; }
  function prAddrByte(addr, rw) { return ((addr & 0x7f) << 1) | (rw & 1); }
  var PR_I2C_SLAVE = 0x50;

  function prI2cMasters(m1val, m2val) {
    var slots = [{ sda: 1, scl: 1, lab: 'S', kind: 'start' }], lostAt = -1;
    for (var i = 0; i < 8; i++) {
      var w1 = prI2cBit(m1val, i), w2 = prI2cBit(m2val, i);
      var bus = w1 & w2, loser = null;
      if (lostAt < 0 && w1 === 1 && bus === 0) { loser = 'M1'; lostAt = i; }
      else if (lostAt < 0 && w2 === 1 && bus === 0) { loser = 'M2'; lostAt = i; }
      slots.push({ sda: bus, scl: 1, lab: i < 7 ? 'A' + (6 - i) : 'R/W', kind: loser ? 'lost' : 'data', loser: loser, w1: w1, w2: w2, bus: bus });
    }
    slots.push({ sda: 0, scl: 1, lab: 'A', kind: 'ack' });
    slots.push({ sda: 1, scl: 0, lab: 'P', kind: 'stop' });
    return { slots: slots, lostAt: lostAt };
  }

  function prI2cTxSlots(addr, rw, acked, includeData) {
    var slots = [{ sda: 1, scl: 1, lab: 'S', kind: 'start' }], ab = prAddrByte(addr, rw), i;
    for (i = 0; i < 8; i++) { slots.push({ sda: prI2cBit(ab, i), scl: 1, lab: i < 7 ? 'A' + (6 - i) : 'R/W', kind: 'data' }); }
    slots.push({ sda: acked ? 0 : 1, scl: 1, lab: acked ? 'ACK' : 'NACK', kind: acked ? 'ack' : 'nack' });
    if (includeData) {
      for (i = 0; i < 8; i++) { slots.push({ sda: prI2cBit(0xA5, i), scl: 1, lab: 'D' + (7 - i), kind: 'data' }); }
      slots.push({ sda: 0, scl: 1, lab: 'A', kind: 'ack' });
    }
    slots.push({ sda: 1, scl: 0, lab: 'P', kind: 'stop' });
    return slots;
  }

  function prI2cSrSlots(addr, acked) {
    var slots = prI2cTxSlots(addr, 0, acked, true).slice(0, -1);
    slots.push({ sda: 0, scl: 1, lab: 'S', kind: 'start' });
    slots.push({ sda: 0, scl: 1, lab: 'Sr', kind: 'restart' });
    var rab = prAddrByte(addr, 1);
    for (var i = 0; i < 8; i++) { slots.push({ sda: prI2cBit(rab, i), scl: 1, lab: i < 7 ? 'A' + (6 - i) : 'R/W', kind: 'data' }); }
    slots.push({ sda: acked ? 0 : 1, scl: 1, lab: acked ? 'ACK' : 'NACK', kind: acked ? 'ack' : 'nack' });
    for (i = 0; i < 8; i++) { slots.push({ sda: prI2cBit(0x2C, i), scl: 1, lab: 'D' + (7 - i), kind: 'data' }); }
    slots.push({ sda: 1, scl: 1, lab: 'M', kind: 'ack' });
    slots.push({ sda: 1, scl: 0, lab: 'P', kind: 'stop' });
    return slots;
  }

  function prI2cGeom(n) {
    return { n: n, left: 40, right: 8, W: 300, cw: (300 - 48) / n, play: 'pr-i2c-play' };
  }

  var _prPlay = null;
  function prPlaySetup(g) { _prPlay = { id: g.play, left: g.left, cw: g.cw, n: g.n }; }
  function prPts(slots, get, yH, yL, left, cw) {
    var pts = '', prevY = yH;
    for (var i = 0; i < slots.length; i++) {
      var y = get(slots[i]) ? yH : yL, x0 = left + i * cw, x1 = x0 + cw;
      pts += x0.toFixed(1) + ',' + prevY + ' ' + x0.toFixed(1) + ',' + y + ' ' + x1.toFixed(1) + ',' + y + ' ';
      prevY = y;
    }
    return pts.trim();
  }
  function prIAL2(slots, opt) {
    var n = slots.length, g = prI2cGeom(n), W = g.W, left = g.left, cw = g.cw;
    prPlaySetup(g);
    var scl = prPts(slots, function (s) { return s.scl; }, 30, 48, left, cw);
    var sda = prPts(slots, function (s) { return s.sda; }, 64, 86, left, cw);
    var i, grid = '';
    for (i = 1; i < n; i++) { var gx = (left + i * cw).toFixed(1); grid += '<line class="grid" x1="' + gx + '" y1="24" x2="' + gx + '" y2="118"/>'; }
    var boxes = '';
    for (i = 0; i < n; i++) {
      var bx = left + i * cw;
      boxes += '<rect class="segbox ' + slots[i].kind + '" x="' + (bx + 0.5).toFixed(1) + '" y="98" width="' + (cw - 1).toFixed(1) + '" height="20"/>' +
        '<text class="seglab" x="' + (bx + cw / 2).toFixed(1) + '" y="111">' + esc(slots[i].lab) + '</text>';
    }
    var px = (left + Math.max(0, Math.min(opt.playIdx == null ? 0 : opt.playIdx, n)) * cw).toFixed(1);
    var playAttr = opt.playId === _prPlay.id ? ' x1="' + px + '" x2="' + px + '"' : '';
    var play = '<line id="' + _prPlay.id + '" class="play"' + playAttr + ' opacity="' + (opt.playIdx == null ? '0' : '1') + '" y1="18" y2="120"/>';
    return '<div class="pr-la"><svg viewBox="0 0 ' + W + ' 150">' +
      '<text class="clab" x="5" y="43">SCL</text><text class="clab" x="5" y="79">SDA</text>' +
      '<polyline class="trace scl2" points="' + scl + '"/>' +
      '<polyline class="trace" points="' + sda + '"/>' +
      grid + boxes + play + '</svg></div>';
  }

  function prI2cLive() { return prViewOf('i2c'); }
  function prI2cBanner(slots, res) {
    var a = prI2cLive(), i;
    if (a) { return prReviewTag(a) + 't = <b>' + Math.min(Math.floor(a.pos), slots.length) + '/' + slots.length + '</b> clocks \u00b7 ' + (a.review ? 'you are standing at this clock' + prScrubI2cHtml(slots, Math.floor(a.pos)) : 'watch the table fill as the line resolves'); }
    if (res == null) { return 'idle \u2014 the pull-ups hold both lines high. Press send.'; }
    if (res.lostAt != null) {
      var txt = 'Arbitration over at <b>A' + (6 - res.lostAt) + '</b>: ' + (res.loser === 'M1' ? 'M1' : 'M2') + ' wanted 1, read 0 back \u2014 it drops out. <b>' + (res.loser === 'M1' ? 'M2' : 'M1') + ' owns the bus</b> and the slave ACKs.';
      for (i = 0; i < slots.length; i++) { if (slots[i].loser) { txt += ' <span class="bad">(marker: slot ' + (i + 1) + ')</span>'; break; } }
      return txt;
    }
    return res.rw === 0 ? 'EEPROM 0x50 saw its own byte <b>0x' + prAddrByte(res.addr, 0).toString(16).toUpperCase() + '</b> and ACKed (SDA held low at clock 9). The sensor at 0x3C stayed deaf.' : 'EEPROM 0x50 ACKed the <b>read</b> address \u2014 now <em>it</em> drives the data byte.';
  }

  function prI2cCtlCard() {
    var u = protos.i2c;
    return '<section class="pf-card"><h3>Two masters, one wire<span class="pf-sub">both start talking at once</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">M1 address</span><input id="pr-i2c-m1" size="4" maxlength="2" value="' + u.m1val.toString(16).toUpperCase() + '"/>' +
        '<span class="lbl">M2 address</span><input id="pr-i2c-m2" size="4" maxlength="2" value="' + u.m2val.toString(16).toUpperCase() + '"/></div>' +
      '<div class="pr-ctlrow"><button type="button" class="btn" id="pr-i2c-send"' + (u.tx ? ' disabled' : '') + '>\u25b6 Send both (watch them fight)</button>' +
        '<button type="button" class="btn mini" data-i2cpair="50,40">0x50 vs 0x40</button>' +
        '<button type="button" class="btn mini" data-i2cpair="50,50">identical</button>' +
        '<button type="button" class="btn mini" data-i2cpair="40,50">M2 first</button></div>' +
      '<p class="pf-hint">Both masters send a START, then their address byte MSB-first, <b>open-drain</b> \u2014 the wire is the AND of whatever the two drivers allow. The first clock where one wants <b>1</b> and the other sinks <b>0</b> decides the winner: the loser sees its own 1 come back as 0 and drops off mid-byte, never disturbing the transfer.</p></section>';
  }
  function prI2cBusCard() {
    var u = protos.i2c, lvl = prWireResolve(u.aOut, u.bOut);
    var svg = '<svg viewBox="0 0 300 64">' +
      '<line class="rail" x1="40" y1="32" x2="260" y2="32"/>' +
      '<line class="rail" x1="70" y1="32" x2="70" y2="46"/><rect class="res' + (u.aOut ? '' : ' act') + '" x="58" y="46" width="24" height="16"/><text class="lab" x="70" y="57" text-anchor="middle">M1</text>' +
      '<line class="rail" x1="230" y1="32" x2="230" y2="46"/><rect class="res' + (u.bOut ? '' : ' act') + '" x="218" y="46" width="24" height="16"/><text class="lab" x="230" y="57" text-anchor="middle">M2</text>' +
      '<circle class="node ' + lvl + '" cx="150" cy="32" r="9"/><text class="lab" x="150" y="18" text-anchor="middle">SDA = ' + lvl.toUpperCase() + '</text></svg>';
    return '<section class="pf-card"><h3>Hand-drive the AND<span class="pf-sub">become both masters yourself</span></h3><div class="pr-wire">' + svg + '</div>' +
      '<div class="pr-ctlrow">' +
        '<button type="button" class="btn" data-i2ca="' + (u.aOut ? 0 : 1) + '" aria-pressed="' + String(!!u.aOut) + '">M1: ' + (u.aOut ? 'wants 1 (released)' : 'sinks 0') + '</button>' +
        '<button type="button" class="btn" data-i2cb="' + (u.bOut ? 0 : 1) + '" aria-pressed="' + String(!!u.bOut) + '">M2: ' + (u.bOut ? 'wants 1 (released)' : 'sinks 0') + '</button>' +
        '<span class="pr-level ' + lvl + '">SDA = ' + lvl.toUpperCase() + '</span></div>' +
      '<p class="pf-hint">The line is high only while <b>both</b> let go. This exact wiring is what the animation above resolves one clock at a time \u2014 and it is why a losing master can drop out at any bit without damaging the winner\u2019s byte.</p></section>';
  }
  function prI2cWaveCard() {
    var u = protos.i2c, a = prI2cLive();
    var res = u.result && u.result.kind === 'masters' ? u.result : null;
    var slots = a ? a.tx.slots : res ? res.slots : prI2cMasters(u.m1val, u.m2val).slots;
    return '<section class="pf-card"><h3>Logic analyser<span class="pf-sub">SCL + SDA, decode band under every clock</span></h3>' +
      prIAL2(slots, { playIdx: a ? Math.min(Math.floor(a.pos), slots.length) : (res ? null : 0), playId: 'pr-i2c-play' }) +
      '<div class="pr-read" id="pr-i2c-read">' + prI2cBanner(slots, res) + '</div></section>';
  }
  function prI2cTableCard() {
    var u = protos.i2c, a = prI2cLive();
    var res = u.result && u.result.kind === 'masters' ? u.result : null;
    var slots = a ? a.tx.slots : res ? res.slots : prI2cMasters(u.m1val, u.m2val).slots;
    var upto = a ? Math.min(Math.floor(a.pos), slots.length) : slots.length;
    var rows = '', i;
    for (i = 1; i <= 8; i++) {
      var s = slots[i], settled = i < upto || (i === upto && (!a || a.review));
      rows += '<tr' + (a && i === Math.floor(a.pos) ? ' class="cur"' : '') + '><td class="k">' + (i <= 7 ? 'A' + (7 - i) : 'R/W') + '</td><td>' + (s.w1 != null ? s.w1 : '?') + '</td><td>' + (s.w2 != null ? s.w2 : '?') + '</td>' +
        '<td class="' + (s.loser ? 'bad' : 'good') + '">' + (settled && s.bus != null ? s.bus : '?') + (settled && s.loser ? ' \u2190 ' + s.loser + ' loses' : '') + '</td></tr>';
    }
    return '<section class="pf-card" id="pr-i2c-table"><h3>Bit by bit<span class="pf-sub">intent vs what the wire says</span></h3>' +
      '<table class="pr-bit tbl"><tr><th>clock</th><th>M1 wants</th><th>M2 wants</th><th>wire reads</th></tr>' + rows + '</table>' +
      '<p class="pf-hint">The moment a driver reads back <b>0</b> while sending <b>1</b>, it knows another master is sinking the line \u2014 and quits between clocks. Nobody resets anybody; the wire itself is the arbiter.</p></section>';
  }
  function prI2cStage5() {
    return prCols(
      prTeach('The shared wire decides, politely',
        '<p>Two masters can start talking at the same instant \u2014 I\u00b2C survives that because every driver is <b>open-drain</b> (exactly the stage-1 rig) and the line is a <b>wired-AND</b>: a 0 from anyone wins. Each sender compares every bit it drives against the bit it <em>reads</em>; the first time it sends 1 and sees 0, it backs off for good. No reset, no priority list \u2014 the address itself is the priority, because the byte diverges at the first 0-bit.</p>' +
        '<p>Send 0x50 against 0x40 and watch where the table turns red: the data collides at bit A4 (0x5 = 101, 0x4 = 100 \u2014 one of them is a 1 where the other sinks a 0). The loser simply stops driving; the winner never notices a thing.</p>') +
      prI2cCtlCard() + prI2cBusCard(),
      prI2cWaveCard() + prI2cTableCard(),
      prGoalCard(5) + prCodeCard('This is what the winner ships', PR_I2C_CODE_STATIC) + prLogCard());
  }

  function prI2cAddrCtlCard() {
    var u = protos.i2c;
    return '<section class="pf-card"><h3>Who is this for?<span class="pf-sub">the bus has one talker and many listeners</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">7-bit address</span><input id="pr-i2c-addr" size="4" maxlength="2" value="' + u.addr.toString(16).toUpperCase() + '"/>' +
        '<span class="lbl">R/W</span>' + prSeg('i2crw', [{ v: '0', t: 'write' }, { v: '1', t: 'read' }], String(u.rw)) + '</div>' +
      '<div class="pr-ctlrow"><button type="button" class="btn" id="pr-i2c-send6"' + (u.tx ? ' disabled' : '') + '>\u25b6 Send START + address</button>' +
        '<button type="button" class="btn" id="pr-i2c-sr"' + (u.tx ? ' disabled' : '') + '>\u21ba Repeated start: write, then read</button></div>' +
      '<div class="pr-ctlrow"><button type="button" class="btn mini" data-i2caddr="50">EEPROM 0x50 (present)</button>' +
        '<button type="button" class="btn mini" data-i2caddr="3c">sensor 0x3C (present)</button>' +
        '<button type="button" class="btn mini" data-i2caddr="77">0x77 (nobody home)</button></div>' +
      '<p class="pf-hint">Every I\u00b2C transaction opens the same way: START, then a <b>7-bit address + one R/W bit</b> packed into the first byte on the wire \u2014 the byte you see in datasheets as <code>0xA0</code> is really <code>0x50 &lt;&lt; 1 | write</code>. All slaves listen; only the named one answers clock 9 by sinking SDA (<b>ACK</b>). Silence (<b>NACK</b>) means nobody lives there, and the master aborts with a STOP.</p></section>';
  }
  function prI2cAddrWaveCard() {
    var u = protos.i2c, a = prI2cLive();
    var res = u.result && u.result.kind !== 'masters' ? u.result : null;
    var slots = a ? a.tx.slots : res ? res.slots : prI2cTxSlots(u.addr, u.rw, u.addr === PR_I2C_SLAVE, false);
    return '<section class="pf-card" id="pr-i2c-wavecard">' +
      '<h3>Logic analyser<span class="pf-sub">' + esc(prHex(prAddrByte(u.addr, u.rw))) + ' on the wire = addr ' + esc(prHex(u.addr)) + ' + R/W ' + u.rw + '</span></h3>' +
      prIAL2(slots, { playIdx: a ? Math.min(Math.floor(a.pos), slots.length) : (res ? null : 0), playId: 'pr-i2c-play' }) +
      '<div class="pr-read" id="pr-i2c-read">' + prI2cAddrBanner(slots, res) + '</div></section>';
  }
  function prI2cAddrBanner(slots, res) {
    var a = prI2cLive(), i;
    if (a) { return prReviewTag(a) + 't = <b>' + Math.min(Math.floor(a.pos), slots.length) + '/' + slots.length + '</b> clocks \u00b7 all but one listener is already silent' + (a.review ? prScrubI2cHtml(slots, Math.floor(a.pos)) : ''); }
    if (res == null) { return 'idle \u2014 SCL and SDA rest high on their pull-ups.'; }
    var ackSlot = -1;
    for (i = 0; i < slots.length; i++) { if (slots[i].kind === 'ack' || slots[i].kind === 'nack') { ackSlot = i; break; } }
    if (res.kind === 'nack') { return 'Address byte <b>' + esc(prHex(prAddrByte(res.addr, res.rw))) + '</b> sent \u2014 clock 9: SDA stays <b>high</b>. <span class="bad">NACK: nobody named 0x' + res.addr.toString(16).toUpperCase() + ' on this bus.</span> Master issues STOP and tries nothing further.'; }
    if (res.kind === 'sr') { return 'Write phase ACKed \u2192 <b>repeated START</b> without releasing the bus \u2192 read address ACKed \u2192 the EEPROM clocks 0x2C back to the master \u2192 master NACKs the last byte (\u201cthat\u2019s all\u201d) \u2192 STOP. One claim, two phases \u2014 exactly how a register read is built.'; }
    return 'Address byte <b>' + esc(prHex(prAddrByte(res.addr, res.rw))) + '</b> sent \u2014 clock 9: <span class="good">ACK (SDA pulled low by 0x' + res.addr.toString(16).toUpperCase() + ')</span>. The named slave is now listening for the data byte.';
  }
  function prI2cSlavesCard() {
    var u = protos.i2c;
    var res = u.result && u.result.kind !== 'masters' ? u.result : null;
    function row(name, addr, present) {
      var hearing = res ? (res.addr === addr) : (u.addr === addr);
      var state = !res ? (present ? 'listening' : 'listening') : (res.addr === addr ? (res.kind === 'nack' ? '<span class="bad">NACK \u2014 empty slot</span>' : '<span class="good">ACK \u2014 it answers</span>') : (present ? 'silent \u2014 not its number' : 'silent'));
      return '<tr><td>' + name + '</td><td class="k">0x' + addr.toString(16).toUpperCase() + '</td><td>' + state + '</td></tr>';
    }
    return '<section class="pf-card"><h3>Who answers?\u00b7<span class="pf-sub">every slave compares clock-by-clock</span></h3>' +
      '<table class="pr-bit tbl"><tr><th>device</th><th>address</th><th>this transfer</th></tr>' +
      row('EEPROM', PR_I2C_SLAVE, true) + row('temp sensor', 0x3c, true) + row('slot 0x77', 0x77, false) + '</table>' +
      '<p class="pf-hint">A slave that sees its own address ACKs and starts listening for data; one that doesn\u2019t goes completely deaf until the next START. A <b>general call</b> (address 0x00) is the exception \u2014 everyone ACKs, no data follows. That\u2019s the entire addressing protocol; everything else is data.</p></section>';
  }
  function prI2cStage6() {
    return prCols(
      prTeach('Address, then data, then done',
        '<p>Stage 5 decided <em>who</em> talks; stage 6 is <em>to whom</em>. After arbitration (or a quiet bus), the winner emits START and the first byte: <b>7-bit address + R/W</b>. This is the whole reason HAL calls take <code>0xA0</code> where the datasheet headline says <code>0x50</code> \u2014 one value on the wire, one value in prose. The 9th clock belongs to the <em>receiver</em>: the addressed slave sinks SDA for ACK or leaves it high for NACK.</p>' +
        '<p>A <b>repeated start</b> (Sr) is the last trick: to read a register you write the register address, then Sr, then the same slave address with R/W=1 \u2014 without ever releasing the bus, so no other master can interleave between the two phases. Send a bad address and feel the NACK; send Sr and watch one claim span two directions.</p>') +
      prI2cAddrCtlCard(),
      prI2cAddrWaveCard() + prI2cSlavesCard(),
      prGoalCard(6) + prCodeCard('The two levels of the same transaction', PR_I2C_CODE_TWO) + prLogCard());
  }

  /* ---- playback: one position, three sources ----
     _prAnim owns the wire while a transfer travels it; _prCap keeps that same
     record after it ends so the learner can walk it back bit by bit, and _prPos
     is where the scrubber parked it. Every renderer asks prView() instead of
     asking "is it still running?", so review needs no second code path. */
  var _prAnim = null;
  var _prCap = null;
  var _prPos = null;
  var PR_STEP_I2C = 0.55, PR_STEP_SPI = 0.5, PR_STEP_RING = 0.34;
  /* protos.speed is the multiplier itself, so an old saved state without it just runs at 1x */
  function prSpeedMul() { return protos.speed === 0.5 || protos.speed === 0.25 ? protos.speed : 1; }
  function prSpeedLabel() { return protos.speed === 0.25 ? '1/4\u00d7' : protos.speed === 0.5 ? '1/2\u00d7' : '1\u00d7'; }
  function prSpeedStep() { protos.speed = prSpeedMul() === 1 ? 0.5 : prSpeedMul() === 0.5 ? 0.25 : 1; }
  function prAnimStop() { _prAnim = null; _prCap = null; _prPos = null; }

  /* a capture goes stale the moment its inputs move out from under it */
  function prUartSig() { var u = protos.uart; return 'u' + protos.stage + ':' + u.data + u.parity + u.stop + ':' + u.char + ':' + u.drift; }
  function prI2cSig() { var u = protos.i2c; return 'i' + protos.stage + ':' + (protos.stage === 5 ? u.m1val + ',' + u.m2val : u.addr + ',' + u.rw); }
  function prSpiSig() { var u = protos.spi; return protos.stage === 9 ? 's9:' + u.byte : 's8:' + u.mMode + ',' + u.sMode + ',' + u.byte; }
  function prLiveSig(kind) { return kind === 'uart' ? prUartSig() : kind === 'i2c' ? prI2cSig() : prSpiSig(); }
  function prCap() {
    if (!_prCap) { return null; }
    if (_prCap.stage !== protos.stage || _prCap.sig !== prLiveSig(_prCap.kind)) { _prCap = null; _prPos = null; return null; }
    return _prCap;
  }
  function prScrub() {
    var c = _prPos === null ? null : prCap();
    if (!c) { return null; }
    return { kind: c.kind, pos: _prPos, total: c.total, unit: c.unit, step: c.step, tx: c.tx, review: true };
  }
  function prView() { return _prAnim || prScrub(); }
  function prViewOf(kind) { var v = prView(); return v && v.kind === kind ? v : null; }
  function prUartLive() { return prViewOf('uart'); }
  function prReviewTag(v) {
    return v && v.review ? '<span class="pr-revt">\u23ea review</span> ' : '';
  }
  /* starting a transfer retires the trace you were reviewing, so the scrub bar
     only ever describes a transfer that is genuinely finished */
  function prBeginPlay() { _prCap = null; _prPos = null; }

  /* ---- the scrubber: walk a finished transfer one bit at a time ---- */
  function prScrubPos() { var c = prCap(); return c ? (_prPos === null ? c.total : _prPos) : 0; }
  function prSetPos(p) {
    var c = prCap(); if (!c) { return; }
    _prPos = Math.max(0, Math.min(c.total, Math.round(p)));
    prSyncScrub();
    prRenderLive();
  }
  function prStopScrub() { _prPos = null; prRenderStatic(); }
  function prSyncScrub() {
    var s = document.getElementById('pr-scrub'); if (s) { s.value = String(prScrubPos()); }
    var l = document.getElementById('pr-scrubpos'); if (l) { l.innerHTML = prScrubLabel(); }
  }
  function prScrubUnit(c) {
    if (c.kind === 'uart') { return 'bit'; }
    if (c.kind === 'i2c') { return 'clock'; }
    return c.tx && c.tx.kind === 'ring' ? 'clock' : 'half-step';
  }
  function prScrubLabel() {
    var c = prCap(); if (!c) { return ''; }
    if (_prPos === null) { return '<b>end</b> \u00b7 drag to walk it'; }
    return '<b>' + prScrubPos() + '/' + c.total + '</b> ' + prScrubUnit(c);
  }
  function prScrubBar() {
    var speed = '<button type="button" class="btn mini" id="pr-speed" title="animation speed (1\u00d7 \u2192 \u00bd \u2192 \u00bc)">' + prSpeedLabel() + ' speed</button>';
    var c = prCap();
    if (!c) { return speed; }
    var name = (prStageById(c.stage) || {}).name || '';
    return speed + '<span class="pr-scrub" role="group" aria-label="Trace position">' +
      '<span class="pr-scrubl">' + esc(name) + '</span>' +
      '<button type="button" class="btn mini" id="pr-step-back" title="one step back ( , )">\u23f4</button>' +
      '<input type="range" id="pr-scrub" min="0" max="' + c.total + '" step="1" value="' + prScrubPos() + '" aria-label="Trace position"/>' +
      '<button type="button" class="btn mini" id="pr-step-fwd" title="one step forward ( . )">\u23f5</button>' +
      '<b class="pr-scrubpos" id="pr-scrubpos" aria-live="polite">' + prScrubLabel() + '</b>' +
      (prView() ? '<button type="button" class="btn mini" id="pr-live" title="follow the wire again">\u25b8 live</button>' : '') +
      '</span>';
  }

  /* ---- keyboard: one table feeds the handler and the cheatsheet ---- */
  var PR_KEY_SEND = ['pr-send', 'pr-send3', 'pr-i2c-send', 'pr-i2c-send6', 'pr-spi-send', 'pr-spi-xfer'];
  var _prKeys = false;
  function prKeysOpen() { return _prKeys; }
  function prKeyLabel(k) {
    var names = { ' ': 'space', ArrowLeft: '\u2190', ArrowRight: '\u2192', ArrowUp: '\u2191', ArrowDown: '\u2193', Escape: 'esc' };
    return names[k] || k;
  }
  function prPress(id) {
    var b = document.getElementById(id);
    if (!b || b.disabled) { return false; }
    b.click();
    return true;
  }
  function prSendKey() { for (var i = 0; i < PR_KEY_SEND.length; i++) { if (prPress(PR_KEY_SEND[i])) { return; } } }
  function prStageSlot() {
    var list = prStagesInFam(prFamOfStage(protos.stage)), i;
    for (i = 0; i < list.length; i++) { if (list[i].id === protos.stage) { return i; } }
    return 0;
  }
  function prStageStep(d) {
    var list = prStagesInFam(prFamOfStage(protos.stage)), i = prStageSlot() + d;
    if (i < 0 || i >= list.length) { return; }
    prGoStage(list[i].id); prFocusTab(list[i].id);
  }
  function prFamStep(d) {
    var fam = prFamOfStage(protos.stage), i;
    for (i = 0; i < PR_FAMILIES.length; i++) { if (PR_FAMILIES[i].id === fam) { break; } }
    var next = PR_FAMILIES[i + d]; if (!next) { return; }
    var first = prStagesInFam(next.id)[0]; if (!first) { return; }
    prGoStage(first.id); prFocusTab(first.id);
  }
  function prScrubStep(d) { if (!prCap()) { return; } prSetPos(prScrubPos() + d); }
  /* the runbar buttons and the keyboard share these, so neither can drift */
  function prToggleRun() { protos.running = !protos.running; prSave(); prRenderStatic(); }
  function prResetLab() {
    var keep = protos.stage;
    prAnimStop();
    protos = prDefaults(); protos.stage = keep;
    prSeedLog(); prSave(); prRenderStatic();
  }
  function prToggleKeys(on) {
    _prKeys = on === undefined ? !_prKeys : !!on;
    prRenderStatic();
    /* the runbar was rebuilt, so hand focus back to the button that opens this */
    var t = document.getElementById('pr-keys-btn'); if (t) { t.focus(); }
  }
  var PR_KEYMAP = [
    { key: 'ArrowLeft', label: 'previous stage in this family', run: function () { prStageStep(-1); } },
    { key: 'ArrowRight', label: 'next stage in this family', run: function () { prStageStep(1); } },
    { key: 'ArrowUp', label: 'previous protocol family', run: function () { prFamStep(-1); } },
    { key: 'ArrowDown', label: 'next protocol family', run: function () { prFamStep(1); } },
    { key: ' ', label: 'run / pause the simulation', run: prToggleRun },
    { key: 's', label: 'send, on whatever this stage sends', run: prSendKey },
    { key: 'r', label: 'reset the lab', run: prResetLab },
    { key: ',', label: 'step the captured trace back one bit / clock', when: prCap, run: function () { prScrubStep(-1); } },
    { key: '.', label: 'step the captured trace forward one', when: prCap, run: function () { prScrubStep(1); } },
    { key: '?', label: 'show or hide this list', run: function () { prToggleKeys(); } },
    { key: 'Escape', label: 'hide this list', when: prKeysOpen, run: function () { prToggleKeys(false); } }
  ];
  /* typing anywhere wins over a shortcut: the terminal, the hex boxes, the sliders */
  function prKeyTyping(t) {
    if (!t || !t.tagName) { return false; }
    var tag = t.tagName.toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') { return true; }
    if (t.isContentEditable) { return true; }
    return tag === 'INPUT' && t.type !== 'range';
  }
  function prKeyOnRange(t) {
    return !!t && !!t.tagName && t.tagName.toUpperCase() === 'INPUT' && t.type === 'range';
  }
  function prKeysHandle(e) {
    if (currentView !== 'protocols' || e.ctrlKey || e.metaKey || e.altKey) { return; }
    if (prKeyTyping(e.target)) { return; }
    /* arrows belong to the slider you are standing on, not to stage navigation */
    if (prKeyOnRange(e.target) && /^Arrow|^Home$|^End$/.test(e.key)) { return; }
    for (var i = 0; i < PR_KEYMAP.length; i++) {
      var k = PR_KEYMAP[i];
      if (k.key !== e.key) { continue; }
      if (k.when && !k.when()) { continue; }
      e.preventDefault();
      k.run(e);
      return;
    }
  }
  function prKeysBtn() {
    return '<button type="button" class="btn mini" id="pr-keys-btn" aria-expanded="' + String(_prKeys) + '" aria-controls="pr-keys" title="keyboard shortcuts ( ? )">? keys</button>';
  }
  function prKeysCard() {
    var rows = PR_KEYMAP.map(function (k) {
      var off = k.when && !k.when();
      return '<tr' + (off ? ' class="dim"' : '') + '><td class="k"><kbd>' + esc(prKeyLabel(k.key)) + '</kbd></td><td>' + esc(k.label) + (off ? ' \u00b7 after a transfer has finished' : '') + '</td></tr>';
    }).join('');
    return '<section class="pf-card" id="pr-keys"><h3>Keyboard<span class="pf-sub">the whole lab is drivable without a mouse</span></h3>' +
      '<table class="pr-bit tbl"><tr><th>key</th><th>what it does</th></tr>' + rows + '</table>' +
      '<p class="pf-hint">Shortcuts are off everywhere else in the app, and inert while you are typing in a field \u2014 the terminal still takes spaces, the hex boxes still take arrows. Sliders keep their own arrow keys too: stand on the trace slider and <b>\u2190 \u2192</b> walks the capture instead of changing stage.</p></section>';
  }

  /* ---- what the scrubber is for: what a receiver had decided by step k ---- */
  function prScrubUartHtml(tx, k) {
    var u = protos.uart, smp = prRxSamples(tx.bits, tx.drift), i, mis = 0;
    for (i = 0; i < smp.length && i < k; i++) { if (smp[i].bad) { mis++; } }
    var at = Math.min(k, smp.length - 1), s = smp[at], off = s ? s.pos - (at + 0.5) : 0;   /* bit-times past the centre it aimed at */
    var ch = 0, got = Math.max(0, Math.min(k - 1, u.data));
    for (i = 0; i < got; i++) { if (smp[1 + i] && smp[1 + i].v) { ch |= (1 << i); } }
    var shown = '';
    for (i = 7; i >= 0; i--) { shown += i < got ? ((ch >>> i) & 1) : '\u00b7'; }
    return ' · receiver so far <b>' + shown + '</b> (' + got + '/' + u.data + ' data bits in, LSB-first)'
      + ' · its sample for bit ' + at + ' sits <b>' + (off >= 0 ? '+' : '') + (off * 100).toFixed(0) + '%</b> of a bit off centre'
      + (Math.abs(off) >= 0.5 ? ' <span class="bad">\u2014 that is a mis-read</span>' : ' <span class="good">\u00b7 still inside the window</span>')
      + (mis ? ' · <span class="bad">' + mis + ' mis-sampled so far</span>' : '');
  }
  function prScrubI2cHtml(slots, k) {
    var s = slots[k];
    if (!s) { return ''; }
    if (s.loser) { return ' \u2694 <b>this is the clock ' + s.loser + ' loses</b> \u2014 it drove 1 and the wire reads 0, so it drops off before the next clock.'; }
    if (s.kind === 'ack') { return ' clock 9 belongs to the <b>receiver</b>: ' + (s.sda ? 'SDA stays high' : 'the slave sinks SDA low') + '.'; }
    if (s.kind === 'nack') { return ' clock 9: nobody sank SDA \u2014 <b>NACK</b>, no device at this address.'; }
    if (s.kind === 'start') { return ' START: SDA falls <em>while SCL is high</em> \u2014 the one transition that means "a transfer is beginning".'; }
    if (s.kind === 'restart') { return ' Sr: a repeated START with no STOP in between \u2014 the master keeps the bus and flips direction.'; }
    if (s.kind === 'stop') { return ' STOP: SDA rises while SCL is high \u2014 the bus is free again.'; }
    return ' driving <b>' + s.sda + '</b>' + (s.w1 != null ? ' \u00b7 M1 wants ' + s.w1 + ', M2 wants ' + s.w2 + ' \u2014 the wire is their AND' : '') + '.';
  }
  function prScrubSpiHtml(tx, k) {
    var bits = prSpiBits(tx.out), cells = '', i, latched = 0, val = 0;
    for (i = 0; i < 8; i++) {
      var p = prSpiSample(tx.m, tx.s, i), seen = k > p;
      cells += seen ? prSpiReadBit(tx.m, tx.s, bits, i) : '\u00b7';
      if (seen) { latched++; val = (val << 1) | prSpiReadBit(tx.m, tx.s, bits, i); }
    }
    return ' · slave has looked at <b>' + latched + '/8</b> windows \u00b7 ' + cells + (latched === 8 ? ' = ' + esc(prHex(val)) : '');
  }

  /* ---- I2C animation + tick ---- */
  function prI2cTick() {
    var st = protos.stage, u = protos.i2c;
    if (!_prAnim || _prAnim.kind !== 'i2c') {
      if ((st === 5 || st === 6) && u.tx) {
        _prAnim = { kind: 'i2c', pos: 0, total: u.tx.slots.length, cur: 0, unit: 1, step: PR_STEP_I2C, tx: u.tx };
        prBeginPlay();
        return true;
      }
      return false;
    }
    if (!protos.running || !u.tx) { _prAnim = null; return false; }
    _prAnim.pos += _prAnim.step * prSpeedMul();
    var k = Math.floor(_prAnim.pos);
    if (k > _prAnim.cur && k <= u.tx.slots.length) { _prAnim.cur = k; }
    if (_prAnim.pos >= _prAnim.total) {
      var tx = u.tx, anim = _prAnim; u.tx = null; _prAnim = null;
      _prCap = { kind: 'i2c', stage: st, pos: anim.total, total: tx.slots.length, unit: 1, step: anim.step, tx: tx, sig: prI2cSig() };
      _prPos = null;
      u.sends++;
      if (tx.kind === 'masters') {
        var lz = null; for (var i = 0; i < tx.slots.length; i++) { if (tx.slots[i].loser) { lz = tx.slots[i].loser; break; } }
        if (tx.lostAt >= 0) {
          u.collisions++;
          u.result = { kind: 'masters', slots: tx.slots, lostAt: tx.lostAt, loser: lz };
          prLog('err', 'arbitration: ' + lz + ' lost at A' + (6 - tx.lostAt) + ' \u2014 dropped off, ' + (lz === 'M1' ? 'M2' : 'M1') + ' finished the byte');
        } else {
          u.result = { kind: 'masters', slots: tx.slots, lostAt: null };
          prLog('note', 'both masters sent the identical byte \u2014 no divergence, no loser; one of them keeps talking and both believe they won (this is not a feature)');
        }
      } else {
        var acked = tx.addr === PR_I2C_SLAVE;
        if (acked) { u.acked++; }
        u.result = { kind: acked ? (tx.sr ? 'sr' : 'ack') : 'nack', slots: tx.slots, addr: tx.addr, rw: tx.rw };
        prLog(acked ? 'ok' : 'err', (acked ? 'ACK from 0x' + tx.addr.toString(16).toUpperCase() : 'NACK \u2014 0x' + tx.addr.toString(16).toUpperCase() + ' is not on this bus') + (tx.sr ? ' (repeated-start transfer)' : ''));
      }
      prSave(); prRenderStatic();
      return true;
    }
    return true;
  }

  function prSpiLive() { return prViewOf('spi'); }

  /* ---- SPI animation + tick ---- */
  function prSpiTick() {
    var st = protos.stage, u = protos.spi;
    if (!_prAnim || _prAnim.kind !== 'spi') {
      if ((st === 8 || st === 9) && u.tx) {
        _prAnim = { kind: 'spi', pos: 0, total: u.tx.kind === 'ring' ? 8 : 16, cur: 0,
                    unit: u.tx.kind === 'ring' ? 2 : 1, step: u.tx.kind === 'ring' ? PR_STEP_RING : PR_STEP_SPI, tx: u.tx };
        prBeginPlay();
        return true;
      }
      return false;
    }
    if (!protos.running || !u.tx) { _prAnim = null; return false; }
    _prAnim.pos += _prAnim.step * prSpeedMul();
    if (_prAnim.pos < _prAnim.total) { return true; }
    var tx = u.tx, anim = _prAnim; u.tx = null; _prAnim = null;
    _prCap = { kind: 'spi', stage: st, pos: anim.total, total: anim.total, unit: anim.unit, step: anim.step, tx: tx, sig: prSpiSig() };
    _prPos = null;
    if (tx.kind === 'modes') {
      var got = prSpiRecv(tx.m, tx.s, prSpiBits(tx.out));
      u.sends++; u.lastGot = got;
      var morph = prSpiMorph(tx.m, tx.s);
      if (morph === 'match') { u.okReads++; } else { u.mismatches++; }
      u.result = { kind: 'modes', sent: tx.out, got: got, morph: morph };
      prLog(morph === 'match' ? 'ok' : 'err', 'mode ' + tx.m + ' master / mode ' + tx.s + ' slave: ' +
        prHex(tx.out) + ' \u2192 ' + prHex(got) + (morph === 'match' ? ' \u2713' : morph === 'marginal' ? ' (sampled on the change edge \u2014 lucky today)' : ' (shifted by one)'));
    } else {
      var before = u.slaveShift, parBefore = u.slavePar;
      u.exchanges++;
      var stale = before !== parBefore;
      if (stale) { u.staleSeen = true; }
      else if (u.staleSeen) { u.freshRead = true; }
      u.masterIn = before;
      u.slaveShift = parBefore;                       /* parallel load at the transfer edge */
      u.result = { kind: 'ring', got: before, out: tx.out, stale: stale };
      prLog(stale ? 'err' : 'ok', 'exchange ' + prHex(tx.out) + ' \u2192 master latched ' + prHex(before) +
        (stale ? ' (stale: the new conversion was still waiting to load)' : ' (fresh \u2014 this is the current measurement)'));
    }
    prSave(); prRenderStatic();
    return true;
  }

  /* ---- goals 5 + 6 ---- */
  var PR_I2C_CODE_STATIC = '/* every I2C driver you will ever ship starts like this */\nI2C1->CR1 |= I2C_CR1_PE;               /* peripheral enable */\nI2C1->CR2 = 8;                          /* 8 MHz kernel clock */\nI2C1->CCR = 40; I2C1->TRISE = 9;        /* ~100 kHz standard mode */\n\n/* start talking: START, then the address byte MSB-first */\nI2C1->CR1 |= I2C_CR1_START;\nwhile ((I2C1->SR1 & I2C_SR1_SB) == 0) { }\nI2C1->DR = (0x50u << 1) | 0u;           /* 0xA0 = 0x50 + write */\n\n/* arbitration is not code you write - it is physics you rely on:\n   drive 1 = release, read the line back; 1 sent / 0 seen = quit. */';
  var PR_I2C_CODE_TWO = '/* the same transaction seen from two altitudes */\n\n/* 1) a register read on a typical sensor */\nuint8_t v = I2C_ReadReg(0x3C, REG_WHO_AM_I);\n\n/* 2) what it expands to on the wire */\nI2C1->CR1 |= I2C_CR1_START;\nI2C1->DR = (0x3Cu << 1) | 0u;           /* 0x78: address + write */\nI2C1->DR = REG_WHO_AM_I;                /* register pointer       */\nI2C1->CR1 |= I2C_CR1_START;             /* Sr: keep the bus, flip */\nI2C1->DR = (0x3Cu << 1) | 1u;           /* 0x79: address + read   */\nv = I2C1->DR;                           /* the slave drives this  */\nI2C1->CR1 |= I2C_CR1_STOP;\n\n/* datasheet address 0x3C; wire byte 0x78 or 0x79. The bus has room\n   for 128 devices, 16 of them reserved. Count them before you buy. */\n\n/* the bus has room for 128 devices (16 reserved) */\n/* HAL convention: it hands you the wire byte, datasheets print the */\n/* 7-bit address: 0xA0 >> 1 = 0x50. One shift, endless confusion. */';


  /* ---- SPI (stages 8 + 9): the sender owns the clock; the shift ring is the whole protocol ---- */
  function prSpiCpol(m) { return (m >> 1) & 1; }
  function prSpiCpha(m) { return m & 1; }
  function prSpiEdge(m) { return (m === 0 || m === 3) ? 'rising' : 'falling'; }
  function prSpiChange(m) { return (m === 0 || m === 3) ? 'falling' : 'rising'; }
  /* half-step timeline: bit i occupies clock period i = [2i, 2i+2). Master puts bit i on
     the line at the launch step; the window is 2 half-steps wide. */
  function prSpiLaunch(m, i) { return 2 * i + (prSpiCpha(m) ? 0 : -1); }
  function prSpiSample(m, s, i) {
    var p = 2 * i + prSpiCpha(s) + (prSpiCpol(m) !== prSpiCpol(s) ? 1 : 0);
    return ((p % 16) + 16) % 16;
  }
  function prSpiReadBit(m, s, bits, i) {
    if (m === s) { return bits[i]; }
    var j = i + Math.floor((prSpiSample(m, s, i) - prSpiLaunch(m, i)) / 2);
    return (j >= 0 && j < bits.length) ? bits[j] : 0;
  }
  function prSpiBits(v) { var b = []; for (var i = 7; i >= 0; i--) { b.push((v >>> i) & 1); } return b; }
  function prSpiFromBits(b) { var v = 0; for (var i = 0; i < 8; i++) { v = (v << 1) | (b[i] & 1); } return v; }
  function prSpiLine(m, bits, h) {
    var j = prSpiCpha(m) ? Math.floor(h / 2) : Math.floor((h + 1) / 2);
    if (j < 0) { return 0; }
    if (j > 7) { return bits[7]; }        /* line holds its last bit between transfers */
    return bits[j];
  }
  function prSpiRecv(m, s, bits) {
    var out = [], i;
    for (i = 0; i < 8; i++) { out.push(prSpiReadBit(m, s, bits, i)); }
    return prSpiFromBits(out);
  }
  function prSpiMorph(m, s) { return m === s ? 'match' : (prSpiCpol(m) === prSpiCpol(s) ? 'marginal' : 'shift'); }

  /* ---- shared 2-lane LA for SPI, in half-step resolution ---- */
  var _prSpiPlay = null;
  function prSpiLane(steps, get, yH, yL, left, cw) {
    var pts = '', prevY = get(steps.length ? steps[0] : 0) ? yH : yL, i;
    pts += left.toFixed(1) + ',' + prevY + ' ';
    for (i = 0; i < steps.length; i++) {
      var y = get(steps[i]) ? yH : yL, x0 = left + i * cw, x1 = x0 + cw;
      pts += x0.toFixed(1) + ',' + prevY + ' ' + x0.toFixed(1) + ',' + y + ' ' + x1.toFixed(1) + ',' + y + ' ';
      prevY = y;
    }
    return pts.trim();
  }
  function prSpiWave(m, s, bits, opt) {
    var left = 40, W = 300, cw = (W - 48) / 16;
    _prSpiPlay = { left: left, cw: cw, id: (opt && opt.playId) || 'pr-spi-play' };
    var i, steps = [], grid = '', marks = '', labs = '';
    for (i = 0; i < 16; i++) { steps.push({ c: (i % 2 === 0) ? 1 - prSpiCpol(m) : prSpiCpol(m), d: prSpiLine(m, bits, i) }); }
    for (i = 1; i < 16; i++) { var gx = (left + i * cw).toFixed(1); grid += '<line class="grid" x1="' + gx + '" y1="20" x2="' + gx + '" y2="112"/>'; }
    for (i = 0; i < 8; i++) {
      var px = left + prSpiSample(m, s, i) * cw;
      marks += '<polygon class="edge' + (m === s ? '' : ' bad') + '" points="' + px.toFixed(1) + ',56 ' + (px - 3).toFixed(1) + ',49 ' + (px + 3).toFixed(1) + ',49"/>';
    }
    for (i = 0; i < 8; i++) {
      var bx = left + (2 * i) * cw;
      labs += '<rect class="segbox data" x="' + bx.toFixed(1) + '" y="94" width="' + (2 * cw - 1).toFixed(1) + '" height="18"/>' +
        '<text class="seglab" x="' + (bx + cw).toFixed(1) + '" y="107">' + bits[i] + '</text>';
    }
    var play = '<line id="' + _prSpiPlay.id + '" class="play" x1="' + left.toFixed(1) + '" x2="' + left.toFixed(1) + '" y1="14" y2="116" opacity="' + ((opt && opt.playOn) ? '1' : '0') + '"/>';
    return '<div class="pr-la"><svg viewBox="0 0 ' + W + ' 120">' +
      '<text class="clab" x="5" y="33">SCLK</text><text class="clab" x="5" y="69">MOSI</text>' +
      '<polyline class="trace clk" points="' + prSpiLane(steps, function (o) { return o.c; }, 22, 44, left, cw) + '"/>' +
      '<polyline class="trace" points="' + prSpiLane(steps, function (o) { return o.d; }, 58, 84, left, cw) + '"/>' +
      grid + marks + labs + play + '</svg></div>';
  }

  function prSpiModeSegCard() {
    var u = protos.spi, rows = '', m;
    for (m = 0; m < 4; m++) {
      rows += '<tr><td class="k">mode ' + m + '</td><td>' + prSpiCpol(m) + '</td><td>' + prSpiCpha(m) + '</td>' +
        '<td>' + (prSpiCpol(m) ? 'high' : 'low') + '</td><td>' + prSpiEdge(m) + '</td><td>' + prSpiChange(m) + '</td>' +
        '<td>' + (u.mMode === m ? 'master' : '') + (u.mMode === m && u.sMode === m ? ' + slave' : (u.sMode === m ? 'slave' : '')) + '</td></tr>';
    }
    return '<section class="pf-card"><h3>The four modes are one 2-bit number<span class="pf-sub">CPOL sets idle, CPHA sets the edge</span></h3>' +
      '<table class="pr-bit tbl"><tr><th>mode</th><th>CPOL</th><th>CPHA</th><th>clock idles</th><th>sample on</th><th>change on</th><th>in use</th></tr>' + rows + '</table>' +
      '<p class="pf-hint">There is no negotiation in SPI: both sides are <b>configured</b>, and a datasheet hands you a mode number. Get the clock idle level wrong and the other side is half a period off \u2014 which is exactly the <b>bit-shifted byte</b> you will find on a logic analyser at 2 a.m.</p></section>';
  }
  function prSpiCtlCard() {
    var u = protos.spi;
    function seg(name, cur) {
      return prSeg(name, [{ v: '0', t: '0' }, { v: '1', t: '1' }, { v: '2', t: '2' }, { v: '3', t: '3' }], String(cur));
    }
    return '<section class="pf-card"><h3>Two chips, one cable, maybe two opinions<span class="pf-sub">master drives, slave samples</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">Master mode</span>' + seg('spimm', u.mMode) +
        '<span class="lbl">Slave mode</span>' + seg('spism', u.sMode) + '</div>' +
      '<div class="pr-ctlrow"><span class="lbl">Byte (hex)</span><input id="pr-spi-byte" size="4" maxlength="2" value="' + u.byte.toString(16).toUpperCase() + '"/>' +
        '<button type="button" class="btn" id="pr-spi-send"' + (u.tx ? ' disabled' : '') + '>\u25b6 Clock it out</button>' +
        '<button type="button" class="btn mini" data-spipair="0,0">both mode 0</button>' +
        '<button type="button" class="btn mini" data-spipair="0,1">CPHA only</button>' +
        '<button type="button" class="btn mini" data-spipair="0,2">CPOL only</button></div>' +
      '<p class="pf-hint">The master shifts MSB-first and clocks every bit; the slave only knows <em>when it is allowed to look</em>. Markers above the MOSI trace are the slave\u2019s sample instants \u2014 green when they sit inside the bit window, amber when they sit on an edge.</p></section>';
  }
  function prSpiBin(v) { var s = '', b; for (b = 7; b >= 0; b--) { s += ((v >>> b) & 1) ? '1' : '0'; } return s; }
  function prSpiReadHtml() {
    var u = protos.spi, a = prSpiLive(), tx = a && a.tx && a.tx.kind === 'modes' ? a.tx : null;
    if (tx) {
      return prReviewTag(a) + (a.review ? 'reviewing \u2014 ' : 'clocking \u2014 ') + 'half-step ' + Math.min(Math.floor(a.pos), 16) + '/16 \u00b7 master mode ' + tx.m + ', slave mode ' + tx.s +
        (a.review ? prScrubSpiHtml(tx, Math.floor(a.pos)) : '');
    }
    var r = u.result && u.result.kind === 'modes' ? u.result : null;
    if (!r) { return 'idle \u2014 SCLK sits at ' + (prSpiCpol(u.mMode) ? 'high' : 'low') + '. Nothing moves until the master clocks.'; }
    var verdict;
    if (r.morph === 'match') {
      verdict = '<span class="good">\u2713 same mode \u2192 the sample lands mid-window</span>';
    } else if (r.got !== r.sent) {
      verdict = '<span class="bad">\u2717 ' + esc(prSpiBin(r.got)) + ' is ' + esc(prSpiBin(r.sent)) + ' shifted one window \u2014 the classic mode-mismatch signature</span>';
    } else {
      verdict = '<span class="bad">marginal: the value survived, but the sample sits exactly on the edge where the master changes the line \u2014 this board reads it right, the next one will not</span>';
    }
    return 'sent <b>' + esc(prHex(r.sent)) + '</b> \u2192 slave latched <b class="' + (r.got === r.sent ? 'good' : 'bad') + '">' + esc(prHex(r.got)) + '</b> \u00b7 ' +
      verdict + ' <span class="k">(' + u.okReads + ' matched, ' + u.mismatches + ' mismatched out of ' + u.sends + ')</span>';
  }
  function prSpiWaveCard() {
    var u = protos.spi, a = prSpiLive(), v = a && a.tx && a.tx.kind === 'modes' ? a.tx : null;
    var mm = v ? v.m : u.mMode, sm = v ? v.s : u.sMode, sentByte = v ? v.out : u.byte;
    return '<section class="pf-card" id="pr-spi-wavecard"><h3>Logic analyser<span class="pf-sub">SCLK + MOSI, MSB-first, ' + esc(prHex(sentByte)) + '</span></h3>' +
      prSpiWave(mm, sm, prSpiBits(sentByte), { playOn: false }) +
      '<div class="pr-read" id="pr-spi-read">' + prSpiReadHtml() + '</div></section>';
  }
  function prSpiStage8() {
    return prCols(
      prTeach('The sender owns the clock, so there is no frame',
        '<p>UART had to invent a start bit because <em>nobody</em> supplies a clock. SPI does: the master generates SCLK, one period per bit, so there is no framing, no baud error, no start/stop overhead \u2014 and no way for the slave to say anything back except on its own wire. The price is two numbers you must agree on <b>before</b> power-on: <b>CPOL</b> (which way the clock idles) and <b>CPHA</b> (which edge the receiver looks at).</p>' +
        '<p>Four combinations, four modes, and that is the entire configuration space. Drive the clock with the wrong idle level and your neighbour samples half a period late: it reads the <em>next</em> bit, so the byte arrives shifted by one \u2014 the most recognizable corruption pattern in the field. Set both to the same mode and it just works; try the presets and read the verdict.</p>') +
      prSpiCtlCard() + prSpiModeSegCard(),
      prSpiWaveCard(),
      prGoalCard(8) + prCodeCard('SPI1 in mode ' + protos.spi.mMode, prSpiModeCode()) + prLogCard());
  }
  function prSpiModeCode() {
    var u = protos.spi, cpol = prSpiCpol(u.mMode), cpha = prSpiCpha(u.mMode);
    return '/* mode ' + u.mMode + ' = CPOL ' + cpol + ' / CPHA ' + cpha + ' */\n' +
      'SPI1->CR1 = 0;                             /* stop while reconfiguring */\n' +
      'SPI1->CR1 |= SPI_CR1_MSTR;                 /* we generate SCLK         */\n' +
      (cpol ? 'SPI1->CR1 |= SPI_CR1_CPOL;               /* clock idles high       */\n' : '/* CPOL = 0: clock idles low (bit stays clear) */\n') +
      (cpha ? 'SPI1->CR1 |= SPI_CR1_CPHA;               /* sample on the 2nd edge */\n' : '/* CPHA = 0: sample on the 1st edge */\n') +
      'SPI1->CR1 |= (4u << 3);                    /* BR: fPCLK/16             */\n' +
      'SPI1->CR1 |= SPI_CR1_SPE;                  /* enable the peripheral    */\n\n' +
      '/* SPI has no read command: an exchange is simultaneous in + out */\n' +
      'SPI1->DR = ' + prHex(u.byte) + 'u;                          /* out on MOSI          */\n' +
      'while ((SPI1->SR & SPI_SR_RXNE) == 0) { }  /* something already came in */\n' +
      'uint8_t in = *(volatile uint8_t *)&SPI1->DR;';
  }

  /* ---- stage 9: the shift ring ---- */
  function prSpiRingSrc(u) {
    var a = prSpiLive(), tx = a && a.tx && a.tx.kind === 'ring' ? a.tx : null;
    if (tx) { return { out: tx.out, sb: tx.slaveBefore }; }
    if (u.result && u.result.kind === 'ring') { return { out: u.result.out, sb: u.result.got }; }
    return { out: u.byte, sb: u.slaveShift };
  }
  function prSpiRingState(u, k) {
    var src = prSpiRingSrc(u);
    var B = prSpiBits(src.out), SB = prSpiBits(src.sb);
    var m = [], sl = [], i;
    k = Math.max(0, Math.min(8, k));
    for (i = 0; i < 8; i++) { m.push(i < 8 - k ? B[i + k] : SB[i - (8 - k)]); }
    for (i = 0; i < 8; i++) { sl.push(i < 8 - k ? SB[i + k] : B[i - (8 - k)]); }
    return { master: m, slave: sl };
  }
  function prRingRow(name, bits, cls) {
    var cells = '', i;
    for (i = 0; i < 8; i++) { cells += '<b class="' + (bits[i] ? 'one' : '') + '">' + bits[i] + '</b>'; }
    return '<span class="rn">' + esc(name) + '</span><span class="ff ' + (cls || '') + '">' + cells + '</span>';
  }
  function prSpiRingCard() {
    var u = protos.spi, a = prSpiLive(), k = a ? Math.min(Math.floor(a.pos), 8) : (u.result && u.result.kind === 'ring' ? 8 : 0);
    var src = prSpiRingSrc(u), st = prSpiRingState(u, k);
    return '<section class="pf-card" id="pr-spi-ring"><h3>One ring, two chips<span class="pf-sub">eight clocks = a complete swap</span></h3>' +
      '<div class="pr-ring">' + prRingRow('master \u2014 sending ' + esc(prHex(src.out)), st.master, 'm') +
        '<span class="arw">\u21c4</span>' + prRingRow('slave \u2014 held ' + esc(prHex(src.sb)) + ' before', st.slave, 's') + '</div>' +
      '<div class="pr-read">' + (a ? prReviewTag(a) : '') + (k === 0 ? 'every clock pushes one bit out of each chip and lets one bit in \u2014 neither register ever empties' :
        k < 8 ? 'clock ' + k + '/8 \u00b7 ' + esc(prHex(prSpiFromBits(st.master))) + ' so far in the master, ' + esc(prHex(prSpiFromBits(st.slave))) + ' in the slave' :
        'exchange complete \u2014 master now holds <b>' + esc(prHex(prSpiFromBits(st.master))) + '</b>, slave holds the byte you sent' + (u.result && u.result.stale ? ' <span class="bad">(that was the <em>previous</em> measurement)</span>' : ' <span class="good">(this is the current one)</span>')) + '</div>' +
      '<p class="pf-hint">There is no such thing as an SPI <b>read</b>, only an <b>exchange</b>: while your byte travels out on MOSI, the other chip\u2019s byte travels in on MISO. So the value you get answers the question <em>“what was it about to say before I asked?”</em> \u2014 one transaction behind, every time, on every SPI device on earth.</p></section>';
  }
  function prSpiRingWave() {
    var u = protos.spi, src = prSpiRingSrc(u);
    var out = prSpiBits(src.out), inn = prSpiBits(src.sb);
    var left = 40, W = 300, cw = (W - 48) / 16, i, steps = [], grid = '';
    _prSpiPlay = { left: left, cw: cw, id: 'pr-spi-ring-play' };
    for (i = 0; i < 16; i++) {
      var j = Math.floor(i / 2);
      steps.push({ c: (i % 2 === 0) ? 1 - prSpiCpol(u.mMode) : prSpiCpol(u.mMode), o: out[j], n: inn[j] });
    }
    for (i = 1; i < 16; i++) { var gx = (left + i * cw).toFixed(1); grid += '<line class="grid" x1="' + gx + '" y1="14" x2="' + gx + '" y2="136"/>'; }
    var labs = '';
    for (i = 0; i < 8; i++) {
      var bx = left + (2 * i) * cw;
      labs += '<rect class="segbox data" x="' + bx.toFixed(1) + '" y="142" width="' + (2 * cw - 1).toFixed(1) + '" height="18"/>' +
        '<text class="seglab" x="' + (bx + cw).toFixed(1) + '" y="155">' + out[i] + '/' + inn[i] + '</text>';
    }
    var play = '<line id="pr-spi-ring-play" class="play" x1="' + left.toFixed(1) + '" x2="' + left.toFixed(1) + '" y1="8" y2="164" opacity="0"/>';
    return '<div class="pr-la"><svg viewBox="0 0 ' + W + ' 168">' +
      '<text class="clab" x="5" y="26">SCLK</text><text class="clab" x="5" y="54">MOSI</text><text class="clab" x="5" y="82">MISO</text>' +
      '<polyline class="trace clk" points="' + prSpiLane(steps, function (o) { return o.c; }, 16, 34, left, cw) + '"/>' +
      '<polyline class="trace" points="' + prSpiLane(steps, function (o) { return o.o; }, 46, 64, left, cw) + '"/>' +
      '<polyline class="trace miso" points="' + prSpiLane(steps, function (o) { return o.n; }, 74, 92, left, cw) + '"/>' +
      grid + labs + play + '</svg></div>';
  }
  function prSpiXferReadHtml() {
    var u = protos.spi;
    return 'sensor will say next: <b>' + esc(prHex(u.slaveShift)) + '</b> \u00b7 latest measurement waiting to load: <b>' + esc(prHex(u.slavePar)) + '</b>' +
      (u.result && u.result.kind === 'ring' ? ' \u00b7 master received: <b class="' + (u.result.stale ? 'bad' : 'good') + '">' + esc(prHex(u.result.got)) + '</b>' : '');
  }
  function prSpiXferCtlCard() {
    var u = protos.spi;
    return '<section class="pf-card"><h3>Ask twice, get the answer once<span class="pf-sub">write \u2192 trigger \u2192 dummy read</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">Byte to clock out</span><input id="pr-spi-xbyte" size="4" maxlength="2" value="' + u.byte.toString(16).toUpperCase() + '"/></div>' +
      '<div class="pr-ctlrow"><button type="button" class="btn" id="pr-spi-xfer"' + (u.tx ? ' disabled' : '') + '>\u25b6 Exchange</button>' +
        '<button type="button" class="btn mini" data-spidummy="1">\u21ba Dummy read (0x00)</button>' +
        '<button type="button" class="btn mini" data-spinew="1">\u26a1 Sensor completes a new measurement</button></div>' +
      '<div class="pr-read" id="pr-spi-xread">' + prSpiXferReadHtml() + '</div>' +
      '<p class="pf-hint">The measurement register is only copied into the shift ring <b>at the edge of a transfer</b>. Clock once and you shift out whatever was already queued \u2014 the previous conversion. Trigger a new measurement, then exchange a dummy <code>0x00</code>, and the fresh value walks out while your zeros walk in. This is why every SPI driver on earth writes a byte it does not care about.</p></section>';
  }
  function prSpiStage9() {
    return prCols(
      prTeach('Full duplex is not a feature, it is the wiring',
        '<p>Two separate data wires \u2014 MOSI out, MISO in \u2014 mean both chips can shift at the same time. Nothing is ever <em>only</em> read or <em>only</em> written: eight clocks always move eight bits each way. The peripheral registers reflect that: you write to <code>SPI1-&gt;DR</code> and the same register hands you back the byte that arrived.</p>' +
        '<p>Consequence, and this is the one people learn the hard way: the byte you receive is the one the slave had <b>ready before this transfer started</b>. Real devices lean on it \u2014 a command byte, then a dummy byte to clock the result out. If your driver reads garbage on the first attempt and the right value on the second, you have not found a bug in the part; you have found the ring.</p>') +
      prSpiXferCtlCard() + prSpiRingCard(),
      '<section class="pf-card" id="pr-spi-xwave"><h3>Logic analyser<span class="pf-sub">three lanes: clock, out, in</span></h3>' + prSpiRingWave() + '</section>',
      prGoalCard(9) + prCodeCard('The two-transfer idiom', PR_SPI_RING_CODE) + prLogCard());
  }
  var PR_SPI_RING_CODE = '/* reading a register over SPI is always a two-step: */\n\n/* 1) the command transfer. We clock it out; whatever comes back on\n   MISO is stale data from the previous transaction - discard it.   */\nSPI1->CR1 |= SPI_CR1_CS;                   /* select the device     */\nSPI1->DR = REG_STATUS | 0x80u;             /* "give me status"      */\nwhile ((SPI1->SR & SPI_SR_RXNE) == 0) { }\n(void)*(volatile uint8_t *)&SPI1->DR;      /* throw the old byte away */\n\n/* 2) the dummy transfer. We send nothing interesting so the device\n   can send everything it has. This is the read.                  */\nSPI1->DR = 0x00u;\nwhile ((SPI1->SR & SPI_SR_RXNE) == 0) { }\nuint8_t status = *(volatile uint8_t *)&SPI1->DR;\nSPI1->CR1 &= ~SPI_CR1_CS;\n\n/* HAL hides exactly this: HAL_SPI_TransmitReceive() with a dummy TX\n   buffer. Some parts need a CS toggle between the two transfers,\n   some need CS held \u2014 read the datasheet timing diagram, not the demo. */';

  /* ---- stage 7: the protocol map (the universal layer) ---- */
  var PR_MAP_ROWS = [
    { k: 'Wires for one transfer',
      v: { uart: ['TX + RX (2)', 2], i2c: ['SDA + SCL (2)', 5], spi: ['SCLK + MOSI + MISO + CS (4)', 8] } },
    { k: 'Who provides the clock',
      v: { uart: ['nobody \u2014 both sides agree on a baud rate', 3], i2c: ['master, and the slave may stretch it', 6], spi: ['master, always, and it never waits', 8] } },
    { k: 'Idle level of the data line',
      v: { uart: ['high (a released line)', 1], i2c: ['high, held there by a pull-up', 1], spi: ['undefined \u2014 the slave only speaks when CS is low', 9] } },
    { k: 'Where a byte begins',
      v: { uart: ['a falling start bit, re-aligned every byte', 2], i2c: ['START: SDA falls while SCL is high', 6], spi: ['nowhere \u2014 the clock simply runs', 8] } },
    { k: 'Bit order',
      v: { uart: ['LSB first', 2], i2c: ['MSB first (A6 \u2192 A0)', 5], spi: ['MSB first by default, LRCP bit flips it', 8] } },
    { k: 'How the receiver knows it looked at the right moment',
      v: { uart: ['sample mid-bit, timed from the start edge', 3], i2c: ['the sender changes SDA only while SCL is low', 5], spi: ['CPHA says first or second edge; CPOL says which is first', 8] } },
    { k: 'Addressing \u2014 how it knows who you mean',
      v: { uart: ['it does not: point to point', 2], i2c: ['7-bit address + R/W in the first byte', 6], spi: ['a physical wire per device (chip select)', 9] } },
    { k: 'Feedback that the byte landed',
      v: { uart: ['none \u2014 fire and forget (parity is only a hint)', 2], i2c: ['the 9th clock: ACK or NACK', 6], spi: ['none \u2014 if MISO is silent you read 0xFF/0x00', 9] } },
    { k: 'Two speakers at once',
      v: { uart: ['yes: TX and RX are different wires', 4], i2c: ['no: half duplex, arbitration decides the winner', 5], spi: ['yes, always: every exchange is two-way', 9] } },
    { k: 'What one bit flip costs you',
      v: { uart: ['a wrong character, caught only by parity', 3], i2c: ['a lost arbitration or a NACK, self-inflicted', 5], spi: ['a byte shifted by one position', 8] } }
  ];
  function prMapTableCard() {
    var rows = '';
    PR_MAP_ROWS.forEach(function (r) {
      rows += '<tr><td class="k">' + esc(r.k) + '</td>' +
        ['uart', 'i2c', 'spi'].map(function (f) {
          var cell = r.v[f];
          return '<td>' + esc(cell[0]) + ' <button type="button" class="rowlink" data-prstage="' + cell[1] + '">stage ' + cell[1] + '</button></td>';
        }).join('') + '</tr>';
    });
    return '<section class="pf-card"><h3>Same questions, three answers<span class="pf-sub">every protocol answers the same list differently</span></h3>' +
      '<table class="pr-bit tbl"><tr><th>question</th><th>UART</th><th>I\u00b2C</th><th>SPI</th></tr>' + rows + '</table>' +
      '<p class="pf-hint">Read it as a decision tree, not a table. No spare pins and need to reach 8 cheap devices \u2192 I\u00b2C. Need tens of MHz and a display \u2192 SPI. One wire each way and a human watching \u2192 UART. Every entry above is already modelled in this lab \u2014 the links jump to the stage where you can <b>make it fail</b>.</p></section>';
  }
  function prMapVocabCard() {
    var items = [
      ['idle level', 'what the line does when nobody drives it. On an open-drain wire a 1 means <em>let go</em> (stage 1); a floating input means <em>nobody decided anything</em> and the next reader is random.'],
      ['framing', 'how the receiver knows a byte is starting: a start bit (UART), a START condition drawn on the clock wire (I\u00b2C), or simply asserting chip select (SPI).'],
      ['sample instant', 'the one moment a receiver is allowed to look: mid-bit by agreement, on a clock edge chosen by CPHA, or anywhere the sender guarantees SDA is stable.'],
      ['bit order', 'LSB first is a UART habit, MSB first is a bus habit. Get it backwards and 0x50 comes off the wire as 0x0A.'],
      ['acknowledgement', 'the receiver\u2019s only voice: parity hints, ACK clocks confirm, SPI stays silent and lies.'],
      ['arbitration', 'what happens when two masters disagree: I\u00b2C resolves it electrically with a wired-AND; SPI just drives two outputs into each other and hopes.'],
      ['clock domain', 'whether the sender supplies the clock (I\u00b2C/SPI) or both sides run their own (UART). Everything about drift, stretching and baud error follows from that one choice.']
    ];
    var lis = '';
    items.forEach(function (it) { lis += '<tr><td class="k">' + esc(it[0]) + '</td><td>' + it[1] + '</td></tr>'; });
    return '<section class="pf-card"><h3>Seven words that cover every serial protocol<span class="pf-sub">the shared vocabulary</span></h3>' +
      '<table class="pr-bit tbl"><tr><th>term</th><th>what it really means</th></tr>' + lis + '</table>' +
      '<p class="pf-hint">Datasheets vary, physics does not. When a new protocol shows up (CAN, USB, one of five display interfaces), find these seven answers first and the rest is bookkeeping.</p></section>';
  }
  function prMapStage7() {
    return prCols(
      prTeach('Protocols are agreements about voltage over time',
        '<p>Stage 1 was the last lesson that was about electricity. From here everything is about <em>convention</em>: two chips with no shared memory, no shared clock and often no spare pins, agreeing on what a wire means at each instant. UART, I\u00b2C and SPI are not three technologies \u2014 they are three answers to the same seven questions.</p>' +
        '<p>Once you can name the questions, a new protocol stops being scary: find the idle level, the framing, the sample instant, the bit order, the acknowledgement, the arbitration, the clock domain. This table is the map of the module; every cell links to a stage you can break.</p>') +
      prMapVocabCard(),
      prMapTableCard(),
      prGoalCard(7) + prCodeCard('Choosing, in C', PR_MAP_CODE) + prLogCard());
  }
  var PR_MAP_CODE = '/* the three lines you will actually configure in a real project */\n\n/* UART  \u2014 agreed clock, framed bytes, no addressing, no ACK */\nUSART1->BRR = 8000000u / 115200u;   /* both sides must already agree  */\n\n/* I2C   \u2014 shared clock, shared data, addressed, acknowledged */\nI2C1->DR = (0x50u << 1) | 0u;       /* the first byte names a device  */\n\n/* SPI   \u2014 master clock, two data wires, chip-select addressing */\nSPI1->CR1 = SPI_CR1_MSTR | SPI_CR1_SPE;   /* mode lives in CPOL/CPHA  */\nGPIOA->BSRR = CS_PIN;               /* addressing is a wire, not a byte */\n\n/* None of these is "faster" in the abstract. Pick by pins available,\n   devices on the bus, distance, and how much you trust the wiring. */';

  /* ---- goals ---- */

  var PR_GOALS = {
    1: { text: 'Set the driver to <b>open-drain</b>, release the pin (ODR = 1), and add a <b>pull-up</b>. The line must read <b>HIGH</b> — proving a "1" on an open-drain pin really means "let go and let the resistor decide".',
      ok: function () { var s = protos.sig; return prResolve(s.drive, s.out, s.pull) === 'high' && s.drive === 'od'; },
      hint: function () { var s = protos.sig; if (s.drive !== 'od') { return 'Switch the driver to open-drain first — push-pull is cheating.'; } if (s.out) { return 'Released — now add a pull-up so the high is defined.'; } return 'ODR is 0, so the NMOS is sinking it low. Release the pin (ODR = 1).'; } },
    2: { text: '<b>Send one byte</b> and let its whole frame travel the wire. The counter of completed sends must reach at least 1.',
      ok: function () { return protos.uart.sent >= 1; },
      hint: function () { return 'Pick any character (or keep ' + esc(prHex(protos.uart.char)) + ') and press Send byte.'; } },
    3: { text: 'Break reception on purpose: drag the <b>baud error</b> until at least one sample lands in the wrong bit window and the decoded byte differs from the sent byte.',
      ok: function () { return protos.uart.errSeen === true; },
      hint: function () { return 'The error accumulates, so the bits nearest the stop break first. Push the slider further — a big mismatch is fine here.'; } },
    4: { text: 'Type a short message and receive it: get <b>3 or more characters</b> through the terminal.',
      ok: function () { return protos.rxLog.length >= 3; },
      hint: function () { return 'Type into the box and press Enter — each character is a full frame.'; } },
    5: { text: 'Make an arbitration decision visible: send two different master addresses and let the log record a <b>loser</b> dropping off mid-byte. (Identical addresses do not count — that is a bug you get for free, not a feature.)',
      ok: function () { return protos.i2c.collisions >= 1; },
      hint: function () { return 'The two addresses must differ at some bit — try the 0x50 vs 0x40 preset and press send.'; } },
    6: { text: 'Address someone who is home: send the address of the <b>present EEPROM (0x50)</b> and get its <b>ACK</b> — then optionally see a NACK from an empty slot and a full repeated-start read.',
      ok: function () { return protos.i2c.acked >= 1; },
      hint: function () { return 'Type 50 in the address box (or click the EEPROM preset) and press Send START + address.'; } },
    7: { text: 'Use the map as a menu: visit at least one stage from <b>each</b> family \u2014 UART, I\u00b2C and SPI \u2014 by following any of the links in the table.',
      ok: function () {
        var s = protos.seen;
        function any(ids) { for (var i = 0; i < ids.length; i++) { if (s[ids[i]]) { return true; } } return false; }
        return any([2, 3, 4]) && any([5, 6]) && any([8, 9]);
      },
      hint: function () { return 'Every cell in the table is a button \u2014 click one link per protocol column and this clears.'; } },
    8: { text: 'Prove the mode rule from both sides: clock a byte out with the master and slave in <b>different</b> modes and watch the byte arrive shifted, then set them equal and take a clean read.',
      ok: function () { var u = protos.spi; return u.mismatches >= 1 && u.okReads >= 1; },
      hint: function () { return 'Try the \u201cCPOL only\u201d preset, press Clock it out, then match the two selectors and send again.'; } },
    9: { text: 'Meet the one-behind effect and beat it: exchange once so the master latches the <b>stale</b> value, then exchange a <b>dummy 0x00</b> and receive the measurement that was waiting.',
      ok: function () { return protos.spi.freshRead === true; },
      hint: function () { return 'Press Exchange (you get 0xCA, the old queued value), then press Dummy read \u2014 the fresh value can only leave on a clock you provide.'; } }
  };
  function prGoalCard(n) {
    var g = PR_GOALS[n]; if (!g) { return ''; }
    var done = !!protos.goals[n];
    return '<section class="pf-card pf-goal' + (done ? ' hit' : '') + '"><h3>Your move<span class="pf-sub">stage ' + n + ' goal</span></h3><p class="pf-teach">' + g.text + '</p>' +
      '<div class="pf-goalarow"><button type="button" class="btn" data-prgoal="' + n + '">✓ Verify</button>' + (done ? '<b class="pf-donet">achieved ✓</b>' : '<b class="pf-openet">not yet</b>') + '</div>' +
      '<p class="pf-hint" id="pr-goal-hint-' + n + '"></p></section>';
  }

  /* ---- stage bodies + shell ---- */
  function prStageBody(n) {
    if (n === 5) { return prI2cStage5(); }
    if (n === 6) { return prI2cStage6(); }
    if (n === 7) { return prMapStage7(); }
    if (n === 8) { return prSpiStage8(); }
    if (n === 9) { return prSpiStage9(); }
    if (n === 1) { return prCols(
      prTeach('A voltage is not a logic level',
        '<p>A pin is a small circuit fighting a wire. Two transistors can <b>actively drive</b> it — one to VDD (push), one to GND (pull) — that is <b>push-pull</b>: defined both ways. Or the pin has only the lower transistor, <b>open-drain</b>: it can sink the line low or <em>let go</em>, never force it high. A <b>pull-up</b> resistor then holds the released line high; a <b>pull-down</b> holds it low.</p>' +
        '<p>Release an open-drain pin with no pull and you get the third level every embedded engineer fears: <b>floating</b> — high impedance, drifting, reading whatever noise is nearby. The rig resolves the level from exactly these choices.</p>') + prSigCtlCard(),
      prWireCard() + prCodeCard('The GPIOA setup this equals', prSigCode()),
      prGoalCard(1) + prAndCard()); }
    if (n === 2) { return prCols(
      prTeach('Framing: one byte becomes a timed series of levels',
        '<p>UART has <b>no clock wire</b>. The only shared promise is a <b>baud rate</b> — how long a bit lasts. To send a byte: idle high, drop a <b>start</b> bit low (the falling edge starts the receiver\'s timer), emit the data bits <b>least-significant first</b>, an optional <b>parity</b> bit for a cheap check, then a <b>stop</b> bit high to return to idle.</p>' +
        '<p>Press <b>Send byte</b> and watch the playhead walk the wire one bit at a time. Change parity and stop and the frame grows or shrinks — the same byte, more or fewer levels.</p>') + prFrameCtlCard(),
      prFrameShowCard() + prCodeCard('Sending ' + esc(prHex(protos.uart.char)) + ' equals this in C', prUartCode()),
      prGoalCard(2) + prLogCard()); }
    if (n === 3) { return prCols(
      prTeach('The receiver trusts its own clock',
        '<p>After the start edge the receiver waits <b>half a bit</b>, then samples once per bit at each centre. If its baud is even slightly wrong, every sample is placed a touch off and the error <b>piles up</b> across the frame — the far bits sit nearest a boundary. Two "close enough" crystals still garble a long frame; that is why framing and parity errors exist.</p>') + prSampleCtlCard(),
      prSampleShowCard(),
      prGoalCard(3) + prCodeCard('Even a perfect divisor has a budget', prUartCode())); }
    return prCols(
      prTeach('A terminal is just a loop',
        '<p>Every key is a byte; every byte is a frame; the receiver reassembles by timing. A serial terminal does nothing more than read what the decoder produced and print it. Change the <b>baud error</b> (carried from stage 3) and watch good characters turn to garbage — the exact corruption a logic analyser shows you when a clock tree is misconfigured.</p>') + prTermCtlCard() + prTermCard(),
      prGoalCard(4) + prCodeCard('USART1 init @ ' + protos.uart.baud + ' baud', prUartCode()));
  }
  function prFamNav() {
    var cur = prFamOfStage(protos.stage);
    return '<div class="pr-fams" role="tablist" aria-label="Protocol families">' +
      PR_FAMILIES.map(function (f) {
        var stages = prStagesInFam(f.id), dots = '';
        stages.forEach(function (s) { dots += '<i' + (protos.goals[s.id] ? ' class="gd"' : '') + '></i>'; });
        return '<button type="button" role="tab" id="pr-fam-' + f.id + '" data-prfam="' + f.id + '" aria-controls="prolab-body" tabindex="' + (f.id === cur ? '0' : '-1') + '" aria-selected="' + String(f.id === cur) + '" class="pr-fam' + (f.id === cur ? ' cur' : '') + '" title="' + esc(f.blurb) + '">' +
          esc(f.name) + '<span class="fc">' + dots + '</span></button>';
      }).join('') + '</div>';
  }
  function prStageNav() {
    var fam = prFamOfStage(protos.stage);
    return '<nav class="pf-stagenav" role="tablist" aria-label="Protocol stages">' +
      prStagesInFam(fam).map(function (s) {
        return '<button type="button" role="tab" id="pr-stage-' + s.id + '" data-prstage="' + s.id + '" aria-controls="prolab-body" tabindex="' + (protos.stage === s.id ? '0' : '-1') + '" aria-selected="' + String(protos.stage === s.id) + '" title="' + esc(s.tag) + '">' +
          (protos.goals[s.id] ? '<span class="gd">✓</span>' : '<span class="num">' + s.id + '</span>') + '<span class="stn">' + esc(s.name) + '</span></button>';
      }).join('') + '</nav>';
  }
  /* a shortcut that moved you has to move the caret too, or the tab order loses you */
  function prFocusTab(n) {
    var t = document.getElementById('pr-stage-' + n);
    if (t) { t.focus(); }
  }
  function prBody() {
    var meta = prStageById(protos.stage) || PR_STAGE_META[0];
    var famMeta = prFamById(meta.fam);
    return prFamNav() + prStageNav() +
      '<div class="pf-runbar">' +
        '<button type="button" class="btn" id="pr-pause" aria-pressed="' + String(!protos.running) + '">' + (protos.running ? '⏸ Pause' : '⏵ Resume') + '</button>' +
        '<button type="button" class="btn" id="pr-reset">\u21ba Reset lab</button>' +
        prScrubBar() +
        prKeysBtn() +
        '<span class="pf-stage-tag">' + esc(famMeta.name + ' \u00b7 ' + meta.tag) + '</span>' +
        '<span class="pf-simclock">sim t = <b id="pr-simclock">' + protos.simMs + '</b> ms</span>' +
      '</div>' + (_prKeys ? prKeysCard() : '') + prStageBody(protos.stage);
  }

  function prRenderStatic() {
    var host = document.getElementById('prolab-body'); if (!host) { return; }
    host.innerHTML = prBody();
    prWire(host);
    /* keep send buttons inert while a frame owns the wire */
    if (protos.uart.tx) { var sb = document.getElementById('pr-send') || document.getElementById('pr-send3'); if (sb) { sb.disabled = true; } }
    if (protos.i2c.tx) { var s5 = document.getElementById('pr-i2c-send') || document.getElementById('pr-i2c-send6'); if (s5) { s5.disabled = true; } }
    if (protos.spi.tx) { var s8 = document.getElementById('pr-spi-send') || document.getElementById('pr-spi-xfer'); if (s8) { s8.disabled = true; } }
    prRenderLive();
  }
  function prRenderLive() {
    if (!protocolsInited) { return; }
    if (!document.getElementById('prolab-body')) { return; }
    var sc = document.getElementById('pr-simclock'); if (sc) { sc.textContent = protos.simMs; }
    var a = prUartLive();
    if (_prLA) {
      var pl = document.getElementById('pr-play');
      if (pl) {
        if (a) {
          var idx = Math.max(0, Math.min(Math.floor(a.pos), _prLA.n));
          var px = _prLA.left + idx * _prLA.cw;
          pl.setAttribute('x1', px.toFixed(1)); pl.setAttribute('x2', px.toFixed(1));
          pl.setAttribute('opacity', '1');
        } else { pl.setAttribute('opacity', '0'); }
      }
    }
    var fr = document.getElementById('pr-frame-read'); if (fr) { fr.innerHTML = prFrameReadHtml(); }
    var sr3 = document.getElementById('pr-smp-read'); if (sr3) { sr3.innerHTML = prSampleReadHtml(); }
    /* I2C playhead + live readouts */
    var pv = prView();
    var ia = pv && pv.kind === 'i2c' ? pv : null;
    if (_prPlay && _prPlay.id === 'pr-i2c-play') {
      var ip = document.getElementById('pr-i2c-play');
      if (ip) {
        if (ia) {
          var ix = Math.max(0, Math.min(ia.pos, _prPlay.n));
          var ipx = _prPlay.left + ix * _prPlay.cw;
          ip.setAttribute('x1', ipx.toFixed(1)); ip.setAttribute('x2', ipx.toFixed(1));
          ip.setAttribute('opacity', '1');
        } else { ip.setAttribute('opacity', '0'); }
      }
    }
    if (protos.stage === 5 || protos.stage === 6) {
      var ir = document.getElementById('pr-i2c-read');
      if (ir) {
        var st6 = protos.i2c, rs = st6.result && ((protos.stage === 5) === (st6.result.kind === 'masters')) ? st6.result : null;
        var sl = ia ? ia.tx.slots : (rs ? rs.slots : null);
        ir.innerHTML = protos.stage === 5 ? prI2cBanner(sl || prI2cMasters(st6.m1val, st6.m2val).slots, ia ? null : rs) : prI2cAddrBanner(sl || prI2cTxSlots(st6.addr, st6.rw, st6.addr === PR_I2C_SLAVE, false), ia ? null : rs);
      }
      var itb = document.getElementById('pr-i2c-table'); if (itb) { itb.outerHTML = prI2cTableCard(); }
    }
    /* SPI playhead + live readouts */
    if (protos.stage === 8 || protos.stage === 9) {
      var sa = pv && pv.kind === 'spi' ? pv : null;
      if (_prSpiPlay) {
        var sp = document.getElementById(_prSpiPlay.id);
        if (sp) {
          if (sa) {
            var sx = _prSpiPlay.left + Math.max(0, Math.min(sa.pos * (sa.unit || 1), 16)) * _prSpiPlay.cw;
            sp.setAttribute('x1', sx.toFixed(1)); sp.setAttribute('x2', sx.toFixed(1));
            sp.setAttribute('opacity', '1');
          } else { sp.setAttribute('opacity', '0'); }
        }
      }
      var sr = document.getElementById('pr-spi-read'); if (sr) { sr.innerHTML = prSpiReadHtml(); }
      if (protos.stage === 9) {
        var rg = document.getElementById('pr-spi-ring'); if (rg) { rg.outerHTML = prSpiRingCard(); }
      }
    }
  }

  function prFinishFrame(tx) {
    var u = protos.uart, dec = prDecode(tx.bits, u, tx.drift);
    /* freeze the frame that just went out so the scrubber can walk it again */
    _prCap = { kind: 'uart', stage: protos.stage, pos: tx.bits.length, total: tx.bits.length, unit: 1, step: 1, tx: tx, sig: prUartSig(), dec: dec };
    _prPos = null;
    u.sent++; u.last = dec.ch; if (!dec.ok) { u.errSeen = true; }
    var sl = prCharLabel(tx.ch), gl = prCharLabel(dec.ch);
    protos.rxLog.unshift({ t: protos.simMs, sent: sl, got: gl, ok: dec.ok });
    if (protos.rxLog.length > 60) { protos.rxLog.pop(); }
    prLog(dec.ok ? 'ok' : 'err', (dec.ok ? '✓ ' : '✗ ') + sl + ' → ' + gl + (dec.ok ? '' : '  (' + dec.mis + ' bit' + (dec.mis > 1 ? 's' : '') + ' mis-sampled)'));
    if (protos.stage === 3 && !dec.ok && !u.tx && !u.queue.length) { prRenderLive(); }
  }

  function prTick() {
    if (!protocolsInited) { return; }
    var u = protos.uart;
    if (protos.running) {
      protos.simMs += PR_TICK_MS;
      if (prI2cTick()) { prRenderLive(); return; }
      if (prSpiTick()) { prRenderLive(); return; }
      if (!u.tx && u.queue && u.queue.length) {
        var c = u.queue.shift();
        u.char = c;
        u.tx = { bits: prUartBits(u, c), ch: c, idx: 0, pos: 0, drift: u.drift };
        prBeginPlay();
        if (protos.stage === 2 || protos.stage === 3) { prRenderStatic(); }
      }
      if (u.tx) {
        u.tx.pos += prSpeedMul();
        u.tx.idx = Math.floor(u.tx.pos);
        if (u.tx.idx >= u.tx.bits.length) {
          var tx = u.tx; u.tx = null;
          prFinishFrame(tx);
          if (protos.stage === 4) { prSave(); prAppendTermRow(); prUpdateLA(); prRenderLive(); }
          else { prSave(); prRenderStatic(); }
          return;
        }
      }
    }
    prRenderLive();
  }

  var prTicker = null;
  function prStartTicker() { if (prTicker) { return; } prTicker = setInterval(prTick, PR_TICK_MS); }

  function prGoStage(n) {
    if (!prStageById(n) || n === protos.stage) { return; }
    prAnimStop();
    protos.seen[n] = true;
    protos.stage = n; prSave(); prRenderStatic();
  }

  function prWire(host) {
    Array.prototype.forEach.call(host.querySelectorAll('[data-prstage]'), function (b) {
      b.addEventListener('click', function () { prGoStage(Number(b.dataset.prstage)); });
    });
    var pz = document.getElementById('pr-pause');
    if (pz) { pz.addEventListener('click', prToggleRun); }
    var rs = document.getElementById('pr-reset');
    if (rs) { rs.addEventListener('click', prResetLab); }

    /* scrubber: walk the transfer that just finished, one clock or bit at a time */
    var smb = document.getElementById('pr-scrub');
    if (smb) { smb.addEventListener('input', function () { prSetPos(Number(smb.value)); }); }
    var sbk = document.getElementById('pr-step-back');
    if (sbk) { sbk.addEventListener('click', function () { prSetPos(prScrubPos() - 1); }); }
    var sfw = document.getElementById('pr-step-fwd');
    if (sfw) { sfw.addEventListener('click', function () { prSetPos(prScrubPos() + 1); }); }
    var slv = document.getElementById('pr-live');
    if (slv) { slv.addEventListener('click', prStopScrub); }
    var spd = document.getElementById('pr-speed');
    if (spd) { spd.addEventListener('click', function () { prSpeedStep(); prSave(); prRenderStatic(); }); }
    var kb = document.getElementById('pr-keys-btn');
    if (kb) { kb.addEventListener('click', function () { prToggleKeys(); }); }

    /* stage 1: line physics */
    Array.prototype.forEach.call(host.querySelectorAll('[data-sigdrive]'), function (b) {
      b.addEventListener('click', function () { protos.sig.drive = b.dataset.sigdrive; prSave(); prRenderStatic(); });
    });
    var so = host.querySelector('[data-sigout]');
    if (so) { so.addEventListener('click', function () { protos.sig.out = Number(so.dataset.sigout) ? 1 : 0; prSave(); prRenderStatic(); }); }
    Array.prototype.forEach.call(host.querySelectorAll('[data-sigpull]'), function (b) {
      b.addEventListener('click', function () { protos.sig.pull = b.dataset.sigpull; prSave(); prRenderStatic(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-wa]'), function (b) {
      b.addEventListener('click', function () { var k = b.dataset.wa === 'a' ? 'aOut' : 'bOut'; protos.wire[k] = protos.wire[k] ? 0 : 1; prSave(); prRenderStatic(); });
    });

    /* stage 2: the frame */
    var ci = document.getElementById('pr-char');
    if (ci) {
      ci.addEventListener('input', function () {
        var c = ci.value.length ? ci.value.charCodeAt(ci.value.length - 1) : 0x48;
        protos.uart.char = c; prUpdateLA();
        var fr = document.getElementById('pr-frame-read'); if (fr) { fr.innerHTML = prFrameReadHtml(); }
        prSave();
      });
    }
    Array.prototype.forEach.call(host.querySelectorAll('[data-parity]'), function (b) {
      b.addEventListener('click', function () { protos.uart.parity = b.dataset.parity; prSave(); prRenderStatic(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-stop]'), function (b) {
      b.addEventListener('click', function () { protos.uart.stop = Number(b.dataset.stop); prSave(); prRenderStatic(); });
    });
    var sd = document.getElementById('pr-send');
    if (sd) { sd.addEventListener('click', function () { protos.uart.queue.push(protos.uart.char); sd.disabled = true; prSave(); }); }
    var s3 = document.getElementById('pr-send3');
    if (s3) { s3.addEventListener('click', function () { protos.uart.queue.push(protos.uart.char); s3.disabled = true; if (!protos.running) { protos.running = true; } prSave(); }); }

    /* stage 3 + 4: baud drift slider */
    var dr = document.getElementById('pr-drift');
    if (dr) {
      dr.addEventListener('input', function () {
        protos.uart.drift = Number(dr.value) || 0;
        var lab = dr.parentNode.querySelector('b'); if (lab) { lab.textContent = protos.uart.drift + '%'; }
        if (protos.stage === 3) { prRenderStatic(); }
        prSave();
      });
    }
    var nb = document.getElementById('pr-newbyte');
    if (nb) { nb.addEventListener('click', function () { protos.uart.char = 0x21 + Math.floor(Math.random() * 58); prSave(); prRenderStatic(); }); }

    /* stage 4: baud presets + terminal */
    Array.prototype.forEach.call(host.querySelectorAll('[data-baud]'), function (b) {
      b.addEventListener('click', function () { protos.uart.baud = Number(b.dataset.baud); prSave(); prRenderStatic(); });
    });
    var ty = document.getElementById('pr-type');
    if (ty) {
      ty.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') { return; }
        var val = ty.value;
        if (!val) { return; }
        var u = protos.uart, n = 0;
        for (var i = 0; i < val.length && n < 40; i++) { u.queue.push(val.charCodeAt(i)); n++; }
        ty.value = '';
        if (!protos.running) { protos.running = true; }
        prSave(); prUpdateLA(); prRenderLive();
      });
    }
    var cl = document.getElementById('pr-clear');
    if (cl) { cl.addEventListener('click', function () { protos.rxLog = []; prSave(); prRenderStatic(); }); }

    /* stage 5: I2C arbitration */
    var m1i = document.getElementById('pr-i2c-m1');
    if (m1i) {
      m1i.addEventListener('input', function () {
        var v = parseInt(m1i.value, 16);
        protos.i2c.m1val = isNaN(v) ? 0 : (v & 0x7f);
        protos.i2c.result = null;
        prSave(); prRenderStatic();
      });
    }
    var m2i = document.getElementById('pr-i2c-m2');
    if (m2i) {
      m2i.addEventListener('input', function () {
        var v = parseInt(m2i.value, 16);
        protos.i2c.m2val = isNaN(v) ? 0 : (v & 0x7f);
        protos.i2c.result = null;
        prSave(); prRenderStatic();
      });
    }
    Array.prototype.forEach.call(host.querySelectorAll('[data-i2cpair]'), function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.i2cpair.split(',');
        protos.i2c.m1val = parseInt(p[0], 16) & 0x7f; protos.i2c.m2val = parseInt(p[1], 16) & 0x7f;
        protos.i2c.result = null; prSave(); prRenderStatic();
      });
    });
    var i2cSend = document.getElementById('pr-i2c-send');
    if (i2cSend) {
      i2cSend.addEventListener('click', function () {
        var u = protos.i2c; if (u.tx) { return; }
        var r = prI2cMasters(u.m1val, u.m2val);
        u.tx = { kind: 'masters', slots: r.slots, lostAt: r.lostAt };
        if (!protos.running) { protos.running = true; }
        prSave(); prRenderStatic();
      });
    }
    Array.prototype.forEach.call(host.querySelectorAll('[data-i2ca]'), function (b) {
      b.addEventListener('click', function () { protos.i2c.aOut = Number(b.dataset.i2ca) ? 1 : 0; prSave(); prRenderStatic(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-i2cb]'), function (b) {
      b.addEventListener('click', function () { protos.i2c.bOut = Number(b.dataset.i2cb) ? 1 : 0; prSave(); prRenderStatic(); });
    });

    /* stage 6: I2C addressing */
    var addrIn = document.getElementById('pr-i2c-addr');
    if (addrIn) {
      addrIn.addEventListener('input', function () {
        var v = parseInt(addrIn.value, 16);
        protos.i2c.addr = isNaN(v) ? 0 : (v & 0x7f);
        protos.i2c.result = null; prSave(); prRenderStatic();
      });
    }
    Array.prototype.forEach.call(host.querySelectorAll('[data-i2crw]'), function (b) {
      b.addEventListener('click', function () { protos.i2c.rw = Number(b.dataset.i2crw) ? 1 : 0; prSave(); prRenderStatic(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-i2caddr]'), function (b) {
      b.addEventListener('click', function () { protos.i2c.addr = parseInt(b.dataset.i2caddr, 16) & 0x7f; protos.i2c.result = null; prSave(); prRenderStatic(); });
    });
    var i2cSend6 = document.getElementById('pr-i2c-send6');
    if (i2cSend6) {
      i2cSend6.addEventListener('click', function () {
        var u = protos.i2c; if (u.tx) { return; }
        u.tx = { kind: 'addr', slots: prI2cTxSlots(u.addr, u.rw, u.addr === PR_I2C_SLAVE, false), addr: u.addr, rw: u.rw, sr: false };
        if (!protos.running) { protos.running = true; }
        prSave(); prRenderStatic();
      });
    }
    var i2cSr = document.getElementById('pr-i2c-sr');
    if (i2cSr) {
      i2cSr.addEventListener('click', function () {
        var u = protos.i2c; if (u.tx) { return; }
        u.tx = { kind: 'addr', slots: prI2cSrSlots(u.addr, u.addr === PR_I2C_SLAVE), addr: u.addr, rw: 1, sr: true };
        if (!protos.running) { protos.running = true; }
        prSave(); prRenderStatic();
      });
    }

    /* family tier */
    Array.prototype.forEach.call(host.querySelectorAll('[data-prfam]'), function (b) {
      b.addEventListener('click', function () {
        var first = prStagesInFam(b.dataset.prfam)[0];
        if (first) { prGoStage(first.id); }
      });
    });

    /* stage 8: SPI modes */
    Array.prototype.forEach.call(host.querySelectorAll('[data-spimm]'), function (b) {
      b.addEventListener('click', function () { protos.spi.mMode = Number(b.dataset.spimm) & 3; protos.spi.result = null; prSave(); prRenderStatic(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-spism]'), function (b) {
      b.addEventListener('click', function () { protos.spi.sMode = Number(b.dataset.spism) & 3; protos.spi.result = null; prSave(); prRenderStatic(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-spipair]'), function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.spipair.split(',');
        protos.spi.mMode = Number(p[0]) & 3; protos.spi.sMode = Number(p[1]) & 3;
        protos.spi.result = null; prSave(); prRenderStatic();
      });
    });
    var spByte = document.getElementById('pr-spi-byte');
    if (spByte) {
      spByte.addEventListener('input', function () {
        var v = parseInt(spByte.value, 16);
        protos.spi.byte = isNaN(v) ? 0 : (v & 0xff);
        protos.spi.result = null; prSave();
        /* update only the trace so the caret keeps its place while typing */
        var wc = document.getElementById('pr-spi-wavecard'); if (wc) { wc.outerHTML = prSpiWaveCard(); }
      });
    }
    var spSend = document.getElementById('pr-spi-send');
    if (spSend) {
      spSend.addEventListener('click', function () {
        var u = protos.spi; if (u.tx) { return; }
        u.tx = { kind: 'modes', m: u.mMode, s: u.sMode, out: u.byte };
        if (!protos.running) { protos.running = true; }
        prSave(); prRenderStatic();
      });
    }

    /* stage 9: the shift ring */
    var xrByte = document.getElementById('pr-spi-xbyte');
    if (xrByte) {
      xrByte.addEventListener('input', function () {
        var v = parseInt(xrByte.value, 16);
        protos.spi.byte = isNaN(v) ? 0 : (v & 0xff);
        protos.spi.result = null; prSave();
        var rg2 = document.getElementById('pr-spi-ring'); if (rg2) { rg2.outerHTML = prSpiRingCard(); }
        var xw = document.getElementById('pr-spi-xwave'); if (xw) { xw.outerHTML = '<section class="pf-card" id="pr-spi-xwave"><h3>Logic analyser<span class="pf-sub">three lanes: clock, out, in</span></h3>' + prSpiRingWave() + '</section>'; }
        var xr2 = document.getElementById('pr-spi-xread'); if (xr2) { xr2.innerHTML = prSpiXferReadHtml(); }
      });
    }
    var xrGo = document.getElementById('pr-spi-xfer');
    if (xrGo) {
      xrGo.addEventListener('click', function () {
        var u = protos.spi; if (u.tx) { return; }
        u.tx = { kind: 'ring', out: u.byte, slaveBefore: u.slaveShift };
        if (!protos.running) { protos.running = true; }
        prSave(); prRenderStatic();
      });
    }
    var xrDummy = host.querySelector('[data-spidummy]');
    if (xrDummy) {
      xrDummy.addEventListener('click', function () {
        var u = protos.spi; if (u.tx) { return; }
        u.byte = 0x00;
        u.tx = { kind: 'ring', out: 0x00, slaveBefore: u.slaveShift };
        if (!protos.running) { protos.running = true; }
        prSave(); prRenderStatic();
      });
    }
    var xrNew = host.querySelector('[data-spinew]');
    if (xrNew) {
      xrNew.addEventListener('click', function () {
        var u = protos.spi;
        u.slavePar = 0x20 + Math.floor(Math.random() * 0xdf);
        prLog('note', 'sensor finished a conversion: ' + prHex(u.slavePar) + ' is ready, but the shift ring still holds ' + prHex(u.slaveShift));
        prSave(); prRenderStatic();
      });
    }

    /* goal verify */
    Array.prototype.forEach.call(host.querySelectorAll('[data-prgoal]'), function (b) {
      b.addEventListener('click', function () {
        var n = Number(b.dataset.prgoal), g = PR_GOALS[n], hint = document.getElementById('pr-goal-hint-' + n);
        if (!g) { return; }
        if (g.ok()) {
          if (!protos.goals[n]) { protos.goals[n] = true; prLog('ok', 'Stage ' + n + ' goal achieved: ' + ((prStageById(n) || {}).name || '')); prSave(); prRenderStatic(); }
          else if (hint) { hint.textContent = 'Verified.'; hint.style.color = 'var(--ok)'; }
        } else if (hint) { hint.textContent = 'Not yet — ' + g.hint(); hint.style.color = 'var(--warn)'; }
      });
    });
  }

  function initProtocols() {
    if (protocolsInited) { prRenderStatic(); return; }
    prLoad();
    prSeedLog();
    prRenderStatic();
    prStartTicker();
    document.addEventListener('keydown', prKeysHandle);
    protocolsInited = true;
  }

  /* ---------------- public API ---------------- */
  window.EmbeddedCRoadmap = {
    data: { lenses: LENSES, memoryMap: MEMMAP, stages: STAGES },
    topics: allTopics,
    exportAll: function () {
      return snapshotAll();
    },
    importAll: function (o) {
      restoreBackup(JSON.stringify(o || {}));
    },
    exportProgress: function () { return JSON.parse(JSON.stringify(done)); },
    isDone: isDone,
    view: function (v) { setView(v); },
    importProgress: function (o) { window.EmbeddedCRoadmap.importAll({ done: o }); },
    notesMarkdown: notesMarkdown,
    getNote: function (id) { return notes[id] || ""; },
    setNote: function (id, text) {
      if (text && text.trim()) { notes[id] = text; } else { delete notes[id]; }
      wr(K_NOTE, notes);
    },
    bookmarks: function () { return Object.keys(marks); },
    edges: function () {
      var e = [], seen = {}, codeToId = {};
      allTopics.forEach(function (t) { codeToId[t.code] = t.id; });
      function key(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
      function add(x) {
        var k = x.type === "prereq" || x.type === "mention"
          ? x.type + "|" + x.from + "|" + x.to
          : x.type + "|" + key(x.from, x.to) + "|" + (x.cluster || "");
        if (!seen[k]) { seen[k] = true; e.push(x); }
      }
      allTopics.forEach(function (t) {
        (t.prereq || []).forEach(function (p) {
          if (byId[p]) { add({ from: p, to: t.id, type: "prereq", directed: true }); }
        });
      });
      (typeof CLUSTERS !== "undefined" ? CLUSTERS : []).forEach(function (c) {
        for (var i = 0; i < c.topics.length; i++) {
          for (var j = i + 1; j < c.topics.length; j++) {
            if (byId[c.topics[i]] && byId[c.topics[j]]) {
              add({ from: c.topics[i], to: c.topics[j], type: "pattern", directed: false, cluster: c.id, why: c.blurb });
            }
          }
        }
      });
      var prereqPairs = {};
      e.forEach(function (x) { if (x.type === "prereq") { prereqPairs[key(x.from, x.to)] = true; } });
      allTopics.forEach(function (t) {
        (t.related || []).forEach(function (r) {
          if (byId[t.id] && byId[r.id] && !prereqPairs[key(t.id, r.id)]) {
            add({ from: t.id, to: r.id, type: "related", directed: false, why: r.why || "" });
          }
        });
      });
      allTopics.forEach(function (t) {
        var txt = Object.keys(t.L || {}).map(function (k) { return t.L[k] || ""; }).join(" ");
        var rx = /\btopic\s+(\d+\.\d+)\b/gi, m;
        while ((m = rx.exec(txt))) {
          var id = codeToId[m[1]];
          if (id && id !== t.id) { add({ from: t.id, to: id, type: "mention", directed: true }); }
        }
      });
      return e;
    },
    clusters: function () { return typeof CLUSTERS !== "undefined" ? CLUSTERS : []; },
    cards: function () {
      return allTopics.filter(function (t) { return t.q; }).map(function (t) {
        return { id: t.id, code: t.code, topic: t.t, front: t.q.ask, back: t.q.ans,
                 done: isDone(t.id), note: notes[t.id] || "" };
      });
    },
    stats: function () {
      return {
        total: allTopics.length,
        done: doneCount(),
        notes: Object.keys(notes).length,
        bookmarks: Object.keys(marks).length,
        byStage: STAGES.map(function (s) {
          return { id: s.id, title: s.title, total: s.topics.length,
                   done: s.topics.filter(function (t) { return isDone(t.id); }).length };
        }),
        interview: ivCoverage(),
        faultsSolved: Object.keys(faultState.seen).filter(function (k) { return faultState.seen[k]; }).length,
        faultsTotal: FAULTS.length
      };
    },
    interview: {
      tracks: TRACKS, levels: LEVELS, formats: FORMATS,
      questions: INTERVIEW,
      coverage: function () { return ivCoverage(); },
      answers: function () { return JSON.parse(JSON.stringify(ivState.answers)); }
    },
    faults: {
      scenarios: FAULTS,
      solved: function () { return Object.keys(faultState.seen).filter(function (k) { return faultState.seen[k]; }); }
    },
    focus: goTopic,
    goTopic: goTopic,
    view: setView,
    practice: setSubview,
    onHook: onHook,
    /* fires whenever a topic's learned state changes, so an external 3D graph
       can light up the matching node/edges without polling exportAll(). */
    onDoneChange: function (fn) {
      if (typeof fn === "function") { doneListeners.push(fn); }
    }
  };
}());
</script>
