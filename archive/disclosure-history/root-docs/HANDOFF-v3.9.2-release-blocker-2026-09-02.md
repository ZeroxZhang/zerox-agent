# v3.9.2 发布交接（2026-09-02）

## 当前状态

- 当前分支：`main`
- 本地与远端 HEAD：`5340a1d33562e16d2b8795678da77c8ad1794138`
- `v3.9.2` 标签已推送，但对应发布工作流失败。
- 失败工作流：https://github.com/ZeroxZhang/zerox-agent/actions/runs/33595676287
- GitHub Release 尚未创建。
- 不要重复做产品泛化复审；产品、真实 Electron、模型截断、IME 回车、规划超时验收此前均已通过。

## 已定位的根因

发布机直接在最终封板状态运行 `npm test`，但历史治理测试只允许封板前状态：

1. Git checkout 将 `.zerox` 文件恢复为 `0644`，测试要求私有证据为 `0600`。
2. 即使本地执行 `chmod -R go-rwx .zerox`，测试仍失败，因为它要求 P107A/CD03A 为 `in_progress`；最终发布状态已是 `completed`。

复现命令：

```bash
npm test -- --run src/shared/conversationDisclosureContinuationPolicyV12.test.ts --maxWorkers=1
```

因此这 65 个失败不是新增产品缺陷，而是发布流水线在封板后重跑封板前测试，生命周期顺序自相矛盾。

## 当前未提交改动

仅修改了两个工作流文件：

- `.github/workflows/release.yml`
- `.github/workflows/verify.yml`

改动策略：

- PR 开发阶段仍执行完整 `npm run verify`。
- main/tag 封板后先执行 `npm run harness:check`，用已推广的验收证明校验精确源码摘要。
- 封板后继续执行类型检查、压力测试、构建、Agent/Memory 评测和生产冒烟，但不再重跑依赖 `in_progress` 的历史治理测试。

这些改动尚未 commit、push，也没有重新生成验收 attestation。

## 续接步骤

1. 先检查当前 diff，确认只包含上述两个工作流文件和本交接文档。
2. 为工作流变更重新生成并推广 v3.9.2 验收 attestation；不要开启新的泛化复审循环。
3. 提交并推送 main，确认 main 校验通过。
4. 确认 GitHub Release 仍不存在后，删除当前失败的远端/本地 `v3.9.2` 标签，再在新 main HEAD 重建并推送标签。
5. 等待 release workflow 完成，最终核验 GitHub Release 及 6 个发布资产。

注意：不要 force push。当前失败标签可从提交 `5340a1d33562e16d2b8795678da77c8ad1794138` 恢复。
