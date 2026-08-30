#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  hashCanonical,
  validateProductionScenarioReceipt,
} from "./conversation-disclosure-acceptance-contract.mjs";

const root = await realpath(process.cwd());
const program = JSON.parse(
  await readFile(
    path.join(root, ".zerox/conversation-disclosure-program.json"),
    "utf8",
  ),
);
const scenarios = program.scenarioMatrix;
if (
  !Array.isArray(scenarios)
  || scenarios.length !== 19
  || new Set(scenarios.map((scenario) => scenario.id)).size !== 19
) {
  fail("CD09 requires exactly 19 unique scenario rows.");
}
const requestedScenario = parseRequestedScenario(process.argv.slice(2));
const executionScenarios = requestedScenario
  ? scenarios.filter((scenario) => scenario.id === requestedScenario)
  : scenarios;
if (executionScenarios.length !== (requestedScenario ? 1 : 19)) {
  fail("Requested CD09 scenario is not in the frozen matrix.");
}
const electronExecutable = await resolveElectronExecutable(root);
const electronRebuildExecutable = path.join(
  root,
  "node_modules/.bin/electron-rebuild",
);
const nativeProbeScript = path.join(root, "scripts/probe-native-sqlite.mjs");
const nativeModulePath = path.join(
  root,
  "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
);
const outputRoot = path.join(
  root,
  ".zerox/verification/conversation-disclosure/CD09-scenarios",
);
if (requestedScenario) {
  // A single-scenario debug run must not destroy sibling scenario evidence;
  // it replaces only its own receipt and screenshots. The full 19-scenario
  // acceptance run below still starts from a clean slate.
  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    `${requestedScenario}.json`,
    `${requestedScenario}.png`,
    `${requestedScenario}.initial.png`,
  ].map((name) => rm(path.join(outputRoot, name), { force: true })));
} else {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
}
const receipts = [];
const nativeTransactionRoot = await realpath(await mkdtemp(
  path.join(os.tmpdir(), "zerox-cd09-native-"),
));
const nativeBackupPath = path.join(
  nativeTransactionRoot,
  "better_sqlite3.node",
);
await copyFile(nativeModulePath, nativeBackupPath);
const nativeBackupDigest = await hashFile(nativeBackupPath);
try {
  await requireSuccess(
    electronRebuildExecutable,
    ["-f", "-w", "better-sqlite3"],
    process.env,
    5 * 60_000,
    "Electron native rebuild",
  );
  await requireSuccess(
    electronExecutable,
    [nativeProbeScript, "--expect-runtime=electron"],
    { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    30_000,
    "Electron native preflight",
  );
  for (const scenario of executionScenarios) {
    const scenarioDigest = hashCanonical(scenario);
    const scenarioRoot = await realpath(await mkdtemp(
      path.join(os.tmpdir(), `zerox-cd09-${scenario.id}-`),
    ));
    const outputPath = path.join(outputRoot, `${scenario.id}.json`);
    const screenshotPath = path.join(outputRoot, `${scenario.id}.png`);
    try {
      const multiProcess = [
        "S13-legacy-coverage",
        "S17-cancel-interruption",
      ].includes(scenario.id);
      const firstOutput = multiProcess
        ? path.join(scenarioRoot, "initial.json")
        : outputPath;
      const firstScreenshot = multiProcess
        ? path.join(scenarioRoot, "initial.png")
        : screenshotPath;
      const first = await runScenarioProcess({
        scenario,
        scenarioDigest,
        scenarioRoot,
        outputPath: firstOutput,
        screenshotPath: firstScreenshot,
        phase: multiProcess ? "initial" : "single",
      });
      await validateChildReceipt(
        first,
        scenario,
        firstScreenshot,
      );
      let receipt = first;
      if (multiProcess) {
        const restarted = await runScenarioProcess({
          scenario,
          scenarioDigest,
          scenarioRoot,
          outputPath: path.join(scenarioRoot, "restart.json"),
          screenshotPath: path.join(scenarioRoot, "restart.png"),
          phase: "restart",
        });
        await validateChildReceipt(
          restarted,
          scenario,
          path.join(scenarioRoot, "restart.png"),
        );
        const initialScreenshotOutput = path.join(
          outputRoot,
          `${scenario.id}.initial.png`,
        );
        await copyFile(firstScreenshot, initialScreenshotOutput);
        const finalScreenshot = await readFile(
          path.join(scenarioRoot, "restart.png"),
        );
        await copyFile(path.join(scenarioRoot, "restart.png"), screenshotPath);
        const screenshotDigests = [
          `sha256:${createHash("sha256").update(finalScreenshot).digest("hex")}`,
          ...first.screenshotDigests,
        ];
        const actions = restarted.actions.map((restartedAction) => {
          const action =
            (
              scenario.id === "S17-cancel-interruption"
              && restartedAction.index === 0
            )
            || (
              scenario.id === "S13-legacy-coverage"
              && restartedAction.index < 2
            )
              ? first.actions[restartedAction.index]
              : restartedAction;
          return action.index === (
            scenario.id === "S13-legacy-coverage" ? 2 : 1
          )
            ? {
                ...action,
                executor: "production_restart",
                evidenceIds: [
                  ...new Set([
                    ...first.processEpochs.map(
                      (epoch) => `process:${epoch}`,
                    ),
                    ...action.evidenceIds,
                  ]),
                ],
              }
            : action;
        });
        const receiptInput = {
          ...Object.fromEntries(
            Object.entries(restarted).filter(([key]) => key !== "digest"),
          ),
          executionId: randomUUID(),
          processEpochs: [
            ...first.processEpochs,
            ...restarted.processEpochs,
          ],
          actions,
          requirements: restarted.requirements.map((requirement, index) => ({
            ...requirement,
            evidenceIds: [
              actionEvidenceRef(actions[
                expectedRequirementActionIndex(
                  scenario.id,
                  index,
                  actions.length,
                )
              ]),
              `screenshot:${
                screenshotDigests[
                  expectedScreenshotIndex(scenario.id, index)
                ]
              }`,
            ],
          })),
          screenshotDigests,
        };
        receipt = {
          ...receiptInput,
          digest: hashCanonical(receiptInput),
        };
        await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
          flag: "wx",
        });
      }
      const validation = validateProductionScenarioReceipt(receipt, scenario);
      if (!validation.ok) {
        fail(`${scenario.id}: ${validation.errors.join("; ")}`);
      }
      receipts.push(receipt);
      process.stdout.write(`[cd09:real-app] ${scenario.id} PASS\n`);
    } finally {
      await rm(scenarioRoot, { recursive: true, force: true });
    }
  }
} finally {
  await copyFile(nativeBackupPath, nativeModulePath);
  if (await hashFile(nativeModulePath) !== nativeBackupDigest) {
    fail("Node native module restore digest changed.");
  }
  await requireSuccess(
    process.execPath,
    [nativeProbeScript, "--expect-runtime=node"],
    process.env,
    30_000,
    "Node native restore",
  );
  await rm(nativeTransactionRoot, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify({
  kind: "conversation-disclosure-production-scenario-run",
  status: "passed",
  scenarioCount: receipts.length,
  receiptDigests: receipts.map((receipt) => receipt.digest),
}, null, 2)}\n`);

function parseRequestedScenario(args) {
  if (args.length === 0) return null;
  if (args.length !== 2 || args[0] !== "--scenario" || !args[1]) {
    fail("Usage: run-conversation-disclosure-real-app.mjs [--scenario ID]");
  }
  return args[1];
}

async function runScenarioProcess({
  scenario,
  scenarioDigest,
  scenarioRoot,
  outputPath,
  screenshotPath,
  phase,
}) {
  const rendererArgs = [
    ...(process.env.ZEROX_V392_OUTER_SANDBOX === "1"
      ? ["--no-sandbox"]
      : []),
    ".",
    ...(scenario.id === "S13-legacy-coverage" && phase === "restart"
      ? []
      : ["--zerox-chat-disclosure=projected"]),
  ];
  // The renderer child can be terminated by a signal (crash or the watchdog
  // SIGTERM/SIGKILL on timeout), which surfaces as a null exit code with no
  // deterministic failure output. It can also exit 0 without writing its
  // receipt/screenshot when the process quits cleanly before the driver
  // finishes (for example the renderer crash-loop shutdown path calls
  // app.quit(), which resolves through the before-quit drain as exit 0).
  // Both are non-deterministic liveness events, not acceptance failures: a
  // genuine success always writes the receipt and screenshot through the
  // driver's exclusive `wx` writes. Retry them a bounded number of times with
  // a clean per-attempt output/screenshot slate, using "did the child produce
  // its complete output artifacts" as the liveness signal. A concrete
  // non-zero exit code (a real, reproducible failure) is never retried and
  // fails closed immediately so we can never mask a genuine defect. Every
  // terminal failure keeps the child's captured stdout/stderr tail so the
  // failing attempt remains diagnosable.
  const maxAttempts = 3;
  let result;
  let artifactsComplete = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await rm(outputPath, { force: true });
    await rm(screenshotPath, { force: true });
    result = await runOwnedProcess(electronExecutable, rendererArgs, {
      cwd: root,
      env: {
        HOME: process.env.HOME,
        LANG: process.env.LANG ?? "en_US.UTF-8",
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        SHELL: "/bin/sh",
        TMPDIR: process.env.TMPDIR ?? "/private/tmp",
        BUILDING_AGENT_USER_DATA_DIR: path.join(scenarioRoot, "user-data"),
        ZEROX_AGENT_USER_DATA_DIR: path.join(scenarioRoot, "user-data"),
        ZEROX_STORAGE_BACKEND: "sqlite",
        ZEROX_DISABLE_AUTO_UPDATE: "1",
        ZEROX_CD09_SCENARIO_ID: scenario.id,
        ZEROX_CD09_SCENARIO_DIGEST: scenarioDigest,
        ZEROX_CD09_SCENARIO_EXPECTED: JSON.stringify(scenario.expected),
        ZEROX_CD09_SCENARIO_EVIDENCE_REQUIREMENTS:
          JSON.stringify(scenario.evidenceRequirements),
        ZEROX_CD09_SCENARIO_OUTPUT: outputPath,
        ZEROX_CD09_SCENARIO_SCREENSHOT: screenshotPath,
        ZEROX_CD09_SCENARIO_PHASE: phase,
      },
      timeoutMs: 45_000,
    });
    if (result.code === null) {
      process.stderr.write(
        `[cd09:real-app] ${scenario.id}/${phase} terminated by signal `
          + `(null exit) on attempt ${attempt}/${maxAttempts}; retrying\n`,
      );
      continue;
    }
    if (result.code !== 0) break;
    artifactsComplete = await outputArtifactsExist(outputPath, screenshotPath);
    if (artifactsComplete) break;
    process.stderr.write(
      `[cd09:real-app] ${scenario.id}/${phase} exited 0 without complete `
        + `output artifacts on attempt ${attempt}/${maxAttempts}; retrying\n`,
    );
  }
  if (result.code !== 0) {
    fail(
      `${scenario.id}/${phase} exited ${result.code}: ${
        result.stderr.trim() || result.stdout.trim()
      }`,
    );
  }
  if (!artifactsComplete) {
    fail(
      `${scenario.id}/${phase} exited 0 without producing its receipt and `
        + `screenshot after ${maxAttempts} attempts. `
        + `Last attempt stdout tail: ${tail(result.stdout)}\n`
        + `Last attempt stderr tail: ${tail(result.stderr)}`,
    );
  }
  return JSON.parse(await readFile(outputPath, "utf8"));
}

async function outputArtifactsExist(outputPath, screenshotPath) {
  const [output, screenshot] = await Promise.all([
    lstat(outputPath).catch(() => null),
    lstat(screenshotPath).catch(() => null),
  ]);
  return Boolean(
    output?.isFile()
      && output.size > 0
      && screenshot?.isFile()
      && screenshot.size > 0,
  );
}

function tail(output, maxLength = 2_000) {
  const trimmed = output.trim();
  return trimmed.length <= maxLength
    ? trimmed
    : `…${trimmed.slice(-maxLength)}`;
}

async function resolveElectronExecutable(repositoryRoot) {
  const relativePath = (
    await readFile(
      path.join(repositoryRoot, "node_modules/electron/path.txt"),
      "utf8",
    )
  ).trim();
  if (!relativePath || path.isAbsolute(relativePath)) {
    fail("Electron path.txt is invalid.");
  }
  return realpath(
    path.join(repositoryRoot, "node_modules/electron/dist", relativePath),
  );
}

async function runOwnedProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, options.timeoutMs);
    timeout.unref();
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

async function requireSuccess(command, args, env, timeoutMs, label) {
  const result = await runOwnedProcess(command, args, {
    cwd: root,
    env,
    timeoutMs,
  });
  if (result.code !== 0) {
    fail(`${label} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
}

