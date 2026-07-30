# Zerox Agent 3.8.0：Debate 完整用户路径与严格验收矩阵

日期：2026-07-30
状态：3.8.0 发布门禁
适用范围：Goal Mode 下的 Direct 与 Debate Plan；普通 Chat 和已经创建的 Goal Run 不在此状态机内

## 1. 核心不变量

1. **Plan 记录决定模式，开关不决定权限。** 一个会话存在活动的执行前 Plan 时，后续输入只能进入该 Plan。
2. **确认前绝不执行。** Plan 生命周期没有 Shell、文件修改、测试执行、Actor/Workflow、记忆写入或未知动态工具的降级通道。
3. **修改就是新 revision。** 对 `awaiting_input` 或 `awaiting_confirmation` Plan 的输入，会使旧有效轮次、终版与投影失效，再从头执行只读规划。
4. **失败不会旁路。** 轮次失败后只能重试失败角色、替换该角色模型或丢弃；普通 Agent、技能和写入工具不得接管输入。
5. **确认是显式且幂等的。** 只有 `ready` Plan 的确认按钮可以创建新的可写 Goal Run；聊天中输入“确认”不等于确认。
6. **执行后不可抹除。** 一旦 Plan 关联 `executionGoalId` 或 `executionRunId`，无论 Goal 成功、失败、取消或预算耗尽，都不能丢弃原 Plan。
7. **真实终态不可美化。** Token/时间预算耗尽、运行错误和取消必须分别显示失败/取消，不得发出 completed 终态。
8. **重启不改变状态。** 会话切换、应用重启、设置变化和 Goal Mode 开关变化，都不能解除活动 Plan 的输入锁与冻结模型绑定。
9. **只有确认或丢弃可以退出。** “取消”只中断当前规划运行并保留审计记录与只读输入锁，不能把下一条消息放回普通 Chat。

## 2. 状态与输入路由

| 当前状态 | Composer | 用户输入 | 允许动作 | 下一状态/结果 |
| --- | --- | --- | --- | --- |
| 无 Plan | 可用 | 普通消息或 Goal 请求 | Chat；或创建 Direct/Debate Plan | 普通回复；或 `drafting` |
| `drafting` | 禁用 | 不接受普通输入 | 等待、取消、丢弃 | 继续规划；取消后仍锁定；或 `discarded` |
| `awaiting_input` | 可用，标记“补充计划” | 文字、文本附件 | 只读重规划 | `awaiting_input/awaiting_confirmation/paused` |
| `awaiting_confirmation` | 可用，标记“修改计划” | 修改意见 | 旧输出失效，完整只读重规划 | 新 revision |
| `paused` + 有终版 | 可用，标记“修订门禁” | 风险处理或补充信息 | 完整只读重规划 | 新 revision |
| `paused/failed` + 失败轮次 | 禁用 | 不得进入普通 Chat | 重试失败轮次、换该角色模型、丢弃 | `drafting/paused/discarded` |
| `canceled` | 禁用 | 不得进入普通 Chat | 查看审计、显式丢弃 | `discarded` |
| `confirmed_pending_execution` | Plan 输入锁结束 | 不再修改 Plan | 恢复同一幂等确认事务 | `executing` |
| `executing` | Goal UI | Goal 反馈与恢复 | Goal 状态机 | `completed/failed/canceled` |
| 已执行终态 | 普通输入按 Goal/Chat 规则 | 不修改来源 Plan | 查看审计、恢复 Goal | 保留 Plan 来源关系 |
| `discarded` | 普通输入恢复 | 新消息 | Chat 或创建新 Plan | 新生命周期 |

`awaiting_confirmation` 中输入“确认”“继续执行”仍被视为计划修改意见。执行授权必须来自版本、哈希、证据和工作区漂移校验后的显式确认动作。

## 3. Debate 轮次与恢复路径

### 正常路径

`A1 → B1 → A2 → B2 → C → awaiting_confirmation`

- A/B 各恰好两次有效发言，C 每个 revision 恰好一次有效综合。
- 每轮拥有独立 `runId`、消息历史和轨迹。
- C 只读取匿名化任务契约、证据与 A/B 公开结构化输出。
- 同一模型档案可绑定多个角色，但上下文仍必须隔离。

### 失败路径

- A1 失败：只可重试 A1；A2、B1、B2、C 均不存在。
- B1 失败：A1 保留；重试 B1 时 B1 及其下游失效。
- A2/B2/C 失败：已完成的上游保留；从失败轮次定点恢复。
- 更换模型只更新失败角色的请求绑定；已冻结的其他角色绑定不变。
- 同一结构化轮次允许一次格式修复；第二次无效则 fail-closed，错误中不保存原始私有输出。
- 取消正在运行的轮次必须持久化 `canceled`，运行中 round 变为 `invalidated`，不能遗留 `running`。
- `canceled` 仍属于执行前 Plan 生命周期；会话输入锁持续存在，直到用户显式丢弃该 Plan。

### 修改路径

用户对 `awaiting_input`、`awaiting_confirmation` 或“有终版但被门禁暂停”的 Plan 输入反馈时：

1. 持久化用户消息，但不做 Skill 发现、记忆写入或普通 Agent 路由。
2. 将补充信息和受信文本附件加入任务契约输入；附件指令仍按不可信数据处理。
3. 重新采集有界只读证据。
4. 将旧有效 rounds 全部标记为 `invalidated`。
5. 清除旧 `finalArtifact` 与可信 projection 引用。
6. 使用冻结绑定重新运行完整 Direct 或 Debate 协议。
7. 新投影、哈希和结构化记录一致后才可再次进入 `awaiting_confirmation`。

