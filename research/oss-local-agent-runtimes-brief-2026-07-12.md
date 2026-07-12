# 调研简报：开源 / 本地优先 Agent 运行时全景（Kimi 系 + Goose / Cline / OpenCode / Aider / Continue / Open Interpreter / smolagents）

- 调研日期：2026-07-12（Asia/Shanghai）
- 用途：《Zerox Agent 与主流桌面端 AI Agent 对比》公众号文章素材
- 对比基准：Zerox Agent v3.4.0（Electron 42 + React 19 + TS 6，本地优先桌面 Agent 控制台，ISC 开源）
- GitHub 数据均为 2026-07-12 当日通过 GitHub REST API 实时查询（`api.github.com/repos/<repo>`），非二手转述

---

## 0. 速览表（GitHub API 实测，2026-07-12）

| 项目 | 仓库 | Stars | License | 最近 push | 形态 |
|---|---|---|---|---|---|
| OpenCode | anomalyco/opencode | **184,897** | MIT | 2026-07-12 | 终端 TUI 编码 Agent |
| Cline | cline/cline | **64,555** | Apache-2.0 | 2026-07-11 | VS Code 扩展 |
| Open Interpreter | openinterpreter/openinterpreter | **64,343** | Apache-2.0 | 2026-07-07 | 本地代码执行 Agent（CLI/OS 模式） |
| Goose | aaif-goose/goose（原 block/goose） | **51,099** | Apache-2.0 | 2026-07-11 | Rust CLI + 桌面 App |
| Aider | Aider-AI/aider | **47,309** | Apache-2.0 | 2026-05-22（节奏放缓） | Python CLI 结对编程 |
| Continue.dev | continuedev/continue | **34,825** | Apache-2.0 | 2026-07-12 | IDE 扩展 + CLI + Hub |
| smolagents | huggingface/smolagents | **28,304** | Apache-2.0 | 2026-07-11 | Python Agent 框架（库） |
| Kimi CLI | MoonshotAI/kimi-cli | **9,152** | Apache-2.0 | 2026-06-22 | 终端通用 Agent |
| Kimi Code CLI | MoonshotAI/kimi-code | **3,061** | MIT | 2026-07-12 | TS 终端编码 Agent（Kimi Work 内嵌运行时） |
| Kimi Work（桌面端） | 闭源 | 无 | 闭源商业 | Daimon 0.5.27+ | Mac/Windows 桌面 Agent（Kimi 模型绑定） |

---

## 1. Kimi 系（与 Zerox Agent 竞争/互补关系最直接）

### 1.1 Kimi Work（桌面端，Daimon 本地优先运行时）

