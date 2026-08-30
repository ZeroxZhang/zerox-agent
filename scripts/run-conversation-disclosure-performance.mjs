#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_PATH = path.relative(ROOT, fileURLToPath(import.meta.url));
const PERFORMANCE_PATH = path.join(
  ROOT,
  ".zerox/verification/conversation-disclosure/CD04-performance-baseline.json",
);
const PARITY_PATH = path.join(
  ROOT,
  ".zerox/verification/conversation-disclosure/CD04-shadow-parity.json",
);
const PROGRAM_ID = "conversation-progressive-disclosure-v3.9.2-2026-08";
const FEATURE_ID = "P108-conversation-disclosure-evidence-foundation";
const PROCESS_SAMPLES = 5;
const INTERNAL_WARMUPS = 3;
const INTERNAL_SAMPLES = 7;
const SOURCE_PATHS = Object.freeze([
  "src/shared/conversationDisclosure.ts",
  "src/shared/conversationEvidence.ts",
  "src/main/jsonlRecovery.ts",
  "src/main/chatSessionStore.ts",
  "src/main/storage/repositories/chatSessionEventRepository.ts",
  "src/main/agentTrajectoryStore.ts",
  "src/main/storage/repositories/runRepository.ts",
  "src/main/storage/storageDb.ts",
  "src/main/storage/migrations/0000_initial.sql",
  "src/main/storage/migrations/0001_plan_records.sql",
  "src/main/storage/migrations/0002_chat_session_events.sql",
  "src/main/storage/migrations/0003_chat_search_fts.sql",
  "src/main/storage/migrations/0004_goal_execution_authority.sql",
  "src/main/storage/migrations/0005_reviewed_learning_eval_authority.sql",
  "src/main/storage/migrations/0006_domain_authority_state.sql",
  "src/main/workspaceRunStore.ts",
  "src/main/conversationDisclosureAdapters.ts",
  "src/main/conversationDisclosureMaterializer.ts",
  "src/main/conversationEvidenceResolver.ts",
  "src/main/conversationDisclosureShadowAudit.ts",
  "src/main/container.ts",
  "src/main/container.test.ts",
  SCRIPT_PATH,
]);
const PARITY_INTEGRATION_TEST_FILE = "src/main/container.test.ts";
const PARITY_INTEGRATION_TEST_PATTERN =
  "loads Goal ledger|loads execution checkpoint|rejects an older cross-store";
const FIXTURE_SPEC = Object.freeze({
  schemaVersion: 1,
  projectionCardinalities: [80, 160, 500],
  chatHistoryRecords: 10_000,
  trajectoryHistoryRecords: 25_000,
  boundedPageRecords: 200,
  ambientBurstUpdates: 20,
  longSummaryBytes: 2_048,
  contributorCount: 500,
  contributorPageLimit: 50,
  ambientProtectedInterleaved: true,
  replayInsideRing: true,
  replayOutsideRing: true,
});
const HARD_SAFETY_CAPS = Object.freeze({
  projectionWallP95Ms: 1_000,
  projectionCpuP95Ms: 1_000,
  boundedReadP95Ms: 250,
  ambientPublicationP95Ms: 250,
  protectedPublicationP95Ms: 250,
  replayP95Ms: 100,
  retainedHeapBytesMax: 256 * 1024 * 1024,
  snapshotBytesMax: 16 * 1024 * 1024,
  ringBytesMax: 8 * 1024 * 1024,
  unexpectedResetRateMax: 0,
});
const FROZEN_PERFORMANCE_BUDGETS = Object.freeze({
  projectionWallP95Ms: 100,
  projectionCpuP95Ms: 100,
  boundedReadP95Ms: 25,
  ambientPublicationP95Ms: 50,
  protectedPublicationP95Ms: 50,
  replayP95Ms: 10,
  retainedHeapBytesMax: 4 * 1024 * 1024,
  snapshotBytesMax: 1_280 * 1024,
  ringBytesMax: 1024 * 1024,
  unexpectedResetRateMax: 0,
});
const PERFORMANCE_BUDGET_KEYS = Object.freeze(
  Object.keys(FROZEN_PERFORMANCE_BUDGETS).sort(),
);
const RAW_SAMPLE_COUNTS = Object.freeze({
  projectionWallMs: PROCESS_SAMPLES * INTERNAL_SAMPLES,
  projectionCpuMs: PROCESS_SAMPLES * INTERNAL_SAMPLES,
  boundedReadMs: PROCESS_SAMPLES * INTERNAL_SAMPLES,
  ambientPublicationMs:
    PROCESS_SAMPLES * FIXTURE_SPEC.ambientBurstUpdates,
  protectedPublicationMs: PROCESS_SAMPLES * INTERNAL_SAMPLES,
  replayMs: PROCESS_SAMPLES * INTERNAL_SAMPLES,
});
const EXPECTED_FIXTURE_METRICS = Object.freeze({
  ambient_protected_burst: Object.freeze([
    "ambientPublicationMs",
    "protectedPublicationMs",
    "retainedHeapBytes",
    "ringBytes",
    "snapshotBytes",
    "unexpectedResetRate",
  ]),
  chat_history_10000: Object.freeze([
    "boundedReadMs",
    "projectionCpuMs",
    "projectionWallMs",
    "retainedFixtureBytes",
    "retainedHeapBytes",
    "snapshotBytes",
  ]),
  contributor_pages: Object.freeze([
    "projectionCpuMs",
    "projectionWallMs",
    "retainedHeapBytes",
    "snapshotBytes",
  ]),
  projection_160: Object.freeze([
    "projectionCpuMs",
    "projectionWallMs",
    "retainedHeapBytes",
    "snapshotBytes",
  ]),
  projection_500: Object.freeze([
    "projectionCpuMs",
    "projectionWallMs",
    "retainedHeapBytes",
    "snapshotBytes",
  ]),
  projection_80: Object.freeze([
    "projectionCpuMs",
    "projectionWallMs",
    "retainedHeapBytes",
    "snapshotBytes",
  ]),
  replay_inside_outside: Object.freeze([
    "insideReplayDelivered",
    "outsideReplayReset",
    "replayMs",
    "ringBytes",
  ]),
  summary_2kb: Object.freeze([
    "projectionCpuMs",
    "projectionWallMs",
    "retainedHeapBytes",
    "snapshotBytes",
  ]),
  trajectory_history_25000: Object.freeze([
    "boundedReadMs",
    "projectionCpuMs",
    "projectionWallMs",
    "retainedFixtureBytes",
    "retainedHeapBytes",
    "snapshotBytes",
  ]),
});
const EXPECTED_CORRECTNESS = Object.freeze({
  deltaPublicationCount:
    PROCESS_SAMPLES * (
      FIXTURE_SPEC.ambientBurstUpdates
      + INTERNAL_WARMUPS
      + INTERNAL_SAMPLES
    ),
  expectedResetCount: PROCESS_SAMPLES,
  expectedResetReasonMatched: PROCESS_SAMPLES,
  listenerGenerationResetObserved: PROCESS_SAMPLES,
  protectedTerminalCount:
    PROCESS_SAMPLES * (INTERNAL_WARMUPS + INTERNAL_SAMPLES),
  replayInsideContinuous: PROCESS_SAMPLES,
  replayInsideDeltaCount: PROCESS_SAMPLES * 5,
  retainedRingEntryCount:
    PROCESS_SAMPLES * (
      FIXTURE_SPEC.ambientBurstUpdates
      + INTERNAL_WARMUPS
      + INTERNAL_SAMPLES
    ),
  replayOutsideReset: PROCESS_SAMPLES,
  replayOutsideReasonMatched: PROCESS_SAMPLES,
  unexpectedResetCount: 0,
});
const DETERMINISTIC_METRICS = new Set([
  "insideReplayDelivered",
  "outsideReplayReset",
  "retainedFixtureBytes",
  "ringBytes",
  "snapshotBytes",
  "unexpectedResetRate",
]);
const REPRODUCIBILITY_FACTOR = 16;

