/* Launch-purity spec: booting the app must not perform any IPC action.
 *
 * Zero dependencies. Run with:  node specs/boot_ipc.spec.js
 *
 * The bug: initDataTools() chose between the native and the browser backup path
 * with `if (importBackupNative())`. That reads like feature detection, but
 * importBackupNative() is an ACTION - its first statement is
 * `tauriInvoke("backup_open_dialog")`. So the app opened a file picker on every
 * single launch, before the user had clicked anything, and then attached the
 * click handler and carried on. The file the user eventually picked was read and
 * imported into a session that had never asked for it. exportBackupNative() had
 * the same shape, one click away from the same mistake.
 *
 * The rule this pins: a capability is tested with a predicate, never by
 * performing the action. hasNativeShell() is that predicate; the two backup
 * functions are actions and are only ever called from a click handler.
 *
 * These are behavioural checks, not greps. The real tauriInvoke is sliced out of
 * 20_app.js and run against a recording __TAURI__ stub, so "did boot dial out?"
 * is answered by counting the calls it actually made.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '20_app.js'), 'utf8');

/* ---- slice the launch path as written ----
   From setDataButtonState (the label helper downloadBackup calls on the way out)
   through initDataTools. restoreBackup() is inside this span but is only defined
   here, never called, so its references to rd/wr/localStorage are never
   evaluated and need no stubs. */
const from = app.indexOf('var dataBtnToken = 0;');
const to = app.indexOf('/* ---------------- tiny markdown');
if (from < 0 || to < 0 || to < from) { throw new Error('boot IPC markers not found in 20_app.js'); }
const body = app.slice(from, to);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('pass  ' + name); return; }
  failures++;
  console.log('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
}

/* Boot the slice twice: once as the desktop shell, once as a plain browser. */
function boot(withShell) {
  const calls = [];
  const listeners = {};
  const downloads = [];
  function node(id) {
    return {
      id: id, textContent: '', dataset: {}, style: {}, value: '', files: null, hidden: false,
      addEventListener(evt, fn) { (listeners[id + ':' + evt] = listeners[id + ':' + evt] || []).push(fn); },
      setAttribute() {}, getAttribute() { return null; },
      appendChild() {}, remove() {}, click() {},
    };
  }
  const win = {};
  if (withShell) {
    win.__TAURI__ = { core: { invoke(cmd) { calls.push(cmd); return Promise.resolve(null); } } };
  }
  const ctx = {
    window: win,
    document: {
      getElementById: node,
      createElement: () => { downloads.push(true); return { click() {}, remove() {}, style: {} }; },
      body: { appendChild() {} },
    },
    localStorage: { getItem: () => null, setItem() {} },
    Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    setTimeout: () => 0, JSON: JSON, String: String, Date: Date,
    /* downloadBackup() serialises the whole state. Not part of this slice, and
       not what these checks are about - stub it and keep the failure honest. */
    snapshotAll: () => ({ schema: 2, app: 'embedded-c-roadmap', state: {} }),
  };
  vm.createContext(ctx);
  vm.runInContext(body +
    '\nthis.api = { hasNativeShell: hasNativeShell, tauriInvoke: tauriInvoke,' +
    ' initDataTools: initDataTools, downloadBackup: downloadBackup,' +
    ' importBackupNative: importBackupNative, exportBackupNative: exportBackupNative };', ctx);
  return { api: ctx.api, calls: calls, listeners: listeners, node: node, downloads: downloads };
}

/* ---- the predicate ---- */
const shell = boot(true);
const browser = boot(false);

check('hasNativeShell() is true in the desktop shell', shell.api.hasNativeShell() === true);
check('hasNativeShell() is false in a plain browser', browser.api.hasNativeShell() === false);
check('testing the capability performed no action',
  shell.calls.length === 0 && browser.calls.length === 0,
  'desktop dialled: ' + (shell.calls.join(',') || 'nothing') +
  ' | browser dialled: ' + (browser.calls.join(',') || 'nothing'));

/* ---- the regression: initDataTools must not dial out ---- */
shell.api.initDataTools();
check('booting the desktop app opens no dialog',
  shell.calls.length === 0,
  'invoke calls during boot: ' + (shell.calls.join(',') || 'none'));
