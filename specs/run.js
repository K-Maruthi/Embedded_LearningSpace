#!/usr/bin/env node
/* Runs every specs/*.spec.js as its own process and aggregates the result.
 * Zero dependencies, matching the convention these specs share with
 * roadmap-source/validate_build.js. Each spec exits 0 or non-zero, so the
 * only job here is to run them all and report which ones failed.
 *
 *   node specs/run.js            run everything
 *   node specs/run.js backup     run specs whose filename matches "backup"
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const dir = __dirname;
const filter = process.argv[2];
const specs = fs.readdirSync(dir).filter((f) => f.endsWith('.spec.js'))
  .filter((f) => !filter || f.indexOf(filter) >= 0)
  .sort();

if (!specs.length) { console.error('no specs matched' + (filter ? ' "' + filter + '"' : ' in ' + dir)); process.exit(1); }

const failed = [];
for (const f of specs) {
  console.log('\n=== ' + f + ' ' + '='.repeat(Math.max(0, 58 - f.length)));
  try {
    cp.execFileSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  } catch (e) {
    failed.push(f);
  }
}

console.log('\n' + '-'.repeat(64));
if (failed.length) {
  console.log(failed.length + ' of ' + specs.length + ' spec file(s) FAILED: ' + failed.join(', '));
  process.exit(1);
}
console.log('all specs green (' + specs.length + ' file(s), ' + specs.map((s) => s.replace(/\.spec\.js$/, '')).join(', ') + ')');
