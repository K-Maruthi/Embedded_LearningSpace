#!/usr/bin/env node
"use strict";
/* Keeps the version in one place: package.json is the source of truth, and this
 * script (wired as the npm "version" hook, so `npm version x.y.z` triggers it)
 * syncs src-tauri/tauri.conf.json and src-tauri/Cargo.toml to match. Cargo.lock
 * is refreshed by the next cargo build; CI runs the check below so drift fails
 * the build instead of shipping. Run with --check to verify without writing. */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const v = pkg.version;
const checkOnly = process.argv.includes("--check");
let changed = false;

function patch(file, from, to) {
  const p = path.join(root, file);
  const text = fs.readFileSync(p, "utf8");
  if (!from.test(text)) {
    console.error("sync-version: pattern not found in " + file);
    process.exit(1);
  }
  const next = text.replace(from, to);
  if (next !== text) {
    changed = true;
    if (!checkOnly) { fs.writeFileSync(p, next); }
  }
  console.log((checkOnly ? "checked " : "updated ") + file + " -> " + v);
}

patch("src-tauri/tauri.conf.json", /("version"\s*:\s*")[^"]+(")/, "$1" + v + "$2");
patch("src-tauri/Cargo.toml", /^(version\s*=\s*")[^"]+(")/m, "$1" + v + "$2");

if (checkOnly) {
  const inSync = !changed;
  console.log(inSync ? "versions in sync at " + v : "versions were out of sync");
  process.exit(inSync ? 0 : 1);
}

/* npm runs this as the `version` hook BEFORE it commits, so staging the synced
   files here is what gets them into the `npm version` commit. Harmless no-op
   outside a git repo. */
try {
  require("child_process").execFileSync("git",
    ["add", "package.json", "package-lock.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml"],
    { stdio: "ignore" });
} catch (e) { /* not a repo / no git — nothing to stage */ }
console.log("version synced to " + v);
