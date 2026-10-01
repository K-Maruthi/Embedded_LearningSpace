/* Model spec for the Peripherals lab (23_lab_periph.js).
 *
 * Zero dependencies. Run with:  node specs/periph_model.spec.js
 *
 * pfUpdateRateHz is the one number the whole timer curriculum hangs on: stages 5
 * and 9 grade against it, the waveform draws from it, and the presets advertise a
 * rate in their labels. It is also where an off-by-one hides — the counter counts
 * 0..ARR inclusive, so the divisor is (ARR+1), not ARR (a shipped comment had
 * exactly that wrong; see problems.md P7).
 *
 * The second half is a drift guard: the numbers the lab *tells* the learner
 * (preset PSC/ARR, the graded Hz bands, the "e.g. PSC 9, ARR 99" hint, the 1 kHz
 * model clock, the values the arm buttons write) are read back out of the
 * fragment and checked against the model, so editing one side without the other
 * fails here instead of shipping a lie.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '23_lab_periph.js'), 'utf8');
const from = src.indexOf('function pfUpdateRateHz');
const to = src.indexOf('var PF_PRESETS');
if (from < 0 || to < 0 || to < from) { throw new Error('pfUpdateRateHz markers not found in 23_lab_periph.js'); }
const ctx = vm.createContext({});
vm.runInContext(src.slice(from, to) + '\nthis.rate = pfUpdateRateHz;', ctx);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('pass  ' + name); return; }
  failures++;
  console.log('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
}
const rate = (PSC, ARR) => ctx.rate({ PSC: PSC, ARR: ARR });

/* ---- 1. the arithmetic, including the off-by-one ---- */
check('PSC 0 / ARR 999 is 1 Hz', rate(0, 999) === 1, String(rate(0, 999)));
check('PSC 9 / ARR 99 is 1 Hz', rate(9, 99) === 1, String(rate(9, 99)));
check('PSC 9 / ARR 49 is 2 Hz', rate(9, 49) === 2, String(rate(9, 49)));
check('PSC 9 / ARR 19 is 5 Hz', rate(9, 19) === 5, String(rate(9, 19)));
check('ARR alone divides by ARR+1, not ARR', rate(0, 49) === 20 && rate(0, 50) !== 20,
  String(rate(0, 49)) + ' / ' + String(rate(0, 50)));
check('more prescaling always means a slower rate', rate(0, 99) > rate(9, 99) && rate(9, 99) > rate(19, 99));

/* ---- 2. drift guard: the 1000 in the formula matches the tick model ---- */
const tickMs = Number((/PF_TICK_MS\s*=\s*(\d+)/.exec(src) || [])[1]);
const clkPerTick = Number((/PF_CLK_PER_TICK\s*=\s*(\d+)/.exec(src) || [])[1]);
const clockHz = clkPerTick / (tickMs / 1000);
check('the tick constants describe a 1 kHz model clock', clockHz === 1000, clockHz + ' Hz');
check('pfUpdateRateHz uses that same clock', rate(0, clockHz - 1) === 1, String(rate(0, clockHz - 1)));

/* ---- 3. the graded Hz bands, read back from the source ---- */
const bands = [...src.matchAll(/pfUpdateRateHz\(T\) >= ([\d.]+) && pfUpdateRateHz\(T\) <= ([\d.]+)/g)];
const rBands = [...src.matchAll(/r >= ([\d.]+) && r <= ([\d.]+)/g)];
check('stage 5 states its Hz band in code', bands.length >= 1, JSON.stringify(bands.map((m) => m[0])));
check('stage 9 states its Hz band in code', rBands.length >= 1, JSON.stringify(rBands.map((m) => m[0])));
const band5 = bands.length ? { lo: Number(bands[0][1]), hi: Number(bands[0][2]) } : null;
const band9 = rBands.length ? { lo: Number(rBands[0][1]), hi: Number(rBands[0][2]) } : null;

/* ---- 4. the shipped presets must satisfy the goals that advertise them ---- */
const blink = src.slice(src.indexOf('id: "blink"'), src.indexOf('id: "noclk"'));
const blinkPsc = Number((/pfWriteReg\("TIM2", "PSC", (\d+)\)/.exec(blink) || [])[1]);
const blinkArr = Number((/pfWriteReg\("TIM2", "ARR", (\d+)\)/.exec(blink) || [])[1]);
check('the blink preset sets a PSC and an ARR', isFinite(blinkPsc) && isFinite(blinkArr), blinkPsc + ' / ' + blinkArr);
const blinkRate = rate(blinkPsc, blinkArr);
check('the blink preset lands inside the stage-9 band it is meant to pass',
  !!band9 && blinkRate >= band9.lo && blinkRate <= band9.hi, blinkRate + ' Hz vs ' + JSON.stringify(band9));
check('the blink preset matches the 1.96 Hz its own comment claims', Math.abs(blinkRate - 1.96) < 0.01, String(blinkRate));

