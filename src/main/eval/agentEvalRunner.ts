import type { AgentTrajectoryEventType } from "../../shared/agentTrajectory";
import type { AgentEvalReport } from "../../shared/agentEval";
import type { AgentEvalFixture } from "./agentEvalFixtures";

export async function runAgentEvals(
  fixtures: AgentEvalFixture[],
): Promise<AgentEvalReport> {
  const failures: AgentEvalReport["failures"] = [];
  let passed = 0;

  for (const fixture of fixtures) {
    const missing = findMissingRequiredEvent(fixture);
    if (missing) {
      failures.push({
        fixtureId: fixture.id,
        reason: `Missing required trajectory event "${missing}".`,
      });
      continue;
    }

    const contractFailure = findContractFailure(fixture);
    if (contractFailure) {
      failures.push({
        fixtureId: fixture.id,
        reason: contractFailure,
      });
      continue;
    }

    passed += 1;
  }

  const toolResults = fixtures.flatMap((fixture) =>
    fixture.events.filter((event) => event.type === "tool_result"),
  );
  const successfulToolResults = toolResults.filter(
    (event) => event.payload.ok === true,
  );
  const recoverableFixtures = fixtures.filter(
    (fixture) => fixture.recoverabilityRequired,
  );
  const recoverablePassed = recoverableFixtures.filter(
    (fixture) => !findMissingRequiredEvent(fixture) && !findContractFailure(fixture),
  );

  return {
    total: fixtures.length,
    passed,
    failed: fixtures.length - passed,
    passRate: ratio(passed, fixtures.length),
    toolSuccessRate: ratio(successfulToolResults.length, toolResults.length),
    recoverabilityRate: ratio(recoverablePassed.length, recoverableFixtures.length),
    failures,
  };
}

function findContractFailure(fixture: AgentEvalFixture): string | null {
  for (const assertion of fixture.assertions ?? []) {
    const eventIndex = fixture.events.findIndex(
      (event) => event.type === assertion.type,
    );
    if (eventIndex < 0) {
      return `Missing asserted event "${assertion.type}".`;
    }

    if (assertion.after) {
      const previousIndex = fixture.events.findIndex(
        (event) => event.type === assertion.after,
      );
      if (previousIndex < 0 || previousIndex >= eventIndex) {
        return `"${assertion.type}" must occur after "${assertion.after}".`;
      }
    }

    for (const [key, value] of Object.entries(assertion.payload ?? {})) {
      if (fixture.events[eventIndex]?.payload[key] !== value) {
        return `"${assertion.type}" payload.${key} expected ${String(value)}.`;
      }
    }
  }

  return null;
}

function findMissingRequiredEvent(
  fixture: AgentEvalFixture,
): AgentTrajectoryEventType | null {
  const availableTypes = new Set(fixture.events.map((event) => event.type));

  for (const required of fixture.requiredEventTypes) {
    if (!availableTypes.has(required)) {
      return required;
    }
  }

  return null;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 1;
  }

  return Number((numerator / denominator).toFixed(4));
}
