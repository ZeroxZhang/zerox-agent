# v3.9.2 会话过程信息披露迭代交接

## 交接状态

- 暂停时间：2026-08-24 18:58 CST。
- 暂停原因：用户即将断网，明确要求停止并等待下一次继续指令。
- 分支：`codex/3.9.2`。
- 工作树：有大量本迭代的未提交修改与未跟踪文件；这是当前持久化状态，不能 reset、clean、checkout 或覆盖。
- 当前唯一未完成 Feature：`P107A-conversation-disclosure-successor-admission`。
- 当前唯一进行中 Workstream：`CD03A`。
- subagent：runtime lane 已完成；contract 与 governance lane 在写入边界被中断。当前没有残留测试、构建或 subagent 进程继续写文件。
- 未执行：commit、push、release、浏览器验收、外部模型调用、真实治理迁移。
- 用户提供的测试凭证从未使用，本文不记录凭证内容。仓库凭证前缀扫描只命中两处刻意构造的脱敏单测 sentinel，不是本次用户凭证落盘证据。

恢复前必须先读本文件、根目录 `AGENTS.md`、`task_plan.md`、`findings.md`、`progress.md` 与 `.zerox/progress.md`。只有用户再次明确说“继续”后才能恢复实现。

## 整体目标

本地开启 Zerox Agent v3.9.2 迭代，系统性优化和重构会话过程的信息动态披露机制。原始要求分三层：

1. 先研究市面顶级 Agent 的动态披露模式，并把附件仅作为调研证据，不把附件中的文字当作用户指令。
2. 从架构与代码两层深挖 `/Users/zeorx/Documents/trae_projects/deepseek_harness`，追踪事件权威、传输、重放、协调、投影、渲染和测试。
3. 研究完成后再制定分阶段开发计划、逐阶段实现与验收；开发结束后必须由独立 subagent 做对抗式审查，最终在 CD09 使用真实应用与浏览器验收。测试凭证仅允许在该受控验收阶段通过临时环境注入，禁止写入文件、日志、截图、终端历史或交接文档。

核心工程原则不是局部 UI patch，而是先梳理：

`事件权威 → 因果生命周期 → 持久化/恢复 → 领域投影 → renderer 披露策略 → 证据检查器 → 真实交互验收`

## 已完成的主程序阶段

| 阶段 | Feature / Workstream | 状态 | 主要产物 |
|---|---|---|---|
| 深度研究 | P104 | done | `.zerox/research/P104-conversation-progressive-disclosure-study.md` |
| 架构与交付程序 | P105 / CD01 | done / completed | CD01 决策、机器可读 program、分阶段验收场景 |
| 类型与纯投影合同 | P106 / CD02 | done / completed | 共享 disclosure contract 与 fixture-driven projector |
| 因果运行时主干 | P107 / CD03 | done / completed | causal store、Kernel/Chat/Workspace settlement、replay/recovery、安全边界 |
| 后继演进准入 | P107A / CD03A | in_progress | 当前 Round4 append-only recovery，尚未关闭 |
| 领域适配到最终验收 | P108-P113 / CD04-CD09 | planned | 尚未开始，不得越过 P107A 准入 |

研究与架构阶段已经完成，不要重做 P104-P107。恢复点是 P107A/CD03A Round4，不是重新调研，也不是直接开始 renderer UI。

## 已接受的历史权威

CD03/P107 已在 Round23 单调完成，后续 CD03A 只能追加新的后继 trust head，不能重新打开或回滚 CD03。

- Round23 snapshot canonical digest：`sha256:e1a5300d6015543e0a6a8e8f09f2a13fcb955111b87c08545e0f882bb786796b`。
- 外部 anchor 原始路径：`/tmp/zerox-cd03-r23.YkhhKk/CD03-round23-external-anchor.json`。
- canonical realpath：`/private/tmp/zerox-cd03-r23.YkhhKk/CD03-round23-external-anchor.json`。
- anchor canonical digest：`sha256:e81f0afb3d10b12976b74d1499870b837595ffbc3b452c7f1f78fff67be8f102`。
- 不得删除、复制、重建或伪造该 anchor。如果系统重启导致 `/tmp` 内容消失，必须报告历史外部证据不可用并重新设计可信恢复步骤，不能手工补文件。

历史校验命令：

```bash
node scripts/check-conversation-disclosure-program.mjs \
  --external-anchor /private/tmp/zerox-cd03-r23.YkhhKk/CD03-round23-external-anchor.json \
  --expected-external-anchor-digest sha256:e81f0afb3d10b12976b74d1499870b837595ffbc3b452c7f1f78fff67be8f102
```

