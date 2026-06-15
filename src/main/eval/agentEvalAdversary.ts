import type { AgentEvalReport } from "../../shared/agentEval";
import type { AgentTrajectoryEvent } from "../../shared/agentTrajectory";
import type {
  AgentEvalEventAssertion,
  AgentEvalFixture,
} from "./agentEvalFixtures";
import { runAgentEvals } from "./agentEvalRunner";

export type AgentEvalAdversarialMutation =
  | "remove_required_event"
  | "wrong_payload"
  | "wrong_order"
  | "tamper_goal_budget"
  | "remove_acceptance_check"
  | "remove_goal_judge";

export type AgentEvalAdversarialCase = {
  sourceFixtureId: string;
  mutation: AgentEvalAdversarialMutation;
  fixture: AgentEvalFixture;
};

export type AgentEvalAdversarialReport = {
  passed: boolean;
  checked: number;
  escaped: Array<{
    fixtureId: string;
    mutation: AgentEvalAdversarialMutation;
  }>;
  evalReport: AgentEvalReport;
};

export function createAdversarialAgentEvalCases(
  fixtures: AgentEvalFixture[],
): AgentEvalAdversarialCase[] {
  return fixtures.flatMap((fixture) =>
    [
      createRemoveRequiredEventCase(fixture),
      createWrongPayloadCase(fixture),
      createWrongOrderCase(fixture),
      createTamperGoalBudgetCase(fixture),
      createRemoveAcceptanceCheckCase(fixture),
      createRemoveGoalJudgeCase(fixture),
    ].filter((testCase): testCase is AgentEvalAdversarialCase =>
      Boolean(testCase),
    ),
  );
}

export async function runAdversarialAgentEvals(
  fixtures: AgentEvalFixture[],
): Promise<AgentEvalAdversarialReport> {
  const cases = createAdversarialAgentEvalCases(fixtures);
  const evalReport = await runAgentEvals(cases.map((testCase) => testCase.fixture));
  const rejectedFixtureIds = new Set(
    evalReport.failures.map((failure) => failure.fixtureId),
  );
  const escaped = cases
    .filter((testCase) => !rejectedFixtureIds.has(testCase.fixture.id))
    .map((testCase) => ({
      fixtureId: testCase.fixture.id,
      mutation: testCase.mutation,
    }));

  return {
    passed: escaped.length === 0,
    checked: cases.length,
    escaped,
    evalReport,
  };
}

function createRemoveRequiredEventCase(
  fixture: AgentEvalFixture,
): AgentEvalAdversarialCase | null {
  const eventType = fixture.requiredEventTypes.find((requiredType) =>
    fixture.events.some((event) => event.type === requiredType),
  );
  if (!eventType) {
    return null;
  }

  const mutated = cloneFixture(fixture);
  mutated.events = resequenceEvents(
    mutated.events.filter((event) => event.type !== eventType),
  );

  return createCase(fixture, "remove_required_event", mutated);
}

function createWrongPayloadCase(
  fixture: AgentEvalFixture,
): AgentEvalAdversarialCase | null {
  const assertionIndex = fixture.assertions?.findIndex(
    (assertion) =>
      Object.keys(assertion.payload ?? {}).length > 0 &&
      fixture.events.some((event) => eventMatchesAssertion(event, assertion)),
  );
  if (assertionIndex === undefined || assertionIndex < 0) {
    return null;
  }

  const mutated = cloneFixture(fixture);
  const assertion = mutated.assertions?.[assertionIndex];
  const payloadEntries = Object.entries(assertion?.payload ?? {});
  const [key] = payloadEntries[0] ?? [];
  if (!assertion || !key) {
    return null;
  }

  assertion.payload = {
    ...assertion.payload,
    [key]: createWrongPayloadValue(fixture, assertion, key),
  };

  return createCase(fixture, "wrong_payload", mutated);
}

