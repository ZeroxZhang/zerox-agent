# Zerox Agent 代码级架构与 UI 调研简报

> 调研对象：Zerox Agent（项目路径 `/Volumes/Out/codex_projects/building agent`，`package.json` 版本 3.6.0）
> 调研日期：2026-07-12 · 用途：《Zerox Agent 与主流桌面端 AI Agent 对比》公众号文章写作素材
> 调研方式：直接阅读源码（main/container/preload/renderer）、`docs/architecture/*`、`docs/tech_report.md`、`docs/wx_mp/article-*`、`.zerox/progress.md`、`release/` 目录

---

## 1. 定位与目标用户

- **一句话定位**：Zerox Agent 是 macOS 上本地优先（local-first）的桌面 AI Agent 控制面（control plane），不是聊天壳、不是云端托管、不是纯编码 CLI（`docs/product/zerox-positioning.md`；README Overview）。
- **目标用户**：独立开发者与 macOS 高级用户；单人项目，2026-06-07 启动，由非技术背景独立开发者开发（`docs/wx_mp/article-blueprint.md`）。
- **名字含义**：Zero + X——从留白开始，把未知本地工作流转成可观察、受权限管控、可恢复的 Agent 运行（README 第 36 行）。
- **边界**：当前无 Accessibility/屏幕录制集成（`docs/wx_mp/article-research.md` §3.3），Agent 通过文件、Shell、Git、Web、Chrome 书签等文本化工具工作——写对比稿时不要宣传"能操作整个 Mac 界面"。

## 2. 整体技术架构（四层 + Main 内六子层）

### 2.1 Electron 进程分层（代码证据）

| 层 | 关键文件 | 机制 |
|---|---|---|
| Electron Shell | `src/main/main.ts`（679 行） | `app.whenReady()` 后注册 IPC、创建窗口、托盘、启动两个定时器：`startTaskScheduler`（60s）与 `startMemoryMaintenanceScheduler`（30min）（`main.ts:63-64`）。窗口 `close` 事件 `preventDefault() + hide()` 保持后台常驻（`main.ts:107-112`）。`webPreferences` 强制 `contextIsolation: true, nodeIntegration: false`（`main.ts:91-95`）。 |
| Preload 桥 | `src/preload/index.ts`（549 行） | `contextBridge` 暴露显式白名单 API；import 全部为 `import type`（仅类型），运行时不依赖 shared 运行时模块——这是 v2.3.1 preload 崩溃事故（打包后 `../shared/kernelContract` 模块解析失败导致回退浏览器预览模式）后的设计教训（`.zerox/progress.md` v2.3.1 条目）。 |
| Renderer | `src/renderer/App.tsx`（1011 行）+ `components/` | React 19.2 + Vite 8，hash 路由导航（`getNavigationSection(window.location.hash)`，`App.tsx:89-99`）。无 Redux/MobX，状态分散在纯函数 reducer（`chatStreamReducer.ts`、`goalProgressViewModel.ts`）。样式为手写 token-based CSS（无 Tailwind/MUI）。 |
| 存储 | `src/main/storage/storageDb.ts`（171 行）+ `migrationBundle.ts` | better-sqlite3 12.11.1，WAL 模式 + `synchronous=NORMAL`，启动时断言 FTS5 编译选项（`storageDb.ts:27-36`），同步运行 `BUNDLED_MIGRATIONS` 内联迁移（约 20 张表，见 migrationBundle.ts），每 60s `wal_checkpoint(PASSIVE)`，关闭时 `wal_checkpoint(TRUNCATE)`（`storageDb.ts:84-86`）。 |

### 2.2 Main 进程内部结构（DI 容器视角）

`src/main/container.ts`（2258 行）是函数式懒加载 DI 容器（`lazy(name, factory)`），从 import 列表可见完整模块地图：

