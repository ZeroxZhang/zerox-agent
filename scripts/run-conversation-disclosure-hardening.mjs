#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const root = process.cwd();
const execFile = promisify(execFileCallback);
const verificationRoot = path.join(
  root,
  ".zerox/verification/conversation-disclosure",
);
const performance = JSON.parse(await readFile(
  path.join(verificationRoot, "CD04-performance-baseline.json"),
  "utf8",
));
const parity = JSON.parse(await readFile(
  path.join(verificationRoot, "CD04-shadow-parity.json"),
  "utf8",
));
const [chat, inspector, styles, responsiveStyles, runner] = await Promise.all([
  readFile(path.join(root, "src/renderer/components/AgentChatPanel.tsx"), "utf8"),
  readFile(path.join(root, "src/renderer/components/RunTrajectoryPanel.tsx"), "utf8"),
  readFile(path.join(root, "src/renderer/styles/chat.css"), "utf8"),
  readFile(path.join(root, "src/renderer/styles/responsive.css"), "utf8"),
  readFile(path.join(root, "scripts/run-conversation-disclosure-tests-v13.mjs"), "utf8"),
]);
const stressResult = await execFile(
  process.execPath,
  [
    path.join(root, "node_modules/vitest/vitest.mjs"),
    "run",
    "--run",
    "src/main/runtimeStress.test.ts",
    "--maxWorkers=1",
  ],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ZEROX_RUNTIME_STRESS: "1" },
    maxBuffer: 16 * 1024 * 1024,
  },
);
const stressMatch = stressResult.stdout.match(/\[runtime-stress\] (\[[^\n]+\])/);
const runtimeStress = stressMatch ? JSON.parse(stressMatch[1]) : [];
const reducedMotionRule = `${styles}\n${responsiveStyles}`.match(
  /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/,
)?.[1] ?? "";

const checks = [
  check(
    "runtime-stress-6-of-6",
    runtimeStress.length === 6
      && runtimeStress.every((entry) =>
        typeof entry.elapsedMs === "number" && entry.elapsedMs < 10_000),
  ),
  check("five-process-performance", performance.provenance?.processSamples === 5),
  check("no-unexpected-reset", performance.correctness?.unexpectedResetCount === 0),
  check("protected-terminal-retention", performance.correctness?.protectedTerminalCount === 50),
  check("full-ring-metric", performance.correctness?.retainedRingEntryCount === 150),
  check("production-container-parity", parity.integrationProof?.status === "passed"),
  check("legacy-default-off", chat.includes('?? resolvePreviewConversationDisclosureMode')),
  check("stable-expansion", chat.includes("resolveChatDisclosureExpanded")),
  check("inspector-selection-reload", inspector.includes("readPersistedEvidenceSelection")),
  check("unknown-presenter-fallback", inspector.includes("其他证据")),
  check("secret-redaction", inspector.includes("redactCredentials")),
  check("bounded-preview", inspector.includes("value.slice(0, 16_384)")),
  check("bounded-paging", inspector.includes("current + 50")),
  check(
    "reduced-motion-contract",
    reducedMotionRule.includes("animation-duration: 0.01ms !important")
      && reducedMotionRule.includes("animation-iteration-count: 1 !important")
      && reducedMotionRule.includes("transition-duration: 0.01ms !important"),
  ),
  check("historical-reconstruction", runner.includes("postRound12FeatureIds")),
];
const accepted = checks.every((entry) => entry.passed);
const artifact = {
  schemaVersion: 1,
  kind: "cd08-disclosure-hardening",
  status: accepted ? "passed" : "failed",
  accepted,
  performanceDigest: performance.digest,
  parityDigest: parity.digest,
  runtimeStress,
  checks,
};
await writeFile(
  path.join(verificationRoot, "CD08-hardening.json"),
  `${JSON.stringify(artifact, null, 2)}\n`,
);
await writeFile(
  path.join(verificationRoot, "CD08-full-gates.md"),
  [
    "# CD08 Full Gates",
    "",
    `Status: ${accepted ? "PASS" : "FAIL"}`,
    "",
    ...checks.map((entry) => `- [${entry.passed ? "x" : " "}] ${entry.id}`),
    "",
  ].join("\n"),
);
console.log(JSON.stringify(artifact, null, 2));
if (!accepted) process.exitCode = 1;

function check(id, passed) {
  return { id, passed: Boolean(passed) };
}
