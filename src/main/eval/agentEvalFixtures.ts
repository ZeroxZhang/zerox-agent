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
        "A failed test_run records reflection before a recovered final summary.",
      events: createEvents("reflection-after-test-failure", [
        ["tool_call", { toolName: "test_run" }],
        ["tool_result", { toolName: "test_run", ok: false }],
        [
          "reflection_added",
          { toolName: "test_run", failureClass: "verification_failed" },
        ],
        ["final_summary", { status: "succeeded" }],
      ]),
      requiredEventTypes: [
        "tool_call",
        "tool_result",
        "reflection_added",
        "final_summary",
      ],
      assertions: [
        {
          type: "reflection_added",
          payload: { failureClass: "verification_failed" },
          after: "tool_result",
        },
        {
          type: "final_summary",
          payload: { status: "succeeded" },
          after: "reflection_added",
        },
      ],
      recoverabilityRequired: true,
    },
    {
      id: "reflection-retry-budget-exhausted",
      description:
        "Repeated recoverable tool failures record retry budget exhaustion before failure classification.",
      events: createEvents("reflection-retry-budget-exhausted", [
        ["tool_call", { toolName: "file_read", path: "~/Downloads/missing-1.md" }],
        ["tool_result", { toolName: "file_read", ok: false }],
        [
          "reflection_added",
          { toolName: "file_read", failureClass: "tool_failed", retryAllowed: true },
        ],
        ["tool_call", { toolName: "file_read", path: "~/Downloads/missing-2.md" }],
        ["tool_result", { toolName: "file_read", ok: false }],
        [
          "reflection_added",
          {
            toolName: "file_read",
            failureClass: "budget_exhausted",
            retryAllowed: false,
          },
        ],
        [
          "failure_classified",
          {
            failureClass: "tool_error",
            toolName: "file_read",
            reflectionFailureClass: "budget_exhausted",
          },
        ],
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
          payload: { failureClass: "budget_exhausted" },
          after: "tool_result",
        },
        {
          type: "failure_classified",
          payload: { reflectionFailureClass: "budget_exhausted" },
          after: "reflection_added",
        },
      ],
      recoverabilityRequired: true,
    },
    {
      id: "context-compaction-before-model-request",
      description:
        "Long active-loop histories are compacted before the next model request.",
      events: createEvents("context-compaction-before-model-request", [
        [
          "context_compacted",
          {
            originalMessageCount: 18,
            compactedMessageCount: 8,
            estimatedTokens: 12000,
            tokenBudget: 5734,
          },
        ],
        ["model_request", { messageCount: 8 }],
        ["model_response", { finishReason: "stop" }],
        ["final_summary", { status: "succeeded" }],
      ]),
      requiredEventTypes: [
        "context_compacted",
        "model_request",
        "model_response",
        "final_summary",
      ],
      assertions: [
        {
          type: "model_request",
          after: "context_compacted",
        },
      ],
    },
    {
      id: "tool-result-checkpoint-before-next-tool",
      description:
        "Recoverable runs write a checkpoint after each tool result before continuing.",
      events: createEvents("tool-result-checkpoint-before-next-tool", [
        ["model_request", {}],
        ["model_response", { toolCallCount: 2 }],
        ["tool_call", { toolName: "file_read", toolCallId: "call_1" }],
        ["tool_result", { toolName: "file_read", ok: true, toolCallId: "call_1" }],
        ["checkpoint_written", { status: "running", toolCallCount: 1 }],
        ["tool_call", { toolName: "file_read", toolCallId: "call_2" }],
        ["tool_result", { toolName: "file_read", ok: true, toolCallId: "call_2" }],
        ["checkpoint_written", { status: "running", toolCallCount: 2 }],
        ["model_request", {}],
        ["model_response", { finishReason: "stop" }],
        ["final_summary", { status: "succeeded" }],
      ]),
      requiredEventTypes: [
        "tool_call",
        "tool_result",
        "checkpoint_written",
        "final_summary",
      ],
      assertions: [
        {
          type: "checkpoint_written",
          payload: { toolCallCount: 1 },
          after: "tool_result",
        },
        {
          type: "checkpoint_written",
          payload: { toolCallCount: 2 },
          after: "tool_result",
        },
      ],
      recoverabilityRequired: true,
    },
    {
      id: "model-retry-before-response",
      description:
        "Transient model request failures are retried before the run proceeds.",
      events: createEvents("model-retry-before-response", [
        ["model_request", { turn: 0 }],
        [
          "model_retry",
          {
            attempt: 1,
            maxRetries: 2,
            delayMs: 1000,
            error: "LLM request failed with status 500: overloaded",
          },
        ],
        ["model_response", { finishReason: "stop" }],
        ["final_summary", { status: "succeeded" }],
      ]),
      requiredEventTypes: [
        "model_request",
        "model_retry",
        "model_response",
        "final_summary",
      ],
      assertions: [
        {
          type: "model_retry",
          payload: { attempt: 1, maxRetries: 2 },
          after: "model_request",
        },
        {
          type: "model_response",
          after: "model_retry",
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
    ...createGoalEvalFixtures(),
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

function createGoalEvalFixtures(): AgentEvalFixture[] {
  return [
    {
      id: "goal-achieved-within-budget",
      description:
        "Goal Mode accepts three milestones and reaches achieved inside explicit budget limits.",
      events: createEvents("goal-achieved-within-budget", [
        [
          "goal_planned",
          {
            goalId: "goal_eval_achieved",
            milestoneCount: 3,
            budget: { maxIterations: 6, maxToolCalls: 12 },
          },
        ],
        [
          "milestone_started",
          { goalId: "goal_eval_achieved", milestoneId: "milestone_plan" },
        ],
        [
          "acceptance_checked",
          {
            goalId: "goal_eval_achieved",
            milestoneId: "milestone_plan",
            accepted: true,
            deterministicFirst: true,
            evidenceRefs: ["run_plan#artifact"],
          },
        ],
        ["checkpoint_written", { goalId: "goal_eval_achieved", status: "executing" }],
        [
          "milestone_started",
          { goalId: "goal_eval_achieved", milestoneId: "milestone_execute" },
        ],
        [
          "acceptance_checked",
          {
            goalId: "goal_eval_achieved",
            milestoneId: "milestone_execute",
            accepted: true,
            deterministicFirst: true,
            evidenceRefs: ["run_execute#artifact"],
          },
        ],
        ["checkpoint_written", { goalId: "goal_eval_achieved", status: "executing" }],
        [
          "milestone_started",
          { goalId: "goal_eval_achieved", milestoneId: "milestone_verify" },
        ],
        [
          "acceptance_checked",
          {
            goalId: "goal_eval_achieved",
            milestoneId: "milestone_verify",
            accepted: true,
            deterministicFirst: true,
            evidenceRefs: ["run_verify#artifact"],
          },
        ],
        [
          "goal_stopped",
          {
            goalId: "goal_eval_achieved",
            status: "achieved",
            stopReason: "goal_accepted",
          },
        ],
        ["final_summary", { status: "succeeded" }],
      ]),
      requiredEventTypes: [
        "goal_planned",
        "milestone_started",
        "acceptance_checked",
        "checkpoint_written",
        "goal_stopped",
        "final_summary",
      ],
      assertions: [
        {
          type: "acceptance_checked",
          payload: { accepted: true, deterministicFirst: true },
          after: "milestone_started",
        },
        {
          type: "goal_stopped",
          payload: { status: "achieved", stopReason: "goal_accepted" },
          after: "acceptance_checked",
        },
      ],
    },
    {
      id: "goal-stopped-by-budget",
      description:
        "Goal Mode stops on budget exhaustion before dispatching another milestone.",
      events: createEvents("goal-stopped-by-budget", [
        [
          "goal_planned",
          {
            goalId: "goal_eval_budget",
            milestoneCount: 2,
            budget: { maxIterations: 1, maxToolCalls: 1 },
          },
        ],
        [
          "milestone_started",
          { goalId: "goal_eval_budget", milestoneId: "milestone_first" },
        ],
        [
          "acceptance_checked",
          {
            goalId: "goal_eval_budget",
            milestoneId: "milestone_first",
            accepted: true,
            deterministicFirst: true,
            evidenceRefs: ["run_first#artifact"],
          },
        ],
        [
          "checkpoint_written",
          {
            goalId: "goal_eval_budget",
            status: "executing",
            budgetUsage: { iterations: 1, toolCalls: 1 },
          },
        ],
        [
          "goal_stopped",
          {
            goalId: "goal_eval_budget",
            status: "stopped_budget",
            stopReason: "budget_exhausted",
            budgetStopBeforeDispatch: true,
          },
        ],
        ["final_summary", { status: "stopped_budget" }],
      ]),
      requiredEventTypes: [
        "goal_planned",
        "milestone_started",
        "acceptance_checked",
        "checkpoint_written",
        "goal_stopped",
        "final_summary",
      ],
      assertions: [
        {
          type: "goal_stopped",
          payload: {
            status: "stopped_budget",
            budgetStopBeforeDispatch: true,
          },
          after: "checkpoint_written",
        },
      ],
    },
    {
      id: "goal-stalled-detection",
      description:
        "Goal Mode reports stalled progress when no ready milestone can advance.",
      events: createEvents("goal-stalled-detection", [
        [
          "goal_planned",
          {
            goalId: "goal_eval_stalled",
            milestoneCount: 1,
            blockedDependency: "missing_dependency",
          },
        ],
        [
          "acceptance_checked",
          {
            goalId: "goal_eval_stalled",
            accepted: false,
            deterministicFirst: true,
            evidenceRefs: [],
          },
        ],
        [
          "goal_stopped",
          {
            goalId: "goal_eval_stalled",
            status: "stopped_stalled",
            stopReason: "progress_stalled",
            helpSummary: "No ready milestones are available.",
          },
        ],
        ["final_summary", { status: "stopped_stalled" }],
      ]),
      requiredEventTypes: [
        "goal_planned",
        "acceptance_checked",
        "goal_stopped",
        "final_summary",
      ],
      assertions: [
        {
          type: "goal_stopped",
          payload: { status: "stopped_stalled", stopReason: "progress_stalled" },
          after: "acceptance_checked",
        },
      ],
    },
    {
      id: "goal-replan-on-acceptance-failure",
      description:
        "Goal Mode replans after a rejected milestone and later accepts the replacement milestone.",
      events: createEvents("goal-replan-on-acceptance-failure", [
        [
          "goal_planned",
          { goalId: "goal_eval_replan", planVersion: 1, milestoneCount: 1 },
        ],
        [
          "milestone_started",
          { goalId: "goal_eval_replan", milestoneId: "milestone_original" },
        ],
        [
          "acceptance_checked",
          {
            goalId: "goal_eval_replan",
            milestoneId: "milestone_original",
            accepted: false,
            deterministicFirst: true,
            evidenceRefs: ["run_original#failure"],
          },
        ],
        [
          "goal_replanned",
          { goalId: "goal_eval_replan", planVersion: 2, replans: 1 },
        ],
        [
          "milestone_started",
          { goalId: "goal_eval_replan", milestoneId: "milestone_replanned" },
        ],
        [
          "acceptance_checked",
          {
            goalId: "goal_eval_replan",
            milestoneId: "milestone_replanned",
            accepted: true,
            deterministicFirst: true,
            evidenceRefs: ["run_replanned#artifact"],
          },
        ],
        [
          "goal_stopped",
          {
            goalId: "goal_eval_replan",
            status: "achieved",
            stopReason: "goal_accepted",
          },
        ],
        ["final_summary", { status: "succeeded" }],
      ]),
      requiredEventTypes: [
        "goal_planned",
        "milestone_started",
        "acceptance_checked",
        "goal_replanned",
        "goal_stopped",
        "final_summary",
      ],
      assertions: [
        {
          type: "goal_replanned",
          payload: { planVersion: 2, replans: 1 },
          after: "acceptance_checked",
        },
        {
          type: "goal_stopped",
          payload: { status: "achieved" },
          after: "goal_replanned",
        },
      ],
    },
    {
      id: "goal-review-gate-blocks",
      description:
        "Goal Mode suspends at a review gate and only starts the next milestone after approval.",
      events: createEvents("goal-review-gate-blocks", [
        [
          "goal_planned",
          {
            goalId: "goal_eval_review",
            reviewPolicy: "review_each_milestone",
            milestoneCount: 2,
          },
        ],
        [
          "milestone_started",
          { goalId: "goal_eval_review", milestoneId: "milestone_before_review" },
        ],
        [
          "acceptance_checked",
          {
            goalId: "goal_eval_review",
            milestoneId: "milestone_before_review",
            accepted: true,
            deterministicFirst: true,
            evidenceRefs: ["run_before_review#artifact"],
          },
        ],
        [
          "goal_review_requested",
          {
            goalId: "goal_eval_review",
            milestoneId: "milestone_before_review",
            reviewPolicy: "review_each_milestone",
          },
        ],
        ["checkpoint_written", { goalId: "goal_eval_review", status: "waiting_for_review" }],
        [
          "milestone_started",
          { goalId: "goal_eval_review", milestoneId: "milestone_after_review" },
        ],
        [
          "acceptance_checked",
          {
            goalId: "goal_eval_review",
            milestoneId: "milestone_after_review",
            accepted: true,
            deterministicFirst: true,
            evidenceRefs: ["run_after_review#artifact"],
          },
        ],
        [
          "goal_stopped",
          {
            goalId: "goal_eval_review",
            status: "achieved",
            stopReason: "goal_accepted",
          },
        ],
        ["final_summary", { status: "succeeded" }],
      ]),
      requiredEventTypes: [
        "goal_planned",
        "milestone_started",
        "acceptance_checked",
        "goal_review_requested",
        "checkpoint_written",
        "goal_stopped",
        "final_summary",
      ],
      assertions: [
        {
          type: "goal_review_requested",
          payload: { reviewPolicy: "review_each_milestone" },
          after: "acceptance_checked",
        },
        {
          type: "milestone_started",
          payload: { milestoneId: "milestone_after_review" },
          after: "goal_review_requested",
        },
      ],
    },
    {
      id: "goal-context-compaction-preserves-anchors",
      description:
        "Goal Mode compacts long context while retaining goal anchors and evidence references.",
      events: createEvents("goal-context-compaction-preserves-anchors", [
        [
          "goal_planned",
          {
            goalId: "goal_eval_context",
            successCriteria: 2,
            ledgerEntries: 6,
          },
        ],
        [
          "context_compacted",
          {
            goalId: "goal_eval_context",
            anchorsPreserved: true,
            retainedAnchorIds: [
              "goal_description",
              "success_criteria",
              "progress_ledger",
              "accepted_milestones",
              "evidence_refs",
            ],
            tokenBudget: 5734,
          },
        ],
        ["model_request", { goalId: "goal_eval_context", messageCount: 8 }],
        [
          "acceptance_checked",
          {
            goalId: "goal_eval_context",
            accepted: true,
            deterministicFirst: true,
            evidenceRefs: ["tool_result_ref:abc123"],
          },
        ],
        [
          "goal_stopped",
          {
            goalId: "goal_eval_context",
            status: "achieved",
            stopReason: "goal_accepted",
          },
        ],
        ["final_summary", { status: "succeeded" }],
      ]),
      requiredEventTypes: [
        "goal_planned",
        "context_compacted",
        "model_request",
        "acceptance_checked",
        "goal_stopped",
        "final_summary",
      ],
      assertions: [
        {
          type: "context_compacted",
          payload: { anchorsPreserved: true },
          after: "goal_planned",
        },
        {
          type: "model_request",
          after: "context_compacted",
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