- **基础设施**：`container.ts`（DI）、`ipc/index.ts`（12+ 域 IPC handler）、`kernel/eventBus.ts`（`KernelEventBus`，同步 pub/sub + 1000 条历史缓冲，供新窗口先回放再接收实时流）。
- **三种执行引擎，共享同一个核心循环**：`chatService.ts`（3628 行，交互式流式 chat）、`agentRuntimeEngine.ts`（1236 行，可恢复运行时）、`goalRuntimeEngine.ts`（1406 行，Goal 里程碑引擎）→ 均委托 `agentLoop.ts`（1570 行）的 `runAgentLoop`。
- **Kernel 契约层**：`kernel/permissionEngine.ts`（185 行，规则权限 allow/deny/ask + v3.6.0 新增 `DENY_LISTED_COMMANDS` 遍历全部 token 防 `sudo osascript` 绕过）、`kernel/compactionEngine.ts`（201 行）、`kernel/compactionStrategy.ts`（`ZEROX_COMPACTION_STRATEGY` = summarize/rebuild/auto）、`kernel/stopPolicy.ts`（证据驱动停止策略）。
- **Actor/Workflow/多 Agent**：`actors/actorRuntime.ts`（185 行，spawn/cancel，深度上限 3）、`workflow/workflowRuntime.ts`（231 行，`parallel` 并发上限 8，frozen host-hook 替代 QuickJS）、`workflow/deepResearchWorkflow.ts`、`multiAgentCoordinator.ts`（父子 run lineage）。
- **Provider & Tools**：`providers/`（`anthropicProvider.ts` 327 行原生 Messages API + prompt cache；`geminiProvider.ts`；`openAiCompatibleProvider.ts` 默认路径，兼容本地模型）；`agentToolExecutor.ts`（2576 行，`validateToolExecutionRequest` 沙箱前置检查，`agentToolExecutor.ts:155-236`）；25 种内置工具。
- **存储层**：`storage/storageDb.ts` + `storage/repositories/`（Run/Checkpoint/Memory/Session Repository）+ `storage/backendResolver.ts`（`ZEROX_STORAGE_BACKEND` = json/sqlite/dual，默认 dual 双写，SQLite 加载失败自动降级 JSON 保证应用始终可启动，`container.ts:275-293`）。

### 2.3 关键数据流（时序）

1. **Chat 链路**：`AgentChatPanel` → `chat:sendMessage` IPC → `ChatService.sendMessage()` → 组装分层 system prompt + 记忆召回 + 工具定义 → `runAgentLoop` → 每轮：注入 system reminder → 上下文压缩（预算 70% 触发）→ 模型请求（流式聚合 `aggregateStreamingCompletion` 兼容三厂商 index/id 策略）→ tool call 授权（`ToolAuthorizationService.authorize`）→ 执行 → observation 回填 → `emitCheckpoint()`（`agentLoop.ts:469-947`）。
2. **Goal 链路**（`docs/architecture/agent-goal-mode.md` 层图）：`GoalChatService` → `AgentGoalPlanner` 规划里程碑 → `AgentGoalStore`（JSON + ledger JSONL）→ 每个里程碑 = 一次 `AgentRuntimeEngine` 可恢复 run → `AgentGoalAcceptance` 验收（先确定性 `file_exists/command_exit_code/test_passes/assertion`，`model_review` 仅为兜底且证据字符串必须真实出现在 transcript 中）→ review gate（`approve_continue / modify_plan / terminate`）→ ledger + trajectory 落盘。
3. **恢复链路**：checkpoint 状态机 `queued → running → waiting_for_approval → paused → succeeded/failed/canceled`（`src/shared/agentExecution.ts` 定义合法迁移）；每个工具结果后写 `userData/config/agent-executions/<runId>.json`；`AgentRuntimeEngine.resumeRun(runId)` 复用原 runId 继续；轨迹 `userData/config/agent-trajectories/<runId>.jsonl` 追加式，带 redaction 标记。
4. **可观测性链路**：所有运行事件发 `KernelEventBus` → 经 `kernel:event` IPC 转发 renderer（`onKernelEvent` 先回放历史再推实时流，`docs/architecture/agent-runtime.md` "Kernel Event Bridge"）；工具授权决策全量写 `toolAuditLog`；Episode 导出（`npm run episode:export`）打包 run graph + eval candidate + trajectory。
5. **学习闭环**（`docs/architecture/agent-learning-loop.md`）：trajectory → 规则提取 `procedural_memory / failure_lesson / skill_improvement` 候选 → 用户 accept/reject → `AgentLearningService.applyAccepted()` 写记忆（kind: procedural）→ 未来 run 的 task/planning prompt 注入。**学习永不自动生效，必须人工审核；应用的是记忆而非代码或技能文件**——对比稿中不能写成"Agent 会自动进化"。

## 3. UI 结构（Renderer）

