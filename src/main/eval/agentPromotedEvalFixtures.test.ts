import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPromotedAgentEvalFixtureStore } from "./agentPromotedEvalFixtures";
import type { AgentEvalFixture } from "./agentEvalFixtures";

describe("promoted agent eval fixture store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(
      path.join(os.tmpdir(), "building-agent-promoted-fixtures-"),
    );
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("upserts and replaces promoted fixtures by fixture id", async () => {
    const store = createPromotedAgentEvalFixtureStore({ configDir });
    const first = createFixture("episode-run-1", "First description");
    const replacement = createFixture(
      "episode-run-1",
      "Replacement description",
    );

    await expect(store.list()).resolves.toEqual([]);
    await expect(store.upsert(first)).resolves.toEqual(first);
    await expect(store.upsert(replacement)).resolves.toEqual(replacement);

    await expect(store.list()).resolves.toEqual([replacement]);
    const raw = await readFile(
      path.join(configDir, "agent-promoted-eval-fixtures.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toEqual({
      schemaVersion: 1,
      fixtures: [replacement],
    });
  });
});

function createFixture(id: string, description: string): AgentEvalFixture {
  return {
    id,
    description,
    events: [
      {
        id: `${id}_summary`,
        runId: "run_1",
        type: "final_summary",
        sequence: 1,
        payload: { summary: description },
        redaction: {
          containsApiKey: false,
          containsFileContent: false,
          containsUserText: false,
        },
        createdAt: "2026-06-10T00:00:00.000Z",
      },
    ],
    requiredEventTypes: ["final_summary"],
  };
}
