/* Register-semantics spec for the Peripherals lab (23_lab_periph.js).
 *
 * Zero dependencies. Run with:  node specs/periph_regs.spec.js
 *
 * This pins the accuracy pass for problems.md P15–P17:
 *
 *   P15  ISER0 used to be toggled like a plain RW register, so clicking a set
 *        bit wrote a full-register value containing 0s and — in the model —
 *        cleared it, while the emitted C already said ICER. Real ARMv7-M
 *        set/clear pairs are ISER = write-1-to-SET (0 bits ignored) and
 *        ICER = write-1-to-CLEAR (write-only, reads 0). The model now behaves
 *        like the chip, and the click handler routes a clear through ICER.
 *   P16  PUPDR existed in the model and in prose but had no UI at all, so the
 *        floating-pad lesson could be described but never performed. It is now
 *        a register card whose clicks cycle a pin's whole 2-bit field (a
 *        single-bit toggle could create 11, which is reserved on silicon).
 *   P17  BSRR was described in prose and used by the stage-8 race fix but was
 *        absent from the bank; now it is a write-only card (reads 0) whose
 *        halves set/reset. CCR is a real row in the timer card instead of a
 *        slider floating outside the bank. And no bit is called "reserved in
 *        this model" any more — a bit with no behaviour here says exactly that.
 *
 * Same headless trick as periph_tape.spec.js: the model slice is evaluated in a
 * vm with rd/wr stubbed; the card renderers only need esc(). Every stage body is
 * then rendered and read, because a hole in a template is silent in the app.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '23_lab_periph.js'), 'utf8');
const from = src.indexOf('var K_PERIPH');
const to = src.indexOf('function pfRenderStatic');   /* renderers, minus the DOM entry points */
if (from < 0 || to < 0 || to < from) { throw new Error('periph slice markers not found in 23_lab_periph.js'); }

const ctx = vm.createContext({
  rd: () => null,
  wr: () => {},
  /* esc() is the only thing the renderers borrow from 20_app.js; the user-code
     panel is the one model path that touches the DOM (it redraws after every
     click), and it bails out on a missing host, so a null getElementById is enough. */
  esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  document: { getElementById: () => null }
});
vm.runInContext(src.slice(from, to) + `
this.periph = periph;
this.reset = function () { periph = pfDefaults(); };
this.write = pfWriteReg;
this.read = pfReadReg;
this.cycle = pfCyclePull;
this.toggle = pfCodeForBitToggle;
this.pull = pfPull;
this.pname = pfPnameForReg;
this.reqs = pfIrqReqs;
this.idr = pfIdrRefresh;
this.stageBody = pfStageBody;
this.body = pfBody;
this.stageNav = pfStageNav;
this.goals = PF_GOALS;
this.stageMeta = PF_STAGE_META;
this.nvicMask = PF_NVIC_IRQ_MASK;
this.irq2 = PF_TIM2_IRQ_BIT;
this.irq3 = PF_TIM3_IRQ_BIT;
`, ctx);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('pass  ' + name); return; }
  failures++;
  console.log('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
}
const bit = (v, i) => ((v >>> i) & 1) === 1;

/* ---- P15: ISER sets, ICER clears, 0s do nothing ---- */
ctx.reset();
check('reset leaves every NVIC line masked', ctx.periph.nvic.ISER0 === 0);
ctx.write('NVIC', 'ISER0', 1 << ctx.irq2);
check('ISER write-1-to-set turns the TIM2 line on', bit(ctx.periph.nvic.ISER0, ctx.irq2));
ctx.write('NVIC', 'ISER0', 1 << ctx.irq3);
check('setting a second line leaves the first one alone',
  bit(ctx.periph.nvic.ISER0, ctx.irq2) && bit(ctx.periph.nvic.ISER0, ctx.irq3));
ctx.write('NVIC', 'ISER0', 0);
check('writing 0 to ISER cannot clear a line (the old toggle bug)',
  bit(ctx.periph.nvic.ISER0, ctx.irq2) && bit(ctx.periph.nvic.ISER0, ctx.irq3),
  'ISER0 = 0x' + ctx.periph.nvic.ISER0.toString(16));
