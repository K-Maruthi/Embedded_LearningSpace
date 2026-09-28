/* The markdown editor and both things it writes into: a topic's notes and a lab stage's journal.
 *
 * Zero dependencies. Run with:  node specs/note_editor.spec.js
 *
 * buildNotes / noteLen / GATE_MIN and the journal store + mount are sliced out of the
 * app's IIFE - two regions concatenated, so the journal path is tested against the real
 * storage rules rather than a copy of them typed into this file - and run against a
 * small DOM that parses just enough of innerHTML to answer querySelector('.saved'),
 * with setTimeout captured so the 400ms debounce and the 900ms "saved" flash are
 * observable instead of merely not-crashing.
 *
 * This file was written BEFORE the editor was touched, as a characterization spec:
 * sections 1 to 8 are what the topic gate already did, so that extracting a shared
 * editor core for the lab journals could be proven to have changed nothing about how
 * topic notes behave. Sections 9 and on are new behaviour, added with the journals.
 *
 * What this is really guarding: the gate is the app's one hard pedagogical rule - no
 * note of GATE_MIN words, no "Mark as learned" - and it lives in three places at once
 * (the button's visibility, toggleDone's fallback, noteLen's counting), every one of
 * which can break silently in a browser. For the journals the equivalent risk is a
 * stage switch throwing away a sentence that was mid-save.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'roadmap-source', '20_app.js');
const app = fs.readFileSync(SRC, 'utf8');

/* ---- the code under test ----
   Two regions, in source order of what they call. The editor and its journal mount
   live above the topic builder; the journal store lives down in the dashboard section
   with the other read-from-storage lab state. Slicing the store in as written is the
   point - a stub of it here would only prove the two copies agree with each other. */
const edFrom = app.indexOf('  var GATE_MIN = ');
const edTo = app.indexOf('  function buildTopic(t, stage) {');
const stFrom = app.indexOf('  /* ---- lab stage journals, the storage end ----');
const stTo = app.indexOf('  function jrLabStages() {');
if (edFrom < 0 || edTo < edFrom || stFrom < 0 || stTo < stFrom) {
  throw new Error('note-editor / journal markers not found in 20_app.js');
}
const body = app.slice(edFrom, edTo) + "\n" + app.slice(stFrom, stTo);

/* ---- the gate threshold ----
   Sliced as an absolute expectation, not just read back from the source: deriving it
   alone would make the spec agree with whatever number the app currently holds, so
   lowering the gate to 1 word would pass. The count checks below use the derived
   value, so the arithmetic is tested against the real threshold either way. */
const GATE_MIN = Number(/var GATE_MIN = (\d+);/.exec(body)[1]);

/* ---- tiny DOM ---- */
class Node {
  constructor(tag) {
    this.tag = tag; this.kids = []; this.classes = new Set(); this.dataset = {};
    this.listeners = {}; this.value = ''; this.placeholder = ''; this._text = ''; this._html = '';
    const self = this;
    this.classList = {
      add: (...c) => c.forEach((x) => self.classes.add(x)),
      remove: (...c) => c.forEach((x) => self.classes.delete(x)),
      contains: (c) => self.classes.has(c),
      toggle: (c, force) => {
        const want = force === undefined ? !self.classes.has(c) : !!force;
        if (want) { self.classes.add(c); } else { self.classes.delete(c); }
        return want;
      },
    };
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.kids = []; this._html = ''; }
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v); this.kids = []; this._text = '';
    /* Parse classes only, enough for querySelector('.x'): the editor's own markup is
       two spans and a paragraph, and a child we cannot find would read as a missing
       element rather than as this file being too naive. */
    for (const m of String(v).matchAll(/<(\w+)([^>]*)>/g)) {
      const cls = (/class="([^"]*)"/.exec(m[2]) || [, ''])[1];
      if (!cls) { continue; }
      const k = new Node(m[1]);
      cls.split(/\s+/).filter(Boolean).forEach((c) => k.classes.add(c));
      this.kids.push(k);
    }
  }
  get className() { return Array.from(this.classes).join(' '); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  appendChild(k) {
    /* A browser refuses a non-Node here, and that refusal is the whole reason a
       factory returning the wrong shape gets noticed. The stub has to refuse too. */
    if (!(k instanceof Node)) { throw new TypeError('parameter 1 is not of type "Node"'); }
    this.kids.push(k); k.parent = this; return k;
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  dispatch(type) {
    const ev = { target: this, stopPropagation() {}, preventDefault() {} };
    (this.listeners[type] || []).forEach((f) => f(ev));
    return (this.listeners[type] || []).length;
  }
  click() { return this.dispatch('click'); }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = (this.scrolled || 0) + 1; }
  querySelector(sel) { return this.kids.filter((k) => k.classes.has(sel.slice(1)))[0] || null; }
  querySelectorAll() { return []; }
}

