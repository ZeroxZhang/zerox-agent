# 大模型官方桌面 Agent 调研简报（外部调研·第一辑）

- **调研时间**：2026-07-12 15:16 CST（以本机时间为准）
- **调研范围**：Claude Desktop / Claude Code / Cowork；ChatGPT 桌面 App / Atlas / Operator（已停运）；GitHub Copilot；Google Gemini CLI / Antigravity
- **用途**：为《Zerox Agent 与主流桌面端 AI Agent 对比》公众号文章收集对比素材
- **说明**：除官方文档（标注"官方"）外，其余来源为第三方报道/社区文档，关键数字均已标注来源与时间；未交叉验证处明确标注"未验证"。

---

## 1. Claude Desktop App / Claude Code / Claude Cowork（Anthropic）

### 定位与目标用户
- **Claude Code**：终端优先的 agentic 编码 agent，2025 年 2 月发布，面向专业开发者；2026 年已有 CLI、VS Code/JetBrains 插件、**独立桌面 App（macOS/Windows，GA，含多项目 session 管理与 GUI 环境管理）**、Web（claude.ai/code，云端沙箱、无本地文件系统）、Agent SDK、GitHub Action/App 等多个分发面。
  来源：第三方特性参考文，2026-05-16，https://hidekazu-konishi.com/entry/claude_code_features_settings_reference_2026.html
- **Claude Cowork**：2026 年 1 月以 research preview 嵌入 Claude Desktop App，2026 年 2 月 10 日扩展到 Windows，2026 年 4 月 GA 至全部付费计划。面向知识工作者：授权一个本地文件夹后，Claude 在**隔离 VM** 中自主规划执行多步任务（整理文件、生成报告、定时任务）。2026 年 3 月新增 Dispatch（手机远程派任务到桌面）。
  来源：igenultra 博客，2026-04-05，https://www.igenultra.com/blog/claude-code-anthropic-ai-in-2026-1775391114 ；suprmind 特性页，2026-05-07，https://suprmind.ai/hub/claude/features/
- **Computer Use**：2026 年 4 月起面向 Pro/Max 用户的 research preview，直接看屏、操控鼠标键盘操作本机任意 App（Mac 优先）。来源：seohq，2026-04-01，https://seohq.github.io/anthropic-claude-computer-use-agent

### 架构（本地优先 vs 云端）
- Claude Code CLI/桌面 App **在本机执行工具**（读本地代码库、跑 shell、改文件），模型推理在 Anthropic 云端；Web 版（claude.ai/code）则是纯云端沙箱、不碰本地文件。
- Cowork 官方称**对话历史存储在本机**、仅访问显式授权的文件夹、删除文件需用户批准；agent 在隔离 VM 内运行。来源：igenultra 博客（转述 Anthropic 隐私说明），2026-04-05。
- 但 Cowork 早期被报道存在"未经预先审查就修改文件"的行为，官方建议先备份。来源：suprmind，2026-05-07。

### 权限/授权模型（重点）
Claude Code 有四种 permission mode（来源：hidekazu-konishi 参考文，2026-05-16）：

| 模式 | 行为 | 进入方式 |
|---|---|---|
| Default | 每次工具调用按 ask/allow/deny 规则评估 | 会话默认 |
| Auto-Accept Edits | 编辑不再询问，其他工具仍按规则 | Shift+Tab 一次 |
| Plan Mode | 只读（允许 Read/Glob/Grep/WebFetch/WebSearch，禁止 Edit/Write/Bash），ExitPlanMode 提交计划供批准 | Shift+Tab 两次 / `--permission-mode plan` |
| Bypass Permissions | 跳过全部权限（仅限沙箱环境），`--dangerously-skip-permissions` | 显式 flag |

- 2026 年 3 月推出 **Auto mode**：由模型分类器代替用户做批准决策——安全动作自动放行，风险动作拦截并升级给用户；默认信任本地 git 工作目录与已配置 remote，其余资源（公司代码托管、云存储、内部服务）一律视为外部不可信，管理员需显式配置 trusted infrastructure。Team 计划可用且需管理员批准。来源：Help Net Security，2026-03-25，https://www.helpnetsecurity.com/2026/03/25/anthropic-claude-code-auto-mode-feature/
- 2026 年 6 月强化：`autoMode.classifyAllShell` 把所有 bash/PowerShell 命令路由进 auto-mode 分类器，拒绝原因写入 transcript 与 /permissions（此前是黑盒）；新增 `sandbox.credentials` 阻止模型读取磁盘上的凭据文件。来源：oday-bakkour changelog 汇总，2026-06-28，https://oday-bakkour.com/blog/ai-coding-roundup-june-28-2026

