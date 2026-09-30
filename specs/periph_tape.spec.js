/* Behaviour-tape spec for the Peripherals lab (23_lab_periph.js).
 *
 * Zero dependencies. Run with:  node specs/periph_tape.spec.js
 *
 * Stage 9 used to be graded on a register snapshot plus `periph.fired.TIM2 >= 4` — a
 * counter that says "the handler ran at some point", not "the handler is running". The
 * interesting failure on real silicon is exactly the one a counter cannot see: the ISR
 * fires a few times and then stops (a masked line, a cleared CEN, a flag never cleared)
 * while every register still reads correct.
 *
 * The fix is a bounded event tape and predicates over it. Two claims are graded
 * separately and this spec pins the difference:
 *
 *   cadence   the handler ran at least N times on a steady period
 *   freshness the newest entry is recent — i.e. it is STILL running
 *
 * First half: the predicates, over scripted tapes (pure, no DOM). Second half: the real
 * model, driven through pfTick() — bring TIM2 up for 2 Hz and the tape the goal grades
 * must be accepted, with its measured cadence equal to 1000 / pfUpdateRateHz(). Then
 * mask the IRQ and the same tape must start failing while its cadence stats stay green.
 * Third: drift guards, so the writer call sites, the goal, the checklist and the card
 * cannot be edited out from under the predicate.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '23_lab_periph.js'), 'utf8');
const from = src.indexOf('var K_PERIPH');
const to = src.indexOf('function pfLed');   /* everything up to the rendering section */
if (from < 0 || to < 0 || to < from) { throw new Error('periph slice markers not found in 23_lab_periph.js'); }

/* pfSave()/pfLoadState() reach for the app's localStorage helpers, which live in
 * 20_app.js; the model only needs them to exist. pfTick() redraws the DOM, so the
 * renderer is stubbed out too — this spec grades the model, not the paint. */
const ctx = vm.createContext({ rd: () => null, wr: () => {}, pfRenderLive: () => {}, pfRenderUserCode: () => {} });
vm.runInContext(src.slice(from, to) + `
this.periph = periph;
this.defaults = pfDefaults;
this.tick = pfTick;
this.write = pfWriteReg;
this.rate = pfUpdateRateHz;
this.entries = pfTapeEntries;
this.gaps = pfTapeGaps;
this.cadence = pfTapeCadence;
this.steady = pfTapeSteady;
this.age = pfTapeAge;
this.verdict = pfTapeVerdict;
this.stillRunning = pfTapeStillRunning;
this.max = PF_TAPE_MAX;
this.minEntries = PF_GOAL9_MIN_ENTRIES;
this.tol = PF_TAPE_TOL;
this.stale = PF_TAPE_STALE_MS;
this.tickMs = PF_TICK_MS;
`, ctx);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('pass  ' + name); return; }
  failures++;
  console.log('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
}

/* ---- scripted tapes: the predicates on their own ---- */
const ev = (k, d, t) => ({ t, k, d });
const enters = (name, times) => times.map((t) => ev('enter', name, t));

const stable = enters('TIM2', [0, 500, 1000, 1500]);
check('four entries half a second apart are steady', ctx.steady(stable, 'TIM2', 4) === true);
const c = ctx.cadence(stable, 'TIM2');
check('the cadence reports n, its window, median and both extremes',
  c.n === 4 && c.window === 4 && c.gaps === 3 && c.median === 500 && c.min === 500 && c.max === 500 && c.steady === true,
  JSON.stringify(c));
check('an old anomaly ages out of the recency window', (() => {
  const aged = enters('TIM2', [0, 500, 1000, 1500]).concat(enters('TIM2', [5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000]));
  const cc = ctx.cadence(aged, 'TIM2');
  return ctx.steady(aged, 'TIM2', 4) === true && cc.n === 12 && cc.window === 8 && cc.gaps === 7;
})(), 'a 4 s stall followed by eight regular entries must read as steady again');
check('too few entries fail the minimum, however regular',
  ctx.steady(enters('TIM2', [0, 500, 1000]), 'TIM2', 4) === false &&
  ctx.cadence(enters('TIM2', [0, 500, 1000]), 'TIM2').n === 3);
check('an outlier gap fails the cadence', ctx.steady(enters('TIM2', [0, 500, 1000, 2200]), 'TIM2', 4) === false,
  JSON.stringify(ctx.cadence(enters('TIM2', [0, 500, 1000, 2200]), 'TIM2')));
check('a gap inside the tolerance band still passes',
  ctx.steady(enters('TIM2', [0, 500, 1000, 1600]), 'TIM2', 4) === true,
  JSON.stringify(ctx.cadence(enters('TIM2', [0, 500, 1000, 1600]), 'TIM2')));
check('entries inside a single sim frame are a burst, not a cadence',
  ctx.steady(enters('TIM2', [0, 50, 100, 150]), 'TIM2', 4) === false,
  JSON.stringify(ctx.cadence(enters('TIM2', [0, 50, 100, 150]), 'TIM2')));
check('another timer\'s entries do not count towards this cadence',
  ctx.cadence(enters('TIM3', [0, 100, 200, 300]), 'TIM2').n === 0);
