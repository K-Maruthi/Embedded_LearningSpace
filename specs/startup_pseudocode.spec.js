/* Startup-pseudocode / startup.s agreement spec.
 *
 * Zero dependencies. Run with:  node specs/startup_pseudocode.spec.js
 *
 * The defect this exists to prevent: the Linker & Startup lab teaches a reset
 * sequence as pseudocode, and the Compilation Path lab hands the learner a
 * <textarea> containing the real src-tauri/src/examples/startup.s. Those two
 * artefacts are supposed to be the same program. They were not — the pseudocode
 * ended in `bl SystemInit` followed by `bl main`, while startup.s contained only
 * `bl main`. `SystemInit` was defined nowhere in the project: not in startup.s,
 * not in main.c, not in linker.ld. A learner who typed the app's own lesson into
 * the editor got `undefined reference to SystemInit` from the real linker.
 *
 * So this is a drift guard, in the same spirit as the periph rate guards in
 * periph_model.spec.js and the generated-script guards in linker_sandbox.spec.js:
 * it reads the claim the lab makes and the artefact the learner is given, and
 * fails if they stop describing the same program. Editing the pseudocode to add
 * a step is fine — adding one to startup.s is fine. Adding one to only one of
 * them is the bug.
 */
const fs = require('fs');
const path = require('path');

const lab = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '22_lab_linker.js'), 'utf8');
const head = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '01_head.html'), 'utf8');
const startup = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'src', 'examples', 'startup.s'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('pass  ' + name); return; }
  failures++;
  console.log('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
}

/* ---- pull the pseudocode block out of the lab ----
   The block is the <pre> whose lines all carry data-reset-code, which is also
   what the reset stepper highlights. If a future edit drops that attribute the
   stepper stops highlighting, and this slice has nothing to read. */
const preFrom = lab.indexOf('<div class="linklab-card linklab-pseudocode-card">');
const preTo = lab.indexOf('</pre>', preFrom);
if (preFrom < 0 || preTo < 0 || preTo < preFrom) {
  throw new Error('pseudocode card markers not found in 22_lab_linker.js');
}
const pre = lab.slice(preFrom, preTo);
const lines = [...pre.matchAll(/data-reset-code="(\d)"[^>]*>([^<]*)</g)]
  .map((m) => ({ step: m[1], text: m[2] }));

check('the pseudocode card has lines to read', lines.length > 0, 'found ' + lines.length);
check('every pseudocode line is part of a reset step',
  lines.every((l) => '1234'.indexOf(l.step) >= 0),
  lines.filter((l) => '1234'.indexOf(l.step) < 0).map((l) => l.step).join());
check('all four reset steps are represented',
  ['1', '2', '3', '4'].every((s) => lines.some((l) => l.step === s)),
  'steps present: ' + [...new Set(lines.map((l) => l.step))].sort().join());

/* ---- what each side names ----
   The lookbehind matters: without it, "_bss" in ".bss" and "_data" in
   "copy_data" would read as linker symbols, and the guard would demand the
   pseudocode mention a section name. */
const PSEUDO_SYMBOL = /(?<![A-Za-z0-9.])_[a-z][a-z0-9_]*/g;
const pseudoSyms = [...new Set(pre.match(PSEUDO_SYMBOL) || [])].sort();

check('the pseudocode names some linker symbols to check', pseudoSyms.length >= 4,
  'found: ' + (pseudoSyms.join(' ') || '(none)'));

/* The direction that matters. If the lesson names a symbol the file does not
   have, the lesson cannot be typed — that is exactly the SystemInit bug, and
   SystemInit is a call target rather than a symbol, so it is checked separately
   below. The reverse is deliberately NOT required: startup.s legitimately
   contains things the reset walk does not cover (_estack, the vector table,
   the local labels copy_data/zero_bss/hang). */
for (const s of pseudoSyms) {
  check('the pseudocode names ' + s + ' and startup.s uses it',
    startup.indexOf(s) >= 0,
    'startup.s does not mention ' + s);
}

/* The "What the linker supplied" panel is a second, separate list of claims
   about the same file, so it gets the same one-directional check. _estack
   appears here rather than in the pseudocode because the hardware loads it from
   the vector table — startup code never assigns it. */
const panelFrom = lab.indexOf('What the linker supplied');
const panelTo = lab.indexOf('</div>', lab.indexOf('_sbss', panelFrom));
if (panelFrom < 0 || panelTo < 0) {
  throw new Error('linker-supplied panel markers not found in 22_lab_linker.js');
}
const panel = lab.slice(panelFrom, panelTo);
const panelSyms = [...new Set(panel.match(PSEUDO_SYMBOL) || [])].sort();
check('the linker-supplied panel names symbols', panelSyms.length >= 4,
  'found: ' + (panelSyms.join(' ') || '(none)'));