/* ---- captured timers: the debounce is the behaviour, not an implementation detail ---- */
let tseq = 0;
const pending = [];
const fired = [];
function fakeSetTimeout(fn, ms) { const id = ++tseq; pending.push({ id, fn, ms, dead: false }); return id; }
function fakeClearTimeout(id) { const t = pending.filter((x) => x.id === id)[0]; if (t) { t.dead = true; } }
function flush() {
  /* One wave only: timers scheduled by a timer that just ran (the 900ms "saved"
     flash being taken back off) wait for the next call. Draining recursively would
     collapse the save and its flash into one instant and make the dot unobservable. */
  const wave = pending.splice(0, pending.length);
  wave.forEach((t) => { fired.push(t.ms); if (!t.dead) { t.fn(); } });
}

const doc = {
  createElement: (tag) => new Node(tag),
  body: new Node('body'),
  /* #jr-* lookups are hosts the labs own. An unknown lab answers null the way a
     browser would, which is what the mount has to survive; a real host is a plain
     node this file can inspect. */
  getElementById: (id) => (byId[id] || null),
};
const byId = {};

/* esc-aware markdown, so a double-escape regression shows up as "&amp;lt;" here the
   same way it would show up as literal source text in the app. */
function mdStub(s) {
  return '<p>' + String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>';
}

let writes = 0, dashes = 0;
const store = {};
const notes = {};
const KJ = 'ecroadmap.journals.v1';
const env = {
  document: doc,
  /* the real esc, so an interpolation that should have been escaped cannot pass here
     and then double-escape in the app */
  esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  el: (tag, cls, html) => {
    const n = new Node(tag);
    if (cls) { n.className = cls; }
    if (html !== undefined) { n.innerHTML = html; }
    return n;
  },
  md: mdStub, notes: notes, GATE_MIN: GATE_MIN,
  rd: (k, fb) => (k in store ? JSON.parse(store[k]) : fb),
  wr: (k, v) => { writes++; store[k] = JSON.stringify(v); },
  K_NOTE: 'ecroadmap.notes.v1', K_JOURNAL: KJ,
  isDone: () => env.__done,
  refreshDash: () => { dashes++; },
  setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
  Object: Object, String: String, JSON: JSON, Array: Array, RegExp: RegExp,
};
env.__done = false;
const M = new Function('env', 'with (env) {\n' + body +
  '\nreturn { len: noteLen, build: buildNotes, GATE: GATE_MIN, ' +
  'key: jrKey, all: jrAll, get: jrGet, set: jrSet, box: journalBox, mount: journalMount };\n}')(env);

