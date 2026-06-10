import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentEvalFixture } from "./agentEvalFixtures";

type StoredPromotedAgentEvalFixtures = {
  schemaVersion: 1;
  fixtures: AgentEvalFixture[];
};

export type PromotedAgentEvalFixtureStore = {
  list(): Promise<AgentEvalFixture[]>;
  upsert(fixture: AgentEvalFixture): Promise<AgentEvalFixture>;
};

export function createCombinedAgentEvalFixtures(
  builtIn: AgentEvalFixture[],
  promoted: AgentEvalFixture[],
): AgentEvalFixture[] {
  const builtInIds = new Set(builtIn.map((fixture) => fixture.id));
  const promotedOnly = promoted.filter((fixture) => !builtInIds.has(fixture.id));

  return [...builtIn, ...promotedOnly];
}

export function createPromotedAgentEvalFixtureStore(options: {
  configDir: string;
}): PromotedAgentEvalFixtureStore {
  const fixturesPath = path.join(
    options.configDir,
    "agent-promoted-eval-fixtures.json",
  );

  async function readStored(): Promise<StoredPromotedAgentEvalFixtures> {
    try {
      const raw = await readFile(fixturesPath, "utf8");
      const stored = JSON.parse(raw) as Partial<StoredPromotedAgentEvalFixtures>;
      if (stored.schemaVersion !== 1 || !Array.isArray(stored.fixtures)) {
        throw new Error("Malformed promoted agent eval fixture store.");
      }

      return {
        schemaVersion: 1,
        fixtures: stored.fixtures,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, fixtures: [] };
      }

      throw error;
    }
  }

  async function writeStored(stored: StoredPromotedAgentEvalFixtures) {
    await mkdir(options.configDir, { recursive: true });
    await writeFile(fixturesPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
    });
  }

  return {
    async list() {
      const stored = await readStored();
      return stored.fixtures;
    },

    async upsert(fixture) {
      const stored = await readStored();
      const existingIndex = stored.fixtures.findIndex(
        (item) => item.id === fixture.id,
      );
      const fixtures =
        existingIndex === -1
          ? [...stored.fixtures, fixture]
          : stored.fixtures.map((item, index) =>
              index === existingIndex ? fixture : item,
            );

      await writeStored({ schemaVersion: 1, fixtures });
      return fixture;
    },
  };
}