async function hashFile(filePath) {
  return `sha256:${createHash("sha256").update(await readFile(filePath)).digest("hex")}`;
}

async function validateChildReceipt(receipt, scenario, screenshotPath) {
  const validation = validateProductionScenarioReceipt(
    receipt,
    scenario,
    { partialProcess: true },
  );
  const screenshotDigest = await hashFile(screenshotPath);
  if (
    !validation.ok
    || receipt.screenshotDigests?.length !== 1
    || receipt.screenshotDigests[0] !== screenshotDigest
  ) {
    fail(
      `${scenario.id} child receipt is invalid: ${
        [...validation.errors, "screenshot mismatch"].join("; ")
      }`,
    );
  }
}

function actionEvidenceRef(action) {
  return `action:${action.index}:${hashCanonical(action.observations)}`;
}

function expectedRequirementActionIndex(
  scenarioId,
  requirementIndex,
  actionCount,
) {
  if (scenarioId === "S10-accessibility") {
    return [1, 0, 2][requirementIndex] ?? actionCount - 1;
  }
  return Math.min(requirementIndex, actionCount - 1);
}

function expectedScreenshotIndex(scenarioId, requirementIndex) {
  if (scenarioId === "S13-legacy-coverage") {
    return requirementIndex < 2 ? 1 : 0;
  }
  if (scenarioId === "S17-cancel-interruption") {
    return requirementIndex === 0 ? 1 : 0;
  }
  return 0;
}

function fail(message) {
  throw new Error(message);
}
