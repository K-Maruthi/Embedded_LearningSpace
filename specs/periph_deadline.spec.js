/* Time-base, handler-cost and deadline spec for the Peripherals lab (23_lab_periph.js).
 *
 * Zero dependencies. Run with:  node specs/periph_deadline.spec.js
 *
 * The periph lab had three defects that all came from the same place: the
 * numbers on screen were not the numbers the model produced.
 *
 *   1. THE TIME BASE LIED ABOVE PSC 99.  pfAdvanceTimer stepped the counter by
 *      Math.max(1, Math.round(PF_CLK_PER_TICK / (PSC+1))) — a clamped whole
 *      count. For any divisor over 100 that clamps to 1, so a 250-count divisor
 *      ran the counter at 1/250th of the rate pfUpdateRateHz() reported: 0.10 Hz
 *      delivered against 0.04 Hz claimed. The card, the stage-9 goal and the
 *      stage-5 hint all read pfUpdateRateHz(), and stage 5's hint actively
 *      recommended "factors of ~500-2000", i.e. it steered learners into the
 *      range where the model disagreed with itself. Fixed by carrying the
 *      remainder in T.acc, so the counter honours the claimed rate at every PSC.
 *
 *   2. THE HANDLER COST WAS STATED AS A HARDWARE FACT.  Prose said "the TIM2
 *      handler holds the CPU ~400 ms" with no qualifier. A real ISR that clears
 *      a flag and toggles an ODR bit costs microseconds; 400 ms is four sim
 *      frames, chosen so preemption is visible at a 10 Hz tick. Nothing said so,
 *      so a learner concludes handlers cost 400 ms.
 *
 *   3. A SATURATED ISR PASSED THE BEHAVIOUR GATE.  This is the one that mattered.
 *      pfTapeCadence() asks "are the gaps regular?" — and a handler that overruns
 *      its own period produces beautifully even gaps, evenly spaced at the COST
 *      rather than at the RATE. Configure 4 Hz, let the 400 ms handler miss its
 *      250 ms deadline, and the tape read median 400 / steady true / verdict
 *      "steady cadence - behaviour gate met" while the card still said 4.00 Hz.
 *      The learner was told they had built a 4 Hz blink; the CPU was 160 %
 *      committed to the ISR and main() never ran. Regularity was being graded
 *      where punctuality was meant.
 *
 * The fix adds a deadline: the period the timer generates against the time one
 * handler holds the CPU, graded as its own claim alongside cadence and
 * freshness. It also retunes the stage-7 nesting demo, which could not do what
 * its own prose promised (TIM3 at 5 Hz overran its 200 ms period, never left the
 * CPU, and TIM2 was dispatched zero times - so stage 7's goal was unreachable
 * from stage 7's own one-click demo).
 *
 * Structure: pure predicate checks first, then the real model driven through
 * pfTick(), then drift guards so the prose, the card and the checklist cannot be
 * edited back into telling a different story than the grader.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* PERIPH_SRC lets the negative control point this spec at a mutated *copy* in a
 * temp directory. Mutating the real 23_lab_periph.js in place means any crash,
 * timeout or kill leaves a mutation behind in learner-facing source — which is
 * exactly how "chosen arbitrarily, so that the timing is *fixed*" ended up
 * committed to a comment on the way to this fix. Nothing else about the spec
 * changes; unset, it reads the curriculum source as usual. */
const src = process.env.PERIPH_SRC
  ? fs.readFileSync(process.env.PERIPH_SRC, 'utf8')
  : fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '23_lab_periph.js'), 'utf8');

/* PF_CH9 is the stage-9 checklist. Several checks below read it, and it is read
 * from two different sections, so it is sliced once here. */
const ch9 = src.slice(src.indexOf('var PF_CH9'), src.indexOf('function pfChecklistCard'));
const from = src.indexOf('var K_PERIPH');
/* The slice has to reach past pfArmNestDemo, because the nesting demo is graded
   by *calling* the arm routine the UI's button calls. A spec that re-types the
   arm sequence instead grades its own transcription of it, which is why the
   first draft of this file passed while the routine could be changed freely. */
const to = src.indexOf('function pfGoStage');
if (from < 0 || to < 0 || to < from) { throw new Error('periph slice markers not found in 23_lab_periph.js'); }

/* pfTick calls the real pfRenderLive, which is defined past pfArmNestDemo and so
 * lands inside this slice. It is gated on periphInited (declared outside the
 * slice), so handing the context that flag keeps it a no-op instead of pulling
 * a DOM into a model spec. */
const ctx = vm.createContext({
  rd: () => null, wr: () => {},
  periphInited: false, journalInited: false
});
vm.runInContext(src.slice(from, to) + `
this.periph = periph;
this.defaults = pfDefaults;
this.tick = pfTick;
this.write = pfWriteReg;
this.rate = pfUpdateRateHz;
this.cadence = pfTapeCadence;
this.steady = pfTapeSteady;
this.age = pfTapeAge;
this.verdict = pfTapeVerdict;
this.stillRunning = pfTapeStillRunning;
this.deadline = pfIsrDeadline;
this.onPeriod = pfTapeOnPeriod;
this.advance = pfAdvanceTimer;
this.armNest = pfArmNestDemo;
this.minEntries = PF_GOAL9_MIN_ENTRIES;
this.tol = PF_TAPE_TOL;
this.stale = PF_TAPE_STALE_MS;
this.tickMs = PF_TICK_MS;
this.clkPerTick = PF_CLK_PER_TICK;
this.isrMs = PF_ISR_MS;
this.maxRolls = PF_MAX_ROLLS;
`, ctx);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('pass  ' + name); return; }
  failures++;
  console.log('FAIL  ' + name + (detail === undefined ? '' : '   [' + detail + ']'));
}
function section(t) { console.log('\n-- ' + t); }

