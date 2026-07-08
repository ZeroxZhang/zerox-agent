<p align="center">
  <img src="logo.png" alt="Zerox Agent" width="128" height="128" />
</p>

<h1 align="center">Zerox Agent</h1>

<p align="center">
  <strong>Local-First Desktop AI Agent · macOS · Electron + React + TypeScript</strong><br />
  <sub>从留白开始，把未知任务转成可执行动作。&nbsp;|&nbsp;Start from Zero. Turn unknown into action.</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20darwin-blue" alt="Platform: macOS" />
  <img src="https://img.shields.io/badge/electron-42.3-9feaf9" alt="Electron 42" />
  <img src="https://img.shields.io/badge/react-19.2-61dafb" alt="React 19" />
  <img src="https://img.shields.io/badge/typescript-6.0-3178c6" alt="TypeScript 6" />
  <img src="https://img.shields.io/badge/vite-8.0-646cff" alt="Vite 8" />
  <img src="https://img.shields.io/badge/better--sqlite3-12-003b57" alt="better-sqlite3" />
  <img src="https://img.shields.io/badge/license-ISC-green" alt="License: ISC" />
</p>

<p align="center">
  <img src="zerox-agent-onepage.png" alt="Zerox Agent one-page product overview" width="720" />
</p>

---

> **Language**：English first &nbsp;|&nbsp; <a href="#chinese">简体中文</a> follows after the English section.

---

# English

## Overview

**Zerox Agent** is a local-first desktop control plane for personal AI agents (current release: v3.4.0). The name comes from **Zero + X**: starting from a blank slate and turning unknown local workflows into observable, permissioned, workspace-scoped runs.

It is not a chat wrapper or a generic hosted agent surface. It runs entirely on your machine: it configures OpenAI-compatible / Anthropic / Gemini models, scans local `SKILL.md` skill files, executes recoverable agent runs, invokes permission-controlled tools, tracks parent/child multi-agent sessions, persists experiential knowledge into local long-term memory, and keeps learning user-reviewed before it changes future behavior.

The product boundary is documented in [`docs/product/zerox-positioning.md`](docs/product/zerox-positioning.md). Runtime, workspace, and learning details live in [`docs/architecture/agent-runtime.md`](docs/architecture/agent-runtime.md), [`docs/architecture/agent-workspaces.md`](docs/architecture/agent-workspaces.md), [`docs/architecture/agent-learning-loop.md`](docs/architecture/agent-learning-loop.md), and [`docs/architecture/agent-goal-mode.md`](docs/architecture/agent-goal-mode.md).

The v3.2.2 interface system is documented in [`docs/design/zerox-agent-3-2-2-design-system-spec.md`](docs/design/zerox-agent-3-2-2-design-system-spec.md): the app keeps the existing local-first workflows while moving the visible design language to a Figma-inspired Soft Blue Desktop Control Surface.

The v3.3.0 release is a macOS UI polish pass documented in [`UI_AUDIT.md`](UI_AUDIT.md) and accepted in [`UI_ACCEPTANCE.md`](UI_ACCEPTANCE.md). It tightens modal safety contracts, macOS menus, sidebar/settings density, typography, compact layouts, and release-ready visual QA without changing product behavior.

The v3.4.0 release uses [`docs/design/guidelines_0708.html`](docs/design/guidelines_0708.html) as the active frontend specification and selects **B · Obsidian** as the app theme. It moves the renderer from the older Soft Blue look to a neutral grayscale macOS control surface with a restrained near-black accent, dark-mode accent inversion, tighter focus/press feedback, and no product behavior changes.

### Design Principles

| Principle | Description |
|-----------|-------------|
| **Local-First** | All data (tasks, runs, permissions, memory, sessions) is stored in the local `userData` directory. Nothing is uploaded to the cloud. |
| **Privacy-Safe** | API keys are encrypted with Electron `safeStorage`. Every tool call is authorized per-task and audit-logged. |
| **Skill-Driven** | Behavior is defined by composable `SKILL.md` files supporting `agent` mode (LLM-driven) and `script` mode, with optional MCP tool extensions. |
| **Observable** | Every run produces a structured trajectory of model calls, reasoning, tool calls, checkpoints, compaction, pauses, and completion. |
| **Recoverable** | Agent work is inspectable, cancelable, and resumable — durable checkpoints survive crashes between tool calls. |
| **Permissioned** | Tools are gated by per-task policies layered with a workspace sandbox; shell commands are analyzed structurally, not just matched by string. |
| **Modular** | The primary app flow is Chat, Runs, Tasks, and Settings; diagnostics, skills, tools, memory, learning, and evals live under Settings. |

---

## Architecture

Zerox Agent is a layered Electron application. An Electron shell wraps a dependency-injection **container** that constructs every service lazily. A **kernel** defines the event contract, turn-loop driver, stop policies, permission engine, and compaction. Several **execution loops** (chat, scheduled task, goal milestone) drive the agent. An **actor model** enables sub-agents, a **workflow runtime** runs deterministic pipelines, and a **provider abstraction** talks to LLMs. All state is persisted through a **dual-write storage layer** (SQLite primary, JSON shadow).

