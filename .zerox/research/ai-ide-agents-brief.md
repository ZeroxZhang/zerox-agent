# 桌面端 AI 编程 Agent 竞品调研简报（外部调研部分）

> 调研日期：2026-07-12（CST）。用途：《Zerox Agent 与主流桌面端 AI Agent 对比》公众号文章素材。
> 对比基准：Zerox Agent 的定位 = 本地优先（local-first）+ 显式权限授权（ToolAuthorizationService / workspace sandbox）+ 可观测轨迹（observable trajectories）+ 经审核的学习（reviewed learning）。
> 所有来源 URL 均为本轮实际检索结果；未找到一手来源的标注"未验证"。

---

## 1. Cursor（Anysphere）

**定位与目标用户**：VS Code fork 的 AI-native 编辑器，2023 年发布，2026 年仍是专业开发者中的"默认选项"。目标用户是愿意为最全 AI 功能付费的职业工程师。([promptzone 2026-05](https://www.promptzone.com/marcus_webb_87b5a26c/cursor-vs-windsurf-vs-zed-may-2026-verified-pricing-features-and-what-cognition-did-with-1d48))

**架构（云端重度依赖）**：闭源 Electron/VS Code fork。代码索引、Agent 推理全部走 Cursor 云端；"Background agents"直接在 Cursor 托管的 Ubuntu 云 VM 里跑 GitHub issue。Privacy Mode 需手动开启，默认行为会把代码上下文发给外部模型提供商。([iconpolls 2026](https://iconpolls.com/blogs/cursor-ai-review-2026-login-download-free-plan-pricing-dashboard-windows-user-experience-faqs)、[endorlabs 2026-03](https://www.endorlabs.com/learn/cursor-security))

**权限/授权模型**：Agent mode 可自动编辑文件、执行终端命令。防护手段是命令 allowlist/denylist + auto-run（类 YOLO）模式。社区文档显示 allowlist 是"前缀匹配 + 黑名单（blocklist）思路"——`npm` 放行即放行全部 `npm` 子命令，官方文档长期没有说清匹配语义，用户靠猜和试。([Cursor 社区论坛 2026-01](https://forum.cursor.com/t/how-does-command-allowlist-denylist-really-work/102782/8)、[howtoharden 2026-06](https://howtoharden.com/guides/cursor/)) auto-run 模式下 agent 无需任何用户批准即可执行终端命令。

**记忆与自我改进**：`.cursorrules` → `.cursor/rules/*.mdc` 规则体系；2025 年 5 月（v0.51）上线 Memories（beta，Settings > Rules 中开关），v1.0（2025-06）正式发布——从对话中自动生成记忆并跨会话保留。但社区反馈 Memories 作用域混乱（项目级记忆实际全局生效、`.cursor/learned_memories.mdc` 不透明），且 User Rules 存在"配置了但不注入上下文"的公开 bug。([Cursor 论坛 2025-10](https://forum.cursor.com/t/rules-vs-memories-and-global-vs-project/137149)、[cursor/cursor#3706](https://github.com/cursor/cursor/issues/3706)) 记忆是自动生成的，**没有"人工审核后生效"的闸门**。

**可观测性**：有 agent 对话历史和 diff review，但没有完整的轨迹回放/审计日志产品化能力（Enterprise 才有 audit logs）。([DevTune 2026-07](https://devtune.ai/verticals/ides-code-editors/cursor/))

**模型支持**：Claude Sonnet 4.5 / Opus 4.6、GPT-5.3、Gemini 3 Pro、自研 Composer（2025-10 发布，agent 循环上约 4× 速度）。([promptzone 2026-05](https://www.promptzone.com/marcus_webb_87b5a26c/cursor-vs-windsurf-vs-zed-may-2026-verified-pricing-features-and-what-cognition-did-with-1d48))

**定价/开源**：闭源。Free / Pro $20 / Pro+ $60 / Ultra $200 / Teams $40/seat，全部改为用量积分制。

**2025-2026 重大争议**：2025-06-16 将 Pro 从"500 次快速请求"改为 $20 API 积分池，"unlimited"只限 Auto 模式，用户几次 prompt 烧光额度并产生意外超额账单；CEO Michael Truell 于 2025-07 公开道歉并承诺退款，但退款渠道被曝数周无人回应，被 RedMonk 等称为"pricing fiasco"。([RedMonk 2025-09](https://redmonk.com/kholterhoff/2025/09/08/the-endless-hot-vibe-code-summer/)、[SaaS Price Pulse 2026-03](https://www.saaspricepulse.com/blog/cursor-pricing-history)、[credyt 2026-07](https://credyt.ai/blog/how-to-communicate-price-increase))

**相对 Zerox 的弱点**：云端优先、闭源不可审计；权限模型是"黑名单 + 前缀匹配"的宽松默认（default-open），而非显式授权；记忆自动生成无审核；2025 定价事件暴露"服务条款可随时单方面变更"的平台风险。

---

## 2. Windsurf / Devin Desktop（Cognition AI）

**定位与目标用户**：Codeium（Exafunction，2021 成立）出品的 agentic IDE，核心 Agent 为 Cascade。经历 2025 年三连变：OpenAI ~$3B 收购告吹（2025-07，因微软 IP 共享条款受阻）→ Google $2.4B 反向人才收购 + 技术授权（CEO Varun Mohan 等入职 DeepMind）→ Cognition AI 于 2025-12 以 ~$2.5 亿收购剩余资产。**2026-06-02 起通过 OTA 更新更名为 Devin Desktop**，Cascade 正在被退役，底层模型改为向 Google 授权。([Axios 2025-08](https://www.axios.com/2025/08/13/windsurf-ai-startup-code-openai-google)、[zemith 2026-06](https://www.zemith.com/en/contents/cursor-vs-windsurf-2026)、[oflight 2026-05](https://www.oflight.co.jp/en/columns/windsurf-devin-cognition-integration-2026))

**架构**：VS Code fork，云端托管产品会把代码传输到 Windsurf/Cognition 基础设施处理；提供 ZDR（Zero Data Retention，Teams/Enterprise 默认开启），但 **ZDR 只管存储不管传输**——代码仍然离开本机。有 self-hosted 企业部署。([witness.ai 2026-05](https://witness.ai/blog/windsurf-security/))

**权限/授权模型**：Cascade 三档自动执行——Off（仅 allowlist 内自动执行）、Auto（模型自行做安全评估决定是否自动执行，仅 premium 模型）、**Turbo（除 denylist 外全部自动执行终端命令和浏览器控制）**。同样是黑名单思路；官方文档自己警告"Turbo + 宽松 allowlist 可无确认执行破坏性命令"。([Windsurf/Devin 官方文档](https://docs.devin.ai/windsurf/plugins/cascade/cascade-overview))

**记忆与自我改进**：`.windsurf/rules` 规则文件（支持 glob/always_on/manual/model_decision 四种触发模式，比 Cursor 更细）、Cascade Memories（跨会话持久事实，自动生成）、Workflows（`/workflow-name` 可复用多步自动化）。([Devin Docs changelog](https://docs.devin.ai/windsurf/plugins/changelog)、[openclaw/skills](https://github.com/openclaw/skills/blob/main/skills/lucaslcarrijo/windsurf-cascade/README.md))

**可观测性**：Cascade 支持按步骤 revert（hover 原始 prompt 点 revert 箭头回滚代码到该步状态），但 **revert 不可逆**，且没有独立的轨迹审计/回放产品。([官方文档](https://docs.devin.ai/windsurf/plugins/cascade/cascade-overview))

**模型支持**：Claude、GPT、自研 SWE-1.x（SWE-1.5/1.6，Cognition 收购后）；更名 Devin Desktop 后模型层向 Google 授权。([NxCode 2026-05](https://www.nxcode.io/resources/news/cognition-windsurf-acquisition-swe-1-5-codemaps-2026)、[developersdigest 2026-06](https://www.developersdigest.tech/blog/migrating-from-windsurf-to-claude-code))

**定价/开源**：闭源；免费档 + 付费档（2026 具体档位未逐一验证）。

**最新动态**：2026-04-15 发布 Windsurf 2.0（Agent Command Center、原生 Devin 集成）；2026-06-02 更名 Devin Desktop。

**相对 Zerox 的弱点**：产品方向完全受并购摆布（两年三次易主，核心 Agent Cascade 被退役）——典型的"用户工作流寄托于厂商资本事件"风险；Turbo 模式是 default-open 的执行模型；ZDR 不解决代码离机问题。

---

## 3. Zed AI（Zed Industries）

**定位与目标用户**：Rust 原生高性能编辑器（Atom/Tree-sitter 原班人马），"AI 是功能而非地基"。2026-04-29 发布 1.0，Mac/Windows/Linux 全平台对齐。目标用户：看重输入延迟、原生 UI、实时协作的工程师。([promptzone 2026-05](https://www.promptzone.com/marcus_webb_87b5a26c/cursor-vs-windsurf-vs-zed-may-2026-verified-pricing-features-and-what-cognition-did-with-1d48))

**架构（本地优先程度最高）**：客户端开源（GPL-3.0 + Apache-2.0 双许可），本地原生渲染。AI 可走 Zed 云端，也可 **自带 API key 或接 Ollama / LM Studio 本地模型**，免费 Personal 档即不限制外部 agent 与自有 key。([cosyra 2026-06](https://cosyra.com/guides/zed-on-phone.html))

**权限/授权模型**：agent panel 内工具调用需确认（具体粒度文档较少，**未充分验证**）；通过 ACP 接入的外部 agent（Claude Code、Gemini CLI 等）沿用各自权限模型。

**记忆与自我改进**：有 rules/上下文配置，但没有自动生成记忆或自我改进机制——记忆能力明显弱于 Cursor/Windsurf。（未找到 Zed 自动记忆的一手资料，标注未验证）

**可观测性**：Zed 主导制定了 **Agent Client Protocol（ACP）开放标准**，标准化编辑器与 agent 的通信；agent 线程在 panel 内可见可回溯，但无独立的轨迹回放/评测产品。([developersdigest 2025-11](https://www.developersdigest.tech/blog/zed-agentic-ide))

**模型支持**：Anthropic、OpenAI、Google、Mistral、DeepSeek、GitHub Copilot、Amazon Bedrock、OpenRouter、Vercel、Ollama、LM Studio 等；通过 ACP 可挂 Claude Code / Codex CLI / Gemini CLI。

**定价/开源**：编辑器开源免费；Pro $10/月（含 $5 token 额度、无限 Edit Predictions），Business $30/seat。([cosyra 2026-06](https://cosyra.com/guides/zed-on-phone.html))

**最新动态**：2026-04-29 发布 1.0；Series B（2025-08），累计融资 ~$42M。

**相对 Zerox 的弱点**：Zed 是五家里最接近"本地优先"的，但它本质是**编辑器**，不是 agent 运行控制面——没有系统级的工具授权服务、没有跨会话的经审核学习机制、没有 agent 轨迹的结构化审计。Zerox 与其不构成直接竞争，反而是"Zed 管编辑、Zerox 管 agent 治理"的互补叙事素材。

---

## 4. Augment Code（Augment Inc）

**定位与目标用户**：企业级 AI 编码平台，核心是 Context Engine——语义索引可达 40-50 万文件、跨多仓库的依赖与历史变更。目标用户：大型 monorepo/多 repo 的企业团队。SOC 2 Type II、ISO/IEC 42001、CMEK（Enterprise）。([VibeCompare 2026-06](https://vibecompare.dev/tools/augment-code/)、[NUBIA 2026-07](https://nubiapage.com/augment-code-review-in-2026-login-ai-code-pricing-free-plan/))

**架构（云端重度依赖）**：插件形态（VS Code / JetBrains / Vim），但 Context Engine 的索引与推理在 Augment 云端——"源代码索引需要仔细的安全审查"是评测共识。承诺不用客户代码训练。([AI Agent Square 2026-06](https://aiagentsquare.com/agents/augment-code))

**权限/授权模型**：IDE 内 agent 操作有确认流程；企业侧靠 SSO/RBAC、审计日志治理。个人用户层面没有细粒度的命令级授权模型（未见公开资料，未验证）。

**记忆与自我改进**：有 Memory 功能（跨会话保留上下文）；Context Engine 本身是一种"组织级长期记忆"——索引代码库、依赖链、历史变更。多 agent 编排（Intent）与 Cosmos 自主 agent 层。([The AI Agent Index 2026-05](https://theaiagentindex.com/agents/augment-code))

**可观测性**：GitHub PR 机器人（AI code review）、用量仪表盘；面向企业的审计能力在 Enterprise 档。Auggie CLI 在 SWE-bench Pro 上 51.80%（2026-04，Scale AI），领先 Cursor 50.21%、Claude Code 49.75%——**是五家里唯一有公开 benchmark 成绩的**。([ThePlanetTools 2026-05](https://theplanettools.ai/blog/augment-code-review-2026-swe-bench-pro))

**模型支持**：以 Claude Sonnet 系为主（官方定价示例基于 Sonnet 4.5），多模型。

**定价/开源**：闭源。Indie $20、Standard $60、Max $200/月（团队最多 20 用户）；另有 $100/月 flat（≤50 席）的团队包。全部积分制。([The AI Agent Index 2026-07](https://theaiagentindex.com/compare/augment-code-vs-sourcegraph-cody)、[CheckThat 2026-03](https://checkthat.ai/brands/augment-code/pricing))

**2025-2026 争议**：2025-10-20 从"消息数"计费迁移到积分制，老用户额度缩水（Dev Legacy $30/月仅换得 56,000 credits），被评"pricing migration damaged trust"；2026-03-31 起非 Enterprise 档移除 inline completions，进一步引发不满；有用户一天烧掉 51,072 credits 后取消订阅的案例。([Augment 官方博客 2025-10](https://www.augmentcode.com/blog/augment-codes-pricing-is-changing)、[prospeo](https://prospeo.io/s/augment-pricing-reviews-pros-and-cons)、[Bodega One 2026-03](https://www.bodegaone.ai/blog/augment-code-sunset-completions-what-next))

**相对 Zerox 的弱点**：整个代码库索引上传云端——与"本地优先、代码不出机"正面冲突；功能可被单方面下线（completions 事件）；积分制成本不可预测；闭源。

---

## 5. Trae（字节跳动）

**定位与目标用户**：字节跳动出品的免费 AI IDE（VS Code fork），2025 年初发布，主打"免费 Cursor 替代品"，在亚洲市场增长快；2026-03-31 推出 SOLO 模式（自主 agent 独立 app，可"交付到生产"）。([vibecoding.app 2026-06](https://vibecoding.app/blog/trae-review)、[百度百科](https://baike.baidu.com/en/item/Trae/1481007))

**架构（云端重度依赖 + 数据出境疑虑）**：闭源 fork，AI 推理走云端；2025 年多份独立分析指其数据收集远超同类（详见争议）。

**权限/授权模型**：SOLO 模式强调自主执行 + 云端并发任务（TRAE Work 支持最多 10 个并发云任务）；未见公开的细粒度命令授权文档（未验证）。

**记忆与自我改进**：有 rules/上下文配置；未见成熟的自动记忆或审核式学习机制（未验证）。

**可观测性**：无公开的轨迹回放/审计能力（未验证）。

**模型支持**：早期用 GPT-4o / Claude 3.5 Sonnet；2026 年支持多模型（具体清单未逐一验证）。

**定价/开源**：闭源。2026-02 起改为 token 计费，五档订阅；$20 档含 SOLO 模式与无限补全。([trae.ai/pricing](https://www.trae.ai/pricing)、[百度百科](https://baike.baidu.com/en/item/Trae/1481007))

**2025 重大隐私争议（重点素材）**：2025-07，开发者在 GitHub 发布技术分析（segmentationf4u1t/trae_telemetry_research），The Register 等报道：**关闭遥测后仍持续上传数据**——7 分钟约 500 次网络请求、共 26MB，目标域名 byteoversea.com；内容疑含硬件配置、OS 信息、机器 ID/用户 ID、项目路径，甚至键鼠操作；并被指存在可远程激活的"热更新"机制。内存占用约为 VS Code 的 6.3 倍、Cursor 的 3 倍。官方回应未能平息质疑；该事件使 Trae 在企业和欧盟/受监管行业"直接出局"。([The Register 2025-07](https://www.theregister.com/software/2025/07/28/bytedance-ai-ide-trae-telemetry-continues-even-after-opt-out/838532)、[GitHub 分析报告](https://github.com/segmentationf4u1t/trae_telemetry_research)、[Yahoo/cybernews 2025-07](https://tech.yahoo.com/cybersecurity/articles/bytedance-ai-tool-trae-caught-130500976.html)、[unit221b 2025-03](https://blog.unit221b.com/dont-read-this-blog/unveiling-trae-bytedances-ai-ide-and-its-extensive-data-collection-system))

**相对 Zerox 的弱点**：这是对比文章里最锋利的案例——"免费"的代价是不可审计的数据收集与违背用户设置的遥测行为；"关闭开关"形同虚设 vs Zerox 的"显式授权、默认拒绝"形成直接对照。

---

## 对 Zerox Agent 对比有用的要点（差异化弹药）

1. **本地优先 vs 云端重度依赖**：Cursor / Windsurf / Augment / Trae 四家均为"代码必须离机"架构（Augment 甚至全量索引上传）。Zed 支持本地模型但定位是编辑器而非 agent 治理层。Zerox 的 local-first 在"代码不出机"上是结构性差异，不是配置项差异。

2. **显式授权 vs 黑名单默认放行**：Cursor auto-run、Windsurf Turbo 都是"除 denylist 外全部自动执行"的 default-open 模型，且 allowlist 是前缀匹配（`npm` 放行=放行一切 npm 命令），官方文档承认破坏性命令可无确认执行。Zerox 的 ToolAuthorizationService + workspace sandbox 是"默认拒绝、显式授权"的白名单模型——这是文章中最有说服力的技术对照。

3. **可观测轨迹 vs 只有对话历史**：五家均无产品化的 agent 轨迹回放/审计（Cursor 审计日志仅 Enterprise；Windsurf revert 不可逆）。Zerox 的 observable trajectories 是独一档卖点。

4. **经审核的学习 vs 自动生成记忆**：Cursor Memories / Windsurf Cascade Memories 都是模型自动写入、无人工审核闸门，且已被社区实测出现作用域混乱、规则不生效等问题。Zerox 的 reviewed learning 可对照为"记忆写入需审核"。

5. **厂商风险时间线（叙事素材）**：Windsurf 两年三易其主、Cascade 被退役；Cursor 2025-06 定价灾难；Augment 2025-10 积分迁移 + 2026-03 功能下线；Trae 2025-07 遥测丑闻。四家均在 12 个月内发生过单方面变更损害用户利益的事件——支撑"本地优先 = 把工作流主权交还给用户"的文章主旨。

6. **定价可预测性**：四家均已转向积分/用量计费，成本不可预测是 2025-2026 年共同的用户痛点；Zerox 本地运行、自带 key 的成本结构是透明对照。

7. **Benchmark 空白需注意**：Augment 有 SWE-bench Pro 51.8% 的公开成绩，其余家无量化公开评测；若文章要给 Zerox 立"可评测"的人设，建议 Zerox 侧补一组可复现的评测数据，避免只打架构牌。