## P107A 的三次拒绝历史

### Round1

- snapshot：`sha256:e8f82a943cae4e6c06732936986229a2e85f7783e6b283cf0b6b431b4f1ff7e5`。
- 三条结果：contract `1C/4M`、runtime `2C/5M`、governance `3C/9M`。
- 结论：拒绝；不得生成 Round1 manifest、attestation 或 anchor。

### Round2

- policy canonical：`sha256:aa9fa6893b20b16ccab49cbe41af65a46b9719a334691ef6174722ffb1f2edc7`。
- policy bytes：`sha256:0f082ee8000cf58a428073bfcd10151919ddb3eecc46dea6531422b01865e3ff`。
- baseline archive canonical：`sha256:eed3ca13a9ed9bc20ee952eaacf3e75a16e55845ac5b27929cb046e8b08b2970`。
- 结论：freezer 证明 transition target 必须同时是 frozen evidence 与禁止双重分类对象，合同不可满足；在 snapshot 前拒绝。
- deterministic rejection witness canonical：`sha256:75a01cdef04821f1d1ca447a5b2383d8d47be331bec7777017042bf90fcf6614`。
- 不得修改 Round2 policy、archive、targets、v2 executables，亦不得补造 Round2 snapshot、receipts、manifest、attestation 或 anchor。

### Round3

- policy canonical：`sha256:3eb5b7637bbab47f83cb3dcbe43cf2bcbb5eab0930eef9e8ff777442c5c2badc`。
- policy bytes：`sha256:4e4bb13182ba7b59753a62b98d02d249f7a8fe9dd1ffe924e211b477206c7223`。
- snapshot canonical：`sha256:cbec3496b39cb5637e40cd1276e370dc9245fd425552fd7e18fcf972d7816ced`。
- snapshot bytes：`sha256:fe7bffa24348d88bfc42926a5ed0129391600d8abcc3daa2d8b1c6aa97b88bac`。
- 覆盖：`58 frozen + 4 transition payload + 4 transition live + 6 post-review mutable + 6 review-output absent + 6 rejected-output absent = 84`。
- 三条失败 receipt canonical：
  - contract：`sha256:1ccf5eb85e00d61533db2e7b59dd0563014d29543014b6be32a4838d4d9d67b1`；
  - runtime：`sha256:ed495d4e3c96d5fbfa8d52f87da3b17b777a27d655c1a15ba875178f09d14f28`；
  - governance：`sha256:7e9c70178da80da83c398b5716d44b79454c3f13a5dd71e3364d39cf5649923b`。
- 结果：`FAIL / FAIL / FAIL`，汇总 `1 Critical / 3 Major / 2 Minor`。
- Round3 manifest、attestation、anchor 和四个 live transition 均未生成或执行。

Round3 六个 finding 必须逐项由 Round4 的负向测试封堵：

1. `R3-CONTRACT-001`：冻结 ADR 少写第六类。
2. `R3-RUNTIME-001`：runner allow-list 漏掉 `rejected_output_absent`，真实事务不可达。
3. `R3-RUNTIME-002`：缺失检查在路径存在时返回 `false`，调用者忽略返回值。
4. `R3-RUNTIME-003`：manifest 没有覆盖所有早期捕获的全局 postflight。
5. `R3-RUNTIME-004`：policy/snapshot 权限存在未拒绝的第三态。
6. `R3-GOVERNANCE-001`：本地自报 task/agent 字符串不能证明平台身份或独立性。

暂停前已重新校验 Round3 ADR、archive、policy、snapshot、三份 receipt、全部 v3 executable、四个 target 和七份 V3 test，共 26 个文件全部与冻结 SHA 一致；policy 与 snapshot 仍为单链接 `0600`。

## Round4 已接受的设计

Round4 是新的 append-only trust head，不是修补或重解释 Round3。

### 拒绝链

- 新建 deterministic Round3 review-rejection witness，同时绑定 policy、snapshot、三份失败 receipt 的 serialized byte SHA 与 canonical digest。
- repository 只能证明指定 Round3 manifest/attestation 路径在仓库内缺失，不能声称全球不存在外部文件。
- 对任何绑定被拒绝 Round3 policy/snapshot 的外部 anchor，V4 采用语义禁止：`admissibility: forbidden`、`externalAbsenceClaim: not_asserted`。

### 六类与 capture ledger

