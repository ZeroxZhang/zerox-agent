# Zerox Agent macOS UI Audit

Date: 2026-07-08
Branch: `codex/3.3.0`
Scope: macOS Electron/React release polish audit only. No source code or behavior changes were made.

## Executive Summary

Zerox Agent already has the bones of a capable local-first desktop agent: persistent conversation, workspace selection, goal mode, tool approvals, run history, scheduled tasks, memory, learning review, eval review, and a menu-bar resident process. The 3.2.2 redesign also moved the app away from heavy glass and toward a calmer blue control surface.

For a 3.3.0 macOS release, the remaining risk is not feature coverage. The risk is that the interface still behaves like a web dashboard placed inside an Electron window instead of a Mac app. The largest issues are in safety-critical surfaces: tool approval, auto-approval, destructive confirmation, goal review, application menus, window chrome, menu/popover keyboard behavior, and inspectable technical output.

Issue count: P0 = 4, P1 = 16, P2 = 6.

## HIG Baseline Used

Reference pages:

- Apple HIG, Designing for macOS: https://developer.apple.com/design/human-interface-guidelines/designing-for-macos
- Apple HIG, Sidebars: https://developer.apple.com/design/human-interface-guidelines/sidebars
- Apple HIG, Toolbars: https://developer.apple.com/design/human-interface-guidelines/toolbars
- Apple HIG, Menus: https://developer.apple.com/design/human-interface-guidelines/menus
- Apple HIG, Color: https://developer.apple.com/design/human-interface-guidelines/color
- Apple HIG, Typography: https://developer.apple.com/design/human-interface-guidelines/typography
- Apple HIG, Accessibility: https://developer.apple.com/design/human-interface-guidelines/accessibility

Design interpretation for this app:

- A Mac productivity app should use the large display to show more content with fewer nested modal paths, while maintaining comfortable density.
- A sidebar should behave like persistent navigation, with clear current selection and predictable collapse/narrow behavior.
- A toolbar/titlebar should carry common commands and window-level affordances without fighting the traffic-light safe area.
- Menus should expose app commands, state, and shortcuts in familiar macOS locations, not only in a custom UI.
- Color should adapt to appearance and accessibility settings; status cannot depend on color alone.
- Typography should start with the system font stack and preserve readable text sizes, not viewport-scaled marketing type.
- Keyboard access, focus order, modal contracts, and visible state must be first-class, especially around risky actions.

## Existing Design Docs Read

- `docs/design/zerox-agent-3-2-2-design-system-spec.md`
- `docs/design/zerox-agent-3-2-2-audit.md`

Independent judgment for 3.3.0: keep the quiet, operational, light desktop direction, but pull it closer to macOS native patterns and away from dashboard/landing-page styling.

## Technology And Project Map

UI stack:

- Electron main process: `src/main/main.ts`
- Window lifecycle: `src/main/desktopLifecycle.ts`
- Preload bridge: `src/preload/index.ts`
- Renderer: React 19 + Vite
- App shell: `src/renderer/App.tsx`
- CSS entry: `src/renderer/styles.css`
- CSS layers: `legacy.css`, `tokens.css`, `base.css`, `app-shell.css`, `sidebar.css`, `chat.css`, `composer.css`, `cards.css`, `responsive.css`
- Build: `npm run build`
- Dev: `npm run dev`, with Vite at `127.0.0.1:5173`
- macOS package: `npm run pack:mac`, `npm run dist:mac`, backed by `scripts/package-mac.mjs` and `electron-builder.yml`

Release/build entry evidence:

- `package.json` scripts define `dev`, `build`, `verify`, `smoke:prod`, `pack:mac`, and `dist:mac`.
- `scripts/package-mac.mjs` runs build, rebuilds `better-sqlite3`, then calls `electron-builder --mac`.
- `electron-builder.yml` targets macOS `dmg` and `zip`, category `public.app-category.productivity`.

## Interface Inventory

Main window and shell:

- Hidden inset titlebar, fixed 1120x760 default window, 960x640 minimum window.
- Two-column shell with a 280px navigation/sidebar and content workspace.
- Chat view hides the global topbar and uses a full-height conversation workspace.

Primary sidebar:

