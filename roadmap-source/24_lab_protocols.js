  /* ---------------- protocol lab (N17) — logic analyser + line physics + UART ---------------- */
  var K_PROTOS = "ecroadmap.protocols.v1";
  var PR_TICK_MS = 120;
  var PR_LOG_MAX = 60;
  var PR_PIN = 5;                 /* the wire the line-physics rig drives, PA5 */
  var protocolsInited = false;

  var PR_STAGE_META = [
    { id: 1, fam: "basics", name: "Signals 101",    tag: "drive + pull = level" },
    { id: 7, fam: "basics", name: "Protocol map",    tag: "what every protocol shares" },
    { id: 2, fam: "uart",   name: "The frame",       tag: "one byte on a wire" },
    { id: 3, fam: "uart",   name: "Sampling & baud", tag: "the receiver's clock" },
    { id: 4, fam: "uart",   name: "Terminal",        tag: "type -> frame -> decode" },
    { id: 5, fam: "i2c",    name: "I2C: shared wire", tag: "wired-AND arbitration" },
    { id: 6, fam: "i2c",    name: "I2C: address + ACK", tag: "who is this for?" },
    { id: 10, fam: "i2c",   name: "I2C: clock stretching", tag: "the slave can stall the clock" },
    { id: 8, fam: "spi",    name: "SPI: four modes", tag: "CPOL/CPHA pick the edge" },
    { id: 9, fam: "spi",    name: "SPI: the shift ring", tag: "you read last transaction" },
    { id: 11, fam: "can",   name: "CAN: dominant wins", tag: "0 beats 1, the ID is the priority" },
    { id: 12, fam: "can",   name: "CAN: the frame", tag: "stuffing, CRC, one ACK slot" }
  ];
  var PR_FAMILIES = [
    { id: "basics", name: "Basics", blurb: "levels, timing, the shared vocabulary" },
    { id: "uart",   name: "UART",   blurb: "agreed clock, one wire each way" },
    { id: "i2c",    name: "I\u00b2C",    blurb: "shared clock, shared data, addressing" },
    { id: "spi",    name: "SPI",    blurb: "clocked by the sender, full duplex by physics" },
    { id: "can",    name: "CAN",    blurb: "one differential pair, everyone listens, IDs arbitrate" }
  ];
  function prStageById(n) {
    for (var i = 0; i < PR_STAGE_META.length; i++) { if (PR_STAGE_META[i].id === n) { return PR_STAGE_META[i]; } }
    return null;
  }
  function prFamOfStage(n) { var m = prStageById(n); return m ? m.fam : "basics"; }
  function prStagesInFam(f) {
    return PR_STAGE_META.filter(function (s) { return s.fam === f; });
  }
  function prFamById(f) {
    for (var i = 0; i < PR_FAMILIES.length; i++) { if (PR_FAMILIES[i].id === f) { return PR_FAMILIES[i]; } }
    return PR_FAMILIES[0];
  }
  function prFamDoneCount(f) {
    var n = 0; prStagesInFam(f).forEach(function (s) { if (protos.goals[s.id]) { n++; } }); return n;
  }

  function prDefaults() {
    return {
      running: true, simMs: 0, stage: 1, speed: 1,
      sig:   { drive: "push", out: 1, pull: "none" },
      wire:  { aOut: 1, bOut: 0 },
      uart:  { data: 8, parity: "none", stop: 1, baud: 9600, clk: 8000000, char: 0x48, drift: 0, tx: null, queue: [], sent: 0, errSeen: false, last: null },
      i2c:   { addr: 0x50, rw: 0, tx: null, sends: 0, collisions: 0, acked: 0, competitor: false, abort: false, m1val: 0xa0, m2val: 0x80, result: null, aOut: 1, bOut: 0,
               stretch: 3, stretches: 0 },
      spi:   { byte: 0x3f, mMode: 0, sMode: 0, tx: null, sends: 0, mismatches: 0, okReads: 0, lastGot: null, result: null, slaveShift: 0xca, slavePar: 0x2c, masterIn: null, exchanges: 0, staleSeen: false, freshRead: false },
      can:   { idA: 0x123, idB: 0x2ab, id: 0x123, dlc: 2, d0: 0xde, d1: 0xad, stuff: true, receiver: true, drive: 1,
               tx: null, arbs: 0, frames: 0, acks: 0, nacks: 0, stuffSeen: false, winnerId: null, loserId: null, result: null },
      seen:  {},
      rxLog: [],
      goals: {},
      log: []
    };
  }
  var protos = prDefaults();

  function prLoad() {
    var s = rd(K_PROTOS, null), d = prDefaults();
    if (!s || typeof s !== "object") { protos = d; prSeedLog(); return; }
    ["sig", "wire", "uart", "i2c", "spi", "can"].forEach(function (g) {
      if (s[g] && typeof s[g] === "object") { for (var f in d[g]) { if (!(f in s[g])) { s[g][f] = d[g][f]; } } }
      else { s[g] = JSON.parse(JSON.stringify(d[g])); }
    });
    /* a half-frame is never worth restoring */
    s.uart.tx = null; s.uart.queue = []; s.i2c.tx = null; s.spi.tx = null; s.can.tx = null;
    if (typeof s.uart.char !== "number") { s.uart.char = d.uart.char; }
    if (typeof s.uart.drift !== "number") { s.uart.drift = 0; }
    if (typeof s.uart.baud !== "number") { s.uart.baud = d.uart.baud; }
    if (typeof s.uart.data !== "number") { s.uart.data = 8; }
    if (!Array.isArray(s.rxLog)) { s.rxLog = []; }
    if (!Array.isArray(s.log)) { s.log = []; }
    if (!s.goals || typeof s.goals !== "object") { s.goals = {}; }
    if (typeof s.stage !== "number" || !prStageById(s.stage)) { s.stage = 1; }
    if (typeof s.i2c.stretch !== "number" || s.i2c.stretch < 0 || s.i2c.stretch > 6) { s.i2c.stretch = d.i2c.stretch; }
    if (typeof s.can.id !== "number" || s.can.id < 0 || s.can.id > 0x7ff) { s.can.id = d.can.id; }
    if (typeof s.can.dlc !== "number" || s.can.dlc < 0 || s.can.dlc > 8) { s.can.dlc = d.can.dlc; }
    if (s.speed !== 0.5 && s.speed !== 0.25) { s.speed = 1; }
    if (!s.seen || typeof s.seen !== "object") { s.seen = {}; }
    for (var k in d) { if (!(k in s)) { s[k] = d[k]; } }
    protos = s;
  }
  function prSeedLog() {
    if (!protos.log.length) { prLog('note', 'Protocol lab ready. Start at Signals 101 — the level on a wire is physics, not magic.'); }
  }
  function prSave() { wr(K_PROTOS, protos); }
  function prLog(kind, msg) {
    protos.log.push({ t: protos.simMs, k: kind, m: msg });
    if (protos.log.length > PR_LOG_MAX) { protos.log.shift(); }
  }

  /* ---- models ---- */
  function prResolve(drive, out, pull) {
    if (drive === "push") { return out ? "high" : "low"; }           /* actively drives both ways */
    if (drive === "od" && !out) { return "low"; }                    /* NMOS on: sinks */
    /* od released, or an input: high-Z, only the pull decides */
    if (pull === "up") { return "high"; }
    if (pull === "down") { return "low"; }
    return "float";
  }
  function prWireResolve(aOut, bOut) {
    if (!aOut || !bOut) { return "low"; }        /* any driver sinking pulls the whole bus low */
    return "high";                                /* both released -> pull-up wins */
  }
  function prUartBits(u, ch) {
    var bits = [{ v: 0, k: "start", l: "Start" }];
    for (var i = 0; i < u.data; i++) { bits.push({ v: (ch >>> i) & 1, k: "data", l: "D" + i }); }
    if (u.parity !== "none") {
      var ones = 0;
      for (var j = 0; j < u.data; j++) { ones += (ch >>> j) & 1; }
      var p = (u.parity === "even") ? (ones & 1) : (1 - (ones & 1));
      bits.push({ v: p, k: "parity", l: u.parity === "even" ? "Even" : "Odd" });
    }
    for (var s = 0; s < u.stop; s++) { bits.push({ v: 1, k: "stop", l: "Stop" }); }
    return bits;
  }
  function prRxSamples(bits, drift) {
    var out = [];
    for (var i = 0; i < bits.length; i++) {
      var pos = i + 0.5 + i * (drift / 100);      /* sample point drifts further each bit */
      var idx = Math.floor(pos);
      var lvl = (idx >= 0 && idx < bits.length) ? bits[idx].v : 1;
      out.push({ i: i, pos: pos, idx: idx, v: lvl, bad: idx !== i });
    }
    return out;
  }
  function prDecode(bits, u, drift) {
    var smp = prRxSamples(bits, drift), mis = 0, i;
    for (i = 0; i < smp.length; i++) { if (smp[i].bad) { mis++; } }
    var ch = 0, startOk = smp[0] && smp[0].v === 0;
    for (i = 0; i < u.data; i++) { if (smp[1 + i] && smp[1 + i].v) { ch |= (1 << i); } }
    var parityOk = true, pIdx = 1 + u.data;
    if (u.parity !== "none" && smp[pIdx]) {
      var ones = 0; for (i = 0; i < u.data; i++) { ones += (ch >>> i) & 1; }
      var expect = u.parity === "even" ? (ones & 1) : (1 - (ones & 1));
      parityOk = (smp[pIdx].v === expect);
    }
    return { ch: ch, mis: mis, startOk: startOk, parityOk: parityOk, ok: mis === 0 && startOk && parityOk };
  }
  function prCharLabel(c) {
    if (c >= 0x20 && c < 0x7f) { return String.fromCharCode(c); }
    var names = { 0x0d: "\\r", 0x0a: "\\n", 0x09: "\\t", 0x00: "NUL" };
    return names[c] != null ? names[c] : "0x" + c.toString(16).toUpperCase();
  }
  function prHex(v) { return "0x" + (v >>> 0).toString(16).toUpperCase(); }
  function prHex3(v) { return (v & 0x7ff).toString(16).toUpperCase(); }

  /* ---- CAN: the wire is an AND of intent, and 0 is the stronger bit ----
     CAN is UART framing on a differential pair with arbitration bolted on. A node
     that writes a dominant 0 pulls the pair apart; a recessive 1 is simply "nobody
     is driving". So the bus reads the AND of what every node allows (prCanBus),
     and a sender that wrote 1 and reads 0 knows another node owns this message -
     it stops mid-frame and becomes a receiver, without disturbing the winner. */
  function prCanBus(a, b) { return a & b; }                    /* 0 = dominant, wins over 1 */
  function prCanIdBits(id) { var b = [], i; for (i = 10; i >= 0; i--) { b.push((id >>> i) & 1); } return b; }
  function prCanArb(a, b) {
    /* SOF is already on the wire and is dominant for everyone; the ID follows MSB
       first, then RTR (dominant for a data frame). Two nodes transmit in lockstep
       and every one of them hears the bus bit it just wrote. */
    var A = [0].concat(prCanIdBits(a)).concat([0]), B = [0].concat(prCanIdBits(b)).concat([0]);
    var bits = [], lostAt = -1, loser = null, i, bus, l;
    for (i = 0; i < A.length; i++) {
      bus = prCanBus(A[i], B[i]); l = null;
      if (lostAt < 0 && A[i] === 1 && bus === 0) { loser = 'A'; lostAt = i; l = 'A'; }
      else if (lostAt < 0 && B[i] === 1 && bus === 0) { loser = 'B'; lostAt = i; l = 'B'; }
      bits.push({ a: A[i], b: B[i], bus: bus, loser: l, l: i === 0 ? 'SOF' : i <= 11 ? 'ID' + (11 - i) : 'RTR' });
    }
    return { bits: bits, lostAt: lostAt, loser: loser, same: lostAt < 0,
             winner: loser === 'A' ? 'B' : loser === 'B' ? 'A' : null,
             /* 0 is dominant, so the smaller number is the more insistent message */
             lower: (lostAt < 0) ? null : (a < b ? 'A' : 'B') };
  }
  var PR_CAN_CRC_POLY = 0x4599;     /* x^15+x^14+x^10+x^8+x^7+x^4+x^3+1 */
  function prCanCrc(bits) {
    /* CRC-15 over everything from SOF up to (not including) the CRC delimiter,
       with stuff bits already removed - the receiver can only check it because it
       deletes them before the shift register sees them. */
    var crc = 0, i, msb;
    for (i = 0; i < bits.length; i++) {
      if (bits[i].k === 'crcdel' || bits[i].k === 'ack') { break; }
      msb = ((crc >>> 14) & 1) ^ (bits[i].v & 1);
      crc = (crc << 1) & 0x7fff;
      if (msb) { crc ^= PR_CAN_CRC_POLY; }
    }
    return crc & 0x7fff;
  }
  /* Bit stuffing: after five identical bits in a row the sender inserts the
     opposite one, so a receiver can never lose the clock on a long silent run.
     The receiver deletes each insertion without being told which bits they are -
     the rule is the encoding. Not applied to the delimiter/ACK/EOF fields. */
  function prCanStuff(bits) {
    var out = [], run = 0, prev = null, stuff = 0, i, b;
    for (i = 0; i < bits.length; i++) {
      b = bits[i];
      if (prev !== null && b.v === prev) { run++; } else { run = 1; prev = b.v; }
      out.push(b);
      if (b.stuffable !== false && run === 5) {
        out.push({ v: 1 - b.v, k: 'stuff', l: 'S', stuff: true, stuffable: false });
        stuff++; run = 0; prev = null;     /* the next real bit starts a fresh run */
      }
    }
    return { bits: out, stuff: stuff };
  }
  function prCanFrame(id, dlc, bytes, acked) {
    /* One standard 11-bit data frame, field by field, MSB first. Stuffing is NOT
       applied here: this is what the transmitter means, before the encoder makes
       the wire self-clocking. */
    var f = [], i, j, b;
    function add(v, k, l, extra) {
      var o = { v: v, k: k, l: l };
      if (extra) { for (var x in extra) { o[x] = extra[x]; } }
      f.push(o);
    }
    add(0, 'sof', 'SOF');
    var ib = prCanIdBits(id);
    for (i = 0; i < 11; i++) { add(ib[i], 'id', 'ID' + (10 - i)); }
    add(0, 'rtr', 'RTR');                        /* data frame: dominant */
    add(0, 'ide', 'IDE');                        /* standard 11-bit identifier */
    add(0, 'r0', 'r0');                          /* reserved, dominant */
    for (i = 3; i >= 0; i--) { add((dlc >>> i) & 1, 'dlc', 'DLC' + i); }
    for (i = 0; i < dlc; i++) {
      b = (bytes && bytes[i] != null ? bytes[i] : 0) & 0xff;
      for (j = 7; j >= 0; j--) { add((b >>> j) & 1, 'data', 'D' + i + '.' + j); }
    }
    var crc = prCanCrc(f);
    for (i = 14; i >= 0; i--) { add((crc >>> i) & 1, 'crc', 'CRC' + i); }
    add(1, 'crcdel', 'del', { stuffable: false });
    add(acked ? 0 : 1, 'ack', acked ? 'ACK' : 'nACK', { stuffable: false });
    add(1, 'ackdel', 'del', { stuffable: false });
    for (i = 0; i < 7; i++) { add(1, 'eof', 'EOF', { stuffable: false }); }
    for (i = 0; i < 3; i++) { add(1, 'ifs', 'IFS', { stuffable: false }); }
    return f;
  }

  /* ---- I2C back-pressure: the slave owns SCL low until it is ready ----
     A clock period is only a promise, not a metronome: whoever holds SCL low is
     saying "not yet". Inserting extra SCL-low slots is exactly how a slow slave
     (an EEPROM writing a page, a sensor converting) makes a fast master wait. */
  function prStretchInsert(slots, at, len) {
    if (!(len > 0)) { return slots.slice(); }
    var out = slots.slice(0, at), i;
    for (i = 0; i < len; i++) { out.push({ sda: 1, scl: 0, lab: '\u22ee', kind: 'stretch' }); }
    return out.concat(slots.slice(at));
  }

  /* ---- logic-analyser primitive: one shared waveform+decoder for every protocol ---- */
  var _prLA = null;   /* { n, left, cw } so prRenderLive can park / move the playhead */
  function prLA(cfg) {
    var bits = cfg.bits, n = bits.length;
    var W = 300, H = 150, left = 40, right = 8, yH = 34, yL = 62, bTop = 84, bH = 24;
    var cw = (W - left - right) / n;
    _prLA = { n: n, left: left, cw: cw };
    var pts = "", prevY = yH, i;
    for (i = 0; i < n; i++) {
      var y = bits[i].v ? yH : yL, x0 = left + i * cw, x1 = x0 + cw;
      pts += x0.toFixed(1) + "," + prevY + " " + x0.toFixed(1) + "," + y + " " + x1.toFixed(1) + "," + y + " ";
      prevY = y;
    }
    var boxes = "";
    for (i = 0; i < n; i++) {
      var bx = left + i * cw;
      boxes += '<rect class="segbox ' + bits[i].k + '" x="' + (bx + 0.5).toFixed(1) + '" y="' + bTop + '" width="' + (cw - 1).toFixed(1) + '" height="' + bH + '"/>' +
        '<text class="seglab" x="' + (bx + cw / 2).toFixed(1) + '" y="' + (bTop + bH / 2 + 2.6).toFixed(1) + '">' + esc(bits[i].l) + '</text>';
    }
    var marks = "";
    if (cfg.showSamples) {
      for (i = 0; i < n; i++) {
        var pos = i + 0.5 + i * ((cfg.drift || 0) / 100);
        if (pos < 0 || pos > n) { continue; }
        var sx = left + pos * cw, bad = Math.floor(pos) !== i;
        marks += '<line class="grid" x1="' + sx.toFixed(1) + '" y1="' + (yH - 6) + '" x2="' + sx.toFixed(1) + '" y2="' + (yL + 6) + '"/>' +
          '<circle class="smp' + (bad ? ' bad' : '') + '" cx="' + sx.toFixed(1) + '" cy="' + ((yH + yL) / 2) + '" r="2.8"/>';
      }
    }
    var playX = left + Math.max(0, Math.min(cfg.playIdx == null ? 0 : cfg.playIdx, n)) * cw;
    var play = '<line id="pr-play" class="play" opacity="' + (cfg.playIdx == null ? '0' : '1') + '" x1="' + playX.toFixed(1) + '" y1="' + (yH - 8) + '" x2="' + playX.toFixed(1) + '" y2="' + (bTop + bH) + '"/>';
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '">' +
      '<text class="clab" x="6" y="' + ((yH + yL) / 2 + 3) + '">' + esc(cfg.label || 'TX') + '</text>' +
      '<line class="grid" x1="' + left + '" y1="' + yH + '" x2="' + (W - right) + '" y2="' + yH + '"/>' +
      '<line class="grid" x1="' + left + '" y1="' + yL + '" x2="' + (W - right) + '" y2="' + yL + '"/>' +
      '<polyline class="trace" points="' + pts.trim() + '"/>' +
      marks + boxes + play +
      '<text class="idl" x="' + left + '" y="' + (bTop + bH + 16) + '">' + esc(cfg.caption || (cfg.showSamples ? 'dots = receiver sample points · drift walks them across a bit boundary' : 'idle high · one box per symbol, left to right in time · LSB first')) + '</text>' +
      '</svg>';
    return '<div class="pr-la">' + svg + '</div>';
  }
  function prLaCfg() {
    var u = protos.uart, st = protos.stage, a = prUartLive();
    if (st === 1) { return { bits: [{ v: 1, k: 'stop', l: 'idle' }], playIdx: null, showSamples: false }; }
    if (st === 3 && !(a && a.review)) { return { bits: prUartBits(u, u.char), playIdx: null, showSamples: true, drift: u.drift }; }
    var bits = a ? a.tx.bits : (u.tx ? u.tx.bits : prUartBits(u, u.char));
    return { bits: bits, playIdx: a ? Math.min(Math.floor(a.pos), bits.length) : 0, showSamples: st === 3, drift: u.drift };
  }
  function prUpdateLA() { var h = document.getElementById('pr-la-host'); if (h) { h.innerHTML = prLA(prLaCfg()); } }

  /* ---- shared card builders ---- */
  function prTeach(title, html) {
    return '<section class="pf-card"><h3>' + esc(title) + '<span class="pf-sub">the idea</span></h3><div class="pf-teach">' + html + '</div></section>';
  }
  function prCodeCard(title, code, sub) {
    return '<section class="pf-card"><h3>' + esc(title) + '<span class="pf-sub">' + esc(sub || 'this equals') + '</span></h3><pre class="pf-code">' + esc(code) + '</pre></section>';
  }
  function prSeg(name, opts, cur) {
    return '<div class="pr-seg" role="group">' + opts.map(function (o) {
      return '<button type="button" data-' + name + '="' + o.v + '" aria-pressed="' + String(cur === o.v) + '">' + esc(o.t) + '</button>';
    }).join('') + '</div>';
  }
  function prCols() {
    var args = Array.prototype.slice.call(arguments);
    var cls = 'pf-grid' + (args.length === 2 ? ' pf-grid2' : '');
    var out = '<div class="' + cls + '">';
    for (var i = 0; i < args.length; i++) { out += '<div class="pf-col pf-col-' + i + '">' + args[i] + '</div>'; }
    return out + '</div>';
  }
  function prLogCard() {
    var rows = protos.log.map(function (e) {
      return '<div class="e ' + e.k + '"><span class="t">' + e.t + 'ms</span><span class="m">' + esc(e.m) + '</span></div>';
    }).join('');
    return '<section class="pf-card"><h3>Event log<span class="pf-sub">what the model saw</span></h3><div class="pf-log">' + (rows || '<div class="e note"><span class="t">—</span><span class="m">nothing yet.</span></div>') + '</div></section>';
  }

  /* ---- stage 1: line physics ---- */
  function prSigCode() {
    var s = protos.sig, p = PR_PIN, L = [];
    L.push('/* PA5 as ' + (s.drive === 'push' ? 'push-pull' : s.drive === 'od' ? 'open-drain' : 'input') + ', pull-' + s.pull + ' */');
    if (s.drive === 'input') { L.push('GPIOA->MODER  = (GPIOA->MODER & ~(3u << ' + (p * 2) + ')) | (0u << ' + (p * 2) + ');  /* input: pad is Hi-Z */'); }
    else { L.push('GPIOA->MODER  = (GPIOA->MODER & ~(3u << ' + (p * 2) + ')) | (1u << ' + (p * 2) + ');  /* general purpose output */'); }
    L.push(s.drive === 'od' ? 'GPIOA->OTYPER |=  (1u << ' + p + ');   /* open-drain: can only sink */' : 'GPIOA->OTYPER &= ~(1u << ' + p + ');   /* push-pull: drives both */');
    var pv = s.pull === 'up' ? '1u' : s.pull === 'down' ? '2u' : '0u';
    L.push('GPIOA->PUPDR  = (GPIOA->PUPDR & ~(3u << ' + (p * 2) + ')) | (' + pv + 'u << ' + (p * 2) + ');   /* pull-' + s.pull + ' */');
    if (s.drive !== 'input') { L.push(s.out ? 'GPIOA->ODR    |=  (1u << ' + p + ');   /* ' + (s.drive === 'od' ? 'release the line' : 'drive high') + ' */' : 'GPIOA->ODR   &= ~(1u << ' + p + ');   /* ' + (s.drive === 'od' ? 'sink the line low' : 'drive low') + ' */'); }
    return L.join('\n');
  }
  function prSigCtlCard() {
    var s = protos.sig;
    return '<section class="pf-card"><h3>Drive the pin<span class="pf-sub">change one knob, watch the level</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">Driver</span>' + prSeg('sigdrive', [{ v: 'push', t: 'Push-pull' }, { v: 'od', t: 'Open-drain' }, { v: 'input', t: 'Input Hi-Z' }], s.drive) + '</div>' +
      '<div class="pr-ctlrow"><span class="lbl">ODR bit</span><button type="button" class="btn" data-sigout="' + (s.out ? 0 : 1) + '" aria-pressed="' + String(!!s.out) + '">' + (s.out ? '1 · drive/release' : '0 · low/sink') + '</button>' +
      '<span class="lbl">Pull</span>' + prSeg('sigpull', [{ v: 'none', t: 'None' }, { v: 'up', t: 'Pull-up' }, { v: 'down', t: 'Pull-down' }], s.pull) + '</div>' +
      '<p class="pf-hint">Push-pull drives <b>both</b> directions, so the pull resistor is then irrelevant. <b>Open-drain</b> can only sink: a 1 lets go and the line needs a <b>pull-up</b> to have a defined high. Cut the pull on a released line and you get <b>floating</b> — the third level that reads anything.</p>' +
    '</section>';
  }
  function prWireCard() {
    var s = protos.sig, lvl = prResolve(s.drive, s.out, s.pull);
    var p = PR_PIN;
    var svg = '<svg viewBox="0 0 300 190">' +
      '<line class="rail" x1="200" y1="16" x2="250" y2="16"/><text class="lab" x="252" y="19">VDD</text>' +
      '<line class="rail" x1="50" y1="170" x2="120" y2="170"/><line class="rail" x1="190" y1="170" x2="250" y2="170"/><text class="lab" x="28" y="173">GND</text>' +
      '<line class="rail" x1="80" y1="95" x2="220" y2="95"/>';
    /* node */
    svg += '<circle class="node ' + lvl + '" cx="150" cy="95" r="10"/><text class="lab" x="150" y="118" text-anchor="middle">PA' + p + ' = ' + lvl.toUpperCase() + '</text>';
    /* driver on the left, node -> driver -> GND */
    svg += '<line class="rail" x1="80" y1="95" x2="80" y2="120"/>';
    if (s.drive === 'input') {
      svg += '<text class="lab" x="80" y="140" text-anchor="middle">Hi-Z</text><line class="rail" x1="80" y1="120" x2="80" y2="132" stroke-dasharray="2 2"/>';
    } else {
      var dact = (s.drive === 'od' && !s.out) || (s.drive === 'push');
      svg += '<rect class="res' + (dact ? ' act' : '') + '" x="68" y="120" width="24" height="30"/><line class="rail" x1="80" y1="150" x2="80" y2="170"/><text class="lab" x="80" y="139" text-anchor="middle">' + (s.drive === 'push' ? 'PP' : 'OD') + '</text>';
    }
    /* pull resistor on the right */
    if (s.pull === 'none') {
      svg += '<text class="lab" x="220" y="70" text-anchor="middle" opacity=".5">no pull</text><line class="rail" x1="220" y1="95" x2="220" y2="78" stroke-dasharray="2 2"/>';
    } else if (s.pull === 'up') {
      var uact = s.drive !== 'push';
      svg += '<line class="rail' + (uact ? ' res act' : '') + '" x1="220" y1="95" x2="220" y2="70"/><rect class="res' + (uact ? ' act' : '') + '" x="214" y="46" width="12" height="24"/><line class="rail" x1="220" y1="46" x2="220" y2="16"/><text class="lab" x="232" y="60">pull-up</text>';
    } else {
      var dact2 = s.drive !== 'push';
      svg += '<line class="rail' + (dact2 ? ' res act' : '') + '" x1="220" y1="95" x2="220" y2="120"/><rect class="res' + (dact2 ? ' act' : '') + '" x="214" y="120" width="12" height="24"/><line class="rail" x1="220" y1="144" x2="220" y2="170"/><text class="lab" x="232" y="134">pull-dn</text>';
    }
    svg += '</svg>';
    return '<section class="pf-card"><h3>The line<span class="pf-sub">PA' + p + ' resolved from physics, not intent</span></h3><div class="pr-wire">' + svg + '</div>' +
      '<div class="pr-read">line reads <b class="pr-level ' + lvl + '">' + lvl.toUpperCase() + '</b>' + esc(prLevelReason(s, lvl)) + '</div></section>';
  }
  function prLevelReason(s, lvl) {
    if (lvl === 'float') { return ' — nothing drives it and no pull: undefined, picks up noise'; }
    if (s.drive === 'push') { return ' — push-pull actively ' + (s.out ? 'sources (high)' : 'sinks to ground (low)'); }
    if (s.drive === 'od' && !s.out) { return ' — open-drain NMOS on, sinking low'; }
    if (s.drive === 'od' && s.out) { return ' — open-drain released, the ' + (s.pull === 'up' ? 'pull-up' : 'pull-down') + ' sets it'; }
    if (s.drive === 'input') { return ' — pin is an input (Hi-Z), only the pull-' + s.pull + ' decides'; }
    return '';
  }
  function prAndCard() {
    var w = protos.wire, lvl = prWireResolve(w.aOut, w.bOut);
    var svg = '<svg viewBox="0 0 300 190">' +
      '<line class="rail" x1="130" y1="16" x2="170" y2="16"/><text class="lab" x="172" y="19">VDD</text>' +
      '<line class="rail" x1="40" y1="170" x2="260" y2="170"/>' +
      '<line class="rail" x1="50" y1="95" x2="250" y2="95"/>' +
      '<circle class="node ' + lvl + '" cx="150" cy="95" r="10"/><text class="lab" x="150" y="118" text-anchor="middle">bus = ' + lvl.toUpperCase() + '</text>' +
      '<line class="rail' + (lvl === 'high' ? ' res act' : '') + '" x1="150" y1="95" x2="150" y2="70"/><rect class="res' + (lvl === 'high' ? ' act' : '') + '" x="144" y="46" width="12" height="24"/><line class="rail" x1="150" y1="46" x2="150" y2="16"/><text class="lab" x="150" y="42" text-anchor="middle">pull-up</text>' +
      '<line class="rail" x1="70" y1="95" x2="70" y2="120"/><rect class="res' + (w.aOut ? '' : ' act') + '" x="58" y="120" width="24" height="26"/><line class="rail" x1="70" y1="146" x2="70" y2="170"/><text class="lab" x="70" y="137" text-anchor="middle">A</text>' +
      '<line class="rail" x1="230" y1="95" x2="230" y2="120"/><rect class="res' + (w.bOut ? '' : ' act') + '" x="218" y="120" width="24" height="26"/><line class="rail" x1="230" y1="146" x2="230" y2="170"/><text class="lab" x="230" y="137" text-anchor="middle">B</text>' +
      '</svg>';
    return '<section class="pf-card"><h3>Wired-AND<span class="pf-sub">two open-drain drivers, one shared line</span></h3><div class="pr-wire">' + svg + '</div>' +
      '<div class="pr-ctlrow">' +
        '<button type="button" class="btn" data-wa="a" aria-pressed="' + String(!!w.aOut) + '">A: ' + (w.aOut ? 'released (1)' : 'driving 0') + '</button>' +
        '<button type="button" class="btn" data-wa="b" aria-pressed="' + String(!!w.bOut) + '">B: ' + (w.bOut ? 'released (1)' : 'driving 0') + '</button>' +
        '<span class="pr-level ' + lvl + '">bus = ' + lvl.toUpperCase() + '</span></div>' +
      '<p class="pf-hint">Neither driver ever sources — the pull-up does. The bus reads <b>high only when both A and B let go</b>; if either sinks, the whole line is pulled low. That is a hardware <em>AND</em>, and it is exactly how I²C arbitration and shared interrupt lines work.</p></section>';
  }

  /* ---- stage 2: the frame ---- */
  function prFrameCtlCard() {
    var u = protos.uart;
    return '<section class="pf-card"><h3>Pick a byte<span class="pf-sub">watch it become a frame</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">Char</span><input id="pr-char" size="2" maxlength="1" value="' + esc(prCharLabel(u.char)) + '"/></div>' +
      '<div class="pr-ctlrow"><span class="lbl">Parity</span>' + prSeg('parity', [{ v: 'none', t: 'None' }, { v: 'even', t: 'Even' }, { v: 'odd', t: 'Odd' }], u.parity) + '</div>' +
      '<div class="pr-ctlrow"><span class="lbl">Stop</span>' + prSeg('stop', [{ v: '1', t: '1 stop' }, { v: '2', t: '2 stop' }], String(u.stop)) +
        '<button type="button" class="btn" id="pr-send"' + (u.tx ? ' disabled' : '') + '>▶ Send byte</button></div>' +
      '<p class="pf-hint">An idle UART line sits <b>high</b>. A byte is framed by a <b>start</b> bit (a pulled-low edge that starts the receiver\'s timer), the data bits <b>LSB-first</b>, an optional <b>parity</b> bit, then a <b>stop</b> (high) back to idle. Same byte, different parity/stop — a different number of levels on the wire.</p>' +
    '</section>';
  }
  function prFrameShowCard() {
    var u = protos.uart;
    return '<section class="pf-card"><h3>Logic analyser<span class="pf-sub">the TX wire, sending ' + esc(prHex(u.char)) + '</span></h3>' +
      '<div id="pr-la-host">' + prLA(prLaCfg()) + '</div>' +
      '<div class="pr-read" id="pr-frame-read">' + prFrameReadHtml() + '</div></section>';
  }
  function prFrameReadHtml() {
    var u = protos.uart, a = prUartLive();
    if (a) {
      var b = a.tx.bits[Math.min(Math.floor(a.pos), a.tx.bits.length - 1)];
      return prReviewTag(a) + (a.review ? 'reviewing\u2026 ' : 'sending\u2026 ') + 'bit <b>' + (Math.min(Math.floor(a.pos) + 1, a.tx.bits.length)) + '/' + a.tx.bits.length + '</b> \u00b7 line now <b>' + (b && b.v ? 'high' : 'low') + '</b>' +
        (a.review ? prScrubUartHtml(a.tx, Math.floor(a.pos)) : '');
    }
    if (u.last != null) { return 'sent <b>' + esc(prHex(u.char)) + '</b> (' + esc(prCharLabel(u.char)) + ') \u00b7 received <b class="good">' + esc(prHex(u.last)) + '</b> (' + esc(prCharLabel(u.last)) + ') \u2713'; }
    return 'idle \u00b7 high. Press <b>Send byte</b> to walk the frame.';
  }
  function prUartCode() {
    var u = protos.uart, brr = Math.round(u.clk / u.baud), L = [];
    L.push('/* USART1: ' + (u.clk / 1e6) + ' MHz kernel clock, ' + u.baud + ' baud */');
    L.push('USART1->BRR = ' + brr + 'u;   /* USARTDIV = fCK / baud */');
    var cr1 = 'USART1->CR1 = USART_CR1_UE | USART_CR1_TE | USART_CR1_RE';
    if (u.parity !== 'none') { cr1 += '\n                 | USART_CR1_PCE' + (u.parity === 'odd' ? ' | USART_CR1_PS' : ''); }
    L.push(cr1 + ';   /* enable, TX+RX' + (u.parity !== 'none' ? ', ' + u.parity + ' parity' : '') + ' */');
    L.push(u.stop === 1 ? 'USART1->CR2 &= ~USART_CR2_STOP;   /* 1 stop bit (reset) */' : 'USART1->CR2 |=  USART_CR2_STOP_1;   /* 2 stop bits */');
    L.push('while ((USART1->SR & USART_SR_TXE) == 0) { }   /* wait for a free data register */');
    L.push('USART1->DR = ' + esc(prHex(u.char)) + 'u;   /* start + ' + u.data + ' data + ' + (u.parity !== 'none' ? 'parity + ' : '') + u.stop + ' stop */');
    return L.join('\n');
  }

  /* ---- stage 3: sampling + baud mismatch ---- */
  function prSampleCtlCard() {
    var u = protos.uart;
    return '<section class="pf-card"><h3>The receiver\'s clock<span class="pf-sub">same ' + u.baud + ' Bd intent, a slightly-off oscillator</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">Baud error</span><input type="range" id="pr-drift" min="-40" max="40" step="2" value="' + u.drift + '"/><b class="pr-read" style="margin:0">' + u.drift + '%</b></div>' +
      '<div class="pr-ctlrow"><button type="button" class="btn" id="pr-newbyte">⟳ New byte</button>' +
        '<button type="button" class="btn" id="pr-send3"' + (u.tx ? ' disabled' : '') + '>▶ Send byte</button>' +
        '<span class="lbl" id="pr-bytelab">' + esc(prHex(u.char)) + ' · \'' + esc(prCharLabel(u.char)) + '\'</span></div>' +
      '<p class="pf-hint">The receiver has no clock wire — it <b>counts</b>. After the start edge it waits half a bit, then samples at each bit centre. A wrong baud makes every sample land a little off, and the error <b>accumulates</b>: the far bits cross a boundary first and get the wrong voltage. Slide until a dot goes red.</p></section>';
  }
  function prSampleTrace() {
    var u = protos.uart, a = prUartLive();
    if (a) { return { ch: a.tx.ch, bits: a.tx.bits, drift: a.tx.drift, playIdx: Math.min(Math.floor(a.pos), a.tx.bits.length), a: a }; }
    var ch = u.tx ? u.tx.ch : u.char;
    return { ch: ch, bits: u.tx ? u.tx.bits : prUartBits(u, ch), drift: u.drift, playIdx: u.tx ? u.tx.idx : null, a: null };
  }
  function prSampleReadHtml() {
    var u = protos.uart, t = prSampleTrace(), dec = prDecode(t.bits, u, t.drift), a = t.a;
    return prReviewTag(a) + 'sent <b>' + esc(prHex(t.ch)) + "</b> \u2192 received <b class=\"" + (dec.ok ? 'good' : 'bad') + '">' + esc(prHex(dec.ch)) + '</b> (' + esc(prCharLabel(dec.ch)) + ') \u00b7 mis-sampled bits <b class="' + (dec.mis ? 'bad' : 'good') + '">' + dec.mis + '</b>' + (dec.ok ? ' \u00b7 <span class="good">\u2713 clean</span>' : ' \u00b7 <span class="bad">\u2717 corrupted</span>') + (a && a.review ? prScrubUartHtml(a.tx, Math.floor(a.pos)) : '');
  }
  function prSampleShowCard() {
    var t = prSampleTrace();
    return '<section class="pf-card"><h3>Sampling points<span class="pf-sub">dots = where the receiver reads each bit</span></h3>' +
      '<div id="pr-la-host">' + prLA({ bits: t.bits, playIdx: t.playIdx, showSamples: true, drift: t.drift }) + '</div>' +
      '<div class="pr-read" id="pr-smp-read">' + prSampleReadHtml() + '</div></section>';
  }

  /* ---- stage 4: terminal ---- */
  function prTermCtlCard() {
    var u = protos.uart;
    return '<section class="pf-card"><h3>Line settings<span class="pf-sub">shared across the whole lab</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">Baud</span>' + prSeg('baud', [{ v: '1200', t: '1200' }, { v: '9600', t: '9600' }, { v: '38400', t: '38400' }, { v: '115200', t: '115200' }], String(u.baud)) + '</div>' +
      '<div class="pr-ctlrow"><span class="lbl">Baud error</span><input type="range" id="pr-drift" min="-40" max="40" step="2" value="' + u.drift + '"/><b class="pr-read" style="margin:0">' + u.drift + '%</b>' + (u.drift !== 0 ? ' <span class="pr-level float">expect garbage</span>' : ' <span class="pr-level low">perfect clock</span>') + '</div>' +
      '<p class="pf-hint">Parity is still whatever you left in stage 2 (<b>' + u.parity + '</b>), stop <b>' + u.stop + '</b>. Divisor BRR = ' + Math.round(u.clk / u.baud) + '. Push the baud error here and good keys turn to corruption — the same garble a scope shows when someone mis-set the clock tree.</p></section>';
  }
  function prTermRowHtml(e) {
    return '<div class="row' + (e.ok ? '' : ' bad') + '"><span class="k">' + esc(e.sent) + '</span><span class="got">' + esc(e.got) + '</span><span class="k">' + (e.ok ? '✓' : '✗') + '</span></div>';
  }
  function prTermCard() {
    var u = protos.uart;
    var rows = protos.rxLog.map(prTermRowHtml).join('');
    return '<section class="pf-card"><h3>Serial terminal<span class="pf-sub">type · press Enter · each char is a frame</span></h3>' +
      '<div id="pr-la-host">' + prLA(prLaCfg()) + '</div>' +
      '<div class="pr-term" id="pr-term">' + (rows || '<div class="row"><span class="k">— no traffic yet —</span><span></span><span></span></div>') + '</div>' +
      '<div class="pr-termin"><input id="pr-type" type="text" autocomplete="off" spellcheck="false" maxlength="64" placeholder="type characters and press Enter to send…"/><button type="button" class="btn" id="pr-clear">Clear</button></div></section>';
  }
  function prAppendTermRow() {
    var t = document.getElementById('pr-term'); if (!t) { return; }
    var e = protos.rxLog[0]; if (!e) { return; }
    if (t.textContent.indexOf('no traffic') >= 0) { t.innerHTML = ''; }
    var div = document.createElement('div');
    div.innerHTML = prTermRowHtml(e);
    t.insertBefore(div.firstChild, t.firstChild);
  }

  /* ---- I2C (stages 5 + 6): the wire is a shared AND; every transfer opens with an address ---- */
  function prI2cBit(v, i) { return (v >>> (6 - i)) & 1; }          /* a 7-bit address number, MSB first */
  function prAddrByte(addr, rw) { return ((addr & 0x7f) << 1) | (rw & 1); }
  /* the byte ON THE WIRE is 8 bits: seven address bits then R/W. Reading it with
     the 7-bit helper would drop A6 and pin R/W to 0, so the trace would draw a
     different byte from the one every readout and datasheet is talking about. */
  function prI2cAddrBit(ab, i) { return i < 7 ? (ab >>> (7 - i)) & 1 : (ab & 1); }
  function prI2cByteBit(v, i) { return (v >>> (7 - i)) & 1; }      /* a full data byte, MSB first */
  var PR_I2C_SLAVE = 0x50;

  function prI2cMasters(m1val, m2val) {
    var slots = [{ sda: 1, scl: 1, lab: 'S', kind: 'start' }], lostAt = -1;
    for (var i = 0; i < 8; i++) {
      var w1 = prI2cBit(m1val, i), w2 = prI2cBit(m2val, i);
      var bus = w1 & w2, loser = null;
      if (lostAt < 0 && w1 === 1 && bus === 0) { loser = 'M1'; lostAt = i; }
      else if (lostAt < 0 && w2 === 1 && bus === 0) { loser = 'M2'; lostAt = i; }
      slots.push({ sda: bus, scl: 1, lab: i < 7 ? 'A' + (6 - i) : 'R/W', kind: loser ? 'lost' : 'data', loser: loser, w1: w1, w2: w2, bus: bus });
    }
    slots.push({ sda: 0, scl: 1, lab: 'A', kind: 'ack' });
    slots.push({ sda: 1, scl: 0, lab: 'P', kind: 'stop' });
    return { slots: slots, lostAt: lostAt };
  }

  function prI2cTxSlots(addr, rw, acked, includeData) {
    var slots = [{ sda: 1, scl: 1, lab: 'S', kind: 'start' }], ab = prAddrByte(addr, rw), i;
    for (i = 0; i < 8; i++) { slots.push({ sda: prI2cAddrBit(ab, i), scl: 1, lab: i < 7 ? 'A' + (6 - i) : 'R/W', kind: 'data' }); }
    slots.push({ sda: acked ? 0 : 1, scl: 1, lab: acked ? 'ACK' : 'NACK', kind: acked ? 'ack' : 'nack' });
    if (includeData) {
      for (i = 0; i < 8; i++) { slots.push({ sda: prI2cByteBit(0xA5, i), scl: 1, lab: 'D' + (7 - i), kind: 'data' }); }
      slots.push({ sda: 0, scl: 1, lab: 'A', kind: 'ack' });
    }
    slots.push({ sda: 1, scl: 0, lab: 'P', kind: 'stop' });
    return slots;
  }

  function prI2cSrSlots(addr, acked) {
    var slots = prI2cTxSlots(addr, 0, acked, true).slice(0, -1);
    slots.push({ sda: 0, scl: 1, lab: 'S', kind: 'start' });
    slots.push({ sda: 0, scl: 1, lab: 'Sr', kind: 'restart' });
    var rab = prAddrByte(addr, 1);
    for (var i = 0; i < 8; i++) { slots.push({ sda: prI2cAddrBit(rab, i), scl: 1, lab: i < 7 ? 'A' + (6 - i) : 'R/W', kind: 'data' }); }
    slots.push({ sda: acked ? 0 : 1, scl: 1, lab: acked ? 'ACK' : 'NACK', kind: acked ? 'ack' : 'nack' });
    for (i = 0; i < 8; i++) { slots.push({ sda: prI2cByteBit(0x2C, i), scl: 1, lab: 'D' + (7 - i), kind: 'data' }); }
    slots.push({ sda: 1, scl: 1, lab: 'M', kind: 'ack' });
    slots.push({ sda: 1, scl: 0, lab: 'P', kind: 'stop' });
    return slots;
  }

  function prI2cGeom(n) {
    return { n: n, left: 40, right: 8, W: 300, cw: (300 - 48) / n, play: 'pr-i2c-play' };
  }

  var _prPlay = null;
  function prPlaySetup(g) { _prPlay = { id: g.play, left: g.left, cw: g.cw, n: g.n }; }
  function prPts(slots, get, yH, yL, left, cw) {
    var pts = '', prevY = yH;
    for (var i = 0; i < slots.length; i++) {
      var y = get(slots[i]) ? yH : yL, x0 = left + i * cw, x1 = x0 + cw;
      pts += x0.toFixed(1) + ',' + prevY + ' ' + x0.toFixed(1) + ',' + y + ' ' + x1.toFixed(1) + ',' + y + ' ';
      prevY = y;
    }
    return pts.trim();
  }
  function prIAL2(slots, opt) {
    var n = slots.length, g = prI2cGeom(n), W = g.W, left = g.left, cw = g.cw;
    prPlaySetup(g);
    var scl = prPts(slots, function (s) { return s.scl; }, 30, 48, left, cw);
    var sda = prPts(slots, function (s) { return s.sda; }, 64, 86, left, cw);
    var i, grid = '';
    for (i = 1; i < n; i++) { var gx = (left + i * cw).toFixed(1); grid += '<line class="grid" x1="' + gx + '" y1="24" x2="' + gx + '" y2="118"/>'; }
    var boxes = '';
    for (i = 0; i < n; i++) {
      var bx = left + i * cw;
      boxes += '<rect class="segbox ' + slots[i].kind + '" x="' + (bx + 0.5).toFixed(1) + '" y="98" width="' + (cw - 1).toFixed(1) + '" height="20"/>' +
        '<text class="seglab" x="' + (bx + cw / 2).toFixed(1) + '" y="111">' + esc(slots[i].lab) + '</text>';
    }
    var px = (left + Math.max(0, Math.min(opt.playIdx == null ? 0 : opt.playIdx, n)) * cw).toFixed(1);
    var playAttr = opt.playId === _prPlay.id ? ' x1="' + px + '" x2="' + px + '"' : '';
    var play = '<line id="' + _prPlay.id + '" class="play"' + playAttr + ' opacity="' + (opt.playIdx == null ? '0' : '1') + '" y1="18" y2="120"/>';
    return '<div class="pr-la"><svg viewBox="0 0 ' + W + ' 150">' +
      '<text class="clab" x="5" y="43">SCL</text><text class="clab" x="5" y="79">SDA</text>' +
      '<polyline class="trace scl2" points="' + scl + '"/>' +
      '<polyline class="trace" points="' + sda + '"/>' +
      grid + boxes + play + '</svg></div>';
  }

  function prI2cLive() { return prViewOf('i2c'); }
  function prI2cBanner(slots, res) {
    var a = prI2cLive(), i;
    if (a) { return prReviewTag(a) + 't = <b>' + Math.min(Math.floor(a.pos), slots.length) + '/' + slots.length + '</b> clocks \u00b7 ' + (a.review ? 'you are standing at this clock' + prScrubI2cHtml(slots, Math.floor(a.pos)) : 'watch the table fill as the line resolves'); }
    if (res == null) { return 'idle \u2014 the pull-ups hold both lines high. Press send.'; }
    if (res.lostAt != null) {
      var txt = 'Arbitration over at <b>A' + (6 - res.lostAt) + '</b>: ' + (res.loser === 'M1' ? 'M1' : 'M2') + ' wanted 1, read 0 back \u2014 it drops out. <b>' + (res.loser === 'M1' ? 'M2' : 'M1') + ' owns the bus</b> and the slave ACKs.';
      for (i = 0; i < slots.length; i++) { if (slots[i].loser) { txt += ' <span class="bad">(marker: slot ' + (i + 1) + ')</span>'; break; } }
      return txt;
    }
    return res.rw === 0 ? 'EEPROM 0x50 saw its own byte <b>0x' + prAddrByte(res.addr, 0).toString(16).toUpperCase() + '</b> and ACKed (SDA held low at clock 9). The sensor at 0x3C stayed deaf.' : 'EEPROM 0x50 ACKed the <b>read</b> address \u2014 now <em>it</em> drives the data byte.';
  }

  function prI2cCtlCard() {
    var u = protos.i2c;
    return '<section class="pf-card"><h3>Two masters, one wire<span class="pf-sub">both start talking at once</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">M1 address</span><input id="pr-i2c-m1" size="4" maxlength="2" value="' + u.m1val.toString(16).toUpperCase() + '"/>' +
        '<span class="lbl">M2 address</span><input id="pr-i2c-m2" size="4" maxlength="2" value="' + u.m2val.toString(16).toUpperCase() + '"/></div>' +
      '<div class="pr-ctlrow"><button type="button" class="btn" id="pr-i2c-send"' + (u.tx ? ' disabled' : '') + '>\u25b6 Send both (watch them fight)</button>' +
        '<button type="button" class="btn mini" data-i2cpair="50,40">0x50 vs 0x40</button>' +
        '<button type="button" class="btn mini" data-i2cpair="50,50">identical</button>' +
        '<button type="button" class="btn mini" data-i2cpair="40,50">M2 first</button></div>' +
      '<p class="pf-hint">Both masters send a START, then their address byte MSB-first, <b>open-drain</b> \u2014 the wire is the AND of whatever the two drivers allow. The first clock where one wants <b>1</b> and the other sinks <b>0</b> decides the winner: the loser sees its own 1 come back as 0 and drops off mid-byte, never disturbing the transfer.</p></section>';
  }
  function prI2cBusCard() {
    var u = protos.i2c, lvl = prWireResolve(u.aOut, u.bOut);
    var svg = '<svg viewBox="0 0 300 64">' +
      '<line class="rail" x1="40" y1="32" x2="260" y2="32"/>' +
      '<line class="rail" x1="70" y1="32" x2="70" y2="46"/><rect class="res' + (u.aOut ? '' : ' act') + '" x="58" y="46" width="24" height="16"/><text class="lab" x="70" y="57" text-anchor="middle">M1</text>' +
      '<line class="rail" x1="230" y1="32" x2="230" y2="46"/><rect class="res' + (u.bOut ? '' : ' act') + '" x="218" y="46" width="24" height="16"/><text class="lab" x="230" y="57" text-anchor="middle">M2</text>' +
      '<circle class="node ' + lvl + '" cx="150" cy="32" r="9"/><text class="lab" x="150" y="18" text-anchor="middle">SDA = ' + lvl.toUpperCase() + '</text></svg>';
    return '<section class="pf-card"><h3>Hand-drive the AND<span class="pf-sub">become both masters yourself</span></h3><div class="pr-wire">' + svg + '</div>' +
      '<div class="pr-ctlrow">' +
        '<button type="button" class="btn" data-i2ca="' + (u.aOut ? 0 : 1) + '" aria-pressed="' + String(!!u.aOut) + '">M1: ' + (u.aOut ? 'wants 1 (released)' : 'sinks 0') + '</button>' +
        '<button type="button" class="btn" data-i2cb="' + (u.bOut ? 0 : 1) + '" aria-pressed="' + String(!!u.bOut) + '">M2: ' + (u.bOut ? 'wants 1 (released)' : 'sinks 0') + '</button>' +
        '<span class="pr-level ' + lvl + '">SDA = ' + lvl.toUpperCase() + '</span></div>' +
      '<p class="pf-hint">The line is high only while <b>both</b> let go. This exact wiring is what the animation above resolves one clock at a time \u2014 and it is why a losing master can drop out at any bit without damaging the winner\u2019s byte.</p></section>';
  }
  function prI2cWaveCard() {
    var u = protos.i2c, a = prI2cLive();
    var res = u.result && u.result.kind === 'masters' ? u.result : null;
    var slots = a ? a.tx.slots : res ? res.slots : prI2cMasters(u.m1val, u.m2val).slots;
    return '<section class="pf-card"><h3>Logic analyser<span class="pf-sub">SCL + SDA, decode band under every clock</span></h3>' +
      prIAL2(slots, { playIdx: a ? Math.min(Math.floor(a.pos), slots.length) : (res ? null : 0), playId: 'pr-i2c-play' }) +
      '<div class="pr-read" id="pr-i2c-read">' + prI2cBanner(slots, res) + '</div></section>';
  }
  function prI2cTableCard() {
    var u = protos.i2c, a = prI2cLive();
    var res = u.result && u.result.kind === 'masters' ? u.result : null;
    var slots = a ? a.tx.slots : res ? res.slots : prI2cMasters(u.m1val, u.m2val).slots;
    var upto = a ? Math.min(Math.floor(a.pos), slots.length) : slots.length;
    var rows = '', i;
    for (i = 1; i <= 8; i++) {
      var s = slots[i], settled = i < upto || (i === upto && (!a || a.review));
      rows += '<tr' + (a && i === Math.floor(a.pos) ? ' class="cur"' : '') + '><td class="k">' + (i <= 7 ? 'A' + (7 - i) : 'R/W') + '</td><td>' + (s.w1 != null ? s.w1 : '?') + '</td><td>' + (s.w2 != null ? s.w2 : '?') + '</td>' +
        '<td class="' + (s.loser ? 'bad' : 'good') + '">' + (settled && s.bus != null ? s.bus : '?') + (settled && s.loser ? ' \u2190 ' + s.loser + ' loses' : '') + '</td></tr>';
    }
    return '<section class="pf-card" id="pr-i2c-table"><h3>Bit by bit<span class="pf-sub">intent vs what the wire says</span></h3>' +
      '<table class="pr-bit tbl"><tr><th>clock</th><th>M1 wants</th><th>M2 wants</th><th>wire reads</th></tr>' + rows + '</table>' +
      '<p class="pf-hint">The moment a driver reads back <b>0</b> while sending <b>1</b>, it knows another master is sinking the line \u2014 and quits between clocks. Nobody resets anybody; the wire itself is the arbiter.</p></section>';
  }
  function prI2cStage5() {
    return prCols(
      prTeach('The shared wire decides, politely',
        '<p>Two masters can start talking at the same instant \u2014 I\u00b2C survives that because every driver is <b>open-drain</b> (exactly the stage-1 rig) and the line is a <b>wired-AND</b>: a 0 from anyone wins. Each sender compares every bit it drives against the bit it <em>reads</em>; the first time it sends 1 and sees 0, it backs off for good. No reset, no priority list \u2014 the address itself is the priority, because the byte diverges at the first 0-bit.</p>' +
        '<p>Send 0x50 against 0x40 and watch where the table turns red: the data collides at bit A4 (0x5 = 101, 0x4 = 100 \u2014 one of them is a 1 where the other sinks a 0). The loser simply stops driving; the winner never notices a thing.</p>') +
      prI2cCtlCard() + prI2cBusCard(),
      prI2cWaveCard() + prI2cTableCard(),
      prGoalCard(5) + prCodeCard('This is what the winner ships', PR_I2C_CODE_STATIC) + prLogCard());
  }

  function prI2cAddrCtlCard() {
    var u = protos.i2c;
    return '<section class="pf-card"><h3>Who is this for?<span class="pf-sub">the bus has one talker and many listeners</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">7-bit address</span><input id="pr-i2c-addr" size="4" maxlength="2" value="' + u.addr.toString(16).toUpperCase() + '"/>' +
        '<span class="lbl">R/W</span>' + prSeg('i2crw', [{ v: '0', t: 'write' }, { v: '1', t: 'read' }], String(u.rw)) + '</div>' +
      '<div class="pr-ctlrow"><button type="button" class="btn" id="pr-i2c-send6"' + (u.tx ? ' disabled' : '') + '>\u25b6 Send START + address</button>' +
        '<button type="button" class="btn" id="pr-i2c-sr"' + (u.tx ? ' disabled' : '') + '>\u21ba Repeated start: write, then read</button></div>' +
      '<div class="pr-ctlrow"><button type="button" class="btn mini" data-i2caddr="50">EEPROM 0x50 (present)</button>' +
        '<button type="button" class="btn mini" data-i2caddr="3c">sensor 0x3C (present)</button>' +
        '<button type="button" class="btn mini" data-i2caddr="77">0x77 (nobody home)</button></div>' +
      '<p class="pf-hint">Every I\u00b2C transaction opens the same way: START, then a <b>7-bit address + one R/W bit</b> packed into the first byte on the wire \u2014 the byte you see in datasheets as <code>0xA0</code> is really <code>0x50 &lt;&lt; 1 | write</code>. All slaves listen; only the named one answers clock 9 by sinking SDA (<b>ACK</b>). Silence (<b>NACK</b>) means nobody lives there, and the master aborts with a STOP.</p></section>';
  }
  function prI2cAddrWaveCard() {
    var u = protos.i2c, a = prI2cLive();
    var res = u.result && u.result.kind !== 'masters' ? u.result : null;
    var slots = a ? a.tx.slots : res ? res.slots : prI2cTxSlots(u.addr, u.rw, u.addr === PR_I2C_SLAVE, false);
    return '<section class="pf-card" id="pr-i2c-wavecard">' +
      '<h3>Logic analyser<span class="pf-sub">' + esc(prHex(prAddrByte(u.addr, u.rw))) + ' on the wire = addr ' + esc(prHex(u.addr)) + ' + R/W ' + u.rw + '</span></h3>' +
      prIAL2(slots, { playIdx: a ? Math.min(Math.floor(a.pos), slots.length) : (res ? null : 0), playId: 'pr-i2c-play' }) +
      '<div class="pr-read" id="pr-i2c-read">' + prI2cAddrBanner(slots, res) + '</div></section>';
  }
  function prI2cAddrBanner(slots, res) {
    var a = prI2cLive(), i;
    if (a) { return prReviewTag(a) + 't = <b>' + Math.min(Math.floor(a.pos), slots.length) + '/' + slots.length + '</b> clocks \u00b7 all but one listener is already silent' + (a.review ? prScrubI2cHtml(slots, Math.floor(a.pos)) : ''); }
    if (res == null) { return 'idle \u2014 SCL and SDA rest high on their pull-ups.'; }
    var ackSlot = -1;
    for (i = 0; i < slots.length; i++) { if (slots[i].kind === 'ack' || slots[i].kind === 'nack') { ackSlot = i; break; } }
    if (res.kind === 'nack') { return 'Address byte <b>' + esc(prHex(prAddrByte(res.addr, res.rw))) + '</b> sent \u2014 clock 9: SDA stays <b>high</b>. <span class="bad">NACK: nobody named 0x' + res.addr.toString(16).toUpperCase() + ' on this bus.</span> Master issues STOP and tries nothing further.'; }
    if (res.kind === 'sr') { return 'Write phase ACKed \u2192 <b>repeated START</b> without releasing the bus \u2192 read address ACKed \u2192 the EEPROM clocks 0x2C back to the master \u2192 master NACKs the last byte (\u201cthat\u2019s all\u201d) \u2192 STOP. One claim, two phases \u2014 exactly how a register read is built.'; }
    return 'Address byte <b>' + esc(prHex(prAddrByte(res.addr, res.rw))) + '</b> sent \u2014 clock 9: <span class="good">ACK (SDA pulled low by 0x' + res.addr.toString(16).toUpperCase() + ')</span>. The named slave is now listening for the data byte.';
  }
  function prI2cSlavesCard() {
    var u = protos.i2c;
    var res = u.result && u.result.kind !== 'masters' ? u.result : null;
    function row(name, addr, present) {
      var hearing = res ? (res.addr === addr) : (u.addr === addr);
      var state = !res ? (present ? 'listening' : 'listening') : (res.addr === addr ? (res.kind === 'nack' ? '<span class="bad">NACK \u2014 empty slot</span>' : '<span class="good">ACK \u2014 it answers</span>') : (present ? 'silent \u2014 not its number' : 'silent'));
      return '<tr><td>' + name + '</td><td class="k">0x' + addr.toString(16).toUpperCase() + '</td><td>' + state + '</td></tr>';
    }
    return '<section class="pf-card"><h3>Who answers?\u00b7<span class="pf-sub">every slave compares clock-by-clock</span></h3>' +
      '<table class="pr-bit tbl"><tr><th>device</th><th>address</th><th>this transfer</th></tr>' +
      row('EEPROM', PR_I2C_SLAVE, true) + row('temp sensor', 0x3c, true) + row('slot 0x77', 0x77, false) + '</table>' +
      '<p class="pf-hint">A slave that sees its own address ACKs and starts listening for data; one that doesn\u2019t goes completely deaf until the next START. A <b>general call</b> (address 0x00) is the exception \u2014 everyone ACKs, no data follows. That\u2019s the entire addressing protocol; everything else is data.</p></section>';
  }
  function prI2cStage6() {
    return prCols(
      prTeach('Address, then data, then done',
        '<p>Stage 5 decided <em>who</em> talks; stage 6 is <em>to whom</em>. After arbitration (or a quiet bus), the winner emits START and the first byte: <b>7-bit address + R/W</b>. This is the whole reason HAL calls take <code>0xA0</code> where the datasheet headline says <code>0x50</code> \u2014 one value on the wire, one value in prose. The 9th clock belongs to the <em>receiver</em>: the addressed slave sinks SDA for ACK or leaves it high for NACK.</p>' +
        '<p>A <b>repeated start</b> (Sr) is the last trick: to read a register you write the register address, then Sr, then the same slave address with R/W=1 \u2014 without ever releasing the bus, so no other master can interleave between the two phases. Send a bad address and feel the NACK; send Sr and watch one claim span two directions.</p>') +
      prI2cAddrCtlCard(),
      prI2cAddrWaveCard() + prI2cSlavesCard(),
      prGoalCard(6) + prCodeCard('The two levels of the same transaction', PR_I2C_CODE_TWO) + prLogCard());
  }

  /* ---- stage 10: I2C clock stretching (the slave owns SCL whenever it likes) ---- */
  function prI2cStretchSlots() {
    var u = protos.i2c;
    /* a WRITE transfer with a payload: start, address+W, ACK, then the data byte.
       The slave holds SCL low right after its ACK — exactly where a real EEPROM
       asks the master to wait while it commits a page. */
    return prStretchInsert(prI2cTxSlots(u.addr, 0, true, true), 10, u.stretch);
  }
  function prI2cStretchCtlCard() {
    var u = protos.i2c;
    return '<section class="pf-card"><h3>Hold the clock<span class="pf-sub">the one wire a slave is allowed to drive</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">Slave address</span><input id="pr-i2c-saddr" size="4" maxlength="2" value="' + u.addr.toString(16).toUpperCase() + '"/>' +
        '<span class="lbl">SCL held low for</span>' + prSeg('i2cstretch', [{ v: '0', t: 'none' }, { v: '1', t: '1 clock' }, { v: '3', t: '3' }, { v: '6', t: '6' }], String(u.stretch)) + '</div>' +
      '<div class="pr-ctlrow"><button type="button" class="btn" id="pr-i2c-stretch-send"' + (u.tx ? ' disabled' : '') + '>\u25b6 Write a byte, wait for the slave</button></div>' +
      '<p class="pf-hint">Every other clock in this lab belonged to the master. I\u00b2C has exactly one exception: after it ACKs, a slave may <b>hold SCL low</b> for as long as it needs — a page write, a conversion, a calibration. The master cannot start the next bit until somebody else releases the line, so it does the only thing it can: <b>wait</b>. The transfer stays perfectly legal, just slower.</p></section>';
  }
  function prI2cStretchBanner(slots, res) {
    var a = prI2cLive(), i, held = 0;
    for (i = 0; i < slots.length; i++) { if (slots[i].kind === 'stretch') { held++; } }
    if (a) {
      var k = Math.max(0, Math.min(Math.floor(a.pos), slots.length - 1)), s = slots[k];
      return prReviewTag(a) + 't = <b>' + Math.min(Math.floor(a.pos), slots.length) + '/' + slots.length + '</b> slots \u00b7 ' +
        (s && s.kind === 'stretch' ? '<span class="bad">SCL is held LOW by the slave — the master\u2019s bit counter is frozen at ' + prStretchCount(slots, k) + '</span>' : 'SCL is back under the master\u2019s control') +
        (a.review ? prScrubI2cHtml(slots, Math.floor(a.pos)) : '');
    }
    if (res == null) { return 'idle \u2014 SCL and SDA rest high on their pull-ups.'; }
    if (!held) { return 'No stretch in this transfer: the slave ACKed and the data byte went out at full 100 kHz. Set <b>SCL held low</b> to something other than <em>none</em> and send again.'; }
    return 'Slave 0x' + res.addr.toString(16).toUpperCase() + ' ACKed, then <b>held SCL low for ' + held + ' clock period' + (held > 1 ? 's' : '') + '</b> before the data byte. The master\u2019s bit counter sat still the whole time \u2014 no clock edge, no progress, no error.' +
      ' <span class="good">Nothing about the byte changed; only the wall-clock time did.</span>';
  }
  function prStretchCount(slots, upto) {
    var n = 0, i;
    for (i = 0; i < upto && i < slots.length; i++) { if (slots[i].kind === 'data') { n++; } }
    return n;
  }
  function prI2cStretchWaveCard() {
    var u = protos.i2c, a = prI2cLive();
    var res = u.result && u.result.kind === 'stretch' ? u.result : null;
    var slots = a ? a.tx.slots : res ? res.slots : prI2cStretchSlots();
    return '<section class="pf-card" id="pr-i2c-stretch-card"><h3>Logic analyser<span class="pf-sub">SCL + SDA, and the flat stretch in the middle</span></h3>' +
      prIAL2(slots, { playIdx: a ? Math.min(Math.floor(a.pos), slots.length) : (res ? null : 0), playId: 'pr-i2c-play' }) +
      '<div class="pr-read" id="pr-i2c-read">' + prI2cStretchBanner(slots, res) + '</div></section>';
  }
  function prI2cStretchTableCard() {
    var u = protos.i2c, a = prI2cLive();
    var res = u.result && u.result.kind === 'stretch' ? u.result : null;
    var slots = a ? a.tx.slots : res ? res.slots : prI2cStretchSlots();
    var upto = a ? Math.min(Math.floor(a.pos), slots.length) : slots.length;
    var counts = [], n = 0, i;
    for (i = 0; i < slots.length; i++) { counts.push(n); if (slots[i].kind === 'data') { n++; } }
    var rows = '';
    for (i = 0; i < slots.length; i++) {
      var s = slots[i];
      var see = i < upto || (i === upto && (!a || a.review));
      rows += '<tr' + (a && i === Math.floor(a.pos) ? ' class="cur"' : (s.kind === 'stretch' ? ' class="dim"' : '')) + '>' +
        '<td class="k">' + (i + 1) + '</td><td>' + esc(s.lab) + '</td>' +
        '<td>' + (see ? (s.scl ? 'high' : '<span class="bad">held low</span>') : '?') + '</td>' +
        '<td>' + (see ? s.sda : '?') + '</td>' +
        '<td>' + (see ? (s.kind === 'stretch' ? '<span class="bad">master waits \u00b7 still bit ' + counts[i] + '</span>' : counts[i] + ' clocked') : '?') + '</td></tr>';
    }
    return '<section class="pf-card" id="pr-i2c-table"><h3>Who owns the clock<span class="pf-sub">stretched clocks are extra time, not extra bits</span></h3>' +
      '<table class="pr-bit tbl"><tr><th>slot</th><th>symbol</th><th>SCL</th><th>SDA</th><th>master\u2019s counter</th></tr>' + rows + '</table>' +
      '<p class="pf-hint">Count the data bits, not the clock edges: the held slots add no bit and consume no symbol, so the byte arrives on the master\u2019s schedule after the slave gets out of the way. Bit-banged I\u00b2C with a fixed delay loop works on the bench and fails on the one board whose EEPROM still has a page to write.</p></section>';
  }
  function prI2cStage10() {
    return prCols(
      prTeach('A clock is a promise, not a metronome',
        '<p>Stage 5 and 6 assumed the master owned the clock. It almost does — but I\u00b2C is the one serial bus where the <em>receiver</em> can push back. Because SCL is <b>open-drain</b> (stage 1 again: a 0 sinks, a 1 just lets go), any device can hold it low, and while it is low <b>no edge happens</b>. A slave that is not ready simply keeps sinking SCL and the master quietly waits.</p>' +
        '<p>That is <b>clock stretching</b>, and it is why the bus is described as \u201cmaster-driven, slave-limited\u201d. There is no timeout to configure and no error flag for it: as far as the driver is concerned the transfer is just slower. Send the byte with a stretch and count the master\u2019s bits during the flat part of the trace.</p>') + prI2cStretchCtlCard(),
      prI2cStretchWaveCard() + prI2cStretchTableCard(),
      prGoalCard(10) + prCodeCard('What the master does about it', PR_I2C_CODE_STRETCH) + prLogCard());
  }
  var PR_I2C_CODE_STRETCH = '/* a slow slave is not a broken slave */\n\n/* the transfer as you write it - nothing here mentions stretching */\nI2C1->CR1 |= I2C_CR1_START;\nwhile ((I2C1->SR1 & I2C_SR1_SB) == 0) { }\nI2C1->DR = (0x50u << 1) | 0u;             /* 0xA0: address + write    */\nwhile ((I2C1->SR1 & I2C_SR1_ADDR) == 0) { }  /* <- stretching happens here */\nI2C1->DR = 0xA5u;                         /* the data byte            */\n\n/* why the wait is already safe: SCL is open-drain, so a slave that needs\n   time just keeps sinking it. Your write to DR moves nothing until the line\n   comes back high, and the peripheral does the waiting for you.\n\n   The trap is bit-banging with a fixed delay loop: it works on the bench\n   and fails on the one board whose EEPROM still has a page to write. */';

  /* ---- playback: one position, three sources ----
     _prAnim owns the wire while a transfer travels it; _prCap keeps that same
     record after it ends so the learner can walk it back bit by bit, and _prPos
     is where the scrubber parked it. Every renderer asks prView() instead of
     asking "is it still running?", so review needs no second code path. */
  var _prAnim = null;
  var _prCap = null;
  var _prPos = null;
  var PR_STEP_I2C = 0.55, PR_STEP_SPI = 0.5, PR_STEP_RING = 0.34;
  /* protos.speed is the multiplier itself, so an old saved state without it just runs at 1x */
  function prSpeedMul() { return protos.speed === 0.5 || protos.speed === 0.25 ? protos.speed : 1; }
  function prSpeedLabel() { return protos.speed === 0.25 ? '1/4\u00d7' : protos.speed === 0.5 ? '1/2\u00d7' : '1\u00d7'; }
  function prSpeedStep() { protos.speed = prSpeedMul() === 1 ? 0.5 : prSpeedMul() === 0.5 ? 0.25 : 1; }
  function prAnimStop() { _prAnim = null; _prCap = null; _prPos = null; }

  /* a capture goes stale the moment its inputs move out from under it */
  function prUartSig() { var u = protos.uart; return 'u' + protos.stage + ':' + u.data + u.parity + u.stop + ':' + u.char + ':' + u.drift; }
  function prI2cSig() {
    var u = protos.i2c;
    if (protos.stage === 5) { return 'i5:' + u.m1val + ',' + u.m2val; }
    return 'i' + protos.stage + ':' + u.addr + ',' + u.rw + (protos.stage === 10 ? ',' + u.stretch : '');
  }
  function prSpiSig() { var u = protos.spi; return protos.stage === 9 ? 's9:' + u.byte : 's8:' + u.mMode + ',' + u.sMode + ',' + u.byte; }
  function prCanSig() {
    var u = protos.can;
    return 'c' + protos.stage + ':' + prHex3(u.idA) + ',' + prHex3(u.idB) + ':' + prHex3(u.id) + ',' + u.dlc + ',' + u.d0 + ',' + u.d1 + ',' + (u.stuff ? 1 : 0) + ',' + (u.receiver ? 1 : 0);
  }
  function prLiveSig(kind) { return kind === 'uart' ? prUartSig() : kind === 'i2c' ? prI2cSig() : kind === 'can' ? prCanSig() : prSpiSig(); }
  function prCap() {
    if (!_prCap) { return null; }
    if (_prCap.stage !== protos.stage || _prCap.sig !== prLiveSig(_prCap.kind)) { _prCap = null; _prPos = null; return null; }
    return _prCap;
  }
  function prScrub() {
    var c = _prPos === null ? null : prCap();
    if (!c) { return null; }
    return { kind: c.kind, pos: _prPos, total: c.total, unit: c.unit, step: c.step, tx: c.tx, review: true };
  }
  function prView() { return _prAnim || prScrub(); }
  function prViewOf(kind) { var v = prView(); return v && v.kind === kind ? v : null; }
  function prUartLive() { return prViewOf('uart'); }
  function prReviewTag(v) {
    return v && v.review ? '<span class="pr-revt">\u23ea review</span> ' : '';
  }
  /* starting a transfer retires the trace you were reviewing, so the scrub bar
     only ever describes a transfer that is genuinely finished */
  function prBeginPlay() { _prCap = null; _prPos = null; }

  /* ---- the scrubber: walk a finished transfer one bit at a time ---- */
  function prScrubPos() { var c = prCap(); return c ? (_prPos === null ? c.total : _prPos) : 0; }
  function prSetPos(p) {
    var c = prCap(); if (!c) { return; }
    _prPos = Math.max(0, Math.min(c.total, Math.round(p)));
    prSyncScrub();
    prRenderLive();
  }
  function prStopScrub() { _prPos = null; prRenderStatic(); }
  function prSyncScrub() {
    var s = document.getElementById('pr-scrub'); if (s) { s.value = String(prScrubPos()); }
    var l = document.getElementById('pr-scrubpos'); if (l) { l.innerHTML = prScrubLabel(); }
    var lv = document.getElementById('pr-live'); if (lv) { lv.hidden = _prPos === null; }
  }
  function prScrubUnit(c) {
    if (c.kind === 'uart') { return 'bit'; }
    if (c.kind === 'i2c') { return 'clock'; }
    if (c.kind === 'can') { return 'bit'; }
    return c.tx && c.tx.kind === 'ring' ? 'clock' : 'half-step';
  }
  function prScrubLabel() {
    var c = prCap(); if (!c) { return ''; }
    if (_prPos === null) { return '<b>end</b> \u00b7 drag to walk it'; }
    return '<b>' + prScrubPos() + '/' + c.total + '</b> ' + prScrubUnit(c);
  }
  function prScrubBar() {
    var speed = '<button type="button" class="btn mini" id="pr-speed" title="animation speed (1\u00d7 \u2192 \u00bd \u2192 \u00bc)">' + prSpeedLabel() + ' speed</button>';
    var c = prCap();
    if (!c) { return speed; }
    var name = (prStageById(c.stage) || {}).name || '';
    return speed + '<span class="pr-scrub" role="group" aria-label="Trace position">' +
      '<span class="pr-scrubl">' + esc(name) + '</span>' +
      '<button type="button" class="btn mini" id="pr-step-back" title="one step back ( , )">\u23f4</button>' +
      '<input type="range" id="pr-scrub" min="0" max="' + c.total + '" step="1" value="' + prScrubPos() + '" aria-label="Trace position"/>' +
      '<button type="button" class="btn mini" id="pr-step-fwd" title="one step forward ( . )">\u23f5</button>' +
      '<b class="pr-scrubpos" id="pr-scrubpos" aria-live="polite">' + prScrubLabel() + '</b>' +
      /* always in the DOM, only shown while a scrub has parked the trace: the bar
         is rendered once when the transfer ends, so a button that appears an
         instant later would never appear at all */
      '<button type="button" class="btn mini" id="pr-live" title="follow the wire again"' + (prView() ? '' : ' hidden') + '>\u25b8 live</button>' +
      '</span>';
  }

  /* ---- keyboard: one table feeds the handler and the cheatsheet ---- */
  var PR_KEY_SEND = ['pr-send', 'pr-send3', 'pr-i2c-send', 'pr-i2c-send6', 'pr-spi-send', 'pr-spi-xfer'];
  var _prKeys = false;
  function prKeysOpen() { return _prKeys; }
  function prKeyLabel(k) {
    var names = { ' ': 'space', ArrowLeft: '\u2190', ArrowRight: '\u2192', ArrowUp: '\u2191', ArrowDown: '\u2193', Escape: 'esc' };
    return names[k] || k;
  }
  function prPress(id) {
    var b = document.getElementById(id);
    if (!b || b.disabled) { return false; }
    b.click();
    return true;
  }
  function prSendKey() { for (var i = 0; i < PR_KEY_SEND.length; i++) { if (prPress(PR_KEY_SEND[i])) { return; } } }
  function prStageSlot() {
    var list = prStagesInFam(prFamOfStage(protos.stage)), i;
    for (i = 0; i < list.length; i++) { if (list[i].id === protos.stage) { return i; } }
    return 0;
  }
  function prStageStep(d) {
    var list = prStagesInFam(prFamOfStage(protos.stage)), i = prStageSlot() + d;
    if (i < 0 || i >= list.length) { return; }
    prGoStage(list[i].id); prFocusTab(list[i].id);
  }
  function prFamStep(d) {
    var fam = prFamOfStage(protos.stage), i;
    for (i = 0; i < PR_FAMILIES.length; i++) { if (PR_FAMILIES[i].id === fam) { break; } }
    var next = PR_FAMILIES[i + d]; if (!next) { return; }
    var first = prStagesInFam(next.id)[0]; if (!first) { return; }
    prGoStage(first.id); prFocusTab(first.id);
  }
  function prScrubStep(d) { if (!prCap()) { return; } prSetPos(prScrubPos() + d); }
  /* the runbar buttons and the keyboard share these, so neither can drift */
  function prToggleRun() { protos.running = !protos.running; prSave(); prRenderStatic(); }
  function prResetLab() {
    var keep = protos.stage;
    prAnimStop();
    protos = prDefaults(); protos.stage = keep;
    prSeedLog(); prSave(); prRenderStatic();
  }
  function prToggleKeys(on) {
    _prKeys = on === undefined ? !_prKeys : !!on;
    prRenderStatic();
    /* the runbar was rebuilt, so hand focus back to the button that opens this */
    var t = document.getElementById('pr-keys-btn'); if (t) { t.focus(); }
  }
  var PR_KEYMAP = [
    { key: 'ArrowLeft', label: 'previous stage in this family', run: function () { prStageStep(-1); } },
    { key: 'ArrowRight', label: 'next stage in this family', run: function () { prStageStep(1); } },
    { key: 'ArrowUp', label: 'previous protocol family', run: function () { prFamStep(-1); } },
    { key: 'ArrowDown', label: 'next protocol family', run: function () { prFamStep(1); } },
    { key: ' ', label: 'run / pause the simulation', run: prToggleRun },
    { key: 's', label: 'send, on whatever this stage sends', run: prSendKey },
    { key: 'r', label: 'reset the lab', run: prResetLab },
    { key: ',', label: 'step the captured trace back one bit / clock', when: prCap, run: function () { prScrubStep(-1); } },
    { key: '.', label: 'step the captured trace forward one', when: prCap, run: function () { prScrubStep(1); } },
    { key: '?', label: 'show or hide this list', run: function () { prToggleKeys(); } },
    { key: 'Escape', label: 'hide this list', when: prKeysOpen, run: function () { prToggleKeys(false); } }
  ];
  /* typing anywhere wins over a shortcut: the terminal, the hex boxes, the sliders */
  function prKeyTyping(t) {
    if (!t || !t.tagName) { return false; }
    var tag = t.tagName.toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') { return true; }
    if (t.isContentEditable) { return true; }
    return tag === 'INPUT' && t.type !== 'range';
  }
  function prKeyOnRange(t) {
    return !!t && !!t.tagName && t.tagName.toUpperCase() === 'INPUT' && t.type === 'range';
  }
  function prKeysHandle(e) {
    if (currentView !== 'protocols' || e.ctrlKey || e.metaKey || e.altKey) { return; }
    if (prKeyTyping(e.target)) { return; }
    /* arrows belong to the slider you are standing on, not to stage navigation */
    if (prKeyOnRange(e.target) && /^Arrow|^Home$|^End$/.test(e.key)) { return; }
    for (var i = 0; i < PR_KEYMAP.length; i++) {
      var k = PR_KEYMAP[i];
      if (k.key !== e.key) { continue; }
      if (k.when && !k.when()) { continue; }
      e.preventDefault();
      k.run(e);
      return;
    }
  }
  function prKeysBtn() {
    return '<button type="button" class="btn mini" id="pr-keys-btn" aria-expanded="' + String(_prKeys) + '" aria-controls="pr-keys" title="keyboard shortcuts ( ? )">? keys</button>';
  }
  function prKeysCard() {
    var rows = PR_KEYMAP.map(function (k) {
      var off = k.when && !k.when();
      return '<tr' + (off ? ' class="dim"' : '') + '><td class="k"><kbd>' + esc(prKeyLabel(k.key)) + '</kbd></td><td>' + esc(k.label) + (off ? ' \u00b7 after a transfer has finished' : '') + '</td></tr>';
    }).join('');
    return '<section class="pf-card" id="pr-keys"><h3>Keyboard<span class="pf-sub">the whole lab is drivable without a mouse</span></h3>' +
      '<table class="pr-bit tbl"><tr><th>key</th><th>what it does</th></tr>' + rows + '</table>' +
      '<p class="pf-hint">Shortcuts are off everywhere else in the app, and inert while you are typing in a field \u2014 the terminal still takes spaces, the hex boxes still take arrows. Sliders keep their own arrow keys too: stand on the trace slider and <b>\u2190 \u2192</b> walks the capture instead of changing stage.</p></section>';
  }

  /* ---- what the scrubber is for: what a receiver had decided by step k ---- */
  function prScrubUartHtml(tx, k) {
    var u = protos.uart, smp = prRxSamples(tx.bits, tx.drift), i, mis = 0;
    for (i = 0; i < smp.length && i < k; i++) { if (smp[i].bad) { mis++; } }
    var at = Math.min(k, smp.length - 1), s = smp[at], off = s ? s.pos - (at + 0.5) : 0;   /* bit-times past the centre it aimed at */
    var ch = 0, got = Math.max(0, Math.min(k - 1, u.data));
    for (i = 0; i < got; i++) { if (smp[1 + i] && smp[1 + i].v) { ch |= (1 << i); } }
    var shown = '';
    for (i = 7; i >= 0; i--) { shown += i < got ? ((ch >>> i) & 1) : '\u00b7'; }
    return ' · receiver so far <b>' + shown + '</b> (' + got + '/' + u.data + ' data bits in, LSB-first)'
      + ' · its sample for bit ' + at + ' sits <b>' + (off >= 0 ? '+' : '') + (off * 100).toFixed(0) + '%</b> of a bit off centre'
      + (Math.abs(off) >= 0.5 ? ' <span class="bad">\u2014 that is a mis-read</span>' : ' <span class="good">\u00b7 still inside the window</span>')
      + (mis ? ' · <span class="bad">' + mis + ' mis-sampled so far</span>' : '');
  }
  function prScrubI2cHtml(slots, k) {
    var s = slots[k];
    if (!s) { return ''; }
    if (s.loser) { return ' \u2694 <b>this is the clock ' + s.loser + ' loses</b> \u2014 it drove 1 and the wire reads 0, so it drops off before the next clock.'; }
    if (s.kind === 'ack') { return ' clock 9 belongs to the <b>receiver</b>: ' + (s.sda ? 'SDA stays high' : 'the slave sinks SDA low') + '.'; }
    if (s.kind === 'nack') { return ' clock 9: nobody sank SDA \u2014 <b>NACK</b>, no device at this address.'; }
    if (s.kind === 'stretch') { return ' SCL is held low by the slave \u2014 an extra clock period with no edge in it, so the master cannot advance. This is the whole of clock stretching.'; }
    if (s.kind === 'start') { return ' START: SDA falls <em>while SCL is high</em> \u2014 the one transition that means "a transfer is beginning".'; }
    if (s.kind === 'restart') { return ' Sr: a repeated START with no STOP in between \u2014 the master keeps the bus and flips direction.'; }
    if (s.kind === 'stop') { return ' STOP: SDA rises while SCL is high \u2014 the bus is free again.'; }
    return ' driving <b>' + s.sda + '</b>' + (s.w1 != null ? ' \u00b7 M1 wants ' + s.w1 + ', M2 wants ' + s.w2 + ' \u2014 the wire is their AND' : '') + '.';
  }
  function prScrubSpiHtml(tx, k) {
    var bits = prSpiBits(tx.out), cells = '', i, latched = 0, val = 0;
    for (i = 0; i < 8; i++) {
      var p = prSpiSample(tx.m, tx.s, i), seen = k > p;
      cells += seen ? prSpiReadBit(tx.m, tx.s, bits, i) : '\u00b7';
      if (seen) { latched++; val = (val << 1) | prSpiReadBit(tx.m, tx.s, bits, i); }
    }
    return ' · slave has looked at <b>' + latched + '/8</b> windows \u00b7 ' + cells + (latched === 8 ? ' = ' + esc(prHex(val)) : '');
  }

  /* ---- I2C animation + tick ---- */
  function prI2cTick() {
    var st = protos.stage, u = protos.i2c;
    if (!_prAnim || _prAnim.kind !== 'i2c') {
      if ((st === 5 || st === 6 || st === 10) && u.tx) {
        _prAnim = { kind: 'i2c', pos: 0, total: u.tx.slots.length, cur: 0, unit: 1, step: PR_STEP_I2C, tx: u.tx };
        prBeginPlay();
        return true;
      }
      return false;
    }
    if (!protos.running || !u.tx) { _prAnim = null; return false; }
    _prAnim.pos += _prAnim.step * prSpeedMul();
    var k = Math.floor(_prAnim.pos);
    if (k > _prAnim.cur && k <= u.tx.slots.length) { _prAnim.cur = k; }
    if (_prAnim.pos >= _prAnim.total) {
      var tx = u.tx, anim = _prAnim; u.tx = null; _prAnim = null;
      _prCap = { kind: 'i2c', stage: st, pos: anim.total, total: tx.slots.length, unit: 1, step: anim.step, tx: tx, sig: prI2cSig() };
      _prPos = null;
      u.sends++;
      if (tx.kind === 'masters') {
        var lz = null; for (var i = 0; i < tx.slots.length; i++) { if (tx.slots[i].loser) { lz = tx.slots[i].loser; break; } }
        if (tx.lostAt >= 0) {
          u.collisions++;
          u.result = { kind: 'masters', slots: tx.slots, lostAt: tx.lostAt, loser: lz };
          prLog('err', 'arbitration: ' + lz + ' lost at A' + (6 - tx.lostAt) + ' \u2014 dropped off, ' + (lz === 'M1' ? 'M2' : 'M1') + ' finished the byte');
        } else {
          u.result = { kind: 'masters', slots: tx.slots, lostAt: null };
          prLog('note', 'both masters sent the identical byte \u2014 no divergence, no loser; one of them keeps talking and both believe they won (this is not a feature)');
        }
      } else if (tx.kind === 'stretch') {
        var acked2 = tx.addr === PR_I2C_SLAVE;
        if (acked2) { u.acked++; }
        if (tx.stretch > 0) { u.stretches++; }
        u.result = { kind: 'stretch', slots: tx.slots, addr: tx.addr, rw: tx.rw, stretch: tx.stretch };
        prLog(tx.stretch ? 'note' : 'ok', tx.stretch
          ? 'slave 0x' + tx.addr.toString(16).toUpperCase() + ' stretched SCL for ' + tx.stretch + ' clock period' + (tx.stretch > 1 ? 's' : '') + ' after its ACK \u2014 the master simply waited, then wrote the data byte'
          : 'no stretch: the slave was ready immediately and the clock never left the master');
      } else {
        var acked = tx.addr === PR_I2C_SLAVE;
        if (acked) { u.acked++; }
        u.result = { kind: acked ? (tx.sr ? 'sr' : 'ack') : 'nack', slots: tx.slots, addr: tx.addr, rw: tx.rw };
        prLog(acked ? 'ok' : 'err', (acked ? 'ACK from 0x' + tx.addr.toString(16).toUpperCase() : 'NACK \u2014 0x' + tx.addr.toString(16).toUpperCase() + ' is not on this bus') + (tx.sr ? ' (repeated-start transfer)' : ''));
      }
      prSave(); prRenderStatic();
      return true;
    }
    return true;
  }

  function prSpiLive() { return prViewOf('spi'); }

  /* ---- SPI animation + tick ---- */
  function prSpiTick() {
    var st = protos.stage, u = protos.spi;
    if (!_prAnim || _prAnim.kind !== 'spi') {
      if ((st === 8 || st === 9) && u.tx) {
        _prAnim = { kind: 'spi', pos: 0, total: u.tx.kind === 'ring' ? 8 : 16, cur: 0,
                    unit: u.tx.kind === 'ring' ? 2 : 1, step: u.tx.kind === 'ring' ? PR_STEP_RING : PR_STEP_SPI, tx: u.tx };
        prBeginPlay();
        return true;
      }
      return false;
    }
    if (!protos.running || !u.tx) { _prAnim = null; return false; }
    _prAnim.pos += _prAnim.step * prSpeedMul();
    if (_prAnim.pos < _prAnim.total) { return true; }
    var tx = u.tx, anim = _prAnim; u.tx = null; _prAnim = null;
    _prCap = { kind: 'spi', stage: st, pos: anim.total, total: anim.total, unit: anim.unit, step: anim.step, tx: tx, sig: prSpiSig() };
    _prPos = null;
    if (tx.kind === 'modes') {
      var got = prSpiRecv(tx.m, tx.s, prSpiBits(tx.out));
      u.sends++; u.lastGot = got;
      var morph = prSpiMorph(tx.m, tx.s);
      if (morph === 'match') { u.okReads++; } else { u.mismatches++; }
      u.result = { kind: 'modes', sent: tx.out, got: got, morph: morph };
      prLog(morph === 'match' ? 'ok' : 'err', 'mode ' + tx.m + ' master / mode ' + tx.s + ' slave: ' +
        prHex(tx.out) + ' \u2192 ' + prHex(got) + (morph === 'match' ? ' \u2713' : morph === 'marginal' ? ' (sampled on the change edge \u2014 lucky today)' : ' (shifted by one)'));
    } else {
      var before = u.slaveShift, parBefore = u.slavePar;
      u.exchanges++;
      var stale = before !== parBefore;
      if (stale) { u.staleSeen = true; }
      else if (u.staleSeen) { u.freshRead = true; }
      u.masterIn = before;
      u.slaveShift = parBefore;                       /* parallel load at the transfer edge */
      u.result = { kind: 'ring', got: before, out: tx.out, stale: stale };
      prLog(stale ? 'err' : 'ok', 'exchange ' + prHex(tx.out) + ' \u2192 master latched ' + prHex(before) +
        (stale ? ' (stale: the new conversion was still waiting to load)' : ' (fresh \u2014 this is the current measurement)'));
    }
    prSave(); prRenderStatic();
    return true;
  }

  /* ---- CAN animation + tick ---- */
  var PR_STEP_CAN = 0.6;
  function prCanTick() {
    var st = protos.stage, u = protos.can, nb;
    if (!_prAnim || _prAnim.kind !== 'can') {
      if ((st === 11 || st === 12) && u.tx) {
        nb = prCanBits(u.tx).length;
        _prAnim = { kind: 'can', pos: 0, total: nb, cur: 0, unit: 1, step: PR_STEP_CAN, tx: u.tx, nbits: nb };
        prBeginPlay();
        return true;
      }
      return false;
    }
    if (!protos.running || !u.tx) { _prAnim = null; return false; }
    _prAnim.pos += _prAnim.step * prSpeedMul();
    var k = Math.floor(_prAnim.pos);
    if (k > _prAnim.cur && k <= _prAnim.nbits) { _prAnim.cur = k; }
    if (_prAnim.pos < _prAnim.total) { return true; }
    var tx = u.tx, anim = _prAnim; u.tx = null; _prAnim = null;
    _prCap = { kind: 'can', stage: st, pos: anim.total, total: anim.total, unit: 1, step: anim.step, tx: tx, sig: prCanSig() };
    _prPos = null;
    if (tx.kind === 'arb') {
      var r = tx.arb;
      if (r.lostAt >= 0) {
        u.arbs++;
        u.winnerId = r.winner === 'A' ? tx.idA : tx.idB;
        u.loserId = r.loser === 'A' ? tx.idA : tx.idB;
        u.result = { kind: 'arb', bits: tx.bits, arb: r, lostAt: r.lostAt, loser: r.loser, winner: r.winner };
        prLog('note', 'arbitration: node ' + r.loser + ' (0x' + prHex3(r.loser === 'A' ? tx.idA : tx.idB) + ') wanted 1 and read 0 at ' + r.bits[r.lostAt].l +
          ' \u2014 it drops out and listens; 0x' + prHex3(u.winnerId) + ' keeps the bus and its frame is untouched');
      } else {
        u.result = { kind: 'arb', bits: tx.bits, arb: r, lostAt: -1 };
        prLog('err', 'both nodes sent the identical ID 0x' + prHex3(tx.idA) + ' \u2014 nothing diverges, so both believe they won; if their data differs, one of them will smash the frame and everyone retries');
      }
    } else {
      u.frames++;
      if (tx.stuff) { u.stuffSeen = true; }
      if (tx.acked) { u.acks++; } else { u.nacks++; }
      u.result = { kind: 'frame', bits: tx.bits, raw: tx.raw, stuff: tx.stuff, id: tx.id, dlc: tx.dlc, acked: tx.acked };
      prLog(tx.acked ? 'ok' : 'err', 'frame 0x' + prHex3(tx.id) + ' dlc ' + tx.dlc + ', ' + tx.raw.length + ' bits' +
        (tx.stuff ? ' + ' + tx.stuff + ' stuff bit' + (tx.stuff > 1 ? 's' : '') : ' (no run of five)') +
        (tx.acked ? ' \u2014 ACK slot pulled dominant: somebody heard it' : ' \u2014 ACK slot stayed recessive: nobody heard it, and a real controller keeps retrying'));
    }
    prSave(); prRenderStatic();
    return true;
  }

  /* ---- goals 5 + 6 ---- */
  var PR_I2C_CODE_STATIC = '/* every I2C driver you will ever ship starts like this */\nI2C1->CR1 |= I2C_CR1_PE;               /* peripheral enable */\nI2C1->CR2 = 8;                          /* 8 MHz kernel clock */\nI2C1->CCR = 40; I2C1->TRISE = 9;        /* ~100 kHz standard mode */\n\n/* start talking: START, then the address byte MSB-first */\nI2C1->CR1 |= I2C_CR1_START;\nwhile ((I2C1->SR1 & I2C_SR1_SB) == 0) { }\nI2C1->DR = (0x50u << 1) | 0u;           /* 0xA0 = 0x50 + write */\n\n/* arbitration is not code you write - it is physics you rely on:\n   drive 1 = release, read the line back; 1 sent / 0 seen = quit. */';
  var PR_I2C_CODE_TWO = '/* the same transaction seen from two altitudes */\n\n/* 1) a register read on a typical sensor */\nuint8_t v = I2C_ReadReg(0x3C, REG_WHO_AM_I);\n\n/* 2) what it expands to on the wire */\nI2C1->CR1 |= I2C_CR1_START;\nI2C1->DR = (0x3Cu << 1) | 0u;           /* 0x78: address + write */\nI2C1->DR = REG_WHO_AM_I;                /* register pointer       */\nI2C1->CR1 |= I2C_CR1_START;             /* Sr: keep the bus, flip */\nI2C1->DR = (0x3Cu << 1) | 1u;           /* 0x79: address + read   */\nv = I2C1->DR;                           /* the slave drives this  */\nI2C1->CR1 |= I2C_CR1_STOP;\n\n/* datasheet address 0x3C; wire byte 0x78 or 0x79. The bus has room\n   for 128 devices, 16 of them reserved. Count them before you buy. */\n\n/* the bus has room for 128 devices (16 reserved) */\n/* HAL convention: it hands you the wire byte, datasheets print the */\n/* 7-bit address: 0xA0 >> 1 = 0x50. One shift, endless confusion. */';


  /* ---- SPI (stages 8 + 9): the sender owns the clock; the shift ring is the whole protocol ---- */
  function prSpiCpol(m) { return (m >> 1) & 1; }
  function prSpiCpha(m) { return m & 1; }
  function prSpiEdge(m) { return (m === 0 || m === 3) ? 'rising' : 'falling'; }
  function prSpiChange(m) { return (m === 0 || m === 3) ? 'falling' : 'rising'; }
  /* half-step timeline: bit i occupies clock period i = [2i, 2i+2). Master puts bit i on
     the line at the launch step; the window is 2 half-steps wide. */
  function prSpiLaunch(m, i) { return 2 * i + (prSpiCpha(m) ? 0 : -1); }
  function prSpiSample(m, s, i) {
    var p = 2 * i + prSpiCpha(s) + (prSpiCpol(m) !== prSpiCpol(s) ? 1 : 0);
    return ((p % 16) + 16) % 16;
  }
  function prSpiReadBit(m, s, bits, i) {
    if (m === s) { return bits[i]; }
    var j = i + Math.floor((prSpiSample(m, s, i) - prSpiLaunch(m, i)) / 2);
    return (j >= 0 && j < bits.length) ? bits[j] : 0;
  }
  function prSpiBits(v) { var b = []; for (var i = 7; i >= 0; i--) { b.push((v >>> i) & 1); } return b; }
  function prSpiFromBits(b) { var v = 0; for (var i = 0; i < 8; i++) { v = (v << 1) | (b[i] & 1); } return v; }
  function prSpiLine(m, bits, h) {
    var j = prSpiCpha(m) ? Math.floor(h / 2) : Math.floor((h + 1) / 2);
    if (j < 0) { return 0; }
    if (j > 7) { return bits[7]; }        /* line holds its last bit between transfers */
    return bits[j];
  }
  function prSpiRecv(m, s, bits) {
    var out = [], i;
    for (i = 0; i < 8; i++) { out.push(prSpiReadBit(m, s, bits, i)); }
    return prSpiFromBits(out);
  }
  function prSpiMorph(m, s) { return m === s ? 'match' : (prSpiCpol(m) === prSpiCpol(s) ? 'marginal' : 'shift'); }

  /* ---- shared 2-lane LA for SPI, in half-step resolution ---- */
  var _prSpiPlay = null;
  function prSpiLane(steps, get, yH, yL, left, cw) {
    var pts = '', prevY = get(steps.length ? steps[0] : 0) ? yH : yL, i;
    pts += left.toFixed(1) + ',' + prevY + ' ';
    for (i = 0; i < steps.length; i++) {
      var y = get(steps[i]) ? yH : yL, x0 = left + i * cw, x1 = x0 + cw;
      pts += x0.toFixed(1) + ',' + prevY + ' ' + x0.toFixed(1) + ',' + y + ' ' + x1.toFixed(1) + ',' + y + ' ';
      prevY = y;
    }
    return pts.trim();
  }
  function prSpiWave(m, s, bits, opt) {
    var left = 40, W = 300, cw = (W - 48) / 16;
    _prSpiPlay = { left: left, cw: cw, id: (opt && opt.playId) || 'pr-spi-play' };
    var i, steps = [], grid = '', marks = '', labs = '';
    for (i = 0; i < 16; i++) { steps.push({ c: (i % 2 === 0) ? 1 - prSpiCpol(m) : prSpiCpol(m), d: prSpiLine(m, bits, i) }); }
    for (i = 1; i < 16; i++) { var gx = (left + i * cw).toFixed(1); grid += '<line class="grid" x1="' + gx + '" y1="20" x2="' + gx + '" y2="112"/>'; }
    for (i = 0; i < 8; i++) {
      var px = left + prSpiSample(m, s, i) * cw;
      marks += '<polygon class="edge' + (m === s ? '' : ' bad') + '" points="' + px.toFixed(1) + ',56 ' + (px - 3).toFixed(1) + ',49 ' + (px + 3).toFixed(1) + ',49"/>';
    }
    for (i = 0; i < 8; i++) {
      var bx = left + (2 * i) * cw;
      labs += '<rect class="segbox data" x="' + bx.toFixed(1) + '" y="94" width="' + (2 * cw - 1).toFixed(1) + '" height="18"/>' +
        '<text class="seglab" x="' + (bx + cw).toFixed(1) + '" y="107">' + bits[i] + '</text>';
    }
    var play = '<line id="' + _prSpiPlay.id + '" class="play" x1="' + left.toFixed(1) + '" x2="' + left.toFixed(1) + '" y1="14" y2="116" opacity="' + ((opt && opt.playOn) ? '1' : '0') + '"/>';
    return '<div class="pr-la"><svg viewBox="0 0 ' + W + ' 120">' +
      '<text class="clab" x="5" y="33">SCLK</text><text class="clab" x="5" y="69">MOSI</text>' +
      '<polyline class="trace clk" points="' + prSpiLane(steps, function (o) { return o.c; }, 22, 44, left, cw) + '"/>' +
      '<polyline class="trace" points="' + prSpiLane(steps, function (o) { return o.d; }, 58, 84, left, cw) + '"/>' +
      grid + marks + labs + play + '</svg></div>';
  }

  function prSpiModeSegCard() {
    var u = protos.spi, rows = '', m;
    for (m = 0; m < 4; m++) {
      rows += '<tr><td class="k">mode ' + m + '</td><td>' + prSpiCpol(m) + '</td><td>' + prSpiCpha(m) + '</td>' +
        '<td>' + (prSpiCpol(m) ? 'high' : 'low') + '</td><td>' + prSpiEdge(m) + '</td><td>' + prSpiChange(m) + '</td>' +
        '<td>' + (u.mMode === m ? 'master' : '') + (u.mMode === m && u.sMode === m ? ' + slave' : (u.sMode === m ? 'slave' : '')) + '</td></tr>';
    }
    return '<section class="pf-card"><h3>The four modes are one 2-bit number<span class="pf-sub">CPOL sets idle, CPHA sets the edge</span></h3>' +
      '<table class="pr-bit tbl"><tr><th>mode</th><th>CPOL</th><th>CPHA</th><th>clock idles</th><th>sample on</th><th>change on</th><th>in use</th></tr>' + rows + '</table>' +
      '<p class="pf-hint">There is no negotiation in SPI: both sides are <b>configured</b>, and a datasheet hands you a mode number. Get the clock idle level wrong and the other side is half a period off \u2014 which is exactly the <b>bit-shifted byte</b> you will find on a logic analyser at 2 a.m.</p></section>';
  }
  function prSpiCtlCard() {
    var u = protos.spi;
    function seg(name, cur) {
      return prSeg(name, [{ v: '0', t: '0' }, { v: '1', t: '1' }, { v: '2', t: '2' }, { v: '3', t: '3' }], String(cur));
    }
    return '<section class="pf-card"><h3>Two chips, one cable, maybe two opinions<span class="pf-sub">master drives, slave samples</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">Master mode</span>' + seg('spimm', u.mMode) +
        '<span class="lbl">Slave mode</span>' + seg('spism', u.sMode) + '</div>' +
      '<div class="pr-ctlrow"><span class="lbl">Byte (hex)</span><input id="pr-spi-byte" size="4" maxlength="2" value="' + u.byte.toString(16).toUpperCase() + '"/>' +
        '<button type="button" class="btn" id="pr-spi-send"' + (u.tx ? ' disabled' : '') + '>\u25b6 Clock it out</button>' +
        '<button type="button" class="btn mini" data-spipair="0,0">both mode 0</button>' +
        '<button type="button" class="btn mini" data-spipair="0,1">CPHA only</button>' +
        '<button type="button" class="btn mini" data-spipair="0,2">CPOL only</button></div>' +
      '<p class="pf-hint">The master shifts MSB-first and clocks every bit; the slave only knows <em>when it is allowed to look</em>. Markers above the MOSI trace are the slave\u2019s sample instants \u2014 green when they sit inside the bit window, amber when they sit on an edge.</p></section>';
  }
  function prSpiBin(v) { var s = '', b; for (b = 7; b >= 0; b--) { s += ((v >>> b) & 1) ? '1' : '0'; } return s; }
  function prSpiReadHtml() {
    var u = protos.spi, a = prSpiLive(), tx = a && a.tx && a.tx.kind === 'modes' ? a.tx : null;
    if (tx) {
      return prReviewTag(a) + (a.review ? 'reviewing \u2014 ' : 'clocking \u2014 ') + 'half-step ' + Math.min(Math.floor(a.pos), 16) + '/16 \u00b7 master mode ' + tx.m + ', slave mode ' + tx.s +
        (a.review ? prScrubSpiHtml(tx, Math.floor(a.pos)) : '');
    }
    var r = u.result && u.result.kind === 'modes' ? u.result : null;
    if (!r) { return 'idle \u2014 SCLK sits at ' + (prSpiCpol(u.mMode) ? 'high' : 'low') + '. Nothing moves until the master clocks.'; }
    var verdict;
    if (r.morph === 'match') {
      verdict = '<span class="good">\u2713 same mode \u2192 the sample lands mid-window</span>';
    } else if (r.got !== r.sent) {
      verdict = '<span class="bad">\u2717 ' + esc(prSpiBin(r.got)) + ' is ' + esc(prSpiBin(r.sent)) + ' shifted one window \u2014 the classic mode-mismatch signature</span>';
    } else {
      verdict = '<span class="bad">marginal: the value survived, but the sample sits exactly on the edge where the master changes the line \u2014 this board reads it right, the next one will not</span>';
    }
    return 'sent <b>' + esc(prHex(r.sent)) + '</b> \u2192 slave latched <b class="' + (r.got === r.sent ? 'good' : 'bad') + '">' + esc(prHex(r.got)) + '</b> \u00b7 ' +
      verdict + ' <span class="k">(' + u.okReads + ' matched, ' + u.mismatches + ' mismatched out of ' + u.sends + ')</span>';
  }
  function prSpiWaveCard() {
    var u = protos.spi, a = prSpiLive(), v = a && a.tx && a.tx.kind === 'modes' ? a.tx : null;
    var mm = v ? v.m : u.mMode, sm = v ? v.s : u.sMode, sentByte = v ? v.out : u.byte;
    return '<section class="pf-card" id="pr-spi-wavecard"><h3>Logic analyser<span class="pf-sub">SCLK + MOSI, MSB-first, ' + esc(prHex(sentByte)) + '</span></h3>' +
      prSpiWave(mm, sm, prSpiBits(sentByte), { playOn: false }) +
      '<div class="pr-read" id="pr-spi-read">' + prSpiReadHtml() + '</div></section>';
  }
  function prSpiStage8() {
    return prCols(
      prTeach('The sender owns the clock, so there is no frame',
        '<p>UART had to invent a start bit because <em>nobody</em> supplies a clock. SPI does: the master generates SCLK, one period per bit, so there is no framing, no baud error, no start/stop overhead \u2014 and no way for the slave to say anything back except on its own wire. The price is two numbers you must agree on <b>before</b> power-on: <b>CPOL</b> (which way the clock idles) and <b>CPHA</b> (which edge the receiver looks at).</p>' +
        '<p>Four combinations, four modes, and that is the entire configuration space. Drive the clock with the wrong idle level and your neighbour samples half a period late: it reads the <em>next</em> bit, so the byte arrives shifted by one \u2014 the most recognizable corruption pattern in the field. Set both to the same mode and it just works; try the presets and read the verdict.</p>') +
      prSpiCtlCard() + prSpiModeSegCard(),
      prSpiWaveCard(),
      prGoalCard(8) + prCodeCard('SPI1 in mode ' + protos.spi.mMode, prSpiModeCode()) + prLogCard());
  }
  function prSpiModeCode() {
    var u = protos.spi, cpol = prSpiCpol(u.mMode), cpha = prSpiCpha(u.mMode);
    return '/* mode ' + u.mMode + ' = CPOL ' + cpol + ' / CPHA ' + cpha + ' */\n' +
      'SPI1->CR1 = 0;                             /* stop while reconfiguring */\n' +
      'SPI1->CR1 |= SPI_CR1_MSTR;                 /* we generate SCLK         */\n' +
      (cpol ? 'SPI1->CR1 |= SPI_CR1_CPOL;               /* clock idles high       */\n' : '/* CPOL = 0: clock idles low (bit stays clear) */\n') +
      (cpha ? 'SPI1->CR1 |= SPI_CR1_CPHA;               /* sample on the 2nd edge */\n' : '/* CPHA = 0: sample on the 1st edge */\n') +
      'SPI1->CR1 |= (4u << 3);                    /* BR: fPCLK/16             */\n' +
      'SPI1->CR1 |= SPI_CR1_SPE;                  /* enable the peripheral    */\n\n' +
      '/* SPI has no read command: an exchange is simultaneous in + out */\n' +
      'SPI1->DR = ' + prHex(u.byte) + 'u;                          /* out on MOSI          */\n' +
      'while ((SPI1->SR & SPI_SR_RXNE) == 0) { }  /* something already came in */\n' +
      'uint8_t in = *(volatile uint8_t *)&SPI1->DR;';
  }

  /* ---- stage 9: the shift ring ---- */
  function prSpiRingSrc(u) {
    var a = prSpiLive(), tx = a && a.tx && a.tx.kind === 'ring' ? a.tx : null;
    if (tx) { return { out: tx.out, sb: tx.slaveBefore }; }
    if (u.result && u.result.kind === 'ring') { return { out: u.result.out, sb: u.result.got }; }
    return { out: u.byte, sb: u.slaveShift };
  }
  function prSpiRingState(u, k) {
    var src = prSpiRingSrc(u);
    var B = prSpiBits(src.out), SB = prSpiBits(src.sb);
    var m = [], sl = [], i;
    k = Math.max(0, Math.min(8, k));
    for (i = 0; i < 8; i++) { m.push(i < 8 - k ? B[i + k] : SB[i - (8 - k)]); }
    for (i = 0; i < 8; i++) { sl.push(i < 8 - k ? SB[i + k] : B[i - (8 - k)]); }
    return { master: m, slave: sl };
  }
  function prRingRow(name, bits, cls) {
    var cells = '', i;
    for (i = 0; i < 8; i++) { cells += '<b class="' + (bits[i] ? 'one' : '') + '">' + bits[i] + '</b>'; }
    return '<span class="rn">' + esc(name) + '</span><span class="ff ' + (cls || '') + '">' + cells + '</span>';
  }
  function prSpiRingCard() {
    var u = protos.spi, a = prSpiLive(), k = a ? Math.min(Math.floor(a.pos), 8) : (u.result && u.result.kind === 'ring' ? 8 : 0);
    var src = prSpiRingSrc(u), st = prSpiRingState(u, k);
    return '<section class="pf-card" id="pr-spi-ring"><h3>One ring, two chips<span class="pf-sub">eight clocks = a complete swap</span></h3>' +
      '<div class="pr-ring">' + prRingRow('master \u2014 sending ' + esc(prHex(src.out)), st.master, 'm') +
        '<span class="arw">\u21c4</span>' + prRingRow('slave \u2014 held ' + esc(prHex(src.sb)) + ' before', st.slave, 's') + '</div>' +
      '<div class="pr-read">' + (a ? prReviewTag(a) : '') + (k === 0 ? 'every clock pushes one bit out of each chip and lets one bit in \u2014 neither register ever empties' :
        k < 8 ? 'clock ' + k + '/8 \u00b7 ' + esc(prHex(prSpiFromBits(st.master))) + ' so far in the master, ' + esc(prHex(prSpiFromBits(st.slave))) + ' in the slave' :
        'exchange complete \u2014 master now holds <b>' + esc(prHex(prSpiFromBits(st.master))) + '</b>, slave holds the byte you sent' + (u.result && u.result.stale ? ' <span class="bad">(that was the <em>previous</em> measurement)</span>' : ' <span class="good">(this is the current one)</span>')) + '</div>' +
      '<p class="pf-hint">There is no such thing as an SPI <b>read</b>, only an <b>exchange</b>: while your byte travels out on MOSI, the other chip\u2019s byte travels in on MISO. So the value you get answers the question <em>“what was it about to say before I asked?”</em> \u2014 one transaction behind, every time, on every SPI device on earth.</p></section>';
  }
  function prSpiRingWave() {
    var u = protos.spi, src = prSpiRingSrc(u);
    var out = prSpiBits(src.out), inn = prSpiBits(src.sb);
    var left = 40, W = 300, cw = (W - 48) / 16, i, steps = [], grid = '';
    _prSpiPlay = { left: left, cw: cw, id: 'pr-spi-ring-play' };
    for (i = 0; i < 16; i++) {
      var j = Math.floor(i / 2);
      steps.push({ c: (i % 2 === 0) ? 1 - prSpiCpol(u.mMode) : prSpiCpol(u.mMode), o: out[j], n: inn[j] });
    }
    for (i = 1; i < 16; i++) { var gx = (left + i * cw).toFixed(1); grid += '<line class="grid" x1="' + gx + '" y1="14" x2="' + gx + '" y2="136"/>'; }
    var labs = '';
    for (i = 0; i < 8; i++) {
      var bx = left + (2 * i) * cw;
      labs += '<rect class="segbox data" x="' + bx.toFixed(1) + '" y="142" width="' + (2 * cw - 1).toFixed(1) + '" height="18"/>' +
        '<text class="seglab" x="' + (bx + cw).toFixed(1) + '" y="155">' + out[i] + '/' + inn[i] + '</text>';
    }
    var play = '<line id="pr-spi-ring-play" class="play" x1="' + left.toFixed(1) + '" x2="' + left.toFixed(1) + '" y1="8" y2="164" opacity="0"/>';
    return '<div class="pr-la"><svg viewBox="0 0 ' + W + ' 168">' +
      '<text class="clab" x="5" y="26">SCLK</text><text class="clab" x="5" y="54">MOSI</text><text class="clab" x="5" y="82">MISO</text>' +
      '<polyline class="trace clk" points="' + prSpiLane(steps, function (o) { return o.c; }, 16, 34, left, cw) + '"/>' +
      '<polyline class="trace" points="' + prSpiLane(steps, function (o) { return o.o; }, 46, 64, left, cw) + '"/>' +
      '<polyline class="trace miso" points="' + prSpiLane(steps, function (o) { return o.n; }, 74, 92, left, cw) + '"/>' +
      grid + labs + play + '</svg></div>';
  }
  function prSpiXferReadHtml() {
    var u = protos.spi;
    return 'sensor will say next: <b>' + esc(prHex(u.slaveShift)) + '</b> \u00b7 latest measurement waiting to load: <b>' + esc(prHex(u.slavePar)) + '</b>' +
      (u.result && u.result.kind === 'ring' ? ' \u00b7 master received: <b class="' + (u.result.stale ? 'bad' : 'good') + '">' + esc(prHex(u.result.got)) + '</b>' : '');
  }
  function prSpiXferCtlCard() {
    var u = protos.spi;
    return '<section class="pf-card"><h3>Ask twice, get the answer once<span class="pf-sub">write \u2192 trigger \u2192 dummy read</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">Byte to clock out</span><input id="pr-spi-xbyte" size="4" maxlength="2" value="' + u.byte.toString(16).toUpperCase() + '"/></div>' +
      '<div class="pr-ctlrow"><button type="button" class="btn" id="pr-spi-xfer"' + (u.tx ? ' disabled' : '') + '>\u25b6 Exchange</button>' +
        '<button type="button" class="btn mini" data-spidummy="1">\u21ba Dummy read (0x00)</button>' +
        '<button type="button" class="btn mini" data-spinew="1">\u26a1 Sensor completes a new measurement</button></div>' +
      '<div class="pr-read" id="pr-spi-xread">' + prSpiXferReadHtml() + '</div>' +
      '<p class="pf-hint">The measurement register is only copied into the shift ring <b>at the edge of a transfer</b>. Clock once and you shift out whatever was already queued \u2014 the previous conversion. Trigger a new measurement, then exchange a dummy <code>0x00</code>, and the fresh value walks out while your zeros walk in. This is why every SPI driver on earth writes a byte it does not care about.</p></section>';
  }
  function prSpiStage9() {
    return prCols(
      prTeach('Full duplex is not a feature, it is the wiring',
        '<p>Two separate data wires \u2014 MOSI out, MISO in \u2014 mean both chips can shift at the same time. Nothing is ever <em>only</em> read or <em>only</em> written: eight clocks always move eight bits each way. The peripheral registers reflect that: you write to <code>SPI1-&gt;DR</code> and the same register hands you back the byte that arrived.</p>' +
        '<p>Consequence, and this is the one people learn the hard way: the byte you receive is the one the slave had <b>ready before this transfer started</b>. Real devices lean on it \u2014 a command byte, then a dummy byte to clock the result out. If your driver reads garbage on the first attempt and the right value on the second, you have not found a bug in the part; you have found the ring.</p>') +
      prSpiXferCtlCard() + prSpiRingCard(),
      '<section class="pf-card" id="pr-spi-xwave"><h3>Logic analyser<span class="pf-sub">three lanes: clock, out, in</span></h3>' + prSpiRingWave() + '</section>',
      prGoalCard(9) + prCodeCard('The two-transfer idiom', PR_SPI_RING_CODE) + prLogCard());
  }
  var PR_SPI_RING_CODE = '/* reading a register over SPI is always a two-step: */\n\n/* 1) the command transfer. We clock it out; whatever comes back on\n   MISO is stale data from the previous transaction - discard it.   */\nSPI1->CR1 |= SPI_CR1_CS;                   /* select the device     */\nSPI1->DR = REG_STATUS | 0x80u;             /* "give me status"      */\nwhile ((SPI1->SR & SPI_SR_RXNE) == 0) { }\n(void)*(volatile uint8_t *)&SPI1->DR;      /* throw the old byte away */\n\n/* 2) the dummy transfer. We send nothing interesting so the device\n   can send everything it has. This is the read.                  */\nSPI1->DR = 0x00u;\nwhile ((SPI1->SR & SPI_SR_RXNE) == 0) { }\nuint8_t status = *(volatile uint8_t *)&SPI1->DR;\nSPI1->CR1 &= ~SPI_CR1_CS;\n\n/* HAL hides exactly this: HAL_SPI_TransmitReceive() with a dummy TX\n   buffer. Some parts need a CS toggle between the two transfers,\n   some need CS held \u2014 read the datasheet timing diagram, not the demo. */';

  /* ---- CAN (stages 11 + 12): one differential pair, everyone hears everything ---- */
  var PR_CAN_FIELD = {
    sof: ['SOF', 'start'], id: ['ID', 'data'], rtr: ['RTR', 'data'], ide: ['IDE', 'data'],
    r0: ['r0', 'data'], dlc: ['DLC', 'data'], data: ['DATA', 'data'], crc: ['CRC', 'parity'],
    crcdel: ['del', 'stop'], ack: ['ACK', 'ack'], ackdel: ['del', 'stop'],
    eof: ['EOF', 'stop'], ifs: ['IFS', 'stop'], stuff: ['S', 'lost']
  };
  function prCanLive() { return prViewOf('can'); }
  function prCanBits(tx) { return tx.stuffed || tx.bits; }
  function prCanBands(bits) {
    var bands = [], i = 0, j;
    while (i < bits.length) {
      j = i;
      while (j < bits.length && bits[j].k === bits[i].k) { j++; }
      bands.push({ k: bits[i].k, from: i, to: j - 1, n: j - i });
      i = j;
    }
    return bands;
  }
  /* One lane, a band per field instead of a box per bit: at 60-plus bits a per-bit
     label is unreadable, but the anatomy of the frame is exactly what stage 12 is
     about. Same #pr-play id as the UART trace, so one renderer drives both. */
  function prCanWave(bits, caption) {
    var left = 34, right = 8, W = 300, H = 150, yH = 34, yL = 62, bTop = 82, bH = 20;
    var n = bits.length, cw = (W - left - right) / n, i;
    _prLA = { n: n, left: left, cw: cw };
    var pts = '', prevY = yH;
    for (i = 0; i < n; i++) {
      var y = bits[i].v ? yH : yL, x0 = left + i * cw, x1 = x0 + cw;
      pts += x0.toFixed(1) + ',' + prevY + ' ' + x0.toFixed(1) + ',' + y + ' ' + x1.toFixed(1) + ',' + y + ' ';
      prevY = y;
    }
    var grid = '';
    for (i = 1; i < n; i++) { var gx = (left + i * cw).toFixed(1); grid += '<line class="grid" x1="' + gx + '" y1="' + (yH - 6) + '" x2="' + gx + '" y2="' + (yL + 6) + '"/>'; }
    var bands = prCanBands(bits), boxes = '';
    for (i = 0; i < bands.length; i++) {
      var bd = bands[i], meta = PR_CAN_FIELD[bd.k] || [bd.k, 'data'];
      var bx = left + bd.from * cw, bw = bd.n * cw;
      var lab = bd.k === 'stuff' ? 'S' : (bd.n > 1 ? meta[0] + ' ' + bd.n : meta[0]);
      boxes += '<rect class="segbox ' + meta[1] + (bd.k === 'stuff' ? ' stuff' : '') + '" x="' + (bx + 0.5).toFixed(1) + '" y="' + bTop + '" width="' + Math.max(1, bw - 1).toFixed(1) + '" height="' + bH + '"/>' +
        (bw >= 17 ? '<text class="seglab" x="' + (bx + bw / 2).toFixed(1) + '" y="' + (bTop + bH / 2 + 2.6).toFixed(1) + '">' + esc(lab) + '</text>' : '');
    }
    var play = '<line id="pr-play" class="play" opacity="0" x1="' + left + '" x2="' + left + '" y1="' + (yH - 8) + '" y2="' + (bTop + bH) + '"/>';
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '">' +
      '<text class="clab" x="6" y="' + ((yH + yL) / 2 + 3) + '">CAN</text>' +
      '<line class="grid" x1="' + left + '" y1="' + yH + '" x2="' + (W - right) + '" y2="' + yH + '"/>' +
      '<line class="grid" x1="' + left + '" y1="' + yL + '" x2="' + (W - right) + '" y2="' + yL + '"/>' +
      '<polyline class="trace" points="' + pts.trim() + '"/>' +
      grid + boxes + play +
      '<text class="idl" x="' + left + '" y="' + (bTop + bH + 16) + '">' + esc(caption || 'dominant 0 = somebody is driving \u00b7 recessive 1 = nobody is \u00b7 fields left to right in time') + '</text>' +
      '</svg>';
    return '<div class="pr-la">' + svg + '</div>';
  }

  /* ---- stage 11: two nodes, one wire, nobody interrupted ---- */
  function prCanArbView() {
    var a = prCanLive(), u = protos.can;
    if (a && a.tx.kind === 'arb') { return { bits: a.tx.bits, arb: a.tx.arb, live: a }; }
    if (u.result && u.result.kind === 'arb') { return { bits: u.result.bits, arb: u.result.arb, live: null }; }
    var m = prCanArb(u.idA, u.idB);
    return { bits: prCanDisplayBits(m), arb: m, live: null };
  }
  function prCanDisplayBits(r) {
    var bits = [], i, b;
    for (i = 0; i < r.bits.length; i++) {
      b = r.bits[i];
      bits.push({ v: b.bus, k: i === 0 ? 'start' : b.loser ? 'lost' : 'data', l: b.l });
    }
    return bits;
  }
  function prCanArbTx(idA, idB) {
    var r = prCanArb(idA, idB);
    return { kind: 'arb', bits: prCanDisplayBits(r), arb: r, idA: idA, idB: idB, lostAt: r.lostAt, loser: r.loser, winner: r.winner };
  }
  function prCanCtlCard() {
    var u = protos.can;
    return '<section class="pf-card"><h3>Two nodes, one message each<span class="pf-sub">they start on the same bit</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">Node A ID</span><input id="pr-can-ida" size="4" maxlength="3" value="' + prHex3(u.idA) + '"/>' +
        '<span class="lbl">Node B ID</span><input id="pr-can-idb" size="4" maxlength="3" value="' + prHex3(u.idB) + '"/></div>' +
      '<div class="pr-ctlrow"><button type="button" class="btn" id="pr-can-arb"' + (u.tx ? ' disabled' : '') + '>\u25b6 Both transmit at once</button></div>' +
      '<div class="pr-ctlrow"><button type="button" class="btn mini" data-canpair="123,2ab">0x123 vs 0x2AB</button>' +
        '<button type="button" class="btn mini" data-canpair="100,200">0x100 vs 0x200</button>' +
        '<button type="button" class="btn mini" data-canpair="200,100">swap them</button>' +
        '<button type="button" class="btn mini" data-canpair="123,123">identical IDs</button></div>' +
      '<p class="pf-hint">A CAN ID is not an address, it is a <b>priority</b>. Every node that has something to say waits for the idle period, then starts on the same bit as everyone else who did. Any node driving a <b>0</b> (dominant) wins that bit, because the pair only reads recessive while <em>nobody</em> drives it. The first node that wrote 1 and heard 0 has lost the race: it drops out and starts listening, and the winner\u2019s frame arrives intact.</p></section>';
  }
  function prCanBusCard() {
    var u = protos.can, v = u.drive ? 1 : 0, cls = v ? 'rec' : 'dom';
    var lvl = v ? 'RECESSIVE' : 'DOMINANT';
    var svg = '<svg viewBox="0 0 300 150">' +
      '<line class="rail" x1="24" y1="34" x2="276" y2="34"/><text class="lab" x="18" y="30" text-anchor="middle">CANH</text>' +
      '<line class="rail" x1="24" y1="82" x2="276" y2="82"/><text class="lab" x="18" y="78" text-anchor="middle">CANL</text>' +
      '<rect class="res" x="30" y="34" width="14" height="48"/><text class="lab" x="37" y="104" text-anchor="middle">120\u03a9</text>' +
      '<rect class="res" x="256" y="34" width="14" height="48"/><text class="lab" x="263" y="104" text-anchor="middle">120\u03a9</text>' +
      '<line class="rail" x1="150" y1="34" x2="150" y2="18"/><line class="rail" x1="150" y1="82" x2="150" y2="98"/>' +
      '<circle class="node ' + cls + '" cx="150" cy="58" r="12"/>' +
      '<line class="rail" x1="80" y1="34" x2="80" y2="22"/><line class="rail" x1="80" y1="82" x2="80" y2="94"/><circle class="node ' + cls + '" cx="80" cy="58" r="8"/>' +
      '<line class="rail" x1="220" y1="34" x2="220" y2="22"/><line class="rail" x1="220" y1="82" x2="220" y2="94"/><circle class="node rec" cx="220" cy="58" r="8"/>' +
      '<text class="lab" x="150" y="128" text-anchor="middle">bus = ' + lvl + ' (' + v + ')</text></svg>';
    return '<section class="pf-card"><h3>Two wires, not one<span class="pf-sub">the pair, and what \u201cdominant\u201d means</span></h3><div class="pr-wire">' + svg + '</div>' +
      '<div class="pr-ctlrow">' + prSeg('candrive', [{ v: '1', t: 'All release \u2192 reads 1' }, { v: '0', t: 'Any node drives \u2192 reads 0' }], String(v)) + '</div>' +
      '<p class="pf-hint">CAN is a twisted pair: CANH and CANL are driven <em>opposite</em> each other and a receiver looks only at the <b>difference</b>, which is why a car\u2019s bus shrugs off an alternator. No node can drive a recessive 1 \u2014 it can only <b>stop driving</b>, and the 120\u03a9 terminators at each end pull the pair back level. Stage 1\u2019s open-drain pull-up, scaled up to a vehicle and made differential.</p></section>';
  }
  function prCanArbWaveCard() {
    var v = prCanArbView();
    /* 13 bits is small enough to label one box per bit, and the bit names
       (SOF, ID10..ID0, RTR) are the whole lesson here */
    return '<section class="pf-card" id="pr-can-wavecard"><h3>Logic analyser<span class="pf-sub">the pair as one decoded bit stream</span></h3>' +
      prLA({ bits: v.bits, playIdx: v.live ? Math.min(Math.floor(v.live.pos), v.bits.length) : null, label: 'CAN',
        caption: 'SOF then ID10..ID0 then RTR \u00b7 0 wins the bit' }) +
      '<div class="pr-read" id="pr-can-read">' + prCanArbBanner() + '</div></section>';
  }
  function prCanArbBanner() {
    var v = prCanArbView(), u = protos.can, a = v.live, r = v.arb;
    if (a) {
      var k = Math.max(0, Math.min(Math.floor(a.pos), v.bits.length - 1));
      return prReviewTag(a) + 'bit <b>' + Math.min(Math.floor(a.pos), v.bits.length) + '/' + v.bits.length + '</b> \u00b7 the pair reads <b>' + (v.bits[k] && v.bits[k].v ? 'recessive (1)' : 'dominant (0)') + '</b>' + (a.review ? prCanScrubHtml(a.tx, k) : '');
    }
    if (!r || r.lostAt == null) { return 'idle \u2014 the pair rests recessive (1): nobody is driving. Press both transmit.'; }
    if (r.lostAt < 0) { return 'Both nodes sent the <b>identical</b> ID \u2014 nothing diverges, so <em>both</em> believe they won. That is only safe while their data is identical too; two nodes sharing an ID is a design bug, not a trick.'; }
    return 'Node <b>' + r.loser + '</b> (0x' + prHex3(r.loser === 'A' ? u.idA : u.idB) + ') drove a 1 and read a 0 at <b>' + esc(r.bits[r.lostAt].l) + '</b> \u2014 it stops transmitting right there and becomes a receiver. Node <b>' + r.winner + '</b> (0x' + prHex3(r.winner === 'A' ? u.idA : u.idB) + ') never noticed: every bit it wrote came back as written. <span class="good">The numerically smaller ID won.</span>';
  }
  function prCanArbTableCard() {
    var v = prCanArbView(), live = v.live, rows = '', i;
    var upto = live ? Math.min(Math.floor(live.pos), v.bits.length) : v.bits.length;
    var src = v.arb.bits;
    for (i = 0; i < src.length; i++) {
      var b = src[i], see = i < upto || (i === upto && (!live || live.review));
      rows += '<tr' + (live && i === Math.floor(live.pos) ? ' class="cur"' : '') + '><td class="k">' + esc(b.l) + '</td>' +
        '<td>' + (see ? b.a : '?') + '</td><td>' + (see ? b.b : '?') + '</td>' +
        '<td class="' + (b.loser ? 'bad' : 'good') + '">' + (see ? b.bus : '?') + (see && b.loser ? ' \u2190 ' + b.loser + ' loses' : '') + '</td></tr>';
    }
    return '<section class="pf-card" id="pr-can-table"><h3>Bit by bit<span class="pf-sub">two intents, one wire</span></h3>' +
      '<table class="pr-bit tbl"><tr><th>bit</th><th>A wants</th><th>B wants</th><th>bus reads</th></tr>' + rows + '</table>' +
      '<p class="pf-hint">Read the two intent columns against the bus: it is 0 whenever <em>either</em> column is 0. A node can only ever lose on a bit where it sent <b>1</b> \u2014 which is exactly why the numerically <b>smaller</b> ID (more dominant leading bits) always wins. Swap 0x200 and 0x100 and the winner changes; give them the same ID and neither loses.</p></section>';
  }
  function prCanStage11() {
    return prCols(
      prTeach('Arbitration that destroys nothing',
        '<p>I\u00b2C (stage 5) settled a collision by letting the loser drop out \u2014 and CAN does the same thing, on a differential pair, at a megabit, in the same bit. The difference is <em>why</em> a node loses: not at the first differing bit, but at the first bit where it is the one asking to be <b>recessive</b>. Dominant 0 is every node\u2019s right; recessive 1 is a favour nobody can enforce.</p>' +
        '<p>So the identifier doubles as the priority. The frame with the lowest ID \u2014 the most leading dominant bits \u2014 wins the race that only lasts as long as the IDs differ, and the loser\u2019s frame is discarded <b>before it is even framed</b>. No retransmission, no collision backoff, no damaged data. Every receiver on the bus hears exactly one message and never knows there was a contest.</p>') +
      prCanCtlCard() + prCanBusCard(),
      prCanArbWaveCard() + prCanArbTableCard(),
      prGoalCard(11) + prCodeCard('What the losing mailbox does about it', PR_CAN_ARB_CODE) + prLogCard());
  }
  var PR_CAN_ARB_CODE = '/* CAN: you never ask permission - you start, and lose politely */\n\nCAN1->MCR &= ~CAN_MCR_INRQ;          /* leave init: the bus is open      */\nCAN1->MCR |=  CAN_MCR_NART;          /* (test only) no auto-retry        */\n\n/* one mailbox = one message: ID + DLC + up to 8 data bytes */\nCAN1->sTxMailBox[0].TIR  = (0x123u << 21);      /* standard ID        */\nCAN1->sTxMailBox[0].TDTR = 2;                   /* DLC: two bytes     */\nCAN1->sTxMailBox[0].TDLR = 0xDEADu;             /* the payload        */\nCAN1->sTxMailBox[0].TIR |= CAN_TI0R_TXRQ;       /* request tx         */\n\n/* None of that code mentions arbitration. If another node started at the\n   same instant, the controller resolves it bit by bit; on a loss the\n   mailbox simply stays pending and is retried when the bus frees up.\n   No error counter moves and the application never learns it happened.\n\n   Lower ID = more leading dominant bits = higher priority. Assign IDs\n   like a schedule, not like addresses. */';

  /* ---- stage 12: the frame ---- */
  function prCanFrameCfg() {
    var u = protos.can, raw = prCanFrame(u.id, u.dlc, [u.d0, u.d1], !!u.receiver);
    var st = u.stuff ? prCanStuff(raw) : { bits: raw, stuff: 0 };
    return { raw: raw, bits: st.bits, stuff: st.stuff, id: u.id, dlc: u.dlc, acked: !!u.receiver };
  }
  function prCanFrameView() {
    var a = prCanLive(), u = protos.can;
    if (a && a.tx.kind === 'frame') { return { bits: prCanBits(a.tx), tx: a.tx, live: a }; }
    if (u.result && u.result.kind === 'frame') { return { bits: prCanBits(u.result), tx: u.result, live: null }; }
    var c = prCanFrameCfg();
    return { bits: c.bits, tx: null, cfg: c, live: null };
  }
  function prCanFrameCtlCard() {
    var u = protos.can;
    return '<section class="pf-card"><h3>Build one message<span class="pf-sub">ID, length, payload \u2014 that is all a frame carries</span></h3>' +
      '<div class="pr-ctlrow"><span class="lbl">ID (hex)</span><input id="pr-can-id" size="4" maxlength="3" value="' + prHex3(u.id) + '"/>' +
        '<span class="lbl">DLC</span>' + prSeg('candlc', [{ v: '0', t: '0' }, { v: '1', t: '1' }, { v: '2', t: '2' }], String(u.dlc)) + '</div>' +
      '<div class="pr-ctlrow"><span class="lbl">data[0]</span><input id="pr-can-d0" size="4" maxlength="2" value="' + u.d0.toString(16).toUpperCase() + '"/>' +
        '<span class="lbl">data[1]</span><input id="pr-can-d1" size="4" maxlength="2" value="' + u.d1.toString(16).toUpperCase() + '"/></div>' +
      '<div class="pr-ctlrow"><button type="button" class="btn" id="pr-can-send"' + (u.tx ? ' disabled' : '') + '>\u25b6 Send frame</button>' +
        '<button type="button" class="btn mini" data-canid="0">ID 0x000 (forces stuffing)</button>' +
        '<button type="button" class="btn mini" data-canid="7ff">ID 0x7FF</button></div>' +
      '<div class="pr-ctlrow"><span class="lbl">Encoder</span>' + prSeg('canstuff', [{ v: '1', t: 'Stuffing on' }, { v: '0', t: 'Stuffing off' }], String(u.stuff ? 1 : 0)) + '</div>' +
      '<div class="pr-ctlrow"><button type="button" class="btn" data-canrx="' + (u.receiver ? 0 : 1) + '" aria-pressed="' + String(!!u.receiver) + '">' + (u.receiver ? 'Receiver present \u2014 ACK comes back' : 'Receiver removed \u2014 nobody will ACK') + '</button></div>' +
      '<p class="pf-hint">Turn <b>stuffing off</b> and the frame still parses on paper, but a long run of identical bits leaves the receiver\u2019s clock with nothing to re-synchronise on: this is why the rule exists, and why it is part of the <em>encoding</em> and not a field. Remove the <b>receiver</b> and watch the ACK slot stay recessive \u2014 the sender is now talking to nobody and will retry forever.</p></section>';
  }
  var PR_CAN_FIELDS = [
    ['SOF', '1', 'start of frame \u2014 one dominant bit; every frame begins by pulling the pair apart'],
    ['ID', '11', 'identifier, MSB first \u2014 and the priority, because low values win arbitration'],
    ['RTR', '1', 'dominant here: this is a data frame, not a request for one'],
    ['IDE', '1', 'dominant = standard 11-bit ID; recessive would mean the 29-bit extended form'],
    ['r0', '1', 'reserved, transmitted dominant and ignored by receivers'],
    ['DLC', '4', 'data length code 0\u20138 \u2014 a <em>length</em>, not a byte count you can read as a number'],
    ['DATA', '0\u201364', 'the payload, 8 bits per byte, most-significant bit first'],
    ['CRC', '15', 'CRC-15 over SOF..DATA with the stuff bits removed'],
    ['CRCdel', '1', 'recessive delimiter \u2014 the edge a receiver resynchronises on'],
    ['ACK', '1', 'the transmitter sends recessive; <em>every</em> receiver that validated the frame pulls it dominant'],
    ['ACKdel', '1', 'recessive delimiter'],
    ['EOF', '7', 'seven recessive bits; a dominant bit here is an error frame, not data'],
    ['IFS', '3', 'intermission \u2014 three recessive bits of enforced silence before anyone may start again']
  ];
  function prCanFieldTableCard() {
    var rows = '';
    PR_CAN_FIELDS.forEach(function (f) {
      rows += '<tr><td class="k">' + esc(f[0]) + '</td><td>' + esc(f[1]) + '</td><td>' + f[2] + '</td></tr>';
    });
    return '<section class="pf-card"><h3>The anatomy of one frame<span class="pf-sub">thirteen fields, and none of them is an address</span></h3>' +
      '<table class="pr-bit tbl"><tr><th>field</th><th>bits</th><th>what it is for</th></tr>' + rows + '</table>' +
      '<p class="pf-hint">Compare it with UART\u2019s three fields or I\u00b2C\u2019s one address byte: CAN pays a lot of overhead per message because it is built for a wire with thirty nodes and no master, where any of them may start talking the instant the bus is idle. The <b>ACK slot</b> is the whole of it: one shared bit, pulled by whoever validates the CRC, so a sender gets confirmation from the network instead of from a named device.</p></section>';
  }
  function prCanFrameWaveCard() {
    var v = prCanFrameView(), tx = v.tx;
    return '<section class="pf-card" id="pr-can-framewave"><h3>Logic analyser<span class="pf-sub">' + esc(prHex3(protos.can.id)) + ' \u00b7 dlc ' + protos.can.dlc + (tx && tx.stuff ? ' \u00b7 ' + tx.stuff + ' stuff bit' + (tx.stuff > 1 ? 's' : '') : '') + '</span></h3>' +
      prCanWave(v.bits, v.bits.length + ' bits \u00b7 0 = dominant \u00b7 one band per field') +
      '<div class="pr-read" id="pr-can-read">' + prCanFrameBanner() + '</div></section>';
  }
  function prCanFrameBanner() {
    var v = prCanFrameView(), a = v.live;
    if (a) {
      var bits = v.bits, k = Math.max(0, Math.min(Math.floor(a.pos), bits.length - 1));
      return prReviewTag(a) + 'bit <b>' + Math.min(Math.floor(a.pos), bits.length) + '/' + bits.length + '</b> \u00b7 the pair reads <b>' + (bits[k] && bits[k].v ? 'recessive (1)' : 'dominant (0)') + '</b>' + (a.review ? prCanScrubHtml(a.tx, k) : '');
    }
    if (v.tx) {
      return 'Frame <b>' + esc(prHex3(v.tx.id)) + '</b> \u00b7 dlc ' + v.tx.dlc + ' \u00b7 ' + v.tx.raw.length + ' meaningful bits' + (v.tx.stuff ? ' + <b>' + v.tx.stuff + '</b> stuffed' : '') +
        ' \u00b7 ACK slot ' + (v.tx.acked ? '<span class="good">dominant \u2014 at least one node heard it</span>' : '<span class="bad">recessive \u2014 nobody heard it</span>');
    }
    return 'idle \u2014 the pair rests recessive. Press send frame.';
  }
  function prCanScrubHtml(tx, k) {
    var i, bit;
    if (tx.kind === 'arb') {
      var b = tx.arb.bits[k];
      if (!b) { return ''; }
      if (b.loser) { return ' \u2694 <b>this is the bit ' + b.loser + ' loses</b> \u2014 it wrote 1 and read 0, so it stops driving here and listens for the rest of the frame.'; }
      return ' A wants <b>' + b.a + '</b>, B wants <b>' + b.b + '</b>, and the wire resolves to <b>' + b.bus + '</b>.';
    }
    bit = prCanBits(tx)[k];
    if (!bit) { return ''; }
    if (bit.stuff) { return ' a <b>stuff bit</b>: inserted so the pair keeps changing, deleted by the receiver without being told. It carries no information at all.'; }
    for (i = 0; i < PR_CAN_FIELDS.length; i++) { if (PR_CAN_FIELDS[i][0] === (PR_CAN_FIELD[bit.k] || [bit.k])[0]) { break; } }
    return ' field <b>' + esc((PR_CAN_FIELD[bit.k] || [bit.k])[0]) + '</b> \u00b7 symbol ' + esc(bit.l) + (bit.v ? ' \u2014 recessive, nobody is driving' : ' \u2014 dominant, somebody is pulling the pair apart') + '.';
  }
  function prCanStuffCard() {
    var v = prCanFrameView(), bits = v.bits, i, cells = '', maxRun = 0, run = 0, prev = null;
    for (i = 0; i < bits.length; i++) {
      cells += '<b class="' + (bits[i].stuff ? 'st' : (bits[i].v ? 'one' : '')) + '">' + bits[i].v + '</b>';
      if (bits[i].stuff) { continue; }
      if (prev !== null && bits[i].v === prev) { run++; } else { run = 1; prev = bits[i].v; }
      if (run > maxRun) { maxRun = run; }
    }
    var n = prCountIf(bits, function (b) { return b.stuff; });
    var sub = n ? n + ' inserted in this frame' : (protos.can.stuff ? 'no run of five to break up' : 'stuffing switched off \u2014 the receiver has no edge to resynchronise on');
    return '<section class="pf-card" id="pr-can-stuff"><h3>Bit stuffing<span class="pf-sub">' + esc(sub) + '</span></h3>' +
      '<div class="pr-ring pr-stuff"><span class="ff">' + cells + '</span></div>' +
      '<p class="pf-hint">The rule is blunt: <b>after five identical bits the encoder inserts the opposite one</b>, and the receiver deletes it again without being told which bits those are \u2014 the rule <em>is</em> the encoding. Longest run in this frame before stuffing: <b>' + maxRun + '</b> bits (the limit is 5). Blue boxes are the inserted bits; the sender\u2019s CRC was computed before they existed.</p>' +
      '<p class="pf-hint">Stuffing is why the wire never sits still long enough for a receiver\u2019s clock to drift. It is also why a CAN frame is never a whole number of bytes: 11-bit ID, 4-bit DLC, 15-bit CRC \u2014 nothing lines up with 8.</p></section>';
  }
  function prCountIf(arr, fn) { var n = 0, i; for (i = 0; i < arr.length; i++) { if (fn(arr[i])) { n++; } } return n; }
  /* swap just the frame trace and the stuffing strip, so the caret in the hex box
     survives a keystroke (same trick as the SPI byte input) */
  function prCanFrameRefresh() {
    var w = document.getElementById('pr-can-framewave'); if (w) { w.outerHTML = prCanFrameWaveCard(); }
    var st = document.getElementById('pr-can-stuff'); if (st) { st.outerHTML = prCanStuffCard(); }
  }
  function prCanStage12() {
    return prCols(
      prTeach('Everything else is bookkeeping',
        '<p>Stage 11 gave CAN its argument \u2014 any node may start talking, and priority settles the collision. The frame is what gets said. A start bit (SOF), an 11-bit ID, the RTR/IDE/r0 control bits, a 4-bit length, up to eight data bytes, a CRC-15, and then two things you will not find on UART or SPI: a <b>shared ACK slot</b> and seven recessive <b>EOF</b> bits.</p>' +
        '<p>The one rule that surprises everybody is <b>bit stuffing</b>. A receiver here has no separate clock wire (this is asynchronous, like UART), so a long run of identical bits would starve its resynchronisation. The encoder simply refuses to send six in a row: after five it inserts the opposite bit, and the receiver deletes it by the same rule. Send ID 0x000 \u2014 eleven dominant bits in a row \u2014 and watch the wire acquire extra bits that carry no information at all.</p>') +
      prCanFrameCtlCard(),
      prCanFrameWaveCard() + prCanStuffCard(),
      prGoalCard(12) + prCanFieldTableCard() + prCodeCard('The two halves a driver never writes', PR_CAN_FRAME_CODE) + prLogCard());
  }
  var PR_CAN_FRAME_CODE = '/* neither of these two is a field you fill in: the hardware does both */\n\n/* 1) the CRC: computed over SOF..DATA with the stuff bits removed */\n/*    a receiver can only check it because it deletes them first */\n\n/* 2) bit stuffing: after five equal bits the encoder inserts the opposite\n      one so the receiver always has an edge to resynchronise on. Six equal\n      bits on the wire is therefore a *violation*, not data. */\n\n/* the ACK slot is the only feedback CAN has, and it is shared: the\n   transmitter sends it recessive, and every receiver that validated the\n   frame pulls it dominant. One bit answers every listener at once, which\n   is why a missing ACK means "nobody", never "that device". */\nif (CAN1->TSR & CAN_TSR_TERR0) {\n  /* no ACK: nobody on the bus heard it. The controller has already\n     retried; log it and move on rather than blinking an LED. */\n}\n\n/* Controller\u2019s view: you hand over ID + DLC + data and it produces\n   stuffing, CRC, ACK sampling and retries. Your only real decision is\n   the ID \u2014 and that decision is a priority. */';

  /* ---- stage 7: the protocol map (the universal layer) ---- */
  var PR_MAP_COLS = ['uart', 'i2c', 'spi', 'can'];
  var PR_MAP_ROWS = [
    { k: 'Wires for one transfer',
      v: { uart: ['TX + RX (2)', 2], i2c: ['SDA + SCL (2)', 5], spi: ['SCLK + MOSI + MISO + CS (4)', 8], can: ['CANH + CANL (one differential pair, every node taps it)', 11] } },
    { k: 'Who provides the clock',
      v: { uart: ['nobody \u2014 both sides agree on a baud rate', 3], i2c: ['master, and the slave may stretch it', 10], spi: ['master, always, and it never waits', 8], can: ['nobody \u2014 each node recovers it from the bit edges themselves', 12] } },
    { k: 'Idle level of the data line',
      v: { uart: ['high (a released line)', 1], i2c: ['high, held there by a pull-up', 1], spi: ['no idle level at all \u2014 the slave only speaks when CS is low', 9], can: ['recessive (1): the terminators hold the pair level while nobody drives', 11] } },
    { k: 'Where a byte begins',
      v: { uart: ['a falling start bit, re-aligned every byte', 2], i2c: ['START: SDA falls while SCL is high', 6], spi: ['nowhere \u2014 the clock simply runs', 8], can: ['nowhere \u2014 a frame opens with one dominant SOF bit', 12] } },
    { k: 'Bit order',
      v: { uart: ['LSB first', 2], i2c: ['MSB first (A6 \u2192 A0)', 5], spi: ['MSB first by default, LRCP bit flips it', 8], can: ['MSB first \u2014 ID, length and data alike', 12] } },
    { k: 'How the receiver knows it looked at the right moment',
      v: { uart: ['sample mid-bit, timed from the start edge', 3], i2c: ['the sender changes SDA only while SCL is low', 5], spi: ['CPHA says first or second edge; CPOL says which is first', 8], can: ['it re-synchronises on edges, and stuffing guarantees one at least every 5 bits', 12] } },
    { k: 'Addressing \u2014 how it knows who you mean',
      v: { uart: ['it does not: point to point', 2], i2c: ['7-bit address + R/W in the first byte', 6], spi: ['a physical wire per device (chip select)', 9], can: ['it does not: the ID names a <em>topic</em> with a priority, and everyone hears it', 11] } },
    { k: 'Feedback that the byte landed',
      v: { uart: ['none \u2014 fire and forget (parity is only a hint)', 2], i2c: ['the 9th clock: ACK or NACK', 6], spi: ['none \u2014 if MISO is silent you read 0xFF/0x00', 9], can: ['the ACK slot: every receiver that passed the CRC pulls it dominant', 12] } },
    { k: 'Two speakers at once',
      v: { uart: ['yes: TX and RX are different wires', 4], i2c: ['no: half duplex, arbitration decides the winner', 5], spi: ['yes, always: every exchange is two-way', 9], can: ['yes in time, never in value: the wired-AND resolves it by ID', 11] } },
    { k: 'What one bit flip costs you',
      v: { uart: ['a wrong character, caught only by parity', 3], i2c: ['a lost arbitration or a NACK, self-inflicted', 5], spi: ['a byte shifted by one position', 8], can: ['the CRC catches the frame, and everybody who saw it bad retries', 12] } }
  ];
  function prMapTableCard() {
    var rows = '';
    PR_MAP_ROWS.forEach(function (r) {
      rows += '<tr><td class="k">' + esc(r.k) + '</td>' +
        PR_MAP_COLS.map(function (f) {
          var cell = r.v[f];
          return '<td>' + esc(cell[0]) + ' <button type="button" class="rowlink" data-prstage="' + cell[1] + '">stage ' + cell[1] + '</button></td>';
        }).join('') + '</tr>';
    });
    return '<section class="pf-card"><h3>Same questions, four answers<span class="pf-sub">every protocol answers the same list differently</span></h3>' +
      '<table class="pr-bit tbl"><tr><th>question</th><th>UART</th><th>I\u00b2C</th><th>SPI</th><th>CAN</th></tr>' + rows + '</table>' +
      '<p class="pf-hint">Read it as a decision tree, not a table. No spare pins and eight cheap devices \u2192 I\u00b2C. Tens of MHz and a display \u2192 SPI. One wire each way and a human watching \u2192 UART. Thirty nodes on one pair of wires, some of them safety-critical \u2192 CAN, and the ID becomes a priority schedule. Every entry above is modelled in this lab \u2014 the links jump to the stage where you can <b>make it fail</b>.</p></section>';
  }
  function prMapVocabCard() {
    var items = [
      ['idle level', 'what the line does when nobody drives it. On an open-drain wire a 1 means <em>let go</em> (stage 1); a floating input means <em>nobody decided anything</em> and the next reader is random.'],
      ['framing', 'how the receiver knows a byte is starting: a start bit (UART), a START condition drawn on the clock wire (I\u00b2C), or simply asserting chip select (SPI).'],
      ['sample instant', 'the one moment a receiver is allowed to look: mid-bit by agreement, on a clock edge chosen by CPHA, or anywhere the sender guarantees SDA is stable.'],
      ['bit order', 'LSB first is a UART habit, MSB first is a bus habit. Get it backwards and 0x50 comes off the wire as 0x0A.'],
      ['acknowledgement', 'the receiver\u2019s only voice: parity hints, ACK clocks confirm, SPI stays silent and lies.'],
      ['arbitration', 'what happens when two speakers disagree: I\u00b2C resolves it electrically with a wired-AND and the loser quietly drops out; CAN does the same but puts the priority in the ID, so the loser was decided at design time; UART and SPI just drive two outputs into each other and hope.'],
      ['clock domain', 'whether the sender supplies the clock (I\u00b2C/SPI) or both sides run their own (UART). Everything about drift, stretching and baud error follows from that one choice.']
    ];
    var lis = '';
    items.forEach(function (it) { lis += '<tr><td class="k">' + esc(it[0]) + '</td><td>' + it[1] + '</td></tr>'; });
    return '<section class="pf-card"><h3>Seven words that cover every serial protocol<span class="pf-sub">the shared vocabulary</span></h3>' +
      '<table class="pr-bit tbl"><tr><th>term</th><th>what it really means</th></tr>' + lis + '</table>' +
      '<p class="pf-hint">Datasheets vary, physics does not. When a new protocol shows up (USB, Ethernet, Modbus, one of five display interfaces), find these seven answers first and the rest is bookkeeping \u2014 CAN is here to prove the method works on something none of the other three resembles.</p></section>';
  }
  function prMapStage7() {
    return prCols(
      prTeach('Protocols are agreements about voltage over time',
        '<p>Stage 1 was the last lesson that was about electricity. From here everything is about <em>convention</em>: two chips with no shared memory, no shared clock and often no spare pins, agreeing on what a wire means at each instant. UART, I\u00b2C, SPI and CAN are not four technologies \u2014 they are four answers to the same seven questions.</p>' +
        '<p>Once you can name the questions, a new protocol stops being scary: find the idle level, the framing, the sample instant, the bit order, the acknowledgement, the arbitration, the clock domain. This table is the map of the module; every cell links to a stage you can break.</p>') +
      prMapVocabCard(),
      prMapTableCard(),
      prGoalCard(7) + prCodeCard('Choosing, in C', PR_MAP_CODE) + prLogCard());
  }
  var PR_MAP_CODE = '/* the three lines you will actually configure in a real project */\n\n/* UART  \u2014 agreed clock, framed bytes, no addressing, no ACK */\nUSART1->BRR = 8000000u / 115200u;   /* both sides must already agree  */\n\n/* I2C   \u2014 shared clock, shared data, addressed, acknowledged */\nI2C1->DR = (0x50u << 1) | 0u;       /* the first byte names a device  */\n\n/* SPI   \u2014 master clock, two data wires, chip-select addressing */\nSPI1->CR1 = SPI_CR1_MSTR | SPI_CR1_SPE;   /* mode lives in CPOL/CPHA  */\nGPIOA->BSRR = CS_PIN;               /* addressing is a wire, not a byte */\n\n/* CAN   \u2014 one differential pair, no master, and the ID is the priority */\nCAN1->sTxMailBox[0].TIR = (0x123u << 21);   /* low ID wins a tie       */\n\n/* None of these is "faster" in the abstract. Pick by pins available,\n   devices on the bus, distance, whether one node must be able to shout,\n   and how much you trust the wiring. */';

  /* ---- goals ---- */

  var PR_GOALS = {
    1: { text: 'Set the driver to <b>open-drain</b>, release the pin (ODR = 1), and add a <b>pull-up</b>. The line must read <b>HIGH</b> — proving a "1" on an open-drain pin really means "let go and let the resistor decide".',
      ok: function () { var s = protos.sig; return prResolve(s.drive, s.out, s.pull) === 'high' && s.drive === 'od'; },
      hint: function () { var s = protos.sig; if (s.drive !== 'od') { return 'Switch the driver to open-drain first — push-pull is cheating.'; } if (s.out) { return 'Released — now add a pull-up so the high is defined.'; } return 'ODR is 0, so the NMOS is sinking it low. Release the pin (ODR = 1).'; } },
    2: { text: '<b>Send one byte</b> and let its whole frame travel the wire. The counter of completed sends must reach at least 1.',
      ok: function () { return protos.uart.sent >= 1; },
      hint: function () { return 'Pick any character (or keep ' + esc(prHex(protos.uart.char)) + ') and press Send byte.'; } },
    3: { text: 'Break reception on purpose: drag the <b>baud error</b> until at least one sample lands in the wrong bit window and the decoded byte differs from the sent byte.',
      ok: function () { return protos.uart.errSeen === true; },
      hint: function () { return 'The error accumulates, so the bits nearest the stop break first. Push the slider further — a big mismatch is fine here.'; } },
    4: { text: 'Type a short message and receive it: get <b>3 or more characters</b> through the terminal.',
      ok: function () { return protos.rxLog.length >= 3; },
      hint: function () { return 'Type into the box and press Enter — each character is a full frame.'; } },
    5: { text: 'Make an arbitration decision visible: send two different master addresses and let the log record a <b>loser</b> dropping off mid-byte. (Identical addresses do not count — that is a bug you get for free, not a feature.)',
      ok: function () { return protos.i2c.collisions >= 1; },
      hint: function () { return 'The two addresses must differ at some bit — try the 0x50 vs 0x40 preset and press send.'; } },
    6: { text: 'Address someone who is home: send the address of the <b>present EEPROM (0x50)</b> and get its <b>ACK</b> — then optionally see a NACK from an empty slot and a full repeated-start read.',
      ok: function () { return protos.i2c.acked >= 1; },
      hint: function () { return 'Type 50 in the address box (or click the EEPROM preset) and press Send START + address.'; } },
    7: { text: 'Use the map as a menu: visit at least one stage from <b>each</b> family \u2014 UART, I\u00b2C, SPI and CAN \u2014 by following any of the links in the table.',
      ok: function () {
        var s = protos.seen;
        function any(ids) { for (var i = 0; i < ids.length; i++) { if (s[ids[i]]) { return true; } } return false; }
        return any([2, 3, 4]) && any([5, 6, 10]) && any([8, 9]) && any([11, 12]);
      },
      hint: function () { return 'Every cell in the table is a button \u2014 click one link per protocol column (there are four now) and this clears.'; } },
    10: { text: 'Make a slave push back: send a byte with the clock <b>held low</b> long enough that the master has to wait, and let the transfer still finish cleanly.',
      ok: function () { return protos.i2c.stretches >= 1; },
      hint: function () { var u = protos.i2c; if (!u.stretch) { return 'Set \u201cSCL held low for\u201d to at least 1 clock \u2014 none means the slave answers instantly.'; } return 'Press \u201cWrite a byte, wait for the slave\u201d and let the trace run to the STOP.'; } },
    11: { text: 'Watch priority decide a race: make two nodes transmit different IDs at once and let the log record the loser dropping out. The winner must be the <b>numerically smaller</b> ID — identical IDs do not count.',
      ok: function () {
        var u = protos.can;
        return u.arbs >= 1 && u.winnerId != null && u.loserId != null && u.winnerId < u.loserId;
      },
      hint: function () { return 'The preset 0x100 vs 0x200 shows it fastest: 0x100 has a dominant bit where 0x200 is recessive, so 0x100 wins and 0x200 slips out.'; } },
    12: { text: 'Force the encoder to work: send a frame whose ID has a long run of identical bits so <b>stuff bits</b> appear on the wire, and have the receiver pull the <b>ACK slot</b> dominant.',
      ok: function () { return protos.can.stuffSeen && protos.can.acks >= 1; },
      hint: function () { return 'Click the <b>ID 0x000</b> preset \u2014 eleven dominant bits in a row force stuffing \u2014 then press Send frame.'; } },
    8: { text: 'Prove the mode rule from both sides: clock a byte out with the master and slave in <b>different</b> modes and watch the byte arrive shifted, then set them equal and take a clean read.',
      ok: function () { var u = protos.spi; return u.mismatches >= 1 && u.okReads >= 1; },
      hint: function () { return 'Try the \u201cCPOL only\u201d preset, press Clock it out, then match the two selectors and send again.'; } },
    9: { text: 'Meet the one-behind effect and beat it: exchange once so the master latches the <b>stale</b> value, then exchange a <b>dummy 0x00</b> and receive the measurement that was waiting.',
      ok: function () { return protos.spi.freshRead === true; },
      hint: function () { return 'Press Exchange (you get 0xCA, the old queued value), then press Dummy read \u2014 the fresh value can only leave on a clock you provide.'; } }
  };
  function prGoalCard(n) {
    var g = PR_GOALS[n]; if (!g) { return ''; }
    var done = !!protos.goals[n];
    return '<section class="pf-card pf-goal' + (done ? ' hit' : '') + '"><h3>Your move<span class="pf-sub">stage ' + n + ' goal</span></h3><p class="pf-teach">' + g.text + '</p>' +
      '<div class="pf-goalarow"><button type="button" class="btn" data-prgoal="' + n + '">✓ Verify</button>' + (done ? '<b class="pf-donet">achieved ✓</b>' : '<b class="pf-openet">not yet</b>') + '</div>' +
      '<p class="pf-hint" id="pr-goal-hint-' + n + '"></p></section>';
  }

  /* ---- stage bodies + shell ---- */
  function prStageBody(n) {
    if (n === 5) { return prI2cStage5(); }
    if (n === 6) { return prI2cStage6(); }
    if (n === 7) { return prMapStage7(); }
    if (n === 10) { return prI2cStage10(); }
    if (n === 11) { return prCanStage11(); }
    if (n === 12) { return prCanStage12(); }
    if (n === 8) { return prSpiStage8(); }
    if (n === 9) { return prSpiStage9(); }
    if (n === 1) { return prCols(
      prTeach('A voltage is not a logic level',
        '<p>A pin is a small circuit fighting a wire. Two transistors can <b>actively drive</b> it — one to VDD (push), one to GND (pull) — that is <b>push-pull</b>: defined both ways. Or the pin has only the lower transistor, <b>open-drain</b>: it can sink the line low or <em>let go</em>, never force it high. A <b>pull-up</b> resistor then holds the released line high; a <b>pull-down</b> holds it low.</p>' +
        '<p>Release an open-drain pin with no pull and you get the third level every embedded engineer fears: <b>floating</b> — high impedance, drifting, reading whatever noise is nearby. The rig resolves the level from exactly these choices.</p>') + prSigCtlCard(),
      prWireCard() + prCodeCard('The GPIOA setup this equals', prSigCode()),
      prGoalCard(1) + prAndCard()); }
    if (n === 2) { return prCols(
      prTeach('Framing: one byte becomes a timed series of levels',
        '<p>UART has <b>no clock wire</b>. The only shared promise is a <b>baud rate</b> — how long a bit lasts. To send a byte: idle high, drop a <b>start</b> bit low (the falling edge starts the receiver\'s timer), emit the data bits <b>least-significant first</b>, an optional <b>parity</b> bit for a cheap check, then a <b>stop</b> bit high to return to idle.</p>' +
        '<p>Press <b>Send byte</b> and watch the playhead walk the wire one bit at a time. Change parity and stop and the frame grows or shrinks — the same byte, more or fewer levels.</p>') + prFrameCtlCard(),
      prFrameShowCard() + prCodeCard('Sending ' + esc(prHex(protos.uart.char)) + ' equals this in C', prUartCode()),
      prGoalCard(2) + prLogCard()); }
    if (n === 3) { return prCols(
      prTeach('The receiver trusts its own clock',
        '<p>After the start edge the receiver waits <b>half a bit</b>, then samples once per bit at each centre. If its baud is even slightly wrong, every sample is placed a touch off and the error <b>piles up</b> across the frame — the far bits sit nearest a boundary. Two "close enough" crystals still garble a long frame; that is why framing and parity errors exist.</p>') + prSampleCtlCard(),
      prSampleShowCard(),
      prGoalCard(3) + prCodeCard('Even a perfect divisor has a budget', prUartCode())); }
    return prCols(
      prTeach('A terminal is just a loop',
        '<p>Every key is a byte; every byte is a frame; the receiver reassembles by timing. A serial terminal does nothing more than read what the decoder produced and print it. Change the <b>baud error</b> (carried from stage 3) and watch good characters turn to garbage — the exact corruption a logic analyser shows you when a clock tree is misconfigured.</p>') + prTermCtlCard() + prTermCard(),
      prGoalCard(4) + prCodeCard('USART1 init @ ' + protos.uart.baud + ' baud', prUartCode()));
  }
  function prFamNav() {
    var cur = prFamOfStage(protos.stage);
    return '<div class="pr-fams" role="tablist" aria-label="Protocol families">' +
      PR_FAMILIES.map(function (f) {
        var stages = prStagesInFam(f.id), dots = '';
        stages.forEach(function (s) { dots += '<i' + (protos.goals[s.id] ? ' class="gd"' : '') + '></i>'; });
        return '<button type="button" role="tab" id="pr-fam-' + f.id + '" data-prfam="' + f.id + '" aria-controls="prolab-body" tabindex="' + (f.id === cur ? '0' : '-1') + '" aria-selected="' + String(f.id === cur) + '" class="pr-fam' + (f.id === cur ? ' cur' : '') + '" title="' + esc(f.blurb) + '">' +
          esc(f.name) + '<span class="fc">' + dots + '</span></button>';
      }).join('') + '</div>';
  }
  function prStageNav() {
    var fam = prFamOfStage(protos.stage);
    return '<nav class="pf-stagenav" role="tablist" aria-label="Protocol stages">' +
      prStagesInFam(fam).map(function (s) {
        return '<button type="button" role="tab" id="pr-stage-' + s.id + '" data-prstage="' + s.id + '" aria-controls="prolab-body" tabindex="' + (protos.stage === s.id ? '0' : '-1') + '" aria-selected="' + String(protos.stage === s.id) + '" title="' + esc(s.tag) + '">' +
          (protos.goals[s.id] ? '<span class="gd">✓</span>' : '<span class="num">' + s.id + '</span>') + '<span class="stn">' + esc(s.name) + '</span></button>';
      }).join('') + '</nav>';
  }
  /* a shortcut that moved you has to move the caret too, or the tab order loses you */
  function prFocusTab(n) {
    var t = document.getElementById('pr-stage-' + n);
    if (t) { t.focus(); }
  }
  function prBody() {
    var meta = prStageById(protos.stage) || PR_STAGE_META[0];
    var famMeta = prFamById(meta.fam);
    return prFamNav() + prStageNav() +
      '<div class="pf-runbar">' +
        '<button type="button" class="btn" id="pr-pause" aria-pressed="' + String(!protos.running) + '">' + (protos.running ? '⏸ Pause' : '⏵ Resume') + '</button>' +
        '<button type="button" class="btn" id="pr-reset">\u21ba Reset lab</button>' +
        prScrubBar() +
        prKeysBtn() +
        '<span class="pf-stage-tag">' + esc(famMeta.name + ' \u00b7 ' + meta.tag) + '</span>' +
        '<span class="pf-simclock">sim t = <b id="pr-simclock">' + protos.simMs + '</b> ms</span>' +
      '</div>' + (_prKeys ? prKeysCard() : '') + prStageBody(protos.stage);
  }

  function prRenderStatic() {
    var host = document.getElementById('prolab-body'); if (!host) { return; }
    host.innerHTML = prBody();
    prWire(host);
    /* keep send buttons inert while a frame owns the wire */
    if (protos.uart.tx) { var sb = document.getElementById('pr-send') || document.getElementById('pr-send3'); if (sb) { sb.disabled = true; } }
    if (protos.i2c.tx) { var s5 = document.getElementById('pr-i2c-send') || document.getElementById('pr-i2c-send6'); if (s5) { s5.disabled = true; } }
    if (protos.spi.tx) { var s8 = document.getElementById('pr-spi-send') || document.getElementById('pr-spi-xfer'); if (s8) { s8.disabled = true; } }
    if (protos.can.tx) { var sca = document.getElementById('pr-can-arb') || document.getElementById('pr-can-send'); if (sca) { sca.disabled = true; } }
    prRenderLive();
    journalMount("protocols", protos.stage, (prStageById(protos.stage) || PR_STAGE_META[0]).name);
  }
  function prRenderLive() {
    if (!protocolsInited) { return; }
    if (!document.getElementById('prolab-body')) { return; }
    var sc = document.getElementById('pr-simclock'); if (sc) { sc.textContent = protos.simMs; }
    var a = prUartLive() || prCanLive();
    if (_prLA) {
      var pl = document.getElementById('pr-play');
      if (pl) {
        if (a) {
          var idx = Math.max(0, Math.min(Math.floor(a.pos), _prLA.n));
          var px = _prLA.left + idx * _prLA.cw;
          pl.setAttribute('x1', px.toFixed(1)); pl.setAttribute('x2', px.toFixed(1));
          pl.setAttribute('opacity', '1');
        } else { pl.setAttribute('opacity', '0'); }
      }
    }
    var fr = document.getElementById('pr-frame-read'); if (fr) { fr.innerHTML = prFrameReadHtml(); }
    var sr3 = document.getElementById('pr-smp-read'); if (sr3) { sr3.innerHTML = prSampleReadHtml(); }
    /* I2C playhead + live readouts */
    var pv = prView();
    var ia = pv && pv.kind === 'i2c' ? pv : null;
    if (_prPlay && _prPlay.id === 'pr-i2c-play') {
      var ip = document.getElementById('pr-i2c-play');
      if (ip) {
        if (ia) {
          var ix = Math.max(0, Math.min(ia.pos, _prPlay.n));
          var ipx = _prPlay.left + ix * _prPlay.cw;
          ip.setAttribute('x1', ipx.toFixed(1)); ip.setAttribute('x2', ipx.toFixed(1));
          ip.setAttribute('opacity', '1');
        } else { ip.setAttribute('opacity', '0'); }
      }
    }
    if (protos.stage === 5 || protos.stage === 6 || protos.stage === 10) {
      var ir = document.getElementById('pr-i2c-read');
      if (ir) {
        var st6 = protos.i2c;
        if (protos.stage === 10) {
          var rs10 = st6.result && st6.result.kind === 'stretch' ? st6.result : null;
          ir.innerHTML = prI2cStretchBanner(ia ? ia.tx.slots : (rs10 ? rs10.slots : prI2cStretchSlots()), ia ? null : rs10);
        } else {
          var rs = st6.result && ((protos.stage === 5) === (st6.result.kind === 'masters')) ? st6.result : null;
          var sl = ia ? ia.tx.slots : (rs ? rs.slots : null);
          ir.innerHTML = protos.stage === 5 ? prI2cBanner(sl || prI2cMasters(st6.m1val, st6.m2val).slots, ia ? null : rs) : prI2cAddrBanner(sl || prI2cTxSlots(st6.addr, st6.rw, st6.addr === PR_I2C_SLAVE, false), ia ? null : rs);
        }
      }
      var itb = document.getElementById('pr-i2c-table');
      if (itb) { itb.outerHTML = protos.stage === 10 ? prI2cStretchTableCard() : prI2cTableCard(); }
    }
    /* CAN playhead readouts: one trace, two stage flavours */
    if (protos.stage === 11 || protos.stage === 12) {
      var cr = document.getElementById('pr-can-read');
      if (cr) { cr.innerHTML = protos.stage === 11 ? prCanArbBanner() : prCanFrameBanner(); }
      if (protos.stage === 11) { var ctb = document.getElementById('pr-can-table'); if (ctb) { ctb.outerHTML = prCanArbTableCard(); } }
    }
    /* SPI playhead + live readouts */
    if (protos.stage === 8 || protos.stage === 9) {
      var sa = pv && pv.kind === 'spi' ? pv : null;
      if (_prSpiPlay) {
        var sp = document.getElementById(_prSpiPlay.id);
        if (sp) {
          if (sa) {
            var sx = _prSpiPlay.left + Math.max(0, Math.min(sa.pos * (sa.unit || 1), 16)) * _prSpiPlay.cw;
            sp.setAttribute('x1', sx.toFixed(1)); sp.setAttribute('x2', sx.toFixed(1));
            sp.setAttribute('opacity', '1');
          } else { sp.setAttribute('opacity', '0'); }
        }
      }
      var sr = document.getElementById('pr-spi-read'); if (sr) { sr.innerHTML = prSpiReadHtml(); }
      if (protos.stage === 9) {
        var rg = document.getElementById('pr-spi-ring'); if (rg) { rg.outerHTML = prSpiRingCard(); }
      }
    }
  }

  function prFinishFrame(tx) {
    var u = protos.uart, dec = prDecode(tx.bits, u, tx.drift);
    /* freeze the frame that just went out so the scrubber can walk it again */
    _prCap = { kind: 'uart', stage: protos.stage, pos: tx.bits.length, total: tx.bits.length, unit: 1, step: 1, tx: tx, sig: prUartSig(), dec: dec };
    _prPos = null;
    u.sent++; u.last = dec.ch; if (!dec.ok) { u.errSeen = true; }
    var sl = prCharLabel(tx.ch), gl = prCharLabel(dec.ch);
    protos.rxLog.unshift({ t: protos.simMs, sent: sl, got: gl, ok: dec.ok });
    if (protos.rxLog.length > 60) { protos.rxLog.pop(); }
    prLog(dec.ok ? 'ok' : 'err', (dec.ok ? '✓ ' : '✗ ') + sl + ' → ' + gl + (dec.ok ? '' : '  (' + dec.mis + ' bit' + (dec.mis > 1 ? 's' : '') + ' mis-sampled)'));
    if (protos.stage === 3 && !dec.ok && !u.tx && !u.queue.length) { prRenderLive(); }
  }

  function prTick() {
    if (!protocolsInited) { return; }
    var u = protos.uart;
    if (protos.running) {
      protos.simMs += PR_TICK_MS;
      if (prI2cTick()) { prRenderLive(); return; }
      if (prSpiTick()) { prRenderLive(); return; }
      if (prCanTick()) { prRenderLive(); return; }
      if (!u.tx && u.queue && u.queue.length) {
        var c = u.queue.shift();
        u.char = c;
        u.tx = { bits: prUartBits(u, c), ch: c, idx: 0, pos: 0, drift: u.drift };
        prBeginPlay();
        if (protos.stage === 2 || protos.stage === 3) { prRenderStatic(); }
      }
      if (u.tx) {
        u.tx.pos += prSpeedMul();
        u.tx.idx = Math.floor(u.tx.pos);
        if (u.tx.idx >= u.tx.bits.length) {
          var tx = u.tx; u.tx = null;
          prFinishFrame(tx);
          if (protos.stage === 4) { prSave(); prAppendTermRow(); prUpdateLA(); prRenderLive(); }
          else { prSave(); prRenderStatic(); }
          return;
        }
      }
    }
    prRenderLive();
  }

  var prTicker = null;
  function prStartTicker() { if (prTicker) { return; } prTicker = setInterval(prTick, PR_TICK_MS); }

  function prGoStage(n) {
    if (!prStageById(n) || n === protos.stage) { return; }
    prAnimStop();
    protos.seen[n] = true;
    protos.stage = n; prSave(); prRenderStatic();
  }

  function prWire(host) {
    Array.prototype.forEach.call(host.querySelectorAll('[data-prstage]'), function (b) {
      b.addEventListener('click', function () { prGoStage(Number(b.dataset.prstage)); });
    });
    var pz = document.getElementById('pr-pause');
    if (pz) { pz.addEventListener('click', prToggleRun); }
    var rs = document.getElementById('pr-reset');
    if (rs) { rs.addEventListener('click', prResetLab); }

    /* scrubber: walk the transfer that just finished, one clock or bit at a time */
    var smb = document.getElementById('pr-scrub');
    if (smb) { smb.addEventListener('input', function () { prSetPos(Number(smb.value)); }); }
    var sbk = document.getElementById('pr-step-back');
    if (sbk) { sbk.addEventListener('click', function () { prSetPos(prScrubPos() - 1); }); }
    var sfw = document.getElementById('pr-step-fwd');
    if (sfw) { sfw.addEventListener('click', function () { prSetPos(prScrubPos() + 1); }); }
    var slv = document.getElementById('pr-live');
    if (slv) { slv.addEventListener('click', prStopScrub); }
    var spd = document.getElementById('pr-speed');
    if (spd) { spd.addEventListener('click', function () { prSpeedStep(); prSave(); prRenderStatic(); }); }
    var kb = document.getElementById('pr-keys-btn');
    if (kb) { kb.addEventListener('click', function () { prToggleKeys(); }); }

    /* stage 1: line physics */
    Array.prototype.forEach.call(host.querySelectorAll('[data-sigdrive]'), function (b) {
      b.addEventListener('click', function () { protos.sig.drive = b.dataset.sigdrive; prSave(); prRenderStatic(); });
    });
    var so = host.querySelector('[data-sigout]');
    if (so) { so.addEventListener('click', function () { protos.sig.out = Number(so.dataset.sigout) ? 1 : 0; prSave(); prRenderStatic(); }); }
    Array.prototype.forEach.call(host.querySelectorAll('[data-sigpull]'), function (b) {
      b.addEventListener('click', function () { protos.sig.pull = b.dataset.sigpull; prSave(); prRenderStatic(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-wa]'), function (b) {
      b.addEventListener('click', function () { var k = b.dataset.wa === 'a' ? 'aOut' : 'bOut'; protos.wire[k] = protos.wire[k] ? 0 : 1; prSave(); prRenderStatic(); });
    });

    /* stage 2: the frame */
    var ci = document.getElementById('pr-char');
    if (ci) {
      ci.addEventListener('input', function () {
        var c = ci.value.length ? ci.value.charCodeAt(ci.value.length - 1) : 0x48;
        protos.uart.char = c; prUpdateLA();
        var fr = document.getElementById('pr-frame-read'); if (fr) { fr.innerHTML = prFrameReadHtml(); }
        prSave();
      });
    }
    Array.prototype.forEach.call(host.querySelectorAll('[data-parity]'), function (b) {
      b.addEventListener('click', function () { protos.uart.parity = b.dataset.parity; prSave(); prRenderStatic(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-stop]'), function (b) {
      b.addEventListener('click', function () { protos.uart.stop = Number(b.dataset.stop); prSave(); prRenderStatic(); });
    });
    var sd = document.getElementById('pr-send');
    if (sd) { sd.addEventListener('click', function () { protos.uart.queue.push(protos.uart.char); sd.disabled = true; prSave(); }); }
    var s3 = document.getElementById('pr-send3');
    if (s3) { s3.addEventListener('click', function () { protos.uart.queue.push(protos.uart.char); s3.disabled = true; if (!protos.running) { protos.running = true; } prSave(); }); }

    /* stage 3 + 4: baud drift slider */
    var dr = document.getElementById('pr-drift');
    if (dr) {
      dr.addEventListener('input', function () {
        protos.uart.drift = Number(dr.value) || 0;
        var lab = dr.parentNode.querySelector('b'); if (lab) { lab.textContent = protos.uart.drift + '%'; }
        if (protos.stage === 3) { prRenderStatic(); }
        prSave();
      });
    }
    var nb = document.getElementById('pr-newbyte');
    if (nb) { nb.addEventListener('click', function () { protos.uart.char = 0x21 + Math.floor(Math.random() * 58); prSave(); prRenderStatic(); }); }

    /* stage 4: baud presets + terminal */
    Array.prototype.forEach.call(host.querySelectorAll('[data-baud]'), function (b) {
      b.addEventListener('click', function () { protos.uart.baud = Number(b.dataset.baud); prSave(); prRenderStatic(); });
    });
    var ty = document.getElementById('pr-type');
    if (ty) {
      ty.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') { return; }
        var val = ty.value;
        if (!val) { return; }
        var u = protos.uart, n = 0;
        for (var i = 0; i < val.length && n < 40; i++) { u.queue.push(val.charCodeAt(i)); n++; }
        ty.value = '';
        if (!protos.running) { protos.running = true; }
        prSave(); prUpdateLA(); prRenderLive();
      });
    }
    var cl = document.getElementById('pr-clear');
    if (cl) { cl.addEventListener('click', function () { protos.rxLog = []; prSave(); prRenderStatic(); }); }

    /* stage 5: I2C arbitration */
    var m1i = document.getElementById('pr-i2c-m1');
    if (m1i) {
      m1i.addEventListener('input', function () {
        var v = parseInt(m1i.value, 16);
        protos.i2c.m1val = isNaN(v) ? 0 : (v & 0x7f);
        protos.i2c.result = null;
        prSave(); prRenderStatic();
      });
    }
    var m2i = document.getElementById('pr-i2c-m2');
    if (m2i) {
      m2i.addEventListener('input', function () {
        var v = parseInt(m2i.value, 16);
        protos.i2c.m2val = isNaN(v) ? 0 : (v & 0x7f);
        protos.i2c.result = null;
        prSave(); prRenderStatic();
      });
    }
    Array.prototype.forEach.call(host.querySelectorAll('[data-i2cpair]'), function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.i2cpair.split(',');
        protos.i2c.m1val = parseInt(p[0], 16) & 0x7f; protos.i2c.m2val = parseInt(p[1], 16) & 0x7f;
        protos.i2c.result = null; prSave(); prRenderStatic();
      });
    });
    var i2cSend = document.getElementById('pr-i2c-send');
    if (i2cSend) {
      i2cSend.addEventListener('click', function () {
        var u = protos.i2c; if (u.tx) { return; }
        var r = prI2cMasters(u.m1val, u.m2val);
        u.tx = { kind: 'masters', slots: r.slots, lostAt: r.lostAt };
        if (!protos.running) { protos.running = true; }
        prSave(); prRenderStatic();
      });
    }
    Array.prototype.forEach.call(host.querySelectorAll('[data-i2ca]'), function (b) {
      b.addEventListener('click', function () { protos.i2c.aOut = Number(b.dataset.i2ca) ? 1 : 0; prSave(); prRenderStatic(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-i2cb]'), function (b) {
      b.addEventListener('click', function () { protos.i2c.bOut = Number(b.dataset.i2cb) ? 1 : 0; prSave(); prRenderStatic(); });
    });

    /* stage 6: I2C addressing */
    var addrIn = document.getElementById('pr-i2c-addr');
    if (addrIn) {
      addrIn.addEventListener('input', function () {
        var v = parseInt(addrIn.value, 16);
        protos.i2c.addr = isNaN(v) ? 0 : (v & 0x7f);
        protos.i2c.result = null; prSave(); prRenderStatic();
      });
    }
    Array.prototype.forEach.call(host.querySelectorAll('[data-i2crw]'), function (b) {
      b.addEventListener('click', function () { protos.i2c.rw = Number(b.dataset.i2crw) ? 1 : 0; prSave(); prRenderStatic(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-i2caddr]'), function (b) {
      b.addEventListener('click', function () { protos.i2c.addr = parseInt(b.dataset.i2caddr, 16) & 0x7f; protos.i2c.result = null; prSave(); prRenderStatic(); });
    });
    var i2cSend6 = document.getElementById('pr-i2c-send6');
    if (i2cSend6) {
      i2cSend6.addEventListener('click', function () {
        var u = protos.i2c; if (u.tx) { return; }
        u.tx = { kind: 'addr', slots: prI2cTxSlots(u.addr, u.rw, u.addr === PR_I2C_SLAVE, false), addr: u.addr, rw: u.rw, sr: false };
        if (!protos.running) { protos.running = true; }
        prSave(); prRenderStatic();
      });
    }
    var i2cSr = document.getElementById('pr-i2c-sr');
    if (i2cSr) {
      i2cSr.addEventListener('click', function () {
        var u = protos.i2c; if (u.tx) { return; }
        u.tx = { kind: 'addr', slots: prI2cSrSlots(u.addr, u.addr === PR_I2C_SLAVE), addr: u.addr, rw: 1, sr: true };
        if (!protos.running) { protos.running = true; }
        prSave(); prRenderStatic();
      });
    }

    /* family tier */
    Array.prototype.forEach.call(host.querySelectorAll('[data-prfam]'), function (b) {
      b.addEventListener('click', function () {
        var first = prStagesInFam(b.dataset.prfam)[0];
        if (first) { prGoStage(first.id); }
      });
    });

    /* stage 8: SPI modes */
    Array.prototype.forEach.call(host.querySelectorAll('[data-spimm]'), function (b) {
      b.addEventListener('click', function () { protos.spi.mMode = Number(b.dataset.spimm) & 3; protos.spi.result = null; prSave(); prRenderStatic(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-spism]'), function (b) {
      b.addEventListener('click', function () { protos.spi.sMode = Number(b.dataset.spism) & 3; protos.spi.result = null; prSave(); prRenderStatic(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-spipair]'), function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.spipair.split(',');
        protos.spi.mMode = Number(p[0]) & 3; protos.spi.sMode = Number(p[1]) & 3;
        protos.spi.result = null; prSave(); prRenderStatic();
      });
    });
    var spByte = document.getElementById('pr-spi-byte');
    if (spByte) {
      spByte.addEventListener('input', function () {
        var v = parseInt(spByte.value, 16);
        protos.spi.byte = isNaN(v) ? 0 : (v & 0xff);
        protos.spi.result = null; prSave();
        /* update only the trace so the caret keeps its place while typing */
        var wc = document.getElementById('pr-spi-wavecard'); if (wc) { wc.outerHTML = prSpiWaveCard(); }
      });
    }
    var spSend = document.getElementById('pr-spi-send');
    if (spSend) {
      spSend.addEventListener('click', function () {
        var u = protos.spi; if (u.tx) { return; }
        u.tx = { kind: 'modes', m: u.mMode, s: u.sMode, out: u.byte };
        if (!protos.running) { protos.running = true; }
        prSave(); prRenderStatic();
      });
    }

    /* stage 9: the shift ring */
    var xrByte = document.getElementById('pr-spi-xbyte');
    if (xrByte) {
      xrByte.addEventListener('input', function () {
        var v = parseInt(xrByte.value, 16);
        protos.spi.byte = isNaN(v) ? 0 : (v & 0xff);
        protos.spi.result = null; prSave();
        var rg2 = document.getElementById('pr-spi-ring'); if (rg2) { rg2.outerHTML = prSpiRingCard(); }
        var xw = document.getElementById('pr-spi-xwave'); if (xw) { xw.outerHTML = '<section class="pf-card" id="pr-spi-xwave"><h3>Logic analyser<span class="pf-sub">three lanes: clock, out, in</span></h3>' + prSpiRingWave() + '</section>'; }
        var xr2 = document.getElementById('pr-spi-xread'); if (xr2) { xr2.innerHTML = prSpiXferReadHtml(); }
      });
    }
    var xrGo = document.getElementById('pr-spi-xfer');
    if (xrGo) {
      xrGo.addEventListener('click', function () {
        var u = protos.spi; if (u.tx) { return; }
        u.tx = { kind: 'ring', out: u.byte, slaveBefore: u.slaveShift };
        if (!protos.running) { protos.running = true; }
        prSave(); prRenderStatic();
      });
    }
    var xrDummy = host.querySelector('[data-spidummy]');
    if (xrDummy) {
      xrDummy.addEventListener('click', function () {
        var u = protos.spi; if (u.tx) { return; }
        u.byte = 0x00;
        u.tx = { kind: 'ring', out: 0x00, slaveBefore: u.slaveShift };
        if (!protos.running) { protos.running = true; }
        prSave(); prRenderStatic();
      });
    }
    var xrNew = host.querySelector('[data-spinew]');
    if (xrNew) {
      xrNew.addEventListener('click', function () {
        var u = protos.spi;
        u.slavePar = 0x20 + Math.floor(Math.random() * 0xdf);
        prLog('note', 'sensor finished a conversion: ' + prHex(u.slavePar) + ' is ready, but the shift ring still holds ' + prHex(u.slaveShift));
        prSave(); prRenderStatic();
      });
    }

    /* stage 10: I2C clock stretching */
    var saddr = document.getElementById('pr-i2c-saddr');
    if (saddr) {
      saddr.addEventListener('input', function () {
        var v = parseInt(saddr.value, 16);
        protos.i2c.addr = isNaN(v) ? 0 : (v & 0x7f);
        protos.i2c.result = null; prSave(); prRenderStatic();
      });
    }
    Array.prototype.forEach.call(host.querySelectorAll('[data-i2cstretch]'), function (b) {
      b.addEventListener('click', function () { protos.i2c.stretch = Number(b.dataset.i2cstretch) || 0; protos.i2c.result = null; prSave(); prRenderStatic(); });
    });
    var i2cStretch = document.getElementById('pr-i2c-stretch-send');
    if (i2cStretch) {
      i2cStretch.addEventListener('click', function () {
        var u = protos.i2c; if (u.tx) { return; }
        u.tx = { kind: 'stretch', slots: prI2cStretchSlots(), addr: u.addr, stretch: u.stretch };
        if (!protos.running) { protos.running = true; }
        prSave(); prRenderStatic();
      });
    }

    /* stage 11: CAN arbitration */
    var ida = document.getElementById('pr-can-ida');
    if (ida) {
      ida.addEventListener('input', function () {
        var v = parseInt(ida.value, 16);
        protos.can.idA = isNaN(v) ? 0 : (v & 0x7ff);
        protos.can.result = null; prSave(); prRenderStatic();
      });
    }
    var idb = document.getElementById('pr-can-idb');
    if (idb) {
      idb.addEventListener('input', function () {
        var v = parseInt(idb.value, 16);
        protos.can.idB = isNaN(v) ? 0 : (v & 0x7ff);
        protos.can.result = null; prSave(); prRenderStatic();
      });
    }
    Array.prototype.forEach.call(host.querySelectorAll('[data-canpair]'), function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.canpair.split(',');
        protos.can.idA = parseInt(p[0], 16) & 0x7ff; protos.can.idB = parseInt(p[1], 16) & 0x7ff;
        protos.can.result = null; prSave(); prRenderStatic();
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-candrive]'), function (b) {
      b.addEventListener('click', function () { protos.can.drive = Number(b.dataset.candrive) ? 1 : 0; prSave(); prRenderStatic(); });
    });
    var canArb = document.getElementById('pr-can-arb');
    if (canArb) {
      canArb.addEventListener('click', function () {
        var u = protos.can; if (u.tx) { return; }
        u.tx = prCanArbTx(u.idA, u.idB);
        if (!protos.running) { protos.running = true; }
        prSave(); prRenderStatic();
      });
    }

    /* stage 12: the CAN frame */
    var canId = document.getElementById('pr-can-id');
    if (canId) {
      canId.addEventListener('input', function () {
        var v = parseInt(canId.value, 16);
        protos.can.id = isNaN(v) ? 0 : (v & 0x7ff);
        protos.can.result = null; prCanFrameRefresh(); prSave();
      });
    }
    var canD0 = document.getElementById('pr-can-d0');
    if (canD0) {
      canD0.addEventListener('input', function () {
        var v = parseInt(canD0.value, 16);
        protos.can.d0 = isNaN(v) ? 0 : (v & 0xff);
        protos.can.result = null; prCanFrameRefresh(); prSave();
      });
    }
    var canD1 = document.getElementById('pr-can-d1');
    if (canD1) {
      canD1.addEventListener('input', function () {
        var v = parseInt(canD1.value, 16);
        protos.can.d1 = isNaN(v) ? 0 : (v & 0xff);
        protos.can.result = null; prCanFrameRefresh(); prSave();
      });
    }
    Array.prototype.forEach.call(host.querySelectorAll('[data-candlc]'), function (b) {
      b.addEventListener('click', function () { protos.can.dlc = Number(b.dataset.candlc) || 0; protos.can.result = null; prSave(); prRenderStatic(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-canstuff]'), function (b) {
      b.addEventListener('click', function () { protos.can.stuff = Number(b.dataset.canstuff) ? 1 : 0; protos.can.result = null; prSave(); prRenderStatic(); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-canid]'), function (b) {
      b.addEventListener('click', function () { protos.can.id = parseInt(b.dataset.canid, 16) & 0x7ff; protos.can.result = null; prSave(); prRenderStatic(); });
    });
    var canRx = host.querySelector('[data-canrx]');
    if (canRx) {
      canRx.addEventListener('click', function () { protos.can.receiver = Number(canRx.dataset.canrx) ? 1 : 0; protos.can.result = null; prSave(); prRenderStatic(); });
    }
    var canSend = document.getElementById('pr-can-send');
    if (canSend) {
      canSend.addEventListener('click', function () {
        var u = protos.can; if (u.tx) { return; }
        var raw = prCanFrame(u.id, u.dlc, [u.d0, u.d1], !!u.receiver);
        var st = u.stuff ? prCanStuff(raw) : { bits: raw, stuff: 0 };
        u.tx = { kind: 'frame', bits: raw, stuffed: st.bits, stuff: st.stuff, raw: raw, id: u.id, dlc: u.dlc, acked: !!u.receiver };
        if (!protos.running) { protos.running = true; }
        prSave(); prRenderStatic();
      });
    }

    /* goal verify */
    Array.prototype.forEach.call(host.querySelectorAll('[data-prgoal]'), function (b) {
      b.addEventListener('click', function () {
        var n = Number(b.dataset.prgoal), g = PR_GOALS[n], hint = document.getElementById('pr-goal-hint-' + n);
        if (!g) { return; }
        if (g.ok()) {
          if (!protos.goals[n]) { protos.goals[n] = true; prLog('ok', 'Stage ' + n + ' goal achieved: ' + ((prStageById(n) || {}).name || '')); prSave(); prRenderStatic(); }
          /* Re-read the node: a first-pass success re-rendered the whole body, so the
             old one is detached and the confirmation would land nowhere (same fix as
             the peripherals lab). */
          var okHint = document.getElementById('pr-goal-hint-' + n);
          if (okHint) { okHint.textContent = 'Verified.'; okHint.style.color = 'var(--ok)'; }
        } else if (hint) { hint.textContent = 'Not yet — ' + g.hint(); hint.style.color = 'var(--warn)'; }
      });
    });
  }

  function initProtocols() {
    if (protocolsInited) { prRenderStatic(); return; }
    prLoad();
    prSeedLog();
    prRenderStatic();
    prStartTicker();
    document.addEventListener('keydown', prKeysHandle);
    protocolsInited = true;
  }

