/* Model spec for the Linker & Startup sandbox (22_lab_linker.js).
 *
 * Zero dependencies. Run with:  node specs/linker_sandbox.spec.js
 *
 * The sandbox is where a learner is invited to break the firmware on purpose, so
 * its accounting has to be exactly right — a wrong flash/RAM total or a missing
 * diagnostic teaches the opposite of the lesson. The model is pure, so it slices
 * out of the fragment cleanly; only `rd`/`wr` (storage) and `esc` (for the script
 * text) are stubbed.
 *
 * The last section is a drift guard: it recomputes from the constants the numbers
 * that the generated linker script prints as literals, so editing the memory map
 * cannot leave the script (or the prose around it) claiming the old one.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '22_lab_linker.js'), 'utf8');
const from = src.indexOf('var FLASH_SIZE = 1048576');
const to = src.indexOf('function lksAddrText');   /* slice ends after lksandScript */
if (from < 0 || to < 0 || to < from) { throw new Error('sandbox markers not found in 22_lab_linker.js'); }

/* `stored` stands in for localStorage: rd() returns whatever a test wants. */
let stored = null;
const ctx = vm.createContext({
  rd: () => stored,
  wr: () => {},
  esc: (s) => String(s),
});
vm.runInContext(src.slice(from, to) +
  '\nthis.compute=lksandCompute; this.defaults=lksandDefault; this.load=lksandLoad;' +
  '\nthis.fmt=lksfmt; this.hex=lkshex; this.script=lksandScript;', ctx);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('pass  ' + name); return; }
  failures++;
  console.log('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
}
const diagFor = (res, sec) => res.diag.filter((d) => d.sec === sec);
const errFor = (res, sec) => diagFor(res, sec).filter((d) => d.sev === 'error').length;

function fresh() { return ctx.defaults(); }
function withVma(id, region) { const s = fresh(); s.sections.filter((x) => x.id === id)[0].vma = region; return s; }
function withSize(id, size) { const s = fresh(); s.sections.filter((x) => x.id === id)[0].size = size; return s; }

/* ---- 1. the healthy default ---- */
const base = ctx.compute(fresh());
check('the default layout is healthy', base.errors === 0 && base.warns === 0,
  JSON.stringify(base.diag.filter((d) => d.sev !== 'ok')));
check('default flash total is the sum of the loaded sections (bss excluded)',
  base.flashUsed === 256 + 245760 + 4096 + 1024, String(base.flashUsed));
check('default RAM total is the RAM sections plus the reserves',
  base.ramUsed === 1024 + 8192 + 8192 + 4096, String(base.ramUsed));

/* ---- 2. .bss is NOLOAD: it costs RAM but never flash ---- */
const bigBss = ctx.compute(withSize('.bss', 60000));
check('.bss does not add flash bytes', bigBss.flashUsed === base.flashUsed, base.flashUsed + ' -> ' + bigBss.flashUsed);
check('.bss does add RAM bytes', bigBss.ramUsed === base.ramUsed + (60000 - 8192), String(bigBss.ramUsed));

/* ---- 3. the stack/heap reserves live in RAM only ---- */
const bigReserve = fresh(); bigReserve.stack = 100000;
const bigRes = ctx.compute(bigReserve);
check('stack reserve does not add flash bytes', bigRes.flashUsed === base.flashUsed, String(bigRes.flashUsed));
check('stack reserve does add RAM bytes', bigRes.ramUsed === base.ramUsed + (100000 - 8192), String(bigRes.ramUsed));

/* ---- 4. every deliberate misplacement gets its own error ---- */
const cases = [
  ['dataflash', '.data', 'FLASH'],
  ['bssflash', '.bss', 'FLASH'],
  ['vecram', '.isr_vector', 'RAM'],
  ['textram', '.text', 'RAM'],
  ['rodataram', '.rodata', 'RAM'],
];
for (const [name, id, region] of cases) {
  const res = ctx.compute(withVma(id, region));
  check(name + ': moving ' + id + ' to ' + region + ' is an error', errFor(res, id) >= 1, JSON.stringify(res.diag));
}
check('.data in RAM while its LMA is flash is fine', errFor(ctx.compute(fresh()), '.data') === 0);

