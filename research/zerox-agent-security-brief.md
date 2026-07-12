# 调研简报：Zerox Agent 工具授权与安全模型（代码级）

**调研对象**：Zerox Agent（本地优先 Electron 桌面 AI Agent，当前版本线 v3.7.0）
**调研日期**：2026-07-12　**证据级别**：全部结论基于当前代码库逐文件阅读，含文件路径与行级函数名

## 一、总体架构：四层纵深授权模型

Zerox Agent 的工具授权不是单一开关，而是**四层串联、任一拒绝即拒绝**的纵深防御链。一次工具调用从模型发出到真正执行，依次经过：

```
模型 tool_call
  → ① 内核权限规则层 evaluatePermission（kernel/permissionEngine.ts，allow/ask/deny 规则）
  → ② 任务权限策略层 authorizeToolCallWithinRunContext（shared/toolPermissions.ts，文件/网络/Shell 白名单 + 运行沙箱）
  → ③ Policy B 极高危强制确认层 classifyToolApprovalRisk / classifyExtremeRisk（shared/toolApproval.ts + shared/extremeRiskPolicy.ts）
  → ④ 执行时二次校验层 validateToolExecutionRequest（main/agentToolExecutor.ts，沙箱硬拒绝 + 超时）
```

入口在 `src/main/toolAuthorizationService.ts:66` 的 `authorize()`。关键证据（`toolAuthorizationService.ts:101-143`）：

```ts
const ruleEvaluation = evaluatePermission(request, resolvePermissionRules(options.permissionRules),
  shellPlan ? { shellPlan } : undefined);
if (ruleEvaluation.action === "deny") { /* 直接拒绝并写审计日志 */ }
let decision = authorizeToolCallWithinRunContext(
  expandHomePermissionPolicy(subject.permissions, homeDir), request, runContext,
  shellPlan ? { shellPlan } : undefined);
const risk = classifyToolApprovalRisk({ taskName, deniedReason: decision.reason, request, shellPlan });
```

**授权与执行使用同一份 canonical runContext**，防止"审放行一个沙箱、执行用更宽沙箱"的 TOCTOU 漏洞。证据：`src/main/agentGoalAcceptanceToolExecutor.ts:46-52` 的注释与实现——

```ts
return options.toolExecutor.execute(request, {
  ...executionOptions,
  // The authorization decision and execution must use the exact same
  // canonical context. Callers cannot replace it with a wider sandbox.
  runContext: options.runContext,
});
```

## 二、Policy B：极高危操作强制人工确认（v3.7.0 引入）

`.zerox/feature_list.json` 条目 `P42-v3.7.0-autonomous-goal-runtime` 明确定义了 Policy B 的验收标准（definitionOfDone）：

> "Policy B destructive, privilege, secret-exfiltration, irreversible external, messaging, publication, and financial actions require visible confirmation"
> "Forced asks are abortable, time out after 60 seconds by default, and cannot be bypassed by wildcard auto approval"

Policy B 的分类逻辑在 `src/shared/extremeRiskPolicy.ts` 的 `classifyExtremeRisk()`，定义四大高危类别（`ExtremeRiskCategory`，第 3-8 行）：

