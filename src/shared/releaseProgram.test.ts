import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

describe("v3.9.0 release program", () => {
  it("passes the machine-readable release checker", () => {
    expect(
      execFileSync(
        process.execPath,
        [path.join(root, "scripts", "check-release-program.mjs")],
        { cwd: root, encoding: "utf8" },
      ),
    ).toContain("Release program check passed");
  });

  it("starts only after the accepted P97 source baseline", () => {
    const program = readJson(".zerox/release-program.json");
    const features = readJson(".zerox/feature_list.json").features;
    const storageProgram = readJson(
      ".zerox/storage-convergence-program.json",
    );

    expect(program).toMatchObject({
      version: "3.9.0",
      tag: "v3.9.0",
      status: "active",
      activeFeatureId: "P98-v3.9.0-release",
      sourceBaseline: {
        commit: "fb09f898a18e4346386ff1731b1703d0e0565631",
        verifyRun: "31945392247",
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
        id: "P98-v3.9.0-release",
        status: "in_progress",
      }),
    );
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
