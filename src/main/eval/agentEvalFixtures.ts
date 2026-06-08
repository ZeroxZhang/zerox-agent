import type {
  AgentTrajectoryEvent,
  AgentTrajectoryEventType,
} from "../../shared/agentTrajectory";

export type AgentEvalFixture = {
  id: string;
  description: string;
  events: AgentTrajectoryEvent[];
  requiredEventTypes: AgentTrajectoryEventType[];
  recoverabilityRequired?: boolean;
};

export function createAgentEvalFixtures(): AgentEvalFixture[] {
  return [
    {
      id: "file-report-happy-path",
      description: "Agent lists a directory, reads one file, and writes a report.",
      events: createEvents("file-report-happy-path", [
        ["state_transition", {}],
        ["model_request", {}],
        ["model_response", {}],
        ["tool_call", { toolName: "file_list" }],
        ["tool_result", { toolName: "file_list", ok: true }],
        ["tool_call", { toolName: "file_read" }],
        ["tool_result", { toolName: "file_read", ok: true }],
        ["tool_call", { toolName: "file_write" }],
        ["tool_result", { toolName: "file_write", ok: true }],
        ["final_summary", {}],
      ]),
      requiredEventTypes: ["tool_call", "tool_result", "final_summary"],
    },
    {
      id: "permission-denied-recovery",
      description: "Agent encounters a denied path and records the safety failure.",
      events: createEvents("permission-denied-recovery", [
        ["tool_call", { toolName: "file_write" }],
        ["failure_classified", { failureClass: "permission_denied" }],
        ["checkpoint_written", { status: "failed" }],
      ]),
      requiredEventTypes: ["tool_call", "failure_classified", "checkpoint_written"],
    },
    {
      id: "invalid-plan-json",
      description: "Invalid model output is classified instead of silently ignored.",
      events: createEvents("invalid-plan-json", [
        ["model_response", { invalid: true }],
        ["failure_classified", { failureClass: "invalid_model_output" }],
      ]),
      requiredEventTypes: ["model_response", "failure_classified"],
    },
    {
      id: "tool-error-reflection",
      description: "A failed tool result is followed by a successful retry.",
      events: createEvents("tool-error-reflection", [
        ["tool_call", { toolName: "file_read" }],
        ["tool_result", { toolName: "file_read", ok: false }],
        ["tool_call", { toolName: "file_read" }],
        ["tool_result", { toolName: "file_read", ok: true }],
        ["final_summary", {}],
      ]),
      requiredEventTypes: ["tool_result", "final_summary"],
    },
    {
      id: "resume-after-tool-call",
      description: "A paused run resumes after a checkpoint without duplicate tools.",
      events: createEvents("resume-after-tool-call", [
        ["checkpoint_written", { status: "paused" }],
        ["state_transition", { from: "paused", to: "running" }],
        ["model_request", {}],
        ["model_response", {}],
        ["final_summary", {}],
      ]),
      requiredEventTypes: ["checkpoint_written", "state_transition", "final_summary"],
      recoverabilityRequired: true,
    },
    {
      id: "workspace-escape-denied",
      description: "A workspace-scoped run denies a write outside its sandbox.",
      events: createEvents("workspace-escape-denied", [
        ["run_context_created", { workspaceId: "workspace_eval" }],
        ["tool_call", { toolName: "file_write", path: "/tmp/outside/report.md" }],
        [
          "workspace_escape_denied",
          {
            toolName: "file_write",
            reason:
              "file_write 被运行沙箱阻止：路径不在工作区或额外可写目录内。",
          },
        ],
        ["failure_classified", { failureClass: "permission_denied" }],
      ]),
      requiredEventTypes: [
        "run_context_created",
        "tool_call",
        "workspace_escape_denied",
        "failure_classified",
      ],
    },
    {
      id: "multi-agent-lineage",
      description: "A parent run records a child agent session boundary.",
      events: createEvents("multi-agent-lineage", [
        ["run_context_created", { workspaceId: "workspace_eval" }],
        [
          "child_run_scheduled",
          {
            sessionId: "session_eval",
            parentRunId: "run_parent",
            childRunId: "run_child",
            agentRole: "executor",
          },
        ],
        ["final_summary", { status: "succeeded" }],
      ]),
      requiredEventTypes: [
        "run_context_created",
        "child_run_scheduled",
        "final_summary",
      ],
    },
  ];
}

function createEvents(
  runId: string,
  entries: Array<[AgentTrajectoryEventType, Record<string, unknown>]>,
): AgentTrajectoryEvent[] {
  return entries.map(([type, payload], index) => ({
    id: `${runId}_${index + 1}`,
    runId,
    type,
    sequence: index + 1,
    payload,
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    createdAt: "2026-06-07T00:00:00.000Z",
  }));
}
