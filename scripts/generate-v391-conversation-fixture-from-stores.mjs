#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const args = parseArgs(process.argv.slice(2));
const distRoot = requireString(args["dist-root"], "--dist-root");
const configDir = requireString(args["config-dir"], "--config-dir");
const timestamp = "2026-08-20T08:00:00.000Z";
const ids = {
  sessionId: "cd09-v391-session",
  requestId: "cd09-v391-request",
  turnId: "cd09-v391-turn",
  goalId: "cd09-v391-goal",
  planId: "cd09-v391-plan",
  runId: "cd09-v391-run",
  milestoneId: "cd09-v391-milestone",
  workspaceId: "cd09-v391-workspace",
};

const moduleNames = [
  load("chatSessionStore.js"),
  load("planStore.js"),
  load("agentRunStore.js"),
  load("agentTrajectoryStore.js"),
  load("agentGoalStore.js"),
];
const modules = await Promise.all(moduleNames);
const [
  { createChatSessionStore },
  { createPlanStore },
  { createAgentRunStore },
  { createAgentTrajectoryStore },
  { createAgentGoalStore },
] = modules;

const chatIds = deterministicIds([
  ids.sessionId,
  "cd09-v391-user-message",
  "cd09-v391-assistant-message",
]);
const chatStore = createChatSessionStore({
  configDir,
  backend: "json",
  createId: chatIds,
  now: () => new Date(timestamp),
});
const planStore = createPlanStore({
  configDir,
  createId: deterministicIds(["cd09-v391-plan-created"]),
  now: () => timestamp,
});
const runStore = createAgentRunStore({ configDir, backend: "json" });
const trajectoryStore = createAgentTrajectoryStore({
  configDir,
  backend: "json",
});
const goalStore = createAgentGoalStore({ configDir, backend: "json" });

const firstMessage = await chatStore.appendMessage({
  requestId: ids.requestId,
  role: "user",
  content: "Resume the v3.9.1 multidomain compatibility task.",
  workspaceId: ids.workspaceId,
});
if (firstMessage.session.id !== ids.sessionId) {
  throw new Error("v3.9.1 Chat store did not allocate the pinned session id.");
}

const trigger = {
  kind: "initial_request",
  summary: "Create the bounded compatibility plan.",
  evidenceRefs: [ids.requestId],
  at: timestamp,
};
const plan = await planStore.create({
  schemaVersion: 1,
  id: ids.planId,
  sessionId: ids.sessionId,
  workspaceId: ids.workspaceId,
  workspaceRoot: "/tmp/cd09-v391-workspace",
  sourceMessage: "Complete one bounded compatibility milestone.",
  mode: "direct",
  status: "canceled",
  actionGate: "blocked",
  revision: 1,
  taskContract: {
    objective: "Complete one bounded compatibility milestone.",
    audience: "local user",
    inScope: ["v3.9.1 local stores"],
    outOfScope: ["external publishing"],
    constraints: ["preserve local source authority"],
    successCriteria: ["The linked run remains reviewable after upgrade."],
    assumptions: [],
  },
  purpose: "initial",
  goalId: ids.goalId,
  goalPlanVersion: 1,
  trigger,
  evidence: [],
  requestedModelAssignments: {},
  frozenModelAssignments: {},
  rounds: [],
  createdAt: timestamp,
  updatedAt: timestamp,
});
if (!plan.goalContractSnapshot || !plan.goalContractRef) {
  throw new Error("v3.9.1 Plan store did not derive its Goal contract.");
}

const runContext = {
  workspaceId: ids.workspaceId,
  workspaceRoot: "/tmp/cd09-v391-workspace",
  sandbox: {
    mode: "workspace_write",
    network: "none",
    shell: "disabled",
    allowWorkspaceEscape: false,
    extraReadRoots: [],
    extraWriteRoots: [],
  },
  goalId: ids.goalId,
  milestoneId: ids.milestoneId,
  sessionId: ids.sessionId,
  runMode: "execution",
  agentRole: "primary",
  depth: 0,
};
const run = {
  id: ids.runId,
  taskId: "cd09-v391-task",
  taskName: "v3.9.1 multidomain compatibility",
  skillName: "local-file-organizer",
  status: "canceled",
  runContext,
  summary: "The legacy run was canceled without losing evidence.",
  events: [{
    level: "info",
    message: "Legacy run canceled by the user.",
    phase: "done",
    createdAt: timestamp,
  }],
  startedAt: timestamp,
  finishedAt: timestamp,
};
await runStore.append(run);
const trajectoryEvent = {
  id: "cd09-v391-trajectory-event",
  runId: ids.runId,
  type: "state_transition",
  sequence: 1,
  runContext,
  payload: { from: "running", to: "canceled" },
  redaction: {
    containsApiKey: false,
    containsFileContent: false,
    containsUserText: false,
  },
  createdAt: timestamp,
};
await trajectoryStore.append(ids.runId, trajectoryEvent);

