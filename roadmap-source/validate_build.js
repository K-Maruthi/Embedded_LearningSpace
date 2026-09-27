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
const app = fs.readFileSync(path.join(root,"20_app.js"),"utf8");
const views = [...app.matchAll(/"view-([a-z0-9_-]+)"/g)].map(m=>m[1]);
const bodyIds = new Set([...body.matchAll(/id="view-([a-z0-9_-]+)"/g)].map(m=>m[1]));
for (const v of new Set(views)) if (!bodyIds.has(v)) fail("20_app.js references view-"+v+" but body has no such view");

for (const id of ["view-roadmap","view-dash","view-mosaic","view-practice","view-graph","view-compile","view-playground"])
  if (!body.includes('id="'+id+'"')) fail("missing required "+id);

for (const id of ["g-reheat","gclusters","gframe","gkinds","gmodes","gpanel","gtip"])
  if (!body.includes('id="'+id+'"')) fail("missing graph element "+id);

const built = path.join(root,"embedded-c-roadmap.html");
if (fs.existsSync(built)) {
  const html = fs.readFileSync(built,"utf8");
  if ((html.match(/<\/html>/gi)||[]).length !== 1) fail("built HTML must contain exactly one </html>");
  if ((html.match(/<style/gi)||[]).length !== 1) fail("built HTML must contain exactly one <style>");
}

if (!process.exitCode) console.log("Validation OK: fragments, JavaScript syntax, view targets, graph hooks, and built HTML shape.");