ctx.write('NVIC', 'ISER0', 1 << 5);
check('an IRQ line this lab does not model cannot be enabled',
  !bit(ctx.periph.nvic.ISER0, 5) && ctx.periph.nvic.ISER0 === ctx.nvicMask,
  'ISER0 = 0x' + ctx.periph.nvic.ISER0.toString(16));
check('…and the unmodelled lines are said out loud in the log',
  ctx.periph.log.some((e) => e.k === 'note' && /does not model/.test(e.m)),
  ctx.periph.log.slice(-3).map((e) => e.m).join(' | '));
ctx.write('NVIC', 'ICER0', 1 << ctx.irq3);
check('ICER write-1-to-clear masks exactly that line',
  bit(ctx.periph.nvic.ISER0, ctx.irq2) && !bit(ctx.periph.nvic.ISER0, ctx.irq3));
ctx.write('NVIC', 'ICER0', 0);
check('writing 0 to ICER changes nothing', bit(ctx.periph.nvic.ISER0, ctx.irq2));
check('ICER reads back as 0 — it is write-only', ctx.read('NVIC', 'ICER0') === 0);
check('ISER reads back live state — it is not write-only', ctx.read('NVIC', 'ISER0') === (1 << ctx.irq2));

/* the semantics only matter if they feed dispatch, not just the grid */
ctx.reset();
ctx.periph.tim2.DIER = 1;
ctx.periph.tim2.SR = 1;
ctx.write('NVIC', 'ISER0', 1 << ctx.irq2);
check('an unmasked line turns the timer flag into a visible request',
  ctx.reqs().some((r) => r.n === 'TIM2'));
ctx.write('NVIC', 'ICER0', 1 << ctx.irq2);
check('masking through ICER withdraws the request', !ctx.reqs().some((r) => r.n === 'TIM2'));
ctx.write('NVIC', 'ISER0', 1 << ctx.irq2);
ctx.write('NVIC', 'ISER0', 0);
check('a later ISER write of 0 leaves the request active', ctx.reqs().some((r) => r.n === 'TIM2'));

/* ---- P17a: BSRR, the atomic set/reset register ---- */
ctx.reset();
ctx.write('RCC', 'AHB1ENR', 1);
ctx.periph.gpioa.ODR = 0x0001;
ctx.write('GPIOA', 'BSRR', 1 << 5);
check('the low half of BSRR sets its ODR bit', ctx.periph.gpioa.ODR === 0x0021,
  '0x' + ctx.periph.gpioa.ODR.toString(16));
ctx.write('GPIOA', 'BSRR', (1 << 16) | (1 << 5));
check('the high half resets its ODR bit', ctx.periph.gpioa.ODR === 0x0020,
  '0x' + ctx.periph.gpioa.ODR.toString(16));
ctx.write('GPIOA', 'BSRR', (1 << 6) | (1 << (16 + 5)));
check('both halves in one word apply set and reset together', ctx.periph.gpioa.ODR === 0x0040,
  '0x' + ctx.periph.gpioa.ODR.toString(16));
ctx.write('GPIOA', 'BSRR', 1 << (16 + 6));
check('the reset half clears what the set half wrote', ctx.periph.gpioa.ODR === 0);
check('BSRR reads back 0 — write-only, nothing to display', ctx.read('GPIOA', 'BSRR') === 0);
ctx.reset();
ctx.periph.gpioa.ODR = 0;
check('BSRR is dropped like every other register when the port is unclocked',
  ctx.write('GPIOA', 'BSRR', 1 << 5) === false && ctx.periph.gpioa.ODR === 0);

/* ---- P16: PUPDR, reachable and field-safe ---- */
ctx.reset();
ctx.write('RCC', 'AHB1ENR', 1);
check('PA5 starts with no pull', ctx.pull(5) === 0);
const seen = [];
for (let i = 0; i < 4; i++) { ctx.cycle(5); seen.push((ctx.periph.gpioa.PUPDR >>> 10) & 3); }
check('four clicks traverse NONE → UP → DOWN → NONE', seen.join() === '1,2,0,1', seen.join());
check('the reserved 11 pattern never appears', seen.every((v) => v !== 3), seen.join());
const pullCode = ctx.periph.userCode.map((e) => e.t).filter((t) => /PUPDR/.test(t));
check('each cycle records the two RMW statements as canonical C',
  pullCode.some((t) => /GPIOA->PUPDR &= ~\(3u << \(5\*2\)\);/.test(t)) &&
  pullCode.some((t) => /GPIOA->PUPDR \|=  \(1u << \(5\*2\)\);/.test(t)),
  pullCode.slice(-2).join(' | '));
