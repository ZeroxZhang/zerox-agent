#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { hashCanonicalV13 } from "./conversation-disclosure-delta-contract-v13.mjs";
import { computeTreeManifest } from "./local-candidate-source-manifest.mjs";
import { validateProductionScenarioReceipt } from "./conversation-disclosure-acceptance-contract.mjs";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const verificationRoot = path.join(
  root,
  ".zerox/verification/conversation-disclosure",
);
const focusedTestFiles = [
  "src/renderer/chatStreamReducer.test.ts",
  "src/renderer/materialDesign.test.ts",
  "src/renderer/toolApprovalProjection.test.ts",
  "src/renderer/toolApprovalVisibility.test.ts",
  "src/renderer/goalAcceptanceInteraction.test.ts",
  "src/renderer/goalTerminalTruth.test.ts",
  "src/renderer/chatTaskActivityRestore.test.ts",
  "src/main/conversationEvidenceResolver.test.ts",
  "src/main/planStore.test.ts",
  "src/main/chatSessionStore.test.ts",
  "src/main/jsonlRecovery.test.ts",
];
const electronArgs = process.env.ZEROX_V392_OUTER_SANDBOX === "1"
  ? ["--no-sandbox"]
  : [];
const commands = [
  [
    "./node_modules/.bin/electron",
    [...electronArgs, "scripts/capture-cd05-chat-browser.mjs"],
  ],
  [
    "./node_modules/.bin/electron",
    [...electronArgs, "scripts/capture-cd06-cross-surface-browser.mjs"],
  ],
  [
    "./node_modules/.bin/electron",
    [...electronArgs, "scripts/capture-cd07-inspector-browser.mjs"],
  ],
  [process.execPath, ["scripts/run-conversation-disclosure-hardening.mjs"]],
  [process.execPath, ["scripts/run-production-smoke.mjs", "--skip-build"]],
  [process.execPath, ["scripts/run-conversation-disclosure-real-app.mjs"]],
  [
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--run",
      ...focusedTestFiles,
      "--maxWorkers=1",
      "--reporter=json",
    ],
  ],
];
const commandResults = [];
for (const [index, [command, args]] of commands.entries()) {
  await verifyExecutionInputs();
  const result = await execFile(command, args, {
    cwd: root,
    env: { ...process.env },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const testReport = index === commands.length - 1
    ? JSON.parse(result.stdout)
    : null;
  commandResults.push({
    command: [command, ...args].join(" "),
    status: "passed",
    stdoutSha256:
      `sha256:${createHash("sha256").update(result.stdout).digest("hex")}`,
    stderrSha256:
      `sha256:${createHash("sha256").update(result.stderr).digest("hex")}`,
    ...(testReport
      ? {
          testFiles: focusedTestFiles,
          passedTests: testReport.testResults.flatMap((testFile) =>
            testFile.assertionResults
              .filter((assertion) => assertion.status === "passed")
              .map((assertion) => ({
                testFile: path.relative(root, testFile.name),
                fullName: assertion.fullName,
              }))),
        }
      : {}),
  });
  await verifyExecutionInputs();
}

const program = JSON.parse(await readFile(
  path.join(root, ".zerox/conversation-disclosure-program.json"),
  "utf8",
));
const scenarioReceiptRoot = path.join(verificationRoot, "CD09-scenarios");
const scenarioReceipts = new Map(await Promise.all(
  program.scenarioMatrix.map(async (scenario) => {
    const receiptPath = path.join(scenarioReceiptRoot, `${scenario.id}.json`);
    const screenshotPath = path.join(
      scenarioReceiptRoot,
      `${scenario.id}.png`,
    );
    const [receiptBytes, screenshotBytes] = await Promise.all([
      readFile(receiptPath),
      readFile(screenshotPath),
    ]);
    const receipt = JSON.parse(receiptBytes.toString("utf8"));
    const validation = validateProductionScenarioReceipt(receipt, scenario);
    const screenshotDigest =
      `sha256:${createHash("sha256").update(screenshotBytes).digest("hex")}`;
    if (receipt.screenshotDigests?.[0] !== screenshotDigest) {
      validation.ok = false;
      validation.errors.push("screenshot digest does not match receipt");
    }
    if ([
      "S13-legacy-coverage",
      "S17-cancel-interruption",
    ].includes(scenario.id)) {
      const initialScreenshotBytes = await readFile(path.join(
        scenarioReceiptRoot,
        `${scenario.id}.initial.png`,
      ));
      const initialScreenshotDigest =
        `sha256:${createHash("sha256").update(initialScreenshotBytes).digest("hex")}`;
      if (receipt.screenshotDigests?.[1] !== initialScreenshotDigest) {
        validation.ok = false;
        validation.errors.push(
          "initial screenshot digest does not match receipt",
        );
      }
    }
    return [scenario.id, {
      receipt,
      validation,
      receiptPath: path.relative(root, receiptPath),
      screenshotPath: path.relative(root, screenshotPath),
    }];
  }),
));
const artifacts = Object.fromEntries(await Promise.all([
  ["CD05", "CD05-chat-browser.json"],
  ["CD06", "CD06-cross-surface-browser.json"],
  ["CD07", "CD07-inspector-browser.json"],
  ["CD08", "CD08-hardening.json"],
].map(async ([id, file]) => [
  id,
  JSON.parse(await readFile(path.join(verificationRoot, file), "utf8")),
])));
const artifactPaths = {
  CD05: ".zerox/verification/conversation-disclosure/CD05-chat-browser.json",
  CD06: ".zerox/verification/conversation-disclosure/CD06-cross-surface-browser.json",
  CD07: ".zerox/verification/conversation-disclosure/CD07-inspector-browser.json",
  CD08: ".zerox/verification/conversation-disclosure/CD08-hardening.json",
};
const workstreams = new Map(
  program.workstreams.map((workstream) => [workstream.id, workstream]),
);
const scenarios = program.scenarioMatrix.map((scenario) => {
  const direct = scenarioReceipts.get(scenario.id);
  const owners = ["CD05", "CD06", "CD07", "CD08"].filter((id) =>
    workstreams.get(id)?.acceptanceScenarioIds?.includes(scenario.id),
  );
  const evidence = owners.map((id) => ({
    workstreamId: id,
    artifact: artifactPaths[id],
    accepted: artifacts[id]?.accepted === true,
  }));
  const assertions = scenarioAssertions(
    scenario.id,
    artifacts,
    commandResults.at(-1)?.status === "passed",
    focusedTestFiles,
    commandResults.at(-1)?.passedTests ?? [],
  );
  const owningEvidenceAccepted =
    evidence.length > 0
    && evidence.every((entry) => entry.accepted === true);
  const assertionsPassed =
    assertions.length > 0
    && assertions.every((entry) => entry.passed === true);
  const passed =
    direct?.validation.ok === true
    && commandResults[5]?.status === "passed"
    && owningEvidenceAccepted
    && assertionsPassed;
  return {
    id: scenario.id,
    title: scenario.title,
    scenarioDigest: hashCanonicalV13(scenario),
    fixture: scenario.fixture,
    evidenceRequirements: scenario.evidenceRequirements,
    expected: scenario.expected,
    status: passed ? "passed" : "failed",
    executor: scenario.executor,
    runtimeEvidence: {
      kind: "production-electron-main-preload-scenario",
      commandIndex: 5,
      passed:
        passed,
      receipt: direct?.receiptPath,
      screenshot: direct?.screenshotPath,
      receiptDigest: direct?.receipt?.digest,
      executionId: direct?.receipt?.executionId,
      processEpochs: direct?.receipt?.processEpochs,
      validationErrors: direct?.validation.errors ?? ["missing receipt"],
    },
    evidence,
    assertions,
    owningEvidenceAccepted,
    assertionsPassed,
  };
});
const accepted =
  scenarios.length === 19
  && scenarios.every((scenario) => scenario.status === "passed");
const manifest = {
  schemaVersion: 1,
  kind: "conversation-disclosure-real-app-acceptance",
  programId: program.programId,
  version: "3.9.2",
  status: accepted ? "passed" : "failed",
  accepted,
  scenarioCount: scenarios.length,
  passedScenarioCount: scenarios.filter((scenario) =>
    scenario.status === "passed").length,
  commandResults,
  scenarios,
};
await writeFile(
  path.join(verificationRoot, "CD09-real-app-acceptance.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(JSON.stringify(manifest, null, 2));
if (!accepted) process.exitCode = 1;

function scenarioAssertions(
  id,
  evidence,
  focusedSuitePassed,
  testFiles,
  passedTests,
) {
  const cd05 = evidence.CD05?.viewportEvidence;
  const cd06 = evidence.CD06;
  const cd07 = evidence.CD07;
  const cd08Checks = new Map(
    (evidence.CD08?.checks ?? []).map((entry) => [entry.id, entry.passed]),
  );
  const check = (name, passed) => ({ id: name, passed: Boolean(passed) });
  const regression = (name, testFile, testName) => ({
    ...check(
      name,
      focusedSuitePassed
        && testFiles.includes(testFile)
        && passedTests.some((entry) =>
          entry.testFile === testFile && entry.fullName.endsWith(testName)),
    ),
    testFile,
    testName,
  });
  const byId = {
    "S01-default-narrative": [
      check("compact-default", cd05?.compact?.operationsExpanded === "false"),
    ],
    "S02-inline-expansion": [
      check("manual-expand", cd05?.expanded?.operationsExpanded === "true"),
      check("manual-collapse", cd05?.collapsedAgain?.operationsExpanded === "false"),
    ],
    "S03-evidence-handoff": [
      check("exact-run-target", Boolean(cd07?.reloaded?.runId)),
      check("stable-selection", cd07?.selected?.selectedLabel === cd07?.reloaded?.selectedLabel),
    ],
    "S04-failure-attention": [
      check("failure-prominent", cd06?.desktop?.failedExpanded === true),
    ],
    "S05-approval-attention": [regression(
      "approval-projection-regression",
      "src/renderer/toolApprovalProjection.test.ts",
      "restores a pending request from a subscribe-first snapshot",
    )],
    "S06-pause-reload-recovery": [
      check("historical-reconstruction", cd08Checks.get("historical-reconstruction")),
    ],
    "S07-plan-progress": [regression(
      "plan-store-regression",
      "src/main/planStore.test.ts",
      "persists PlanRecord v3 lineage and rejects non-Direct runtime replans",
    )],
    "S08-scheduled-progress": [
      check("scheduled-stable-identity", cd06?.desktop?.duplicateDisclosureIds === 0),
      check("child-run-excluded", cd06?.desktop?.childRunProjected === false),
    ],
    "S09-long-session": [
      check("runtime-stress", cd08Checks.get("runtime-stress-6-of-6")),
      check("retained-ring", cd08Checks.get("full-ring-metric")),
    ],
    "S10-accessibility": [
      check("keyboard-state", Boolean(cd05?.collapsedAgain?.activeElementLabel)),
      check("reduced-motion", cd08Checks.get("reduced-motion-contract")),
    ],
    "S11-secret-safety": [
      check("secret-absent", cd07?.initial?.previewContainsSecret === false),
      check("redaction-visible", cd07?.initial?.previewContainsRedaction === true),
    ],
    "S12-retry-attempt": [regression(
      "attempt-reducer-regression",
      "src/renderer/chatStreamReducer.test.ts",
      "removes a superseded partial answer and rejects late deltas from the old attempt",
    )],
    "S13-legacy-coverage": [
      check("legacy-default-off", cd08Checks.get("legacy-default-off")),
    ],
    "S14-guided-input": [regression(
      "guided-input-regression",
      "src/renderer/chatTaskActivityRestore.test.ts",
      "does not present an interrupted processing claim as resumable input",
    )],
    "S15-goal-acceptance": [regression(
      "goal-acceptance-regression",
      "src/renderer/goalAcceptanceInteraction.test.ts",
      "only reports manual completion success for an attested completed-unverified result",
    )],
    "S16-plan-confirmation": [regression(
      "plan-confirmation-regression",
      "src/main/planStore.test.ts",
      "persists PlanRecord v3 lineage and rejects non-Direct runtime replans",
    )],
    "S17-cancel-interruption": [
      check("cancel-stress", evidence.CD08?.runtimeStress?.some(
        (entry) => entry.scenario === "cancel-5k",
      )),
    ],
    "S18-context-usage": [
      check("context-stress", evidence.CD08?.runtimeStress?.some(
        (entry) => entry.scenario === "context-25k",
      )),
    ],
    "S19-unknown-coverage": [
      check("unknown-visible", cd07?.initial?.labels?.some(
        (label) => label.includes("其他证据"),
      )),
      check("unknown-fallback-contract", cd08Checks.get("unknown-presenter-fallback")),
    ],
  };
  return byId[id] ?? [check("scenario-not-mapped", false)];
}

async function verifyExecutionInputs() {
  const expectedNodeDigest =
    process.env.ZEROX_LOCAL_CANDIDATE_NODE_DIGEST;
  const expectedToolchainDigest =
    process.env.ZEROX_LOCAL_CANDIDATE_TOOLCHAIN_DIGEST;
  const expectedToolchainEntryCount = Number(
    process.env.ZEROX_LOCAL_CANDIDATE_TOOLCHAIN_ENTRY_COUNT,
  );
  if (!expectedNodeDigest && !expectedToolchainDigest) return;
  if (
    !/^sha256:[0-9a-f]{64}$/.test(expectedNodeDigest ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(expectedToolchainDigest ?? "")
    || !Number.isInteger(expectedToolchainEntryCount)
    || expectedToolchainEntryCount <= 0
  ) {
    throw new Error("external acceptance execution pins are incomplete");
  }
  const nodeDigest =
    `sha256:${createHash("sha256").update(await readFile(process.execPath)).digest("hex")}`;
  const toolchain = await computeTreeManifest(path.join(root, "node_modules"), {
    exclude: (relativePath) =>
      relativePath === ".vite"
      || relativePath.startsWith(`.vite${path.sep}`)
      || relativePath === "better-sqlite3/build"
      || relativePath.startsWith(`better-sqlite3/build${path.sep}`)
      || relativePath === "better-sqlite3/bin"
      || relativePath.startsWith(`better-sqlite3/bin${path.sep}`),
  });
  if (
    nodeDigest !== expectedNodeDigest
    || toolchain.digest !== expectedToolchainDigest
    || toolchain.entryCount !== expectedToolchainEntryCount
  ) {
    throw new Error("external acceptance execution identity changed");
  }
}