/* ---- helpers: drive the real model ---- */
function bringUp(psc, arr, seconds, opts) {
  const o = opts || {};
  ctx.periph = ctx.defaults();
  ctx.periph.stage = 9;
  ctx.write('RCC', 'AHB1ENR', 1);
  ctx.write('RCC', 'APB1ENR', 1);
  ctx.write('GPIOA', 'MODER', 1 << 10);
  ctx.write('TIM2', 'PSC', psc);
  ctx.write('TIM2', 'ARR', arr);
  ctx.write('TIM2', 'DIER', 1);
  ctx.write('TIM2', 'CR1', 1);
  if (o.unmask !== false) { ctx.write('NVIC', 'ISER0', 1 << 28); }
  const ticks = Math.round(seconds * 10);
  for (let i = 0; i < ticks; i++) { ctx.tick(); }
  return {
    c: ctx.cadence(ctx.periph.tape, 'TIM2'),
    dl: ctx.deadline(ctx.periph.tim2),
    pass: ctx.stillRunning(),
    merged: ctx.periph.tim2.merged | 0
  };
}

const ISR = ctx.isrMs;
const TICK = ctx.tickMs;
const MAX_HZ = 1000 / ISR;

/* ============================ 1. the time base ============================ */
section('the counter honours the rate pfUpdateRateHz reports, at every PSC');

/* A pure-arithmetic restatement of what the model must do: counts per tick is
 * PF_CLK_PER_TICK/(PSC+1), which is a fraction for any PSC above 99. The old
 * step was Math.max(1, Math.round(...)), so this is the invariant that was lost. */