- 精确六类只有一份共享常量：`frozen_file`、`transition_live`、`transition_payload`、`post_review_mutable`、`review_output_absent`、`rejected_output_absent`。
- required-absent 只在 `ENOENT` 成功；file、directory、symlink 或其他 present 对象都必须抛错。
- policy、snapshot、rejection、receipt、manifest、attestation、anchor、journal、marker 都是私有证据，要求 effective-user owner、single-link、`0600`。
- checker、freezer、manifest、runner 的所有 present/absent 观察进入同一 ledger，输出前后都做全局 postflight。

### 事务

- fresh、prepared recovery、completed replay 必须走同一份 derived transaction plan 和同一套 admission/absence/mode/pin 校验。
- journal 一旦 durable publication，恢复只能 forward-only，不能回退 source bytes。
- 四个 live 文件只接受 all-from 或 all-to；任何 1-3 个提前切换的 mixed state 均失败。
- P108 completion 在 P107A 中继续不可表示，必须由 CD04 的下一份 reviewed delta 推进。

### 诚实的评审保证

- 外部 caller 在评审派发前创建 repository 外、`0600`、no-replace 的 dispatch set，固定三个 ordered lane、caller-assigned task slot、unique challenge 与 instruction digest。
- receipt 绑定 dispatch set/entry/challenge；task path 与 agent label 始终是 unsigned claim。
- 本地可证明的是 caller-pinned dispatch consistency，不是平台身份或密码学独立性。
- 所有 manifest/attestation/anchor 必须明确 `identityAssurance: not-signed`，禁止使用 `platform-verified`、`signed`、`cryptographically-independent` 等更强表述。

## 暂停时的 V4 文件快照

以下 SHA 只是暂停快照，不是发布 trust root。contract 与 governance lane 被中断，恢复后允许继续修改这些 V4/Round4 新文件；任何 V3/Round3 文件仍禁止修改。

| 文件 | 暂停 SHA-256 | 状态 |
|---|---|---|
| `.zerox/decisions/CD03A-round4-recovery-trust-head.md` | `c2112bea476b3d8f8192f632666d256681adb3084b886b9ec0ce7f7dfe9b3597` | 设计候选；已修正文案，不是冻结证据 |
| `scripts/conversation-disclosure-continuation-runtime-io-v4.mjs` | `3c4d5d7140f903433ed0e99c2f95abf0c1b3d55ecf6e2303215bf3a669bb8179` | 已完成候选，10 个 scoped tests PASS |
| `src/shared/conversationDisclosureContinuationRuntimeIoV4.test.ts` | `f8b17d36f7daf8a2292cca969b67c9d9b83450f4388610a4f9eebc517c24201a` | 已完成候选 |
| `scripts/conversation-disclosure-continuation-contract-v4.mjs` | `db2c1a94c3549b4dcddf84b928d2a5ed1c34accacc6972f66987e9bd387a507f` | 中断半成品，见下方 blockers |
| `scripts/conversation-disclosure-program-governance-v4.mjs` | `93ae5ecc00e04521a54fddaef96d123aff5086a5c56c58fc5e87ed9fee474d0b` | 候选；依赖缺失 contract exports |
| `src/shared/conversationDisclosureContinuationProgramGovernanceV4.test.ts` | `0523aa5ef28b5b12c5e0c998531992f2c253b59d864530e44d58f6c4e1a5830f` | 28 tests 中 27 PASS、1 已知失败 |
| `CD03A-round4-package.target.json` | `cf1b85c49d6b3999e15711207dea97732ce3e95a3a8367a98524f55a483ffe9a` | 与 Round3 package target 完全相同，尚未迁移 live |
| `CD03A-round4-harness.target.mjs` | `3f8f79c3ae7bb8e35356326e7613a9b0dce06376ab0c70ba0ee7ef663e3c8b2e` | 中断候选，需重审 imports/schema/required paths |
| `CD03A-round4-program-test.target.ts` | `af1d92d326eb244802a338743f715ab58c628601deeb204b231cec7593a8991b` | 中断候选，未完成全量 gate |
| `CD03A-round4-package-scripts-test.target.ts` | `caa0b400cdda372f561d39cf147b246ccecc17344a9372b5a03aa480f4bd6473` | 中断候选，未完成全量 gate |

四个 target 的完整路径均位于 `.zerox/verification/conversation-disclosure/`。live `package.json`、`scripts/check-harness-state.mjs`、`src/shared/conversationDisclosureProgram.test.ts`、`src/shared/packageScripts.test.ts` 仍保持 transition source 状态；不要手工复制 target 覆盖 live。

暂停时的 scoped 结果：

