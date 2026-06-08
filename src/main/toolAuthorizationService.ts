import path from "node:path";
import os from "node:os";
import type { ScheduledTaskStore } from "./taskStore";
import type { ToolAuditLog } from "./toolAuditLog";
import {
  authorizeToolCallWithinRunContext,
  type AuthorizeTaskToolCallResult,
  type TaskPermissionPolicy,
  type ToolCallRequest,
} from "../shared/toolPermissions";
import type { AgentRunContext } from "../shared/agentWorkspace";

export type ToolAuthorizationService = {
  authorize(
    taskId: string,
    request: ToolCallRequest,
    options?: ToolAuthorizationOptions,
  ): Promise<AuthorizeTaskToolCallResult>;
};

export type ToolAuthorizationOptions = {
  runContext?: AgentRunContext;
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
  requestUserApproval?: (
    request: ToolUserApprovalRequest,
  ) => Promise<ToolUserApprovalResult>;
}): ToolAuthorizationService {
  const homeDir = options.homeDir ?? os.homedir();

  return {
    async authorize(taskId, request, authorizeOptions) {
      const task = await options.taskStore.get(taskId);

      if (!task) {
        return {
          ok: false,
          message: "Scheduled task was not found.",
        };
      }

      let decision = authorizeToolCallWithinRunContext(
        expandHomePermissionPolicy(task.permissions, homeDir),
        request,
        authorizeOptions?.runContext,
      );
      if (
        !decision.allowed &&
        options.requestUserApproval &&
        shouldRequestUserApproval(decision.reason)
      ) {
        const approval = await options.requestUserApproval({
          taskId: task.id,
          taskName: task.name,
          request,
          deniedReason: decision.reason,
        });

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
        taskId,
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

function shouldRequestUserApproval(reason: string): boolean {
  if (/运行沙箱阻止/.test(reason)) {
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
