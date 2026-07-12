# 调研简报：Zerox Agent 的可观测性与评测体系（代码级）

调研日期：2026-07-12 ｜ 范围：本仓库 `/Volumes/Out/codex_projects/building agent`（分支 `main`，HEAD `6fd5242`），全部为当前代码库直接取证。

---

## 1. 定位与设计基调（背景锚点）

`.zerox/golden-principles.md` 用 7 条"黄金原则"直接定义了产品的工程世界观，后文所有机制都可对应到这些原则：

> 1. Local-first data is the product boundary.
> 2. Tool access must be permissioned, audited, and workspace-scoped.
> 3. **Agent runs must produce durable evidence before they affect learning.**
> 4. Learning changes future behavior only after user review.
> 5. Runtime state types and runtime behavior must match.
> 6. **Verification must be deterministic before it becomes inferential.**
> 7. Documentation is useful only when a fresh agent can act on it.

其中第 3、4、6 条是本简报主题（轨迹 → 证据 → 评测 → 受审核的学习）的直接来源。

---

## 2. 运行轨迹（Trajectory）如何记录

### 2.1 类型化事件模型

`src/shared/agentTrajectory.ts` 定义了**类型即契约**的轨迹事件模型：

- `AgentTrajectoryEventType` 是 **64 个事件类型的联合枚举**，覆盖完整生命周期，可直接反映能力边界：
  - 目标层：`goal_planned` / `goal_replanned` / `goal_review_requested` / `goal_judged`
  - 模型层：`model_request` / `model_retry` / `model_response` / `model_reasoning`
  - 工具层：`tool_call` / `tool_result` / `native_tool_invocation`
  - 上下文层：`context_compacted` / `context_rebuilt` / `checkpoint_written` / `checkpoint_boundary`
  - 验收层：`acceptance_checked` / `acceptance_certified` / `acceptance_repair_scheduled`
  - 子代理/Actor 层：`actor_spawned` / `actor_done` / `actor_message_sent` / `actor_message_reentered`
  - 记忆/蒸馏层：`dream_started` / `dream_memory_written` / `distill_skill_packaged`
  - 安全层：`workspace_escape_denied`、`failure_classified`、`strategy_guard_triggered`、`reflection_added`

- 每个事件携带**脱敏元数据**，这是一个很突出的差异化设计（`src/shared/agentTrajectory.ts:65`）：

```ts
export type AgentTrajectoryRedaction = {
  containsApiKey: false;          // 类型级保证：API Key 不允许为 true
  containsFileContent: boolean;
  containsUserText: boolean;
};
```

`containsApiKey: false` 是字面量类型而非 boolean——**"轨迹里绝不会有 API Key"是用 TypeScript 类型系统强制的不变量**，而不是运行时检查。

### 2.2 双写存储与热路径优化

`src/main/agentTrajectoryStore.ts` 的 `createAgentTrajectoryStore()` 实现三种后端（`json` / `sqlite` / `dual`）：

- 默认 JSON 后端：按 `<configDir>/agent-trajectories/<runId>.jsonl` **逐事件追加**（`flag: "a"`），并支持 `AbortSignal` 可中断写入（`agentTrajectoryStore.ts:47-58`）。
- `dual` 模式下 SQLite 是**同步热路径**，JSON 文件作为 fire-and-forget 的影子写入，失败只打 warning 绝不影响主路径：

```ts
repo.appendTrajectory(runId, event); // sync hot path
if (backend === "dual") {
  enqueueShadowWrite(jsonImpl.append(runId, event, appendOptions));
}
```

- `flushShadowWrites()` 在优雅退出时排空影子写入，保证两份存储最终一致。

### 2.3 损坏行自恢复

`src/main/jsonlRecovery.ts` 的 `readRecoverableJsonl()` 是"可恢复"承诺的落地细节：解析 JSONL 时**逐行隔离失败**，把坏行旁路写到 `*.corrupt-lines-<timestamp>.jsonl` 证据文件，主读取继续：

```ts
if (corruptLines.length) {
  await writeFile(`${filePath}.corrupt-lines-${Date.now()}.jsonl`, ...);
}
return records;
```

进程被 kill 导致最后一行写半截这种常见灾难，不会污染整个 run 的轨迹。

### 2.4 运行记录与检查点存储

- `src/main/agentRunStore.ts`（`createAgentRunStore`）：与轨迹存储**完全同构**的后端切换（json/sqlite/dual + 影子写），append-only 的 `agent-runs.jsonl`，支持 `limit`/`taskId` 过滤。
- `src/main/agentExecutionStore.ts`（`createAgentExecutionStore`）：按 `<configDir>/agent-executions/<runId>.json` 持久化 `AgentExecutionCheckpoint`；`listActive()` 只返回**非终态**（`isTerminalExecutionStatus` 取反）检查点并按 `updatedAt` 倒序——这是"应用重启后找回未完成 run 并续跑"（可恢复）的存储基础，与近期 commit `7e916b9 fix: persist and resume long-running goals` 对应。