function clampedStep(psc) { return Math.max(1, Math.round(ctx.clkPerTick / (psc + 1))); }
check('the model no longer uses a clamped whole-count step',
  !/Math\.max\(1,\s*Math\.round\(PF_CLK_PER_TICK/.test(src),
  'the clamped step is back — divisors over 100 will run slow again');
check('the counter carries a fractional remainder instead',
  /\.acc\s*=\s*\(T\.acc\s*\|\|\s*0\)\s*\+\s*PF_CLK_PER_TICK\s*\/\s*div/.test(src));
check('a divisor over 100 is exactly where the old step clamped',
  clampedStep(99) === 1 && clampedStep(249) === 1 && clampedStep(999) === 1,
  [99, 249, 999].map(clampedStep).join('/'));
check('…while the honest step for those divisors is well under one count per tick',
  ctx.clkPerTick / 250 < 1 && ctx.clkPerTick / 1000 < 1,
  (ctx.clkPerTick / 250).toFixed(3) + ' / ' + (ctx.clkPerTick / 1000).toFixed(3));

/* The measured period must equal the claimed period. Long periods need long runs,
 * so each case is run for a few of its own periods. */
for (const [psc, arr] of [[9, 99], [19, 49], [0, 999], [99, 7], [3, 9], [13, 24]]) {
  const claimMs = 1000 / ctx.rate({ PSC: psc, ARR: arr });
  if (claimMs <= ISR) { continue; }                    /* sub-deadline cases are tested in section 3 */
  const r = bringUp(psc, arr, (claimMs * 5) / 1000);
  check('PSC ' + psc + ' / ARR ' + arr + ' measures its claimed ' + claimMs.toFixed(0) + ' ms period',
    r.c.median === claimMs, r.c.median + ' ms vs ' + claimMs.toFixed(0) + ' ms');
}

/* Large PSC is where the old model broke. These are slow, so run them once for
 * a fixed long window and compare against the claim rather than a full cadence. */
for (const [psc, arr, secs] of [[249, 99, 320], [499, 99, 320], [999, 99, 320]]) {
  ctx.periph = ctx.defaults();
  ctx.write('RCC', 'APB1ENR', 1);
  ctx.write('TIM2', 'PSC', psc);
  ctx.write('TIM2', 'ARR', arr);
  ctx.write('TIM2', 'DIER', 1);
  ctx.write('TIM2', 'CR1', 1);
  ctx.write('NVIC', 'ISER0', 1 << 28);
  for (let i = 0; i < secs * 10; i++) { ctx.tick(); }
  const claimMs = 1000 / ctx.rate({ PSC: psc, ARR: arr });
  const c = ctx.cadence(ctx.periph.tape, 'TIM2');
  const err = c.median ? Math.abs(c.median - claimMs) / claimMs : 1;
  check('PSC ' + psc + ' no longer runs at the clamped 10 Hz instead of ' + (1000 / claimMs).toFixed(3) + ' Hz',
    err < 1e-9, c.median + ' ms vs ' + claimMs.toFixed(0) + ' ms');
  check('…and the clamped step really would have been wrong here',
    clampedStep(psc) * 10 / 100 !== 1000 / claimMs,
    'the mutation is indistinguishable — the case proves nothing');
}

/* The accumulator must not drift. div 8 gives 12.5 counts per tick, so the only
 * correct step alternates 12,13,12,13 — floor with the remainder carried.
 *
 * Note what rounding does and does not break here, because an earlier draft of this
 * comment claimed rounding "runs 4 % fast" and built its control on that. It does
 * not: with the remainder still carried, round hands over 13 then 12 then 13, which
 * averages 12.5 exactly, and 2400 ticks deliver exactly 30000 counts. Rounding's
 * real defect is the opposite of drift — it runs *ahead*. It claims a count that has
 * not elapsed yet, so UIF rises before the period it reports has actually passed.
 * That is what the next check tests, and it is why the control below survives here. */
ctx.periph = ctx.defaults();
ctx.write('RCC', 'APB1ENR', 1);
ctx.write('TIM2', 'PSC', 7);
ctx.write('TIM2', 'ARR', 499);
ctx.write('TIM2', 'DIER', 1);
ctx.write('TIM2', 'CR1', 1);
ctx.write('NVIC', 'ISER0', 1 << 28);
for (let i = 0; i < 2400; i++) { ctx.tick(); }     /* 240 s = six periods */
const driftClaim = 1000 / ctx.rate({ PSC: 7, ARR: 499 });
const driftC = ctx.cadence(ctx.periph.tape, 'TIM2');
check('div 8 is a genuine 12.5-count step, so this case exercises the remainder',
  ctx.clkPerTick / 8 % 1 !== 0, (ctx.clkPerTick / 8) + ' counts per tick');
check('the long period makes a floor-vs-round error larger than one sim frame',
  driftClaim * 0.04 > TICK, driftClaim.toFixed(0) + ' ms period, 4 % = ' + (driftClaim * 0.04).toFixed(0) + ' ms');
check('a fractional divisor does not drift over 240 s of sim time',
  driftC.n >= 5 && Math.abs(driftC.median - driftClaim) <= TICK,
  driftC.n + ' entries, median ' + driftC.median + ' ms vs ' + driftClaim.toFixed(1) + ' ms');

/* …and it must not run ahead of the clock either. ARR 12 is a 13-count period at
 * 12.5 counts per tick, so the true period is 104 ms: the first rollover is due
 * during the second 100 ms frame, never the first. Rounding up hands over 13
 * counts on tick 1 — a whole count that has not elapsed — and raises UIF one frame
 * early, at 100 ms for a timer the card says is 9.6 Hz. That is the same class of
 * lie the deadline check exists to stop: a number the model reports, and a
 * behaviour it does not have. */
ctx.periph = ctx.defaults();
ctx.write('RCC', 'APB1ENR', 1);
ctx.write('TIM2', 'PSC', 7);
ctx.write('TIM2', 'ARR', 12);
ctx.write('TIM2', 'DIER', 1);
ctx.write('TIM2', 'CR1', 1);
ctx.write('NVIC', 'ISER0', 1 << 28);
for (let i = 0; i < 8; i++) { ctx.tick(); }
const earlyClaim = 1000 / ctx.rate({ PSC: 7, ARR: 12 });
const firstEntry = ctx.periph.tape.filter((e) => e.k === 'enter' && e.d === 'TIM2').map((e) => e.t);
check('a 13-count period is 104 ms, which is not inside the first 100 ms frame',
  earlyClaim > TICK && earlyClaim < 2 * TICK, earlyClaim.toFixed(1) + ' ms');
/* Expected first rollover: the first frame boundary at or after the true period.
 * An earlier draft asserted ">= TICK", which is off by one — a rollover on frame 1
 * stamps at exactly 100 ms and passes. Comparing against the computed boundary is
 * both correct and self-explaining. */
const earlyExpected = Math.ceil(earlyClaim / TICK) * TICK;
check('the first rollover lands on the first frame boundary at or after the period',
  firstEntry.length > 0 && firstEntry[0] === earlyExpected,
  'first entry at ' + firstEntry[0] + ' ms, expected ' + earlyExpected + ' ms for a ' + earlyClaim.toFixed(1) + ' ms period');
check('…which is the second frame, so the counter cannot have fired a frame early',
  earlyExpected > TICK && firstEntry[0] > TICK,
  'period ' + earlyClaim.toFixed(1) + ' ms, first entry ' + firstEntry[0] + ' ms');

/* UIF is one bit, so several rollovers in a tick raise it once - but the surplus
 * is counted, because "the peripheral generated more than the CPU could take" is
 * the whole point of the deadline check. */
ctx.periph = ctx.defaults();
ctx.write('RCC', 'APB1ENR', 1);
ctx.write('TIM2', 'PSC', 0);
ctx.write('TIM2', 'ARR', 0);
ctx.write('TIM2', 'DIER', 1);
ctx.write('TIM2', 'CR1', 1);
ctx.write('NVIC', 'ISER0', 1 << 28);
for (let i = 0; i < 10; i++) { ctx.tick(); }
check('PSC 0 / ARR 0 counts 1000 events per tick and counts the merged surplus',
  (ctx.periph.tim2.merged | 0) >= 900,
  (ctx.periph.tim2.merged | 0) + ' merged over 10 ticks');
check('one tick cannot produce more rollovers than PF_MAX_ROLLS',
  ctx.maxRolls >= ctx.clkPerTick, ctx.maxRolls + ' vs ' + ctx.clkPerTick);

/* ============================ 2. handler cost ============================ */
section('the handler cost is labelled a model device, not a hardware figure');

const isrDecl = src.indexOf('var PF_ISR_MS = 400');
check('PF_ISR_MS is still a plain number of milliseconds', ISR === 400, String(ISR));
check('PF_ISR_MS is preceded by a comment saying it is not a hardware figure',
  /NOT a hardware figure/.test(src.slice(Math.max(0, isrDecl - 700), isrDecl)),
  src.slice(Math.max(0, isrDecl - 400), isrDecl).slice(0, 120));
check('…that comment says why it is that big',
  /four whole sim frames/.test(src.slice(Math.max(0, isrDecl - 700), isrDecl)),
  'the comment does not explain the choice');
/* The size *and* the reason have to survive separately. An earlier draft checked
 * only the size, so replacing "chosen so that preemption is *visible*" with
 * "chosen arbitrarily, so that the timing is *fixed*" passed — and that second
 * phrasing is exactly the defect: it asserts a figure is arbitrary instead of
 * admitting it was picked to make preemption visible. */
const costComment = src.slice(Math.max(0, isrDecl - 700), isrDecl);
check('…and it says the number was chosen so preemption is visible, not fixed arbitrarily',
  /preemption is\s*\n?\s*\*visible\*/.test(costComment) && !/arbitrarily/.test(costComment),
  costComment.replace(/\s+/g, ' ').slice(-160));
check('the cost comment claims the figure is a real measurement',
  !/is the cost on hardware/.test(costComment));

/* Every rendered string that quotes the cost must qualify it.
 * This is the drift guard that actually matters, because the original defect was
 * prose asserting "~400 ms" as a fact with no qualifier. An earlier draft
 * scanned a hand-listed set of card functions and quietly skipped the one whose
 * name was misspelled — so it passed while the prose was unqualified. The check
 * is now global over *string literals* — that is, text a learner can actually
 * read, as opposed to source comments, which are for maintainers. A new card
 * that hardcodes the cost is caught without anyone remembering to list it. */
function stringLiterals(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const q = text[i];
    if (q !== "'" && q !== '"') { i++; continue; }
    let j = i + 1, buf = '';
    while (j < text.length && text[j] !== q) {
      if (text[j] === '\\') { buf += text[j] + (text[j + 1] || ''); j += 2; continue; }
      buf += text[j]; j++;
    }
    out.push({ start: i, end: j, text: buf });
    i = j + 1;
  }
  return out;
}
const literals = stringLiterals(src);
const proseWithLiteralCost = literals.filter((l) => /\b400\b/.test(l.text));
check('at least three rendered strings quote the cost, so the scan has targets',
  proseWithLiteralCost.length >= 3,
  proseWithLiteralCost.length + ' literals contain 400');
const unqualified = proseWithLiteralCost.filter((l) => !/PF_ISR_MS|this model|in this lab/.test(l.text));
check('every rendered string quoting 400 also says it is this model\'s cost',
  unqualified.length === 0,
  unqualified.length + ' unqualified, first: ' + (unqualified[0] && unqualified[0].text.trim().slice(0, 100)));
check('no rendered string asserts a handler cost as a bare fact',
  !/holds the CPU ~400 ms/.test(src) && !/holds the CPU ≈ 400 ms/.test(src));
check('the cost is never interpolated as a raw literal in a card',
  !/'[^']*holds the CPU 400/.test(src) && !/"[^"]*holds the CPU 400/.test(src));
