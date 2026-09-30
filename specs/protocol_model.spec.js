/* Model spec for the Protocol Lab (24_lab_protocols.js).
 *
 * Zero dependencies. Run with:  node specs/protocol_model.spec.js
 *
 * The lab is a teaching model, which makes its arithmetic load-bearing: if the
 * level resolver or the UART sampler is wrong, the app teaches a wrong thing with
 * total confidence. These functions are pure (they take their state as arguments),
 * so they can be sliced out of the fragment and checked directly — no browser, no
 * DOM, exactly like the other specs here.
 *
 * Covered: the pin-level resolver that every protocol stage is built on, the
 * two-driver wired-AND, UART frame construction (start/parity/stop, LSB first),
 * the receiver's drifting sample points, the CAN dominant/recessive arbitration
 * and CRC/stuffing encoder, and I2C clock stretching.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '24_lab_protocols.js'), 'utf8');
const from = src.indexOf('/* ---- models ---- */');
const to = src.indexOf('/* ---- logic-analyser primitive');
if (from < 0 || to < 0 || to < from) { throw new Error('model markers not found in 24_lab_protocols.js'); }
const ctx = vm.createContext({});
vm.runInContext(src.slice(from, to) +
  '\nthis.prResolve=prResolve; this.prWireResolve=prWireResolve; this.prUartBits=prUartBits;' +
  '\nthis.prRxSamples=prRxSamples; this.prDecode=prDecode; this.prCharLabel=prCharLabel; this.prHex=prHex;' +
  '\nthis.prHex3=prHex3; this.prCanBus=prCanBus; this.prCanIdBits=prCanIdBits; this.prCanArb=prCanArb;' +
  '\nthis.prCanCrc=prCanCrc; this.prCanStuff=prCanStuff; this.prCanFrame=prCanFrame; this.prStretchInsert=prStretchInsert;', ctx);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('pass  ' + name); return; }
  failures++;
  console.log('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
}

/* ---- 1. one pin: the whole lab rests on this table ---- */
const resolve = ctx.prResolve;
check('push-pull drives high and low', resolve('push', 1, 'none') === 'high' && resolve('push', 0, 'none') === 'low');
check('open-drain with ODR=0 sinks low whatever the pull', resolve('od', 0, 'none') === 'low' && resolve('od', 0, 'up') === 'low');
check('open-drain released is high only because of the pull-up', resolve('od', 1, 'up') === 'high');
check('open-drain released with a pull-down reads low', resolve('od', 1, 'down') === 'low');
check('open-drain released with no pull floats (the I2C failure)', resolve('od', 1, 'none') === 'float');
check('an input follows its pull resistor', resolve('in', 0, 'up') === 'high' && resolve('in', 0, 'down') === 'low');
check('an unpulled input floats', resolve('in', 0, 'none') === 'float');

/* ---- 2. two drivers on one wire (wired-AND) ---- */
check('any driver sinking pulls the whole bus low',
  ctx.prWireResolve(0, 1) === 'low' && ctx.prWireResolve(1, 0) === 'low' && ctx.prWireResolve(0, 0) === 'low');
check('the bus is high only when both release', ctx.prWireResolve(1, 1) === 'high');

/* ---- 3. UART framing ---- */
function cfg(over) {
  return Object.assign({ data: 8, parity: 'none', stop: 1 }, over || {});
}
check('8N1 frame is 10 bits', ctx.prUartBits(cfg(), 0x41).length === 10);
check('the frame opens with a start bit of 0', ctx.prUartBits(cfg(), 0x41)[0].v === 0 && ctx.prUartBits(cfg(), 0x41)[0].k === 'start');
check('a 2-stop frame is 11 bits', ctx.prUartBits(cfg({ stop: 2 }), 0x41).length === 11);
check('parity adds exactly one bit', ctx.prUartBits(cfg({ parity: 'even' }), 0x41).length === 11);

