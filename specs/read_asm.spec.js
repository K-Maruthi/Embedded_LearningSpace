/* "Reading a .s" stage spec.
 *
 * Zero dependencies. Run with:  node specs/read_asm.spec.js
 *
 * What this guards: stage 9 of the Linker & Startup lab teaches the reader how to
 * read assembly, and it does so by decomposing four real lines of the same
 * startup.s that stage 5 already shows. That creates three ways for the stage to
 * start lying, and all three are silent:
 *
 *   1. The histogram is the lesson. "19 of 58 lines are instructions" is the
 *      number a reader is meant to take away, and it is computed at load time
 *      from the embedded file. If asmClassify is reordered, every line whose
 *      first non-space character is ambiguous flips category and the count moves
 *      with no visible symptom anywhere else in the app.
 *   2. Each decode names a line number and claims fields for it. The quoted text
 *      is read out of STARTUP_S_LINES at render time rather than stored, so it
 *      cannot drift - but that only helps if the line number still points at a
 *      line of the kind the decode claims, and if every field token the decode
 *      highlights actually appears in that line. A decode of line 28 labelled
 *      "a wide 32-bit load" would render perfectly and teach the wrong thing.
 *   3. The Thumb-2 list makes falsifiable claims about specific lines (line 29 is
 *      4 bytes, line 28 is 2, line 6 says .thumb, line 23 is the pseudo-
 *      instruction). If startup.s is edited, those pointers can end up naming the
 *      wrong lines while the prose still reads perfectly.
 *
 * So the spec recomputes the classification independently, checks every decode
 * against the line it claims, and pins the Thumb-2 pointers to the lines they
 * name. It deliberately does NOT grep for prose: "Thumb-2" being present in the
 * fragment is not evidence that anything is taught.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const lab = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '22_lab_linker.js'), 'utf8');
const head = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '01_head.html'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '02_body.html'), 'utf8');
const startup = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'src', 'examples', 'startup.s'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('pass  ' + name); return; }
  failures++;
  console.log('FAIL  ' + name);
  if (detail !== undefined && detail !== null && detail !== '') {
    console.log('      ' + String(detail).split('\n').join('\n      '));
  }
}
function section(t) { console.log('\n-- ' + t); }

/* --- pull the fragment's own data structures out by brace matching --- */
function sliceBalanced(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) { return null; }
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (depth === 0) { return src.slice(at, i + 1); } }
  }
  return null;
}
function sliceFunction(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) { return null; }
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (depth === 0) { return src.slice(at, i + 1); } }
  }
  return null;
}
/* Bracket-balanced, not brace-balanced: an array of objects closes with "]" and
   brace matching would run straight past it into the next declaration. */
function sliceBracketed(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) { return null; }
  const open = src.indexOf('[', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') { depth++; }
    else if (src[i] === ']') { depth--; if (depth === 0) { return src.slice(at, i + 1); } }
  }
  return null;
}

/* The embedded copy, read the same way the lab's own spec reads it. */
const linesSrc = sliceBracketed(lab, 'var STARTUP_S_LINES = [');
let S = [];
if (linesSrc) {
  const ctx = vm.createContext({ out: null });
  vm.runInContext(linesSrc + '\nthis.out = STARTUP_S_LINES;', ctx);
  S = ctx.out;
}

/* ---- 1. the classifier, recomputed independently ---- */
section('the line classifier');
const classifySrc = sliceFunction(lab, 'asmClassify');
const cmtSrc = sliceFunction(lab, 'asmCommentLines');
check('asmClassify is a real function', !!classifySrc);
check('asmCommentLines is a real function', !!cmtSrc);

let classify = null, labCmt = null;
if (classifySrc && cmtSrc) {
  const ctx = vm.createContext({ STARTUP_S_LINES: S });
  vm.runInContext(classifySrc + '\n' + cmtSrc + '\nthis.c = asmClassify; this.m = asmCommentLines();', ctx);
  classify = ctx.c;
  labCmt = ctx.m;
}

/* A second reading of the same file, written from the definition of each kind
   rather than by reusing the lab's code. The only thing shared is the text. */
/* Written from the definition, not from the lab's code. The comment test is the
   interesting part: a line is a comment only when the comment starts the first
   non-space character, so a `.word` directive with an inline block comment is
   still a directive. An earlier version here copied the lab's simpler "does the
   line contain an opening delimiter" rule, which agreed with the lab and was
   wrong in the same way - two readings of the same bug. The line numbers pinned
   below are what catch that, not the agreement. */
function referenceClassify(lines) {
  const cmt = (() => {
    const f = [];
    let open = false;
    for (const t of lines) {
      const at = t.indexOf('/*');
      if (at >= 0) { open = true; }
      f.push(open && (at < 0 || /^\s*\/\*/.test(t)));
      if (t.indexOf('*/') >= 0) { open = false; }
    }
    return f;
  })();
  return lines.map((t, i) => {
    if (t === '') { return 'blank'; }
    if (cmt[i]) { return 'comment'; }
    const tr = t.replace(/^\s+/, '');
    if (tr.charAt(0) === '.') { return 'directive'; }
    if (tr.slice(-1) === ':') { return 'label'; }
    return 'insn';
  });
}
const refKinds = referenceClassify(S);
const labKinds = S.map((_, i) => (classify ? classify(S[i], labCmt[i]) : '?'));

