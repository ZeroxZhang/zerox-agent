import path from "node:path";
import os from "node:os";
import type { ScheduledTaskStore } from "./taskStore";
import type { ToolAuditLog } from "./toolAuditLog";
import { evaluatePermission } from "./kernel/permissionEngine";
import {
  authorizeToolCallWithinRunContext,
  type AuthorizeTaskToolCallResult,
  type TaskPermissionPolicy,
  type ToolCallRequest,
} from "../shared/toolPermissions";
import { analyzeShell, type ShellPlan } from "./tools/shell/shellAnalyzer";
import type { AgentRunContext } from "../shared/agentWorkspace";
import type { PermissionRule } from "../shared/kernelContract";

export type ToolAuthorizationService = {
  authorize(
    taskId: string,
    request: ToolCallRequest,
    options?: ToolAuthorizationOptions,
  ): Promise<AuthorizeTaskToolCallResult>;
};

export type ToolAuthorizationOptions = {
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
};

export type ToolUserApprovalResult = {
  approved: boolean;
  reason?: string;
};

export function createToolAuthorizationService(options: {
  taskStore: ScheduledTaskStore;
  auditLog: ToolAuditLog;
  homeDir?: string;
  permissionRules?: PermissionRule[] | (() => PermissionRule[]);
  requestUserApproval?: (
    request: ToolUserApprovalRequest,
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
      if (
        !decision.allowed &&
        options.requestUserApproval &&
        shouldRequestUserApproval(decision.reason)
      ) {
        const approvalRequest = {
          taskId: subject.id,
          taskName: subject.name,
          request,
          deniedReason: decision.reason,
        };
        await authorizeOptions?.onApprovalRequested?.(approvalRequest);
        const approval = await options.requestUserApproval(approvalRequest);
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
