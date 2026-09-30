<script>
/* Concept graph. Reads everything through EmbeddedCRoadmap (edges(), clusters(), topics),
   so it is one rendering of the same data model an external 3D graph would use.
   Own force layout on purpose: no CDN, works from a downloaded file. */
(function () {
  "use strict";
  var R = window.EmbeddedCRoadmap;
  if (!R) { return; }
  /* esc comes from the app's public API — one definition, no drift. The fallback
     only exists so this file still loads when the graph is opened standalone. */
  var esc = R.esc || function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
  var NS = "http://www.w3.org/2000/svg";
  var W = 1000, H = 660;
  var STAGE_HUES = ["var(--link)", "var(--steel)", "var(--violet)", "var(--warn)", "var(--ok)", "var(--accent)", "var(--olive)"];
  var KINDS = [
    { k: "prereq", label: "prerequisite" },
    { k: "pattern", label: "same failure pattern" },
    { k: "related", label: "conceptually related" },
    { k: "mention", label: "mentioned in text" }
  ];
  var MODES = [{ k: "stage", label: "by stage" }, { k: "pattern", label: "by pattern" }, { k: "free", label: "free" }];

  var show = { prereq: true, pattern: true, related: true, mention: false };
  var mode = "stage", selId = null, activeCluster = null;
  var built = false, alpha = 0, running = false;
  var nodes = [], hubs = [], links = [], nodeById = {}, hubById = {}, stageLists = {};
  var svg, world, gE, gH, gN, tipEl, panelEl, frame;
  var T = { x: 0, y: 0, k: 1 };
  /* Roving-tabindex keyboard traversal: kbdOrder is the roadmap reading order
     (stage by stage), kbdIndex is the node that currently owns tabindex="0". */
  var kbdOrder = [], kbdIndex = 0;

  /* (There used to be a second `function esc()` right here. Because function
     declarations hoist and the `var esc = R.esc || …` above then assigns over it,
     the declaration was dead code that only looked like a second definition —
     exactly the drift the comment at the top promises to avoid. scripts/lint.js now
     scans this file as its own scope so it cannot come back.) */
  function mk(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var a in attrs) { if (Object.prototype.hasOwnProperty.call(attrs, a)) { n.setAttribute(a, attrs[a]); } }
    if (parent) { parent.appendChild(n); }
    return n;
  }
  function rnd(i) { var x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); }

  function seedLayout() {
    var stageCount = Math.max(1, (R.data.stages || []).length);
    var byStage = {};
    nodes.forEach(function (n) { (byStage[n.stage] = byStage[n.stage] || []).push(n); });
    if (mode === "stage") {
      Object.keys(byStage).forEach(function (sk) {
        var list = byStage[sk], col = Number(sk);
        list.forEach(function (n, i) {
          n.x = (col + 0.5) * (W / stageCount);
          n.y = 30 + (i + 0.5) * ((H - 60) / Math.max(1, list.length));
          n.vx = n.vy = 0; n.fixed = false;
        });
      });
    } else if (mode === "pattern") {
      var cs = R.clusters();
      var members = {};
      cs.forEach(function (c, ci) { c.topics.forEach(function (id) { (members[id] = members[id] || []).push(ci); }); });
      nodes.forEach(function (n, i) {
        var list = members[n.id] || [], ci = list.length ? list[0] : (i % Math.max(1, cs.length));
        var cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, cs.length))));
        var col = ci % cols, row = Math.floor(ci / cols);
        n.x = 110 + col * ((W - 220) / Math.max(1, cols - 1));
        n.y = 90 + row * 150 + (rnd(i * 9.3) - 0.5) * 90;
        n.vx = n.vy = 0; n.fixed = false;
      });
    } else {
      nodes.forEach(function (n, i) {
        var a = i * 2.399963, r = 20 + Math.sqrt(i) * 25;
        n.x = W / 2 + Math.cos(a) * Math.min(r, W * 0.42);
        n.y = H / 2 + Math.sin(a) * Math.min(r, H * 0.42);
        n.vx = n.vy = 0; n.fixed = false;
      });
    }
    hubs.forEach(function (h) {
      if (!h.members.length) { return; }
      h.x = h.members.reduce(function (a, n) { return a + n.x; }, 0) / h.members.length;
      h.y = h.members.reduce(function (a, n) { return a + n.y; }, 0) / h.members.length;
      h.vx = h.vy = 0;
    });
  }

  /* ---------- model ---------- */
  function build() {
    var topics = R.topics, stageOf = {};
    (R.data.stages || []).forEach(function (s, si) { s.topics.forEach(function (t) { stageOf[t.id] = si; }); });
    var perStage = {};
    stageLists = {};
    topics.forEach(function (t) { var s = stageOf[t.id] || 0; perStage[s] = (perStage[s] || 0) + 1; });
    var seen = {};
    nodes = topics.map(function (t, i) {
      var s = stageOf[t.id] || 0, idx = seen[s] = (seen[s] || 0) + 1;
      var n = { id: t.id, t: t, stage: s, deg: 0, vx: 0, vy: 0, fixed: false,
        x: (s + 0.5) * (W / Math.max(1, (R.data.stages || []).length)) + (rnd(i * 3.1) - 0.5) * 60,
        y: (idx / (perStage[s] + 1)) * (H - 40) + 20 + (rnd(i * 7.7) - 0.5) * 20 };
      nodeById[t.id] = n;
      (stageLists[s] = stageLists[s] || []).push(n);
      return n;
    });
    links = [];
    R.edges().forEach(function (e) {
      var a = nodeById[e.from], b = nodeById[e.to];
      if (!a || !b || e.type === "pattern") { return; }
      links.push({ a: a, b: b, kind: e.type, why: e.why });
      if (e.type !== "mention") { a.deg++; b.deg++; }
    });
    hubs = R.clusters().map(function (c, ci) {
      var mem = c.topics.map(function (id) { return nodeById[id]; }).filter(Boolean);
      var cx = 0, cy = 0;
      mem.forEach(function (m) { cx += m.x; cy += m.y; });
      var h = { id: "hub:" + c.id, c: c, hub: true, members: mem, x: cx / mem.length, y: cy / mem.length, vx: 0, vy: 0 };
      hubById[c.id] = h;
      mem.forEach(function (m) { links.push({ a: h, b: m, kind: "pattern", cluster: c.id }); m.deg += 0.5; });
      return h;
    });
    nodes.forEach(function (n) { n.r = 5 + Math.min(n.deg, 12) * 0.55; });
    /* Stable reading order for the keyboard: stage by stage, in roadmap order.
       Taken once, so arrow keys do not reorder themselves as the layout settles. */
    kbdOrder = [];
    Object.keys(stageLists).sort(function (a, b) { return a - b; })
      .forEach(function (s) { kbdOrder = kbdOrder.concat(stageLists[s]); });
  }

  /* ---------- forces ---------- */
  function byStageForNode(n) { return stageLists[n.stage] || []; }
  function tick() {
    var all = nodes.concat(hubs), n = all.length, i, j, a, b, dx, dy, d, f;
    var wPat = mode === "pattern" ? 2.4 : (mode === "stage" ? 0.35 : 1);
    var wPre = mode === "pattern" ? 0.5 : 1, wRel = mode === "pattern" ? 0.5 : 0.7, wMen = 0.15;
    for (i = 0; i < n; i++) {
      a = all[i];
      for (j = i + 1; j < n; j++) {
        b = all[j];
        dx = a.x - b.x; dy = a.y - b.y;
        d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        if (d > 170) { continue; }
        f = ((a.hub || b.hub) ? 60 : 26) / Math.max(d, 10) * alpha;
        dx = dx / d * f; dy = dy / d * f;
        a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
      }
    }
    links.forEach(function (l) {
      var A = l.a, B = l.b, k, len, w;
      dx = B.x - A.x; dy = B.y - A.y;
      d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      if (l.kind === "pattern") { len = 38; w = wPat * 0.09; }
      else if (l.kind === "prereq") { len = 70; w = wPre * 0.05; }
      else if (l.kind === "related") { len = 90; w = wRel * 0.03; }
      else { len = 120; w = wMen * 0.03; }
      k = (d - len) * w * alpha; dx = dx / d * k; dy = dy / d * k;
      A.vx += dx; A.vy += dy; B.vx -= dx; B.vy -= dy;
    });
    all.forEach(function (p) {
      if (mode === "stage" && !p.hub) {
        var stageCount = Math.max(1, (R.data.stages || []).length);
        var list = byStageForNode(p);
        var idx = list ? list.indexOf(p) : 0;
        var targetX = (p.stage + 0.5) * (W / stageCount);
        var targetY = 30 + (idx + 0.5) * ((H - 60) / Math.max(1, list ? list.length : 1));
        p.vx += (targetX - p.x) * 0.055 * alpha;
        p.vy += (targetY - p.y) * 0.055 * alpha;
      } else {
        p.vx += (W / 2 - p.x) * 0.002 * alpha; p.vy += (H / 2 - p.y) * 0.003 * alpha;
      }
      if (p.fixed) { p.vx = 0; p.vy = 0; return; }
      p.vx *= 0.6; p.vy *= 0.6;
      p.x = Math.max(16, Math.min(W - 16, p.x + p.vx));
      p.y = Math.max(16, Math.min(H - 16, p.y + p.vy));
    });
  }

  function place() {
    nodes.forEach(function (n) { n.el.setAttribute("transform", "translate(" + n.x.toFixed(1) + "," + n.y.toFixed(1) + ")"); });
    hubs.forEach(function (h) { h.el.setAttribute("transform", "translate(" + h.x.toFixed(1) + "," + h.y.toFixed(1) + ")"); });
    links.forEach(function (l) {
      var A = l.a, B = l.b, x2 = B.x, y2 = B.y;
      if (l.kind === "prereq") {
        var dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) || 1, r = (B.r || 6) + 3;
        x2 = B.x - dx / d * r; y2 = B.y - dy / d * r;
      }
      l.el.setAttribute("x1", A.x.toFixed(1)); l.el.setAttribute("y1", A.y.toFixed(1));
      l.el.setAttribute("x2", x2.toFixed(1)); l.el.setAttribute("y2", y2.toFixed(1));
    });
  }

  function loop() {
    if (!running) { return; }
    var host = document.getElementById("view-graph");
    if (!host || host.hidden) { running = false; return; }
    for (var s = 0; s < 2; s++) { tick(); alpha = Math.max(0.0005, alpha * 0.986); }
    place();
    if (alpha <= 0.0006 && !dragging) { running = false; return; }
    window.requestAnimationFrame(loop);
  }
  function reheat(a) {
    alpha = Math.max(alpha, a || 0.8);
    if (!running) { running = true; window.requestAnimationFrame(loop); }
  }

  /* ---------- drawing ---------- */
  function draw() {
    frame = document.getElementById("gframe");
    tipEl = document.getElementById("gtip");
    panelEl = document.getElementById("gpanel");
    svg = mk("svg", { "class": "graph", viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "xMidYMid meet" });
    var defs = mk("defs", {}, svg);
    var mkr = mk("marker", { id: "garrow", viewBox: "0 0 8 8", refX: "7", refY: "4", markerWidth: "6", markerHeight: "6", orient: "auto" }, defs);
    mk("path", { d: "M0,0 L8,4 L0,8 z", fill: "var(--ink-2)" }, mkr);
    world = mk("g", {}, svg);
    gE = mk("g", {}, world); gH = mk("g", {}, world); gN = mk("g", {}, world);

    links.forEach(function (l) {
      var cl = "gedge k-" + l.kind + (l.kind === "mention" && !show.mention ? " hide" : "");
      var attrs = { "class": cl };
      if (l.kind === "pattern") { attrs.style = "stroke:" + hubById[l.cluster].c.color; }
      if (l.kind === "prereq") { attrs["marker-end"] = "url(#garrow)"; }
      l.el = mk("line", attrs, gE);
    });
    hubs.forEach(function (h) {
      var g = mk("g", { "class": "ghub" }, gH);
      var col = h.c.color;
      mk("polygon", { points: "0,-11 11,0 0,11 -11,0", fill: col, "fill-opacity": ".22", stroke: col, "stroke-width": "1.6" }, g);
      var tx = mk("text", { y: "-16", fill: col }, g);
      tx.textContent = h.c.label.length > 34 ? h.c.label.slice(0, 32) + "\u2026" : h.c.label;
      g.addEventListener("click", function (e) { e.stopPropagation(); spotlight(activeCluster === h.c.id ? null : h.c.id); });
      h.el = g;
    });
    nodes.forEach(function (n, i) {
      var g = mk("g", { "class": "gnode", "data-id": n.id }, gN);
      mk("circle", { "class": "core", r: n.r.toFixed(1), fill: STAGE_HUES[n.stage % STAGE_HUES.length] }, g);
      var tx = mk("text", { "class": "nlabel", y: (n.r + 10).toFixed(1) }, g);
      tx.textContent = n.t.code;
      /* A graph node is an interactive thing, so it says so and takes part in a
         roving tabindex — otherwise the one view that is entirely about
         relationships would be mouse-only. */
      g.setAttribute("tabindex", i === 0 ? "0" : "-1");
      g.setAttribute("role", "button");
      renderNodeLabel(n, g);
      g.addEventListener("focus", function () { kbdIndex = kbdOrder.indexOf(n); showNodeTip(n); });
      g.addEventListener("blur", function () { tipEl.classList.remove("on"); });
      n.el = g;
      bindNode(n);
    });
    frame.insertBefore(svg, frame.firstChild);
    bindSvg();
    bindKeys();
    syncDone();
    applyVisibility();
    applyFocus();
    place();
  }

  function syncDone() {
    nodes.forEach(function (n) {
      var c = n.el.querySelector("circle.core");
      c.setAttribute("fill-opacity", R.isDone(n.id) ? "0.98" : "0.32");
    });
  }

  /* ---------- interaction ---------- */
  var dragging = null, panning = null, moved = 0;
  function toWorld(cx, cy) {
    var ctm = svg.getScreenCTM && svg.getScreenCTM();
    if (!ctm) { return { x: cx, y: cy }; }
    var pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
    var p = pt.matrixTransform(ctm.inverse());
    return { x: (p.x - T.x) / T.k, y: (p.y - T.y) / T.k };
  }
  function applyT() { world.setAttribute("transform", "translate(" + T.x.toFixed(1) + "," + T.y.toFixed(1) + ") scale(" + T.k.toFixed(3) + ")"); }

  function bindNode(n) {
    n.el.addEventListener("pointerdown", function (e) {
      e.stopPropagation();
      dragging = n; moved = 0;
      n.fixed = true;
      try { n.el.setPointerCapture(e.pointerId); } catch (x) { /* not critical */ }
      reheat(0.3);
    });
    n.el.addEventListener("pointermove", function (e) {
      if (dragging !== n) { showTip(n, e); return; }
      moved++;
      var p = toWorld(e.clientX, e.clientY);
      n.x = p.x; n.y = p.y; n.vx = n.vy = 0;
      reheat(0.25); place();
    });
    n.el.addEventListener("pointerup", function (e) {
      if (dragging !== n) { return; }
      dragging = null;
      if (moved < 4) { n.fixed = false; select(selId === n.id ? null : n.id); }
      else { setTimeout(function () { n.fixed = false; }, 0); }
    });
    n.el.addEventListener("pointerleave", function () { tipEl.classList.remove("on"); });
  }
  /* ---------- keyboard traversal ----------
     Arrow Up/Down walk one stage's column (the layout's own reading order);
     Arrow Left/Right move to the neighbouring stage, landing on the node nearest
     the current height; Home/End jump to the ends; Enter/Space select and Escape
     clears. Focus is real DOM focus, so the ring is the browser's own. */
  function focusNode(n, announce) {
    if (!n) { return; }
    var prev = kbdOrder[kbdIndex];
    if (prev && prev !== n) { prev.el.setAttribute("tabindex", "-1"); }
    kbdIndex = kbdOrder.indexOf(n);
    if (kbdIndex < 0) { kbdIndex = 0; }
    n.el.setAttribute("tabindex", "0");
    try { n.el.focus(); } catch (e) { /* older engines */ }
    if (announce) { showNodeTip(n); }
  }
  function moveFocus(dir) {
    var cur = kbdOrder[kbdIndex];
    if (!cur) { focusNode(kbdOrder[0], true); return; }
    if (dir === "up" || dir === "down") {
      var list = stageLists[cur.stage] || [cur];
      var i = list.indexOf(cur) + (dir === "down" ? 1 : -1);
      if (i >= 0 && i < list.length) { focusNode(list[i], true); }
      return;
    }
    var next = stageLists[cur.stage + (dir === "right" ? 1 : -1)];
    if (!next || !next.length) { return; }
    var best = next[0], bestD = Infinity;
    next.forEach(function (n) { var dd = Math.abs(n.y - cur.y); if (dd < bestD) { bestD = dd; best = n; } });
    focusNode(best, true);
  }
  function bindKeys() {
    var arrows = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    svg.addEventListener("keydown", function (e) {
      var k = e.key;
      if (arrows[k]) { e.preventDefault(); moveFocus(arrows[k]); return; }
      if (k === "Home") { e.preventDefault(); focusNode(kbdOrder[0], true); return; }
      if (k === "End") { e.preventDefault(); focusNode(kbdOrder[kbdOrder.length - 1], true); return; }
      if (k === "Enter" || k === " " || k === "Spacebar") {
        e.preventDefault();
        var cur = kbdOrder[kbdIndex];
        if (cur) { select(selId === cur.id ? null : cur.id); }
        return;
      }
      if (k === "Escape") { e.preventDefault(); select(null); spotlight(null); }
    });
  }
  function bindSvg() {
    svg.addEventListener("pointerdown", function (e) {
      if (e.target !== svg && e.target.closest && e.target.closest(".gnode,.ghub")) { return; }
      panning = { x: e.clientX, y: e.clientY, tx: T.x, ty: T.y, moved: 0 };
      svg.classList.add("panning");
    });
    svg.addEventListener("pointermove", function (e) {
      if (!panning) { return; }
      var r = svg.getBoundingClientRect(), sc = W / (r.width || W);
      panning.moved++;
      T.x = panning.tx + (e.clientX - panning.x) * sc;
      T.y = panning.ty + (e.clientY - panning.y) * sc;
      applyT();
    });
    var end = function () {
      if (!panning) { return; }
      var was = panning; panning = null; svg.classList.remove("panning");
      if (was.moved < 3) { select(null); }
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointerleave", end);
    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      var p = toWorld(e.clientX, e.clientY), k = Math.max(0.4, Math.min(3.5, T.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      T.x += (p.x * T.k - p.x * k); T.y += (p.y * T.k - p.y * k); T.k = k;
      applyT();
    }, { passive: false });
  }
  function renderNodeLabel(n, g) {
    g.setAttribute("aria-label", n.t.code + " " + n.t.t + (R.isDone(n.id) ? " (learned)" : ""));
  }
  function tipHtml(n) {
    var cl = (R.clusters().filter(function (c) { return c.topics.indexOf(n.id) !== -1; }).map(function (c) { return c.label; })).join("; ");
    return '<span class="c">' + esc(n.t.code) + (R.isDone(n.id) ? " \u00b7 learned" : "") + "</span>" + esc(n.t.t) +
      (cl ? '<span class="c" style="margin-top:4px">' + esc(cl) + "</span>" : "");
  }
  function placeTip(left, top) {
    var b = frame.getBoundingClientRect();
    tipEl.style.left = Math.max(4, Math.min(b.width - 270, left)) + "px";
    tipEl.style.top = Math.max(4, Math.min(b.height - 64, top)) + "px";
    tipEl.classList.add("on");
  }
  function showTip(n, e) {
    tipEl.innerHTML = tipHtml(n);
    var b = frame.getBoundingClientRect();
    placeTip(e.clientX - b.left + 14, e.clientY - b.top + 14);
  }
  /* Same tooltip, positioned from the node element rather than a pointer, so what
     a keyboard user sees matches what hovering shows. */
  function showNodeTip(n) {
    tipEl.innerHTML = tipHtml(n);
    var nb = n.el.getBoundingClientRect(), b = frame.getBoundingClientRect();
    placeTip(nb.left - b.left + nb.width + 8, nb.top - b.top);
  }

  /* ---------- selection / spotlight ---------- */
  function visibleNeighbours(id) {
    var out = {};
    links.forEach(function (l) {
      if (l.kind === "pattern" || !show[l.kind]) { return; }
      if (l.a.id === id) { out[l.b.id] = 1; } else if (l.b.id === id) { out[l.a.id] = 1; }
    });
    if (show.pattern) {
      hubs.forEach(function (h) {
        if (h.c.topics.indexOf(id) !== -1) { h.c.topics.forEach(function (o) { if (o !== id) { out[o] = 1; } }); }
      });
    }
    return out;
  }
  function applyVisibility() {
    links.forEach(function (l) { l.el.classList.toggle("hide", !show[l.kind]); });
    hubs.forEach(function (h) { h.el.style.display = show.pattern ? "" : "none"; });
    var kb = document.getElementById("gkinds");
    if (kb) { Array.prototype.forEach.call(kb.querySelectorAll(".gk"), function (b) { b.setAttribute("aria-pressed", String(!!show[b.dataset.k])); }); }
  }
  function applyFocus() {
    var nb = selId ? visibleNeighbours(selId) : null;
    var inCl = activeCluster ? hubById[activeCluster].c.topics : null;
    nodes.forEach(function (n) {
      var dim = false, isNb = false;
      if (selId) { dim = n.id !== selId && !nb[n.id]; isNb = !dim; }
      if (inCl) { dim = inCl.indexOf(n.id) === -1; isNb = !dim; }
      n.el.classList.toggle("dim", dim);
      n.el.classList.toggle("nb", isNb && n.id !== selId);
      n.el.classList.toggle("sel", n.id === selId);
    });
    hubs.forEach(function (h) {
      var dim = false;
      if (selId) { dim = h.c.topics.indexOf(selId) === -1; }
      if (activeCluster) { dim = h.c.id !== activeCluster; }
      h.el.classList.toggle("dim", dim);
    });
    links.forEach(function (l) {
      var lit = false, dim = false;
      if (selId) {
        if (l.kind === "pattern") { lit = l.b.id === selId; dim = !(l.b.id === selId || (nb && nb[l.b.id] && l.a.c.topics.indexOf(selId) !== -1)); }
        else { lit = l.a.id === selId || l.b.id === selId; dim = !lit; }
      }
      if (activeCluster) {
        var inC = l.kind === "pattern" && l.cluster === activeCluster;
        lit = inC; dim = !inC;
      }
      l.el.classList.toggle("lit", lit);
      l.el.classList.toggle("dim", dim);
    });
  }
  function select(id) {
    selId = id;
    if (id) { activeCluster = null; refreshClusterChips(); document.getElementById("gblurb").textContent = "Select a failure pattern to spotlight it."; }
    applyFocus(); renderPanel();
  }
  function spotlight(cid) {
    activeCluster = cid; selId = null;
    var c = cid ? hubById[cid].c : null;
    document.getElementById("gblurb").textContent = c ? c.blurb + " (" + c.topics.length + " topics, highlighted.)" : "Select a failure pattern to spotlight it.";
    refreshClusterChips(); applyFocus(); renderPanel();
  }
  function refreshClusterChips() {
    var host = document.getElementById("gclusters");
    if (!host) { return; }
    host.innerHTML = "";
    R.clusters().forEach(function (c) {
      var d = c.topics.filter(function (id) { return R.isDone(id); }).length;
      var b = document.createElement("button");
      b.type = "button"; b.className = "gc-chip"; b.style.color = c.color;
      b.setAttribute("aria-pressed", String(activeCluster === c.id));
      b.innerHTML = '<span class="dot" style="background:' + c.color + '"></span><span style="color:var(--ink)">' + esc(c.label) +
        '</span><span class="cnt">' + d + "/" + c.topics.length + "</span>";
      b.addEventListener("click", function () { spotlight(activeCluster === c.id ? null : c.id); });
      host.appendChild(b);
    });
  }

  /* ---------- side panel ---------- */
  function li(o, why) {
    return '<li><a data-open="' + o.id + '">' + esc(o.t.code) + " " + esc(o.t.t) + "</a>" +
      (why ? '<span class="why">' + esc(why) + "</span>" : "") + "</li>";
  }
  function renderPanel() {
    var n = selId && nodeById[selId];
    if (!n) {
      var c = activeCluster && hubById[activeCluster].c;
      panelEl.innerHTML = c
        ? "<h3>" + esc(c.label) + '</h3><p class="gp-kick">' + esc(c.blurb) + "</p><h5>topics in this pattern</h5><ul>" +
          c.topics.map(function (id) { return li(nodeById[id]); }).join("") + "</ul>"
        : '<h3>Reading the graph</h3><p class="gp-kick">Each dot is one topic; colour is the stage, and a dot fills in when you mark the topic learned. ' +
          "Diamonds are failure patterns: the topics tied to one are the same bug in different clothes. " +
          'Drag a dot to pull on its neighbours, scroll to zoom, drag the background to pan.</p><p class="gp-empty">Click a topic to see how it connects.</p>';
      wirePanel(); return;
    }
    var before = [], after = [], rel = [], men = [], menBy = [];
    function P(o, why) { return { o: o, why: why }; }
    links.forEach(function (l) {
      if (l.kind === "pattern") { return; }
      var other = l.a.id === n.id ? l.b : (l.b.id === n.id ? l.a : null);
      if (!other) { return; }
      if (l.kind === "prereq") { (l.b.id === n.id ? before : after).push(P(other, l.why)); }
      else if (l.kind === "related") { rel.push({ o: other, why: l.why }); }
      else if (l.a.id === n.id) { men.push(other); } else { menBy.push(other); }
    });
    var cl = R.clusters().filter(function (c) { return c.topics.indexOf(n.id) !== -1; });
    panelEl.innerHTML = '<div class="gp-code">' + esc(n.t.code) + "</div><h3>" + esc(n.t.t) + '</h3><p class="gp-kick">' + esc(n.t.kick) + "</p>" +
      '<button class="btn" type="button" data-open="' + n.id + '">Open topic</button>' +
      (before.length ? "<h5>you need first</h5><ul>" + before.map(function (r) { return li(r.o, r.why); }).join("") + "</ul>" : "") +
      (after.length ? "<h5>builds on this</h5><ul>" + after.map(function (r) { return li(r.o, r.why); }).join("") + "</ul>" : "") +
      (rel.length ? "<h5>conceptually related</h5><ul>" + rel.map(function (r) { return li(r.o, r.why); }).join("") + "</ul>" : "") +
      (cl.length ? "<h5>same failure pattern</h5><ul>" + cl.map(function (c) {
        return '<li><a data-cluster="' + c.id + '" style="color:' + c.color + '">' + esc(c.label) + '</a><span class="why">' +
          esc(c.topics.filter(function (id) { return id !== n.id; }).map(function (id) { return nodeById[id].t.code; }).join(", ")) + "</span></li>";
      }).join("") + "</ul>" : "") +
      (men.length ? "<h5>this topic points to</h5><ul>" + men.map(function (o) { return li(o); }).join("") + "</ul>" : "") +
      (menBy.length ? "<h5>pointed to from</h5><ul>" + menBy.map(function (o) { return li(o); }).join("") + "</ul>" : "");
    wirePanel();
  }
  function wirePanel() {
    Array.prototype.forEach.call(panelEl.querySelectorAll("[data-open]"), function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        if (a.tagName === "BUTTON") { R.goTopic(a.dataset.open); } else { select(a.dataset.open); }
      });
    });
    Array.prototype.forEach.call(panelEl.querySelectorAll("[data-cluster]"), function (a) {
      a.style.cursor = "pointer";
      a.addEventListener("click", function () { spotlight(a.dataset.cluster); });
    });
  }

  /* ---------- toolbar ---------- */
  function buildToolbar() {
    var kb = document.getElementById("gkinds"), mb = document.getElementById("gmodes");
    KINDS.forEach(function (K) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "gk"; b.dataset.k = K.k;
      b.setAttribute("aria-pressed", String(!!show[K.k]));
      b.innerHTML = '<span class="sw ' + K.k + '"></span>' + esc(K.label);
      b.addEventListener("click", function () { show[K.k] = !show[K.k]; applyVisibility(); applyFocus(); renderPanel(); });
      kb.appendChild(b);
    });
    MODES.forEach(function (M) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "gk"; b.dataset.m = M.k; b.textContent = M.label;
      b.setAttribute("aria-pressed", String(mode === M.k));
      b.addEventListener("click", function () {
        mode = M.k;
        Array.prototype.forEach.call(mb.children, function (x) { x.setAttribute("aria-pressed", String(x.dataset.m === mode)); });
        seedLayout(); place(); reheat(0.9);
      });
      mb.appendChild(b);
    });
    document.getElementById("g-reheat").addEventListener("click", function () { T.x = 0; T.y = 0; T.k = 1; applyT(); seedLayout(); place(); reheat(0.9); });
  }

  function ensure() {
    if (!built) {
      built = true;
      build(); seedLayout(); buildToolbar(); draw(); refreshClusterChips(); renderPanel();
      reheat(0.9);
    } else { reheat(0.35); }
  }

  R.onHook("view:graph", ensure);
  R.onHook("graph:cluster", function (id) { ensure(); spotlight(id); });
  R.onDoneChange(function () {
    if (!built) { return; }
    syncDone(); refreshClusterChips();
    /* Refresh the spoken label of every node, so "learned" is announced too. */
    nodes.forEach(function (n) { renderNodeLabel(n, n.el); });
  });
  R.graph = {
    focus: function (id) { ensure(); if (nodeById[id]) { select(id); } },
    spotlight: function (id) { ensure(); spotlight(id); },
    kinds: function (o) { Object.keys(o || {}).forEach(function (k) { show[k] = !!o[k]; }); if (built) { applyVisibility(); applyFocus(); } }
  };
}());
</script>
</body>
</html>