- **导航分区**（`src/shared/navigation.ts`）：主区 `chat / runs / scheduled-tasks / settings`；settings 内 `model-settings / tools / memory / skills / learning / evals`；system-overview 内 `setup / capability / review`。
- **组件清单**（`src/renderer/components/`）：`AgentChatPanel.tsx`（4277 行，主交互面板，导入 `GoalStatusStrip` 与 `GoalDetailDrawer`，见第 108-109、2408、2841 行）、`GoalDetailDrawer.tsx`（446 行，抽屉式目标详情：完整目标说明、进度状态、**审核门**（waiting_for_review 时渲染证据列表 + `继续执行/调整计划/终止` 三按钮，`GoalDetailDrawer.tsx:108-120`）、恢复路径、里程碑证据；带 `useDialogFocusTrap` 焦点陷阱与 Esc 关闭）、`RunsPanel.tsx`、`RunTrajectoryPanel.tsx`、`OverviewPanel.tsx`、`ScheduledTasksPanel.tsx`、`MemoryPanel.tsx`、`LearningReviewPanel.tsx`、`EvalReviewPanel.tsx`、`ModelSettingsPanel.tsx`、`SkillLibraryPanel.tsx`、`ToolsPanel.tsx`、`ToolSafetySummaryCard.tsx`、`chat/`（`AnswerBlock`、`OutputPartRenderer`、`CodeBlockView`、`DataTableView`、`CommandOutputView`、`JsonPreview`、`RunLedgerView`——13 种 `ChatOutputPart` 结构化输出部件的专用渲染器）。
- **浏览器预览模式**：无 Electron 环境下用 `demoAgentData.ts` 的确定性演示数据渲染，用于 UI 审查——但公众号截图不能用此模式画面（blueprint 明确要求真实 Desktop Mode 截图）。
- **设计语言**：v3.2.2 Soft Blue（`#166bb7`）→ v3.3.0/3.4.0 Obsidian 中性灰阶（近黑主色 `#26262a`），手写 CSS token，macOS 控制面质感。

## 4. 版本演进（release/ 目录实物 + progress.md）

- **发布节奏**：`release/` 目录有 1.0.0 → 3.6.0 共 40+ 个 macOS arm64 `.dmg`/`.zip` 实物（最早名为 "Building Agent"，1.7.0 前后改名 "Zerox Agent"，2.x 起统一 `Zerox Agent-x.y.z`）。
- **关键版本线**（`.zerox/progress.md`）：
  - v1.6.0（6/12）运行时核心；v1.7.0 Goal Mode 基础；
  - v2.0.1（6/15）**唯一一次回滚**——SQLite snapshot 覆盖 JSON-driven Goal/ledger 数据，回滚至 v1.9.5 并归档证据；
  - v2.3.0（6/16）Agent Runtime Kernel（KernelEventBus、checkpoint 压缩、权限引擎）；v2.3.1 preload 崩溃热修复；v2.3.6 Chrome 书签确定性目标经**六次黑盒 CDP 验收**才通过；
  - v2.4.0 八阶段大迭代收口；v2.4.5 分层系统提示重构；v2.4.6 `@skill` 显式调用；v2.5.0 workspace 一级边界；v2.6.0 15+ 项安全加固；v2.9.0 结构化输出渲染（Evidence-Linked Answer + Run Ledger，6 个 Task TDD 流水线）；
  - v3.2.2 设计系统重建（独立审查子代理 Hooke 首次 BLOCKED）；v3.3.0 UI 审计 28 项（4 项 P0 全关闭，验收 PASS，`UI_ACCEPTANCE.md`）；v3.4.0（7/10）Goal Mode 运行时状态与 workspace 修复（5 个根因：GoalDraft 丢 workspaceId、含空格路径被截断、pause 非安全继续、resolveReview 等待整循环、running milestone 无 ready 态）；v3.6.0 token 预算、内层取消、`DENY_LISTED_COMMANDS` 安全加固；P42 v3.7.0 自主目标运行时已在 feature_list 标记 done（84/84）。
- **版本号口径注意**：README 正文仍写 "current release: v3.4.0"，package.json 为 3.6.0，feature_list 含 v3.7.0 功能——发稿前需作者统一（blueprint §六.4 已列为待确认项）。
- **测试规模增长**：88 文件/393 测试（6/10）→ 188/1325（7/10）→ **199 文件/1835 测试**（7/12 `npm run verify` 复核，Agent evals 26/26、memory evals 2/2）。

## 5. 已有公众号文章的目标读者与行文风格

`docs/wx_mp/` 已有一篇完整策划（`article-blueprint.md`《Harness 做出桌面 Agent，我能去面 DeepSeek 产品经理吗？》+ 两份调研），其风格定位可直接作为新对比文的基调参照：

