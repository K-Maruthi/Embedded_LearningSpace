# Embedded Learning Space — Tauri wrapper

This project wraps the supplied `embedded-c-roadmap.html` standalone build in Tauri 2.

## Folder layout

- `src/index.html` — the exact standalone roadmap build packaged by Tauri.
- `src-tauri/` — Tauri desktop application configuration and Rust entry point.
- `roadmap-source/` — source fragments and generated standalone HTML kept for reference/rebuilds.

## Windows development

From this folder:

```bat
npm install
npm run tauri dev
```

## Windows release build

```bat
npm run tauri build
```

Installers will be placed under `src-tauri/target/release/bundle/`.

## Important

The roadmap's notes, progress, bookmarks, quiz/practice state and settings remain local to the desktop app. The existing Export/Import backup controls operate on the complete local learning state.