check('the emitted pair names the pin and both pull states',
  /PA5: pull NONE/.test(pullCode[pullCode.length - 2] || '') &&
  /→ pull UP/.test(pullCode[pullCode.length - 1] || ''),
  pullCode.slice(-2).join(' | '));
ctx.reset();
check('a pull click with GPIOA unclocked is dropped, not applied',
  ctx.cycle(5) === null && ctx.periph.gpioa.PUPDR === 0);
ctx.write('RCC', 'AHB1ENR', 1);
ctx.cycle(0);          /* PA0: NONE → UP */
ctx.idr();
check('PA0 as an input with pull-UP reads 1 in IDR', bit(ctx.periph.gpioa.IDR, 0));
ctx.cycle(0);          /* PA0: UP → DOWN */
ctx.idr();
check('pull-DOWN snaps the same pad to 0', !bit(ctx.periph.gpioa.IDR, 0));

/* ---- P17b: CCR is a register, not a floating slider ---- */
ctx.reset();
ctx.write('RCC', 'APB1ENR', 1);
ctx.write('TIM2', 'CCR', 1234);
check('CCR is a writable compare register', ctx.read('TIM2', 'CCR') === 1234);
ctx.write('TIM2', 'CCR', 0x1FFFF);
check('CCR keeps its 16-bit width', ctx.read('TIM2', 'CCR') === 0xFFFF);
check('the timer card renders a CCR row', ctx.stageBody(5).indexOf('<span class="nm">CCR</span>') >= 0);

/* ---- the emitted C matches the model behaviour ---- */
check('setting a line emits ISER with the vendor IRQ name',
  (ctx.toggle('NVIC', 'ISER0', 28, true) || '').indexOf('NVIC->ISER[0] = (1u << TIM2_IRQn);') === 0 &&
  /unmask/.test(ctx.toggle('NVIC', 'ISER0', 28, true)));
check('clearing a line emits ICER — never a plain ISER assignment',
  (ctx.toggle('NVIC', 'ICER0', 28, false) || '').indexOf('NVIC->ICER[0] = (1u << TIM2_IRQn);') === 0 &&
  /mask/.test(ctx.toggle('NVIC', 'ICER0', 28, false)));
check('a BSRR set click emits the atomic BS macro with no read-modify-write',
  /GPIOA->BSRR = GPIO_BSRR_BS5;/.test(ctx.toggle('GPIOA', 'BSRR', 5, true)) &&
  ctx.toggle('GPIOA', 'BSRR', 5, true).indexOf('&=') < 0 && ctx.toggle('GPIOA', 'BSRR', 5, true).indexOf('|=') < 0);
check('a BSRR reset click emits the atomic BR macro',
  /GPIOA->BSRR = GPIO_BSRR_BR5;/.test(ctx.toggle('GPIOA', 'BSRR', 21, false)));
check('every register row resolves to its peripheral through one helper',
  ctx.pname('ISER0') === 'NVIC' && ctx.pname('ICER0') === 'NVIC' &&
  ctx.pname('PUPDR') === 'GPIOA' && ctx.pname('BSRR') === 'GPIOA' &&
  ctx.pname('CCR') === 'TIM2' && ctx.pname('AHB1ENR') === 'RCC');

/* ---- every stage renders, whole, with no template hole ---- */
const ids = ctx.stageMeta.map((s) => s.id);
check('ten stages are declared, each with a unique id', ids.length === 10 && new Set(ids).size === 10, ids.join());
ids.forEach((n) => {
  let html = null, err = null;
  try { html = ctx.stageBody(n); } catch (e) { err = String(e && e.stack ? e.stack.split('\n')[0] : e); }
  check('stage ' + n + ' renders', html !== null, err || '');
  if (html === null) { return; }
  check('stage ' + n + ' builds a full stage, not a fragment', html.length > 900, 'length ' + html.length);
  check('stage ' + n + ' leaks no undefined or NaN into the page',
    html.indexOf('undefined') < 0 && html.indexOf('NaN') < 0,
    (html.match(/.{0,40}(undefined|NaN).{0,40}/) || [])[0]);
});
check('the lab body carries the stage nav and the sim bar',
  ctx.body().indexOf('data-pfstage="1"') >= 0 && ctx.body().indexOf('pf-simclock') >= 0);

