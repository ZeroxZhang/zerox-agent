# P93 Frontend And Kernel Compatibility Review

## Scope

- Shared Chat and Goal contracts through preload and IPC.
- Kernel-backed Chat and Goal settlement through renderer reconciliation.
- Stream, activity, continuation, restart, and stale-event behavior.
- Desktop and 390 x 844 interaction, focus, navigation, and overflow.

## Confirmed Findings And Repairs

1. Chat terminal events released renderer request ownership before IPC
   settlement. Request ownership now remains until the matching Promise settles.
2. Guided Skill continuations reused a request ID with a reset sequence.
   In-memory continuation sequence now remains monotonic.
3. Guided Skill input was marked completed before execution. Persistence now
   uses `pending -> processing -> completed`, and processing claims recover
   after restart.
4. Same-session transcript refreshes could resolve out of order. A monotonic
   refresh sequence now rejects older snapshots.
5. Streamed failure diagnostics could be followed by a duplicate assistant
   error. Failure settlement now reuses the existing streamed message.
6. Kernel failed and canceled settlement could append duplicate terminal
   activity. Settlement now reuses an already persisted matching terminal.
7. A late Goal event from an older Goal in the same session could update the
   current Goal UI. Progress routing now prefers exact Goal identity.
8. Globally broadcast Goal milestone events were not filtered. Renderer
   routing now requires matching Goal or session identity.
9. Goal details could mix an old Goal with a new summary or remain silently
   stale after IPC failure. Detail state is keyed by Goal ID and exposes a
   retryable load error.
10. Goal pause, retry, review, cancel, and interrupt actions used requested
    action text instead of the canonical returned Goal state. They now project
    the returned state.
11. `waiting_for_model` was missing from final-acceptance result validation.
    It is now accepted and presented as a truthful recoverable state.
12. Blocked Goal actions ignored `stopReason`. Integrity failures expose no
    invalid retry, while impossible Goals require adjustment or termination.
13. Startup loading could overwrite active Chat state and session data. Initial
    results now apply only while the untouched startup context still owns them.
14. Session changes retained composer attachments or Skill selection, and a
    late paste could write into the next session. Session generations now fence
    paste completion and clear session-scoped composer state.
15. Long persisted transcripts opened away from the latest message. Initial
    load now scrolls to the bottom before returning control to user scrolling.
16. Narrow windows lost new-chat and session-switch entry points. Chat now has
    an icon new-chat action and a horizontally scrollable session rail.
17. Narrow non-Chat pages inherited the session rail. The compact rail is now
    scoped to Chat.
18. Stacked dialogs independently handled Escape. A renderer dialog stack now
    grants keyboard ownership only to the topmost modal, prevents underlying
    dialogs from stealing focus during cleanup, and carries the original
    restore target through nested dialog removal.
19. Rename and session menus lacked complete keyboard/focus behavior. Rename
    uses the shared focus trap; menus focus the first item, support arrows and
    Escape, close outside, and restore trigger focus.
20. Rejected App IPC calls could leave pending UI stuck. Update and session
    mutations now recover with visible errors and restored controls.
21. Guided Skill input allowed duplicate submission. A synchronous operation
    token disables fields and submission until the matching response settles.

## Verification

- Focused compatibility gate: 16 files, 527 tests passed.
- Full verify: 273 files, 2,793 tests passed; 6 opt-in stress tests skipped.
- Agent evaluations: 26/26. Memory evaluations: 2/2.
- Runtime stress: all 6 scenarios passed.
- Production smoke passed with JSON fallback.
- Electron-rebuilt SQLite desktop and 390 x 844 smoke passed.
- Node ABI restored; native load and 4 storage files / 70 tests passed.
- Browser interaction verified session selection, new Chat, menu focus,
  arrow navigation, Escape close, and trigger focus restoration.
- Eight visual QA captures had no page-level horizontal overflow; narrow
  Settings had no clipped samples, Chat clipping was confined to its intended
  horizontal session rail, and the compact session menu rendered unclipped.
