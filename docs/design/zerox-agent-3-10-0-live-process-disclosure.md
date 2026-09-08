# Zerox Agent 3.10 · 实时过程披露（Live Process Disclosure）方案

> 目标读者：实现者（含未来接手的新 agent）。
> 结论先行：这不是一个 UI 需求，而是一次**运行时过程事实源（process fact source）**的架构升级；
> 而且实测发现——**今天根本还没有"实时"**，所以第一步是让流真正实时，而不是先做折叠。
> 状态：方案（待评审）· 2026-09 · 基于 v3.9.2 代码实测

---

## 0. TL;DR

| 问题 | 结论 |
|---|---|
| 你要的是什么？ | 不是"照抄 DSH 的界面"，而是把可观测性从**事后证据**升级为**过程见证**，并让用户在关键节点能干预 |
| **最反直觉的发现** | **当前会话在回合结束前几乎不更新**：`answer_delta` / `thinking_delta` 在主进程被累积，只在 attempt 开始或终态时 flush（`streamingStatus.ts:129,187,300`）。用户看到的是"提交 → 空白 → 一次性出结果" |
| 真正的瓶颈在哪？ | ①流没有实时投递 ②reasoning 不是一等事实（不落库、被截断、无消费者）③工具/计划的过程态被三处过滤器逐层剔除 |
| 该怎么改？ | **一份事实源 + 三种投影**：运行时事件日志 → ①实时折叠披露 ②持久化会话转录 ③证据/学习闭环 |
| 地基够不够？ | 数据模型约 80% 已就绪（`conversationDisclosure.ts` 3049 行、`chat_session_events`、`KernelEventBus`），但**投递链路和渲染性能都不达标** |
| 最大的坑？ | 把 thinking 只做成前端动画 → 重启即失、与轨迹不一致 → **实时披露反而摧毁它本该建立的信任** |
| 第二大的坑 | 有一个**源级测试明确禁止**工具/思考预览进入主界面（`materialDesign.test.ts:1644-1650`）——这是治理动作，必须显式改政策，不能偷偷绕过 |
| 工作量 | P0–P4 五个阶段；**P0 不改 UI，但必须先做**，否则后面全是空转 |

---

## 1. 需求洞察：你真正要解决的问题

### 1.1 你说了什么

> "把 zerox agent 的会话交互做升级，改成像 deepseek harness 这种动态实时披露关键过程信息，思考折叠，以及工具调用，规划过程等等，都想在任务执行过程中实时动态披露。"

表层需求 = 交互形态对齐 DSH：实时、可折叠、过程可见。

### 1.2 你真正要的是什么（五层）

**第一层 · 信任的可验证性：从"事后审计"到"过程见证"**

Zerox 的产品定义（`AGENTS.md`）是 "permissioned, observable, recoverable agent runs"，`golden-principles.md` 第 2 条要求"工具访问必须被授权、审计、限定在工作区"。但当前可观测性的兑现方式是**事后**的：`RunTrajectoryPanel` 看证据、`checkpoint` 看恢复点、`acceptance` 看验收。长任务执行期间用户处于盲区。

这带来一个结构性矛盾：**你要求用户对自主 Agent 授权，却只让他在事后才知道 Agent 用它做了什么。** 授权因此退化成盲签。实时披露的真实价值，是让"授权"这个契约在执行过程中持续可被监督。

**第二层 · 可干预性：披露的唯一硬价值是"在正确时刻能介入"**

如果只是"能看着"，价值减半——用户盯着屏幕并不能改变结果。真正的诉求是干预窗口：

- 看到工具参数 → 能在执行前否决/修改
- 看到计划步骤 → 能在跑偏之前纠正
- 看到思考方向 → 能补充约束
- 看到长任务无进展 → 能继续/停止而不是干等

所以披露设计必须以"这个信息出现在这个时刻，用户能做什么"为第一问。

**第三层 · 认知负荷：折叠不是隐藏，是注意力路由**

`docs/design/zerox-agent-3-8-1-model-and-conversation-ux.md:72-82` 和 `README.md:229-240` 已经明确：主对话只保留真正需要用户处理的内容，Thinking / 工具预览 / Debate 轮次进右栏。这是**正确的**产品判断，但它是"一刀切"的：要么收纳，要么刷屏。

