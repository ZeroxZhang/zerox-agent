import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCombinedAgentEvalFixtures,
  createPromotedAgentEvalFixtureStore,
} from "./agentPromotedEvalFixtures";
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

  it("serializes concurrent upserts without dropping promoted fixtures", async () => {
    const store = createPromotedAgentEvalFixtureStore({ configDir });
    const first = createFixture("episode-run-1", "First description");
    const second = createFixture("episode-run-2", "Second description");

    await Promise.all([store.upsert(first), store.upsert(second)]);

    const stored = await store.list();
    expect(stored.map((fixture) => fixture.id).sort()).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("appends promoted-only fixtures after built-in fixtures", () => {
    const builtIn = [
      createFixture("built-in-1", "Built-in 1"),
      createFixture("built-in-2", "Built-in 2"),
    ];
    const promoted = [
      createFixture("promoted-1", "Promoted 1"),
      createFixture("promoted-2", "Promoted 2"),
    ];

    const combined = createCombinedAgentEvalFixtures(builtIn, promoted);

    expect(combined.map((fixture) => fixture.id)).toEqual([
      "built-in-1",
      "built-in-2",
      "promoted-1",
      "promoted-2",
    ]);
  });

  it("keeps built-in duplicate ids and skips promoted replacements", () => {
    const builtIn = [
      createFixture("built-in-1", "Built-in 1"),
      createFixture("duplicate-id", "Built-in duplicate"),
      createFixture("built-in-2", "Built-in 2"),
    ];
    const replacement = createFixture("duplicate-id", "Promoted duplicate");
    const promoted = [
      replacement,
      createFixture("promoted-only", "Promoted only"),
    ];

    const combined = createCombinedAgentEvalFixtures(builtIn, promoted);

    expect(combined).toEqual([
      builtIn[0],
      builtIn[1],
      builtIn[2],
      promoted[1],
    ]);
    expect(combined).not.toContain(replacement);
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