/* and the cards that do quote it must exist under the names the scan implies */
for (const fn of ['pfTimCard', 'pfTapeCard', 'pfNestCtlCard', 'pfTimelineCard']) {
  check('card ' + fn + ' exists, so the qualifier scan covers it',
    src.indexOf('function ' + fn + '(') >= 0, 'function ' + fn + ' not found');
}

/* The timer row distinguishes a met deadline from a missed one by swapping a CSS
 * class. A class with no rule renders both states identically, so the distinction
 * this fix exists to add would be present in the DOM and absent from the screen —
 * which is exactly how it shipped the first time. Require both rules to exist and
 * to resolve to different declarations. */
const css = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '01_head.html'), 'utf8');
check('the timer row marks the deadline met and missed with two distinct classes',
  /dlEl\.className = dl\.met \? 'dl-ok' : 'dl-bad'/.test(src),
  'pfTimCard no longer distinguishes the two states');
const dlOkRule = /\.dl-ok\s*\{([^}]*)\}/.exec(css);
const dlBadRule = /\.dl-bad\s*\{([^}]*)\}/.exec(css);
check('the stylesheet defines .dl-ok', !!dlOkRule, 'no .dl-ok rule in 01_head.html');
check('the stylesheet defines .dl-bad', !!dlBadRule, 'no .dl-bad rule in 01_head.html');
check('…and the two states are not painted identically',
  !!dlOkRule && !!dlBadRule && dlOkRule[1] !== dlBadRule[1],
  'both rules resolve to the same declarations');
