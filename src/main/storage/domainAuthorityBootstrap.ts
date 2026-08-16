import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Goal, ProgressLedgerEvent } from "../../shared/agentGoal";
import type { AgentExecutionCheckpoint } from "../../shared/agentExecution";
import type { AgentWorkspace, MultiAgentSession } from "../../shared/agentWorkspace";
import type { AgentLearningCandidate } from "../../shared/agentLearning";
import type { AgentEvalCandidate } from "../../shared/agentEvalCandidate";
import type { MemoryRecord } from "../../shared/memory";
import type { Storage } from "../../shared/storageContract";
import { createAgentExecutionStore } from "../agentExecutionStore";
import { createAgentGoalStore } from "../agentGoalStore";
import type { AgentEvalFixture } from "../eval/agentEvalFixtures";
import { createMemoryRepository } from "./repositories/memoryRepository";
import { createSessionRepository } from "./repositories/sessionRepository";
import {
  createEvalCandidateRepository,
  createLearningRepository,
  createPromotedEvalFixtureRepository,
  createWorkspaceRepository,
} from "./repositories";

const targetDomains = [
  "goal",
  "execution_checkpoint",
  "memory",
  "workspace",
  "multi_agent_session",
  "learning_candidate",
  "eval_candidate",
  "promoted_eval_fixture",
] as const;

type TargetDomain = (typeof targetDomains)[number];

export type DomainAuthorityBootstrapResult = {
  imported: TargetDomain[];
  existing: TargetDomain[];
};

