import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const checker = path.join(
  process.cwd(),
  "scripts",
  "check-runtime-convergence-program.mjs",
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("runtime convergence program checker", () => {
  it("accepts a dependency-ordered single-active program", async () => {
    const root = await createFixture();
    await expect(runChecker(root)).resolves.toContain(
      "Runtime convergence program check passed",
    );
  });

  it("accepts an idle boundary before the next planned Feature is promoted", async () => {
    const manifest = createManifest();
    manifest.workstreams[0].state = "completed";
    manifest.activeFeatureId = null;
    manifest.nextFeatureId = "P2";
    const root = await createFixture({
      manifest,
      featureStatus: "done",
    });
    await expect(runChecker(root)).resolves.toContain(
      "Runtime convergence program check passed",
    );
  });

  it.each([
    {
      name: "dependency cycles",
      mutate(manifest: ProgramFixture) {
        manifest.workstreams[0].dependsOn = ["RC02"];
      },
      expected: "workstream dependency cycle",
    },
    {
      name: "uncovered findings",
      mutate(manifest: ProgramFixture) {
        manifest.workstreams[1].findings = ["F6", "F7", "F8", "F9"];
      },
      expected: "does not cover review finding F10",
    },
    {
      name: "multiple active workstreams",
      mutate(manifest: ProgramFixture) {
        manifest.workstreams[1].state = "in_progress";
      },
      expected: "in-progress workstreams; maximum is 1",
    },
  ])("rejects $name", async ({ mutate, expected }) => {
    const manifest = createManifest();
    mutate(manifest);
    const root = await createFixture({ manifest });
    await expect(runChecker(root)).rejects.toContain(expected);
  });

  it("rejects missing program artifacts", async () => {
    const manifest = createManifest();
    manifest.operatingGuide = ".zerox/missing-guide.md";
    const root = await createFixture({ manifest });
    await expect(runChecker(root)).rejects.toContain(
      "operatingGuide does not exist",
    );
  });

  it("rejects program and Feature status drift", async () => {
    const root = await createFixture({
      featureStatus: "done",
    });
    await expect(runChecker(root)).rejects.toContain(
      "must be in_progress while RC01 is active",
    );
  });
});

type WorkstreamFixture = {
  id: string;
  featureId: string;
  state: "planned" | "in_progress" | "completed";
  findings: string[];
  dependsOn: string[];
  rollback: string;
  verification: string[];
};

type ProgramFixture = {
  schemaVersion: number;
  programId: string;
  sourceReview: string;
  operatingGuide: string;
  status: "active" | "completed";
  activeFeatureId: string | null;
  nextFeatureId: string | null;
  maxActiveFeatures: number;
  workstreams: WorkstreamFixture[];
};

function createManifest(): ProgramFixture {
  return {
    schemaVersion: 1,
    programId: "test-program",
    sourceReview: "docs/review.md",
    operatingGuide: ".zerox/guide.md",
    status: "active",
    activeFeatureId: "P1",
    nextFeatureId: "P1",
    maxActiveFeatures: 1,
    workstreams: [
      {
        id: "RC01",
        featureId: "P1",
        state: "in_progress",
        findings: ["F1", "F2", "F3", "F4", "F5"],
        dependsOn: [],
        rollback: "rollback RC01",
        verification: ["focused tests"],
      },
      {
        id: "RC02",
        featureId: "P2",
        state: "planned",
        findings: ["F6", "F7", "F8", "F9", "F10"],
        dependsOn: ["RC01"],
        rollback: "rollback RC02",
        verification: ["focused tests"],
      },
    ],
  };
}

async function createFixture(options: {
  manifest?: ProgramFixture;
  featureStatus?: "done" | "in_progress";
} = {}): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "zerox-program-check-"));
  roots.push(root);
  await Promise.all([
    mkdir(path.join(root, ".zerox"), { recursive: true }),
    mkdir(path.join(root, "docs"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(root, ".zerox", "runtime-convergence-program.json"),
      JSON.stringify(options.manifest ?? createManifest()),
      "utf8",
    ),
    writeFile(
      path.join(root, ".zerox", "feature_list.json"),
      JSON.stringify({
        schemaVersion: 1,
        features: [{ id: "P1", status: options.featureStatus ?? "in_progress" }],
      }),
      "utf8",
    ),
    writeFile(path.join(root, ".zerox", "guide.md"), "# Guide\n", "utf8"),
    writeFile(path.join(root, "docs", "review.md"), "# Review\n", "utf8"),
  ]);
  return root;
}

async function runChecker(root: string): Promise<string> {
  try {
    const result = await execFileAsync(process.execPath, [checker], {
      cwd: root,
      encoding: "utf8",
    });
    return result.stdout;
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw `${failure.stdout ?? ""}${failure.stderr ?? ""}${failure.message}`;
  }
}
