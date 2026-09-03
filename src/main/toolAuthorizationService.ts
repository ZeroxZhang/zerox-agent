import path from "node:path";
import os from "node:os";
import type { ScheduledTaskStore } from "./taskStore";
import type { ToolAuditLog } from "./toolAuditLog";
import {
  evaluatePermission,
  isCommandDenyListed,
} from "./kernel/permissionEngine";
import {
  classifyToolApprovalRisk,
  type ToolApprovalCausalRef,
  type ToolApprovalRisk,
} from "../shared/toolApproval";
import {
  authorizeToolCallWithinRunContext,
  type AuthorizeTaskToolCallResult,
  type TaskPermissionPolicy,
  type ToolAuthorizationDecision,
  type ToolAuthorizationDecisionKind,
  type ToolCallRequest,
} from "../shared/toolPermissions";
import { analyzeShell, type ShellPlan } from "./tools/shell/shellAnalyzer";
import type { AgentRunContext } from "../shared/agentWorkspace";
import type { PermissionRule } from "../shared/kernelContract";
import { authorizePlanModeTool } from "./planModePolicy";

export type ToolAuthorizationService = {
  authorize(
    taskId: string,
    request: ToolCallRequest,
    options?: ToolAuthorizationOptions,
  ): Promise<AuthorizeTaskToolCallResult>;
};

export type ToolAuthorizationOptions = {
  signal?: AbortSignal;
  runContext?: AgentRunContext;
  runtimeTask?: RuntimeToolAuthorizationTask;
  onApprovalRequested?: (request: ToolUserApprovalRequest) => Promise<void>;
  onApprovalResolved?: (result: ToolUserApprovalResult) => Promise<void>;
  approvalContext?: ToolApprovalCausalRef;
};

export type RuntimeToolAuthorizationTask = {
  name: string;
  permissions: TaskPermissionPolicy;
  policyLabel?: string;
};

export type ToolUserApprovalRequest = {
  taskId: string;
  taskName: string;
  request: ToolCallRequest;
  deniedReason: string;
  risk?: ToolApprovalRisk;
  causalRef?: ToolApprovalCausalRef;
  approvalId?: string;
  /** Machine-readable denial classification that produced this request. */
  decisionKind?: ToolAuthorizationDecisionKind;
};

export type ToolUserApprovalResult = {
  approved: boolean;
  reason?: string;
  automatic?: boolean;
  approvalId?: string;
  approvalRevision?: number;
  decisionId?: string;
};

export type ToolUserApprovalRequestOptions = {
  signal?: AbortSignal;
  onIntentPersisted?: (intent: { id: string; revision: number }) => Promise<void>;
};

