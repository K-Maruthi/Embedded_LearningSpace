/* Compilation Path lab spec (21_lab_compile.js).
 *
 * Zero dependencies. Run with:  node specs/lab_compile.spec.js
 *
 * The lab has one stage rail and two bodies: Teaching shows the fixed example,
 * Lab bench swaps in your editable sources. The bench build is a *second* report
 * (clab.benchReport) so it can never leak into the teaching stages; clabReport()
 * is the single place that decides which one a stage is showing.
 *
 * What is pinned here:
 *   1. the report selection (teach → fixed, bench → your build, fallback labelled)
 *   2. provenance: every facts panel and live artifact says whose build it is
 *   3. the per-stage parsers that turn real tool output into observations
 *      (preprocess #define count, compile labels/instruction count, objdump
 *      section sizes, size table, vector-table words)
 *   4. failure landing: clabFirstFailure finds the stage a build stopped at
 *   5. drift guards tying the stage rail, CLAB_TITLES, COMPILE_DATA and the Rust
 *      report ids to each other
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '21_lab_compile.js'), 'utf8');
const from = src.indexOf('  var clab = {');
const to = src.indexOf('  function clabWireBench');
if (from < 0 || to < 0 || to < from) { throw new Error('compile-lab markers not found in 21_lab_compile.js'); }

const prelude = `
var COMPILE_DATA = { source:1, preprocess:1, compile:1, assemble:1, object:1, link:1, image:1, check:1 };
var compileLabStage = "source";
var currentView = "";
var document = { getElementById: function () { return null; } };
var window = { __TAURI__: null };
function rd() { return null; }
function wr() {}
function notice() {}
function esc(s) { return String(s); }
function hl(s) { return String(s); }
function hlModeFor() { return "c"; }
`;
const tail = `
this.clab = clab;
this.clabReport = clabReport;
this.clabSourceTag = clabSourceTag;
this.clabFirstFailure = clabFirstFailure;
this.clabStageOut = clabStageOut;
this.clabFacts = clabFacts;
this.clabBuild = clabBuild;
this.clabBenchBar = clabBenchBar;
this.stageNow = function () { return compileLabStage; };
`;
const ctx = vm.createContext({});
vm.runInContext(prelude + src.slice(from, to) + tail, ctx);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('pass  ' + name); return; }
  failures++;
  console.log('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
}
function stage(id, ok, stdout, artifacts) {
  return { id: id, ok: ok, commands: [id + ' --cmd'], stdout: stdout || '', stderr: '', artifacts: artifacts || [] };
}
function report(ok, stages, custom) {
  return { toolchain: 'arm-none-eabi-gcc 12.2.1', ok: ok, custom: !!custom, stages: stages || [] };
}
const clab = ctx.clab;
const fixed = report(true, [stage('source', true), stage('preprocess', true), stage('compile', true),
  stage('assemble', true), stage('object', true), stage('link', true), stage('image', true)], false);
const mine = report(true, [stage('source', true), stage('preprocess', true), stage('compile', true),
  stage('assemble', true), stage('object', true), stage('link', true), stage('image', true)], true);

/* ---- 1. which report a mode shows, and that selection does not mutate ---- */
clab.mode = 'teach'; clab.report = fixed; clab.benchReport = mine;
check('teaching mode shows the fixed example', ctx.clabReport() === fixed);
check('teaching mode does not read the bench report', ctx.clabReport().custom === false);
clab.mode = 'bench';
check('bench mode shows your build once it exists', ctx.clabReport() === mine);
check('selecting the bench report leaves clab.report intact', clab.report === fixed);
clab.benchReport = null;
check('bench mode falls back to the fixed example before the first build', ctx.clabReport() === fixed);
check('clabStageOut follows the selected report', ctx.clabStageOut('compile') === clab.report.stages[2]);
clab.mode = 'bench'; clab.benchReport = mine;
const benchCompile = mine.stages[2];
clab.benchReport = report(true, [stage('compile', true, 'mine', [])], true);
check('clabStageOut reads the bench report in bench mode', ctx.clabStageOut('compile') === clab.benchReport.stages[0]);
clab.report = fixed; clab.benchReport = null; clab.mode = 'teach';

/* ---- 2. provenance language ---- */
check('a bench build is labelled as yours', ctx.clabSourceTag({ custom: true }) === 'your bench sources');
check('an unedited build is labelled as the fixed example', ctx.clabSourceTag({ custom: false }) === 'the fixed example');

/* ---- 3. failure landing ---- */
check('an all-green report lands nowhere', ctx.clabFirstFailure(fixed) === null);
check('a failed compile lands on compile',
  ctx.clabFirstFailure(report(false, [stage('source', true), stage('preprocess', true), stage('compile', false)], true)) === 'compile');