let fails = 0, checks = 0;
function ok(name, cond, extra) {
  checks++;
  if (cond) { console.log('pass  ' + name); return; }
  fails++;
  console.log('FAIL  ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra)));
}

/* Each scenario builds a fresh box, because the editor holds its editing state in a
   closure over the box rather than in the note, and that is part of what is tested. */
function scenario(id, initial) {
  Object.keys(notes).forEach((k) => { delete notes[k]; });
  if (initial !== undefined) { notes[id] = initial; }
  writes = 0; dashes = 0; fired.length = 0; pending.length = 0; env.__done = false;
  const wrap = new Node('article');
  const box = M.build({ id: id }, wrap, () => { box.__marked = (box.__marked || 0) + 1; });
  const head = box.kids[0], gateMsg = box.kids[1], view = box.kids[2], btns = box.kids[3];
  return {
    id: id, wrap: wrap, box: box, head: head, gateMsg: gateMsg, view: view, btns: btns,
    edit: btns.kids[0], mark: btns.kids[1],
    saved: () => head.querySelector('.saved'),
    ta: () => view.kids.filter((k) => k.tag === 'textarea')[0] || null,
    /* Called as S.type(...), so the box it types into is `this` - the scenario object
       is not in scope while the literal is still being built. */
    type(text) { const t = this.ta(); t.value = text; t.dispatch('input'); },
  };
}
function words(n) { const a = []; for (let i = 0; i < n; i++) { a.push('w' + i); } return a.join(' '); }

/* ---- 1. the shape of the box ---- */
(function () {
  const S = scenario('t1');
  ok('the note box carries the notes class', S.box.classes.has('notes'));
  ok('head, gate message, view and buttons, in that order',
    [S.head.tag, S.gateMsg.tag, S.view.tag, S.btns.tag].join() === 'h4,p,div,div',
    [S.head.tag, S.gateMsg.tag, S.view.tag, S.btns.tag].join());
  ok('the head says notes and markdown, and owns the saved dot',
    /notes/.test(S.head.innerHTML) && /markdown/.test(S.head.innerHTML) && !!S.saved(),
    S.head.innerHTML);
  ok('an empty note invites writing rather than showing nothing',
    /notes-empty/.test(S.view.innerHTML), S.view.innerHTML);
  ok('and the row reports no note', S.wrap.dataset.note === '0', S.wrap.dataset.note);
  ok('the button offers Write', S.edit.textContent === 'Write', S.edit.textContent);
  ok('Write does not reveal the mark button', !S.mark.classes.has('show'));
})();

/* ---- 2. an existing note is rendered, not re-typed ---- */
(function () {
  const S = scenario('t2', 'stack grows down, and <b>.bss</b> is not data');
  ok('a saved note renders as markdown instead of the empty prompt',
    /<div class="md">/.test(S.view.innerHTML) && !/notes-empty/.test(S.view.innerHTML),
    S.view.innerHTML);
  ok('the note is escaped, so it cannot inject markup',
    S.view.innerHTML.indexOf('&lt;b&gt;') >= 0 && S.view.innerHTML.indexOf('<b>.bss</b>') < 0,
    S.view.innerHTML);
  ok('and escaped exactly once', S.view.innerHTML.indexOf('&amp;lt;') < 0, S.view.innerHTML);
  ok('the row reports a note', S.wrap.dataset.note === '1', S.wrap.dataset.note);
  ok('the button now offers Edit', S.edit.textContent === 'Edit', S.edit.textContent);
})();

/* ---- 3. the word gate ---- */
(function () {
  ok('the gate is twelve words - two sentences, not a paragraph', GATE_MIN === 12, GATE_MIN);
  ok('an absent note is zero words', M.len('nope') === 0, M.len('nope'));
  notes.x = '   \n\t ';
  ok('and so is a note of only whitespace', M.len('x') === 0, M.len('x'));
  notes.x = words(GATE_MIN - 1) + '  last';
  ok(GATE_MIN + ' words reach the gate, however they are spaced', M.len('x') === GATE_MIN, M.len('x'));
  notes.x = words(GATE_MIN - 1);
  ok((GATE_MIN - 1) + ' words do not', M.len('x') === GATE_MIN - 1, M.len('x'));

  const S = scenario('t3');
  S.edit.click();
  S.type(words(GATE_MIN - 1));
  ok('one word short, the mark button stays hidden', !S.mark.classes.has('show'));
  S.type(words(GATE_MIN));
  ok('at the threshold it appears', S.mark.classes.has('show'));
  env.__done = true;
  S.type(words(GATE_MIN) + ' more');
  ok('a topic already learned does not get asked to mark it again', !S.mark.classes.has('show'));
})();

/* ---- 4. editing, debounced saving, the flash ---- */
(function () {
  const S = scenario('t4');
  S.edit.click();
  ok('Write opens a textarea holding the current text', S.ta() !== null && S.ta().value === '', !!S.ta());
  ok('and the button flips to Done', S.edit.textContent === 'Done', S.edit.textContent);
  ok('the empty prompt is gone while editing', S.view.innerHTML === '' || !/notes-empty/.test(S.view.innerHTML),
    S.view.innerHTML);
  ok('the textarea is focused, so typing starts immediately', S.ta().focused === true);

  S.type('the map file lied about .bss size');
  ok('the note lands in memory at once', /map file/.test(notes.t4), notes.t4);
  ok('storage is not written before the debounce fires', writes === 0, writes);
  flush();
  ok('after the pause it is saved', writes === 1 && JSON.parse(store['ecroadmap.notes.v1']).t4 === notes.t4,
    writes);
  ok('the saved dot lights up', S.saved().classes.has('on'));
  ok('and the flash is a pause, not a stuck light', (() => { flush(); return !S.saved().classes.has('on'); })());
  ok('the dashboard hears about it', dashes >= 1, dashes);

  S.type('one edit');
  S.type('two edits');
  const before = writes;
  flush();
  ok('typing through the debounce still costs one write', writes === before + 1, [before, writes]);

  S.type('   ');
  flush();
  ok('deleting all the text removes the note rather than storing a blank',
    !Object.prototype.hasOwnProperty.call(notes, 't4'), notes);
  ok('and the row stops claiming a note', S.wrap.dataset.note === '0', S.wrap.dataset.note);
})();

/* ---- 5. marking learned from inside the notes ---- */
(function () {
  const S = scenario('t5', words(GATE_MIN));
  S.edit.click();
  ok('the gate is already open for a full note', (() => { S.type(notes.t5 + ' tail'); return S.mark.classes.has('show'); })());
  S.mark.click();
  ok('marking learned is announced to the topic', S.box.__marked === 1, S.box.__marked);
  ok('and it leaves editing mode', S.edit.textContent === 'Edit', S.edit.textContent);
  ok('the note text survives the transition', S.view.innerHTML.indexOf('w0') >= 0, S.view.innerHTML);
  ok('the gate styling is cleaned up', !S.box.classes.has('gate') && !S.gateMsg.classes.has('on'),
    [S.box.className, S.gateMsg.className]);
})();

/* ---- 6. leaving the editor without saving ---- */
(function () {
  const S = scenario('t6', 'a note that already exists');
  S.edit.click();
  S.type('scratch scratch scratch');
  S.edit.click();
  ok('Done collapses the editor back to the rendered note',
    /<div class="md">/.test(S.view.innerHTML) && S.edit.textContent === 'Edit',
    [S.view.innerHTML, S.edit.textContent]);
  ok('and an edited note keeps its text', S.view.innerHTML.indexOf('scratch') >= 0, S.view.innerHTML);
  const S2 = scenario('t7');
  S2.edit.click();
  S2.edit.click();
  ok('abandoning an empty editor offers Write again, not Edit',
    S2.edit.textContent === 'Write', S2.edit.textContent);
})();

/* ---- 7. the gate's nudge, called from toggleDone when the note is too short ---- */
(function () {
  const S = scenario('t8');
  ok('the box exposes the gate nudge', typeof S.box._openForGate === 'function');
  S.box._openForGate();
  ok('it styles the box as the gate', S.box.classes.has('gate'));
  ok('it pulses, and stops pulsing', S.box.classes.has('pulse') &&
    (() => { flush(); return !S.box.classes.has('pulse'); })());
  ok('it says why in the message', S.gateMsg.classes.has('on'));
  ok('and it opens the editor so you can comply', S.ta() !== null && S.edit.textContent === 'Done');
  ok('the box scrolls itself into view', S.box.scrolled === 1, S.box.scrolled);
  const before = S.box.kids[1].classes.has('on');
  S.edit.click();
  ok('writing it away clears the nudge', before && !S.gateMsg.classes.has('on') && !S.box.classes.has('gate'));
})();

/* ---- 8. two boxes for two topics do not share state ---- */
(function () {
  const A = scenario('tA', 'notes for A');
  const B = scenario('tB');
  ok('each box renders its own topic\'s note',
    /notes for A/.test(A.view.innerHTML) && /notes-empty/.test(B.view.innerHTML),
    [A.view.innerHTML, B.view.innerHTML]);
  ok('and one box\'s editor does not leak into the other', A.ta() === null && B.ta() === null);
})();

/* ---- 9. the journal store: one key per lab stage, nothing kept for a blank ---- */
function raw(k) { return store[KJ] === undefined ? undefined : JSON.parse(store[KJ])[k]; }
function wipe() { delete store[KJ]; writes = 0; pending.length = 0; }

(function () {
  wipe();
  ok('a journal is keyed lab:stage', M.key('link', 'script') === 'link:script', M.key('link', 'script'));
  ok('a stage nobody wrote in reads back as empty text', M.get('link', 'script') === '', M.get('link', 'script'));
  ok('and the map is empty, not missing', Object.keys(M.all()).length === 0, M.all());
  M.set('link', 'script', 'the ORDER line decides placement, not the file order');
  ok('writing lands it in storage under the lab key',
    raw('link:script') === 'the ORDER line decides placement, not the file order', raw('link:script'));
  M.set('link', 'memory', '   ');
  ok('a blank journal is never stored', raw('link:memory') === undefined, Object.keys(M.all()));
  M.set('link', 'script', '');
  ok('clearing a journal deletes the key instead of leaving an empty entry',
    raw('link:script') === undefined, Object.keys(M.all()));
  M.set('periph', 3, 'duty is CCR over ARR');
  ok('a numeric stage id keys the same way a name does', raw('periph:3') === 'duty is CCR over ARR', raw('periph:3'));
  M.set('protocols', 4, 'baud error accumulates across a frame');
  M.set('protocols', 5, 'the master owns the clock, not the data');
  ok('writing one stage cannot roll back another that was written first',
    M.get('protocols', 4) === 'baud error accumulates across a frame' &&
    M.get('protocols', 5) === 'the master owns the clock, not the data', M.all());
})();

/* ---- 10. the box the labs mount ---- */
function freshHost(lab) { const h = new Node('div'); h.id = 'jr-' + lab; byId['jr-' + lab] = h; return h; }

(function () {
  wipe();
  const host = freshHost('compile');
  M.mount('compile', 'link', '6. Link');
  ok('the mount puts exactly one box in the host', host.kids.length === 1, host.kids.length);
  const box = host.kids[0];
  ok('it is a notes box with the journal modifier, so the styling is inherited',
    box.classes.has('notes') && box.classes.has('jrbox'), box.className);
  ok('head, view and buttons, and no gate message', box.kids.length === 3, box.kids.length);
  ok('the head names the stage the journal belongs to',
    /6\. Link/.test(box.kids[0].innerHTML) && /stage journal/.test(box.kids[0].innerHTML),
    box.kids[0].innerHTML);
  ok('a journal has one button and it is the editor - nothing here is gated',
    box.kids[2].kids.length === 1 && box.kids[2].kids[0].textContent === 'Write',
    box.kids[2].kids.map((k) => k.textContent));

  box.kids[2].kids[0].click();
  const ta = box.kids[1].kids[0];
  ok('Write opens a textarea in the view', ta !== undefined && ta.tag === 'textarea', ta && ta.tag);
  ta.value = 'the linker resolves symbols; the loader only sees addresses';
  ta.dispatch('input');
  ok('typing is not in storage before the debounce has had its pause',
    raw('compile:link') === undefined, raw('compile:link'));
  flush();
  ok('after the pause the stage journal is stored',
    raw('compile:link') === 'the linker resolves symbols; the loader only sees addresses', raw('compile:link'));
  ok('and the store reads it back for whoever asks next',
    M.get('compile', 'link') === 'the linker resolves symbols; the loader only sees addresses');

  const first = host.kids[0];
  M.mount('compile', 'link', '6. Link');
  ok('re-mounting the stage you are already on does not rebuild the box',
    host.kids.length === 1 && host.kids[0] === first, host.kids.length);
  ok('so a renderer that redraws cannot throw away the sentence being typed',
    host.kids[0].kids[1].kids[0].value === 'the linker resolves symbols; the loader only sees addresses',
    host.kids[0].kids[1].kids[0].value);

  M.mount('compile', 'image', '7. Image');
  ok('a different stage does get its own box', host.kids.length === 1 && host.kids[0] !== first);
  ok('and the stage left behind keeps what was written on it',
    M.get('compile', 'link') === 'the linker resolves symbols; the loader only sees addresses');

  /* The case the whole mount design exists for: leaving a stage mid-sentence. */
  const nb = host.kids[0];
  nb.kids[2].kids[0].click();
  const tb = nb.kids[1].kids[0];
  tb.value = 'the image is the only thing the flasher ever reads';
  tb.dispatch('input');
  M.mount('compile', 'check', '8. Check');
  flush();
  ok('a box thrown away mid-save still lands its text on the stage it was writing about',
    M.get('compile', 'image') === 'the image is the only thing the flasher ever reads',
    [M.get('compile', 'image'), M.get('compile', 'check')]);
  ok('and it does not leak into the stage that replaced it', M.get('compile', 'check') === '');

  /* Coming back is the whole point of a journal, so the read side is asserted as hard
     as the write side: a box that always opens empty would pass every check above. */
  M.mount('compile', 'link', '6. Link');
  ok('coming back to a stage shows what was written on it',
    /linker resolves symbols/.test(host.kids[0].kids[1].innerHTML), host.kids[0].kids[1].innerHTML);
  host.kids[0].kids[2].kids[0].click();
  ok('and the editor opens with that text in it, ready to continue',
    host.kids[0].kids[1].kids[0].value === 'the linker resolves symbols; the loader only sees addresses',
    host.kids[0].kids[1].kids[0].value);
  host.kids[0].kids[2].kids[0].click();

  delete byId['jr-link'];
  let threw = null;
  try { M.mount('link', 'mcu', '1. MCU'); } catch (e) { threw = String((e && e.message) || e); }
  ok('a lab with no host in the markup is skipped, not thrown on', threw === null, threw);
  ok('and nothing is written for it', raw('link:mcu') === undefined, Object.keys(M.all()));
})();

console.log(fails ? '\n' + fails + ' FAILURE(S) of ' + checks : '\nall green (' + checks + ' checks)');
process.exit(fails ? 1 : 0);