### 记忆与自我改进
- 双轨记忆（suprmind，2026-05-07）：① **Chat memory**——从对话提炼摘要跨会话携带，Settings → Capabilities → Memory 可查看编辑，2025-09 上面向 Team/Enterprise，2026-03 上面向 Free；② **文件系统记忆**——agent 往 `/memory` 文件夹写笔记，会话开始时读取，有 auto-memory 模式让 Claude 自行决定存什么；Opus 4.7 专门改进了文件记忆在长程多会话任务中的可靠性。
- Claude.ai 级记忆是**服务端存储、账号级**，默认开启，可逐条删除/清空，Temporary Chat 不产生记忆；**不适用于 API 与 Claude Code**（Claude Code 靠 CLAUDE.md 项目记忆 + 文件记忆）。来源：lumichats 指南，2026-03-25，https://lumichats.com/blog/claude-memory-2026-complete-guide-how-to-use
- 数据政策：2025 年 8 月起未 opt-out 训练的会话数据保留延长至 5 年（与 active memory 分开）。来源：suprmind。

### 可观测性（轨迹/回放/评测）
- 本地 session 存储结构（社区安全指南，2026-02-02，https://github.com/gabrielbelli/claude-best-practices）：
  ```
  ~/.claude/sessions/<session-id>/
  ├── transcript.json      # 完整对话 + 工具调用
  ├── snapshots/           # 编辑前文件快照
  └── metadata.json
  ```
  可通过 `/resume` 复查、导出用于合规。
- **Checkpoint & rewind**：每次编辑前快照文件，Esc 两次回退到上一个 checkpoint，可逐文件恢复；2026 年 6 月新增 `/rewind` 命令（/clear 后可恢复会话分支）。来源：joinnextdev，2026-06-27，https://www.joinnextdev.com/blog/claude-codes-rewind-lands-5-updates-that-matter
- **OpenTelemetry**：可导出 session 数、编辑行数、commits、PR、token 用量、成本、tool decision 事件到任意 OTLP 后端；v2.1.193（2026-06-25）新增 `claude_code.assistant_response` 日志事件。Hooks（PreToolUse/PostToolUse）可写审计日志。来源：generalanalysis 指南，2026-05-22，https://generalanalysis.com/guides/claude-code-control-observability-opentelemetry
- 官方 Agent SDK 可观测性文档：https://code.claude.com/docs/en/agent-sdk/observability （官方，2026-07-03 抓取）
- 局限：`--resume` 绑定绝对路径，项目移动后失效；原生轨迹面向"审计/合规"，没有面向用户的结构化回放 UI 或内置评测框架（第三方 Entire CLI 才提供路径无关 checkpoint 与跨 agent 回放）。来源：cc.bruniaux.com 指南，2026-01-17，https://cc.bruniaux.com/guide/observability/

### 模型支持
- 仅 Anthropic 自家模型：Opus 4.6/4.7/4.8（Bedrock/Vertex/Foundry 已默认 Opus 4.8）、Sonnet 4.6、Haiku 4.5；1M token 上下文、agent teams、auto mode、computer use。来源：CometAPI，2026-04-14；releasebot 汇总 Anthropic 2.1.207 release notes，2026-07-11，https://releasebot.io/updates/anthropic

### 定价/开源
- Free $0（无 Claude Code）→ Pro $20/月（$17 年付）→ Max 5x $100/月 → Max 20x $200/月；Team Premium $125/seat 含 Claude Code。来源：Anthropic 官方支持页，2026-05-20 更新，https://support.claude.com/en/articles/11049762-choose-a-claude-plan
- 重度 agent 使用成本极高：社区估算 Max 20x 用户月消耗等效 API 价值约 $570（未验证，The Register 转述），导致 Anthropic 持续收紧周配额；2026 年 4 月 21 日曾**无预告测试将 Claude Code 从 Pro 移除**（仅 2% 新用户受影响但定价页全站改动），引发强烈反弹后数小时内回滚——暴露订阅制定价不透明与锁定风险。来源：Ars Technica，2026-04-23，https://arstechnica.com/ai/2026/04/anthropic-tested-removing-claude-code-from-the-pro-plan/ ；implicator.ai，2026-04-22
- Claude Code **闭源**；Agent SDK（TS/Python）开源可嵌入。

