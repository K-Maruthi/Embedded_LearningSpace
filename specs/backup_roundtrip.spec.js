/* Backup / restore round-trip for the global data envelope.
 *
 * Zero dependencies. Run with:  node specs/backup_roundtrip.spec.js
 *
 * The bug this exists to keep fixed: the labs persist to their own ecroadmap.* keys,
 * and for a while snapshotAll() exported only the roadmap state - so "Export data"
 * silently dropped every goal verified in the Peripheral and Protocol labs, which the
 * Dashboard had started showing as progress. The coverage check below is the part that
 * keeps working: it fails if somebody adds a new storage key and forgets to back it up.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '20_app.js'), 'utf8');

/* ---- every storage key the app declares, read from the source ---- */
const declared = {};
for (const m of src.matchAll(/\bK_([A-Z]+)\s*=\s*"(ecroadmap[^"]*)"/g)) { declared['K_' + m[1]] = m[2]; }
const declaredNames = Object.keys(declared);

const from = src.indexOf('/* ---------------- global data backup');
const to = src.indexOf('function initDataTools');
if (from < 0 || to < 0 || to < from) { throw new Error('backup markers not found in 20_app.js'); }
const body = src.slice(from, to);

/* ---- stubs: only what the code under test actually calls ---- */
const ROADMAP = ['K_DONE', 'K_NOTE', 'K_MARK', 'K_IV', 'K_FAULT', 'K_THEME'];
const store = {};
let reloads = 0, scheduled = [];
const env = {
  JSON: JSON, Object: Object, Number: Number, String: String, Array: Array, Date: Date,
  rd: (k, fb) => (k in store ? JSON.parse(store[k]) : fb),
  wr: (k, v) => { store[k] = JSON.stringify(v); },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
  location: { reload() { reloads++; } },
  setTimeout: (fn, ms) => { scheduled.push(fn); return 0; },
  document: {
    getElementById: (id) => ({ textContent: '', dataset: {}, style: {} }),
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, select() {}, click() {} }),
    body: { appendChild() {}, removeChild() {} }
  },
  allTopics: [], progress() {}, refreshDash() {}, refreshMosaic() {}, fireDoneChange() {},
  isDone: () => false, ivInited: false, faultsInited: false, faultOrder: [],
  ivRenderList() {}, ivRenderCoverage() {}, faultShow() {},
  esc: (s) => String(s)
};
/* the lab keys are var-declared elsewhere in the file; hand the block their real values */
['K_DONE', 'K_NOTE', 'K_MARK', 'K_THEME', 'K_IV', 'K_FAULT', 'K_WALK', 'K_BENCH', 'K_LKSAND', 'K_PERIPH', 'K_PROTOS']
  .forEach((n) => { env[n] = declared[n]; });
env.done = {}; env.notes = {}; env.marks = {}; env.ivState = { answers: {} }; env.faultState = { seen: {} };

const M = new Function('env', 'with (env) {\n' + body +
  '\nreturn { snap: snapshotAll, restore: restoreBackup, keys: labKeys, state: labState, schema: () => DATA_SCHEMA };\n}')(env);