/* 'A' = 0x41 = 0b0100_0001: D0..D7 = 1,0,0,0,0,0,1,0 — sent LSB first. */
const a = ctx.prUartBits(cfg(), 0x41);
check("'A' travels LSB first", a[1].v === 1 && a[2].v === 0 && a[7].v === 1 && a[8].v === 0,
  a.map((b) => b.l + '=' + b.v).join(' '));
check('stop bit is 1', a[9].v === 1 && a[9].k === 'stop');
/* ones in 0x41 = 2 (even), so even parity is 0 and odd parity is 1. */
check('even parity bit for an even number of ones is 0', ctx.prUartBits(cfg({ parity: 'even' }), 0x41)[9].v === 0);
check('odd parity bit for the same byte is 1', ctx.prUartBits(cfg({ parity: 'odd' }), 0x41)[9].v === 1);

/* ---- 4. the receiver's sample points ---- */
const bits = ctx.prUartBits(cfg(), 0x41);
const clean = ctx.prRxSamples(bits, 0);
check('at zero drift every sample sits in its own bit window',
  clean.every((s) => s.bad === false && s.idx === s.i), JSON.stringify(clean));
check('sample points start half a bit into each window', clean[0].pos === 0.5 && clean[1].pos === 1.5);

const decoded = ctx.prDecode(bits, cfg(), 0);
check('a clean frame decodes to the sent byte', decoded.ch === 0x41, JSON.stringify(decoded));
check('a clean frame is reported ok', decoded.ok === true && decoded.mis === 0 && decoded.startOk && decoded.parityOk);

/* Drift is the stage-3 lesson: the error accumulates, so the last bits break first.
   That claim is only true if more drift never *reduces* the number of mis-samples. */
const misAt = [0, 2, 4, 6, 8, 10, 16, 24, 40].map((d) => ctx.prDecode(bits, cfg(), d).mis);
check('more drift never fixes a sample', misAt.every((m, i) => i === 0 || m >= misAt[i - 1]), JSON.stringify(misAt));
check('zero drift mis-samples nothing', misAt[0] === 0, JSON.stringify(misAt));
check('moderate drift mis-samples something (the slider does its job)', ctx.prDecode(bits, cfg(), 10).mis > 0,
  JSON.stringify(misAt));
check('the first break happens near the stop bit, not the start bit',
  ctx.prRxSamples(bits, 6).filter((s) => s.bad).map((s) => s.i).every((i) => i >= 8),
  JSON.stringify(ctx.prRxSamples(bits, 6).filter((s) => s.bad).map((s) => s.i)));

/* ---- 5. small display helpers ---- */
check('printable bytes render as characters', ctx.prCharLabel(0x41) === 'A');
check('control bytes get a name', ctx.prCharLabel(0x0d) === '\\r' && ctx.prCharLabel(0) === 'NUL');
check('other bytes fall back to hex', ctx.prCharLabel(0x1f) === '0x1F');
check('prHex pads and upper-cases', ctx.prHex(0x50) === '0x50' && ctx.prHex(0) === '0x0');

/* ---- 6. CAN: dominant beats recessive, so the smaller ID owns the bus ----
   CAN is the one bus in the lab where the wire itself decides who talks. The
   load-bearing claim is "the numerically smaller ID always wins", which is only
   true if 0 dominates and both nodes are compared MSB first. */
const bus = ctx.prCanBus;
check('the pair reads dominant when anyone drives, recessive only when nobody does',
  bus(0, 0) === 0 && bus(0, 1) === 0 && bus(1, 0) === 0 && bus(1, 1) === 1);
check('an 11-bit ID is compared MSB first', ctx.prCanIdBits(0x100).join('') === '00100000000' && ctx.prCanIdBits(0x200).join('') === '01000000000',
  ctx.prCanIdBits(0x100).join(''));
check('prHex3 keeps an 11-bit ID three hex digits', ctx.prHex3(0x0) === '0' && ctx.prHex3(0x123) === '123' && ctx.prHex3(0x7ff) === '7FF');

