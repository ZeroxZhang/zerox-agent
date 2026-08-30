#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
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
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const passthrough = process.argv.slice(2);
const vitest = path.join(root, "node_modules/vitest/vitest.mjs");
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
const targetTests = [
  "src/shared/conversationDisclosureProgram.test.ts",
  "src/shared/packageScripts.test.ts",
];
const excludedFromCurrent = [
  ...historicalV3Tests,
  historicalV3PolicyTest,
  ...historicalV4Tests,
  ...targetTests,
];

if (passthrough.length > 0) {
  await runVitest(root, passthrough);
  process.exit(0);
}

const fixtureRoots = [];
try {
  await runVitest(root, [
    ...excludedFromCurrent.flatMap((entry) => ["--exclude", entry]),
  ]);

  const historicalRoot = await createFixture("zerox-r7-v3-history-");
  await restoreRound3Semantics(historicalRoot);
  await runVitest(historicalRoot, ["--run", ...historicalV3Tests]);
  await runVitest(historicalRoot, [
    "--run",
    historicalV3PolicyTest,
    "--testNamePattern",
    "^(?!.*validates the exact production policy in both pre-publish and published post-transition states).*$",
  ]);

  const round4Root = await createFixture("zerox-r7-v4-history-");
  await restoreRound4Semantics(round4Root);
  await runVitest(round4Root, ["--run", ...historicalV4Tests]);

  const targetRoot = await createFixture("zerox-r7-target-tests-");
  await applyRound7Targets(targetRoot);
  await runVitest(targetRoot, ["--run", ...targetTests]);
} finally {
  await Promise.all(fixtureRoots.splice(0).map((entry) =>
    rm(entry, { recursive: true, force: true })));
}

async function createFixture(prefix) {
  const fixture = await mkdtemp(path.join(os.tmpdir(), prefix));
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

async function applyRound7Targets(fixture) {
  const mappings = [
    [
      ".zerox/verification/conversation-disclosure/CD03A-round7-package.target.json",
      "package.json",
    ],
    [
      ".zerox/verification/conversation-disclosure/CD03A-round7-harness.target.mjs",
      "scripts/check-harness-state.mjs",
    ],
    [
      ".zerox/verification/conversation-disclosure/CD03A-round7-program-test.target.ts",
      "src/shared/conversationDisclosureProgram.test.ts",
    ],
    [
      ".zerox/verification/conversation-disclosure/CD03A-round7-package-scripts-test.target.ts",
      "src/shared/packageScripts.test.ts",
    ],
  ];
  for (const [source, destination] of mappings) {
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

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
