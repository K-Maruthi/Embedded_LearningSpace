/* Behaviour spec for the three shared helpers in 20_app.js that other parts of the
 * app lean on and that were each fixed in this pass:
 *
 *   hl()      the code highlighter — it used to treat `#` to end-of-line as a
 *             comment for every language, so `#include` and, worse, every ARM
 *             `#immediate` in real disassembly was dimmed, and strings were not
 *             recognised at all (no `.s` token, though the stylesheet had one).
 *   shuffle() the random ordering for mock rounds and fault triage — it was a
 *             `sort()` with a random comparator, which is biased and untestable.
 *   esc()     the escaping those depend on.
 *
 * Zero dependencies. Run with:  node specs/helpers.spec.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '20_app.js'), 'utf8');

const escFrom = app.indexOf('function esc(s)');
const escTo = app.indexOf('function el(tag, cls, html)');
const hlFrom = app.indexOf('var HL_C_KEYWORDS');
const hlTo = app.indexOf('function copy(text, btn)');
const shFrom = app.indexOf('function shuffle(list, seed)');
const shTo = app.indexOf('/* ---------------- notices');
if ([escFrom, escTo, hlFrom, hlTo, shFrom, shTo].indexOf(-1) !== -1 || escTo < escFrom || hlTo < hlFrom || shTo < shFrom) {
  throw new Error('could not find the esc/hl/shuffle markers in 20_app.js');
}
const ctx = vm.createContext({});
vm.runInContext(
  app.slice(escFrom, escTo) + '\n' + app.slice(hlFrom, hlTo) + '\n' + app.slice(shFrom, shTo) +
  '\nthis.hl = hl; this.hlModeFor = hlModeFor; this.shuffle = shuffle; this.esc = esc;',
  ctx
);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('pass  ' + name); return; }
  failures++;
  console.log('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
}

/* ---- esc ---- */
check('esc escapes & < >', ctx.esc('a & b < c > d') === 'a &amp; b &lt; c &gt; d');

/* ---- hl(): mode selection ---- */
check('main.s highlights as assembly', ctx.hlModeFor('main.s') === 'asm', ctx.hlModeFor('main.s'));
check('firmware.map highlights as linker/map text', ctx.hlModeFor('firmware.map (excerpt)') === 'ld', ctx.hlModeFor('firmware.map (excerpt)'));
check('main.c highlights as C', ctx.hlModeFor('main.c') === 'c');
check('preprocessed main.i highlights as C', ctx.hlModeFor('main.i (tail — the part this example cares about)') === 'c');

/* ---- hl(): C mode ---- */
const c = ctx.hl('int x = 5; // note');
check('C keyword is .k', c.indexOf('<span class="k">int</span>') !== -1, c);
check('C number is .n', c.indexOf('<span class="n">5</span>') !== -1, c);
check('C // comment is .c', c.indexOf('<span class="c">// note</span>') !== -1, c);

const inc = ctx.hl('#include <stdint.h>\nint x;');
check('#include is a directive .p, not a comment',
  inc.indexOf('<span class="p">#include &lt;stdint.h&gt;</span>') !== -1, inc);
check('#include does not emit a .c comment span', inc.indexOf('class="c"') === -1, inc);
check('a real C keyword after a directive still highlights',
  inc.indexOf('<span class="k">int</span>') !== -1, inc);

const str = ctx.hl('char *s = "int x";');
check('a string literal is .s', str.indexOf('<span class="s">"int x"</span>') !== -1, str);
check('a keyword inside a string is not re-highlighted',
  (str.match(/class="k"/g) || []).length === 1, str);

const onlyComment = ctx.hl('// int x = 5;');
check('a keyword inside a comment is not re-highlighted',
  onlyComment.indexOf('class="k"') === -1 && onlyComment.indexOf('class="n"') === -1, onlyComment);

/* ---- hl(): assembly mode ---- */
const asm = ctx.hl('movs r0, #10   @ load immediate', 'asm');
check('assembly @ comment is .c', asm.indexOf('<span class="c">@ load immediate</span>') !== -1, asm);
check('assembly register is .k', asm.indexOf('<span class="k">r0</span>') !== -1, asm);
check('an ARM #immediate is a number, not a comment',
  asm.indexOf('#<span class="n">10</span>') !== -1, asm);
check('no part of the instruction is claimed as a comment before the @',
  asm.indexOf('<span class="c">#10') === -1, asm);
const dir = ctx.hl('.text\n.global main', 'asm');
check('an assembly directive is .p', dir.indexOf('<span class="p">.text</span>') !== -1, dir);

/* ---- hl(): ld mode ---- */
const ld = ctx.hl('/* memory */ FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 1M', 'ld');
check('a linker-script block comment is .c', ld.indexOf('<span class="c">/* memory */</span>') !== -1, ld);
check('a linker-script address is .n', ld.indexOf('<span class="n">0x08000000</span>') !== -1, ld);

/* ---- hl() escapes its input ---- */
const hostile = ctx.hl('<script>alert(1)</script>');
check('hl escapes markup it is handed', hostile.indexOf('&lt;script&gt;') !== -1 && hostile.indexOf('<script>') === -1, hostile);

/* ---- shuffle() ---- */
const base = Array.from({ length: 10 }, (_, i) => i);
const once = ctx.shuffle(base);
check('shuffle returns a permutation', JSON.stringify(once.slice().sort((a, b) => a - b)) === JSON.stringify(base), JSON.stringify(once));
check('shuffle does not mutate its input', JSON.stringify(base) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
check('shuffle keeps the length', once.length === base.length);

const seedA = JSON.stringify(ctx.shuffle(base, 42));
const seedB = JSON.stringify(ctx.shuffle(base, 42));
check('shuffle is reproducible for a given seed', seedA === seedB, seedA + ' vs ' + seedB);
check('different seeds give a different order', seedA !== JSON.stringify(ctx.shuffle(base, 43)));

/* Uniformity, the property the old random-comparator sort did not have: over many
   seeds every element should reach the first position, and no element should
   monopolise it. A biased shuffle puts the original ends first far too often. */
const firstCounts = new Array(base.length).fill(0);
const RUNS = 400;
for (let s = 1; s <= RUNS; s++) { firstCounts[ctx.shuffle(base, s)[0]]++; }
check('every element can land first', firstCounts.every((n) => n > 0), JSON.stringify(firstCounts));
check('no element dominates the first position',
  Math.max.apply(null, firstCounts) < RUNS * 0.3, JSON.stringify(firstCounts));

if (failures) {
  console.log('\n' + failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nhelper behaviour green (hl modes, escapes, shuffle)');