const PARITY_GOLDEN = Object.freeze({
  schemaVersion: 1,
  scopes: [
    {
      scopeKey:
        "scope:1:1:4:chat:19:session_parity-full:0::0::17:query:parity-full",
      sourceCutDigest:
        "sha256:e2053c692cf905c5a5482028f5477182caa8ada6cb756dfd32d58c0a74b71e97",
      items: [
        [
          "item:1:1:10:trajectory:0::12:trajectory_0:32:trajectory:run_full:trajectory_0",
          "optional",
          "succeeded",
          "sha256:3af41759fcb9210f1f848ba6c3c7c4ee75703a708e6930a01375946dac72bd83",
        ],
        [
          "item:1:1:13:chat_activity:0::10:activity_0:45:chat-activity:request_full:turn_full:paused:1",
          "required",
          "paused",
          "sha256:2d8358aa525f67c42e927fe407e95db72218b455f0026ee31dc633cd79f5b901",
        ],
        [
          "item:1:1:12:chat_message:0::12:message_full:25:chat-message:message_full",
          "required",
          "succeeded",
          "sha256:309e04e46fc9c5c45b4cbbaf8308291160765f7f6401957f54f99e447735b093",
        ],
        [
          "item:1:1:12:guided_input:0::10:input_full:23:guided-input:input_full",
          "required",
          "waiting_for_user",
          "sha256:ff262106c09002d0f838c07e38b145d6b66cd58cfd50b039f66cdcb2d03cac21",
        ],
        [
          "item:1:1:13:chat_activity:0::10:activity_1:56:chat-activity:request_full:turn_full:waiting_for_input:2",
          "required",
          "waiting_for_user",
          "sha256:8283b746fe2c9ed763749e620940f97bef5767bf2a75b6c8924c9c6552bc31c1",
        ],
        [
          "item:1:1:8:approval:0::13:approval_full:22:approval:approval_full",
          "required",
          "waiting_for_approval",
          "sha256:fedc5eaaa857357ecc40938717960eae49d303ae86712dc53b2a3b05ab30e6a6",
        ],
        [
          "item:1:1:13:workspace_run:0::20:workspace_event_full:51:workspace-event:workspace_full:workspace_event_full",
          "required",
          "succeeded",
          "sha256:e520f51b2a69e267c3604256d60d3ec3a950bf0c4c5f2681c8f31f20e5a06301",
        ],
        [
          "item:1:1:15:tool_invocation:0::15:invocation_full:20:tool:run_full\u0000call_0",
          "required",
          "succeeded",
          "sha256:bb473dbb0f4d4723067b12114573dd81c6eee1bfeb029fc438e5fa27806dbe84",
        ],
        [
          "item:1:1:4:plan:0::9:plan_full:14:plan:plan_full",
          "required",
          "waiting_for_user",
          "sha256:7bffba7a893b08cf410ecda1b293d9f61dbd9b207ca03fe92232846e7bff7613",
        ],
        [
          "item:1:1:9:agent_run:0::14:run_checkpoint:24:agent-run:run_checkpoint",
          "optional",
          "paused",
          "sha256:34cc3336c5324da8dc2770afe78ae5b6d394e26871c6f974c1e698c7a4f48723",
        ],
        [
          "item:1:1:13:scheduled_run:0::8:run_full:22:scheduled-run:run_full",
          "required",
          "succeeded",
          "sha256:fe68087b8c989f53ece6d4cb55281c30bde5b51d624591061c996272b951893d",
        ],
        [
          "item:1:1:13:workspace_run:0::14:workspace_full:28:workspace-run:workspace_full",
          "required",
          "succeeded",
          "sha256:1431a1721cdba5b5c62a081d4728a363db8433796ef4a8f19e6e5e4df614f7d2",
        ],
        [
          "item:1:1:4:goal:0::9:goal_full:14:goal:goal_full",
          "optional",
          "waiting_for_acceptance",
          "sha256:fd0ae3ae9edd83223008b5a52e1a56b7fc430e532b857893fc9a651057535c03",
        ],
        [
          "item:1:1:5:usage:0::10:usage_full:16:usage:usage_full",
          "optional",
          "succeeded",
          "sha256:faf12cd8e276ff7e69d670359ba3d2761e3c6e8275ecb6631fcd2508dd77632b",
        ],
        [
          "item:1:1:6:kernel:0::11:kernel_full:15:kernel:run_full",
          "optional",
          "succeeded",
          "sha256:8d8502544e75416d5c6f4385a17b5445fdf91a469917e99ea0daf4be52021ca2",
        ],
        [
          "item:1:1:7:context:0::12:context_full:20:context:context_full",
          "optional",
          "succeeded",
          "sha256:e11c2e65f29739e6257240487da8b57fe3aaf3c5e87ebaed1b7c0e33d3a6143f",
        ],
        [
          "item:1:1:9:agent_run:0::8:run_full:18:agent-run:run_full",
          "required",
          "succeeded",
          "sha256:78ca7c7f976b349d3ea3ee685400b5b4ac468fba920c333dd77d2d35591dfe99",
        ],
      ],
    },
    {
      scopeKey:
        "scope:1:1:4:chat:21:session_parity-legacy:0::0::19:query:parity-legacy",
      sourceCutDigest:
        "sha256:6e64f0c53af07c76b0667d6504671b9c1c37c534952021b5f675ab78a8a9b75a",
      items: [[
        "item:1:1:13:chat_activity:0::10:activity_0:39:chat-activity:request_0:turn_0:paused:1",
        "optional",
        "paused",
        "sha256:4b0fcb6fbfc4585f653c3c31090f1b9a543d497b6ed491d243e07ae3e5758ad6",
      ]],
    },
    {
      scopeKey:
        "scope:1:1:4:chat:22:session_parity-unknown:0::0::20:query:parity-unknown",
      sourceCutDigest:
        "sha256:fd7313af0f84333a8aeebd390fc13bf7bd63b6e67bbf9becbe09c5545ef6c2dc",
      items: [[
        "item:1:1:7:unknown:15:future_optional:8:future_1:6:future",
        "optional",
        "unknown",
        "sha256:53a3479dfd45ae8cb93bd84b4b1b609d940efa0d65043b24f67421d69b837ed8",
      ]],
    },
  ],
});

const args = new Set(process.argv.slice(2));
if (args.has("--worker")) {
  await runWorker();
} else {
  await runParent();
}