function createWrongOrderCase(
  fixture: AgentEvalFixture,
): AgentEvalAdversarialCase | null {
  const assertion = fixture.assertions?.find(
    (candidate) =>
      Boolean(candidate.after) &&
      candidate.after !== candidate.type &&
      fixture.events.some((event) => eventMatchesAssertion(event, candidate)) &&
      fixture.events.some((event) => event.type === candidate.after),
  );
  if (!assertion) {
    return null;
  }

  const mutated = cloneFixture(fixture);
  const assertedEvents = mutated.events.filter((event) =>
    eventMatchesAssertion(event, assertion),
  );
  const otherEvents = mutated.events.filter(
    (event) => !eventMatchesAssertion(event, assertion),
  );
  mutated.events = resequenceEvents([...assertedEvents, ...otherEvents]);

  return createCase(fixture, "wrong_order", mutated);
}

function createTamperGoalBudgetCase(
  fixture: AgentEvalFixture,
): AgentEvalAdversarialCase | null {
  const assertionIndex = fixture.assertions?.findIndex((assertion) =>
    Object.prototype.hasOwnProperty.call(
      assertion.payload ?? {},
      "budgetStopBeforeDispatch",
    ),
  );
  if (assertionIndex === undefined || assertionIndex < 0) {
    return null;
  }

  const mutated = cloneFixture(fixture);
  const assertion = mutated.assertions?.[assertionIndex];
  if (!assertion?.payload) {
    return null;
  }

  assertion.payload = {
    ...assertion.payload,
    budgetStopBeforeDispatch: false,
  };

  return createCase(fixture, "tamper_goal_budget", mutated);
}

function createRemoveAcceptanceCheckCase(
  fixture: AgentEvalFixture,
): AgentEvalAdversarialCase | null {
  if (
    !fixture.requiredEventTypes.includes("acceptance_checked") ||
    !fixture.events.some((event) => event.type === "acceptance_checked")
  ) {
    return null;
  }

  const mutated = cloneFixture(fixture);
  mutated.events = resequenceEvents(
    mutated.events.filter((event) => event.type !== "acceptance_checked"),
  );

  return createCase(fixture, "remove_acceptance_check", mutated);
}

function createRemoveGoalJudgeCase(
  fixture: AgentEvalFixture,
): AgentEvalAdversarialCase | null {
  if (
    !fixture.requiredEventTypes.includes("goal_judged") ||
    !fixture.events.some((event) => event.type === "goal_judged")
  ) {
    return null;
  }

  const mutated = cloneFixture(fixture);
  mutated.events = resequenceEvents(
    mutated.events.filter((event) => event.type !== "goal_judged"),
  );

  return createCase(fixture, "remove_goal_judge", mutated);
}

function createCase(
  source: AgentEvalFixture,
  mutation: AgentEvalAdversarialMutation,
  fixture: AgentEvalFixture,
): AgentEvalAdversarialCase {
  fixture.id = `${source.id}::adversarial::${mutation}`;
  fixture.description = `${source.description} [adversarial: ${mutation}]`;

  return {
    sourceFixtureId: source.id,
    mutation,
    fixture,
  };
}

function cloneFixture(fixture: AgentEvalFixture): AgentEvalFixture {
  return structuredClone(fixture) as AgentEvalFixture;
}

function resequenceEvents(events: AgentTrajectoryEvent[]): AgentTrajectoryEvent[] {
  return events.map((event, index) => ({
    ...event,
    sequence: index + 1,
  }));
}

function eventMatchesAssertion(
  event: AgentTrajectoryEvent,
  assertion: AgentEvalEventAssertion,
): boolean {
  if (event.type !== assertion.type) {
    return false;
  }

  return Object.entries(assertion.payload ?? {}).every(
    ([key, value]) => event.payload[key] === value,
  );
}

function createWrongPayloadValue(
  fixture: AgentEvalFixture,
  assertion: AgentEvalEventAssertion,
  key: string,
): string {
  const prefix = `__adversarial_wrong_payload__${fixture.id}_${assertion.type}_${key}`;
  let value = prefix;
  let suffix = 1;
  const existingValues = new Set(
    fixture.events
      .filter((event) => event.type === assertion.type)
      .map((event) => event.payload[key]),
  );

  while (existingValues.has(value)) {
    value = `${prefix}_${suffix}`;
    suffix += 1;
  }

  return value;
}
