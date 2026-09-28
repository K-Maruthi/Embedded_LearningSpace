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
  "1b_data_extensions.js","1b_data_topics.js","20_app.js","40_graph.js"
];

function fail(msg){ console.error("VALIDATION ERROR: " + msg); process.exitCode=1; }
for (const f of files) {
  if (!fs.existsSync(path.join(root,f))) { fail("missing fragment "+f); continue; }
}

function scriptOnly(src) {
  return src.replace(/<script[^>]*>/gi, "").replace(/<\/script>/gi, "").replace(/<\/body>/gi, "").replace(/<\/html>/gi, "");
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),"ec-roadmap-"));
for (const f of files.filter(x=>x.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(root,f),"utf8");
  const out = path.join(tmp,f);
  fs.writeFileSync(out, scriptOnly(src));
  try { cp.execFileSync(process.execPath, ["--check", out], {stdio:"pipe"}); }
  catch(e){ fail("syntax in "+f+"\n"+String(e.stderr||e.stdout||e)); }
}

const body = fs.readFileSync(path.join(root,"02_body.html"),"utf8");
const head = fs.readFileSync(path.join(root,"01_head.html"),"utf8");
const app = fs.readFileSync(path.join(root,"20_app.js"),"utf8");
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

const built = path.join(root,"embedded-c-roadmap.html");
if (fs.existsSync(built)) {
  const html = fs.readFileSync(built,"utf8");
  if ((html.match(/<\/html>/gi)||[]).length !== 1) fail("built HTML must contain exactly one </html>");
  if ((html.match(/<style/gi)||[]).length !== 1) fail("built HTML must contain exactly one <style>");
}

if (!process.exitCode) console.log("Validation OK: fragments, JavaScript syntax, rail and view targets, journal hosts, content breakpoints, graph hooks, and built HTML shape.");