### 2025-2026 重大动态
- 2026-01：Cowork research preview（macOS）；02-10 上 Windows；04 月 GA。
- 2026-03：Auto mode；Dispatch（手机派任务）；记忆面向 Free 开放。
- 2026-04：Pro 移除 Claude Code 定价测试风波；Computer Use preview。
- 2026-06：`/rewind`、`sandbox.credentials`、OTel 日志事件、agent teams 成熟。

---

## 2. ChatGPT 桌面 App / Atlas / Operator（OpenAI）

### 定位与目标用户
- **Operator**（2025-01 research preview，CUA 云端浏览器 agent）已于 **2025-08-31 停运**，被 ChatGPT Agent（2025-07-17）与 Atlas agent mode 取代。来源：o-mega.ai 评测，2025-12-17，https://o-mega.ai/articles/top-10-browser-use-agents-full-review-2026
- **ChatGPT Atlas**：Chromium 内核 AI 浏览器，2025-10-21 macOS 首发免费，agent mode 面向 Plus/Pro/Business；**2026-08-09 将停止服务**，浏览器 agent 能力并入 ChatGPT 桌面 App 与 Codex。来源：OpenAI 官方 release notes，2026-07-09 抓取，https://help.openai.com/en/articles/12591856-chatgpt-atlas-release-notes
- **新 ChatGPT 桌面 App（2026-07-09 全球发布，macOS/Windows）**：合并 Chat + **ChatGPT Work**（长任务 agent：跨 App/文件研究分析、产出文档/表格/PPT，支持 Scheduled Tasks 定时/触发/监控）+ **Codex**（编码 agent）。旧版保留为 "ChatGPT Classic"。来源：OpenAI 官方 release notes，2026-07-09，https://help.openai.com/en/articles/6825453-chatgpt-release-notes ；官方博客 https://openai.com/index/chatgpt-for-your-most-ambitious-work/

### 架构（本地优先 vs 云端）
- 混合：桌面 App 本地运行，**Work 在用户许可下可使用本地文件与桌面 App**，内置浏览器访问网页；模型推理在 OpenAI 云端。Codex 桌面 App 支持 local/cloud 混合执行（local mode 代码留在本地），多 agent UI 配隔离 worktree。来源：augmentcode 对比，2026-03-14，https://www.augmentcode.com/tools/devin-vs-codex-desktop-app
- ChatGPT Agent（agent mode）运行在**托管虚拟机**（虚拟浏览器 + 沙箱终端，受限网络），不碰本机其他 App/文件系统。来源：2025 AI Agent Index（arXiv），https://arxiv.org/html/2602.17753v1

### 权限/授权模型（重点）
Atlas agent mode 的边界（OpenAI 官方，2025-10-21，https://openai.com/index/introducing-chatgpt-atlas/）：
- **系统访问**：不能在浏览器中运行代码、下载文件、安装扩展。
- **数据访问**：不能访问电脑其他 App 或文件系统、不能读写 ChatGPT 记忆、不能获取已保存密码或使用自动填充。
- **浏览活动**：agent mode 访问的页面不写入浏览历史；可选 logged-out 模式不带任何 cookie/登录态。
- 敏感操作（结账等）需用户批准；家长控制可关闭 agent mode 与浏览器记忆。
- 桌面 App Work："重要动作需用户批准"，桌面文件/App 访问"with your permission"——粒度按官方表述是**动作级确认**，未公开类似 Claude Code 的规则化 allow/deny 配置（未验证是否有更细粒度策略）。

### 记忆与自我改进
- 账号级持久记忆（2024 起全用户），服务端存储；2026-07-08 新增 memory summary 页面：可直接编辑摘要文本、删除记忆、"Delete and turn off memory"；Temporary Chat 不读不写记忆。来源：OpenAI 官方 release notes，2026-07-08。
- Atlas 有独立的 browser memories（随 Atlas 退役而终止）；agent mode 明确**不能读写 ChatGPT 记忆**——agent 与记忆系统隔离。
- 默认不用浏览内容训练（可 opt-in "include web browsing"）。

