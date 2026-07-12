# 深度调研简报：Zerox Agent 的记忆与学习体系（代码级）

> 调研对象：《Zerox Agent 与主流桌面端 AI Agent 对比》报告之"记忆与学习"章节
> 调研方式：阅读 `/Volumes/Out/codex_projects/building agent` 源码（分支 main，2026-07-12）
> 所有机制描述均以代码为准，关键函数/类型已标注文件路径。

---

## 0. 结论先行（TL;DR）

Zerox Agent 的记忆体系不是"一个向量库 + 自动写入"的黑盒，而是**三层架构 + 人工审核闸门 + 置信度分级自动写入 + 可回归评测**：

1. **记忆存储层**：5 种 `MemoryKind`（core/session/semantic/episodic/procedural）× 3 层治理优先级（`MemoryLayer`），支持词法 + embedding 混合检索（RRF 融合）。
2. **学习提取层（reviewed learning 的核心）**：每次 agent run 结束后，从轨迹自动提取学习候选，**默认状态 `pending_review`，必须经用户 accept 才能进入记忆**。
3. **梦境蒸馏层（self-improvement）**：后台 dream（历史 → 项目级记忆 + 剪枝）与 distill（重复工作流 → 打包成技能），**默认关闭（`ZEROX_SELF_IMPROVEMENT` 环境变量 opt-in）**，且只写"提示词型技能 + 咨询性记忆"，不修改自身代码。
4. **评测闭环**：`run-memory-evals.mjs` 测检索质量，`run-agent-evals.mjs` 测轨迹契约；更关键的是**评测本身也走"候选 → 审核 → 晋升"的 reviewed pipeline**，把真实运行的 episode 变成可回归的 fixture。

---

## 1. 记忆体系的三层架构

### 1.1 存储层：五种记忆类型 + 三层治理优先级

`src/shared/memory.ts` 定义了 `MemoryKind`：

```ts
export type MemoryKind =
  | "core" | "session" | "semantic" | "episodic" | "procedural";
```

- `core`（核心记忆）/ `semantic`（语义记忆，偏好与事实）/ `session`（会话记忆）/ `episodic`（情景记忆，每次 run 结束写入，见 `agentRuntimeEngine.ts:270` 附近的 episodic write）/ `procedural`（流程记忆，来自已审核学习）。

记忆来源 `MemorySource` 中专门新增了 P7 的两个来源：

```ts
| { type: "dream"; runId: string }   // P7 (Patch 23)
| { type: "distill"; runId: string } // P7 (Patch 23)
```

治理层 `MemoryLayer`（`memory.ts:23`）：`manual_required`（用户手录，检索排序最优先）> `ingested_habit`（习惯摄取）> `system_long_term`（系统长期）。`sortRecordsByImportanceAndDate()` 先按 layer 排名、再按 importance、再按更新时间排序——**用户显式写入的记忆永远压过系统自动写入的记忆**。

### 1.2 检索层：词法 + 向量混合检索（RRF）

`searchMemoryRecords()`（`memory.ts:223`）支持 `strategy: "blended" | "hybrid"`：
- `blended`：词法打分（标题命中 +3 / 标签 +2 / 内容 +1，短语命中 +1）叠加 embedding 余弦相似度 ×100；
- `hybrid`：`searchMemoryRecordsWithHybridRrf()` 用词法榜与向量榜做 Reciprocal Rank Fusion（`1/(60+rank+1)`）合并。

### 1.3 治理层：自动维护 + 冲突检测

- `src/shared/memoryMaintenance.ts`：`createMemoryMaintenancePlan()` 对 `session/semantic/episodic` 做合并规划，两种策略 `duplicate-title`（同名去重）与 `topic-rollup`（主题聚合，min 4 条），输出 draft 而非直接写。
- `src/shared/memoryGovernance.ts`：`createMemoryGovernanceReport()` 检测重复标题、**偏好冲突**（同一 subject 下内容矛盾的 preference 记忆）、陈旧低信号记录（importance ≤ 2 且 120 天未更新），给出归档/合并建议。

---

## 2. 学习提取：reviewed learning 的完整链路

这是 Zerox "reviewed learning"（已审核学习）的核心机制，代码链路完整：

### 2.1 提取：run 结束 → 轨迹 → 学习候选

`src/main/agentRuntimeEngine.ts:289`（`createLearningCandidates`）：每次 run 结束（成功或失败）后，拉取该 run 的完整轨迹，调用 `extractLearningCandidatesFromTrajectory(run, trajectory)`（`src/main/agentLearningExtractor.ts:5`），逐条写入学习候选库。

