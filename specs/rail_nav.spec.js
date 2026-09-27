/* Left-rail navigation: one pressed button, a crumb that follows it, every view reachable.
 *
 * Zero dependencies. Run with:  node specs/rail_nav.spec.js
 *
 * setView / syncRail / setSubview are sliced out of the app and run against a tiny
 * DOM assembled from the real markup in 01_head.html and 02_body.html, so the rail
 * being tested here is the rail users get, not a copy this file keeps current.
 *
 * What this is really guarding: a rail button is either a view (data-v) or a track
 * inside Practice (data-v + data-sv). Match on data-v alone and all four Practice
 * tracks light up at once; forget the data-sv match and the crumb lies about where
 * you are. Both fail quietly in a browser and loudly here.
 */
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'roadmap-source');
const head = fs.readFileSync(path.join(srcDir, '01_head.html'), 'utf8');
const page = fs.readFileSync(path.join(srcDir, '02_body.html'), 'utf8');
const app = fs.readFileSync(path.join(srcDir, '20_app.js'), 'utf8');

/* ---- the rail, as it is written ---- */
const shell = head.slice(head.indexOf('<body>'));
const groups = [...shell.matchAll(
  /<details class="rgroup"([^>]*)>\s*<summary><span class="rname">([^<]*)<\/span><span class="rcount">(\d+)<\/span><\/summary>([\s\S]*?)<\/details>/g)].map((m) => ({
  label: m[2].trim(),
  count: Number(m[3]),
  open: /\bopen\b/.test(m[1]),
  btns: [...m[4].matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map((b) => ({
    label: b[2].trim(),
    v: (/data-v="([^"]+)"/.exec(b[1]) || [, ''])[1],
    sv: (/data-sv="([^"]+)"/.exec(b[1]) || [, ''])[1],
    pressed: /aria-pressed="true"/.test(b[1]),
  })),
}));
const rail = [];
groups.forEach((g) => g.btns.forEach((b) => rail.push({ g: g, label: b.label, v: b.v, sv: b.sv, pressed: b.pressed })));

const views = [...new Set([...page.matchAll(/id="view-([a-z0-9_-]+)"/g)].map((m) => m[1]))];
const subviews = [...new Set([...page.matchAll(/id="sv-([a-z0-9_-]+)"/g)].map((m) => m[1]))];
const pvNav = page.slice(page.indexOf('id="pv-subnav"'));
const pvBtns = [...pvNav.slice(0, pvNav.indexOf('</nav>')).matchAll(/data-sv="([^"]+)"/g)].map((m) => m[1]);

/* ---- tiny DOM ---- */
function el(id) {
  return {
    id: id, hidden: false, textContent: '', dataset: {}, style: {}, attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    closest() { return this._grp; },
  };
}
/* One group object per <details>, shared by its buttons - collapsing a section has to
   affect every button in it, or "opening the section you landed in" proves nothing.
   querySelector answers like a browser does: the summary's own text carries the count,
   so reading it instead of .rname shows up as "Labs4" rather than passing quietly. */
const grpObjs = {};
groups.forEach((g) => {
  grpObjs[g.label] = {
    label: g.label, open: g.open,
    querySelector(sel) {
      return { textContent: sel === '.rname' ? this.label : this.label + g.count };
    },
  };
});
const viewNodes = {};
views.forEach((n) => { viewNodes['view-' + n] = el('view-' + n); });
const btnEls = rail.map((b) => {
  const e = el('');
  e.dataset = { v: b.v };
  if (b.sv) { e.dataset.sv = b.sv; }
  e.textContent = b.label;
  e.attrs['aria-pressed'] = String(b.pressed);
  e._grp = grpObjs[b.g.label];
  return e;
});
const byId = {};
Object.keys(viewNodes).forEach((k) => { byId[k] = viewNodes[k]; });
['q', 'expandall', 'crumb-grp', 'crumb-view'].forEach((k) => { byId[k] = el(k); });
subviews.forEach((n) => { byId['sv-' + n] = el('sv-' + n); });
['bitlab', 'diffs'].forEach((n) => { byId['pgv-' + n] = el('pgv-' + n); });
const pvBtnEls = pvBtns.map((n) => { const e = el(''); e.dataset = { sv: n }; return e; });
const pgBtnEls = ['bitlab', 'diffs'].map((n) => { const e = el(''); e.dataset = { sv: n }; return e; });

let scrolled = 0;
const doc = {
  getElementById: (id) => { if (!(id in byId)) { throw new Error('spec DOM has no element #' + id); } return byId[id]; },
  querySelectorAll: (sel) => {
    if (sel === '.view') { return Object.values(viewNodes); }
    if (sel === '.rgroup') { return Object.values(grpObjs); }
    if (sel === '.viewsw button') { return btnEls; }
    if (sel === '#pv-subnav button') { return pvBtnEls; }
    if (sel === '#pg-subnav button') { return pgBtnEls; }
    throw new Error('spec DOM cannot answer ' + sel);
  },
};

/* ---- the code under test ---- */
const from = app.indexOf('  function setView(v) {');
const to = app.indexOf('  function goTopic(id)');
if (from < 0 || to < 0 || to < from) { throw new Error('navigation markers not found in 20_app.js'); }