- Brand mark and product copy.
- New chat button.
- Primary sections: `会话`, `任务记录`, `任务`, `设置`.
- Pinned entries: scheduled tasks and local configuration.
- Recents list with active sessions, archived sessions, token count, goal badges, row menu.
- Footer with app version.

Chat:

- Empty home hero with logo, prompt suggestions, status chips.
- Chat message list and structured output blocks.
- Runtime surfaces: thinking disclosure, tool call preview, goal draft, goal status strip, goal run process, tool approval panel, guided skill input.
- Composer: workspace picker, workspace path, skill mention menu, selected skill chip, text input, auto-approval toggle, goal mode, stop, send.
- Context panel: progress, task activity, memory/context cards, subagent state.
- Goal detail drawer.

Runs:

- Active execution list, run history, selected run summary, retry/resume/pause/stop/open chat actions.
- Timeline, technical details, run graph, trajectory panel, kernel events, eval promotion references.

Scheduled tasks:

- Task cards, enable switch, run/stop/edit/delete actions.
- Create menu.
- Create/edit task dialog with form, schedule generation, advanced JSON input, permission editor, focus trap.

Settings sections:

- Model settings.
- Tools and tool audit.
- Memory, profile, ingestion, raw history, eval, governance, maintenance.
- Skills library.
- Learning review.
- Eval review.
- System overview/readiness/runtime health.

Menus, Tray, system surfaces:

- Tray icon, tooltip, context menu: show app, about, quit.
- About dialog via Electron `dialog.showMessageBox`.
- No explicit app menu template found.

## Findings

### P0-01 Tool Approval Does Not Meet Modal Or Safety Accessibility Contracts

Status: Completed in 3.3.0 UI polish. Tool approval now renders as a blocking `alertdialog` with `aria-modal`, labelled title/description, focus trap, safe default focus on reject, Escape-to-deny, and an overlay surface.

Description: Tool approval is the highest-risk UI in the product, but the visible approval panel is an inline `section` with `role="dialog"` and no `aria-modal`, no `aria-labelledby`, no focus trap, no Escape/cancel contract, and no focus return. It appears inside the runtime stack, so keyboard and screen-reader users may miss the authorization decision or tab past it into unrelated controls.

Location: `src/renderer/components/AgentChatPanel.tsx:2285`, `src/renderer/components/AgentChatPanel.tsx:3178`, `src/renderer/styles/composer.css:507`

Severity: P0

Fix: Promote tool approval to a proper approval surface. Either make it a real modal dialog with focus handoff, trapped Tab, Escape mapped to safe denial, focus return, `aria-labelledby`, and persistent risk copy, or make it an inline non-modal alert region without `role="dialog"` but with immediate focus and `role="alertdialog"` only when it blocks the run. Use the scheduled-task dialog focus pattern as the local implementation reference.

### P0-02 Auto-Approval And Goal Mode Hide Risk In Tiny Tooltip-Only Controls

Status: Completed in 3.3.0 UI polish. The composer now uses clearer labels and shows persistent high-authority mode copy whenever auto-approval or goal mode is enabled.

Description: `自动` and `目标` are powerful mode switches. Their risk explanation lives in hover/focus tooltip text that is also `aria-hidden`. The controls are only 32px high and styled like small chips, while enabling them changes the authority model of the agent.

Location: `src/renderer/components/AgentChatPanel.tsx:194`, `src/renderer/components/AgentChatPanel.tsx:2550`, `src/renderer/styles/composer.css:526`, `src/renderer/styles/composer.css:556`

Severity: P0

Fix: Replace tooltip-only risk with persistent state copy when either mode is enabled. Treat auto-approval like a security state, not a formatting chip: use a named toggle row, warning icon, explicit scope text, and a clear "enabled for this session" summary. Keep title/tooltips only as secondary affordance.

### P0-03 Destructive Actions Use Browser Alert/Confirm Instead Of Mac-Quality Confirmation

Status: Completed in 3.3.0 UI polish. Session, scheduled-task, and memory destructive confirmations now use a shared renderer confirmation dialog with modal semantics and safe default focus; App-level error alerts use the same dialog system.