check('the lab classifies every line of the embedded file', labKinds.every((k) => k !== '?'),
  labKinds.map((k, i) => (k === '?' ? (i + 1) : -1)).filter((i) => i >= 0).join());
const disagree = S.map((_, i) => (labKinds[i] === refKinds[i] ? -1 : i)).filter((i) => i >= 0);
check('the lab and this spec agree on the kind of every line',
  disagree.length === 0,
  disagree.length === 0 ? '' : 'line(s) ' + disagree.map((i) => (i + 1) + ' lab=' + labKinds[i] + ' spec=' + refKinds[i]).join('; '));

/* The exclusion that matters: 'b .' starts with a letter and ends with a
   character, so it is an instruction. A classifier that tested "ends with ."
   or "first char is a letter" for a directive would get this wrong, and a
   classifier that stripped whitespace before the empty test would misfile
   whitespace-only lines. */
const bDot = S.findIndex((t) => t.replace(/^\s+/, '') === 'b .');
check('there is a "b ." line to classify', bDot >= 0);
check('"b ." is classified as an instruction, not a directive',
  bDot >= 0 && labKinds[bDot] === 'insn', bDot >= 0 ? labKinds[bDot] : '');

/* A trailing comment must not swallow the directive it is attached to. This is
   the case that was actually wrong: startup.s:12 and :13 are `.word` directives
   with an inline `/* ... *&#47;` note, and treating any line containing "/*" as a
   comment made the vector table's first two entries invisible to the count. The
   assertion is on specific line numbers because a rule copied from the lab's own
   code agrees with the lab whether or not the lab is right. */
const trailing = S.map((t, i) => (t.indexOf('/*') >= 0 && !/^\s*\/\*/.test(t) ? i + 1 : -1)).filter((i) => i > 0);
check('the file has at least one directive with a trailing comment, so the case is live',
  trailing.length >= 2, 'lines ' + trailing.join() + ' - if startup.s changes, re-check what they are');
trailing.forEach((n) => {
  check('startup.s:' + n + ' is a directive, not a comment',
    labKinds[n - 1] === 'directive',
    JSON.stringify(S[n - 1]) + ' was classified ' + labKinds[n - 1] +
    ' - a trailing comment does not make the line it annotates a comment');
});
/* And the converse: a line that is nothing but a comment must still count,
   including the middle of a multi-line one. */
const blockHeader = S.findIndex((t) => /^\s*\/\*/.test(t));
check('the file opens with a block comment, which is 3 lines of the file',
  blockHeader === 0 && labKinds[0] === 'comment' && labKinds[1] === 'comment' && labKinds[2] === 'comment',
  'lines 1-3 are ' + [labKinds[0], labKinds[1], labKinds[2]].join(','));
check('and the comment state is not left open past the end of the header',
  S.slice(3).every((t, i) => !labKinds[i + 3] || labKinds[i + 3] !== 'comment' || /^\s*\/\*/.test(t)),
  'a block comment that never closed would swallow the rest of the file');

/* ---- 2. the histogram ---- */
section('the histogram');
const histSrc = /var ASM_HIST = \(function \(\) \{([\s\S]*?)\n  \}\)\(\);/.exec(lab);
check('ASM_HIST is computed from the file, not written into the copy', !!histSrc);
let ASM_HIST = null;
if (histSrc && classify) {
  const ctx = vm.createContext({ STARTUP_S_LINES: S, STARTUP_S_CMT: labCmt });
  vm.runInContext(classifySrc + '\n' + histSrc[0] + '\nthis.h = ASM_HIST;', ctx);
  ASM_HIST = ctx.h;
}
const refCounts = { insn: 0, directive: 0, label: 0, comment: 0, blank: 0 };
refKinds.forEach((k) => { refCounts[k]++; });
if (ASM_HIST) {
  Object.keys(refCounts).forEach((k) => {
    check('the ' + k + ' count is ' + refCounts[k],
      ASM_HIST[k] === refCounts[k], 'lab: ' + ASM_HIST[k] + ' spec: ' + refCounts[k]);
  });
  const sum = Object.keys(refCounts).reduce((a, k) => a + ASM_HIST[k], 0);
  check('the five counts add up to the whole file (' + S.length + ' lines)', sum === S.length, 'sum: ' + sum);
  check('fewer than half the lines are instructions', ASM_HIST.insn < S.length / 2,
    ASM_HIST.insn + ' of ' + S.length + ' - if this ever goes over half the stage\'s headline claim is wrong');
  check('and it is not a single instruction either', ASM_HIST.insn > 5, ASM_HIST.insn);
}
const orderSrc = sliceBracketed(lab, 'var ASM_ORDER = [');
const kindsSrc = sliceBalanced(lab, 'var ASM_KINDS = {');
check('ASM_ORDER lists all five kinds, instructions first', !!orderSrc && !!kindsSrc &&
  /"insn"[\s\S]*"directive"[\s\S]*"label"[\s\S]*"comment"[\s\S]*"blank"/.test(orderSrc));
