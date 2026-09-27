/* Temporary harness: pulls the protocol module out of 20_app.js and drives its
   tick / playback logic without a DOM, to check the scrub refactor. */
const fs = require('fs');
const src = fs.readFileSync('roadmap-source/20_app.js', 'utf8');
const a = src.indexOf('var K_PROTOS = "ecroadmap.protocols.v1";');
const b = src.indexOf('/* ---------------- public API ---------------- */');
if (a < 0 || b < 0) { throw new Error('markers not found'); }
const body = src.slice(a, b);

const doc = {
  getElementById: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ innerHTML: '', style: {}, setAttribute: () => {} })
};
const env = {
  esc: (s) => String(s), wr: () => {}, rd: () => null,
  document: doc, window: { addEventListener: () => {} },
  setInterval: () => 0, Math: Math, JSON: JSON, Array: Array, Object: Object,
  Number: Number, String: String, isNaN: isNaN, parseInt: parseInt
};

const factory = new Function('env',
  'with (env) {\n' + body + '\n' +
  'return { P: () => protos, defaults: prDefaults, load: prLoad, tick: prTick,' +
  ' i2cTick: prI2cTick, spiTick: prSpiTick, finish: prFinishFrame,' +
  ' goStage: prGoStage, animStop: prAnimStop, view: prView, cap: prCap, scrub: prScrub,' +
  ' i2cLive: prI2cLive, spiLive: prSpiLive, uartLive: prUartLive,' +
  ' speedMul: prSpeedMul, speedStep: prSpeedStep,' +
  ' masters: prI2cMasters, txSlots: prI2cTxSlots, srSlots: prI2cSrSlots,' +
  ' spiRecv: prSpiRecv, spiBits: prSpiBits, spiFromBits: prSpiFromBits,' +
  ' ringState: prSpiRingState, ringSrc: prSpiRingSrc, decode: prDecode, uartBits: prUartBits,' +
  ' st: () => ({ anim: _prAnim, cap: _prCap, pos: _prPos }),' +
  ' setInited: (b) => { protocolsInited = b; },' +
  ' setPos: (p) => { _prPos = p; }, setProtos: (p) => { protos = p; } };\n}');

const M = factory(env);
M.load();
M.setInited(true);   /* prTick returns early until the view has been initialised */
const P = M.P();