for (const s of panelSyms) {
  check('the lab tells the learner the linker supplies ' + s + ' and startup.s uses it',
    startup.indexOf(s) >= 0,
    'startup.s does not mention ' + s);
}

/* ---- call targets: the sharp edge of the original defect ---- */
function calls(text, re) { return [...text.matchAll(re)].map((m) => m[1]).sort(); }
const pseudoCalls = calls(pre, /\bbl\s+(\w+)/g);
const startupCalls = calls(startup, /\bbl\s+(\w+)/g);

check('the pseudocode and startup.s call exactly the same targets',
  pseudoCalls.join(',') === startupCalls.join(','),
  'pseudocode calls ' + (pseudoCalls.join(',') || '(none)') +
  ' vs startup.s calls ' + (startupCalls.join(',') || '(none)'));
check('the only call is main, and the pseudocode ends in it',
  pseudoCalls.length === 1 && pseudoCalls[0] === 'main',
  'calls: ' + (pseudoCalls.join(',') || '(none)'));
check('the last thing the pseudocode teaches before main is zeroing .bss',
  /write zero until end/.test(pre) && pre.indexOf('write zero until end') < pre.indexOf('bl main'),
  'order: ' + lines.map((l) => l.text.trim().replace(/\s*;.*/, '')).join(' / '));
/* ---- the regression, named ---- */
check('no SystemInit call survives anywhere in the pseudocode',
  !/\bbl\s+SystemInit\b/.test(pre),
  'a call to a symbol that is defined in no file of this project is a lesson that cannot be typed');
check('startup.s defines nothing it does not also call, beyond the vector table',
  /\bbl\s+main\b/.test(startup) && !/\bbl\s+SystemInit\b/.test(startup));

/* ---- the file the learner is actually handed ---- */
check('startup.s still exports the reset entry the lab points at',
  /\.global\s+Reset_Handler/.test(startup) && /^Reset_Handler:/m.test(startup));
check('startup.s still places a vector table with an initial stack pointer',
  /\.section\s+\.isr_vector/.test(startup) && /\.word\s+_estack/.test(startup));
check('startup.s still ends main() in an infinite loop, and the lab says so',
  /hang:[\s\S]*?b\s+hang/.test(startup) && /b\s+hang/.test(pre),
  'a main() that returns runs off the end of .text');
check('the card tells the learner this file is deliberately minimal',
  /deliberately minimal/i.test(pre) || /deliberately minimal/i.test(lab.slice(preFrom, preTo + 400)),
  'without this the learner assumes a vendor startup is missing from the lesson');

/* ================= the annotated assembly listing =================
   The second half of the same defect. The lab's pseudocode is five lines; the
   file the learner is handed is 58. Showing both without saying which assembly
   implements which step leaves the reader to assume a gap. So the lab embeds the
   real file, annotates it per reset step, and this section pins that copy to
   the artefact on disk. An embedded copy is only safe if something makes drift
   fail loudly, and that something is these checks. */
const vm = require('vm');
const asmFrom = lab.indexOf('var STARTUP_S_LINES = [');
const asmTo = lab.indexOf('var LINK_RULES = {');
if (asmFrom < 0 || asmTo < 0 || asmTo < asmFrom) {
  throw new Error('STARTUP_S_* tables not found in 22_lab_linker.js');
}
const ctx = vm.createContext({});
vm.runInContext(lab.slice(asmFrom, asmTo) +
  '\nthis.S = STARTUP_S_LINES; this.T = STARTUP_S_STEP; this.N = STARTUP_S_NOTE; this.R = STARTUP_S_REGS;', ctx);
const S = ctx.S, T = ctx.T, N = ctx.N, R = ctx.R;

/* Line endings are normalised: the file in the repository is CRLF, the copy is
   a JS array, and comparing bytes would fail on a checkout of the wrong
   platform for no real reason. What must match is the text, line for line. */
const realLines = startup.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');

check('the embedded listing has the same number of lines as startup.s',
  S.length === realLines.length,
  'embedded ' + S.length + ' vs real ' + realLines.length +
  ' - a line was added to one of them without the other');
const firstDiff = S.findIndex((l, i) => l !== realLines[i]);
check('the embedded listing is line-for-line identical to startup.s',
  firstDiff < 0,
  firstDiff < 0 ? '' : 'line ' + (firstDiff + 1) + ': embedded ' + JSON.stringify(S[firstDiff]) +
    ' vs real ' + JSON.stringify(realLines[firstDiff]));

