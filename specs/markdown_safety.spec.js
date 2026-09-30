/* Render-safety spec for the tiny markdown renderer (md / inline).
 *
 * Zero dependencies. Run with:  node specs/markdown_safety.spec.js
 *
 * The threat model: note text and lab journals are user-authored, and they reach
 * the app from two places — typed at the keyboard, and restored from a backup JSON
 * file that may not have been produced by this app. Everything md() emits lands in
 * innerHTML, so the renderer is the whole security boundary: whatever it emits for
 * hostile input is what executes. These checks pin the contract.
 *
 * The last section documents a real hole found while writing this spec: esc()
 * escapes & < > but not the double quote, so a URL containing `"` can close the
 * href attribute mid-value and smuggle new attributes (event handlers) into the
 * emitted <a>. The spec asserts it cannot, which drives the fix in inline().
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'roadmap-source', '20_app.js'), 'utf8');

/* ---- slice the renderer out of the IIFE, exactly as written ----
   md() calls esc(), which lives in the helpers section above it, so both are
   sliced as written — a stub here would only prove the stub is safe. */
const escFrom = app.indexOf('function esc(s)');
const escTo = app.indexOf('function el(tag, cls, html)');
const from = app.indexOf('/* ---------------- tiny markdown');
const to = app.indexOf('/* ---------------- memory map');
if (escFrom < 0 || escTo < escFrom || from < 0 || to < 0 || to < from) { throw new Error('markdown/esc markers not found in 20_app.js'); }
const ctx = vm.createContext({ });
vm.runInContext(app.slice(escFrom, escTo) + '\n' + app.slice(from, to) + '\nthis.md = md; this.inline = inline;', ctx);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('pass  ' + name); return; }
  failures++;
  console.log('FAIL  ' + name + (detail ? '\n      ' + detail : ''));
}

/* crude but sufficient: pull every tag open out of the emitted HTML */
function tags(html) {
  const out = [];
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g)) {
    out.push({ name: m[1].toLowerCase(), attrs: m[2] });
  }
  return out;
}
const ALLOWED = new Set(['h1','h2','h3','h4','p','ul','ol','li','blockquote','hr','pre','code','strong','em','a','br']);

/* ---- 1. the tag whitelist ---- */
const rich = ctx.md('# head\n\npara **bold** *em* `code`\n\n- item one\n- item two\n\n1. first\n2. second\n\n> quoted\n\n---\n\n```c\nint x;\n```\n');
for (const t of tags(rich)) {
  check('emitted <' + t.name + '> is on the whitelist', ALLOWED.has(t.name), rich);
}
check('whitelist output keeps structure',
  rich.includes('<h1>head</h1>') && rich.includes('<ul><li>item one</li>') &&
  rich.includes('<ol><li>first</li>') && rich.includes('<blockquote>') &&
  rich.includes('<hr>') && rich.includes('<pre><code>int x;'), rich);

/* ---- 2. raw HTML never survives as markup ---- */
const hostile = '<script>alert(1)<\/script> and <img src=x onerror=alert(2)> and <iframe src="https://evil.example"><\/iframe>';
const escOut = ctx.md(hostile);
const escTags = tags(escOut).map((t) => t.name);
check('raw <script> is not emitted as an element', !escTags.includes('script'), escOut);
check('raw <img onerror> is not emitted as an element', !escTags.includes('img'), escOut);
check('raw <iframe> is not emitted as an element', !escTags.includes('iframe'), escOut);
check('hostile text survives as escaped text', escOut.includes('&lt;script&gt;') && escOut.includes('&lt;img'), escOut);

/* ---- 3. link scheme allowlist ---- */
const plainJs = ctx.md('[click](javascript:alert(1))');
check('javascript: URL is not turned into a link', !/<a\s/.test(plainJs), plainJs);
check('javascript: URL leaves no "javascript" in an attribute',
  !/<[^>]*javascript/i.test(plainJs), plainJs);
const vbs = ctx.md('[click](vbscript:msgbox)');
const dataLink = ctx.md('[click](data:text/html,<b>x</b>)');
check('data: URL is not turned into a link', !/<a\s/.test(dataLink), dataLink);
check('vbscript: URL is not turned into a link', !/<a\s/.test(vbs), vbs);

/* ---- 4. legitimate links still work ---- */
const good = ctx.md('[docs](https://developer.arm.com/documentation)');
const goodA = tags(good).find((t) => t.name === 'a');
check('https link renders as <a>', !!goodA, good);
check('https link keeps rel="noopener"', !!goodA && /rel="noopener"/.test(goodA.attrs), good);
check('https link keeps target="_blank"', !!goodA && /target="_blank"/.test(goodA.attrs), good);

/* ---- 5. attribute smuggling through the quote hole ----
   esc() leaves " alone, so a `"` inside the URL can close href and add handlers. */
const smuggle = ctx.md('[x](https://a"onerror="alert(1))');
const smuggleTags = tags(smuggle).filter((t) => t.name === 'a');
check('quote-in-URL cannot add attributes to <a>',
  smuggleTags.every((t) => !/onerror|onload|onclick|on[a-z]+\s*=/.test(t.attrs)),
  smuggle);
const smuggle2 = ctx.md('[x](https://a"style="position:fixed;top:0;left:0;width:99%;height:99%)');
check('quote-in-URL cannot add style to <a>',
  tags(smuggle2).every((t) => t.name !== 'a' || !/style\s*=/.test(t.attrs)),
  smuggle2);

/* ---- 6. quotes in ordinary prose stay escaped-as-text (no injection surface) ---- */
const prose = ctx.md('say "hello" **now**');
check('quotes in prose render as text', prose.includes('say "hello"'), prose);

if (failures) {
  console.log('\n' + failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nmarkdown render-safety green');
