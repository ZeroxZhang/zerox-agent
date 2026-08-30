#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const passthrough = process.argv.slice(2);
const vitest = path.join(root, "node_modules/vitest/vitest.mjs");
const fixtureBase = process.platform === "darwin" ? "/private/tmp" : os.tmpdir();
const historicalV3Tests = [
  "src/shared/conversationDisclosureContinuationV3.test.ts",
  "src/shared/conversationDisclosureContinuationManifestV3.test.ts",
  "src/shared/conversationDisclosureContinuationFreezeV3.test.ts",
];
const historicalV3PolicyTest =
  "src/shared/conversationDisclosureContinuationPolicyV3.test.ts";
const historicalV4Tests = [
  "src/shared/conversationDisclosureContinuationV4.test.ts",
  "src/shared/conversationDisclosureContinuationPolicyV4.test.ts",
  "src/shared/conversationDisclosureContinuationRuntimeIoV4.test.ts",
  "src/shared/conversationDisclosureContinuationProgramGovernanceV4.test.ts",
  "src/shared/conversationDisclosureContinuationFreezeV4.test.ts",
  "src/shared/conversationDisclosureContinuationCheckerV4.test.ts",
  "src/shared/conversationDisclosureContinuationManifestV4.test.ts",
  "src/shared/conversationDisclosureContinuationRunnerV4.test.ts",
  "src/shared/conversationDisclosureTestOrchestratorV4.test.ts",
];
const historicalV7Tests = [
  "src/shared/conversationDisclosureReviewDispatchV7.test.ts",
  "src/shared/conversationDisclosureContinuationV7.test.ts",
  "src/shared/conversationDisclosureContinuationPolicyV7.test.ts",
  "src/shared/conversationDisclosureContinuationRuntimeIoV7.test.ts",
  "src/shared/conversationDisclosureContinuationProgramGovernanceV7.test.ts",
  "src/shared/conversationDisclosureContinuationFreezeV7.test.ts",
  "src/shared/conversationDisclosureContinuationCheckerV7.test.ts",
  "src/shared/conversationDisclosureContinuationManifestV7.test.ts",
  "src/shared/conversationDisclosureContinuationRunnerV7.test.ts",
  "src/shared/conversationDisclosureFinalEvidenceV7.test.ts",
  "src/shared/conversationDisclosureTestOrchestratorV7.test.ts",
];
const historicalV8Tests = [
  "src/shared/conversationDisclosureReviewDispatchV8.test.ts",
  "src/shared/conversationDisclosureContinuationV8.test.ts",
  "src/shared/conversationDisclosureContinuationPolicyV8.test.ts",
  "src/shared/conversationDisclosureContinuationRuntimeIoV8.test.ts",
  "src/shared/conversationDisclosureContinuationProgramGovernanceV8.test.ts",
  "src/shared/conversationDisclosureContinuationFreezeV8.test.ts",
  "src/shared/conversationDisclosureContinuationCheckerV8.test.ts",
  "src/shared/conversationDisclosureContinuationManifestV8.test.ts",
  "src/shared/conversationDisclosureContinuationRunnerV8.test.ts",
  "src/shared/conversationDisclosureFinalEvidenceV8.test.ts",
  "src/shared/conversationDisclosureTestOrchestratorV8.test.ts",
];
const targetTests = [
  "src/shared/conversationDisclosureProgram.test.ts",
  "src/shared/packageScripts.test.ts",
];
export const ROUND9_TRANSITION_MAPPINGS = Object.freeze([
  Object.freeze({
    source:
      ".zerox/verification/conversation-disclosure/CD03A-round9-package.target.json",
    destination: "package.json",
    fromSha256:
      "sha256:560fb3e3b2829a32b4ac694c7781fce9e53941a9e20fc4ec1c08602d53c278b9",
    toSha256:
      "sha256:261fa89bbaaf64b2194e0884a0a1e3c119cb6e17d7be8e1ee9f3bf493673243f",
  }),
  Object.freeze({
    source:
      ".zerox/verification/conversation-disclosure/CD03A-round9-harness.target.mjs",
    destination: "scripts/check-harness-state.mjs",
    fromSha256:
      "sha256:231d28280f6891f50f5c714b4161d1b9d93cf171e0b67396de67ce7a36e06339",
    toSha256:
      "sha256:0cb9e7f933315730b72b1a3b1476c5d15232a9d22566c4c3aa634a2517e2515f",
  }),
  Object.freeze({
    source:
      ".zerox/verification/conversation-disclosure/CD03A-round9-program-test.target.ts",
    destination: "src/shared/conversationDisclosureProgram.test.ts",
    fromSha256:
      "sha256:087cff0ba7f208464bf62e41f3a10dfbb88f3f2461d46398187c0b4cfa16dd5c",
    toSha256:
      "sha256:95328286a80783dcc62fece46a54920d1087c93aeda20cac2d1ab9efad7ae191",
  }),
  Object.freeze({
    source:
      ".zerox/verification/conversation-disclosure/CD03A-round9-package-scripts-test.target.ts",
    destination: "src/shared/packageScripts.test.ts",
    fromSha256:
      "sha256:2f30d10ebd5ccc408255813e0d10ca4e8bd145930bdbe263bc2a6e5d2fa61efe",
    toSha256:
      "sha256:8a2448fc2d1dbf8cb9eac5981c46eb49a1faa3fcdf857c34e3f61799ef2b8bc5",
  }),
]);
const excludedFromCurrent = [
  ...historicalV3Tests,
  historicalV3PolicyTest,
  ...historicalV4Tests,
  ...historicalV7Tests,
  ...historicalV8Tests,
  ...targetTests,
];