check('booting the desktop app still wires Import to the native dialog',
  (shell.listeners['importdata:click'] || []).length === 1,
  'importdata listeners: ' + (shell.listeners['importdata:click'] || []).length);
check('booting the desktop app does not leave the browser file input wired',
  (shell.listeners['importfile:change'] || []).length === 0);

browser.api.initDataTools();
check('booting in a browser opens no dialog', browser.calls.length === 0,
  'invoke calls during boot: ' + (browser.calls.join(',') || 'none'));
check('booting in a browser wires Import to the hidden file input',
  (browser.listeners['importfile:change'] || []).length === 1,
  'importfile listeners: ' + (browser.listeners['importfile:change'] || []).length);
/* The browser path still owns the Import button - it just opens the hidden input
   instead of a native dialog. So the meaningful difference is what the wired
   handler DOES, which the click check below settles. */

/* ---- the click is what opens the dialog, exactly once ---- */
const clicked = boot(true);
clicked.api.initDataTools();
const handler = (clicked.listeners['importdata:click'] || [])[0];
check('a click on Import is wired', typeof handler === 'function');
if (handler) {
  handler();
  check('clicking Import opens exactly one dialog',
    clicked.calls.length === 1 && clicked.calls[0] === 'backup_open_dialog',
    'invoke calls: ' + (clicked.calls.join(',') || 'none'));
}

/* The browser path owns the same button and must not dial IPC when clicked -
   it opens the hidden input instead. This is the check that would have caught
   the boot-time bug too, if the bug had been one click later. */
const brClick = boot(false);
brClick.api.initDataTools();
const brHandler = (brClick.listeners['importdata:click'] || [])[0];
check('Import is wired in a browser too', typeof brHandler === 'function');
if (brHandler) {
  brHandler();
  check('clicking Import in a browser uses the file input, not IPC',
    brClick.calls.length === 0,
    'invoke calls: ' + (brClick.calls.join(',') || 'none'));
}

/* ---- downloadBackup must not test by performing either ---- */
const dl = boot(false);
dl.api.downloadBackup();
check('export in a browser does not touch IPC', dl.calls.length === 0,
  'invoke calls: ' + (dl.calls.join(',') || 'none'));
check('export in a browser actually reaches the blob download', dl.downloads.length === 1,
  'createElement calls: ' + dl.downloads.length);
const dlShell = boot(true);
dlShell.api.downloadBackup();
check('export in the desktop app opens exactly one save dialog',
  dlShell.calls.length === 1 && dlShell.calls[0] === 'backup_save_dialog',
  'invoke calls: ' + (dlShell.calls.join(',') || 'none'));
check('export in the desktop app does not also start a browser download',
  dlShell.downloads.length === 0,
  'createElement calls: ' + dlShell.downloads.length);

/* ---- and the shape that caused it, refused at the source level ----
   A bare `if (action())` is what made an action look like a query. Comments are
   stripped first: the fix's own comment quotes the bad shape in order to warn
   against it, and a guard must not fire on the warning. */
const code = app
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ');
const badShape = [...code.matchAll(/if\s*\(\s*(exportBackupNative|importBackupNative)\s*\(\s*\)\s*\)/g)];
check('no backup action is used as a condition anywhere in the app',
  badShape.length === 0,
  badShape.map((m) => m[1] + '() is being tested by calling it').join('; '));

/* The predicate must exist and be the thing the boot path consults, so the fix
   cannot be "delete the branch" - the browser fallback is still needed. */
check('the native branch is still there, chosen by a predicate',
  /if\s*\(\s*hasNativeShell\(\)\s*\)/.test(code),
  'initDataTools must still pick a path; hasNativeShell() is the only safe way to');
check('hasNativeShell only inspects the global, it never invokes',
  /function hasNativeShell\(\)[\s\S]{0,200}?\n  \}/.test(code) &&
  !/function hasNativeShell\(\)[\s\S]{0,200}?tauriInvoke/.test(code),
  'a predicate that invokes is the same bug wearing a different name');

console.log(failures ? '\n' + failures + ' check(s) FAILED'
  : '\nboot IPC green (launch performs no IPC; only clicks do)');
process.exit(failures ? 1 : 0);