const calls = [];
const env = {
  document: doc, Array: Array, String: String, Object: Object,
  window: { scrollTo() { scrolled++; } },
  currentView: 'roadmap', currentSubview: 'interview', currentPgSubview: 'bitlab',
  ivInited: true, labInited: true, faultsInited: true, pgInited: { bitlab: true, diffs: true },
  refreshDash: (f) => calls.push('dash' + f), refreshMosaic: () => calls.push('mosaic'),
  fireHook: (h) => calls.push(h), initCompileLab: () => calls.push('compile'),
  initLinkLab: () => calls.push('link'), initPeriph: () => calls.push('periph'),
  initProtocols: () => calls.push('protocols'), initInterview: () => calls.push('iv'),
  initLab: () => calls.push('lab'), initFaults: () => calls.push('faults'),
};
const M = new Function('env', 'with (env) {\n' + app.slice(from, to) +
  '\nreturn { setView: setView, setSubview: setSubview, view: () => currentView, sub: () => currentSubview };\n}')(env);

let fails = 0, checks = 0;
function ok(name, cond, extra) {
  checks++;
  if (cond) { console.log('pass  ' + name); return; }
  fails++;
  console.log('FAIL  ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra)));
}
function pressed() { return btnEls.filter((b) => b.attrs['aria-pressed'] === 'true'); }
function shown() { return Object.values(viewNodes).filter((n) => !n.hidden).map((n) => n.id); }

/* ---- 1. the rail as written is a complete, unambiguous map of the app ---- */
ok('the rail has four groups', groups.length === 4, groups.map((g) => g.label));
ok('every group has something in it', groups.every((g) => g.btns.length > 0), groups.map((g) => g.btns.length));
ok('rail labels are unique', new Set(rail.map((b) => b.label)).size === rail.length, rail.map((b) => b.label));
ok('a collapsed section still says how much is inside',
  groups.every((g) => g.count === g.btns.length), groups.map((g) => g.label + ':' + g.count + '/' + g.btns.length));
ok('only the group you start in is expanded',
  groups.filter((g) => g.open).map((g) => g.label).join() === 'Read', groups.map((g) => g.label + (g.open ? '+' : '-')));
ok('every rail button names a view that exists', rail.every((b) => views.indexOf(b.v) >= 0),
  rail.filter((b) => views.indexOf(b.v) < 0).map((b) => b.v));
ok('every view can be reached from the rail', views.every((v) => rail.some((b) => b.v === v)),
  views.filter((v) => !rail.some((b) => b.v === v)));
ok('rail tracks name practice subviews that exist', rail.filter((b) => b.sv).every((b) => subviews.indexOf(b.sv) >= 0),
  rail.filter((b) => b.sv && subviews.indexOf(b.sv) < 0).map((b) => b.sv));
ok('the markup starts with exactly one pressed button', rail.filter((b) => b.pressed).length === 1);
ok('and it is the roadmap', (rail.find((b) => b.pressed) || {}).v === 'roadmap');

/* ---- 2. entering each view leaves one button pressed and the crumb true ---- */
views.forEach(function (v) {
  M.setView(v);
  const p = pressed();
  ok(v + ': one view shown', shown().length === 1 && shown()[0] === 'view-' + v, shown());
  ok(v + ': exactly one rail button pressed', p.length === 1, p.map((b) => b.textContent));
  ok(v + ': it is a button for this view', p.length === 1 && p[0].dataset.v === v);
  ok(v + ': the crumb names the section and the button',
    p.length === 1 && byId['crumb-grp'].textContent === p[0]._grp.label && byId['crumb-view'].textContent === p[0].textContent,
    [byId['crumb-grp'].textContent, byId['crumb-view'].textContent]);
  ok(v + ': the crumb is a place, not a headcount', !/\d/.test(byId['crumb-grp'].textContent),
    byId['crumb-grp'].textContent);
  ok(v + ': the rail scrolled the page back to the top', scrolled > 0);
});

/* ---- 3. Practice is four tracks inside one view, not four views ---- */
['interview', 'lab', 'faults', 'tools'].forEach(function (sv) {
  M.setView('practice');
  M.setSubview(sv);
  const p = pressed();
  ok('practice/' + sv + ': only its own track is pressed',
    p.length === 1 && p[0].dataset.sv === sv, p.map((b) => b.dataset.sv || b.dataset.v));
  ok('practice/' + sv + ': the view is still practice', M.view() === 'practice' && shown()[0] === 'view-practice');
});

/* ---- 4. the linker track is a redirect, so the Labs button must take the mark ---- */
M.setView('practice');
M.setSubview('linker');
ok('the linker track redirects to the playground view', M.view() === 'playground' && shown()[0] === 'view-playground');
ok('and presses the Linker button, not a Practice track',
  pressed().length === 1 && pressed()[0].dataset.v === 'playground' && !pressed()[0].dataset.sv,
  pressed().map((b) => b.textContent));

/* ---- 5. one section open at a time, and it is the one you are in ---- */
M.setView('roadmap');
Object.values(grpObjs).forEach((g) => { g.open = false; });
grpObjs.Practice.open = true;          /* a section opened by hand, not navigated to */
M.setView('protocols');
let openNow = Object.values(grpObjs).filter((g) => g.open).map((g) => g.label);
ok('entering a lab opens its own section and no other', openNow.length === 1 && openNow[0] === 'Labs', openNow);
M.setView('dash');
openNow = Object.values(grpObjs).filter((g) => g.open).map((g) => g.label);
ok('and the section you left closes behind you', openNow.join() === 'Progress', openNow);

/* ---- 6. the roadmap-only tools hide themselves elsewhere ---- */
M.setView('protocols');
ok('search and expand-all are hidden off the roadmap',
  byId.q.style.display === 'none' && byId.expandall.style.display === 'none',
  [byId.q.style.display, byId.expandall.style.display]);
M.setView('roadmap');
ok('and shown again on it', byId.q.style.display === '' && byId.expandall.style.display === '');

console.log(fails ? '\n' + fails + ' FAILURE(S) of ' + checks : '\nall green (' + checks + ' checks)');
process.exit(fails ? 1 : 0);