const fixtureRoots = [];

async function main() {
  if (passthrough.length > 0) {
    await runVitest(root, passthrough);
    return;
  }

  try {
    const transitionState = await detectRound9TransitionState(root);
    let currentRoot = root;
    if (transitionState === "target") {
      currentRoot = await createFixture("zerox-r9-current-source-");
      await restoreCurrentRound9Sources(currentRoot);
    }
    await runVitest(currentRoot, [
      ...excludedFromCurrent.flatMap((entry) => ["--exclude", entry]),
    ]);

    const historicalRoot = await createFixture("zerox-r9-v3-history-");
    await restoreRound3Semantics(historicalRoot);
    await runVitest(historicalRoot, ["--run", ...historicalV3Tests]);
    await runVitest(historicalRoot, [
      "--run",
      historicalV3PolicyTest,
      "--testNamePattern",
      "^(?!.*validates the exact production policy in both pre-publish and published post-transition states).*$",
    ]);

    const round4Root = await createFixture("zerox-r9-v4-history-");
    await restoreRound4Semantics(round4Root);
    await runVitest(round4Root, ["--run", ...historicalV4Tests]);

    const round7Root = await createFixture("zerox-r9-v7-history-");
    await restoreRound7Semantics(round7Root);
    await runVitest(round7Root, ["--run", ...historicalV7Tests]);

    const round8Root = await createFixture("zerox-r9-v8-history-");
    await restoreRound8Semantics(round8Root);
    await runVitest(round8Root, ["--run", ...historicalV8Tests]);

    const targetRoot = await createFixture("zerox-r9-target-tests-");
    await applyRound9Targets(targetRoot);
    await runVitest(targetRoot, ["--run", ...targetTests]);
  } finally {
    await Promise.all(fixtureRoots.splice(0).map((entry) =>
      rm(entry, { recursive: true, force: true })));
  }
}

async function createFixture(prefix) {
  const fixture = await mkdtemp(path.join(fixtureBase, prefix));
  fixtureRoots.push(fixture);
  await cp(root, fixture, {
    recursive: true,
    preserveTimestamps: true,
    filter(source) {
      if (source === root) return true;
      const relative = path.relative(root, source);
      const top = relative.split(path.sep)[0];
      return ![
        ".git",
        "node_modules",
        "dist",
        "dist-electron",
        "release",
      ].includes(top) && !top.startsWith("release-test-");
    },
  });
  await symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"));
  return fixture;
}

async function restoreRound3Semantics(fixture) {
  const policyPath = path.join(
    fixture,
    ".zerox/verification/conversation-disclosure/CD03A-round3-successor-evolution-policy.json",
  );
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const featurePath = path.join(fixture, ".zerox/feature_list.json");
  const featureList = JSON.parse(await readFile(featurePath, "utf8"));
  const featureIndex = featureList.features.findIndex(
    (entry) => entry.id === policy.featureId,
  );
  featureList.features[featureIndex] = {
    ...policy.admission.featureDefinition,
    status: "in_progress",
  };
  await writeJson(featurePath, featureList);

  const programPath = path.join(
    fixture,
    ".zerox/conversation-disclosure-program.json",
  );
  const program = JSON.parse(await readFile(programPath, "utf8"));
  const workstreamIndex = program.workstreams.findIndex(
    (entry) => entry.id === policy.workstreamId,
  );
  program.workstreams[workstreamIndex] = {
    ...policy.admission.workstreamDefinition,
    state: "in_progress",
  };
  program.activeFeatureId = policy.featureId;
  program.nextFeatureId = policy.featureId;
  await writeJson(programPath, program);

  const archive = JSON.parse(await readFile(path.join(
    fixture,
    ".zerox/verification/conversation-disclosure/CD03A-round3-baseline-archive.json",
  ), "utf8"));
  const archived = new Map(
    archive.entries
      .filter((entry) => entry.source === "governance_transition")
      .map((entry) => [entry.path, entry]),
  );
  for (const transition of policy.governanceTransitions) {
    const entry = archived.get(transition.path);
    if (!entry || entry.sha256 !== transition.fromSha256
      || entry.encoding !== "gzip-base64-v1") {
      throw new Error(`Round3 archive misses transition source: ${transition.path}`);
    }
    await writeFile(
      path.join(fixture, transition.path),
      gunzipSync(Buffer.from(entry.bytes, "base64")),
    );
  }
}