const hint5 = /e\.g\. PSC (\d+), ARR (\d+)/.exec(src);
check('the stage-5 hint names an example', !!hint5, String(hint5 && hint5[0]));
if (hint5) {
  const r = rate(Number(hint5[1]), Number(hint5[2]));
  check('the stage-5 hint example lands in the stage-5 band',
    !!band5 && r >= band5.lo && r <= band5.hi, r + ' Hz vs ' + JSON.stringify(band5));
}

const nest = /TIM2 PSC (\d+) \/ ARR (\d+), TIM3 PSC (\d+) \/ ARR (\d+)/.exec(src);
check("the nesting demo states both timers' PSC/ARR", !!nest, String(nest && nest[0]));
/* The demo has to satisfy two things at once, and they used to fight: the
   higher-priority timer must land while the lower-priority one is still on the
   CPU (that is what a preemption is), AND it must not arrive faster than a
   handler can finish (that is what a deadline is). It was 5 Hz against a
   400 ms handler, so TIM3 overran its own 200 ms period, never left the CPU,
   and TIM2 was dispatched zero times — stage 7's goal (nestCount >= 1) was
   unreachable from stage 7's own one-click demo. Assert the deadline, not a
   magic rate: any pair that outlives PF_ISR_MS is a legitimate demo. */
const isrMs = Number((/PF_ISR_MS\s*=\s*(\d+)/.exec(src) || [])[1]);
if (nest) {
  const t2 = rate(Number(nest[1]), Number(nest[2]));
  const t3 = rate(Number(nest[3]), Number(nest[4]));
  const p2 = 1000 / t2, p3 = 1000 / t3;
  check("the nesting demo's TIM2 is 2 Hz as its label says", t2 === 2, String(t2));
  check('the more urgent timer is the slower one, so it can be overtaken',
    t3 < t2, t2 + ' Hz vs ' + t3 + ' Hz');
  check('both nesting-demo periods outlast the handler, so neither overruns',
    p2 > isrMs && p3 > isrMs, p2.toFixed(0) + ' ms / ' + p3.toFixed(0) + ' ms vs ' + isrMs + ' ms');
}

/* ---- 5. the arm routines write the same values the hints promise ----
   Pattern:  pfWriteReg('TIM2', 'PSC', 9);  pfWriteReg('TIM2', 'ARR', 49);
   The timer name is a backreference so one pattern serves TIM2 and TIM3. */
function armValues(fn, timer) {
  const re = /pfWriteReg\('(TIM[0-9])', 'PSC', (\d+)\)\s*;\s*pfWriteReg\('\1', 'ARR', (\d+)\)/g;
  for (const m of fn.matchAll(re)) {
    if (m[1] === timer) { return { psc: Number(m[2]), arr: Number(m[3]) }; }
  }
  return null;
}
const nestArmFrom = src.indexOf('function pfArmNestDemo');
check('the nesting arm routine exists', nestArmFrom >= 0, 'pfArmNestDemo not found');
const arm = src.slice(nestArmFrom, src.indexOf('function pfArmRaceIsr'));
const armT2 = armValues(arm, 'TIM2');
const armT3 = armValues(arm, 'TIM3');
check('the nesting arm routine writes TIM2 PSC/ARR', !!armT2, 'not found');
check('the nesting arm routine writes TIM3 PSC/ARR', !!armT3, 'not found');
if (armT2 && nest) {
  check('the nesting arm routine agrees with its on-screen TIM2 hint',
    armT2.psc === Number(nest[1]) && armT2.arr === Number(nest[2]),
    JSON.stringify(armT2) + ' vs PSC ' + nest[1] + ' / ARR ' + nest[2]);
}
if (armT3 && nest) {
  check('the nesting arm routine agrees with its on-screen TIM3 hint',
    armT3.psc === Number(nest[3]) && armT3.arr === Number(nest[4]),
    JSON.stringify(armT3) + ' vs PSC ' + nest[3] + ' / ARR ' + nest[4]);
}
if (armT2) {
  check('the TIM2 the arm routine writes is 2 Hz',
    rate(armT2.psc, armT2.arr) === 2, String(rate(armT2.psc, armT2.arr)));
}
if (armT3) {
  const t3 = rate(armT3.psc, armT3.arr);
  check('the TIM3 the arm routine writes keeps its deadline',
    1000 / t3 > isrMs, (1000 / t3).toFixed(0) + ' ms period vs a ' + isrMs + ' ms handler');
}
const raceArm = src.slice(src.indexOf('function pfArmRaceIsr'), src.indexOf('function pfGoStage'));
const raceT2 = armValues(raceArm, 'TIM2');
check('the race ISR arms TIM2', !!raceT2, 'not found');
if (raceT2 && armT2) {
  check('the race ISR uses the same TIM2 rate as the nesting demo',
    raceT2.psc === armT2.psc && raceT2.arr === armT2.arr, JSON.stringify(raceT2) + ' vs ' + JSON.stringify(armT2));
}

if (failures) {
  console.log('\n' + failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nperipheral timer model green (rate maths, tick clock, preset/band/arm drift)');