Description: Session delete, task delete, memory delete, and some error paths use `window.confirm` and `window.alert`. These block the renderer with browser-native sheets that do not match the app's visual system, are hard to style, and do not give the app a consistent destructive-action grammar.

Location: `src/renderer/App.tsx:246`, `src/renderer/App.tsx:270`, `src/renderer/App.tsx:342`, `src/renderer/App.tsx:359`, `src/renderer/components/ScheduledTasksPanel.tsx:392`, `src/renderer/components/MemoryPanel.tsx:271`

Severity: P0

Fix: Introduce one shared confirmation/dialog pattern for destructive actions. On macOS, prefer Electron `dialog.showMessageBox` from main for app-level confirmations or a renderer modal with focus trap and clear default/cancel buttons. Keep destructive buttons on the trailing side and require the safe action to be the default focus.

### P0-04 Goal Detail Drawer Contains Review/Terminate Actions Without Dialog Semantics

Status: Completed in 3.3.0 UI polish. The goal detail drawer now has dialog/sheet semantics, `aria-modal`, labelled heading/description, focus trap, Escape handling, focus return, and safer backdrop dismissal for review/recovery states.

Description: The goal detail drawer includes review gate, replan, retry, and terminate actions. It is rendered as an `aside` inside a backdrop, closes on backdrop click, and lacks `role="dialog"`, `aria-modal`, labelled heading, Escape handling, focus trap, and focus return.

Location: `src/renderer/components/GoalDetailDrawer.tsx:35`, `src/renderer/components/GoalDetailDrawer.tsx:44`, `src/renderer/components/GoalDetailDrawer.tsx:72`

Severity: P0

Fix: Make the goal drawer a formal sheet/dialog. Add labelled heading, focus handoff to the title or first safe action, Escape handling, Tab trap, focus return, and safer dismissal rules when a review/terminate action is visible. If backdrop click remains, do not allow it while unsaved review decisions or recoverable actions are in progress.

### P1-01 macOS Application Menu Is Missing

Status: Completed in 3.3.0 UI polish. The main process now installs a macOS-style application menu with standard App/Edit/View/Window roles, navigation commands, Preferences shortcut, and development-only reload/devtools entries.

Description: The app defines a Tray context menu but no app menu template. On macOS, users expect app, File, Edit, View, Window, and Help menus, with commands like Preferences, New Chat, Show/Hide Sidebar, Reload only in development, Minimize, Zoom, Bring All to Front, and Quit.

Location: `src/main/main.ts:137`, `src/main/main.ts:158`, `src/main/main.ts:313`

Severity: P1

Fix: Add a macOS application menu template in main process. Include standard roles where possible and route product commands through existing IPC/navigation. Keep Tray for background status, not as the only command surface.

### P1-02 Window Chrome And Drag Regions Feel Custom Rather Than Native

Status: Partially addressed in 3.3.0 UI polish. The native window background now matches renderer tokens and app/menu command access is improved; a full cross-view toolbar/titlebar redesign remains intentionally deferred because it would require broader shell restructuring.

Description: The window uses `titleBarStyle: "hiddenInset"` and manual traffic-light positioning, plus a fixed drag strip, a sticky sidebar pseudo-element drag area, and a draggable topbar that disappears in chat. This creates inconsistent drag affordance and leaves the chat view without a clear toolbar/titlebar command area.

Location: `src/main/desktopLifecycle.ts:5`, `src/main/desktopLifecycle.ts:11`, `src/renderer/styles/app-shell.css:11`, `src/renderer/styles/app-shell.css:43`, `src/renderer/styles/sidebar.css:22`

Severity: P1

Fix: Define one titlebar/toolbar model. Keep a traffic-light safe area, but use a stable app toolbar region across chat and non-chat views. Avoid multiple overlapping drag regions. Expose window-level commands in a toolbar or menu instead of relying on hidden custom strips.

### P1-03 Sidebar Is A Web Dashboard Rail More Than A Mac Sidebar

Status: Completed for 3.3.0 UI polish. The sidebar width, active selection, icon emphasis, grouping copy, compact breakpoint behavior, and Mac-window minimum width were tightened toward a calmer native navigation sidebar.