const arbPairs = [[0x000, 0x7ff], [0x100, 0x200], [0x123, 0x2ab], [0x400, 0x401]];
check('the smaller ID wins every race',
  arbPairs.every(([a, b]) => {
    const r = ctx.prCanArb(a, b);
    return r.winner === 'A' && r.lower === 'A' && r.loser === 'B';
  }),
  arbPairs.map(([a, b]) => JSON.stringify({ p: a + '/' + b, r: ctx.prCanArb(a, b) })).join(' '));
check('swapping the two IDs swaps the winner', arbPairs.every(([a, b]) => ctx.prCanArb(b, a).winner === 'B'));
check('the race is decided on the loser\u2019s recessive bit, not before',
  arbPairs.every(([a, b]) => {
    const r = ctx.prCanArb(a, b), at = r.bits[r.lostAt];
    const mine = r.loser === 'A' ? at.a : at.b;
    const theirs = r.loser === 'A' ? at.b : at.a;
    return at.bus === 0 && mine === 1 && theirs === 0 && at.loser === r.loser;
  }));
check('nothing diverges before the losing bit',
  arbPairs.every(([a, b]) => {
    const r = ctx.prCanArb(a, b);
    return r.bits.every((x, i) => i >= r.lostAt || x.a === x.b);
  }));
check('arbitration opens with a dominant SOF and ends at the RTR bit',
  (() => { const r = ctx.prCanArb(0x123, 0x2ab); return r.bits.length === 13 && r.bits[0].l === 'SOF' && r.bits[0].bus === 0 && r.bits[12].l === 'RTR'; })());
const same = ctx.prCanArb(0x123, 0x123);
check('two nodes with the same ID do not arbitrate at all', same.lostAt < 0 && same.same === true && same.winner === null,
  JSON.stringify(same));

/* ---- 7. the CAN encoder: CRC over the fields, then stuffing over both ---- */
const fr = ctx.prCanFrame(0x123, 2, [0xde, 0xad], true);
const field = (k) => fr.filter((b) => b.k === k);
check('a two-byte frame is 63 bits of fields', fr.length === 63, fr.length);
check('it opens with one dominant SOF bit', fr[0].k === 'sof' && fr[0].v === 0);
check('the ID on the wire is the ID you asked for, MSB first',
  field('id').map((b) => b.v).join('') === ctx.prCanIdBits(0x123).join(''));
check('one RTR/IDE/r0 bit each, all dominant for a standard data frame',
  field('rtr').length === 1 && field('ide').length === 1 && field('r0').length === 1 &&
  field('rtr')[0].v === 0 && field('ide')[0].v === 0);
check('the 4-bit DLC carries the length', field('dlc').map((b) => b.v).join('') === '0010', field('dlc').map((b) => b.v).join(''));
check('the payload is 8 bits per byte, most significant bit first',
  field('data').length === 16 && field('data').slice(0, 8).map((b) => b.v).join('') === '11011110' &&
  field('data').slice(8).map((b) => b.v).join('') === '10101101');
check('exactly 15 CRC bits sit between the payload and the delimiter',
  field('crc').length === 15 && fr[fr.length - 1].k === 'ifs');
check('a receiver that heard it pulls the ACK slot dominant', field('ack')[0].v === 0);
check('with nobody listening the ACK slot stays recessive',
  ctx.prCanFrame(0x123, 2, [0xde, 0xad], false).filter((b) => b.k === 'ack')[0].v === 1);
check('the frame closes with seven recessive EOF bits and three of silence',
  field('eof').length === 7 && field('eof').every((b) => b.v === 1) && field('ifs').length === 3);

/* the CRC is the receiver's only reason to trust the frame: same bits, same
   checksum; one flipped payload bit, a different one */
/* the CRC covers SOF..DATA and nothing else: feeding it its own field back would
   cancel out, which is exactly the mistake this helper would let a reader make */
