#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
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
  || scenarios.some(
    (scenario) =>
      typeof scenario?.id !== "string"
      || !/^S\d{2}-[a-z0-9-]+$/.test(scenario.id),
  )
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
const legacyFixture = executionScenarios.some(
  (scenario) => scenario.id === "S13-legacy-coverage",
)
  ? await loadLegacyFixture(root)
  : null;
const electronExecutable = await resolveElectronExecutable(root);
const electronRebuildExecutable = path.join(
  root,
  "node_modules/.bin/electron-rebuild",
);
const nativeProbeScript = path.join(root, "scripts/probe-native-sqlite.mjs");
const nodeNativeRebuildScript = path.join(
  root,
  "scripts/rebuild-native-sqlite.mjs",
);
const nativeModulePath = path.join(
  root,
  "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
);
const initialNodeProbe = await runOwnedProcess(
  process.execPath,
  [nativeProbeScript, "--expect-runtime=node"],
  {
    cwd: root,
    env: process.env,
    timeoutMs: 30_000,
  },
);
if (initialNodeProbe.code !== 0) {
  await requireSuccess(
    process.execPath,
    [nodeNativeRebuildScript],
    process.env,
    5 * 60_000,
    "Node native recovery",
  );
  await requireSuccess(
    process.execPath,
    [nativeProbeScript, "--expect-runtime=node"],
    process.env,
    30_000,
    "Node native recovery preflight",
  );
}
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
      const firstOutput = path.join(
        scenarioRoot,
        multiProcess ? "initial.json" : "single.json",
      );
      const firstScreenshot = path.join(
        scenarioRoot,
        multiProcess ? "initial.png" : "single.png",
      );
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
              && restartedAction.index <= 1
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
          attemptNonces: [
            ...first.attemptNonces,
            ...restarted.attemptNonces,
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
      } else {
        await copyFile(firstOutput, outputPath);
        await copyFile(firstScreenshot, screenshotPath);
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
  // Every child gets a distinct filesystem root, process group and nonce.
  // Signals, timeouts, crash-loop exits and missing artifacts fail closed;
  // they cannot be erased by a later successful retry.
  const maxAttempts = 1;
  const userDataPath = path.join(scenarioRoot, "user-data");
  const restartBaselinePath = path.join(
    scenarioRoot,
    "restart-baseline-user-data",
  );
  if (phase === "restart") {
    const persistedUserData = await lstat(userDataPath).catch(() => null);
    if (!persistedUserData?.isDirectory()) {
      fail(
        `${scenario.id}/${phase} cannot snapshot its persisted userData baseline.`,
      );
    }
    await rm(restartBaselinePath, { recursive: true, force: true });
    await cp(userDataPath, restartBaselinePath, { recursive: true });
  }
  let result;
  let artifactsComplete = false;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await rm(outputPath, { force: true });
      await rm(screenshotPath, { force: true });
      const attemptRoot = await realpath(await mkdtemp(
        path.join(scenarioRoot, `attempt-${attempt}-`),
      ));
      const attemptUserDataPath = path.join(attemptRoot, "user-data");
      const attemptOutputPath = path.join(attemptRoot, "receipt.json");
      const attemptScreenshotPath = path.join(attemptRoot, "screenshot.png");
      const attemptNonce = randomUUID();
      const secretCanary = scenario.id === "S11-secret-safety"
        ? `cd09_${randomUUID().replaceAll("-", "")}`
        : undefined;
      const legacyFixtureDigest = scenario.id === "S13-legacy-coverage"
        ? legacyFixture?.fixtureDigest
        : undefined;
      if (scenario.id === "S13-legacy-coverage" && !legacyFixture) {
        fail("S13 immutable multidomain fixture was not loaded.");
      }
      if (phase === "restart") {
        await cp(restartBaselinePath, attemptUserDataPath, { recursive: true });
      } else {
        await mkdir(attemptUserDataPath, { recursive: true });
      }
      if (legacyFixtureDigest && phase === "initial") {
        await assertLegacyFixtureSnapshot(
          legacyFixture.fixtureRoot,
          legacyFixture,
          true,
        );
        await cp(
          legacyFixture.configPath,
          path.join(attemptUserDataPath, "config"),
          { recursive: true },
        );
      }
      if (legacyFixtureDigest) {
        await assertLegacyFixtureSnapshot(
          attemptUserDataPath,
          legacyFixture,
          false,
        );
      }
      const outputHandle = await open(attemptOutputPath, "wx", 0o600);
      let screenshotHandle;
      try {
        screenshotHandle = await open(attemptScreenshotPath, "wx", 0o600);
        const [outputIdentity, screenshotIdentity] = await Promise.all([
          outputHandle.stat(),
          screenshotHandle.stat(),
        ]);
        result = await runOwnedProcess(electronExecutable, rendererArgs, {
          cwd: root,
          extraStdio: [outputHandle.fd, screenshotHandle.fd],
          env: {
            HOME: process.env.HOME,
            LANG: process.env.LANG ?? "en_US.UTF-8",
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            SHELL: "/bin/sh",
            TMPDIR: process.env.TMPDIR ?? "/private/tmp",
            BUILDING_AGENT_USER_DATA_DIR: attemptUserDataPath,
            ZEROX_AGENT_USER_DATA_DIR: attemptUserDataPath,
            ZEROX_STORAGE_BACKEND:
              scenario.id === "S13-legacy-coverage" ? "json" : "sqlite",
            ZEROX_DISABLE_AUTO_UPDATE: "1",
            ZEROX_CD09_ACCEPTANCE_MODE: "1",
            ZEROX_CD09_SCENARIO_ID: scenario.id,
            ZEROX_CD09_SCENARIO_DIGEST: scenarioDigest,
            ZEROX_CD09_SCENARIO_EXPECTED: JSON.stringify(scenario.expected),
            ZEROX_CD09_SCENARIO_EVIDENCE_REQUIREMENTS:
              JSON.stringify(scenario.evidenceRequirements),
            ZEROX_CD09_SCENARIO_OUTPUT: attemptOutputPath,
            ZEROX_CD09_SCENARIO_SCREENSHOT: attemptScreenshotPath,
            ZEROX_CD09_SCENARIO_OUTPUT_FD: "3",
            ZEROX_CD09_SCENARIO_SCREENSHOT_FD: "4",
            ZEROX_CD09_ATTEMPT_NONCE: attemptNonce,
            ...(secretCanary
              ? { ZEROX_CD09_SECRET_CANARY: secretCanary }
              : {}),
            ...(legacyFixtureDigest
              ? { ZEROX_CD09_LEGACY_FIXTURE_DIGEST: legacyFixtureDigest }
              : {}),
            ...(legacyFixture
              ? {
                  ZEROX_CD09_LEGACY_SOURCE_CUT_ID:
                    legacyFixture.sourceCutId,
                  ZEROX_CD09_LEGACY_INTENTIONAL_ABSENCES:
                    JSON.stringify(legacyFixture.intentionalAbsences),
                }
              : {}),
            ZEROX_CD09_SCENARIO_PHASE: phase,
          },
          timeoutMs:
            scenario.id === "S15-goal-acceptance" ? 90_000 : 45_000,
        });
        await Promise.all([
          assertArtifactIdentity(attemptOutputPath, outputIdentity),
          assertArtifactIdentity(attemptScreenshotPath, screenshotIdentity),
        ]);
      } finally {
        await Promise.allSettled([
          outputHandle.close(),
          screenshotHandle?.close(),
        ]);
      }
      if (secretCanary) {
        assertTextExcludesCanary(result.stdout, secretCanary, "stdout");
        assertTextExcludesCanary(result.stderr, secretCanary, "stderr");
        await assertDirectoryExcludesCanary(attemptRoot, secretCanary);
      }
      if (legacyFixtureDigest) {
        await Promise.all([
          assertLegacyFixtureSnapshot(
            legacyFixture.fixtureRoot,
            legacyFixture,
            true,
          ),
          assertLegacyFixtureSnapshot(
            attemptUserDataPath,
            legacyFixture,
            false,
          ),
        ]);
      }
      if (result.code === null) break;
      if (result.code !== 0) break;
      artifactsComplete = await outputArtifactsExist(
        attemptOutputPath,
        attemptScreenshotPath,
      );
      if (!artifactsComplete) break;
      const attemptReceipt = JSON.parse(
        await readFile(attemptOutputPath, "utf8"),
      );
      if (
        JSON.stringify(attemptReceipt.attemptNonces)
          !== JSON.stringify([attemptNonce])
      ) {
        fail(`${scenario.id}/${phase} receipt did not bind its owning attempt.`);
      }
      await rm(userDataPath, { recursive: true, force: true });
      await cp(attemptUserDataPath, userDataPath, { recursive: true });
      await copyFile(attemptOutputPath, outputPath);
      await copyFile(attemptScreenshotPath, screenshotPath);
      break;
    }
    if (result.code === null) {
      fail(
        `${scenario.id}/${phase} terminated by ${result.signal ?? "unknown signal"}`
          + `${result.timedOut ? " after timeout" : ""}: `
          + `${tail(result.stderr) || tail(result.stdout)}`,
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
          + `screenshot for its bound attempt. `
          + `Last attempt stdout tail: ${tail(result.stdout)}\n`
          + `Last attempt stderr tail: ${tail(result.stderr)}`,
      );
    }
    return JSON.parse(await readFile(outputPath, "utf8"));
  } finally {
    await rm(restartBaselinePath, { recursive: true, force: true });
  }
}