check('interleaved noise between entries does not disturb the cadence', (() => {
  const tape = [];
  for (const t of [0, 500, 1000, 1500]) {
    tape.push(ev('enter', 'TIM2', t), ev('led', 'TIM2', t + 10), ev('exit', 'TIM2', t + 400));
  }
  tape.push(ev('lost', 'main', 700));
  const cc = ctx.cadence(tape, 'TIM2');
  return ctx.steady(tape, 'TIM2', 4) === true && cc.n === 4 && cc.median === 500;
})());
check('entries of the wrong kind never count', ctx.cadence([ev('exit', 'TIM2', 0), ev('exit', 'TIM2', 500)], 'TIM2').n === 0);

/* freshness: the two claims must be separable */
check('a stale tape passes the cadence claim but fails freshness',
  ctx.steady(stable, 'TIM2', 4) === true &&
  ctx.steady(stable, 'TIM2', 4, 5000, 3000) === false,
  'age ' + ctx.age(stable, 'TIM2', 5000));
check('a fresh tape passes both', ctx.steady(stable, 'TIM2', 4, 1900, 3000) === true);
check('age is null before the handler ever runs', ctx.age([], 'TIM2', 1000) === null);
check('freshness is only asserted when a clock is supplied',
  ctx.steady(stable, 'TIM2', 4, undefined, undefined) === true);

/* verdicts are what the learner reads, so they have to distinguish those two failures */
check('verdict: nothing yet', ctx.verdict(ctx.cadence([], 'TIM2'), null) === 'no handler entries yet');
check('verdict: too few entries', /too few entries \(1\/4\)/.test(ctx.verdict(ctx.cadence(enters('TIM2', [0]), 'TIM2'), 0)),
  ctx.verdict(ctx.cadence(enters('TIM2', [0]), 'TIM2'), 0));
check('verdict: irregular gaps', /irregular gaps/.test(
  ctx.verdict(ctx.cadence(enters('TIM2', [0, 500, 1000, 2200]), 'TIM2'), 100)));
check('verdict: stopped is not the same answer as steady',
  /^stopped — last entry 4000 ms ago$/.test(ctx.verdict(ctx.cadence(stable, 'TIM2'), 4000)),
  ctx.verdict(ctx.cadence(stable, 'TIM2'), 4000));
check('verdict: steady once it is both regular and fresh',
  /steady cadence/.test(ctx.verdict(ctx.cadence(stable, 'TIM2'), 100)));

/* ---- the real model: the same gate, driven by pfTick() ---- */
check('a fresh model starts with an empty tape', ctx.periph.tape.length === 0 && ctx.stillRunning() === false);
ctx.periph.stage = 9;
ctx.write('RCC', 'AHB1ENR', 1);
ctx.write('RCC', 'APB1ENR', 1);
ctx.write('GPIOA', 'MODER', 1 << 10);
ctx.write('TIM2', 'PSC', 9);
ctx.write('TIM2', 'ARR', 49);
ctx.write('TIM2', 'DIER', 1);
ctx.write('TIM2', 'CR1', 1);
ctx.write('NVIC', 'ISER0', 1 << 28);
ctx.periph.cpu.PRIMASK = 0;
for (let i = 0; i < 60; i++) { ctx.tick(); }        /* six seconds at 2 Hz */

const live = ctx.cadence(ctx.periph.tape, 'TIM2');
const stuttered = { n: live.n, median: live.median, steady: live.steady };
check('the bring-up passes the stage-9 behaviour gate', ctx.stillRunning() === true, JSON.stringify(live));
check('the tape measured the cadence pfUpdateRateHz promises',
  live.median === 1000 / ctx.rate({ PSC: 9, ARR: 49 }), live.median + ' ms vs ' + (1000 / ctx.rate({ PSC: 9, ARR: 49 })) + ' ms');
check('six seconds at 2 Hz is twelve handler entries', live.n === 12, String(live.n));
check('the older fired counter agrees with the tape', (ctx.periph.fired.TIM2 | 0) === live.n, ctx.periph.fired.TIM2 + ' vs ' + live.n);
const leds = ctx.entries(ctx.periph.tape, 'led', 'TIM2').length;
const exits = ctx.entries(ctx.periph.tape, 'exit', 'TIM2').length;
check('every entry wrote the pin it owns', leds === live.n, leds + ' led events for ' + live.n + ' entries');
check('handlers exit, and the newest one is still on the CPU', exits === live.n - 1, exits + ' exits for ' + live.n + ' entries');
check('entries are recorded in sim-clock order', (() => {
  const t = ctx.periph.tape.map((e) => e.t);
  return t.every((v, i) => i === 0 || v >= t[i - 1]);
})());

/* the silent failure: mask the IRQ, keep the registers "correct" */
ctx.periph.cpu.PRIMASK = 1;
for (let i = 0; i < 40; i++) { ctx.tick(); }        /* four seconds: past the stale window */
const masked = ctx.cadence(ctx.periph.tape, 'TIM2');
check('a masked IRQ stops the handler but leaves the cadence stats green',
  masked.steady === true && masked.n === stuttered.n, JSON.stringify(masked));