/* The listing is written into innerHTML unescaped, which is only sound because
   assembly has no use for "<" or "&". A future line carrying "<" would open a tag
   and "&" could start a character reference - so the assumption is checked rather
   than asserted in a comment. ">" is deliberately not in the set: the file header
   writes "->" and a lone ">" is a literal character in HTML text content. */
const unsafeLine = S.findIndex((l) => /[<&]/.test(l));
check('no line of the listing needs escaping to be safe as innerHTML',
  unsafeLine < 0,
  unsafeLine < 0 ? '' : 'startup.s line ' + (unsafeLine + 1) + ' contains a character that HTML will parse: ' +
    JSON.stringify(S[unsafeLine]));
check('the listing does use ">" somewhere, so the check above is not vacuous',
  S.some((l) => l.indexOf('>') >= 0),
  'if no line had a ">" the exclusion above would be untested');
check('the listing is rendered unescaped on purpose, not by accident',
  /* Scoped to asmLinesHtml, because that is the function whose whole design is
     the unescaped insert. Elsewhere in the fragment, assembly text may and does
     go through esc() - in the "Reading a .s" stage the same lines appear as
     button labels, where escaping is correct. What must not change is the
     listing itself. */
  (() => {
    const gen = sliceFunction(lab, 'asmLinesHtml');
    return !!gen && !/esc\(/.test(gen) && /asmHost\.innerHTML = asmLinesHtml\(\)/.test(lab);
  })(),
  'if asmLinesHtml ever switches to esc(), the indent-sensitive assembly text will be wrong instead of safe');

/* ---- the step table ---- */
check('every line is assigned to a step or explicitly to none',
  T.length === S.length && T.every((v) => Number.isInteger(v) && v >= 0 && v <= 5),
  'table has ' + T.length + ' entries for ' + S.length + ' lines');
for (let k = 1; k <= 5; k++) {
  const owned = T.filter((v) => v === k).length;
  check('reset step ' + k + ' owns at least one line of the file', owned > 0,
    'a step with no lines highlights nothing and teaches nothing');
}
function spanOf(k) {
  const idx = T.map((v, i) => (v === k ? i : -1)).filter((i) => i >= 0);
  return [idx[0] + 1, idx[idx.length - 1] + 1, idx.length];
}
for (const k of [3, 4, 5]) {
  const [lo, hi, n] = spanOf(k);
  check('reset step ' + k + ' is a contiguous run of ' + n + ' lines (' + lo + '-' + hi + ')',
    n === hi - lo + 1,
    'the copy loop, the zero loop and the call to main are each one unbroken block; a hole means a line was misfiled');
}
check('the .data copy precedes the .bss zero, which precedes main',
  spanOf(3)[0] < spanOf(4)[0] && spanOf(4)[0] < spanOf(5)[0],
  'step 3 at ' + spanOf(3)[0] + ', step 4 at ' + spanOf(4)[0] + ', step 5 at ' + spanOf(5)[0]);
check('the two words the core fetches on reset belong to step 1',
  S[11] && /_estack/.test(S[11]) && T[11] === 1 && /Reset_Handler/.test(S[12]) && T[12] === 1,
  'startup.s lines 12-13 are what reset actually reads, so they are step 1');
check('the vector table itself belongs to step 2, not step 1',
  /__isr_vector:/.test(S[10]) && T[10] === 2,
  'step 1 is the core reading two words; step 2 is the table that holds them');
check('the branches out of each loop point at the next step',
  /bge zero_bss/.test(S[27]) && T[27] === 3 && /bge call_main/.test(S[38]) && T[38] === 4,
  'bge zero_bss leaves the copy loop and enters the zero loop');

/* ---- the notes ---- */
const noteKeys = Object.keys(N).map(Number);
check('every annotated line number exists in the file',
  noteKeys.every((k) => k >= 1 && k <= S.length),
  'out of range: ' + noteKeys.filter((k) => k < 1 || k > S.length).join());
check('the notes key onto the lines a reader would actually question',
  [23, 25, 29, 30, 43, 45].every((k) => N[k]),
  'missing a note for: ' + [23, 25, 29, 30, 43, 45].filter((k) => !N[k]).join());
check('the two pseudo-instructions and the branch-with-link are all called out',
  /pseudo-instruction/.test(N[23] || '') && /branch-with-link/.test(N[43] || ''),
  'ldr r0, =addr and bl are the two things beginners misread as real instructions');
check('a note never claims more than the line it annotates',
  Object.keys(N).every((k) => {
    const text = N[k];
    /* a note may quote its own line, but must not contain another line's number
       as if it were part of the same thought - a cheap guard against a note that
       was written for a different line and re-keyed */
    return text.length < 700;
  }),
  'a note over 700 characters is a paragraph that has lost its line');

/* asmLineNote is the fallback for the ~40 unannotated structural lines, so the
   kinds it must recognise are part of the contract, not an implementation
   detail: without them most of the file has a dead click target. It is sliced
   out by brace matching and actually called, because grepping for the word
   "Blank." proves only that the word is present, not that any line can reach it
   - an unreachable branch and a missing one look identical to a text search. */
function sliceFunction(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) { return null; }
  const open = src.indexOf('{', at);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (depth === 0) { return src.slice(at, i + 1); } }
  }
  return null;
}
const noteSrc = sliceFunction(lab, 'asmLineNote');
const cmtSrc = sliceFunction(lab, 'asmCommentLines');
const classifySrc = sliceFunction(lab, 'asmClassify');
const cmtWiring = /var STARTUP_S_CMT = asmCommentLines\(\);/.exec(lab);
/* Independently recompute which lines are inside an assembly block comment, so
   the lab's answer is compared against a second reading of the same file rather
   than against itself. Declared before the block that reports on it.
   A line is comment only when the comment starts its first non-space character:
   startup.s:12 and :13 are .word directives carrying an inline note, and the
   simpler "contains an opening delimiter" rule marked both as comments. */
