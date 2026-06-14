# Agent benchmark 调研笔记

调研日期：2026-06-07
调研目标：核验 Pi Agent / Hermes Agent 等开源 agent 标杆的公开能力，并对照 Zerox Agent 当前项目做差距判断。

## 关键问题
1. 这些标杆 agent 的核心能力边界是什么？
2. Zerox Agent 当前仓库已经具备哪些基础设施？
3. 与标杆相比，最显著的产品、架构、评测、生态短板是什么？

## 发现

### 外部标杆

1. Pi Agent 是一个 TypeScript monorepo，定位为 coding-agent toolkit，包含 interactive coding agent CLI、agent runtime、统一多 provider LLM API、TUI 库、Slack/chat automation 等包。GitHub 页面显示约 60.5k stars、v0.78.1 最新版本发布于 2026-06-04。它的强项是代码工作流、终端体验、包化 runtime、会话共享和供应链治理。
2. Pi Dashboard 是 Pi 的外部控制面，强调事件流桥接、多 session 总览、浏览器/手机查看和远程 steering。它说明成熟 agent 不只需要执行循环，还需要可观察、可接管、可恢复的 session surface。
3. Hermes Agent 由 Nous Research 发布，GitHub README 定位为 self-improving AI agent，强调内建学习循环、跨平台消息网关、持久记忆、自动创建/改进 skills、FTS5 会话搜索、cron automations、subagents、RPC 工具脚本、六种 terminal backends、trajectory generation 等。GitHub 页面显示约 185k stars，v0.16.0 最新版本发布于 2026-06-06。

### Zerox Agent 本地项目观察

1. 项目是 macOS-first Electron + React + TypeScript 桌面 agent，README 已声明 local-first、permission-controlled tools、skill system、memory、scheduled tasks、run timeline 等方向。
2. 代码实现已有 AgentRunnerService、AgentLoop、ToolAuthorizationService、MemoryStore、SkillRegistry、MCP client、TaskSchedulerService、ChatService 和 UI panels；测试覆盖面较广。
3. 核心 agent loop 仍偏基础：maxTurns 较小，规划/反思依赖纯 JSON prompt 解析，缺少结构化执行图、持久 workspace、可恢复 session、自动压缩质量评估、trajectory/eval 数据闭环。
4. Memory 已有本地存储、embedding、chunking、rerank、maintenance，但写入多为 session/episodic 摘要，尚未形成“经验 -> skill/memory/user model -> 下次行为改变”的闭环。
5. MCP/skill 工具可注册进 dynamic tool registry，但统一权限类型仍主要围绕内置六类工具，第三方工具的权限解释、审计粒度、UI 配置、生命周期治理还有明显建设空间。

## 来源列表

- Pi repo: https://github.com/earendil-works/pi （访问日期：2026-06-07，可信度：高，一手 GitHub README）
- Pi Dashboard: https://pi-dashboard.dev/ （访问日期：2026-06-07，可信度：中高，项目官网）
- Hermes Agent repo: https://github.com/nousresearch/hermes-agent （访问日期：2026-06-07，可信度：高，一手 GitHub README）

## 调研结论

### 关键事实

1. Zerox 当前强在本地桌面产品壳、权限、安全、可视化模块雏形；弱在 agent runtime 深度、生态规模、自学习闭环和跨平台 surface。
2. Pi 的优势是 coding-agent 工具链成熟度、TUI/包化架构、会话数据和工程治理；Hermes 的优势是长驻个人 agent、自学习、跨平台消息入口、执行后端和自动化生态。
3. Zerox 若继续做 local-first desktop agent，最应该补的是“可恢复长任务 + 统一工具/权限生态 + memory/skill 学习闭环 + eval/trajectory 基建”，而不是单纯堆 UI panel。

### 待确认问题

- Pi/Hermes 的 star 数和发布版本会快速变化，最终产品路线不应依赖 star 数，而应依赖能力结构。
- Zerox 是否定位 coding agent、个人自动化 agent，还是本地桌面 agent OS，需要先定主战场。