### 可观测性
- ChatGPT Agent 是少数提供**专属 system card** 的 agent 之一，且实现 **HTTP 请求密码学签名（RFC 9421）** 解决 agent 身份与可审计性。来源：2025 AI Agent Index。
- 但面向用户的轨迹回放/检查点能力薄弱：Work 仅"可跟进进度、回答问题、改方向、批准重要动作"；没有公开的逐工具调用回放、checkpoint/rewind、本地轨迹导出（未验证）。
- OpenAI 对开发者的可观测性靠平台侧 Agent Command Center（/platform/monitor/command-center，企业向）。

### 模型支持
- 仅 OpenAI 模型（GPT-5 家族；GPT-5.4 computer use 在 Online-Mind2Web 达 93.0%，第三方 leaderboard 数据，2026）。

### 定价/开源
- Atlas 浏览器免费；agent mode 在 Plus $20/月起（Go/Plus/Pro/Business），入口价从 Operator 时代的 $200 降到 $20。来源：o-mega.ai。
- Codex 随 ChatGPT 订阅：Plus $20、Pro $200、Business $30/seat、Enterprise 定制；另有 credits 加购机制。来源：augmentcode 引 ChatGPT plans 页。
- 全闭源。

### 2025-2026 重大动态
- 2025-07：ChatGPT Agent 发布；2025-08-31：Operator 停运；2025-10-21：Atlas 发布。
- 2026-03-19/20：WSJ 报道 OpenAI 确认将 ChatGPT + Codex + Atlas 合并为桌面 "superapp"（Fidji Simo/Greg Brockman 主导），战略从"多线押注"收缩到编码工具与企业客户。来源：the-decoder，2026-03-20，https://the-decoder.com/openai-plans-to-merge-chatgpt-codex-and-atlas-browser-into-a-single-desktop-superapp/
- 2026-07-09：新桌面 App 发布（Chat+Work+Codex）、Plugin Directory 取代 App Directory、Work 支持 Scheduled Tasks；**Atlas 宣布 2026-08-09 退役**。

---

## 3. GitHub Copilot（Microsoft/GitHub）

### 定位与目标用户
- IDE 插件形态的编码助手 + agent：Agent Mode（VS Code/Visual Studio/JetBrains/Eclipse/Xcode 内）、**Copilot CLI**（终端 agent，npm 包 `@github/copilot`）、**Cloud Coding Agent**（从 github.com/Issue 派发，云端异步产出 PR）。2026 年中市占约 37%、月活开发者约 2800 万（Tech Insider 转引，2026-06，未独立验证）。来源：codingfleet，2026-06-07，https://codingfleet.com/blog/github-copilot-alternatives-2026/

### 架构（本地优先 vs 云端）
- Agent Mode/CLI 本地执行工具、**推理全部走 GitHub 服务端**（api.github.com、mcp.github.com）；Copilot CLI 无内置 OS 级沙箱，以应用层权限模型代替。Cloud Coding Agent 在 GitHub Actions 云端沙箱跑。来源：agent-safehouse 沙箱分析报告，2026-03-09，https://agent-safehouse.dev/docs/agent-investigations/copilot-cli

### 权限/授权模型（重点）
- Copilot CLI 权限层级（agent-safehouse 报告 + GitHub 官方文档 https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview）：
  - **Trusted directories**：启动时询问是否信任当前文件夹（本次/永久记住/退出）。
  - **逐工具批准**：每个工具调用确认；可选"本次会话内批准该工具"。
  - `--allow-tool TOOL` / `--deny-tool TOOL` 细粒度预授权/封禁（如 `shell(git status)`）；`--allow-all` / `--yolo` 全开；`--dangerously-skip-permissions` 跳过全部检查（含路径/URL）。
  - **preToolUse hooks** 可编程 allow/deny。
  - 关键局限（报告原文）："The permission system is **advisory, not enforced by the OS kernel**. A bug or exploit in the CLI itself could bypass these checks."
- VS Code 侧（官方文档，2026-06 抓取，https://code.visualstudio.com/docs/agents/concepts/trust-and-safety）：
  - `chat.tools.terminal.autoApprove` 支持按命令正则配 allow/deny（如 `"rm": false`、`"/^Remove-Item\\b/i": false`）。
  - **Agent sandboxing（preview）**：对 agent 终端子进程做 OS 级文件/网络隔离，沙箱内命令自动批准不再询问；官方列举审批模式的四大缺陷：**approval fatigue、命令解析可绕过（别名/引号拼接）、prompt injection、对外部服务的不可逆副作用**。
- Cloud Coding Agent 在 Actions 沙箱内，产出必须经 PR 人工审查。