Description: The sidebar is fixed at 280px, uses a custom active icon pill, embeds Pinned/Recents sections, and becomes a top navigation block below 900px. In the actual Electron window the min width is 960px, so the narrow state is mostly unreachable. Recents disappear entirely at smaller widths.

Location: `src/renderer/App.tsx:383`, `src/renderer/App.tsx:435`, `src/renderer/styles/sidebar.css:1`, `src/renderer/styles/sidebar.css:116`, `src/renderer/styles/responsive.css:25`, `src/main/desktopLifecycle.ts:7`

Severity: P1

Fix: Recast the left column as a Mac-style sidebar: persistent selection rows, restrained hover, clear grouping, optional collapsible recents, and width behavior that matches the window minimum. If narrow layouts are supported, lower the Electron min width or remove unreachable responsive rules.

### P1-04 Settings Buries Trust Surfaces Behind A Nested Navigation Model

Status: Partially addressed in 3.3.0 UI polish. The settings navigation and panels were visually flattened, static intent/priority pills were reduced, and narrow settings navigation is now compact and horizontally scrollable; promoting trust surfaces out of Settings remains a future information-architecture change.

Description: Tools, memory, learning, evals, and system overview are all under Settings even though they are product-defining control-plane surfaces. The settings shell also has a sidebar inside the main sidebar, with intent pills and nested cards, increasing visual load.

Location: `src/shared/navigation.ts:100`, `src/shared/navigation.ts:159`, `src/renderer/App.tsx:601`, `src/renderer/App.tsx:652`, `src/renderer/styles/app-shell.css:97`

Severity: P1

Fix: Keep the 3.3.0 navigation model if behavior cannot change, but visually reduce nested chrome. Treat Tools, Memory, Learning, and Evals as governance panels with a flatter segmented/sidebar treatment. For a later IA pass, consider promoting trust surfaces out of Settings.

### P1-05 Typography Is Not Native Enough For A Long-Running Mac App

Status: Completed in 3.3.0 UI polish. The app font stack now prioritizes Apple system fonts, empty-state hero type was reduced, and compact breakpoints use tokenized utility sizing rather than viewport-scale display typography.

Description: The font stack prioritizes Inter before SF Pro, and the chat empty state uses viewport-scaled hero type. Utility panels also mix raw sizes such as `15px`, `11px`, and `2rem` with token sizes. This makes the product feel closer to a web app than Notes/Mail/Finder/Things.

Location: `src/renderer/styles/tokens.css:174`, `src/renderer/styles/base.css:9`, `src/renderer/styles/chat.css:172`, `src/renderer/styles/composer.css:283`, `src/renderer/styles/responsive.css:90`

Severity: P1

Fix: Put `-apple-system`, `BlinkMacSystemFont`, and SF Pro before Inter, or drop Inter for app UI. Replace viewport-scaled hero typography with tokenized macOS utility sizes. Reserve larger display type for true onboarding, not the default chat workspace.

### P1-06 Color System Is Pleasant But Too Custom And Too Blue-Dominant

Status: Partially addressed in 3.3.0 UI polish. BrowserWindow background now matches the renderer root, active navigation and settings surfaces use softer neutral treatment, and shadows/radii were reduced; a full semantic system-color and dark-mode contrast pass remains a larger follow-up.

Description: The palette is a soft blue dashboard system with custom tokens. The BrowserWindow background is cream (`#f5f1ea`) while app tokens are pale blue/white. Dark mode has many token overrides, but the system does not use platform semantic colors and still depends heavily on blue surfaces, blue shadows, and blue active states.

Location: `src/main/desktopLifecycle.ts:10`, `src/renderer/styles/tokens.css:1`, `src/renderer/styles/tokens.css:21`, `src/renderer/styles/tokens.css:232`, `src/renderer/styles/tokens.css:258`

Severity: P1

Fix: Align the native window background with renderer tokens. Reduce large blue-tinted surfaces in favor of neutral system-like backgrounds, using blue as accent and selection. Audit dark mode from actual rendered screens and map status colors to semantic foreground/background pairs with contrast checks.

### P1-07 Legacy CSS Still Competes With The New System