- **目标读者三圈层**：① Agent 工程师/AI 产品经理/AI 创业者（要架构图与具体设计）；② 独立开发者/产品运营（要"非技术背景也能做出正式产品"的过程）；③ 研发与开源观察者（要硬核细节且愿意公开技术债）。
- **行文风格**：产品效果前置、第一人称真诚克制自嘲、拒绝标题党（200 字内交代钩子真相）、主动泼冷水列边界（未签名、macOS-only、tree-sitter 延后、单人开发）、金句控制在 5–6 条、每 500–800 字一个视觉元素、不做竞品功能打分表——"用'我的取舍'替代'别人做错了'"。
- **措辞护栏（对比文必须继承）**：不写"完全本地数据绝不上云"（模型请求发往用户配置的 API Provider）；不写"真正能操作电脑"；不写"业界首创 Shell AST 安全"（当前是自研 tokenizer，非 tree-sitter）；self-improvement 必须注明默认关闭且需用户审核。
- **素材基线**：`article-research.md`（1335 行）已覆盖项目概览、产品视角、技术视角、故事素材、类比建议表，新对比文应复用其中已核实事实，把增量放在"与主流桌面端 AI Agent 的对比"上。

## 6. 对 Zerox Agent 对比有用的要点（差异化弹药）

写对比稿时，Zerox 可突出、而多数桌面端 Agent 不具备或不强调的差异化：

1. **每次工具调用都是一次授权决策**：三层叠加授权（PermissionRule 通配规则 → run sandbox 静态检查 → 风险分级人工审批），且**授权决策永远在主进程**，renderer 更新权限规则也不被工具执行信任（`docs/architecture/agent-runtime.md` "Permission Rule Engine"）；`toolAuditLog` 全量审计。对比点：IDE 类 Agent 多为一次性 allowlist 或"自动编辑"模式。
2. **结构化 Shell 安全分析而非字符串黑名单**：`shellAnalyzer` 引号感知分段、控制符检测、重定向路径提取、网络访问与不透明解释器检测；`allow git *` 不能放过 `git foo; rm -rf`；macOS 敏感命令（`osascript/security/tccutil` 等）按全部 token 扫描禁绝。对比点：竞品多为正则黑名单或容器隔离（且容器方案牺牲本地文件直访体验）。
3. **Per-tool-call checkpoint + 跨重启恢复**：崩溃/退出后从最后 checkpoint 续跑，复用原 runId；Goal 还有 11 段连续性 checkpoint（never-compact）。对比点：多数 Agent 崩溃即丢会话上下文。
4. **确定性优先的 Goal 验收**：`file_exists/command_exit_code/test_passes/assertion` 先行，model_review 证据必须真实出现在 transcript——"模型说成功不算成功"。对比点：多数 Agent 的"完成"由模型自评。
5. **完整可观测性**：~50 类轨迹事件 + KernelEventBus 实时回放 + Run Graph + Episode 导出证据包 + 内置 26 个确定性 eval fixtures + 对抗评测（mutation test）。对比点：竞品普遍只给最终 diff/回答，无运行轨迹回放与本地评测体系。
6. **审核制自我改进**：学习候选必须人工 accept 才写入 procedural memory，且只改 prompt 不改代码/技能。对比点：可对标"Agent 自我进化"叙事但强调"不自动进化"是刻意设计。
7. **本地优先的工程化兑现**：SQLite(WAL/FTS5) 主存储 + JSON 影子双写 + ABI 不匹配自动降级（保证永远能启动）、API Key 用 Electron `safeStorage` 加密、全部状态在 userData。对比点：云端 Agent 托管产品无法承诺数据不出机。
8. **诚实的技术债清单（信任建设）**：未签名/未公证、macOS-only、tree-sitter 与 QuickJS 因 Electron ABI 成本延后、单进程 Main 承载全部 Agent 逻辑、shell_exec 无 Docker/seccomp 真沙箱、tool call 串行执行。blueprint 已验证"主动列边界"反而提升可信度。
9. **工程过程本身即故事**：199 文件/1835 测试、RED→GREEN 证据链、独立子代理审查（Hooke/Lagrange/Leibniz）、打包后 CDP 黑盒验收、唯一一次回滚——"用 Harness 管住 AI 写出的系统"这一叙事是竞品对比中无人能复制的维度。

## 7. 待确认/不确定项（交回给写作阶段注意）

- 对外版本号口径（README v3.4.0 vs package.json v3.6.0 vs feature_list v3.7.0）需作者统一。
- 开源表述：两份调研对"完全开源/源码可见"存在冲突；仓库 remote 为 `github.com/ZeroxZhang/zerox-agent`，license 字段为 ISC——公开程度需作者确认。
- `drizzle-orm` 虽在 dependencies，但 `src/` 中无任何 `drizzle` import（迁移走内联 SQL 的 `BUNDLED_MIGRATIONS`，查询走 better-sqlite3 原生同步 API）——写文章时不要说"使用 Drizzle ORM 做查询"，只能说"用 drizzle 做 schema/migration 描述"或直接不提。
- better-sqlite3 ABI mismatch 导致本地 71 个测试失败是开发环境问题（research 报告 §4.5），生产包重新编译不受影响；引用测试数时以 7/12 复核的 199/1835 为准。