check('the cost is never rendered as a raw literal in a card',
  !/'[^']*holds the CPU 400/.test(src) && !/"[^"]*holds the CPU 400/.test(src));

/* ============================ 3. the deadline ============================ */
section('a deadline is the period against the cost, and it is graded');

check('pfIsrDeadline exists', typeof ctx.deadline === 'function');
for (const [psc, arr] of [[9, 49], [9, 99], [4, 49], [9, 19], [0, 999]]) {
  const d = ctx.deadline({ PSC: psc, ARR: arr });
  const claimMs = 1000 / ctx.rate({ PSC: psc, ARR: arr });
  check('deadline for PSC ' + psc + '/ARR ' + arr + ' is ' + claimMs.toFixed(0) + ' ms vs ' + ISR + ' ms',
    d.periodMs === claimMs && d.costMs === ISR && Math.abs(d.load - ISR / claimMs) < 1e-12,
    JSON.stringify(d));
  check('…and it is met only when the handler fits inside the period',
    d.met === (ISR <= claimMs), String(d.met));
}
check('the fastest rate this model can actually serve is ' + MAX_HZ.toFixed(2) + ' Hz',
  Math.abs(MAX_HZ - 2.5) < 1e-9, String(MAX_HZ));
check('a 4 Hz configuration is over budget and says so',
  !ctx.deadline({ PSC: 4, ARR: 49 }).met, '4 Hz / 250 ms vs ' + ISR + ' ms');
check('a 2 Hz configuration is inside budget',
  ctx.deadline({ PSC: 9, ARR: 49 }).met);

/* on-period: regularity alone must not be enough. */
section('regular but wrong is still wrong');
check('pfTapeOnPeriod exists', typeof ctx.onPeriod === 'function');
const ev = (t) => ({ t: t, k: 'enter', d: 'TIM2' });
function tape(ts) { return ts.map(ev); }
const on5 = tape([0, 500, 1000, 1500, 2000, 2500]);
const on4 = tape([0, 400, 800, 1200, 1600, 2000]);   /* a saturated 4 Hz ISR */
check('a cadence at the requested period is on-period', ctx.onPeriod(ctx.cadence(on5, 'TIM2'), 500) === true);
check('a steady cadence at the wrong period is NOT on-period',
  ctx.onPeriod(ctx.cadence(on4, 'TIM2'), 250) === false,
  JSON.stringify(ctx.cadence(on4, 'TIM2')));
check('…even though that same cadence is perfectly steady',
  ctx.cadence(on4, 'TIM2').steady === true, 'regularity is not punctuality');
check('on-period allows one sim frame of slack',
  ctx.onPeriod(ctx.cadence(tape([0, 600, 1200, 1800]), 'TIM2'), 500) === true,
  JSON.stringify(ctx.cadence(tape([0, 600, 1200, 1800]), 'TIM2')));
check('…but not a drift of two frames',
  ctx.onPeriod(ctx.cadence(tape([0, 700, 1400, 2100]), 'TIM2'), 500) === false,
  JSON.stringify(ctx.cadence(tape([0, 700, 1400, 2100]), 'TIM2')));
check('a single entry has no cadence to judge and fails on-period',
  ctx.onPeriod(ctx.cadence(tape([0]), 'TIM2'), 500) === false);
check('a zero or missing period never passes on-period',
  ctx.onPeriod(ctx.cadence(on5, 'TIM2'), 0) === false && ctx.onPeriod(ctx.cadence(on5, 'TIM2'), undefined) === false);

/* the real model: a saturated ISR is steady AND fails the gate */
section('the gate rejects a saturated ISR that the cadence calls steady');
const sat = bringUp(4, 49, 20);
check('4 Hz with a ' + ISR + ' ms handler: the cadence is steady',
  sat.c.steady === true, JSON.stringify(sat.c));
check('…the cadence is the cost, not the requested rate',
  sat.c.median === ISR, sat.c.median + ' ms vs the ' + (1000 / ctx.rate({ PSC: 4, ARR: 49 })).toFixed(0) + ' ms asked for');
check('…and that is precisely the claim under test',
  sat.c.median !== 1000 / ctx.rate({ PSC: 4, ARR: 49 }));
check('the deadline is reported missed',
  sat.dl.met === false && sat.dl.load > 1, JSON.stringify(sat.dl));
check('the behaviour gate now fails it', sat.pass === false,
  'the gate passed a saturated ISR again');
check('the verdict names the deadline rather than calling it steady',
  /^missed deadline/.test(ctx.verdict(sat.c, ctx.age(ctx.periph.tape, 'TIM2', ctx.periph.simMs), sat.dl)),
  ctx.verdict(sat.c, ctx.age(ctx.periph.tape, 'TIM2', ctx.periph.simMs), sat.dl));
check('the verdict shows the load as a percentage',
  /\d+ % load/.test(ctx.verdict(sat.c, 0, sat.dl)),
  ctx.verdict(sat.c, 0, sat.dl));
check('and it explains that the cadence is the cost, not the rate',
  /cadence is the cost, not the rate/.test(ctx.verdict(sat.c, 0, sat.dl)));