check('the *first* failure wins, not the last',
  ctx.clabFirstFailure(report(false, [stage('source', false), stage('preprocess', false)], true)) === 'source');
check('a missing report is not a failure', ctx.clabFirstFailure(null) === null);

/* ---- 4. the preprocess parser ---- */
clab.mode = 'teach'; clab.benchReport = null;
clab.srcs.mainC = '#define LIMIT 10\nint f(void){return LIMIT;}';
clab.report = report(true, [stage('preprocess', true, '', [{ name: 'main.i (tail)', text: '#define LIMIT 10\nint f(void){return 10;}' }])], false);
const pre1 = ctx.clabFacts('preprocess');
check('preprocess facts warn when a #define survives into main.i',
  pre1.indexOf('still visible') >= 0 && pre1.indexOf('#define') >= 0, pre1.slice(0, 200));
clab.report = report(true, [stage('preprocess', true, '', [{ name: 'main.i (tail)', text: 'int f(void){return 10;}' }])], false);
clab.srcs.mainC = '#define LIMIT 10\n#define WIDTH 4\nint f(void){return LIMIT + WIDTH;}';
const pre2 = ctx.clabFacts('preprocess');
check('preprocess facts count the #defines that expanded',
  pre2.indexOf('2 #define directives were in your main.c') >= 0, pre2.slice(0, 300));
clab.srcs.mainC = '#define LIMIT 10\nint f(void){return LIMIT;}';
const pre3 = ctx.clabFacts('preprocess');
check('preprocess facts get the singular right too',
  pre3.indexOf('1 #define directive was in your main.c') >= 0, pre3.slice(0, 300));
check('preprocess facts explain the line markers',
  pre2.indexOf('preprocessor line markers') >= 0, pre2.slice(0, 300));

/* ---- 5. the compile parser ---- */
clab.report = report(true, [stage('compile', true, '', [{ name: 'main.s', text:
  'add_limit:\n    adds r0, r0, #10\n    bx lr\nmain:\n    push {r4, lr}\n    bl add_limit\n' }])], false);
const c1 = ctx.clabFacts('compile');
check('compile facts name the assembly labels',
  c1.indexOf('your functions became assembly labels: add_limit, main.') >= 0, c1.slice(0, 300));
check('compile facts count instruction lines',
  c1.indexOf('about 4 instruction/assembler lines') >= 0, c1.slice(0, 300));
check('compile facts never claim .L labels are functions',
  c1.indexOf('.L') < 0, c1.slice(0, 300));

/* ---- 6. the object parser (objdump -h) ---- */
clab.report = report(true, [stage('object', true,
  'Idx Name          Size      VMA\n' +
  '  0 .text         0000002a  00000000\n' +
  '  1 .data         00000004  00000000\n' +
  '  2 .bss          00000010  00000000\n' +
  '  3 .comment      00000012  00000000\n' +
  '  4 .ARM.attribs  00000030  00000000\n' +
  '*UND* add_limit\n', [])], false);
const o1 = ctx.clabFacts('object');
check('object facts sum section sizes from objdump',
  o1.indexOf('.text</code> 42 B') >= 0 && o1.indexOf('.data</code> 4 B') >= 0 && o1.indexOf('.bss</code> 16 B') >= 0,
  o1.slice(0, 400));
check('object facts drop .comment and .ARM bookkeeping sections',
  o1.indexOf('.comment</code>') < 0 && o1.indexOf('.ARM</code>') < 0, o1.slice(0, 400));
check('object facts point at the unresolved symbols',
  o1.indexOf('*UND*') >= 0, o1.slice(0, 500));

/* ---- 7. the link parser (size output) ---- */
clab.report = report(true, [stage('link', true,
  '   text\t   data\t    bss\t    dec\t    hex\tfilename\n' +
  '    106\t      4\t     16\t    126\t     7e\tfirmware.elf\n', [])], false);
const l1 = ctx.clabFacts('link');
check('link facts report text as Flash bytes', l1.indexOf('<code>text 106 B</code>') >= 0, l1.slice(0, 300));
check('link facts report data and bss as RAM', l1.indexOf('<code>data 4 B</code>') >= 0 && l1.indexOf('<code>bss 16 B</code>') >= 0, l1.slice(0, 300));
clab.report = report(false, [stage('link', false, 'region `FLASH\' overflowed by 128 bytes\n', [])], false);
const l2 = ctx.clabFacts('link');
check('link facts say when the image does not fit', l2.indexOf('does not fit the MEMORY regions') >= 0, l2.slice(0, 300));

