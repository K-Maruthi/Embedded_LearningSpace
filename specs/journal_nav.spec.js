/* The dashboard's "jump back to the stage I wrote about" path: goStage / wireGoStage.
 *
 * Zero dependencies. Run with:  node specs/journal_nav.spec.js
 *
 * A journal row on the dashboard is a link that has to land you on the exact lab stage
 * the entry was written on. The code under test is sliced out of 20_app.js by its
 * markers and run over stubs for the four things it reaches for - setView,
 * document.querySelector, prStageById, prGoStage - so this checks the routing logic
 * without a browser.
 *
 * The subtle case is the Protocol Lab: unlike the other three it renders only the
 * current family's stage tabs, so the tab for a stage in another family is not in the
 * DOM to be clicked. The jump has to switch to the stage directly there, while a stage
 * that no longer exists must still just open the lab rather than drive the app into a
 * half-known state. That distinction lives in three lines and is invisible unless a
 * journal was written on a non-default family, which is exactly when nobody is looking.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'roadmap-source', '20_app.js');
const app = fs.readFileSync(SRC, 'utf8');

const from = app.indexOf('  var JR_TABS = {');
const to = app.indexOf('  /* ---- lab progress');
if (from < 0 || to < from) { throw new Error('goStage markers not found in 20_app.js'); }
const body = app.slice(from, to);

/* ---- the world goStage navigates over ---- */
// The Protocol Lab ids this build knows. 5/6 are the I2C family, 8/9 the SPI family;
// the point is only that some real ids exist and others do not.
const PR_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

let view = null, clicked = null, driven = null;
// renderTabs lists exactly the stage-tab buttons present in the DOM right now, so a
// jump can only click a tab that is really there - which is the whole failure mode.
function makeEnv(renderTabs) {
  view = null; clicked = null; driven = null;
  const byAttr = {};
  renderTabs.forEach((t) => {
    // goStage builds "[attr=\"stage\"]" with the brackets, so that is the key a real
    // querySelector would answer to; the readable name is what we record as clicked.
    const btn = { clicked: false, click() { this.clicked = true; clicked = t; } };
    byAttr['[' + t + ']'] = btn;
  });
  const env = {
    setView: (v) => { view = v; },
    document: {
      querySelector: (sel) => byAttr[sel] || null,
    },
    prStageById: (n) => (PR_IDS.indexOf(n) >= 0 ? { id: n } : null),
    prGoStage: (n) => { driven = n; },
    Number: Number, String: String, Array: Array, Object: Object,
  };
  return env;
}
function run(env) {
  const M = new Function('env', 'with (env) {\n' + body +
    '\nreturn { go: goStage, wire: wireGoStage, tabs: JR_TABS, short: JR_SHORT };\n}')(env);
  return M;
}

let fails = 0, checks = 0;
function ok(name, cond, extra) {
  checks++;
  if (cond) { console.log('pass  ' + name); return; }
  fails++;
  console.log('FAIL  ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra)));
}

/* ---- 1. a lab whose stage tab is on screen just gets clicked ---- */
// The three reading/sim labs always render every stage tab, so the jump presses it.
let M = run(makeEnv(['data-compile-stage="source"']));
M.go('compile', 'source');
ok('compile opens its own view and clicks the stage tab',
  view === 'compile' && clicked === 'data-compile-stage="source"', { view, clicked });

M = run(makeEnv(['data-pfstage="7"']));
M.go('periph', '7');
ok('periph clicks the tab for the string stage id the row carries',
  view === 'periph' && clicked === 'data-pfstage="7"', { view, clicked });

/* the linker lab lives under a different view name than its journal key */
M = run(makeEnv(['data-link-stage="memory"']));
M.go('link', 'memory');
ok('the link journal opens the playground view, not a view called "link"',
  view === 'playground' && clicked === 'data-link-stage="memory"', { view, clicked });

/* ---- 2. protocols, tab present: same path as everyone else ---- */
M = run(makeEnv(['data-prstage="3"']));
M.go('protocols', '3');
ok('a protocols stage whose tab is showing is clicked, not driven',
  clicked === 'data-prstage="3"' && driven === null, { clicked, driven });

/* ---- 3. protocols, cross-family: the tab is NOT in the DOM ---- */
// This is the bug the fix closes. Without it the view switches and nothing else does:
// the learner lands on the wrong stage and the journal row looks simply broken.
M = run(makeEnv(['data-prstage="1"']));  // only family "basics" is on screen
M.go('protocols', '6');                  // 6 is a real I2C stage, tab not rendered
ok('a real protocols stage with no visible tab still switches to that stage',
  view === 'protocols' && driven === 6 && clicked === null, { view, driven, clicked });
ok('the id handed to the lab is a number, matching what prGoStage expects',
  driven === 6 && typeof driven === 'number', { driven });

/* ---- 4. a stage that no longer exists must NOT drive the app ---- */
// prGoStage with a phantom id is worse than not navigating: it half-switches. So an
// unknown stage opens the lab and stops - the deliberate fall-through.
M = run(makeEnv(['data-prstage="1"']));
M.go('protocols', '999');               // not in PR_IDS, no tab either
ok('a protocols stage that does not exist opens the lab but drives nothing',
  view === 'protocols' && driven === null && clicked === null, { view, driven, clicked });

/* ---- 5. an unknown lab is inert ---- */
M = run(makeEnv([]));
M.go('nonsense', 'x');
ok('a lab with no JR_TABS entry does nothing at all',
  view === null && clicked === null && driven === null, { view, clicked, driven });

/* ---- 6. the four labs the journals name are exactly the four that route ---- */
const routed = Object.keys(M.tabs).sort().join();
const named = Object.keys(M.short).sort().join();
ok('every lab goStage can route has a short dashboard name, and vice versa',
  routed === named, { routed, named });

/* ---- 7. wireGoStage turns a row's "lab:stage" into exactly that call ---- */
M = run(makeEnv(['data-prstage="1"']));
const link = { dataset: { gostage: 'protocols:5' }, _ev: {},
  addEventListener(ev, fn) { this._ev[ev] = fn; },
  click() { this._ev.click({ preventDefault() {} }); } };
const host = { querySelectorAll: () => [link] };
M.wire(host);
link.click();
ok('clicking a wired journal row routes to the lab and stage it names',
  view === 'protocols' && driven === 5, { view, driven });

console.log('\n' + '-'.repeat(52));
if (fails) { console.log(fails + ' of ' + checks + ' checks FAILED'); process.exit(1); }
console.log('all green (' + checks + ' checks)');
