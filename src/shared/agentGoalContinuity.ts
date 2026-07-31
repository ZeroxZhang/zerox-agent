import type { Goal, Milestone } from "./agentGoal";

export type GoalContinuityLedgerEvent = {
  at: string;
  kind: string;
  summary: string;
  milestoneId?: string;
  evidenceRefs?: string[];
};

export type GoalContinuityCheckpointInput = {
  goal: Goal;
  ledgerEvents?: GoalContinuityLedgerEvent[];
  now?: string;
  compact?: boolean;
};

export function buildGoalContinuityCheckpoint(
  input: GoalContinuityCheckpointInput,
): string {
  if (input.compact) {
    return buildCompactGoalContinuityCheckpoint(input);
  }

  const ledgerEvents = input.ledgerEvents ?? [];
  const checkpointedAt = input.now ?? input.goal.updatedAt;

  return [
    "[Goal continuity checkpoint - never compact]",
    "",
    "## §1 Active intent",
    `Goal: ${input.goal.description}`,
    `> ${input.goal.description}`,
    "",
    "## §2 Next concrete action",
    nextConcreteAction(input.goal),
    "",
    "## §3 Directives",
    "- local-first; permissioned tools; evidence-backed acceptance.",
    ...selectedSkillDirective(input.goal),
    "Success criteria:",
    ...input.goal.successCriteria.map(
      (criterion) =>
        `- ${criterion.id}: ${criterion.description}; checks=${criterion.acceptanceChecks
          .map((check) => `${check.id}:${check.kind}`)
          .join(", ")}`,
    ),
    "",
    "## §4 Task tree",
    ...taskTree(input.goal.milestones),
    "",
    "## §5 Current work",
    currentWork(input.goal),
    "",
    "## §6 Files and evidence",
    ...filesAndEvidence(input.goal, ledgerEvents),
    "",
    "## §7 Discovered knowledge",
    "Current progress ledger:",
    ...recentLedgerLines(ledgerEvents, ["milestone_accepted", "goal_replanned"]),
    "",
    "## §8 Errors and fixes",
    ...errorsAndFixes(input.goal, ledgerEvents),
    "",
    "## §9 Live resources",
    `- status=${input.goal.status}; planVersion=${input.goal.planVersion}; checkpointedAt=${checkpointedAt}`,
    `- execution usage ${executionUsageLine(input.goal)}`,
    "",
    "## §10 Design decisions",
    `- reviewPolicy=${input.goal.reviewPolicy}; stopReason=${input.goal.stopReason ?? "none"}`,
    "",
    "## §11 Open notes",
    ...openNotes(input.goal, ledgerEvents),
  ].join("\n");
}

function buildCompactGoalContinuityCheckpoint(
  input: GoalContinuityCheckpointInput,
): string {
  const goal = input.goal;
  const ledgerEvents = input.ledgerEvents ?? [];
  const checkpointedAt = input.now ?? goal.updatedAt;
  return [
    "[Goal continuity checkpoint - never compact]",
    "## §1 Active intent",
    `Goal: ${goal.description}`,
    "## §2 Next concrete action",
    nextConcreteAction(goal),
    "## §3 Directives",
    ...selectedSkillDirective(goal),
    `Success criteria: ${goal.successCriteria.map((criterion) => criterion.description).join("; ") || "none"}`,
    "## §4 Task tree",
    compactTaskTree(goal.milestones),
    "## §5 Current work",
    currentWork(goal),
    "## §6 Files and evidence",
    compactEvidence(goal, ledgerEvents),
    "## §7 Discovered knowledge",
    `Current progress ledger: ${compactLedger(ledgerEvents)}`,
    "## §8 Errors and fixes",
    compactErrors(goal),
    "## §9 Live resources",
    `status=${goal.status}; plan=${goal.planVersion}; checkpointedAt=${checkpointedAt}; ${executionUsageLine(goal)}`,
    "## §10 Design decisions",
    `reviewPolicy=${goal.reviewPolicy}; stopReason=${goal.stopReason ?? "none"}`,
    "## §11 Open notes",
    `accepted=${goal.milestones.filter((milestone) => milestone.state === "accepted").length}/${goal.milestones.length}`,
  ].join("\n");
}

function selectedSkillDirective(goal: Goal): string[] {
  if (!goal.selectedSkill) {
    return [];
  }

  return [
    `- selectedSkill=${goal.selectedSkill.manifest.name}; must follow selected skill body and output requirements.`,
  ];
}

function nextConcreteAction(goal: Goal): string {
  const running = goal.milestones.find((milestone) => milestone.state === "running");
  if (running) {
    return `Continue running milestone ${running.id}: ${running.description}`;
  }

  const ready = goal.milestones.find((milestone) => milestone.state === "ready");
  if (ready) {
    return `Start ready milestone ${ready.id}: ${ready.description}`;
  }

  const pending = goal.milestones.find((milestone) => milestone.state === "pending");
  if (pending) {
    return `Unblock pending milestone ${pending.id}: ${pending.description}`;
  }

  if (
    goal.milestones.length > 0 &&
    goal.milestones.every((milestone) =>
      milestone.state === "accepted" || milestone.state === "skipped"
    )
  ) {
    return "Run goal-level acceptance over accepted milestone evidence.";
  }

  if (goal.status === "waiting_for_review") {
    return "Wait for explicit user review decision before dispatching more work.";
  }

  return "Inspect goal state and decide the next safe action.";
}