/* Keys are matched on a line, not by slicing a fixed width out of the block:
   the table is column-aligned for reading, so the spacing after the colon is
   whatever lines up the "emits" column and is not part of the contract. */
const kindsKeys = kindsSrc ? (kindsSrc.match(/^\s*(\w+):\s*\{ label:/gm) || []).map((s) => /^\s*(\w+):/.exec(s)[1]) : [];
check('ASM_KINDS describes exactly the five kinds in ASM_ORDER',
  kindsKeys.length === 5 && ['insn', 'directive', 'label', 'comment', 'blank'].every((k) => kindsKeys.indexOf(k) >= 0),
  kindsKeys.join());
if (kindsSrc) {
  const emits = {};
  [...kindsSrc.matchAll(/^\s*(\w+):\s*\{[^\n]*?emits: "(\w+)"/gm)].forEach((m) => { emits[m[1]] = m[2]; });
  check('every kind states what it emits', Object.keys(emits).length === 5, JSON.stringify(emits));
  check('only instructions are described as emitting code',
    emits.insn === 'code' && ['directive', 'label', 'comment', 'blank'].every((k) => emits[k] !== 'code'),
    JSON.stringify(emits) + ' - the table is the thing that teaches "only one kind is code"');
  check('the table admits .word emits data, so "only instructions emit" is not overstated',
    emits.directive === 'varies');
  check('and that directives never reach the image, which is the claim the .s/.o contrast rests on',
    /Never reaches the image/.test(kindsSrc));
  /* The m flag is load-bearing: without it ^ only matches the start of the whole
     block, every key misses, and the check reports a length of 0 for all five. */
  const whatOf = (k) => (new RegExp('^\\s*' + k + ':\\s*\\{[^\\n]*?what: "([^"]*)"', 'm').exec(kindsSrc) || [null, ''])[1];
  check('every kind has an explanation a reader can act on',
    kindsKeys.length > 0 && kindsKeys.every((k) => whatOf(k).length >= 55),
    kindsKeys.map((k) => k + '=' + whatOf(k).length).join(' '));
}

/* ---- 3. the decode table ---- */
section('the decode table');
const decSrc = sliceBalanced(lab, 'var READASM_LINES = {');
check('READASM_LINES exists', !!decSrc);
let DEC = null;
if (decSrc) {
  const ctx = vm.createContext({});
  vm.runInContext(decSrc + '\nthis.d = READASM_LINES;', ctx);
  DEC = ctx.d;
}
const KEYS = DEC ? Object.keys(DEC) : [];
check('there are lines to decode', KEYS.length >= 3, KEYS.join());

/* The invariant that makes the quoted text trustworthy: no decode stores its own
   copy of the line, so a stale copy is not merely unlikely, it is unrepresentable.
   If a `line:` key ever reappears, the spec should fail rather than pass. */
/* Anchored to the start of a line, because prose inside a string may legitimately
   contain the characters "line:" - an expansion note does exactly that. */
if (decSrc) {
  check('no decode stores its own copy of the line text',
    !/^\s*line:\s*"/m.test(decSrc),
    'a `line:` key would be a second copy of startup.s that nothing pins; ' +
    'the text must be read out of STARTUP_S_LINES at render time');
}
if (DEC) {
  check('and none of the parsed decodes has a line field either',
    KEYS.every((k) => DEC[k].line === undefined),
    KEYS.filter((k) => DEC[k].line !== undefined).join());
}
if (DEC) {
  KEYS.forEach((k) => {
    const d = DEC[k];
    const text = S[d.n - 1];
    check('decode "' + k + '" points at a real line (' + d.n + ')', typeof text === 'string',
      d.n + ' is past the end of a ' + S.length + '-line file');
    if (typeof text !== 'string') { return; }
    check('decode "' + k + '" is decoding an instruction, not a ' + refKinds[d.n - 1],
      refKinds[d.n - 1] === 'insn', 'line ' + d.n + ' is ' + refKinds[d.n - 1]);
    check('decode "' + k + '" has fields and a reason', Array.isArray(d.fields) && d.fields.length >= 3 && !!d.why,
      (d.fields || []).length + ' fields');
    /* Every highlighted token must be present in the line it claims to explain.
       This is the check that catches a decode that has been pointed at the wrong
       line: the field table would still render, just about the wrong text. */
    const missing = d.fields.map((f) => f[0]).filter((tok) => text.indexOf(tok) < 0);
    check('every field of "' + k + '" appears in startup.s:' + d.n,
      missing.length === 0,
      missing.length === 0 ? text.trim() : 'not in "' + text.trim() + '": ' + missing.map(JSON.stringify).join(' '));
    check('every field of "' + k + '" has a role and an explanation',
      d.fields.every((f) => f.length === 3 && f[1] && String(f[2]).length > 30),
      d.fields.map((f) => (f.length === 3 ? '' : JSON.stringify(f[0]) + ' is malformed')).join('; '));
  });
  /* The four decodes are the four interesting shapes, and each must be a
     different line - four buttons that all decoded line 29 would be a
     plausible-looking bug that no per-decode check would catch. */
  const ns = KEYS.map((k) => DEC[k].n);
  check('each decode names a different line', new Set(ns).size === ns.length, ns.join());
  check('the pseudo-instruction decode points at a "ldr rX, =" line',
    KEYS.some((k) => /=\s*\S/.test(S[DEC[k].n - 1] || '')),
    KEYS.map((k) => k + '=' + (S[DEC[k].n - 1] || '').trim()).join(' | '));
  check('the pseudo-instruction decode says what it expands into',
    KEYS.some((k) => Array.isArray(DEC[k].pieces) && DEC[k].pieces.length >= 2 && DEC[k].expands),
    'the expansion is the whole point of the "=" form; if it is gone the ' +
    'decode is a claim with no content');
  check('only the pseudo-instruction claims an expansion',
    KEYS.filter((k) => DEC[k].expands).length === 1);
}

/* ---- 4. Thumb-2 ---- */
section('Thumb-2');
const t2Src = sliceBracketed(lab, 'var READASM_T2 = [');
check('READASM_T2 exists', !!t2Src);
let T2 = null;
if (t2Src) {
  const ctx = vm.createContext({});
  vm.runInContext(t2Src + '\nthis.t = READASM_T2;', ctx);
  T2 = ctx.t;
}
if (T2) {
  check('there are consequences, not just a definition', T2.length >= 4, T2.length + ' items');
  check('every item has a title, a body and a pointer to where to see it',
    T2.every((i) => i.t && String(i.d).length > 80 && i.at),
    T2.map((i) => (i.at ? '' : i.t + ' has no "see" pointer')).join('; '));
  check('every "see" pointer names a real line number',
    T2.every((i) => (i.at.match(/\bline (\d+)\b/g) || []).every((m) => {
      const n = Number(/\d+/.exec(m)[0]);
      return n >= 1 && n <= S.length;
    })),
    T2.map((i) => i.at).join(' | '));
  /* The pointers are claims about specific lines. If the file changes under
     them they become wrong silently, so each is checked against the line. */
  const twoSizes = T2.find((i) => /Two encodings/.test(i.t));
  check('the "two encodings" item points at one short and one long instruction',
    !!twoSizes && /line (\d+) is 4 bytes; line (\d+) is 2/.test(twoSizes.at),
    twoSizes ? twoSizes.at : 'item not found');
  if (twoSizes && /line (\d+) is 4 bytes; line (\d+) is 2/.test(twoSizes.at)) {
    const m = /line (\d+) is 4 bytes; line (\d+) is 2/.exec(twoSizes.at);
    const wide = Number(m[1]), narrow = Number(m[2]);
    /* A wide Thumb-2 instruction is one the T1 (16-bit) encodings cannot
       express: a load or store with a register offset, or a 32-bit bl. A
       short one is a 16-bit form: conditional branch, ldr literal, mov
       immediate, b. */
    const wideOk = /^(ldr|str)\s+r\d,\s*\[r\d\],/.test((S[wide - 1] || '').trim()) ||
      /^bl\s/.test((S[wide - 1] || '').trim());
    check('startup.s:' + wide + ' really is a wide (32-bit) form', wideOk, (S[wide - 1] || '').trim());
    const narrowOk = /^(b|blx|bne|beq|bge|blt|bgt|ble|bcc|bcs)\w*\s+\S+/.test((S[narrow - 1] || '').trim()) ||
      /^ldr\s+r\d,\s*\[pc/.test((S[narrow - 1] || '').trim()) ||
      /^movs\s+r\d,\s*#\d+$/.test((S[narrow - 1] || '').trim());
    check('startup.s:' + narrow + ' really is a short (16-bit) form', narrowOk, (S[narrow - 1] || '').trim());
  }
  const pool = T2.find((i) => /literal pool/i.test(i.t));
  check('the literal-pool item points at a "ldr rX, =" line',
    !!pool && /line (\d+)/.exec(pool.at) && /^ldr\s+r\d,\s*=/.test((S[Number(/line (\d+)/.exec(pool.at)[1]) - 1] || '').trim()),
    pool ? pool.at + ' -> ' + (S[Number(/line (\d+)/.exec(pool.at)[1]) - 1] || '').trim() : 'item not found');
  const wbr = T2.find((i) => /cannot execute A32/.test(i.t));
  check('the A32 item points at the .thumb directive',
    !!wbr && /line (\d+)/.test(wbr.at) && /^\.thumb\b/.test((S[Number(/line (\d+)/.exec(wbr.at)[1]) - 1] || '').trim()),
    wbr ? wbr.at + ' -> ' + (S[Number(/line (\d+)/.exec(wbr.at)[1]) - 1] || '').trim() : 'item not found');
  /* The M0 claim is the one that is easy to state wrongly, so it is pinned. */
  const m0 = T2.find((i) => /Not every Cortex-M has Thumb-2/.test(i.t));
  check('the M0 item names ARMv6-M as the reason',
    !!m0 && /ARMv6-M/.test(m0.d) && /Thumb-1 only, no Thumb-2/.test(m0.d),
    m0 ? m0.d.slice(0, 120) : 'no item titled about the M0');
  check('and it says which line in the file depends on Thumb-2',
    !!m0 && /line (\d+)/.test(m0.at) && /^ldr\s+r3,\s*\[r2\],/.test((S[Number(/line (\d+)/.exec(m0.at)[1]) - 1] || '').trim()),
    m0 ? m0.at + ' -> ' + (S[Number(/line (\d+)/.exec(m0.at)[1]) - 1] || '').trim() : '');
  /* ".thumb" is the string the whole stage exists to explain, so the app must
     actually contain it - and, just as importantly, the app must not claim the
     thing that is false, that .thumb means 16-bit only. */
  check('the stage says .thumb does not mean 16-bit only', !!wbr && /does <i>not<\/i> mean '16-bit instructions only'/.test(wbr.d));
}

/* ---- 5. rendering and wiring ---- */
section('rendering and wiring');
check('the stage is in LINK_STAGES', /var LINK_STAGES = \[[^\]]*"readasm"/.test(lab));
check('the nav has a button for it', /data-link-stage="readasm"/.test(page));
check('the nav button is numbered 9', /data-link-stage="readasm"[^>]*>9\./.test(page));
check('renderLinkLab builds the body', /if\(stage==="readasm"\)\{ d=\{title:d\.title, intro:d\.intro, body:readasmBody\(\)\}; \}/.test(lab));
check('the stage is wired', /if \(stage === "readasm"\)/.test(lab));
check('readasmBody is a real function', !!sliceFunction(lab, 'readasmBody'));
check('the stage is a real LINK_DATA entry, not only a nav button', /LINK_DATA\.readasm = \{/.test(lab));
check('the body is declared empty and filled at render, so it is not dead markup',
  /body: ""/.test(sliceBalanced(lab, 'LINK_DATA.readasm = {') || ''));

/* The wiring must actually attach, and must select a first entry, or the panel
   shows its placeholder forever and the stage reads as broken. */
const wiring = lab.slice(lab.indexOf('if (stage === "readasm")'));
const readasmBody = sliceFunction(lab, 'readasmBody') || '';
check('the decode buttons are wired', /querySelectorAll\("button\[data-ra\]"\)/.test(wiring));
check('the histogram rows are wired to the kinds panel', /querySelectorAll\("\.readasm-histrow"\)/.test(wiring));
/* Every class selector the wiring reaches for must be a class readasmBody
   actually emits. Grepping that the string ".readasm-kind" appears somewhere in
   the block is not enough: the mutation that renames one of two occurrences
   leaves the other in place and the grep still passes, while the panel has
   quietly stopped responding. Tying each selector to the markup is the check
   that survives that. */
const wiredClasses = [...wiring.matchAll(/querySelector(?:All)?\("\.(readasm-[\w-]+)"/g)].map((m) => m[1]);
const emittedClasses = [...new Set((readasmBody.match(/readasm-[\w-]+/g) || []))];
const dangling = [...new Set(wiredClasses)].filter((c) => emittedClasses.indexOf(c) < 0);
check('every class the wiring selects is one the body emits', dangling.length === 0,
  dangling.length === 0 ? wiredClasses.join(' ') : 'selectors with no matching markup: ' + dangling.join(' '));
check('and the kinds panel is wired through that same class', wiredClasses.indexOf('readasm-kind') >= 0,
  wiredClasses.join(' '));
check('the kinds panel needs two lookups: the listener and the reset', (wiring.match(/querySelectorAll\("\.readasm-kind"\)/g) || []).length >= 2,
  (wiring.match(/querySelectorAll\("\.readasm-kind"\)/g) || []).length + ' lookups');
check('a first decode is selected so the panel is never empty', /button\[data-ra="insn"\]/.test(wiring));
check('the quoted line is read from the file at render time, and escaped there',
  /STARTUP_S_LINES\[d\.n - 1\]/.test(wiring) && /esc\(text\.replace/.test(wiring));
check('the fields are rendered as a table with a header row',
  /<th>Field<\/th><th>Role<\/th><th>What it means<\/th>/.test(lab));
/* The stage escapes the line text, unlike the stage-5 listing. That difference
   is deliberate and the reason it is asserted here: the same lines are rendered
   two ways in two stages, and a future reader must not "fix" one to match the
   other. */
/* The stage mixes plain text with deliberate markup, and the two have to be
   handled differently. Labels and line quotes are plain text and go through
   esc(); the "what", "d" and "why" fields carry real <em>/<code> and must not be
   escaped or they render as tags. Asserting only that esc() appears somewhere in
   the function is satisfied by any one call, so each field is checked where it
   is interpolated. */
/* The label is interpolated twice - in the histogram row and in the table - and
   "esc() appears somewhere" is satisfied while either one is bare. Count the
   uses and require every one of them to be escaped. */
const labelUses = (readasmBody.match(/ASM_KINDS\[k\]\.label/g) || []).length;
const labelEscaped = (readasmBody.match(/esc\(ASM_KINDS\[k\]\.label\)/g) || []).length;
check('every use of the kind label goes through esc()', labelUses >= 2 && labelEscaped === labelUses,
  labelEscaped + ' of ' + labelUses + ' escaped');
check('the decode quote goes through esc()', /esc\(text\.replace\(\/\^\\s\+\/, ""\)\)/.test(wiring));
check('the rail button label goes through esc()',
  /esc\(STARTUP_S_LINES\[READASM_LINES\[k\]\.n - 1\]\.replace\(\/\^\\s\+\/, ""\)\)/.test(readasmBody));
check('the "what" and "why" fields are inserted as markup, not escaped',
  /ASM_KINDS\[k\]\.what \+ '<\/p><\/div>'/.test(readasmBody) && /d\.why \+ "<\/p>"/.test(wiring),
  'these fields carry <em> and <code> on purpose; escaping them would show the reader the tags');
check('and the field explanations are too', /d\.fields\[i\]\[2\]/.test(wiring),
  'the third field of each row is prose with <code> in it');

/* ---- 6. the graded questions ---- */
section('the graded questions');
/* The graded questions live in the string readasmBody() returns, not in the
   LINK_DATA literal, so the block to inspect is the function body. Slicing up to
   the function instead would have found nothing at all. */
const raBlock = sliceFunction(lab, 'readasmBody') || '';
const quizzes = [...raBlock.matchAll(/data-q="([^"]+)" data-ok="([^"]+)"/g)].map((m) => ({ q: m[1], ok: m[2] }));
check('the stage has three graded questions', quizzes.length === 3, quizzes.map((x) => x.q).join());
check('every question key is unique', new Set(quizzes.map((x) => x.q)).size === quizzes.length);
check('the pseudo-instruction question is marked correct on the "ldr =" option',
  (() => {
    const q = /data-q="[^"]*pseudo[^"]*"[^>]*data-ok="([^"]+)"/.exec(raBlock) ||
      /data-q="ra1" data-ok="([^"]+)"/.exec(raBlock);
    if (!q) { return false; }
    const m = new RegExp('data-a="' + q[1] + '"[^>]*>([^<]*)').exec(raBlock);
    return !!m && /=/.test(m[1]);
  })(), 'the data-ok option must be the one whose text contains the "=" form');
/* Each check is scoped to its own quiz element. Searching the whole stage body
   for `data-a="<letter>"` finds the first matching letter anywhere, which for a
   reused letter is a different question's option - the ra3 check was reading
   ra1's "d" option and would have passed for the wrong reason. */
function optionTexts(block, qKey) {
  const at = block.indexOf('data-q="' + qKey + '"');
  if (at < 0) { return null; }
  const end = block.indexOf('data-answer=', at);
  const scope = block.slice(at, end < 0 ? block.length : end);
  const ok = /data-ok="([^"]+)"/.exec(scope);
  const opts = {};
  for (const m of scope.matchAll(/data-a="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)) { opts[m[1]] = m[2]; }
  return ok ? { ok: ok[1], opts } : null;
}
const ra3 = optionTexts(raBlock, 'ra3');
check('the Cortex-M0 question is marked correct on the wide-load option',
  !!ra3 && /ldr r3, \[r2\]/.test(ra3.opts[ra3.ok] || ''),
  ra3 ? 'ok=' + ra3.ok + ' text=' + JSON.stringify(ra3.opts[ra3.ok]) : 'ra3 not found');
const ra1 = optionTexts(raBlock, 'ra1');
check('the pseudo-instruction question is marked correct on the "ldr =" option',
  !!ra1 && /=/.test(ra1.opts[ra1.ok] || ''),
  ra1 ? 'ok=' + ra1.ok + ' text=' + JSON.stringify(ra1.opts[ra1.ok]) : 'ra1 not found');
const ra2 = optionTexts(raBlock, 'ra2');
check('the literal-pool question is marked correct on the "ldr =" option',
  !!ra2 && /ldr r0, =_sdata/.test(ra2.opts[ra2.ok] || ''),
  ra2 ? 'ok=' + ra2.ok + ' text=' + JSON.stringify(ra2.opts[ra2.ok]) : 'ra2 not found');
[ra1, ra2, ra3].forEach((q, i) => {
  check('question ra' + (i + 1) + ' has four options and one marked correct',
    !!q && Object.keys(q.opts).length === 4 && q.ok in q.opts,
    q ? JSON.stringify(q) : 'not found');
});
/* Each question needs an explanation, and the explanation must be the reason -
   an answer that restates the option teaches nothing. */
const answers = [...raBlock.matchAll(/data-answer="([^"]+)" hidden>([\s\S]*?)<\/div>/g)];
check('every question has an answer panel', answers.length === quizzes.length,
  quizzes.map((x) => x.q) + ' vs ' + answers.map((a) => a[1]));
check('each answer explains rather than restates', answers.every((a) => a[2].length > 120),
  answers.map((a) => a[1] + ' is ' + a[2].length + ' chars').join('; '));
check('the literal-pool answer names the reason (too few bits in 16 bits)',
  answers.some((a) => /16-bit encoding cannot carry a full 32-bit immediate/i.test(a[2])));
check('the M0 answer names the reason (Thumb-1 has no wide load/store)',
  answers.some((a) => /single-register load\/store/i.test(a[2])));

/* ---- 7. CSS ----
   The style block is parsed into real rules rather than searched as text. A
   substring search for ".readasm-rail" is satisfied by a class that was renamed
   to ".readasm-rail-unstyled", and by a rule that only ever appears inside a
   comment, so several mutations in the harness pass a naive presence check.
   Splitting on braces and keeping the selector apart from the body is what makes
   "this class is styled" mean the class is styled. */
section('CSS');
const rules = (() => {
  const at = head.indexOf('<style>');
  const end = head.indexOf('</style>');
  const css = head.slice(at < 0 ? 0 : at, end < 0 ? head.length : end);
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    /* Only the final line of the captured prefix is the selector; a comment or a
       declaration line above it is not. */
    const sel = m[1].split('\n').pop().trim();
    out.push({ sel: sel, body: m[2], classes: (sel.match(/\.[A-Za-z][\w-]*/g) || []).map((c) => c.slice(1)) });
  }
  return out;
})();
check('the style block parsed into rules', rules.length > 100, rules.length + ' rules');

const classes = ['readasm-hist', 'readasm-histrow', 'readasm-kinds', 'readasm-kind', 'readasm-rail',
  'readasm-detail', 'readasm-src', 'readasm-fields', 'readasm-t2', 'readasm-count',
  'readasm-histbar', 'readasm-histlabel', 'readasm-ran', 'readasm-ranote', 'readasm-why',
  'readasm-expands', 'readasm-pieces', 'readasm-t2item'];
/* A rule that targets the class on its own, not one that reaches it as a
   descendant. ".readasm-rail button" is a child rule; if the base rule is gone
   the rail is unstyled and every child rule still applies, so a check that only
   asks "does any rule mention this class" passes on a panel with no layout. */
function ownsClass(rule, c) {
  return rule.sel.split(',').map((s) => s.trim()).indexOf('.' + c) >= 0;
}
classes.forEach((c) => {
  const base = rules.filter((r) => ownsClass(r, c));
  const filled = base.filter((r) => r.body.trim().length > 0);
  check('.' + c + ' has a base rule that declares something', filled.length > 0,
    'the class appears only inside compound selectors (' +
    rules.filter((r) => r.classes.indexOf(c) >= 0).map((r) => r.sel).join(' | ') +
    '), so it has no styling of its own');
});

/* The bar must be sized by the inline width the body writes, and that width must
   be a percentage of the whole file. A zero-height track, or a body that never
   writes a width, leaves the histogram as a row of numbers and a decorative box. */
/* "has a height" is not "has a usable height": a zero-height track satisfies
   /height:\d/ and renders as nothing at all, so the value is compared. */
const barRules = rules.filter((r) => ownsClass(r, 'readasm-histbar'));
const trackHeights = barRules.map((r) => (/height:\s*(\d+)px/.exec(r.body) || [])[1]).filter(Boolean).map(Number);
check('the histogram track is tall enough to see',
  trackHeights.some((h) => h >= 6),
  'heights found: ' + JSON.stringify(trackHeights) + ' in ' + barRules.map((r) => r.sel).join(' | '));
/* The fill's width is written inline per row, so what the style block has to
   supply is the shape: a block-level child that fills the track. A rule that set
   a fixed width, or a track with overflow visible, would defeat the inline
   width - which is the only thing making the bars comparable. */
const fillRules = rules.filter((r) => /\.readasm-histbar\s+i(\s|$|\.)/.test(r.sel));
check('the fill is a block that fills its track, so the inline width is what shows',
  fillRules.some((r) => /display:\s*block/.test(r.body) && /height:\s*100%/.test(r.body)),
  fillRules.map((r) => r.sel + ' {' + r.body.trim() + '}').join(' | ') ||
  'no ".readasm-histbar i" rule found');
check('the track clips its fill rather than letting it spill out',
  barRules.some((r) => /overflow:\s*hidden/.test(r.body)),
  barRules.map((r) => r.sel + ' {' + r.body.trim() + '}').join(' | '));
check('the body writes the width inline, per row', /style="width:'/.test(readasmBody));
/* Note the closing quote: the emitted HTML is style="width:...%", and the "%"
   is followed by a double quote, not a single one. Pinning the whole expression
   is deliberate - "some width is written" would pass on a hardcoded 100%. */
check('the width the body writes is the share of the whole file, as a percentage',
  /style="width:'\s*\+\s*\n?\s*Math\.round\(\(ASM_HIST\[k\] \/ total\) \* 100\)\s*\+\s*'%"/.test(readasmBody),
  'the bar has to be proportional to the count or the comparison it invites is a lie');
check('the total is the line count of the embedded file, not a constant',
  /var total = STARTUP_S_LINES\.length/.test(readasmBody));

/* Every var() referenced by the stage's own rules must be declared somewhere in
   the same style block. Checked over parsed rules rather than a window of text,
   so a neighbouring rule's var() cannot stand in for a missing declaration. */
const declaredProps = new Set((head.match(/--[a-z0-9-]+\s*:/g) || []).map((s) => s.replace(/\s*:/, '')));
const stageRules = rules.filter((r) => r.classes.some((c) => classes.indexOf(c) >= 0));
const stageVars = [...new Set(stageRules.map((r) => (r.body.match(/var\(--[a-z0-9-]+\)/g) || []).join(' '))
  .join(' ').match(/var\(--[a-z0-9-]+\)/g) || [])];
const undeclared = stageVars.filter((v) => !declaredProps.has(v.slice(4, -1)));
check('no undefined custom property is used by the stage',
  undeclared.length === 0,
  'undefined: ' + (undeclared.join(' ') || 'none') +
  ' - a var with no declaration renders as an empty value, which reads as "unimportant"');
check('and the stage does use custom properties, so the check above is not vacuous',
  stageVars.length >= 8, stageVars.length + ' distinct properties across ' + stageRules.length + ' rules');
check('the detail panel has a min-height so it does not jump when a line is picked',
  stageRules.some((r) => r.classes.indexOf('readasm-detail') >= 0 && /min-height:\s*\d/.test(r.body)));
check('the source quote is set in the mono face, not the prose face',
  stageRules.some((r) => r.classes.indexOf('readasm-src') >= 0 && /var\(--mono\)/.test(r.body)));
check('the count is emphasised, since it is the number the stage exists for',
  /^\.readasm-count strong\{[^}]*color:\s*var\(--accent\)/m.test(head));
/* nth-child lives in the selector, not the body, so this one has to look at the
   selector text - and specifically at the rule that targets the fields table. */
/* Each of these pairs a class with the one declaration it exists to make, so
   "the rule is present" cannot be satisfied by a rule that no longer does the
   job. Renaming a selector, or neutering the property that carries the layout,
   breaks exactly one of these. */
const purpose = [
  ['readasm-rail', /display:\s*flex/, 'the four decode buttons sit in one row'],
  ['readasm-histrow', /display:\s*grid/, 'label, bar and count line up in columns'],
  ['readasm-hist', /display:\s*grid/, 'the five histogram rows stack'],
  ['readasm-kinds', /display:\s*grid/, 'the five kind cards stack'],
  ['readasm-t2', /display:\s*grid/, 'the six Thumb-2 consequences stack'],
  ['readasm-fields', /border-collapse:\s*collapse/, 'the field table is one grid, not five loose cells'],
  ['readasm-kind', /border:\s*1px/, 'a kind card is visibly a card'],
  ['readasm-detail', /border:\s*1px/, 'the decode panel is visibly a panel'],
  ['readasm-histbar', /overflow:\s*hidden/, 'the fill is clipped to the track'],
  ['readasm-detail', /min-height:\s*\d/, 'the panel does not jump between lines'],
];
purpose.forEach(([c, re, why]) => {
  const r = rules.find((x) => ownsClass(x, c) && re.test(x.body));
  check('.' + c + ' still does the thing it is there for (' + why + ')', !!r,
    rules.filter((x) => ownsClass(x, c)).map((x) => x.sel + ' {' + x.body.trim() + '}').join(' | ') || 'no base rule');
});
check('the field-role column is visually distinct from the field tokens',
  rules.some((r) => /\.readasm-fields[^\s{]*\s*td:nth-child\(2\)/.test(r.sel) && /var\(--accent\)/.test(r.body)),
  rules.filter((r) => /nth-child/.test(r.sel)).map((r) => r.sel).join(' | '));

/* ---- 8. the copy itself is still the real file ---- */
section('the embedded file');
const realLines = startup.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
check('the embedded copy still matches src-tauri/src/examples/startup.s',
  JSON.stringify(S) === JSON.stringify(realLines),
  'embedded ' + S.length + ' lines, real ' + realLines.length);
check('and the file still declares .thumb, which is what the stage explains',
  /^\s*\.thumb\b/m.test(startup),
  'the whole stage hangs on this line existing; if startup.s drops .thumb the ' +
  '"Reading a .s" copy is no longer pinned to a real line');

console.log('');
if (failures) {
  console.log(failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('read-asm green (classifier, histogram, decodes, Thumb-2, grading)');
