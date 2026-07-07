# Zerox Agent v3.2.2 Visual Style Direction

Date: 2026-07-06
Phase: 2 / Corrected Direction Proposal
Status: confirmed; superseded by Phase 3 specification for implementation decisions

## Scope Correction

This phase is not a product redesign.

The user clarified that the supplied Figma reference should guide the visual style, design language, element treatment, icons, layout feel, and design-system iteration. The work must stay on the visible surface layer.

### In Scope

- Color language
- Surface system
- Radius, border, shadow, and elevation behavior
- Typography tone and density
- Icon style
- Layout rhythm and spacing rules
- Component styling direction
- Motion temperament
- Token architecture direction for visual implementation
- Future dark-mode readiness

### Out Of Scope

- No new product features
- No backend or Agent capability changes
- No new information architecture
- No route or navigation model changes
- No new workflow semantics
- No change to permission, sandbox, memory, tool authorization, or goal behavior
- No change to existing product copy beyond visual fit and truncation rules

The implementation phase must restyle existing surfaces and components. If a structure change is needed only to remove hard-coded styling or apply tokens safely, it must be documented as a visual-system migration, not a product behavior change.

## Source Reference

Reference file inspected during Phase 1:

![Figma dashboard reference](zerox-agent-3-2-2-audit/figma-reference-dashboard.png)

Reference character:

- Pale blue application environment
- Large white rounded workspace surface
- Floating blue vertical icon rail
- White metric cards with soft shadow
- Strong black text paired with bright blue accents
- Simple progress bars and light chart grid
- Minimal top navigation
- Friendly, clean, dashboard-like spacing
- Rounded but not childish
- Calm, low-noise, approachable desktop UI

The reference is not being copied as a product layout. It is being translated into Zerox's current desktop app surfaces.

## Direction Name

**Soft Blue Desktop Control Surface**

Chinese shorthand: **柔和浅蓝桌面控制面**

This direction keeps Zerox's existing local-first Agent product intact, but changes the visible skin from the current cool glass/control-room aesthetic into a lighter, softer, more dashboard-like desktop surface inspired by the Figma reference.

## Design Language

Zerox should feel like a clean desktop dashboard embedded in a calm blue workspace: light, rounded, approachable, and organized. The UI should look deliberately designed, not like raw admin tooling, but it must remain efficient enough for a desktop Agent app.

Principles:

- **Light environment first**: the base app should read as pale blue, not gray glass.
- **White work surfaces**: main content, cards, popovers, and composer use white or near-white panels.
- **Blue as navigation and active-state language**: blue is the main brand/action color, especially for selected navigation, progress, active states, and primary actions.
- **Soft elevation over hard outlines**: use shadow and gentle borders together; avoid heavy strokes.
- **Dashboard order, Agent content**: borrow the reference's clean card/chart discipline, but apply it to existing Chat, Runs, Settings, composer, approvals, and tool-output surfaces.
- **Friendly but not mobile**: rounded and airy, while preserving desktop density and keyboard-first workflows.

## Color Direction

The palette should move closer to the Figma reference while keeping enough semantic range for Agent safety states.

### Core Palette

| Role | Value | Use |
| --- | --- | --- |
| App background | `#EAF4FC` | Root desktop environment, sidebar outer area |
| App background raised | `#F4F9FE` | Softer page gradients or top-level bands |
| Main surface | `#FFFFFF` | Primary content panels, composer, cards |
| Surface muted | `#F8FBFF` | Secondary sections, inset controls |
| Blue primary | `#166BB7` | Main navigation rail, primary buttons, active icons |
| Blue active | `#1C73C9` | Selected states, progress lines |
| Blue soft | `#D9ECFA` | Selected backgrounds, progress tracks |
| Blue pale | `#EEF7FF` | Hover/tinted surfaces |
| Text primary | `#101828` | Main headings and body |
| Text secondary | `#475467` | Labels, descriptions |
| Text muted | `#98A2B3` | Hints, timestamps, disabled metadata |
| Border subtle | `#D7E4EF` | Card outlines, field borders |
| Border strong | `#B7CDE0` | Focused or selected boundaries |

### Semantic Accents

| Role | Value | Use |
| --- | --- | --- |
| Success | `#2E9E6F` | Completed runs, allowed permissions, valid config |
| Success soft | `#E8F7EF` | Success badges and quiet backgrounds |
| Warning | `#D9911B` | Goal/auto authority, tool approval, risky state |
| Warning soft | `#FFF4D8` | Warning badges and approval surfaces |
| Danger | `#C94848` | Denied, failed, destructive, stop |
| Danger soft | `#FCEBEC` | Danger backgrounds |
| Info cyan | `#2AB8C5` | Live/streaming detail only, not general decoration |

Color rules:

- Page backgrounds should not use beige, cream, dark slate, or purple gradients.
- Primary blue should dominate navigation and action affordances.
- Warning yellow stays reserved for risk and authorization.
- Cyan is a small detail accent for live Agent activity, never the main theme.
- Shadows may carry a blue tint, but should not look glowing.