/* a regular-but-off-cadence case, deadline met but the tape disagrees */
section('a regular cadence at the wrong rate fails even with the deadline met');
check('verdict distinguishes wrong-cadence from missed-deadline',
  /^cadence \d+ ms, not the \d+ ms you asked for$/.test(
    ctx.verdict(ctx.cadence(on4, 'TIM2'), 100, { periodMs: 250, costMs: ISR, load: ISR / 250, met: true })),
  ctx.verdict(ctx.cadence(on4, 'TIM2'), 100, { periodMs: 250, costMs: ISR, load: ISR / 250, met: true }));

/* the claims that must still pass */
section('honest configurations still pass');
for (const [psc, arr] of [[9, 49], [9, 59], [0, 649], [9, 39]]) {
  const r = bringUp(psc, arr, 20);
  const claimMs = 1000 / ctx.rate({ PSC: psc, ARR: arr });
  check('PSC ' + psc + '/ARR ' + arr + ' at ' + (1000 / claimMs).toFixed(2) + ' Hz keeps its deadline and passes',
    r.dl.met === true && r.pass === true,
    'met=' + r.dl.met + ' gate=' + r.pass + ' ' + JSON.stringify(r.c));
}
const good = bringUp(9, 49, 20);
check('a correct 2 Hz bring-up reads median 500 and passes',
  good.c.median === 500 && good.pass === true, JSON.stringify(good.c));
check('…with the plain steady verdict',
  /steady cadence/.test(ctx.verdict(good.c, 100, good.dl)),
  ctx.verdict(good.c, 100, good.dl));

/* every rate the stage-9 goal accepts must also keep its deadline */
section('every rate inside the stage-9 band is servable');
const band = [...src.matchAll(/r >= ([\d.]+) && r <= ([\d.]+)/g)].map((m) => ({ lo: Number(m[1]), hi: Number(m[2]) }));
check('the goal still declares a rate band', band.length > 0, 'no band found');
check('…in more than one place, so the sites below are actually separate',
  band.length >= 2, band.length + ' band(s) found');
check('every declared band is the same band',
  band.every((b) => b.lo === band[0].lo && b.hi === band[0].hi),
  JSON.stringify(band));
for (const b of band) {
  const worstMs = 1000 / b.hi;                       /* fastest rate the band accepts */
  check('the fastest rate the goal accepts (' + b.hi + ' Hz, ' + worstMs.toFixed(0) + ' ms) keeps its deadline',
    worstMs >= ISR, worstMs.toFixed(0) + ' ms period vs a ' + ISR + ' ms handler — the goal accepts a rate it can never deliver');
}
/* The band has to appear in all three places the learner meets it, and saying so
 * by counting occurrences of "2.4" is not enough — that count survives a mutation
 * which rewrites one of the three into vaguer words and leaves five other 2.4s in
 * the file. So name each site and require the band in it. */
const BAND = band[0].lo.toFixed(1) + ' - ' + band[0].hi.toFixed(1);
const normDash = (s) => s.replace(/\u2013/g, '-');
check('the checklist row states the band',
  normDash(ch9).indexOf(BAND) >= 0, 'the checklist row no longer quotes the band');
check('the stage-9 goal text states the band',
  normDash(block('pfGoalCard')).indexOf(BAND) >= 0, 'the goal card no longer quotes the band');
const specBriefAt = src.indexOf('pf-spec">PA5');
check('the one-line stage brief is where the check expects it',
  specBriefAt >= 0, 'no pf-spec">PA5 marker — the brief check would silently pass');
check('the one-line stage brief states the band',
  normDash(src.slice(specBriefAt, specBriefAt + 160)).indexOf(BAND) >= 0,
  'the stage brief no longer quotes the band');
check('the band is servable across its whole width',
  1000 / band[0].hi >= ISR && 1000 / band[0].lo > ISR,
  'fastest ' + (1000 / band[0].hi).toFixed(0) + ' ms, slowest ' + (1000 / band[0].lo).toFixed(0) + ' ms vs ' + ISR);
for (const [psc, arr] of [[9, 49], [9, 59], [9, 69], [0, 649], [0, 599], [4, 199], [19, 29], [7, 79]]) {
  const hz = ctx.rate({ PSC: psc, ARR: arr });
  if (!(hz >= band[0].lo && hz <= band[0].hi)) { continue; }
  const d = ctx.deadline({ PSC: psc, ARR: arr });
  check('PSC ' + psc + '/ARR ' + arr + ' (' + hz.toFixed(2) + ' Hz) is inside the band and servable',
    d.met === true, 'load ' + Math.round(d.load * 100) + ' %');
}

/* the silent failure that must survive */
section('the masked-line failure is still caught');
const masked = (() => {
  bringUp(9, 49, 6);
  ctx.periph.cpu.PRIMASK = 1;
  for (let i = 0; i < 40; i++) { ctx.tick(); }
  const c = ctx.cadence(ctx.periph.tape, 'TIM2');
  return { c, dl: ctx.deadline(ctx.periph.tim2), pass: ctx.stillRunning() };
})();
check('a masked IRQ leaves the cadence stats green', masked.c.steady === true, JSON.stringify(masked.c));
check('…and the gate still catches it', masked.pass === false);
check('…naming staleness rather than the deadline, which is fine',
  /^stopped/.test(ctx.verdict(masked.c, ctx.age(ctx.periph.tape, 'TIM2', ctx.periph.simMs), masked.dl)),
  ctx.verdict(masked.c, ctx.age(ctx.periph.tape, 'TIM2', ctx.periph.simMs), masked.dl));
