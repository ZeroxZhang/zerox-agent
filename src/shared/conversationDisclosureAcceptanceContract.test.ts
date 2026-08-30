import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-acceptance-contract.mjs"
);

const program = JSON.parse(readFileSync(
  path.join(
    process.cwd(),
    ".zerox/conversation-disclosure-program.json",
  ),
  "utf8",
)) as {
  scenarioMatrix: Array<{
    id: string;
    actions: string[];
    expected: string[];
    evidenceRequirements: string[];
  }>;
};
const scenario = program.scenarioMatrix[0]!;

describe("conversation disclosure production scenario receipt", () => {
  it("accepts one exact production main/preload execution receipt", () => {
    expect(contract.validateProductionScenarioReceipt(
      createReceipt(),
      scenario,
    )).toMatchObject({ ok: true, errors: [] });
  });

  it("rejects omitted or reordered actions and requirements", () => {
    const omitted = createReceipt();
    omitted.actions.pop();
    omitted.digest = digestReceipt(omitted);
    expect(
      contract.validateProductionScenarioReceipt(omitted, scenario).ok,
    ).toBe(false);

    const reordered = createReceipt();
    reordered.actions.reverse();
    reordered.digest = digestReceipt(reordered);
    expect(
      contract.validateProductionScenarioReceipt(reordered, scenario).ok,
    ).toBe(false);

    const missingObservation = createReceipt();
    delete missingObservation.actions[0]!.observations.toolResultObserved;
    missingObservation.digest = digestReceipt(missingObservation);
    expect(
      contract.validateProductionScenarioReceipt(
        missingObservation,
        scenario,
      ).ok,
    ).toBe(false);
  });

  it("rejects demo data, absent preload, reused IPC ordinals, and drifted rows", () => {
    const demo = createReceipt();
    demo.demoDataUsed = true;
    demo.productionPreload = false;
    demo.ipcInvocations[1]!.ordinal = 1;
    demo.digest = digestReceipt(demo);
    expect(
      contract.validateProductionScenarioReceipt(demo, scenario).errors,
    ).toEqual(expect.arrayContaining([
      "receipt identity or digest is invalid",
      "production preload IPC trace is incomplete",
    ]));

    const drifted = {
      ...scenario,
      actions: [...scenario.actions, "forged action"],
    };
    expect(
      contract.validateProductionScenarioReceipt(createReceipt(), drifted).ok,
    ).toBe(false);
  });

  it("interrupts recovered processing guided input instead of replaying it", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/main/chatService.ts"),
      "utf8",
    );
    const recoveryStart = source.indexOf(
      "async function recoverPendingSkillInputState",
    );
    const recoveryEnd = source.indexOf(
      "async function persistSkillInputLifecycleState",
      recoveryStart,
    );
    const recovery = source.slice(recoveryStart, recoveryEnd);
    expect(recovery).toContain('persisted.status === "processing"');
    expect(recovery).toContain(
      "await compensateUnrecoverableGuidedInputSettlement(persisted)",
    );
    const compensationStart = source.indexOf(
      "async function compensateUnrecoverableGuidedInputSettlement",
    );
    const compensationEnd = source.indexOf(
      "async function ensureGuidedInputCausalAttempt",
      compensationStart,
    );
    expect(source.slice(compensationStart, compensationEnd)).not.toContain(
      'settlement.state === "committed"',
    );

    const restoreSource = readFileSync(
      path.join(process.cwd(), "src/renderer/chatTaskActivity.ts"),
      "utf8",
    );
    expect(restoreSource).toContain(
      'pending.status === "pending" && inputRequest',
    );
    expect(restoreSource).not.toContain(
      'pending.status === "processing") &&',
    );

    const rendererSource = readFileSync(
      path.join(
        process.cwd(),
        "src/renderer/components/AgentChatPanel.tsx",
      ),
      "utf8",
    );
    expect(rendererSource).toMatch(
      /result\.code === "ATTACHMENT_EXPIRED"[\s\S]*result\.code === "UNKNOWN_SKILL_INPUT"[\s\S]*result\.code === "CONFLICT"[\s\S]*setPendingInputRequest\(null\)/,
    );
  });

  it("binds S10 focus survival to the action that performs the update and navigation", () => {
    for (const relativePath of [
      "src/main/conversationDisclosureAcceptanceDriver.ts",
      "scripts/conversation-disclosure-acceptance-contract.mjs",
      "scripts/run-conversation-disclosure-real-app.mjs",
    ]) {
      const source = readFileSync(path.join(process.cwd(), relativePath), "utf8");
      expect(source).toContain('scenarioId === "S10-accessibility"');
      expect(source).toContain("[1, 0, 2][requirementIndex]");
      expect(source).toContain("expectedRequirementActionIndex(");
    }

    const driverSource = readFileSync(
      path.join(
        process.cwd(),
        "src/main/conversationDisclosureAcceptanceDriver.ts",
      ),
      "utf8",
    );
    for (const observation of [
      "blockingStateExposed",
      "selectedRunStateExposed",
      "selectedEvidenceStateExposed",
      "nonessentialMotionSuppressed",
      "stateChangedUnderReducedMotion",
      "reducedAnimationDurationMs",
      "reducedTransitionDurationMs",
    ]) {
      expect(driverSource).toContain(observation);
    }
    expect(driverSource).toContain("getComputedStyle(motionTarget)");

    const chatSource = readFileSync(
      path.join(
        process.cwd(),
        "src/renderer/components/AgentChatPanel.tsx",
      ),
      "utf8",
    );
    expect(chatSource).toContain(
      'role={row.attention === "blocking" ? "alert" : undefined}',
    );
    for (const relativePath of [
      "src/renderer/components/RunsPanel.tsx",
      "src/renderer/components/RunTrajectoryPanel.tsx",
    ]) {
      const source = readFileSync(path.join(process.cwd(), relativePath), "utf8");
      expect(source).toContain("aria-current");
    }
  });
});