```text
node --check: contract-v4, runtime-io-v4, governance-v4, Round4 harness target PASS
git diff --check: PASS
RuntimeIoV4: 1 file / 10 tests PASS
RuntimeIoV4 + GovernanceV4: 2 files; 37 tests PASS, 1 FAIL
```

唯一运行中的已知失败来自：

```text
CONTINUATION_V4_GOVERNANCE_TRANSITIONS is undefined
createTransitions -> Object.entries(undefined)
```

这是一条真实未完成接口，不要为了让测试变绿而删掉测试。

## 当前阻塞与半成品缺陷

`scripts/conversation-disclosure-continuation-contract-v4.mjs` 在中断前已发现但尚未修完：

1. `POLICY_KEYS` 曾包含重复的 `algorithm`，会让 exact-key 校验永远失败；恢复时先确认并修复。
2. policy 缺 `admissionClassSet` 与 `admissionClassSetDigest`，无法把共享六类本身变成硬根。
3. 缺 `CONTINUATION_V4_GOVERNANCE_TRANSITIONS` 与 `validateGovernanceTransitionStateV4`，导致治理双态测试失败。
4. 仍需导出或实现 V4 lifecycle phases、baseline archive、review snapshot、lifecycle validators，供 freezer/checker/runner 使用。
5. contract 中旧的 `capturePresent/captureAbsent/postflight` adapter 描述与已实现 runtime-io API 不一致。实际 API 是 ledger、stable/private capture、required-absent、postflight 和 private publication；必须统一，不能保留无效抽象。
6. contract lane 尚未创建 rejection builder、policy builder 与两份 contract/policy tests。

尚未创建的主要 V4 文件：

- `scripts/build-conversation-disclosure-review-rejection-v4.mjs`
- `scripts/build-conversation-disclosure-continuation-policy-v4.mjs`
- `scripts/freeze-conversation-disclosure-continuation-v4.mjs`
- `scripts/check-conversation-disclosure-continuation-v4.mjs`
- `scripts/build-conversation-disclosure-continuation-manifest-v4.mjs`
- `scripts/verify-conversation-disclosure-continuation-v4.mjs`
- 对应 Continuation/Policy/Freeze/Checker/Manifest/Runner V4 tests
- Round3 rejection witness、Round4 baseline archive、policy、snapshot、三份 review receipt、manifest、attestation 与 repository 外 dispatch/anchor

不存在任何正式 Round4 policy、snapshot、receipt、manifest、attestation、anchor 或 journal。不要把当前 source 文件称为已发布、已冻结或已验收。

## Roster 影响

暂停前设计的最小 roster 是在 Round3 的 84 路径上新增 31 路径，总计 115，预期六类为：

`87 frozen / 4 live / 4 payload / 6 post-review mutable / 6 review-output absent / 8 rejected-output absent`

本交接文档是用户明确要求的新 feature 文件，因此恢复后若将其纳入 P107A，最小值会变成 116，暂估 frozen 变为 88。这个数字不是信任根；必须在最终文件集合稳定后从 live Feature roster、coverage builder 和 policy builder 三方重算。任何后续新增测试或脚本都会继续改变计数，禁止把 115/116 直接硬编码成未经重算的事实。

当前 `.zerox/feature_list.json` 和 `.zerox/conversation-disclosure-program.json` 仍是 Round3 roster/definition；尚未扩展到 Round4。这是有意的暂停状态，不是遗漏补丁。只有 V4 文件集稳定后再一次性更新 Feature、CD03A completion artifacts、verification commands 与 Program roots。

## 恢复顺序

### R4-0：恢复审计

1. 读 `AGENTS.md` 和本文件。
2. 运行 `./init.sh`；当前 harness 需要 caller-pinned 历史 anchor，未提供 pin 时的 fail-closed 是预期，不要把它当成产品 bug。
3. 核对 branch、`git status --short`、Round23 anchor、Round3 冻结 SHA 与四个 live source SHA。
4. 保留所有 `release-test-p70*`、`release-test-p71*` 未跟踪目录，不得 clean/reset。
5. 重跑暂停门：syntax、`git diff --check`、RuntimeIoV4 test，以及当前预期的一条 governance missing-export failure。

### R4-1：先完成共享合同

1. 只修改 V4/Round4 新文件，修复上节六个 blocker。
2. 新增 exact-key、六类 omit/extra/duplicate、Round3 anchor 注入、byte/canonical 双根、not-signed assurance mutation tests。
3. 让 runtime-io 与 contract 只有一套真实 capture 语义。
4. contract/policy/governance scoped tests 全过后，再继续其他 executables。

