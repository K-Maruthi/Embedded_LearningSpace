# Agent skills (project-local)

Installed **into this repo**, not globally, on 2026-10-02. Agents that read `.claude/skills/`
(Claude Code, Freebuff/Codebuff, and most tools following the Agent Skills convention) pick these
up automatically; the rest are readable on demand with the file tools.

Everything here is **decision support**. Nothing here runs at build time, nothing is imported by
`roadmap-source/`, and nothing is part of `npm test`. Deleting this whole directory would not
break the app.

## Start here

| Skill | Use it for |
|---|---|
| **[`roadmap-design-system`](roadmap-design-system/SKILL.md)** | **Read first, always, for this app.** Its real tokens, the +212px breakpoint arithmetic, the checks the build enforces, naming prefixes, verification loop. |
| [`ui-ux-pro-max`](ui-ux-pro-max/SKILL.md) | Searchable decision catalog — styles, product palettes, type pairings, 119 UX/a11y rules, icons, motion, charts. Trimmed; see its [TRIMMED.md](ui-ux-pro-max/TRIMMED.md). |
| [`design-tokens`](design-tokens/SKILL.md) | How to name/layer a *new* token and specify component states. Reference layer under the project skill. |
| [`frontend-design`](frontend-design/SKILL.md) | Aesthetic direction when building something new that should not read as a template. |
| [`web-design-guidelines`](web-design-guidelines/SKILL.md) | Auditing UI code against the current Web Interface Guidelines (fetches fresh rules). |
| [`writing-guidelines`](writing-guidelines/SKILL.md) | Auditing the repo's prose in `features.md`, `problems.md`, `todo.md`, etc. |
| [`webapp-testing`](webapp-testing/SKILL.md) | Optional Playwright scripts for headless browser checks of the built HTML. |

## Running the search tool

`ui-ux-pro-max` ships a real search engine (BM25 over the CSVs) — pure Python 3 stdlib, no pip
install, no network:

```bash
python .claude/skills/ui-ux-pro-max/scripts/search.py "keyboard focus ring" --domain ux
python .claude/skills/ui-ux-pro-max/scripts/search.py "dense instrument panel" --domain style
python .claude/skills/ui-ux-pro-max/scripts/search.py "embedded learning" --design-system -p "Probe"
python .claude/skills/ui-ux-pro-max/scripts/validate_data.py   # data-integrity check
```

Verified working in this environment (Python 3.14.7). Its data-integrity validator passes on the
trimmed set and still fails on a real contrast violation, a deleted required a11y rule, a bogus
provenance source, or a stale stack row — see `ui-ux-pro-max/TRIMMED.md`.

## Requires extra setup

- **`webapp-testing` will not run as installed.** It needs `pip install playwright && playwright
  install chromium`, which was *not* done because it changes your global Python environment.
  This repo's native browser path is the Preview tab plus the headless specs in `specs/`, so treat
  this skill as optional.
- **`web-design-guidelines` and `writing-guidelines` fetch their rule sets over the network** at
  review time (they are thin wrappers around a remote `command.md`). Offline, they are stubs.
- Everything else works offline, as-is.

## Provenance and licenses

| Skill | Source | Pinned at | License |
|---|---|---|---|
| `ui-ux-pro-max` | `github.com/nextlevelbuilder/ui-ux-pro-max-skill` | `09170eec` (2026-09-27) | MIT © Next Level Builder |
| `design-tokens` (references) | same repo, `design-system` skill | `09170eec` | MIT © Next Level Builder |
| `frontend-design` | `github.com/anthropics/skills` | `8a1541c4` (2026-09-28) | see `frontend-design/LICENSE.txt` |
| `webapp-testing` | `github.com/anthropics/skills` | `8a1541c4` | see `webapp-testing/LICENSE.txt` |
| `web-design-guidelines` | `github.com/vercel-labs/agent-skills` | `063bee94` (2026-08-28) | MIT © Vercel, Inc. |
| `writing-guidelines` | `github.com/vercel-labs/agent-skills` | `063bee94` | MIT © Vercel, Inc. |
| `roadmap-design-system` | written for this repo | — | MIT (this repo) |

Upstream trees are kept verbatim except where noted; local edits are marked in-file with a
comment saying so. `ui-ux-pro-max` is the only one substantially modified (data trimmed, code
patched to match, counts corrected) — read its `TRIMMED.md` before trusting a number in it.

## Refreshing

To update a skill, re-clone its upstream, copy the directory over the installed one, then re-apply
any trim noted in `ui-ux-pro-max/TRIMMED.md`. Record the new commit in the table above. Do not
hand-merge upstream into a trimmed copy without re-running that skill's own validator.
