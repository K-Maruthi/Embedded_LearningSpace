#!/usr/bin/env node
"use strict";
const fs = require("fs");
const cp = require("child_process");
const os = require("os");
const path = require("path");

const root = __dirname;
const files = [
  "01_head.html","02_body.html",
  "10_data_a.js","11_data_b.js","12_data_c.js","13_data_d.js","14_data_e.js","15_data_f.js",
  "16_data_interview.js","17_data_faults.js","18_data_clusters.js","19_data_diffs.js",
  "1b_data_extensions.js","1b_data_topics.js"
];
const appFiles = [
  "20_app.js","21_lab_compile.js","22_lab_linker.js","23_lab_periph.js","24_lab_protocols.js","25_api.js"
];
const GRAPH_FILE = "40_graph.js";

function fail(msg){ console.error("VALIDATION ERROR: " + msg); process.exitCode=1; }
for (const f of files) {
  if (!fs.existsSync(path.join(root,f))) { fail("missing fragment "+f); continue; }
}

function scriptOnly(src) {
  return src.replace(/<script[^>]*>/gi, "").replace(/<\/script>/gi, "").replace(/<\/body>/gi, "").replace(/<\/html>/gi, "");
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),"ec-roadmap-"));
/* The app IIFE spans 20-25: 20_app.js opens it and 25_api.js closes it, so those
   fragments do not parse alone — only the assembled span does. Data fragments and
   the graph script are self-contained and checked on their own. */
for (const f of files.filter(x=>x.endsWith(".js")).concat([GRAPH_FILE])) {
  const src = fs.readFileSync(path.join(root,f),"utf8");
  const out = path.join(tmp,f);
  fs.writeFileSync(out, scriptOnly(src));
  try { cp.execFileSync(process.execPath, ["--check", out], {stdio:"pipe"}); }
  catch(e){ fail("syntax in "+f+"\n"+String(e.stderr||e.stdout||e)); }
}
const appAll = appFiles.map(f=>scriptOnly(fs.readFileSync(path.join(root,f),"utf8"))).join("");
const appAllPath = path.join(tmp,"_assembled_app.js");
fs.writeFileSync(appAllPath, appAll);
try { cp.execFileSync(process.execPath, ["--check", appAllPath], {stdio:"pipe"}); }
catch(e){ fail("syntax in the assembled app fragments\n"+String(e.stderr||e.stdout||e)); }

const body = fs.readFileSync(path.join(root,"02_body.html"),"utf8");
const head = fs.readFileSync(path.join(root,"01_head.html"),"utf8");
const app = appAll;
const views = [...app.matchAll(/"view-([a-z0-9_-]+)"/g)].map(m=>m[1]);
const bodyIds = new Set([...body.matchAll(/id="view-([a-z0-9_-]+)"/g)].map(m=>m[1]));
for (const v of new Set(views)) if (!bodyIds.has(v)) fail("20_app.js references view-"+v+" but body has no such view");

/* The left rail is the app's only navigation, so "can every view be reached"
   stops being a list someone has to remember to update and becomes a fact
   checked against the markup on both sides of the boundary. */
const shell = head.slice(head.indexOf("<body>"));
const railBtns = [...shell.matchAll(/<button[^>]*>/g)].map(m=>m[0])
  .filter(t=>/data-v="/.test(t))
  .map(t=>({ v:/data-v="([^"]+)"/.exec(t)[1], sv:(/data-sv="([^"]+)"/.exec(t)||["",""])[1] }));
if (!railBtns.length) fail("the rail in 01_head.html has no view buttons");
const railViews = new Set(railBtns.map(b=>b.v));
for (const v of railViews) if (!bodyIds.has(v)) fail("rail button data-v="+v+" has no view-"+v+" in the body");
for (const id of bodyIds) if (!railViews.has(id)) fail("view-"+id+" exists but the rail cannot navigate to it");
const subIds = new Set([...body.matchAll(/id="sv-([a-z0-9_-]+)"/g)].map(m=>m[1]));
for (const b of railBtns) if (b.sv && !subIds.has(b.sv)) fail("rail button data-sv="+b.sv+" has no sv-"+b.sv+" in the body");

