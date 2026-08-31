import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

describe("v3.9.2 release transition", () => {
  it("passes the machine-readable release checker", () => {
    expect(
      execFileSync(
        process.execPath,
        [path.join(root, "scripts", "check-release-program.mjs")],
        { cwd: root, encoding: "utf8" },
      ),
    ).toContain("Release program check passed");
  });

  it("preserves v3.9.1 history until P113 promotes the v3.9.2 release", () => {
    const program = readJson(".zerox/release-program.json");
    const features = readJson(".zerox/feature_list.json").features;
    const conversationProgram = readJson(
      ".zerox/conversation-disclosure-program.json",
    );
    const p113 = features.find(
      (feature: { id: string }) =>
        feature.id === "P113-v3.9.2-disclosure-adversarial-acceptance",
    );
    const p114 = features.find(
      (feature: { id: string }) =>
        feature.id === "P114-v3.9.2-resilience-release",
    );

    expect(["3.9.1", "3.9.2"]).toContain(program.version);
    expect(program.tag).toBe(`v${program.version}`);
    if (program.version === "3.9.1") {
      expect(program).toMatchObject({
        programId: "v3.9.1-context-hotfix-release-2026-08",
        status: "completed",
      });
      expect(p113.status).toBe("in_progress");
      expect(p114).toBeUndefined();
    } else {
      expect(conversationProgram).toMatchObject({
        status: "completed",
        activeFeatureId: null,
        nextFeatureId: null,
      });
      expect(p113.status).toBe("done");
      expect(p114.status).toBe(
        program.status === "completed" ? "done" : "in_progress",
      );
      expect(program.sourceBaseline).toMatchObject({
        commit: expect.stringMatching(/^[a-f0-9]{40}$/),
        releaseAttestationDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });
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