check('a stopped handler is not reported as a missed deadline',
  !/missed deadline/.test(ctx.verdict(masked.c, 4000, ctx.deadline({ PSC: 9, ARR: 49 }))));

/* ============================ 4. the nesting demo ============================ */
section('the nesting demo can do what its prose promises');

/* The demo text states the numbers; parse them and check the invariant. */
const nest = /TIM2 PSC (\d+) \/ ARR (\d+), TIM3 PSC (\d+) \/ ARR (\d+)/.exec(src);
check("the nesting card still states both timers' PSC/ARR", !!nest, String(nest && nest[0]));
if (nest) {
  const p2 = 1000 / ctx.rate({ PSC: Number(nest[1]), ARR: Number(nest[2]) });
  const p3 = 1000 / ctx.rate({ PSC: Number(nest[3]), ARR: Number(nest[4]) });
  check('both nesting periods outlast the handler, so neither overruns',
    p2 > ISR && p3 > ISR, p2.toFixed(0) + ' / ' + p3.toFixed(0) + ' vs ' + ISR);
  check('the more urgent timer is the slower one, so preemption is possible', p3 > p2, p2.toFixed(0) + ' ms vs ' + p3.toFixed(0) + ' ms');
  check('the slower, more urgent timer still lands inside the longer handler',
    p3 > 0 && p2 > ISR, 'TIM2 holds the CPU ' + ISR + ' ms of a ' + p2.toFixed(0) + ' ms period');
}

/* Run the demo by CALLING the arm routine the button calls, then run the sim.
   Anything less grades this spec's own transcription rather than the lab. */
function armAndRun() {
  ctx.periph = ctx.defaults();
  ctx.armNest();
  for (let i = 0; i < 40; i++) { ctx.tick(); }
  return {
    nestCount: ctx.periph.nestCount,
    t2n: ctx.cadence(ctx.periph.tape, 'TIM2').n,
    t3n: ctx.cadence(ctx.periph.tape, 'TIM3').n,
    t3met: ctx.deadline(ctx.periph.tim3).met,
    t3period: ctx.deadline(ctx.periph.tim3).periodMs
  };
}
const demo = armAndRun();
check('the demo the button actually arms produces a preemption', demo.nestCount >= 1,
  'nestCount ' + demo.nestCount + ' — stage 7 goal unreachable from its own demo');
check('…and both handlers actually ran', demo.t2n >= 1 && demo.t3n >= 1,
  'TIM2 ' + demo.t2n + ' entries, TIM3 ' + demo.t3n);
check('…with the armed TIM3 keeping its deadline', demo.t3met === true,
  demo.t3period.toFixed(0) + ' ms period');

/* The counter-example the card now offers must behave as the prose says. It is
   re-armed the same way, only with the fast TIM3 the prose names. */
function armAndRunFast() {
  ctx.periph = ctx.defaults();
  ctx.armNest();
  ctx.write('TIM3', 'ARR', 19);
  for (let i = 0; i < 40; i++) { ctx.tick(); }
  return {
    nestCount: ctx.periph.nestCount,
    t2n: ctx.cadence(ctx.periph.tape, 'TIM2').n,
    t3met: ctx.deadline(ctx.periph.tim3).met
  };
}
const starve = armAndRunFast();
check('the 5 Hz counter-example misses its deadline', starve.t3met === false,
  '200 ms period vs ' + ISR + ' ms handler');
check('…and starves the lower-priority timer completely',
  starve.t2n === 0 && starve.nestCount === 0,
  'TIM2 entries ' + starve.t2n + ', nestCount ' + starve.nestCount);
check('the nesting card offers that counter-example in its own prose',
  /ARR 19/.test(src.slice(src.indexOf('function pfNestCtlCard'), src.indexOf('function pfRaceCtlCard'))),
  'the 5 Hz hint is gone');
check('the nesting card label and its PSC/ARR prose agree',
  (() => {
    const card = src.slice(src.indexOf('function pfNestCtlCard'), src.indexOf('function pfRaceCtlCard'));
    const m = /TIM2 @ ([\d.]+) Hz.*TIM3 @ ([\d.]+) Hz/.exec(card);
    const n = /TIM2 PSC (\d+) \/ ARR (\d+), TIM3 PSC (\d+) \/ ARR (\d+)/.exec(card);
    if (!m || !n) { return false; }
    return Math.abs(ctx.rate({ PSC: Number(n[1]), ARR: Number(n[2]) }) - Number(m[1])) < 0.01 &&
           Math.abs(ctx.rate({ PSC: Number(n[3]), ARR: Number(n[4]) }) - Number(m[2])) < 0.01;
  })(),
  'the button label advertises a rate the prose values do not produce');

/* ============================ 5. drift guards ============================ */
section('drift guards: the grader, the cards and the prose cannot disagree');

/* Slice a named function's body. Refuses a missing name outright: a silent
 * indexOf(-1) produces a slice that looks fine and matches nothing, which is how
 * "the timer card no longer says X" once passed while the card said it fine. */