提取规则是**确定性的、基于轨迹事件的**（非 LLM 黑盒）：

| 触发条件 | 候选类型 | claim / 建议 |
|---|---|---|
| run 成功且工具调用 ≥ 2 次 | `procedural_memory` | "Successful run used tool sequence: A -> B -> C"，建议固化为流程记忆 |
| `failure_classified` = `permission_denied` | `failure_lesson` | 建议在权限策略内换路径或向用户请求授权 |
| `failure_classified` = `invalid_model_output` | `skill_improvement` | 建议收紧 skill/运行时 prompt 的输出约束 |
| 同一工具连续失败 ≥ 2 次（`findRepeatedToolFailure`） | `failure_lesson` | 建议重试前先检查参数、权限与最近观察 |

每个候选携带 `sourceRunId` + `sourceTrajectoryEventIds`——**每条学习都可以回溯到产生它的具体轨迹事件**，可审计。

### 2.2 存储：默认 pending_review

`src/main/agentLearningStore.ts:63`，候选写入时**强制初始状态为 `pending_review`**：

```ts
const candidate: AgentLearningCandidate = {
  id: createId(),
  type: input.type,
  status: "pending_review",   // ← 永不自动生效
  sourceRunId: input.sourceRunId,
  ...
};
```

状态机（`src/shared/agentLearning.ts:6`）：`pending_review → accepted | rejected → applied`。落盘于本地 `<configDir>/agent-learning-candidates.json`。

### 2.3 审核：人在回路（UI + IPC）

`src/main/ipc/index.ts:755`（`registerLearningIpcHandlers`）暴露四个通道，对应渲染层的 `src/renderer/components/LearningReviewPanel.tsx`：

- `learning:listCandidates` — 列表（可按 status/type 过滤）
- `learning:acceptCandidate` — 置为 `accepted`
- `learning:rejectCandidate` — 置为 `rejected`
- `learning:applyAccepted` — 应用已接受的学习

**没有任何路径能把 `pending_review` 直接变 `applied`**——必须经过用户点击 accept。

### 2.4 应用：只固化 procedural 记忆

`src/main/agentLearningService.ts:17`（`applyAcceptedLearning`）只处理 `type === "procedural_memory"` 的候选，其余（failure_lesson / skill_improvement）`skipped += 1`——它们留在面板里作为对人的建议，**不会自动变成系统行为**。固化时写入 `memoryStore.create({ kind: "procedural", tags: ["agent-learning", "procedural-memory"], source: { type: "agent_run", refId: candidate.sourceRunId }, importance: 4 })`，再把候选置为 `applied`。

### 2.5 回流：注入下一次 run 的 prompt（带"已审核"标注）

`src/main/agentProceduralMemory.ts:9`（`buildProceduralMemoryPromptContext`）：新任务启动时，按任务名 + skill 名检索 kind=procedural 的记忆（limit 3，单条 600 字符 / 总计 1800 字符预算），拼入 prompt，且标题明确标注来源与使用边界：

> "相关流程记忆（来自已审核学习；优先参考，但仍需结合当前任务判断）"

调用点：`agentRunnerService.ts:337` 与 `agentRuntimeEngine.ts:801`，均在构造首条 user message 前注入。**记忆是 advisory 的，模型被告知"仍需结合当前任务判断"**——学习不篡夺判断权。

---

## 3. 梦境蒸馏：自我改进的两条臂

代码集中在 `src/main/actors/`，注释明确标注 "contracts v1.4 §7, P7"。

### 3.1 dream：从历史中学（`dreamService.ts`）

`runDream(deps)`（`dreamService.ts:61`）：
1. **只读扫描**：`trajectoryRepository.scanByTypes([...], { limit: 500 })` 取最近 7 类轨迹事件 + 会话数 + 项目级记忆。
2. **蒸馏**：默认 `ruleBasedDistill()`（**无 LLM，纯规则**，可注入 LLM provider 覆盖）：出现 ≥3 次的工具二元序列 → 流程记忆（confidence = min(0.9, 0.5+count×0.1)）；≥2 次失败/越权事件 → failure-lesson；标题词不在近期轨迹中的旧记忆 → stale 检测。
3. **分级写入**（`DREAM_AUTO_WRITE_THRESHOLD = 0.7`，`dreamService.ts:52`）：
   - 高置信度（≥0.7）→ 直接写项目级记忆（`source: { type: "dream" }`，id 前缀 `dream_`），并**归档**被取代/陈旧的记忆（`archiveReason: "superseded" | "stale"`）——这是"遗忘/剪枝"机制；
   - 低置信度 → 计入 `candidatesQueued` 等待人工处理。