### 2.5 轨迹洞察（人类可读层）

- `src/shared/agentRunInsights.ts`：`buildRunTimeline()` 把 run 事件分类为 `error/memory/model/permission/system/tool` 六类时间线，`getRunGuidance()` 根据失败摘要给出**中文、可操作的修复建议**（如"工具调用被拒绝 → 打开任务权限，允许确切的目录、域名或命令模板"）——可观测性直接到 UX 层。
- `src/shared/agentTrajectoryInsights.ts`：`summarizeTrajectoryEvent()` 把 `reflection_added`（恢复建议）、`model_retry`、`context_compacted`（如 "128 → 40 条消息，92k/128k tokens"）、`strategy_guard_triggered`（工具连续触发 N 次告警）翻译成洞察卡片。

---

## 3. Episode 导出与回放

### 3.1 自包含的 episode 证据包

`src/main/agentEpisodeExporter.ts` 的 `createAgentEpisodePackage()` 把一次运行打包成 **9 个文件的证据包**：

| 文件 | 内容 |
|---|---|
| `run.json` / `checkpoint.json` | 运行记录 / 执行检查点 |
| `trajectory.jsonl` | 完整轨迹 |
| `chat-trajectory.jsonl` / `workspace-run-events.jsonl` | 对话轨迹 / 工作区事件（可选） |
| `run-graph.json` | `projectRunGraph()` 投影出的运行图 |
| `learning-candidates.json` | 该 run 产生的学习候选 |
| `verification.json` | 校验结果 |
| `eval-candidate.json` | `createEvalCandidateFromEpisode()` 生成的评测候选 |
| `metadata.json` | 含 `redaction` 摘要（是否含文件内容/用户文本） |

关键闭环：**导出即生成 eval-candidate**（`agentEpisodeExporter.ts:41-45`）。导出的轨迹直接回流为评测语料——真实运行失败可以被"提拔"成回归测试 fixture，这正是黄金原则 3（"先产生持久证据，再影响学习"）与 4（"学习需经用户审核"）的工程化。

### 3.2 CLI 导出路径

- `scripts/export-agent-episode.mjs` 是用户入口：`npm run episode:export -- --config-dir <dir> --run-id <id>` 或 `--latest-validation`。
- 它委托 `src/main/agentEpisodeExportCli.ts` 的 `exportAgentEpisodeFromConfig()`，该函数从本地 stores 组装数据，并内置一个**最小校验**：

```ts
const verification = {
  passed: trajectory.some((event) => event.type === "final_summary"),
  checks: ["run_record", "trajectory_final_summary"],
};
```

episode 自带"这次运行是否有终态摘要"的可验证标记。

---

## 4. Actor 模型：并发与检查点组织

### 4.1 ActorRuntime（v0，contracts v1.4 §5.1/5.2）

`src/main/actors/actorRuntime.ts` 的 `createActorRuntime()` 提供 `spawn/wait/cancel/status/send`：

- **生命周期持久化**：每个 actor 的 `spawning → running → done/canceled/error` 状态写入 SQLite `actors` 表（`ActorRepository`），fork 执行通过注入的 `runActor` 回调解耦——运行时本身无需真实子进程或 LLM 即可测试。
- **三类上下文模式**：`ActorContextMode = "none" | "state" | "full"`；v0 只实现 `"full"`（fork 上下文继承）。
- **`ForkContext`（`actorRuntime.ts:26-30`）**：
  - `cachePrefix`：字节稳定的缓存对齐前缀（P3），fork 代理复用父 run 的 prompt cache；
  - `frozenAt`：捕获时刻的轨迹序列号（Patch 16）——**fork 的上下文是时间冻结的快照**，子代理不会看到分叉后的新事件，这是确定性回放/并发隔离的关键。
- `outputSchema` 校验：P6 支持对 actor 返回值做 JSON Schema 子集校验，失败自动降级为 `error` 状态。
- 终态时未送达的 inbox 消息会被 `markUndelivered` 落盘（对应 `actor_message_undelivered` 事件）。

### 4.2 Checkpoint-writer fork actor（contracts v1.4 §5.3）

`src/main/actors/checkpointWriterActor.ts` 的 `runCheckpointWriterActor()` 是第一个真实 actor：