async function runParent() {
  compileMainSources();
  const modules = loadModules(path.join(ROOT, "dist-electron"));
  const integrationProof = runOwningStoreParityProbe();
  const parityCandidate = buildParityCandidate(modules);

  const samples = [];
  for (let index = 0; index < PROCESS_SAMPLES; index += 1) {
    const child = spawnSync(
      process.execPath,
      [
        "--expose-gc",
        fileURLToPath(import.meta.url),
        "--worker",
        `--sample=${index}`,
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          ZEROX_CD04_COMPILED_ROOT: path.join(ROOT, "dist-electron"),
        },
      },
    );
    if (child.status !== 0) {
      fail(
        `performance worker ${index} failed: ${
          child.stderr || child.stdout || `status ${child.status}`
        }`,
      );
    }
    samples.push(JSON.parse(child.stdout));
  }

  const rosterErrors = validateWorkerFixtureRoster(samples);
  if (rosterErrors.length > 0) {
    fail(`performance worker fixture roster is invalid: ${rosterErrors.join("; ")}`);
  }
  const sourceDigest = digestFiles(SOURCE_PATHS);
  const fixtureDigest = hashCanonical({
    performance: FIXTURE_SPEC,
    parity: PARITY_GOLDEN,
    parityIntegration: integrationProof,
  });
  const runnerDigest = digestFile(SCRIPT_PATH);
  const fixtures = aggregateWorkerSamples(samples);
  const correctness = aggregateCorrectness(samples);
  const budgets = FROZEN_PERFORMANCE_BUDGETS;
  const safetyErrors = validateSafetyCaps(fixtures, correctness);
  const generatedAt = new Date().toISOString();
  const withoutDigest = {
    schemaVersion: 1,
    kind: "conversation-disclosure-performance-baseline",
    programId: PROGRAM_ID,
    featureId: FEATURE_ID,
    generatedAt,
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpuModel: os.cpus()[0]?.model ?? "unknown",
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    provenance: {
      sourceDigest,
      fixtureDigest,
      runnerDigest,
      sourcePaths: SOURCE_PATHS,
      processSamples: PROCESS_SAMPLES,
      internalWarmups: INTERNAL_WARMUPS,
      internalSamples: INTERNAL_SAMPLES,
    },
    fixtureSpec: FIXTURE_SPEC,
    fixtures,
    budgets,
    hardSafetyCaps: HARD_SAFETY_CAPS,
    correctness,
    domControl: {
      status: "legacy_control",
      command:
        "BUILDING_AGENT_PERF_SMOKE=1 npm run smoke:prod:built",
      thresholds: {
        inputP95FrameMs: 50,
        inputMaxFrameMs: 100,
        sessionSwitchMs: 250,
        getSessionMs: 500,
        longTaskMaxMs: 120,
        renderedMessageCountMax: 80,
      },
      projectedDom: "deferred_to_CD05_CD08",
    },
    accepted: safetyErrors.length === 0,
    safetyErrors,
  };
  const performanceArtifact = {
    ...withoutDigest,
    digest: hashCanonical(withoutDigest),
  };
  const parityArtifact = buildParityArtifact(
    modules,
    parityCandidate,
    sourceDigest,
    fixtureDigest,
    generatedAt,
    integrationProof,
  );
  if (!performanceArtifact.accepted) {
    fail(`performance safety caps failed: ${safetyErrors.join("; ")}`);
  }
  if (!parityArtifact.accepted) {
    process.stderr.write(
      `${JSON.stringify({
        audits: parityArtifact.scopes,
        candidate: parityCandidate.scopes.map((snapshot) => ({
          scopeKey: snapshot.scope.key,
          sourceCutDigest:
            modules.shadow.createConversationShadowBodyDigest(
              snapshot.sourceCuts,
            ),
          items: snapshot.items.map((item) => [
            item.id,
            parityItemRequiredness(snapshot, item),
            item.lifecycle,
            modules.shadow.createConversationShadowBodyDigest(item),
          ]),
        })),
      }, null, 2)}\n`,
    );
    fail("shadow parity contains required, lifecycle, identity, or safety mismatches");
  }

  const update = args.has("--update");
  const persistedPerformance = verifyOrWriteArtifact(
    PERFORMANCE_PATH,
    performanceArtifact,
    update,
    (stored) => validateStoredPerformance(stored, performanceArtifact),
  );
  const persistedParity = verifyOrWriteArtifact(
    PARITY_PATH,
    parityArtifact,
    update,
    (stored) => validateStoredParity(modules, stored, parityArtifact),
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    sourceDigest,
    fixtureDigest,
    performanceDigest: persistedPerformance.digest,
    parityDigest: persistedParity.digest,
    processSamples: PROCESS_SAMPLES,
    fixtureCount: fixtures.length,
    correctness,
  }, null, 2)}\n`);
}

function runOwningStoreParityProbe() {
  const vitest = path.join(
    ROOT,
    "node_modules/.bin",
    process.platform === "win32" ? "vitest.cmd" : "vitest",
  );
  const command = [
    "vitest",
    "run",
    PARITY_INTEGRATION_TEST_FILE,
    "--maxWorkers=1",
    "-t",
    PARITY_INTEGRATION_TEST_PATTERN,
  ];
  const result = spawnSync(vitest, command.slice(1), {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(
      `production container parity probe failed: ${
        result.stderr || result.stdout || `status ${result.status}`
      }`,
    );
  }
  return {
    kind: "production-container-vitest",
    status: "passed",
    command: command.join(" "),
    testFile: PARITY_INTEGRATION_TEST_FILE,
    testFileSha256: digestFile(PARITY_INTEGRATION_TEST_FILE),
  };
}

async function runWorker() {
  const compiledRoot = process.env.ZEROX_CD04_COMPILED_ROOT;
  if (!compiledRoot) fail("worker is missing ZEROX_CD04_COMPILED_ROOT");
  const modules = loadModules(compiledRoot);
  const fixtures = {};
  for (const count of FIXTURE_SPEC.projectionCardinalities) {
    fixtures[`projection_${count}`] = measureProjectionFixture(modules, count);
  }
  fixtures.chat_history_10000 = await measureChatHistoryFixture(modules);
  fixtures.trajectory_history_25000 =
    await measureTrajectoryHistoryFixture(modules);
  fixtures.summary_2kb = measureSummaryFixture(modules);
  fixtures.contributor_pages = measureContributorFixture(modules);
  const materializer = await measureMaterializerFixture(modules);
  fixtures.ambient_protected_burst = materializer.metrics;
  fixtures.replay_inside_outside = materializer.replayMetrics;
  process.stdout.write(JSON.stringify({
    sample: Number(
      process.argv.find((value) => value.startsWith("--sample="))
        ?.slice("--sample=".length) ?? 0,
    ),
    fixtures,
    correctness: materializer.correctness,
  }));
}

function compileMainSources() {
  const tsc = path.join(
    ROOT,
    "node_modules/.bin",
    process.platform === "win32" ? "tsc.cmd" : "tsc",
  );
  const result = spawnSync(
    tsc,
    ["-p", "tsconfig.electron.json", "--pretty", "false"],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    fail(`TypeScript build failed: ${result.stderr || result.stdout}`);
  }
}

function loadModules(compiledRoot) {
  const require = createRequire(import.meta.url);
  return {
    disclosure: require(path.join(
      compiledRoot,
      "shared/conversationDisclosure.js",
    )),
    evidence: require(path.join(
      compiledRoot,
      "shared/conversationEvidence.js",
    )),
    adapters: require(path.join(
      compiledRoot,
      "main/conversationDisclosureAdapters.js",
    )),
    materializer: require(path.join(
      compiledRoot,
      "main/conversationDisclosureMaterializer.js",
    )),
    shadow: require(path.join(
      compiledRoot,
      "main/conversationDisclosureShadowAudit.js",
    )),
    storageDb: require(path.join(
      compiledRoot,
      "main/storage/storageDb.js",
    )),
    chatRepository: require(path.join(
      compiledRoot,
      "main/storage/repositories/chatSessionEventRepository.js",
    )),
    runRepository: require(path.join(
      compiledRoot,
      "main/storage/repositories/runRepository.js",
    )),
  };
}

function measureProjectionFixture(modules, count) {
  const scope = makeScope(modules, `projection-${count}`);
  const readSet = {
    scope,
    agentRuns: Array.from({ length: count }, (_, index) =>
      makeRun(index, "running", undefined, scope.sessionId)),
  };
  return measureProjection(modules, readSet);
}

async function measureChatHistoryFixture(modules) {
  const scope = makeScope(modules, "chat-history-10000");
  const history = Array.from(
    { length: FIXTURE_SPEC.chatHistoryRecords },
    (_, index) => makeChatActivity(index, "running"),
  );
  const storage = await modules.storageDb.createInMemoryStorage();
  const insert = storage.db.prepare(
    `INSERT INTO chat_session_events
      (id, session_id, seq, type, payload, created_at)
     VALUES (?, ?, ?, 'activity_appended', ?, ?)`,
  );
  storage.db.transaction(() => {
    for (const record of history) {
      insert.run(
        record.eventId,
        scope.sessionId,
        record.sequence,
        JSON.stringify({ event: record.event }),
        record.event.createdAt,
      );
    }
  })();
  const repository = modules.chatRepository
    .createChatSessionEventRepository(storage);
  const bounded = measureRepeated(() => repository.getActivityPage(
    scope.sessionId,
    { limit: FIXTURE_SPEC.boundedPageRecords },
  ));
  const result = {
    ...measureProjection(modules, { scope, chatActivity: bounded.value }),
    boundedReadMs: bounded.wallMs,
    retainedFixtureBytes: Buffer.byteLength(JSON.stringify(history), "utf8"),
  };
  storage.close();
  return result;
}

async function measureTrajectoryHistoryFixture(modules) {
  const scope = makeScope(modules, "trajectory-history-25000");
  const history = Array.from(
    { length: FIXTURE_SPEC.trajectoryHistoryRecords },
    (_, index) => makeTrajectoryEvent(index),
  );
  const storage = await modules.storageDb.createInMemoryStorage();
  const insert = storage.db.prepare(
    `INSERT INTO trajectory_events
      (id, run_id, seq, type, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  storage.db.transaction(() => {
    for (const event of history) {
      insert.run(
        event.id,
        event.runId,
        event.sequence,
        event.type,
        JSON.stringify(event),
        event.createdAt,
      );
    }
  })();
  const repository = modules.runRepository.createRunRepository(storage);
  const bounded = measureRepeated(() => repository.getTrajectoryPage(
    "run-history",
    { limit: FIXTURE_SPEC.boundedPageRecords },
  ));
  const result = {
    ...measureProjection(modules, {
      scope,
      trajectory: [{ runId: "run-history", events: bounded.value }],
    }),
    boundedReadMs: bounded.wallMs,
    retainedFixtureBytes: Buffer.byteLength(JSON.stringify(history), "utf8"),
  };
  storage.close();
  return result;
}