4. dream 本身可选地作为**后台 actor** 运行（`contextMode: "state", lifecycle: "ephemeral", background: true`），读写隔离。

### 3.2 distill：把重复工作流固化为技能（`distillService.ts`）

`runDistill(deps)`（`distillService.ts:43`）：
1. 跨 run 扫描工具调用，按 run 内**长度-3 滑动窗口**聚类工具序列；
2. 在 ≥3 个不同 run 中出现（`minOccurrences` 默认 3）才算"重复"，confidence = min(0.95, 0.5+runs×0.1)；
3. `DISTILL_PACKAGE_THRESHOLD = 0.7`（`distillService.ts:41`）以上 → `registerWorkflowAsSkill()` 打包成本地技能；以下 → `candidatesQueued`。

`src/main/workflow/registerWorkflowAsSkill.ts` 的打包产物有严格边界：
- 写出的技能是 **`mode: "agent"` 的 SKILL.md**（prompt 型，不含任意可执行代码），`permissions: { mode: "workspace_only" }`；
- slug 必须匹配 `^[a-z0-9][a-z0-9-]*$`，**双重路径护栏**：拒绝 `..`/绝对路径，且 `path.resolve(skillPath)` 必须位于 `skillsDir` 内（defence in depth）。

### 3.3 调度与开关（`selfImprovementService.ts`）

- **默认关闭**：`resolveSelfImprovementMode()` 读 `ZEROX_SELF_IMPROVEMENT`，仅当值为 `"on"` 才启动定时器（默认 1 小时一轮）；入口在 `main.ts:497` `container.selfImprovementService()?.start()`。
- `runNow()` 支撑 `/dream`、`/distill` 手动触发。
- **可观测**：每轮向轨迹仓库写入 `dream_started/completed`、`distill_started/completed` 事件，附 findings/skills 计数——self-improvement 本身也是可回放、可审计的轨迹。
- **best-effort**：失败仅 `console.warn` 并继续调度，永不阻塞主进程。

---

## 4. self-improvement 的边界：代码如何落实"不加入未经审核的自我修改"

AGENTS.md 的边界在代码中落实为**四道闸门**：

1. **权限闸门**：self-improvement 全局默认 off，opt-in 环境变量开启。
2. **产物闸门**：dream/distill 能写的只有两种东西——`kind: "procedural"` 的**咨询性记忆**和 `mode: "agent"` 的**提示词型技能**。代码里没有写自身源码、改配置、安装依赖的路径。distill 技能强制 `workspace_only` 权限 + 路径护栏 slug。
3. **审核闸门**：per-run 学习候选永远 `pending_review` 起步，必须人工 accept 才入记忆；dream/distill 的低置信度发现只计数排队，不自动生效。
4. **判断闸门**：注入 prompt 的流程记忆显式标注"来自已审核学习……仍需结合当前任务判断"，模型保留否决权；`agentReflection.ts` 的重试决策另有指纹去重（`duplicate_retry_blocked`）与预算（`budget_exhausted`）保护，防止记忆/策略引发死循环。

辅助机制：`src/shared/agentReflection.ts` 的 `createToolFailureReflection` 按错误分类（permission_denied 永远 `retryAllowed: false`，强制停下来请求授权），失败类与重试决策都会作为 `reflection_added` 事件落轨迹（`agentTrajectoryInsights.ts` 渲染为 UI 洞察）。

---

## 5. 记忆与行为评测：可回归，且评测本身也 reviewed

### 5.1 记忆检索评测（`scripts/run-memory-evals.mjs`）

调用 `dist-electron/shared/memoryEval.js`（源码 `src/shared/memoryEval.ts`）的 `runMemoryEvals(records, cases)`：每个 case 给定 query + `expectedMemoryIds` + `rejectedMemoryIds` + `topK`，真实跑 `searchMemoryRecords` 检索，判定期望命中与拒绝项不误伤，输出 `passRate` 与逐 case 失败原因；失败即 `exitCode = 1`（可接 CI）。`createDefaultMemoryEvalCases()` 还能从本地高重要度记忆自动生成回归用例。

### 5.2 agent 轨迹评测（`scripts/run-agent-evals.mjs`）

