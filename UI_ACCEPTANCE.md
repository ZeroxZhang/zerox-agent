# Zerox Agent 3.3.0 macOS UI Acceptance

Date: 2026-07-08
Scope: pre-release macOS UI and interaction acceptance for the current 3.3.0 frontend polish state.
Verdict: PASS

## Acceptance Summary

The 3.3.0 UI polish is acceptable for macOS UI/interaction release. The four P0 safety and modal-contract issues from `UI_AUDIT.md` are closed in the current implementation, and the updated desktop screenshots show no blocking visual regressions, page-level horizontal overflow, or broken primary shell states across Chat, Runs, Tasks, Model Settings, and Tools Settings.

This is a UI/interaction acceptance pass, not a full product capability, security, or release packaging sign-off.

## Evidence Reviewed

- `UI_AUDIT.md`, including first-round P0/P1/P2 findings and current status notes.
- Current working tree diff for Electron main/window/menu changes, React shell/components, dialog/focus helpers, and CSS.
- Latest screenshots in `docs/design/zerox-agent-3-2-2-qa/*.png`.
- Latest `docs/design/zerox-agent-3-2-2-qa/capture-metrics.json`, regenerated during this acceptance pass.
- Verification commands:
  - `npm test`: passed, 188 test files and 1320 tests.
  - `npm run build`: passed. Vite emitted only the existing large chunk warning.
  - `./node_modules/.bin/electron scripts/capture-visual-qa.mjs`: passed and captured 7 visual QA views.

## P0 Closure

### P0-01 Tool Approval Modal Contract

PASS. `ToolApprovalPanel` is now a blocking `alertdialog` with `aria-modal`, labelled title/description, overlay, focus trap, Escape-to-deny, and initial focus on the safe `拒绝` action.

Evidence:
- `src/renderer/components/AgentChatPanel.tsx` uses `useDialogFocusTrap` for tool approval.
- `src/renderer/components/AgentChatPanel.tsx` renders `role="alertdialog"`, `aria-modal="true"`, and safe action order.
- `src/renderer/styles/composer.css` promotes the approval surface to a centered overlay with scrollable risk details.

### P0-02 Auto-Approval And Goal Mode Risk

PASS. Composer controls now use explicit labels, and enabled high-authority states render persistent risk copy instead of relying only on hidden/tooltip text.

Evidence:
- `自动授权` and `目标模式` are visible labels in the composer.
- `composer-mode-risk-summary` appears when either high-authority mode is enabled.
- The screenshot metrics include the expanded risk explanations in the rendered chat view.

Residual note: the hidden tooltip text still exists as secondary help, which is acceptable because it is no longer the only risk disclosure.

### P0-03 Destructive Confirmation

PASS. Browser-native `window.confirm`/`window.alert` usage for the audited destructive/error paths has been replaced with a shared renderer dialog.

Evidence:
- `src/renderer/components/ConfirmDialog.tsx` provides modal semantics, focus trap, safe default focus, Escape handling, and danger/info variants.
- Session delete/errors in `src/renderer/App.tsx` use `ConfirmDialog`.
- Scheduled task delete in `src/renderer/components/ScheduledTasksPanel.tsx` uses `ConfirmDialog`.
- Memory delete in `src/renderer/components/MemoryPanel.tsx` uses `ConfirmDialog`.

### P0-04 Goal Detail Drawer

PASS. The goal detail drawer now behaves as a formal dialog/sheet with labelled semantics, focus trap, Escape handling, focus return, and guarded backdrop dismissal for review/recoverable states.

Evidence:
- `src/renderer/components/GoalDetailDrawer.tsx` uses `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`, and `useDialogFocusTrap`.
- Backdrop dismissal is disabled when guarded review/recovery actions are visible.

## P1/P2 Acceptance Notes

The completed P1/P2 items are credible for 3.3.0 scope:

- macOS application menu is present with standard App/Edit/View/Window roles and product navigation.
- Window minimum width now allows compact layouts in principle (`minWidth: 640`), and desktop QA views are stable.
- Sidebar, settings, typography, shadow/radius, and icon treatments are calmer and closer to a native productivity app.
- Technical blocks now preserve horizontal scrolling on compact layouts instead of clipping debug output.
- Settings and tasks no longer show obvious card-within-card or glyph placeholder regressions in the captured desktop states.

## Remaining Non-Blocking Items

These should not block the 3.3.0 UI/interaction release, but they should stay visible:

1. P1-02 window chrome is still a custom hidden-inset model with drag strips, and Chat still lacks a stable toolbar/titlebar region. The new app menu reduces release risk, but a full titlebar/toolbar pass remains future work.
2. P1-08 popovers and menus are improved for Escape close, but full arrow-key/typeahead/active-descendant behavior is still incomplete for workspace picker, skill mentions, and row action menus.
3. P1-09 runtime, goal, approval, context, and Runs still do not share one unified execution-state grammar. This is an information-design follow-up, not a blocking regression.
4. P1-11 some controls remain custom rather than fully macOS-semantic, especially switches and numeric settings beyond the updated temperature slider.
5. `05-settings-narrow.png` at 390px still reports clipped samples in `capture-metrics.json` for horizontally scrollable settings navigation. This is acceptable for macOS release because the Electron minimum width is now 640px and the metric does not report page-level horizontal overflow. Future QA should add a 640px minimum-window capture and update `design-qa.md`, which currently overstates that all clipped samples are gone.
6. The palette remains a custom soft-blue system rather than true semantic macOS system colors, and dark-mode contrast was not re-captured in this pass.
7. During acceptance, release metadata had not yet been aligned. Post-acceptance release wrap-up updated package/runtime metadata, README, and release tracking to `3.3.0`.

## Evidence Limits

- This acceptance is based on code inspection, automated tests, build output, regenerated static screenshots, and capture metrics.
- It does not prove full keyboard accessibility for every composite widget because workspace picker, skill mention, and row action menu arrow/typeahead behavior was not interactively exercised.
- It does not validate dark mode, real packaged DMG behavior, notarization, or live background Tray state counts.
- An ad-hoc `electron -e` probe for a 640px settings capture did not return under this Electron CLI invocation and was interrupted; the acceptance therefore relies on source-level `minWidth: 640`, the standard capture script, and the desktop/narrow QA evidence above.

## Final Decision

PASS. No P0/P1 frontend or interaction issue remains that should block the 3.3.0 macOS UI release. The remaining items are polish, accessibility depth, release metadata, or future IA/system-grammar work rather than release blockers.