function measureSummaryFixture(modules) {
  const scope = makeScope(modules, "summary-2kb");
  const records = Array.from({ length: 160 }, (_, index) => ({
    ...makeChatActivity(index, "running"),
    event: {
      ...makeChatActivity(index, "running").event,
      message: "x".repeat(FIXTURE_SPEC.longSummaryBytes),
    },
  }));
  return measureProjection(modules, {
    scope,
    chatActivity: modules.evidence.createConversationSourcePage({
      source: "chat_activity",
      sourceId: scope.sessionId,
      queryHash: "query:summary",
      sourceRevision: "fixture:summary:160",
      status: "complete",
      records,
    }),
  });
}

function measureContributorFixture(modules) {
  const scope = makeScope(modules, "contributors-500");
  const contributors = Array.from(
    { length: FIXTURE_SPEC.contributorCount },
    (_, index) => ({
      kind: "trajectory",
      ref: `event_${index}`,
      domainRevision: String(index + 1),
      domainStatus: "tool_result",
      role: "contributor",
    }),
  );
  const measured = measureRepeated(() =>
    modules.disclosure.createConversationContributorPage({
      scopeKey: scope.key,
      itemId: "item:contributors",
      contributors,
      limit: FIXTURE_SPEC.contributorPageLimit,
    }));
  return {
    projectionWallMs: measured.wallMs,
    projectionCpuMs: measured.cpuMs,
    snapshotBytes: Buffer.byteLength(JSON.stringify(measured.value), "utf8"),
    retainedHeapBytes: measureRetainedHeap(() => structuredClone(contributors)),
  };
}

async function measureMaterializerFixture(modules) {
  const scope = makeScope(modules, "materializer");
  let runs = Array.from({ length: 160 }, (_, index) =>
    makeRun(index, "running", undefined, scope.sessionId));
  let kernelTurn = 0;
  const materializer = modules.materializer
    .createConversationDisclosureMaterializer({
      load: async () => ({
        scope,
        agentRuns: runs,
        kernel: [{
          authorityRef: "kernel_1",
          runId: "run_0",
          status: "running",
          occurredAt: timestamp(kernelTurn),
          turn: kernelTurn,
        }],
      }),
      createGenerationId: () => "fixture-generation",
      now: () => 1_000 + kernelTurn,
      maxRingEntries: 128,
      maxRingBytes: 8 * 1024 * 1024,
    });
  const initial = await materializer.refresh(scope);
  const publications = [];
  const connection = await materializer.connect(scope, (publication) => {
    publications.push(publication);
  });
  const ambientSamples = [];
  const protectedSamples = [];
  let protectedValue;
  let protectedIndex = 0;
  for (let index = 0; index < FIXTURE_SPEC.ambientBurstUpdates; index += 1) {
    kernelTurn += 1;
    ambientSamples.push((await measureAsync(() =>
      materializer.refresh(scope))).wallMs);
    if (
      index % 2 === 1
      && protectedIndex < INTERNAL_WARMUPS + INTERNAL_SAMPLES
    ) {
      const nextIndex = protectedIndex;
      protectedIndex += 1;
      runs = runs.map((run, runIndex) =>
        runIndex === nextIndex
          ? {
              ...run,
              status: "succeeded",
              finishedAt: timestamp(30 + nextIndex),
            }
          : run);
      const measured = await measureAsync(() => materializer.refresh(scope));
      protectedValue = measured.value;
      if (nextIndex >= INTERNAL_WARMUPS) {
        protectedSamples.push(measured.wallMs);
      }
    }
  }
  if (!protectedValue || protectedSamples.length !== INTERNAL_SAMPLES) {
    fail("interleaved protected publication fixture is incomplete");
  }
  const replay = await measureAsyncRepeated(() =>
    materializer.replay(scope, {
      generation: initial.snapshot.generation,
      cursor: Math.max(0, protectedValue.snapshot.cursor - 5),
    }));
  const retention = await materializer.replayRetention(scope);
  if (!retention) fail("materializer replay retention is unavailable");
  const ringBytes = retention.ringBytes;

  let pressureTurn = 0;
  const pressure = modules.materializer.createConversationDisclosureMaterializer({
    load: async () => ({
      scope,
      agentRuns: [
        makeRun(999, "running", "run_pressure", scope.sessionId),
      ],
      kernel: [{
        authorityRef: "kernel_pressure",
        runId: "run_pressure",
        status: "running",
        occurredAt: timestamp(pressureTurn),
        turn: pressureTurn,
      }],
    }),
    createGenerationId: () => `pressure-${pressureTurn}`,
    now: () => 10_000 + pressureTurn,
    maxRingEntries: 2,
    maxRingBytes: 8 * 1024 * 1024,
  });
  const pressureInitial = await pressure.refresh(scope);
  for (let index = 0; index < 4; index += 1) {
    pressureTurn += 1;
    await pressure.refresh(scope);
  }
  const outside = await measureAsync(() =>
    pressure.replay(scope, {
      generation: pressureInitial.snapshot.generation,
      cursor: 0,
    }));

  let degraded = true;
  const recoveryPublications = [];
  const recovery = modules.materializer.createConversationDisclosureMaterializer({
    load: async () => ({
      scope,
      unknownFacts: degraded ? [makeUnknown(scope)] : [],
    }),
    createGenerationId: () => degraded ? "degraded" : "recovered",
  });
  await recovery.refresh(scope);
  const recoveryConnection = await recovery.connect(scope, (publication) => {
    recoveryPublications.push(publication);
  });
  degraded = false;
  const expectedReset = await recovery.refresh(scope);

  connection.close();
  recoveryConnection.close();
  await Promise.all([
    materializer.close(),
    pressure.close(),
    recovery.close(),
  ]);
  const unexpectedResets = publications.filter(
    (publication) => publication.kind === "reset",
  ).length;
  const deltaPublications = publications.filter(
    (publication) => publication.kind === "delta",
  ).length;
  return {
    metrics: {
      ambientPublicationMs: ambientSamples,
      protectedPublicationMs: protectedSamples,
      snapshotBytes: Buffer.byteLength(
        JSON.stringify(protectedValue.snapshot),
        "utf8",
      ),
      ringBytes,
      retainedHeapBytes: measureRetainedHeap(() =>
        structuredClone(protectedValue.snapshot)),
      unexpectedResetRate:
        unexpectedResets / Math.max(1, publications.length),
    },
    replayMetrics: {
      replayMs: replay.wallMs,
      ringBytes,
      insideReplayDelivered:
        replay.value.kind === "deltas" ? replay.value.deltas.length : 0,
      outsideReplayReset: outside.value.kind === "reset" ? 1 : 0,
    },
    correctness: {
      unexpectedResetCount: unexpectedResets,
      expectedResetCount: expectedReset.kind === "reset" ? 1 : 0,
      expectedResetReasonMatched:
        expectedReset.kind === "reset"
        && expectedReset.reason === "source_set_changed"
          ? 1
          : 0,
      deltaPublicationCount: deltaPublications,
      replayInsideContinuous: replay.value.kind === "deltas" ? 1 : 0,
      replayInsideDeltaCount:
        replay.value.kind === "deltas" ? replay.value.deltas.length : 0,
      replayOutsideReset: outside.value.kind === "reset" ? 1 : 0,
      replayOutsideReasonMatched:
        outside.value.kind === "reset"
        && outside.value.reason === "replay_ring_miss"
          ? 1
          : 0,
      retainedRingEntryCount: retention.ringEntries,
      listenerGenerationResetObserved: recoveryPublications.filter(
        (publication) => publication.kind === "reset",
      ).length,
      protectedTerminalCount:
        protectedValue.snapshot.items.filter(
          (item) =>
            item.primarySource.kind === "agent_run"
            && item.lifecycle === "succeeded",
        ).length,
    },
  };
}

