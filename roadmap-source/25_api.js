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
    /* Shared render helpers, so sibling scripts (the concept graph) never grow
       a second copy of esc() that can drift from this one. */
    esc: esc,
    hl: hl,
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
