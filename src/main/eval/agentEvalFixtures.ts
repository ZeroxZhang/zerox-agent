import type {
  AgentTrajectoryEvent,
  AgentTrajectoryEventType,
} from "../../shared/agentTrajectory";

export type AgentEvalFixture = {
  id: string;
  description: string;
  events: AgentTrajectoryEvent[];
  requiredEventTypes: AgentTrajectoryEventType[];
  assertions?: AgentEvalEventAssertion[];
  recoverabilityRequired?: boolean;
};

export type AgentEvalEventAssertion = {
  type: AgentTrajectoryEventType;
  payload?: Record<string, unknown>;
  after?: AgentTrajectoryEventType;
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
      assertions: [
        { type: "workspace_escape_denied", after: "tool_call" },
        {
          type: "failure_classified",
          payload: { failureClass: "permission_denied" },
        },
      ],
    },
    {
      id: "code-engineering-native-tools",
      description:
        "Code engineering runs use native code, git, and test tools before finalizing.",
      events: createEvents("code-engineering-native-tools", [
        ["model_request", {}],
        ["model_response", {}],
        ["tool_call", { toolName: "code_search" }],
        [
          "native_tool_invocation",
          { toolName: "code_search", nativeKind: "code", riskLevel: "low" },
        ],
        [
          "native_tool_observation",
          { toolName: "code_search", nativeKind: "code", ok: true },
        ],
        ["tool_result", { toolName: "code_search", ok: true }],
        ["tool_call", { toolName: "git_status" }],
        [
          "native_tool_invocation",
          { toolName: "git_status", nativeKind: "git", riskLevel: "low" },
        ],
        [
          "native_tool_observation",
          { toolName: "git_status", nativeKind: "git", ok: true },
        ],
        ["tool_result", { toolName: "git_status", ok: true }],
        ["tool_call", { toolName: "git_diff" }],
        [
          "native_tool_invocation",
          { toolName: "git_diff", nativeKind: "git", riskLevel: "medium" },
        ],
        [
          "native_tool_observation",
          { toolName: "git_diff", nativeKind: "git", ok: true },
        ],
        ["tool_result", { toolName: "git_diff", ok: true }],
        ["tool_call", { toolName: "test_run" }],
        [
          "native_tool_invocation",
          { toolName: "test_run", nativeKind: "test", riskLevel: "medium" },
        ],
        [
          "native_tool_observation",
          { toolName: "test_run", nativeKind: "test", ok: true },
        ],
        ["tool_result", { toolName: "test_run", ok: true }],
        ["final_summary", { status: "succeeded" }],
      ]),
      requiredEventTypes: [
        "tool_call",
        "native_tool_invocation",
        "native_tool_observation",
        "tool_result",
        "final_summary",
      ],
      assertions: [
        {
          type: "native_tool_invocation",
          payload: { toolName: "code_search", nativeKind: "code" },
          after: "tool_call",
        },
        {
          type: "native_tool_invocation",
          payload: { toolName: "git_status", nativeKind: "git" },
          after: "tool_call",
        },
        {
          type: "native_tool_invocation",
          payload: { toolName: "git_diff", nativeKind: "git" },
          after: "tool_call",
        },
        {
          type: "native_tool_invocation",
          payload: { toolName: "test_run", nativeKind: "test" },
          after: "tool_call",
        },
        {
          type: "native_tool_observation",
          payload: { toolName: "test_run", ok: true },
          after: "native_tool_invocation",
        },
      ],
    },
    {
      id: "reflection-after-test-failure",
      description:
        "A failed test_run records reflection before failure classification.",
      events: createEvents("reflection-after-test-failure", [
        ["tool_call", { toolName: "test_run" }],
        ["tool_result", { toolName: "test_run", ok: false }],
        [
          "reflection_added",
          { toolName: "test_run", failureClass: "verification_failed" },
        ],
        ["failure_classified", { failureClass: "tool_execution_failed" }],
      ]),
      requiredEventTypes: [
        "tool_call",
        "tool_result",
        "reflection_added",
        "failure_classified",
      ],
      assertions: [
        {
          type: "reflection_added",
          payload: { failureClass: "verification_failed" },
          after: "tool_result",
        },
      ],
      recoverabilityRequired: true,
    },
    {
      id: "episode-eval-candidate",
      description:
        "A completed episode records eval candidate artifact generation.",
      events: createEvents("episode-eval-candidate", [
        ["tool_call", { toolName: "code_search" }],
        ["tool_result", { toolName: "code_search", ok: true }],
        ["artifact_created", { artifactType: "eval_candidate" }],
        ["final_summary", { status: "succeeded" }],
      ]),
      requiredEventTypes: [
        "tool_call",
        "tool_result",
        "artifact_created",
        "final_summary",
      ],
      assertions: [
        {
          type: "artifact_created",
          payload: { artifactType: "eval_candidate" },
          after: "tool_result",
        },
      ],
    },
    {
      id: "research-writing-native-tools",
      description:
        "Research writing runs fetch sources, record citations, check coverage, and write a sourced Markdown report.",
      events: createEvents("research-writing-native-tools", [
        ["model_request", {}],
        ["model_response", {}],
        ["tool_call", { toolName: "web_fetch_document" }],
        [
          "native_tool_invocation",
          {
            toolName: "web_fetch_document",
            nativeKind: "web",
            riskLevel: "medium",
          },
        ],
        [
          "native_tool_observation",
          { toolName: "web_fetch_document", nativeKind: "web", ok: true },
        ],
        ["tool_result", { toolName: "web_fetch_document", ok: true }],
        ["tool_call", { toolName: "citation_record" }],
        [
          "native_tool_invocation",
          {
            toolName: "citation_record",
            nativeKind: "citation",
            riskLevel: "low",
          },
        ],
        [
          "native_tool_observation",
          { toolName: "citation_record", nativeKind: "citation", ok: true },
        ],
        ["tool_result", { toolName: "citation_record", ok: true }],
        ["tool_call", { toolName: "citation_coverage_check" }],
        [
          "native_tool_invocation",
          {
            toolName: "citation_coverage_check",
            nativeKind: "citation",
            riskLevel: "low",
          },
        ],
        [
          "native_tool_observation",
          {
            toolName: "citation_coverage_check",
            nativeKind: "citation",
            ok: true,
          },
        ],
        [
          "tool_result",
          {
            toolName: "citation_coverage_check",
            ok: true,
            coverageOk: true,
          },
        ],
        ["tool_call", { toolName: "markdown_report_write" }],
        [
          "native_tool_invocation",
          {
            toolName: "markdown_report_write",
            nativeKind: "report",
            riskLevel: "medium",
          },
        ],
        [
          "native_tool_observation",
          {
            toolName: "markdown_report_write",
            nativeKind: "report",
            ok: true,
          },
        ],
        [
          "tool_result",
          {
            toolName: "markdown_report_write",
            ok: true,
            artifactType: "markdown_report",
            citationsSidecar: true,
          },
        ],
        [
          "final_summary",
          {
            status: "succeeded",
            sourcedFacts: 1,
            modelInferences: 1,
          },
        ],
      ]),
      requiredEventTypes: [
        "tool_call",
        "native_tool_invocation",
        "native_tool_observation",
        "tool_result",
        "final_summary",
      ],
      assertions: [
        {
          type: "native_tool_invocation",
          payload: { toolName: "web_fetch_document", nativeKind: "web" },
          after: "tool_call",
        },
        {
          type: "native_tool_invocation",
          payload: { toolName: "citation_record", nativeKind: "citation" },
          after: "tool_call",
        },
        {
          type: "native_tool_invocation",
          payload: {
            toolName: "citation_coverage_check",
            nativeKind: "citation",
          },
          after: "tool_call",
        },
        {
          type: "tool_result",
          payload: { toolName: "citation_coverage_check", coverageOk: true },
          after: "native_tool_observation",
        },
        {
          type: "tool_result",
          payload: { toolName: "markdown_report_write", citationsSidecar: true },
          after: "native_tool_observation",
        },
        {
          type: "final_summary",
          payload: { sourcedFacts: 1, modelInferences: 1 },
          after: "tool_result",
        },
      ],
    },
    {
      id: "multi-agent-lineage",
      description:
        "A parent run delegates a bounded child handoff and records the review gate.",
      events: createEvents("multi-agent-lineage", [
        ["run_context_created", { workspaceId: "workspace_eval" }],
        [
          "child_handoff_created",
          {
            handoffId: "handoff_eval",
            parentRunId: "run_parent",
            childRole: "researcher",
            objective: "Collect citation evidence.",
            reviewGateRequired: true,
          },
        ],
        [
          "child_run_scheduled",
          {
            sessionId: "session_eval",
            parentRunId: "run_parent",
            childRunId: "run_child",
            agentRole: "researcher",
          },
        ],
        [
          "child_handoff_completed",
          {
            handoffId: "handoff_eval",
            childRunId: "run_child",
            status: "succeeded",
            artifacts: 1,
          },
        ],
        [
          "child_handoff_reviewed",
          {
            handoffId: "handoff_eval",
            childRunId: "run_child",
            decision: "accepted",
          },
        ],
        ["final_summary", { status: "succeeded" }],
      ]),
      requiredEventTypes: [
        "run_context_created",
        "child_handoff_created",
        "child_run_scheduled",
        "child_handoff_completed",
        "child_handoff_reviewed",
        "final_summary",
      ],
      assertions: [
        {
          type: "child_handoff_created",
          payload: { childRole: "researcher", reviewGateRequired: true },
          after: "run_context_created",
        },
        {
          type: "child_run_scheduled",
          payload: { childRunId: "run_child", agentRole: "researcher" },
          after: "child_handoff_created",
        },
        {
          type: "child_handoff_completed",
          payload: { status: "succeeded" },
          after: "child_run_scheduled",
        },
        {
          type: "child_handoff_reviewed",
          payload: { decision: "accepted" },
          after: "child_handoff_completed",
        },
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
