# Zerox Agent 3.4.0 Obsidian Frontend Iteration Plan

## Design Read

Zerox Agent 3.4.0 is a local-first desktop control plane for professional developers. This iteration treats `docs/design/guidelines_0708.html` as the source of truth and selects `B · 曜石 Obsidian` as the accent system: neutral grayscale surfaces, a near-black primary action in light mode, and the specified light accent inversion in dark mode.

## Scope

- Frontend and interaction updates only.
- Preserve Chat, Runs, Tasks, Settings, Goal Mode, runtime, permissions, workspace sandbox, storage, memory, learning, and eval behavior.
- Prefer the 0708 design specification when it conflicts with the older Soft Blue visual system, as long as product behavior is unchanged.

## Obsidian Translation

- Color: replace Soft Blue app primitives with the 0708 neutral grayscale stack, `#F3F3F3` light base, `#1E1E20` dark base, and `#26262A` light accent.
- Accent: keep accent area under 5 percent of each screen, using it for primary actions, selected navigation, links, and focus rings.
- Layout: align toward macOS three-region structure with a compact 232px sidebar, restrained content surfaces, and 4pt-grid spacing.
- Materials: use glass only for frame-like chrome and popovers. Content cards stay solid with subtle borders and low shadows.
- Typography: keep system font stacks, 13px body baseline, mono only for code, tokens, counts, and paths.
- Motion: use 100-250ms feedback for hover, press, popover, segmented, and theme-adjacent transitions. No decorative animation.
- Accessibility: maintain text contrast, visible `:focus-visible` rings, minimum 28px icon targets, and `prefers-reduced-motion` behavior.

## Development Batches

1. Token migration
   - Rebuild `src/renderer/styles/tokens.css` around Obsidian primitives, semantic aliases, dark-mode inversion, shadows, focus rings, radii, and motion durations.

2. Shell and navigation
   - Update `app-shell.css` and `sidebar.css` for compact macOS geometry, neutral sidebar chrome, Obsidian selected states, and tactile hover/press states.

3. Chat and composer
   - Update `chat.css` and `composer.css` for white/neutral content surfaces, stronger input focus, less blue emphasis, and 0708 button/menu behavior.

4. Secondary surfaces
   - Update `cards.css` and responsive polish so Settings, Tools, Memory, Tasks, Runs, code blocks, tables, cards, badges, and status surfaces inherit the Obsidian tokens.

5. Release metadata and verification
   - Bump package metadata and README to `3.4.0`.
   - Update renderer/package/readme tests and visual QA capture output path.
   - Run focused tests, harness, verify, smoke, visual QA, packaging, packaged smoke, and git checks.

## Acceptance Evidence

- `./init.sh`
- `npm test -- src/renderer/materialDesign.test.ts src/shared/packageScripts.test.ts src/shared/readme.test.ts`
- `npm test`
- `npm run build`
- `npm run verify`
- `npm run smoke:prod`
- `npm run harness:check`
- `ELECTRON_DISABLE_SECURITY_WARNINGS=1 ./node_modules/.bin/electron scripts/capture-visual-qa.mjs`
- `git diff --check`
- `npm run dist:mac`
- Packaged app smoke requiring `v3.4.0`
- Commit and push on `codex/3.4.0`
