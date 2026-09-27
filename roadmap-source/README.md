# Embedded C Roadmap

A browser-local, single-page learning roadmap for Embedded C, from low-level C fundamentals through Cortex-M compilation, linking and startup concepts.

## Teaching labs

- **Compilation Path** follows one small Cortex-M example through preprocessing, compilation, assembly, object generation, linking, ELF creation and final image generation.
- **Linker & Startup** uses one fixed Cortex-M4 memory model to teach `MEMORY`, `SECTIONS`, VMA/LMA, linker-generated symbols, the vector table, `.data` initialization, `.bss` zeroing, startup flow and the relationship between the linker script and reset code.
- **Graph** shows prerequisite, failure-pattern, conceptually-related and explanation-reference relationships from the same canonical topic model.
- **Canonical topic schema** is normalized in `1b_data_topics.js`. Stage files own the teaching content; the registry attaches approach, visual, related-topic and interview metadata directly to each topic and validates IDs during startup.

The labs use curated teaching models and run locally in the browser. No external compiler, backend, CDN or uploaded build artifacts are required for the teaching flow.

## Build

Run:

```sh
bash build.sh
```

This concatenates the HTML/CSS/JS fragments into `embedded-c-roadmap.html`.

## Source layout

| File | Role |
|---|---|
| `01_head.html` | Document head, styles and navigation markup |
| `02_body.html` | Body markup for Roadmap, Dashboard, Mosaic, Practice, Graph, Compilation Path and Linker & Startup |
| `10_data_a.js` – `15_data_f.js` | Roadmap topic data |
| `16_data_interview.js` | Interview/practice data |
| `17_data_faults.js` | Failure-mode teaching data |
| `18_data_clusters.js` | Same-failure-pattern clusters |
| `19_data_diffs.js` | Comparison/difference teaching data |
| `1b_data_topics.js` | Canonical topic schema: stage identity, study approach, visual, conceptual links and interview coverage |
| `20_app.js` | Application state, views, labs, hooks and public API |
| `40_graph.js` | Concept graph renderer |
| `build.sh` | Reproducible concatenation build |
| `embedded-c-roadmap.html` | Generated standalone application |

## Runtime API

The application exposes `window.EmbeddedCRoadmap` once loaded. The public surface includes roadmap data access, graph edges/clusters, completion hooks, interview/fault data and import/export helpers; see the bottom of `20_app.js` for the current API.

## Storage and backup

Progress, notes, bookmarks, interview answers, fault-practice state and the theme setting are stored locally in `localStorage`, namespaced under `ecroadmap.*`. There is no backend.

The top-bar **Export data** control writes one versioned JSON backup containing the complete roadmap state. **Import data** restores that global state on the current device/browser. The backup is intentionally independent of any individual stage or view, so it can be copied between computers or browsers.

The graph is a view over the same canonical topic/edge model. Topic labels are shown on hover/selection so the full 163-topic graph remains readable.