Status: Partially addressed in 3.3.0 UI polish. `legacy.css` is now explicitly marked as an override quarantine, with new UI work directed to the current token/component CSS files; deleting or fully scoping legacy rules remains deferred to avoid a broad visual regression.

Description: `styles.css` imports `legacy.css` before new token and component CSS. `legacy.css` still contains old app shell, sidebar, navigation rail, focus, topbar, and typography rules. Later files override many rules, but the source of truth remains ambiguous.

Location: `src/renderer/styles.css:1`, `src/renderer/styles/legacy.css:44`, `src/renderer/styles/legacy.css:123`, `src/renderer/styles/sidebar.css:1`

Severity: P1

Fix: Do not do a big rewrite for 3.3.0. Instead, quarantine legacy selectors with comments and a deletion checklist. Move any still-needed structural rules into current files, then make `legacy.css` inert or scoped to explicitly named holdovers.

### P1-08 Popovers And Menus Lack Full Keyboard Menu Behavior

Status: Partially addressed in 3.3.0 UI polish. Escape-close behavior was added for the workspace picker and skill mention menu, and modal focus handling was centralized for dialog-like surfaces. Full arrow-key/typeahead/active-descendant behavior remains a later composite-widget pass.

Description: Sidebar row menus, workspace menu, and skill mention menu use menu/listbox roles but do not implement full keyboard contracts such as arrow navigation, active descendant, Escape close, typeahead, focus return, and outside-click/focus dismissal consistency. The workspace `role="menu"` also contains a search input, which is not a simple menu pattern.

Location: `src/renderer/App.tsx:740`, `src/renderer/App.tsx:754`, `src/renderer/components/AgentChatPanel.tsx:2317`, `src/renderer/components/AgentChatPanel.tsx:2335`, `src/renderer/components/AgentChatPanel.tsx:2473`

Severity: P1

Fix: Pick patterns per component: workspace picker should be a combobox/popover, skill mention should be a combobox/listbox with active option, row actions can be a menu button. Implement Escape, arrow keys, focus return, and selection announcements consistently.

### P1-09 Runtime, Goal, Approval, And Run History Need One State Grammar

Status: Not completed in 3.3.0 UI polish. This requires a shared runtime/state grammar across chat, context rail, and Runs; it is documented here but intentionally not refactored in the surface-polish pass.

Description: The app has many state surfaces: thinking disclosure, tool preview, goal draft, goal status strip, goal process, tool approval panel, context activity card, run history, kernel events. Each is locally useful, but together they read as separate widgets instead of one execution timeline language.

Location: `src/renderer/components/AgentChatPanel.tsx:2177`, `src/renderer/components/AgentChatPanel.tsx:2230`, `src/renderer/components/AgentChatPanel.tsx:3091`, `src/renderer/components/RunsPanel.tsx:43`

Severity: P1

Fix: Define a single visual grammar for agent execution: queued, thinking, tool proposed, awaiting approval, running, evidence, review gate, paused, failed, recovered, completed. Use the same status icon, color, row density, timestamp, and action placement in chat, context panel, and Runs.

### P1-10 Technical Output Can Become Uninspectable On Narrow Layouts

Status: Completed in 3.3.0 UI polish. Technical blocks, tables, command output, and JSON previews now preserve horizontal scrolling at narrow widths instead of clipping important debug content.

Description: At small widths, tables, code blocks, command output, and JSON previews set `overflow-x: hidden`. This prevents page overflow, but it can hide paths, command output, diffs, and JSON keys that users need for debugging and trust.

Location: `src/renderer/styles/responsive.css:171`

Severity: P1

Fix: Use horizontal scrolling inside technical blocks instead of clipping. Add visible scroll affordance, copy button, and wrap mode where appropriate. For command output and diffs, prioritize inspectability over visual tidiness.

### P1-11 Controls Do Not Consistently Match macOS Control Semantics

Status: Partially addressed in 3.3.0 UI polish. The bounded temperature setting now uses a slider with a visible value, while additional switch/stepper normalization remains a follow-up because it touches several form surfaces.

Description: Numeric settings use text/number fields where steppers or sliders would be easier to scan. The scheduled-task enabled control is a custom button switch with no visible text. Some risky toggles are hidden checkboxes styled as labels.

