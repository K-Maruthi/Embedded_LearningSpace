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
  "1b_data_extensions.js", "1b_data_topics.js"
];
/* The app IIFE spans several fragments: 20_app.js holds state, views, practice and
   the boot sequence (and opens the <script> tag); 21-24 hold the four labs;
   25_api.js closes with the public API and the IIFE's closing paren (and closes
   the </script> tag). Concatenating the span in order reproduces the original
   single-file app byte for byte. */
const appFiles = [
  "20_app.js", "21_lab_compile.js", "22_lab_linker.js", "23_lab_periph.js",
  "24_lab_protocols.js", "25_api.js"
];
const GRAPH_FILE = "40_graph.js";

const out = path.join(root, "embedded-c-roadmap.html");
const appJs = appFiles.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("");
const graphJs = fs.readFileSync(path.join(root, GRAPH_FILE), "utf8");
const html = files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("")
  + appJs + graphJs;
/* The one version string a learner reads ("rev …" in the rail) is substituted here
   from package.json — the single source of truth sync-version.js already guards —
   so it can no longer drift the way a hand-typed revision label once did while the app
   shipped as 1.0.0. validate_build.js fails if the token is missing or a hardcoded
   version slips back into a fragment. */
const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
const stamped = html.replace(/__APP_VERSION__/g, pkg.version);
fs.writeFileSync(out, stamped);
console.log("Built embedded-c-roadmap.html (" + stamped.length + " bytes) at rev " + pkg.version);

cp.execFileSync(process.execPath, [path.join(root, "validate_build.js")], { stdio: "inherit" });

const dest = path.join(repo, "src", "index.html");
fs.copyFileSync(out, dest);

/* The built HTML loads fonts with relative URLs ("fonts/…"), and the Tauri
   frontendDist is ../src — so the vendored woff2 files must sit next to
   src/index.html or the app silently falls back to system fonts. */
const fontDir = path.join(repo, "src", "fonts");
fs.mkdirSync(fontDir, { recursive: true });
for (const f of fs.readdirSync(path.join(root, "fonts"))) {
  if (f.endsWith(".woff2")) { fs.copyFileSync(path.join(root, "fonts", f), path.join(fontDir, f)); }
}

console.log("Copied to " + path.relative(path.resolve(repo), dest) + " (+ src/fonts/)");
