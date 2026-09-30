/* Render smoke test for the Protocol Lab (24_lab_protocols.js).
 *
 * Zero dependencies. Run with:  node specs/protocol_stages.spec.js
 *
 * A stage body in this lab is a pure function of `protos` - no DOM, no Tauri, no
 * network - so a whole stage can be rendered headlessly. That matters because the
 * failure mode is silent: one undefined name in one caption throws inside
 * prRenderStatic(), the innerHTML assignment never happens, and the tab simply
 * stops responding while the stage id is already saved. The model spec cannot see
 * that; this one renders every stage and reads the result.
 *
 * Covered: every declared stage renders, offers a goal card and a nav button;
 * no template hole leaks "undefined"/"NaN" into the page; every stage-7 map link
 * points at a stage that exists; and every goal's ok()/hint() is callable on a
 * fresh lab instead of throwing on the first click.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '24_lab_protocols.js'), 'utf8');

/* esc() is the only thing the renderers borrow from 20_app.js; everything else
   they touch (rd/wr/notice/journalMount) lives on the write-and-save paths, which
   rendering never takes. */
const ctx = vm.createContext({
  esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
});
vm.runInContext(src +
  '\nthis.PR_STAGE_META = PR_STAGE_META; this.PR_FAMILIES = PR_FAMILIES; this.PR_GOALS = PR_GOALS;' +
  '\nthis.prBody = prBody; this.prStageNav = prStageNav; this.prFamNav = prFamNav;' +
  '\nthis.prI2cStretchSlots = prI2cStretchSlots; this.prI2cTxSlots = prI2cTxSlots;' +
  '\nthis.setStage = function (n) { protos.stage = n; };', ctx);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('pass  ' + name); return; }
  failures++;
  console.log('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
}

const metas = ctx.PR_STAGE_META;
const ids = metas.map((s) => s.id);
const nameOf = (id) => (metas.filter((s) => s.id === id)[0] || {}).name || '?';

/* ---- the shape of the module itself ---- */
check('twelve stages are declared, each with a unique id', ids.length === 12 && new Set(ids).size === 12, ids.join());
check('every stage names a family that exists',
  metas.every((s) => ctx.PR_FAMILIES.some((f) => f.id === s.fam)),
  metas.filter((s) => !ctx.PR_FAMILIES.some((f) => f.id === s.fam)).map((s) => s.id));
check('every stage carries a name and a one-line tag',
  metas.every((s) => typeof s.name === 'string' && s.name.length > 3 && typeof s.tag === 'string' && s.tag.length > 3));
check('every family has at least one stage',
  ctx.PR_FAMILIES.every((f) => metas.some((s) => s.fam === f.id)),
  ctx.PR_FAMILIES.filter((f) => !metas.some((s) => s.fam === f.id)).map((f) => f.id));
check('the goal table covers exactly the declared stages',
  Object.keys(ctx.PR_GOALS).map(Number).sort((a, b) => a - b).join() === ids.slice().sort((a, b) => a - b).join(),
  Object.keys(ctx.PR_GOALS).join());

/* ---- every stage must render, whole ---- */
ids.forEach((id) => {
  ctx.setStage(id);
  let html = null, err = null;
  try { html = ctx.prBody(); } catch (e) { err = String(e && e.stack ? e.stack.split('\n')[0] : e); }
  check('stage ' + id + ' (' + nameOf(id) + ') renders', html !== null, err || '');
  if (html === null) { return; }
  check('stage ' + id + ' builds a full stage, not a fragment', html.length > 900, 'length ' + html.length);
  check('stage ' + id + ' offers its own goal card', html.indexOf('data-prgoal="' + id + '"') >= 0);
  /* a template hole is the one bug that survives every other check here */
  check('stage ' + id + ' leaks no undefined or NaN into the page',
    html.indexOf('undefined') < 0 && html.indexOf('NaN') < 0,
    (html.match(/.{0,40}(undefined|NaN).{0,40}/) || [])[0]);
});

/* ---- the nav is built from the same metadata the pages are ----
   the stage tier only ever shows the current family, so each stage is asked for
   its own family: "reachable" means the tab is one click away from where you are */
ids.forEach((id) => {
  const fam = metas.filter((s) => s.id === id)[0].fam;
  const family = metas.filter((s) => s.fam === fam).map((s) => s.id);
  ctx.setStage(id);
  const nav = ctx.prStageNav() + ctx.prFamNav();
  check('the nav offers a button for stage ' + id, nav.indexOf('data-prstage="' + id + '"') >= 0);
  check('and for the rest of ' + fam + ' while you are in it',
    family.every((n) => nav.indexOf('data-prstage="' + n + '"') >= 0),
    family.filter((n) => nav.indexOf('data-prstage="' + n + '"') < 0).join());
  check('and highlights exactly that family, not two',
    (nav.match(/class="pr-fam cur"/g) || []).length === 1 && nav.indexOf('id="pr-fam-' + fam + '"') >= 0);
  check('and marks exactly one stage as current',
    (nav.match(/aria-selected="true"/g) || []).length === 2,
    (nav.match(/aria-selected="true"/g) || []).length + ' selected tabs (one family + one stage)');
});

