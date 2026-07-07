# Zerox Agent v3.2.2 Visual System Migration Plan

Date: 2026-07-07
Phase: 4 / Implementation Plan
Status: approved by latest user instruction to proceed through completion

## Objective

Implement the Phase 3 **Soft Blue Desktop Control Surface** specification as a surface-only visual migration for Zerox Agent v3.2.2.

This plan is binding for implementation. It exists so the code migration remains a design-system migration, not a product or backend rewrite.

## Non-Negotiable Boundaries

- Do not add product features.
- Do not change Agent runtime behavior.
- Do not change tool authorization behavior.
- Do not change workspace sandbox behavior.
- Do not change memory behavior.
- Do not change goal-mode behavior.
- Do not change route structure or information architecture.
- Do not alter output parsing.
- Only change TypeScript when needed for visual class hooks, icon normalization, accessibility semantics, or release metadata.

## Batch 1: Version And Tracking

Files:

- `.zerox/feature_list.json`
- `.zerox/progress.md`
- `package.json`
- `package-lock.json`
- `README.md`

Work:

- Track P34 as the active v3.2.2 design-system migration.
- Bump version metadata to `3.2.2`.
- Update README release references from `3.2.1` to `3.2.2`.

Verification:

- `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts`
- `git diff --check`

## Batch 2: Canonical Tokens

Files:

- `src/renderer/styles/tokens.css`

Work:

- Introduce primitive tokens for blue, neutral, success, warning, danger, cyan, app background.
- Introduce semantic tokens for app background, surfaces, text, borders, focus, actions, status, Agent visual states.
- Introduce component tokens for shell, sidebar, cards, composer, popovers, code/output, dialogs.
- Preserve old token names as compatibility aliases where needed.
- Add dark-mode parity tokens.

Verification:

- `npm test -- src/renderer/materialDesign.test.ts`
- `git diff --check`

## Batch 3: Shell, Sidebar, And Shared Surfaces

Files:

- `src/renderer/styles/base.css`
- `src/renderer/styles/app-shell.css`
- `src/renderer/styles/sidebar.css`
- `src/renderer/styles/cards.css`
- `src/renderer/styles/responsive.css`

Work:

- Move app root to pale-blue environment.
- Restyle main workspace, Settings shell, navigation, cards, buttons, forms, status pills, and shared surfaces to white/blue soft-elevation system.
- Reduce glass blur dependence.
- Preserve current navigation labels, routes, Settings grouping, pinned entries, recents, and responsive behavior.

Verification:

- `npm test -- src/renderer/materialDesign.test.ts`
- Browser screenshot QA for Runs and Settings desktop/narrow states.

## Batch 4: Chat, Composer, Output, Menus, And Drawers

Files:

- `src/renderer/styles/chat.css`
- `src/renderer/styles/composer.css`
- `src/renderer/styles/responsive.css`
- possibly `src/renderer/components/GoalDetailDrawer.tsx`

Work:

- Restyle Chat surfaces, runtime blocks, tool approvals, context cards, code/diff/output blocks, popovers, slash/skill menus, workspace menu, and composer.
- Keep all Chat behavior unchanged.
- Fix tooltip/popover collision risks discovered in Phase 1 where possible through CSS.
- Improve dialog/drawer visual semantics and accessibility only where it does not alter behavior.

Verification:

- `npm test -- src/renderer/materialDesign.test.ts`
- Browser screenshot QA for Chat desktop/narrow states.

## Batch 5: Icon Language

Files:

- `src/renderer/components/Icon.tsx`
- `src/shared/materialNavigation.ts`
- related CSS files

Work:

- Normalize icon visual sizes to the Phase 3 stroke-style grammar.
- Use blue/white active navigation treatments inspired by the Figma reference.
- Do not introduce feature-implying icons.

Verification:

- `npm test -- src/renderer/materialDesign.test.ts src/shared/navigation.test.ts`

## Batch 6: Legacy Quarantine And Magic-Value Sweep

Files:

- `src/renderer/styles/legacy.css`
- all migrated CSS files

Work:

- Map or remove active legacy Material/glass assumptions where migration covers them.
- Keep any remaining legacy rules clearly subordinate to canonical tokens.
- Search and eliminate raw visual hex/rgb/rgba values outside `tokens.css` where practical for migrated v3.2.2 surfaces.

Verification:

- targeted `rg` checks for raw colors in migrated CSS
- `npm test -- src/renderer/materialDesign.test.ts`
- `git diff --check`

## Batch 7: Visual QA And Full Verification

Files:

- `docs/design/zerox-agent-3-2-2-qa/`
- `.zerox/progress.md`

Work:

- Capture screenshots for:
  - Chat desktop `1440x900`
  - Runs desktop `1440x900`
  - Settings desktop `1440x900`
  - Chat narrow `390x844`
  - Settings narrow `390x844`
- Record overflow and console evidence.
- Compare implementation against the Figma-inspired Phase 3 criteria.

Verification:

- `npm test -- src/renderer/materialDesign.test.ts src/shared/packageScripts.test.ts src/shared/readme.test.ts`
- `npm test`
- `npm run build`
- `npm run verify`
- `npm run smoke:prod`
- `npm run harness:check`
- `git diff --check`

## Batch 8: Independent Adversarial Review

Reviewer:

- Independent Principal Design Architect agent requested by the user.

Review scope:

- Faithfulness to Figma-inspired surface style.
- Token architecture quality.
- Desktop usability and density.
- Icon language consistency.
- Accessibility and responsive risks.
- Confirmation that no product/backend/Agent behavior changes were introduced.

Completion:

- Review must return accepted or all blocking findings must be fixed.
- Acceptance evidence must be recorded in `.zerox/progress.md`.

## Completion Criteria

P34 is complete only when:

- All implementation batches are done.
- v3.2.2 metadata is updated.
- Visual QA screenshots and metrics are saved.
- Full verification commands pass.
- Independent Principal Design Architect review accepts the result.
- `.zerox/progress.md` records changed files and evidence.