- **定位**：Moonshot AI 官方桌面 Agent，面向知识工作者（金融、研究、咨询、开发），"从指令到本地文件一步到位"。来源：[Kimi Work 产品页](https://www.kimi.com/products/kimi-work)、[Kimi Work 介绍（2026-06-17）](https://www.kimi.com/resources/kimi-work-introduction)（均于 2026-07-12 抓取）。
- **架构**：macOS / Windows 原生桌面应用，自称 "Local Agent"：挂载本地文件夹、本地执行 Python/shell、内置 Cron 定时引擎、"数据保留在设备上"。运行时内部名为 **Daimon**，内嵌 Kimi Code 运行时（证据：GitHub issue [MoonshotAI/kimi-code#1118](https://github.com/MoonshotAI/kimi-code/issues/1118)，2026-06-26：Desktop Daimon releaseVersion 0.5.27，bundled kimi-code 0.12.3，含 `@moonshot-ai/agent-core` 等包）。
- **权限模型**：**只有两档**——"Full access"（全程免打扰自动执行）与 "Ask permission"（敏感步骤逐项确认）。无公开的结构化命令分析、sandbox 分层、域名白名单等细粒度机制文档。
- **能力**：Goal Mode（目标持久化状态、多轮执行、验收证据、预算）；最多 **300 个并行子 Agent** swarm；WebBridge 浏览器自动化（复用用户已登录会话）；插件市场（MCP/skill 组合，OAuth 授权）；原生接入金融/学术数据库（全球股票、World Bank、论文专利）。
- **记忆与自我改进**：有长期记忆与会话持久化，但**无公开的用户审核式学习机制**；外部记忆需第三方连接器（[Nowledge Mem 集成文档](https://mem.nowledge.co/docs/integrations/kimi-work)，明确写道 "Kimi Work does not expose lifecycle hooks today"）。
- **模型支持**：**仅 Kimi 自有模型**（K2.5/K2.7 Code 系），非 model-agnostic。
- **定价/开源**：闭源商业产品（免费 + 订阅分层，具体定价未在本次调研验证）。
- **稳定性信号**：issue #1118 报告 Windows 上 python-run 爆出数千个 runner.py 进程——内嵌运行时的进程治理仍有粗糙处。
- **对 Zerox 有用的要点**：
  1. Zerox 的权限模型是**结构性碾压**：`PermissionRule[]` 模式匹配 + shell 语义前缀推导（`npm run *` 匹配 `npm run build`）+ 控制符拦截（`allow git *` 无法被 `git foo; rm -rf` 绕过）+ 三层 sandbox（workspace/network/shell 独立收窄）（README.md:653、779-786）；Kimi Work 只有"全开/逐项问"两档。
  2. Zerox **model-agnostic**（Anthropic/Gemini/OpenAI-compatible 三家原生 provider，README.md:675-681），Kimi Work 绑定 Kimi 模型——"不被单一模型厂商锁定"是公众号可主打角度。
  3. Zerox 有**可审核的自我改进**（Dream + Distill，低置信度发现必须用户审核，默认关闭 `ZEROX_SELF_IMPROVEMENT`，README.md:788-793）和**对抗式评测**（对 harness 做变异测试）；Kimi Work 无同类公开机制。
  4. Zerox 的证据 judge（`createEvidenceJudgePolicy` 要求引用的证据字符串真实出现在 transcript 中，拒绝幻觉式"成功"，README.md:652）是 Kimi Work 未公开具备的可靠性设计。
  5. 互补而非纯竞争：Kimi Work 可作为 Zerox 的一个 OpenAI-compatible provider 端点；Zerox 可定位为"Kimi/Claude/GPT 都能驱动的本地控制面"。
  6. **需诚实承认的 Zerox 短板**（避免文章被反噬）：Kimi Work 有 300-agent 并行 swarm、WebBridge 浏览器自动化、原生金融/学术数据库、Windows 支持；Zerox 当前 macOS only、并行上限 8（workflow `parallel` 上限，README.md:673）、无浏览器自动化。

### 1.2 Kimi CLI / Kimi Code CLI

- **Kimi CLI**（MoonshotAI/kimi-cli）：9,152 stars（2026-07-12 API 实测），Apache-2.0，最后 push 2026-06-22。定位"本地 AI 终端代理 / 本地运行的 Claude Code 替代"，Shell 模式直接执行命令，支持 ACP（Agent Client Protocol）与 Zed 等 IDE 集成（[CSDN 上手文，2026-03-25](https://blog.csdn.net/gitblog_01145/article/details/159456579)）。知乎 2025-10 称其"完全离线、MIT、支持 Ollama/GGUF"——与 GitHub API 显示的 Apache-2.0 矛盾，**离线/本地模型支持未验证**。
- **Kimi Code CLI**（MoonshotAI/kimi-code）：3,061 stars，MIT，2026-05 发布（[MarkTechPost，2026-06-06](https://www.marktechpost.com/2026/06/06/moonshot-ai-releases-kimi-code-cli-a-terminal-ai-coding-agent-built-in-typescript-for-next-gen-agents/)），TypeScript 终端编码 Agent，读改代码/跑 shell/搜文件；它就是 Kimi Work 桌面端的内嵌运行时（issue #1118 佐证）。
- **对 Zerox 有用的要点**：Kimi CLI 系是"终端里的 Kimi 模型前端"，无桌面控制面、无权限审计、无记忆治理；Zerox 的差异化恰好在"控制台"层（轨迹、审计、评测、学习审核），两者不构成正面竞争，反而佐证"CLI Agent 之上需要一个本地控制平面"的叙事。

---

## 2. Goose（Block → Agentic AI Foundation）

- **定位**：Block（Square/Cash App 母公司）出品的通用本地 Agent，"不只是改代码，而是系统级自动化"。已迁入 Agentic AI Foundation，仓库 aaif-goose/goose（原 block/goose 已 301 跳转）。
- **架构**：Rust CLI + 桌面 App；15+ LLM provider（含 Ollama 纯本地，[localaimaster，2026-06-20](https://localaimaster.com/blog/goose-ollama-local-agent)）；通过 MCP 获得工具；YAML **Recipes** 定义可复用工作流。
- **权限模型**：逐项确认 + 可配置 auto-approve；2026 年 1 月 Block 红队演练 **"Operation Pale Fire"** 发现 recipe 中隐形 Unicode 字符可注入恶意指令，之后修复：recipe 可视化、零宽字符剥离、更细粒度授权提示、MCP 服务器恶意扫描、第二 AI 对抗监控（[Morph，2026-03-04](https://www.morphllm.com/comparisons/goose-vs-claude-code)）。教训："never enable auto-approve"。
- **记忆/自我改进**：无持久认知记忆体系；Recipes 是人工沉淀的"流程资产"，非自动学习。
- **可观测性**：有会话日志与 recipe 可视化，但无公开的轨迹事件流/回放/评测体系。
- **模型支持**：model-agnostic（本地 Ollama 亦可，但 7–14B 小模型工具调用可靠性差）。
- **定价/开源**：免费 Apache-2.0；51,099 stars；最新 release v1.38.0（2026-06-17，localaimaster）；Block 已于 2025-10 向全公司 12,000 名员工部署（[sanj.dev，2026-04-16](https://sanj.dev/post/goose-vs-claude-code/)）。
- **对 Zerox 有用的要点**：
  1. Goose 的权限仍是"提示确认"粒度，Zerox 的 `ShellPlan` 结构化命令分析 + 破坏性命令拦截（`rm -rf`/`git push -f`/`DROP TABLE`，README.md:782）可对比为"从问人到结构性阻断"。
  2. Pale Fire 事件反衬 Zerox 的纵深防御设计（控制符拦截、symlink 边界逐段 realpath 复查、风险分级升级到系统对话框，README.md:781-786）。
  3. Goose 无记忆治理与审核式学习；Zerox 的五类记忆 + FTS5/向量/hybrid RRF + 30 分钟自动整理 + 治理报告（README.md:765-777）是明显差异化。
  4. Goose 无对抗评测；Zerox 的 harness 变异测试可主打。

---

## 3. Cline（cline/cline）

- **定位**：VS Code 内的自主编码 Agent，原名 Claude Dev；62K+ stars、**8M+ 安装量**（[Blink，2026-05-28](https://blink.new/blog/cursor-vs-cline)；GitHub API 实测 64,555）。
- **架构**：IDE 扩展，**Plan-and-Act 双模式**（先规划后执行）；代码在本机执行，只把上下文发给所选 LLM provider；接 Ollama 时"零代码离开本机"（[CodeBrewTools，2026-05-24](https://codebrewtools.com/blogs/claude-code-vs-claude)）。
- **权限模型**：**逐项审批**（每个文件改/命令执行都要用户确认），是 Cline 的主打卖点——但本质是"人肉点确认"，无结构化命令分析；有 auto-approve 白名单。
- **记忆**：Memory Bank（项目内 markdown 文件）+ `.clinerules`；为通用常识，本次未逐一验证官方文档，**标注未验证**。
- **可观测性**：任务检查点（workspace 快照回滚）、完整对话/工具调用展示；无独立轨迹回放与评测框架。
- **模型支持**：完全 BYOK，Anthropic/OpenAI/Google/任意 OpenAI-compatible 端点；扩展免费，只付 API 费。
- **对 Zerox 有用的要点**：
  1. Cline 是"IDE 内监督式编码"，Zerox 是"桌面控制平面 + 后台可恢复运行"——场景错位，Zerox 可强调**长任务无人值守**（checkpoint 跨重启恢复、定时任务、Goal Mode，README.md:719-737），Cline 离开 VS Code 即不存在。
  2. Cline 的"逐项确认"在大任务下确认疲劳，Zerox 的任务策略授权 + 审计日志（`tool_audit` 表，README.md:687）是"一次授权、全程留痕"的更优解。
  3. Cline 无自我改进/学习审核机制；无 actor 多智能体血缘追踪。

---

## 4. OpenCode（anomalyco/opencode，原 SST）

- **定位**：开源、model-agnostic 的终端编码 Agent（TUI）。2026 年中 stars 反超 Claude Code：184,897 vs ~135,000（[Codersera，2026-06-30](https://codersera.com/blog/opencode-vs-claude-code-2026/)）；864+ contributors、802 releases、13K+ commits（[Morph，2026-07-06](https://www.morphllm.com/comparisons/opencode-vs-claude-code)）。
- **架构**：终端 TUI，LSP 集成，多会话，plan/build 双模式，子 agent 支持；SST 团队 2026 年更名 Anomaly。
- **权限模型**：build 模式默认只读/受限、plan 模式不执行；工具级 allow/ask/deny 配置（通用认知，**未在本次检索中验证最新文档**）。
- **记忆**：无持久认知记忆；项目级 `AGENTS.md`/规则文件。
- **可观测性**：会话分享链接（opencode.ai share）；无评测/回放框架。
- **模型支持**：最强 model-agnostic 之一（75+ provider，含本地）；官方 "Zen" 付费模型网关可选。
- **定价/开源**：MIT 免费。
- **对 Zerox 有用的要点**：
  1. OpenCode 是"更快的终端马"，Zerox 是"带仪表盘、黑匣子和学习机制的控制塔"——对比叙事可用"赛车 vs 塔台"。
  2. OpenCode 无 checkpoint 恢复、无定时任务、无目标模式、无记忆、无学习审核；长任务/无人值守场景全部缺失。
  3. 其 184K stars 证明"开源 + model-agnostic"路线有巨大社区认同，Zerox 同属该路线，可借势叙事而非对立。

---

## 5. Aider（Aider-AI/aider）

- **定位**：终端 AI 结对编程，git 原生。47,309 stars（API 实测），Apache-2.0。
- **架构**：Python CLI；**Repo Map**（对整个 git 仓库构建精简地图喂给 LLM）；每批改动自动原子 commit；architect/editor 双模型分工。
- **权限/安全**：无 sandbox、无授权层——直接改工作区并 commit，靠 git diff/revert 兜底。
- **记忆**：无；靠 git 历史与 repo map。
- **可观测性**：git 历史即审计；无轨迹/评测。
- **模型支持**：全 provider + Ollama。
- **最新动态**：最后一次 repo push 2026-05-22，"节奏明显放缓"（[Morph，2026-06-09](https://www.morphllm.com/ai-coding-assistant-open-source)）；作者 Paul Gauthier 个人主导。
- **对 Zerox 有用的要点**：Aider 展示了"无权限层 Agent"的极限——一切安全靠 git。Zerox 可对比："git 兜底是事后，Zerox 的 sandbox/授权/审计是事前与事中"。Aider 无任何记忆/学习/多 Agent/调度能力，是"单功能利刃"vs"控制平面"的对照样本。

---

## 6. Continue.dev（continuedev/continue）

- **定位**：开源 AI 编码助手平台（VS Code/JetBrains/Neovim 扩展 + CLI + Continue Hub）。34,825 stars（API 实测；二手资料 32K–35K 区间一致）。
- **架构**：IDE 内 chat/autocomplete/edit/agent 四模式；context providers 体系；**Continue Hub** 提供团队共享 agents/rules/MCP/密钥治理（商业化层）。
- **权限模型**：agent 模式有工具确认；无结构化 shell 分析。
- **记忆**：rules 文件 + Hub 共享配置；无认知记忆。
- **可观测性**：无轨迹回放/评测。
- **模型支持**：100+ 模型，BYOK；Ollama/LM Studio/vLLM 本地。
- **定价**：Solo 免费（自带 key）；Models Add-on $15/月；Team $10/dev/月；Enterprise 定制（[ToolHalla，2026-03-21](http://toolhalla.ai/blog/aider-vs-continue-dev-vs-cody-2026)）。
- **对 Zerox 有用的要点**：Continue 证明"IDE 插件 + 团队治理"是另一条商业化路线；它没有任何桌面独立控制面、无定时/目标/可恢复运行、无学习审核。Zerox 可强调"IDE 之外的工作"（文件整理、调研、定时报告）是 Continue 够不到的场景。

---

## 7. Open Interpreter（openinterpreter/openinterpreter）

- **定位**：自然语言驱动本地代码执行（Python/JS/Shell），另有 OS 模式做计算机操作。64,343 stars（API 实测；注意仓库已从 OpenInterpreter/open-interpreter 迁移至 openinterpreter/openinterpreter，旧名 301 跳转）。
- **架构**：Python 包 + CLI；LLM 生成代码→本地解释器执行→结果回灌；AGPL→Apache-2.0（现 API 显示 Apache-2.0，[Presenc AI 对比文 2026-05-15](https://presenc.ai/compare/openclaw-vs-open-interpreter-vs-jan-vs-localai-2026) 仍写 AGPL-3.0，以 API 为准）。
- **权限模型**：`--safe` / `auto_run` 开关，逐项确认代码块——**无 sandbox、无路径白名单、无命令分析**，"auto run"模式安全社区批评已久。
- **记忆**：会话历史文件；无认知记忆。
- **可观测性**：无。
- **模型支持**：OpenAI-compatible + 本地模型。
- **最新动态**：pushed 2026-07-07，维护活跃（与"项目停滞"的过时印象相反，2024 后曾低迷，2026 恢复更新——pushed 日期为证）。
- **对 Zerox 有用的要点**：Open Interpreter 是"权限裸奔"派的代表，恰好反衬 Zerox 的安全纵深（路径白名单 + symlink 复查 + 控制符拦截 + 风险分级系统对话框，README.md:779-786）。公众号可用它做"本地 Agent 安全光谱"的反面锚点。

---

## 8. smolagents（huggingface/smolagents）

- **定位**：HuggingFace 极简 Agent **框架（库，非产品）**，~1000 行核心代码。28,304 stars（API 实测）。
- **架构**：`CodeAgent` 让 LLM 直接写 Python 代码作为动作（而非 JSON tool call），多工具任务步数减少 ~30%（[particula.tech，2026-04-24](https://particula.tech/blog/microsoft-agent-framework-vs-google-adk-vs-smolagents)）；`ToolCallingAgent`；多 agent 编排；沙箱执行器（e2b/modal/docker）。
- **权限模型**：库级 sandbox executor 可选；安全责任在使用者。
- **记忆/可观测性**：无内置记忆；OpenTelemetry 集成（通用认知，未验证）。
- **模型支持**：LiteLLM/HF Transformers/任意。
- **定价/开源**：Apache-2.0 免费。
- **对 Zerox 有用的要点**：smolagents 是"给开发者砌墙用的砖"，Zerox 是"装修好的房子"。两者不在同一层——Zerox 恰可以把 smolagents 这类框架作为 skill/script 的执行后端之一，叙事上是生态位互补。

---

## 9. 总结：Zerox Agent 的差异化空间（可直接用于文章的论点）

1. **权限与安全的结构性代差**：对照组普遍是"逐项确认/开关式 auto-approve"（Cline、Goose、Open Interpreter），Zerox 是唯一公开实现"结构化 shell 分析（ShellPlan）+ 控制符绕过拦截 + 三层 sandbox 收窄 + symlink 边界复查 + 风险分级系统对话框"的（`src/main/kernel/` 权限引擎，`src/main/agentLoop.ts` 授权链，README.md:646-655、779-786）。
2. **可恢复性无人对标**：每个工具结果后写 `AgentExecutionCheckpoint`、跨应用重启暂停/恢复（`agentRuntimeEngine.ts`，README.md:723-733）；对照组全部没有（OpenCode/Cline 只有会话内 checkpoint）。
3. **可观测 + 可评测的闭环**：KernelEventBus 结构化轨迹事件（`turn_start`/`tool_call`/`compaction`/`judge_verdict` 等，README.md:650）、证据 judge 防幻觉验收、`runAgentEvals` + harness 变异对抗评测、ETCLOVG 成熟度评分（README.md:788-793）——这是"企业级可靠性"叙事，对照组零覆盖。
4. **记忆治理 + 审核式学习**：五类记忆、FTS5/向量/hybrid RRF、自动整理与治理报告、Dream+Distill 且低置信度必须人工审核（`selfImprovementService`，README.md:765-777、790）——"Agent 会学习，但学习必须经过你批准"是独有卖点。
5. **多 Agent 血缘透明**：actor 模型子运行继承并收窄父 sandbox、父子会话血缘可检视（`src/main/actors/`，README.md:665-669）；Kimi Work 的 300-agent swarm 是规模优势但血缘/权限收窄机制未公开。
6. **model-agnostic + 本地优先 + 开源**：与 Kimi Work（绑定 Kimi 模型、闭源）形成最直接对照；与 OpenCode/Cline/Aider 同属开放路线但补上了它们缺失的"控制平面"层。
7. **诚实短板（文章需平衡）**：macOS only；无浏览器自动化（vs WebBridge）；并行规模小（workflow parallel ≤ 8 vs 300-agent swarm）；无原生金融/学术数据源；无插件市场；社区 stars 与上述项目不在同一量级。

---

## 附：主要来源清单

- GitHub REST API 实时查询（2026-07-12）：cline/cline、anomalyco/opencode、Aider-AI/aider、continuedev/continue、huggingface/smolagents、MoonshotAI/kimi-cli、MoonshotAI/kimi-code、aaif-goose/goose、openinterpreter/openinterpreter
- [Kimi Work 产品页](https://www.kimi.com/products/kimi-work) / [Kimi Work 介绍](https://www.kimi.com/resources/kimi-work-introduction)（抓取于 2026-07-12）
- [MoonshotAI/kimi-code issue #1118（Daimon 内嵌运行时证据）](https://github.com/MoonshotAI/kimi-code/issues/1118)
- [Nowledge Mem × Kimi Work 集成文档](https://mem.nowledge.co/docs/integrations/kimi-work)
- [MarkTechPost: Kimi Code CLI 发布](https://www.marktechpost.com/2026/06/06/moonshot-ai-releases-kimi-code-cli-a-terminal-ai-coding-agent-built-in-typescript-for-next-gen-agents/)
- [Goose + Ollama 本地运行（localaimaster，2026-06-20）](https://localaimaster.com/blog/goose-ollama-local-agent)
- [Operation Pale Fire 红队事件（Morph，2026-03-04）](https://www.morphllm.com/comparisons/goose-vs-claude-code)
- [Goose vs Claude Code（sanj.dev，2026-04-16）](https://sanj.dev/post/goose-vs-claude-code/)
- [Cursor vs Cline（Blink，2026-05-28）](https://blink.new/blog/cursor-vs-cline)
- [OpenCode vs Claude Code（Codersera，2026-06-30）](https://codersera.com/blog/opencode-vs-claude-code-2026/)、[Morph，2026-07-06](https://www.morphllm.com/comparisons/opencode-vs-claude-code)
- [开源 AI 编码助手排名（Morph，2026-06-09）](https://www.morphllm.com/ai-coding-assistant-open-source)
- [Continue.dev 定价（ToolHalla，2026-03-21）](http://toolhalla.ai/blog/aider-vs-continue-dev-vs-cody-2026)
- [smolagents 对比（particula.tech，2026-04-24）](https://particula.tech/blog/microsoft-agent-framework-vs-google-adk-vs-smolagents)
- [OpenClaw/Open Interpreter/Jan/LocalAI 对比（Presenc AI，2026-05-15）](https://presenc.ai/compare/openclaw-vs-open-interpreter-vs-jan-vs-localai-2026)
- Zerox Agent 本仓库：README.md（中文段 571–795 行）、AGENTS.md

未验证项已就地标注（Cline Memory Bank/检查点细节、OpenCode 权限配置最新文档、Kimi CLI 离线本地模型支持、Kimi Work 定价分层）。