check('…and the behaviour gate catches it anyway', ctx.stillRunning() === false);
check('a recent anomaly still fails, however well the window ends',
  ctx.steady(enters('TIM2', [0, 500, 1000, 1500, 5500, 6000]), 'TIM2', 4) === false,
  JSON.stringify(ctx.cadence(enters('TIM2', [0, 500, 1000, 1500, 5500, 6000]), 'TIM2')));
check('the verdict names the failure it found',
  /^stopped — last entry \d+ ms ago$/.test(ctx.verdict(masked, ctx.age(ctx.periph.tape, 'TIM2', ctx.periph.simMs))),
  ctx.verdict(masked, ctx.age(ctx.periph.tape, 'TIM2', ctx.periph.simMs)));
check('the old style counter would still have said "passed"', (ctx.periph.fired.TIM2 | 0) >= ctx.minEntries);
ctx.periph.cpu.PRIMASK = 0;
for (let i = 0; i < 6; i++) { ctx.tick(); }
check('a couple of fresh entries are not enough while the outage is still in the window',
  ctx.stillRunning() === false && ctx.cadence(ctx.periph.tape, 'TIM2').n > stuttered.n);
for (let i = 0; i < 34; i++) { ctx.tick(); }
check('once the outage leaves the window the gate reopens', ctx.stillRunning() === true,
  JSON.stringify(ctx.cadence(ctx.periph.tape, 'TIM2')));

/* the ring is bounded: a long run must not grow storage forever, and must not lose the cadence */
for (let i = 0; i < 400; i++) { ctx.tick(); }
check('the tape stays inside its ring', ctx.periph.tape.length <= ctx.max,
  ctx.periph.tape.length + ' entries, max ' + ctx.max);
check('a saturated tape still measures a steady cadence',
  ctx.cadence(ctx.periph.tape, 'TIM2').steady === true && ctx.stillRunning() === true,
  JSON.stringify(ctx.cadence(ctx.periph.tape, 'TIM2')));

/* ---- drift guards: the predicate has to stay wired to the lab ---- */
function slice(startMark, endMark) {
  const a = src.indexOf(startMark), b = src.indexOf(endMark, a);
  if (a < 0 || b < 0 || b <= a) { throw new Error('markers not found: ' + startMark + ' … ' + endMark); }
  return src.slice(a, b);
}
const isr = slice('function pfEnterIsr', 'function pfNvicTick');
const nvic = slice('function pfNvicTick', 'function pfAdvanceTimer');
const race = slice('function pfRaceTick', 'function pfUpdateRateHz');
check('the handler records its entry', /pfTape\("enter", r\.n\)/.test(isr));
check('the handler records the pin write it made', /pfTape\("led", r\.n\)/.test(isr));
check('a handler exit is recorded too', /pfTape\("exit", top\.n\)/.test(nvic));
check('a lost update is recorded as a CPU event', /pfTape\("lost", "main"\)/.test(race));
check('defaults declare the tape', /tape:\s*\[\]/.test(slice('function pfDefaults', 'function pfLoadState')));
check('a stored/imported tape is type-checked and trimmed to the ring',
  /!Array\.isArray\(s\.tape\)/.test(src) && /s\.tape\.length > PF_TAPE_MAX/.test(src));
check('the ring is bounded on write', /periph\.tape\.length > PF_TAPE_MAX/.test(src) && ctx.max > 0, String(ctx.max));
check('the cadence rule uses the declared tolerance', /median \* PF_TAPE_TOL/.test(src));
check('a cadence is never shorter than one sim frame', /median >= PF_TICK_MS/.test(src));
check('stage 9 asks through the shared behaviour gate',
  (src.match(/pfTapeStillRunning\(\)/g) || []).length >= 3,
  String((src.match(/pfTapeStillRunning\(\)/g) || []).length));
check('the goal text and the checklist both state the same entry count',
  (src.match(/PF_GOAL9_MIN_ENTRIES \+ ' handler entries/g) || []).length >= 2,
  String((src.match(/PF_GOAL9_MIN_ENTRIES \+ ' handler entries/g) || []).length));
check('the tape card is rendered in the stages that discuss it',
  (src.match(/pfTapeCard\(\)/g) || []).length >= 4,
  String((src.match(/pfTapeCard\(\)/g) || []).length));
check('the card and the gate read the same cadence helper',
  (src.match(/pfTapeCadence\(/g) || []).length >= 2 && (src.match(/pfTapeAge\(/g) || []).length >= 2);
check('the cadence window is bounded and used by the predicate',
  /PF_TAPE_WINDOW = \d+/.test(src) && /hits\.slice\(-PF_TAPE_WINDOW\)/.test(src));
check('the card shows the raw events, not just a verdict', src.indexOf('id="pf-tape"') >= 0 && /PF_TAPE_KINDS/.test(src));

if (failures) {
  console.log('\n' + failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nperipheral behaviour tape green (cadence, freshness, ring bound, real-model bring-up, wiring)');
