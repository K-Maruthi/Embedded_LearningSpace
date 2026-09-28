/* Dashboard "benches" card — progress for the four labs.
 *
 * Zero dependencies, like validate_build.js. Run with:  node specs/dash_progress.spec.js
 *
 * The block under test lives inside the app's IIFE and reaches for a handful of
 * cross-region globals (COMPILE_DATA, LINK_STAGES, the stage metadata, localStorage
 * helpers). We slice it out of 20_app.js by its comment markers and run it over stubs,
 * so this checks the arithmetic and the markup without a browser.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'roadmap-source', '20_app.js');
const PAGE = path.join(__dirname, '..', 'roadmap-source', '02_body.html');
const src = fs.readFileSync(SRC, 'utf8');
const page = fs.readFileSync(PAGE, 'utf8');

const from = src.indexOf('/* ---- lab progress');
const to = src.indexOf('function refreshDash');
if (from < 0 || to < 0 || to < from) { throw new Error('lab-progress markers not found in 20_app.js'); }
const body = src.slice(from, to);

/* The denominators are only honest if the lists handed to dashLabs() really are the
   stages each lab can navigate to. Derive them from the source, not from what this
   test hopes they are. */
const LINK_STAGES = (src.match(/var LINK_STAGES = \[([^\]]*)\]/)[1].match(/"([^"]+)"/g) || [])
  .map((s) => s.slice(1, -1));
const linkNav = [...page.matchAll(/data-link-stage="([^"]+)"/g)].map((m) => m[1]);
const compileNav = [...page.matchAll(/data-compile-stage="([^"]+)"/g)].map((m) => m[1]);
const linkDataKeys = [...src
  .slice(src.indexOf('var LINK_DATA = {'), src.indexOf('var LINK_RULES = {'))
  .matchAll(/^ {4}(\w+): \{$/gm)].map((m) => m[1]);
const SANDBOX_ASSIGNED = /LINK_DATA\.sandbox = \{/.test(src);

const store = {};
const env = {
  esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  rd: (k, fb) => (k in store ? JSON.parse(store[k]) : fb),
  wr: (k, v) => { store[k] = JSON.stringify(v); },
  Math: Math, Object: Object, JSON: JSON, String: String, Number: Number, Array: Array,
  K_WALK: 'ecroadmap.walk.v1', K_PERIPH: 'ecroadmap.periph.v1', K_PROTOS: 'ecroadmap.protocols.v1',
  K_JOURNAL: 'ecroadmap.journals.v1',
  LINK_STAGES: LINK_STAGES,
  /* only the titles are needed, and they are invented here: the point is that a
     journal is labelled from the lab's own stage metadata, whatever that metadata is */
  LINK_DATA: LINK_STAGES.reduce((o, k) => { o[k] = { title: 'L ' + k }; return o; }, {}),
  COMPILE_DATA: compileNav.reduce((o, k) => { o[k] = { title: 'x' }; return o; }, {}),
  PF_STAGE_META: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: 'P' + (i + 1) })),
  PR_STAGE_META: [
    { id: 1, name: 'Signals 101' }, { id: 2, name: 'The frame' }, { id: 3, name: 'Sampling & baud' },
    { id: 4, name: 'Terminal' }, { id: 5, name: 'I2C: shared wire' }, { id: 6, name: 'I2C: address + ACK' },
    { id: 7, name: 'Protocol map' }, { id: 8, name: 'SPI: four modes' }, { id: 9, name: 'SPI: the shift ring' }
  ],
  pfStageById: (n) => env.PF_STAGE_META.filter((s) => s.id === n)[0] || null,
  prStageById: (n) => env.PR_STAGE_META.filter((s) => s.id === n)[0] || null,
  lksandLoad: () => ({ stack: 8192, heap: 4096, sections: [] }),
  lksandCompute: () => (store.__brokenLayout
    ? { flashUsed: 0, ramUsed: 0, errors: 2 }
    : { flashUsed: 262144, ramUsed: 12288, errors: 0 })
};
const M = new Function('env', 'with (env) {\n' + body +
  '\nreturn { mark: walkMark, count: walkCount, seen: walkSeen, goals: storedGoals, ' +
  'labs: dashLabs, verdict: lksandVerdict, row: labRow, jr: jrEntries, jrlabs: jrLabStages };\n}')(env);

