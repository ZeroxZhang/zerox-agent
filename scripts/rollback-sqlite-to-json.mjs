#!/usr/bin/env node
// Export only SQLite-authoritative domains to legacy JSON. Every artifact is
// staged before any live path changes. A failed commit restores all previous
// paths in reverse order and records compensation evidence.
//
//   node scripts/rollback-sqlite-to-json.mjs \
//     --configDir <path> --confirmSqliteAuthoritative \
//     [--planBackend sqlite]

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const configDir = args.configDir;
if (!configDir) {
  console.error(
    "usage: node scripts/rollback-sqlite-to-json.mjs --configDir <path> --confirmSqliteAuthoritative [--planBackend sqlite]",
  );
  process.exit(2);
}
if (args.confirmSqliteAuthoritative !== true) {
  console.error(
    "refusing rollback export: pass --confirmSqliteAuthoritative only after verifying the per-domain SQLite authority matrix",
  );
  process.exit(2);
}
if (
  args.planBackend !== undefined &&
  args.planBackend !== "json" &&
  args.planBackend !== "sqlite"
) {
  console.error("--planBackend must be json or sqlite");
  process.exit(2);
}
const exportPlan = args.planBackend === "sqlite";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const { createStorageImpl } = await import(
  path.join(root, "dist-electron/main/storage/storageDb.js")
);
const runsRepo = await import(
  path.join(root, "dist-electron/main/storage/repositories/runRepository.js")
);
const repos = await import(
  path.join(root, "dist-electron/main/storage/repositories/index.js")
);
const sessRepo = await import(
  path.join(root, "dist-electron/main/storage/repositories/sessionRepository.js")
);
const chatRepo = await import(
  path.join(
    root,
    "dist-electron/main/storage/repositories/chatSessionEventRepository.js",
  )
);
const skillSnapshots = await import(
  path.join(root, "dist-electron/shared/skills.js")
);

const dbPath = path.join(configDir, "zerox.db");
if (!existsSync(dbPath)) {
  console.error(`no zerox.db at ${dbPath}; nothing to roll back.`);
  process.exit(0);
}

mkdirSync(configDir, { recursive: true });
const stagingRoot = path.join(
  configDir,
  `.zerox-rollback-staging-${process.pid}-${randomUUID()}`,
);
mkdirSync(stagingRoot, { recursive: true });

const stagedArtifacts = [];
const stagedDirectoryRoots = [];
const counts = {};

function stageFile(relativePath, content) {
  const destination = path.join(stagingRoot, relativePath);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, content, { encoding: "utf8", mode: 0o600 });
  if (
    !stagedDirectoryRoots.some(
      (rootPath) =>
        relativePath === rootPath ||
        relativePath.startsWith(`${rootPath}${path.sep}`),
    )
  ) {
    stagedArtifacts.push({ relativePath, kind: "file" });
  }
}