真实诉求是分层：默认折叠、按注意力自动展开、用户可固定。两种用户（结果导向 vs 过程监控）必须能共存——业界反馈同样是两极分化的（[LukeW, Showing the Work of Agents in UI](https://www.lukew.com/ff/entry.asp?2142)）。

**第四层 · 单一事实源：披露必须是运行时事实的投影，而不是渲染层的临时状态**

今天 `thinkingText` 只活在 renderer 内存里，被截断到最近 2000 字符（`src/renderer/chatStreamReducer.ts:74`, `:304-311`），attempt 重置时清空（`:383-406`），从不落库。更糟的是：**它和 `toolCallPreviews` 都是只写状态——没有任何组件读取它们**（唯一其他引用是重置处 `AgentChatPanel.tsx:1804-1805`）。

后果：
1. 刷新/重启后思考消失，用户看到的是"残缺的现场"
2. 实时视图与 `RunTrajectoryPanel` 的证据是两套真相
3. 过程数据无法进入 Zerox 已有的学习闭环（`agentLearning` / `evalCandidate` / `trajectory`）——而这是 Zerox 的差异化能力

**第五层 · 战略一致性：这不是追平，是补齐自家论点**

`.zerox/research/zerox-architecture-ui-brief.md` 第 6 节把"完整可观测性（~50 类轨迹事件 + KernelEventBus 实时回放 + Episode 导出证据包）"列为 Zerox 的核心差异化弹药。过程态披露正是把这份弹药从"运行结束后导出"推进到"运行中见证"，是产品自己论点的完成，而非跟风。

### 1.3 一个必须先讲清的张力

v3.9.2 的披露政策是**刻意**的：主对话收纳 Thinking / 工具预览。你的新需求在方向上与它相反。而且它不只是文档约定——**它被一个源级测试锁死了**：

```ts
// src/renderer/materialDesign.test.ts:1644-1650
it("keeps tool and raw reasoning previews out of the main interface", () => {
  expect(chatPanelSource).not.toContain("RuntimeTextDisclosure");
  expect(chatPanelSource).not.toContain("ToolCallPreviewDisclosure");
  expect(chatPanelSource).not.toContain("latestToolCallPreview");
  expect(chatPanelSource).not.toContain("context-thinking-disclosure");
  expect(chatPanelSource).not.toContain("tool-call-preview-block");
});
```

**本方案的立场：保留政策目标，替换实现机制，并显式改政策。**

- 政策目标（主对话不被过程噪音淹没）继续成立；
- 但"收纳"不再等于"藏进右栏"，而是"**以可折叠的过程块内联，按注意力自动决定展开态**"；
- 该测试断言的是**旧的实现形态**（预览组件名），需要随政策一起重写为**新政策的断言**（例如：默认折叠、注意力自动展开、用户偏好可覆盖）。

这正是 `resolveConversationDisclosurePolicy`（`src/shared/conversationDisclosure.ts:1218-1258`）已经建模的东西——地基已经在了。

### 1.4 需求重述（一句话）

> **让过程在回合进行中真正可见（而不是回合结束后一次性出现），把它从渲染层的临时状态升级为运行时的持久事实，让同一份事实同时驱动实时折叠披露、事后复盘与学习闭环；并在不违背"主对话只保留需要用户处理的内容"这一既有承诺的前提下，把关键节点变成可干预窗口。**

---

## 2. 现状盘点（代码证据）

### 2.1 已经存在的地基（比预期好）

| 能力 | 证据 | 判断 |
|---|---|---|
| 已序列化的流式事件 | `src/shared/chat.ts:332-368`（`answer_delta` / `thinking_delta` / `tool_call_preview` / `output_part` / `status` / `waiting_for_input` / 终态 / `attempt_control`） | 有 sequence、attempt 谱系、幂等键 |
| 富结构输出块 | `src/shared/chatOutput.ts:126-140`（14 种 `ChatOutputPart`，含 `tool_call` / `tool_result` / `approval_request` / `file_diff` / `command_output` / `ledger_event`） | 块模型已存在 |
| 工具卡渲染器 + 样式 | `src/renderer/components/chat/OutputPartRenderer.tsx:56-84`；`.chat-tool-card` 样式 `src/renderer/styles/chat.css:805-845` | **UI 和 CSS 都写好了，只是没接上** |
| 输出组装器 | `src/main/chatOutputAssembler.ts:162-230`（`appendToolCall` 增量累积参数、`appendToolResult` 派生结构化部件） | 参数流式累积已实现 |
| reasoning 已从 provider 流出 | `src/main/chatService/streamingStatus.ts:346-383`（`reasoning_delta` → `thinking_delta`；`tool_call_delta` → `tool_call_preview` + `output_part`） | 上游打通了 |
| 事实投影引擎 | `src/shared/conversationDisclosure.ts`（3049 行：事实类型、生命周期、注意力、敏感性、证据指针、快照/delta 游标、世代、覆盖率） | 架构级地基 |
| 披露策略解析器 | `conversationDisclosure.ts:516-528, 1218-1258`（`auto/open/closed/pinned` → `expanded` + `prominence` + `detailMode`） | 正是需要的东西 |
| 持久事件日志 | `src/main/storage/migrationBundle.ts:341-355`（`chat_session_events`） | 事件溯源底座 |
| 实时内核事件桥 | `src/main/kernel/eventBus.ts`（1000 条环形缓冲 + publish/subscribe/stream）；`src/preload/index.ts:521-535`（先回放历史再推实时） | 传输已就绪 |
| 轨迹事件词表 | `src/shared/agentTrajectory.ts:1-63`（~65 类，含 `model_reasoning`）；`src/shared/workspaceRunLedger.ts:74-77`（`reasoning` 事件带 `content`） | 事实源的另一半已存在 |
| 已有投影式披露 UI | `src/renderer/components/AgentChatPanel.tsx:5819-5905`（`ProjectedConversationDisclosure`，含 `aria-expanded` / `aria-controls` / 展开-收起图标） | 迁移中，未成默认 |
| 专用设计令牌 | `src/renderer/styles/tokens.css:107-121`（`--agent-planning/thinking/executing/approval/evidence-*`） | **已声明、零消费者**，可直接用 |

### 2.2 缺口清单（每条都有代码证据）

| # | 缺口 | 证据 | 影响 |
|---|---|---|---|
| **G0** | **回合进行中几乎无实时投递**：`answer_delta` / `thinking_delta` 在主进程累积，只在 `sendAttemptControl`（attempt 开始/重试）与 `sendTerminalEvent`（终态）时 flush | `src/main/chatService/streamingStatus.ts:129,187,300`（仅 2 个 flush 调用点）；行为被测试钉死：`src/main/chatService.test.ts:3723-3732`（两轮输出被合并成**一条** `"I will inspect. Final reply."`）、`:4710-4716`（单轮仅 1 条 delta 且**没有** text `output_part`） | **"实时"这件事今天不存在**；这是本需求的第一性问题 |
| **G0b** | `thinkingText` / `toolCallPreviews` 是**只写状态**，无任何组件读取 | `src/renderer/chatStreamReducer.ts:32-33,304-321` 写入；唯一其他引用是重置 `AgentChatPanel.tsx:1804-1805` | 即使流实时了，这两条也看不见 |
| G1 | **reasoning 不是输出块** | `ChatOutputPart` 联合（`chatOutput.ts:126-140`）无 reasoning 变体 | 无法折叠、无法持久化、无法重放 |
| G2 | **reasoning 被截断与丢弃** | `chatStreamReducer.ts:74`（2000 字符）、`:383-406`（attempt 重置清空）；`src/main/actors/checkpointWriterActor.ts:146-153`（"drop verbose model_reasoning detail"）；状态里的 `思考` 行只是后端 ≤180 字末句摘要（`src/main/chatService/moduleruntime.ts:453-467`） | 重启即失；长思考被腰斩 |
| G3 | **工具/审批被三层过滤器逐层剔除** | ①读路径白名单 `src/shared/chatSessionProjection.ts:4-12`（`chatSessions.ts:302` 应用）②渲染路径 `src/renderer/chatOutputModel.ts:14-24`（`isMainConversationOutputPart`）③进度行 `src/renderer/chatTaskActivity.ts:611-630` | 工具链在会话里彻底不可见，与实时视图不一致 |
| G4 | 披露 delta 通道只有答案 | `conversationDisclosure.ts:404-412`（`channel: "answer"`） | 投影引擎未承载 reasoning/tool/plan |
| G5 | projected 模式非默认 | `src/preload/index.ts:192-195`（仅 `--zerox-chat-disclosure=projected`）、`AgentChatPanel.tsx:422-427` | 新架构空转 |
| G6 | 计划步骤无过程事实 | `src/shared/planMode.ts` 有完整 `PlanRecord`/`PlanMilestone`，但无步骤级流式事实 | 规划过程只能看摘要 |
| G7 | 无 token 级重放 | 事件词表无 chunk 记录 | 无法逐字重放、无法精确统计首字延迟 |
| G8 | 四条并行通道 | `chat:streamEvent` / `chat:statusEvent` / `kernel:event` / `chat_session_events`（`src/shared/ipcChannels.ts:10-14`、`src/preload/index.ts:148-152`） | 事实可能分叉；新增第五条是错误方向 |
| G9 | **完全没有流式视觉状态** | `is-streaming` 类在 `AgentChatPanel.tsx:6685` 应用但 `src/renderer/styles` 中 **0 条规则**；renderer 全域 `aria-busy` / `role="log"` 均为 **0** | 用户无法判断"在跑"还是"卡死" |
| G10 | **渲染性能不足以承载高频 delta** | `AgentChatPanel.tsx:290-311`（`visibleChatMessages` 每次 messages 变化重建**全部**消息对象 → `memo` 全失效）→ `OutputPartRenderer.tsx:182-185`（每次 delta 重新解析增长的 markdown，O(n²)）；滚动副作用在每次 messages 变化时同步读写信箱（`:609-621`）；无虚拟化 / `content-visibility` | **直接开启实时 delta 会卡**，必须与 P0 同时加固 |
| G11 | 离开 `#chat` 即卸载面板，在途 UI 状态与流事件全丢 | `src/renderer/App.tsx:778-789`（条件渲染）；`AgentChatPanel.tsx:894-896,6557-6559` | 切页回来只剩 80 条持久化状态事件 |
| G12 | 无障碍与一致性欠账 | 无 `role="log"`；live region 条件挂载；状态色-only（`AgentChatPanel.tsx:4385-4392,6113-6124`）；`--text-tertiary` 进度文字 ≈2.5:1（低于 AA） | 违反设计系统 `3-2-1:142-153` |
| G13 | **源级测试禁止工具/思考预览进入主界面** | `src/renderer/materialDesign.test.ts:1644-1650` | 治理阻塞，必须显式改政策 |

### 2.3 关键判断

> **不要新增第五条通道，也不要重写渲染层。**
> 正确顺序是：
> **① 让流真正实时（G0）+ 渲染加固（G10）→ ② 把 reasoning/tool/plan 补成一等事实（G1/G3/G6）→ ③ 打开已有投影引擎（G5）→ ④ 重写政策测试（G13）。**
>
> 补充实测：**唯一真正的持久化缺口是 reasoning（G1/G2）。** 工具调用与审批的 `outputParts` 已经落库（`src/main/chatSessionStore.ts:390`），只是在读会话（G3①）和渲染（G3②）时被过滤掉了——那是策略改动，不是存储改造。

---

## 3. 外部参照：抄什么、不抄什么

### 3.1 DSH 的实现机制（源码实测）

安装目录 `@deepseek-ai/dsh/node_modules/@deepseek-ai/`（222 个包），关键机制：

**① 会话事件日志是唯一事实源，且带前向兼容标记**

`dsh-session/lib/types/types.d.ts` 定义 `SessionEventMap`：`turn/start`、`turn/end`、`step/start`、`step/end`、`user/message`、`assistant/chunk`（**原始流式 chunk，为逐字重放保真**）、`assistant/message`（终态）、`tool/call`、`tool/result`、`llm/retry`、`compaction/summary`、`command/run`、`command/done`。每个事件带 `ignorable` 标记（`known-event-types.d.ts`）：读到不认识的类型时，能安全忽略就忽略，不能就拒绝加载——而不是静默丢数据。

**② 存在"模型可见表面"与"人类转录"的显式分离**

`dsh-session/lib/types/surface.d.ts` 明确写道：

> "The model-visible surface deliberately shadows replaced ranges, so it is the wrong source for a human transcript — a landed replacement would erase conversation the user already saw."

这是本方案最关键的一条外部经验：**给模型看的上下文 ≠ 给人看的过程记录。** 两者必须分开投影。

**③ 投影节点把 reasoning 当一等公民**

`dsh-client-ui-conversation/lib/types/client/contract/records.d.ts`：

```ts
export type AssistantBlock =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'image'; attachment: ImageAttachmentRef }
  | { kind: 'tool-call'; callId: string; name: string; argsRaw: string }
  | { kind: 'other'; block: unknown }
```

`AssistantMessageNode` 还带 `usage`、`provenance`、`requestConfig`、`timing{stepStartTime, firstTokenTime, completedTime}`、`interrupted`。

**④ 进行中的工具调用与已完成的工具结果是同一递归类型**

```ts
export interface RunningToolCall { callId; parentCallId?; name; argsRaw; turn; step; time; subCalls }
export type ToolCallBlock = RunningToolCall | ToolResultNode
```

即"调用已发出、结果未到"本身就是可渲染状态，天然支撑实时卡片。

**⑤ 支持轮次内插入人类消息**

`SteeringMessageNode`：人类消息在 turn 运行中从"下一步收件箱"被接纳——这是"可干预"的机制化表达。

**⑥ 同一份事件，多个投影目标**

`dsh-client-ui-conversation`（叙事）与 `dsh-client-ui-trajectory`（证据表格）都从同一事件窗口投影；UI 以 slot 注册，每个 `dsh-client-ui-*` 包是独立可卸载的界面单元。

**⑦ 传输**：HTTP `/api` + fetch 形态处理器，响应按块流式输出（`dsh-client-connection/lib/types/http-bridge.d.ts`）。

### 3.2 AG-UI 协议（业界事实标准）

[AG-UI Events 规范](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/events.mdx) 的事件族几乎与"用户想要的东西"一一对应：

| 事件族 | 成员 | 对应需求 |
|---|---|---|
| Lifecycle | `RunStarted` / `StepStarted` / `StepFinished` / `RunFinished` / `RunError` | 规划过程、步骤边界 |
| Text | `TextMessageStart/Content/End` | 流式回答 |
| Tool Call | `ToolCallStart` / `ToolCallArgs` / `ToolCallEnd` / `ToolCallResult` | 工具调用与参数流 |
| State | `StateSnapshot` / `StateDelta` / `MessagesSnapshot` | 快照+增量同步 |
| Activity | `ActivitySnapshot` / `ActivityDelta`（结构化活动，如 `PLAN`、`SEARCH`） | 规划过程披露 |
| Reasoning | `ReasoningStart` / `ReasoningMessageStart/Content/End` / `ReasoningEnd` + `ReasoningEncryptedValue` | 思考折叠 + 隐私 |
| Subagent | `SubagentStarted` / `SubagentFinished` / `SubagentError`（`subagentRunId` 归属） | 多 Agent 归属 |

两个值得直接吸收的约定：
1. **Reasoning 的隐私立场**：规范明确"surface reasoning signals (e.g., summaries)... without exposing raw chain-of-thought"，并用 `ReasoningEncryptedValue` 承载加密 CoT 以便跨轮延续。Zerox 的 local-first 立场应更严格。
2. **Activity 快照/delta 用 JSON Patch**（RFC 6902）做增量，与 Zerox `conversationDisclosure` 的 upsert/removals 思路一致。

### 3.3 业界 UX 共识

- **折叠默认 + 按需展开**是主流解法。ChatDB 的做法：工作时左栏展示决策/工具，结果出现后左栏折叠为摘要——"让过程充当进度指示器，而不是让用户盯着 spinner"（[LukeW](https://www.lukew.com/ff/entry.asp?2142)）。
- **用户偏好必须可配置**：Claude Code 社区持续要求"工具卡与思考标签默认折叠"（[#73789](https://github.com/anthropics/claude-code/issues/73789)）与"隐藏内部工具调用细节"（[#25156](https://github.com/anthropics/claude-code/issues/25156)），同时也有"思考完成后保持展开"的诉求（[DeepSeek-Reasonix #8732](https://github.com/esengine/DeepSeek-Reasonix/pull/8732)）。→ 单一默认值无法满足，必须给模式开关。

### 3.4 结论：抄什么 / 不抄什么

**抄：**
1. reasoning / tool-call 作为**一等内容块**（DSH `AssistantBlock`）
2. **进行中状态是一等状态**（`RunningToolCall`）
3. **模型可见表面与人类转录分离**（DSH `surface`）——防止过程事实回灌上下文
4. **事件日志 + 前向兼容标记**（`ignorable`）
5. **同一事件、多投影目标**（叙事 / 证据 / 学习）
6. **披露偏好模式**（auto/compact/expanded/pinned）
7. AG-UI 的 Activity 快照/delta 增量同步与 reasoning 隐私立场

**不抄：**
1. **不抄 DSH 的 Cordis slot 体系**——Zerox 是 Electron + React 单体 renderer，引入插件化 slot 是过度设计
2. **不抄 token 级全量持久化默认开启**——对本地 SQLite 是持续写入压力，应做成可选开关
3. **不抄"无限制内联展开"**——会直接违背 v3.9.2 的主对话承诺
4. **不抄 raw CoT 直出**——见 §4.7
5. **不抄"逐 token IPC"**——Zerox 是进程间 IPC，应按时间/字节窗口合并后投递（见 §4.3）

---

## 4. 目标架构

### 4.1 总原则：一份事实源 + 三种投影

```
                     ┌──────────────────────────────┐
   模型流式输出 ───►  │  过程事实源 (Process Facts)   │
   provider events   │  · 有序、有序列号、可持久化    │
   工具执行事件 ───►  │  · 与 chat_session_events 同源 │
   计划/目标事件 ───► │  · 敏感性/脱敏在写入时完成     │
                     └───────────────┬──────────────┘
                                     │  （有界节流投递）
          ┌──────────────────────────┼──────────────────────────┐
          ▼                          ▼                          ▼
  ① 实时披露投影             ② 会话转录投影              ③ 证据/学习投影
  LiveDisclosure             Transcript                 Evidence
  · 折叠块 + 策略             · 人类可读、可重放          · trajectory / episode
  · 注意力路由                · 不含过程噪音               · 学习候选 / eval
  · 干预入口
```

**关键约束（本方案的宪法）：**
- 过程事实**只给人看，不自动回灌模型上下文**。模型上下文仍由既有 context 预算与压缩策略决定。这是对 DSH `surface` 分离的直接采纳，也是防止上下文爆炸的必要条件。
- 所有过程事实在**写入时**完成脱敏（复用 `redactCredentialString` + `redactConversationDisclosurePaths`），不允许"先存原文、展示时再脱敏"。
- 事实源只有一个写入点（每类事实一个 owner），投影只读。

### 4.2 过程事实模型

复用 `conversationDisclosure.ts` 已有的 `ConversationDisclosureFact` 骨架，**只补事实种类，不新建体系**：

| 事实种类 | 现有状态 | 需要补什么 |
|---|---|---|
| `reasoning` | ❌ 不存在 | 新增：`{ partId, turn, text, chars, redacted, truncated, durationMs }` |
| `tool_invocation` | ✅ 已有 | 补 `argsPreview`、`resultPreview`、`durationMs`、`subCalls` |
| `plan_step` | ⚠️ 部分（`plan` 事实 + trajectory `milestone_started`） | 补步骤级 `{ stepId, index, title, status, startedAt, endedAt }` |
| `model_call` | ⚠️ 仅 trajectory | 补 `{ turn, model, firstTokenMs, totalMs, retryOf }` |
| `context_compaction` | ✅ `context` 事实 | 补被压缩范围引用 |
| `steering` | ❌ 不存在 | 新增：轮次内用户插话 |

### 4.3 让流真正实时（P0 的核心）

**问题**：`answer_delta` / `thinking_delta` 被无上限累积，只在 attempt 边界和终态 flush（G0）。

**目标**：改为**有界节流投递**，而不是逐 token 或全量延迟。

```
累积缓冲区 ──(满足以下任一条件即 flush)──► renderer
   · 距上次 flush ≥ 60ms
   · 缓冲字节 ≥ 512B
   · 遇到块边界（text→tool_call、reasoning 结束、output_part 切换）
   · attempt 控制 / 终态（保持现有语义）
```

**必须保持的不变量**（这些是现有测试在保护的东西）：
- `sequence` 单调递增，attempt 谱系语义不变
- flush 只改变投递时机，不改变事件内容与顺序
- `output_part` 与 delta 的相对顺序不变
- 幂等键 `settlementId` / `domainStateAvailable` 语义不变

**需要同步更新的测试**：`src/main/chatService.test.ts` 中 7 处 `answer_delta` 断言（尤其 `:3723-3732`、`:4710-4716`），把它们从"断言合并成一条"改为"断言有界分片且拼接后等于完整文本"。

**渲染侧配套（G10，与 P0 同时做，否则会卡）**：
1. `visibleChatMessages` 不再重建全部消息对象（按消息 id 稳定引用 / 只更新变化的那一条）
2. markdown 解析按 `(partId, 文本版本)` 缓存，或改为增量追加渲染
3. 滚动副作用改为 rAF 节流，避免每次 delta 触发同步 layout 读
4. 给消息 article 加 `content-visibility: auto`（并验证不影响 a11y）

### 4.4 事件词表增量（向后兼容）

**原则：只加不改。** 旧 renderer 必须能忽略新字段/新事件。

1. `ChatOutputPart` 新增 `ChatReasoningPart`（`src/shared/chatOutput.ts`）：
   ```ts
   export type ChatReasoningPart = ChatOutputPartBase & {
     type: "reasoning";
     turn: number;
     text: string;            // 已脱敏
     redacted: boolean;
     truncated: boolean;
     streaming: boolean;
     durationMs?: number;
   };
   ```
   加入 `ChatOutputPart` 联合。旧代码 `switch` 落到默认分支即可。

2. `streamingStatus.emitModelStreamEvent` 在 `reasoning_delta` 时**同时**发 `output_part`（reasoning 块）与保留的 `thinking_delta`（旧 renderer 兼容），双发一个版本后废弃后者。

3. `ChatTaskStatusEvent` 的 `reasoning` 状态改为**只带摘要与 partId**，内容走 `output_part`，消除"摘要与内容两套"的隐患。

4. 工具生命周期沿用现有 `tool_invocation` + `invocationStatus`，补 `durationMs` 与 `subCalls`，不新增事件类型。

5. `chat_session_events` 的 `type` 词表增加 `reasoning` / `plan_step` / `steering`，并引入 `ignorable` 语义（对齐 DSH）：未知类型若可安全忽略则忽略并计数，否则拒绝重建。

### 4.5 披露策略引擎（复用而非新建）

直接用 `resolveConversationDisclosurePolicy`（`conversationDisclosure.ts:1218-1258`），它已经处理了：

- `preference: auto | open | closed | pinned`
- 自动展开条件：`blocking` / `failed` / `blocked` / `completed_unverified` / 各种 `waiting_*`
- 密度控制：`volume > 4` 时更紧凑
- `sensitivity === "restricted"` 时只给证据指针，不给内联细节

**需要补充的规则（本方案新增）：**

| 事实 | 折叠态摘要 | 自动展开条件 |
|---|---|---|
| reasoning | 首行 80 字 + `已思考 Ns` | 从不自动展开（除非用户 pinned 或 `open`） |
| tool_call | `工具名 · 关键参数 · 运行中/成功/失败` | 失败、等待审批、被拒绝 |
| tool_result | `N 字节 · M 行 · 状态` | 失败、含 diff |
| plan_step | `步骤 i/N · 标题 · 状态` | 步骤失败、需要用户决策 |
| model_call | `第 N 轮 · 模型 · 首字 Xms` | 重试、降级、失败 |
| compaction | `已压缩 K 次 · X→Y tokens` | 用户主动查看 |
| steering | 用户自己的插话 | 始终可见 |

**默认值建议**：`auto`。设置页提供四档（自动 / 紧凑 / 展开 / 固定），落到会话级 + 全局默认。

### 4.6 渲染模型：Turn → Process Block

```
Turn 卡片（一个 requestId / turnId）
├── 用户消息
├── 过程块流（按 sequence 排序）
│   ├── [思考] 折叠块          ← ChatReasoningPart
│   ├── [工具] 折叠卡          ← ChatToolCallPart（running → 更新为结果）
│   ├── [工具结果] 折叠卡      ← ChatToolResultPart
│   ├── [审批] 决策卡          ← ChatApprovalPart（阻塞，自动展开）
│   ├── [计划步骤] 步骤块      ← plan_step 事实
│   └── [模型轮次] 进度行      ← model_call 事实
└── 助手答案（流式，始终可见）
```

组件落点（沿用既有结构，不新建体系）：

- 新增 `src/renderer/components/chat/ProcessBlock.tsx`：统一折叠容器，复用既有披露交互契约——`aria-expanded` + `aria-controls` + `expand/collapse` 图标（15px 组 / 14px 行）+ `展开/收起{label}详情` 文案（参考 `AgentChatPanel.tsx:5841-5856,5896-5910`）。
- 扩展 `OutputPartRenderer.tsx`：增加 `reasoning` 分支，并把 `tool_call` / `tool_result` / `approval_request` 包进 `ProcessBlock`（`.chat-tool-card` 样式已存在，直接复用）。
- 扩展 `chatStreamReducer.ts`：`thinkingText` 迁移为 `reasoningParts`（按 turn 归并），移除 2000 字符截断（改为按块上限 + 分页），attempt 重置时按块清空而非整体清空。**注意保持 reducer 在 thinking/tool 事件上不改变 `messages` 引用的现有优点**，否则会连带触发 G10。
- 复用 `projectChatDisclosureGroups` 的分组语义（attention / narrative / operations / context / result），由"分组列表"升级为"块流 + 分组标签"。
- 可直接使用 `tokens.css:107-121` 已声明的 `--agent-thinking/executing/approval/evidence-*` 令牌（当前零消费者）。

**设计系统约束（必须遵守）**：8px 卡片圆角、glass-muted 表面、高级细节默认折叠、`aria-live="polite"`（进度）/ `role="alert"`（错误）、状态不得色-only、无弹跳动画（现代 chat 表面当前 0 keyframes / 1 transition，需保持克制）、WCAG 2.2 AA、390/640/900/1180/1280/1440 无横向溢出（`docs/design/zerox-agent-3-2-1-ui-ux-design-system.md:107-153`）。

### 4.7 干预点设计（这是本方案的价值落点）

| 干预点 | 触发条件 | UI | 动作 |
|---|---|---|---|
| 工具授权 | `invocationStatus === "waiting_approval"` | 对话内联决策卡，自动展开 | 允许 / 拒绝 / 查看完整参数 |
| 计划纠偏 | plan_step 失败或 actionGate 非 ready | 步骤块内联提示 | 调整计划 / 重试 / 终止 |
| 长任务停滞 | 无进展超阈值（现有 `staleStatusThresholdMs = 90_000`） | 进度行内联 | 继续 / 停止 |
| 模型重试/降级 | `model_call.retryOf` 存在 | 进度行内联 | 切换模型 / 中止 |
| 轮次内插话 | 用户主动 | 输入框（可选 P3 后） | 追加约束到当前轮 |

**注意**：干预必须复用既有服务——`ToolAuthorizationService`、`GoalDetailDrawer` 的 review gate、`agentRuns:pause/resume`。**不得新建授权路径**（`AGENTS.md` 边界）。

### 4.8 敏感性与脱敏（reasoning 的特殊处理）

reasoning 是最敏感的过程事实（可能含用户数据、密钥、路径、未公开推理）。策略：

1. **写入即脱敏**：`redactCredentialString` + `redactConversationDisclosurePaths` + 块级长度/行数上限（复用 `sanitizeConversationDisclosureSummary` 机制，阈值放宽）。
2. **默认不落原文**：本地存储默认只保留脱敏后文本；原始 CoT 是否落盘由设置项决定，默认关闭（对齐 AG-UI 的"展示 reasoning summary 而非 raw CoT"立场）。
3. **敏感级别**：reasoning 事实标 `sensitivity: "technical"`，`detailMode` 由策略决定；涉及 `restricted` 时只给证据指针。
4. **不进模型上下文**：见 §4.1 宪法条款。
5. **导出**：`episode:export` 默认包含脱敏后的 reasoning，可选排除。

### 4.9 性能与背压

1. **服务端节流**：§4.3 的有界 flush。
2. **渲染层节流**：reasoning 块在 `streaming` 期间以 `requestAnimationFrame` 批量追加，完成后冻结为静态文本。
3. **引用稳定**：修复 G10 的 `visibleChatMessages` 全量重建。
4. **折叠态不渲染内容**：折叠时只渲染摘要。
5. **预算**：单条 reasoning 块上限（建议 32KB）+ 单轮过程块数上限（建议 200）+ 超限降级为"证据指针"。

---

## 5. 实施路线图

> 顺序是刻意的：**先让流实时、先把渲染加固，再谈折叠与卡片。** 反过来做会得到"卡顿的假实时"。

### P0 · 让流真正实时 + 渲染加固（不改 UI 结构，1 个迭代）

**目标**：回合进行中用户能看到文本与思考在增长，且不卡。

| 动作 | 文件 |
|---|---|
| 有界节流 flush（时间/字节/块边界） | `src/main/chatService/streamingStatus.ts` |
| 更新 7 处 delta 断言为"分片 + 拼接等价" | `src/main/chatService.test.ts` |
| 修复 `visibleChatMessages` 全量重建 | `src/renderer/components/AgentChatPanel.tsx` |
| markdown 解析缓存/增量 | `src/renderer/components/chat/OutputPartRenderer.tsx` |
| 滚动副作用 rAF 节流 | `AgentChatPanel.tsx` |
| 补流式视觉状态（`is-streaming` 样式 + `aria-busy`） | `src/renderer/styles/chat.css`、`AgentChatPanel.tsx:6685` |

**验收**：
- 长回答期间肉眼可见逐段增长；首字可见延迟 < 200ms
- `npm test`（含更新后的 chatService 断言）全绿
- 性能：单轮 20KB 回答的渲染不出现掉帧尖峰（可用现有 `architectureEfficiency.test.ts` 思路补一条断言）
- `npm run smoke:prod` 通过

### P1 · 事实源收口（reasoning 成为一等事实 + 过滤器策略化）

| 动作 | 文件 |
|---|---|
| 新增 `ChatReasoningPart` 并加入联合 | `src/shared/chatOutput.ts` |
| 组装器新增 reasoning 累积器 | `src/main/chatOutputAssembler.ts` |
| `reasoning_delta` 双发 `output_part` | `src/main/chatService/streamingStatus.ts` |
| 三层过滤器改为**策略驱动**（默认仍折叠，但可展开） | `src/shared/chatSessionProjection.ts`、`src/renderer/chatOutputModel.ts`、`src/renderer/chatTaskActivity.ts` |
| **重写治理测试**为"默认折叠 + 注意力自动展开 + 偏好可覆盖" | `src/renderer/materialDesign.test.ts:1644-1650` |
| `chat_session_events` 词表 + `ignorable` 语义 | `src/shared/chat.ts`、`src/main/storage/` |

**验收**：
- reasoning 落库：重启后 DB 中可查到脱敏 reasoning 块
- 治理测试表达的是**新政策**，不是删除
- `npm run verify` 全绿

### P2 · 思考折叠 + 工具卡片（主对话内联，默认折叠）

| 动作 | 文件 |
|---|---|
| `ProcessBlock` 折叠容器 | `src/renderer/components/chat/ProcessBlock.tsx`（新） |
| `OutputPartRenderer` 增加 reasoning 分支 + 包裹工具卡 | `OutputPartRenderer.tsx` |
| reducer：`thinkingText` → `reasoningParts`，取消 2000 字符截断 | `src/renderer/chatStreamReducer.ts` |
| 让只写状态真正被消费 | `AgentChatPanel.tsx:1804-1805` 附近的死状态清理 |
| 披露策略接入（默认 auto） | `AgentChatPanel.tsx`、`conversationDisclosure.ts` |
| 替换"最新思考"单行预览为 per-turn 折叠块 | `AgentChatPanel.tsx:6073-6100` |
| projected 模式灰度（先 flag，后默认） | `src/preload/index.ts:192-195`、`AgentChatPanel.tsx:422-427` |

**验收**：
- `npm run smoke:prod` 通过（UI 变更必须）
- 多视口核对 390/640/900/1180/1280/1440
- 无障碍：`aria-expanded` 正确、阻塞态 `role="alert"`、键盘可达、状态非色-only
- 用户偏好四档可切换并持久化

### P3 · 计划与进度披露 + 干预

| 动作 | 文件 |
|---|---|
| `plan_step` 过程事实 | `src/shared/conversationDisclosure.ts`、`src/main/planRecordDecoder.ts` |
| 步骤块渲染 | `ProcessBlock.tsx` + `AgentChatPanel.tsx` |
| 轮次进度行（turn/maxTurns/elapsed/toolCalls） | `src/renderer/chatTaskActivity.ts` |
| 工具授权内联决策卡 | `OutputPartRenderer.tsx`（`approval_request` 已有）、复用 `ToolAuthorizationService` |
| 停滞/重试干预入口 | `AgentChatPanel.tsx`，复用 `agentRuns:pause/resume` |
| 切页不丢在途状态（可选：把面板状态提升或常驻） | `src/renderer/App.tsx:778-789` |

**验收**：
- Goal / Plan 既有测试零回归；`npm run program:check` 全绿
- 端到端：一次需要审批的工具调用，用户能在对话内完成允许/拒绝，且 `toolAuditLog` 有记录

### P4 · 重放、偏好与学习闭环

| 动作 | 文件 |
|---|---|
| 会话重开用同一事实重建折叠态 | `src/renderer/chatSessionReconciliation.ts`、`chatStreamReducer.ts` |
| 设置页「过程披露」偏好 | Settings 分区 |
| reasoning 事实接入 trajectory / 学习候选 | `src/shared/agentTrajectory.ts`、`src/main/` learning 链路 |
| `episode:export` 包含脱敏 reasoning | `scripts/export-agent-episode.mjs` |
| （可选）token 级 chunk 保真重放 | `src/shared/chat.ts`，默认关闭 |

**验收**：
- 重启后实时视图与 `RunTrajectoryPanel` 证据一致（**一致性即本功能的核心验收项**）
- `npm run episode:export` 产物含 reasoning 且已脱敏
- `npm run verify` + `npm run smoke:prod`

---

## 6. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| **实时视图与持久化不一致** | 摧毁功能本身的信任价值 | P1 先落库再上 UI；一致性作为 P4 硬验收 |
| **主对话刷屏（回退 v3.9.2 承诺）** | 产品决策倒退 | 默认 `auto` + 折叠；密度控制；用户可切紧凑 |
| **治理测试被绕过** | 违反工程纪律 | P1 显式重写 `materialDesign.test.ts` 为**新政策**断言，而非删除 |
| **开启实时 delta 后卡顿** | 体验倒退 | P0 与渲染加固同批交付；性能断言进测试 |
| **reasoning 泄漏敏感信息** | 安全/隐私事故 | 写入即脱敏；原始 CoT 默认不落盘；`sensitivity` 分级 |
| **过程事实回灌模型上下文** | 上下文爆炸、成本失控 | §4.1 宪法条款：过程事实只给人看 |
| **事件词表膨胀导致旧版本读错** | 数据损坏 | `ignorable` 语义 + 只加不改 + schema 版本 |
| **越权新增授权路径** | 违反产品边界 | 干预一律复用 `ToolAuthorizationService` |
| **流式投递语义漂移** | 现有竞态保护失效 | 保持 `sequence` / attempt / 幂等键不变量，测试先行 |

---

## 7. 验收与命令

```bash
npm run harness:check     # 治理面
npm run program:check     # 四个程序检查
npm test                  # 单测（当前 319 文件 / 3815 测试）
npm run typecheck:tests
npm run build
npm run verify            # typecheck + test + build + agent evals + memory evals
npm run smoke:prod        # UI/runtime 变更必跑
```

**本方案特有的验收项：**
1. **实时性**：长回答期间内容持续增长，首字可见延迟 < 200ms。
2. **一致性**：任取一轮对话，实时折叠块、重启后转录、`RunTrajectoryPanel` 证据三者内容一致。
3. **可干预**：一次工具审批在对话内完成，`toolAuditLog` 有对应记录。
4. **不刷屏**：默认设置下，主对话首屏可见内容不因过程块增加而超出基线 X%（建议 ≤ 20%）。
5. **可脱敏**：构造含 API Key / 绝对路径的 reasoning，落库与 UI 均不可见原文。
6. **性能**：单轮 20KB 回答无掉帧尖峰；不出现 O(n²) markdown 重解析。

通过后按 `AGENTS.md` 把改动文件与命令证据写入 `.zerox/progress.md`。

---

## 8. 边界：不做什么

- ❌ 不默认展开原始 CoT（对齐 AG-UI 的 reasoning 隐私立场）
- ❌ 不把工具结果全文塞进主对话（折叠态只给摘要）
- ❌ 不新增第五条并行事件通道（复用 `chat_session_events` + `conversationDisclosure`）
- ❌ 不做逐 token IPC（按时间/字节窗口合并投递）
- ❌ 不引入 DSH 的 Cordis slot 插件体系（Electron + React 单体，过度设计）
- ❌ 不绕过 `ToolAuthorizationService` 或工作区沙箱（`AGENTS.md` 硬边界）
- ❌ 不引入云 worker 或未审核自修改（`AGENTS.md` 硬边界）
- ❌ 不让过程事实自动进入模型上下文
- ❌ 不在本方案内改动 Kernel 迁移的 production cutover 标志
- ❌ 不删除 `materialDesign.test.ts` 的守卫，而是把它改写为新政策

---

## 附录 A：关键文件索引

| 文件 | 作用 |
|---|---|
| `src/shared/chat.ts` | 会话/流式事件/状态事件契约 |
| `src/shared/chatOutput.ts` | 结构化输出块（14 种，待加 reasoning） |
| `src/shared/chatSessionProjection.ts` | 转录投影白名单（过滤器 ①） |
| `src/renderer/chatOutputModel.ts` | 渲染投影过滤器（过滤器 ②） |
| `src/shared/conversationDisclosure.ts` | 事实投影引擎 + 披露策略解析器 |
| `src/shared/agentTrajectory.ts` | ~65 类轨迹事件词表 |
| `src/shared/workspaceRunLedger.ts` | 工作区运行账本（含 reasoning 事件） |
| `src/shared/toolInvocationLedger.ts` | 工具调用账本与状态机 |
| `src/shared/featureFlags.ts` | 特性开关注册表（新增开关必须登记） |
| `src/shared/ipcChannels.ts` | IPC 通道注册表（含漂移守卫） |
| `src/main/chatService/streamingStatus.ts` | 状态/流式事件发射与**合并**（G0 所在） |
| `src/main/chatOutputAssembler.ts` | 输出块组装与脱敏 |
| `src/main/kernel/eventBus.ts` | 内核事件总线（环形缓冲 + 回放） |
| `src/main/storage/migrationBundle.ts` | SQLite schema（`chat_session_events` 等） |
| `src/renderer/chatStreamReducer.ts` | 流式状态归约（G0b/G1/G2 所在） |
| `src/renderer/chatTaskActivity.ts` | 任务活动投影（过滤器 ③） |
| `src/renderer/components/AgentChatPanel.tsx` | 主交互面板（7171 行，G10/G11 所在） |
| `src/renderer/components/chat/OutputPartRenderer.tsx` | 输出块渲染器 |
| `src/renderer/materialDesign.test.ts` | 治理守卫（G13 所在） |
| `src/renderer/styles/tokens.css` | `--agent-*` 专用令牌（未使用） |

## 附录 B：外部参考

- [AG-UI Protocol · Events](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/events.mdx) — 事件族与 reasoning 隐私立场
- [LukeW · Showing the Work of Agents in UI](https://www.lukew.com/ff/entry.asp?2142) — 过程展示与渐进披露的取舍
- [Claude Code #73789](https://github.com/anthropics/claude-code/issues/73789) / [#25156](https://github.com/anthropics/claude-code/issues/25156) — 折叠默认与偏好诉求
- [DeepSeek-Reasonix #8732](https://github.com/esengine/DeepSeek-Reasonix/pull/8732) — 思考保持展开模式
- DSH 安装包源码：`@deepseek-ai/dsh-session/lib/types/{types,surface,known-event-types}.d.ts`、`@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/records.d.ts`、`@deepseek-ai/dsh-client-ui-trajectory/lib/types/client/trajectory-event-projection.d.ts`