export async function bootstrapSqliteDomainAuthority(options: {
  configDir: string;
  storage: Storage;
  now?: () => Date;
}): Promise<DomainAuthorityBootstrapResult> {
  const now = options.now ?? (() => new Date());
  const imported: TargetDomain[] = [];
  const existing: TargetDomain[] = [];

  async function bootstrap(
    domain: TargetDomain,
    sourceExists: boolean,
    readAuthority: () => Map<string, unknown>,
    importSource: () => Promise<void>,
  ): Promise<void> {
    const marked = options.storage.db
      .prepare(
        "SELECT source FROM domain_authority_state WHERE domain = ?",
      )
      .get<{ source: string }>(domain);
    const jsonRollbackAuthority = marked?.source === "json_rollback";
    if (marked && !jsonRollbackAuthority) {
      existing.push(domain);
      return;
    }
    if (sourceExists || jsonRollbackAuthority) {
      options.storage.db.exec("BEGIN IMMEDIATE");
      try {
        const existingAuthority = readAuthority();
        await importSource();
        if (!jsonRollbackAuthority) {
          assertSafeAuthorityReplacement(
            domain,
            existingAuthority,
            readAuthority(),
          );
        }
        options.storage.db
          .prepare(
            `INSERT INTO domain_authority_state (domain, source, imported_at)
             VALUES (?, ?, ?)
             ON CONFLICT(domain) DO UPDATE SET
               source = excluded.source,
               imported_at = excluded.imported_at`,
          )
          .run(
            domain,
            jsonRollbackAuthority ? "json_rollback_import" : "legacy_json",
            now().toISOString(),
          );
        options.storage.db.exec("COMMIT");
        imported.push(domain);
      } catch (error) {
        try {
          options.storage.db.exec("ROLLBACK");
        } catch {
          // Preserve the original import failure if SQLite already rolled back.
        }
        throw error;
      }
    } else {
      existing.push(domain);
      options.storage.db
        .prepare(
          `INSERT INTO domain_authority_state (domain, source, imported_at)
           VALUES (?, 'existing_sqlite', ?)`,
        )
        .run(domain, now().toISOString());
    }
  }

  const goalsDir = path.join(options.configDir, "agent-goals");
  const goalFiles = await listFiles(goalsDir, (name) =>
    name.endsWith(".json"),
  );
  const ledgerFiles = await listFiles(goalsDir, (name) =>
    name.endsWith(".ledger.jsonl"),
  );
  await bootstrap(
    "goal",
    goalFiles.length > 0 || ledgerFiles.length > 0,
    () =>
      readPayloadSnapshot(
        options.storage,
        `SELECT 'goal:' || id AS identity, payload FROM goals
         UNION ALL
         SELECT 'ledger:' || goal_id || ':' || seq AS identity, payload
           FROM goal_ledger`,
      ),
    async () => {
      options.storage.db.exec(
        "DELETE FROM goal_ledger; DELETE FROM goal_ledger_sequences; DELETE FROM goals;",
      );
      const store = createAgentGoalStore({
        configDir: options.configDir,
        backend: "sqlite",
        storage: options.storage,
      });
      for (const filename of goalFiles) {
        const goal = await readJsonFile<Goal>(path.join(goalsDir, filename));
        if (goal.id !== filename.replace(/\.json$/, "")) {
          throw new Error(`Goal bootstrap identity mismatch: ${filename}`);
        }
        await store.save(goal);
      }
      for (const filename of ledgerFiles) {
        const goalId = filename.replace(/\.ledger\.jsonl$/, "");
        const events = await readStrictJsonl<ProgressLedgerEvent>(
          path.join(goalsDir, filename),
        );
        for (const event of events) {
          if (event.publicationKey) {
            await store.appendLedgerIfAbsent(
              goalId,
              event.publicationKey,
              event,
            );
          } else {
            await store.appendLedger(goalId, event);
          }
        }
      }
    },
  );

  const executionsDir = path.join(options.configDir, "agent-executions");
  const executionFiles = await listFiles(
    executionsDir,
    (name) => name.endsWith(".json") && !name.includes(".corrupt-"),
  );
  await bootstrap(
    "execution_checkpoint",
    executionFiles.length > 0,
    () =>
      readPayloadSnapshot(
        options.storage,
        `SELECT current.run_id AS identity, current.payload
           FROM checkpoints current
          WHERE current.kind = 'runtime'
            AND current.rowid = (
              SELECT MAX(candidate.rowid)
                FROM checkpoints candidate
               WHERE candidate.run_id = current.run_id
                 AND candidate.kind = 'runtime'
            )`,
      ),
    async () => {
      options.storage.db
        .prepare("DELETE FROM checkpoints WHERE kind = 'runtime'")
        .run();
      const store = createAgentExecutionStore({
        configDir: options.configDir,
        backend: "sqlite",
        storage: options.storage,
      });
      for (const filename of executionFiles) {
        const checkpoint = await readJsonFile<AgentExecutionCheckpoint>(
          path.join(executionsDir, filename),
        );
        if (checkpoint.runId !== filename.replace(/\.json$/, "")) {
          throw new Error(
            `Execution bootstrap identity mismatch: ${filename}`,
          );
        }
        await store.save(checkpoint);
      }
    },
  );

  const memoryPath = path.join(options.configDir, "memory-records.json");
  await bootstrap(
    "memory",
    await fileExists(memoryPath),
    () =>
      readPayloadSnapshot(
        options.storage,
        "SELECT id AS identity, payload FROM memory_records",
      ),
    async () => {
      const stored = await readJsonFile<{ records?: MemoryRecord[] }>(
        memoryPath,
      );
      createMemoryRepository(options.storage).replaceAll(stored.records ?? []);
    },
  );

  const workspacePath = path.join(options.configDir, "agent-workspaces.json");
  await bootstrap(
    "workspace",
    await fileExists(workspacePath),
    () =>
      readPayloadSnapshot(
        options.storage,
        "SELECT id AS identity, payload FROM workspaces",
      ),
    async () => {
      const stored = await readJsonFile<{ workspaces?: AgentWorkspace[] }>(
        workspacePath,
      );
      options.storage.db.prepare("DELETE FROM workspaces").run();
      const repository = createWorkspaceRepository(options.storage);
      for (const workspace of stored.workspaces ?? []) {
        repository.save(workspace);
      }
    },
  );

  const multiAgentPath = path.join(
    options.configDir,
    "multi-agent-sessions.json",
  );
  await bootstrap(
    "multi_agent_session",
    await fileExists(multiAgentPath),
    () =>
      readPayloadSnapshot(
        options.storage,
        `SELECT id AS identity, payload
           FROM sessions
          WHERE kind = 'multi_agent'`,
      ),
    async () => {
      const stored = await readJsonFile<{ sessions?: MultiAgentSession[] }>(
        multiAgentPath,
      );
      options.storage.db
        .prepare("DELETE FROM sessions WHERE kind = 'multi_agent'")
        .run();
      const repository = createSessionRepository(options.storage);
      for (const session of stored.sessions ?? []) {
        repository.createSession({
          ...session,
          kind: "multi_agent",
          payload: session,
        });
      }
    },
  );

  const learningPath = path.join(
    options.configDir,
    "agent-learning-candidates.json",
  );
  await bootstrap(
    "learning_candidate",
    await fileExists(learningPath),
    () =>
      readPayloadSnapshot(
        options.storage,
        "SELECT id AS identity, payload FROM learning_candidates",
      ),
    async () => {
      const stored = await readJsonFile<{
        candidates?: AgentLearningCandidate[];
      }>(learningPath);
      options.storage.db.prepare("DELETE FROM learning_candidates").run();
      const repository = createLearningRepository(options.storage);
      for (const candidate of stored.candidates ?? []) {
        repository.create(candidate);
      }
    },
  );

  const evalPath = path.join(options.configDir, "agent-eval-candidates.json");
  await bootstrap(
    "eval_candidate",
    await fileExists(evalPath),
    () =>
      readPayloadSnapshot(
        options.storage,
        "SELECT id AS identity, payload FROM eval_candidates",
      ),
    async () => {
      const stored = await readJsonFile<{ candidates?: AgentEvalCandidate[] }>(
        evalPath,
      );
      options.storage.db.prepare("DELETE FROM eval_candidates").run();
      const repository = createEvalCandidateRepository(options.storage);
      for (const candidate of stored.candidates ?? []) {
        repository.create(candidate);
      }
    },
  );

  const fixturesPath = path.join(
    options.configDir,
    "agent-promoted-eval-fixtures.json",
  );
  await bootstrap(
    "promoted_eval_fixture",
    await fileExists(fixturesPath),
    () =>
      readPayloadSnapshot(
        options.storage,
        "SELECT id AS identity, payload FROM promoted_eval_fixtures",
      ),
    async () => {
      const stored = await readJsonFile<{ fixtures?: AgentEvalFixture[] }>(
        fixturesPath,
      );
      options.storage.db
        .prepare("DELETE FROM promoted_eval_fixtures")
        .run();
      const repository = createPromotedEvalFixtureRepository(options.storage);
      for (const [index, fixture] of (stored.fixtures ?? []).entries()) {
        repository.upsert(fixture, {
          createdAt: new Date(index).toISOString(),
        });
      }
    },
  );

  return { imported, existing };
}