function measureProjection(modules, readSet) {
  const measured = measureRepeated(() => {
    const batch = modules.adapters.adaptConversationDisclosureSources(readSet);
    return modules.disclosure.projectConversationDisclosureSnapshot({
      scope: readSet.scope,
      generation: "performance-generation",
      expectedSourceCuts: batch.sourceCuts,
      seeds: batch.seeds,
      unknownFacts: batch.unknownFacts,
    });
  });
  return {
    projectionWallMs: measured.wallMs,
    projectionCpuMs: measured.cpuMs,
    snapshotBytes: Buffer.byteLength(JSON.stringify(measured.value), "utf8"),
    retainedHeapBytes: measureRetainedHeap(() => structuredClone(measured.value)),
  };
}

function buildParityCandidate(modules) {
  const fullScope = makeScope(modules, "parity-full");
  const legacyScope = makeScope(modules, "parity-legacy");
  const unknownScope = makeScope(modules, "parity-unknown");
  const fullPage = modules.evidence.createConversationSourcePage({
    source: "trajectory",
    sourceId: "run_full",
    queryHash: "query:parity-trajectory",
    sourceRevision: "fixture:trajectory:1",
    status: "complete",
    records: [makeTrajectoryEvent(0, "run_full")],
  });
  const requiredActivity = makeChatActivity(
    0,
    "paused",
    fullScope.sessionId,
  );
  requiredActivity.event.settlementId = "settlement_full";
  requiredActivity.event.requestId = "request_full";
  requiredActivity.event.turnId = "turn_full";
  const requiredActivityFingerprint =
    modules.adapters.createRequiredChatEventFingerprint(
      requiredActivity.event,
    );
  const requiredSettlement = {
    id: "settlement_full",
    attempt: 1,
    sourceSequence: 1,
    targetState: "paused",
    requiredDomains: ["chat", "workspace"],
    workspaceRunId: "workspace_full",
    preparedWorkspaceEventId: "workspace_event_full",
    workspaceEventId: "workspace_event_full",
    preparedChatEventFingerprint: requiredActivityFingerprint,
    state: "committed",
    chatEventFingerprint: requiredActivityFingerprint,
    createdAt: timestamp(1),
    updatedAt: timestamp(2),
  };
  const guidedInputState = makeGuidedInputState(fullScope);
  const guidedActivity = makeChatActivity(
    1,
    "waiting_for_input",
    fullScope.sessionId,
  );
  guidedActivity.event.requestId = "request_full";
  guidedActivity.event.turnId = "turn_full";
  guidedActivity.event.settlementId = "settlement_guided";
  guidedActivity.event.pendingSkillInput = guidedInputState;
  const guidedActivityFingerprint =
    modules.adapters.createRequiredChatEventFingerprint(guidedActivity.event);
  const guidedSettlement = {
    id: "settlement_guided",
    attempt: 1,
    sourceSequence: guidedActivity.event.sequence,
    targetState: "waiting_for_input",
    guidedInputRequestId: guidedInputState.inputRequestId,
    requiredDomains: ["chat"],
    preparedChatEventFingerprint: guidedActivityFingerprint,
    state: "committed",
    chatEventFingerprint: guidedActivityFingerprint,
    createdAt: timestamp(1),
    updatedAt: timestamp(2),
  };
  const causalRecord = {
    schemaVersion: 1,
    requestId: "request_full",
    turnId: "turn_full",
    sessionId: fullScope.sessionId,
    userMessageId: "message_full",
    inputFingerprint: "fixture",
    revision: 1,
    attempts: [],
    requiredSettlements: [requiredSettlement, guidedSettlement],
    agentRunAdmissions: [{
      runId: "run_full",
      taskId: "task_full",
      executionRevision: 1,
      state: "settled",
      finalStatus: "succeeded",
      createdAt: timestamp(1),
      updatedAt: timestamp(3),
    }],
    refs: [
      { kind: "agent_run", id: "run_full" },
      { kind: "trajectory_run", id: "run_full" },
      { kind: "workspace_run", id: "workspace_full" },
      {
        kind: "tool_invocation",
        runId: "run_full",
        id: "invocation_full",
      },
      { kind: "approval", id: "approval_full" },
    ],
    coverage: { state: "complete", reasonCodes: [] },
    createdAt: timestamp(0),
    updatedAt: timestamp(3),
  };
  const fullReadSet = {
    scope: fullScope,
    causalRecords: [causalRecord],
    chatMessages: [{
      id: "message_full",
      role: "user",
      content: "fixture content is not projected",
      createdAt: timestamp(1),
      requestId: "request_full",
      turnId: "turn_full",
      turnSettlementStatus: "succeeded",
    }],
    chatActivity: modules.evidence.createConversationSourcePage({
      source: "chat_activity",
      sourceId: fullScope.sessionId,
      queryHash: "query:parity-chat",
      sourceRevision: "fixture:chat:1",
      status: "complete",
      records: [requiredActivity, guidedActivity],
    }),
    goals: [makeGoal(fullScope)],
    plans: [makePlan(fullScope)],
    scheduledRuns: [{
      taskId: "task_full",
      runId: "run_full",
      status: "succeeded",
      occurredAt: timestamp(3),
    }],
    agentRuns: [{
      ...makeRun(0, "succeeded", "run_full", fullScope.sessionId),
      taskId: "task_full",
    }],
    activeCheckpoints: [{
      id: "checkpoint_full",
      runId: "run_checkpoint",
      taskId: "task_checkpoint",
      status: "paused",
      runContext: {
        sessionId: fullScope.sessionId,
      },
      currentStepId: "step_1",
      steps: [],
      messages: [],
      toolCallCount: 0,
      createdAt: timestamp(1),
      updatedAt: timestamp(2),
    }],
    trajectory: [{
      runId: "run_full",
      owner: {
        ...makeRun(0, "succeeded", "run_full", fullScope.sessionId),
        taskId: "task_full",
      },
      events: fullPage,
    }],
    toolInvocations: [{
      id: "invocation_full",
      runId: "run_full",
      toolCallId: "call_0",
      toolName: "read_file",
      source: "native",
      args: {},
      status: "completed",
      createdAt: timestamp(1),
      updatedAt: timestamp(2),
      ok: true,
      history: [{
        status: "completed",
        at: timestamp(2),
        ok: true,
      }],
    }],
    workspaceRuns: [{
      run: {
        workspaceRunId: "workspace_full",
        sessionId: fullScope.sessionId,
        requestId: "request_full",
        status: "succeeded",
        createdAt: timestamp(1),
        updatedAt: timestamp(3),
      },
      events: modules.evidence.createConversationSourcePage({
        source: "workspace_run",
        sourceId: "workspace_full",
        queryHash: "query:parity-workspace",
        sourceRevision: "fixture:workspace:1",
        status: "complete",
        records: [{
          id: "workspace_event_full",
          workspaceRunId: "workspace_full",
          sessionId: fullScope.sessionId,
          requestId: "request_full",
          seq: 1,
          type: "status",
          status: "paused",
          lifecycleStatus: "paused",
          message: "Paused durably",
          causalRef: {
            turnId: "turn_full",
            sourceSequence: 1,
          },
          payload: {},
          createdAt: timestamp(2),
        }],
      }),
    }],
    approvals: [makeApproval(fullScope)],
    guidedInputs: [
      {
        state: guidedInputState,
        settlement: guidedSettlement,
        settlementOwner: causalRecord,
        chatEvent: guidedActivity.event,
        occurredAt: timestamp(1),
      },
    ],
    contexts: [{
      authorityRef: "context_full",
      status: "compacted",
      snapshot: {
        estimatedTokens: 1_024,
        tokenBudget: 8_192,
        compactionCount: 1,
      },
      occurredAt: timestamp(3),
    }],
    usages: [{
      authorityRef: "usage_full",
      status: "measured",
      usage: {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
      },
      occurredAt: timestamp(3),
    }],
    kernel: [{
      authorityRef: "kernel_full",
      runId: "run_full",
      status: "succeeded",
      occurredAt: timestamp(3),
      turn: 2,
      maxTurns: 4,
    }],
  };
  const legacyReadSet = {
    scope: legacyScope,
    chatActivity: modules.evidence.createConversationSourcePage({
      source: "chat_activity",
      sourceId: legacyScope.sessionId,
      queryHash: "query:parity-legacy",
      sourceRevision: "fixture:legacy-tail",
      status: "partial",
      reasonCode: "legacy_chat_activity_tail",
      records: [makeChatActivity(0, "paused", legacyScope.sessionId)],
    }),
  };
  const unknownReadSet = {
    scope: unknownScope,
    unknownFacts: [{
      schemaVersion: 2,
      originalKind: "future_optional",
      authorityRef: "future_1",
      scope: unknownScope,
      domainStatus: "future",
      requiredness: "optional",
      durability: "durable",
      sensitivity: "technical",
      occurredAt: timestamp(2),
      semanticSlot: "future",
      safeSummary: "Future optional evidence",
    }],
  };
  const scopes = [
    materializeReadSet(modules, fullReadSet, "parity-generation-full"),
    materializeReadSet(modules, legacyReadSet, "parity-generation-legacy"),
    materializeReadSet(modules, unknownReadSet, "parity-generation-unknown"),
  ];
  return { scopes };
}

