# Zerox Agent 3.8.0：多服务商模型系统与 Plan Debate

日期：2026-07-30
状态：实现基线
外部参考：OpenWorker `f96ad4c8e6865f0aec519681a3717b6bcdd81546`

## 1. 产品边界

3.8.0 把 Goal Mode 改造成“先规划、后执行”的受控入口。普通 Chat 与 Max Mode 不变。Goal 请求先生成 `PlanRecord`，用户只可确认状态为 `ready`、版本与哈希均匹配且工作区未漂移的计划；确认后创建新的可写 Goal Run，绝不把只读 Plan Run 原地升级。

多 Agent Debate 是执行前的 Deliberation Gate，不是自由群聊、人格扮演、多数表决或隐藏推理展示。它用于暴露错误、验证关键主张、保留少数意见，并在证据不足时选择询问、阻断或拒绝执行。

## 2. 不可违反的原则

- 证据优先于语言流畅度、置信表达与共识。
- 先隔离生成，再交换结构化公开结果；不共享隐藏推理、凭证、Provider sidecar 或原始私有轨迹。
- 共识不等于正确；`PlanActionGate` 独立表达 `ready | needs_input | blocked`。
- 使用 Claim Ledger 管理主张、证据、反例、条件、置信度与验证状态。
- 讨论权与执行权分离；Plan Agent 没有任务执行或文件写入权限。
- A/B/C 即便绑定同一模型档案，也必须拥有独立 `runId`、消息历史和轨迹。
- 失败必须可见并暂停；不可静默跳过、自动降级或替换模型。

## 3. 多服务商模型架构

```text
Provider Descriptor Registry
          ↓
Provider Connection + safeStorage
          ↓
Curated Model Matrix
          ↓
Stable Model Profile
          ↓
Resolved/Frozen Model Binding
          ↓
Provider Router + Adapter
```

### Provider Descriptor

共享层只暴露可序列化的 `ProviderDescriptor` 与 `ProviderField`。Settings 根据字段、条件显示、choices 和 secret 标记动态渲染表单。主进程独占认证解析、Client Factory 和凭证访问。未知 Provider fail-closed。

首版覆盖 OpenAI、Anthropic、Gemini、Bedrock、Vertex、Z AI、DeepSeek、Kimi、MiniMax、Qwen、xAI、Mistral、Meta Model API、Together、Fireworks、OpenRouter 与 Ollama。OpenAI 可配置兼容端点；Ollama 规范化 `/v1` 并通过 `/api/tags` 做 30 秒可用性探测。

### Connection、Profile 与 Router

- 同一 Provider 可有多个 `ProviderConnection`，由稳定 `connectionId` 区分账号、区域和代理。
- secret 由 Electron `safeStorage` 加密；renderer、日志、Plan 和轨迹只见 `hasCredential`、来源与设置时间。
- `ModelProfile.id` 是持久化与运行绑定的唯一标识；`provider:model` 仅用于展示和导入兼容。
- Client 缓存键为 `connectionId + revision`，不包含 secret。
- Plan Round 冻结 `ResolvedModelBinding`；配置更新不会改变已经开始的 Debate。
- v1→v2 迁移原子、幂等，保留原 Provider、Base URL、Chat/Embedding model 与连接内凭证。

## 4. Debate 协议

固定状态机：

```text
A1 初版提案
  ↓
B1 对抗质疑与优化建议
  ↓
A2 逐项接受、拒绝或修订
  ↓
B2 残余风险、未决争议与少数意见
  ↓
C  独立、匿名化终版综合
```

A/B 各最多两次有效发言，C 在每个 Debate revision 中只综合一次。C 使用全新上下文，仅读取任务契约、证据和 A/B 的公开结构化输出。

重试失败角色时可替换其模型；重跑已完成轮次会增加 revision，并使全部下游轮次、终版和投影失效。计划只有在结构化记录、Markdown 投影与哈希一致后才能进入 `awaiting_confirmation`。

### 会话输入归属

一个会话只要存在尚未进入执行且未丢弃的 Plan，该 Plan 就是该会话后续输入的唯一接收者。Goal Mode 开关只是创建入口和状态展示，不能作为退出 Plan Mode 的权限开关。