```
┌──────────────────────────────────────────────────────────────────┐
│                        Electron Shell                            │
│   Tray · BrowserWindow · safeStorage · dialog · app lifecycle    │
├──────────────────────────────────────────────────────────────────┤
│                         Main Process                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │  Container (DI) │  │   IPC Handlers  │  │  KernelEventBus  │  │
│  └─────────────────┘  └─────────────────┘  └──────────────────┘  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌──────────────────┐  │
│  │ Chat loop │ │ Runtime   │ │ Goal      │ │ Actor / Workflow │  │
│  │ (chat)    │ │ engine    │ │ engine    │ │ runtime          │  │
│  │           │ │ (sched.)  │ │ (milest.) │ │ (deep-research)  │  │
│  └───────────┘ └───────────┘ └───────────┘ └──────────────────┘  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌──────────────────┐  │
│  │ Provider  │ │ ToolExec  │ │ ToolAuthz │ │ Skill registry / │  │
│  │ Anthropic │ │ + sandbox │ │ + shell   │ │ MCP / dream-dist │  │
│  │ Gemini    │ │           │ │ plan      │ │                  │  │
│  │ OpenAI-c. │ │           │ │           │ │                  │  │
│  └───────────┘ └───────────┘ └───────────┘ └──────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Storage: SQLite (zerox.db) + dual-write JSON shadow       │  │
│  └────────────────────────────────────────────────────────────┘  │
├─────────────────────────── IPC ──────────────────────────────────┤
│            Preload bridge  (contextIsolation: true)               │
├──────────────────────────────────────────────────────────────────┤
│                       Renderer Process                           │
│   Chat · Runs · Scheduled Tasks · Settings                       │
│   (Overview · Skills · Tools · Memory · Learning · Evals)        │
│   React 19 + hand-rolled CSS design system                       │
└──────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Desktop Shell | Electron 42 | Window, tray, `safeStorage`, OS integration |
| Bundler | Vite 8 | Renderer HMR + production bundle |
| Language | TypeScript 6 | Full-stack type safety, 3 tsconfig targets |
| UI | React 19 | Function components + Hooks |
| Styling | Hand-rolled CSS | Token-based design system (CSS custom properties), light/dark |
| Database | better-sqlite3 | Synchronous SQLite (WAL, FTS5) for all persistent state |
| Parsing | yaml, cron-parser | `SKILL.md` frontmatter, cron schedules |
| Testing | Vitest 4 | Unit tests + deterministic agent/memory evals |
| Packaging | electron-builder 26 | macOS `.app` / `.dmg` / `.zip` |

### The Kernel

`src/main/kernel/` is the cooperating set of modules that define how a run proceeds:

- **`KernelEventBus`** — a synchronous pub/sub with an in-memory history buffer; every `KernelEvent` (`turn_start`, `tool_call`, `compaction`, `checkpoint_written`, `judge_verdict`, `retry`, `run_end`) is forwarded to all renderer windows on the `kernel:event` channel.
- **Turn-loop driver** — `runRuntimeKernel` is the reference driver; the production loops reimplement the turn loop with richer behavior (streaming, compaction, pausing).
- **Stop policies** — `createTurnLimitPolicy` and `createEvidenceJudgePolicy`. The evidence judge calls an LLM and **requires its cited evidence strings to actually appear in the transcript** — hallucinated success is rejected.
- **Permission engine** — pattern-matches tool requests against `PermissionRule[]`; for `shell_exec` it derives a semantic command prefix so `npm run *` matches `npm run build`. Control operators (`;`, `&&`, `||`, backticks, `$(...)`, pipes, redirections) disable `allow` rules on the reduced command, so `allow git *` cannot be bypassed with `git foo; rm -rf`.
- **Resilience budgets** — chat default 8 turns, goal mode = `milestoneCount × 6`, absolute cap 60.
- **Compaction (three layers)** — kernel-level context compaction, the rebuild-from-checkpoint strategy (injects FTS5-BM25 memory hits + a 12k-token tail around a markdown checkpoint anchor), and path-guarded JSON checkpoint files.

### Execution Loops

Three production loops, all delegating to `runAgentLoop` (`src/main/agentLoop.ts`), the heart of the system. Per turn: inject system reminders → compact oversized history → request the model (streaming or with retry) → terminate, or authorize + execute tools → serialize observations → checkpoint. Loop guards detect repeated tool calls, fragmented tool-call patterns, and tool-failure streaks.

Every run is governed by an immutable `ExecutionContextPackage` — a frozen snapshot of the workspace sandbox, the selected skill, visible tools, permissions, memory scopes, and the checkpoint strategy. In v3.0.0, chat, goal milestone, and scheduled-task runs also emit a secret-safe `AgentRuntimeContextSnapshot` as the runtime context spine: it records the run surface, model identity, anchored time, sandbox roots, visible tool schema hash, memory scopes, checkpoint metadata, and trajectory identity before model/tool events. In v3.1.0, Goal commands with selected skills keep durable goal acceptance status, requirement-level subtasks, and attached active-goal summaries so complex requests do not collapse into one vague running state. Skills are loaded on demand through permissioned `skill_load` / `skill_resource_list` tools rather than eagerly. Each tool call is recorded in a durable tool invocation ledger (full status-transition history per call), and a separate raw history search store keeps pre-compaction message evidence queryable via `history_search` / `history_around`.

- **Chat loop** (`chatService.ts`) — interactive chat with streaming deltas, tool-call previews, output parts, status events, and continuation resume.
- **Recoverable runtime engine** (`agentRuntimeEngine.ts`) — scheduled/manual task execution with a persistent `AgentExecutionCheckpoint` written after every tool call, enabling true pause/resume across app restarts. Optional **max-mode** (best-of-N: 3 propose-only candidates, a judge picks the winner, the winner's tool calls replay via an ephemeral actor).
- **Goal milestone engine** (`goalRuntimeEngine.ts`) — runs one milestone at a time; deterministic task contracts run a no-LLM direct tool sequence, everything else runs `runAgentLoop` with post-loop acceptance judging.

### Actors & Multi-Agent

`src/main/actors/` implements an actor model so the model itself can spawn sub-agents via the `actor` tool (`run`/`spawn`/`status`/`wait`/`cancel`/`send`). Actors have a `contextMode` (`none`/`state`/`full`), a lifecycle (`persistent`/`ephemeral`), an optional `toolWhitelist`, an `outputSchema` for outcome validation, and a per-actor inbox enabling peer-to-peer messaging. Child run contexts inherit and **narrow** the parent sandbox (network/shell can only restrict, `read_only` is sticky, extra roots must stay inside parent roots, single-level handoff enforced by `depth`). The actor tool parent run context is propagated into spawned actors, terminal actor failures become tool-level failures, and chat status events expose subagent spawned/done/error summaries for the subagent context rail.

The flagship actor is the **checkpoint-writer fork**: it cold-reads the parent run's trajectory and distills an 11-section markdown continuity checkpoint (active intent, next action, directives, task tree, current work, files, learnings, errors, live resources, design decisions, open notes), preferring LLM distillation and falling back to a rule-based builder so it never fails.

### Workflow Runtime

`src/main/workflow/` runs deterministic pipelines inside a frozen host-hook sandbox (`agent`, `webfetch`, `websearch`, `parallel` cap 8, `pipeline`) with a deadline (default 12h) and abort signal. The built-in **`deep-research`** workflow is a `plan → search → extract → group → verify → report` pipeline where verification uses **3-voter adversarial actors** (a fact is dropped if ≥2 of 3 reject). Workflows can be packaged as discoverable skills (`registerWorkflowAsSkill`), and the model can invoke them through the `workflow` tool.

### Providers

`src/main/providers/` abstracts the LLM behind a frozen `LLMProvider` interface (`complete`, `stream`, `countTokens`, `buildCachePrefix`) with normalized content (text/thinking/tool_use/tool_result/image). Three implementations:

- **Anthropic** — native Messages API, `thinking` budget, multi-segment system messages + `cache_control: ephemeral` for prompt-cache hit rate, native `count_tokens`.
- **Gemini** — native `generateContent`/`streamGenerateContent`, `systemInstruction`, `thinkingConfig`, `cachedContent`.
- **OpenAI-compatible** (default) — wraps the legacy client; converts normalized content at the boundary; heuristic token counting.

### Storage & Persistence

All persistent state lives in **SQLite** (`<userData>/config/zerox.db`, WAL mode, FTS5 required). The schema is plain SQL under versioned migrations (`0000_initial.sql`, embedded into the bundle at build time). **Dual-write** keeps a JSON/JSONL shadow copy so the app still runs if the native module's ABI mismatches; `ZEROX_STORAGE_BACKEND` selects `json` / `sqlite` / `dual` (default `dual`). A parity test guarantees the SQLite repository and the JSON store produce byte-identical run graphs.

Key tables: `sessions`, `chat_messages`, `runs`, `trajectory_events`, `checkpoints`, `tool_results` (raw string offloads), `memory_records` + `memory_fts` (FTS5 external-content), `goals` + `goal_ledger`, `artifacts` (provenance), `tasks` (scheduled), `tool_audit`, `permissions`, `actors`, `learning_candidates`, `eval_candidates`, `workspaces`, `memory_profile`, `validation_snapshots`.

Legacy JSON/JSONL files coexist under the same `config/` directory (`agent-runs.jsonl`, `chat-sessions.json`, `memory-records.json`, `scheduled-tasks.json`, `tool-audit.jsonl`, `agent-trajectories/<runId>.jsonl`, `agent-goals/*`, `tool-result-refs/*.json`, `memory-persona.md`, `agent-validation.json`, `multi-agent-sessions.json`, etc.). API keys are encrypted with Electron `safeStorage` and stored in `model-settings.json` — never in the database, never in plaintext.

### Data Modes

The app explicitly indicates the current data mode:

- **Desktop Mode**: Electron is connected. Data is written to `userData/config`.
- **Preview Mode**: only the frontend is loaded in a browser. Static demo data is used; no persistent writes occur.

---

## Core Capabilities

### 1. Agent Chat

The chat window is the primary entry point — a goal-mode-first, chat-first interaction surface. Users describe needs in natural language; the Agent selects the appropriate skill, decomposes the task, invokes tools, and returns results. The session displays model, skill, task, memory, and tool status in real time.

Chat UX includes: session-native Goal Mode in Chat Session mode (a persistent 目标 composer control, typed goal-draft confirmation before execution, legacy `/目标 ...` compatibility, inline review gates, goal progress from the same conversation); a right context rail that shows decomposed task progress and automatically switches to active subagent execution status while subagents run; a compact real-time activity strip; expandable task-activity timeline (newest first); provider-returned public reasoning fields; user-controlled long-task continuation at checkpoints or repeated tool failures; and an always-available interrupt that cancels the active request and propagates cancellation into running tools.

### 2. Model Settings

- Supports OpenAI-compatible, Anthropic (native), and Gemini (native) providers
- Separate configuration for chat model and embedding model
- Adjustable temperature (recommended 0.2–0.5), max tokens, and thinking budget
- One-click connection test with latency and connectivity reporting

### 3. Skill System

Skills are auto-discovered from the app `skills/` directory plus user roots such as `~/.claude/skills` and `~/.agents/skills` (app-local first wins, so local skills can override user skills of the same name). Each skill is a `SKILL.md` file with YAML frontmatter defining execution mode (`agent`/`script`), typed inputs, permissions, dependencies, optional custom tools, and optional MCP servers. Skills are invoked via `@skill` fuzzy autocomplete in the composer and run through a staged `SkillExecutionContract` state machine with tamper-evident provenance. Built-in: `local-file-organizer`; example: `example-mcp-skill`.

### 4. Scheduled Tasks

Six schedule kinds: `manual`, `daily`, `weekdays`, `weekly`, `interval`, and `cron` (parsed via `cron-parser`). Natural-language drafting (`draftScheduleFromText`) recognizes bilingual phrases like "工作日 09:30" / "every 30 minutes". Tasks are **prompt-first** (describe what, when, where results go, when to stop) — skills are optional. Prompt-only tasks run as `prompt-task` in full-auto mode; `shell_exec`/`test_run` are hidden unless explicit shell templates are configured. Each automatic run is linked to a real chat session so task records can open the run context directly. The scheduler ticks every 60s.

### 5. Agent Execution & Recovery

The recoverable runtime is designed to be hard to strand:

- Dynamic skill and MCP tools are authorized by explicit tool name or registered source.
- Tool failures are appended as model-visible observations before retrying.
- Duplicate retry blocks and exhausted retry budgets become structured `reflection_added` / `failure_classified` evidence.
- Long histories are compacted before model requests and recorded as `context_compacted`.
- Transient model failures retry with bounded exponential backoff and `model_retry` evidence.
- Checkpoints are written after each tool result, so a crash between tools does not erase completed observations.
- Runs trajectory insight cards summarize recovery stops, model retries, and context compaction before users inspect raw payloads.

### 6. Goal Mode

For long-running objectives, Goal Mode plans milestones with success criteria and acceptance checks (`file_exists`, `command_exit_code`, `test_passes`, `assertion`, `model_review`). It runs one milestone at a time, tracks budget (iterations, tool calls, wall clock, tokens, replans), and carries an 11-section **goal-continuity checkpoint** through compaction (marked never-compact). Evidence-based `model_review` checks can use a transcript-backed goal judge that emits a `goal_judged` verdict before acceptance. Goal Mode artifact evidence files are written under the workspace or explicit user-selected output roots, so refs like `artifact:research_notes` are judged from real local files. Deterministic task contracts (e.g. Chrome bookmarks → desktop markdown) run a no-LLM pipeline with provenance-backed acceptance. Review gates fire based on policy (`each`/`key`/`final`/`high_risk` milestone).

### 7. Multi-Agent & Workflows

Parent/child multi-agent sessions are recorded as lineage metadata on top of the recoverable runtime. Child runs inherit and narrow the workspace sandbox, making multi-agent activity inspectable in the Runs panel instead of becoming an opaque execution path. The model can spawn actors (`actor` tool) and invoke workflows (`workflow` tool); the built-in `deep-research` workflow orchestrates search → extract → adversarial verify → report. Actor lifecycle events are mirrored back into chat so the right rail can show each subagent's current state instead of hiding parallel work behind a generic context list.

### 8. Tool System

**25 built-in tools** cover core agent capabilities. Tools come from three sources: built-in, skill-defined (from `SKILL.md`), and MCP servers.

| Tool | Function |
|------|----------|
| `file_list` / `file_stat` / `file_search` / `file_inventory` | Directory listing, metadata, name/content search, inventory |
| `file_read` / `file_write` | Read / write files (auto-creates dirs) |
| `file_move_plan` / `file_apply_moves` / `file_verify_moves` / `file_rollback_moves` | Transactional file-move pipeline with verify + rollback |
| `tool_result_read` | Read back offloaded large tool results |
| `code_search` | ripgrep-first source search |
| `git_status` / `git_diff` | Branch + changed-file summary / raw diff + numstat |
| `test_run` | Run approved test commands with structured output + cancellation |
| `chrome_bookmarks_read` | Deterministic native Chrome bookmark extraction (with artifact output) |
| `memory_search` / `conversation_search` | Bounded long-term memory / chat-session evidence recall |
| `web_search` / `web_fetch` / `web_fetch_document` | DuckDuckGo search / webpage fetch / normalized research document fetch |
| `citation_record` / `citation_coverage_check` | Record structured source evidence / verify sourced facts cite known citations |
| `markdown_report_write` | Write citation-backed Markdown reports + `.citations.json` sidecars |
| `shell_exec` | Execute shell commands with timeout, cancellation, structured failure diagnostics |

Native tools emit `native_tool_invocation` and `native_tool_observation` trajectory events so evals and episode exports can distinguish first-party tools from shell fallbacks. An ACI (agent-computer-interface) policy lints tool descriptors for risk level, permission scope, and observable-event hygiene.

### 9. Memory System

Local long-term memory with five cognitive-science-inspired types:

| Type | Purpose | Example |
|------|---------|---------|
| `core` | Persistent facts about the user | Name, preferences, identity |
| `session` | Transient per-session context | Temporary info in current conversation |
| `semantic` | General knowledge, concepts | Markdown syntax rules, API docs |
| `episodic` | Task execution experiences | Run summaries and outcomes |
| `procedural` | Workflows, procedures | Recommended file-organization steps |

Features: lexical search (title 3×, tags 2×, body 1×, multi-word phrase matching) over FTS5; optional **vector search** (cosine similarity via embedding model) with a **hybrid RRF** fusion strategy; 30-minute auto-maintenance (consolidates duplicate titles, rolls up topics, archives sources); memory governance reports (duplicates, preference conflicts, stale low-signal records); retrieval evals; an editable `memory-persona.md` profile; bounded runtime recall; conversation-evidence memories; atomic L1 preference extraction; and reviewed procedural learning that influences future planning.

### 10. Permissions & Security

- **File**: absolute-path whitelists with `{{placeholder}}` support; symlink-boundary detection walks each path segment and re-checks `realpathSync`.
- **Shell**: structural command analysis (tree-sitter-style `ShellPlan` is the source of truth), command-template matching, control-operator blocking, and destructive-command prevention (`rm -rf`, `git push -f`, `DROP TABLE`, `kubectl delete`, etc.).
- **Web**: explicit search toggle, subdomain-aware domain fetch whitelist.
- **Memory**: read/write toggles on task policies; memory tools are read-only recall helpers unless explicit write permission is granted.
- **Sandbox layering**: the run context narrows tool access by sandbox mode (`workspace_write`/`read_only`), network mode (`none`/`approved_domains`/`task_policy`), and shell mode (`disabled`/`approved_commands`/`workspace_only`).
- **Approval**: every tool call is checked against the task policy and audit-logged; critical calls (shell/file-write/web-fetch) escalate to a system dialog with risk classification (`normal`/`high`/`critical`).

### 11. Self-Improvement & Evals

- **Dream + Distill** (`selfImprovementService`): a background loop scans recent trajectories — `dream` distills recurring tool-call bigrams into procedural memory and failure lessons; `distill` clusters repeated tool-call sequences and packages high-confidence ones as discoverable skills. Low-confidence findings queue as user-reviewed learning candidates. Default off (`ZEROX_SELF_IMPROVEMENT`).
- **Agent evals** (`runAgentEvals`): trajectory-event assertion checks over curated fixtures (happy paths, permission-denied recovery, tool-error reflection, resume-after-tool-call, workspace-escape-denied, etc.). **Adversarial evals** mutation-test the harness itself — any mutation that escapes undetected is a failure.
- **Eval candidates**: a run's trajectory can be mined into a regression fixture; accepted candidates are promoted into the permanent set.
- **Harness score**: Overview computes a 0–10 **ETCLOVG** maturity score across 7 categories (Execution environment, Tool interface, Context management, Lifecycle orchestration, Observability, Verification, Governance) plus a native **Agent Capability** score. The score folds in adversarial eval, goal-mode pass rate, and goal-judge pass rate.

---

## Quick Start

### Prerequisites

- **macOS** (currently macOS-only)
- **Node.js** ≥ 18
- **npm** ≥ 9

### Install & Run

```bash
# 1. Clone
git clone <repo-url> && cd "building agent"

# 2. Initialize the repo-local harness and read the agent guide
./init.sh
less AGENTS.md

# 3. Install dependencies
npm install

# 4. Run full self-check (tests + build + deterministic agent/memory evals)
npm run doctor

# 5. Launch the desktop app (production mode)
npm run start:prod
```

### Development Mode

```bash
npm run dev
```

Starts three processes concurrently: Vite dev server (renderer HMR → `http://127.0.0.1:5173`), TypeScript main-process compilation (watch), and Electron (waits for compilation to complete).

### First-Time Setup

1. **Configure Model**: Open app → Settings → fill in Base URL, Chat Model, API Key
2. **Prepare Agent**: return to Overview, click "Prepare Local Agent", review the default file workflow and its allowed directories
3. **Validate**: click "One-Click Validate" to test connection, tool permissions, run log, and the default task path

> Embedding Model is optional; without it, memory uses keyword search only. With it, vector semantic search is enabled.

### LLM Smoke Test

If `.api_info.md` is present in the working directory:

```bash
npm run smoke:llm
```

Parses `.api_info.md`, sends a minimal `/chat/completions` request per provider, and reports results with API keys redacted.

### Desktop Validation

```bash
npm run validate:agent
```

Runs full validation inside the Electron main process: reads config → saves model → prepares task → tests connection → runs task → writes memory and validation snapshot.

---

## Development Guide

### Common Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Development mode (Vite + tsc watch + Electron) |
| `npm run doctor` / `verify` | Full self-check: tests, build, deterministic agent/memory evals |
| `npm run build` | Production build |
| `npm run start:prod` | Production build & launch |
| `npm test` / `test:watch` | Run / watch unit tests |
| `npm run smoke:llm` | Real-model connectivity smoke |
| `npm run smoke:prod` | Production smoke (start → verify render → exit) |
| `npm run validate:agent` | Full desktop agent validation |
| `npm run eval:agent` / `eval:memory` | Deterministic agent / memory eval suites |
| `npm run harness:check` / `harness:score` | Repo-local harness check / ETCLOVG score |
| `npm run episode:export` | Export a local evidence package (`run-graph.json`, `eval-candidate.json`, `trajectory.jsonl`) |
| `npm run pack:mac` / `dist:mac` | Package macOS `.app` (unsigned trial) / `.dmg` + `.zip` (distribution) |

### TypeScript Configuration

Three compilation targets via project references:

| Config | Target | Output | Purpose |
|--------|--------|--------|---------|
| `tsconfig.electron.json` | `main` + `preload` + `shared` | `dist-electron/` | Electron main process (Node16 ESM) |
| `tsconfig.renderer.json` | `renderer` + `shared` | (noEmit) | Vite-bundled renderer (ESNext) |
| `tsconfig.json` | Root reference | — | Combines the two above |

### Project Structure

```
src/
├── main/                  # Electron main process (Node.js)
│   ├── main.ts            # Entry: window/tray/IPC/startup
│   ├── container.ts       # DI container — constructs every service lazily
│   ├── agentLoop.ts       # Core turn loop (system reminders → compact → model → tools)
│   ├── agentRuntimeEngine.ts   # Recoverable runtime (checkpoints, pause/resume, max-mode)
│   ├── goalRuntimeEngine.ts    # Goal milestone engine + acceptance
│   ├── chatService.ts     # Chat-mode entry + streaming
│   ├── agentRunnerService.ts   # Runner facade + streaming generator
│   ├── agentToolExecutor.ts    # Tool registry, execution, sandbox
│   ├── kernel/            # Kernel: eventBus, runtimeKernel, stopPolicy, permissionEngine, compaction
│   ├── actors/            # Actor runtime, inbox, actor tool, checkpoint-writer, dream/distill
│   ├── workflow/          # Workflow runtime + deep-research workflow + workflow tool
│   ├── providers/         # LLM providers: Anthropic, Gemini, OpenAI-compatible + maxMode
│   ├── storage/           # SQLite (storageDb), migrations, repositories, backend resolver
│   ├── eval/              # Agent eval runner, adversarial eval, fixtures
│   ├── tools/             # Tool implementations (file/shell/web/code/git/test/...)
│   ├── ipc/               # IPC handlers per domain
│   └── ...
│
├── renderer/              # Electron renderer (browser)
│   ├── App.tsx            # Root: navigation + panel switching
│   ├── components/        # Panels (Chat, Runs, ScheduledTasks, Overview, Settings, ...)
│   │   └── chat/          # Chat output-part renderers (code, table, command, ledger, ...)
│   ├── chatStreamReducer.ts     # Pure streaming state machine
│   ├── chatOutputModel.ts       # Output-part adapter
│   ├── chatTaskActivity.ts      # Task status / process timeline
│   ├── goalProgressViewModel.ts # Goal progress projection
│   ├── agentWorkStatus.ts       # Work-phase state machine
│   ├── chatMarkdown.ts          # Hand-written markdown parser
│   └── styles/            # Token-based CSS design system
│
├── preload/               # Context bridge (contextIsolation: true)
├── shared/                # Shared domain logic (~140 modules, no subdirs)
│   ├── agentProtocol.ts   # Tool definitions, model-response parse, prompt profiles
│   ├── agentGoal.ts       # Goal / milestone / acceptance aggregate
│   ├── agentTrajectory.ts # Universal trajectory event type (~50 variants)
│   ├── agentWorkspace.ts  # Run context + sandbox policy
│   ├── toolPermissions.ts # Permission policy + authorization
│   ├── memory.ts          # Memory types + search (lexical/vector/hybrid RRF)
│   ├── skills.ts          # SKILL.md parsing
│   ├── scheduledTasks.ts  # Schedule kinds + NL drafting
│   ├── systemPromptLayer*.ts # Layered prompt assembly
│   ├── kernelContract.ts  # Kernel event/run/permission contract
│   ├── storageContract.ts # Frozen storage/repository interfaces
│   └── ...
│
├── skills/                # Local skills (local-file-organizer, example-mcp-skill, distilled/)
├── scripts/               # eval runners, packaging, migrations, smoke, episode export
├── build/                 # electron-builder resources (icon.svg, icon.icns)
├── docs/                  # product positioning + architecture docs
└── package.json
```

---

## Skill System

Skills are the core extension mechanism. Each skill is a `SKILL.md` file with YAML frontmatter and a Markdown body:

```markdown
---
name: my-skill
displayName: 我的技能
description: 这个技能做了什么
version: 0.1.0
execution:
  mode: agent            # agent | script
  maxTurns: 15           # optional
inputs:
  - name: inputParam
    label: 输入参数
    type: string         # string | path | number | boolean | choice
    required: true
permissions:
  files:
    read: ["{{inputParam}}"]     # Mustache-style placeholders
    write: ["{{inputParam}}"]
  shell:
    commands: []
  web:
    search: false
    fetchDomains: []
  memory:
    read: true
    write: true
planning:
  required: true
  maxSteps: 7
tools:                    # optional custom tool definitions
  - name: my_tool
    description: 自定义工具描述
    parameters: { type: object, properties: {} }
    entrypoint: my_tool_handler
mcpServers:               # optional MCP servers
  - name: external-server
    command: npx
    args: ["-y", "@scope/server"]
    env:
      API_KEY: "{{env.MCP_API_KEY}}"
---
# 技能指令

技能的具体指令内容，将作为 Agent 的执行指南。
```

At startup the registry scans app-local `skills/` then user roots, parses the frontmatter, validates the manifest, collects MCP configs, initializes MCP clients, and registers custom tools on the dynamic tool registry. Skills are invoked via `@skill` fuzzy autocomplete and run through a staged `SkillExecutionContract` with provenance pinning the skill's hash for tamper-evidence.

---

## Agent Run Lifecycle

Scheduled and manual task runs go through the recoverable runtime by default. Each run writes checkpoints, appends trajectory events, stores a terminal run record, and can generate learning candidates from the completed trajectory.

```
startedAt
  │
  ├── [preflight]  Workspace, skill, memory, and tool-schema setup
  │
  ├── [executing]  Model/tool loop
  │    ├── Compact oversized history before model_request
  │    ├── Retry transient model failures (model_retry evidence)
  │    ├── Authorize every tool against task policy + source metadata
  │    ├── Execute tool, append native/tool observation evidence
  │    ├── Write a checkpoint after each tool result
  │    └── Feed recoverable failures back to the model as observations
  │
  ├── [recovering] Runtime reflection
  │    ├── Classify permission / verification / network / duplicate / budget failures
  │    ├── Allow bounded retry only when recoverable
  │    └── Emit structured trajectory evidence before aborting unrecoverable loops
  │
  └── [done]       Completion
       ├── Write AgentRunRecord
       ├── Success → auto-write episodic memory
       └── Update task lastRunAt
finishedAt
```

Active checkpoints appear in the Runs panel and can be paused or resumed after interruption or app restart. The Runs panel also inspects raw trajectory events, payloads, and redaction flags, and projects runtime/trajectory/kernel/goal/milestone/tool/checkpoint/summary/gate evidence into a single stable run graph.

---

## Packaging & Distribution

```bash
npm run doctor        # Self-check first
npm run smoke:prod    # Production smoke
npm run pack:mac      # Unsigned .app → release/mac/   (local trial)
npm run dist:mac      # .dmg + .zip → release/          (distribution)
```

Current local builds are unsigned and not notarized. Each release passes an independent packaged-app acceptance gate (a computer-use run against the local macOS package) before handoff. After downloading a `.dmg` from GitHub Releases, macOS Gatekeeper may show "Zerox Agent is damaged and can't be opened." The image is usually valid; remove the quarantine attribute before opening:

```bash
xattr -dr com.apple.quarantine ~/Downloads/"Zerox-Agent-3.4.0-arm64.dmg"
# or, if already dragged into Applications:
xattr -dr com.apple.quarantine "/Applications/Zerox Agent.app"
```

For public distribution, Apple signing, notarization, auto-update, and crash reporting still need to be added.

---

## Testing & Evals

```bash
npm test                              # all unit tests
npm run test:watch                    # watch mode
npm run eval:agent                    # deterministic agent eval suite
npm run eval:memory                   # deterministic memory retrieval eval suite
npm run harness:check                 # repo-local harness check
npm run harness:score                 # build + contract evals + ETCLOVG score
npm run verify                        # tests + build + deterministic evals
BUILDING_AGENT_CONFIG_DIR=/path/to/config npm run eval:agent      # include local promoted fixtures
npm run episode:export -- --config-dir <userData/config> --run-id <runId>
npm run episode:export -- --config-dir <userData/config> --latest-validation
```

`npm run verify` covers the Vitest suite (183 test files), the production build, 26 deterministic agent eval fixtures, and the memory eval suite. Agent evals cover native code engineering, research writing, reflection-after-test-failure, retry-budget exhaustion, context compaction, tool-call checkpointing, model retry, strategy-guard fragmentation recovery, episode eval-candidate, child-handoff review gate, goal-mode recovery/control, bounded-autonomy golden paths, Agent Runtime Kernel kernel event replay, permission-rule behavior, deterministic local artifact provenance acceptance, execution-context/tool-ledger/history contracts, memory-history scope checks, and output-rendering restore fidelity. research writing, reflection-after-test-failure, retry-budget exhaustion, context compaction, tool-call checkpointing, model retry, strategy-guard fragmentation recovery, episode eval-candidate, child-handoff review gate, goal-mode recovery/control, bounded-autonomy golden paths, Agent Runtime Kernel event replay, permission-rule behavior, deterministic local artifact provenance acceptance, execution-context/tool-ledger/history contracts, memory-history scope checks, and output-rendering restore fidelity. Adversarial evals mutation-test the harness itself. The harness score emits the seven-category ETCLOVG score plus a native Agent Capability score used by Overview.

Deterministic local artifact goals are accepted only when the task contract, canonical destination, generated artifact, and provenance evidence all agree; location/resource canonicalization normalizes home-relative, workspace-relative, Desktop, Downloads, and absolute roots before sandbox and acceptance checks.

### Test Coverage

- **Shared layer**: skill parsing, task permissions, memory search, bootstrap, navigation, data boundary, agent protocol, goal/task contracts, trajectory, run graph, etc.
- **Main process**: tool execution, permission authorization, model config store, task scheduling, memory store, chat service, storage/repositories, smoke mode, etc.
- **Renderer**: agent work status, chat stream reducer, output model, goal view model, validation preview, demo data, design-system invariants, etc.

---

## Roadmap

Planned:

- [ ] Apple signing, notarization, auto-update, and clearer release distribution
- [ ] Deeper runtime-loop consolidation with first-class persistent plans and verifier/critic passes
- [ ] Skill marketplace, remote skill installation, and visual skill/workflow editing
- [ ] Event-triggered tasks (file changes, system events, etc.)
- [ ] Windows & Linux desktop support
- [ ] Opt-in crash reporting and diagnostics

---

---
# Chinese

<h1 id="chinese">Zerox Agent（中文）</h1>

## 项目概述

**Zerox Agent** 是一个本地优先的桌面智能体控制台。名字取自 **Zero + X**——从留白开始，把未知的本地工作流转成可观察、受权限管控、可恢复的 Agent 运行。

它不是聊天壳，也不是泛用云端 Agent 入口。它运行在本机：配置 OpenAI-compatible / Anthropic / Gemini 模型、扫描本地 `SKILL.md` 技能文件、执行可恢复的 Agent 运行、调用受权限管控的工具、跟踪父子多 Agent 会话、把经验和知识写入本地长期记忆，并且在改变未来行为前保留用户审核。

产品边界写在 [`docs/product/zerox-positioning.md`](docs/product/zerox-positioning.md)。运行时、workspace、学习机制和目标模式分别见 [`docs/architecture/agent-runtime.md`](docs/architecture/agent-runtime.md)、[`docs/architecture/agent-workspaces.md`](docs/architecture/agent-workspaces.md)、[`docs/architecture/agent-learning-loop.md`](docs/architecture/agent-learning-loop.md) 与 [`docs/architecture/agent-goal-mode.md`](docs/architecture/agent-goal-mode.md)。

当前版本是 **v3.4.0**。本次发布以 [`docs/design/guidelines_0708.html`](docs/design/guidelines_0708.html) 为前端规范，并选择 **B · 曜石 Obsidian** 作为主色方案；界面从旧的 Soft Blue 迁移到中性灰阶 macOS 控制面、近黑主操作色、暗色模式反转主色、明确焦点与按压反馈，不改变产品核心功能。

### 设计原则

| 原则 | 说明 |
|------|------|
| **本地优先** | 所有数据（任务、运行日志、权限、记忆、会话）存储在本地 `userData` 目录，不上传云端。 |
| **隐私安全** | API Key 使用 Electron `safeStorage` 加密存储，工具调用按任务授权并记录审计日志。 |
| **技能驱动** | 行为由可组合的 `SKILL.md` 文件定义，支持智能体模式 (`agent`) 和脚本模式 (`script`)，可扩展 MCP 工具。 |
| **可观测** | 每次运行产生结构化轨迹，覆盖模型调用、推理、工具调用、检查点、压缩、暂停和完成。 |
| **可恢复** | Agent 工作可检查、可取消、可恢复——持久化 checkpoint 让工具间的崩溃不丢已完成结果。 |
| **权限管控** | 工具按任务策略授权并叠加 workspace sandbox；shell 命令做结构化分析，而非仅字符串匹配。 |
| **模块化** | 主流程保留会话、运行、任务和设置；诊断、技能、工具、记忆、学习和评测收纳到设置内。 |

---

## 架构设计

Zerox Agent 是分层 Electron 应用。Electron 壳包裹一个依赖注入 **container**，懒加载构造每个服务；**kernel** 定义事件契约、轮次循环驱动、停止策略、权限引擎和压缩；多个**执行循环**（对话、定时任务、目标里程碑）驱动 Agent；**actor 模型**支撑子智能体，**workflow 运行时**跑确定性流水线，**provider 抽象**对接 LLM；所有状态通过**双写存储层**（SQLite 主、JSON 影子）持久化。

```
┌──────────────────────────────────────────────────────────────────┐
│                        Electron Shell                            │
│   Tray · BrowserWindow · safeStorage · dialog · app 生命周期      │
├──────────────────────────────────────────────────────────────────┤
│                         主进程 (Main)                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │  Container (DI) │  │   IPC Handlers  │  │  KernelEventBus  │  │
│  └─────────────────┘  └─────────────────┘  └──────────────────┘  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌──────────────────┐  │
│  │ 对话 loop │ │ Runtime   │ │ Goal      │ │ Actor / Workflow │  │
│  │ (chat)    │ │ engine    │ │ engine    │ │ runtime          │  │
│  │           │ │ (定时任务)│ │ (里程碑)  │ │ (deep-research)  │  │
│  └───────────┘ └───────────┘ └───────────┘ └──────────────────┘  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌──────────────────┐  │
│  │ Provider  │ │ ToolExec  │ │ ToolAuthz │ │ Skill registry / │  │
│  │ Anthropic │ │ + sandbox │ │ + shell   │ │ MCP / dream-dist │  │
│  │ Gemini    │ │           │ │ plan      │ │                  │  │
│  │ OpenAI-c. │ │           │ │           │ │                  │  │
│  └───────────┘ └───────────┘ └───────────┘ └──────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  存储：SQLite (zerox.db) + 双写 JSON 影子                   │  │
│  └────────────────────────────────────────────────────────────┘  │
├─────────────────────────── IPC ──────────────────────────────────┤
│            Preload 桥接层  (contextIsolation: true)               │
├──────────────────────────────────────────────────────────────────┤
│                       渲染进程 (Renderer)                         │
│   会话 · 运行 · 定时任务 · 设置                                   │
│   (总览 · 技能 · 工具 · 记忆 · 学习 · 评测)                       │
│   React 19 + 手写 CSS 设计系统                                    │
└──────────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层 | 技术 | 用途 |
|----|------|------|
| 桌面壳 | Electron 42 | 窗口、托盘、`safeStorage`、系统集成 |
| 构建 | Vite 8 | 渲染进程 HMR + 生产打包 |
| 类型 | TypeScript 6 | 全栈类型安全，三套 tsconfig |
| UI | React 19 | 函数组件 + Hooks |
| 样式 | 手写 CSS | 基于 token 的设计系统（CSS 自定义属性），明暗主题 |
| 数据库 | better-sqlite3 | 同步 SQLite（WAL、FTS5）持久化全部状态 |
| 解析 | yaml、cron-parser | `SKILL.md` 前置元数据、cron 调度 |
| 测试 | Vitest 4 | 单元测试 + 确定性 Agent/记忆评测 |
| 打包 | electron-builder 26 | macOS `.app` / `.dmg` / `.zip` |

### Kernel

`src/main/kernel/` 是一组协作模块，定义运行如何推进：

- **`KernelEventBus`** — 同步发布/订阅，带内存历史缓冲；每个 `KernelEvent`（`turn_start`/`tool_call`/`compaction`/`checkpoint_written`/`judge_verdict`/`retry`/`run_end`）通过 `kernel:event` 通道转发到所有渲染窗口。
- **轮次循环驱动** — `runRuntimeKernel` 是参考驱动；生产循环在其基础上重实现了更丰富的行为（流式、压缩、暂停）。
- **停止策略** — `createTurnLimitPolicy` 与 `createEvidenceJudgePolicy`。证据 judge 调用 LLM 并**要求其引用的证据字符串真实出现在 transcript 中**——幻觉式"成功"会被拒绝。
- **权限引擎** — 按模式匹配工具请求与 `PermissionRule[]`；对 `shell_exec` 推导语义命令前缀，使 `npm run *` 匹配 `npm run build`。出现控制符（`; && ||` 反引号 `$(...)` 管道 重定向）时，禁用对缩减命令的 `allow` 规则，`allow git *` 无法被 `git foo; rm -rf` 绕过。
- **韧性预算** — 对话默认 8 轮，目标模式 = `里程碑数 × 6`，绝对上限 60。
- **压缩（三层）** — kernel 级上下文压缩、rebuild-from-checkpoint 策略（在 markdown checkpoint 锚点周围注入 FTS5-BM25 记忆命中 + 12k token 尾部）、路径受保护的 JSON checkpoint 文件。

### 执行循环

三个生产循环，都委托给 `runAgentLoop`（`src/main/agentLoop.ts`），系统核心。每轮：注入系统提醒 → 压缩过长历史 → 请求模型（流式或带重试）→ 终止，或授权+执行工具 → 序列化 observation → checkpoint。循环守卫检测重复工具调用、碎片化工具调用模式和工具失败连击。

- **对话循环**（`chatService.ts`）— 交互式聊天，支持流式增量、工具调用预览、output part、状态事件和续跑恢复。
- **可恢复 runtime engine**（`agentRuntimeEngine.ts`）— 手动/定时任务执行，每个工具结果后写持久化 `AgentExecutionCheckpoint`，支持跨应用重启的暂停/恢复。可选 **max-mode**（best-of-N：3 个仅提议候选，judge 选优，胜者的工具调用通过临时 actor 重放）。
- **目标里程碑 engine**（`goalRuntimeEngine.ts`）— 一次跑一个里程碑；确定性任务契约跑无 LLM 的直接工具序列，其余跑 `runAgentLoop` 并在循环后做验收判定。

### Actor 与多智能体

`src/main/actors/` 实现了 actor 模型，模型本身可通过 `actor` 工具（`run`/`spawn`/`status`/`wait`/`cancel`/`send`）生成子智能体。Actor 有 `contextMode`（`none`/`state`/`full`）、生命周期（`persistent`/`ephemeral`）、可选 `toolWhitelist`、用于结果校验的 `outputSchema`，以及支持点对点消息的 per-actor 收件箱。子运行上下文继承并**收窄**父 sandbox（network/shell 只能更严、`read_only` 粘性、额外根必须在父根内、`depth` 强制单层 handoff）。

旗舰 actor 是 **checkpoint-writer fork**：冷读父运行轨迹，蒸馏出 11 段 markdown 连续性 checkpoint（活跃意图、下一步、指令、任务树、当前工作、文件、习得、错误、在线资源、设计决策、待办备注），优先 LLM 蒸馏，失败回退到规则构建器，永不失败。

### Workflow 运行时

`src/main/workflow/` 在冻结的 host-hook sandbox（`agent`/`webfetch`/`websearch`/`parallel` 上限 8 /`pipeline`）内跑确定性流水线，带截止时间（默认 12h）和 abort 信号。内置 **`deep-research`** workflow 是 `plan → search → extract → group → verify → report` 流水线，验证使用 **3-voter 对抗 actor**（一个 fact 若被 ≥2 个否决则丢弃）。Workflow 可被打包成可发现技能（`registerWorkflowAsSkill`），模型可通过 `workflow` 工具调用。

### Provider

`src/main/providers/` 用冻结的 `LLMProvider` 接口（`complete`/`stream`/`countTokens`/`buildCachePrefix`）抽象 LLM，内容归一化（text/thinking/tool_use/tool_result/image）。三个实现：

- **Anthropic** — 原生 Messages API，`thinking` 预算，多段 system 消息 + `cache_control: ephemeral` 提升 prompt cache 命中，原生 `count_tokens`。
- **Gemini** — 原生 `generateContent`/`streamGenerateContent`，`systemInstruction`、`thinkingConfig`、`cachedContent`。
- **OpenAI-compatible**（默认）— 包装旧客户端；在边界转换归一化内容；启发式 token 计数。

### 存储与持久化

所有持久化状态在 **SQLite**（`<userData>/config/zerox.db`，WAL 模式，需要 FTS5）。schema 是版本化迁移下的纯 SQL（`0000_initial.sql`，构建时嵌入 bundle）。**双写**保留 JSON/JSONL 影子副本，原生模块 ABI 不匹配时应用仍可运行；`ZEROX_STORAGE_BACKEND` 选择 `json`/`sqlite`/`dual`（默认 `dual`）。一项 parity 测试保证 SQLite 仓库与 JSON 存储产出逐字节一致的 run graph。

主要表：`sessions`、`chat_messages`、`runs`、`trajectory_events`、`checkpoints`、`tool_results`（原始字符串卸载）、`memory_records` + `memory_fts`（FTS5 external-content）、`goals` + `goal_ledger`、`artifacts`（来源证明）、`tasks`（定时）、`tool_audit`、`permissions`、`actors`、`learning_candidates`、`eval_candidates`、`workspaces`、`memory_profile`、`validation_snapshots`。

旧 JSON/JSONL 文件并存于同一 `config/` 目录（`agent-runs.jsonl`、`chat-sessions.json`、`memory-records.json`、`scheduled-tasks.json`、`tool-audit.jsonl`、`agent-trajectories/<runId>.jsonl`、`agent-goals/*`、`tool-result-refs/*.json`、`memory-persona.md`、`agent-validation.json`、`multi-agent-sessions.json` 等）。API Key 用 Electron `safeStorage` 加密存在 `model-settings.json`——不入数据库、不落明文。

### 数据模式

应用明确指出当前所处的数据模式：

- **正式本地数据模式**：Electron 桌面端已连接，数据写入 `userData/config`。
- **浏览器演示数据模式**：仅 localhost 预览前端，使用静态演示数据，不写入正式存储。

---

## 核心能力

### 1. 智能体对话 (Chat)

对话窗口是第一入口。用户从自然语言描述需求，Agent 选择技能、分解任务、调用工具、返回结果，会话中实时展示模型、技能、任务、记忆和工具状态。

对话体验包括：会话原生 **Goal Mode**（固定的“目标”输入控制、执行前的结构化目标草案确认、兼容旧 `/目标 ...`、内联审核门、从同一会话查看目标进度）；输入框上方紧凑实时状态栏；可展开的任务过程时间线（最新在前）；模型/API 返回的公开 reasoning 字段；长任务到检查点或连续工具失败时暂停让用户决定；以及始终可用的中断，可取消当前请求并把取消信号传给正在运行的工具。

### 2. 模型配置 (Model Settings)

- 支持 OpenAI-compatible、Anthropic（原生）、Gemini（原生）provider
- 独立配置对话模型与 Embedding 模型
- 可调 temperature（建议 0.2–0.5）、max tokens、thinking 预算
- 一键连接测试，报告延迟和连通性

### 3. 技能系统 (Skills)

从应用内 `skills/` 目录及 `~/.claude/skills`、`~/.agents/skills` 等用户目录自动发现（应用内优先，可覆盖同名用户技能）。每个技能是一个带 YAML frontmatter 的 `SKILL.md`，定义执行模式（`agent`/`script`）、类型化输入、权限、依赖、可选自定义工具和 MCP 服务器。通过输入框 `@skill` 模糊自动补全调用，经分阶段 `SkillExecutionContract` 状态机执行并带防篡改来源。内置：`local-file-organizer`；示例：`example-mcp-skill`。

### 4. 任务调度 (Scheduled Tasks)

六种调度：`manual`、`daily`、`weekdays`、`weekly`、`interval`、`cron`（`cron-parser` 解析）。自然语言草拟（`draftScheduleFromText`）识别"工作日 09:30"/"every 30 minutes"等双语表述。任务以 **prompt 描述为主**（写清做什么、何时、结果放哪、何时停），技能可选。prompt-only 任务以 `prompt-task` 全自动运行；未配置显式命令模板时不暴露 `shell_exec`/`test_run`。每次自动运行绑定真实会话，任务记录可直接打开运行上下文。调度器每 60 秒触发一次。

### 5. Agent 执行与恢复

可恢复 runtime 的设计目标是让运行不再轻易卡死：

- 动态 skill / MCP 工具按显式工具名或注册来源授权。
- 工具失败作为模型可见 observation 写回，再决定是否重试。
- 重复 retry 和恢复预算耗尽成为结构化 `reflection_added` / `failure_classified` 证据。
- 长历史在模型请求前压缩，记录 `context_compacted`。
- 瞬时模型失败有限指数退避重试，记录 `model_retry`。
- 每个工具结果后立即写 checkpoint，工具间崩溃不丢已完成 observation。
- Runs 轨迹诊断卡会摘要恢复停止、模型重试和上下文压缩，再让用户看 raw payload。

### 6. 目标模式 (Goal Mode)

面向长期目标，Goal Mode 规划带成功标准和验收检查（`file_exists`/`command_exit_code`/`test_passes`/`assertion`/`model_review`）的里程碑，一次跑一个，跟踪预算（迭代、工具调用、墙钟、token、重规划），并在压缩中携带 11 段**目标连续性 checkpoint**（标记 never-compact）。确定性任务契约（如 Chrome 书签 → 桌面 markdown）跑无 LLM 流水线并做来源证明验收。审核门按策略触发（`each`/`key`/`final`/`high_risk` 里程碑）。

### 7. 多智能体与工作流

父子多 Agent 会话作为血缘元数据记录在可恢复 runtime 之上。子运行继承并收窄 workspace sandbox，使多 Agent 活动在 Runs 面板可检视，而非变成不透明执行路径。模型可生成 actor（`actor` 工具）和调用 workflow（`workflow` 工具）；内置 `deep-research` workflow 编排 搜索 → 抽取 → 对抗验证 → 报告。

### 8. 工具系统 (Tools)

**25 种内置工具**覆盖核心能力。工具来自三类来源：内置、技能定义（来自 `SKILL.md`）、MCP 服务器。

| 工具 | 功能 |
|------|------|
| `file_list` / `file_stat` / `file_search` / `file_inventory` | 目录列表、元数据、名称/内容搜索、清单 |
| `file_read` / `file_write` | 读取 / 写入文件（自动建目录） |
| `file_move_plan` / `file_apply_moves` / `file_verify_moves` / `file_rollback_moves` | 事务化文件移动流水线，带校验 + 回滚 |
| `tool_result_read` | 读回卸载的大型工具结果 |
| `code_search` | ripgrep 优先源码搜索 |
| `git_status` / `git_diff` | 分支 + 改动文件摘要 / raw diff + numstat |
| `test_run` | 运行已授权测试命令，结构化结果 + 可中断 |
| `chrome_bookmarks_read` | 确定性原生 Chrome 书签抽取（带 artifact 输出） |
| `memory_search` / `conversation_search` | 有预算的长期记忆 / 会话证据召回 |
| `web_search` / `web_fetch` / `web_fetch_document` | DuckDuckGo 搜索 / 网页抓取 / 规范化研究文档抓取 |
| `citation_record` / `citation_coverage_check` | 记录结构化引用证据 / 检查 sourced fact 是否引用已知 citation |
| `markdown_report_write` | 写入带引用的 Markdown 报告 + `.citations.json` sidecar |
| `shell_exec` | 执行 shell 命令，支持超时、中断、结构化失败诊断 |

原生工具额外写入 `native_tool_invocation` 和 `native_tool_observation` 轨迹事件，让 eval 和 episode export 能区分一方工具调用与 shell fallback。ACI（agent-computer-interface）策略会对工具描述符做风险等级、权限范围和可观测事件卫生的 lint。

### 9. 记忆系统 (Memory)

本地长期记忆支持五种参考认知科学的类型：

| 类型 | 用途 | 示例 |
|------|------|------|
| `core` (核心) | 关于用户的持久事实 | 用户姓名、偏好、身份 |
| `session` (会话) | 单次会话临时上下文 | 当前对话中的临时信息 |
| `semantic` (语义) | 通用知识、概念 | Markdown 语法规则、API 文档摘要 |
| `episodic` (情景) | 任务执行经验 | 某次运行的摘要和结果 |
| `procedural` (流程) | 操作流程、工作流 | 文件整理的推荐步骤 |

特性：基于 FTS5 的关键词检索（标题 3×、标签 2×、正文 1×，支持多词短语匹配）；可选**向量检索**（Embedding 模型余弦相似度）与 **hybrid RRF** 融合策略；每 30 分钟自动整理（合并重复标题、话题归拢、归档源记忆）；记忆治理报告（重复、偏好冲突、陈旧低信号）；检索评测；可编辑 `memory-persona.md` 画像；有预算运行时召回；会话证据记忆；原子 L1 偏好抽取；以及影响后续规划的审核后流程学习。

### 10. 权限与安全 (Permissions & Security)

- **文件**：绝对路径白名单，支持 `{{placeholder}}`；符号链接边界检测逐段行走并复查 `realpathSync`。
- **Shell**：结构化命令分析（tree-sitter 风格 `ShellPlan` 为唯一真相源）、命令模板匹配、控制符拦截、破坏性命令拦截（`rm -rf`、`git push -f`、`DROP TABLE`、`kubectl delete` 等）。
- **Web**：显式搜索开关、子域名感知的域名抓取白名单。
- **记忆**：任务策略中 memory.read/write 开关；记忆工具默认只读召回，除非显式授予写权限。
- **Sandbox 分层**：运行上下文按 sandbox 模式（`workspace_write`/`read_only`）、network 模式（`none`/`approved_domains`/`task_policy`）、shell 模式（`disabled`/`approved_commands`/`workspace_only`）收窄工具访问。
- **授权**：每次工具调用按任务策略检查并写审计日志；关键调用（shell/文件写/web 抓取）按风险分级（`normal`/`high`/`critical`）升级到系统对话框。

### 11. 自我改进与评测 (Self-Improvement & Evals)

- **Dream + Distill**（`selfImprovementService`）：后台循环扫描近期轨迹——`dream` 把重复工具调用 bigram 蒸馏成流程记忆和失败教训；`distill` 聚类重复工具调用序列，把高置信度的打包成可发现技能。低置信度发现排队为待用户审核的学习候选。默认关闭（`ZEROX_SELF_IMPROVEMENT`）。
- **Agent 评测**（`runAgentEvals`）：对精选 fixture 做轨迹事件断言检查（happy path、权限拒绝恢复、工具错误反思、工具后恢复、workspace 越界拒绝等）。**对抗评测**对 harness 本身做变异测试——任何未被发现的变异都是失败。
- **评测候选**：运行轨迹可被挖掘成回归 fixture；接受的候选晋升为永久集。
- **Harness 评分**：Overview 计算跨 7 类（执行环境、工具接口、上下文、生命周期编排、可观测、验证、治理）的 0–10 **ETCLOVG** 成熟度评分，外加原生 **Agent Capability** 评分。

---

## 快速开始

### 环境要求

- **macOS**（当前仅支持 macOS）
- **Node.js** ≥ 18
- **npm** ≥ 9

### 安装与运行

```bash
# 1. 克隆仓库
git clone <repo-url> && cd "building agent"

# 2. 初始化仓库本地 harness，并阅读 Agent 操作指南
./init.sh
less AGENTS.md

# 3. 安装依赖
npm install

# 4. 运行完整自检（测试 + 构建 + Agent/记忆评测）
npm run doctor

# 5. 启动桌面应用（生产模式）
npm run start:prod
```

### 开发模式

```bash
npm run dev
```

同时启动三个进程：Vite 开发服务器（renderer HMR → `http://127.0.0.1:5173`）、TypeScript 主进程编译（watch）、Electron 窗口（自动等待编译完成）。

### 首次启动引导

1. **配置模型**：打开应用 → 设置 → 填写 Base URL、Chat Model、API Key
2. **准备智能体**：回到首页，点击「准备本地智能体」，检查模型、技能和默认任务
3. **验收运行**：点击「一键验收」，测试连接、工具权限、运行日志和默认任务路径

> Embedding Model 可选填；不填时记忆仍可用关键词检索，填后增加向量语义检索。

### 真实模型冒烟测试

如果当前目录有 `.api_info.md`：

```bash
npm run smoke:llm
```

解析 `.api_info.md`，对每个供应商发送一次最小 `/chat/completions` 请求，打印延迟和回复摘要（**API Key 已脱敏**）。

### 桌面端完整验收

```bash
npm run validate:agent
```

在 Electron 主进程内运行完整验收：读取配置 → 保存模型 → 准备任务 → 测试连接 → 运行任务 → 写入记忆和验收快照。

---

## 开发指南

### 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式（Vite + tsc watch + Electron） |
| `npm run doctor` / `verify` | 完整自检：测试、构建、确定性 Agent/记忆评测 |
| `npm run build` | 生产构建 |
| `npm run start:prod` | 生产构建并启动 |
| `npm test` / `test:watch` | 运行 / watch 单元测试 |
| `npm run smoke:llm` | 真实模型连通性冒烟 |
| `npm run smoke:prod` | 生产包冒烟（启动 → 验证渲染 → 退出） |
| `npm run validate:agent` | 桌面端完整验收 |
| `npm run eval:agent` / `eval:memory` | 确定性 Agent / 记忆评测 |
| `npm run harness:check` / `harness:score` | 仓库本地 harness 检查 / ETCLOVG 评分 |
| `npm run episode:export` | 导出本地证据包（`run-graph.json`、`eval-candidate.json`、`trajectory.jsonl`） |
| `npm run pack:mac` / `dist:mac` | 打包 macOS `.app`（未签名试用）/ `.dmg` + `.zip`（分发） |

### TypeScript 配置

项目使用 TypeScript 项目引用分离三个编译目标：

| 配置 | 目标 | 输出 | 用途 |
|------|------|------|------|
| `tsconfig.electron.json` | `src/main` + `src/preload` + `src/shared` | `dist-electron/` | Electron 主进程 (Node16 ESM) |
| `tsconfig.renderer.json` | `src/renderer` + `src/shared` | (noEmit) | Vite 打包的渲染进程 (ESNext) |
| `tsconfig.json` | 根引用文件 | — | 组合以上两者 |

### 项目结构

```
src/
├── main/                  # Electron 主进程 (Node.js)
│   ├── main.ts            # 入口：窗口/Tray/IPC/启动
│   ├── container.ts       # DI container，懒加载构造每个服务
│   ├── agentLoop.ts       # 核心轮次循环（系统提醒 → 压缩 → 模型 → 工具）
│   ├── agentRuntimeEngine.ts   # 可恢复 runtime（checkpoint、暂停/恢复、max-mode）
│   ├── goalRuntimeEngine.ts    # 目标里程碑 engine + 验收
│   ├── chatService.ts     # 对话模式入口 + 流式
│   ├── agentRunnerService.ts   # Runner facade + 流式生成器
│   ├── agentToolExecutor.ts    # 工具注册、执行、sandbox
│   ├── kernel/            # Kernel：eventBus、runtimeKernel、stopPolicy、permissionEngine、压缩
│   ├── actors/            # Actor runtime、inbox、actor 工具、checkpoint-writer、dream/distill
│   ├── workflow/          # Workflow runtime + deep-research workflow + workflow 工具
│   ├── providers/         # LLM provider：Anthropic、Gemini、OpenAI-compatible + maxMode
│   ├── storage/           # SQLite (storageDb)、迁移、repositories、backend resolver
│   ├── eval/              # Agent eval runner、对抗 eval、fixtures
│   ├── tools/             # 工具实现（file/shell/web/code/git/test/...）
│   ├── ipc/               # 按域注册的 IPC handler
│   └── ...
│
├── renderer/              # Electron 渲染进程（浏览器）
│   ├── App.tsx            # 根组件：导航 + 面板切换
│   ├── components/        # 面板（Chat、Runs、ScheduledTasks、Overview、Settings...）
│   │   └── chat/          # 聊天 output-part 渲染器（code、table、command、ledger...）
│   ├── chatStreamReducer.ts     # 纯流式状态机
│   ├── chatOutputModel.ts       # output-part 适配层
│   ├── chatTaskActivity.ts      # 任务状态 / 过程时间线
│   ├── goalProgressViewModel.ts # 目标进度投影
│   ├── agentWorkStatus.ts       # 工作相位状态机
│   ├── chatMarkdown.ts          # 手写 markdown 解析器
│   └── styles/            # 基于 token 的 CSS 设计系统
│
├── preload/               # 预加载桥接 (contextIsolation: true)
├── shared/                # 共享域逻辑（约 140 个模块，无子目录）
│   ├── agentProtocol.ts   # 工具定义、模型响应解析、prompt profile
│   ├── agentGoal.ts       # 目标 / 里程碑 / 验收聚合
│   ├── agentTrajectory.ts # 通用轨迹事件类型（约 50 个变体）
│   ├── agentWorkspace.ts  # 运行上下文 + sandbox 策略
│   ├── toolPermissions.ts # 权限策略 + 授权
│   ├── memory.ts          # 记忆类型 + 搜索（关键词/向量/hybrid RRF）
│   ├── skills.ts          # SKILL.md 解析
│   ├── scheduledTasks.ts  # 调度类型 + 自然语言草拟
│   ├── systemPromptLayer*.ts # 分层 prompt 组装
│   ├── kernelContract.ts  # Kernel 事件/运行/权限契约
│   ├── storageContract.ts # 冻结的存储/repository 接口
│   └── ...
│
├── skills/                # 本地技能（local-file-organizer、example-mcp-skill、distilled/）
├── scripts/               # 评测运行、打包、迁移、冒烟、episode 导出
├── build/                 # electron-builder 资源（icon.svg、icon.icns）
├── docs/                  # 产品定位 + 架构文档
└── package.json
```

---

## 技能系统

技能是核心扩展机制。每个技能是一个带 YAML frontmatter 和 Markdown 正文的 `SKILL.md`：

```markdown
---
name: my-skill
displayName: 我的技能
description: 这个技能做了什么
version: 0.1.0
execution:
  mode: agent            # agent | script
  maxTurns: 15           # 可选
inputs:
  - name: inputParam
    label: 输入参数
    type: string         # string | path | number | boolean | choice
    required: true
permissions:
  files:
    read: ["{{inputParam}}"]     # Mustache 风格占位符
    write: ["{{inputParam}}"]
  shell:
    commands: []
  web:
    search: false
    fetchDomains: []
  memory:
    read: true
    write: true
planning:
  required: true
  maxSteps: 7
tools:                    # 可选自定义工具
  - name: my_tool
    description: 自定义工具描述
    parameters: { type: object, properties: {} }
    entrypoint: my_tool_handler
mcpServers:               # 可选 MCP 服务器
  - name: external-server
    command: npx
    args: ["-y", "@scope/server"]
    env:
      API_KEY: "{{env.MCP_API_KEY}}"
---
# 技能指令

技能的具体指令内容，将作为 Agent 的执行指南。
```

启动时注册表按序扫描应用内 `skills/` 和用户目录，解析 frontmatter、校验 manifest、收集 MCP 配置、初始化 MCP 客户端，并把自定义工具注册到动态工具注册表。技能通过输入框 `@skill` 模糊自动补全调用，经分阶段 `SkillExecutionContract` 执行，并用 hash 锁定技能来源以防篡改。

---

## Agent 运行生命周期

手动/定时任务默认走可恢复 runtime。每次运行写 checkpoint、追加 trajectory event、保存终态 run record，并可从完成轨迹生成学习候选。v3.0.0 增加了 `AgentRuntimeContextSnapshot` 作为 runtime context spine，在模型/工具事件前记录运行表面、模型身份、时间锚点、workspace sandbox、可见工具 schema、记忆范围、checkpoint 与 trajectory identity，且不包含 API key 或大块原始工具输出。v3.1.0 继续补强 Goal 命令、选中技能、子任务验收和子代理执行的可观测链路：

```
startedAt
  │
  ├── [preflight]  workspace、skill、memory、tool schema 准备
  │
  ├── [executing]  模型/工具循环
  │    ├── 模型请求前压缩过长历史
  │    ├── 瞬时模型失败有限重试（model_retry 证据）
  │    ├── 每个工具调用按任务权限和来源元数据授权
  │    ├── 执行工具并追加 native/tool observation 证据
  │    ├── 每个工具结果后写 checkpoint
  │    └── 可恢复失败作为 observation 反喂模型
  │
  ├── [recovering] 运行时反思
  │    ├── 分类权限/验证/网络/重复/预算等失败
  │    ├── 仅在可恢复时允许有限重试
  │    └── 不可恢复循环终止前写入结构化轨迹证据
  │
  └── [done]       完成
       ├── 写入 AgentRunRecord
       ├── 成功运行 → 自动写入 episodic memory
       └── 更新任务 lastRunAt
finishedAt
```

活动 checkpoint 出现在 Runs 面板，可在中断或应用重启后暂停/恢复。Runs 面板还可检视原始轨迹事件、payload 和脱敏标记，并把 runtime/trajectory/kernel/goal/milestone/tool/checkpoint/summary/gate 证据投影成单一稳定 run graph。

---

## 打包与分发

```bash
npm run doctor        # 先跑自检
npm run smoke:prod    # 生产包冒烟
npm run pack:mac      # 未签名 .app → release/mac/  （本地试用）
npm run dist:mac      # .dmg + .zip → release/       （分发）
```

当前本地构建产物未签名、未公证。每个版本在交接前都会通过独立 packaged-app 验收（针对本地 macOS 包的 computer-use 运行）。从 GitHub Releases 下载 `.dmg` 后，macOS Gatekeeper 可能提示「Zerox Agent 已损坏，无法打开」。这通常不是文件损坏，而是下载隔离属性拦截。打开前在终端执行：

```bash
xattr -dr com.apple.quarantine ~/Downloads/"Zerox-Agent-<version>-arm64.dmg"
# 或已拖进 Applications：
xattr -dr com.apple.quarantine "/Applications/Zerox Agent.app"
```

如需公开分发，后续需要补充 Apple 签名、公证、自动更新和崩溃报告。

---

## 测试与评测

```bash
npm test                              # 全部单元测试
npm run test:watch                    # watch 模式
npm run eval:agent                    # 确定性 Agent 评测
npm run eval:memory                   # 确定性记忆检索评测
npm run harness:check                 # 仓库本地 harness 检查
npm run harness:score                 # 构建 + 契约评测 + ETCLOVG 评分
npm run verify                        # 测试 + 构建 + 确定性评测
BUILDING_AGENT_CONFIG_DIR=/path/to/config npm run eval:agent      # 含本地 promoted fixture
npm run episode:export -- --config-dir <userData/config> --run-id <runId>
npm run episode:export -- --config-dir <userData/config> --latest-validation
```

`npm run verify` 覆盖 Vitest 测试套件（183 个测试文件）、生产构建、确定性 Agent 评测套件（26 个 fixture）和记忆评测套件。Agent 评测覆盖原生代码工程、研究写作、测试失败反思、retry budget 耗尽、上下文压缩、tool-call checkpoint、模型重试、strategy guard 碎片化恢复、episode eval candidate、child handoff review gate、goal-mode recovery/control、bounded-autonomy 黄金路径、Agent Runtime Kernel 事件回放、permission-rule 行为、确定性本地 artifact 来源验收、execution-context/tool-ledger/history 契约、memory-history scope 检查和输出渲染恢复保真。对抗评测对 harness 本身做变异测试。harness 评分输出与 Overview 一致的七类 ETCLOVG 分数和原生 Agent Capability 分数。

确定性本地 artifact 目标只有在 task contract、canonical destination、生成的 artifact 和 provenance evidence 相互匹配时才通过验收。Location/resource canonicalization 会在 sandbox 和验收检查前规范化 `~`、workspace-relative、Desktop、Downloads 和绝对路径。

### 测试覆盖

- **共享层**：技能解析、任务权限、记忆搜索、引导流程、导航、数据边界、Agent 协议、goal/task 契约、trajectory、run graph 等
- **主进程**：工具执行、权限授权、模型配置存储、任务调度、记忆存储、会话服务、storage/repositories、冒烟模式等
- **渲染进程**：Agent 工作状态、聊天流式 reducer、output model、目标视图模型、验收预览、演示数据、设计系统不变量等

---

## 路线图

后续计划：

- [ ] Apple 签名、公证、自动更新和更清晰的分发流程
- [ ] 更深的 runtime loop 统一，包含一等持久化 plan 与 verifier/critic 回路
- [ ] 技能市场、远程技能安装和可视化技能/工作流编辑
- [ ] 条件触发任务（文件变化、系统事件等）
- [ ] Windows 和 Linux 桌面支持
- [ ] 可选开启的崩溃报告和诊断

---

## License

ISC

---

<p align="center">
  <sub>Built with ❤️ by Zerox · macOS-first · Local-first · Privacy-first</sub>
</p>
