import path from "node:path";
import os from "node:os";
import type { ScheduledTaskStore } from "./taskStore";
import type { ToolAuditLog } from "./toolAuditLog";
import { evaluatePermission } from "./kernel/permissionEngine";
import { classifyToolApprovalRisk, type ToolApprovalRisk } from "../shared/toolApproval";
import {
  authorizeToolCallWithinRunContext,
  type AuthorizeTaskToolCallResult,
  type TaskPermissionPolicy,
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
};

export type ToolUserApprovalResult = {
  approved: boolean;
  reason?: string;
  automatic?: boolean;
};

export function createToolAuthorizationService(options: {
  taskStore: ScheduledTaskStore;
  auditLog: ToolAuditLog;
  homeDir?: string;
  permissionRules?: PermissionRule[] | (() => PermissionRule[]);
  requestUserApproval?: (
    request: ToolUserApprovalRequest,
    options?: { signal?: AbortSignal },
  ) => Promise<ToolUserApprovalResult>;
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
          const decision = {
            allowed: false,
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

      // P4: build a ShellPlan for shell_exec when a runContext is available,
      // feeding both permission layers as the single source of truth (Patch 4).
      // Zero regression for non-shell tools / when no runContext is present.
      const shellPlan: ShellPlan | undefined =
        request.toolName === "shell_exec" && runContext
          ? analyzeShell(String(request.args.command ?? ""), { cwd: runContext.workspaceRoot })
          : undefined;

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
          allowed: true,
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
        shouldAutoApproveScheduledTask(task, request, decision.reason)
      ) {
        decision = {
          allowed: true,
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
          risk,
        };
        throwIfAborted(authorizeOptions?.signal);
        await authorizeOptions?.onApprovalRequested?.(approvalRequest);
        throwIfAborted(authorizeOptions?.signal);
        const approval = await options.requestUserApproval(approvalRequest, {
          ...(authorizeOptions?.signal
            ? { signal: authorizeOptions.signal }
            : {}),
        });
        throwIfAborted(authorizeOptions?.signal);
        await authorizeOptions?.onApprovalResolved?.(approval);

        decision = approval.approved
          ? {
              allowed: true,
              reason:
                approval.reason ??
                `用户已在弹窗中授权本次操作。原始风险：${decision.reason}`,
            }
          : {
              allowed: false,
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
) {
  return {
    allowed: false,
    reason: formatRuleDecisionReason(evaluation),
  };
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