const activePlanRef = {
  planId: plan.id,
  planRevision: plan.revision,
  goalPlanVersion: 1,
  mode: plan.mode,
  purpose: "initial",
  goalContractRef: plan.goalContractRef,
};
const criterionId = plan.goalContractSnapshot.successCriteria[0]?.id;
if (!criterionId) {
  throw new Error("v3.9.1 Goal contract has no success criterion.");
}
const criterion = {
  id: criterionId,
  description: "The linked run remains reviewable after upgrade.",
  acceptanceChecks: [{
    id: "cd09-v391-assertion",
    kind: "assertion",
    description: "The legacy run and trajectory remain linked.",
    params: { condition: "run and trajectory identifiers match" },
    requiresEvidence: false,
  }],
};
const goal = {
  id: ids.goalId,
  chatSessionId: ids.sessionId,
  description: "v3.9.1 multidomain compatibility Goal",
  goalContractSnapshot: plan.goalContractSnapshot,
  goalContractRef: plan.goalContractRef,
  activePlanRef,
  planHistory: [{
    ...activePlanRef,
    trigger,
    outcome: "active",
    adoptedAt: timestamp,
  }],
  successCriteria: [criterion],
  milestones: [{
    id: ids.milestoneId,
    description: "Preserve the linked legacy execution evidence.",
    dependsOn: [],
    successCriteria: [criterion],
    state: "failed",
    runIds: [ids.runId],
    attempts: 1,
    lastRunStatus: "canceled",
  }],
  status: "canceled",
  stopReason: "user_canceled",
  executionUsage: {
    iterations: 1,
    toolCalls: 0,
    wallClockMs: 100,
    tokens: 32,
    replans: 0,
  },
  reviewPolicy: "review_final_only",
  planVersion: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
await goalStore.save(goal);
await goalStore.appendLedger(ids.goalId, {
  at: timestamp,
  kind: "goal_stopped",
  summary: "Legacy Goal canceled by the user.",
  evidenceRefs: [ids.runId],
});
await chatStore.appendMessage({
  sessionId: ids.sessionId,
  requestId: ids.requestId,
  role: "assistant",
  content: "The v3.9.1 run was canceled and remains reviewable.",
  executedRunId: ids.runId,
  goalId: ids.goalId,
});
await chatStore.attachGoal(ids.sessionId, {
  id: ids.goalId,
  description: goal.description,
  status: goal.status,
  updatedAt: timestamp,
});
await chatStore.appendActivityEvent(ids.sessionId, {
  sessionId: ids.sessionId,
  requestId: ids.requestId,
  sequence: 1,
  turnId: ids.turnId,
  state: "canceled",
  message: "Legacy request canceled by the user.",
  createdAt: timestamp,
  elapsedMs: 100,
});

await Promise.all([
  chatStore.flush(),
  runStore.flushShadowWrites(),
  trajectoryStore.flushShadowWrites(),
  goalStore.flushShadowWrites(),
]);
const [storedSession, storedPlan, storedRun, storedTrajectory, storedGoal] =
  await Promise.all([
    chatStore.get(ids.sessionId),
    planStore.get(ids.planId),
    runStore.get(ids.runId),
    trajectoryStore.list(ids.runId),
    goalStore.get(ids.goalId),
  ]);
if (
  storedSession?.id !== ids.sessionId
  || storedPlan?.id !== ids.planId
  || storedRun?.id !== ids.runId
  || storedGoal?.id !== ids.goalId
  || storedTrajectory.length !== 1
  || chatIds.remaining() !== 0
) {
  throw new Error("v3.9.1 fixture store round-trip was incomplete.");
}

process.stdout.write(`${JSON.stringify({
  status: "generated",
  ids,
  counts: {
    sessions: 1,
    plans: 1,
    goals: 1,
    runs: 1,
    trajectoryEvents: storedTrajectory.length,
  },
  modules: [
    "chatSessionStore.js",
    "planStore.js",
    "agentRunStore.js",
    "agentTrajectoryStore.js",
    "agentGoalStore.js",
  ].map((name) => pathToFileURL(path.join(distRoot, "main", name)).href),
})}\n`);

async function load(name) {
  const url = pathToFileURL(path.join(distRoot, "main", name)).href;
  return import(url);
}

function deterministicIds(values) {
  let index = 0;
  const createId = () => {
    const value = values[index];
    if (!value) throw new Error("Deterministic v3.9.1 id budget exhausted.");
    index += 1;
    return value;
  };
  createId.remaining = () => values.length - index;
  return createId;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key?.startsWith("--") && value && !value.startsWith("--")) {
      parsed[key.slice(2)] = value;
      index += 1;
    }
  }
  return parsed;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return path.resolve(value);
}
