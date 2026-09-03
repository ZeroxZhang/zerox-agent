#!/usr/bin/env node

import {
  chmod,
  lstat,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  captureStableFileV12,
  publishPrivateExactV12,
} from "./conversation-disclosure-continuation-runtime-io-v12.mjs";

import {
  CD04_DELTA_FEATURE_ID,
  CD04_DELTA_PROGRAM_ID,
  CD04_DELTA_RECEIPT_PATHS,
  CD04_DELTA_REVIEW_LANES,
  CD04_DELTA_REVIEW_OUTPUT_PATHS,
  CD04_DELTA_REVIEW_PATH,
  CD04_DELTA_SCHEMA_VERSION,
  CD04_DELTA_SNAPSHOT_PATH,
  CD04_DELTA_TRANSITIONS,
  CD04_DELTA_WORKSTREAM_ID,
  canonicalJsonV13,
  sha256BytesV13,
  validateCd04DeltaSnapshotV13,
  withCanonicalDigestV13,
} from "./conversation-disclosure-delta-contract-v13.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const round12PolicyPath =
  ".zerox/verification/conversation-disclosure/CD03A-round12-successor-evolution-policy.json";
const performancePath =
  ".zerox/verification/conversation-disclosure/CD04-performance-baseline.json";
const parityPath =
  ".zerox/verification/conversation-disclosure/CD04-shadow-parity.json";
const postReviewMutable = new Set([
  CD04_DELTA_REVIEW_PATH,
  ".zerox/feature_list.json",
  ".zerox/conversation-disclosure-program.json",
  ".zerox/progress.md",
  "task_plan.md",
  "findings.md",
  "progress.md",
]);
const governancePaths = Object.freeze([
  "scripts/check-runtime-convergence-program.mjs",
  "scripts/check-kernel-migration-program.mjs",
  "scripts/check-storage-convergence-program.mjs",
  "scripts/check-release-program.mjs",
  "scripts/conversation-disclosure-continuation-runtime-io-v12.mjs",
  "scripts/conversation-disclosure-delta-contract-v13.mjs",
  "scripts/freeze-conversation-disclosure-delta-v13.mjs",
  "scripts/build-conversation-disclosure-delta-anchor-v13.mjs",
  "scripts/apply-conversation-disclosure-delta-v13.mjs",
  "scripts/check-conversation-disclosure-program-v13.mjs",
  "scripts/check-harness-state-v13.mjs",
  "scripts/run-conversation-disclosure-tests-v13.mjs",
  "src/shared/conversationDisclosureDeltaV13.test.ts",
  "src/shared/conversationDisclosureTestOrchestratorV13.test.ts",
  "src/shared/credentialRedaction.ts",
  "src/shared/credentialRedaction.test.ts",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-snapshot.json",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-rejection-v1.json",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-snapshot-v2.json",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-rejection-v2.json",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-snapshot-v3.json",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-rejection-v3.json",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-snapshot-v4.json",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-rejection-v4.json",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-snapshot-v5.json",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-rejection-v5.json",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-snapshot-v6.json",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-rejection-v6.json",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-snapshot-v7.json",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-rejection-v7.json",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-snapshot-v8.json",
  ".zerox/verification/conversation-disclosure/CD04-delta-review-rejection-v8.json",
  ...CD04_DELTA_TRANSITIONS.map((entry) => entry.targetPath),
]);