export function createToolAuthorizationService(options: {
  taskStore: ScheduledTaskStore;
  auditLog: ToolAuditLog;
  homeDir?: string;
  permissionRules?: PermissionRule[] | (() => PermissionRule[]);
  requestUserApproval?: (
    request: ToolUserApprovalRequest,
    options?: ToolUserApprovalRequestOptions,
  ) => Promise<ToolUserApprovalResult>;
  /**
   * Advanced consent switch (default OFF): when ON, automatic tasks and goal
   * runs may auto-approve policy_deny calls. Never affects sandbox_deny,
   * invalid_request, hard_deny, or extreme-risk confirmations.
   */
  policyDenyOverrideEnabled?: () => boolean;
}): ToolAuthorizationService {
  const homeDir = options.homeDir ?? os.homedir();

  return {
    async authorize(taskId, request, authorizeOptions) {
      const task = await options.taskStore.get(taskId);
      const subject = task
        ? {
            id: task.id,
            name: task.name,
            permissions: task.permissions,
            policyLabel: undefined,
          }
        : authorizeOptions?.runtimeTask
          ? {
              id: taskId,
              name: authorizeOptions.runtimeTask.name,
              permissions: authorizeOptions.runtimeTask.permissions,
              policyLabel: authorizeOptions.runtimeTask.policyLabel,
            }
          : null;

      if (!subject) {
        return {
          ok: false,
          message: "Scheduled task was not found.",
        };
      }

      const runContext = authorizeOptions?.runContext;

      if (runContext?.runMode === "plan") {
        const planDecision = authorizePlanModeTool(request);
        if (!planDecision.allowed) {
          const decision: ToolAuthorizationDecision = {
            allowed: false,
            kind: "policy_deny",
            reason: planDecision.reason,
          };
          const auditEvent = await options.auditLog.append({
            taskId: subject.id,
            request,
            decision,
          });
          return {
            ok: true,
            decision,
            auditEvent,
          };
        }
      }

      // Every command-capable tool shares one parsed ShellPlan. test_run uses
      // its declared workspaceRoot as cwd, while shell_exec uses the canonical
      // run root. Authorization and the executor therefore reason about the
      // same paths, network access, and nested interpreter structure.
      const isCommandTool =
        request.toolName === "shell_exec" || request.toolName === "test_run";
      const requestedTestRoot = String(request.args.workspaceRoot ?? "").trim();
      const commandCwd =
        request.toolName === "test_run" && requestedTestRoot
          ? path.isAbsolute(requestedTestRoot)
            ? path.resolve(requestedTestRoot)
            : path.resolve(runContext?.workspaceRoot ?? process.cwd(), requestedTestRoot)
          : runContext?.workspaceRoot;
      const shellPlan: ShellPlan | undefined =
        isCommandTool && runContext && commandCwd
          ? analyzeShell(String(request.args.command ?? ""), { cwd: commandCwd })
          : undefined;

      // Hard-deny layer: macOS-sensitive automation commands are never
      // executable through the agent shell, regardless of rules, approval
      // dialogs, or the advanced consent switch.
      if (isCommandTool) {
        const deniedCommand = isCommandDenyListed(
          String(request.args.command ?? ""),
        );
        if (deniedCommand) {
          const hardDecision: ToolAuthorizationDecision = {
            allowed: false,
            kind: "hard_deny",
            reason:
              `硬性拒绝：${deniedCommand} 属于 macOS 敏感命令（可能绕过安全控制或自动化系统交互），禁止执行。`,
          };
          const auditEvent = await options.auditLog.append({
            taskId: subject.id,
            request,
            decision: hardDecision,
          });
          return {
            ok: true,
            decision: hardDecision,
            auditEvent,
          };
        }
      }

      const ruleEvaluation = evaluatePermission(
        request,
        resolvePermissionRules(options.permissionRules),
        shellPlan ? { shellPlan } : undefined,
      );
      if (ruleEvaluation.action === "deny") {
        const ruleDecision = evaluateRuleDecision(ruleEvaluation);
        const auditEvent = await options.auditLog.append({
          taskId: subject.id,
          request,
          decision: ruleDecision,
        });
        return {
          ok: true,
          decision: ruleDecision,
          auditEvent,
        };
      }

      let decision = authorizeToolCallWithinRunContext(
        expandHomePermissionPolicy(subject.permissions, homeDir),
        request,
        runContext,
        shellPlan ? { shellPlan } : undefined,
      );
      if (decision.allowed && ruleEvaluation.action === "allow") {
        decision = {
          ...decision,
          reason: `${formatRuleDecisionReason(ruleEvaluation)} ${decision.reason}`,
        };
      }
      if (decision.allowed && subject.policyLabel) {
        decision = {
          ...decision,
          reason: `${decision.reason} (${subject.policyLabel})`,
        };
      }
      const risk = classifyToolApprovalRisk({
        taskName: subject.name,
        deniedReason: decision.reason,
        request,
        ...(shellPlan ? { shellPlan } : {}),
      });
      if (
        !decision.allowed &&
        task &&
        !risk.requiresConfirmation &&
        shouldAutoApproveScheduledTask(task, request, decision.reason) &&
        canAutoOverrideDecision(
          decision.kind,
          options.policyDenyOverrideEnabled?.() ?? false,
        )
      ) {
        decision = {
          allowed: true,
          kind: "allowed",
          reason: `自动任务全自动模式已放行 ${request.toolName}。原始策略：${decision.reason}`,
        };
      }
      if (
        (risk.requiresConfirmation || !decision.allowed) &&
        (risk.requiresConfirmation || shouldRequestInteractiveApproval(task)) &&
        options.requestUserApproval &&
        shouldRequestUserApproval(decision.reason)
      ) {
        const approvalRequest = {
          taskId: subject.id,
          taskName: subject.name,
          request,
          deniedReason: risk.requiresConfirmation
            ? risk.reason
            : decision.reason,
          decisionKind: decision.kind,
          risk,
          ...(authorizeOptions?.approvalContext
            ? { causalRef: authorizeOptions.approvalContext }
            : {}),
        };
        throwIfAborted(authorizeOptions?.signal);
        const approval = await options.requestUserApproval(approvalRequest, {
          ...(authorizeOptions?.signal
            ? { signal: authorizeOptions.signal }
            : {}),
          async onIntentPersisted(intent) {
            await authorizeOptions?.onApprovalRequested?.({
              ...approvalRequest,
              approvalId: intent.id,
            });
          },
        });
        throwIfAborted(authorizeOptions?.signal);
        await authorizeOptions?.onApprovalResolved?.(approval);

        decision = approval.approved
          ? {
              allowed: true,
              kind: "allowed",
              reason:
                approval.reason ??
                `用户已在弹窗中授权本次操作。原始风险：${decision.reason}`,
            }
          : {
              allowed: false,
              kind: "policy_deny",
              reason:
                approval.reason ??
                `用户拒绝授权本次操作。原始风险：${decision.reason}`,
            };
      }
      if (
        risk.requiresConfirmation &&
        !options.requestUserApproval &&
        decision.allowed
      ) {
        decision = {
          allowed: false,
          kind: "policy_deny",
          reason: `极高危操作需要用户确认：${risk.reason}`,
        };
      }
      throwIfAborted(authorizeOptions?.signal);
      const auditEvent = await options.auditLog.append({
        taskId: subject.id,
        request,
        decision,
      });

      return {
        ok: true,
        decision,
        auditEvent,
      };
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("Authorization canceled.", "AbortError");
}

function shouldRequestInteractiveApproval(
  task: { schedule: { kind: string } } | null,
): boolean {
  return !task || task.schedule.kind === "manual";
}

function shouldAutoApproveScheduledTask(
  task: { schedule: { kind: string } },
  request: ToolCallRequest,
  reason: string,
): boolean {
  if (task.schedule.kind === "manual") {
    return false;
  }

  if (request.toolName === "shell_exec" || request.toolName === "test_run") {
    return false;
  }

  return shouldRequestUserApproval(reason);
}

function resolvePermissionRules(
  rules: PermissionRule[] | (() => PermissionRule[]) | undefined,
): PermissionRule[] {
  if (!rules) {
    return [];
  }

  return typeof rules === "function" ? rules() : rules;
}

function evaluateRuleDecision(
  evaluation: ReturnType<typeof evaluatePermission>,
): ToolAuthorizationDecision {
  return {
    allowed: false,
    kind: "policy_deny",
    reason: formatRuleDecisionReason(evaluation),
  };
}

/**
 * Default-strict automatic consent: unattended paths (scheduled auto tasks,
 * goal runs) may auto-approve only approval_required calls, or policy_deny
 * calls when the advanced autoOverridePolicyDeny switch is ON. sandbox_deny,
 * invalid_request and hard_deny are never auto-lifted.
 */
function canAutoOverrideDecision(
  kind: ToolAuthorizationDecisionKind | undefined,
  policyDenyOverrideEnabled: boolean,
): boolean {
  if (kind === "approval_required") return true;
  if (kind === "policy_deny") return policyDenyOverrideEnabled;
  return false;
}

function formatRuleDecisionReason(
  evaluation: ReturnType<typeof evaluatePermission>,
): string {
  const verb = evaluation.action === "allow" ? "allowed" : "denied";
  return `Permission rule ${verb} ${evaluation.command} (${evaluation.matchedRule}).`;
}

function shouldRequestUserApproval(reason: string): boolean {
  if (/运行沙箱阻止|workspace_only/.test(reason)) {
    return false;
  }

  return !/缺少|必填|必须是有效/i.test(reason);
}

function expandHomePermissionPolicy(
  policy: TaskPermissionPolicy,
  homeDir: string,
): TaskPermissionPolicy {
  return {
    ...policy,
    files: {
      read: expandHomeDirectories(policy.files.read, homeDir),
      write: expandHomeDirectories(policy.files.write, homeDir),
    },
  };
}

function expandHomeDirectories(directories: string[], homeDir: string): string[] {
  return [
    ...directories,
    ...directories
      .filter((directory) => directory === "~" || directory.startsWith("~/"))
      .map((directory) =>
        directory === "~" ? homeDir : path.join(homeDir, directory.slice(2)),
      ),
  ];
}
