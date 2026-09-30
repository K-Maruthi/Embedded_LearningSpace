/* Answer-key spec for the graded multiple-choice questions in the two reading labs.
 *
 * Zero dependencies. Run with:  node specs/lab_quiz.spec.js
 *
 * Why this exists: the Compilation Path and Linker & Startup labs each end a stage
 * with a graded question, and both labs originally decided correctness in code with
 * `b.dataset.a === "a"` — i.e. "the first option is always right". That is true for
 * most of the questions and false for exactly two:
 *
 *   - compile / q2  ("which stage applies .data > RAM AT > FLASH?") — correct is
 *     Linker, which is option "b", but option "a" (Compiler) was marked correct.
 *   - link / m2     ("uint8_t buffer[256];" placement) — correct is RAM .bss, which
 *     is option "b", but option "a" (Flash .text) was marked correct.
 *
 * A green check on a wrong answer is the worst failure a teaching app can have, and
 * it is invisible: the explanation text next to it is right, so the pair reads
 * plausibly unless you already know. The fix moves the answer out of the handler and
 * into the markup (`data-ok="…"`), where it is data a spec and the build can check.
 *
 * This pins three things:
 *   1. every graded group declares data-ok, and it names one of its own options;
 *   2. the questions whose answers were once wrong still point at the true option;
 *   3. no grading handler reintroduces the `dataset.a === "a"` shortcut.
 */
const fs = require('fs');
const path = require('path');

const labs = [
  { file: '21_lab_compile.js', cls: 'complab-choices', keyAttr: 'data-cq' },
  { file: '22_lab_linker.js', cls: 'linklab-quiz', keyAttr: 'data-q' },
].map((l) => Object.assign(l, {
  src: fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', l.file), 'utf8'),
}));

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('pass  ' + name); return; }
  failures++;
  console.log('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
}

/* A container with the lab's class is either a graded question (it carries the
   lab's key attribute — data-cq / data-q) or the "put these in order" widget, which
   shares the class but grades by data-order. Their inner HTML has no nested <div>,
   so a non-greedy match to the first </div> is exactly the container. */
function groups(lab) {
  const out = [];
  const rx = new RegExp('<div class="' + lab.cls + '"([^>]*)>([\\s\\S]*?)</div>', 'g');
  let m;
  while ((m = rx.exec(lab.src))) {
    const attrs = m[1];
    const inner = m[2];
    const id = new RegExp(lab.keyAttr + '="([^"]+)"').exec(attrs);
    const ok = /data-ok="([^"]+)"/.exec(attrs);
    const opts = [...inner.matchAll(/data-a="([^"]+)"/g)].map((o) => o[1]);
    const labels = {};
    for (const b of inner.matchAll(/<button[^>]*data-a="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)) {
      labels[b[1]] = b[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }
    out.push({ id: id ? id[1] : null, ok: ok ? ok[1] : null, opts, labels });
  }
  return out;
}

/* ---- 1. every graded group declares a correct option, and it is one of its own ---- */
const all = [];
for (const lab of labs) {
  const gs = groups(lab);
  check(lab.file + ': found graded questions', gs.length > 0);
  for (const g of gs) {
    if (!g.id) {
      /* The ordering widget: same class, graded by data-order, no data-a options.
         A choice group that lost its key attribute would land here with options, so
         that is a failure rather than a silent skip. */
      check(lab.file + ': a group with ' + lab.keyAttr + ' is a graded question',
        g.opts.length === 0, 'this container has options but no ' + lab.keyAttr);
      continue;
    }
    all.push(Object.assign({ file: lab.file }, g));
    check(lab.file + ' ' + g.id + ': declares data-ok', !!g.ok,
      'options are ' + JSON.stringify(g.opts));
    check(lab.file + ' ' + g.id + ': data-ok names a real option', !!g.ok && g.opts.indexOf(g.ok) !== -1,
      'data-ok=' + g.ok + ' but options are ' + JSON.stringify(g.opts));
  }
}

/* ---- 2. the answer key is textually correct ---- */
const EXPECT = {
  '21_lab_compile.js:compile': 'C syntax',
  '21_lab_compile.js:q1': 'Preprocessor',
  '21_lab_compile.js:q2': 'Linker',
  '22_lab_linker.js:m1': '.data',
  '22_lab_linker.js:m2': '.bss',
  '22_lab_linker.js:m3': 'stack',
  '22_lab_linker.js:chain': 'linker',
  '22_lab_linker.js:endtoend': '_sidata',
};
for (const key of Object.keys(EXPECT)) {
  const g = all.filter((x) => x.file + ':' + x.id === key)[0];
  const want = EXPECT[key];
  const got = g && g.ok ? g.labels[g.ok] : undefined;
  check(key + ': correct option reads "' + want + '"',
    !!got && got.toLowerCase().indexOf(want.toLowerCase()) !== -1,
    'marked-correct option ' + JSON.stringify(g && g.ok) + ' = ' + JSON.stringify(got) +
    '; all options ' + JSON.stringify(g && g.labels));
}

/* ---- 3. no handler decides correctness by a hardcoded first-letter ---- */
for (const lab of labs) {
  const hardcoded = /dataset\.a\s*===?\s*"(?:a|b|c)"/.test(lab.src);
  check(lab.file + ': grading compares against data-ok, not a literal',
    !hardcoded, 'found dataset.a compared to a literal in the grading handler');
}
/* The order-the-steps questions are graded independently of data-ok; they carry
   data-order instead, so they must never be picked up by the group scan above. */
for (const lab of labs) {
  const stray = /data-order[^>]*data-ok|data-ok[^>]*data-order/.test(lab.src);
  check(lab.file + ': the ordering questions are not given a data-ok', !stray);
}

if (failures) {
  console.log('\n' + failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nlab quiz answer keys green (' + all.length + ' graded questions)');
