# Zerox Agent Release Runbook (post-optimization, 2026-09-03)

> 记录发布流程的机器/CI/权限/封板不变量。维护发布流程前先读这里。
> 2026-09-03 重写：conversation-disclosure 成功者机制（轮次证据/编排器/
> successor checker/attestation 依赖链）已冻结至 archive/disclosure-history/
> （tag archive/disclosure-history-v3.9.2），sealed 门禁现在跑全量 npm test。

## 1. 发布模型（一句话）

发布 = 本地全量门禁（Node 22，npm test 全绿 + harness:check/program:check
exit 0 + 打包锚自检）→ 封板提交 → CI sealed 门禁（含 npm test）→ tag →
GitHub Release。历史 attestation 通道（promote-v392-release-attestation、
release-acceptance-preflight）已冻结不再走常规发布；删除它们属于发布治理
决策，未包含在本次优化范围内。

## 2. 不变量（改动前后都要成立）

1. **Node 22 + 原生 ABI**：.nvmrc=22；换 Node 后必须 npm rebuild
   better-sqlite3；better_sqlite3.node digest 变化属 ABI 噪音，非代码回归。
2. **npm test = vitest 活树全量**：319 文件 / ~3800 用例，Node 22 本地必须
   全绿；不允许再引入历史状态重放或 fixture 复原编排器。
3. **harness:check/program:check 本地无 secret 必须 exit 0**：产品契约 +
   四个 program checker（runtime/kernel/storage/release）。
4. **CI sealed 门禁命令列表被 ciWorkflow.test.ts 锁定**：verify.yml 的
   sealed-main 与 release.yml 的 Verify source tree 必须包含 npm test；
   改命令列表要同步改该测试。
5. **归档只读**：archive/disclosure-history/ 是冻结记录，只允许移动，
   不允许编辑或重新挂回 checker/测试。
6. **CI 权限规范化**（verify.yml/release.yml 的 normalize-evidence action）：
   find .zerox -type f -exec chmod 0644 {} +（CD03A 证据已归档，不再有
   0600 特例）。
7. **CI 需要全历史**：checkout fetch-depth: 0（祖先校验需要）。
8. **本地跑动前避开 IDE git 监控**：Trae/Cursor/Codex 等监控仓库会触发
   .git/index.lock，导致验收最后一道守卫失败。

## 3. 发布步骤（概要）

1. 本地：nvm use 22；npm run harness:check && npm run program:check &&
   npm test（全绿基线见 .zerox/progress.md）。
2. 打包自检：npm run build；需要时 npm run pack:mac / release:mac（签名、
   safe-fs helper digest pin 见 build-v392-acceptance-anchor CONTROL_DIGESTS，
   由 packageScripts.test.ts 守护）。
3. 封板提交（仅 .zerox 证据），push main（fast-forward，禁止 force），
   确认 verify workflow（含 npm test）全绿。
4. 重建并推送 v3.x tag；确认 release workflow（含 smoke:prod:built）成功。
5. 核验 GitHub Release 非 draft/prerelease 且资产完整。

## 4. 已知问题与待优化

- [高] 工具链可复现：pin 下载固定 clang/SDK，摆脱必须单台验收机。
- [中] 打包/发布脚本仍有 v392 时代命名与锚文件（build-v392-acceptance-anchor
  + capture-cd05/06/07），随下一次完整发布治理迭代清理。

## 5. 快速排错

- npm test 本地红：先确认 Node 22 与 better-sqlite3 ABI（见不变量 1）。
- CI attestation/secret 报错：sealed 门禁已不再消费 ZEROX_V392_* digest；
  若 CI 仍引用旧 secret，属历史残留 env，可安全移除。
- harness:check 报文件缺失：先查是否误删 .zerox 活跃文件或 archive 引用。
