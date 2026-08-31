import type {
  RuntimeStrategy,
  StrategyPlan,
  StrategyPlanStep,
  TaskDomain,
  TaskFrame,
  TaskMode,
  TaskRisk,
} from "./agentTaskStrategy";

export type WorkflowId =
  | "local_file_organize"
  | "code_change"
  | "web_inspection"
  | "data_analysis"
  | "writing_report"
  | "research_brief";

export type WorkflowDefinition = {
  id: WorkflowId;
  label: string;
  domain: TaskDomain;
  modes: TaskMode[];
  preferredRuntime: RuntimeStrategy;
  preferredTools: string[];
  recoveryTools?: string[];
  confirmationRisks: TaskRisk[];
  guardrails: string[];
};

export const workflowCatalog: WorkflowDefinition[] = [
  {
    id: "local_file_organize",
    label: "Local File Organize",
    domain: "files",
    modes: ["deterministic"],
    preferredRuntime: "quick_action",
    preferredTools: [
      "file_inventory",
      "file_move_plan",
      "file_apply_moves",
      "file_verify_moves",
    ],
    recoveryTools: ["file_move_transaction_read", "file_rollback_moves"],
    confirmationRisks: ["moves_data", "deletes_data"],
    guardrails: [
      "Resolve user path references before execution.",
      "Preview every move before applying local changes.",
      "Write a transaction log before mutating files.",
      "Verify moved files after apply.",
    ],
  },
  {
    id: "code_change",
    label: "Code Change",
    domain: "code",
    modes: ["exploratory", "deterministic"],
    preferredRuntime: "agent_loop",
    preferredTools: ["code_search", "git_diff", "test_run"],
    confirmationRisks: ["deletes_data", "external_side_effect"],
    guardrails: [
      "Inspect relevant files before editing.",
      "Use focused tests before broader verification.",
      "Keep unrelated worktree changes intact.",
    ],
  },
  {
    id: "web_inspection",
    label: "Web Inspection",
    domain: "web",
    modes: ["exploratory", "interactive"],
    preferredRuntime: "agent_loop",
    preferredTools: ["web_fetch", "web_search"],
    confirmationRisks: ["external_side_effect"],
    guardrails: ["Use cited sources and distinguish inference from source facts."],
  },
  {
    id: "data_analysis",
    label: "Data Analysis",
    domain: "data",
    modes: ["exploratory", "deterministic"],
    preferredRuntime: "scripted_workflow",
    preferredTools: ["file_read", "file_write"],
    confirmationRisks: ["writes_files", "moves_data", "deletes_data"],
    guardrails: ["Use parsers or structured APIs instead of ad hoc text slicing."],
  },
  {
    id: "writing_report",
    label: "Writing Report",
    domain: "writing",
    modes: ["exploratory", "deterministic"],
    preferredRuntime: "agent_loop",
    preferredTools: ["markdown_report_write"],
    confirmationRisks: ["writes_files"],
    guardrails: ["Separate cited facts from model inferences."],
  },
  {
    id: "research_brief",
    label: "Research Brief",
    domain: "research",
    modes: ["exploratory"],
    preferredRuntime: "agent_loop",
    preferredTools: [
      "web_fetch_document",
      "citation_record",
      "citation_coverage_check",
      "markdown_report_write",
    ],
    confirmationRisks: ["external_side_effect", "writes_files"],
    guardrails: ["Record citations and run coverage checks before finalizing."],
  },
];

export function selectWorkflowForTask(
  frame: TaskFrame,
): WorkflowDefinition | null {
  return (
    workflowCatalog.find(
      (workflow) =>
        workflow.domain === frame.domain && workflow.modes.includes(frame.mode),
    ) ?? null
  );
}

export function buildWorkflowStrategyPlan(
  frame: TaskFrame,
  workflow: WorkflowDefinition,
): StrategyPlan {
  const steps = buildWorkflowSteps(workflow);
  const confirmationGates =
    workflow.confirmationRisks.includes(frame.risk) &&
    steps.some((step) => step.risk !== "none")
      ? [
          {
            id: "confirm_file_moves",
            beforeStepId: firstRiskyStepId(steps),
            reason: "Preview file moves before changing local data.",
          },
        ]
      : [];

  return {
    runtime: workflow.preferredRuntime,
    confirmationGates,
    steps,
  };
}

function buildWorkflowSteps(workflow: WorkflowDefinition): StrategyPlanStep[] {
  if (workflow.id === "local_file_organize") {
    return [
      {
        id: "inventory",
        operation: "batch inventory target directory",
        toolName: "file_inventory",
        toolClass: "batch_read",
        risk: "none",
        batchExpected: true,
        platformSensitive: false,
      },
      {
        id: "plan_moves",
        operation: "create deterministic file move plan",
        toolName: "file_move_plan",
        toolClass: "model",
        risk: "none",
        batchExpected: true,
        platformSensitive: false,
      },
      {
        id: "apply_moves",
        operation: "apply reviewed file moves",
        toolName: "file_apply_moves",
        toolClass: "write",
        risk: "local_write",
        batchExpected: true,
        platformSensitive: false,
      },
      {
        id: "verify_moves",
        operation: "verify moved files",
        toolName: "file_verify_moves",
        toolClass: "batch_read",
        risk: "none",
        batchExpected: true,
        platformSensitive: false,
      },
    ];
  }

  return workflow.preferredTools.map((toolName, index) => ({
    id: `step_${index + 1}`,
    operation: `${workflow.id}:${toolName}`,
    toolName,
    toolClass: toolName === "test_run" ? "test" : "model",
    risk: "none",
    batchExpected: false,
    platformSensitive: false,
  }));
}

function firstRiskyStepId(steps: StrategyPlanStep[]): string {
  return steps.find((step) => step.risk !== "none")?.id ?? steps[0]?.id ?? "step_1";
}