## 4. UI 权限与可见性

- 活动 Plan 时 Goal Mode 开关保持选中且禁用，不能通过开关退出。
- 工作区选择禁用；Plan 始终使用创建时冻结的工作区。
- 取消运行后仍保持上述锁定；取消不是退出模式的替代入口。
- 普通 Skill 选择器、Skill mention 菜单与普通执行提示隐藏。
- 新建 Plan 时选中的 Skill 只提供只读规划上下文；Skill 的执行期必填参数推迟到确认后的 Goal。会话进入 Plan 后，更早遗留的 Skill 输入请求立即作废。
- `awaiting_input` 和 `awaiting_confirmation` 显示输入后果；失败轮次时 Composer 禁用。
- 默认只展示终版和当前门禁。轮次、证据、Claim Ledger、少数意见与模型绑定折叠展示。
- `丢弃计划` 仅在从未进入执行时可用。
- `确认计划` 仅在 `awaiting_confirmation + ready + projection/hash 一致` 时可用。
- 失败的 AgentLoop 显示“任务未完成”，右侧活动、消息终态、会话恢复和 Token 统计保持一致。

## 5. 验收用例

### 输入归属

- **DP-01**：Goal 开关关闭时，`awaiting_input` 的下一条消息仍进入 Plan。
- **DP-02**：手动选择 Skill 后发送补充信息，不调用 Skill discovery、普通模型或 Tool Executor；新建 Plan 也不因 Skill 的执行期必填参数进入执行输入流程。
- **DP-03**：文本附件随补充信息进入 Plan，附件内容不获得系统指令权限。
- **DP-03a**：Plan Mode 拒绝图片或其他无法纳入受信文本契约的附件，且失败发生在 Plan/聊天记录持久化之前。
- **DP-04**：`awaiting_confirmation` 收到修改意见，创建新 revision 并失效旧轮次。
- **DP-05**：失败轮次收到 Composer 输入，不启动普通 Agent，返回重试/丢弃指引。
- **DP-06**：切换会话再返回、应用重启后，DP-01 至 DP-05 行为不变。
- **DP-07**：只有显式丢弃后，新消息恢复普通 Chat；取消后仍锁定在当前 Plan，其他会话不受影响。
- **DP-07a**：Plan 创建前遗留的 pending Skill input 在 Plan 激活后作废，提交它不能启动 Skill 或 AgentLoop。

### Debate 与恢复

- **DP-08**：顺序固定为 A1、B1、A2、B2、C，A/B 各最多两次。
- **DP-09**：五轮 runId/历史隔离，C 输入不包含 Profile ID、私有轨迹或凭证。
- **DP-10**：B1 失败后替换模型重试，只失效 B1 及下游。
- **DP-11**：C 格式错误只在同一隔离轮修复一次，不重放 A/B。
- **DP-12**：取消进行中的轮次后 Plan 为 `canceled`，不存在 running round；应用重启后仍锁定，直到显式丢弃。
- **DP-13**：Ready Plan 修改后，旧终版与投影不再可确认。

### 确认、执行与终态

- **DP-14**：非 ready、版本变化、哈希不一致、证据或工作区漂移均阻止确认。
- **DP-15**：双击确认、重复 IPC 与崩溃恢复只创建同一个 Goal/Run。
- **DP-16**：确认后创建新的可写 Goal Run，不升级 Plan Run。
- **DP-16a**：确认校验与 Goal 创建完成前，renderer 和主进程都不提升工具权限；只有新的 Goal Run 实际激活后才开启可写能力。
- **DP-17**：已关联执行 Goal 的 Plan 在 Goal 失败后仍不可丢弃。
- **DP-18**：AgentLoop Token 预算耗尽发出 failed，不发 completed。
- **DP-19**：失败消息、右侧活动、会话恢复、工具数和 Token 数采用同一运行期事实。
- **DP-20**：取消与超时分别显示 canceled/failed，不显示任务完成。

### 权限与持久化

- **DP-21**：工具可见性、授权服务和执行器三层分别拒绝 Plan 写入。
- **DP-22**：未知动态工具 fail-closed。
- **DP-23**：投影 Writer 阻止路径穿越、符号链接和工作区逃逸。
- **DP-23a**：证据采集对 `realpath` 后逃出工作区的符号链接 fail-closed。
- **DP-24**：JSON 与 SQLite Store 的 revision、事件和恢复语义一致。
- **DP-25**：Plan Record、Markdown 投影和哈希不一致时不可确认。
- **DP-26**：缺失或未知 `actionGate` 一律按 `blocked` 处理，不能因模型字段缺失进入 ready。
- **DP-27**：同一连接超过 20 次配置修订后，较早 Plan 冻结的 binding 仍可解析原端点与原凭证。
- **DP-28**：Provider 类型不可在原 Connection 上变更；legacy 配置切换 Provider 时不得继承或转发旧 Provider 密钥。
- **DP-29**：不声明 `environmentKey` 的 Provider 拒绝 environment 凭证来源。

## 6. 发布证据

发布前必须同时保留以下证据：

```text
focused Plan/Chat/Renderer/permission tests
npm test
npm run build
npm run verify
npm run smoke:prod
npm run harness:check
git diff --check
真实 Electron：
  创建 Debate → 等待补充 → 关闭 Goal 开关尝试 → 输入补充
  Ready 后输入修改 → 再次 Ready → 显式确认
  轮次失败 → 换模型重试
  执行预算耗尽 → failed 呈现与 Token/工具计数一致
  重启应用 → 活动 Plan 输入锁与恢复入口仍正确
```

任何一项失败都不得把 P53 标记为完成。