async function assertArtifactIdentity(filePath, expected) {
  const actual = await lstat(filePath);
  if (
    !actual.isFile()
    || actual.isSymbolicLink()
    || actual.dev !== expected.dev
    || actual.ino !== expected.ino
    || actual.nlink !== 1
  ) {
    fail(`Acceptance artifact identity changed: ${filePath}`);
  }
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

async function assertDirectoryExcludesCanary(directory, canary) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      fail(`S11 secret scan encountered a symbolic link: ${entryPath}`);
    }
    if (entry.isDirectory()) {
      await assertDirectoryExcludesCanary(entryPath, canary);
      continue;
    }
    if (!entry.isFile()) {
      fail(`S11 secret scan encountered a special file: ${entryPath}`);
    }
    const bytes = await readFile(entryPath);
    if (bytes.includes(Buffer.from(canary, "utf8"))) {
      fail(`S11 secret canary leaked into ${path.relative(directory, entryPath)}.`);
    }
  }
}

async function loadLegacyFixture(repositoryRoot) {
  const fixtureRoot = path.join(
    repositoryRoot,
    "fixtures/conversation-disclosure/v3.9.1-multidomain",
  );
  const manifestPath = path.join(fixtureRoot, "fixture-manifest.json");
  const manifestIdentity = await lstat(manifestPath);
  if (
    !manifestIdentity.isFile()
    || manifestIdentity.isSymbolicLink()
    || manifestIdentity.nlink !== 1
  ) {
    fail("S13 fixture manifest must be one single-link regular file.");
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest?.schemaVersion !== 1
    || manifest.fixtureId !== "conversation-disclosure-v3.9.1-multidomain-json"
    || manifest.generatedBackend !== "json"
    || manifest.sourceRelease?.tag !== "v3.9.1"
    || !/^[a-f0-9]{40}$/.test(manifest.sourceRelease?.commit ?? "")
    || !/^[a-f0-9]{40}$/.test(manifest.sourceRelease?.tree ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(manifest.fixtureDigest ?? "")
    || !Array.isArray(manifest.files)
    || manifest.files.length !== 8
    || !Array.isArray(manifest.intentionalAbsences)
    || manifest.intentionalAbsences.length === 0
    || new Set(manifest.intentionalAbsences).size
      !== manifest.intentionalAbsences.length
  ) {
    fail("S13 fixture manifest authority is invalid.");
  }
  const fixture = {
    fixtureRoot,
    configPath: path.join(fixtureRoot, "config"),
    fixtureDigest: manifest.fixtureDigest,
    sourceCutId:
      `${manifest.sourceRelease.tag}@${manifest.sourceRelease.commit}`
      + `#${manifest.sourceRelease.tree}`,
    intentionalAbsences: [...manifest.intentionalAbsences],
    files: manifest.files.map((entry) => ({ ...entry })),
  };
  await assertLegacyFixtureSnapshot(fixtureRoot, fixture, true);
  return fixture;
}

async function assertLegacyFixtureSnapshot(baseRoot, fixture, exactFileSet) {
  const expectedPaths = fixture.files.map((entry) => entry.path);
  const sortedExpectedPaths = [...expectedPaths].sort();
  if (
    new Set(expectedPaths).size !== expectedPaths.length
    || JSON.stringify(expectedPaths) !== JSON.stringify(sortedExpectedPaths)
    || expectedPaths.some((relativePath) =>
      typeof relativePath !== "string"
      || path.isAbsolute(relativePath)
      || !relativePath.startsWith("config/")
      || relativePath.split("/").includes("..")
    )
  ) {
    fail("S13 fixture manifest file roster is unsafe or non-canonical.");
  }
  if (exactFileSet) {
    const actualPaths = (await listRelativeFiles(path.join(baseRoot, "config")))
      .map((relativePath) => `config/${relativePath}`)
      .sort();
    if (JSON.stringify(actualPaths) !== JSON.stringify(sortedExpectedPaths)) {
      fail("S13 fixture source file roster changed.");
    }
  }
  const digestRecords = [];
  for (const expected of fixture.files) {
    const absolutePath = path.join(baseRoot, expected.path);
    const identity = await lstat(absolutePath);
    if (
      !identity.isFile()
      || identity.isSymbolicLink()
      || identity.nlink !== 1
    ) {
      fail(`S13 fixture file identity is unsafe: ${expected.path}`);
    }
    const bytes = await readFile(absolutePath);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const lineCount = bytes.length === 0
      ? 0
      : bytes.toString("utf8").split("\n").length - 1;
    if (
      digest !== expected.sha256
      || bytes.length !== expected.bytes
      || lineCount !== expected.lineCount
    ) {
      fail(`S13 fixture file changed: ${expected.path}`);
    }
    digestRecords.push(
      `${expected.path}\0${digest}\0${bytes.length}\0${lineCount}\n`,
    );
  }
  const aggregateDigest = `sha256:${createHash("sha256")
    .update(Buffer.from(digestRecords.join("")))
    .digest("hex")}`;
  if (aggregateDigest !== fixture.fixtureDigest) {
    fail("S13 fixture aggregate digest does not match its manifest.");
  }
}

async function listRelativeFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name))) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      fail(`S13 fixture contains a symbolic link: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await listRelativeFiles(entryPath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      fail(`S13 fixture contains a special file: ${relativePath}`);
    }
  }
  return files;
}

function assertTextExcludesCanary(value, canary, label) {
  if (String(value).includes(canary)) {
    fail(`S11 secret canary leaked into child ${label}.`);
  }
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
      ...(options.extraStdio
        ? { stdio: ["ignore", "pipe", "pipe", ...options.extraStdio] }
        : {}),
      detached: process.platform !== "win32",
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
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateOwnedProcessTree(child.pid, "SIGTERM");
    }, options.timeoutMs);
    timeout.unref();
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      void ensureOwnedProcessTreeTerminated(child.pid).then(
        () => resolve({
          code,
          signal,
          timedOut,
          stdout,
          stderr,
          processGroupQuiescent: true,
        }),
        reject,
      );
    });
  });
}

async function ensureOwnedProcessTreeTerminated(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    throw new Error("Owned process group identity is invalid.");
  }
  if (process.platform === "win32") {
    if (!await processExists(pid)) return;
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      killer.once("error", reject);
      killer.once("close", (code) =>
        code === 0 ? resolve() : reject(
          new Error(`taskkill failed while clearing owned process ${pid}.`),
        )
      );
    });
    if (await waitForProcessExit(pid, 2_000)) return;
    throw new Error(`Owned process tree ${pid} survived taskkill.`);
  }

  if (!processGroupExists(pid)) return;
  terminateOwnedProcessTree(pid, "SIGTERM");
  if (await waitForProcessGroupExit(pid, 1_000)) return;
  terminateOwnedProcessTree(pid, "SIGKILL");
  if (await waitForProcessGroupExit(pid, 2_000)) return;
  throw new Error(`Owned process group ${pid} survived SIGKILL.`);
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processGroupExists(pid);
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await processExists(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !await processExists(pid);
}

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function terminateOwnedProcessTree(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  try {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref();
    } else {
      process.kill(-pid, signal);
    }
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
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