/* ---- 8. the image parser (vector-table words) ---- */
clab.report = report(true, [stage('image', true,
  '00000000  00 40 20 00 21 01 00 08  00 00 00 00 00 00 00 00\n', [])], false);
const i1 = ctx.clabFacts('image');
check('image facts decode word 0 as the initial stack pointer', i1.indexOf('0x204000') >= 0, i1.slice(0, 400));
check('image facts decode word 1 as Reset_Handler', i1.indexOf('0x8000121') >= 0, i1.slice(0, 400));

/* ---- 9. facts provenance and the not-built-yet warning ---- */
clab.mode = 'bench'; clab.benchReport = null;
clab.report = report(true, [stage('compile', true, '', [{ name: 'main.s', text: 'main:\n    bx lr\n' }])], false);
const b1 = ctx.clabFacts('compile');
check('bench facts fall back labelled as the fixed example',
  b1.indexOf('<b>from the fixed example</b>') >= 0, b1.slice(0, 200));
check('bench facts tell you the bench has not been built yet',
  b1.indexOf('you have not built the bench sources yet') >= 0, b1.slice(0, 400));
clab.benchReport = mine;
const b2 = ctx.clabFacts('compile');
check('bench facts switch to your own build', b2.indexOf('<b>from your bench build</b>') >= 0, b2.slice(0, 200));
check('a built bench no longer warns about not building', b2.indexOf('not built the bench sources yet') < 0);

/* ---- 10. the bench bar says what was last built ---- */
clab.benchReport = null;
check('the bench bar admits nothing has been built', ctx.clabBenchBar().indexOf('nothing built from the bench yet') >= 0);
clab.benchReport = mine;
check('the bench bar names your sources after a build', ctx.clabBenchBar().indexOf('last build: your bench sources') >= 0);
clab.benchReport = report(true, [], false);
check('the bench bar names the fixed example for an unedited build', ctx.clabBenchBar().indexOf('last build: the fixed example') >= 0);

/* ---- 11. a failed build lands on the failing stage (async, real clabBuild) ---- */
(async function () {
  clab.mode = 'bench';
  clab.info = { found: true, version: '12.2.1' };
  clab.status = 'ready';
  clab.benchReport = null;
  clab.report = fixed;
  ctx.window.__TAURI__ = { core: { invoke: function () {
    return Promise.resolve(report(false, [stage('source', true), stage('preprocess', true), stage('compile', false)], true));
  } } };
  const before = ctx.stageNow();
  await ctx.clabBuild();
  check('clabBuild stores the bench report, not the fixed one', clab.benchReport && clab.benchReport.custom === true);
  check('clabBuild still leaves the fixed report untouched', clab.report === fixed);
  check('a failed bench build moves the stage rail to the failure', ctx.stageNow() === 'compile', before + ' -> ' + ctx.stageNow());
  check('a failed bench build marks the status', clab.status === 'failed', clab.status);

  /* ---- 12. drift guards across the rail, the titles and the Rust report ---- */
  const titleBlock = /var CLAB_TITLES = \{([\s\S]*?)\};/.exec(src);
  check('CLAB_TITLES exists', !!titleBlock);
  const titleKeys = titleBlock ? [...titleBlock[1].matchAll(/(\w+):/g)].map(function (m) { return m[1]; }).sort().join(',') : '';
  const dataBlock = src.slice(src.indexOf('var COMPILE_DATA = {'), src.indexOf('var compileLabStage'));
  const dataKeys = [...dataBlock.matchAll(/^    (\w+): \{/gm)].map(function (m) { return m[1]; });
  check('every stage tab has teaching content',
    dataKeys.slice().sort().join(',') === 'assemble,check,compile,image,link,object,preprocess,source', dataKeys.join(','));
  check('CLAB_TITLES covers every report stage, and only those',
    titleKeys === dataKeys.filter(function (k) { return k !== 'check'; }).sort().join(','), titleKeys);
  const nav = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '02_body.html'), 'utf8');
  const navKeys = [...nav.matchAll(/data-compile-stage="(\w+)"/g)].map(function (m) { return m[1]; }).sort().join(',');
  check('the stage rail matches the teaching content keys', navKeys === dataKeys.slice().sort().join(','), navKeys);
  const rust = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'src', 'pipeline.rs'), 'utf8');
  const rustKeys = [...rust.matchAll(/stage\("(\w+)"\)/g)].map(function (m) { return m[1]; }).sort().join(',');
  check('the Rust report ids match CLAB_TITLES', rustKeys === titleKeys, rustKeys + ' vs ' + titleKeys);

  if (failures) {
    console.log('\n' + failures + ' check(s) FAILED');
    process.exit(1);
  }
  console.log('\ncompile lab green (report split, provenance, parsers, failure landing, drift guards)');
}());
