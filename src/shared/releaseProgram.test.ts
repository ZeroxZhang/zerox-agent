import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

describe("v3.9.1 release program", () => {
  it("passes the machine-readable release checker", () => {
    expect(
      execFileSync(
        process.execPath,
        [path.join(root, "scripts", "check-release-program.mjs")],
        { cwd: root, encoding: "utf8" },
      ),
    ).toContain("Release program check passed");
  });

  it("starts only after the accepted P102 source baseline", () => {
    const program = readJson(".zerox/release-program.json");
    const features = readJson(".zerox/feature_list.json").features;
    const storageProgram = readJson(
      ".zerox/storage-convergence-program.json",
    );

    expect(program).toMatchObject({
      version: "3.9.1",
      tag: "v3.9.1",
      sourceBaseline: {
        commit: "546129c7681de81c2a200b915ccd0c32ba97930a",
        verifyRun: "31953402750",
      },
    });
    expect(storageProgram).toMatchObject({
      status: "completed",
      activeFeatureId: null,
      activeWorkstreamId: null,
    });
    expect(features).toContainEqual(
      expect.objectContaining({
        id: "P97-sqlite-domain-storage-convergence",
        status: "done",
      }),
    );
    expect(features).toContainEqual(
      expect.objectContaining({
        id: "P102-adaptive-context-orchestration",
        status: "done",
      }),
    );
    expect(features).toContainEqual(
      expect.objectContaining({
        id: "P103-v3.9.1-context-orchestration-hotfix-release",
        status: program.status === "completed" ? "done" : "in_progress",
      }),
    );
  });

  it("allows the governed local v3.9.2 successor without rewriting v3.9.1 history", () => {
    const program = readJson(".zerox/release-program.json");
    const conversationProgram = readJson(
      ".zerox/conversation-disclosure-program.json",
    );
    const packageJson = readJson("package.json");
    const features = readJson(".zerox/feature_list.json").features;
    const hasLocalV392Candidate = features.some(
      (feature: { id: string }) =>
        feature.id === "P113-v3.9.2-disclosure-adversarial-acceptance",
    );

    expect(program).toMatchObject({ version: "3.9.1", status: "completed" });
    expect(packageJson.version).toBe(
      hasLocalV392Candidate ? "3.9.2" : "3.9.1",
    );
    if (hasLocalV392Candidate) {
      expect(conversationProgram).toMatchObject({
        programId: "conversation-progressive-disclosure-v3.9.2-2026-08",
      });
      expect([
        "P113-v3.9.2-disclosure-adversarial-acceptance",
        null,
      ]).toContain(conversationProgram.activeFeatureId);
    }
  });

  it("declares ordered identity, package, push, tag, and closure gates", () => {
    const program = readJson(".zerox/release-program.json");
    expect(program.workstreams.map((workstream: { id: string }) => workstream.id))
      .toEqual(["R01", "R02", "R03", "R04", "R05"]);
    const states = program.workstreams.map(
      (workstream: { state: string }) => workstream.state,
    );
    expect(states.filter((state: string) => state === "in_progress")).toHaveLength(
      program.status === "active" ? 1 : 0,
    );
    const activeIndex = states.indexOf("in_progress");
    if (activeIndex >= 0) {
      expect(states.slice(0, activeIndex).every(
        (state: string) => state === "completed",
      )).toBe(true);
      expect(states.slice(activeIndex + 1).every(
        (state: string) => state === "planned",
      )).toBe(true);
    }
    expect(program.invariants.join("\n")).toContain("exactly six");
    expect(program.invariants.join("\n")).toContain("Ed25519");
    expect(program.invariants.join("\n")).toContain("clean tracked tree");
  });
});