function buildParityArtifact(
  modules,
  candidate,
  sourceDigest,
  fixtureDigest,
  generatedAt,
  integrationProof,
) {
  const goldenByScope = new Map(
    PARITY_GOLDEN.scopes.map((entry) => [entry.scopeKey, entry]),
  );
  const scopes = candidate.scopes.map((snapshot) => {
    const expected = goldenByScope.get(snapshot.scope.key);
    if (!expected) fail(`missing parity golden scope ${snapshot.scope.key}`);
    return modules.shadow.auditConversationDisclosureShadow({
      snapshot,
      expected: expected.items.map(([
        id,
        requiredness,
        lifecycle,
        canonicalBodyDigest,
      ]) => ({
        id,
        requiredness,
        lifecycle,
        canonicalBodyDigest,
      })),
      expectedSourceCutDigest: expected.sourceCutDigest,
      optionalReasons: Object.fromEntries(
        snapshot.items
          .filter((item) => item.primarySource.kind === "kernel")
          .map((item) => [item.id, "ephemeral_kernel"]),
      ),
    });
  });
  const artifact = modules.shadow.buildConversationShadowParityArtifact({
    programId: PROGRAM_ID,
    featureId: FEATURE_ID,
    generatedAt,
    sourceDigest,
    fixtureDigest,
    integrationProof,
    scopes,
  });
  const errors = modules.shadow.validateConversationShadowParityArtifact(
    artifact,
  );
  if (errors.length > 0) fail(`invalid parity artifact: ${errors.join("; ")}`);
  return artifact;
}

function materializeReadSet(modules, readSet, generation) {
  const batch = modules.adapters.adaptConversationDisclosureSources(readSet);
  return modules.disclosure.projectConversationDisclosureSnapshot({
    scope: readSet.scope,
    generation,
    expectedSourceCuts: batch.sourceCuts,
    seeds: batch.seeds,
    unknownFacts: batch.unknownFacts,
  });
}

function parityItemRequiredness(snapshot, item) {
  return snapshot.sourceCuts.find((cut) =>
    cut.source === item.primarySource.kind
    && cut.sourceIdentity === `record:${item.primarySource.ref}`
    && (
      item.primarySource.kind !== "unknown"
      || cut.originalKind === item.primarySource.originalKind
    ))?.requiredness;
}

function aggregateWorkerSamples(samples) {
  const ids = Object.keys(samples[0].fixtures).sort();
  return ids.map((id) => {
    const metricNames = new Set(
      samples.flatMap((sample) => Object.keys(sample.fixtures[id])),
    );
    return {
      id,
      metrics: Object.fromEntries(
        [...metricNames].sort().map((metric) => [
          metric,
          stats(samples.flatMap((sample) => {
            const value = sample.fixtures[id][metric];
            return Array.isArray(value) ? value : [value];
          })),
        ]),
      ),
    };
  });
}

function aggregateCorrectness(samples) {
  const keys = Object.keys(samples[0].correctness).sort();
  return Object.fromEntries(keys.map((key) => [
    key,
    samples.reduce((sum, sample) => sum + sample.correctness[key], 0),
  ]));
}

function validateWorkerFixtureRoster(samples) {
  const expectedFixtureIds = Object.keys(EXPECTED_FIXTURE_METRICS).sort();
  return samples.flatMap((sample, sampleIndex) => {
    const fixtureIds = Object.keys(sample.fixtures ?? {}).sort();
    const errors = canonicalJson(fixtureIds) === canonicalJson(expectedFixtureIds)
      ? []
      : [`worker ${sampleIndex} fixture ids are incomplete`];
    for (const fixtureId of expectedFixtureIds) {
      const metricNames = Object.keys(
        sample.fixtures?.[fixtureId] ?? {},
      ).sort();
      if (
        canonicalJson(metricNames)
          !== canonicalJson([...EXPECTED_FIXTURE_METRICS[fixtureId]].sort())
      ) {
        errors.push(
          `worker ${sampleIndex} ${fixtureId} metric ids are incomplete`,
        );
      }
    }
    return errors;
  });
}

function validateSafetyCaps(fixtures, correctness) {
  const observed = observedPerformanceMetrics(fixtures);
  const errors = [
    ...validateMetricSampleCounts(fixtures),
    ...validateMetricShapes(fixtures),
    ...Object.entries(FROZEN_PERFORMANCE_BUDGETS).flatMap(([key, budget]) =>
      observed[key] > budget
        ? [`${key} ${observed[key]} > frozen budget ${budget}`]
        : []),
    ...Object.entries(HARD_SAFETY_CAPS).flatMap(([key, cap]) =>
      observed[key] > cap ? [`${key} ${observed[key]} > hard cap ${cap}`] : []),
  ];
  if (correctness.unexpectedResetCount !== 0) {
    errors.push("unexpected materializer reset observed");
  }
  for (const [name, expected] of Object.entries(EXPECTED_CORRECTNESS)) {
    if (correctness[name] !== expected) {
      errors.push(
        `materializer correctness ${name} ${correctness[name]} !== ${expected}`,
      );
    }
  }
  return errors;
}

