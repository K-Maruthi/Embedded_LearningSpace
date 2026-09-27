# Embedded C Roadmap

A browser-local, single-page learning roadmap for Embedded C, from low-level C fundamentals through Cortex-M compilation, linking and startup concepts.

## Teaching labs

- **Compilation Path** follows one small Cortex-M example through preprocessing, compilation, assembly, object generation, linking, ELF creation and final image generation.
- **Linker & Startup** uses one fixed Cortex-M4 memory model to teach `MEMORY`, `SECTIONS`, VMA/LMA, linker-generated symbols, the vector table, `.data` initialization, `.bss` zeroing, startup flow and the relationship between the linker script and reset code.
- **Graph** shows prerequisite, failure-pattern, conceptually-related and explanation-reference relationships from the same canonical topic model.
- **Canonical topic schema** is normalized in `1b_data_topics.js`. Stage files own the teaching content; the registry attaches approach, visual, related-topic and interview metadata directly to each topic and validates IDs during startup.

The labs use curated teaching models and run locally in the browser. No external compiler, backend, CDN or uploaded build artifacts are required for the teaching flow.

## Build

From the repository root:

```sh
npm run build:roadmap
```

This concatenates the HTML/CSS/JS fragments into `embedded-c-roadmap.html`, validates the
result and copies it to `src/index.html` for the Tauri shell. `bash build.sh` is the POSIX
twin: it validates and concatenates but leaves `src/index.html` alone, so a build that way
silently ships the app against the previous copy.

## Styling

All CSS lives in the single `<style>` block in `01_head.html`. The rail is `position:fixed`
and the body carries `padding-left:var(--rail)` (212px), so a `@media (max-width:Npx)` rule
measures the *viewport*, not the content column. Content breakpoints are therefore written
as `intended content width + 212px` — a layout that wants to collapse at a 900px content
column reads `max-width:1112px`. `validate_build.js` rejects any width rule below 812px; the
rail's own 820px rule is the one exception, because it is about the window rather than the
content, and it is only reachable by opening the built HTML in a narrow browser window (the
app will not shrink past its 1050px minimum).

## Source layout

| File | Role |
|---|---|
| `01_head.html` | Document head, the single style block, and the shell: left rail, masthead |
| `02_body.html` | Body markup for all nine views: Roadmap, Dashboard, Mosaic, Graph, Compilation Path, Linker & Startup, Peripherals, Protocols and Practice |
| `10_data_a.js` – `15_data_f.js` | Roadmap topic data |
| `16_data_interview.js` | Interview/practice data |
| `17_data_faults.js` | Failure-mode teaching data |
| `18_data_clusters.js` | Same-failure-pattern clusters |
| `19_data_diffs.js` | Comparison/difference teaching data |
| `1b_data_topics.js` | Canonical topic schema: stage identity, study approach, visual, conceptual links and interview coverage |
| `20_app.js` | Application state, views, labs, hooks and public API |
| `40_graph.js` | Concept graph renderer |
| `build.js` | Reproducible concatenation build (`npm run build:roadmap`); also copies the result to `src/index.html` |
| `build.sh` | POSIX twin: validates and concatenates, but does not refresh `src/index.html` |
| `validate_build.js` | Fragment, syntax, rail/view, content-breakpoint and graph-hook contract checks |
| `embedded-c-roadmap.html` | Generated standalone application |

## Runtime API

The application exposes `window.EmbeddedCRoadmap` once loaded. The public surface includes roadmap data access, graph edges/clusters, completion hooks, interview/fault data and import/export helpers; see the bottom of `20_app.js` for the current API.

## Storage and backup

Progress, notes, bookmarks, interview answers, fault-practice state and the theme setting
are stored locally in `localStorage`, namespaced under `ecroadmap.*`. The labs keep their
own keys (`ecroadmap.bench.v1`, `ecroadmap.lksandbox.v1`, `ecroadmap.periph.v1`,
`ecroadmap.protocols.v1`, `ecroadmap.walk.v1`). There is no backend.

The rail's **Export data** control writes one versioned JSON backup containing the roadmap
state *and* every lab key, so restoring cannot lose a verified stage goal. **Import data**
restores that global state on the current device/browser; a backup carrying lab state reloads
the app rather than refreshing in place, because an open lab's ticker would otherwise write
its stale in-memory copy straight over the import.

The graph is a view over the same canonical topic/edge model. Topic labels are shown on hover/selection so the full 163-topic graph remains readable.
