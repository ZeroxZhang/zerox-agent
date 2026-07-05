# v3.2.1 UI/UX Design System And Settings IA Plan

## Scope

Implement one release feature: `P33-v3.2.1-ui-ux-design-system-settings-ia`.

This iteration upgrades the interface design and interaction consistency without
adding new runtime capability. The work is limited to renderer shell, navigation,
design tokens/CSS, design documentation, tests, release metadata, packaging, and
release notes.

## Workstreams

1. Product design
   - Define v3.2.1 as unified experience system plus Settings governance center.
   - Preserve Chat, Runs, Tasks, Settings as the primary product flow.
   - Define non-goals around cloud execution, hidden automation, and runtime changes.

2. Interaction design
   - Reorder Settings by user intent and operation priority.
   - Group Settings into startup configuration, capability/boundary, and review/quality.
   - Make Settings subpage navigation update the hash and survive refresh.

3. UX design
   - Make trust, permission, recoverability, observability, and reviewed learning visible.
   - Add WCAG 2.2 AA, keyboard, focus, responsive, and no-overflow gates.
   - Normalize copy and icon semantics.

4. Design director integration
   - Publish the unified design-system file.
   - Hold the release until design director and UX expert score at least 95.

## Development Rules

- Read files named by P33 before editing.
- Keep edits scoped to the P33 file list.
- Prefer shared navigation models and CSS tokens over one-off component rules.
- Do not modify `ToolAuthorizationService`, workspace sandbox checks, runtime
  permission policy, storage behavior, or model/provider behavior.
- Use focused tests before broad verification.
- Record command evidence in `.zerox/progress.md`.

## Implementation Order

1. Add P33 feature gate and bump package metadata to 3.2.1.
2. Add Settings navigation groups, priority metadata, and deep-linkable subpage navigation.
3. Apply the unified cool glass Settings shell and panel styling.
4. Add the v3.2.1 UI/UX design-system document.
5. Expand static design tests and navigation tests.
6. Run focused tests.
7. Run full tests, build, verify, production smoke, and harness check.
8. Run design director and UX expert review; iterate until score is at least 95.
9. Package macOS release, smoke packaged build, update progress, mark P33 done,
   push branch/tag, and publish GitHub Release v3.2.1.

## Acceptance

- `npm test -- src/shared/navigation.test.ts src/renderer/materialDesign.test.ts src/shared/packageScripts.test.ts src/shared/readme.test.ts`
- `npm test`
- `npm run build`
- `npm run verify`
- `npm run smoke:prod`
- `npm run harness:check`
- `npm run dist:mac`
- `BUILDING_AGENT_SMOKE_REQUIRED_TEXTS=v3.2.1 npm run smoke:prod:built`
- `git diff --check`
- Design director score >= 95.
- UX expert score >= 95.