| 类别 | 覆盖的操作（正则证据） |
|---|---|
| `irrecoverable_data_loss`（不可恢复数据丢失） | `git reset --hard`、`git clean -f`、`git stash drop/clear`、`git worktree remove`、`git branch -D`、`git tag -d`（`DESTRUCTIVE_GIT`，第 28-35 行）；`rm -rf` 组合旗标（第 38 行 + `hasRecursiveAndForce()` 第 272 行）、`diskutil erase`/`mkfs`/`shred`/`dd of=/System`（`DESTRUCTIVE_STORAGE`，第 37-42 行） |
| `privilege_or_security_boundary`（提权/安全边界） | `sudo`/`doas`/`pkexec`（第 45 行）、`security add/delete/unlock`、`systemsetup`/`spctl`/`csrutil`/`fdesetup`、`osascript`/`tccutil`/`nvram`、`launchctl load/unload`、对 `/System` 等系统路径的 `chmod/chown`（第 44-51 行）；**以及任何对授权体系自身源码的写入**（见下） |
| `secret_exfiltration`（机密外泄） | `curl/wget/scp/sftp/rsync/nc` 等网络传输命令 + 命令行中出现 `api_key`/`access_token`/`password`/`.ssh/id_`/`.aws/`/`.env`/`cookie` 等机密词（`SECRET_WORDS` 第 65 行 × `NETWORK_TRANSMITTER` 第 66 行，组合判定第 161-167 行） |
| `irreversible_external_action`（不可逆外部动作，含财务） | `git push --force`、`npm/pnpm/yarn/cargo publish`、`gh release create`、`vercel --prod`/`firebase deploy`/`fly deploy`、`kubectl delete`/生产环境 `kubectl apply`、`aws/gcloud/az` 的 `delete/destroy/terminate/purge`、`terraform destroy`、`mail/mailx/sendmail`（第 53-61、177-187 行） |

**财务类操作**通过工具名模式强制确认（`extremeRiskPolicy.ts:63`）：

```ts
const EXTERNAL_TOOL_NAMES = /(?:^|_)(?:send|publish|deploy|release|purchase|payment|transfer|trade|post_comment|create_issue)(?:_|$)/i;
```

任何名称含 `purchase`/`payment`/`transfer`/`trade`/`send` 的工具调用，无论参数如何，一律 `requiresConfirmation: true`。

**最独特的"防自我提权"设计**：Policy B 把 Agent 自己授权体系的源码路径列为写保护对象（`extremeRiskPolicy.ts:64`）：

```ts
const AUTHORIZATION_SOURCE_PATH = /(?:^|[/\\])src[/\\](?:(?:main|shared)[/\\].*(?:authorization|approval|permission|sandbox).*
  |shared[/\\](?:extremeRiskPolicy|toolApproval|toolPermissions|agentWorkspace|kernelContract)\.(?:ts|js)
  |preload[/\\]index\.(?:ts|js)|renderer[/\\]components[/\\]AgentChatPanel\.tsx)$/i;
```

无论是 `file_write` 还是 `shell_exec`（含 `sed -i`、`perl -i`、`tee`、`mv`/`cp` 等变更型命令，`isMutatingExecutable` 第 251-256 行）触碰这些文件，都会强制人工确认——**Agent 不能偷偷改写自己的权限边界来提权**。

## 三、工作区沙箱：路径边界 + 三层收窄策略

**沙箱策略模型**（`src/shared/agentWorkspace.ts:39-58`）：

```ts
type AgentSandboxPolicy = {
  mode: "workspace_write" | "read_only";      // 只读沙箱：file_write/shell_exec 全部拒绝
  network: "none" | "approved_domains" | "task_policy";
  shell: "disabled" | "approved_commands" | "workspace_only";
  allowWorkspaceEscape: boolean;              // 默认 false
  extraReadRoots: string[]; extraWriteRoots: string[];
};
```

- **默认最严**：`buildDefaultSandboxPolicy()`（第 135-144 行）= `workspace_write + task_policy + approved_commands + allowWorkspaceEscape:false`。
- **路径边界校验**走 `validatePathInsideRunContext()` → `validatePathInsideLocationRoots()`（`src/shared/locationResource.ts:139-179`），具备三重防护：
  1. 规范化防 `..` 穿越（`normalizeAbsolutePath`，第 214-234 行）；
  2. **symlink 边界检测**：逐段 `lstatSync` 检查，若候选路径中间段是指向边界的软链接则拒绝（`findSymlinkPathSegment`，第 243-277 行），仅放行 macOS 系统别名 `/var→/private/var`、`/tmp→/private/tmp`（第 311-335 行）；
  3. **realpath 比对**：`resolveComparableRealPath()`（第 279-309 行）解析真实路径后再做边界包含判定，对已存在和不存在的路径（逐级回溯真实前缀）都生效——堵住"先建软链再写入"的逃逸手法。
