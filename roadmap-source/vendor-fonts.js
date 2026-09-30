#!/usr/bin/env node
"use strict";
/* One-off helper used to vendor the three Google-hosted font families locally.
 * Downloads the latin-subset woff2 files into roadmap-source/fonts/ and prints
 * the @font-face block that was inserted at the top of the <style> rule in
 * 01_head.html. Not part of the build; kept so the vendoring is reproducible. */
const fs = require("fs");
const path = require("path");

const CSS_URL = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const dir = path.join(__dirname, "fonts");

(async () => {
  const css = await (await fetch(CSS_URL, { headers: { "User-Agent": UA } })).text();
  const blocks = css.match(/\/\* [a-z-]+ \*\/\s*@font-face\s*\{[^}]+\}/g) || [];
  const latin = blocks.filter((b) => b.startsWith("/* latin */"));
  const byUrl = new Map();
  for (const b of latin) {
    const fam = /font-family: '([^']+)'/.exec(b)[1];
    const weight = /font-weight: ([\d ]+);/.exec(b)[1].trim();
    const url = /url\((\S+?)\) format\('woff2'\)/.exec(b)[1];
    if (!byUrl.has(url)) byUrl.set(url, { fam, weights: [] });
    byUrl.get(url).weights.push(Number(weight));
  }
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  let i = 0;
  for (const [url, { fam, weights }] of byUrl) {
    const buf = Buffer.from(await (await fetch(url, { headers: { "User-Agent": UA } })).arrayBuffer());
    const name = fam.toLowerCase().replace(/\s+/g, "-") + "-" + (weights.length > 1 ? "variable" : weights[0]) + ".woff2";
    fs.writeFileSync(path.join(dir, name), buf);
    console.log(name, buf.length, "bytes", fam, weights.join("/"));
    const w = weights.length > 1 ? Math.min(...weights) + " " + Math.max(...weights) : String(weights[0]);
    lines.push("@font-face{font-family:\"" + fam + "\";font-style:normal;font-weight:" + w +
      ";font-display:swap;src:url(\"fonts/" + name + "\") format(\"woff2\")}");
    i++;
  }
  fs.writeFileSync(path.join(dir, "fonts.css"), lines.join("\n") + "\n");
  console.log("\n--- fonts.css ---\n" + lines.join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