async function restoreRound4Semantics(fixture) {
  const policyPath = path.join(
    fixture,
    ".zerox/verification/conversation-disclosure/CD03A-round4-successor-evolution-policy.json",
  );
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const featurePath = path.join(fixture, ".zerox/feature_list.json");
  const featureList = JSON.parse(await readFile(featurePath, "utf8"));
  const featureIndex = featureList.features.findIndex(
    (entry) => entry.id === policy.featureId,
  );
  featureList.features[featureIndex] = {
    ...policy.admission.featureDefinition,
    status: "in_progress",
  };
  await writeJson(featurePath, featureList);

  const programPath = path.join(
    fixture,
    ".zerox/conversation-disclosure-program.json",
  );
  const program = JSON.parse(await readFile(programPath, "utf8"));
  const workstreamIndex = program.workstreams.findIndex(
    (entry) => entry.id === policy.workstreamId,
  );
  program.workstreams[workstreamIndex] = {
    ...policy.admission.workstreamDefinition,
    state: "in_progress",
  };
  program.activeFeatureId = policy.featureId;
  program.nextFeatureId = policy.featureId;
  await writeJson(programPath, program);

  const archive = JSON.parse(await readFile(path.join(
    fixture,
    ".zerox/verification/conversation-disclosure/CD03A-round4-baseline-archive.json",
  ), "utf8"));
  const archived = new Map(
    archive.entries
      .filter((entry) => entry.source === "governance_transition")
      .map((entry) => [entry.path, entry]),
  );
  for (const transition of policy.governanceTransitions) {
    const entry = archived.get(transition.path);
    if (!entry || entry.sha256 !== transition.fromSha256
      || entry.encoding !== "gzip-base64-v1") {
      throw new Error(`Round4 archive misses transition source: ${transition.path}`);
    }
    await writeFile(
      path.join(fixture, transition.path),
      gunzipSync(Buffer.from(entry.bytes, "base64")),
    );
  }
}

async function restoreRound7Semantics(fixture) {
  const policyPath = path.join(
    fixture,
    ".zerox/verification/conversation-disclosure/CD03A-round7-successor-evolution-policy.json",
  );
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const featurePath = path.join(fixture, ".zerox/feature_list.json");
  const featureList = JSON.parse(await readFile(featurePath, "utf8"));
  const featureIndex = featureList.features.findIndex(
    (entry) => entry.id === policy.featureId,
  );
  featureList.features[featureIndex] = {
    ...policy.admission.featureDefinition,
    status: "in_progress",
  };
  await writeJson(featurePath, featureList);
  const programPath = path.join(
    fixture,
    ".zerox/conversation-disclosure-program.json",
  );
  const program = JSON.parse(await readFile(programPath, "utf8"));
  const workstreamIndex = program.workstreams.findIndex(
    (entry) => entry.id === policy.workstreamId,
  );
  program.workstreams[workstreamIndex] = {
    ...policy.admission.workstreamDefinition,
    state: "in_progress",
  };
  program.activeFeatureId = policy.featureId;
  program.nextFeatureId = policy.featureId;
  await writeJson(programPath, program);
  await restoreTransitionSources(
    fixture,
    policy,
    ".zerox/verification/conversation-disclosure/CD03A-round7-baseline-archive.json",
    "Round7",
  );
}