## Surface And Elevation

The reference uses a large white container floating over pale blue. Zerox should adapt that as a layered desktop shell rather than a literal centered landing-card.

### Surface Levels

| Level | Treatment | Typical Use |
| --- | --- | --- |
| `L0` App canvas | `#EAF4FC`, no border | Window background |
| `L1` Primary workspace | `#FFFFFF`, `1px #D7E4EF`, soft blue shadow | Main Chat/Runs/Settings canvas |
| `L2` Section surface | `#FFFFFF`, `1px #D7E4EF`, lower shadow | Settings sections, Runs panels, composer |
| `L3` Inset surface | `#F8FBFF`, `1px #D7E4EF` | Inputs, code containers, filters |
| `L4` Floating surface | `#FFFFFF`, stronger soft shadow | Popovers, menus, dropdowns |

### Radius

| Element | Radius |
| --- | ---: |
| App-level workspace shell | `18px` |
| Large panels and composer | `14px` |
| Cards and popovers | `12px` |
| Inputs, buttons, chips | `10px` |
| Icon buttons | `10px` or circle when icon-only |
| Small badges | `999px` only for status pills |

The Figma reference uses generous rounding. Zerox can become softer, but it should avoid turning every control into a pill.

### Shadow

Use blue-tinted shadows inspired by the reference:

- Low: `0 8px 20px rgba(22, 107, 183, 0.08)`
- Medium: `0 14px 34px rgba(22, 107, 183, 0.12)`
- Floating: `0 18px 46px rgba(22, 107, 183, 0.16)`

Rules:

- No black-heavy shadows.
- No glass blur as the main effect.
- Borders and shadows should work together; neither should be visually loud.

## Layout Framework

This is a surface/layout styling direction, not an IA change.

### App Shell

The visual shell should move toward the reference:

- Pale blue root background fills the window.
- Main app area reads as a large white rounded workspace.
- Navigation can become visually closer to a blue rail plus white content area.
- Current routes remain: Chat, Runs, Tasks, Settings.
- Current Settings grouping remains unless a later explicit product decision changes it.

### Sidebar

Reference translation:

- Use a stronger blue treatment for active navigation.
- Icons should feel like white/light symbols inside blue selected affordances.
- Keep Zerox's existing labels and recents; do not replace them with a dashboard-only icon rail unless implementation can do so without changing navigation behavior.

Visual recommendation:

- Sidebar background: pale blue or very light blue.
- Active item: white card or blue filled item depending on density context.
- Primary new-chat action: blue filled button with white text/icon.
- Pinned/recents: keep low-contrast text, improve separation with spacing and subtle dividers instead of extra cards.

### Main Content

Reference translation:

- Use one large, clear white working surface.
- Use cards as repeated objects, not as nested page sections.
- Keep generous top breathing room without oversized hero text.
- Align content on a strong grid.

Suggested desktop spacing:

- Outer app inset: `16px`
- Sidebar width: keep existing behavior unless implementation reveals a visual need; target `260px` to `280px`
- Main content max-width: no artificial centered card for desktop; fill available content area
- Section gap: `20px`
- Card gap: `16px`
- Dense list row height: `52px` to `64px`
- Form row gap: `14px`

### Responsive

The visual style should remain light and soft at narrow widths, but Phase 4 should not invent a mobile product.

Rules:

- Preserve existing responsive route behavior.
- Avoid hiding safety-critical state purely for aesthetics.
- Popovers and tooltips must stay inside viewport.
- Composer text and buttons must not collide at 390px.

## Component Style

### Cards

Inspired by the Figma metric cards:

- White fill
- `12px` radius
- `1px #D7E4EF` border
- Low blue shadow
- Title at `13px` to `14px`
- Primary value or state at `24px` to `32px` only when useful
- Progress bars use blue fill on pale-blue track

Zerox adaptation:

- Runs cards, Settings recommendation cards, tool permission summaries, and context summaries can use this style.
- Chat messages should not all become metric cards; only grouped execution/tool surfaces need card treatment.

### Buttons

Primary:

- Blue fill `#166BB7`
- White text
- `10px` radius
- Soft shadow only for main actions

Secondary:

- White or pale-blue fill
- Blue or graphite text
- Subtle border

Danger:

- White or danger-soft background until destructive confirmation
- Danger text/border
- Filled red only for final destructive/stop action

### Inputs

- White or `#F8FBFF`
- `1px #D7E4EF` border
- Focus border `#1C73C9`
- Focus ring `0 0 0 3px rgba(28, 115, 201, 0.16)`
- `10px` radius
- Avoid dark inset fields.

### Composer

The composer should be restyled, not reimagined:

- Large white rounded surface like a Figma card.
- Mode chips use pale-blue backgrounds.
- Send action uses blue filled icon button.
- Stop/destructive action uses danger semantics.
- Existing workspace, goal, auto, skill, and send/stop behavior remains unchanged.

### Agent Output And Code

Surface-only direction:

- Code/terminal/diff blocks should move from dark or ad hoc styling to light inset panels where possible.
- Use monospace text, pale-blue/white backgrounds, subtle borders.
- Keep semantic color for additions/deletions/warnings.
- Do not change output content, parsing, or behavior.

### Popovers And Menus

Use the reference's floating-white language:

- White fill
- `12px` radius
- Medium blue-tinted shadow
- `1px #D7E4EF` border
- Selected row uses `#EEF7FF`
- Keyboard focus ring is visible and blue.

## Icon Language

The Figma reference uses simple, friendly line icons in a bold blue vertical rail. Zerox should converge on a single stroke-icon style.

### Icon Rules

- Base size: `20px`
- Small metadata: `16px`
- Large brand/navigation marks: `24px`
- Stroke width: `1.75px` to `2px`
- Stroke caps/joins: round
- Filled icons only for the app mark or selected navigation if needed
- Icon-only controls require labels/tooltips/ARIA names

### Visual Treatment

- Active rail icons: white icon on `#166BB7` or blue icon on `#D9ECFA`, depending on final sidebar treatment.
- Inactive icons: `#475467`.
- Warning icons: `#D9911B`.
- Success icons: `#2E9E6F`.
- Danger icons: `#C94848`.

### Icon Categories To Standardize

Keep the current product concepts; only unify the icon style:

- Chat/session
- Runs/history
- Tasks/schedule
- Settings/governance
- Workspace/folder
- Tool call
- Approval/risk
- Memory
- Evidence/check
- Recovery/checkpoint
- Stop/send

No new icon category should imply a new feature.

## Typography

Reference typography is simple, black, high-contrast, and dashboard-like. Zerox should keep Chinese-first readability while reducing the current "technical admin" feel.

### Font Stack

```css
font-family: Inter, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
```

Monospace:

```css
font-family: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, Monaco, Consolas, monospace;
```

### Type Scale

| Role | Size | Weight | Line Height |
| --- | ---: | ---: | ---: |
| Page title | `28px` | `700` | `36px` |
| Section title | `20px` | `700` | `28px` |
| Card title | `15px` | `650` | `22px` |
| Body | `14px` | `400` | `22px` |
| Control | `14px` | `550` | `20px` |
| Metadata | `12px` | `400` | `18px` |
| Numeric emphasis | `32px` | `750` | `38px` |

Rules:

- Do not use oversized marketing-style hero text inside the app.
- Chinese labels should remain short and operational.
- English technical strings, paths, and model names must fit or wrap cleanly.
- Letter spacing remains `0`.

## Motion Style

The reference is static, but its visual character implies friendly softness. Motion should feel smooth, light, and practical.

| Motion | Value |
| --- | --- |
| Hover/focus | `120ms cubic-bezier(0.2, 0, 0, 1)` |
| Popover open | `160ms cubic-bezier(0.16, 1, 0.3, 1)` |
| Card/row enter | `180ms cubic-bezier(0.16, 1, 0.3, 1)` |
| Composer resize | `180ms cubic-bezier(0.2, 0, 0, 1)` |
| Streaming/progress loop | `900ms linear`, reduced-motion disabled |

Rules:

- Motion clarifies state changes; it is not decoration.
- No bounce, spring spectacle, glow pulses, or dramatic page transitions.
- Reduced motion must remove loops and non-essential transforms.

## Brand Translation

Current brand assets use cream, black, and cyan, while the Figma reference is white/blue. For this iteration, brand treatment should visually align to the new light-blue shell without changing product identity.

Direction:

- Keep the Zerox name and mark.
- Place the mark on white or pale-blue surfaces instead of cream-heavy islands.
- Use primary blue as the live UI brand color.
- Keep cyan as a secondary live-detail accent only.
- Avoid a separate brand palette that fights the app palette.

## Implementation Boundary For Phase 4

Allowed implementation work:

- Replace hard-coded visual values with tokens.
- Restyle existing shell/sidebar/cards/composer/chat output/settings/runs surfaces.
- Normalize icon sizes, stroke style, color usage, and focus treatment.
- Adjust CSS layout spacing when needed for the same existing content.
- Improve visual accessibility and responsive collision behavior.

Disallowed implementation work:

- Adding new Agent states.
- Changing tool authorization logic.
- Changing workspace sandbox behavior.
- Changing memory behavior.
- Changing goal mode behavior.
- Changing route structure or feature navigation.
- Adding analytics/dashboard features because the reference has chart cards.

## Revised Phase 2 Decision

There are no longer three product directions to choose from.

The corrected direction is:

**Use the Figma reference as the surface-style source and evolve Zerox into a Soft Blue Desktop Control Surface.**

The previously generated product-direction previews in `docs/design/zerox-agent-3-2-2-directions/` are superseded and must not be used as Phase 3 source of truth. They remain in the workspace as exploration artifacts only.

## Phase Gate

This phase was confirmed by the user. Phase 3 converted this visual direction into the canonical design-system specification with exact tokens, component rules, accessibility contracts, and migration constraints.

Canonical Phase 3 source: [Zerox Agent v3.2.2 Design System Specification](zerox-agent-3-2-2-design-system-spec.md).
