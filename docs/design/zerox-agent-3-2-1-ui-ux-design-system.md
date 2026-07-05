# Zerox Agent v3.2.1 UI/UX Design System

## Design Director Integration

v3.2.1 is the unified experience system and Settings governance iteration.
中文定位：**统一体验系统 + Settings 治理中心**。
The product designer, interaction designer, and UX designer independently
converged on the same direction: do not add new agent capability; make the
existing local-first control plane feel coherent, legible, permissioned, and
recoverable across every visible layer.

Design language / 设计语言: **quiet local glass control plane**. Zerox should feel like a
trusted desktop operations room: cool, calm, precise, observable, and never
cloud-console noisy.

Director shorthand: **安静的本地玻璃控制台** - 冷色、低噪、权限显性、轨迹可查、失败可恢复、学习需审核。

## Product Goals

- Keep Chat as the first work surface.
- Keep Runs as the task record and recovery surface.
- Turn Settings into a governance center for model connection, permissions,
  memory, skills, learning review, eval review, and system health.
- Preserve local-first trust: no cloud workers, no hidden self-modification,
  no bypass around `ToolAuthorizationService` or workspace sandbox checks.
- Make every high-risk path visible, reviewable, and recoverable.

## Information Architecture

Primary navigation remains:

| Surface | Role |
| --- | --- |
| 会话 | Start work, select workspace/skill, create goal drafts, observe active work. |
| 任务记录 | Review run outcome, next action, evidence, recovery, and audit detail. |
| 任务 | Manage scheduled local automation. |
| 设置 | Govern connection, capability, memory, review, evals, and system state. |

Settings is grouped by user intent:

| Group | Sections | Rationale |
| --- | --- | --- |
| 启动配置 | 模型 | First-run setup must make the agent usable before diagnostics. |
| 能力与边界 | 工具, 记忆, 技能 | Capabilities must stay close to permission and context boundaries. |
| 审核与质量 | 学习, 评测, 系统 | Review, regression quality, and system status are governance tasks. |

Default Settings entry is `model-settings`. `system-overview` remains deep
linkable through `#overview` and `#system-overview`.

## Color System / 配色系统

Canonical color source: `src/renderer/styles/tokens.css`.

| Token family | Use |
| --- | --- |
| `--bg-*` | Root, page, raised, inset, accent, danger, success, warning surfaces. |
| `--glass-*` | Shell, Settings, sidebar, panels, muted cards, borders, blur. |
| `--status-*` | Semantic status text, background, and border. |
| `--brand-*` | Zerox identity accents: primary control ink, blue accent, cyan detail. |
| `--focus-ring` | Keyboard-visible focus ring across controls. |

Rules:

- Cool blue/gray surfaces are the baseline.
- Beige, cream, white-block, and yellow-heavy surfaces are not allowed as page
  defaults.
- Warning yellow is reserved for risk, permission, and goal/auto authority.
- Danger red is reserved for delete, terminate, destructive shell/file actions.
- Dark mode must preserve contrast and glass separation without glowing cards.

## Typography

Canonical type source: `--font-sans`, `--font-display`, `--font-mono`.

- Product UI is Chinese-first with short operational labels.
- Display-sized type is reserved for page headers and true empty-state anchors.
- Settings panels use compact headings: `h2` in shell header, `h3` inside panels.
- Technical identifiers, paths, tool names, and commands use `--font-mono`.
- Letter spacing is zero in app surfaces; do not use all-caps decoration.

## Icon System / 图标系统

Primary sources:

- Navigation: `src/shared/materialNavigation.ts`.
- Local controls: `src/renderer/components/Icon.tsx`.

Rules:

- Icon-only controls require `aria-label`.
- Decorative icons are `aria-hidden`.
- Prefer stable local icon names over scattered glyphs.
- Do not introduce new hand-drawn SVGs unless the existing icon system cannot
  represent the command.
- Risk, permission, recovery, evidence, memory write, accept, and reject are
  semantic icon categories; new icons must map to one of these before use.

## VI Standards / VI 规范

- Brand signal: Zerox logo, cool glass surfaces, precise local-control wording.
- Voice: calm, direct, permission-aware, bilingual only where docs need it.
- Product promise: local-first, explicit permissions, observable trajectories,
  recoverable runs, reviewed learning.
- Do not market inside the app. UI copy should name the current state and next
  action, not sell the feature.

## Component Rules

- Settings content panels use glass-muted surfaces and 8px card radius.
- Shell containers may use larger radius only as page framing, not nested cards.
- Each Settings page has one primary action zone, one state message, and
  advanced details behind `<details>`.
- JSON simulators, raw history, kernel events, run graph payloads, runtime paths,
  and low-level diagnostics default to collapsed.
- Empty states must say what is absent and provide a next action when one exists.
- Long text and paths must wrap; table, code, terminal, and JSON can scroll only
  inside their own region.

## Interaction Rules

- Primary action: one per page or task zone.
- Secondary action: safe alternate or navigation action.
- Danger action: destructive, terminating, or irreversible action.
- Safety action: permissions, automatic authorization, goal execution, shell,
  file write, and web fetch use warning semantics unless denied/dangerous.
- Loading/saving status uses `aria-live="polite"` when implemented.
- Errors use `role="alert"` when implemented.
- Dialogs must restore focus and support Escape before release hardening.

## Settings Page Standard

Every Settings section must expose:

- Grouped navigation entry.
- Intent tag.
- Priority tag: 高频路径, 安全路径, or 审查路径.
- Consistent shell header.
- Page-level state band.
- Advanced details collapsed by default.
- No page-level horizontal overflow at 390, 640, 900, 1180, 1280, and 1440 widths.

## Accessibility And Responsive QA

Target: WCAG 2.2 AA.

- Body/control text contrast: 4.5:1.
- Large text: 3:1.
- Focus ring and state border: at least 3:1.
- Keyboard path: sidebar, Settings nav, forms, details, composer, goal draft,
  authorization, Runs tabs, and review queues.
- 200% zoom must keep send, stop, goal confirmation, tool authorization, memory
  accept/reject, and run recovery reachable.

## 95 Point Release Rubric / 95 分发布评分

Release requires a design director and UX expert score of at least 95.

| Area | Points |
| --- | ---: |
| IA and user path clarity | 18 |
| Trust, permission, and recovery clarity | 18 |
| Accessibility and keyboard semantics | 17 |
| Responsive behavior and no overflow | 14 |
| Copy and icon consistency | 12 |
| Visual comfort and design-language unity | 12 |
| QA evidence quality | 9 |

Hard blockers that force a score below 95:

- Permission or data boundary is unclear.
- Any primary Settings, Chat, Runs, or Tasks path has page-level horizontal overflow.
- A key path is not keyboard reachable.
- High-risk action lacks visible risk framing.
- Error state has no recovery path.
- Light or dark mode text becomes unreadable.

## Evidence And Release Gates

Design approval cannot rely on static source checks alone. The v3.2.1 release
must collect evidence in this order:

1. Focused tests for navigation, design-system contracts, package metadata, and README.
2. Full unit suite.
3. Production build.
4. `npm run verify`.
5. Production smoke.
6. Harness check.
7. Multi-viewport Settings QA for 390, 640, 900, 1180, 1280, and 1440 widths.
8. Design director review score >= 95.
9. UX expert review score >= 95.
10. macOS distribution packaging and packaged-app smoke.

Design director target score before final packaging: 96/100, provided the real
rendered app shows no page-level horizontal overflow, Settings navigation stays
deep-linkable, high-risk actions keep visible risk semantics, and the new docs
are committed with the release.
