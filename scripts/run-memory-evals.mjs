#!/usr/bin/env node

const [{ createMemoryEvalFixtures, runMemoryEvals }] = await Promise.all([
  import("../dist-electron/shared/memoryEval.js"),
]);

const report = runMemoryEvals(...createMemoryEvalFixtures());
console.log(JSON.stringify(report, null, 2));

if (report.failed > 0) {
  process.exitCode = 1;
}
