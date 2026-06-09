# Harness Engineering 调研笔记

调研日期：2026-06-09
调研目标：系统梳理 2026 年兴起的 AI Agent Harness Engineering（围绕模型的运行底座、约束、状态、验证与反馈循环），并结合当前项目形成可执行迭代规划。

## 关键问题
1. Harness Engineering 的核心定义、组件边界、层级模型和验证协议是什么？
2. OpenAI、Anthropic 以及研究论文中的实践分别强调哪些可复用工程模式？
3. 当前项目的技术栈、构建状态、交付方式、模块边界、测试与文档有哪些值得学习和需要补齐的地方？
4. 如何把 Harness 的可借鉴做法转化为当前项目的阶段性 spec 和工程 plan？

## 发现

### 范围校准
- “Harness Engineering” 在当前语境中主要指 AI coding agent 的工程化运行底座，而不是 Harness.io 这家公司。它关注模型之外的环境：任务规格、上下文选择、工具访问、项目记忆、任务状态、观测、失败归因、验证、权限、熵审计和人工干预记录。
- Harness.io 的 CI/CD、IDP、Feature Flags、治理与可观测产品可作为平台工程旁证，但本次规划会以 AI agent harness 为主。

### 第 1 轮发现：定义与一手资料
- OpenAI 在《Harness engineering: leveraging Codex in an agent-first world》中把人的角色从“写代码”转向“设计环境、指定意图、建立反馈循环”。关键实践包括：repo-local knowledge、AGENTS.md/skills、工作树隔离、可被 agent 读取的 UI/日志/指标、结构化测试和自定义 lint 约束。
- Anthropic 的 long-running agents 文章把 harness 具体化为跨上下文窗口的状态系统：initializer agent、feature list、progress notes、init.sh、会话开头自检和会话结尾提交/进度更新。
- Anthropic 的 long-running app development 文章强调 planner-generator-evaluator 的契约循环：planner 把一句话扩展成 spec，generator 实现，evaluator 按合同验收并用 Playwright 找到可执行 bug。
- arXiv 论文《AI Harness Engineering》将 harness 定义为模型、工具和项目环境之间的 runtime substrate，并列出 11 个组件职责；核心评价对象不再只是 patch，而是“可验证、可归因、可维护的变更证据包”。
- arXiv 论文《Meta-Engineering Harnesses》进一步强调契约编译、角色专门化 agent、独立/对抗式验证、失败分类和外循环校准，适合连续生产软件而非一次性代码生成。
- 《Agent Harness Engineering: A Survey》提出 ETCLOVG 七层 taxonomy：Execution environment、Tool interface、Context management、Lifecycle/Orchestration、Observability、Verification、Governance，可作为当前项目 review 的检查框架。

### 阶段摘要（第 1 轮）
- Harness Engineering 的共识正在收敛：能力不只来自模型，而来自“模型 + harness + 环境”的整体系统。
- 高质量 harness 的核心不是写更长 prompt，而是把任务边界、repo-local knowledge、工具权限、状态、观测、验证、失败归因和人工干预都做成可检查的运行机制。
- 对当前项目最有价值的借鉴是：用 repo 作为系统记录、用机器可读 feature/progress 文件控制范围、用独立 evaluator/QA agent 做验收、用 trace/eval 驱动 harness 迭代。

### 当前项目 review：构建与质量状态
- 项目是 Electron + React + TypeScript + Vite 的 macOS local-first desktop agent。`package.json` 提供 `test`、`build`、`verify`、`smoke:prod`、`validate:agent`、`eval:agent`、`eval:memory` 等完整自检入口。
- `npm run verify` 通过：76 个测试文件、333 个测试全部通过；生产构建通过；agent eval 7/7 通过；memory eval 2/2 通过。`npm run smoke:prod` 也通过，Electron 生产启动能渲染 agent chat UI。
- 规模：177 个 TS/TSX 文件；业务代码约 22,834 行；测试约 11,342 行。测试密度较高，且覆盖 runtime、workspace、memory、tool auth、eval、renderer 状态等关键层。
- 现有强项已经很贴近 harness engineering：recoverable runtime、checkpoint、trajectory、workspace sandbox、tool audit、reviewed learning、procedural memory injection、deterministic eval、multi-agent lineage、large tool result offload。
- 现有差距也清晰：根目录缺少面向 agent 的 `AGENTS.md`/`init.sh`/机器可读 feature list/progress；scheduled task runtime 与 chat agent loop 仍是两条路径；`waiting_for_approval` 状态已建模但未真正写入 runtime checkpoint；recoverable runtime 的 step 状态仍是单步壳，尚未完整记录计划步骤；scheduled-task runtime 没有把 abort signal 传到工具执行；shell sandbox 的 `workspace_only` 语义还不够硬。

## 来源列表

- OpenAI, “Harness engineering: leveraging Codex in an agent-first world”, 2026-02-11, https://openai.com/index/harness-engineering/
- Anthropic, “Effective harnesses for long-running agents”, 2025-11-26, https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic, “Harness design for long-running application development”, 2026, https://www.anthropic.com/engineering/harness-design-long-running-apps
- Zhong & Zhu, “AI Harness Engineering: A Runtime Substrate for Foundation-Model Software Agents”, arXiv:2605.13357, 2026-05-13, https://arxiv.org/abs/2605.13357
- Sengupta et al., “Meta-Engineering Harnesses for AI-Native Software Production”, arXiv:2605.25665, 2026-05-25, https://arxiv.org/abs/2605.25665
- Li et al., “Agent Harness Engineering: A Survey”, OpenReview PDF, 2026, https://openreview.net/pdf/f358711a95aaaf61fdeffd4ef3fc60fba9b8da57.pdf
- walkinglabs, “Learn Harness Engineering”, GitHub, crawled 2026-06, https://github.com/walkinglabs/learn-harness-engineering