Location: `src/renderer/components/ModelSettingsPanel.tsx:238`, `src/renderer/components/ModelSettingsPanel.tsx:260`, `src/renderer/components/ScheduledTasksPanel.tsx:540`, `src/renderer/components/AgentChatPanel.tsx:2551`, `src/renderer/styles/composer.css:590`

Severity: P1

Fix: Use conventional control forms: sliders or steppers for bounded numeric values, native-looking switches with visible state text for enable/disable, checkboxes for binary options in forms, and buttons only for commands.

### P1-12 Window Minimum Size Conflicts With Responsive Rules

Status: Completed in 3.3.0 UI polish. The Electron minimum width now allows compact layouts, and the compact settings/chat screenshots were revalidated with no horizontal overflow.

Description: The Electron window has `minWidth: 960`, but responsive rules start at 900px and 640px. Those layouts are useful for web preview screenshots, but a macOS user cannot reach them through normal window resizing.

Location: `src/main/desktopLifecycle.ts:7`, `src/renderer/styles/responsive.css:15`, `src/renderer/styles/responsive.css:64`

Severity: P1

Fix: Decide the real supported minimum Mac width. If it is 960px, remove or downgrade unreachable narrow styles from release criteria. If compact windows matter, reduce the minimum width and test the sidebar, composer, dialogs, and output blocks at that size.

### P1-13 Chat Empty State Feels Like A Landing Page

Status: Completed in 3.3.0 UI polish. The chat empty state is more compact across desktop and narrow layouts, with reduced hero scale and tighter spacing while preserving suggestions and readiness chips.

Description: The empty chat uses a centered logo, large responsive hero title, descriptive copy, and suggestion buttons. It is polished, but for a daily desktop tool it reads more like a landing/onboarding surface than a working command window.

Location: `src/renderer/components/AgentChatPanel.tsx:2164`, `src/renderer/styles/chat.css:154`, `src/renderer/styles/chat.css:172`

Severity: P1

Fix: Make the first screen a compact command workspace: keep suggestions, but reduce hero scale, bring recents/workspace/model readiness closer to the composer, and avoid marketing-scale typography after first launch.

### P1-14 Settings And Overview Use Card-Within-Card Density

Status: Completed in 3.3.0 UI polish. Settings, tools, memory, task, and overview panels now use flatter borders, smaller radius, and fewer shadows; compact settings navigation was converted to a horizontal control strip.

Description: Settings body, panel cards, action bands, readiness cards, runtime cards, and inner rows all use white surfaces, borders, radii, and shadows. The repeated chrome makes settings feel heavier than Apple utility panels.

Location: `src/renderer/styles/app-shell.css:247`, `src/renderer/styles/cards.css:47`, `src/renderer/styles/cards.css:52`, `src/renderer/styles/cards.css:154`

Severity: P1

Fix: Flatten one layer. Use full-width grouped sections with separators for settings forms, reserve cards for repeated items, and reduce shadows inside settings. Keep density calm and scannable.

### P1-15 Focus Styling Exists But Is Not Systematic Across Composite Widgets

Status: Partially addressed in 3.3.0 UI polish. A shared `useDialogFocusTrap` helper now supports tool approval, destructive confirmations, and goal detail drawer focus return/Escape behavior. Non-modal popovers still need a dedicated keyboard-navigation pass.

Description: Base focus styles are present, and the scheduled-task dialog has a focus loop. The same rigor is not applied to GoalDetailDrawer, ToolApprovalPanel, sidebar menus, workspace picker, and skill listbox.

Location: `src/renderer/styles/base.css:37`, `src/renderer/components/ScheduledTasksPanel.tsx:121`, `src/renderer/components/GoalDetailDrawer.tsx:35`, `src/renderer/components/AgentChatPanel.tsx:3178`

Severity: P1

Fix: Extract a shared focus-management helper or pattern for modal/popover surfaces. Add manual keyboard QA for Tab, Shift+Tab, Escape, Enter, Space, arrow keys, and focus return.

### P1-16 Tray Is Present, But Menu Bar And Background State Are Under-communicated

Status: Partially addressed in 3.3.0 UI polish. The application menu is now present, and the Tray menu exposes background status plus quick links to Runs, Scheduled Tasks, and Settings. Live active-run/pending-approval counts remain deferred because that requires stateful tray updates.