### 记忆与自我改进
- Custom instructions（仓库级 `.github/copilot-instructions.md`）、Enterprise knowledge bases；无跨会话持久"用户记忆"机制，无 agent 自我沉淀经验的能力（未验证有官方记忆功能）。

### 可观测性
- VS Code 内 diff 视图、checkpoint rollback（编辑器级）；Copilot CLI `Ctrl+T` 切换推理过程可见性；Cloud agent 产出 PR + Actions 日志。
- 无 OpenTelemetry 级结构化轨迹导出、无官方回放/评测框架（未验证）；安全团队多依赖第三方沙箱（Modal/E2B/Runloop）提供 per-sandbox 监控。来源：Modal 博客。

### 模型支持
- 多模型：GPT-5 系、Claude Opus/Sonnet、Gemini（2026-06 起 per-issue 多模型）；BYOK 仅限 Copilot SDK 企业场景。来源：copilot-alternatives.com 对比，2026-06-15。

### 定价/开源
- Free $0（有限 agent mode）→ Pro $10/月（含 cloud coding agent）→ Pro+ $39 → Max $100（新注册一度暂停）；Business $19/seat、Enterprise $39/seat。**2026-06-01 起全面改为 AI Credits 计量计费**（Chat/agent mode/code review/cloud agent/CLI 消耗 credits，超出可加购），社区普遍反映成本不可预测。来源：GitHub 官方 plans 页 https://github.com/features/copilot/plans ；techjacksolutions，2026-06-16。
- 闭源。

### 2025-2026 重大动态
- 2025 年中：premium requests 计量制上线；2026-01：repo indexing 改进；2026-06-01：AI Credits 全面计量 + per-issue 多模型；Agent sandboxing（OS 级）进入 preview；2026-04-22 起 Business 自助注册暂停（官方 plans 页脚注）。

---

## 4. Google Gemini CLI / Antigravity

### 定位与目标用户
- **Gemini CLI**（Apache 2.0 开源、TypeScript/Node）：消费者路径已于 **2026-06-18 停服**（Free/AI Pro/AI Ultra 不再受理请求；Vertex AI/Enterprise/Code Assist 付费路径保留）。来源：aibuilderclub，2026-06-18，https://www.aibuilderclub.com/blog/google-kills-gemini-cli-june-18-2026 ；Google AI Developers Forum，2026-05-20。
- **Antigravity**：2025-11 随 Gemini 3 首发的 agent-first IDE；**2026-05-19（Google I/O）发布 Antigravity 2.0**，拆成共享同一 agent harness 的多个面：① Antigravity IDE（VS Code fork，Editor + Agent Manager）② 独立桌面 App（agent 指挥中心，无内置编辑器）③ **Antigravity CLI（`agy`，Go 单二进制，闭源，Gemini CLI 继任者）** ④ SDK（Python）⑤ Managed Agents in Gemini API（一次 API 调用拉起隔离 Linux 沙箱 agent，会话持久可恢复）。来源：totalum，2026-05-23，https://www.totalum.app/blog/google-antigravity-2-0-totalum ；ginfomedia I/O 汇总，2026-07-01。

### 架构（本地优先 vs 云端）
- 桌面/CLI 本地执行 agent，但**代码在 Google 服务器上处理**（nevercodealone 引官方文档："Der Code wird auf Google Servern verarbeitet"）；Managed Agents 则是 Google 托管沙箱 + 持久 state。免费 tier 可用全部模型但约 5 小时刷新的速率限制。

### 权限/授权模型（重点）
- Antigravity CLI 四档 permission presets（`/permissions` 切换；toolsbase 命令参考，2026-06-22，https://toolsbase.dev/en/reference/antigravity-cli-commands）：
  | preset | 行为 |
  |---|---|
  | `request-review`（默认） | 多数操作需审查 |
  | `proceed-in-sandbox` | 沙箱内自动放行 |
  | `always-proceed` | 不询问（仅限受控工作区） |
  | `strict` | 所有非只读工具都询问 |
