#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const packageRoot = path.join(
  root,
  "release-local/mac-arm64/Zerox Agent.app",
);
const executable = path.join(packageRoot, "Contents/MacOS/Zerox Agent");
const appAsar = path.join(packageRoot, "Contents/Resources/app.asar");
const sourceDb = process.env.ZEROX_PLAN_ACCEPTANCE_SOURCE_DB?.trim() || null;
const sourceFixture = path.join(
  root,
  "fixtures/plan-resilience-source.json",
);
const explicitPlanId = process.env.ZEROX_PLAN_ACCEPTANCE_PLAN_ID?.trim();
const receiptPath = path.join(
  root,
  ".zerox/verification/plan-resilience-local-package.json",
);
const userDataDir = await mkdtemp(
  path.join(os.tmpdir(), "zerox-plan-resilience-"),
);
const isolatedWorkspace = path.join(userDataDir, "workspace");
const isolatedDb = path.join(userDataDir, "config/zerox.db");
const provider = await startProviderFixture();

try {
  const sourcePlan = sourceDb
    ? await readSourcePlan(sourceDb, explicitPlanId)
    : JSON.parse(await readFile(sourceFixture, "utf8"));
  const planId = sourcePlan.id;
  const failedReview = [...(sourcePlan.planningStages ?? [])]
    .reverse()
    .find((stage) => stage.kind === "review" && stage.status === "failed");
  const completedRound = [...(sourcePlan.rounds ?? [])]
    .reverse()
    .find((round) => round.kind === "direct" && round.status === "completed");
  const completedGeneration = [...(sourcePlan.planningStages ?? [])]
    .reverse()
    .find(
      (stage) =>
        stage.kind === "generation" && stage.status === "completed",
    );
  if (!failedReview?.modelBinding || !completedRound || !completedGeneration) {
    throw new Error(
      "Acceptance source plan must contain a failed review and a completed Direct generation.",
    );
  }

  await mkdir(path.dirname(isolatedDb), { recursive: true });
  await mkdir(isolatedWorkspace, { recursive: true });
  if (sourceDb) {
    await execFileAsync("/usr/bin/sqlite3", [
      sourceDb,
      `.backup '${isolatedDb.replaceAll("'", "''")}'`,
    ]);
  } else {
    await seedFixtureDatabase(isolatedDb, sourcePlan);
  }
  await execFileAsync("/usr/bin/sqlite3", [
    isolatedDb,
    `UPDATE plan_records SET payload = json_set(payload, '$.workspaceRoot', ${sqlLiteral(isolatedWorkspace)}) WHERE id = ${sqlLiteral(planId)};`,
  ]);
  await seedFrozenModelSettings(
    userDataDir,
    provider.baseUrl,
    failedReview.modelBinding,
  );

  const startedAt = Date.now();
  const child = spawn(executable, [], {
    cwd: root,
    env: {
      ...process.env,
      ZEROX_AGENT_USER_DATA_DIR: userDataDir,
      ZEROX_STORAGE_BACKEND: "sqlite",
      ZEROX_DISABLE_AUTO_UPDATE: "1",
      ZEROX_AGENT_REPLAY_PLAN_ID: planId,
      ZEROX_AGENT_REPLAY_TIMEOUT_MS: "120000",
      DASHSCOPE_API_KEY: "local-plan-fixture-key",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => remember(output, chunk));
  child.stderr.on("data", (chunk) => remember(output, chunk));
  const exitCode = await waitForExit(child, 110_000);
  const elapsedMs = Date.now() - startedAt;
  const finalPlan = await readPlan(isolatedDb, planId);
  const finalCompletedRounds = (finalPlan.rounds ?? []).filter(
    (round) => round.kind === "direct" && round.status === "completed",
  );
  const finalCompletedGeneration = (finalPlan.planningStages ?? []).filter(
    (stage) => stage.kind === "generation" && stage.status === "completed",
  );
  const finalReview = [...(finalPlan.planningStages ?? [])]
    .reverse()
    .find((stage) => stage.kind === "review");
  const oldReviewInvalidated = (finalPlan.planningStages ?? []).some(
    (stage) =>
      stage.runId === failedReview.runId && stage.status === "invalidated",
  );
  const accepted = Boolean(
    exitCode === 0 &&
      finalPlan.status !== "paused" &&
      finalPlan.status !== "failed" &&
      provider.modelCallCount() === 2 &&
      provider.injectedFailureCount() === 1 &&
      provider.slowSuccessCount() === 1 &&
      elapsedMs >= provider.responseDelayMs &&
      finalCompletedRounds.length === 1 &&
      finalCompletedRounds[0]?.runId === completedRound.runId &&
      finalCompletedGeneration.length === 1 &&
      finalCompletedGeneration[0]?.runId === completedGeneration.runId &&
      oldReviewInvalidated &&
      finalReview?.status === "completed" &&
      finalReview.reviewApproved === true,
  );
  const receipt = {
    schemaVersion: 1,
    kind: "plan-resilience-local-package-acceptance",
    status: accepted ? "passed" : "failed",
    accepted,
    package: {
      path: "release-local/mac-arm64/Zerox Agent.app",
      appAsarSha256: await sha256File(appAsar),
    },
    source: {
      planId,
      failedReviewRunId: failedReview.runId,
      completedGenerationRunId: completedGeneration.runId,
      completedRoundRunId: completedRound.runId,
    },
    transportRecovery: {
      modelCallCount: provider.modelCallCount(),
      injectedFailureCount: provider.injectedFailureCount(),
      slowSuccessCount: provider.slowSuccessCount(),
      responseDelayMs: provider.responseDelayMs,
      elapsedMs,
    },
    resumedPlan: {
      exitCode,
      status: finalPlan.status,
      completedDirectRoundCount: finalCompletedRounds.length,
      completedGenerationStageCount: finalCompletedGeneration.length,
      generatedPlanReused:
        finalCompletedRounds[0]?.runId === completedRound.runId &&
        finalCompletedGeneration[0]?.runId === completedGeneration.runId,
      failedReviewInvalidated: oldReviewInvalidated,
      latestReviewStatus: finalReview?.status ?? null,
      latestReviewApproved: finalReview?.reviewApproved === true,
    },
    replayLogObserved: output.some((line) =>
      line.includes("[PLAN-REPLAY] retryFailedRound 完成"),
    ),
  };
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  if (!accepted) process.exitCode = 1;
} finally {
  await provider.close();
  await rm(userDataDir, { recursive: true, force: true });
}

async function readSourcePlan(databasePath, planId) {
  if (planId && !/^plan_[A-Za-z0-9_-]+$/.test(planId)) {
    throw new Error("Unsafe plan id.");
  }
  const query = planId
    ? `SELECT id, payload FROM plan_records WHERE id = ${sqlLiteral(planId)};`
    : "SELECT id, payload FROM plan_records WHERE status = 'paused' ORDER BY updated_at DESC;";
  const { stdout } = await execFileAsync("/usr/bin/sqlite3", [
    "-json",
    databasePath,
    query,
  ]);
  const candidates = JSON.parse(stdout || "[]");
  for (const candidate of candidates) {
    const plan = JSON.parse(candidate.payload);
    if (
      (plan.planningStages ?? []).some(
        (stage) => stage.kind === "review" && stage.status === "failed",
      )
    ) {
      return plan;
    }
  }
  throw new Error("No paused plan with a failed review was found.");
}

async function seedFixtureDatabase(databasePath, plan) {
  await execFileAsync("/usr/bin/sqlite3", [databasePath, `
    CREATE TABLE plan_records (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      action_gate TEXT NOT NULL,
      revision INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO plan_records (
      id, session_id, mode, status, action_gate, revision,
      payload, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(plan.id)},
      ${sqlLiteral(plan.sessionId)},
      ${sqlLiteral(plan.mode)},
      ${sqlLiteral(plan.status)},
      ${sqlLiteral(plan.actionGate)},
      ${Number(plan.revision)},
      ${sqlLiteral(JSON.stringify(plan))},
      ${sqlLiteral(plan.createdAt)},
      ${sqlLiteral(plan.updatedAt)}
    );
  `]);
}

async function readPlan(databasePath, planId) {
  const { stdout } = await execFileAsync("/usr/bin/sqlite3", [
    "-json",
    databasePath,
    `SELECT payload FROM plan_records WHERE id = ${sqlLiteral(planId)};`,
  ]);
  const rows = JSON.parse(stdout || "[]");
  if (!rows[0]?.payload) throw new Error("Isolated plan record is missing.");
  return JSON.parse(rows[0].payload);
}

async function seedFrozenModelSettings(userDataPath, baseUrl, binding) {
  const timestamp = "2026-08-31T14:00:00.000Z";
  const settings = {
    schemaVersion: 2,
    connections: [{
      id: binding.connectionId,
      name: "Local plan resilience fixture",
      providerKind: binding.providerKind,
      values: { baseUrl },
      encryptedSecrets: {},
      credentialSource: "environment",
      verification: {
        status: "passed",
        checkedAt: timestamp,
        message: "Local deterministic fixture",
        connectionRevision: binding.connectionRevision,
      },
      revision: binding.connectionRevision,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    connectionHistory: [],
    profiles: [{
      id: binding.profileId,
      name: "Local plan resilience fixture",
      connectionId: binding.connectionId,
      modelId: binding.modelId,
      purpose: "chat",
      generation: binding.generation,
      verification: {
        status: "passed",
        checkedAt: timestamp,
        message: "Local deterministic fixture",
        connectionRevision: binding.connectionRevision,
        profileRevision: binding.profileRevision,
      },
      custom: true,
      revision: binding.profileRevision,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    profileHistory: [],
    defaultChatProfileId: binding.profileId,
    defaultEmbeddingProfileId: null,
    hiddenRoutedModelIds: [],
    updatedAt: timestamp,
  };
  await writeFile(
    path.join(userDataPath, "config/model-settings.json"),
    `${JSON.stringify(settings, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function startProviderFixture() {
  let calls = 0;
  let failures = 0;
  let slowSuccesses = 0;
  const responseDelayMs = 35_000;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
      response.writeHead(404).end();
      return;
    }
    for await (const _chunk of request) {
      // Drain the request before injecting a deterministic transport result.
    }
    calls += 1;
    if (calls === 1) {
      failures += 1;
      request.socket.destroy(new Error("injected transient connection reset"));
      return;
    }
    await delay(responseDelayMs);
    slowSuccesses += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: "fixture-plan-review",
      object: "chat.completion",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify({ approved: true, issues: [] }),
        },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 64, completion_tokens: 12, total_tokens: 76 },
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    responseDelayMs,
    modelCallCount: () => calls,
    injectedFailureCount: () => failures,
    slowSuccessCount: () => slowSuccesses,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Packaged plan replay exceeded ${timeoutMs} ms.`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code ?? -1);
    });
  });
}

function remember(output, chunk) {
  output.push(String(chunk).slice(-4_000));
  if (output.length > 40) output.shift();
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function sha256File(filePath) {
  return `sha256:${createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex")}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