if ((shell.match(/aria-pressed="true"/g)||[]).length !== 1) fail("the rail must start with exactly one pressed button");

/* The practice sub-nav is the same contract one level down. It held a "Linker &
   startup" button with no section behind it for as long as it worked, because the
   app special-cased that one name into a jump - so nothing ever had to make the
   button true. A nav item is now checked against the sections, never against a
   special case in the code. */
const pvStart = body.indexOf('id="pv-subnav"');
if (pvStart < 0) fail("no #pv-subnav in 02_body.html");
else {
  const pvNav = body.slice(pvStart, body.indexOf("</nav>", pvStart));
  for (const m of pvNav.matchAll(/data-sv="([^"]+)"/g))
    if (!subIds.has(m[1])) fail("practice sub-nav button "+m[1]+" has no #sv-"+m[1]+" section");
}

/* A lab journal only works if four things agree on one name: the renderer that mounts
   the box, the host element that is NOT owned by that renderer, the jump path the
   dashboard uses to get back to a stage, and the storage key written under it. Every
   way to get that wrong is invisible at runtime - no box appears, or the box appears
   and its dashboard row goes nowhere - so the name is checked across the boundary. */
const jrMounts = new Set([...app.matchAll(/journalMount\("([a-z0-9_-]+)"/g)].map(m=>m[1]));
const jrHosts = new Set([...body.matchAll(/id="jr-([a-z0-9_-]+)"/g)].map(m=>m[1]));
const jrTabs = new Map();
for (const m of ((/var JR_TABS = \{([\s\S]*?)\};/.exec(app)||[,""])[1]).matchAll(/([a-z0-9_-]+):\s*"([^"]+)"/g)) jrTabs.set(m[1], m[2]);
if (!jrMounts.size) fail("no lab mounts a journal - journalMount() is never called");
for (const l of jrMounts) if (!jrHosts.has(l)) fail("journalMount(\""+l+"\") has no #jr-"+l+" host in the body, so the box is silently dropped");
for (const l of jrHosts) if (!jrMounts.has(l)) fail("#jr-"+l+" exists but no renderer mounts a journal into it");
for (const l of jrMounts) if (!jrTabs.has(l)) fail("lab "+l+" has a journal but no JR_TABS entry, so the dashboard cannot jump back to its stages");
for (const [l, attr] of jrTabs) {
  if (!jrMounts.has(l)) fail("JR_TABS lists "+l+" but that lab has no journal to jump back into");
  if (!body.includes(attr+"=") && !app.includes(attr+"=\"")) fail("JR_TABS points "+l+" at ["+attr+"], which neither the markup nor the labs generate");
}

/* A graded question's answer key lives in the markup (data-ok), not in the handler.
   The two reading labs once decided correctness with `b.dataset.a === "a"`, which
   silently marks the first option right — true for most questions, false for two
   (compile/q2 is "Linker", link/m2 is ".bss"). A wrong green check teaches the
   wrong thing and is invisible, so the key is now declared as data and checked
   here, where adding a question without one fails the build. */
for (const m of app.matchAll(/<div class="(?:complab-choices|linklab-quiz)"([^>]*)>([\s\S]*?)<\/div>/g)) {
  const attrs = m[1], inner = m[2];
  const key = /data-(?:cq|q)="([^"]+)"/.exec(attrs);
  if (!key) continue; /* the ordering widget shares the class but grades by data-order */
  const ok = /data-ok="([^"]+)"/.exec(attrs);
  const opts = [...inner.matchAll(/data-a="([^"]+)"/g)].map(o => o[1]);
  if (!ok) fail("graded question " + key[1] + " has no data-ok answer key");
  else if (opts.indexOf(ok[1]) === -1) fail("graded question " + key[1] + ": data-ok=" + ok[1] + " is not one of its options " + JSON.stringify(opts));
  else if (opts.length < 2) fail("graded question " + key[1] + " needs at least two options");
}
if (/dataset\.a\s*===?\s*"(?:a|b|c)"/.test(app)) fail("a lab grading handler hardcodes the first option as correct — declare data-ok and compare against it instead");

