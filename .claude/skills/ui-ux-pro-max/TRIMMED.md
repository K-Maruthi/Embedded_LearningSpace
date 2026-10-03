# Trimmed install — what was removed and how to restore it

Upstream: `github.com/nextlevelbuilder/ui-ux-pro-max-skill` @ `09170eec` (2026-09-27), MIT.
Installed 2026-10-02 because this app is a **vanilla HTML/CSS single-file build** with no
React, no Tailwind, no shadcn, and its fonts already bundled from `roadmap-source/fonts/`.
Carrying the full upstream skill cost 3.7 MB for content this repo cannot use.

**3.7 MB → 1.1 MB.** Nothing removed was reachable from a UI decision for this project.

## Removed

| Removed | Size | Why |
|---|---|---|
| `data/google-fonts.csv` (1935 families) | 732 KB | The app bundles IBM Plex Sans/Mono + Source Serif 4 already; `typography.csv` keeps all 74 pairings |
| `data/phosphor-icons-upstream.json` | 840 KB | Provenance snapshot for a React icon package this app doesn't use |
| `data/google-font-licenses.json` | 444 KB | Only needed to validate the font catalog above |
| `data/catalog-summary.json` | 4 KB | Rollup of the two catalogs above |
| `data/react-performance.csv` | 16 KB | No React in this project |
| `data/stacks/*.csv` (21 of 22) | 500 KB | Kept only `html-tailwind.csv` — the nearest match to hand-written HTML/CSS |
| `scripts/tests/` | 315 KB | Upstream's own CI for its data, not this project's |

## Code changes made (all in `scripts/`, all commented in place)

- `core.py`: dropped the `react` and `google-fonts` entries from `CSV_CONFIG`, their synonym and
  alias maps, both from `_DOMAIN_TIEBREAK_ORDER`, and reduced `STACK_CONFIG` /
  `STACK_CURRENT_APPLICABILITY` to `html-tailwind`.
- `validate_data.py`: removed `react-performance.csv` from `CORE_PROVENANCE_FILES`, emptied
  `CATALOG_PROVENANCE_FILES` / `CATALOG_PROVENANCE_IDS`, made `_check_catalog_contract` a no-op
  seam, and made `_check_react_contract` return early when the domain is absent.
- `data/data-provenance.json`: dropped the 3 provenance records whose `sourceFile` no longer
  exists (51 → 48 records).
- `SKILL.md`: counts and domain/stack lists corrected so the skill cannot advertise data it
  does not have.

## Not weakened — proof

`python scripts/validate_data.py` passes on the trimmed set
(`OK: validated 10 domain files, 1 stack files, and ui-reasoning.csv`) and still **bites**:

| Mutation | Result |
|---|---|
| Set a palette's `On Primary` equal to its `Primary` | FAILS — `normal-text On Primary/Primary contrast 1.00:1 is below 4.5:1` |
| Delete the required `Focus Appearance` UX rule | FAILS |
| Point a provenance record at a nonexistent `sourceFile` | FAILS |
| Mark the only remaining stack row `deprecated` | FAILS |

The checks that mattered are still wired; only the checks for absent files were removed.

## Restoring anything

- **Font catalog**: re-download `google-fonts.csv` + `google-font-licenses.json` from upstream,
  re-add the `google-fonts` block to `CSV_CONFIG`, restore `CATALOG_PROVENANCE_FILES` /
  `CATALOG_PROVENANCE_IDS` and the `_check_catalog_contract` body (upstream is at
  `github.com/nextlevelbuilder/ui-ux-pro-max-skill` @ `09170eec`). Re-add the provenance records
  too — the validator requires one per file.
- **More stacks**: add the CSV to `data/stacks/`, add a row to `STACK_CONFIG` and
  `STACK_CURRENT_APPLICABILITY`, and add a provenance record with `entityKind:
  "dataset-contract"`.
- **Easiest of all**: re-clone upstream and copy the whole `.claude/skills/ui-ux-pro-max/`
  directory back over this one. The trim only buys disk; it is not load-bearing.
