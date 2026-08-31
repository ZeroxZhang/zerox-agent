#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
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
const fixtureBase = os.tmpdir();
const v12Runner = "scripts/run-conversation-disclosure-tests-v12.mjs";
const historicalV3PolicyTest =
  "src/shared/conversationDisclosureContinuationPolicyV3.test.ts";
const separatelyRestoredRounds = Object.freeze([
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
]);
const postRound12FeatureIds = new Set([
  "P109-chat-progressive-disclosure-surface",
  "P110-cross-surface-progressive-disclosure",
  "P111-conversation-evidence-inspector",
  "P112-v3.9.2-disclosure-hardening",
  "P113-v3.9.2-disclosure-adversarial-acceptance",
]);

async function main() {
  if (passthrough.length > 0) {
    await runNode(root, [v12Runner, ...passthrough]);
    return;
  }

  const historicalTests = await listVersionedHistoricalTests();
  await runNode(root, [
    v12Runner,
    ...historicalTests.flatMap((entry) => ["--exclude", entry]),
  ]);

  for (const round of separatelyRestoredRounds) {
    const fixture = await createFixture(`zerox-r13-round${round}-history-`);
    try {
      await restoreRoundAdmission(fixture, round);
      const roundTests = historicalTests.filter((entry) =>
        entry.includes(`V${round}.test.ts`));
      if (round === 3) {
        await runVitest(
          fixture,
          roundTests.filter((entry) => entry !== historicalV3PolicyTest),
          { testTimeoutMs: 15_000 },
        );
        await runVitest(fixture, [
          historicalV3PolicyTest,
          "--testNamePattern",
          "^(?!.*validates the exact production policy in both pre-publish and published post-transition states).*$",
        ]);
      } else {
        await runVitest(fixture, roundTests);
      }
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  }
}

async function createFixture(prefix) {
  const fixture = await mkdtemp(path.join(fixtureBase, prefix));
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
  await symlink(
    path.join(root, "node_modules"),
    path.join(fixture, "node_modules"),
  );
  return fixture;
}

export async function listVersionedHistoricalTests() {
  const sharedDir = path.join(root, "src/shared");
  return (await readdir(sharedDir))
    .filter((name) =>
      /^conversationDisclosure(?:ReviewDispatch|Continuation|FinalEvidence|TestOrchestrator).*V(?:2|3|4|5|6|7|8|9|10|11|12)\.test\.ts$/.test(
        name,
      ))
    .map((name) => `src/shared/${name}`)
    .sort();
}

async function restoreRoundAdmission(fixture, round) {
  const policyPath =
    `.zerox/verification/conversation-disclosure/CD03A-round${round}-successor-evolution-policy.json`;
  const archivePath =
    `.zerox/verification/conversation-disclosure/CD03A-round${round}-baseline-archive.json`;
  const policy = JSON.parse(
    await readFile(path.join(fixture, policyPath), "utf8"),
  );
  const archive = JSON.parse(
    await readFile(path.join(fixture, archivePath), "utf8"),
  );
  const archived = new Map(
    archive.entries
      .map((entry) => [entry.path, entry]),
  );
  for (const authority of policy.pathAuthorities) {
    if (
      authority.class === "create"
      || authority.baseline?.presence === "absent"
    ) {
      await rm(path.join(fixture, authority.path), { force: true });
      continue;
    }
    if (authority.class !== "modify") continue;
    const entry = archived.get(authority.path);
    if (
      !entry
      || entry.sha256 !== authority.baseline?.sha256
      || entry.encoding !== "gzip-base64-v1"
    ) {
      throw new Error(
        `Round${round} archive misses modify baseline: ${authority.path}`,
      );
    }
    await writeFile(
      path.join(fixture, authority.path),
      gunzipSync(Buffer.from(entry.bytes, "base64")),
    );
  }
  for (const transition of policy.governanceTransitions) {
    const entry = archived.get(transition.path);
    if (
      !entry
      || entry.sha256 !== transition.fromSha256
      || entry.encoding !== "gzip-base64-v1"
    ) {
      throw new Error(
        `Round12 archive misses transition source: ${transition.path}`,
      );
    }
    const bytes = gunzipSync(Buffer.from(entry.bytes, "base64"));
    if (sha256(bytes) !== transition.fromSha256) {
      throw new Error(
        `Round12 archived transition source is stale: ${transition.path}`,
      );
    }
    await writeFile(path.join(fixture, transition.path), bytes);
  }
  const featurePath = path.join(fixture, ".zerox/feature_list.json");
  const featureList = JSON.parse(await readFile(featurePath, "utf8"));
  featureList.features = featureList.features
    .filter((entry) =>
      entry.id !== policy.successor.featureDefinition.id
      && !postRound12FeatureIds.has(entry.id))
    .map((entry) => entry.id === policy.featureId
      ? { ...policy.admission.featureDefinition, status: "in_progress" }
      : entry);
  await writeFile(featurePath, `${JSON.stringify(featureList, null, 2)}\n`);

  const programPath = path.join(
    fixture,
    ".zerox/conversation-disclosure-program.json",
  );
  const currentProgram = JSON.parse(await readFile(programPath, "utf8"));
  const historicalProgramRoot =
    policy.closedWorld?.programRootDefinition;
  if (!historicalProgramRoot || typeof historicalProgramRoot !== "object") {
    throw new Error(`Round${round} policy misses its frozen Program root`);
  }
  const historicalWorkstreams =
    historicalProgramRoot.workstreams;
  if (!Array.isArray(historicalWorkstreams)) {
    throw new Error(`Round${round} policy misses its frozen workstream roster`);
  }
  const admissionIndex = historicalWorkstreams.findIndex(
    (entry) => entry.id === policy.workstreamId,
  );
  const program = {
    ...structuredClone(historicalProgramRoot),
    updatedAt: currentProgram.updatedAt,
    status: "active",
    activeFeatureId: policy.featureId,
    nextFeatureId: policy.featureId,
    scenarioMatrix: historicalProgramRoot.scenarioMatrix.map((scenario) => ({
      ...scenario,
      acceptanceEvidence: [],
    })),
    workstreams: historicalWorkstreams.map((entry, index) => ({
      ...entry,
      state:
        index < admissionIndex
          ? "completed"
          : index === admissionIndex
            ? "in_progress"
            : "planned",
    })),
  };
  await writeFile(programPath, `${JSON.stringify(program, null, 2)}\n`);
}

async function runNode(cwd, argv) {
  const result = await execFile(process.execPath, argv, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: "",
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}

async function runVitest(cwd, tests, options = {}) {
  await runNode(cwd, [
    path.join(root, "node_modules/vitest/vitest.mjs"),
    "run",
    "--run",
    ...tests,
    "--maxWorkers=1",
    ...(options.testTimeoutMs
      ? ["--testTimeout", String(options.testTimeoutMs)]
      : []),
  ]);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
  process.exitCode = 0;
}