let fails = 0, checks = 0;
function ok(name, cond, extra) {
  checks++;
  if (cond) { console.log('pass  ' + name); return; }
  fails++;
  console.log('FAIL  ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra)));
}

/* setDataButtonState() also defers work, so the queue holds button-label restores as
   well as the reload. Drain it and judge the outcome by whether location.reload() ran. */
function drain() { const q = scheduled; scheduled = []; q.forEach((fn) => fn()); return reloads; }
function resetImports() { scheduled = []; reloads = 0; }

/* ---- 1. nothing that persists can be left out of the backup ---- */
ok('the app declares the storage keys we expect', declaredNames.length >= 11, declaredNames);
const covered = M.keys().concat(ROADMAP.map((n) => declared[n]));
const orphans = declaredNames.filter((n) => covered.indexOf(declared[n]) < 0);
ok('every ecroadmap.* key is either restored in memory or listed in labKeys()', orphans.length === 0, orphans);
ok('the five lab keys really are in the backup list',
  ['K_BENCH', 'K_LKSAND', 'K_PERIPH', 'K_PROTOS', 'K_WALK'].every((n) => M.keys().indexOf(declared[n]) >= 0), M.keys());
ok('no storage key is listed twice', new Set(covered).size === covered.length, covered);

/* ---- 2. snapshot carries lab state ---- */
store[declared.K_PERIPH] = JSON.stringify({ stage: 4, goals: { 1: true, 2: true } });
store[declared.K_WALK] = JSON.stringify({ link: { sandbox: true } });
store[declared.K_PROTOS] = JSON.stringify({ stage: 9, goals: { 1: true } });
let snap = M.snap();
ok('schema is 2 so a backup records that it carries labs', snap.schema === 2, snap.schema);
ok('snapshot includes the lab keys that have state',
  Object.keys(snap.state.labs).length === 3 &&
  snap.state.labs[declared.K_PERIPH].goals[2] === true &&
  snap.state.labs[declared.K_WALK].link.sandbox === true, Object.keys(snap.state.labs));
ok('snapshot omits lab keys that were never written',
  !Object.prototype.hasOwnProperty.call(snap.state.labs, declared.K_BENCH), Object.keys(snap.state.labs));

/* ---- 3. restore puts them back ---- */
const exported = JSON.stringify(snap);
Object.keys(store).forEach((k) => { delete store[k]; });   /* fresh machine */
resetImports();
ok('a schema-2 backup restores', M.restore(exported) === true);
ok('the lab keys come back out of the file',
  JSON.parse(store[declared.K_PERIPH]).goals[2] === true &&
  JSON.parse(store[declared.K_WALK]).link.sandbox === true, Object.keys(store));
ok('importing lab state reloads, because a running ticker would overwrite it',
  drain() === 1, { reloads: reloads });

/* ---- 4. old files must still import ---- */
Object.keys(store).forEach((k) => { delete store[k]; });
store[declared.K_PROTOS] = JSON.stringify({ stage: 5, goals: { 1: true, 2: true } });
resetImports();
const v1 = JSON.stringify({ schema: 1, app: 'embedded-c-roadmap',
  state: { done: { t1: 5 }, notes: { t1: 'keep' }, marks: {}, interview: { answers: {} }, faults: { seen: {} } } });
ok('a schema-1 backup is accepted, not refused', M.restore(v1) === true);
ok('a schema-1 backup does not wipe the labs it never recorded',
  JSON.parse(store[declared.K_PROTOS]).goals[2] === true, store[declared.K_PROTOS]);
ok('a schema-1 backup restores the roadmap state', env.done.t1 === 5 && env.notes.t1 === 'keep', env.done);
ok('with no lab state written there is nothing to restart', drain() === 0, { reloads: reloads });

/* ---- 5. refuse only what we genuinely cannot understand ---- */
resetImports();
const newer = JSON.stringify({ schema: 99, app: 'embedded-c-roadmap', state: { done: { t9: 1 } } });
ok('a backup from a newer schema is refused', M.restore(newer) === false);
ok('refusing a newer backup changes nothing', env.done.t9 === undefined && drain() === 0, env.done);
ok('a foreign file is refused', M.restore(JSON.stringify({ app: 'something-else', state: {} })) === false);
ok('rubbish is refused', M.restore('{ not json') === false);

/* ---- 6. the import path cannot be used to write arbitrary storage ---- */
/* The five roadmap keys are written by every restore, so "smuggled" here means the
   labs section introducing a key this build never declared. */
Object.keys(store).forEach((k) => { delete store[k]; });
resetImports();
const hostile = JSON.stringify({ schema: 2, app: 'embedded-c-roadmap', state: {
  done: { t2: 1 }, notes: {}, marks: {}, interview: { answers: {} }, faults: { seen: {} },
  labs: { 'ecroadmap.somethingelse.v1': { bad: true }, '__proto__': { x: 1 }, 'https://evil': 'yes' } } });
M.restore(hostile);
ok('the restore itself ran', store[declared.K_DONE] !== undefined, Object.keys(store));
/* Strongest form of the check: the own-key set after import is exactly the keys this
   build knows about, so nothing could have been smuggled through the labs section. */
ok('import writes exactly the declared storage keys, nothing smuggled',
  JSON.stringify(Object.keys(store).sort()) === JSON.stringify(
    [declared.K_DONE, declared.K_NOTE, declared.K_MARK, declared.K_IV, declared.K_FAULT].sort()),
  Object.keys(store));

console.log(fails ? '\n' + fails + ' FAILURE(S) of ' + checks : '\nall green (' + checks + ' checks)');
process.exit(fails ? 1 : 0);