function stageDirectory(relativePath) {
  mkdirSync(path.join(stagingRoot, relativePath), {
    recursive: true,
    mode: 0o700,
  });
  stagedDirectoryRoots.push(relativePath);
  stagedArtifacts.push({ relativePath, kind: "directory" });
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonl(rows) {
  return rows.length
    ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`
    : "";
}

function assertSafeFileId(id, label) {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) {
    throw new Error(`unsafe ${label} id in SQLite: ${id}`);
  }
}

let storage;
try {
  storage = createStorageImpl({ dbPath });
  await storage.migrate();
  const db = storage.db;
  const runRepository = runsRepo.createRunRepository(storage);

  // Runs.
  const runs = runRepository.list({ limit: Number.MAX_SAFE_INTEGER });
  stageFile("agent-runs.jsonl", jsonl(runs));
  counts.runs = runs.length;

  // Trajectory events, including groups with no run row.
  stageDirectory("agent-trajectories");
  const trajectoryRows = db
    .prepare(
      `SELECT run_id, payload
         FROM trajectory_events
        ORDER BY run_id ASC, seq ASC, created_at ASC, rowid ASC`,
    )
    .all();
  const trajectories = new Map();
  for (const row of trajectoryRows) {
    const group = trajectories.get(row.run_id) ?? [];
    group.push(JSON.parse(row.payload));
    trajectories.set(row.run_id, group);
  }
  for (const [runId, events] of trajectories) {
    assertSafeFileId(runId, "run");
    stageFile(
      path.join("agent-trajectories", `${runId}.jsonl`),
      jsonl(events),
    );
  }
  counts.trajectory_events = trajectoryRows.length;

  // Chat event projections plus pre-RC05 compatibility rows.
  const repository = chatRepo.createChatSessionEventRepository(storage);
  const projected = repository
    .listProjections()
    .map((projection) => repository.getSession(projection.session.id))
    .filter(Boolean);
  const projectedIds = new Set(projected.map((session) => session.id));
  const legacy = sessRepo
    .createSessionRepository(storage)
    .listSessions({ kind: "chat" })
    .filter((session) => !projectedIds.has(session.id))
    .map((session) => {
      const payload = session.payload ?? {};
      const messages = db
        .prepare(
          `SELECT payload
             FROM chat_messages
            WHERE session_id = ?
            ORDER BY COALESCE(seq, 9223372036854775807) ASC,
                     created_at ASC, rowid ASC`,
        )
        .all(session.id)
        .map((row) => JSON.parse(row.payload));
      return {
        ...payload,
        id: payload.id ?? session.id,
        messages: messages.length ? messages : (payload.messages ?? []),
      };
    });
  const chatSessions = [...projected, ...legacy];
  stageFile(
    "chat-sessions.json",
    json({ schemaVersion: 1, sessions: chatSessions }),
  );
  counts.sessions = chatSessions.length;

  // Scheduled Tasks.
  const tasks = repos.createTaskRepository(storage).list();
  stageFile(
    "scheduled-tasks.json",
    json({ schemaVersion: 1, tasks }),
  );
  counts.tasks = tasks.length;

  // Memory Profile.
  const profile = repos.createMemoryProfileRepository(storage).read();
  stageFile("memory-persona.md", profile.content ?? "");
  counts.memory_profile = profile.content ? 1 : 0;

  // Tool authorization audit.
  const auditRows = db
    .prepare(
      "SELECT payload FROM tool_audit ORDER BY created_at ASC, rowid ASC",
    )
    .all()
    .map((row) => JSON.parse(row.payload));
  stageFile("tool-audit.jsonl", jsonl(auditRows));
  counts.tool_audit = auditRows.length;

  // Validation snapshot.
  const validation = repos.createValidationRepository(storage).load();
  stageFile(
    "agent-validation.json",
    json({ schemaVersion: 1, latest: validation ?? null }),
  );
  counts.validation_snapshots = validation ? 1 : 0;

  // Plan is SQLite-authoritative only when the caller confirms that mode.
  if (exportPlan) {
    stageDirectory("plans");
    const planRows = db
      .prepare(
        "SELECT id, session_id, payload, updated_at FROM plan_records ORDER BY updated_at DESC, id ASC",
      )
      .all();
    const sessionIndex = { version: 1, sessions: {} };
    for (const row of planRows) {
      assertSafeFileId(row.id, "Plan");
      const rawPlan = JSON.parse(row.payload);
      const plan = rawPlan.selectedSkill
        ? {
            ...rawPlan,
            selectedSkill: skillSnapshots.createPublicSkillSnapshot(
              rawPlan.selectedSkill,
            ),
          }
        : rawPlan;
      stageFile(path.join("plans", `${row.id}.json`), json(plan));
      if (!sessionIndex.sessions[row.session_id]) {
        sessionIndex.sessions[row.session_id] = {
          planId: row.id,
          updatedAt: row.updated_at,
        };
      }
    }
    const eventRows = db
      .prepare(
        `SELECT id, plan_id, type, revision, payload, created_at
           FROM plan_events
          ORDER BY plan_id ASC, revision ASC, created_at ASC, rowid ASC`,
      )
      .all();
    const eventsByPlan = new Map();
    for (const row of eventRows) {
      assertSafeFileId(row.plan_id, "Plan");
      const events = eventsByPlan.get(row.plan_id) ?? [];
      events.push({
        id: row.id,
        planId: row.plan_id,
        type: row.type,
        revision: row.revision,
        ...(row.payload ? { payload: JSON.parse(row.payload) } : {}),
        createdAt: row.created_at,
      });
      eventsByPlan.set(row.plan_id, events);
    }
    for (const [planId, events] of eventsByPlan) {
      stageFile(
        path.join("plans", `${planId}.events.jsonl`),
        jsonl(events),
      );
    }
    stageFile(
      path.join("plans", "session-index.json"),
      json(sessionIndex),
    );
    counts.plan_records = planRows.length;
    counts.plan_events = eventRows.length;
  }
} catch (error) {
  storage?.close();
  rmSync(stagingRoot, { recursive: true, force: true });
  throw error;
}
storage.close();

function nextBackupPath(target) {
  const parsed = path.parse(target);
  const base = parsed.ext
    ? path.join(parsed.dir, `${parsed.name}.legacy${parsed.ext}`)
    : `${target}.legacy`;
  let candidate = base;
  let suffix = 1;
  while (existsSync(candidate)) {
    candidate = `${base}.${suffix++}`;
  }
  return candidate;
}

function recoveryEvidencePath() {
  return path.join(
    configDir,
    `rollback-recovery-${Date.now()}-${randomUUID()}.json`,
  );
}

const committed = [];
const backups = [];
const testFailAfter =
  process.env.NODE_ENV === "test"
    ? Number.parseInt(
        process.env.ZEROX_ROLLBACK_TEST_FAIL_AFTER_PUBLISH ?? "",
        10,
      )
    : Number.NaN;

try {
  for (const artifact of stagedArtifacts) {
    const stagedPath = path.join(stagingRoot, artifact.relativePath);
    const targetPath = path.join(configDir, artifact.relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    let backupPath = null;
    if (existsSync(targetPath)) {
      backupPath = nextBackupPath(targetPath);
      renameSync(targetPath, backupPath);
      backups.push(backupPath);
    }
    try {
      renameSync(stagedPath, targetPath);
    } catch (error) {
      if (backupPath && existsSync(backupPath)) {
        renameSync(backupPath, targetPath);
      }
      throw error;
    }
    committed.push({
      ...artifact,
      targetPath,
      backupPath,
    });
    if (
      Number.isFinite(testFailAfter) &&
      committed.length >= testFailAfter
    ) {
      throw new Error(
        `injected rollback commit failure after ${committed.length} artifacts`,
      );
    }
  }
} catch (commitError) {
  const compensation = [];
  for (const artifact of [...committed].reverse()) {
    try {
      const recoveredPath = path.join(
        stagingRoot,
        "published-before-failure",
        artifact.relativePath,
      );
      mkdirSync(path.dirname(recoveredPath), { recursive: true });
      if (existsSync(artifact.targetPath)) {
        renameSync(artifact.targetPath, recoveredPath);
      }
      if (artifact.backupPath && existsSync(artifact.backupPath)) {
        renameSync(artifact.backupPath, artifact.targetPath);
      }
      compensation.push({
        relativePath: artifact.relativePath,
        restored: Boolean(artifact.backupPath),
        removedNewPath: true,
      });
    } catch (error) {
      compensation.push({
        relativePath: artifact.relativePath,
        restored: false,
        error: String(error),
      });
    }
  }
  const evidencePath = recoveryEvidencePath();
  writeFileSync(
    evidencePath,
    json({
      schemaVersion: 1,
      failedAt: new Date().toISOString(),
      error: String(commitError),
      stagingRoot,
      compensation,
    }),
    { encoding: "utf8", mode: 0o600 },
  );
  const compensationFailed = compensation.some((item) => item.error);
  throw new Error(
    `rollback commit failed and compensation ${compensationFailed ? "was incomplete" : "completed"}; evidence: ${evidencePath}; cause: ${String(commitError)}`,
  );
}

rmSync(stagingRoot, { recursive: true, force: true });
console.log(
  JSON.stringify(
    {
      rolledBack: counts,
      authority: [
        "chat",
        "run",
        "trajectory",
        "task",
        "validation",
        "memory_profile",
        "tool_audit",
        ...(exportPlan ? ["plan_sqlite_mode"] : []),
      ],
      backups,
    },
    null,
    2,
  ),
);

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      out[key] = argv[++index];
    } else {
      out[key] = true;
    }
  }
  return out;
}