- `awaiting_input`：文字与文本附件作为补充信息，重新执行完整只读规划。
- `awaiting_confirmation`：新输入视为修改意见，旧轮次、终版与投影全部失效后生成新 revision。
- `drafting` 或无终版的失败/暂停状态：输入不得落入普通 Chat；用户只能等待、重试失败轮次或丢弃。
- `canceled`：只表示本轮规划运行已中断，Plan 与会话输入锁继续保留；用户必须显式丢弃后才能回到普通 Chat。
- 用户只有明确确认并进入新的 Goal Run，或明确丢弃 Plan，才会离开该只读规划生命周期。
- 输入“确认”不会替代显式确认按钮；输入“继续执行”也不会绕过门禁。
- 应用重启、页面切换、Goal Mode 开关变化和模型设置变化都不能改变以上输入归属。

完整状态、动作与验收矩阵见
[`zerox-agent-3-8-0-debate-user-path-acceptance.md`](./zerox-agent-3-8-0-debate-user-path-acceptance.md)。

## 5. Plan 权限边界

Plan Run 的能力白名单只包含工作区、代码、Git、运行历史和记忆的只读查询，以及已授权网页搜索。以下三层均执行不可覆盖的硬门禁：

1. 动态工具可见性：隐藏不在 Plan allowlist 的工具。
2. `ToolAuthorizationService`：拒绝 Shell、写入、测试执行、Actor/Workflow、记忆写入和未知工具。
3. `AgentToolExecutor`：在执行边界再次 fail-closed。

Plan Agent 不直接拥有文件写权限。主进程 `PlanArtifactWriter` 是唯一投影写入器，仅可原子写入 `.zerox/plans/<planId>.md`，并防护路径穿越、符号链接与工作区逃逸。

## 6. 持久化与确认

应用内结构化 `PlanRecord` 是唯一可信源，Markdown 只是可审阅投影。JSON 与 SQLite Store 使用相同接口、乐观版本控制和事件语义。

确认顺序：

1. 校验 `ready` gate、状态、`expectedVersion` 和终版哈希。
2. 重新验证文件、Git 与工作区证据，阻止漂移。
3. 写入幂等的 `confirmed_pending_execution`。
4. 以稳定 ID 创建新的可写 Goal Run，并保存 `sourcePlanId/version/hash`。
5. 重复确认或崩溃恢复只能得到同一个 Goal/Run。

确认过程中不预先提升 renderer 或主进程的工具权限。只有上述事务校验成功、来源关系已经持久化且新的 Goal Run 实际激活后，Goal Controller 才能开启可写能力。

活动或待确认计划引用的 Connection/Profile 不可删除；普通设置修改不改变计划中已冻结的绑定。

进入执行后的 Plan 只保留来源和审计关系。即使对应 Goal Run 失败、取消或预算耗尽，也不能把原 Plan 丢弃后伪装成“从未执行”；恢复和重试必须发生在 Goal 生命周期中。

## 7. UI 规范

- Settings 保留现有导航，模型区域由连接列表、Descriptor 表单、临时连接测试、模型档案、自定义模型、隐藏模型和默认 Chat/Embedding 档案组成。
- Goal Mode 提供 Direct/Debate；Debate 可分别选择 A/B/C Chat Profile，只有一个可用档案时自动统一绑定。
- 运行中显示角色、轮次、Provider、模型、耗时、状态与失败恢复入口。
- 默认展示 C 的终版计划；A/B 输出、Claim Ledger、证据、采纳情况和少数意见进入折叠审计区。
- 活动 Plan 会锁定 Goal Mode 的视觉状态、工作区选择与普通技能入口；可接受修改时 Composer 明确显示“输入将重新规划”，失败轮次时 Composer 禁用并指向重试/丢弃入口。
- 执行状态必须使用真实终态。预算耗尽、运行超时和 AgentLoop 失败显示“任务未完成”，不得显示“任务完成”，工具数和 Token 数以运行期计数为准。
- 样式继续遵循 Obsidian 设计规范：复用语义 token、清晰 focus-visible、最小触控目标、390–1440px 响应式，不引入原始颜色值。

## 8. 安全与验收

验收覆盖 Descriptor、所有 Provider 合约、认证隔离、矩阵、Custom/Hidden 模型、路由冻结与缓存失效、v1→v2 迁移、Debate 顺序/隔离/重试、三层权限阻断、投影安全、确认幂等与漂移、IPC/preload/UI 回归。

发布门禁：

```text
focused tests
npm test
npm run build
npm run verify
npm run smoke:prod
npm run harness:check
git diff --check
```