Description: The Tray menu exposes show, about, and quit. It does not expose running tasks, paused approvals, recent failures, or quick access to Runs/Tasks/Settings. Because the app can run at login and hide on close, background state needs clearer macOS affordance.

Location: `src/main/main.ts:137`, `src/main/main.ts:155`, `src/main/main.ts:158`, `src/main/desktopLifecycle.ts:16`

Severity: P1

Fix: Keep the Tray menu short, but add stateful entries for active run count or pending approval when available. Pair this with a proper app menu. Avoid overloading Tray as the only command center.

### P2-01 Brand, App Icon, Navigation Icons, And Control Icons Are Not Unified

Status: Partially addressed in 3.3.0 UI polish. Navigation and control icons now use a softer shared stroke treatment in more places, with additional glyph replacements added in chat context and scheduled-task creation menus. Full brand/icon-system unification remains a future visual identity pass.

Description: Brand assets use cream, black, and cyan, while the app UI is pale blue with navy accents. Navigation uses `materialNavigation` paths, controls use a separate custom `Icon` path set, and some UI uses glyphs. The result is coherent enough, but not Apple-level unified.

Location: `build/icon.svg:4`, `build/zerox-logo.svg:4`, `src/shared/materialNavigation.ts:11`, `src/renderer/components/Icon.tsx:18`

Severity: P2

Fix: Define one icon grammar. For macOS, prefer SF-symbol-like stroke weight, sizes, and filled/outline state rules. Bring the cyan brand accent into a limited set of product identity moments or remove it from the icon.

### P2-02 Mixed Language And Placeholder Copy Reduce Polish

Status: Partially addressed in 3.3.0 UI polish. Primary sidebar labels, goal detail, scheduled-task naming, and high-authority composer labels now use clearer Chinese copy. Historical short metrics such as `tok` remain unchanged for now.

Description: UI copy mixes Chinese with English labels such as `Pinned`, `Recents`, `Goal detail`, `tok`, and module names like `第 4 模块`. This is small, but it is visible in first-run and navigation surfaces.

Location: `src/renderer/App.tsx:436`, `src/renderer/App.tsx:447`, `src/renderer/App.tsx:918`, `src/renderer/components/GoalDetailDrawer.tsx:51`, `src/shared/navigation.ts:79`

Severity: P2

Fix: Decide the release language. For a Chinese UI, use `固定入口`, `最近会话`, `目标详情`, `token` or `令牌` consistently, and replace internal module labels with user-facing names.

### P2-03 Decorative Glyphs And Symbols Feel Unfinished

Status: Completed in 3.3.0 UI polish for the audited glyphs. Context panel and scheduled-task create-menu glyphs were replaced with the shared icon component.

Description: Context panel items and create menu actions use glyphs like `◷`, `◎`, `□`, `✎`, and `▰`. These are fast and readable during development, but they do not match a refined macOS app.

Location: `src/renderer/components/AgentChatPanel.tsx:3024`, `src/renderer/components/AgentChatPanel.tsx:3032`, `src/renderer/components/AgentChatPanel.tsx:3040`, `src/renderer/components/ScheduledTasksPanel.tsx:656`

Severity: P2

Fix: Replace glyphs with the same icon component used elsewhere, after the icon grammar is unified. Use labels and status tokens, not decorative symbols, to carry meaning.

### P2-04 Shadows And Radius Are Softer Than Typical Mac Utility UI

Status: Completed in 3.3.0 UI polish. Default panel radii and shadow elevations were reduced, and dense settings/control surfaces now rely more on separators and contrast than floating blue shadows.

Description: The token system uses 12 to 18px radii and blue-tinted shadows up to 46px. This is friendly, but it leans web-dashboard and makes dense operational panels feel padded and floaty.

Location: `src/renderer/styles/tokens.css:157`, `src/renderer/styles/tokens.css:220`, `src/renderer/styles/tokens.css:232`

Severity: P2

Fix: Reduce default panel radius toward 8 to 10px for utility surfaces. Keep larger radius for popovers/dialogs only where it matches the app's style. Lower shadow elevation and rely more on separators and material contrast.