/* Version single-sourcing. The "rev …" label in the rail is the only version a
   learner reads, and it used to be hand-typed (it said 1.2 while the app was
   1.0.0). It now travels as a token that build.js replaces from package.json, so
   the fragments must carry the token and must not carry a literal rev number. */
const versionSources = head + body + app;
if (versionSources.indexOf("__APP_VERSION__") === -1) fail("no __APP_VERSION__ token in the fragments — the displayed revision would be hand-typed again");
if (/\brev\s+\d+\.\d+/.test(versionSources)) fail("a fragment hardcodes a rev number — use __APP_VERSION__, which build.js substitutes from package.json");

/* Content breakpoints are measured off the content column, and the rail takes
   --rail (212px) out of the viewport before any content starts. A rule written as
   max-width:600px after the rail landed would fire at a 388px content column, so the
   layout would keep its multi-column shape at widths where that no longer fits -
   which reads as "nothing happened" rather than as an error. The rail's own 820px
   rule is the deliberate exception: it is about the window, not the content. */
const RAIL = 212;
for (const m of head.matchAll(/@media[^{]*\(\s*max-width:\s*(\d+)px\s*\)/g)) {
  const n = Number(m[1]);
  if (n === 820) continue;
  if (n < 600 + RAIL) fail("media rule at "+n+"px is narrower than a 600px content column plus the "+RAIL+"px rail - write content breakpoints as (intended content width + "+RAIL+")");
}

// ids the shell owns and 20_app.js looks up by id on every boot
for (const id of ["q","expandall","revline","progbar","progtxt","exportdata","importdata","importfile","themebtn","crumb-grp","crumb-view"])
  if (!shell.includes('id="'+id+'"')) fail("missing shell element "+id);

/* Tag balance across the two pure-markup fragments. An unclosed </details> in the
   rail would swallow the masthead and every other check here would still pass. */
const BALANCE = ["div","section","nav","main","header","footer","details","summary","p","span","table","svg","aside","button"];
for (const [name, frag] of [["01_head.html shell", shell], ["02_body.html", body]]) {
  for (const t of BALANCE) {
    const open = (frag.match(new RegExp("<"+t+"(?=[ >])", "g"))||[]).length;
    const close = (frag.match(new RegExp("</"+t+">", "g"))||[]).length;
    if (open !== close) fail(name+" has "+open+" <"+t+"> but "+close+" </"+t+">");
  }
}

for (const id of ["g-reheat","gclusters","gframe","gkinds","gmodes","gpanel","gtip"])
  if (!body.includes('id="'+id+'"')) fail("missing graph element "+id);

/* The product ships as one HTML document with no network at runtime, so this file's
   size *is* first paint on a cold start — and it grows a little with every data
   fragment nobody is watching. A budget turns "the app got slower" into a build
   failure with a number attached. Raise it deliberately (and say why) when content
   genuinely needs the room. */
const HTML_BUDGET_KB = 1500;
let builtKb = null;
const built = path.join(root,"embedded-c-roadmap.html");
if (fs.existsSync(built)) {
  const html = fs.readFileSync(built,"utf8");
  if ((html.match(/<\/html>/gi)||[]).length !== 1) fail("built HTML must contain exactly one </html>");
  if ((html.match(/<style/gi)||[]).length !== 1) fail("built HTML must contain exactly one <style>");
  if (html.indexOf("__APP_VERSION__") !== -1) fail("built HTML still contains __APP_VERSION__ — build.js must substitute it from package.json before copying to src/index.html");
  builtKb = Math.round(html.length/1024);
  if (html.length > HTML_BUDGET_KB*1024) fail("built HTML is "+builtKb+" KB, over the "+HTML_BUDGET_KB+" KB single-file budget — trim markup, or raise HTML_BUDGET_KB on purpose and say why");
}

if (!process.exitCode) console.log("Validation OK: fragments, JavaScript syntax, rail and view targets, journal hosts, quiz answer keys, version single-sourcing, content breakpoints, graph hooks, built HTML shape"+(builtKb===null?"":" and a "+builtKb+"/"+HTML_BUDGET_KB+" KB single-file budget")+".");