function readPayloadSnapshot(
  storage: Storage,
  sql: string,
): Map<string, unknown> {
  const rows = storage.db
    .prepare(sql)
    .all<{ identity: string; payload: string }>();
  return new Map(
    rows.map((row) => [row.identity, JSON.parse(row.payload)]),
  );
}

function assertSafeAuthorityReplacement(
  domain: TargetDomain,
  existing: ReadonlyMap<string, unknown>,
  imported: ReadonlyMap<string, unknown>,
): void {
  for (const [identity, target] of existing) {
    const source = imported.get(identity);
    if (source === undefined) {
      throw new Error(
        `mixed-generation conflict for ${domain} identity ${identity}: ` +
          "SQLite contains a record absent from legacy JSON",
      );
    }
    if (isDeepStrictEqual(source, target)) {
      continue;
    }
    if (identity.startsWith("ledger:")) {
      throw new Error(
        `mixed-generation conflict for ${domain} identity ${identity}: ` +
          "append-only ledger events differ",
      );
    }
    const sourceGeneration = recordGeneration(source);
    const targetGeneration = recordGeneration(target);
    if (
      sourceGeneration === null ||
      targetGeneration === null ||
      targetGeneration >= sourceGeneration
    ) {
      throw new Error(
        `mixed-generation conflict for ${domain} identity ${identity}: ` +
          `legacy=${generationLabel(sourceGeneration)} ` +
          `SQLite=${generationLabel(targetGeneration)}`,
      );
    }
  }
}

function recordGeneration(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const field of ["updatedAt", "at", "createdAt"]) {
    const parsed = Date.parse(String(record[field] ?? ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function generationLabel(value: number | null): string {
  return value === null ? "<none>" : new Date(value).toISOString();
}

async function listFiles(
  directory: string,
  include: (name: string) => boolean,
): Promise<string[]> {
  try {
    return (await readdir(directory))
      .filter(include)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readStrictJsonl<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, "utf8");
  const records: T[] = [];
  for (const [index, line] of raw.split("\n").entries()) {
    if (!line.trim()) {
      continue;
    }
    try {
      records.push(JSON.parse(line) as T);
    } catch (error) {
      throw new Error(
        `JSONL bootstrap parse failed at ${filePath}:${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return records;
}
