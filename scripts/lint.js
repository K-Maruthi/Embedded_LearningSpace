#!/usr/bin/env node
"use strict";
/* Zero-dependency lint for the frontend fragments, in the same spirit as the
 * specs: bare node, nothing to install. It guards the specific ways a big
 * hand-written ES5 IIFE actually rots:
 *
 *   - a second `var` declaring a name the app scope already declared
 *     (after the 20-25 fragment split, a re-declaration across fragments
 *     would silently shadow);
 *   - a stray console statement (the app ships none on purpose);
 *   - TODO/FIXME left in the fragments instead of todo.md;
 *   - raw tab characters (the fragments are space-indented).
 *
 *   node scripts/lint.js            lint everything
 *   node scripts/lint.js --warn     report but exit 0
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "roadmap-source");
const APP_FILES = ["20_app.js", "21_lab_compile.js", "22_lab_linker.js",
  "23_lab_periph.js", "24_lab_protocols.js", "25_api.js"];
const DATA_FILES = ["10_data_a.js", "11_data_b.js", "12_data_c.js", "13_data_d.js",
  "14_data_e.js", "15_data_f.js", "16_data_interview.js", "17_data_faults.js",
  "18_data_clusters.js", "19_data_diffs.js", "1b_data_extensions.js", "1b_data_topics.js"];

const problems = [];
function problem(file, line, msg) {
  problems.push(file + ":" + line + "  " + msg);
}

/* ---- duplicate var/function declarations within each IIFE scope ----
   Two scopes: the app IIFE, which is assembled from fragments 20-25 and so can
   only be checked across all six files at once; and the concept graph, which is a
   second self-contained IIFE in its own file (a name shared with the app is fine —
   but a name declared twice inside it is not, which is how a `var esc = …` plus a
   dead `function esc(){}` once sat in there looking like one definition). */
const SCOPES = [
  { name: "the app fragments", files: APP_FILES },
  { name: "40_graph.js", files: ["40_graph.js"] }
];
for (const scopeDef of SCOPES) {
  const scope = new Map();
  for (const f of scopeDef.files) {
    const text = fs.readFileSync(path.join(srcDir, f), "utf8");
    const re = /(?:^|\n)(  var |  function )([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = re.exec(text))) {
      const name = m[2];
      const line = text.slice(0, m.index).split("\n").length;
      if (scope.has(name)) {
        problem(f, line, "redeclares '" + name + "' in " + scopeDef.name + ", already declared in " + scope.get(name));
      } else {
        scope.set(name, f);
      }
    }
  }
}

/* ---- duplicate keys in the public API object ----
   The object handed to the page is a plain literal with its keys at four-space
   indentation. A key written twice is silently shadowed (the later one wins),
   which is exactly how a hand-edited API drifts -- `view` was declared both as a
   one-line wrapper and again as `setView`. Only the API's own literal is scanned,
   so nested objects (deeper indentation) are ignored. */
{
  const file = "25_api.js";
  const text = fs.readFileSync(path.join(srcDir, file), "utf8");
  const start = text.indexOf("window.EmbeddedCRoadmap = {");
  const end = text.indexOf("\n  };\n", start);
  const api = start >= 0 && end > start ? text.slice(start, end) : text;
  const seen = new Map();
  const re = /^    ([A-Za-z_$][\w$]*)\s*:/gm;
  let m;
  while ((m = re.exec(api))) {
    const name = m[1];
    const line = text.slice(0, start + m.index).split("\n").length;
    if (seen.has(name)) {
      problem(file, line, "duplicate public API key '" + name + "', first declared on line " + seen.get(name));
    } else {
      seen.set(name, line);
    }
  }
}

/* ---- hygiene: console / TODO / tabs in every fragment ---- */
for (const f of APP_FILES.concat(DATA_FILES, ["40_graph.js", "01_head.html", "02_body.html"])) {
  const lines = fs.readFileSync(path.join(srcDir, f), "utf8").split("\n");
  lines.forEach((l, i) => {
    if (/\bconsole\./.test(l)) { problem(f, i + 1, "console statement: " + l.trim().slice(0, 60)); }
    if (/\b(TODO|FIXME|XXX)\b/.test(l)) { problem(f, i + 1, "TODO/FIXME in fragment (track it in todo.md): " + l.trim().slice(0, 60)); }
    if (/\t/.test(l)) { problem(f, i + 1, "tab character"); }
  });
}

if (problems.length) {
  console.log(problems.join("\n"));
  console.log("\n" + problems.length + " lint problem(s)" + (process.argv.includes("--warn") ? "" : " — run the specific fix or pass --warn"));
  process.exit(process.argv.includes("--warn") ? 0 : 1);
}
console.log("lint clean: no duplicate declarations in the app fragments or the graph, no duplicate public API keys, no console/TODO/tabs");