function taskTree(milestones: Milestone[]): string[] {
  if (!milestones.length) {
    return ["- (no milestones planned)"];
  }

  return milestones.map((milestone) => {
    const dependsOn = milestone.dependsOn.length
      ? ` dependsOn=${milestone.dependsOn.join(",")}`
      : "";
    const attempts = milestone.attempts > 0 ? ` attempts=${milestone.attempts}` : "";
    const summary =
      milestone.state === "accepted"
        ? milestone.lastAcceptanceSummary ?? "Accepted."
        : milestone.description;
    return `- ${milestone.id} [${milestone.state}] ${summary}${dependsOn}${attempts}`;
  });
}

function compactTaskTree(milestones: Milestone[]): string {
  if (!milestones.length) {
    return "(no milestones)";
  }
  return milestones
    .map((milestone) => {
      const detail =
        milestone.state === "accepted"
          ? milestone.lastAcceptanceSummary ?? "Accepted."
          : milestone.description;
      return `${milestone.id}[${milestone.state}] ${detail}`;
    })
    .join(" -> ");
}

function currentWork(goal: Goal): string {
  const active = goal.milestones.find((milestone) =>
    milestone.state === "running" || milestone.state === "ready"
  );
  if (!active) {
    return `Goal status is ${goal.status}; no active milestone is currently runnable.`;
  }

  return `${active.id}: ${active.description}`;
}

function filesAndEvidence(
  goal: Goal,
  ledgerEvents: GoalContinuityLedgerEvent[],
): string[] {
  const refs = new Set<string>();
  for (const event of ledgerEvents) {
    for (const ref of event.evidenceRefs ?? []) {
      refs.add(ref);
    }
  }
  for (const milestone of goal.milestones) {
    for (const runId of milestone.runIds) {
      refs.add(`run:${runId}`);
    }
  }

  if (!refs.size) {
    return ["- (no evidence refs recorded yet)"];
  }

  return [...refs].map((ref) => `- ${ref}`);
}

function compactEvidence(
  goal: Goal,
  ledgerEvents: GoalContinuityLedgerEvent[],
): string {
  const refs = filesAndEvidence(goal, ledgerEvents)
    .filter((line) => !line.includes("(no evidence"))
    .map((line) => line.replace(/^- /, ""))
    .slice(0, 4);
  return refs.length ? refs.join(", ") : "none";
}

function compactLedger(ledgerEvents: GoalContinuityLedgerEvent[]): string {
  const latest = ledgerEvents.at(-1);
  return latest ? `${latest.kind}: ${latest.summary}` : "none";
}

function compactErrors(goal: Goal): string {
  const failed = goal.milestones.find((milestone) =>
    milestone.state === "rejected" || milestone.state === "failed"
  );
  return failed
    ? `${failed.id}: ${failed.lastAcceptanceSummary ?? failed.lastRunSummary ?? failed.state}`
    : "none";
}

function recentLedgerLines(
  ledgerEvents: GoalContinuityLedgerEvent[],
  kinds: string[],
): string[] {
  const filtered = ledgerEvents
    .filter((event) => kinds.includes(event.kind))
    .slice(-4);
  if (!filtered.length) {
    return ["- (none yet)"];
  }

  return filtered.map((event) => {
    const milestone = event.milestoneId ? ` milestone=${event.milestoneId}` : "";
    return `- ${event.at} ${event.kind}${milestone}: ${event.summary}`;
  });
}

function errorsAndFixes(
  goal: Goal,
  ledgerEvents: GoalContinuityLedgerEvent[],
): string[] {
  const rejected = goal.milestones.filter((milestone) =>
    milestone.state === "rejected" || milestone.state === "failed"
  );
  const rejectedLines = rejected.map((milestone) =>
    `- ${milestone.id} [${milestone.state}]: ${
      milestone.lastAcceptanceSummary ?? milestone.lastRunSummary ?? "No summary."
    }`
  );
  const ledgerLines = recentLedgerLines(ledgerEvents, [
    "milestone_rejected",
    "goal_replanned",
    "goal_stopped",
  ]);
  const lines = [
    ...rejectedLines,
    ...ledgerLines.filter((line) => line !== "- (none yet)"),
  ];
  return lines.length ? lines : ["- (none recorded)"];
}

function executionUsageLine(goal: Goal): string {
  return [
    `iterations=${goal.executionUsage.iterations}`,
    `toolCalls=${goal.executionUsage.toolCalls}`,
    `wallClockMs=${goal.executionUsage.wallClockMs}`,
    `tokens=${goal.executionUsage.tokens}`,
    `replans=${goal.executionUsage.replans}`,
  ].join("; ");
}

function openNotes(
  goal: Goal,
  ledgerEvents: GoalContinuityLedgerEvent[],
): string[] {
  const latest = ledgerEvents.at(-1);
  return [
    `- latestLedger=${latest ? `${latest.kind}: ${latest.summary}` : "none"}`,
    `- acceptedMilestones=${goal.milestones.filter((milestone) => milestone.state === "accepted").length}/${goal.milestones.length}`,
  ];
}