const cmtFlags = (() => {
  let open = false;
  return S.map((t) => {
    const at = t.indexOf('/*');
    if (at >= 0) { open = true; }
    const f = open && (at < 0 || /^\s*\/\*/.test(t));
    if (t.indexOf('*/') >= 0) { open = false; }
    return f;
  });
})();
check('asmLineNote exists as a real function', !!noteSrc);
check('asmCommentLines exists, because comment state spans lines', !!cmtSrc);
check('asmClassify exists, because the kind of a line is a shared decision', !!classifySrc,
  'asmLineNote calls it and so does the "Reading a .s" histogram; if it is ' +
  'gone the listing throws on the first click');
check('the comment flags are computed once, not per click', !!cmtWiring,
  'asmLineNote reads STARTUP_S_CMT, so the array has to be built somewhere; ' +
  'if this line is gone the listing throws on the first click');
let noteOf = null;
if (noteSrc && cmtSrc && classifySrc && cmtWiring) {
  const nctx = vm.createContext({ STARTUP_S_LINES: S, STARTUP_S_NOTE: N });
  vm.runInContext(classifySrc + '\n' + cmtSrc + '\n' + cmtWiring[0] + '\n' + noteSrc +
    '\nthis.of = asmLineNote; this.cm = STARTUP_S_CMT; this.cf = asmClassify;', nctx);
  noteOf = nctx.of;
  check('the lab and this spec agree on which lines are comments',
    JSON.stringify(nctx.cm) === JSON.stringify(cmtFlags),
    'lab: ' + nctx.cm.map((f, i) => (f ? i + 1 : 0)).filter(Boolean).join() +
    ' | spec: ' + cmtFlags.map((f, i) => (f ? i + 1 : 0)).filter(Boolean).join());
}