/* ---- stage 7's whole point is that every cell is a working link ---- */
ctx.setStage(7);
const mapHtml = ctx.prBody();
const mapLinks = [...mapHtml.matchAll(/data-prstage="(\d+)"/g)].map((m) => Number(m[1])).filter((n) => n !== 7);
check('the protocol map links somewhere for every stage it mentions', mapLinks.length >= 12, mapLinks.length);
check('and every one of those links resolves to a real stage',
  mapLinks.every((n) => ids.indexOf(n) >= 0), mapLinks.filter((n) => ids.indexOf(n) < 0));
check('the map covers all four protocol families it claims to compare',
  ['uart', 'i2c', 'spi', 'can'].every((f) => mapHtml.indexOf('data-prstage="' + metas.filter((s) => s.fam === f)[0].id + '"') >= 0));

/* ---- a goal whose ok()/hint() throws is worse than no goal at all ---- */
ctx.setStage(ids[0]);
Object.keys(ctx.PR_GOALS).forEach((k) => {
  const g = ctx.PR_GOALS[k];
  let okVal = null, hint = null;
  try { okVal = g.ok(); hint = g.hint(); } catch (e) { hint = null; }
  check('goal ' + k + ' evaluates without throwing on a fresh lab', (okVal === true || okVal === false) && typeof hint === 'string' && hint.length > 10,
    typeof hint === 'string' ? hint : 'ok() or hint() threw');
  check('goal ' + k + ' starts unachieved', okVal === false);
});

/* ---- the new animated stages must expose the controls their model needs ---- */
ctx.setStage(10);
const stretchHtml = ctx.prBody();
check('the clock-stretching stage exposes the hold length', /data-i2cstretch="\d"/.test(stretchHtml));
check('and a way to run it', stretchHtml.indexOf('id="pr-i2c-stretch-send"') >= 0);
/* the slot builder is where an argument-order slip turns a write transfer with a
   payload into a bare read address, which still renders and still animates */
const sslots = ctx.prI2cStretchSlots();
const stretchRun = sslots.filter((s) => s.kind === 'stretch');
check('the stretched transfer is START + address + ACK + data + ACK + STOP plus the hold',
  sslots.length === 20 + stretchRun.length && sslots[0].kind === 'start' && sslots[sslots.length - 1].kind === 'stop',
  sslots.length + ' slots, kinds ' + sslots.map((s) => s.lab).join(' '));
check('it addresses 0x50 for a write on the first byte',
  sslots.slice(1, 9).map((s) => s.sda).join('') === '1010000' + '0', sslots.slice(1, 9).map((s) => s.sda).join(''));
check('the slave ACKs before it holds anything', sslots[9].kind === 'ack' && sslots[9].sda === 0);
check('the hold sits between the ACK and the data byte, for exactly the configured length',
  sslots[10].kind === 'stretch' && stretchRun.length === 3 && sslots[10 + stretchRun.length].kind === 'data');
check('and the payload byte is the one the stage claims to write',
  sslots.slice(10 + stretchRun.length, 18 + stretchRun.length).map((s) => s.sda).join('') === '10100101',
  sslots.slice(10 + stretchRun.length, 18 + stretchRun.length).map((s) => s.sda).join(''));

/* the wire carries an 8-bit address byte: seven address bits then R/W. Reading it
   with the 7-bit helper drops A6 and freezes R/W at 0, which renders, animates and
   is simply a different byte from the one every label in the stage names. */
const addrBits = (rw) => ctx.prI2cTxSlots(0x50, rw, true, true).slice(1, 9).map((s) => s.sda).join('');
check('the address byte drawn for 0x50 + write is 0xA0', addrBits(0) === '10100000', addrBits(0));
check('and for 0x50 + read it is 0xA1, differing only in R/W',
  addrBits(1) === '10100001', addrBits(1));
check('the data byte drawn is the byte the prose claims',
  ctx.prI2cTxSlots(0x50, 0, true, true).slice(10, 18).map((s) => s.sda).join('') === '10100101');
ctx.setStage(11);
const arbHtml = ctx.prBody();
check('the arbitration stage takes two IDs and a way to race them',
  arbHtml.indexOf('id="pr-can-ida"') >= 0 && arbHtml.indexOf('id="pr-can-idb"') >= 0 && arbHtml.indexOf('id="pr-can-arb"') >= 0);
check('and shows the arbitration bit table', arbHtml.indexOf('id="pr-can-table"') >= 0);
ctx.setStage(12);
const frameHtml = ctx.prBody();
check('the frame stage takes an ID, a length and a payload',
  frameHtml.indexOf('id="pr-can-id"') >= 0 && /data-candlc="/.test(frameHtml) && frameHtml.indexOf('id="pr-can-d0"') >= 0);
check('and shows both the encoded frame and the stuffing strip',
  frameHtml.indexOf('id="pr-can-framewave"') >= 0 && frameHtml.indexOf('id="pr-can-stuff"') >= 0);
check('the frame trace draws one band per field, not one box per bit',
  (() => {
    const bands = (frameHtml.match(/class="segbox [a-z]+"/g) || []).length;
    return bands >= 8 && bands <= 20;
  })(), (frameHtml.match(/class="segbox [a-z]+"/g) || []).join(' '));

if (failures) {
  console.log('\n' + failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nprotocol stages green (every stage renders, every goal is callable, every map link resolves)');