/* ---- the pass has to be reachable from the stages that teach it ---- */
check('stages 3 and 4 can reach the PUPDR controls',
  ctx.stageBody(3).indexOf('>PUPDR<') >= 0 && ctx.stageBody(4).indexOf('>PUPDR<') >= 0);
check('stage 8 carries the BSRR card next to the race rig',
  ctx.stageBody(8).indexOf('>BSRR<') >= 0 && ctx.stageBody(8).indexOf('pf-race-arm') >= 0);
check('the NVIC stages can reach both ISER0 and ICER0',
  ctx.stageBody(6).indexOf('>ISER0<') >= 0 && ctx.stageBody(6).indexOf('>ICER0<') >= 0);
check('the playground assembles the full register bank',
  ['PUPDR', 'BSRR', 'CCR', 'ICER0'].every((r) => ctx.stageBody(10).indexOf('>' + r + '<') >= 0));

/* ---- honesty rules for the bank itself ---- */
check('the NVIC card teaches the set/clear idiom, not a toggle',
  ctx.stageBody(6).indexOf('write-1-to-set') >= 0 && ctx.stageBody(6).indexOf('write-only') >= 0);
check('the BSRR card says reads return 0', ctx.stageBody(8).indexOf('reads return 0') >= 0);
check('the PUPDR card names the reserved pattern', ctx.stageBody(3).indexOf('reserved') >= 0);
check('no bit is called "reserved in this model" any more', src.indexOf('reserved in this model') < 0);
check('unwired bits are described as unwired', /not wired in this model/.test(src));
check('unwired bits are visually distinct from read-only ones', /\(dead \? ' dis' : ''\)/.test(src));

/* ---- the goals are all callable on a fresh lab ---- */
ctx.reset();
Object.keys(ctx.goals).map(Number).sort((a, b) => a - b).forEach((k) => {
  let ok = null, err = null;
  try { ok = ctx.goals[k].ok(); } catch (e) { err = String(e && e.message ? e.message : e); }
  check('the stage-' + k + ' goal verdict is callable and starts unmet', ok === false, err || 'got ' + ok);
  let hint = null;
  try { hint = ctx.goals[k].hint(); } catch (e) { err = String(e && e.message ? e.message : e); }
  check('the stage-' + k + ' goal hint is callable and non-empty',
    typeof hint === 'string' && hint.length > 0, err || '');
});

/* ---- wiring guards: the source cannot quietly regress to the old semantics ---- */
check('the ISER click redirects a clear through ICER', /reg === 'ISER0' && was \? 'ICER0' : reg/.test(src));
check('ISER writes are masked to the modelled lines',
  /\(periph\.nvic\.ISER0 \| value\) & PF_NVIC_IRQ_MASK/.test(src));
check('ICER writes clear only inside the modelled lines',
  /\(periph\.nvic\.ISER0 & ~value\) & PF_NVIC_IRQ_MASK/.test(src));
check('the BSRR card is write-only in the register bank', /pfReg\('BSRR', '0x4002_0018', 'WO'/.test(src));
check('PUPDR clicks cycle a whole field, never a single bit',
  /pfCyclePull\(bit >> 1\)/.test(src) && !/next = \(cur \^ mask\)[\s\S]{0,80}PUPDR/.test(src));
check('the click handler and the live refresh share the peripheral resolver',
  (src.match(/\|\| pfPnameForReg\(reg\)/g) || []).length >= 2,
  String((src.match(/\|\| pfPnameForReg\(reg\)/g) || []).length));

if (failures) {
  console.log('\n' + failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nperipheral register semantics green (ISER/ICER, BSRR, PUPDR cycle, CCR, stage renders, goal callability)');