1. **冷读**父 run 从 `frozenAt` 起的轨迹（`runRepository.getTrajectory(parentRunId, { fromSeq })`），`summarizeTrajectory()` 只保留 milestone/tool/error 类事件并裁剪到 8000 字符；
2. 优先用 LLM 蒸馏出 **11 段 markdown-v1 检查点**（active_intent、next_action、directives、task_tree、files、learnings、errors、live_resources、design_decisions 等），请求复用父 run 的 `cachePrefix`（缓存对齐省钱），`temperature: 0`；
3. **任何失败或格式不合法（`isValidMarkdownV1`）自动回退**到规则生成 `buildGoalContinuityCheckpoint`——"检查点写入永远可靠"；
4. 通过路径守护的 `CheckpointRepository.write(runId, "markdown", { source: "p5-fork" })` 落盘，供 `RebuildFromCheckpoint` 消费（来源无关）。

### 4.3 Orchestrator：不阻塞主 agent

`src/main/actors/checkpointWriterOrchestrator.ts`：当压缩（compaction）触发或 milestone/replan 事件主动刷新时，`maybeWriteCheckpoint()` 捕获父 `CachePrefix` → spawn actor → await 结果；并显式往父 run 轨迹里**回填 `actor_spawned` / `actor_done` 事件**（带 `cacheReadTokens`/`cacheWriteTokens`），使 fork agent 出现在运行图里：

```ts
// P5 observability: emit actor_spawned/actor_done trajectory events so
// the fork-agent checkpoint writer shows up in the run graph.
```

错误/取消时主 agent 降级到 P2 的 SummarizeCompaction——**actor 失败永远不阻塞主 agent**。`resolveCheckpointWriterFlag()` 支持 `off` / `p2-transition` / fork 路径的灰度开关。

---

## 5. Harness / Eval 评分体系：如何量化 agent 质量

### 5.1 三类评测 + 可提拔 fixture

`scripts/run-harness-score.mjs`（即 `npm run eval:agent` 的打分入口）组合了：

- **契约评测**：`runAgentEvals(evalFixtures)`——fixture 是"事件序列 + 断言"（`agentEvalRunner.ts:57-82`：断言事件类型存在、payload 匹配、`maxCount` 上限），产出三个比率：
  - `passRate`（通过率）
  - `toolSuccessRate`（工具结果成功率）
  - `recoverabilityRate`（可恢复 fixture 的通过率——**"可恢复性"本身是一等评测指标**）
- **目标模式专项**：`goal-*` fixture 子集（`goalPassRate`）与 `goal_judged` 裁判 fixture 子集（`goalJudgePassRate`）单独计分；
- **对抗评测**：`runAdversarialAgentEvals()`，失败直接使进程 exit 1；
- **promoted fixtures**：`createPromotedAgentEvalFixtureStore({ configDir })` 把本地 episode 导出的、经审核的 eval-candidate 合并进评测集（`createCombinedAgentEvalFixtures`），形成"线上失败 → 审核 → 回归测试"的闭环。

### 5.2 加权总分与 CI 闸门

`src/shared/harnessScore.ts` 的 `computeHarnessScore()` 把信号聚合为 0–10 的 `overall` 分与 `bad/warn/good` 三档 `tone`，分维度计分：

- `execution_environment`（init.sh / AGENTS.md 存在性）
- `tool_interface`（toolSuccessRate × 10）
- `context_management`（AGENTS.md + TrajectoryStore）
- `lifecycle_orchestration`（ExecutionStore…）
- 以及 eval pass、recoverability、goal pass、goal-judge pass 等比率维度
- `scoreGovernance(pendingLearningCandidates)`：**治理分**——积压的待审核学习候选会扣分（阻止"未经审核的自我改进"静默堆积）

`run-harness-score.mjs:105` 的退出契约：`evalReport.failed > 0 || !adversarial.passed || score.tone === "bad"` → exit 1，可直接作 CI 质量门。脚本同时输出 `aci`（`evaluateToolAciPolicy`，工具接口能力评估）与 `context`（`createAgentContextProfileReport`，上下文画像）报告。

### 5.3 Harness 工程基线自检

`scripts/check-harness-state.mjs`（`npm run harness:check`）检查的是**元层面的工程纪律**：必须存在 `AGENTS.md`、`init.sh`、`.zerox/feature_list.json`、`.zerox/progress.md`、`.zerox/golden-principles.md`、spec/plan 文档，且 `package.json` 必须有 `test/build/verify/smoke:prod/eval:agent/eval:memory/harness:check` 七个脚本——即"验证体系本身也被验证"。

---

## 6. 特性驱动开发：feature_list.json 如何运作