function observedPerformanceMetrics(fixtures) {
  return {
    projectionWallP95Ms: maxMetric(fixtures, "projectionWallMs", "p95"),
    projectionCpuP95Ms: maxMetric(fixtures, "projectionCpuMs", "p95"),
    boundedReadP95Ms: maxMetric(fixtures, "boundedReadMs", "p95"),
    ambientPublicationP95Ms:
      maxMetric(fixtures, "ambientPublicationMs", "p95"),
    protectedPublicationP95Ms:
      maxMetric(fixtures, "protectedPublicationMs", "p95"),
    replayP95Ms: maxMetric(fixtures, "replayMs", "p95"),
    retainedHeapBytesMax: maxMetric(fixtures, "retainedHeapBytes", "max"),
    snapshotBytesMax: maxMetric(fixtures, "snapshotBytes", "max"),
    ringBytesMax: maxMetric(fixtures, "ringBytes", "max"),
    unexpectedResetRateMax:
      maxMetric(fixtures, "unexpectedResetRate", "max"),
  };
}

function validateStoredPerformance(stored, current) {
  const errors = [];
  if (
    stored.schemaVersion !== 1
    || stored.kind !== "conversation-disclosure-performance-baseline"
    || stored.programId !== PROGRAM_ID
    || stored.featureId !== FEATURE_ID
  ) {
    errors.push("stored performance artifact identity is invalid");
  }
  if (stored.provenance?.sourceDigest !== current.provenance.sourceDigest
    || stored.provenance?.fixtureDigest !== current.provenance.fixtureDigest
    || stored.provenance?.runnerDigest !== current.provenance.runnerDigest) {
    errors.push("stored performance artifact provenance is stale");
  }
  const { digest, ...withoutDigest } = stored;
  if (digest !== hashCanonical(withoutDigest)) {
    errors.push("stored performance artifact digest is stale");
  }
  if (
    canonicalJson(Object.keys(stored.budgets ?? {}).sort())
      !== canonicalJson(PERFORMANCE_BUDGET_KEYS)
  ) {
    errors.push("stored performance budget set is incomplete");
  }
  if (
    canonicalJson(stored.budgets)
      !== canonicalJson(FROZEN_PERFORMANCE_BUDGETS)
  ) {
    errors.push("stored performance budgets differ from the reviewed freeze");
  }
  if (
    canonicalJson(stored.hardSafetyCaps)
      !== canonicalJson(HARD_SAFETY_CAPS)
  ) {
    errors.push("stored performance hard safety caps are stale");
  }
  if (stored.accepted !== true) {
    errors.push("stored performance artifact is not accepted");
  }
  errors.push(...validateMetricSampleCounts(stored.fixtures ?? []));
  errors.push(...validateMetricShapes(stored.fixtures ?? []));
  errors.push(...validateStoredMeasurementAgreement(
    stored.fixtures ?? [],
    current.fixtures,
  ));
  if (canonicalJson(stored.correctness) !== canonicalJson(current.correctness)) {
    errors.push("stored performance correctness differs from the fresh run");
  }
  const observed = observedPerformanceMetrics(current.fixtures);
  const storedObserved = observedPerformanceMetrics(stored.fixtures ?? []);
  for (const name of PERFORMANCE_BUDGET_KEYS) {
    const budget = stored.budgets?.[name];
    const actual = observed[name];
    if (
      typeof budget !== "number"
      || !Number.isFinite(budget)
      || typeof actual !== "number"
      || actual > budget
    ) {
      errors.push(`${name} ${actual} exceeds frozen budget ${budget}`);
    }
    if (
      typeof storedObserved[name] !== "number"
      || storedObserved[name] > budget
    ) {
      errors.push(
        `stored ${name} ${storedObserved[name]} exceeds frozen budget ${budget}`,
      );
    }
  }
  if (!current.accepted) errors.push(...current.safetyErrors);
  return errors;
}

function validateMetricSampleCounts(fixtures) {
  return fixtures.flatMap((fixture) =>
    Object.entries(RAW_SAMPLE_COUNTS).flatMap(([metricName, expected]) => {
      const metric = fixture.metrics?.[metricName];
      return metric && metric.samples !== expected
        ? [
            `${fixture.id}.${metricName} has ${metric.samples} samples; `
              + `expected ${expected}`,
          ]
        : [];
    }));
}

function validateMetricShapes(fixtures) {
  return fixtures.flatMap((fixture) =>
    Object.entries(fixture.metrics ?? {}).flatMap(([metricName, metric]) => {
      const values = [
        metric?.samples,
        metric?.p50,
        metric?.p95,
        metric?.max,
        metric?.mad,
      ];
      if (
        values.some((value) =>
          typeof value !== "number"
          || !Number.isFinite(value)
          || value < 0)
        || !Number.isSafeInteger(metric.samples)
        || metric.samples < 1
        || metric.p50 > metric.p95
        || metric.p95 > metric.max
      ) {
        return [`${fixture.id}.${metricName} has invalid metric statistics`];
      }
      if (
        RAW_SAMPLE_COUNTS[metricName]
        && metricName !== "unexpectedResetRate"
        && metric.max === 0
      ) {
        return [`${fixture.id}.${metricName} unexpectedly reports zero work`];
      }
      return [];
    }));
}

function validateStoredMeasurementAgreement(storedFixtures, currentFixtures) {
  const currentById = new Map(
    currentFixtures.map((fixture) => [fixture.id, fixture]),
  );
  const errors = [];
  if (
    canonicalJson(storedFixtures.map((fixture) => fixture.id).sort())
      !== canonicalJson(currentFixtures.map((fixture) => fixture.id).sort())
  ) {
    errors.push("stored performance fixture set differs from the fresh run");
    return errors;
  }
  for (const stored of storedFixtures) {
    const current = currentById.get(stored.id);
    if (!current) continue;
    if (
      canonicalJson(Object.keys(stored.metrics ?? {}).sort())
        !== canonicalJson(Object.keys(current.metrics ?? {}).sort())
    ) {
      errors.push(`${stored.id} metric set differs from the fresh run`);
      continue;
    }
    for (const [metricName, storedMetric] of Object.entries(stored.metrics)) {
      const currentMetric = current.metrics[metricName];
      if (DETERMINISTIC_METRICS.has(metricName)) {
        if (canonicalJson(storedMetric) !== canonicalJson(currentMetric)) {
          errors.push(`${stored.id}.${metricName} differs from the fresh run`);
        }
        continue;
      }
      for (const statistic of ["p50", "p95", "max"]) {
        const storedValue = storedMetric[statistic];
        const currentValue = currentMetric[statistic];
        if (
          storedValue <= 0
          || currentValue <= 0
          || storedValue > currentValue * REPRODUCIBILITY_FACTOR
          || currentValue > storedValue * REPRODUCIBILITY_FACTOR
        ) {
          errors.push(
            `${stored.id}.${metricName}.${statistic} is not reproducible`,
          );
        }
      }
    }
  }
  return errors;
}

function validateStoredParity(modules, stored, current) {
  const errors = modules.shadow.validateConversationShadowParityArtifact(stored);
  if (
    stored.sourceDigest !== current.sourceDigest
    || stored.fixtureDigest !== current.fixtureDigest
  ) {
    errors.push("stored shadow parity provenance is stale");
  }
  if (!stored.accepted) errors.push("stored shadow parity is not accepted");
  if (
    canonicalJson(stored.scopes) !== canonicalJson(current.scopes)
    || canonicalJson(stored.totals) !== canonicalJson(current.totals)
    || canonicalJson(stored.integrationProof)
      !== canonicalJson(current.integrationProof)
    || stored.accepted !== current.accepted
  ) {
    errors.push("stored shadow parity differs from current deterministic fixture");
  }
  return errors;
}