function createReceipt() {
  const actions = ["send_task", "observe_compact_completion"].map(
    (action, index) => ({
      index,
      action,
      executor: "production_preload_ipc",
      ok: true,
      evidenceIds: ["session_1"],
      observations: index === 0
        ? {
            sessionLoaded: true,
            sendSucceeded: true,
            acceptedAssistantPersisted: true,
            answerDeltaObserved: true,
            terminalObserved: true,
            toolInvocationObserved: true,
            toolResultObserved: true,
            toolCallsExecuted: 1,
          }
        : {
            sessionLoaded: true,
            disclosureVisible: true,
            operationsExpanded: "false",
            acceptedNarrativeVisible: true,
            privateReasoningHidden: true,
          },
    }),
  );
  const value = {
    schemaVersion: 1,
    kind: "conversation-disclosure-production-scenario",
    scenarioId: scenario.id,
    scenarioDigest: contract.hashCanonical(scenario),
    executionId: "11111111-1111-4111-8111-111111111111",
    processEpochs: ["main_11111111-1111-4111-8111-111111111111"],
    productionMain: true,
    productionPreload: true,
    demoDataUsed: false,
    expected: scenario.expected,
    evidenceRequirements: scenario.evidenceRequirements,
    actions,
    requirements: scenario.expected.map((_requirement, index) => ({
      index,
      requirement: scenario.expected[index]!,
      ok: true,
      evidenceIds: [
        `action:${actions[Math.min(index, actions.length - 1)]!.index}:${
          contract.hashCanonical(
            actions[Math.min(index, actions.length - 1)]!.observations,
          )
        }`,
        `screenshot:sha256:${"1".repeat(64)}`,
      ],
    })),
    ipcInvocations: [
      { ordinal: 1, channel: "chatSessions:list", ok: true },
      { ordinal: 2, channel: "chatSessions:get", ok: true },
      { ordinal: 3, channel: "agentRuns:list", ok: true },
      { ordinal: 4, channel: "agentRuns:listTrajectory", ok: true },
    ],
    screenshotDigests: [`sha256:${"1".repeat(64)}`],
    status: "passed",
    digest: "",
  };
  value.digest = digestReceipt(value);
  return value;
}

function digestReceipt(value: Record<string, unknown>): string {
  const input = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "digest"),
  );
  return contract.hashCanonical(input);
}