- **子 Agent 沙箱只能收窄不能放宽**：`narrowSandboxPolicy()`（`agentWorkspace.ts:280-315`）对 network/shell 取更严模式、`allowWorkspaceEscape` 取逻辑与、子 extraRoots 必须是父 roots 的子路径。
- **Git worktree 工作区需显式授权**：`assertGitWorktreeCreationAllowed()`（`src/main/agentWorkspaceService.ts:235-263`）要求 `explicit_user_approval` 或受信仓库策略，否则抛错。
- **Shell 逃逸防护**：`allowWorkspaceEscape=false` 时，`authorizeToolCallWithinRunContext`（`src/shared/toolPermissions.ts:486-509`）逐条检查 ShellPlan 提取的所有触碰路径，任一在工作区外即拒绝；且 `opaqueExecution`（`sh -c`/`python -c`/`node`/`xargs` 等无法静态分析路径的嵌套解释器调用，`shellAnalyzer.ts:91-114`）直接拒绝。

## 四、Wildcard 绕过与命令注入防护

**① Shell 命令模板精确匹配**：`authorizeShellCommand()`（`toolPermissions.ts:777-802`）先用 `shellControlOperatorPattern = /(;|&&|\|\||`|\$\(|\||[<>])/` 拒绝一切含控制符的命令，再将命令与任务声明的**模板**做正则编译匹配（`compileShellTemplate`，第 827-845 行），模板中的 `*` 与 `{{var}}` 通配符只能匹配**不含控制符的单个参数**。

**② 权限规则的 ask-by-default + 控制符降权**：`evaluatePermission()`（`kernel/permissionEngine.ts:68-95`）中，含控制符的 shell 命令**禁止**用 `allow` 规则的 `*` 模式做"简化命令"匹配，只能精确匹配整条命令；无匹配规则默认 `ask`。

**③ macOS 危险命令硬黑名单**：`DENY_LISTED_COMMANDS`（`permissionEngine.ts:21-31`）永久拒绝 `osascript`、`security`、`shortcuts`、`automator`、`systemsetup`、`tccutil`、`spctl`、`csrutil`、`nvram`。`isCommandDenyListed()`（第 48-66 行）**检查所有 token 且取 basename**，捕获 `sudo osascript`、`/bin/sh -c osascript` 等绕过。

**④ ShellPlan 结构化分析替代 naive tokenizer**：`src/main/tools/shell/shellAnalyzer.ts` 的 `analyzeShell()` 将原始命令解析成结构化 `ShellPlan`（命令序列、每命令读写路径、控制符、网络访问、opaqueExecution），正确切分 `&&`/管道/`$()`/反引号替换/重定向目标，展开 `~` 和 `$VAR`。授权层与 Policy B 层共用同一份 ShellPlan 作为"single source of truth"（`toolAuthorizationService.ts:96-99`）。

**⑤ 自动授权不可绕过 Policy B**：`toolApprovalCoordinator.ts:80-83`，即使开启自动授权/Goal 模式全速运行，批量放行也跳过 `risk.requiresConfirmation` 的待审批项。且 `toolAuthorizationService.ts:195-204`：若无人工确认通道（如后台运行），极高危操作**降级为拒绝**而非放行。

## 五、超时、取消与审计

- **工具级超时**：非 shell 工具统一 120s `Promise.race` 超时（`agentToolExecutor.ts:117-140`）；`shell_exec` 超时 clamp 在 25–600000ms、默认 120s，`maxBuffer` 限 1MB。
- **审批超时**：`DEFAULT_APPROVAL_TIMEOUT_MS = 60_000`（`toolApprovalCoordinator.ts:19`），超时自动拒绝并提示"请改用安全替代方案"。
- **取消传播**：`AbortSignal` 贯穿授权与执行全链；运行取消时待审批弹窗自动结算为拒绝（`toolApprovalCoordinator.ts:136-150`）；shell 执行通过 `exec` 的 `signal` 选项直接杀进程。
- **审计日志**：每次授权决策（含拒绝）都经 `auditLog.append()` 落盘，`ToolAuditEvent` 含 taskId、请求、决策理由，渲染层可经 `toolAudit:list` IPC 查看。

## 六、Preload / IPC 层安全隔离

- `src/main/main.ts:91-95`：BrowserWindow 强制 `contextIsolation: true, nodeIntegration: false`，渲染进程无 Node 能力。
- `src/preload/index.ts:547`：仅通过 `contextBridge.exposeInMainWorld("buildingAgent", buildingAgent)` 暴露一个**白名单化的窄 API 对象**——每个方法固定对应一个 IPC channel，渲染层无法构造任意 channel；所有跨层参数均为结构化序列化的 typed payload。
- 授权类 IPC（`main.ts:507-525`）只暴露 `getMode/setAutoApprovalEnabled/setGoalModeEnabled/resolve` 四个受控入口。
- Goal 模式下自动授权被**锁定不可关闭**（`autoApprovalLocked: goalModeEnabled`，`toolApprovalCoordinator.ts:54`），防止 UI 层绕过运行时策略。

## 七、原生工具分级声明（ACI 策略）

`src/shared/agentToolCapabilities.ts` 为每个工具声明 `sideEffect`（none/local_read/local_write/destructive/external）、`requiresConfirmation`、平台敏感性；`src/shared/toolAciPolicy.ts:21-80` 的 `evaluateToolAciPolicy()` 强制每个原生工具必须声明 riskLevel、permissionScope、observableEvents，且描述禁用含糊词——**工具目录本身被 CI 级策略审计**。文件整理类操作走"预览→事务日志→可回滚"三段式（`file_move_plan`/`file_apply_moves`/`file_rollback_moves`）。

## 对 Zerox Agent 对比有用的要点（差异化优势）

1. **四层纵深授权 vs 竞品的单层确认弹窗**：Claude Code / Cursor 等以"一次性规则 + 弹窗"为主，Zerox 是规则层、策略层、Policy B 层、执行层串联，且授权与执行共用同一 canonical context（防 TOCTOU）。
2. **Policy B 的"不可绕过"属性可被量化**：自动授权（含 Goal 全速模式）跳过所有 `requiresConfirmation` 项；后台无人值守时极高危操作降级为拒绝而非放行；60s 超时自动拒绝；通配符规则对含控制符命令失效。
3. **防自我提权独特点**：`AUTHORIZATION_SOURCE_PATH` 把授权体系自身源码列为写保护——Agent 改不了自己的权限边界，这是目前主流桌面 Agent 未见明确实现的差异。
4. **沙箱防逃逸的技术深度**：realpath 比对 + 逐段 symlink 检测 + opaqueExecution 静态拒绝 + 子 Agent 沙箱只收窄，远超多数竞品"cwd 限制"的粒度。
5. **可观测即默认**：每次决策（含拒绝）都进审计日志，配合工具级 ACI 策略声明，"权限可控"不是宣传语而是 CI 可验证的契约。
6. **可注意的弱点（报告需诚实）**：macOS 特化明显；`shellAnalyzer` 是自研 tokenizer 而非 tree-sitter（代码注释自认是 fallback），极端 shell 语法下存在理论漏判空间；IPC 层未启用 Electron `sandbox: true`（仅 contextIsolation+nodeIntegration:false）。

**未验证项**：本简报仅覆盖代码静态阅读，未运行 `npm test` 验证测试套件实时通过率。