function block(name, until) {
  const a = src.indexOf('function ' + name);
  if (a < 0) { throw new Error('23_lab_periph.js has no function ' + name + ' — the guards below would silently pass'); }
  const b = until ? src.indexOf(until, a + 1) : src.indexOf('\n  function ', a + 12);
  return src.slice(a, b > a ? b : src.length);
}

check('the behaviour gate is the one place the three claims meet',
  /function pfTapeStillRunning[\s\S]{0,400}pfTapeSteady[\s\S]{0,200}dl\.met[\s\S]{0,200}pfTapeOnPeriod/.test(src),
  'the gate no longer requires the deadline');
check('the gate still requires freshness and cadence', /PF_TAPE_STALE_MS/.test(src));
/* A checklist row is only a row if it is in PF_CH9 *and* carries a live
 * predicate. Matching the label text alone would still pass if the row were
 * commented out, renamed to an inert key, or left with a stub predicate. */
check('the checklist grades the deadline as its own row',
  /\{\s*l:\s*'deadline kept/.test(ch9),
  'no live checklist row labelled "deadline kept"');
check('…and that row is decided by pfIsrDeadline, not by a constant',
  /\{\s*l:\s*'deadline kept[^}]*pfIsrDeadline\(periph\.tim2\)\.met/.test(ch9),
  'the deadline row does not read the live deadline');
check('the checklist label quotes the live period, not a fixed number',
  /deadline kept[^\n]*Math\.round\(1000 \/ pfUpdateRateHz\(periph\.tim2\)\)/.test(ch9));
check('the checklist has exactly one deadline row, so it is not padded',
  (ch9.match(/l:\s*'deadline kept/g) || []).length === 1);
/* Anchored to the card's own body: an earlier draft matched the *definition*
   `function pfTapeVerdict(c, age, dl)`, which is why a mutation that deleted the
   argument at the call site sailed through. */
const tapeStatBody = src.slice(src.indexOf('function pfTapeStatHtml'), src.indexOf('function pfTapeRowsHtml'));
check('the tape card prints the deadline evidence the grader uses',
  /pfIsrDeadline/.test(tapeStatBody) && /load/.test(tapeStatBody),
  'card omits deadline evidence');
check('the tape card and the grader ask for the same verdict',
  /pfTapeVerdict\(c,\s*age,\s*dl\)/.test(tapeStatBody),
  'card does not pass dl to verdict at the call site');
check('the timer card shows the period against the cost',
  /pf-\+ lk \+ \'-dl\'|"pf-" \+ lk \+ "-dl"/.test(src) || /'-dl'/.test(src));
check('the deadline readout marks a missed deadline distinctly',
  /dl\.met \? 'dl-ok' : 'dl-bad'/.test(src));
check('the stage-9 hint explains a missed deadline rather than shrugging',
  /Deadline missed/.test(src));
/* Stage 5's warning has to be reached by the live guard, not merely present as
 * text — an earlier draft matched the sentence, so disabling the guard (`if
 * (false)`) still passed and the learner never saw the warning. */
const stage5Hint = src.slice(src.indexOf('Pick factors that land in'), src.indexOf('pf-goal-hint'));
check('stage 5 warns that a short period cannot be met',
  /shorter than the/.test(stage5Hint), 'the warning text is gone');
check('…and the warning is gated on the live rate, not disabled',
  /if \(r > 0 && r < 1000 \/ PF_ISR_MS\) \{/.test(stage5Hint),
  'the guard that shows the warning is dead');
check('stage 5 states the rate it reports is the one the counter delivers',
  /for every PSC/.test(block('pfTimCard', 'function pfPupdrCard')),
  'the timer card no longer distinguishes claim from delivery');
check('the timer card separates the rate claim from the deadline',
  /The deadline is separate/.test(block('pfTimCard', 'function pfPupdrCard')),
  'the timer card conflates the rate the timer generates with the cost the CPU pays');
check('the stage-5 hint no longer recommends only large factors',
  !/Pick factors of ~500/.test(src), 'the hint still steers into the broken range');
check('the tolerance used for on-period is the declared one',
  /Math\.max\(periodMs \* PF_TAPE_TOL, PF_TICK_MS\)/.test(src));
check('a period shorter than one sim frame is always satisfiable by the next tick',
  ctx.onPeriod(ctx.cadence(tape([0, 100, 200, 300]), 'TIM2'), 50) === true,
  'a sub-frame period must never be unmeetable — the limit is the model clock');
check('…but a cadence that drifts two frames off a longer period still fails',
  ctx.onPeriod(ctx.cadence(tape([0, 500, 1000, 1500]), 'TIM2'), 1000) === false,
  JSON.stringify(ctx.cadence(tape([0, 500, 1000, 1500]), 'TIM2')));

/* the model spec must not be able to drift back to pinning the magic rate */
const modelSpec = fs.readFileSync(path.join(__dirname, 'periph_model.spec.js'), 'utf8');
check('periph_model.spec.js asserts the demo keeps its deadline',
  /keeps its deadline|outlast the handler/.test(modelSpec));
check('periph_model.spec.js no longer pins TIM3 to a fixed 5 Hz',
  !/really is 5 Hz/.test(modelSpec));

if (failures) {
  console.log('\n' + failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nperiph deadline green (time base, handler cost, deadline grading, nesting demo)');