`.zerox/feature_list.json`（schemaVersion 1，当前 **84 个 feature，全部 `done`**，最近更新 2026-07-11）是单文件特性台账，每个条目结构：

```json
{
  "id": "P42-v3.7.0-autonomous-goal-runtime",
  "priority": 72,
  "status": "done",
  "title": "v3.7.0 autonomous goal runtime, Policy B authorization, and strict goal UI",
  "files": [/* 36 个受影响文件，含 spec/plan/源码/测试/台账自身 */],
  "definitionOfDone": [
    "Goal mode forces auto approval on and locks it while active",
    "Policy B destructive, privilege, secret-exfiltration ... require visible confirmation",
    "Forced asks ... time out after 60 seconds ...",
    "..."
  ],
  "verification": ["npm test -- --run src/shared/extremeRiskPolicy.test.ts ...", "..."]
}
```

运作机制（结合 `AGENTS.md` 的 Fast Start）：**① 每条 feature 自带 `definitionOfDone` 文字契约 + `verification` 可执行命令**，验收是机器可跑的而非口头约定；② `files` 字段强制特性—代码的可追溯映射（还包含 spec/plan 文档，形成"设计 → 计划 → 实现 → 测试"链）；③ `priority` 排序 + 一次只做一条未完成特性，改后必须跑验证命令并更新 `.zerox/progress.md` 留证据；④ 台账自身被 `check-harness-state.mjs` 守护。这使仓库对"一个全新的 agent 接手开发"是友好的（黄金原则 7）。

---

## 7. 对 Zerox Agent 对比有用的要点

这些是报告中"可观测、可恢复、可验证"优势的核心弹药（相对主流桌面端 agent 如 Claude Desktop/MCP 宿主、Cursor、Manus 等——竞品侧证据由其他子简报负责）：

1. **类型级隐私保证**：`containsApiKey: false` 是编译期不变量。多数 agent 的日志/轨迹是事后脱敏，Zerox 是把"轨迹不含密钥"写进类型系统——"你的对话和轨迹永远不出本地、且结构上不含密钥"。
2. **轨迹是一等公民而非日志副产品**：64 种语义化事件 + 事件级 `redaction` 元数据 + run-graph 投影 + 中文洞察/修复建议（`getRunGuidance`），从"可观测"直达"可操作"。多数产品只有黑盒的"AI 正在工作"转圈。
3. **崩溃韧性成体系**：JSONL 追加写 + `readRecoverableJsonl` 坏行隔离 + AbortSignal 贯穿 + 终态后写入被 settle（见 P42 DoD）+ `agent-executions/` 非终态检查点支持重启续跑。"断电不丢进度"是可演示的差异。
4. **评测即开发流程**：recoverabilityRate 作为一等指标、对抗评测、`tone==="bad"` 直接 CI 失败——agent 质量有量化红线；业界普遍靠人工试用和 benchmark 截图，Zerox 能把"每次改动都不劣化"变成自动化承诺。
5. **真实运行 → 回归测试的闭环**：episode 导出自动生成 `eval-candidate.json`，经审核后成为 promoted fixture。这是"从真实使用中学习，但每一步学习都经过人审"（黄金原则 3/4），区别于竞品的云端自动改进（数据出域）或完全不学习。
6. **Actor 模型带来可治理的并发**：fork 上下文时间冻结（`frozenAt`）、prompt-cache 对齐、actor 生命周期全量落库、失败降级到规则路径、不阻塞主 agent——多代理不是"开 N 个黑盒"，而是有血缘（`actor_spawned`/`actor_done` 回填父轨迹）、可取消、可审计的受控 fork。
7. **治理分惩罚学习积压**：`scoreGovernance(pendingLearningCandidates)` 让"未经审核的自我改进"在总分里直接体现——可以回应"本地 agent 会自己越学越偏吗"的质疑。
8. **84/84 特性全部带 DoD + 可执行验证**的台账，证明这不是 demo 工程而是"特性驱动、证据留痕"的成熟迭代纪律——文章可用作"工程可信度"的收尾论据。

### 局限与需诚实说明之处

- ActorRuntime 头部注释自认仍是 **v0**（`send`/`background`/`outputSchema`/peer 为 P6 规划，部分已部分实现）；多代理能力仍处早期。
- `verification` 目前是最小校验（只检查 `final_summary` 存在），episode 的"回放"更接近证据审查而非确定性重放执行。
- harness 总分中若干维度（如 `context_management`）部分依赖文件存在性打固定分，属于自检而非纯行为评测。
- 本简报全部基于当前工作区代码取证（2026-07-12，HEAD `6fd5242`）；未涉及竞品侧对比数据（交由其他调研子简报）。
