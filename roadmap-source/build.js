#!/usr/bin/env node
"use strict";
/* Reproducible concatenation build (same fragment order as build.sh) plus the
   copy into src/index.html that the Tauri frontendDist expects. Run via
   `npm run build:roadmap` from the repository root. */
const fs = require("fs");
const cp = require("child_process");
const path = require("path");

const root = __dirname;
const repo = path.join(root, "..");
const files = [
  "01_head.html", "02_body.html",
  "10_data_a.js", "11_data_b.js", "12_data_c.js", "13_data_d.js", "14_data_e.js", "15_data_f.js",
  "16_data_interview.js", "17_data_faults.js", "18_data_clusters.js", "19_data_diffs.js",
  "1b_data_extensions.js", "1b_data_topics.js", "20_app.js", "40_graph.js"
];

const out = path.join(root, "embedded-c-roadmap.html");
const html = files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("");
fs.writeFileSync(out, html);
console.log("Built embedded-c-roadmap.html (" + html.length + " bytes)");

cp.execFileSync(process.execPath, [path.join(root, "validate_build.js")], { stdio: "inherit" });

const dest = path.join(repo, "src", "index.html");
fs.copyFileSync(out, dest);
console.log("Copied to " + path.relative(path.resolve(repo), dest));
