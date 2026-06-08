# Agent Intent Router Design

## Goal

Improve Zerox's first-step decision making for chat messages by introducing a structured, testable intent router. The first implementation should convert a user message into an explicit route before `ChatService` decides whether to create a task, run a task, ask for missing information, or continue normal chat.

This is the first slice of the broader planning improvement roadmap. It focuses on intent classification and slot filling, not on a full LLM planner or runtime plan artifact.

## Product Position

Top agent products make the first turn feel deliberate: they infer what the user is trying to do, ask for missing information when needed, and avoid silently choosing unsafe defaults. Zerox currently detects scheduled task creation and task execution through private helpers in `chatService.ts`. That works for simple cases, but the decision is hard to inspect, hard to test in isolation, and too eager to default to `~/Downloads`.

The new router should make every first-step decision answerable:

- What intent did Zerox detect?
- How confident was the detection?
- Which slots were filled?
- Which slots are missing?
- What should `ChatService` do next?

## Scope

### In Scope

- Add a shared `agentIntent` module for deterministic intent routing.
- Represent intent as structured data with intent kind, confidence, slots, missing slots, and optional clarification copy.
- Support the first route kinds: `create_task`, `run_task`, and `chat`.
- Move target directory, task name, and task-run matching helpers out of `chatService.ts` into the shared module where practical.
- Update `ChatService` to consume the structured route before creating or running tasks.
- Ask a clarification question when a create-task intent is clear but required slots are missing.
- Keep the existing task creation behavior when schedule and target directory are both present.
- Keep existing task run behavior, including exact task name matching and the single-task fallback.
- Add focused unit tests for the router and update chat service tests for the new behavior.

### Out Of Scope For First Implementation

- Calling an LLM to classify intent.
- Adding a visible UI for intent debugging.
- Persisting intent routes in trajectory events.
- Building runtime plan artifacts.
- Reworking `AgentRuntimeEngine` planning.
- Supporting arbitrary user-created skill selection during task creation.

These remain compatible future extensions. The first version should be small, deterministic, and easy to verify.

## Recommended Architecture

Introduce `src/shared/agentIntent.ts` as a pure module. It should import schedule parsing from `scheduledTasks.ts`, but avoid main-process dependencies. `ChatService` should call this module once per incoming user message and then branch on the returned route.

The module is intentionally shared because the renderer can later use it for previews in the scheduled task panel or a future command palette. The first integration is main-process only.

## Alternatives Considered

### Alternative 1: Keep Private ChatService Helpers

This is the smallest code change, but it preserves the current hidden decision model. It does not make intent routing reusable or meaningfully easier to test.

### Alternative 2: Add An LLM Classifier Immediately

This would improve semantic coverage, especially for vague natural language requests. It also adds latency, cost, schema validation, and model failure modes before Zerox has a stable route contract.

### Alternative 3: Deterministic Router First

This is the selected approach. It creates a clear contract and test surface now, while leaving room for a later hybrid router that uses deterministic rules first and an LLM classifier only for uncertain messages.

## Data Model

### AgentIntentKind

`AgentIntentKind` is a string union:

- `create_task`: the user is asking Zerox to create or schedule a task.
- `run_task`: the user is asking Zerox to execute an existing task.
- `chat`: the message should go through the normal chat agent loop.

### AgentIntentSlotName

`AgentIntentSlotName` is a string union:

- `schedule`: a parsed `TaskSchedule`.
- `targetDir`: the local directory to operate on.
- `taskName`: the scheduled task name to create or match.

### AgentIntentRoute

`AgentIntentRoute` should contain:

- `kind`: `AgentIntentKind`.
- `confidence`: number from 0 to 1.
- `slots`: object with optional `schedule`, `targetDir`, and `taskName`.
- `missingSlots`: array of `AgentIntentSlotName`.
- `reason`: short internal reason string for tests and future diagnostics.
- `clarification`: optional user-visible message when Zerox should ask for missing information.

## Routing Rules

### Create Task

A message routes to `create_task` when it contains a valid schedule from `draftScheduleFromText` and task-like wording. Task-like wording includes file organization terms already supported by the product, such as organizing downloads, desktop, documents, or projects.

Required slots for first implementation:

- `schedule`
- `targetDir`

If `schedule` is present but `targetDir` is missing, Zerox should not silently default to `~/Downloads`. It should return a clarification such as:

`我可以创建这个定时任务。你想让我整理哪个文件夹？例如：下载、桌面、文档或项目。`

When both required slots are present, the router produces a `create_task` route with no missing slots. `ChatService` then builds the same `ScheduledTaskInput` shape currently used, including default `local-file-organizer`, report name, and file permissions scoped to the target directory.

### Run Task

A message routes to `run_task` only when it contains an explicit execution verb and a task or skill keyword. This preserves the current safety rule: casual conversation should not trigger task execution.

The route should include a `taskName` slot only when an explicit name can be detected from the message. Matching against stored tasks remains inside `ChatService` or a helper that receives the task list, because the shared pure router should not depend on stores.

### Chat

All other messages route to `chat`. This includes vague automation ideas without a schedule, ordinary questions, and messages that look like planning discussions rather than direct task creation or execution commands.

## ChatService Flow

1. Trim and persist the user message as today.
2. Call `classifyAgentIntent(userMessage)`.
3. If route is `create_task` with missing slots, append and return the clarification reply.
4. If route is `create_task` with all required slots, create the scheduled task.
5. If route is `run_task`, list tasks, match the task, and run it as today.
6. Otherwise continue the existing chat memory search and `runAgentLoop` path.

The route should not bypass existing error handling. Task creation failures, missing task stores, run failures, and model-profile failures keep their current user-visible behavior.

## Testing Strategy

### Router Unit Tests

Add `src/shared/agentIntent.test.ts` covering:

- Chinese create-task message with daily schedule and downloads directory routes to `create_task`.
- English create-task message with daily schedule and desktop directory routes to `create_task`.
- Scheduled message without a target directory routes to `create_task` with missing `targetDir` and a clarification.
- Explicit run-task command routes to `run_task`.
- Ordinary chat routes to `chat`.
- Mentioning "run" without a task keyword routes to `chat`.

### ChatService Tests

Update `src/main/chatService.test.ts` covering:

- Clear create-task route still creates a scheduled task.
- Scheduled task request without target directory returns clarification and does not call `taskStore.create`.
- Explicit run-task route still executes a matching task.
- Ordinary chat still reaches the model loop.

### Regression Verification

Run the focused tests first:

- `npm test -- src/shared/agentIntent.test.ts`
- `npm test -- src/main/chatService.test.ts`

Then run the full verification:

- `npm run verify`

## Future Extensions

After this slice is stable, Zerox can add:

- Hybrid model-backed intent classification for uncertain messages.
- Intent route trajectory events for observability.
- Plan artifacts in the recoverable runtime.
- Clarification UI with selectable slot chips.
- Skill selection during task creation instead of defaulting to `local-file-organizer`.