export async function freezeCd04DeltaV13(options) {
  const parentAnchorPath = path.resolve(options.parentAnchor);
  const parentAnchor = JSON.parse(
    (await readStableFile(parentAnchorPath, true)).toString("utf8"),
  );
  if (
    parentAnchor.digest !== options.expectedParentAnchorDigest
    || parentAnchor.kind !== "conversation-disclosure-continuation-external-anchor"
    || parentAnchor.repositoryRealpath !== root
  ) {
    throw new Error("Round12 parent anchor does not match the caller pin");
  }
  await prepareTransitionTargets();
  const policy = JSON.parse(
    await readFile(path.join(root, round12PolicyPath), "utf8"),
  );
  if (
    policy.successor?.featureDefinition?.id !== CD04_DELTA_FEATURE_ID
    || policy.successor?.workstreamDefinition?.id !== CD04_DELTA_WORKSTREAM_ID
  ) {
    throw new Error("Round12 successor definition is not P108/CD04");
  }
  const featureList = JSON.parse(
    await readFile(path.join(root, ".zerox/feature_list.json"), "utf8"),
  );
  const liveFeature = featureList.features.find(
    (entry) => entry.id === CD04_DELTA_FEATURE_ID,
  );
  if (
    canonicalJsonV13(liveFeature)
      !== canonicalJsonV13({
        ...policy.successor.featureDefinition,
        status: "in_progress",
      })
  ) {
    throw new Error("live P108 definition differs from the Round12 admission");
  }
  const historicalGatePaths = await discoverHistoricalGatePaths();
  const frozenPaths = [...new Set([
    ...policy.successor.featureDefinition.files.filter(
      (relativePath) => !postReviewMutable.has(relativePath),
    ),
    ...governancePaths,
    ...historicalGatePaths,
  ])].sort();
  const frozenEntries = [];
  for (const relativePath of frozenPaths) {
    const bytes = await readStableFile(path.join(root, relativePath));
    frozenEntries.push({
      path: relativePath,
      sha256: sha256BytesV13(bytes),
    });
  }
  const transitions = [];
  for (const transition of CD04_DELTA_TRANSITIONS) {
    const [live, target] = await Promise.all([
      readStableFile(path.join(root, transition.path)),
      readStableFile(path.join(root, transition.targetPath)),
    ]);
    transitions.push({
      ...transition,
      fromSha256: sha256BytesV13(live),
      toSha256: sha256BytesV13(target),
    });
  }
  const [performance, parity] = await Promise.all([
    readJsonArtifact(performancePath),
    readJsonArtifact(parityPath),
  ]);
  const frozenAt = options.frozenAt ?? new Date().toISOString();
  const reviewChallenges = Object.fromEntries(
    CD04_DELTA_REVIEW_LANES.map((lane) => [
      lane,
      sha256BytesV13(canonicalJsonV13({
        schemaVersion: CD04_DELTA_SCHEMA_VERSION,
        lane,
        frozenAt,
        parentAnchorDigest: parentAnchor.digest,
        frozenEntries,
        transitions,
      })),
    ]),
  );
  const snapshot = withCanonicalDigestV13({
    schemaVersion: CD04_DELTA_SCHEMA_VERSION,
    kind: "conversation-disclosure-cd04-delta-review-snapshot",
    programId: CD04_DELTA_PROGRAM_ID,
    featureId: CD04_DELTA_FEATURE_ID,
    workstreamId: CD04_DELTA_WORKSTREAM_ID,
    frozenAt,
    parent: {
      anchorPath: parentAnchorPath,
      anchorDigest: parentAnchor.digest,
      policyDigest: parentAnchor.policyDigest,
      snapshotDigest: parentAnchor.snapshotDigest,
    },
    artifacts: {
      performance: {
        path: performancePath,
        canonicalDigest: performance.value.digest,
        sha256: performance.sha256,
      },
      parity: {
        path: parityPath,
        canonicalDigest: parity.value.digest,
        sha256: parity.sha256,
      },
    },
    frozenEntries,
    transitions,
    reviewLanes: [...CD04_DELTA_REVIEW_LANES],
    reviewChallenges,
    requiredAbsentPaths: [
      CD04_DELTA_REVIEW_PATH,
      ...Object.values(CD04_DELTA_RECEIPT_PATHS),
      ...Object.values(CD04_DELTA_REVIEW_OUTPUT_PATHS),
      ".zerox/verification/conversation-disclosure/CD04-reviewed-delta-manifest.json",
    ].sort(),
  });
  const errors = validateCd04DeltaSnapshotV13(snapshot);
  if (errors.length > 0) {
    throw new Error(`CD04 delta snapshot is invalid: ${errors.join("; ")}`);
  }
  for (const relativePath of snapshot.requiredAbsentPaths) {
    if (await exists(path.join(root, relativePath))) {
      throw new Error(`CD04 pre-review output already exists: ${relativePath}`);
    }
  }
  if (options.publish) {
    await publishPrivateJson(path.join(root, CD04_DELTA_SNAPSHOT_PATH), snapshot);
  }
  return snapshot;
}

async function discoverHistoricalGatePaths() {
  const [scripts, sharedTests, verification] = await Promise.all([
    readdir(path.join(root, "scripts")),
    readdir(path.join(root, "src/shared")),
    readdir(path.join(root, ".zerox/verification/conversation-disclosure")),
  ]);
  return [
    ...scripts
      .filter((name) =>
        name.includes("conversation-disclosure") && name.endsWith(".mjs"))
      .map((name) => `scripts/${name}`),
    ...sharedTests
      .filter((name) =>
        /^conversationDisclosure.*V(?:2|3|4|5|6|7|8|9|10|11|12)\.test\.ts$/
          .test(name))
      .map((name) => `src/shared/${name}`),
    ...verification
      .filter((name) =>
        /^CD03A-round(?:2|3|4|5|6|7|8|9|10|11|12)-(?:successor-evolution-policy|baseline-archive)\.json$/
          .test(name))
      .map((name) => `.zerox/verification/conversation-disclosure/${name}`),
  ];
}

