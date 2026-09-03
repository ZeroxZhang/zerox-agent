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

  it("records the completed v3.9.1 program and the promoted v3.9.2 closure", () => {
    const program = readJson(".zerox/release-program.json");
    const features = readJson(".zerox/feature_list.json").features;
    // The disclosure program closed with v3.9.2 and is archived with its
    // evidence; it is read from the archive as the frozen record.
    const conversationProgram = readJson(
      "archive/disclosure-history/program/conversation-disclosure-program.json",
    );
    const p113 = features.find(
      (feature: { id: string }) =>
        feature.id === "P113-v3.9.2-disclosure-adversarial-acceptance",
    );

    expect(["3.9.1", "3.9.2"]).toContain(program.version);
    expect(program.tag).toBe(`v${program.version}`);
    expect(program.status).toBe("completed");
    // v3.9.2 shipped through the sealed release-attestation lane; P113 is
    // promoted to done while the release-program record remains the v3.9.1
    // context-hotfix closure (version migration is separate governance).
    expect(conversationProgram).toMatchObject({
      status: "completed",
      activeFeatureId: null,
      nextFeatureId: null,
    });
    expect(p113.status).toBe("done");
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
