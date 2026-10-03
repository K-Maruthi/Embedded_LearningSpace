---
name: design-tokens
description: "Design token architecture for hand-written CSS: primitive to semantic to component layers, CSS custom property systems, spacing/typography scales, and component state specs. Use when adding, naming, reorganizing or auditing design tokens and CSS variables in this repo, or when deciding whether something deserves to be a token. The reference docs are generic; for THIS app's existing tokens and breakpoints read roadmap-design-system first."
license: MIT
metadata:
  author: adapted from claudekit/ui-ux-pro-max-skill
  version: "1.0.0-repo-trim"
---

# Design tokens (references)

Generic guidance on structuring tokens, kept as a reference layer under the project skill.

**Order of reading for this repo:**
1. [`roadmap-design-system`](../roadmap-design-system/SKILL.md) — what this app's tokens *are*,
   and the build constraints any token change must survive. Always read this first.
2. This skill — how to name and layer a *new* token so it fits the existing set.
3. [`ui-ux-pro-max`](../ui-ux-pro-max/SKILL.md) — the searchable catalog (palettes, type
   pairings, styles) for choosing *values* when a genuinely new one is needed.

## When to use

- Adding a colour / space / radius / size token, or deciding whether something should be one.
- Renaming or reorganising an existing token without breaking its call sites.
- Specifying the states and variants of a component (hover, focus, active, disabled, selected).
- Auditing hardcoded values that should have been tokens.

## The three layers

| Layer | Question | Example |
|---|---|---|
| **Primitive** | What raw value is this? | `--grey-900`, `--space-4`, `--radius-3` |
| **Semantic** | What role does it play? | `--ink`, `--rule`, `--accent`, `--surface-2` |
| **Component** | Which component consumes it? | `--btn-bg`, `--rail-w` |

The value of the layers is **renaming without re-styling**: a component reads the semantic name,
so swapping the primitive underneath changes every consumer at once, and a component never needs
a value it doesn't own.

**This app is a deliberate exception and should stay one.** It runs a *flat, single-layer* token
set of 28 custom properties in one `:root` block (`roadmap-source/01_head.html`), with no
primitive palette and no per-component variables. That is a conscious trade: the whole stylesheet
is one hand-written `<style>`, so an indirection layer would cost bytes against the 1500 KB
single-file budget and buy indirection the app does not need. Use these references to reason
about *why* a token is shaped the way it is and when a new one is warranted — not as a mandate to
retrofit the existing set into three layers.

Read on demand:

| Reference | Read it when |
|---|---|
| `references/token-architecture.md` | deciding how many layers a system needs |
| `references/primitive-tokens.md` | naming raw scales (colour steps, spacing, radii) |
| `references/semantic-tokens.md` | mapping intent to a token, theming across modes |
| `references/component-tokens.md` | a component needs its own knobs |
| `references/component-specs.md` | writing the spec for a new component |
| `references/states-and-variants.md` | hover/focus/active/disabled/selected states |

## Rules that survive any layering

- **A token earns its place by being used more than once.** One call site is a local value.
- **Name for role, never for appearance.** `--ink` survives a palette change; `--dark-grey`
  becomes a lie the moment it is used on light text.
- **Every interactive element needs all its states defined**, focus included — a state that is
  only implied by a browser default is a state that will be lost the next time the CSS is edited.
- **Contrast is a property of a *pair*, not a colour.** Check `ink` on `surface`, `accent` on
  `surface-2`, and every state you introduce, in **both** themes. `ui-ux-pro-max`'s `color`
  domain and the WCAG rules in its `ux` domain cover the arithmetic.

## Provenance

References adapted from `claudekit/ui-ux-pro-max-skill` (MIT), `design-system` skill,
`09170eec`. The upstream skill was slide/presentation-oriented; its slide-generation scripts,
slide data and `tailwind-integration.md` were **not** installed — this project has no Tailwind and
no slide tooling. See `../README.md` for the full install manifest.
