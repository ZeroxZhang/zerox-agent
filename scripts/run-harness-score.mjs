#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const configDir = args["config-dir"] ?? process.env.BUILDING_AGENT_CONFIG_DIR;

const [
  { computeHarnessScore },
  { createAgentEvalFixtures },
  {
    createCombinedAgentEvalFixtures,
    createPromotedAgentEvalFixtureStore,
  },
  { runAgentEvals },
  { runAdversarialAgentEvals },
] = await Promise.all([
    import("../dist-electron/shared/harnessScore.js"),
    import("../dist-electron/main/eval/agentEvalFixtures.js"),
    import("../dist-electron/main/eval/agentPromotedEvalFixtures.js"),
    import("../dist-electron/main/eval/agentEvalRunner.js"),
    import("../dist-electron/main/eval/agentEvalAdversary.js"),
  ]);

const builtInFixtures = createAgentEvalFixtures();
const promotedFixtures = configDir
  ? await createPromotedAgentEvalFixtureStore({ configDir }).list()
  : [];
const evalFixtures = configDir
  ? createCombinedAgentEvalFixtures(builtInFixtures, promotedFixtures)
  : builtInFixtures;
const evalReport = await runAgentEvals(evalFixtures);
const adversarial = await runAdversarialAgentEvals(evalFixtures);
const pendingLearningCandidates = configDir
  ? await countPendingLearningCandidates(configDir)
  : 0;
const pendingEvalCandidates = configDir
  ? await countPendingEvalCandidates(configDir)
  : 0;
const score = computeHarnessScore({
  hasAgentGuide: await exists("AGENTS.md"),
  hasExecutionStore: await exists("src/main/agentExecutionStore.ts"),
  hasInitScript: await exists("init.sh"),
  hasTrajectoryStore: await exists("src/main/agentTrajectoryStore.ts"),
  evalPassRate: evalReport.passRate,
  recoverabilityRate: evalReport.recoverabilityRate,
  toolSuccessRate: evalReport.toolSuccessRate,
  pendingLearningCandidates,
});

console.log(
  JSON.stringify(
    {
      score,
      eval: evalReport,
      adversarial: adversarial,
      promotedFixtureCount: promotedFixtures.length,
      pendingEvalCandidates,
    },
    null,
    2,
  ),
);

if (evalReport.failed > 0 || !adversarial.passed || score.tone === "bad") {
  process.exitCode = 1;
}

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function countPendingLearningCandidates(baseDir) {
  try {
    const raw = await readFile(
      path.join(baseDir, "agent-learning-candidates.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    const candidates = Array.isArray(parsed.candidates)
      ? parsed.candidates
      : [];
    return candidates.filter(
      (candidate) => candidate?.status === "pending_review",
    ).length;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return 0;
    }

    throw error;
  }
}

async function countPendingEvalCandidates(baseDir) {
  try {
    const raw = await readFile(
      path.join(baseDir, "agent-eval-candidates.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.candidates)) {
      throw new Error("Malformed agent eval candidate store.");
    }

    return parsed.candidates.filter(
      (candidate) => candidate?.status === "pending_review",
    ).length;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return 0;
    }

    throw error;
  }
}

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith("--")) {
      continue;
    }

    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}
