# Zerox Agent Release Runbook (v3.9.2+)

> 这份文档记录 v3.9.2 发布中沉淀下来的机器/CI/权限/封板不变量与操作步骤。
> 维护发布流程前先读这里；改动任何源码后，这些不变量都必须重新成立。

## 1. 发布模型（一句话）

发布 = 「在一台固定 macOS 机器上跑权威验收 → 生成字节级证明（attestation）
→ CI 用证明核对源码 → 打包 → 发 GitHub Release」。任何源码字节变化都会让
证明作废，必须重新验收。

## 2. 不变量（改动前后都要成立）

1. **验收必须跑在“active（封板前）”树上**。历史治理测试要求程序状态
   `in_progress`；封板（sealed/completed）树不能跑 `npm test`。
   流程是：重开生命周期提交 → 验收 → 再封板提交（仅 .zerox）。
2. **评审回执（review receipt）绑定“评审候选树指纹”，且指纹包含文件权限位**。
   本地验收机与 CI 全新检出的权限位不一致会导致回执校验失败。
   约定布局：所有 .zerox 文件 0644，仅
   `.zerox/verification/conversation-disclosure/CD03A-round*` 为 0600。
3. **验收绑定本机工具链**。权威验收必须在本机（CommandLineTools clang +
   MacOSX26.5 SDK）执行；CI 云机器工具链不同，无法复现 pin 的编译字节。
4. **打包使用仓库内 pin 的 safe-fs helper 二进制**（`native/zerox-safe-fs-darwin-arm64`，
   digest `sha256:58b2493f…`），不再依赖宿主编译器复现（见 `package-mac.mjs` 叠加逻辑）。
5. **原生模块必须还原为 Node ABI**：
   `node_modules/better-sqlite3/build/Release/better_sqlite3.node` digest 必须等于
   `sha256:259c5118…`（本机 node-gyp 编译产物，官方 prebuilt 不是这个值）。
6. **CI 校验前先规范化权限**（verify.yml / release.yml 的
   “Normalize governance evidence modes”步骤）：
   `find .zerox -type f -exec chmod 0644 {} + && chmod 0600 .zerox/verification/conversation-disclosure/CD03A-round*`。
7. **CI 需要全历史**：verify.yml 的 checkout 必须 `fetch-depth: 0`（祖先校验需要）。
8. **验收机要避开 IDE git 监控**：Trae/Cursor/ChatGPT-Codex 等监控仓库会触发
   `.git/index.lock`，导致验收最后一道“仓库未被外部改动”守卫失败。开跑前关闭它们。

## 3. 发布步骤（概要）

1. `node scripts/release-acceptance-preflight.mjs`（秒级环境体检，先解决所有 FAIL/WARN）。
2. 重开生命周期：把 `.zerox/conversation-disclosure-program.json` 与
   `.zerox/feature_list.json` 恢复到封板前字节（例如从上一个 active 提交）。
3. 重铸评审回执到当前候选树指纹（code/security 两路独立评审 PASS 后）。
4. 计算 acceptance-input 摘要，用本机私有环境跑权威验收（runner 见交接记录）。
5. `scripts/promote-v392-release-attestation.mjs` 推广新 attestation。
6. 封板提交（仅 .zerox 证据 + 生命周期 completed）。
7. 更新 GitHub secret `ZEROX_V392_RELEASE_ATTESTATION_DIGEST` 为新 digest。
8. push main（fast-forward，禁止 force），确认 verify workflow 全绿。
9. 重建并推送 `v3.9.x` tag；确认 release workflow 成功。
10. 核验 GitHub Release 非 draft/prerelease 且恰好 6 个资产（dmg/zip/latest-mac.yml + 各自 blockmap/sig）。

## 4. 已知问题与待优化（按优先级）

- [高] 指纹剔除权限位：让本地与 CI 天然一致，去掉 CI 的 chmod 规范化（要改核心脚本，需随下一次完整验收落地）。
- [高] 断点续跑 + 更细的超时：真实 Electron 场景目前受 15 分钟单命令上限限制。
- [中] 改动分级：CI/文档类改动走轻量证明通道，避免触发完整 25 分钟验收。
- [中] 工具链可复现：pin 下载固定 clang/SDK，摆脱“必须这台机器”。

## 5. 快速排错

- 验收在 15 分钟超时 / Electron 场景崩溃：先关 IDE、清理残留，再重跑（pin 不变）。
- `better-sqlite3` digest 不对：
  `cd node_modules/better-sqlite3 && ../../node_modules/@electron/rebuild/node_modules/.bin/node-gyp rebuild --release`。
- CI “attestation invalid or stale”：源码树与证明不一致，需重新验收，别硬推 main。