/* ---- 5. a tiny vector table is a warning, not an error ---- */
const smallVec = ctx.compute(withSize('.isr_vector', 8));
check('an undersized vector table warns', smallVec.warns >= 1 && errFor(smallVec, '.isr_vector') === 0, JSON.stringify(smallVec.diag));

/* ---- 6. region overflow ---- */
const flashOver = ctx.compute(withSize('.text', ctx.FLASH_SIZE));
check('a flash overflow is reported', flashOver.errors >= 1 &&
  flashOver.diag.some((d) => d.sec === 'layout' && /FLASH region overflowed/.test(d.msg)), JSON.stringify(flashOver.diag));
const ramOver = ctx.compute(withSize('.bss', ctx.RAM_SIZE));
check('a RAM overflow is reported', ramOver.errors >= 1 &&
  ramOver.diag.some((d) => d.sec === 'layout' && /RAM region overflowed/.test(d.msg)), JSON.stringify(ramOver.diag));

/* ---- 7. the loader clamps anything a stored file could contain ---- */
stored = { stack: -5, heap: 'not a number', sections: [
  { size: -100, vma: 'BOGUS' }, { size: 1e12, vma: 'RAM' }, { size: 0, vma: 'FLASH' }, { size: 1, vma: 'RAM' }, { size: 1, vma: 'FLASH' },
] };
const loaded = ctx.load();
check('a negative size is clamped to zero', loaded.sections[0].size === 0, String(loaded.sections[0].size));
check('an unknown region is ignored', loaded.sections[0].vma === 'FLASH', loaded.sections[0].vma);
check('an absurd size is clamped to the model maximum', loaded.sections[1].size === ctx.LKS_MAX, String(loaded.sections[1].size));
check('a non-numeric reserve becomes zero', loaded.stack === 0, String(loaded.stack));
check('a value that is not a number is zeroed', loaded.heap === 0, String(loaded.heap));
stored = { sections: [{ size: 1 }] };
check('a wrong section count falls back to the defaults', ctx.load().sections.length === 5, JSON.stringify(ctx.load().sections.length));
stored = null;

/* ---- 8. formatting ---- */
check('bytes format as B / KiB / MiB', ctx.fmt(512) === '512 B' && ctx.fmt(1024) === '1 KiB' && ctx.fmt(1048576) === '1 MiB',
  [ctx.fmt(512), ctx.fmt(1024), ctx.fmt(1048576)].join(' | '));

/* ---- 9. drift guard: the script the sandbox prints must match the constants ---- */
const script = ctx.script(fresh(), ctx.compute(fresh()));
const estack = ctx.hex(ctx.RAM_ORIGIN + ctx.RAM_SIZE);
check('the generated script\'s _estack matches ORIGIN(RAM)+LENGTH(RAM)',
  script.indexOf('= ' + estack) !== -1, script.split('\n').filter((l) => /_estack/.test(l)).join(' | ') + ' expected ' + estack);
check('the generated FLASH length matches FLASH_SIZE',
  script.indexOf((ctx.FLASH_SIZE / 1048576) + 'M') !== -1, script.split('\n').filter((l) => /FLASH/.test(l)).join(' | '));
check('the generated RAM length matches RAM_SIZE',
  script.indexOf((ctx.RAM_SIZE / 1024) + 'K') !== -1, script.split('\n').filter((l) => /RAM/.test(l)).join(' | '));
check('the script keeps .bss NOLOAD', /\.bss \(NOLOAD\)/.test(script), script);
check('a .data in RAM is emitted with AT > FLASH', /\.data[\s\S]*> RAM AT > FLASH/.test(script), script);
const dataFlash = ctx.script(withVma('.data', 'FLASH'), ctx.compute(withVma('.data', 'FLASH')));
check('a .data in FLASH drops the AT > FLASH load address', !/AT > FLASH/.test(dataFlash), dataFlash);

if (failures) {
  console.log('\n' + failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nlinker sandbox model green (accounting, diagnostics, overflow, drift)');