### R4-2：分 lane 实现

- contract lane：rejection witness builder、policy builder、contract/policy tests。
- runtime lane：freezer、checker、manifest builder及其全局 ledger/mode/absence tests。
- transaction lane：self-contained external runner、fresh/recovery/replay parity 与 fault matrix。
- governance lane：四个 target、Program/Feature 双态、diagnostic-only 非权威路径与 P108 completion block。

每条 lane 必须分文件，禁止修改 V3/Round3。主 agent 负责接口整合与交叉测试，不接受 subagent 自报 PASS 代替复跑。

### R4-3：稳定 roster 与 dry-run

1. 文件集稳定后更新 `.zerox/feature_list.json` 与 `.zerox/conversation-disclosure-program.json`。
2. 重算 P107A Feature file-set/definition、CD03A Workstream、Program root、六类计数、四 target SHA 和 executable SHA；禁止 placeholder。
3. 构造 Round4 baseline archive 与 deterministic Round3 rejection witness。
4. 先在临时位置做 builder → freezer → snapshot validator → checker 的 production-shape round trip；正式 policy/snapshot 仍保持 absent。

### R4-4：双态与全量门禁

必须在主工作树 all-from 和隔离副本 all-to 两态均通过：

- focused V2/V3/V4 tests；
- typecheck tests 与 `tsc --noEmit`；
- `npm run verify`；
- `npm run smoke:prod`；
- Agent eval `26/26`、Memory eval `2/2`；
- diagnostic `program:check` / `harness:check` 明确 `authoritative:false`；
- direct caller-pinned V4 checker/harness；
- Round23 historical checker；
- `git diff --check` 与 credential-shape scan；
- mixed transition、mode/link/inode/parent/TOCTOU、preload/env、secret sentinel、journal fault matrix全部 fail-closed。

### R4-5：发布与对抗审查

1. 只有上述门禁稳定后，才可 `O_EXCL`、`0600`、no-replace 发布 Round4 policy，再 freeze snapshot。
2. caller 在 repo 外先固定 private dispatch set，然后按三个 lane 派发相同 subject 的 adversarial review。
3. 任一 Critical、Major 或 Minor finding 都拒绝 Round4；不得生成 pending manifest 或执行 transition，只能开 Round5。
4. 只有三条 zero-finding PASS receipt，才构建 pending manifest并运行外部 forward-only transaction。
5. attestation → final manifest → external anchor → completed marker 的顺序不可颠倒。
6. anchor 完成后才能关闭 P107A/CD03A并激活 P108/CD04；P108 不会自动完成。

### 后续 CD04-CD09

- CD04/P108：证据基础与领域 adapter。
- CD05/P109：Chat 渐进披露 surface。
- CD06/P110：跨 surface 一致投影。
- CD07/P111：conversation evidence inspector。
- CD08/P112：性能、隐私、兼容性与恢复 hardening。
- CD09/P113：独立对抗验收、真实应用启动、浏览器交互和受控测试 provider。

浏览器/API 只属于最终 CD09 验收，不能用于当前 CD03A 恢复，也不能把 green unit tests 误当真实交互验收。

## 不可违反的边界

- 不修改、删除、rename、chmod 或重建任何 Round1/Round2/Round3/v2/v3 冻结字节。
- 不 reset/clean 用户工作树，不处理无关 P70/P71 文件。
- 不主动 commit 或 push。
- 不绕过 `ToolAuthorizationService`、workspace sandbox、local-first authority 或 secret redaction。
- 不在 policy/snapshot 前手工迁移四个 live target。
- 不把 diagnostic 输出当权威 acceptance。
- 不把未签名的 task/agent label 称为身份验证。
- 不保存或回显用户测试凭证。
- 不在用户明确继续前恢复 subagent 或运行长任务。

## 常用入口

- 计划：[task_plan.md](./task_plan.md)
- 研究与根因：[findings.md](./findings.md)
- 详细进度：[progress.md](./progress.md)
- harness 进度：[.zerox/progress.md](./.zerox/progress.md)
- Round4 ADR：[.zerox/decisions/CD03A-round4-recovery-trust-head.md](./.zerox/decisions/CD03A-round4-recovery-trust-head.md)
- 机器程序：[.zerox/conversation-disclosure-program.json](./.zerox/conversation-disclosure-program.json)
- Feature roster：[.zerox/feature_list.json](./.zerox/feature_list.json)

恢复口令建议直接使用：“继续 v3.9.2，会话信息披露，从交接文档的 R4-0 开始。”