const crcInput = (frame) => frame.slice(0, frame.findIndex((b) => b.k === 'crc'));
const crcOf = (frame) => ctx.prCanCrc(crcInput(frame));
check('the CRC is stable for identical traffic', crcOf(fr) === crcOf(ctx.prCanFrame(0x123, 2, [0xde, 0xad], true)));
check('flipping one payload bit changes the CRC', crcOf(fr) !== crcOf(ctx.prCanFrame(0x123, 2, [0xde, 0xae], true)));
check('the frame carries the CRC-15 its own transmitter computed over SOF..DATA',
  field('crc').map((b) => b.v).join('') === crcOf(fr).toString(2).padStart(15, '0'),
  field('crc').map((b) => b.v).join('') + ' vs ' + crcOf(fr).toString(2).padStart(15, '0'));

/* stuffing is an encoding rule, so the invariant is about the wire: after five
   identical bits one of the opposite value must appear */
const maxRun = (bits) => {
  let run = 0, prev = null, most = 0;
  for (const b of bits) { if (prev !== null && b.v === prev) { run++; } else { run = 1; prev = b.v; } most = Math.max(most, run); }
  return most;
};
const stuffedRegion = (bits) => bits.slice(0, bits.findIndex((b) => b.k === 'crcdel'));
const stuffedZero = ctx.prCanStuff(ctx.prCanFrame(0x000, 0, [], true));
check('a long dominant run forces stuff bits onto the wire', stuffedZero.stuff >= 3, stuffedZero.stuff);
check('every inserted bit is the opposite of the five it follows',
  (() => {
    const out = stuffedZero.bits, s = out.filter((b) => b.stuff);
    return s.length === stuffedZero.stuff && s.every((b) => {
      const i = out.indexOf(b);
      return i >= 5 && [1, 2, 3, 4, 5].every((d) => out[i - d].v === 1 - b.v);
    });
  })());
check('no six identical bits survive in the stuffable part of any frame',
  [ctx.prCanFrame(0x000, 0, [], true), ctx.prCanFrame(0x7ff, 2, [0xff, 0xff], true), ctx.prCanFrame(0x123, 2, [0xde, 0xad], true)]
    .every((f) => maxRun(stuffedRegion(ctx.prCanStuff(f).bits)) <= 5),
  [ctx.prCanFrame(0x000, 0, [], true), ctx.prCanFrame(0x7ff, 2, [0xff, 0xff], true)]
    .map((f) => maxRun(stuffedRegion(ctx.prCanStuff(f).bits))).join());
check('stuffing changes the stream length but not the fields it wraps',
  ctx.prCanStuff(fr).bits.filter((b) => b.k !== 'stuff').length === fr.length);

/* ---- 8. I2C clock stretching: extra time, never extra bits ---- */
const slots = [{ sda: 0, scl: 1, lab: 'A', kind: 'ack' }, { sda: 0, scl: 1, lab: 'D7', kind: 'data' }, { sda: 1, scl: 0, lab: 'P', kind: 'stop' }];
const stretched = ctx.prStretchInsert(slots, 1, 3);
check('a stretch adds slots without removing any', stretched.length === slots.length + 3);
check('the held slots are SCL low and carry no symbol',
  stretched.slice(1, 4).every((s) => s.scl === 0 && s.kind === 'stretch' && s.sda === 1));
check('the transfer resumes in the same order afterwards',
  stretched.slice(0, 1).concat(stretched.slice(4)).map((s) => s.lab).join() === slots.map((s) => s.lab).join());
const noStretch = ctx.prStretchInsert(slots, 1, 0);
check('a zero stretch is a copy, not the same array', noStretch.length === slots.length && noStretch !== slots);

if (failures) {
  console.log('\n' + failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nprotocol model green (levels, wired-AND, UART framing and drift, CAN arbitration/CRC/stuffing, I2C stretching)');
