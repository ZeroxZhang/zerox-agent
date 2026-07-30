# Zerox Agent 3.8.1 · Model Provider and Conversation UX

## Scope

Version 3.8.1 keeps the v3.8.0 trust boundary and reorganizes two user paths:

1. provider setup is connection-first, with models and defaults managed inside the selected connection;
2. Chat keeps routine execution disclosure in the right status rail and reserves the transcript for conversation plus user-blocking decisions.

The implementation borrows the useful separation in [OpenWorker](https://github.com/andrewyng/openworker) between provider setup and model/default management, while retaining Zerox Agent's encrypted main-process secret store, stable model-profile revisions, frozen Plan bindings, workspace sandbox, and `ToolAuthorizationService`.

## Provider information architecture

```text
Provider descriptor
└── Saved connection
    ├── public endpoint and protocol values
    ├── encrypted or ambient credentials
    ├── revision-bound verification
    └── model profiles
        ├── generation settings
        ├── optional capability overrides
        ├── connection- and profile-revision-bound verification
        └── default Chat / Embedding purpose
```

The renderer receives only public connection metadata. It never receives stored secret values.

### Connection states

| State | Meaning | User action |
|---|---|---|
| Saved, unverified | Configuration is durable, but no successful request exists for this revision | Test |
| Verified | A compact model request passed for the current revision | Use or set a model as default |
| Failed | The current saved model test failed | Inspect the bounded error and retry |
| Missing credential | The connection remains saved without a usable credential | Replace credential |
| Environment / ambient | The runtime resolves credentials outside the renderer | Test |

Saving a changed connection increments its revision and clears prior verification and defaults. “Test and save” tests the exact draft model first, saves only after success, then records connection and model verification bound to both saved revisions. A model can become default only after that exact model revision passes; editing it or a later failed test atomically clears its default. Removing a credential preserves the connection and its model profiles, increments the revision, clears verification/defaults, and removes encrypted secrets from both current and historical revisions.

Embedding tests call the OpenAI-compatible `/embeddings` route rather than Chat Completions. This release exposes Embedding purpose only for the implemented OpenAI, OpenAI-compatible custom, and Ollama paths; Anthropic-protocol and other native providers remain unavailable until they have a dedicated adapter. Ollama connection probing selects an installed model and then performs a real `/v1/chat/completions` request before the model can be verified or defaulted.

## Alibaba Model Studio Coding Plan

Coding Plan is a distinct provider rather than an alias of regular DashScope:

- OpenAI-compatible Base URL: `https://coding.dashscope.aliyuncs.com/v1`
- protocol: OpenAI Chat Completions
- credential environment key: `DASHSCOPE_CODING_API_KEY`
- curated models follow Alibaba Cloud's current exact allowlist:
  - recommended: `qwen3.7-plus`, `qwen3.6-plus`, `kimi-k2.5`, `glm-5`, `MiniMax-M2.5`
  - additional: `qwen3.5-plus`, `qwen3-max-2026-01-23`, `qwen3-coder-next`, `qwen3-coder-plus`, `glm-4.7`
  - `qwen3-coder-next` remains available but is marked without Function Calling because its official model page lists that capability as unsupported

The Coding Plan integration deliberately does not use the OpenAI Responses API. The endpoint and protocol follow [Alibaba Cloud's Coding Plan documentation](https://help.aliyun.com/zh/model-studio/coding-plan).

## Custom providers

A custom connection requires:

- protocol: `openai` or `anthropic`;
- Base URL;
- API key;
- exact model ID.

OpenAI-compatible connections send Bearer authentication and append `/chat/completions` to the Base URL. Anthropic connections send `x-api-key` plus `anthropic-version: 2023-06-01` and append `/v1/messages` to the service root. A saved custom connection cannot switch protocols; users create a new connection so a credential cannot silently cross protocol boundaries.

Credential reuse is bound to a shared target identity used by renderer and main process: normalized protocol/Base URL for compatible providers, Region and auth method for Bedrock, and Project/Location/auth method for Vertex. Changing that identity requires an explicit replacement credential before either testing or saving.

## Conversation disclosure policy

| Information | Main conversation | Right status rail |
|---|---:|---:|
| User and assistant messages | Yes | No |
| Plan-mode choice | Decision card until confirmed | Selected state afterward |
| Plan clarification questions | Answer card | Plan state |
| Ready-plan confirmation, failure recovery, Goal review/acceptance | Decision card | Summary |
| Tool authorization or guided Skill input | Decision surface | Status |
| Thinking, tool previews, Debate rounds, Goal milestones, approval history | No | Compact latest state with optional disclosure |
| Routine active Goal status | No | Progress |

Decision cards disappear after the decision is committed. Plan-mode selection disables ordinary composer input until the user chooses Direct or Debate. An `awaiting_input` Plan disables free-form composer routing and collects required answers in the Plan card; ready-plan feedback remains available as a read-only replan path.

## Safety and compatibility

- No cloud worker or provider-side credential storage was added.
- Provider responses remain normalized through bounded status-only error handling; non-success response bodies are never persisted into verification messages.
- Unverified connections and model revisions remain visible in settings but are excluded from Plan assignment and default selection until that exact model test passes.
- Frozen Plan bindings continue resolving historical connection and profile revisions.
- Changing a connection clears its verification instead of carrying a stale success forward.
- Only user-confirmed Ready plans create writable Goal runs.

## Acceptance

The release gate includes focused provider/store/renderer tests, full unit tests, TypeScript and production builds, static provider smoke, production Electron smoke, harness verification, dependency audit, and `git diff --check`. Independent adversarial review and an independent end-to-end test pass are required before merging to `main`.