- 配套：terminal Allow/Deny lists、Secure Mode（Auto/Manual）、credential masking、hardened Git policies、**macOS 工作区沙箱（Windows/Linux 仍 pending）**。
- 安全记录差：默认 agent 可访问终端/文件系统/网络；早期有 agent 抹掉用户整块硬盘的事件（促使推出 macOS 沙箱）；研究者持续报出漏洞，Google 文档自认"known security limitations"。来源：aitoolanalysis 评测，2026-01-06/05 更新，https://aitoolanalysis.com/google-antigravity-review/
- 另一倒退：Antigravity CLI **不支持 Gemini CLI 原有的自定义 Docker 镜像 sandbox**。来源：Google AI Developers Forum，2026-05-20。

### 记忆与自我改进
- AGENTS.md 项目配置（取代 GEMINI.md）、Skills/Hooks/Subagents 作为 Antigravity Plugins；无公开的跨会话持久记忆机制（未验证）。

### 可观测性
- 官方叙事"Evidence, not raw logs"：agent 产出 task lists、implementation plans、**browser recordings** 供人工验证；`/diff`、`/rewind` 支持回滚。来源：ginfomedia，2026-07-01；toolsbase。
- 但：速率限制数字不透明（只公布 Pro 5x/20x 相对倍数）、无 OTel 级导出（未验证）。

### 模型支持
- Gemini 3.1 Pro、Gemini 3 Flash、**Gemini 3.5 Flash**（2.0 默认引擎，Terminal-Bench 2.1 76.2%）、Claude Sonnet/Opus 4.6、GPT-OSS 120B；同一 mission 内不同 agent 可配不同模型。**不支持自带 API key**（消费端 App 锁 Google 模型线）。来源：vibecoding.app 评测，2026-06-08，https://vibecoding.app/blog/google-antigravity-review

### 定价/开源
- Preview 免费；AI Pro $19.99/月；AI Ultra 新入门档 $99.99/月（5x Pro 用量），原 $249.99 顶档降至 $199.99；credits $25/2,500。2026 年初曾发生 Pro 用户 7-10 天锁死的 rate-limit 丑闻（"paperweight" 争议），2.0 改为 compute-budget 模型，长期可靠性未验证。来源：aitoolanalysis。
- Antigravity CLI **闭源**（Gemini CLI 是 Apache 2.0）——被社区视为开源倒退。

### 2025-2026 重大动态
- 2025-11：Antigravity 随 Gemini 3 发布；2026-05-19：2.0 五面齐发（I/O）；2026-06-18：Gemini CLI 消费者停服强制迁移；rate-limit 与定价争议贯穿上半年。

---

## 5. 对 Zerox Agent 对比有用的要点

> 参照系：Zerox Agent 的已知能力（见 `.zerox/feature_list.json` P42 / `.zerox/progress.md`）：Goal 模式强制自动批准且锁定、Policy B 分级授权（destructive/privilege/secret-exfiltration/irreversible-external/messaging/publication/financial 必须可见确认，forced ask 60s 超时、不可被通配自动批准绕过）、`ToolAuthorizationService` 不可绕过、workspace 沙箱根校验、JSONL workspace-run ledger 双写（replay-grade）、48 种 trajectory 事件 + runGraph、checkpoint-writer 冷读轨迹写 11 段 markdown checkpoint、重启续跑不重复仓库发现、取消即终态不再写轨迹。

### 5.1 各对手相对 Zerox 的弱点 / Zerox 可突出的差异化

**vs Claude Code / Cowork**
- 权限粒度：Claude Code 的 Auto mode 把批准决策交给**模型分类器**（黑盒、需管理员配 trusted infrastructure），而 Zerox 的 Policy B 是**确定性规则引擎**，强制确认不可被通配/自动批准绕过——"AI 不能给自己批条子"是强叙事点。
- 记忆：Claude 账号级记忆存 Anthropic 云端、默认开启、5 年保留政策（未 opt-out 训练）；Zerox 的记忆/检查点全在本地 JSONL/markdown，无云端留存问题。
- 定价与锁定：Claude Code 绑定 Anthropic 模型 + 订阅制（Pro $20 曾险被移除、Max $100-200），4 月定价风波是现成案例；Zerox 可强调 BYOK/多模型与本地优先。
- Claude 的优势也要如实承认：OTel 导出、agent teams、computer use、成熟生态——Zerox 若缺 OTel 需承认。