function verifyOrWriteArtifact(filePath, artifact, update, validateStored) {
  if (!existsSync(filePath) && !update) {
    fail(
      `${path.relative(ROOT, filePath)} is absent; `
        + "artifact creation requires explicit --update",
    );
  }
  if (!update) {
    const stored = JSON.parse(readFileSync(filePath, "utf8"));
    const errors = validateStored(stored);
    if (errors.length > 0) {
      fail(`${path.relative(ROOT, filePath)}: ${errors.join("; ")}`);
    }
    return stored;
  }
  atomicWriteJson(filePath, artifact);
  return artifact;
}

function atomicWriteJson(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}`;
  rmSync(temporary, { force: true });
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  chmodSync(temporary, 0o600);
  renameSync(temporary, filePath);
}

function measureRepeated(operation) {
  for (let index = 0; index < INTERNAL_WARMUPS; index += 1) operation();
  const wall = [];
  const cpu = [];
  let value;
  for (let index = 0; index < INTERNAL_SAMPLES; index += 1) {
    const startedCpu = process.cpuUsage();
    const started = performance.now();
    value = operation();
    wall.push(performance.now() - started);
    const used = process.cpuUsage(startedCpu);
    cpu.push((used.user + used.system) / 1_000);
  }
  return {
    value,
    wallMs: wall,
    cpuMs: cpu,
  };
}

async function measureAsyncRepeated(operation) {
  for (let index = 0; index < INTERNAL_WARMUPS; index += 1) {
    await operation();
  }
  const wall = [];
  let value;
  for (let index = 0; index < INTERNAL_SAMPLES; index += 1) {
    const started = performance.now();
    value = await operation();
    wall.push(performance.now() - started);
  }
  return { value, wallMs: wall };
}

async function measureAsync(operation) {
  const started = performance.now();
  const value = await operation();
  return { value, wallMs: performance.now() - started };
}

function measureRetainedHeap(operation) {
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const retained = operation();
  global.gc?.();
  const after = process.memoryUsage().heapUsed;
  void retained;
  return Math.max(0, after - before);
}

function stats(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) {
    return { samples: 0, p50: 0, p95: 0, max: 0, mad: 0 };
  }
  const p50 = percentile(finite, 50);
  return {
    samples: finite.length,
    p50: round(p50),
    p95: round(percentile(finite, 95)),
    max: round(finite.at(-1)),
    mad: round(percentile(
      finite.map((value) => Math.abs(value - p50)),
      50,
    )),
  };
}

function percentile(values, value) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((value / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function maxMetric(fixtures, metricName, statistic) {
  return Math.max(
    0,
    ...fixtures.flatMap((fixture) =>
      fixture.metrics[metricName]
        ? [fixture.metrics[metricName][statistic]]
        : []),
  );
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}

function digestFiles(paths) {
  return hashCanonical(paths.map((relativePath) => ({
    path: relativePath,
    digest: digestFile(relativePath),
  })));
}

function digestFile(relativePath) {
  return `sha256:${createHash("sha256")
    .update(readFileSync(path.join(ROOT, relativePath)))
    .digest("hex")}`;
}

function hashCanonical(value) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("non-finite canonical number");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  fail(`unsupported canonical value: ${typeof value}`);
}

function makeScope(modules, suffix) {
  return modules.disclosure.createConversationDisclosureScope({
    surface: "chat",
    sessionId: `session_${suffix}`,
    queryHash: `query:${suffix}`,
  });
}

function makeRun(index, status, explicitId, sessionId) {
  const id = explicitId ?? `run_${index}`;
  return {
    id,
    taskId: `task_${index}`,
    taskName: `Task ${index}`,
    skillName: "fixture",
    status,
    summary: "",
    events: [],
    ...(sessionId ? { runContext: { sessionId } } : {}),
    executionRevision: 1,
    startedAt: timestamp(1),
    finishedAt: status === "running" ? "" : timestamp(3),
  };
}

function makeChatActivity(index, state, sessionId = "session_fixture") {
  return {
    eventId: `activity_${index}`,
    sequence: index + 1,
    legacy: false,
    event: {
      sessionId,
      requestId: `request_${index}`,
      turnId: `turn_${index}`,
      sequence: index + 1,
      state,
      message: `Activity ${index}`,
      createdAt: timestamp(index),
      elapsedMs: index,
    },
  };
}

function makeTrajectoryEvent(index, runId = "run-history") {
  return {
    id: `trajectory_${index}`,
    runId,
    sequence: index + 1,
    type: index % 2 === 0 ? "tool_call" : "tool_result",
    payload: {
      toolCallId: `call_${Math.floor(index / 2)}`,
      publicationKey: `publication_${index}`,
    },
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    createdAt: timestamp(index),
  };
}

function makeUnknown(scope) {
  return {
    schemaVersion: 2,
    originalKind: "future_optional",
    authorityRef: "future_1",
    scope,
    domainStatus: "future",
    requiredness: "optional",
    durability: "durable",
    sensitivity: "technical",
    occurredAt: timestamp(1),
    semanticSlot: "future",
    safeSummary: "Future optional evidence",
  };
}

function makeGoal(scope) {
  return {
    id: "goal_full",
    chatSessionId: scope.sessionId,
    description: "fixture goal",
    successCriteria: [],
    milestones: [],
    status: "waiting_for_acceptance",
    executionUsage: {
      iterations: 1,
      toolCalls: 1,
      wallClockMs: 10,
      tokens: 120,
      replans: 0,
    },
    reviewPolicy: "review_final_only",
    planVersion: 1,
    activePlanRef: {
      planId: "plan_full",
      planRevision: 1,
      goalPlanVersion: 1,
      mode: "direct",
      purpose: "initial",
      goalContractRef: {
        id: "contract_full",
        revision: 1,
        sha256: "sha256:fixture",
      },
    },
    createdAt: timestamp(0),
    updatedAt: timestamp(3),
  };
}

function makePlan(scope) {
  return {
    id: "plan_full",
    sessionId: scope.sessionId,
    sourceMessage: "fixture",
    mode: "direct",
    status: "awaiting_confirmation",
    actionGate: "confirmation_required",
    revision: 1,
    taskContract: {},
    evidence: [],
    requestedModelAssignments: {},
    frozenModelAssignments: {},
    rounds: [],
    goalId: "goal_full",
    createdAt: timestamp(0),
    updatedAt: timestamp(2),
  };
}

function makeApproval(scope) {
  return {
    schemaVersion: 1,
    id: "approval_full",
    revision: 1,
    state: "pending",
    requestFingerprint: "fixture",
    taskId: "task_full",
    taskName: "Safe fixture task",
    toolName: "read_file",
    safeArgsSummary: {},
    risk: {
      level: "normal",
      category: "filesystem",
      requiresConfirmation: true,
    },
    causalRef: {
      sessionId: scope.sessionId,
      requestId: "request_full",
      turnId: "turn_full",
    },
    ownerProcessEpoch: "fixture",
    createdAt: timestamp(1),
    updatedAt: timestamp(1),
    expiresAt: timestamp(60),
  };
}

function makeGuidedInputState(scope) {
  return {
    inputRequestId: "input_full",
    status: "pending",
    settlementId: "settlement_guided",
    sessionId: scope.sessionId,
    requestId: "request_full",
    userMessage: "not projected",
    selectedSkillName: "fixture",
    partialValues: {},
  };
}

function timestamp(index) {
  return new Date(Date.UTC(2026, 7, 25, 0, 0, index % 60)).toISOString();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