async function prepareTransitionTargets() {
  const packageJson = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  packageJson.scripts.test =
    "node scripts/run-conversation-disclosure-tests-v13.mjs";
  packageJson.scripts["program:check"] =
    "node scripts/check-runtime-convergence-program.mjs && "
    + "node scripts/check-kernel-migration-program.mjs && "
    + "node scripts/check-storage-convergence-program.mjs && "
    + "node scripts/check-release-program.mjs && "
    + "node scripts/check-conversation-disclosure-program-v13.mjs && "
    + "node scripts/check-harness-state.mjs";
  await publishReplaceableTarget(
    CD04_DELTA_TRANSITIONS[0].targetPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );

  const harnessTarget = await readFile(
    path.join(root, "scripts/check-harness-state-v13.mjs"),
    "utf8",
  );
  await publishReplaceableTarget(
    CD04_DELTA_TRANSITIONS[1].targetPath,
    harnessTarget,
  );

  const packageTestSource = await readFile(
    path.join(root, "src/shared/packageScripts.test.ts"),
    "utf8",
  );
  await publishReplaceableTarget(
    CD04_DELTA_TRANSITIONS[2].targetPath,
    buildPackageScriptsTarget(packageTestSource),
  );

  const featureList = JSON.parse(
    await readFile(path.join(root, ".zerox/feature_list.json"), "utf8"),
  );
  const p108 = featureList.features.find(
    (entry) => entry.id === CD04_DELTA_FEATURE_ID,
  );
  if (!p108 || p108.status !== "in_progress") {
    throw new Error("P108 must be the active Feature before target generation");
  }
  const p109 = {
    id: "P109-chat-progressive-disclosure-surface",
    priority: 140,
    status: "in_progress",
    title: "Build the Chat progressive disclosure surface",
    files: [
      ".zerox/decisions/CD05-chat-disclosure-surface.md",
      ".zerox/verification/conversation-disclosure/CD05-chat-browser.json",
      ".zerox/conversation-disclosure-program.json",
      ".zerox/feature_list.json",
      ".zerox/progress.md",
      "src/shared/conversationDisclosure.ts",
      "src/preload/index.ts",
      "src/preload/index.test.ts",
      "src/renderer/chatStreamReducer.ts",
      "src/renderer/chatStreamReducer.test.ts",
      "src/renderer/components/AgentChatPanel.tsx",
      "src/renderer/materialDesign.test.ts",
      "task_plan.md",
      "findings.md",
      "progress.md",
    ],
    definitionOfDone: [
      "Chat narrative grouped operations failures blockers context and final results preserve existing owning-domain truth",
      "user expansion survives streaming updates and stable rows do not duplicate or lose focus",
      "projected Chat stays behind a local default-off kill switch with verified legacy rollback",
      "focused renderer accessibility full verify production smoke program harness and browser acceptance pass",
    ],
    verification: [
      "npm test -- --run src/renderer/chatStreamReducer.test.ts src/renderer/materialDesign.test.ts src/preload/index.test.ts",
      "npm run typecheck:tests",
      "npm run verify",
      "npm run smoke:prod",
      "npm run program:check",
      "npm run harness:check",
      "git diff --check",
    ],
  };
  featureList.updatedAt = "2026-08-25T17:00:00.000+08:00";
  featureList.features = [
    p109,
    ...featureList.features.map((entry) =>
      entry.id === CD04_DELTA_FEATURE_ID
        ? { ...entry, status: "done" }
        : entry),
  ];
  await publishReplaceableTarget(
    CD04_DELTA_TRANSITIONS[3].targetPath,
    `${JSON.stringify(featureList, null, 2)}\n`,
  );

  const program = JSON.parse(
    await readFile(
      path.join(root, ".zerox/conversation-disclosure-program.json"),
      "utf8",
    ),
  );
  program.updatedAt = "2026-08-25T17:00:00.000+08:00";
  program.activeFeatureId = p109.id;
  program.nextFeatureId = p109.id;
  program.workstreams = program.workstreams.map((entry) =>
    entry.id === "CD04"
      ? { ...entry, state: "completed" }
      : entry.id === "CD05"
        ? { ...entry, state: "in_progress" }
        : entry);
  await publishReplaceableTarget(
    CD04_DELTA_TRANSITIONS[4].targetPath,
    `${JSON.stringify(program, null, 2)}\n`,
  );
}