async function restoreRound8Semantics(fixture) {
  const policyPath = path.join(
    fixture,
    ".zerox/verification/conversation-disclosure/CD03A-round8-successor-evolution-policy.json",
  );
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const featurePath = path.join(fixture, ".zerox/feature_list.json");
  const featureList = JSON.parse(await readFile(featurePath, "utf8"));
  const featureIndex = featureList.features.findIndex(
    (entry) => entry.id === policy.featureId,
  );
  featureList.features[featureIndex] = {
    ...policy.admission.featureDefinition,
    status: "in_progress",
  };
  await writeJson(featurePath, featureList);

  const programPath = path.join(
    fixture,
    ".zerox/conversation-disclosure-program.json",
  );
  const program = JSON.parse(await readFile(programPath, "utf8"));
  const workstreamIndex = program.workstreams.findIndex(
    (entry) => entry.id === policy.workstreamId,
  );
  program.workstreams[workstreamIndex] = {
    ...policy.admission.workstreamDefinition,
    state: "in_progress",
  };
  program.activeFeatureId = policy.featureId;
  program.nextFeatureId = policy.featureId;
  await writeJson(programPath, program);

  const archive = JSON.parse(await readFile(path.join(
    fixture,
    ".zerox/verification/conversation-disclosure/CD03A-round8-baseline-archive.json",
  ), "utf8"));
  const archived = new Map(
    archive.entries
      .filter((entry) => entry.source === "governance_transition")
      .map((entry) => [entry.path, entry]),
  );
  for (const transition of policy.governanceTransitions) {
    const entry = archived.get(transition.path);
    if (!entry || entry.sha256 !== transition.fromSha256
      || entry.encoding !== "gzip-base64-v1") {
      throw new Error(`Round8 archive misses transition source: ${transition.path}`);
    }
    await writeFile(
      path.join(fixture, transition.path),
      gunzipSync(Buffer.from(entry.bytes, "base64")),
    );
  }
}

async function restoreTransitionSources(fixture, policy, archivePath, label) {
  const archive = JSON.parse(await readFile(path.join(fixture, archivePath), "utf8"));
  const archived = new Map(
    archive.entries
      .filter((entry) => entry.source === "governance_transition")
      .map((entry) => [entry.path, entry]),
  );
  for (const transition of policy.governanceTransitions) {
    const entry = archived.get(transition.path);
    if (!entry || entry.sha256 !== transition.fromSha256
      || entry.encoding !== "gzip-base64-v1") {
      throw new Error(`${label} archive misses transition source: ${transition.path}`);
    }
    await writeFile(
      path.join(fixture, transition.path),
      gunzipSync(Buffer.from(entry.bytes, "base64")),
    );
  }
}

export async function detectRound9TransitionState(repositoryRoot) {
  const states = [];
  for (const transition of ROUND9_TRANSITION_MAPPINGS) {
    const targetBytes = await readFile(path.join(repositoryRoot, transition.source));
    if (sha256(targetBytes) !== transition.toSha256) {
      throw new Error(
        `Round9 transition payload is stale: ${transition.source}`,
      );
    }
    const liveDigest = sha256(
      await readFile(path.join(repositoryRoot, transition.destination)),
    );
    if (liveDigest === transition.fromSha256) {
      states.push("source");
    } else if (liveDigest === transition.toSha256) {
      states.push("target");
    } else {
      throw new Error(
        `Round9 transition live bytes are a third state: ${transition.destination}`,
      );
    }
  }
  const uniqueStates = new Set(states);
  if (uniqueStates.size !== 1) {
    throw new Error("Round9 transition live bytes are mixed");
  }
  return states[0];
}

export async function restoreCurrentRound9Sources(fixture) {
  const archivePath =
    ".zerox/verification/conversation-disclosure/CD03A-round8-baseline-archive.json";
  const archive = JSON.parse(
    await readFile(path.join(fixture, archivePath), "utf8"),
  );
  const archived = new Map(
    archive.entries
      .filter((entry) => entry.source === "governance_transition")
      .map((entry) => [entry.path, entry]),
  );
  for (const transition of ROUND9_TRANSITION_MAPPINGS) {
    const entry = archived.get(transition.destination);
    if (!entry || entry.sha256 !== transition.fromSha256
      || entry.encoding !== "gzip-base64-v1") {
      throw new Error(
        `Round8 archive misses Round9 source: ${transition.destination}`,
      );
    }
    const bytes = gunzipSync(Buffer.from(entry.bytes, "base64"));
    if (sha256(bytes) !== transition.fromSha256) {
      throw new Error(
        `Round8 archive source bytes are stale: ${transition.destination}`,
      );
    }
    await writeFile(path.join(fixture, transition.destination), bytes);
  }
  if (await detectRound9TransitionState(fixture) !== "source") {
    throw new Error("Round9 source reconstruction did not converge");
  }
}

async function applyRound9Targets(fixture) {
  for (const { source, destination } of ROUND9_TRANSITION_MAPPINGS) {
    await writeFile(
      path.join(fixture, destination),
      await readFile(path.join(fixture, source)),
    );
  }
}

async function runVitest(cwd, args) {
  const result = await execFile(process.execPath, [vitest, "run", ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: "",
    },
    maxBuffer: 32 * 1024 * 1024,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
