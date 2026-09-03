# legacyTurn.ts (3057 行) 切分勘察与边界清单

> 勘察日期: 2026-09-03 · 目标: 3057 → ≤1500 行（字面口径 ④）

## 结构事实（已测量）

- 文件布局: imports 1-115 · `LegacyTurnRuntime` 类型 116-127 · 工厂
  128-135（8 个 rt 绑定） · `executeMessageInternal` **136-3051（2916
  行单函数）** · 工厂 return 3054-3057。
- 巨型函数内部 = 11 个嵌套 helper（合计约 441 行）+ 顺序主流程约
  2372 行（556-911 段约 356 行；1036-3051 段约 2016 行），流程与
  helper 文本交错（helper 分散在 171-1035 之间的 8 个片段中）。
- 嵌套 helper 跨度: invalidatePublicationAuthority 171-173 ·
  interruptRequiredSettlementAttempt 176-207 ·
  compensateRequiredSettlementFailure 210-271 · persistChatStatusEvent
  274-351 · finalizeAssistantOutput 378-385 · emitOutputPart 388-396 ·
  ensureCausalAttempt 427-450 · emitTerminalStreamEvent 453-489 ·
  settleClaimOwnedFailure 492-555 · persistAssistantReply 912-1035。
- 主流程锚点: 2048 “Unified agent mode”（agentLoop 分支）· 2800
  “Fallback: simple LLM chat”；settleClaimOwnedFailure 调用点 573/607/891
  /1160/1175；persistAssistantReply 为独立嵌套函数（唯一可字节级外移
  的 124 行）。

## 为什么“非机械”

- 单函数内含大量跨段共享的可变局部（sessionId/requestId/
  workspaceRunRecorder/currentCausalAttempt/publicationAuthority/
  startedAtMs…，136-170 初始化）+ 11 个闭包 helper + options 深层成员
  访问；顺序流程段互有 fall-through、提前 return 与调用交错。
- 单纯把嵌套 helper 外移只能省约 440 行（legacyTurn.ts 仍 ~2600），
  且每个 helper 的闭包捕获面需 ctx 化改写。

## 切分设计（目标 ≤1500）

将 `executeMessageInternal` 收敛为编排器，阶段函数移入同目录兄弟模块：

1. **新模块 `chatService/legacyTurnStages.ts`**（或按域拆 2 个）：
   阶段函数接受 `LegacyTurnCtx`（ctx 由 executeMessageInternal 每次调用
   时构造，字段 = 该阶段引用的外层标识符集合）：
   - stage-prepare（136-170 流程 + guidedInput 准备）
   - stage-settle（556-911：settlement/failure 处理）
   - stage-agent-run（2048-2799：unified agent 分支）
   - stage-simple-chat（2800-3036：fallback LLM 分支）
   - stage-persist（复用 persistAssistantReply 外移版，912-1035）
2. **ctx 语义**：可变局部用 getter/setter 对（`ctx.sessionId()` /
   `ctx.setSessionId(v)`），helper 经 `ctx.helpers.*` 或直接收编进阶段
   文件；每次切片后跑 chatService 聚焦测试 + 全量 npm test。
3. 切片顺序（每片独立提交、tsc+测试绿再进下一片）：
   (a) persistAssistantReply 外移（124 行，闭包面最小）→ 验证机制；
   (b) stage-settle 外移；
   (c) stage-agent-run 外移（最大单块 ~750）；
   (d) stage-simple-chat + stage-prepare 收尾；
   完成后 executeMessageInternal ≤ ~600 行、legacyTurn.ts ≤1500。

## 风险与验证

- 行为回归风险集中在 settle/agent-run/simple-chat 三段；每片后跑
  `src/main/chatService.test.ts`（13905 行覆盖）+ 相关 goal/agent 套件
  + 全量 npm test(Node22) 再提交。
- 兜底：任一片无法在 2 个 tsc+测试循环内收敛则回退该片（git 单文件
  restore），记录进度后继续下一候选。