function buildPackageScriptsTarget(source) {
  const marker = '  it("exposes harness engineering commands", () => {';
  const start = source.indexOf(marker);
  const describeClose = source.lastIndexOf("\n});");
  if (start < 0 || describeClose < start) {
    throw new Error("package scripts test harness block is missing");
  }
  const block = `  it("exposes harness engineering commands", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;
    const round12PackageTarget = JSON.parse(readFileSync(path.join(
      process.cwd(),
      ".zerox/verification/conversation-disclosure/CD03A-round12-package.target.json",
    ), "utf8")) as PackageJson;

    expect(round12PackageTarget.scripts?.test).toBe(
      "node scripts/run-conversation-disclosure-tests-v12.mjs",
    );
    expect(packageJson.scripts).toMatchObject({
      "test": "node scripts/run-conversation-disclosure-tests-v13.mjs",
      "harness:check": "node scripts/check-harness-state.mjs",
      "program:check":
        "node scripts/check-runtime-convergence-program.mjs && node scripts/check-kernel-migration-program.mjs && node scripts/check-storage-convergence-program.mjs && node scripts/check-release-program.mjs && node scripts/check-conversation-disclosure-program-v13.mjs && node scripts/check-harness-state.mjs",
      "conversation-disclosure:baseline":
        "node scripts/run-conversation-disclosure-performance.mjs",
    });
    const checkerSource = readFileSync(path.join(
      process.cwd(),
      "scripts/check-conversation-disclosure-program-v13.mjs",
    ), "utf8");
    const harnessSource = readFileSync(path.join(
      process.cwd(),
      "scripts/check-harness-state.mjs",
    ), "utf8");
    expect(checkerSource).toContain("CD04_DELTA_SNAPSHOT_PATH");
    expect(checkerSource).toContain("validateCd04DeltaAnchorV13");
    expect(checkerSource).toContain("caller-pinned CD04 delta anchor");
    expect(harnessSource).toContain("checkConversationDisclosureProgramV13");
    expect(harnessSource).toContain(
      '"conversation-disclosure-harness-v13-receipt"',
    );
    expect(harnessSource).toContain('identityAssurance: "not-signed"');
    expect(harnessSource).toContain("platformIdentitySignature: null");
    expect(harnessSource).not.toContain(
      'identityAssurance: "platform-signed"',
    );
  });
`;
  return `${source.slice(0, start)}${block}${source.slice(describeClose)}\n`;
}

async function readJsonArtifact(relativePath) {
  const bytes = await readStableFile(path.join(root, relativePath));
  const value = JSON.parse(bytes.toString("utf8"));
  if (!value.accepted || typeof value.digest !== "string") {
    throw new Error(`${relativePath} is not an accepted artifact`);
  }
  return { value, sha256: sha256BytesV13(bytes) };
}

async function readStableFile(filePath, requirePrivate = false) {
  const expectedRoot = filePath === root || filePath.startsWith(`${root}${path.sep}`)
    ? root
    : undefined;
  return (await captureStableFileV12(filePath, filePath, {
    expectedRoot,
    requirePrivate,
  })).bytes;
}

async function publishReplaceableTarget(relativePath, content) {
  const filePath = path.join(root, relativePath);
  const next = Buffer.from(content);
  if (await exists(filePath)) {
    const current = await readStableFile(filePath);
    if (current.equals(next)) return;
  }
  const temporary = `${filePath}.tmp-${process.pid}`;
  await rm(temporary, { force: true });
  await writeFile(temporary, next, { mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600);
  await rename(temporary, filePath);
}

async function publishPrivateJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  if (await exists(filePath)) {
    const current = await readStableFile(filePath, true);
    if (current.equals(bytes)) return;
    throw new Error(`refusing to replace frozen snapshot: ${filePath}`);
  }
  await publishPrivateExactV12(filePath, bytes, {
    expectedRoot: root,
    label: "CD04 delta review snapshot",
  });
}

async function exists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function parseArguments(argv) {
  const options = { publish: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--publish") {
      options.publish = true;
    } else if (value === "--parent-anchor") {
      options.parentAnchor = argv[++index];
    } else if (value === "--expected-parent-anchor-digest") {
      options.expectedParentAnchorDigest = argv[++index];
    } else if (value === "--frozen-at") {
      options.frozenAt = argv[++index];
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  if (!options.parentAnchor || !options.expectedParentAnchorDigest) {
    throw new Error("caller-pinned Round12 parent anchor is required");
  }
  return options;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const snapshot = await freezeCd04DeltaV13(
    parseArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
}