**vs ChatGPT 桌面 App / Atlas**
- 数据边界：Atlas agent mode 边界严格但**产品反复**（Operator 停运、Atlas 发布 9 个月即退役、superapp 合并）——"战略摇摆、用户被迫迁移"对比 Zerox 本地优先的稳定性；WSJ 报道的 superapp"全知视角"隐私争议（浏览+代码+对话关联）是 Zerox 本地数据边界叙事的最佳靶子。
- 可观测性：ChatGPT Work 只有进度跟随 + 动作批准，无轨迹回放/checkpoint；Zerox 的 replay-grade ledger + 11 段 checkpoint + actor replay 是明显代差。
- 记忆隔离悖论：OpenAI 为安全让 agent 不能读写记忆——说明其记忆与权限体系是割裂的；Zerox 可讲"记忆与授权同层设计"。

**vs GitHub Copilot**
- 安全模型：Copilot CLI 权限"advisory, not enforced by OS kernel"（第三方报告原话），`--yolo`/`--dangerously-skip-permissions` 全开门槛低；VS Code 官方自己列举 approval fatigue、命令解析绕过、prompt injection、外部副作用四大缺陷并被迫补做 OS 沙箱（仍 preview）——Zerox 的 workspace 根校验 + Policy B + 不可绕过授权服务是对这些痛点的正面回答。
- 计费：2026-06 全面 AI Credits 计量被社区诟病不可预测；无持久记忆、无自我改进。
- 推理必经 GitHub 云端，无本地模型路径。

**vs Antigravity / Gemini CLI**
- 安全记录：抹盘事件、默认全权限、Windows/Linux 沙箱缺失、CLI 取消自定义 Docker sandbox、代码上 Google 服务器——Zerox 的"本地优先 + 默认受限"对比强烈。
- 开源倒退（Gemini CLI Apache 2.0 → agy 闭源）与强制迁移（6-18 停服）是信任叙事素材。
- 速率限制不透明（只给相对倍数）、7-10 天锁死丑闻。

### 5.2 跨对手共性缺口（Zerox 差异化主线）
1. **权限模型的确定性**：四家都在"每步询问（累）"与"全跳过（险）"之间摇摆，折中方案要么靠模型分类器（Claude Auto mode）、要么靠 OS 沙箱预览（VS Code）、要么直接不全（Copilot CLI advisory）。Zerox Policy B 的"风险类别 → 强制可见确认 + 超时中止 + 不可绕过"是规则确定性路线，且 forced ask 防绕过细节（60s 超时、通配不豁免）没有对手公开做到同等粒度。
2. **本地优先的信任**：四家推理全部上云，记忆/留存政策受厂商单方变更（Anthropic 5 年保留、OpenAI superapp 关联、Google 服务器处理代码）。Zerox 轨迹、记忆、检查点全本地，天然免疫"定价页一夜之间改权限"类风险。
3. **可观测性与回放**：Claude Code 有 transcript + OTel 但无用户级回放 UI；其余三家基本没有 replay-grade 轨迹。Zerox 的 48 类 trajectory 事件、JSONL ledger 双写、checkpoint-writer 冷读重建、取消即终态，是唯一把"可回放"做成一等公民的。
4. **可恢复的长程任务**：Antigravity Scheduled Tasks、ChatGPT Work Scheduled Tasks 有定时但无公开的"崩溃续跑不重复发现"机制；Zerox goal runtime 的有界 transcript checkpoint 跨重试/重启存活是差异化。
5. **模型中立**：四家全部锁自家（或自家生态内）模型；Zerox 若保持 BYOK/多模型，是开发者用脚投票的核心理由（4 月 Anthropic 定价风波中 HN 用户"迁移本地模型"的呼声可作引子）。

### 5.3 需要如实承认的对手强项（文章应避免的过度宣称）
- Claude Code：OTel 企业可观测性、agent teams、computer use 成熟度、SDK 生态领先。
- ChatGPT：HTTP 请求密码学签名（RFC 9421）的 agent 身份方案、9 亿用户的分发。
- Copilot：GitHub 原生工作流（Issue→PR→CI）、OS 级沙箱 preview 方向正确。
- Antigravity：免费多模型、Managed Agents API、browser recording 证据链思路与 Zerox 相近。

### 5.4 未验证/待核实清单
- Claude Code 桌面 App 是否支持 OTel（CLI 确认支持；桌面 App 未验证）。
- ChatGPT 新桌面 App Work 的更细粒度权限策略与本地轨迹导出（官方未公开细节）。
- Copilot agent sandboxing 的 GA 时间（截至 2026-07-12 仍 preview）。
- Antigravity 是否有跨会话记忆（未找到官方说明）。
- 各家在中国区的可用性（全部受限，文章若涉及需单独核实）。