let fails = 0;
function ok(name, cond, extra) {
  if (!cond) { fails++; console.log('FAIL  ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra))); }
  else { console.log('pass  ' + name); }
}
function sweepTo(kind, target) {
  /* drive ticks until the transfer of that kind finishes */
  let n = 0;
  while (n++ < 500) {
    const st = M.st();
    if (st.cap && st.cap.kind === kind && !st.anim) { break; }
    if (st.cap && st.cap.kind !== kind) { break; }
    M.tick();
  }
  return M.st();
}

/* ---------- 1. I2C: the capture freezes the arbitration trace ---------- */
M.animStop();
P.stage = 5; P.running = true;
P.i2c.m1val = 0xa0; P.i2c.m2val = 0x80;
P.i2c.result = null;
P.i2c.tx = { kind: 'masters', slots: M.masters(0xa0, 0x80).slots, lostAt: M.masters(0xa0, 0x80).lostAt };
const i2cSlotCount = P.i2c.tx.slots.length;
let st = sweepTo('i2c');
ok('i2c capture exists', !!st.cap && st.cap.kind === 'i2c');
ok('i2c capture total = slot count', st.cap.total === i2cSlotCount, { total: st.cap && st.cap.total, slots: i2cSlotCount });
const capTotal = st.cap ? st.cap.total : -1;
ok('i2c capture keeps the arbitration verdict (0xA0 vs 0x80 diverges at bit 1)', P.i2c.result && P.i2c.result.lostAt === 1, P.i2c.result && { lostAt: P.i2c.result.lostAt });
ok('i2c capture is valid right after finishing', M.cap() === st.cap);
ok('i2c live view is gone', M.i2cLive() === null);

/* scrub positions: every whole clock maps onto a slot, loser found at the same index */
let loserIdx = -1;
for (let i = 0; i < st.cap.tx.slots.length; i++) { if (st.cap.tx.slots[i].loser) { loserIdx = i; break; } }
let found = null;
for (let pos = 0; pos <= capTotal; pos++) {
  M.setPos(pos);
  const v = M.i2cLive();
  if (!v || v.pos !== pos || v.tx !== st.cap.tx) { found = { pos, v: v && v.pos }; break; }
}
ok('i2c scrub view is a coherent playback record at every position', found === null, found);
M.setPos(loserIdx + 1);
ok('i2c scrubbing to the loser slot sees it (slot ' + loserIdx + ' = A' + (6 - P.i2c.result.lostAt) + ')',
  loserIdx === P.i2c.result.lostAt + 1, { loserIdx, lostAt: P.i2c.result.lostAt });
M.setPos(null);
ok('i2c scrub off = verdict path, no view', M.i2cLive() === null && M.scrub() === null);

/* changing an input invalidates the capture */
M.setPos(capTotal - 2);
P.i2c.m1val = 0x60;
ok('i2c capture invalidated when the inputs move', M.cap() === null && M.i2cLive() === null);
M.setPos(null);
P.i2c.m1val = 0xa0;

/* ---------- 2. SPI modes: unit/step live in the record, not in stage sniffing ---------- */
M.animStop();
P.stage = 8;
P.spi.mMode = 0; P.spi.sMode = 2; P.spi.byte = 0x3f; P.spi.result = null;
P.spi.tx = { kind: 'modes', m: 0, s: 2, out: 0x3f };
st = sweepTo('spi');
ok('spi modes capture exists', !!st.cap && st.cap.kind === 'spi');
ok('spi modes capture total = 16 half-steps', st.cap.total === 16, st.cap && st.cap.total);
ok('spi modes capture unit = 1', st.cap.unit === 1);
ok('spi modes mismatch recorded', P.spi.result && P.spi.result.got === 0x7e, P.spi.result && { got: P.spi.result.got });
M.setPos(7);
const sv = M.spiLive();
ok('spi scrub carries the captured modes', sv.tx.m === 0 && sv.tx.s === 2 && sv.review === true);
M.setPos(null);

/* ring capture */
M.animStop();
P.stage = 9;
P.spi.tx = { kind: 'ring', out: 0x00, slaveBefore: P.spi.slaveShift };
st = sweepTo('spi');
ok('spi ring capture total = 8 clocks', st.cap.total === 8, st.cap && st.cap.total);
ok('spi ring capture unit = 2 (clocks -> half-steps)', st.cap.unit === 2);
/* ring geometry at the scrubber, k = 0/1/4/8, against the known swap */
const outB = M.spiBits(st.cap.tx.out), sbB = M.spiBits(st.cap.tx.slaveBefore);
[0, 1, 4, 8].forEach(function (k) {
  M.setPos(k);
  const src = M.ringSrc(P), got = M.ringState({ tx: st.cap.tx }, k);
  const expM = [], expS = [];
  for (let i = 0; i < 8; i++) { expM.push(i < 8 - k ? outB[i + k] : sbB[i - (8 - k)]); expS.push(i < 8 - k ? sbB[i + k] : outB[i - (8 - k)]); }
  ok('ring state at k=' + k + ' matches the swap model',
    JSON.stringify(got.master) === JSON.stringify(expM) && JSON.stringify(got.slave) === JSON.stringify(expS),
    { k, got: got.master.join(''), exp: expM.join('') });
});
ok('ring scrub source follows the capture, not live registers', M.ringSrc(P).out === st.cap.tx.out);
M.setPos(null);

/* ---------- 3. UART: idx sequence unchanged at 1x, position is fractional under the hood ---------- */
M.animStop();
P.stage = 2;
P.uart.data = 8; P.uart.parity = 'none'; P.uart.stop = 1; P.uart.drift = 0;
P.uart.char = 0x48; P.uart.queue = []; P.uart.tx = null; P.uart.sent = 0;
P.uart.tx = { bits: M.uartBits(P.uart, 0x48), ch: 0x48, idx: 0, pos: 0, drift: 0 };
const seen = [];
const len = P.uart.tx.bits.length;
for (let i = 0; i < len + 2 && P.uart.tx; i++) {
  M.tick();
  if (P.uart.tx) { seen.push(P.uart.tx.idx); }
}
ok('uart idx walks 1..len-1 in whole steps at 1x', JSON.stringify(seen) === JSON.stringify(Array.from({ length: len - 1 }, (_, i) => i + 1)), seen);
ok('uart frame finished and produced a capture', !!M.st().cap && M.st().cap.kind === 'uart');
ok('uart capture froze the decode', M.st().cap.dec.ok === true && M.st().cap.dec.ch === 0x48, M.st().cap && M.st().cap.dec);
M.setPos(3);
const uv = M.uartLive();
ok('uart scrub view exposes bits + drift from the capture', uv.tx.drift === 0 && uv.tx.bits.length === len && uv.pos === 3);
M.setPos(null);

/* speed multiplier: at 1/2x the same frame takes twice as many ticks */
P.speed = 0.5;
P.uart.tx = { bits: M.uartBits(P.uart, 0x48), ch: 0x48, idx: 0, pos: 0, drift: 0 };
let ticks = 0;
while (P.uart.tx && ticks < 200) { M.tick(); ticks++; }
P.speed = 1;
P.uart.tx = { bits: M.uartBits(P.uart, 0x48), ch: 0x48, idx: 0, pos: 0, drift: 0 };
let ticks1x = 0;
while (P.uart.tx && ticks1x < 200) { M.tick(); ticks1x++; }
ok('1/2x takes exactly twice as many ticks as 1x', ticks === ticks1x * 2, { half: ticks, full: ticks1x, len });
ok('speed cycles 1 -> 1/2 -> 1/4 -> 1', (function () {
  P.speed = 1; M.speedStep(); const s1 = P.speed; M.speedStep(); const s2 = P.speed; M.speedStep(); const s3 = P.speed;
  return s1 === 0.5 && s2 === 0.25 && s3 === 1;
})());

/* ---------- 4. stage change + reset drop the capture ---------- */
P.stage = 5; M.setPos(4); P.i2c.tx = null; P.i2c.result = null;
M.goStage(6);
ok('stage change clears animation, capture and scrub cursor', (function () {
  const s = M.st(); return s.anim === null && s.cap === null && s.pos === null;
})());
ok('after goStage the view is empty', M.view() === null);

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nall green');
process.exit(fails ? 1 : 0);