调用 `dist-electron/main/eval/agentEvalRunner.js` 的 `runAgentEvals(fixtures)`：fixture = 期望的轨迹事件序列 + `requiredEventTypes` + 断言（payload 匹配 / 先后顺序 / `maxCount`）。报告给出三个指标：`passRate`、`toolSuccessRate`、`recoverabilityRate`。内置 fixture 覆盖权限拒绝恢复、工作区越权拦截、重试预算耗尽、上下文压缩、策略守护、规则化权限 deny（`rm -rf *`）等关键契约（`src/main/eval/agentEvalFixtures.ts`，20+ 个场景）。

### 5.3 评测晋升闭环：评测用例也要人审

这是最独特的一环（`src/main/agentEvalCandidateService.ts`）：

1. `generateForRun(runId)`：对已结束的 run，用 `createEvalCandidateFromEpisode` 把真实 episode 转成 eval fixture 候选，落库 `agentEvalCandidateStore`，状态 `pending_review`；
2. UI（`EvalReviewPanel.tsx`）人工 `acceptCandidate` / `rejectCandidate`（经 `enqueueReviewMutation` 串行化防止并发竞态）；
3. `promoteAccepted`：仅 `accepted` 可晋升，`promotedFixtureStore.upsert()` 写入 `<configDir>/agent-promoted-eval-fixtures.json`；
4. 下次 `run-agent-evals.mjs --config-dir ...` 时，`createCombinedAgentEvalFixtures()` 把晋升 fixture 与内置 fixture 合并执行——**生产环境真实发生的失败，经人工审核后变成永久的回归测试**。

---

## 6. 诚实的局限性（供报告对照，避免过度宣传）

- `ruleBasedDistill` 默认**无 LLM**，distill 的"技能"实质是工具序列的提示词模板，不是学习到的复杂策略；LLM 增强需自行注入 provider。
- dream/distill 的低置信度分支目前**只累加 `candidatesQueued` 计数**，尚未接入学习候选库的持久化写入（代码注释承诺"queue for human review"，但当前实现未落库）——报告措辞宜说"低置信度不自动写入"，不宜说"进入审核队列"。
- 内置 fixture 评测是**合成轨迹契约测试**，不是端到端真模型评测；真实 episode 需经晋升流程补充。
- 记忆检索默认词法为主，embedding 依赖记录自带向量，未绑定特定向量服务。

---

## 7. 对 Zerox Agent 对比有用的要点（差异化优势清单）

对照主流桌面端 AI Agent（Claude Desktop / OpenClaw / MemGPT-Letta 类记忆方案 / 各类 coding agent），Zerox 在"记忆与学习"维度可突出：

1. **Reviewed learning 是硬编码而非口号**：学习候选状态机 `pending_review → accepted → applied` 在类型层强制（`agentLearning.ts`），IPC 层无 bypass 路径。多数竞品记忆是"模型自动写入、自动检索"，Zerox 是"自动提议、人工批准、审计留痕"。
2. **每条学习可回溯到轨迹事件**：`sourceRunId` + `sourceTrajectoryEventIds` 让记忆有出处；竞品向量记忆通常无法回答"这条记忆从哪次对话来的"。
3. **自我改进有明确爆炸半径**：opt-in 开关 + 只写咨询性记忆与提示词技能 + workspace_only 权限 + 路径护栏 + 失败 best-effort。对照"agent 自动改自己代码/自动装技能"的方案，Zerox 的 self-improvement 改不了自己的执行逻辑。
4. **记忆有"遗忘"机制**：dream 的 superseded/stale 归档 + governance 的冲突/陈旧检测，记忆库会自我收敛，而不是无限膨胀的向量堆。
5. **评测是双层的**：检索评测（memory evals）+ 轨迹契约评测（agent evals），且**评测用例本身走人工审核晋升**——真实失败变成回归测试，这在桌面 Agent 产品中罕见。
6. **全程本地优先**：候选库、记忆、晋升 fixture 全是本地 JSON/仓库文件，无云端依赖，契合"local-first trust"定位。
7. **模型不可见的治理优先级**：`MemoryLayer` 保证用户手录记忆 > 系统学习记忆，防止自动学习"喧宾夺主"。

可对应的竞品弱点（供报告"对比"段落使用，需另一子代理网络验证后引用）：
- 云端记忆服务（如 Mem0 类）隐私外发、不可本地审计；
- 自动记忆写入类产品缺少人工审核闸门，错误记忆一旦写入会持续污染上下文；
- 多数桌面 Agent 无轨迹级评测与回归机制，"越用越好"不可验证。