### P2-05 Status Pills Are Overused

Status: Partially addressed in 3.3.0 UI polish. Static settings intent/priority pills are now plain text on desktop and hidden in compact navigation; live status pills remain where they communicate changing state.

Description: Status pills appear in the topbar, settings nav, settings body, task cards, audit rows, and chat surfaces. They help scanning, but too many small colored capsules make the UI busier and less native.

Location: `src/renderer/App.tsx:550`, `src/renderer/App.tsx:641`, `src/renderer/styles/app-shell.css:211`, `src/renderer/components/ScheduledTasksPanel.tsx:529`

Severity: P2

Fix: Reserve pills for state that changes or requires attention. Use plain secondary text for static category labels like intent/priority. Keep color plus text for warnings, errors, and live execution.

### P2-06 Release Metadata And UI Versioning Need A Final Pass

Status: Completed in 3.3.0 release wrap-up. Version metadata is aligned to 3.3.0 in `package.json`, `package-lock.json`, README, and release tracking; packaging and GitHub Release evidence are recorded in `.zerox/progress.md`.

Description: The branch is `codex/3.3.0`, and package/runtime version metadata now reports `3.3.0`. The UI footer reads from runtime version, so sidebar/About/package metadata stay aligned after the release wrap-up.

Location: `package.json:3`, `src/renderer/App.tsx:528`

Severity: P2

Fix: Before release, align package/runtime version with the intended 3.3.0 version and verify the sidebar footer, About dialog, and packaged app metadata show the same value.

## Implementation Order

### P0 First

1. Fix ToolApprovalPanel modal/focus/ARIA contract.
2. Redesign auto-approval and goal-mode risk presentation.
3. Replace browser `alert`/`confirm` with one shared confirmation pattern.
4. Fix GoalDetailDrawer dialog/sheet contract.

### P1 Next

1. Add macOS application menu.
2. Stabilize window chrome and toolbar/drag model.
3. Decide real minimum window width and align responsive rules.
4. Tighten sidebar into a Mac-style navigation sidebar.
5. Flatten settings and reduce nested card chrome.
6. Normalize popover/menu keyboard behavior.
7. Create one runtime/goal/approval state grammar.
8. Restore inspectable overflow for code, tables, JSON, and command output.
9. Move typography toward system fonts and tokenized utility sizes.
10. Reduce custom blue dominance and verify dark mode.
11. Quarantine `legacy.css`.
12. Improve controls, focus patterns, and Tray state.

### P2 Last

1. Unify icon and brand language.
2. Polish mixed-language copy.
3. Replace decorative glyphs.
4. Reduce radius/shadow softness in dense panels.
5. Reduce status pill overuse.
6. Align versioning and release metadata.

## Verification And Inspection Commands Run

- `git status --short --branch`
- `rg --files -g 'package.json' -g 'pnpm-lock.yaml' -g 'yarn.lock' -g 'package-lock.json' -g 'bun.lockb' -g 'vite.config.*' -g 'electron*' -g 'forge.config.*' -g 'electron-builder.*' -g 'src/**' -g 'docs/design/**'`
- `find . -maxdepth 3 -type f \( -name 'README*' -o -name 'DESIGN*' -o -name '*.md' \) -print`
- `sed` and `nl -ba` inspections of Electron, React, CSS, and design-doc files cited above.
- `rg -n "role=|aria-|dialog|popover|drawer|alert|status|tooltip|menu|window\.alert|confirm|Escape" src/renderer src/main src/shared`
- `rg -n "#[0-9A-Fa-f]{3,8}|rgba\(|rgb\(" src/renderer/styles src/renderer/components`
- `rg -n "window\.confirm|window\.alert|dialog\.showMessageBox|Menu\.buildFromTemplate|Tray|setApplicationMenu|role=\"dialog\"|aria-modal" src/main src/renderer`
- `npm test -- src/renderer/materialDesign.test.ts`

## Notes On Repository State

Pre-existing working tree changes were observed and not touched:

- Modified: `docs/design/zerox-agent-3-2-2-qa/capture-metrics.json`
- Untracked: `.zerox/product-design-audit-2026-07-05/`

This audit intentionally created only this review document.