let fails = 0, checks = 0;
function ok(name, cond, extra) {
  checks++;
  if (cond) { console.log('pass  ' + name); return; }
  fails++;
  console.log('FAIL  ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra)));
}

/* --- the denominators themselves --- */
ok('LINK_STAGES matches the linker nav buttons',
  JSON.stringify(LINK_STAGES) === JSON.stringify(linkNav), [LINK_STAGES, linkNav]);
ok('every nav link stage resolves in LINK_DATA (else it silently redirects to mcu)',
  linkNav.every((s) => linkDataKeys.indexOf(s) >= 0 || (s === 'sandbox' && SANDBOX_ASSIGNED)),
  linkNav.filter((s) => linkDataKeys.indexOf(s) < 0 && !(s === 'sandbox' && SANDBOX_ASSIGNED)));
ok('the compile nav is populated', compileNav.length === 8, compileNav);

const CS = compileNav, LS = LINK_STAGES;
ok('nothing recorded yet reads as zero', M.count('compile', CS) === 0 && M.count('link', LS) === 0);
M.mark('compile', 'source'); M.mark('compile', 'source'); M.mark('compile', 'link');
ok('walkMark is idempotent and counts stages', M.count('compile', CS) === 2, M.count('compile', CS));
ok('marking one lab does not disturb the other', M.count('link', LS) === 0);
ok('the walk key is the only thing written', Object.keys(store).length === 1, Object.keys(store));

/* a stage renamed or dropped on the way out must not keep inflating the count */
M.mark('compile', 'removed-stage');
ok('a stale stage name is recorded but never counted', M.count('compile', CS) === 2, M.count('compile', CS));

store['ecroadmap.periph.v1'] = JSON.stringify({ stage: 8, goals: { 1: true, 2: true, 3: false, 7: true, 99: true } });
store['ecroadmap.protocols.v1'] = JSON.stringify({ stage: 9, goals: { 1: true, 2: true, 5: true, 6: true, 7: true, 8: true, 9: true } });
const g = M.goals('ecroadmap.periph.v1', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
ok('storedGoals counts only truthy verifications of real stages', g.n === 3 && g.stage === 8, g);
ok('storedGoals survives a missing key', M.goals('ecroadmap.nope.v1', [1, 2]).n === 0);

/* --- journals: the same honesty the progress rows are held to ---
   A journal is only worth showing if the stage it names still exists and something was
   actually written. The lists the progress rows divide by and the lists the journals are
   filtered against have to be the same lists, or one of the two is lying. */
const gl = M.jrlabs();
const pfIds = env.PF_STAGE_META.map((s) => s.id), prIds = env.PR_STAGE_META.map((s) => s.id);
ok('journals are filtered against the very stage lists the progress rows count',
  JSON.stringify(gl[0].stages) === JSON.stringify(CS) &&
  JSON.stringify(gl[1].stages) === JSON.stringify(LS) &&
  JSON.stringify(gl[2].stages) === JSON.stringify(pfIds) &&
  JSON.stringify(gl[3].stages) === JSON.stringify(prIds),
  gl.map((x) => x.lab + ':' + x.stages.join('|')));
ok('every lab that can hold a journal is named for the export',
  gl.every((g) => g.title && g.name(g.stages[0])), gl.map((g) => g.title));

store['ecroadmap.journals.v1'] = JSON.stringify({
  'link:script': 'the ORDER line decides placement',
  'compile:source': '   ',
  'periph:3': 'duty is CCR over ARR',
  'protocols:7': 'the protocol map is the point of this stage',
  'compile:removed-stage': 'written when this stage still existed',
  'nonsense:key': 'a lab that is not one of the four',
});
const jr = M.jr();
ok('a journal of only whitespace is not something written',
  jr.filter((e) => e.lab === 'compile').length === 0, jr);
ok('a journal for a stage that no longer exists is not offered as somewhere to go',
  jr.every((e) => String(e.stage) !== 'removed-stage'), jr.map((e) => e.lab + ':' + e.stage));
ok('a key from a lab this build does not know is never read',
  jr.every((e) => e.lab !== 'nonsense'), jr.map((e) => e.lab));
ok('the three real journals are all listed', jr.length === 3, jr.map((e) => e.lab + ':' + e.stage));
ok('they come out in lab order, then the lab\u2019s own stage order',
  jr.map((e) => e.lab + ':' + e.stage).join() === 'link:script,periph:3,protocols:7',
  jr.map((e) => e.lab + ':' + e.stage));
ok('each is labelled with its stage name from the metadata, not its raw id',
  jr.map((e) => e.name).join() === 'L script,P3,Protocol map', jr.map((e) => e.name));
ok('and the text itself comes along for the export',
  /ORDER/.test(jr[0].text), jr[0]);

const html = M.labs();
ok('one row per bench', (html.match(/class="stagebar labrow"/g) || []).length === 4,
  (html.match(/class="stagebar labrow"/g) || []).length);
ok('counts render as n/total',
  html.indexOf('2/' + CS.length) >= 0 && html.indexOf('0/' + LS.length) >= 0 &&
  html.indexOf('3/10') >= 0 && html.indexOf('7/9') >= 0,
  (html.match(/<span class="nn">[^<]*<\/span>/g) || []));
ok('a stale stage cannot push a row past n/total', html.indexOf('3/' + CS.length) < 0);
ok('the current stage is named from the metadata',
  html.indexOf('at <b>P8</b>') >= 0 && html.indexOf('at <b>SPI: the shift ring</b>') >= 0);
ok('every row links to a real view',
  ['compile', 'playground', 'periph', 'protocols'].every((v) => html.indexOf('data-golab="' + v + '"') >= 0));
ok('no bar exceeds its track',
  (html.match(/width:(\d+)%/g) || []).every((w) => Number(w.match(/\d+/)[0]) <= 100), html.match(/width:\d+%/g));

/* the sandbox verdict belongs to the user, not to the default model */
ok('an unopened sandbox claims nothing', M.verdict() === 'not opened', M.verdict());
M.mark('link', 'sandbox');
ok('an opened sandbox reports its footprint', M.verdict() === 'fits · 256 KB flash, 12 KB ram', M.verdict());
store.__brokenLayout = true;
ok('a broken layout reports the error count', M.verdict() === '2 placement errors', M.verdict());
store.__brokenLayout = false;

/* esc() runs once over the whole label, so a name must never come back double-escaped */
ok('ampersand in a lab name is escaped exactly once',
  html.indexOf('Linker &amp; Startup') >= 0 && html.indexOf('&amp;amp;') < 0,
  (html.match(/data-golab="playground">[^<]*/) || [])[0]);
const r = M.row('Sampling & baud', 'protocols', 1, 3, 'x');
ok('a stage name with & is escaped once, not twice',
  r.indexOf('Sampling &amp; baud') >= 0 && r.indexOf('&amp;amp;') < 0, r);

/* --- the dashboard grid must still tile: 12 columns per row, no orphaned gap --- */
const dash = page.slice(page.indexOf('id="view-dash"'), page.indexOf('id="view-mosaic"'));
const spans = [...dash.matchAll(/class="panel(?![\w-])([^"]*)"/g)].map((m) => {
  const w = /\bw(\d+)\b/.exec(m[1]);
  return w ? Number(w[1]) : 4;
});
let row = 1, col = 1;
for (const s of spans) { if (col - 1 + s > 12) { row++; col = 1; } col += s; }
const holes = row * 12 - spans.reduce((a, c) => a + c, 0);
ok('the dashboard panels tile with no holes', holes === 0, { spans: spans.join(','), rows: row, holes: holes });

console.log(fails ? '\n' + fails + ' FAILURE(S) of ' + checks : '\nall green (' + checks + ' checks)');
process.exit(fails ? 1 : 0);