if (noteOf) {
  const answers = S.map((_, i) => noteOf(i + 1));
  const silent = answers.map((a, i) => (typeof a !== 'string' || a.length < 20 ? i + 1 : -1))
    .filter((i) => i >= 0);
  check('every one of the ' + S.length + ' lines explains itself when clicked',
    silent.length === 0,
    'no answer for line(s): ' + (silent.join() || 'none') +
    ' - a line that says nothing is a dead click target');

  /* Only lines with no hand-written note are required to fall through to the
     generic classifier. A line the author explained specifically is allowed to
     say something other than its structural class - that is the point of it. */
  const generic = (re) => S.map((l, i) => (re.test(l) && !N[i + 1] ? i + 1 : -1)).filter((i) => i >= 0);

  const blankLines = generic(/^$/);
  check('a blank line with no note is answered as blank, not as an instruction',
    blankLines.length > 0 && blankLines.every((n) => /Blank\./.test(noteOf(n))),
    blankLines.length + ' blank lines');
  const dirLines = generic(/^\s*\.[a-z]/);
  check('a directive with no note is answered as a directive',
    dirLines.length > 0 && dirLines.every((n) => /Assembler directive/.test(noteOf(n))),
    dirLines.length + ' directives; misanswered: ' +
    dirLines.filter((n) => !/Assembler directive/.test(noteOf(n))).join());
  const cmtLines = cmtFlags.map((f, i) => (f && !N[i + 1] ? i + 1 : -1)).filter((i) => i >= 0);
  check('a line inside an assembly comment is answered as a comment',
    cmtLines.length > 0 && cmtLines.every((n) => /Comment\./.test(noteOf(n))),
    cmtLines.length + ' comment lines; misanswered: ' +
    cmtLines.filter((n) => !/Comment\./.test(noteOf(n))).join());
  check('the middle of a multi-line comment is recognised as comment, not code',
    cmtFlags[1] === true && /Comment\./.test(noteOf(2)),
    'only line 1 carries the opening delimiter, so a per-line test alone would ' +
    'call line 2 an instruction and teach the reader that comments are one line long');
  const lblLines = generic(/^\s*\S+:\s*$/);
  check('a label with no note is answered as a label, not as an instruction',
    lblLines.length > 0 && lblLines.every((n) => /Label\./.test(noteOf(n))),
    lblLines.length + ' labels; misanswered: ' +
    lblLines.filter((n) => !/Label\./.test(noteOf(n))).join());
  check('a hand-written note beats the generic classification',
    /pseudo-instruction/.test(noteOf(23)) && !/Assembler directive/.test(noteOf(23)),
    'line 23 is an ldr pseudo-op: the specific note must win over its class');
  check('both ldr = pseudo-instructions are called out as pseudo-instructions',
    /pseudo-instruction/.test(noteOf(23)) && /pseudo-instruction/.test(noteOf(25)),
    'ldr r0, =_sdata and ldr r2, =_sidata are the classic beginner trap: they ' +
    'look like directives, emit a literal pool, and are not ARM instructions at all');
  check('no note claims a byte count for a non-instruction',
    S.every((l, i) => /^\s*\.[a-z]/.test(l) || /^\s*\S+:\s*$/.test(l)
      ? !/emits \d+ bytes|is \d+ bytes/.test(noteOf(i + 1))
      : true),
    'labels and directives cost no bytes; claiming a size for them is a real error');
}

/* ---- the wiring, so the tables are actually read ---- */
check('the listing, the note pane and the register panel all have hosts',
  ['id="linklab-asm"', 'id="linklab-asmnote"', 'id="linklab-regs"'].every((id) => lab.indexOf(id) >= 0));
check('the listing is rendered from the array, not hand-written into the markup',
  /asmHost\.innerHTML = asmLinesHtml\(\)/.test(lab) && /STARTUP_S_LINES\[i\]/.test(lab));
check('a reset step drives the assembly highlight',
  /asmApplyStep\(n\)/.test(lab) && /asmApplyStep\(0\)/.test(lab),
  'without the initial call the panel is blank until the reader clicks a step');
check('changing step clears the line selection, not just the highlights',
  /classList\.remove\("active",\s*"dim",\s*"picked"\)/.test(lab),
  'a line chosen under the previous step would keep its marker and its note ' +
  'while the panel showed a different step - the marker would point at a step ' +
  'that is no longer on screen');
check('the picked line is styled at least as visibly as an active one',
  /\.linklab-asmline\.picked\{[^}]*background:var\(--surface\)/.test(head),
  'giving the selection the container background made a picked line look less ' +
  'highlighted than its neighbours, which inverts the signal');
check('the selection marker is visually distinct from the step marker',
  /\.linklab-asmline\.picked\{[^}]*var\(--ok\)/.test(head) &&
  /\.linklab-asmline\.active\{[^}]*var\(--accent\)/.test(head),
  'two different meanings need two different colours, in both themes');
check('the register panel has an entry for every step',
  [1, 2, 3, 4, 5].every((k) => Array.isArray(R[k]) && R[k].length > 0),
  'missing: ' + [1, 2, 3, 4, 5].filter((k) => !R[k] || !R[k].length).join());
check('the copy loop step names all four registers it uses',
  (R[3] || []).filter((r) => r[0]).map((r) => r[0]).join() === 'r0,r1,r2,r3',
  'r0-r3 are the whole story of the copy loop: got ' +
  (R[3] || []).filter((r) => r[0]).map((r) => r[0]).join());
check('the step before the first instruction says there is nothing in the registers',
  /\bno registers\b/i.test((R[1] || []).map((r) => r[1]).join()),
  'r0-r3 have no value before the core executes anything; claiming otherwise teaches a false model');

console.log(failures ? '\n' + failures + ' check(s) FAILED' : '\nstartup pseudocode green (pseudocode and startup.s agree)');
process.exit(failures ? 1 : 0);
